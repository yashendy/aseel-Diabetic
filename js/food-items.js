// js/food-items.js (نسخة مُحدّثة تدعم الاستيراد من OpenFoodFacts)
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, query, where, orderBy, doc, getDoc, updateDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ====== عناصر ====== */
const searchEl = document.getElementById('search');
const catEl = document.getElementById('category');
const addBtn = document.getElementById('addBtn');
const itemsGrid = document.getElementById('itemsGrid');
const emptyState = document.getElementById('emptyState');

const modal = document.getElementById('itemModal');
const closeModalBtn = document.getElementById('closeModal');
const itemForm = document.getElementById('itemForm');
const modalTitle = document.getElementById('modalTitle');

const nameEl = document.getElementById('name');
const brandEl = document.getElementById('brand');
const catModalEl = document.getElementById('cat');
const sourceEl = document.getElementById('source');

const imageUrlEl = document.getElementById('imageUrl');
const autoImageEl = document.getElementById('autoImage');
const tagsEl = document.getElementById('tags');

const carbsEl = document.getElementById('carbs');
const calEl = document.getElementById('cal');
const proteinEl = document.getElementById('protein');
const fatEl = document.getElementById('fat');
const fiberEl = document.getElementById('fiber');
const sugarEl = document.getElementById('sugar');

const measuresWrap = document.getElementById('measuresWrap');
const addMeasureBtn = document.getElementById('addMeasure');

const calcModeEl = document.getElementById('calcMode');
const calcQtyEl = document.getElementById('calcQty');
const calcMeasureEl = document.getElementById('calcMeasure');

const pGramsEl = document.getElementById('pGrams');
const pCarbsEl = document.getElementById('pCarbs');
const pCalEl = document.getElementById('pCal');
const pProtEl = document.getElementById('pProt');
const pFatEl = document.getElementById('pFat');

const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

/* OFF عناصر */
const importBarcodeBtn = document.getElementById('importBarcodeBtn');
const importSearchBtn = document.getElementById('importSearchBtn');

const offBarcodeModal = document.getElementById('offBarcodeModal');
const closeBarcodeModal = document.getElementById('closeBarcodeModal');
const barcodeInput = document.getElementById('barcodeInput');
const fetchBarcodeBtn = document.getElementById('fetchBarcodeBtn');
const barcodeResult = document.getElementById('barcodeResult');

const offSearchModal = document.getElementById('offSearchModal');
const closeSearchModal = document.getElementById('closeSearchModal');
const offQuery = document.getElementById('offQuery');
const fetchSearchBtn = document.getElementById('fetchSearchBtn');
const searchResults = document.getElementById('searchResults');

/* ====== حالة ====== */
let currentUser;
let editingId = null;
let currentMeasures = []; // [{name, grams}]
let allItemsCache = [];   // عرض سريع وتصفية محلية

/* ====== أدوات ====== */
function openModal(isEdit=false){
  modal.classList.remove('hidden');
  modalTitle.textContent = isEdit ? 'تعديل صنف' : 'إضافة صنف';
}
function closeModal(){ modal.classList.add('hidden'); }

function openOffModal(m){ m.classList.remove('hidden'); }
function closeOffModal(m){ m.classList.add('hidden'); }

const pad = n => String(n).padStart(2,'0');
function arabicToDot(s){ return (s||'').toString().replace(',', '.').trim(); }
function numOrNull(x){ const n = Number(arabicToDot(x)); return isNaN(n) ? null : n; }
function toLowerAr(s){ return (s||'').toString().trim().toLowerCase(); }

function categoryIcon(cat){
  switch(cat){
    case 'نشويات': return '🍞';
    case 'حليب': return '🥛';
    case 'فاكهة': return '🍎';
    case 'خضروات': return '🥕';
    case 'لحوم': return '🍗';
    case 'دهون': return '🥑';
    default: return '🍽️';
  }
}

/* توليد keywords (بادئات) من الاسم والتاجز */
function buildKeywords(name, tagsArr){
  const tokens = new Set();
  const addPrefixes = (word)=>{
    const w = word.trim().toLowerCase();
    for (let i=1;i<=Math.min(w.length,10);i++) tokens.add(w.slice(0,i));
  };
  toLowerAr(name).split(/\s+/).forEach(addPrefixes);
  (tagsArr||[]).forEach(t=> addPrefixes(toLowerAr(t)));
  return Array.from(tokens);
}

