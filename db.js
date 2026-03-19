/* ══════════════════════════════════════════════════════════════
   db.js — Data Layer · Ресторан ОГОнь · Банкет-адмін
   Backend: Supabase через Cloudflare Worker

   Дані завжди тягнуться з сервера — без localStorage.
   Встав URL свого воркера в API_URL нижче.
══════════════════════════════════════════════════════════════ */

const API_URL = 'https://dark-morning-bd95.skifchaqwerty.workers.dev'; // ← https://your-worker.workers.dev (без слешу на кінці)

/* ══════════════════════════════════════════════════════════════
   API — запити через Cloudflare Worker
══════════════════════════════════════════════════════════════ */
async function api_get(table, params = '') {
  const res = await fetch(`${API_URL}/${table}${params ? '?' + params : ''}`);
  if (!res.ok) throw new Error(`[api_get ${table}] HTTP ${res.status}`);
  return res.json();
}

async function api_insert(table, body) {
  const res = await fetch(`${API_URL}/${table}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`[api_insert ${table}] HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function api_upsert(table, body) {
  const res = await fetch(`${API_URL}/${table}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`[api_upsert ${table}] HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function api_update(table, id, body) {
  const res = await fetch(`${API_URL}/${table}?id=eq.${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`[api_update ${table}] HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

/* ── Конвертація snake_case (Supabase) ↔ camelCase (app) ── */
function banquetFromSB(b) {
  return {
    id:          b.id,
    clientId:    b.client_id    || '',
    clientName:  b.client_name  || '',
    clientPhone: b.client_phone || '',
    date:        b.date         || '',
    time:        b.time         || '',
    hall:        b.hall         || 'big',
    hallLabel:   b.hall_label   || 'Великий зал',
    guests:      b.guests       || 0,
    deposit:     b.deposit      || 0,
    totalBase:   b.total_base   || 0,
    totalFinal:  b.total_final  || 0,
    modifier:    b.modifier     || 0,
    modLabel:    b.mod_label    || 'без',
    status:      b.status       || 'pending',
    comment:     b.comment      || '',
    dishes:      Array.isArray(b.dishes) ? b.dishes : [],
    createdAt:   b.created_at   || '',
  };
}

function banquetToSB(b) {
  return {
    id:           b.id,
    client_id:    b.clientId    || '',
    client_name:  b.clientName  || '',
    client_phone: b.clientPhone || '',
    date:         b.date        || '',
    time:         b.time        || '',
    hall:         b.hall        || 'big',
    hall_label:   b.hallLabel   || 'Великий зал',
    guests:       b.guests      || 0,
    deposit:      b.deposit     || 0,
    total_base:   b.totalBase   || 0,
    total_final:  b.totalFinal  || 0,
    modifier:     b.modifier    || 0,
    mod_label:    b.modLabel    || 'без',
    status:       b.status      || 'pending',
    comment:      b.comment     || '',
    dishes:       Array.isArray(b.dishes) ? b.dishes : [],
    created_at:   b.createdAt   || new Date().toISOString(),
  };
}

function clientFromSB(c) {
  return { id: c.id, name: c.name || '', phone: c.phone || '', createdAt: c.created_at || '' };
}

function clientToSB(c) {
  return { id: c.id, name: c.name, phone: c.phone, created_at: c.createdAt || new Date().toISOString() };
}

/* ══════════════════════════════════════════════════════════════
   BANQUETS API
══════════════════════════════════════════════════════════════ */

// Синхронна заглушка — повертає порожній масив,
// бо без localStorage у нас немає миттєвого кешу.
// Сторінки мають використовувати async db_getBanquets().
function db_getBanquetsSync() {
  return [];
}

async function db_getBanquets() {
  const rows = await api_get('banquets', 'order=date.desc');
  return rows.map(banquetFromSB);
}

async function db_getBanquet(id) {
  const rows = await api_get('banquets', `id=eq.${encodeURIComponent(id)}`);
  return rows.length ? banquetFromSB(rows[0]) : null;
}

async function db_addBanquet(banquet) {
  banquet.id        = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  banquet.createdAt = new Date().toISOString();
  banquet.status    = banquet.status || 'pending';
  await api_insert('banquets', banquetToSB(banquet));
  return banquet;
}

async function db_updateBanquet(id, updates) {
  const current = await db_getBanquet(id);
  if (!current) throw new Error('Banquet not found: ' + id);
  const updated = { ...current, ...updates };
  await api_update('banquets', id, banquetToSB(updated));
  return updated;
}

/* ══════════════════════════════════════════════════════════════
   CLIENTS API
══════════════════════════════════════════════════════════════ */

function db_getClientsSync() {
  return [];
}

async function db_getClients() {
  const rows = await api_get('clients', 'order=created_at.desc');
  return rows.map(clientFromSB);
}

async function db_getClient(id) {
  const rows = await api_get('clients', `id=eq.${encodeURIComponent(id)}`);
  return rows.length ? clientFromSB(rows[0]) : null;
}

async function db_findClientByPhone(phone) {
  const n    = phone.replace(/\D/g, '');
  const rows = await db_getClients();
  return rows.find(c => (c.phone||'').replace(/\D/g,'') === n) || null;
}

async function db_upsertClient(name, phone) {
  const existing = await db_findClientByPhone(phone);
  if (existing) return existing;

  const client = {
    id:        'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    name, phone,
    createdAt: new Date().toISOString(),
  };
  await api_upsert('clients', clientToSB(client));
  return client;
}

/* ══════════════════════════════════════════════════════════════
   DERIVED HELPERS (async)
══════════════════════════════════════════════════════════════ */
async function db_getClientBanquets(clientId) {
  const rows = await api_get('banquets', `client_id=eq.${encodeURIComponent(clientId)}&order=date.desc`);
  return rows.map(banquetFromSB);
}

async function db_getClientStats(clientId) {
  const banquets = await db_getClientBanquets(clientId);
  const total    = banquets.reduce((s, b) => s + (b.totalFinal || 0), 0);
  const last     = banquets.length
    ? [...banquets].sort((a,b) => new Date(b.date) - new Date(a.date))[0]
    : null;
  return { count: banquets.length, total, last };
}

/* ══════════════════════════════════════════════════════════════
   MENU API
   Читає меню з Supabase (таблиці menu_categories + menu_dishes)
   або з локального menu.json як fallback.

   SQL для Supabase (виконай в SQL Editor):

   CREATE TABLE menu_categories (
     id         text PRIMARY KEY,
     name       text,
     sort_order integer DEFAULT 0
   );
   CREATE TABLE menu_dishes (
     id          text PRIMARY KEY,
     category_id text REFERENCES menu_categories(id),
     name        text,
     description text,
     composition text,
     price       integer DEFAULT 0,
     weight      text,
     extras      jsonb DEFAULT '[]',
     image_url   text,
     sort_order  integer DEFAULT 0
   );
   -- Disable RLS для обох таблиць
══════════════════════════════════════════════════════════════ */

let _menuCache = null;

async function db_getMenu() {
  if (_menuCache) return _menuCache;

  if (API_URL) {
    try {
      const [categories, dishes] = await Promise.all([
        api_get('menu_categories', 'order=sort_order.asc'),
        api_get('menu_dishes',     'order=sort_order.asc'),
      ]);
      _menuCache = categories.map(cat => ({
        id:         cat.id,
        name:       cat.name,
        sort_order: cat.sort_order,
        dishes: dishes
          .filter(d => d.category_id === cat.id)
          .map(d => ({
            id:          d.id,
            name:        d.name,
            description: d.description || '',
            composition: d.composition || '',
            price:       d.price       || 0,
            weight:      d.weight      || '',
            extras:      Array.isArray(d.extras) ? d.extras : [],
            image_url:   d.image_url   || '',
          })),
      }));
      return _menuCache;
    } catch(err) {
      console.warn('[db_getMenu] Supabase error, fallback to menu.json:', err.message);
    }
  }

  // Fallback — локальний файл
  try {
    const r = await fetch('./menu.json');
    _menuCache = await r.json();
    return _menuCache;
  } catch(err) {
    console.warn('[db_getMenu] menu.json not found:', err.message);
    return [];
  }
}

function db_clearMenuCache() { _menuCache = null; }

/* ══════════════════════════════════════════════════════════════
   SEED — демо-дані коли API_URL не вказано
══════════════════════════════════════════════════════════════ */
// Зберігаємо seed у пам'яті (не в localStorage)
let _seedBanquets = null;
let _seedClients  = null;

function db_seed() {
  if (API_URL) return;

  _seedClients = [
    { id:'c1', name:'Олена Коваль',     phone:'+380 67 123 4567', createdAt:'2025-06-01T10:00:00Z' },
    { id:'c2', name:'Михайло Бондар',   phone:'+380 50 987 6543', createdAt:'2025-06-15T12:00:00Z' },
    { id:'c3', name:'Тетяна Мороз',     phone:'+380 73 456 7890', createdAt:'2025-07-01T09:00:00Z' },
    { id:'c4', name:'Андрій Шевченко',  phone:'+380 96 321 0987', createdAt:'2025-07-10T11:00:00Z' },
    { id:'c5', name:'Юлія Іваненко',    phone:'+380 63 654 3210', createdAt:'2025-07-20T14:00:00Z' },
    { id:'c6', name:'Павло Кравченко',  phone:'+380 98 111 2233', createdAt:'2025-08-01T10:00:00Z' },
  ];
  _seedBanquets = [
    { id:'b1', clientId:'c1', clientName:'Олена Коваль',    clientPhone:'+380 67 123 4567', date:'2025-08-14', guests:45, deposit:8000,  totalBase:42000, totalFinal:42000, modifier:0,   modLabel:'без',  status:'confirmed', comment:'День народження, алергія на горіхи', dishes:[{id:'d1',name:'Філадельфія Класік',qty:3,price:340},{id:'d2',name:'Самурай',qty:5,price:425},{id:'d4',name:'Шашлик',qty:10,price:380},{id:'d3',name:'Хачапурі',qty:8,price:290}], createdAt:'2025-08-01T10:00:00Z' },
    { id:'b2', clientId:'c2', clientName:'Михайло Бондар',  clientPhone:'+380 50 987 6543', date:'2025-08-19', guests:60, deposit:10000, totalBase:61818, totalFinal:68000, modifier:10,  modLabel:'+10%', status:'confirmed', comment:'Корпоратив', dishes:[{id:'d5',name:'Вогняний Дракон',qty:4,price:445},{id:'d6',name:'Канада',qty:6,price:410},{id:'d3',name:'Хачапурі',qty:10,price:290},{id:'d4',name:'Шашлик',qty:8,price:380}], createdAt:'2025-08-05T11:00:00Z' },
    { id:'b3', clientId:'c3', clientName:'Тетяна Мороз',    clientPhone:'+380 73 456 7890', date:'2025-08-23', guests:30, deposit:5000,  totalBase:28500, totalFinal:28500, modifier:0,   modLabel:'без',  status:'pending',   comment:'', dishes:[{id:'d2',name:'Самурай',qty:4,price:425},{id:'d3',name:'Хачапурі',qty:6,price:290}], createdAt:'2025-08-10T09:00:00Z' },
    { id:'b4', clientId:'c4', clientName:'Андрій Шевченко', clientPhone:'+380 96 321 0987', date:'2025-08-30', guests:80, deposit:15000, totalBase:79167, totalFinal:95000, modifier:20,  modLabel:'+20%', status:'confirmed', comment:'Весілля, жива музика', dishes:[{id:'d1',name:'Філадельфія Класік',qty:10,price:340},{id:'d4',name:'Шашлик',qty:20,price:380},{id:'d3',name:'Хачапурі',qty:15,price:290}], createdAt:'2025-08-12T14:00:00Z' },
    { id:'b5', clientId:'c5', clientName:'Юлія Іваненко',   clientPhone:'+380 63 654 3210', date:'2025-09-05', guests:25, deposit:4000,  totalBase:23333, totalFinal:21000, modifier:-10, modLabel:'-10%', status:'pending',   comment:'Ювілей', dishes:[{id:'d2',name:'Самурай',qty:3,price:425},{id:'d3',name:'Хачапурі',qty:5,price:290}], createdAt:'2025-08-15T10:00:00Z' },
    { id:'b6', clientId:'c6', clientName:'Павло Кравченко', clientPhone:'+380 98 111 2233', date:'2025-09-12', guests:50, deposit:9000,  totalBase:53000, totalFinal:53000, modifier:0,   modLabel:'без',  status:'confirmed', comment:'Корпоратив, без алкоголю', dishes:[{id:'d1',name:'Філадельфія Класік',qty:8,price:340},{id:'d6',name:'Канада',qty:6,price:410},{id:'d4',name:'Шашлик',qty:12,price:380}], createdAt:'2025-08-20T11:00:00Z' },
    { id:'b7', clientId:'c1', clientName:'Олена Коваль',    clientPhone:'+380 67 123 4567', date:'2025-10-20', guests:35, deposit:6000,  totalBase:31000, totalFinal:34100, modifier:10,  modLabel:'+10%', status:'pending',   comment:'Ювілей матері', dishes:[{id:'d5',name:'Вогняний Дракон',qty:5,price:445},{id:'d3',name:'Хачапурі',qty:7,price:290},{id:'d4',name:'Шашлик',qty:8,price:380}], createdAt:'2025-09-01T10:00:00Z' },
  ];

  // Перевизначаємо API функції для офлайн-режиму
  window._offlineMode = true;
}

// Офлайн-перевизначення викликаються після db_seed() якщо API_URL порожній
if (!API_URL) {
  // Замінюємо async функції на офлайн-версії після завантаження
  window.addEventListener('DOMContentLoaded', () => {
    if (!window._offlineMode) return;

    db_getBanquets     = async () => _seedBanquets || [];
    db_getBanquet      = async (id) => (_seedBanquets||[]).find(b=>b.id===id) || null;
    db_getClients      = async () => _seedClients || [];
    db_getClient       = async (id) => (_seedClients||[]).find(c=>c.id===id) || null;
    db_findClientByPhone = async (phone) => {
      const n = phone.replace(/\D/g,'');
      return (_seedClients||[]).find(c=>(c.phone||'').replace(/\D/g,'')=== n)||null;
    };
    db_getClientBanquets = async (clientId) =>
      (_seedBanquets||[]).filter(b=>b.clientId===clientId);
    db_getClientStats  = async (clientId) => {
      const bq = (_seedBanquets||[]).filter(b=>b.clientId===clientId);
      return { count:bq.length, total:bq.reduce((s,b)=>s+(b.totalFinal||0),0),
        last: bq.length?[...bq].sort((a,b)=>new Date(b.date)-new Date(a.date))[0]:null };
    };
    db_upsertClient    = async (name, phone) => ({ id:'c_new', name, phone, createdAt: new Date().toISOString() });
    db_addBanquet      = async (b) => ({ ...b, id:'b_new_'+Date.now(), createdAt:new Date().toISOString() });
    db_updateBanquet   = async (id, u) => ({ id, ...u });
  });
}

/* ══════════════════════════════════════════════════════════════
   SHARED UI HELPERS
══════════════════════════════════════════════════════════════ */
function fmt(n)         { return (n || 0).toLocaleString('uk-UA') + ' ₴'; }
function fmtDate(s)     { if (!s) return '—'; const part=(s+'').split('T')[0]; const [y,m,d]=part.split('-'); if(!d) return s; return `${d}.${m}.${y}`; }
function statusLabel(s) { return { confirmed:'Підтверджено', pending:'Очікує', cancelled:'Скасовано' }[s] || s; }
function getParam(k)    { return new URLSearchParams(window.location.search).get(k); }
function goTo(page, params) {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  window.location.href = page + q;
}
function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function renderOfflineBanner() {
  if (API_URL) return;
  const bar = document.createElement('div');
  bar.style.cssText = [
    'position:fixed','bottom:0','left:0','right:0',
    'background:#1a1208','border-top:1px solid rgba(232,87,42,.3)',
    'padding:8px 24px','font-size:12px','color:#f0893a',
    'font-weight:600','z-index:500','display:flex',
    'align-items:center','gap:12px','font-family:Manrope,sans-serif'
  ].join(';');
  bar.innerHTML = `<span>⚠️ Офлайн-режим — дані тільки демонстраційні</span>`;
  document.body.appendChild(bar);
}
