/* ============================ food-items.js (FULL) ============================
   - Fetch list from admin/global/foodItems
   - Filters: text, category, hashtag(s), brand
   - Admin dialog: edit & save dietTags, nutrPer100g, measures, etc.
============================================================================= */

import {
  getFirestore, collection, getDocs, doc, setDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

const db = getFirestore();

const els = {
  tbody: document.getElementById('itemsTbody'),
  search: document.getElementById('searchInput'),
  hashtag: document.getElementById('hashtagFilter'),
  brand: document.getElementById('brandFilter'),
  category: document.getElementById('categoryFilter'),
  refresh: document.getElementById('btnRefresh'),
  addBtn: document.getElementById('btnAdd'),

  dialog: document.getElementById('itemDialog'),
  closeDialog: document.getElementById('btnCloseDialog'),
  cancelDialog: document.getElementById('btnCancelItem'),
  saveItem: document.getElementById('btnSaveItem'),

  tabs: document.querySelectorAll('.tab'),
  panes: document.querySelectorAll('.pane'),

  // basic
  name_ar:  document.getElementById('name_ar'),
  name_en:  document.getElementById('name_en'),
  brand_ar: document.getElementById('brand_ar'),
  brand_en: document.getElementById('brand_en'),
  cat_ar:   document.getElementById('cat_ar'),
  cat_en:   document.getElementById('cat_en'),
  desc_ar:  document.getElementById('desc_ar'),
  desc_en:  document.getElementById('desc_en'),
  image:    document.getElementById('image_url'),
  gi:       document.getElementById('gi'),
  isActive: document.getElementById('isActive'),

  // nutr
  cal_kcal:  document.getElementById('cal_kcal'),
  carbs_g:   document.getElementById('carbs_g'),
  fiber_g:   document.getElementById('fiber_g'),
  protein_g: document.getElementById('protein_g'),
  fat_g:     document.getElementById('fat_g'),
  sugar_g:   document.getElementById('sugar_g'),
  satFat_g:  document.getElementById('satFat_g'),
  sodium_mg: document.getElementById('sodium_mg'),

  // measures
  m1_name: document.getElementById('m1_name'),
  m1_name_en: document.getElementById('m1_name_en'),
  m1_grams: document.getElementById('m1_grams'),
  m2_name: document.getElementById('m2_name'),
  m2_name_en: document.getElementById('m2_name_en'),
  m2_grams: document.getElementById('m2_grams'),
  m3_name: document.getElementById('m3_name'),
  m3_name_en: document.getElementById('m3_name_en'),
  m3_grams: document.getElementById('m3_grams'),
  m4_name: document.getElementById('m4_name'),
  m4_name_en: document.getElementById('m4_name_en'),
  m4_grams: document.getElementById('m4_grams'),

  // diet
  dietTagsInput: document.getElementById('dietTagsInput')
};

const state = {
  items: [],
  filtered: [],
  selected: null, // doc snapshot data + id
  isAdmin: !document.body.classList.contains('no-admin')
};

/* ===================== Fetch & Render ===================== */
async function fetchItems(){
  els.tbody.innerHTML = `<tr><td colspan="8" class="empty">جارِ التحميل…</td></tr>`;
  const snap = await getDocs(collection(db, 'admin/global/foodItems'));
  const rows = [];
  snap.forEach(d => {
    const data = d.data() || {};
    rows.push(Object.assign({ id: d.id }, normalizeItem(data)));
  });
  state.items = rows;
  fillCategories(rows);
  applyFilters();
}

function normalizeItem(d){
  // ensure props exist
  d.nutrPer100g = d.nutrPer100g || {};
  d.measures = Array.isArray(d.measures) ? d.measures : [];
  d.dietTags = Array.isArray(d.dietTags) ? d.dietTags : [];
  return d;
}

function fillCategories(rows){
  const set = new Set(['__ALL__']);
  rows.forEach(r => { if (r.category) set.add(r.category); });
  els.category.innerHTML = '';
  for (const val of set){
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = (val === '__ALL__') ? 'كل الفئات' : val;
    els.category.appendChild(opt);
  }
  els.category.value = '__ALL__';
}

function applyFilters(){
  const q = (els.search.value||'').trim().toLowerCase();
  const c = els.category.value || '__ALL__';
  const brandQ = (els.brand.value||'').trim().toLowerCase();

  // hashtags: parse tokens, remove '#'
  const tags = (els.hashtag.value || '')
    .split(/[\s,;]+/)
    .map(s => s.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean);

  let list = state.items.slice();

  if (q){
    list = list.filter(r => {
      const ar = (r.name || r.name_ar || '').toLowerCase();
      const en = (r.name_en || '').toLowerCase();
      const br = (r.brand || r.brand_ar || '').toLowerCase();
      const brEn = (r.brand_en || '').toLowerCase();
      return ar.includes(q) || en.includes(q) || br.includes(q) || brEn.includes(q);
    });
  }

  if (brandQ){
    list = list.filter(r => {
      const br = (r.brand || r.brand_ar || '').toLowerCase();
      const brEn = (r.brand_en || '').toLowerCase();
      return br.includes(brandQ) || brEn.includes(brandQ);
    });
  }

  if (c && c !== '__ALL__'){
    list = list.filter(r => r.category === c);
  }

  if (tags.length){
    list = list.filter(r => {
      const itemTags = (r.dietTags || []).map(x => String(x).toLowerCase());
      return tags.every(t => itemTags.includes(t));
    });
  }

  state.filtered = list;
  renderTable(list);
}

function renderTable(list){
  if (!list.length){
    els.tbody.innerHTML = `<tr><td colspan="8" class="empty">لا توجد نتائج مطابقة</td></tr>`;
    return;
  }
  els.tbody.innerHTML = '';
  for (const it of list){
    const tr = document.createElement('tr');

    const tdImg = document.createElement('td');
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = it.imageUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22></svg>';
    tdImg.appendChild(img);

    const tdName = document.createElement('td');
    tdName.innerHTML = `
      <div class="meta">
        <strong>${escapeHtml(it.name || it.name_ar || 'بدون اسم')}</strong>
        <span class="muted">${escapeHtml(it.name_en || '')}</span>
      </div>`;

    const tdBrand = document.createElement('td');
    tdBrand.innerHTML = `<div class="meta">
        <span>${escapeHtml(it.brand || it.brand_ar || '-')}</span>
        <span class="muted">${escapeHtml(it.brand_en || '')}</span>
      </div>`;

    const tdCat = document.createElement('td');
    tdCat.textContent = it.category || it.category_ar || '-';

    const tdMeasure = document.createElement('td');
    tdMeasure.textContent = previewMeasure(it.measures);

    const tdTags = document.createElement('td');
    tdTags.className = 'hashtags-cell';
    tdTags.innerHTML = renderTags(it.dietTags);

    const tdId = document.createElement('td');
    tdId.className = 'mono';
    tdId.textContent = it.id;

    const tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';
    if (state.isAdmin){
      const btn = document.createElement('button');
      btn.className = 'btn small secondary';
      btn.textContent = 'تحرير';
      btn.addEventListener('click', ()=> openDialog(it));
      tdActions.appendChild(btn);
    } else {
      tdActions.textContent = '—';
    }

    tr.appendChild(tdImg);
    tr.appendChild(tdName);
    tr.appendChild(tdBrand);
    tr.appendChild(tdCat);
    tr.appendChild(tdMeasure);
    tr.appendChild(tdTags);
    tr.appendChild(tdId);
    tr.appendChild(tdActions);

    els.tbody.appendChild(tr);
  }
}

function previewMeasure(measures){
  const m = Array.isArray(measures) ? measures[0] : null;
  if (!m) return '—';
  const n = [m.name, m.name_en].filter(Boolean).join(' / ');
  const g = (m.grams!=null && m.grams!=='') ? `${m.grams} g` : '';
  return `${n} ${g}`.trim();
}

function renderTags(tags){
  const arr = Array.isArray(tags) ? tags : [];
  if (!arr.length) return '<span class="muted">—</span>';
  return `<div class="tags">` + arr.map(t => `<span class="chip">#${escapeHtml(t)}</span>`).join('') + `</div>`;
}

function escapeHtml(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

/* ===================== Dialog (Admin) ===================== */
function openDialog(item){
  state.selected = item || null;
  fillItemDialog(item);
  els.dialog?.showModal();
}

function closeDialog(){
  state.selected = null;
  els.dialog?.close();
}

// تبويب بسيط
els.tabs.forEach(tab=>{
  tab.addEventListener('click', ()=>{
    els.tabs.forEach(t=>t.classList.remove('active'));
    els.panes.forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.pane)?.classList.add('active');
  });
});

function fillItemDialog(existing){
  const d = existing || {};
  setVal(els.name_ar, d.name || d.name_ar || '');
  setVal(els.name_en, d.name_en || '');
  setVal(els.brand_ar, d.brand || d.brand_ar || '');
  setVal(els.brand_en, d.brand_en || '');
  setVal(els.cat_ar, d.category || d.category_ar || '');
  setVal(els.cat_en, d.category_en || '');
  setVal(els.desc_ar, d.description || d.description_ar || '');
  setVal(els.desc_en, d.description_en || '');
  setVal(els.image, d.imageUrl || '');
  setVal(els.gi, d.gi ?? '');

  if (els.isActive) els.isActive.checked = !!d.isActive;

  const n = d.nutrPer100g || {};
  setVal(els.cal_kcal,  n.cal_kcal ?? '');
  setVal(els.carbs_g,   n.carbs_g ?? '');
  setVal(els.fiber_g,   n.fiber_g ?? '');
  setVal(els.protein_g, n.protein_g ?? '');
  setVal(els.fat_g,     n.fat_g ?? '');
  setVal(els.sugar_g,   n.sugar_g ?? '');
  setVal(els.satFat_g,  n.satFat_g ?? '');
  setVal(els.sodium_mg, n.sodium_mg ?? '');

  // measures
  const m = Array.isArray(d.measures) ? d.measures : [];
  fillMeasureRow(els.m1_name, els.m1_name_en, els.m1_grams, m[0]);
  fillMeasureRow(els.m2_name, els.m2_name_en, els.m2_grams, m[1]);
  fillMeasureRow(els.m3_name, els.m3_name_en, els.m3_grams, m[2]);
  fillMeasureRow(els.m4_name, els.m4_name_en, els.m4_grams, m[3]);

  // dietTags
  if (els.dietTagsInput){
    els.dietTagsInput.value = (d.dietTags || []).join(' ');
  }
}

function fillMeasureRow(n, ne, g, row){
  if (!n || !ne || !g) return;
  n.value  = row?.name ?? '';
  ne.value = row?.name_en ?? '';
  g.value  = row?.grams ?? '';
}

function setVal(el, v){ if (el) el.value = v; }
function numVal(el){ const v=el?.value?.toString().trim(); if(!v) return null; const n=Number(v); return Number.isFinite(n)?n:null; }

async function saveItem(){
  if (!state.isAdmin) return;
  const ex = state.selected || {};
  const id = ex.id; // تحرير فقط في هذا المثال

  const payload = {
    name: val(els.name_ar),
    name_en: val(els.name_en),
    brand: val(els.brand_ar),
    brand_en: val(els.brand_en),
    category: val(els.cat_ar),
    category_en: val(els.cat_en),
    description: val(els.desc_ar),
    description_en: val(els.desc_en),
    imageUrl: val(els.image),
    gi: numVal(els.gi),
    isActive: !!els.isActive?.checked,

    nutrPer100g: {
      cal_kcal:  numVal(els.cal_kcal),
      carbs_g:   numVal(els.carbs_g),
      fiber_g:   numVal(els.fiber_g),
      protein_g: numVal(els.protein_g),
      fat_g:     numVal(els.fat_g),
      sugar_g:   numVal(els.sugar_g),
      satFat_g:  numVal(els.satFat_g),
      sodium_mg: numVal(els.sodium_mg)
    },

    measures: collectMeasuresFromForm(),

    // dietTags
    dietTags: readDietTagsFromUI(els.dietTagsInput)
  };

  // نظّف nulls الفارغة داخل nutr/measures
  if (!payload.nutrPer100g.cal_kcal)  delete payload.nutrPer100g.cal_kcal;
  if (!payload.nutrPer100g.carbs_g)   delete payload.nutrPer100g.carbs_g;
  if (!payload.nutrPer100g.fiber_g)   delete payload.nutrPer100g.fiber_g;
  if (!payload.nutrPer100g.protein_g) delete payload.nutrPer100g.protein_g;
  if (!payload.nutrPer100g.fat_g)     delete payload.nutrPer100g.fat_g;
  if (!payload.nutrPer100g.sugar_g)   delete payload.nutrPer100g.sugar_g;
  if (!payload.nutrPer100g.satFat_g)  delete payload.nutrPer100g.satFat_g;
  if (!payload.nutrPer100g.sodium_mg) delete payload.nutrPer100g.sodium_mg;

  try{
    await updateDoc(doc(db, 'admin/global/foodItems', id), payload);
    closeDialog();
    await fetchItems();
  }catch(e){
    console.error('saveItem error', e);
    alert('حدث خطأ أثناء الحفظ');
  }
}

function val(el){ return (el?.value ?? '').toString().trim(); }

function collectMeasuresFromForm(){
  const rows = [];
  pushMeasure(rows, els.m1_name, els.m1_name_en, els.m1_grams);
  pushMeasure(rows, els.m2_name, els.m2_name_en, els.m2_grams);
  pushMeasure(rows, els.m3_name, els.m3_name_en, els.m3_grams);
  pushMeasure(rows, els.m4_name, els.m4_name_en, els.m4_grams);
  return rows;
}
function pushMeasure(out, n, ne, g){
  const name = val(n), name_en = val(ne);
  const grams = numVal(g);
  if (name || name_en || grams!=null) out.push({ name, name_en, grams });
}

function readDietTagsFromUI(inputEl){
  const tags = new Set();
  if (inputEl && inputEl.value){
    inputEl.value.split(/[;,\s]+/).forEach(t => { t=t.trim(); if(t) tags.add(t.replace(/^#/, '')); });
  }
  return Array.from(tags);
}

/* ===================== Events ===================== */
['input','change'].forEach(ev=>{
  els.search?.addEventListener(ev, applyFilters);
  els.hashtag?.addEventListener(ev, applyFilters);
  els.brand?.addEventListener(ev, applyFilters);
  els.category?.addEventListener(ev, applyFilters);
});
els.refresh?.addEventListener('click', fetchItems);
els.closeDialog?.addEventListener('click', closeDialog);
els.cancelDialog?.addEventListener('click', closeDialog);
els.saveItem?.addEventListener('click', saveItem);

// تفعيل/تعطيل زر إضافة صنف (لو عندك إضافة جديدة)
if (state.isAdmin){
  document.body.classList.remove('no-admin');
  if (els.addBtn) els.addBtn.style.display = 'inline-flex';
} else {
  if (els.addBtn) els.addBtn.style.display = 'none';
}

/* ===================== Boot ===================== */
fetchItems().catch(err=>{
  console.error('fetchItems error', err);
  els.tbody.innerHTML = `<tr><td colspan="8" class="empty">تعذر التحميل</td></tr>`;
});
