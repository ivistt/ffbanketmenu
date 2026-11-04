// These sort options affect only this admin view, never persisted sort_order.
function adminDishTimestamp(dish) {
  const date = Date.parse(dish.created_at || '');
  if (Number.isFinite(date)) return date;
  const legacy = /^dish_(\d{13})_/.exec(dish.id || '');
  return legacy ? Number(legacy[1]) : null;
}

function adminDishHasPhoto(dish) {
  const url = String(dish.image_url || '').trim();
  return !!url && url !== IMAGE_BASE;
}

function sortAdminDishes(list, chronology, photos) {
  return [...list].sort((a, b) => {
    if (photos !== 'default') {
      const difference = Number(adminDishHasPhoto(a)) - Number(adminDishHasPhoto(b));
      if (difference) return photos === 'missing' ? difference : -difference;
    }
    if (chronology === 'default') return 0;
    const first = adminDishTimestamp(a), second = adminDishTimestamp(b);
    if (first === null) return second === null ? 0 : 1;
    if (second === null) return -1;
    return chronology === 'newest' ? second - first : first - second;
  });
}

let batchPhotos = [];
let batchPhotoBusy = false;
let batchDishLabels = new Map();

function ensureBatchPhotoModal() {
  if (document.getElementById('batchPhotoModalBg')) return;
  const style = document.createElement('style');
  style.textContent = `
    .batch-photo-modal { max-width:900px; }
    .batch-photo-row { display:grid; grid-template-columns:100px minmax(0,1fr) auto; gap:14px; align-items:center; padding:14px 0; border-bottom:1px solid var(--border); }
    .batch-photo-row img { width:100px; height:90px; object-fit:contain; background:var(--surface2); border-radius:8px; }
    .batch-photo-name { overflow-wrap:anywhere; font-weight:700; margin-bottom:8px; }
    .batch-photo-status { font-size:12px; color:var(--text-muted); margin-top:6px; overflow-wrap:anywhere; }
    .batch-photo-help { font-size:13px; line-height:1.6; color:var(--text-dim); }
    @media(max-width:600px) { .batch-photo-row { grid-template-columns:64px minmax(0,1fr); gap:10px; } .batch-photo-row img { width:64px; height:64px; } .batch-photo-remove { grid-column:2; justify-self:start; } }
  `;
  document.head.append(style);
  const modal = document.createElement('div');
  modal.id = 'batchPhotoModalBg';
  modal.className = 'modal-bg';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'batchPhotoTitle');
  modal.addEventListener('click', e => { if (e.target === modal) closeBatchPhotos(); });
  modal.innerHTML = `
    <div class="modal batch-photo-modal">
      <div class="modal-head"><div class="modal-title" id="batchPhotoTitle">Фото пакетом</div>
        <button class="modal-close" aria-label="Закрити" onclick="closeBatchPhotos()">×</button></div>
      <div class="modal-body">
        <p class="batch-photo-help">Виберіть фотографії та призначте кожній страву з повного списку.
        Зберігаються лише посилання <code>/ffmenu/images/ім'я-файлу</code>: самі файли потім завантажте в папку <code>images</code> репозиторію <code>ffmenu</code> на GitHub з тими самими назвами.
        До публікації файлів фото на сайті не з'являться.</p>
        <p class="batch-photo-help">Сортування за новизною використовує дату створення, якщо вона відома. Страви без відомої дати показуються в кінці.
        «Без фото» означає порожнє посилання, а не перевірку доступності файлу.</p>
        <input class="file-input field-input" id="batchPhotoFiles" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/gif" aria-label="Вибрати фотографії">
        <datalist id="batchDishOptions"></datalist>
        <div id="batchPhotoRows"></div>
        <div id="batchPhotoSummary" class="batch-photo-help" role="status" aria-live="polite"></div>
        <div class="modal-footer"><button class="btn-ghost" onclick="closeBatchPhotos()">Закрити</button>
          <button class="btn-primary" id="batchPhotoSave" onclick="saveBatchPhotos()">Зберегти відповідності</button></div>
      </div>
    </div>`;
  document.body.append(modal);
  document.getElementById('batchPhotoFiles').addEventListener('change', addBatchPhotoFiles);
}

function openBatchPhotos() {
  ensureBatchPhotoModal();
  batchDishLabels = new Map(dishes.map(d => [
    `${d.name} · ${_catMap.get(d.category_id)?.name || d.category_id} · ${d.id}`, d.id
  ]).sort((a, b) => a[0].localeCompare(b[0], 'uk')));
  document.getElementById('batchDishOptions').innerHTML = [...batchDishLabels.keys()]
    .map(label => `<option value="${escHtml(label)}"></option>`).join('');
  openModal('batchPhotoModalBg');
  renderBatchPhotos();
}

