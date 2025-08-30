// js/food-items.js — Admin Catalog (root: foodItems)
// متوافق مع Firebase v12 (CDN)

import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc, query, orderBy,
  serverTimestamp, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* --- DOM --- */
const grid = document.getElementById('grid');
const qEl = document.getElementById('q'),
      fCat = document.getElementById('fCat'),
      fSource = document.getElementById('fSource'),
      fPhoto = document.getElementById('fPhoto'),
      fSort = document.getElementById('fSort'),
      btnClear = document.getElementById('btnClear');

const btnAdd = document.getElementById('btnAdd');

const drawer = document.getElementById('drawer'),
      btnClose = document.getElementById('btnClose'),
      btnCancel = document.getElementById('btnCancel'),
      formTitle = document.getElementById('formTitle');

const form = document.getElementById('itemForm');
const itemId = document.getElementById('itemId'),
      nameEl = document.getElementById('name'),
      brandEl = document.getElementById('brand'),
      categoryEl = document.getElementById('category'),
      carb100El = document.getElementById('carb100'),
      prot100El = document.getElementById('prot100'),
      fat100El = document.getElementById('fat100'),
      kcal100El = document.getElementById('kcal100'),
      unitsList = document.getElementById('unitsList'),
      uNameEl = document.getElementById('uName'),
      uGramsEl = document.getElementById('uGrams'),
      btnAddUnit = document.getElementById('btnAddUnit'),
      imageUrlEl = document.getElementById('imageUrl'),
      btnAutoImage = document.getElementById('btnAutoImage'),
      tagsEl = document.getElementById('tags'),
      notesEl = document.getElementById('notes'),
      sourceEl = document.getElementById('source'),
      metaText = document.getElementById('metaText');

const snack = document.getElementById('snack'),
      snackText = document.getElementById('snackText'),
      snackUndo = document.getElementById('snackUndo');

/* --- State --- */
let UNITS = [];
let ITEMS = [];
let USER = null;
let lastDeleted = null, snackTimer = null;

/* --- Utils --- */
const toNumber = v => (v===''||v==null?0:Number(v));
const calcCalories = (c,p,f)=>Math.round(4*toNumber(c)+4*toNumber(p)+9*toNumber(f));
const fmt = n => (n==null||isNaN(+n)?'—':(+n).toFixed(1));
const esc = s => (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const normalTags = str => !str?[]:str.split(',').map(t=>t.trim()).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).map(t=>t.toLowerCase());

const setGrid = (html)=>{ grid.innerHTML = html; };
const showLoading = ()=> setGrid(`<div class="meta">جارِ التحميل…</div>`);
const showError = (msg, retryFn)=> setGrid(`
  <div class="card">
    <div style="color:#b91c1c;font-weight:600">تعذر التحميل</div>
    <div class="meta" style="margin:6px 0">${esc(msg)}</div>
    <button class="btn" id="__retry">إعادة المحاولة</button>
  </div>
`);
function attachRetry(fn){ document.getElementById('__retry')?.addEventListener('click', fn); }

