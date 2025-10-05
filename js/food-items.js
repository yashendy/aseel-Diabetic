// ====== Admin Food Items page logic ======
// يعتمد على: window.db (Firestore) + js/dictionaries.js
// HTML: عناصر بالـ id (q, category, onlyActive, grid, editor ...) موجودة في food-items.html

import {
  collection, doc, addDoc, updateDoc,
  query, orderBy, onSnapshot, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

const collPath = ['admin', 'global', 'foodItems']; // collection path
const el = (id) => document.getElementById(id);
const grid = el('grid');
const dlg  = el('editor');

/* ================== UI Helpers ================== */
function fillCategorySelect() {
  const src = (window.CATEGORIES || []);
  // فلتر الصفحة
  const filterSel = el('category');
  if (filterSel) {
    filterSel.innerHTML = '<option value="">الفئة (الكل)</option>';
    src.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat; opt.textContent = cat;
      filterSel.appendChild(opt);
    });
  }
  // قائمة الفئة داخل نموذج التحرير
  const formSel = el('category_in');
  if (formSel) {
    formSel.innerHTML = '';
    src.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat; opt.textContent = cat;
      formSel.appendChild(opt);
    });
  }
}

function placeholderImg() { return 'https://via.placeholder.com/72'; }

/* ================== Query & Live Render ================== */
let unsub = null;

function makeQuery() {
  // هنجيب بالترتيب الأحدث حسب createdAt
  return query(collection(window.db, ...collPath), orderBy('createdAt', 'desc'));
}

function render(items) {
  grid.innerHTML = '';
  const kw = (el('q')?.value || '').trim().toLowerCase();
  const catFilter = el('category')?.value || '';
  const onlyActive = el('onlyActive')?.checked;

  const results = items.filter(it => {
    if (onlyActive && it.isActive === false) return false;
    if (catFilter && it.category !== catFilter) return false;
    if (!kw) return true;
    const hay = [
      it.name_ar, it.name_en, it.brand_ar, it.brand_en,
      it.category, ...(it.tags || []), ...(it.dietTags || [])
    ].join(' ').toLowerCase();
    return hay.includes(kw.replace('#', ''));
  });

  if (!results.length) {
    grid.innerHTML = '<div class="card">لا توجد أصناف مطابقة.</div>';
    return;
  }

  results.forEach(it => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="item">
        <img src="${it.imageUrl || placeholderImg()}" onerror="this.src='${placeholderImg()}'"/>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
            <div>
              <div style="font-weight:700">${it.name_ar || '-'}</div>
              <div class="badge">${it.category || '-'}</div>
            </div>
            <div>${it.isActive===false ? '<span class="badge danger">مخفي</span>' : ''}</div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            ${(it.tags||[]).slice(0,4).map(t=>`<span class="pill">#${t}</span>`).join('')}
          </div>
          <div style="margin-top:10px;display:flex;gap:6px">
            <button class="btn btn--ghost" data-edit="${it.id}">تعديل</button>
            <button class="btn" data-del="${it.id}">حذف</button>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function startLive() {
  const qx = makeQuery();
  if (unsub) unsub();
  unsub = onSnapshot(qx, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render(items);
  });
}

/* ================== Editor ================== */
function openEditor(data) {
  el('docId').value = data?.id || '';
  el('name_ar').value = data?.name_ar || '';
  el('brand_ar').value = data?.brand_ar || '';
  el('desc_ar').value = data?.desc_ar || '';
  el('category_in').value = data?.category || (window.CATEGORIES?.[0] || '');
  el('imageUrl').value = data?.imageUrl || '';
  el('gi').value = data?.gi ?? '';

  el('cal_kcal').value = data?.nutrPer100g?.cal_kcal ?? '';
  el('carbs_g').value  = data?.nutrPer100g?.carbs_g  ?? '';
  el('fiber_g').value  = data?.nutrPer100g?.fiber_g  ?? '';
  el('protein_g').value= data?.nutrPer100g?.protein_g?? '';
  el('fat_g').value    = data?.nutrPer100g?.fat_g    ?? '';
  el('sodium_mg').value= data?.nutrPer100g?.sodium_mg?? '';

  el('tags').value     = (data?.tags || []).join(', ');
  el('dietTags').value = (data?.dietTags || []).join(', ');
  el('allergens').value= (data?.allergens || []).join(', ');
  el('isActive').checked = data?.isActive !== false;

  renderMeasures(data?.measures || []);
  dlg.showModal();
}

function renderMeasures(measures) {
  const box = document.getElementById('measuresList');
  box.innerHTML = '';
  (measures||[]).forEach((m, idx) => {
    const chip = document.createElement('span');
    chip.className = 'pill';
    chip.innerHTML = `${m.name || m.name_ar || ''} <small>(${m.grams || 0}g)</small> <button data-rm-measure="${idx}" class="close" title="حذف">×</button>`;
    box.appendChild(chip);
  });
  box.dataset.payload = JSON.stringify(measures || []);
}

function pushMeasure() {
  const name_ar = el('m_name_ar').value.trim();
  const name_en = el('m_name_en').value.trim();
  const grams = parseFloat(el('m_grams').value);
  if (!name_ar || !grams) return alert('أدخلي اسم المقدار والجرام');
  const list = JSON.parse(document.getElementById('measuresList').dataset.payload || '[]');
  list.push({ name: name_ar, name_en, grams });
  renderMeasures(list);
  el('m_name_ar').value = '';
  el('m_name_en').value = '';
  el('m_grams').value   = '';
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.rmMeasure !== undefined) {
    const idx = +t.dataset.rmMeasure;
    const list = JSON.parse(document.getElementById('measuresList').dataset.payload || '[]');
    list.splice(idx, 1);
    renderMeasures(list);
  }
});

