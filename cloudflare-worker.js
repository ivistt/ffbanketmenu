/* ══════════════════════════════════════════════════════════════
   Cloudflare Worker — Supabase Proxy + Auth · Ресторан ОГОнь

   РОЗГОРТАННЯ:
   1. dash.cloudflare.com → Workers & Pages → Create → Worker
   2. Замінити весь код на цей файл → Deploy
   3. Settings → Variables and Secrets:
        SUPABASE_URL  (Type: Text)    = https://xxxxx.supabase.co
        SUPABASE_KEY  (Type: Secret)  = eyJ...anon key...
        APP_PASSWORD_MAIN    (Type: Secret) = пароль для Основа
        APP_PASSWORD_DALNYK  (Type: Secret) = пароль для Дальник
        APP_PASSWORD         (Type: Secret) = optional legacy/admin password
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

    const auth = await verifyToken(request, env);
    if (auth.error) return corsResponse(auth.error);

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

      let requestText = '';
      let requestJson = null;
      if (['POST', 'PATCH'].includes(request.method)) {
        requestText = await request.text();
        if (requestText) {
          try {
            requestJson = JSON.parse(requestText);
          } catch {
            return corsResponse(json({ error: 'invalid_json' }, 400));
          }
        }
      }

      if (route === 'banquets' && auth.scope !== 'all') {
        if (['GET', 'PATCH', 'DELETE'].includes(effectiveMethod)) {
          sbUrl.searchParams.set('restaurant', `eq.${auth.scope}`);
        }
        if (['POST', 'PATCH'].includes(effectiveMethod)) {
          const nextBody = requestJson && typeof requestJson === 'object' ? requestJson : {};
          nextBody.restaurant = auth.scope;
          requestText = JSON.stringify(nextBody);
        }
      }

      const sbRequest = new Request(sbUrl.toString(), {
        method: effectiveMethod,
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_KEY,
          'Authorization': 'Bearer ' + env.SUPABASE_KEY,
          'Prefer': request.headers.get('Prefer') || 'return=representation',
        },
        body: ['POST', 'PATCH'].includes(effectiveMethod) ? requestText : undefined,
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
  if (!getConfiguredUsers(env).length) {
    return corsResponse(json({ ok: false, error: 'server_misconfigured' }, 500));
  }
  const user = resolveAuthUserByPassword(password, env);
  if (!user) {
    await sleep(400);
    return corsResponse(json({ ok: false, error: 'wrong_password' }, 401));
  }

  if (!user.secret) {
    return corsResponse(json({ ok: false, error: 'server_misconfigured' }, 500));
  }

  const token = await makeToken(user.secret, user.scope);
  return corsResponse(json({ ok: true, token, scope: user.scope, userLabel: user.label }, 200));
}

async function verifyToken(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return { error: json({ ok: false, error: 'unauthorized' }, 401) };
  }

  const auth = await validateToken(token, env);
  if (!auth) {
    return { error: json({ ok: false, error: 'invalid_token' }, 401) };
  }

  return auth;
}

// ══════════════════════════════════════════════════════════════
//  TOKEN HELPERS
// ══════════════════════════════════════════════════════════════

function getConfiguredUsers(env) {
  const users = [];
  if (env.APP_PASSWORD_MAIN) users.push({ scope: 'main', label: 'Основа', secret: env.APP_PASSWORD_MAIN });
  if (env.APP_PASSWORD_DALNYK) users.push({ scope: 'dalnyk', label: 'Дальник', secret: env.APP_PASSWORD_DALNYK });
  if (env.APP_PASSWORD) users.push({ scope: 'all', label: 'Адмін', secret: env.APP_PASSWORD });
  return users;
}

function resolveAuthUserByPassword(password, env) {
  return getConfiguredUsers(env).find(user => user.secret === password) || null;
}

function resolveAuthUserByScope(scope, env) {
  return getConfiguredUsers(env).find(user => user.scope === scope) || null;
}

function parseToken(token) {
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const payload = atob(b64);
    const bits = payload.split(':');
    if (bits[0] !== 'ogonh') return null;
    if (bits.length === 2) {
      const exp = parseInt(bits[1], 10);
      return { payload, sig, scope: 'all', exp };
    }
    const exp = parseInt(bits[2], 10);
    return { payload, sig, scope: bits[1] || 'all', exp };
  } catch {
    return null;
  }
}

async function makeToken(secret, scope) {
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = `ogonh:${scope}:${exp}`;
  const sig = await hmacHex(secret, payload);
  return btoa(payload) + '.' + sig;
}

async function validateToken(token, env) {
  const parsed = parseToken(token);
  if (!parsed || isNaN(parsed.exp) || Date.now() > parsed.exp) return null;
  const user = resolveAuthUserByScope(parsed.scope, env);
  if (!user || !user.secret) return null;
  const expected = await hmacHex(user.secret, parsed.payload);
  if (parsed.sig !== expected) return null;
  return { scope: user.scope, userLabel: user.label };
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
