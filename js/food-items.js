// js/food-items.js — Admin catalog, schema compatible with meals v7
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc, query, orderBy,
  serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* DOM */
const $ = (id)=>document.getElementById(id);
const qEl=$('q'), fCat=$('fCat'), grid=$('grid');
const btnNew=$('btnNew');

const form=$('form'), formTitle=$('formTitle');
const itemId=$('itemId'), nameEl=$('name'), categoryEl=$('category'), brandEl=$('brand'), imageUrlEl=$('imageUrl');
const carb100El=$('carb100'), fiber100El=$('fiber100'), prot100El=$('prot100'), fat100El=$('fat100'), kcal100El=$('kcal100');
const unitsList=$('unitsList'), uNameEl=$('uName'), uGramsEl=$('uGrams'), btnAddUnit=$('btnAddUnit');
const tagsEl=$('tags'), sourceEl=$('source');
const btnSave=$('btnSave'), btnReset=$('btnReset'), btnDelete=$('btnDelete');

const snack=$('snack'), snackText=$('snackText');

/* State */
let USER=null;
let ITEMS=[];
let UNITS=[];   // [{name, grams}]
let lastDeleted=null;

/* Utils */
const esc=s=>(s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=n=>(n==null||isNaN(+n)?'—':(+n).toFixed(1));
const kcalOf=(c,p,f)=>Math.round(4*(+c||0)+4*(+p||0)+9*(+f||0));
const normTags=(str)=>!str?[]:str.split(',').map(t=>t.trim()).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).map(t=>t.toLowerCase());

function showSnack(text){ snackText.textContent=text; snack.classList.remove('hidden'); setTimeout(()=>snack.classList.add('hidden'),3500); }

/* Auth + load */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER=user;
  await loadItems();
});

/* Load items from admin/global/foodItems */
async function loadItems(){
  grid.textContent='جارِ التحميل…';
  const ref=collection(db,'admin','global','foodItems');
  // بعض المستندات قد لا تملك nameLower، فنعتمد على name
  let snap;
  try{
    snap=await getDocs(query(ref, orderBy('name')));
  }catch{
    snap=await getDocs(ref);
  }
  ITEMS=snap.docs.map(d=>({id:d.id,...d.data()}));
  renderGrid();
}

/* Units UI */
function renderUnits(){
  unitsList.innerHTML= UNITS.length? '' : '<span class="meta">لا توجد مقادير.</span>';
  UNITS.forEach((u,i)=>{
    const el=document.createElement('span');
    el.className='unit';
    el.innerHTML=`<strong>${esc(u.name)}</strong> = ${esc(u.grams)} g <span class="x" data-i="${i}">✖</span>`;
    unitsList.appendChild(el);
  });
}
btnAddUnit.addEventListener('click',()=>{
  const n=uNameEl.value.trim(), g=Number(uGramsEl.value);
  if(!n||!g||g<=0){ alert('أدخل اسم المقدار والجرامات (>0)'); return; }
  UNITS.push({name:n,grams:g}); uNameEl.value=''; uGramsEl.value=''; renderUnits();
});
unitsList.addEventListener('click',e=>{
  const t=e.target; if(t.classList.contains('x')){ UNITS.splice(Number(t.dataset.i),1); renderUnits(); }
});

/* New / Reset / Delete */
btnNew.addEventListener('click',()=> openNew());
btnReset.addEventListener('click',()=> openNew());
btnDelete.addEventListener('click', async ()=>{
  if(!itemId.value) return;
  if(!confirm('حذف هذا الصنف؟')) return;
  const it=ITEMS.find(x=>x.id===itemId.value)||null;
  await deleteDoc(doc(db,'admin','global','foodItems', itemId.value));
  lastDeleted=it;
  await loadItems();
  openNew();
  showSnack('تم الحذف');
});
function openNew(){
  form.reset(); itemId.value='';
  UNITS=[]; renderUnits();
  formTitle.textContent='إضافة صنف';
}

