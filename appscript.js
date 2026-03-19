// ══════════════════════════════════════════════════════════════
//  appscript.js  —  Ресторан ОГОнь · Банкет-адмін
//  Вставте цей код у Google Apps Script:
//  Google Таблиця → Розширення → Apps Script → вставити → Зберегти
//  Деплой → New deployment → Web App
//    Execute as: Me
//    Who has access: Anyone
//  Скопіюйте URL і вставте у db.js → константа SHEETS_URL
// ══════════════════════════════════════════════════════════════

const SHEET_BANQUETS = 'Банкети';
const SHEET_CLIENTS  = 'Клієнти';

// ── ENTRY POINTS ──
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  // Allow CORS for browser fetch
  const output = handleLogic(e);
  return output;
}

function handleLogic(e) {
  let body = {};
  try {
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
  } catch(err) {}

  const action = (e.parameter && e.parameter.action) || body.action;

  try {
    let result;
    switch (action) {
      case 'getBanquets':   result = getBanquets();          break;
      case 'getBanquet':    result = getBanquet(e.parameter.id || body.id); break;
      case 'addBanquet':    result = addBanquet(body);       break;
      case 'updateBanquet': result = updateBanquet(body);    break;
      case 'getClients':    result = getClients();           break;
      case 'upsertClient':  result = upsertClient(body);     break;
      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
    return jsonResponse({ ok: true, data: result });
  } catch(err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

// ── BANQUETS ──
const BANQUET_COLS = ['id','clientId','clientName','clientPhone','date','guests','deposit',
                      'totalBase','totalFinal','modifier','modLabel','status','comment','dishes','createdAt'];

function getBanquets() {
  const sheet = getOrCreate(SHEET_BANQUETS, BANQUET_COLS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(rowToObj(BANQUET_COLS)).map(parseBanquet);
}

function getBanquet(id) {
  return getBanquets().find(b => b.id === id) || null;
}

function addBanquet(data) {
  const sheet = getOrCreate(SHEET_BANQUETS, BANQUET_COLS);
  if (!data.id)        data.id        = 'b_' + Date.now();
  if (!data.createdAt) data.createdAt = new Date().toISOString();
  if (!data.status)    data.status    = 'pending';
  sheet.appendRow(BANQUET_COLS.map(k => k === 'dishes' ? JSON.stringify(data[k]||[]) : (data[k]||'')));
  return data;
}

function updateBanquet(data) {
  const sheet = getOrCreate(SHEET_BANQUETS, BANQUET_COLS);
  const vals  = sheet.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === data.id) {
      const existing = rowToObj(BANQUET_COLS)(vals[i]);
      const merged   = Object.assign({}, parseBanquet(existing), data);
      sheet.getRange(i + 1, 1, 1, BANQUET_COLS.length)
        .setValues([BANQUET_COLS.map(k => k === 'dishes' ? JSON.stringify(merged[k]||[]) : (merged[k]||''))]);
      return merged;
    }
  }
  throw new Error('Banquet not found: ' + data.id);
}

function parseBanquet(b) {
  if (typeof b.dishes === 'string') {
    try { b.dishes = JSON.parse(b.dishes); } catch { b.dishes = []; }
  }
  b.guests     = Number(b.guests)     || 0;
  b.deposit    = Number(b.deposit)    || 0;
  b.totalBase  = Number(b.totalBase)  || 0;
  b.totalFinal = Number(b.totalFinal) || 0;
  b.modifier   = Number(b.modifier)   || 0;
  return b;
}

// ── CLIENTS ──
const CLIENT_COLS = ['id','name','phone','createdAt'];

function getClients() {
  const sheet = getOrCreate(SHEET_CLIENTS, CLIENT_COLS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1).map(rowToObj(CLIENT_COLS));
}

function upsertClient(data) {
  const sheet  = getOrCreate(SHEET_CLIENTS, CLIENT_COLS);
  const rows   = sheet.getDataRange().getValues();
  const normPhone = (data.phone || '').replace(/\D/g, '');

  // Check if exists
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][2] || '').replace(/\D/g, '') === normPhone) {
      return rowToObj(CLIENT_COLS)(rows[i]); // return existing
    }
  }

  // Insert new
  if (!data.id)        data.id        = 'c_' + Date.now();
  if (!data.createdAt) data.createdAt = new Date().toISOString();
  sheet.appendRow(CLIENT_COLS.map(k => data[k] || ''));
  return data;
}

// ── HELPERS ──
function getOrCreate(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    // Style header row
    const hRange = sh.getRange(1, 1, 1, headers.length);
    hRange.setFontWeight('bold');
    hRange.setBackground('#f3f3f3');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowToObj(cols) {
  return function(row) {
    const obj = {};
    cols.forEach((k, i) => { obj[k] = row[i]; });
    return obj;
  };
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
