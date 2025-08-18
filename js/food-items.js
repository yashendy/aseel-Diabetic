// js/food-items.js
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc, query, orderBy,
  serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* DOM refs */
const grid = document.getElementById('grid');

const qEl = document.getElementById('q');
const fCat = document.getElementById('fCat');
const fSource = document.getElementById('fSource');
const fPhoto = document.getElementById('fPhoto');
const fSort = document.getElementById('fSort');
const btnClear = document.getElementById('btnClear');

const btnAdd = document.getElementById('btnAdd');
const togglePick = document.getElementById('togglePickMode');

const drawer = document.getElementById('drawer');
const btnClose = document.getElementById('btnClose');
const btnCancel = document.getElementById('btnCancel');
const formTitle = document.getElementById('formTitle');

const form = document.getElementById('itemForm');
const itemId = document.getElementById('itemId');
const nameEl = document.getElementById('name');
const brandEl = document.getElementById('brand');
const categoryEl = document.getElementById('category');
const carb100El = document.getElementById('carb100');
const prot100El = document.getElementById('prot100');
const fat100El  = document.getElementById('fat100');
const kcal100El = document.getElementById('kcal100');
const unitsList = document.getElementById('unitsList');
const uNameEl   = document.getElementById('uName');
const uGramsEl  = document.getElementById('uGrams');
const btnAddUnit= document.getElementById('btnAddUnit');
const imageUrlEl= document.getElementById('imageUrl');
const btnAutoImage = document.getElementById('btnAutoImage');
const tagsEl    = document.getElementById('tags');
const notesEl   = document.getElementById('notes');
const sourceEl  = document.getElementById('source');
const metaText  = document.getElementById('metaText');

/* Snack (undo delete) */
const snack = document.getElementById('snack');
const snackText = document.getElementById('snackText');
const snackUndo = document.getElementById('snackUndo');

let UNITS = []; // [{name, grams}]
let ITEMS = [];
let USER = null;
let lastDeleted = null, snackTimer = null;

const params = new URLSearchParams(location.search);
const currentChild = params.get('child') || '';

/* Helpers */
const toNumber = v => (v==='' || v==null ? 0 : Number(v));
const calcCalories = (c,p,f) => Math.round(4*toNumber(c) + 4*toNumber(p) + 9*toNumber(f));
const fmt = n => (n==null || isNaN(+n) ? '—' : (+n).toFixed(1));
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function normalTags(str){
  if(!str) return [];
  return str.split(',').map(t=>t.trim()).filter(Boolean).map(t=>{
    if(!t.startsWith('#')) t = '#'+t;
    return t.toLowerCase();
  });
}
function tagsToString(arr){return (arr||[]).join(', ')}

function openDrawer(){ drawer.classList.add('open'); }
function closeDrawer(){ drawer.classList.remove('open'); resetForm(); }

function resetForm(){
  itemId.value = '';
  formTitle.textContent = 'إضافة صنف';
  nameEl.value = ''; brandEl.value = ''; categoryEl.value='';
  carb100El.value=''; prot100El.value=''; fat100El.value=''; kcal100El.value='';
  UNITS = []; renderUnits();
  imageUrlEl.value=''; tagsEl.value=''; notesEl.value='';
  sourceEl.value='manual'; metaText.textContent='—';
}

function renderUnits(){
  unitsList.innerHTML = UNITS.length ? '' : '<span class="meta">لا توجد مقادير مضافة.</span>';
  UNITS.forEach((u,idx)=>{
    const el = document.createElement('span');
    el.className='unit';
    el.innerHTML = `<strong>${esc(u.name)}</strong> = <span>${esc(u.grams)} g</span> <span class="x" title="حذف" data-i="${idx}">✖</span>`;
    unitsList.appendChild(el);
  });
}
btnAddUnit.addEventListener('click', ()=>{
  const n = uNameEl.value.trim();
  const g = Number(uGramsEl.value);
  if(!n || !g){ alert('أدخل اسم المقدار والجرام المكافئ'); return; }
  if(g<=0){ alert('الجرام يجب أن يكون رقمًا موجبًا'); return; }
  UNITS.push({name:n, grams:g});
  uNameEl.value=''; uGramsEl.value='';
  renderUnits();
});
unitsList.addEventListener('click', (e)=>{
  const t = e.target;
  if(t.classList.contains('x')){
    const i = Number(t.dataset.i);
    UNITS.splice(i,1);
    renderUnits();
  }
});

