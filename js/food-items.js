// js/food-items.js
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc,
  query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* DOM */
const form       = document.getElementById('itemForm');
const itemId     = document.getElementById('itemId');
const nameEl     = document.getElementById('name');
const categoryEl = document.getElementById('category');
const brandEl    = document.getElementById('brand');

const carb100El  = document.getElementById('carb100');
const prot100El  = document.getElementById('prot100');
const fat100El   = document.getElementById('fat100');
const fiber100El = document.getElementById('fiber100');   // NEW

const kcal100El  = document.getElementById('kcal100');
const giEl       = document.getElementById('gi');
const sourceEl   = document.getElementById('source');

const unitsList  = document.getElementById('unitsList');
const uNameEl    = document.getElementById('uName');
const uGramsEl   = document.getElementById('uGrams');
const btnAddUnit = document.getElementById('btnAddUnit');

const imageUrlEl = document.getElementById('imageUrl');
const tagsEl     = document.getElementById('tags');

const btnReset   = document.getElementById('btnReset');
const btnDelete  = document.getElementById('btnDelete');

const grid       = document.getElementById('grid');
const qEl        = document.getElementById('q');
const fCat       = document.getElementById('fCat');
const fPhoto     = document.getElementById('fPhoto');

const snack      = document.getElementById('snack');
const snackText  = document.getElementById('snackText');
const snackUndo  = document.getElementById('snackUndo');

/* State */
let USER = null;
let ITEMS = [];
let UNITS = [];
let lastDeleted = null, snackTimer=null;

/* Utils */
const esc = s => (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt = n => (n==null||isNaN(+n)?'—':(+n).toFixed(1));
const calcCalories = (c,p,f)=> Math.round(4*(+c||0)+4*(+p||0)+9*(+f||0));

/* Snack */
function showSnack(t){ snackText.textContent=t; snack.hidden=false; clearTimeout(snackTimer); snackTimer=setTimeout(()=>snack.hidden=true,4000); }
snackUndo.addEventListener('click', async ()=>{
  snack.hidden=true;
  if(!lastDeleted) return;
  const data={...lastDeleted}; lastDeleted=null;
  // حاول استرجاع بالـ id؛ لو فشل أنشئ id جديد
  try {
    await setDoc(doc(db, 'admin','global','foodItems', data.id), {...data, updatedAt:serverTimestamp()});
  } catch {
    await addDoc(collection(db,'admin','global','foodItems'),
      {...data, id:undefined, createdAt:serverTimestamp(), updatedAt:serverTimestamp()});
  }
  await loadItems();
  showSnack('تم التراجع عن الحذف');
});

/* Auth + load */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER=user;
  await loadItems();
});

/* ======== Load / Save / Delete ======== */
async function loadItems(){
  grid.textContent='جارِ التحميل…';
  const adminItemsRef = collection(db, 'admin','global','foodItems'); // المسار المركزي
  const snap = await getDocs(query(adminItemsRef, orderBy('name')));
  ITEMS = snap.docs.map(d=>({id:d.id, ...d.data()}));
  renderGrid();
}

function renderUnits(){
  unitsList.innerHTML = UNITS.length? '' : '<span class="meta">لا توجد مقادير مضافة.</span>';
  UNITS.forEach((u,i)=>{
    const el=document.createElement('span');
    el.className='unit';
    el.innerHTML=`<strong>${esc(u.name)}</strong> = <span>${esc(u.grams)} g</span> <button class="x" data-i="${i}">✖</button>`;
    unitsList.appendChild(el);
  });
}

btnAddUnit.addEventListener('click', ()=>{
  const n=uNameEl.value.trim(), g=Number(uGramsEl.value);
  if(!n||!g||g<=0){ alert('أدخل اسم المقدار وجرام (>0)'); return; }
  UNITS.push({name:n, grams:g}); uNameEl.value=''; uGramsEl.value=''; renderUnits();
});

unitsList.addEventListener('click', e=>{
  const t=e.target; if(t.classList.contains('x')){ UNITS.splice(Number(t.dataset.i),1); renderUnits(); }
});

btnReset.addEventListener('click', ()=>{
  form.reset(); UNITS=[]; renderUnits(); itemId.value='';
});

