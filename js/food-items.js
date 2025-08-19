// js/food-items.js  — safe bindings version
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc, query, orderBy,
  serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* --------- tiny helpers --------- */
const $$ = id => document.getElementById(id);
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); }; // آمن
const must = (el, name) => { if(!el) console.warn(`[food-items] عنصر مفقود: #${name}`); return el; };

const grid       = must($$('grid'), 'grid');

const qEl        = $$('#q');
const fCat       = $$('#fCat');
const fSource    = $$('#fSource');
const fPhoto     = $$('#fPhoto');
const fSort      = $$('#fSort');
const btnClear   = $$('#btnClear');

const btnAdd     = $$('#btnAdd');
const togglePick = $$('#togglePickMode');

const drawer     = $$('#drawer');
const btnClose   = $$('#btnClose');
const btnCancel  = $$('#btnCancel');
const formTitle  = $$('#formTitle');

const form       = $$('#itemForm');
const itemId     = $$('#itemId');
const nameEl     = $$('#name');
const brandEl    = $$('#brand');
const categoryEl = $$('#category');

const carb100El  = $$('#carb100');
const prot100El  = $$('#prot100');
const fat100El   = $$('#fat100');
const kcal100El  = $$('#kcal100');

const unitsList  = $$('#unitsList');
const uNameEl    = $$('#uName');
const uGramsEl   = $$('#uGrams');
const btnAddUnit = $$('#btnAddUnit');

const imageUrlEl   = $$('#imageUrl');
const btnAutoImage = $$('#btnAutoImage');

const tagsEl    = $$('#tags');
const notesEl   = $$('#notes');
const sourceEl  = $$('#source');
const metaText  = $$('#metaText');

const snack     = $$('#snack');
const snackText = $$('#snackText');
const snackUndo = $$('#snackUndo');

let UNITS = [], ITEMS = [], USER = null;
let lastDeleted = null, snackTimer = null;
const params = new URLSearchParams(location.search);
const currentChild = params.get('child') || '';

const toNumber = v => (v===''||v==null?0:Number(v));
const calcCalories = (c,p,f)=>Math.round(4*toNumber(c)+4*toNumber(p)+9*toNumber(f));
const fmt = n => (n==null||isNaN(+n)?'—':(+n).toFixed(1));
const esc = s => (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const normalTags = str => !str?[]:str.split(',').map(t=>t.trim()).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).map(t=>t.toLowerCase());
const setGrid = html => { if(grid) grid.innerHTML = html; };

const showLoading = ()=> setGrid(`<div class="meta">جارِ التحميل…</div>`);
const showError = (msg, retryFn)=> {
  setGrid(`
    <div class="card">
      <div style="color:#b91c1c;font-weight:600">تعذر التحميل</div>
      <div class="meta" style="margin:6px 0">${esc(msg)}</div>
      <button class="btn" id="__retry">إعادة المحاولة</button>
    </div>
  `);
  on(document.getElementById('__retry'), 'click', retryFn);
};

function openDrawer(){ drawer?.classList.add('open'); }
function closeDrawer(){ drawer?.classList.remove('open'); resetForm(); }
function resetForm(){
  if(!form) return;
  itemId.value=''; formTitle && (formTitle.textContent='إضافة صنف');
  nameEl.value=''; brandEl.value=''; categoryEl.value='';
  carb100El.value=''; prot100El.value=''; fat100El.value=''; kcal100El.value='';
  UNITS=[]; renderUnits(); imageUrlEl.value=''; tagsEl.value=''; notesEl.value='';
  sourceEl.value='manual'; metaText && (metaText.textContent='—');
}
function renderUnits(){
  if(!unitsList) return;
  unitsList.innerHTML = UNITS.length? '' : '<span class="meta">لا توجد مقادير مضافة.</span>';
  UNITS.forEach((u,i)=>{
    const el=document.createElement('span');
    el.className='unit';
    el.innerHTML=`<strong>${esc(u.name)}</strong> = <span>${esc(u.grams)} g</span> <span class="x" data-i="${i}">✖</span>`;
    unitsList.appendChild(el);
  });
}
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