/* صورة تلقائية (SVG) */
function autoImageFor(name='صنف'){
  const hue = (Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0) % 360);
  const bg  = `hsl(${hue} 80% 90%)`;
  const fg  = `hsl(${hue} 60% 40%)`;
  const txt = esc(name[0] || 'ص');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>
    <rect width='100%' height='100%' fill='${bg}'/>
    <text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle'
      font-family='Segoe UI, Tahoma' font-size='140' fill='${fg}'>${txt}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
btnAutoImage.addEventListener('click', ()=>{
  if(!nameEl.value.trim()){ alert('أدخل اسم الصنف أولاً'); return; }
  imageUrlEl.value = autoImageFor(nameEl.value.trim());
});

/* احسب السعرات تلقائيًا لو فاضي */
[kcal100El, carb100El, prot100El, fat100El].forEach(el=>{
  el.addEventListener('input', ()=>{
    if(kcal100El.value===''){
      const kcal = calcCalories(carb100El.value, prot100El.value, fat100El.value);
      if(!isNaN(kcal)) kcal100El.placeholder = `${kcal}`;
    }
  });
});

/* فتح/إغلاق النموذج */
btnAdd.addEventListener('click', ()=>{ resetForm(); openDrawer(); });
btnClose.addEventListener('click', closeDrawer);
btnCancel.addEventListener('click', closeDrawer);

/* وضع الاختيار (يحفظ محليًا) */
togglePick.checked = localStorage.getItem('fi_pickmode') === '1';
togglePick.addEventListener('change', ()=>{
  localStorage.setItem('fi_pickmode', togglePick.checked ? '1' : '0');
  renderGrid();
});

/* فلاتر */
[qEl,fCat,fSource,fPhoto,fSort].forEach(el=> el.addEventListener('input', renderGrid));
btnClear.addEventListener('click', ()=>{
  qEl.value=''; fCat.value=''; fSource.value=''; fPhoto.value=''; fSort.value='name_asc';
  renderGrid();
});

/* تحميل بيانات المستخدم ثم الأصناف */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER = user;
  await loadItems();
});

async function loadItems(){
  grid.textContent = 'جارِ التحميل…';
  const ref = collection(db, `parents/${USER.uid}/foodItems`);
  const snap = await getDocs(query(ref, orderBy('name')));
  ITEMS = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  renderGrid();
}