btnDelete.addEventListener('click', async ()=>{
  if(!itemId.value) return;
  if(!confirm('حذف هذا الصنف؟')) return;
  const it = ITEMS.find(x=>x.id===itemId.value);
  await deleteDoc(doc(db, 'admin','global','foodItems', itemId.value));
  lastDeleted = it || null;
  await loadItems();
  form.reset(); UNITS=[]; renderUnits(); itemId.value='';
  showSnack('تم الحذف');
});

form.addEventListener('submit', saveItem);

async function saveItem(e){
  e.preventDefault();

  const name     = nameEl.value.trim();
  const category = categoryEl.value;
  const brand    = brandEl.value.trim() || null;

  const carbs   = Number(carb100El.value);
  const protein = Number(prot100El.value);
  const fat     = Number(fat100El.value);
  const fiber   = Number(fiber100El.value); // NEW

  if(!name || !category || isNaN(carbs) || carbs<0 || (protein<0) || (fat<0) || (fiber<0)){
    alert('الاسم + التصنيف + كارب/100g مطلوبة وقيم التغذية ≥ 0'); return;
  }

  let kcal = kcal100El.value==='' ? calcCalories(carbs, protein, fat) : Number(kcal100El.value);
  if(isNaN(kcal)) kcal=0;

  const payload = {
    name,
    category,
    brand,
    carbs_100g:  +carbs || 0,
    protein_100g:+protein || 0,
    fat_100g:    +fat || 0,
    fiber_100g:  +fiber || 0,        // NEW
    calories_100g:+kcal || 0,
    gi:          (giEl.value===''? null : Math.max(0, Math.min(110, Number(giEl.value)))),
    householdUnits: UNITS.slice(),
    imageUrl: imageUrlEl.value.trim() || null,
    source:  sourceEl.value.trim() || null,
    tags: normalTags(tagsEl.value),
    updatedAt: serverTimestamp()
  };

  const refColl = collection(db, 'admin','global','foodItems');
  if(itemId.value){
    await updateDoc(doc(refColl, itemId.value), payload);
    alert('تم تحديث الصنف');
  }else{
    await addDoc(refColl, {...payload, createdAt: serverTimestamp()});
    alert('تمت إضافة الصنف');
  }

  await loadItems();
  form.reset(); UNITS=[]; renderUnits(); itemId.value='';
}

/* ======== Render Grid ======== */
[qEl,fCat,fPhoto].forEach(el=> el.addEventListener('input', renderGrid));

function normalTags(str){
  if(!str) return [];
  return str.split(',').map(t=>t.trim()).filter(Boolean)
    .map(t=> t.startsWith('#') ? t : ('#'+t)).map(t=>t.toLowerCase());
}

