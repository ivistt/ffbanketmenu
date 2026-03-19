/* ══════════════════════════════════════════════════════════════
   db.js — Data Layer · Ресторан ОГОнь · Банкет-адмін

   ПІДКЛЮЧЕННЯ Google Sheets:
   1. Зроби деплой appscript.js як Web App (інструкція всередині)
   2. Встав URL нижче в SHEETS_URL
   3. Збережи і закинь на GitHub — готово

   ЯК ПРАЦЮЄ:
   • Дані зберігаються локально (localStorage) — миттєвий інтерфейс
   • При записі (addBanquet, updateBanquet) — надсилає у Sheets фоново
   • Кнопка "Синхронізувати" тягне актуальні дані з Sheets у кеш
   • Якщо Sheets недоступний — продовжує працювати офлайн
══════════════════════════════════════════════════════════════ */

const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbzu0I7ljbIiQLXSRHG03KvPkeC3-SAHEoE3ZhWCekv4RAe-RYzeROfKQU8Wvj5_BRI/exec'; // ← вставити URL після деплою Apps Script
                        // вигляд: https://script.google.com/macros/s/ABC.../exec

/* ── CACHE KEYS ── */
const CK_BANQUETS = 'ogon_banquets_v2';
const CK_CLIENTS  = 'ogon_clients_v2';