/* مزامنة قائمة المقادير في UI */
function renderMeasures(){
  measuresWrap.innerHTML = '';
  currentMeasures.forEach((m, idx)=>{
    const row = document.createElement('div');
    row.className = 'measure-row';
    row.innerHTML = `
      <input type="text" placeholder="اسم التقدير (كوب/معلقة/حبة)" value="${m.name||''}">
      <input type="number" step="any" placeholder="جم" value="${m.grams ?? ''}">
      <button type="button" class="del small">حذف</button>
    `;
    const [nameInput, gramsInput, delBtn] = row.querySelectorAll('input,button');

    nameInput.addEventListener('input', ()=>{
      currentMeasures[idx].name = nameInput.value.trim();
      refreshCalcMeasureOptions(); calcPreview();
    });
    gramsInput.addEventListener('input', ()=>{
      currentMeasures[idx].grams = numOrNull(gramsInput.value);
      calcPreview();
    });
    delBtn.addEventListener('click', ()=>{
      currentMeasures.splice(idx,1);
      renderMeasures(); refreshCalcMeasureOptions(); calcPreview();
    });

    measuresWrap.appendChild(row);
  });
}
addMeasureBtn.addEventListener('click', ()=>{
  currentMeasures.push({ name:'', grams:null });
  renderMeasures(); refreshCalcMeasureOptions();
});

/* حساب المعاينة */
function refreshCalcMeasureOptions(){
  calcMeasureEl.innerHTML = '';
  currentMeasures.forEach(m=>{
    if (m.name && m.grams){
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = `${m.name} (${m.grams} جم)`;
      calcMeasureEl.appendChild(opt);
    }
  });
}
function calcPreview(){
  const mode = calcModeEl.value;
  const qty = Number(arabicToDot(calcQtyEl.value) || 0);
  const per100 = {
    carbs: Number(arabicToDot(carbsEl.value) || 0),
    cal: Number(arabicToDot(calEl.value) || 0),
    prot: Number(arabicToDot(proteinEl.value) || 0),
    fat: Number(arabicToDot(fatEl.value) || 0),
  };

  let grams = 0;
  if (mode === 'grams'){
    grams = qty;
  } else {
    const m = currentMeasures.find(x=> x.name === calcMeasureEl.value);
    if (m && m.grams) grams = qty * m.grams;
  }
  const carbs = (per100.carbs * grams) / 100;
  const cal = (per100.cal * grams) / 100;
  const prot = (per100.prot * grams) / 100;
  const fat = (per100.fat * grams) / 100;

  pGramsEl.textContent = (Math.round(grams*10)/10) || 0;
  pCarbsEl.textContent = (Math.round(carbs*10)/10) || 0;
  pCalEl.textContent   = Math.round(cal) || 0;
  pProtEl.textContent  = (Math.round(prot*10)/10) || 0;
  pFatEl.textContent   = (Math.round(fat*10)/10) || 0;
}
[calcModeEl, calcQtyEl, calcMeasureEl, carbsEl, calEl, proteinEl, fatEl].forEach(el=>{
  el.addEventListener('input', calcPreview);
});

/* ====== تحميل المستخدم ثم الأصناف ====== */
onAuthStateChanged(auth, async (user)=>{
  if (!user) return location.href = 'index.html';
  currentUser = user;
  await loadItems();
});

async function loadItems(){
  const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
  const qy = query(ref, orderBy('nameLower','asc'));
  const snap = await getDocs(qy);

  allItemsCache = [];
  snap.forEach(d=>{
    allItemsCache.push({ id: d.id, ...d.data() });
  });

  applyFilters();
}

/* ====== الفلاتر والبحث ====== */
searchEl.addEventListener('input', debounce(applyFilters, 250));
catEl.addEventListener('change', applyFilters);

