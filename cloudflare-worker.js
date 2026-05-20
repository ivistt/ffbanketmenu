/* ══════════════════════════════════════════════════════════════
   Cloudflare Worker — Supabase Proxy + Auth · Ресторан ОГОнь

   РОЗГОРТАННЯ:
   1. dash.cloudflare.com → Workers & Pages → Create → Worker
   2. Замінити весь код на цей файл → Deploy
   3. Settings → Variables and Secrets:
        SUPABASE_URL  (Type: Text)    = https://xxxxx.supabase.co
        SUPABASE_KEY  (Type: Secret)  = eyJ...anon key...
        APP_PASSWORD  (Type: Secret)  = твій_пароль_для_входу
   4. Скопіюй URL воркера → встав у db.js в API_URL
      і в auth.js в WORKER_URL (той самий URL + /auth)

   ВАЖЛИВО:
   - Підтримує DELETE через POST + X-HTTP-Method-Override
   - Це обходить CORS preflight-проблему в браузері для адмінки
══════════════════════════════════════════════════════════════ */

const ALLOWED_TABLES = ['banquets', 'clients', 'menu_categories', 'menu_dishes'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/^\//, '').split('/')[0];

    if (route === 'auth') {
      return handleAuth(request, env);
    }

    if (route === 'menu' && request.method === 'GET') {
      return handlePublicMenu(request, env);
    }

    const authError = await verifyToken(request, env);
    if (authError) return corsResponse(authError);

    const override = request.headers.get('X-HTTP-Method-Override');
    const effectiveMethod = override || request.method;

    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(effectiveMethod)) {
      return corsResponse(new Response('Method not allowed', { status: 405 }));
    }

    try {
      if (!ALLOWED_TABLES.includes(route)) {
        return corsResponse(new Response('Not found', { status: 404 }));
      }

      const sbUrl = new URL(`${env.SUPABASE_URL}/rest/v1/${route}`);
      url.searchParams.forEach((v, k) => sbUrl.searchParams.set(k, v));

      const sbRequest = new Request(sbUrl.toString(), {
        method: effectiveMethod,
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_KEY,
          'Authorization': 'Bearer ' + env.SUPABASE_KEY,
          'Prefer': request.headers.get('Prefer') || 'return=representation',
        },
        body: ['POST', 'PATCH'].includes(effectiveMethod) ? request.body : undefined,
      });

      const sbRes = await fetch(sbRequest);
      const body = await sbRes.text();

      return corsResponse(new Response(body, {
        status: sbRes.status,
        headers: { 'Content-Type': 'application/json' },
      }));
    } catch (err) {
      return corsResponse(new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  }
};

// ══════════════════════════════════════════════════════════════
//  PUBLIC MENU — /menu (без авторизації)
// ══════════════════════════════════════════════════════════════

async function handlePublicMenu(request, env) {
  try {
    const sbHeaders = {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_KEY,
    };

    const [catsRes, dishesRes] = await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/menu_categories?order=sort_order.asc,name.asc`, { headers: sbHeaders }),
      fetch(`${env.SUPABASE_URL}/rest/v1/menu_dishes?order=sort_order.asc,name.asc`, { headers: sbHeaders }),
    ]);

    if (!catsRes.ok || !dishesRes.ok) {
      throw new Error(`Supabase error: cats=${catsRes.status} dishes=${dishesRes.status}`);
    }

    const categories = await catsRes.json();
    const dishes = await dishesRes.json();

    const menu = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icon || '',
      sort_order: cat.sort_order,
      dishes: dishes
        .filter(d => d.category_id === cat.id)
        .map(d => ({
          id: d.id,
          name: d.name,
          description: d.description || '',
          composition: d.composition || '',
          price: d.price || 0,
          weight: d.weight || '',
          extras: Array.isArray(d.extras) ? d.extras : [],
          image_url: d.image_url || '',
        })),
    }));

    return corsResponse(new Response(JSON.stringify(menu), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    }));
  } catch (err) {
    return corsResponse(new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════

async function handleAuth(request, env) {
  if (request.method !== 'POST') {
    return corsResponse(new Response('Method not allowed', { status: 405 }));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse(json({ ok: false, error: 'invalid_json' }, 400));
  }

  const { password } = body;
  if (!password) {
    return corsResponse(json({ ok: false, error: 'missing_password' }, 400));
  }
  if (!env.APP_PASSWORD) {
    return corsResponse(json({ ok: false, error: 'server_misconfigured' }, 500));
  }

  if (password !== env.APP_PASSWORD) {
    await sleep(400);
    return corsResponse(json({ ok: false, error: 'wrong_password' }, 401));
  }

  const token = await makeToken(env.APP_PASSWORD);
  return corsResponse(json({ ok: true, token }, 200));
}

async function verifyToken(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const valid = await validateToken(token, env.APP_PASSWORD);
  if (!valid) {
    return json({ ok: false, error: 'invalid_token' }, 401);
  }

  return null;
}

// ══════════════════════════════════════════════════════════════
//  TOKEN HELPERS
// ══════════════════════════════════════════════════════════════

async function makeToken(secret) {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = `ogonh:${exp}`;
  const sig = await hmacHex(secret, payload);
  return btoa(payload) + '.' + sig;
}

async function validateToken(token, secret) {
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return false;
    const payload = atob(b64);
    const exp = parseInt(payload.split(':')[1], 10);
    if (isNaN(exp) || Date.now() > exp) return false;
    const expected = await hmacHex(secret, payload);
    return sig === expected;
  } catch {
    return false;
  }
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function corsResponse(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, Prefer, Authorization, X-HTTP-Method-Override');
  return r;
}
