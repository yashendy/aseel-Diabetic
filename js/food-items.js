/* ============================ js/food-items.js (FULL, v12) ============================
   - Uses firebase-config.js (v12) for initialized db
   - Fetches admin/global/foodItems
   - Filters: text, category, hashtag(s), brand
   - Admin dialog for editing item incl. dietTags
====================================================================================== */

import { db } from './firebase-config.js';
import {
  collection, getDocs, doc, updateDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const safeArr = (a) => Array.isArray(a) ? a : [];

function val(el){ return (el?.value ?? '').toString().trim(); }
function numVal(el){ const v = val(el); if(v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function setVal(el,v){ if(el) el.value = (v ?? ''); }

/* ---------- Elements ---------- */
const els = {
  tbody: $('itemsTbody'),
  search: $('searchInput'),
  hashtag: $('hashtagFilter'),
  brand: $('brandFilter'),
  category: $('categoryFilter'),
  refresh: $('btnRefresh'),
  addBtn: $('btnAdd'),

  dialog: $('itemDialog'),
  closeDialog: $('btnCloseDialog'),
  cancelDialog: $('btnCancelItem'),
  saveItem: $('btnSaveItem'),

  tabs: document.querySelectorAll('.tab'),
  panes: document.querySelectorAll('.pane'),

  // basic
  name_ar:  $('name_ar'),
  name_en:  $('name_en'),
  brand_ar: $('brand_ar'),
  brand_en: $('brand_en'),
  cat_ar:   $('cat_ar'),
  cat_en:   $('cat_en'),
  desc_ar:  $('desc_ar'),
  desc_en:  $('desc_en'),
  image:    $('image_url'),
  gi:       $('gi'),
  isActive: $('isActive'),

  // nutr
  cal_kcal:  $('cal_kcal'),
  carbs_g:   $('carbs_g'),
  fiber_g:   $('fiber_g'),
  protein_g: $('protein_g'),
  fat_g:     $('fat_g'),
  sugar_g:   $('sugar_g'),
  satFat_g:  $('satFat_g'),
  sodium_mg: $('sodium_mg'),

  // measures
  m1_name: $('m1_name'), m1_name_en: $('m1_name_en'), m1_grams: $('m1_grams'),
  m2_name: $('m2_name'), m2_name_en: $('m2_name_en'), m2_grams: $('m2_grams'),
  m3_name: $('m3_name'), m3_name_en: $('m3_name_en'), m3_grams: $('m3_grams'),
  m4_name: $('m4_name'), m4_name_en: $('m4_name_en'), m4_grams: $('m4_grams'),

  // diet
  dietTagsInput: $('dietTagsInput')
};

const state = {
  items: [],
  filtered: [],
  selected: null, // {id, ...data}
  isAdmin: !document.body.classList.contains('no-admin')
};

/* ===================== Fetch ===================== */
async function fetchItems(){
  els.tbody.innerHTML = `<tr><td colspan="8" class="empty">جارِ التحميل…</td></tr>`;
  const snap = await getDocs(collection(db, 'admin/global/foodItems'));
  const rows = [];
  snap.forEach(d => {
    const data = normalizeItem(d.data() || {});
    rows.push({ id: d.id, ...data });
  });
  state.items = rows;
  fillCategories(rows);
  applyFilters();
}

function normalizeItem(d){
  return {
    name: d.name || d.name_ar || '',
    name_en: d.name_en || '',
    brand: d.brand || d.brand_ar || '',
    brand_en: d.brand_en || '',
    category: d.category || d.category_ar || '',
    category_en: d.category_en || '',
    description: d.description || d.description_ar || '',
    description_en: d.description_en || '',
    imageUrl: d.imageUrl || '',
    gi: (d.gi ?? null),
    isActive: !!d.isActive,
    nutrPer100g: d.nutrPer100g || {},
    measures: safeArr(d.measures),
    dietTags: safeArr(d.dietTags)
  };
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

/* ===================== Filters ===================== */
function applyFilters(){
  const q = val(els.search).toLowerCase();
  const brandQ = val(els.brand).toLowerCase();
  const cat = els.category.value || '__ALL__';
  const tags = val(els.hashtag)
    .split(/[\s,;]+/)
    .map(s => s.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean);

  let list = state.items.slice();

  if (q){
    list = list.filter(r => {
      const ar = (r.name || '').toLowerCase();
      const en = (r.name_en || '').toLowerCase();
      const br = (r.brand || '').toLowerCase();
      const brEn = (r.brand_en || '').toLowerCase();
      return ar.includes(q) || en.includes(q) || br.includes(q) || brEn.includes(q);
    });
  }
  if (brandQ){
    list = list.filter(r => (r.brand || '').toLowerCase().includes(brandQ) ||
                            (r.brand_en || '').toLowerCase().includes(brandQ));
  }
  if (cat !== '__ALL__'){
    list = list.filter(r => r.category === cat);
  }
  if (tags.length){
    list = list.filter(r => {
      const itemTags = safeArr(r.dietTags).map(x => String(x).toLowerCase());
      return tags.every(t => itemTags.includes(t));
    });
  }

  state.filtered = list;
  renderTable(list);
}

/* ===================== Render ===================== */
function renderTable(list){
  if (!list.length){
    els.tbody.innerHTML = `<tr><td colspan="8" class="empty">لا توجد نتائج مطابقة…</td></tr>`;
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
        <strong>${escapeHtml(it.name || 'بدون اسم')}</strong>
        <span class="muted">${escapeHtml(it.name_en || '')}</span>
      </div>`;

    const tdBrand = document.createElement('td');
    tdBrand.innerHTML = `
      <div class="meta">
        <span>${escapeHtml(it.brand || '-')}</span>
        <span class="muted">${escapeHtml(it.brand_en || '')}</span>
      </div>`;

    const tdCat = document.createElement('td');
    tdCat.textContent = it.category || '-';

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

    tr.append(tdImg, tdName, tdBrand, tdCat, tdMeasure, tdTags, tdId, tdActions);
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
  const arr = safeArr(tags);
  if (!arr.length) return '<span class="muted">—</span>';
  return `<div class="tags">` + arr.map(t => `<span class="chip">#${escapeHtml(t)}</span>`).join('') + `</div>`;
}

/* ===================== Dialog (Admin) ===================== */
function openDialog(item){
  state.selected = item || null;
  fillItemDialog(item);
  els.dialog?.showModal();
}
function closeDialog(){ state.selected = null; els.dialog?.close(); }

els.tabs.forEach(tab=>{
  tab.addEventListener('click', ()=>{
    els.tabs.forEach(t=>t.classList.remove('active'));
    els.panes.forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.pane)?.classList.add('active');
  });
});

function fillItemDialog(d){
  d = d || {};
  setVal(els.name_ar,  d.name || '');
  setVal(els.name_en,  d.name_en || '');
  setVal(els.brand_ar, d.brand || '');
  setVal(els.brand_en, d.brand_en || '');
  setVal(els.cat_ar,   d.category || '');
  setVal(els.cat_en,   d.category_en || '');
  setVal(els.desc_ar,  d.description || '');
  setVal(els.desc_en,  d.description_en || '');
  setVal(els.image,    d.imageUrl || '');
  setVal(els.gi,       d.gi ?? '');
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

  // measures (4 rows)
  fillMeasureRow(els.m1_name, els.m1_name_en, els.m1_grams, d.measures?.[0]);
  fillMeasureRow(els.m2_name, els.m2_name_en, els.m2_grams, d.measures?.[1]);
  fillMeasureRow(els.m3_name, els.m3_name_en, els.m3_grams, d.measures?.[2]);
  fillMeasureRow(els.m4_name, els.m4_name_en, els.m4_grams, d.measures?.[3]);

  if (els.dietTagsInput) els.dietTagsInput.value = safeArr(d.dietTags).join(' ');
}
function fillMeasureRow(n, ne, g, row){
  setVal(n,  row?.name ?? '');
  setVal(ne, row?.name_en ?? '');
  setVal(g,  row?.grams ?? '');
}

function collectMeasuresFromForm(){
  const out = [];
  pushMeasure(out, els.m1_name, els.m1_name_en, els.m1_grams);
  pushMeasure(out, els.m2_name, els.m2_name_en, els.m2_grams);
  pushMeasure(out, els.m3_name, els.m3_name_en, els.m3_grams);
  pushMeasure(out, els.m4_name, els.m4_name_en, els.m4_grams);
  return out;
}
function pushMeasure(out, n, ne, g){
  const name = val(n), name_en = val(ne);
  const grams = numVal(g);
  if (name || name_en || grams!=null) out.push({ name, name_en, grams });
}

function readDietTagsFromUI(){
  const tags = new Set();
  const input = els.dietTagsInput;
  if (input && input.value){
    input.value.split(/[;,\s]+/).forEach(t => {
      t = t.replace(/^#/, '').trim();
      if (t) tags.add(t);
    });
  }
  return Array.from(tags);
}

async function saveItem(){
  if (!state.isAdmin || !state.selected) return;
  const id = state.selected.id;

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
    dietTags: readDietTagsFromUI()
  };

  try{
    await updateDoc(doc(db, 'admin/global/foodItems', id), payload);
    closeDialog();
    await fetchItems();
  }catch(e){
    console.error('saveItem error', e);
    alert('حدث خطأ أثناء الحفظ');
  }
}

/* ---------- Events ---------- */
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

// إظهار أدوات الأدمن
if (state.isAdmin){
  document.body.classList.remove('no-admin');
  if (els.addBtn) els.addBtn.style.display = 'inline-flex';
} else {
  if (els.addBtn) els.addBtn.style.display = 'none';
}

/* ---------- Boot ---------- */
fetchItems().catch(err=>{
  console.error('fetchItems error', err);
  if (els.tbody) els.tbody.innerHTML = `<tr><td colspan="8" class="empty">تعذر التحميل</td></tr>`;
});