async function applyFilters(){
  const q = searchEl.value.trim();
  const cat = catEl.value;

  // #هاشتاج
  if (q.startsWith('#') && q.length > 1){
    const tag = q.slice(1).trim().toLowerCase();
    const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
    const qy = query(ref, where('tags','array-contains', tag));
    const snap = await getDocs(qy);
    const arr = []; snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
    const filtered = cat==='الكل' ? arr : arr.filter(x=> x.category===cat);
    renderItems(filtered); return;
  }

  // اسم (keywords)
  if (q.length >= 2){
    const token = q.trim().toLowerCase();
    const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
    const qy = query(ref, where('keywords','array-contains', token));
    const snap = await getDocs(qy);
    const arr = []; snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
    const filtered = cat==='الكل' ? arr : arr.filter(x=> x.category===cat);
    renderItems(filtered); return;
  }

  const base = (cat==='الكل') ? allItemsCache : allItemsCache.filter(x=> x.category===cat);
  renderItems(base);
}

/* ====== عرض الكروت ====== */
function placeholderThumb(cat){
  const span = document.createElement('span');
  span.textContent = categoryIcon(cat);
  span.style.display='inline-block';
  span.style.lineHeight='64px';
  span.style.textAlign='center';
  span.style.width='64px';
  return span;
}

