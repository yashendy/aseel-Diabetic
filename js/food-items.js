// js/food-items.js (modular) — متوافق مع meals.js + ضغط صورة صغير جداً + حفظ تحت parents/{uid}/foodItems

import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc, getDocs, getDoc,
  query, orderBy, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ===== عناصر واجهة ===== */
const userEmailEl = document.getElementById('userEmail');
const formTitleEl = document.getElementById('formTitle');
const foodForm    = document.getElementById('foodForm');
const nameEl      = document.getElementById('name');
const brandEl     = document.getElementById('brand');
const categoryEl  = document.getElementById('category');
const tagsEl      = document.getElementById('tags');
const carbs100El  = document.getElementById('carbs100');
const protein100El= document.getElementById('protein100');
const fat100El    = document.getElementById('fat100');
const cal100El    = document.getElementById('cal100');
const measuresWrap= document.getElementById('measuresWrap');
const addMeasureBtn = document.getElementById('addMeasureBtn');

const imageInput  = document.getElementById('imageInput');
const previewImg  = document.getElementById('preview');
const clearImgBtn = document.getElementById('clearImgBtn');

const saveBtn     = document.getElementById('saveBtn');
const resetBtn    = document.getElementById('resetBtn');

const searchEl    = document.getElementById('search');
const filterCatEl = document.getElementById('filterCat');
const foodGrid    = document.getElementById('foodGrid');
const emptyEl     = document.getElementById('empty');

const toastEl     = document.getElementById('toast').querySelector('.msg');

/* ===== حالة ===== */
let currentUser = null;
let editingId   = null;   // عند التعديل
let cachedItems = [];     // كاش لعرض الشبكة
let currentImageDataUrl = ''; // Base64 صغيرة بعد الضغط

/* ===== أدوات ===== */
const pad = (n)=> String(n).padStart(2,'0');
const esc = (s)=> (s||'').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;')
  .replaceAll("'",'&#039;');
const toNumber = (x)=> { const n=Number(String(x??'').replace(',','.')); return isNaN(n)?0:n; };
const showToast = (m)=>{ const t=document.getElementById('toast'); toastEl.textContent=m; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),1800); };