/* Save (create/update) — schema compatible with meals */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const name=nameEl.value.trim();
  const category=categoryEl.value;
  if(!name || !category){ alert('الاسم والتصنيف مطلوبان'); return; }

  const carbs=Number(carb100El.value);
  if(isNaN(carbs)||carbs<0){ alert('قيمة الكارب لكل 100g مطلوبة وصحيحة'); return; }

  const fiber=Number(fiber100El.value||0);
  const protein=Number(prot100El.value||0);
  const fat=Number(fat100El.value||0);
  let kcal = kcal100El.value==='' ? kcalOf(carbs,protein,fat) : Number(kcal100El.value||0);

  const docData={
    name,
    nameLower: name.toLowerCase(),
    brand: (brandEl.value||'').trim()||null,
    category,
    imageUrl: (imageUrlEl.value||'').trim()||null,
    tags: normTags(tagsEl.value),
    source: (sourceEl.value||'').trim()||'manual',

    // 🔴 هذا هو الشكل الذي تتوقعه صفحة الوجبات v7
    nutrPer100g:{
      carbs_g:   +carbs || 0,
      fiber_g:   +fiber || 0,
      protein_g: +protein || 0,
      fat_g:     +fat || 0,
      cal_kcal:  +kcal || 0
    },
    measures: UNITS.map(u=>({name:u.name, grams:+u.grams})),

    updatedAt: serverTimestamp()
  };

  const ref=collection(db,'admin','global','foodItems');
  try{
    if(itemId.value){
      await updateDoc(doc(ref,itemId.value), docData);
      showSnack('تم التحديث ✅');
    }else{
      await addDoc(ref, {...docData, createdAt: serverTimestamp()});
      showSnack('تمت الإضافة ✅');
    }
    await loadItems();
    openNew();
  }catch(err){
    console.error(err);
    alert('تعذر الحفظ — تأكد من صلاحيات الأدمن وقواعد Firestore');
  }
});

/* Grid + Search */
[qEl,fCat].forEach(el=> el?.addEventListener('input', renderGrid));

function renderGrid(){
  if(!ITEMS.length){ grid.innerHTML='<div class="meta" style="padding:12px">لا توجد أصناف.</div>'; return; }

  const q=(qEl.value||'').trim().toLowerCase();
  const cat=fCat.value||'';
  let arr=ITEMS.slice();

  if(q){
    arr=arr.filter(it=>{
      const inName=(it.name||'').toLowerCase().includes(q);
      const inTags=(it.tags||[]).some(t=>(t||'').toLowerCase().includes(q));
      return inName || inTags || (q.startsWith('#') && (it.tags||[]).includes(q));
    });
  }
  if(cat){ arr=arr.filter(it=>it.category===cat); }

  if(!arr.length){ grid.innerHTML='<div class="meta" style="padding:12px">لا نتائج مطابقة.</div>'; return; }

  grid.innerHTML='';
  arr.forEach(it=>{
    const img = it.imageUrl || autoImg(it.name||'صنف');
    const n = it.nutrPer100g||{};
    const card=document.createElement('div');
    card.className='item';
    card.innerHTML=`
      <div class="head">
        <img class="thumb" src="${esc(img)}" alt="">
        <div>
          <div class="title">${esc(it.name||'—')}</div>
          <div class="meta">${esc(it.brand||'—')} • ${esc(it.category||'—')}</div>
        </div>
      </div>
      <div class="chips">
        <span class="chip">كارب/100g: <strong>${fmt(n.carbs_g)}</strong></span>
        <span class="chip">ألياف/100g: ${fmt(n.fiber_g)}</span>
        <span class="chip">بروتين/100g: ${fmt(n.protein_g)}</span>
        <span class="chip">دهون/100g: ${fmt(n.fat_g)}</span>
        <span class="chip">سعرات/100g: ${fmt(n.cal_kcal)}</span>
        ${(it.measures?.length?`<span class="chip">مقادير: ${it.measures.length}</span>`:'')}
      </div>
      <div class="row two" style="margin-top:8px">
        <button class="btn" data-act="edit">تعديل</button>
        <button class="btn danger" data-act="del">حذف</button>
      </div>
    `;

    card.querySelector('[data-act="edit"]').addEventListener('click',()=> openEdit(it));
    card.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
      if(!confirm(`حذف «${it.name}»؟`)) return;
      await deleteDoc(doc(db,'admin','global','foodItems', it.id));
      lastDeleted=it;
      await loadItems();
      showSnack('تم الحذف');
    });

    grid.appendChild(card);
  });
}

/* Edit / Copy helpers */
function openEdit(it){
  formTitle.textContent='تعديل صنف';
  itemId.value=it.id||'';
  nameEl.value=it.name||'';
  categoryEl.value=it.category||'';
  brandEl.value=it.brand||'';
  imageUrlEl.value=it.imageUrl||'';

  const n=it.nutrPer100g||{};
  carb100El.value = n.carbs_g ?? '';
  fiber100El.value= n.fiber_g ?? '';
  prot100El.value = n.protein_g ?? '';
  fat100El.value  = n.fat_g ?? '';
  kcal100El.value = n.cal_kcal ?? '';

  UNITS=(it.measures||[]).map(u=>({name:u.name, grams:u.grams}));
  renderUnits();

  tagsEl.value=(it.tags||[]).join(', ');
  sourceEl.value=it.source||'';
  window.scrollTo({top:0,behavior:'smooth'});
}

/* Fallback image */
function autoImg(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <rect width="100%" height="100%" fill="hsl(${hue} 80% 90%)"/>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
        font-family="Segoe UI" font-size="54" fill="hsl(${hue} 60% 35%)">${esc((name||'ص')[0])}</text>
    </svg>`
  );
}