/* ================== Gather + Validate ================== */
function splitCSV(s) {
  return (s||'').split(',').map(x => x.trim()).filter(Boolean);
}
function numOrNull(v) { return v === '' ? null : +v; }

function validateBeforeSave(p) {
  if (!p.name_ar) throw new Error('الاسم العربي مطلوب');
  if (!window.CATEGORIES.includes(p.category)) {
    throw new Error('الفئة غير معتمدة — اختاري من القائمة');
  }
  if (Array.isArray(p.dietTags)) {
    p.dietTags = p.dietTags.filter(t => window.DIET_TAGS.includes(t));
  } else {
    p.dietTags = [];
  }
  return p;
}

function gatherPayload() {
  const payload = {
    name_ar: el('name_ar').value.trim(),
    brand_ar: el('brand_ar').value.trim() || null,
    desc_ar: el('desc_ar').value.trim()  || null,
    category: el('category_in').value,
    imageUrl: el('imageUrl').value.trim() || null,
    gi: el('gi').value ? +el('gi').value : null,
    nutrPer100g: {
      cal_kcal:  numOrNull(el('cal_kcal').value),
      carbs_g:   numOrNull(el('carbs_g').value),
      fiber_g:   numOrNull(el('fiber_g').value),
      protein_g: numOrNull(el('protein_g').value),
      fat_g:     numOrNull(el('fat_g').value),
      sodium_mg: numOrNull(el('sodium_mg').value),
    },
    tags:      splitCSV(el('tags').value),
    dietTags:  splitCSV(el('dietTags').value),
    allergens: splitCSV(el('allergens').value),
    measures:  JSON.parse(document.getElementById('measuresList').dataset.payload || '[]'),
    isActive:  el('isActive').checked !== false
  };
  return validateBeforeSave(payload);
}

/* ================== Firestore Writes ================== */
async function save() {
  try {
    const payload = gatherPayload();
    const id = el('docId').value;

    if (id) {
      await updateDoc(doc(window.db, ...collPath, id), {
        ...payload,
        updatedAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(window.db, ...collPath), {
        ...payload,
        createdAt: serverTimestamp()
      });
    }
    dlg.close();
  } catch (err) {
    console.error(err);
    alert(err.message || 'حدث خطأ أثناء الحفظ');
  }
}

async function softDelete(id) {
  if (!confirm('حذف ناعم؟ سيتم إخفاء الصنف.')) return;
  await updateDoc(doc(window.db, ...collPath, id), {
    isActive: false, deleted: true, updatedAt: serverTimestamp()
  });
}

/* ================== Wire Events ================== */
function wire() {
  // الفلاتر
  ['q','category','onlyActive'].forEach(x=>{
    const n = el(x);
    if (!n) return;
    const handler = ()=> startLive();
    n.addEventListener('input', handler);
    if (n.tagName === 'SELECT') n.addEventListener('change', handler);
  });

  // أزرار المحرر
  document.getElementById('btnNew')?.addEventListener('click', ()=> openEditor(null));
  document.getElementById('addMeasure')?.addEventListener('click', pushMeasure);
  document.getElementById('closeModal')?.addEventListener('click', ()=> dlg.close());
  document.getElementById('save')?.addEventListener('click', save);

  // تفويض أحداث التعديل/الحذف
  grid.addEventListener('click', (e)=>{
    const t = e.target;
    if (t.dataset.edit) {
      const id = t.dataset.edit;
      // نعيد جلب لقطة حديثة ونفتح المحرر
      getDocs(query(collection(window.db, ...collPath))).then(snap=>{
        const it = snap.docs.map(d=>({id:d.id, ...d.data()})).find(x=>x.id===id);
        openEditor(it);
      });
    } else if (t.dataset.del) {
      softDelete(t.dataset.del);
    }
  });
}

/* ================== Boot ================== */
fillCategorySelect();
wire();
startLive();