/* ══════════════════════════════════════════════════════════════
   LOCAL CACHE (localStorage)
══════════════════════════════════════════════════════════════ */
function cache_get(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function cache_set(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {
    console.warn('[db] localStorage error:', e);
  }
}

/* ══════════════════════════════════════════════════════════════
   SHEETS API
   Використовуємо mode:'no-cors' для запису — браузер не читає
   відповідь, але дані доходять до Apps Script.
   Для читання (sync) — звичайний fetch, Apps Script повертає JSON.
══════════════════════════════════════════════════════════════ */
async function sheets_write(action, body) {
  if (!SHEETS_URL) return null;
  try {
    // GET + no-cors — єдиний надійний спосіб з GitHub Pages.
    // POST блокується CORS preflight. Apps Script читає через e.parameter.
    const url = new URL(SHEETS_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('payload', JSON.stringify(body));
    await fetch(url.toString(), { method: 'GET', mode: 'no-cors' });
    return true;
  } catch (err) {
    console.warn('[Sheets write]', err.message);
    return null;
  }
}

async function sheets_read(action, params = {}) {
  if (!SHEETS_URL) return null;
  try {
    const url    = new URL(SHEETS_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
    const res  = await fetch(url.toString(), { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    return data.data;
  } catch (err) {
    console.warn('[Sheets read]', err.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   BANQUETS API
══════════════════════════════════════════════════════════════ */

/** Повертає з кешу миттєво */
function db_getBanquetsSync() {
  return cache_get(CK_BANQUETS);
}

/** Повертає з кешу; якщо sync=true — спочатку тягне з Sheets */
async function db_getBanquets({ sync = false } = {}) {
  if (sync) {
    const remote = await sheets_read('getBanquets');
    if (remote) { cache_set(CK_BANQUETS, remote); return remote; }
  }
  return cache_get(CK_BANQUETS);
}

function db_getBanquet(id) {
  return cache_get(CK_BANQUETS).find(b => b.id === id) || null;
}

async function db_addBanquet(banquet) {
  banquet.id        = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  banquet.createdAt = new Date().toISOString();
  banquet.status    = banquet.status || 'pending';

  // 1. Зберегти в кеш (миттєво)
  const list = cache_get(CK_BANQUETS);
  list.push(banquet);
  cache_set(CK_BANQUETS, list);

  // 2. Надіслати в Sheets (фоново, no-cors)
  sheets_write('addBanquet', banquet);

  return banquet;
}

async function db_updateBanquet(id, updates) {
  // 1. Оновити кеш (миттєво)
  const list = cache_get(CK_BANQUETS);
  const idx  = list.findIndex(b => b.id === id);
  if (idx === -1) throw new Error('Banquet not found: ' + id);
  const updated = { ...list[idx], ...updates };
  list[idx]     = updated;
  cache_set(CK_BANQUETS, list);

  // 2. Надіслати в Sheets (фоново, no-cors)
  sheets_write('updateBanquet', { id, ...updates });

  return updated;
}

/* ══════════════════════════════════════════════════════════════
   CLIENTS API
══════════════════════════════════════════════════════════════ */

function db_getClientsSync() {
  return cache_get(CK_CLIENTS);
}

async function db_getClients({ sync = false } = {}) {
  if (sync) {
    const remote = await sheets_read('getClients');
    if (remote) { cache_set(CK_CLIENTS, remote); return remote; }
  }
  return cache_get(CK_CLIENTS);
}

function db_getClient(id) {
  return cache_get(CK_CLIENTS).find(c => c.id === id) || null;
}

function db_findClientByPhone(phone) {
  const n = phone.replace(/\D/g, '');
  return cache_get(CK_CLIENTS).find(c => (c.phone||'').replace(/\D/g,'') === n) || null;
}

async function db_upsertClient(name, phone) {
  const existing = db_findClientByPhone(phone);
  if (existing) return existing;

  const client = {
    id:        'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    name, phone,
    createdAt: new Date().toISOString(),
  };

  // 1. Зберегти в кеш
  const list = cache_get(CK_CLIENTS);
  list.push(client);
  cache_set(CK_CLIENTS, list);

  // 2. Надіслати в Sheets (no-cors)
  sheets_write('upsertClient', client);

  return client;
}

/* ══════════════════════════════════════════════════════════════
   DERIVED HELPERS
══════════════════════════════════════════════════════════════ */
function db_getClientBanquets(clientId) {
  return cache_get(CK_BANQUETS).filter(b => b.clientId === clientId);
}

function db_getClientStats(clientId) {
  const banquets = db_getClientBanquets(clientId);
  const total    = banquets.reduce((s, b) => s + (b.totalFinal || 0), 0);
  const last     = banquets.length
    ? [...banquets].sort((a,b) => new Date(b.date) - new Date(a.date))[0]
    : null;
  return { count: banquets.length, total, last };
}

/* ══════════════════════════════════════════════════════════════
   SEED (тільки коли немає SHEETS_URL і кеш порожній)
══════════════════════════════════════════════════════════════ */
function db_seed() {
  if (SHEETS_URL) return;
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
    { id:'b1', clientId:'c1', clientName:'Олена Коваль',    clientPhone:'+380 67 123 4567', date:'2025-08-14', guests:45, deposit:8000,  totalBase:42000, totalFinal:42000, modifier:0,   modLabel:'без',  status:'confirmed', comment:'День народження, алергія на горіхи', dishes:[{id:'d1',name:'Філадельфія Класік',qty:3,price:340},{id:'d2',name:'Самурай',qty:5,price:425},{id:'d4',name:'Шашлик',qty:10,price:380},{id:'d3',name:'Хачапурі',qty:8,price:290}], createdAt:'2025-08-01T10:00:00Z' },
    { id:'b2', clientId:'c2', clientName:'Михайло Бондар',  clientPhone:'+380 50 987 6543', date:'2025-08-19', guests:60, deposit:10000, totalBase:61818, totalFinal:68000, modifier:10,  modLabel:'+10%', status:'confirmed', comment:'Корпоратив', dishes:[{id:'d5',name:'Вогняний Дракон',qty:4,price:445},{id:'d6',name:'Канада',qty:6,price:410},{id:'d3',name:'Хачапурі',qty:10,price:290},{id:'d4',name:'Шашлик',qty:8,price:380}], createdAt:'2025-08-05T11:00:00Z' },
    { id:'b3', clientId:'c3', clientName:'Тетяна Мороз',    clientPhone:'+380 73 456 7890', date:'2025-08-23', guests:30, deposit:5000,  totalBase:28500, totalFinal:28500, modifier:0,   modLabel:'без',  status:'pending',   comment:'', dishes:[{id:'d2',name:'Самурай',qty:4,price:425},{id:'d3',name:'Хачапурі',qty:6,price:290}], createdAt:'2025-08-10T09:00:00Z' },
    { id:'b4', clientId:'c4', clientName:'Андрій Шевченко', clientPhone:'+380 96 321 0987', date:'2025-08-30', guests:80, deposit:15000, totalBase:79167, totalFinal:95000, modifier:20,  modLabel:'+20%', status:'confirmed', comment:'Весілля, жива музика', dishes:[{id:'d1',name:'Філадельфія Класік',qty:10,price:340},{id:'d4',name:'Шашлик',qty:20,price:380},{id:'d3',name:'Хачапурі',qty:15,price:290}], createdAt:'2025-08-12T14:00:00Z' },
    { id:'b5', clientId:'c5', clientName:'Юлія Іваненко',   clientPhone:'+380 63 654 3210', date:'2025-09-05', guests:25, deposit:4000,  totalBase:23333, totalFinal:21000, modifier:-10, modLabel:'-10%', status:'pending',   comment:'Ювілей', dishes:[{id:'d2',name:'Самурай',qty:3,price:425},{id:'d3',name:'Хачапурі',qty:5,price:290}], createdAt:'2025-08-15T10:00:00Z' },
    { id:'b6', clientId:'c6', clientName:'Павло Кравченко', clientPhone:'+380 98 111 2233', date:'2025-09-12', guests:50, deposit:9000,  totalBase:53000, totalFinal:53000, modifier:0,   modLabel:'без',  status:'confirmed', comment:'Корпоратив, без алкоголю', dishes:[{id:'d1',name:'Філадельфія Класік',qty:8,price:340},{id:'d6',name:'Канада',qty:6,price:410},{id:'d4',name:'Шашлик',qty:12,price:380}], createdAt:'2025-08-20T11:00:00Z' },
    { id:'b7', clientId:'c1', clientName:'Олена Коваль',    clientPhone:'+380 67 123 4567', date:'2025-10-20', guests:35, deposit:6000,  totalBase:31000, totalFinal:34100, modifier:10,  modLabel:'+10%', status:'pending',   comment:'Ювілей матері', dishes:[{id:'d5',name:'Вогняний Дракон',qty:5,price:445},{id:'d3',name:'Хачапурі',qty:7,price:290},{id:'d4',name:'Шашлик',qty:8,price:380}], createdAt:'2025-09-01T10:00:00Z' },
  ];
  cache_set(CK_BANQUETS, banquets);
}

/* ══════════════════════════════════════════════════════════════
   SHARED UI HELPERS
══════════════════════════════════════════════════════════════ */
function fmt(n)      { return (n || 0).toLocaleString('uk-UA') + ' ₴'; }
function fmtDate(s)  { if (!s) return '—'; const part = (s+'').split('T')[0]; const [y,m,d] = part.split('-'); if (!d) return s; return `${d}.${m}.${y}`; }
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
   OFFLINE BANNER — показується коли SHEETS_URL не вказано
══════════════════════════════════════════════════════════════ */
function renderOfflineBanner() {
  if (SHEETS_URL) return; // підключено — не показуємо
  const bar = document.createElement('div');
  bar.id = 'offline-bar';
  bar.style.cssText = [
    'position:fixed','bottom:0','left:0','right:0',
    'background:#1a1208','border-top:1px solid rgba(232,87,42,.3)',
    'padding:8px 24px','font-size:12px','color:#f0893a',
    'font-weight:600','z-index:500','display:flex',
    'align-items:center','gap:12px','font-family:Manrope,sans-serif'
  ].join(';');
  bar.innerHTML = `
    <span>⚠️ Офлайн-режим — дані тільки в браузері цього пристрою</span>
    <a href="#" onclick="showHowToConnect();return false"
       style="color:var(--accent,#e8572a);text-decoration:underline;white-space:nowrap">
      Як підключити Google Sheets?
    </a>`;
  document.body.appendChild(bar);
}

function showHowToConnect() {
  alert(
    'Щоб підключити Google Sheets:\n\n' +
    '1. Відкрий Google Таблицю → Розширення → Apps Script\n' +
    '2. Вставте код з файлу appscript.js\n' +
    '3. Деплой → Новий деплой → Веб-застосунок\n' +
    '   Виконувати як: Я\n' +
    '   Хто має доступ: Усі\n' +
    '4. Скопіюйте URL деплою\n' +
    '5. Вставте URL у db.js → const SHEETS_URL = "ВАШ_URL"'
  );
}