function autoImageFor(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  const bg=`hsl(${hue} 80% 90%)`, fg=`hsl(${hue} 60% 40%)`, ch=esc(name[0]||'ص');
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>
      <rect width='100%' height='100%' fill='${bg}'/>
      <text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle'
        font-family='Segoe UI' font-size='140' fill='${fg}'>${ch}</text>
    </svg>`
  );
}

function renderGrid(){
  let arr = ITEMS.slice();
  const q = qEl.value.trim().toLowerCase();
  const cat=fCat.value, ph=fPhoto.value;

  if(q){
    arr = arr.filter(it=>{
      const inName=(it.name||'').toLowerCase().includes(q);
      const inTags=(it.tags||[]).some(t=> t.toLowerCase().includes(q));
      return inName || inTags || (q.startsWith('#') && (it.tags||[]).includes(q));
    });
  }
  if(cat) arr=arr.filter(it=>it.category===cat);
  if(ph==='with')    arr=arr.filter(it=>!!it.imageUrl);
  if(ph==='without') arr=arr.filter(it=>!it.imageUrl);

  if(!arr.length){ grid.innerHTML='<div class="meta">لا توجد أصناف.</div>'; return; }

  grid.innerHTML='';
  arr.forEach(it=>{
    const img = it.imageUrl || autoImageFor(it.name||'صنف');
    const kcal = it.calories_100g ?? calcCalories(it.carbs_100g,it.protein_100g,it.fat_100g);

    const card = document.createElement('div');
    card.className='card';
    card.innerHTML = `
      <div class="head">
        <img class="thumb" src="${esc(img)}" onerror="this.src='${autoImageFor(it.name||'صنف')}'" alt="">
        <div>
          <div class="title">${esc(it.name||'—')}</div>
          <div class="meta">${esc(it.brand||'—')} • ${esc(it.category||'—')}</div>
          <div class="chips">
            <span class="chip">كارب/100g: <strong>${fmt(it.carbs_100g)}</strong></span>
            <span class="chip">بروتين/100g: ${fmt(it.protein_100g)}</span>
            <span class="chip">دهون/100g: ${fmt(it.fat_100g)}</span>
            <span class="chip">ألياف/100g: ${fmt(it.fiber_100g)}</span>   <!-- NEW -->
            <span class="chip">سعرات/100g: ${isNaN(kcal)?'—':kcal}</span>
            ${(it.gi!=null)?`<span class="badge">GI: ${it.gi}</span>`:''}
          </div>
        </div>
      </div>

      <div class="quick">
        <label>حساب سريع للحصة:</label>
        <input type="number" step="1" min="0" placeholder="جرام" class="input qG">
        <select class="input qU">
          <option value="">أو مقدار منزلي</option>
          ${(it.householdUnits||[]).map(u=>`<option value="${u.grams}">${esc(u.name)} (${u.grams}g)</option>`).join('')}
        </select>
        <button class="btn ghost qCalc">احسب</button>
        <span class="meta qOut"></span>
      </div>

      <div class="actions">
        <button class="btn qEdit">تعديل</button>
        <button class="btn qCopy">نسخ</button>
        <button class="btn qDel" style="background:#ef4444;color:#fff">حذف</button>
      </div>

      <div class="meta">${esc((it.tags||[]).join(', '))}</div>
    `;

    const qG=card.querySelector('.qG'), qU=card.querySelector('.qU'), qOut=card.querySelector('.qOut');
    card.querySelector('.qCalc').addEventListener('click', ()=>{
      const grams = Number(qU.value || qG.value);
      if(!grams){ qOut.textContent='أدخل وزنًا أو اختر مقدار'; return; }
      const factor = grams/100;
      const carbs  = factor*(it.carbs_100g||0);
      const fiber  = factor*(it.fiber_100g||0); // NEW
      const kcal2  = factor*(it.calories_100g ?? calcCalories(it.carbs_100g,it.protein_100g,it.fat_100g));
      qOut.textContent = `كارب: ${carbs.toFixed(1)}g • ألياف: ${fiber.toFixed(1)}g • سعرات: ${Math.round(kcal2)} kcal`;
    });

    card.querySelector('.qEdit').addEventListener('click', ()=> openEdit(it));
    card.querySelector('.qCopy').addEventListener('click', ()=> openCopy(it));
    card.querySelector('.qDel').addEventListener('click', async ()=>{
      if(!confirm(`حذف «${it.name}»؟`)) return;
      lastDeleted={...it};
      await deleteDoc(doc(db, 'admin','global','foodItems', it.id));
      await loadItems();
      showSnack('تم الحذف');
    });

    grid.appendChild(card);
  });
}

function openEdit(it){
  itemId.value = it.id || '';
  nameEl.value = it.name || '';
  categoryEl.value = it.category || '';
  brandEl.value = it.brand || '';

  carb100El.value  = it.carbs_100g ?? '';
  prot100El.value  = it.protein_100g ?? '';
  fat100El.value   = it.fat_100g ?? '';
  fiber100El.value = it.fiber_100g ?? '';     // NEW
  kcal100El.value  = it.calories_100g ?? '';
  giEl.value       = it.gi ?? '';

  UNITS = (it.householdUnits||[]).map(u=>({name:u.name, grams:u.grams}));
  renderUnits();

  imageUrlEl.value = it.imageUrl || '';
  tagsEl.value     = (it.tags||[]).join(', ');
  sourceEl.value   = it.source || '';
  window.scrollTo({top:0, behavior:'smooth'});
}

function openCopy(it){
  const x={...it}; delete x.id;
  x.name=(x.name||'')+' - نسخة';
  openEdit(x);
  itemId.value=''; // حتى يكون حفظه إضافة جديدة
}
