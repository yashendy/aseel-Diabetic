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

/* ====== حالة ====== */
let currentUser;
let editingId = null;
let currentMeasures = []; // [{name, grams}]
let allItemsCache = [];   // لعرض سريع وتصفية محلية عند الحاجة

/* ====== أدوات ====== */
function openModal(isEdit=false){
  modal.classList.remove('hidden');
  modalTitle.textContent = isEdit ? 'تعديل صنف' : 'إضافة صنف';
}
function closeModal(){ modal.classList.add('hidden'); }
const pad = n => String(n).padStart(2,'0');
function arabicToDot(s){ return (s||'').toString().replace(',', '.').trim(); }
function numOrNull(x){
  const n = Number(arabicToDot(x));
  return isNaN(n) ? null : n;
}
function toLowerAr(s){ return (s||'').toString().trim().toLowerCase(); }

/* رموز فئة */
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
    for (let i=1;i<=Math.min(w.length,10);i++){
      tokens.add(w.slice(0,i));
    }
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
      refreshCalcMeasureOptions();
      calcPreview();
    });
    gramsInput.addEventListener('input', ()=>{
      currentMeasures[idx].grams = numOrNull(gramsInput.value);
      calcPreview();
    });
    delBtn.addEventListener('click', ()=>{
      currentMeasures.splice(idx,1);
      renderMeasures();
      refreshCalcMeasureOptions();
      calcPreview();
    });

    measuresWrap.appendChild(row);
  });
}
addMeasureBtn.addEventListener('click', ()=>{
  currentMeasures.push({ name:'', grams:null });
  renderMeasures();
  refreshCalcMeasureOptions();
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
  await loadItems(); // تحميل أولي
});

async function loadItems(){
  // قراءة مبدئية مرتبة بالاسم (نخزّن كاش محلي للفلاتر السريعة)
  const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
  const qy = query(ref, orderBy('nameLower','asc'));
  const snap = await getDocs(qy);

  allItemsCache = [];
  snap.forEach(d=>{
    allItemsCache.push({ id: d.id, ...d.data() });
  });

  // طبّق فلاتر الواجهة الحالية
  applyFilters();
}

/* ====== الفلاتر والبحث ====== */
searchEl.addEventListener('input', debounce(applyFilters, 250));
catEl.addEventListener('change', applyFilters);

async function applyFilters(){
  const q = searchEl.value.trim();
  const cat = catEl.value;

  // لو بحث بهاشتاج (#tag)
  if (q.startsWith('#') && q.length > 1){
    const tag = q.slice(1).trim().toLowerCase();
    // Query مباشر على tags (array-contains) ثم فلترة تصنيف محليًا
    const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
    const qy = query(ref, where('tags','array-contains', tag));
    const snap = await getDocs(qy);
    const arr = [];
    snap.forEach(d => arr.push({ id:d.id, ...d.data() }));

    const filtered = cat==='الكل' ? arr : arr.filter(x=> x.category===cat);
    renderItems(filtered);
    return;
  }

  // بحث بالاسم: نستخدم keywords لو طول النص >= 2
  if (q.length >= 2){
    const token = q.trim().toLowerCase();
    const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
    const qy = query(ref, where('keywords','array-contains', token));
    const snap = await getDocs(qy);
    const arr = [];
    snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
    const filtered = cat==='الكل' ? arr : arr.filter(x=> x.category===cat);
    renderItems(filtered);
    return;
  }

  // لا يوجد بحث: استخدم الكاش + فلتر تصنيف محلي
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
      img.src = item.imageUrl;
      img.alt = item.name || '';
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
  renderMeasures();
  refreshCalcMeasureOptions();
  calcPreview();
  autoImageEl.value = 'true';
  sourceEl.value = 'manual';
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
  renderMeasures();
  refreshCalcMeasureOptions();
  calcPreview();
}

function openEdit(item){
  editingId = item.id;
  itemForm.reset();
  fillForm(item);
  openModal(true);
}

itemForm.addEventListener('submit', async (e)=>{
  e.preventDefault();

  // تحقق أساسي
  if (!nameEl.value.trim()){ alert('أدخل اسم الصنف'); return; }
  if (!catModalEl.value){ alert('اختر التصنيف'); return; }
  const carbs = numOrNull(carbsEl.value);
  const cal   = numOrNull(calEl.value);
  if (carbs===null || cal===null){ alert('أدخل الكارب والسعرات لكل 100 جم'); return; }
  if (carbs<0 || cal<0){ alert('القيم لا يمكن أن تكون سالبة'); return; }

  // مقادير البيت: تجاهل الصفوف الفارغة
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

    closeModal();
    await loadItems();

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
    alert('🗑️ تم الحذف');
    await loadItems();
  } catch(e){
    console.error(e);
    alert('تعذر حذف الصنف');
  }
}

/* ====== debounce ====== */
function debounce(fn, ms){
  let t; return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=>fn.apply(null,args), ms);
  };
}