/* --- صورة تلقائية (SVG) --- */
function autoImageFor(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  const bg=`hsl(${hue} 80% 90%)`, fg=`hsl(${hue} 60% 40%)`, ch=esc(name[0]||'ص');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>
      <rect width='100%' height='100%' fill='${bg}'/>
      <text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle'
        font-family='Segoe UI' font-size='140' fill='${fg}'>${ch}</text>
    </svg>`
  );
}

/* --- تحقق الدور: أدمن فقط --- */
async function ensureAdmin(u){
  const snap = await getDoc(doc(db, 'users', u.uid));
  const role = snap.exists()? (snap.data()?.role||'') : '';
  if(role !== 'admin'){
    alert('هذه الصفحة مخصّصة للمسؤول فقط.');
    // بدّلي لاسم صفحة وليّ الأمر عندك
    location.href = 'parent.html';
    return false;
  }
  return true;
}

/* --- Auth + Load --- */
async function safeLoadItems(){
  try{ await loadItems(); }
  catch(err){ console.error('[catalog] load error:', err); showError(err.message || 'تحقق من الاتصال والصلاحيات.', safeLoadItems); attachRetry(safeLoadItems); }
}

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER=user;
  if(await ensureAdmin(user)){
    await safeLoadItems();
  }
});

async function loadItems(){
  showLoading();
  const ref = collection(db, 'foodItems'); // ← جذر موحد
  const snap = await getDocs(query(ref, orderBy('name')));
  ITEMS = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  renderGrid();
}

/* --- فلاتر + رندر الشبكة --- */
[qEl,fCat,fSource,fPhoto,fSort].forEach(el=> el?.addEventListener('input', renderGrid));
btnClear?.addEventListener('click', ()=>{ if(qEl) qEl.value=''; fCat.value=''; fSource.value=''; fPhoto.value=''; fSort.value='name_asc'; renderGrid(); });

function renderGrid(){
  let arr=ITEMS.slice();
  const q = (qEl?.value||'').trim().toLowerCase();
  const cat=fCat?.value||'', src=fSource?.value||'', ph=fPhoto?.value||'', sort=fSort?.value||'name_asc';

  if(q){
    arr=arr.filter(it=>{
      const inName=(it.name||'').toLowerCase().includes(q);
      const inTags=(it.tags||[]).some(t=>t.toLowerCase().includes(q)) || ((q.startsWith('#')) && (it.tags||[]).includes(q));
      return inName||inTags;
    });
  }
  if(cat) arr=arr.filter(it=>it.category===cat);
  if(src) arr=arr.filter(it=>(it.source||'manual')===src);
  if(ph==='with') arr=arr.filter(it=>!!it.imageUrl);
  if(ph==='without') arr=arr.filter(it=>!it.imageUrl);

  arr.sort((a,b)=>{
    if(sort==='name_asc')  return (a.name||'').localeCompare(b.name||'','ar');
    if(sort==='name_desc') return (b.name||'').localeCompare(a.name||'','ar');
    if(sort==='newest')    return (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0);
    if(sort==='oldest')    return (a.createdAt?.seconds||0)-(b.createdAt?.seconds||0);
    return 0;
  });

  if(!arr.length){ setGrid(`<div class="meta">لا توجد أصناف (جرّب تغيير الفلاتر أو أضف صنفًا).</div>`); return; }

  grid.innerHTML='';
  arr.forEach(it=>{
    const kcal = it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g);
    const img  = it.imageUrl || autoImageFor(it.name||'صنف');
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
            <span class="chip">سعرات/100g: ${isNaN(kcal)?'—':kcal}</span>
            <span class="badge src">${esc(it.source||'manual')}</span>
            ${(it.householdUnits?.length>0)?'<span class="badge units">مقادير منزلية</span>':''}
            ${(it.tags?.length>0)?'<span class="badge tags">تاجات</span>':''}
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn qEdit">تعديل</button>
        <button class="btn qCopy">نسخ</button>
        <button class="btn qDel" style="color:#fff;background:#ef4444;border:0">حذف</button>
      </div>

      <div class="meta">${esc((it.tags||[]).join(', '))}</div>
    `;

    card.querySelector('.qEdit').addEventListener('click', ()=> openEdit(it));
    card.querySelector('.qCopy').addEventListener('click', ()=> openCopy(it));
    card.querySelector('.qDel').addEventListener('click', async ()=>{
      if(!confirm(`حذف الصنف «${it.name}»؟`)) return;
      lastDeleted={...it};
      await deleteDoc(doc(db, `foodItems/${it.id}`));
      await safeLoadItems();
      showSnack(`تم حذف «${it.name}»`);
    });

    grid.appendChild(card);
  });
}