/* تصفية + ترتيب + عرض الشبكة */
function renderGrid(){
  const q = qEl.value.trim().toLowerCase();
  const cat = fCat.value;
  const src = fSource.value;
  const ph  = fPhoto.value;
  const sort = fSort.value;

  let arr = ITEMS.slice();

  // فلترة
  if(q){
    arr = arr.filter(it=>{
      const inName = (it.name||'').toLowerCase().includes(q);
      const inTags = (it.tags||[]).some(t=> t.toLowerCase().includes(q));
      return inName || inTags;
    });
  }
  if(cat) arr = arr.filter(it=> it.category===cat);
  if(src) arr = arr.filter(it=> (it.source||'manual')===src);
  if(ph==='with')    arr = arr.filter(it=> !!it.imageUrl);
  if(ph==='without') arr = arr.filter(it=> !it.imageUrl);

  // ترتيب
  arr.sort((a,b)=>{
    if(sort==='name_asc')  return (a.name||'').localeCompare(b.name||'','ar');
    if(sort==='name_desc') return (b.name||'').localeCompare(a.name||'','ar');
    if(sort==='newest')    return (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0);
    if(sort==='oldest')    return (a.createdAt?.seconds||0)-(b.createdAt?.seconds||0);
    return 0;
  });

  // عرض
  grid.innerHTML = '';
  if(!arr.length){
    grid.innerHTML = `<div class="meta">لا توجد أصناف مطابقة.</div>`;
    return;
  }

  const pickMode = togglePick.checked;

  arr.forEach(it=>{
    const kcal = it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g);
    const img  = it.imageUrl || autoImageFor(it.name||'صنف');
    const unitsBadge = (it.householdUnits?.length>0) ? `<span class="badge units">مقادير منزلية</span>` : '';
    const tagsBadge  = (it.tags?.length>0) ? `<span class="badge tags">تاجات</span>` : '';
    const source     = `<span class="badge src">${esc(it.source||'manual')}</span>`;

    const card = document.createElement('div');
    card.className='card';
    card.innerHTML = `
      <div class="head">
        <img class="thumb" src="${esc(img)}" alt="">
        <div>
          <div class="title">${esc(it.name||'—')}</div>
          <div class="meta">${esc(it.brand||'—')} • ${esc(it.category||'—')}</div>
          <div class="chips">
            <span class="chip">كارب/100g: <strong>${fmt(it.carbs_100g)}</strong></span>
            <span class="chip">بروتين/100g: ${fmt(it.protein_100g)}</span>
            <span class="chip">دهون/100g: ${fmt(it.fat_100g)}</span>
            <span class="chip">سعرات/100g: ${isNaN(kcal)?'—':kcal}</span>
            ${source} ${unitsBadge} ${tagsBadge}
          </div>
        </div>
      </div>

      <div class="quick">
        <label>حساب سريع للحصة:</label>
        <input type="number" step="1" min="0" placeholder="جرام" class="input qG">
        <select class="input qU">
          <option value="">أو اختَر مقدارًا منزليًا</option>
          ${(it.householdUnits||[]).map(u=>`<option value="${u.grams}">${esc(u.name)} (${u.grams}g)</option>`).join('')}
        </select>
        <button class="btn ghost qCalc">احسب</button>
        <span class="meta qOut"></span>
      </div>

      <div class="actions">
        ${pickMode && currentChild ? `<button class="btn primary qSend">استخدام داخل الوجبات</button>`:''}
        <button class="btn qEdit">تعديل</button>
        <button class="btn qCopy">نسخ</button>
        <button class="btn qDel" style="color:#fff;background:#ef4444;border:0">حذف</button>
      </div>

      <div class="meta">${esc(tagsToString(it.tags))}</div>
    `;

    // أحداث الحاسبة
    const qG = card.querySelector('.qG');
    const qU = card.querySelector('.qU');
    const qOut = card.querySelector('.qOut');

    card.querySelector('.qCalc').addEventListener('click', ()=>{
      const grams = Number(qU.value || qG.value);
      if(!grams){ qOut.textContent='أدخل وزنًا أو اختر مقدار'; return; }
      const factor = grams/100;
      const carbs = factor * (it.carbs_100g||0);
      const kcal  = factor * (it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g));
      qOut.textContent = `كارب: ${carbs.toFixed(1)}g • سعرات: ${Math.round(kcal)} kcal`;
    });

    // إرسال للوجبات
    if(pickMode && currentChild){
      const btnSend = card.querySelector('.qSend');
      btnSend?.addEventListener('click', ()=>{
        const grams = Number(qU.value || qG.value);
        if(!grams){ alert('أدخل وزنًا أو اختر مقدار'); return; }
        const url = `meals.html?child=${encodeURIComponent(currentChild)}&item=${encodeURIComponent(it.id)}&grams=${grams}`;
        location.href = url;
      });
    }

    // تعديل
    card.querySelector('.qEdit').addEventListener('click', ()=> openEdit(it));
    // نسخ
    card.querySelector('.qCopy').addEventListener('click', ()=> openCopy(it));
    // حذف (مع undo)
    card.querySelector('.qDel').addEventListener('click', async ()=>{
      if(!confirm(`حذف الصنف «${it.name}»؟ لا يمكن التراجع بعد الإغلاق.`)) return;
      lastDeleted = { ...it };
      await deleteDoc(doc(db, `parents/${USER.uid}/foodItems/${it.id}`));
      await loadItems();
      showSnack(`تم حذف «${it.name}»`);
    });

    grid.appendChild(card);
  });
}

