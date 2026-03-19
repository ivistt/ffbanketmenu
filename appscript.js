// ══════════════════════════════════════════════════════════════
//  appscript.js — Ресторан ОГОнь · Банкет-адмін
//
//  ВСТАНОВЛЕННЯ:
//  1. Відкрий Google Таблицю → Розширення → Apps Script
//  2. Видали весь код → вставте цей файл → Ctrl+S
//  3. Деплой → Новий деплой → Веб-застосунок
//     • Виконувати як:   Я (my@gmail.com)
//     • Хто має доступ: Усі
//  4. Натисни "Деплой" → дай дозвіл → скопіюй URL
//  5. Встав URL у db.js → константа SHEETS_URL
//
//  ВАЖЛИВО: після кожної зміни коду потрібен новий деплой
//  (Деплой → Керування деплоями → редагувати → нова версія)
// ══════════════════════════════════════════════════════════════

const SHEET_BANQUETS = 'Банкети';
const SHEET_CLIENTS  = 'Клієнти';

// ── CORS HEADERS ──────────────────────────────────────────────
// Apps Script підтримує CORS тільки через doGet з jsonp або
// через спеціальний ContentService з правильними заголовками.
// Найнадійніший спосіб для GitHub Pages — повертати JSON
// через ContentService (браузер отримає відповідь без блокування).

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  let body   = {};
  let action = '';

  try {
    const params = e.parameter || {};

    // 1. form-urlencoded POST: payload приходить як e.parameter.payload
    //    (Apps Script автоматично парсить urlencoded body в e.parameter)
    if (params.payload) {
      body   = JSON.parse(decodeURIComponent(params.payload));
      action = params.action || body.action || '';
    }
    // 2. GET з payload (fallback)
    else if (params.action) {
      action = params.action;
      // Нічого більше — GET без payload використовується тільки для читання
    }
    // 3. raw JSON POST (curl/Postman)
    else if (e.postData && e.postData.contents) {
      body   = JSON.parse(e.postData.contents);
      action = body.action || '';
    }
  } catch (err) {
    Logger.log('Parse error: ' + err.toString());
  }

  Logger.log('action=' + action + ' clientName=' + (body.clientName||'—'));

  try {
    let result;
    switch (action) {
      case 'getBanquets':   result = getBanquets();       break;
      case 'getBanquet':    result = getBanquet(body.id); break;
      case 'addBanquet':    result = addBanquet(body);    break;
      case 'updateBanquet': result = updateBanquet(body); break;
      case 'getClients':    result = getClients();        break;
      case 'upsertClient':  result = upsertClient(body);  break;
      default:
        return respond({ ok: false, error: 'Unknown action: ' + action });
    }
    return respond({ ok: true, data: result });
  } catch (err) {
    return respond({ ok: false, error: err.toString() });
  }
}

// ContentService з application/json — браузер читає без CORS блокування
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── BANQUETS ──────────────────────────────────────────────────
const B_COLS = [
  'id','clientId','clientName','clientPhone',
  'date','guests','deposit','totalBase','totalFinal',
  'modifier','modLabel','status','comment','dishes','createdAt'
];

function getBanquets() {
  const sh   = getOrCreate(SHEET_BANQUETS, B_COLS);
  const rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => parseBanquet(rowToObj(B_COLS, r)));
}

function getBanquet(id) {
  return getBanquets().find(b => b.id === id) || null;
}

function addBanquet(data) {
  const sh = getOrCreate(SHEET_BANQUETS, B_COLS);
  data.id        = data.id        || 'b_' + Date.now();
  data.createdAt = data.createdAt || new Date().toISOString();
  data.status    = data.status    || 'pending';
  sh.appendRow(objToRow(B_COLS, data));
  styleLastRow(sh);
  return data;
}

function updateBanquet(data) {
  const sh   = getOrCreate(SHEET_BANQUETS, B_COLS);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === data.id) {
      const existing = parseBanquet(rowToObj(B_COLS, vals[i]));
      const merged   = Object.assign({}, existing, data);
      sh.getRange(i + 1, 1, 1, B_COLS.length)
        .setValues([objToRow(B_COLS, merged)]);
      return merged;
    }
  }
  throw new Error('Banquet not found: ' + data.id);
}

function parseBanquet(b) {
  if (typeof b.dishes === 'string') {
    try { b.dishes = JSON.parse(b.dishes); } catch (_) { b.dishes = []; }
  }
  b.guests     = Number(b.guests)     || 0;
  b.deposit    = Number(b.deposit)    || 0;
  b.totalBase  = Number(b.totalBase)  || 0;
  b.totalFinal = Number(b.totalFinal) || 0;
  b.modifier   = Number(b.modifier)   || 0;
  return b;
}

// ── CLIENTS ───────────────────────────────────────────────────
const C_COLS = ['id', 'name', 'phone', 'createdAt'];

function getClients() {
  const sh   = getOrCreate(SHEET_CLIENTS, C_COLS);
  const rows = sh.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => rowToObj(C_COLS, r));
}

function upsertClient(data) {
  const sh         = getOrCreate(SHEET_CLIENTS, C_COLS);
  const rows       = sh.getDataRange().getValues();
  const normPhone  = (data.phone || '').replace(/\D/g, '');

  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][2] || '').replace(/\D/g, '') === normPhone) {
      return rowToObj(C_COLS, rows[i]); // already exists
    }
  }

  data.id        = data.id        || 'c_' + Date.now();
  data.createdAt = data.createdAt || new Date().toISOString();
  sh.appendRow(objToRow(C_COLS, data));
  styleLastRow(sh);
  return data;
}

// ── SHEET HELPERS ─────────────────────────────────────────────
function getOrCreate(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh   = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    // Style header row
    const hRange = sh.getRange(1, 1, 1, headers.length);
    hRange.setFontWeight('bold')
          .setBackground('#263238')
          .setFontColor('#ffffff')
          .setHorizontalAlignment('left');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, headers.length, 160);
  }
  return sh;
}

function styleLastRow(sh) {
  // Alternate row colors for readability
  const last    = sh.getLastRow();
  const isEven  = (last % 2 === 0);
  const bg      = isEven ? '#F5F5F5' : '#FFFFFF';
  sh.getRange(last, 1, 1, sh.getLastColumn()).setBackground(bg);
}

function rowToObj(cols, row) {
  const obj = {};
  cols.forEach((k, i) => { obj[k] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

function objToRow(cols, obj) {
  return cols.map(k => {
    const v = obj[k];
    if (k === 'dishes') return JSON.stringify(Array.isArray(v) ? v : []);
    return v !== undefined && v !== null ? v : '';
  });
}