function tokenize(ar){
  const s = (ar||'').toLowerCase().trim();
  return s
    .replace(/[^\p{L}\p{N}\s#]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
function genKeywords(name, brand, category, tags){
  const base = [name, brand, category, ...(tags||[])].join(' ');
  const toks = tokenize(base);
  // شظايا بحث مبسطة
  const uniq = Array.from(new Set(toks));
  return uniq.slice(0, 50); // نكتفي بعدد منطقي
}
function catIcon(c){
  switch(c){
    case 'نشويات': return '🍞';
    case 'حليب': return '🥛';
    case 'فاكهة': return '🍎';
    case 'خضروات': return '🥕';
    case 'لحوم': return '🍗';
    case 'دهون': return '🥑';
    default: return '🍽️';
  }
}

/* ===== ضغط صورة إلى 200px كحد أقصى ===== */
async function fileToTinyDataUrl(file){
  if(!file) return '';
  const bmp = await createImageBitmap(file);
  const maxSide = 200;
  const ratio = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  // جودة 0.6 تكفي لثَمب صغيرة
  return canvas.toDataURL('image/jpeg', 0.6);
}

/* ===== إدارة المقاييس البيتية ===== */
function addMeasureRow(name='', grams=''){
  const row = document.createElement('div');
  row.className = 'grid';
  row.innerHTML = `
    <div class="field">
      <label>اسم المقياس</label>
      <input type="text" class="mName" value="${esc(name)}" placeholder="مثال: ملعقة" />
    </div>
    <div class="field">
      <label>جرامات</label>
      <input type="number" class="mGrams" step="any" value="${esc(grams)}" placeholder="مثال: 15" />
    </div>
    <div class="field">
      <label>&nbsp;</label>
      <button type="button" class="btn danger delM">حذف</button>
    </div>
  `;
  row.querySelector('.delM').addEventListener('click', ()=> row.remove());
  measuresWrap.appendChild(row);
}

function readMeasures(){
  const rows = Array.from(measuresWrap.querySelectorAll('.grid'));
  const out = [];
  rows.forEach(r=>{
    const name = r.querySelector('.mName').value.trim();
    const grams= toNumber(r.querySelector('.mGrams').value);
    if(name && grams>0){ out.push({ name, grams }); }
  });
  return out;
}

/* ===== جلسة المستخدم ===== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  currentUser = user;
  userEmailEl.textContent = user.email || user.uid;
  await loadItems();
});

/* ===== تحميل الأصناف ===== */
async function loadItems(){
  const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
  // لو nameLower موجود ممتاز، لو لأ هنجيب بدون orderBy ونرتب محليًا
  let snap;
  try{
    snap = await getDocs(query(ref, orderBy('nameLower','asc')));
  }catch(_){
    // fallback بدون index
    snap = await getDocs(ref);
  }
  cachedItems = [];
  snap.forEach(d=>{
    const raw = d.data();
    cachedItems.push(normalizeFoodDoc({ id:d.id, ...raw }));
  });
  renderGrid();
}

/* ===== تطبيع وثيقة الصنف لتوافق meals.js ===== */
function normalizeFoodDoc(it){
  // nutrPer100g
  const carbs_g = toNumber(it?.nutrPer100g?.carbs_g ?? it?.carbs_100g);
  const cal_kcal = toNumber(it?.nutrPer100g?.cal_kcal ?? it?.calories_100g);
  const protein_g= toNumber(it?.nutrPer100g?.protein_g ?? it?.protein_100g);
  const fat_g    = toNumber(it?.nutrPer100g?.fat_g ?? it?.fat_100g);

  // measures: نقبل Array جاهزة أو Map `{اسم:جرامات}`
  let measures = [];
  if (Array.isArray(it?.measures)){
    measures = it.measures.filter(m=> m && m.name && Number(m.grams)>0)
      .map(m=> ({ name:String(m.name), grams: toNumber(m.grams) }));
  } else if (it?.householdUnits && typeof it.householdUnits==='object'){
    measures = Object.entries(it.householdUnits)
      .filter(([n,g])=> n && toNumber(g)>0)
      .map(([n,g])=> ({name:String(n), grams:toNumber(g)}));
  }

  // tags/keywords/nameLower
  const name = it?.name || '';
  const brand= it?.brand || '';
  const category = it?.category || '';
  const tags = Array.isArray(it?.tags) ? it.tags : tokenize(String(it?.tags||'').replace(/,/g,' '));
  const nameLower = (it?.nameLower) ? it.nameLower : String(name).toLowerCase();
  const keywords  = Array.isArray(it?.keywords) ? it.keywords : genKeywords(name, brand, category, tags);

  // الصورة: data url صغيرة (لو وُجدت)
  const imageUrl = it?.imageUrl || '';

  return {
    id: it.id,
    name, brand, category, tags,
    nutrPer100g: { carbs_g, cal_kcal, protein_g, fat_g },
    measures,
    nameLower, keywords,
    imageUrl,
  };
}

/* ===== عرض الشبكة + فلترة ===== */
function renderGrid(){
  const q = (searchEl.value||'').trim();
  const cat = filterCatEl.value || 'الكل';

  let list = [...cachedItems];

  if (cat !== 'الكل'){ list = list.filter(x=> (x.category||'')===cat); }

  if (q){
    if (q.startsWith('#')){
      const tag = q.slice(1).toLowerCase();
      list = list.filter(x=> Array.isArray(x.tags) && x.tags.some(t=> String(t).toLowerCase()===tag));
    }else{
      const token = q.toLowerCase();
      list = list.filter(x=>{
        return (x.name||'').toLowerCase().includes(token)
            || (x.brand||'').toLowerCase().includes(token)
            || (x.category||'').toLowerCase().includes(token)
            || (Array.isArray(x.tags)&&x.tags.some(t=> String(t).toLowerCase().includes(token)))
            || (Array.isArray(x.keywords)&&x.keywords.includes(token));
      });
    }
  }

  // ترتيب بالاسم
  list.sort((a,b)=> (a.nameLower||'').localeCompare(b.nameLower||''));

  foodGrid.innerHTML = '';
  if(!list.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  list.forEach(x=>{
    const card = document.createElement('div');
    card.className = 'card-item';
    const thumb = x.imageUrl
      ? `<img src="${esc(x.imageUrl)}" alt="">`
      : `<span>${catIcon(x.category)}</span>`;
    card.innerHTML = `
      <div class="card-thumb">${thumb}</div>
      <div class="card-body">
        <div><strong>${esc(x.name)}</strong> ${x.brand?`<small>(${esc(x.brand)})</small>`:''}</div>
        <div class="badges">
          <span class="badge">${esc(x.category||'-')}</span>
          <span class="badge">ك/100g: ${x.nutrPer100g.carbs_g||0}</span>
          <span class="badge">س/100g: ${x.nutrPer100g.cal_kcal||0}</span>
          ${x.nutrPer100g.protein_g?`<span class="badge">ب/100g: ${x.nutrPer100g.protein_g}</span>`:''}
          ${x.nutrPer100g.fat_g?`<span class="badge">د/100g: ${x.nutrPer100g.fat_g}</span>`:''}
        </div>
        <div class="card-actions">
          <button class="btn secondary edit">تعديل</button>
          <button class="btn danger del">حذف</button>
        </div>
      </div>
    `;
    card.querySelector('.edit').addEventListener('click', ()=> fillFormForEdit(x.id));
    card.querySelector('.del').addEventListener('click', ()=> deleteItem(x.id, x.name));
    foodGrid.appendChild(card);
  });
}

/* ===== تعبئة النموذج للتعديل ===== */
async function fillFormForEdit(id){
  const ref = doc(db, `parents/${currentUser.uid}/foodItems/${id}`);
  const s = await getDoc(ref);
  if(!s.exists()) return;
  const it = normalizeFoodDoc({ id:s.id, ...s.data() });

  editingId = id;
  formTitleEl.textContent = '✏️ تعديل صنف';
  nameEl.value = it.name||'';
  brandEl.value= it.brand||'';
  categoryEl.value = it.category || 'نشويات';
  tagsEl.value = Array.isArray(it.tags) ? it.tags.join(', ') : '';

  carbs100El.value = it.nutrPer100g.carbs_g ?? '';
  protein100El.value = it.nutrPer100g.protein_g ?? '';
  fat100El.value = it.nutrPer100g.fat_g ?? '';
  cal100El.value = it.nutrPer100g.cal_kcal ?? '';

  measuresWrap.innerHTML = '';
  (it.measures||[]).forEach(m=> addMeasureRow(m.name, m.grams));

  currentImageDataUrl = it.imageUrl || '';
  previewImg.src = currentImageDataUrl || '';
  previewImg.classList.toggle('hidden', !currentImageDataUrl);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===== حذف صنف ===== */
async function deleteItem(id, name){
  if(!confirm(`حذف ${name||'الصنف'}؟`)) return;
  await deleteDoc(doc(db, `parents/${currentUser.uid}/foodItems/${id}`));
  showToast('🗑️ تم الحذف');
  await loadItems();
}

/* ===== حفظ (إضافة/تعديل) ===== */
foodForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name = nameEl.value.trim();
  if(!name){ nameEl.focus(); return; }

  const brand = brandEl.value.trim();
  const category = categoryEl.value || 'نشويات';
  const tags = parseTags(tagsEl.value);

  const carbs_g = toNumber(carbs100El.value);
  const protein_g = toNumber(protein100El.value);
  const fat_g     = toNumber(fat100El.value);
  const cal_kcal  = toNumber(cal100El.value);

  const measures = readMeasures();

  const payload = {
    name,
    brand: brand || null,
    category,
    tags,
    nameLower: name.toLowerCase(),
    keywords: genKeywords(name, brand, category, tags),
    nutrPer100g: {
      carbs_g: carbs_g || 0,
      protein_g: protein_g || 0,
      fat_g: fat_g || 0,
      cal_kcal: cal_kcal || 0,
    },
    measures, // array [{name, grams}]
    imageUrl: currentImageDataUrl || '', // Data URL صغيرة
    updatedAt: serverTimestamp(),
  };

  saveBtn.disabled = true; saveBtn.textContent = editingId ? 'جارٍ التحديث…' : 'جارٍ الحفظ…';
  try{
    const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
    if (editingId){
      await updateDoc(doc(ref, editingId), payload);
      showToast('✅ تم التحديث');
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(ref, payload);
      showToast('✅ تم الحفظ');
    }
    await loadItems();
    resetForm();
  }catch(err){
    console.error(err);
    alert('تعذر الحفظ');
  }finally{
    saveBtn.disabled = false; saveBtn.textContent = 'حفظ الصنف';
  }
});

function resetForm(){
  editingId = null;
  formTitleEl.textContent = '➕ إضافة صنف';
  foodForm.reset();
  measuresWrap.innerHTML = '';
  currentImageDataUrl = '';
  previewImg.src = ''; previewImg.classList.add('hidden');
}

/* ===== وسوم + بحث + فلترة ===== */
function parseTags(s){
  if(!s) return [];
  const replaced = s.replace(/#/g,' ').replace(/,/g,' ');
  return tokenize(replaced);
}

searchEl.addEventListener('input', debounce(renderGrid, 250));
filterCatEl.addEventListener('change', renderGrid);
resetBtn.addEventListener('click', resetForm);
addMeasureBtn.addEventListener('click', ()=> addMeasureRow());

/* ===== صورة مصغرة جداً ===== */
imageInput.addEventListener('change', async ()=>{
  const f = imageInput.files?.[0];
  if (!f){ currentImageDataUrl=''; previewImg.classList.add('hidden'); return; }
  try{
    currentImageDataUrl = await fileToTinyDataUrl(f);
    previewImg.src = currentImageDataUrl;
    previewImg.classList.remove('hidden');
  }catch(e){
    console.error(e); alert('تعذر معالجة الصورة'); currentImageDataUrl=''; previewImg.classList.add('hidden');
  }
});
clearImgBtn.addEventListener('click', ()=>{
  currentImageDataUrl=''; previewImg.src=''; previewImg.classList.add('hidden'); imageInput.value='';
});

/* ===== أدوات مساعدة ===== */
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