/* Snack (Undo) */
function showSnack(text){
  snackText.textContent = text;
  snack.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(()=> snack.hidden = true, 5000);
}
snackUndo.addEventListener('click', async ()=>{
  snack.hidden = true;
  if(!lastDeleted) return;
  const backup = {...lastDeleted};
  lastDeleted = null;
  // استرجاع بنفس الـ id (اختياري: نحاول)
  try{
    await setDoc(doc(db, `parents/${USER.uid}/foodItems/${backup.id}`), {
      ...backup, updatedAt: serverTimestamp()
    });
  }catch{
    await addDoc(collection(db, `parents/${USER.uid}/foodItems`), {
      ...backup, id: undefined, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  }
  await loadItems();
  showSnack('تم التراجع عن الحذف');
});

/* فتح تعديل */
function fillForm(it){
  itemId.value = it.id || '';
  formTitle.textContent = it.id ? 'تعديل صنف' : 'إضافة صنف';
  nameEl.value = it.name || '';
  brandEl.value = it.brand || '';
  categoryEl.value = it.category || '';
  carb100El.value = it.carbs_100g ?? '';
  prot100El.value = it.protein_100g ?? '';
  fat100El.value  = it.fat_100g ?? '';
  kcal100El.value = it.calories_100g ?? '';
  UNITS = (it.householdUnits||[]).map(u=> ({name:u.name, grams:u.grams}));
  renderUnits();
  imageUrlEl.value = it.imageUrl || '';
  tagsEl.value = tagsToString(it.tags);
  notesEl.value = it.notes || '';
  sourceEl.value = it.source || 'manual';

  const c = it.createdAt?.toDate ? it.createdAt.toDate() : null;
  const u = it.updatedAt?.toDate ? it.updatedAt.toDate() : null;
  metaText.textContent = `أُنشئ: ${c?c.toLocaleString('ar-EG'):'—'} • آخر تحديث: ${u?u.toLocaleString('ar-EG'):'—'}`;
}

function openEdit(it){ fillForm(it); openDrawer(); }
function openCopy(it){
  const clone = {...it};
  delete clone.id;
  clone.name = (clone.name||'') + ' - نسخة';
  fillForm(clone);
  openDrawer();
}

/* حفظ النموذج */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name = nameEl.value.trim();
  const category = categoryEl.value;
  const carbs = Number(carb100El.value);
  if(!name || !category || isNaN(carbs)){ alert('الاسم + التصنيف + كارب/100g مطلوبة'); return; }
  if(carbs < 0 || toNumber(prot100El.value) < 0 || toNumber(fat100El.value) < 0){ alert('القيم الغذائية يجب أن تكون ≥ 0'); return; }

  let kcal100 = kcal100El.value==='' ? calcCalories(carb100El.value, prot100El.value, fat100El.value) : Number(kcal100El.value);
  if(isNaN(kcal100)) kcal100 = 0;

  const payload = {
    name,
    brand: brandEl.value.trim() || null,
    category,
    carbs_100g: +carb100El.value || 0,
    protein_100g: +prot100El.value || 0,
    fat_100g: +fat100El.value || 0,
    calories_100g: +kcal100 || 0,
    householdUnits: UNITS.slice(),
    imageUrl: imageUrlEl.value.trim() || null,
    tags: normalTags(tagsEl.value),
    notes: notesEl.value.trim() || null,
    source: sourceEl.value || 'manual',
    updatedAt: serverTimestamp(),
  };

  const id = itemId.value;
  try{
    if(id){
      await updateDoc(doc(db, `parents/${USER.uid}/foodItems/${id}`), payload);
      alert('تم التحديث بنجاح');
    }else{
      await addDoc(collection(db, `parents/${USER.uid}/foodItems`), {
        ...payload, createdAt: serverTimestamp()
      });
      alert('تمت الإضافة بنجاح');
    }
    closeDrawer();
    await loadItems();
  }catch(err){
    console.error(err);
    alert('حدث خطأ أثناء الحفظ');
  }
});
