/* ══════════════════════════════════════════════════════════════
   db.js  —  Banquet Admin · Data Layer
   Зберігає в Google Sheets через Apps Script Web App.
   Кешує в localStorage для швидкого рендеру без мигання.

   НАЛАШТУВАННЯ:
   1. Відкрий Google Таблицю → Розширення → Apps Script
   2. Вставте код з appscript.js → Деплой → New deployment
   3. Execute as: Me | Who has access: Anyone
   4. Скопіюйте URL і встав нижче в SHEETS_URL
══════════════════════════════════════════════════════════════ */

const SHEETS_URL = ''; // ← сюди вставити URL після деплою Apps Script

/* ── CACHE KEYS ── */
const CK_BANQUETS = 'ogon_banquets_v2';
const CK_CLIENTS  = 'ogon_clients_v2';

/* ══════════════════════════════════════════════════════════════
   CACHE HELPERS
══════════════════════════════════════════════════════════════ */
function cache_get(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function cache_set(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

/* ══════════════════════════════════════════════════════════════
   SHEETS API CALL
══════════════════════════════════════════════════════════════ */
async function sheets_call(action, body = {}) {
  if (!SHEETS_URL) {
    console.warn('[db] SHEETS_URL не налаштовано, працюємо в офлайн-режимі');
    return null;
  }
  try {
    const res = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // Apps Script requires text/plain for POST
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Sheets API error');
    return data.data;
  } catch (err) {
    console.error('[Sheets API]', err);
    throw err;
  }
}

/* ══════════════════════════════════════════════════════════════
   BANQUETS
══════════════════════════════════════════════════════════════ */

/** Повертає всі банкети з кешу миттєво, потім синхронізує з Sheets */
async function db_getBanquets({ sync = false } = {}) {
  const cached = cache_get(CK_BANQUETS);
  if (!sync) return cached;

  const remote = await sheets_call('getBanquets');
  if (remote) {
    cache_set(CK_BANQUETS, remote);
    return remote;
  }
  return cached;
}

function db_getBanquetsSync() {
  return cache_get(CK_BANQUETS);
}

function db_getBanquet(id) {
  return cache_get(CK_BANQUETS).find(b => b.id === id) || null;
}

async function db_addBanquet(banquet) {
  banquet.id        = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  banquet.createdAt = new Date().toISOString();
  banquet.status    = banquet.status || 'pending';

  // Update local cache first (optimistic)
  const list = cache_get(CK_BANQUETS);
  list.push(banquet);
  cache_set(CK_BANQUETS, list);

  // Sync to Sheets
  await sheets_call('addBanquet', banquet);
  return banquet;
}

async function db_updateBanquet(id, updates) {
  // Update local cache first (optimistic)
  const list    = cache_get(CK_BANQUETS);
  const idx     = list.findIndex(b => b.id === id);
  if (idx === -1) throw new Error('Banquet not found: ' + id);
  const updated = { ...list[idx], ...updates };
  list[idx]     = updated;
  cache_set(CK_BANQUETS, list);

  // Sync to Sheets
  await sheets_call('updateBanquet', { id, ...updates });
  return updated;
}

/* ══════════════════════════════════════════════════════════════
   CLIENTS
══════════════════════════════════════════════════════════════ */

function db_getClientsSync() {
  return cache_get(CK_CLIENTS);
}

async function db_getClients({ sync = false } = {}) {
  const cached = cache_get(CK_CLIENTS);
  if (!sync) return cached;
  const remote = await sheets_call('getClients');
  if (remote) { cache_set(CK_CLIENTS, remote); return remote; }
  return cached;
}

function db_getClient(id) {
  return cache_get(CK_CLIENTS).find(c => c.id === id) || null;
}

function db_findClientByPhone(phone) {
  const n = phone.replace(/\D/g, '');
  return cache_get(CK_CLIENTS).find(c => c.phone.replace(/\D/g, '') === n) || null;
}

async function db_upsertClient(name, phone) {
  const existing = db_findClientByPhone(phone);
  if (existing) return existing;

  const client = {
    id:        'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name, phone,
    createdAt: new Date().toISOString(),
  };

  // Update local cache first
  const list = cache_get(CK_CLIENTS);
  list.push(client);
  cache_set(CK_CLIENTS, list);

  // Sync to Sheets
  await sheets_call('upsertClient', client);
  return client;
}

/* ══════════════════════════════════════════════════════════════
   DERIVED / STATS
══════════════════════════════════════════════════════════════ */
function db_getClientBanquets(clientId) {
  return cache_get(CK_BANQUETS).filter(b => b.clientId === clientId);
}

function db_getClientStats(clientId) {
  const banquets = db_getClientBanquets(clientId);
  const total    = banquets.reduce((s, b) => s + (b.totalFinal || 0), 0);
  const last     = banquets.length
    ? banquets.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    : null;
  return { count: banquets.length, total, last };
}

/* ══════════════════════════════════════════════════════════════
   SEED MOCK DATA  (if cache is empty and no Sheets URL set)
══════════════════════════════════════════════════════════════ */
function db_seed() {
  if (SHEETS_URL) return; // don't seed when real Sheets is connected
  if (cache_get(CK_BANQUETS).length > 0) return;

  const clients = [
    { id:'c1', name:'Олена Коваль',     phone:'+380 67 123 4567', createdAt:'2025-06-01T10:00:00Z' },
    { id:'c2', name:'Михайло Бондар',   phone:'+380 50 987 6543', createdAt:'2025-06-15T12:00:00Z' },
    { id:'c3', name:'Тетяна Мороз',     phone:'+380 73 456 7890', createdAt:'2025-07-01T09:00:00Z' },
    { id:'c4', name:'Андрій Шевченко',  phone:'+380 96 321 0987', createdAt:'2025-07-10T11:00:00Z' },
    { id:'c5', name:'Юлія Іваненко',    phone:'+380 63 654 3210', createdAt:'2025-07-20T14:00:00Z' },
    { id:'c6', name:'Павло Кравченко',  phone:'+380 98 111 2233', createdAt:'2025-08-01T10:00:00Z' },
  ];
  cache_set(CK_CLIENTS, clients);

  const banquets = [
    { id:'b1', clientId:'c1', clientName:'Олена Коваль',    clientPhone:'+380 67 123 4567', date:'2025-08-14', guests:45, deposit:8000,  totalBase:42000, totalFinal:42000, modifier:0,   modLabel:'без',  status:'confirmed', comment:'День народження, алергія на горіхи', dishes:[{name:'Філадельфія Класік',qty:3,price:340},{name:'Самурай',qty:5,price:425},{name:'Шашлик',qty:10,price:380},{name:'Хачапурі',qty:8,price:290}], createdAt:'2025-08-01T10:00:00Z' },
    { id:'b2', clientId:'c2', clientName:'Михайло Бондар',  clientPhone:'+380 50 987 6543', date:'2025-08-19', guests:60, deposit:10000, totalBase:61818, totalFinal:68000, modifier:10,  modLabel:'+10%', status:'confirmed', comment:'Корпоратив', dishes:[{name:'Вогняний Дракон',qty:4,price:445},{name:'Канада',qty:6,price:410},{name:'Хачапурі',qty:10,price:290},{name:'Шашлик',qty:8,price:380}], createdAt:'2025-08-05T11:00:00Z' },
    { id:'b3', clientId:'c3', clientName:'Тетяна Мороз',    clientPhone:'+380 73 456 7890', date:'2025-08-23', guests:30, deposit:5000,  totalBase:28500, totalFinal:28500, modifier:0,   modLabel:'без',  status:'pending',   comment:'', dishes:[{name:'Каліфорнія',qty:5,price:325},{name:'Самурай',qty:4,price:425},{name:'Хачапурі',qty:6,price:290}], createdAt:'2025-08-10T09:00:00Z' },
    { id:'b4', clientId:'c4', clientName:'Андрій Шевченко', clientPhone:'+380 96 321 0987', date:'2025-08-30', guests:80, deposit:15000, totalBase:79167, totalFinal:95000, modifier:20,  modLabel:'+20%', status:'confirmed', comment:'Весілля, жива музика', dishes:[{name:'Філадельфія Класік',qty:10,price:340},{name:'Шашлик',qty:20,price:380},{name:'Хачапурі',qty:15,price:290},{name:'Канада',qty:5,price:410}], createdAt:'2025-08-12T14:00:00Z' },
    { id:'b5', clientId:'c5', clientName:'Юлія Іваненко',   clientPhone:'+380 63 654 3210', date:'2025-09-05', guests:25, deposit:4000,  totalBase:23333, totalFinal:21000, modifier:-10, modLabel:'-10%', status:'pending',   comment:'Ювілей, потрібен торт', dishes:[{name:'Самурай',qty:3,price:425},{name:'Fire Roll',qty:4,price:380},{name:'Хачапурі',qty:5,price:290}], createdAt:'2025-08-15T10:00:00Z' },
    { id:'b6', clientId:'c6', clientName:'Павло Кравченко', clientPhone:'+380 98 111 2233', date:'2025-09-12', guests:50, deposit:9000,  totalBase:53000, totalFinal:53000, modifier:0,   modLabel:'без',  status:'confirmed', comment:'Корпоратив, без алкоголю', dishes:[{name:'Філадельфія Класік',qty:8,price:340},{name:'Канада',qty:6,price:410},{name:'Шашлик',qty:12,price:380},{name:'Хачапурі',qty:10,price:290}], createdAt:'2025-08-20T11:00:00Z' },
    { id:'b7', clientId:'c1', clientName:'Олена Коваль',    clientPhone:'+380 67 123 4567', date:'2025-10-20', guests:35, deposit:6000,  totalBase:31000, totalFinal:34100, modifier:10,  modLabel:'+10%', status:'pending',   comment:'Ювілей матері', dishes:[{name:'Вогняний Дракон',qty:5,price:445},{name:'Хачапурі',qty:7,price:290},{name:'Шашлик',qty:8,price:380}], createdAt:'2025-09-01T10:00:00Z' },
  ];
  cache_set(CK_BANQUETS, banquets);
}

/* ══════════════════════════════════════════════════════════════
   SHARED UI HELPERS  (available on every page)
══════════════════════════════════════════════════════════════ */
function fmt(n)      { return (n || 0).toLocaleString('uk-UA') + ' ₴'; }
function fmtDate(s)  { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${d}.${m}.${y}`; }
function statusLabel(s) { return { confirmed:'Підтверджено', pending:'Очікує', cancelled:'Скасовано' }[s] || s; }
function getParam(k) { return new URLSearchParams(window.location.search).get(k); }
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

/* ══════════════════════════════════════════════════════════════
   SYNC BANNER  —  показується коли SHEETS_URL не вказано
══════════════════════════════════════════════════════════════ */
function renderOfflineBanner() {
  if (SHEETS_URL) return;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#2a1208;border-top:1px solid rgba(232,87,42,.3);padding:8px 24px;font-size:12px;color:#f0893a;font-weight:600;z-index:500;display:flex;align-items:center;gap:10px;font-family:Manrope,sans-serif';
  bar.innerHTML = '⚠️ Офлайн-режим: дані зберігаються тільки в браузері. <a href="#" style="color:#e8572a;text-decoration:underline" onclick="alert(\'Встав URL Apps Script у константу SHEETS_URL у файлі db.js\')">Як підключити Google Sheets?</a>';
  document.body.appendChild(bar);
}