function batchPhotoNameKey(value) {
  return value.toLocaleLowerCase('uk').replace(/\.[a-z0-9]+$/i, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function addBatchPhotoFiles(event) {
  if (batchPhotoBusy) return;
  let skipped = 0;
  for (const file of event.target.files) {
    if (!/\.(jpe?g|png|webp|avif|gif)$/i.test(file.name) || batchPhotos.some(row => row.file.name === file.name)) {
      skipped++; continue;
    }
    const candidates = dishes.filter(d => batchPhotoNameKey(d.name) === batchPhotoNameKey(file.name));
    const dishId = candidates.length === 1 ? candidates[0].id : '';
    const label = [...batchDishLabels].find(([, id]) => id === dishId)?.[0] || '';
    batchPhotos.push({ file, preview: URL.createObjectURL(file), label, saved: false, message: '' });
  }
  event.target.value = '';
  renderBatchPhotos();
  if (skipped) showToast(`Пропущено повторні назви або непідтримувані файли: ${skipped}`);
}

function renderBatchPhotos() {
  document.getElementById('batchPhotoRows').innerHTML = batchPhotos.map((row, index) => `
    <div class="batch-photo-row">
      <img src="${escHtml(row.preview)}" alt="${escHtml(row.file.name)}">
      <div><div class="batch-photo-name">${escHtml(row.file.name)}</div>
        <input class="field-input" list="batchDishOptions" aria-label="Страва для ${escHtml(row.file.name)}"
          placeholder="Почніть вводити назву страви…" value="${escHtml(row.label)}"
          ${batchPhotoBusy || row.saved ? 'disabled' : ''} oninput="setBatchPhotoDish(${index}, this.value)">
        <div class="batch-photo-status" id="batchPhotoStatus-${index}">${escHtml(row.message || 'Виберіть страву зі списку')}</div></div>
      <button class="btn-ghost batch-photo-remove" ${batchPhotoBusy ? 'disabled' : ''} onclick="removeBatchPhoto(${index})">Прибрати</button>
    </div>`).join('');
  document.getElementById('batchPhotoFiles').disabled = batchPhotoBusy;
  document.getElementById('batchPhotoSave').disabled = batchPhotoBusy || !batchPhotos.some(row => !row.saved);
  document.getElementById('batchPhotoSave').textContent = batchPhotoBusy ? 'Збереження…' : 'Зберегти відповідності';
  document.getElementById('batchPhotoSummary').textContent = `${batchPhotos.length} фото · Збережено: ${batchPhotos.filter(row => row.saved).length}`;
}

function setBatchPhotoDish(index, label) {
  batchPhotos[index].label = label;
  batchPhotos[index].message = '';
  const id = batchDishLabels.get(label), dish = _dishMap.get(id);
  document.getElementById(`batchPhotoStatus-${index}`).textContent = dish
    ? (adminDishHasPhoto(dish) ? 'Наявне фото буде замінено' : 'Готово до збереження')
    : 'Виберіть точну страву зі списку';
}

function removeBatchPhoto(index) {
  if (batchPhotoBusy) return;
  URL.revokeObjectURL(batchPhotos[index].preview);
  batchPhotos.splice(index, 1);
  renderBatchPhotos();
}

async function saveBatchPhotos() {
  if (batchPhotoBusy) return;
  const pending = batchPhotos.filter(row => !row.saved);
  if (!pending.length) return;
  const ids = batchPhotos.map(row => batchDishLabels.get(row.label));
  if (ids.some(id => !id)) return showToast('Виберіть страву зі списку для кожного фото');
  if (new Set(ids).size !== ids.length) return showToast('Для однієї страви можна вибрати лише одне фото');
  const overwrites = pending.filter(row => adminDishHasPhoto(_dishMap.get(batchDishLabels.get(row.label)) || {}));
  if (overwrites.length && !confirm(`Замінити наявні фото у ${overwrites.length} страв?`)) return;
  batchPhotoBusy = true;
  renderBatchPhotos();
  try {
    for (const row of pending) {
      try {
        const id = batchDishLabels.get(row.label);
        const imageUrl = IMAGE_BASE + encodeURIComponent(row.file.name);
        const result = await api_update('menu_dishes', id, { image_url: imageUrl });
        if (!result?.id) throw new Error('Страва не знайдена або недоступна');
        const dish = _dishMap.get(id);
        if (dish) dish.image_url = imageUrl;
        row.saved = true;
        row.message = 'Посилання збережено. Завантажте цей файл на GitHub.';
      } catch (err) {
        row.message = `Не збережено: ${err.message}. Можна повторити.`;
      }
      renderBatchPhotos();
    }
    if (typeof db_clearMenuCache === 'function') db_clearMenuCache();
    applyFilter();
  } finally {
    batchPhotoBusy = false;
    renderBatchPhotos();
  }
}

function closeBatchPhotos() {
  const modal = document.getElementById('batchPhotoModalBg');
  if (!modal || !modal.classList.contains('open')) return;
  if (batchPhotoBusy) return showToast('Дочекайтеся завершення збереження');
  if (batchPhotos.some(row => !row.saved) && !confirm('Закрити без збереження решти відповідностей?')) return;
  batchPhotos.forEach(row => URL.revokeObjectURL(row.preview));
  batchPhotos = [];
  modal.classList.remove('open');
}

window.addEventListener('beforeunload', event => {
  if (batchPhotoBusy || batchPhotos.some(row => !row.saved)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