function renderItems(items){
  itemsGrid.innerHTML = '';
  if (!items.length){
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  items.forEach(item=>{
    const card = document.createElement('div');
    card.className = 'item';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (item.imageUrl && String(item.autoImage)!=='true'){
      const img = document.createElement('img');
      img.src = item.imageUrl; img.alt = item.name || '';
      img.style.width='100%'; img.style.height='100%'; img.style.objectFit='cover'; img.style.borderRadius='8px';
      img.onerror = ()=> { thumb.innerHTML=''; thumb.appendChild(placeholderThumb(item.category)); };
      thumb.appendChild(img);
    } else {
      thumb.appendChild(placeholderThumb(item.category));
    }

    const meta = document.createElement('div'); meta.className = 'meta';
    const title = document.createElement('div');
    title.innerHTML = `<strong>${escapeHTML(item.name)}</strong> ${item.brand? `<small>(${escapeHTML(item.brand)})</small>`:''}`;
    const badges = document.createElement('div'); badges.className='badges';
    badges.innerHTML = `
      <span class="badge">${escapeHTML(item.category||'-')}</span>
      <span class="badge">كارب/100g: ${item?.nutrPer100g?.carbs_g ?? '-'}</span>
      <span class="badge">سعرات/100g: ${item?.nutrPer100g?.cal_kcal ?? '-'}</span>
      <span class="badge">المصدر: ${escapeHTML(item.source || 'manual')}</span>
    `;
    const tags = document.createElement('div'); tags.className='tags';
    (item.tags || []).forEach(t=>{
      const sp = document.createElement('span'); sp.className='tag'; sp.textContent = `#${t}`;
      tags.appendChild(sp);
    });

    const actions = document.createElement('div'); actions.className='actions';
    const editBtn = document.createElement('button'); editBtn.textContent='تعديل';
    const delBtn  = document.createElement('button'); delBtn.textContent='حذف'; delBtn.className='del';
    editBtn.addEventListener('click', ()=> openEdit(item));
    delBtn.addEventListener('click', ()=> deleteItem(item));

    actions.append(editBtn, delBtn);
    meta.append(title, badges, tags, actions);

    card.append(thumb, meta);
    itemsGrid.appendChild(card);
  });
}

function escapeHTML(s){
  return (s||'').toString()
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

/* ====== إضافة/تعديل ====== */
addBtn.addEventListener('click', ()=>{
  editingId = null;
  itemForm.reset();
  currentMeasures = [];
  renderMeasures(); refreshCalcMeasureOptions(); calcPreview();
  autoImageEl.value = 'true'; sourceEl.value = 'manual';
  openModal(false);
});
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);

function fillForm(item){
  nameEl.value = item.name || '';
  brandEl.value = item.brand || '';
  catModalEl.value = item.category || '';
  sourceEl.value = item.source || 'manual';
  imageUrlEl.value = item.imageUrl || '';
  autoImageEl.value = String(item.autoImage)==='false' ? 'false' : 'true';
  tagsEl.value = (item.tags||[]).join(' ');

  carbsEl.value = item?.nutrPer100g?.carbs_g ?? '';
  calEl.value = item?.nutrPer100g?.cal_kcal ?? '';
  proteinEl.value = item?.nutrPer100g?.protein_g ?? '';
  fatEl.value = item?.nutrPer100g?.fat_g ?? '';
  fiberEl.value = item?.nutrPer100g?.fiber_g ?? '';
  sugarEl.value = item?.nutrPer100g?.sugar_g ?? '';

  currentMeasures = Array.isArray(item.measures) ? JSON.parse(JSON.stringify(item.measures)) : [];
  renderMeasures(); refreshCalcMeasureOptions(); calcPreview();
}

function openEdit(item){
  editingId = item.id;
  itemForm.reset();
  fillForm(item);
  openModal(true);
}

itemForm.addEventListener('submit', async (e)=>{
  e.preventDefault();

  if (!nameEl.value.trim()){ alert('أدخل اسم الصنف'); return; }
  if (!catModalEl.value){ alert('اختر التصنيف'); return; }
  const carbs = numOrNull(carbsEl.value);
  const cal   = numOrNull(calEl.value);
  if (carbs===null || cal===null){ alert('أدخل الكارب والسعرات لكل 100 جم'); return; }
  if (carbs<0 || cal<0){ alert('القيم لا يمكن أن تكون سالبة'); return; }

  const measures = currentMeasures
    .filter(m => (m.name||'').trim() && typeof m.grams === 'number' && m.grams>0)
    .map(m => ({ name: m.name.trim(), grams: Number(m.grams) }));

  const tagsArr = (tagsEl.value || '')
    .split(/[,\s]+/).map(t=>t.trim()).filter(Boolean).map(t=>t.toLowerCase());

  const payload = {
    name: nameEl.value.trim(),
    nameLower: toLowerAr(nameEl.value),
    brand: brandEl.value.trim() || null,
    category: catModalEl.value,
    source: (sourceEl.value || 'manual'),
    imageUrl: imageUrlEl.value.trim() || null,
    autoImage: (autoImageEl.value === 'true'),
    tags: tagsArr,
    keywords: buildKeywords(nameEl.value, tagsArr),
    nutrPer100g: {
      carbs_g: carbs,
      cal_kcal: cal,
      protein_g: numOrNull(proteinEl.value),
      fat_g: numOrNull(fatEl.value),
      fiber_g: numOrNull(fiberEl.value),
      sugar_g: numOrNull(sugarEl.value)
    },
    measures,
    updatedAt: serverTimestamp()
  };

  try{
    const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
    if (editingId){
      await updateDoc(doc(ref, editingId), payload);
      alert('✅ تم تحديث الصنف');
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(ref, payload);
      alert('✅ تم إضافة الصنف');
    }
    closeModal(); await loadItems();
  } catch(err){
    console.error(err);
    alert('حدث خطأ أثناء الحفظ');
  }
});

/* ====== حذف ====== */
async function deleteItem(item){
  if (!confirm(`هل تريد حذف "${item.name}"؟`)) return;
  try{
    await deleteDoc(doc(db, `parents/${currentUser.uid}/foodItems/${item.id}`));
    alert('🗑️ تم الحذف'); await loadItems();
  } catch(e){
    console.error(e); alert('تعذر حذف الصنف');
  }
}

/* ====== OpenFoodFacts: استيراد بالباركود ====== */
importBarcodeBtn.addEventListener('click', ()=>{
  barcodeInput.value=''; barcodeResult.innerHTML='';
  openOffModal(offBarcodeModal);
});
closeBarcodeModal.addEventListener('click', ()=> closeOffModal(offBarcodeModal));

fetchBarcodeBtn.addEventListener('click', async ()=>{
  const code = (barcodeInput.value||'').trim();
  if (!/^\d{8,14}$/.test(code)){ alert('رجاء إدخال باركود صالح (8-14 أرقام)'); return; }

  barcodeResult.innerHTML = '⏳ جاري الجلب...';
  try{
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || data.status !== 1){
      barcodeResult.innerHTML = `<div class="off-result">لم يتم العثور على منتج بهذا الباركود.</div>`;
      return;
    }
    const prod = data.product;
    const mapped = mapOFFProduct(prod);

    barcodeResult.innerHTML = offPreviewHTML(mapped);
    const fillBtn = barcodeResult.querySelector('.off-fill');
    fillBtn.addEventListener('click', ()=>{
      fillForm(mappedToForm(mapped));
      closeOffModal(offBarcodeModal);
      openModal(false); // افتح نموذج الإضافة
    });

  }catch(e){
    console.error(e);
    barcodeResult.innerHTML = `<div class="off-result">حدث خطأ أثناء الجلب.</div>`;
  }
});