/* Snack undo */
function showSnack(t){ snackText.textContent=t; snack.hidden=false; clearTimeout(snackTimer); snackTimer=setTimeout(()=>snack.hidden=true,5000); }
snackUndo?.addEventListener('click', async ()=>{
  snack.hidden=true;
  if(!lastDeleted) return;
  const data={...lastDeleted}; lastDeleted=null;
  try{
    await setDoc(doc(db, `foodItems/${data.id}`), {...data, updatedAt: serverTimestamp()});
  }catch{
    await addDoc(collection(db, `foodItems`), {...data, id: undefined, createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
  }
  await safeLoadItems();
  showSnack('تم التراجع عن الحذف');
});

/* Edit/Copy */
function fillForm(it){
  itemId.value=it.id||''; formTitle.textContent= it.id?'تعديل صنف':'إضافة صنف';
  nameEl.value=it.name||''; brandEl.value=it.brand||''; categoryEl.value=it.category||'';
  carb100El.value=it.carbs_100g ?? ''; prot100El.value=it.protein_100g ?? ''; fat100El.value=it.fat_100g ?? ''; kcal100El.value=it.calories_100g ?? '';
  UNITS=(it.householdUnits||[]).map(u=>({name:u.name, grams:u.grams})); renderUnits();
  imageUrlEl.value=it.imageUrl||''; tagsEl.value=(it.tags||[]).join(', '); notesEl.value=it.notes||''; sourceEl.value=it.source||'manual';
  const c=it.createdAt?.toDate?it.createdAt.toDate():null, u=it.updatedAt?.toDate?it.updatedAt.toDate():null;
  metaText.textContent=`أُنشئ: ${c?c.toLocaleString('ar-EG'):'—'} • آخر تحديث: ${u?u.toLocaleString('ar-EG'):'—'}`;
}
function openEdit(it){ fillForm(it); openDrawer(); }
function openCopy(it){ const x={...it}; delete x.id; x.name=(x.name||'')+' - نسخة'; fillForm(x); openDrawer(); }

/* Save */
form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name=nameEl.value.trim(), category=categoryEl.value, carbs=Number(carb100El.value);
  if(!name||!category||isNaN(carbs)){ alert('الاسم + التصنيف + كارب/100g مطلوبة'); return; }
  if(carbs<0||toNumber(prot100El.value)<0||toNumber(fat100El.value)<0){ alert('القيم ≥ 0'); return; }
  let kcal = kcal100El.value==='' ? calcCalories(carb100El.value, prot100El.value, fat100El.value) : Number(kcal100El.value);
  if(isNaN(kcal)) kcal=0;

  const payload={
    name, brand:brandEl.value.trim()||null, category,
    carbs_100g:+carb100El.value||0, protein_100g:+prot100El.value||0, fat_100g:+fat100El.value||0,
    calories_100g:+kcal||0, householdUnits:UNITS.slice(),
    imageUrl:imageUrlEl.value.trim()||null, tags:normalTags(tagsEl.value), notes:notesEl.value.trim()||null,
    source:sourceEl.value||'manual', updatedAt:serverTimestamp()
  };
  try{
    if(itemId.value){
      await updateDoc(doc(db, `foodItems/${itemId.value}`), payload);
      alert('تم التحديث بنجاح');
    }else{
      await addDoc(collection(db, `foodItems`), {...payload, createdAt:serverTimestamp()});
      alert('تمت الإضافة بنجاح');
    }
    closeDrawer(); await safeLoadItems();
  }catch(err){
    console.error(err); alert('حدث خطأ أثناء الحفظ');
  }
});

/* Units add/remove */
btnAddUnit?.addEventListener('click', ()=>{
  const n=uNameEl.value.trim(), g=Number(uGramsEl.value);
  if(!n||!g||g<=0){ alert('أدخل اسم المقدار والجرام (>0)'); return; }
  UNITS.push({name:n, grams:g}); uNameEl.value=''; uGramsEl.value=''; renderUnits();
});
unitsList?.addEventListener('click', e=>{
  const t=e.target; if(t.classList.contains('x')){ UNITS.splice(Number(t.dataset.i),1); renderUnits(); }
});
btnAutoImage?.addEventListener('click', ()=>{
  if(!nameEl.value.trim()){ alert('أدخل اسم الصنف أولاً'); return; }
  imageUrlEl.value=autoImageFor(nameEl.value.trim());
});

/* Open/Close drawer */
btnAdd?.addEventListener('click', ()=>{ resetForm(); openDrawer(); });
btnClose?.addEventListener('click', closeDrawer);
btnCancel?.addEventListener('click', closeDrawer);