/* UI bindings (safe) */
on(btnAdd,   'click', ()=>{ resetForm(); openDrawer(); });
on(btnClose, 'click', closeDrawer);
on(btnCancel,'click', closeDrawer);

on(btnAddUnit,'click', ()=>{
  const n=uNameEl.value.trim(), g=Number(uGramsEl.value);
  if(!n||!g||g<=0){ alert('أدخل اسم المقدار والجرام (>0)'); return; }
  UNITS.push({name:n, grams:g}); uNameEl.value=''; uGramsEl.value=''; renderUnits();
});
on(unitsList,'click', e=>{
  const t=e.target; if(t?.classList.contains('x')){ UNITS.splice(Number(t.dataset.i),1); renderUnits(); }
});
on(btnAutoImage,'click', ()=>{
  if(!nameEl.value.trim()){ alert('أدخل اسم الصنف أولاً'); return; }
  imageUrlEl.value=autoImageFor(nameEl.value.trim());
});

if(togglePick){
  togglePick.checked = localStorage.getItem('fi_pickmode')==='1';
  on(togglePick,'change', ()=>{
    localStorage.setItem('fi_pickmode', togglePick.checked?'1':'0');
    renderGrid();
  });
}

[qEl,fCat,fSource,fPhoto,fSort].forEach(el=> on(el,'input', renderGrid));
on(btnClear,'click', ()=>{ if(qEl) qEl.value=''; if(fCat) fCat.value=''; if(fSource) fSource.value=''; if(fPhoto) fPhoto.value=''; if(fSort) fSort.value='name_asc'; renderGrid(); });

/* Auth + load */
showLoading();
let authTimer = setTimeout(()=>{ if(!USER) location.href='index.html'; }, 2000);

onAuthStateChanged(auth, async (user)=>{
  clearTimeout(authTimer);
  if(!user){ location.href='index.html'; return; }
  USER=user;
  await safeLoadItems();
});

async function safeLoadItems(){
  try{ await loadItems(); }
  catch(err){ console.error('[food-items] load error:', err); showError(err.message||'تحقق من الاتصال والصلاحيات.', safeLoadItems); }
}

async function loadItems(){
  showLoading();
  const ref = collection(db, `parents/${USER.uid}/foodItems`);
  const snap = await getDocs(query(ref, orderBy('name')));
  ITEMS = snap.docs.map(d=> ({ id:d.id, ...d.data() })); 
  renderGrid();
}