/* ====== OpenFoodFacts: استيراد بالاسم ====== */
importSearchBtn.addEventListener('click', ()=>{
  offQuery.value=''; searchResults.innerHTML='';
  openOffModal(offSearchModal);
});
closeSearchModal.addEventListener('click', ()=> closeOffModal(offSearchModal));

fetchSearchBtn.addEventListener('click', async ()=>{
  const q = (offQuery.value||'').trim();
  if (q.length < 2){ alert('اكتب على الأقل حرفين للبحث'); return; }
  searchResults.innerHTML = '⏳ جاري البحث...';
  try{
    const fields = [
      'code','product_name','product_name_ar','brands','image_front_url',
      'nutriments','serving_size','categories','categories_tags'
    ].join(',');
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&search_terms=${encodeURIComponent(q)}&json=1&page_size=20&fields=${fields}`;
    const res = await fetch(url);
    const data = await res.json();
    const products = Array.isArray(data.products) ? data.products : [];
    if (!products.length){
      searchResults.innerHTML = '<div class="off-result">لا نتائج مطابقة.</div>';
      return;
    }
    // عرض نتائج
    searchResults.innerHTML = '';
    products.forEach(p=>{
      const mapped = mapOFFProduct(p);
      const card = document.createElement('div');
      card.className = 'off-card';
      card.innerHTML = `
        <div class="off-thumb">${mapped.imageUrl ? `<img src="${mapped.imageUrl}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px">` : '📦'}</div>
        <div class="off-meta">
          <div><strong>${escapeHTML(mapped.name||'-')}</strong> ${mapped.brand?`<small>(${escapeHTML(mapped.brand)})</small>`:''}</div>
          <div class="muted" style="font-size:12px">كارب/100g: ${mapped.nutrPer100g.carbs_g ?? '-'} • سعرات/100g: ${mapped.nutrPer100g.cal_kcal ?? '-'}</div>
          <div class="off-actions"><button class="off-fill small">ملء النموذج</button></div>
        </div>
      `;
      card.querySelector('.off-fill').addEventListener('click', ()=>{
        fillForm(mappedToForm(mapped));
        closeOffModal(offSearchModal);
        openModal(false);
      });
      searchResults.appendChild(card);
    });

  }catch(e){
    console.error(e);
    searchResults.innerHTML = `<div class="off-result">حدث خطأ أثناء البحث.</div>`;
  }
});

/* ====== تحويل/تخمين من OFF ====== */
function mapOFFProduct(prod){
  // الاسم (أفضلية عربي)
  const name = prod.product_name_ar || prod.product_name || '';
  const brand = (prod.brands||'').split(',')[0]?.trim() || null;
  const imageUrl = prod.image_front_url || null;

  const n = prod.nutriments || {};
  // سعرات kcal: قد تكون energy-kcal_100g أو energy_100g (كيلوجول)
  let cal = n['energy-kcal_100g'];
  if (cal == null && n['energy_100g'] != null){
    const kj = Number(n['energy_100g']);
    if (!isNaN(kj)) cal = Math.round(kj / 4.184);
  }
  const carbs = n['carbohydrates_100g'];
  const protein = n['proteins_100g'];
  const fat = n['fat_100g'];
  const fiber = n['fiber_100g'];
  const sugar = n['sugars_100g'];

  // تقدير بيتي من serving_size لو يتضمن جرام
  const measures = [];
  const serving = prod.serving_size || '';
  const gMatch = serving.match(/(\d+(?:[\.,]\d+)?)\s*g/i);
  if (gMatch){
    const grams = Number(String(gMatch[1]).replace(',','.'));
    if (!isNaN(grams) && grams>0) measures.push({ name: 'حصة', grams });
  }

  // تخمين التصنيف
  const category = guessCategory(prod);

  // وسوم افتراضية
  const code = prod.code || '';
  const autoTags = ['off', code ? `barcode:${code}` : null].filter(Boolean);

  return {
    name,
    brand,
    category,
    imageUrl,
    autoImage: imageUrl ? false : true,
    source: 'openfoodfacts',
    tags: autoTags,
    nutrPer100g: {
      carbs_g: safeNum(carbs),
      cal_kcal: safeNum(cal),
      protein_g: safeNum(protein),
      fat_g: safeNum(fat),
      fiber_g: safeNum(fiber),
      sugar_g: safeNum(sugar)
    },
    measures
  };
}

function mappedToForm(mapped){
  // دمج لإرسالها للفورم كما لو مستخدم أدخلها
  return {
    name: mapped.name || '',
    brand: mapped.brand || '',
    category: mapped.category || '',
    source: mapped.source || 'openfoodfacts',
    imageUrl: mapped.imageUrl || '',
    autoImage: mapped.autoImage !== false ? true : false,
    tags: mapped.tags || [],
    nutrPer100g: mapped.nutrPer100g,
    measures: mapped.measures || []
  };
}

function offPreviewHTML(m){
  return `
    <div class="off-card">
      <div class="off-thumb">${m.imageUrl ? `<img src="${m.imageUrl}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px">` : '📦'}</div>
      <div class="off-meta">
        <div><strong>${escapeHTML(m.name||'-')}</strong> ${m.brand?`<small>(${escapeHTML(m.brand)})</small>`:''}</div>
        <div class="muted" style="font-size:12px">
          تصنيف متوقّع: ${escapeHTML(m.category || '-')}&nbsp;•&nbsp;
          كارب/100g: ${m.nutrPer100g.carbs_g ?? '-'} • سعرات/100g: ${m.nutrPer100g.cal_kcal ?? '-'}
        </div>
        <div class="off-actions">
          <button class="off-fill">ملء النموذج</button>
        </div>
      </div>
    </div>
  `;
}

function safeNum(v){
  const n = Number(v); return isNaN(n) ? null : Math.round(n*100)/100;
}

function guessCategory(prod){
  const cats = (prod.categories || prod.categories_tags || '').toString().toLowerCase();
  const name = (prod.product_name || '').toLowerCase();

  const has = (s)=> cats.includes(s) || name.includes(s);

  if (has('bread') || has('rice') || has('pasta') || has('cereal') || has('oat') || has('biscuit') || has('flour') || has('corn'))
    return 'نشويات';
  if (has('milk') || has('lact') || has('yogurt') || has('cheese'))
    return 'حليب';
  if (has('fruit') || has('apple') || has('banana') || has('juice'))
    return 'فاكهة';
  if (has('vegetable') || has('tomato') || has('cucumber') || has('salad'))
    return 'خضروات';
  if (has('meat') || has('chicken') || has('beef') || has('fish') || has('tuna'))
    return 'لحوم';
  if (has('oil') || has('butter') || has('ghee') || has('fat') || has('avocado'))
    return 'دهون';
  return '';
}

/* ====== ملء نموذج الصفحة من الماب ====== */
function fillFormFromMapped(m){
  nameEl.value = m.name || '';
  brandEl.value = m.brand || '';
  catModalEl.value = m.category || '';
  sourceEl.value = m.source || 'openfoodfacts';
  imageUrlEl.value = m.imageUrl || '';
  autoImageEl.value = m.autoImage ? 'true':'false';
  tagsEl.value = (m.tags||[]).join(' ');

  carbsEl.value = m?.nutrPer100g?.carbs_g ?? '';
  calEl.value = m?.nutrPer100g?.cal_kcal ?? '';
  proteinEl.value = m?.nutrPer100g?.protein_g ?? '';
  fatEl.value = m?.nutrPer100g?.fat_g ?? '';
  fiberEl.value = m?.nutrPer100g?.fiber_g ?? '';
  sugarEl.value = m?.nutrPer100g?.sugar_g ?? '';

  currentMeasures = Array.isArray(m.measures) ? JSON.parse(JSON.stringify(m.measures)) : [];
  renderMeasures(); refreshCalcMeasureOptions(); calcPreview();
}
function fillForm(m){ fillFormFromMapped(m); }

/* ====== debounce ====== */
function debounce(fn, ms){
  let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn.apply(null,args), ms); };
}