function renderGrid(){
  if(!grid) return;
  const q   = qEl?.value.trim().toLowerCase() || '';
  const cat = fCat?.value || '';
  const src = fSource?.value || '';
  const ph  = fPhoto?.value || '';
  const sort= fSort?.value || 'name_asc';

  let arr=ITEMS.slice();
  if(q){
    arr=arr.filter(it=>{
      const inName=(it.name||'').toLowerCase().includes(q);
      const inTags=(it.tags||[]).some(t=>t.toLowerCase().includes(q));
      return inName||inTags||q.startsWith('#') && (it.tags||[]).includes(q);
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

  const pickMode = !!(togglePick && togglePick.checked);
  grid.innerHTML='';
  arr.forEach(it=>{
    const kcal = it.calories_100g ?? Math.round(4*(it.carbs_100g||0)+4*(it.protein_100g||0)+9*(it.fat_100g||0));
    const img  = it.imageUrl || autoImageFor(it.name||'صنف');
    const card = document.createElement('div');
    card.className='card';
    card.innerHTML=`
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
      <div class="meta">${esc((it.tags||[]).join(', '))}</div>
    `;

    const qG=card.querySelector('.qG'), qU=card.querySelector('.qU'), qOut=card.querySelector('.qOut');
    card.querySelector('.qCalc').addEventListener('click', ()=>{
      const grams=Number(qU.value||qG.value);
      if(!grams){ qOut.textContent='أدخل وزنًا أو اختر مقدار'; return; }
      const factor=grams/100;
      const carbs=factor*(it.carbs_100g||0);
      const kcal2=factor*(it.calories_100g ?? Math.round(4*(it.carbs_100g||0)+4*(it.protein_100g||0)+9*(it.fat_100g||0)));
      qOut.textContent=`كارب: ${carbs.toFixed(1)}g • سعرات: ${Math.round(kcal2)} kcal`;
    });

    if(pickMode && currentChild){
      card.querySelector('.qSend')?.addEventListener('click', ()=>{
        const grams=Number(qU.value||qG.value);
        if(!grams){ alert('أدخل وزنًا أو اختر مقدار'); return; }
        location.href=`meals.html?child=${encodeURIComponent(currentChild)}&item=${encodeURIComponent(it.id)}&grams=${grams}`;
      });
    }
    card.querySelector('.qEdit').addEventListener('click', ()=> openEdit(it));
    card.querySelector('.qCopy').addEventListener('click', ()=> openCopy(it));
    card.querySelector('.qDel').addEventListener('click', async ()=>{
      if(!confirm(`حذف الصنف «${it.name}»؟`)) return;
      lastDeleted={...it};
      await deleteDoc(doc(db, `parents/${USER.uid}/foodItems/${it.id}`));
      await safeLoadItems();
      showSnack(`تم حذف «${it.name}»`);
    });

    grid.appendChild(card);
  });
}

function showSnack(t){
  if(!snack||!snackText) return;
  snackText.textContent=t; snack.hidden=false;
  clearTimeout(snackTimer); snackTimer=setTimeout(()=>snack.hidden=true,5000);
}
on(snackUndo,'click', async ()=>{
  if(!snack) return;
  snack.hidden=true;
  if(!lastDeleted) return;
  const data={...lastDeleted}; lastDeleted=null;
  try{
    await setDoc(doc(db, `parents/${USER.uid}/foodItems/${data.id}`), {...data, updatedAt: serverTimestamp()});
  }catch{
    await addDoc(collection(db, `parents/${USER.uid}/foodItems`), {...data, id: undefined, createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
  }
  await safeLoadItems(); showSnack('تم التراجع عن الحذف');
});

function fillForm(it){
  if(!form) return;
  itemId.value=it.id||''; if(formTitle) formTitle.textContent= it.id?'تعديل صنف':'إضافة صنف';
  nameEl.value=it.name||''; brandEl.value=it.brand||''; categoryEl.value=it.category||'';
  carb100El.value=it.carbs_100g ?? ''; prot100El.value=it.protein_100g ?? ''; fat100El.value=it.fat_100g ?? ''; kcal100El.value=it.calories_100g ?? '';
  UNITS=(it.householdUnits||[]).map(u=>({name:u.name, grams:u.grams})); renderUnits();
  imageUrlEl.value=it.imageUrl||''; tagsEl.value=(it.tags||[]).join(', '); notesEl.value=it.notes||''; sourceEl.value=it.source||'manual';
  const c=it.createdAt?.toDate?it.createdAt.toDate():null, u=it.updatedAt?.toDate?it.updatedAt.toDate():null;
  if(metaText) metaText.textContent=`أُنشئ: ${c?c.toLocaleString('ar-EG'):'—'} • آخر تحديث: ${u?u.toLocaleString('ar-EG'):'—'}`;
}
function openEdit(it){ fillForm(it); openDrawer(); }
function openCopy(it){ const x={...it}; delete x.id; x.name=(x.name||'')+' - نسخة'; fillForm(x); openDrawer(); }

on(form,'submit', async (e)=>{
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
      await updateDoc(doc(db, `parents/${USER.uid}/foodItems/${itemId.value}`), payload);
      alert('تم التحديث بنجاح');
    }else{
      await addDoc(collection(db, `parents/${USER.uid}/foodItems`), {...payload, createdAt:serverTimestamp()});
      alert('تمت الإضافة بنجاح');
    }
    closeDrawer(); await safeLoadItems();
  }catch(err){ console.error(err); alert('حدث خطأ أثناء الحفظ'); }
});
