// food-items (1).js
import { auth, db } from './firebase-config.js';
import {
  collection, updateDoc, deleteDoc, getDocs, doc, query, orderBy,
  serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* DOM */
const $=(id)=>document.getElementById(id);
const qEl=$('q'), fCat=$('fCat'), grid=$('grid'), btnNew=$('btnNew');

const form=$('form'), formTitle=$('formTitle');
const itemId=$('itemId'), currentImageUrl=$('currentImageUrl');
const nameEl=$('name'), categoryEl=$('category'), brandEl=$('brand'), unitEl=$('unit');

/* القيم الغذائية لكل 100 جم */
const carb100El=$('carb100'), fiber100El=$('fiber100'), prot100El=$('prot100'), fat100El=$('fat100'), kcal100El=$('kcal100'), giEl=$('gi');

/* المقادير */
const measuresTextEl=$('measuresText');
const measureNameEl=$('measureName');
const measureWeightEl=$('measureWeight');
const btnAddMeasure=$('btnAddMeasure');
const measuresWrap=$('measuresWrap');

/* صورة */
const imgFileEl=$('imgFile'), imgPrev=$('imgPrev'), imgProg=$('imgProg');
const btnPick=$('btnPick'), btnRemoveImg=$('btnRemoveImg');
const btnReset=$('btnReset'), btnDelete=$('btnDelete');

let ITEMS=[], SELECTED_FILE=null, REMOVE_IMAGE=false;
const MAX_IMAGE_MB=3;

/* حالة محلية لوزن المقادير */
let MEASURES={}; // { "كوب": 200, ... }

/* Utils */
const esc=(s)=> (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const num=(v)=>{ const n=Number(v); return Number.isFinite(n)?n:null; };
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

/* حسابات GL */
function calcGLFor100g(nutr, gi){
  const carbs = +nutr?.carbs_g || 0;
  const fiber = +nutr?.fiber_g || 0;
  const net   = Math.max(0, carbs - fiber);
  if (!gi || !net) return null;
  return +( (gi * net) / 100 ).toFixed(1);
}
function calcGLForPortion(nutr, gi, grams){
  const carbs = +nutr?.carbs_g || 0;
  const fiber = +nutr?.fiber_g || 0;
  const net100 = Math.max(0, carbs - fiber);
  if (!gi || !net100 || !grams) return null;
  const netPortion = (net100 * grams) / 100; // صافي الكارب في المقدار
  return +( (gi * netPortion) / 100 ).toFixed(1);
}

/* Auth + load */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  await loadItems();
});

/* Load items */
async function loadItems(){
  const col = collection(db,'admin','global','foodItems');
  let snap; try{ snap = await getDocs(query(col, orderBy('name'))); } catch { snap = await getDocs(col); }
  ITEMS = snap.docs.map(d=>({id:d.id, ...d.data()}));
  fillCats();
  renderGrid();
}

/* Filters */
function fillCats(){
  const cats = Array.from(new Set(ITEMS.map(i=> (i.category||'').trim()).filter(Boolean))).sort();
  fCat.innerHTML = `<option value="">كل الفئات</option>` + cats.map(c=> `<option>${esc(c)}</option>`).join('');
}
qEl.addEventListener('input', renderGrid);
fCat.addEventListener('change', renderGrid);

/* Grid */
function renderGrid(){
  const term=(qEl?.value||'').trim().toLowerCase();
  const cat=(fCat?.value||'').trim().toLowerCase();
  const list=ITEMS.filter(it=>{
    const okCat = !cat || (it.category||'').toLowerCase()===cat;
    const okTxt = !term || [it.name,it.category,it.brand].map(x=>(x||'').toLowerCase()).join(' ').includes(term);
    return okCat && okTxt;
  });
  if(!list.length){ grid.innerHTML='<div class="meta">لا توجد نتائج.</div>'; return; }
  grid.innerHTML='';
  list.forEach(it=>{
    const img = it.imageUrl || autoImg(it.name);
    const n   = it.nutrPer100g || {};
    const gi  = +it.gi || 0;

    // ✅ GL/100g
    const gl100 = calcGLFor100g(n, gi);

    // ✅ مثال GL لأول مقدار إن وُجد
    const measMap = it.measureQty || it.measures || null;
    let measLine = '';
    if (measMap && Object.keys(measMap).length){
      const k = Object.keys(measMap)[0];
      const grams = +measMap[k] || 0;
      const glPort = calcGLForPortion(n, gi, grams);
      measLine = `<div class="meta">مقدار: ${esc(k)} = ${grams} جم${glPort!=null ? ` — GL≈<strong>${glPort}</strong>`:''}</div>`;
    }

    const card=document.createElement('div');
    card.className='item';
    card.innerHTML=`
      <div style="display:flex;gap:10px;align-items:center">
        <div class="imgbox"><img src="${esc(img)}" alt=""></div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <strong>${esc(it.name||'-')}</strong>
            <span class="meta">${esc(it.category||'-')}</span>
          </div>
          <div class="meta">${esc(it.brand||'')}</div>
          <div class="meta">القيم لكل 100 جم — كارب: ${n?.carbs_g ?? '—'}غ | ألياف: ${n?.fiber_g ?? '—'}غ | بروتين: ${n?.protein_g ?? '—'}غ | دهون: ${n?.fat_g ?? '—'}غ | سعرات: ${n?.cal_kcal ?? '—'} كال</div>
          <div class="meta">GI: ${gi || '—'}${gl100!=null ? ` — GL/100جم≈<span class="badge">${gl100}</span>`:''}</div>
          ${measLine}
          ${(it.measuresText? `<div class="meta">ملاحظات المقادير: ${esc(it.measuresText)}</div>`:'')}
          <div style="margin-top:8px;display:flex;gap:8px">
            <button class="btn" data-edit>تعديل</button>
            <button class="btn danger" data-del>حذف</button>
          </div>
        </div>
      </div>
    `;
    card.querySelector('[data-edit]').onclick=()=> openEdit(it);
    card.querySelector('[data-del]').onclick=async()=>{
      if(!confirm(`حذف «${it.name}»؟`)) return;
      await deleteDoc(doc(db,'admin','global','foodItems', it.id));
      await loadItems();
    };
    grid.appendChild(card);
  });
}

/* New / Edit */
btnNew.addEventListener('click', openNew);
function openNew(){
  formTitle.textContent='إضافة صنف';
  itemId.value=''; currentImageUrl.value='';
  nameEl.value=''; categoryEl.value=''; brandEl.value=''; unitEl.value='g';
  carb100El.value=''; fiber100El.value=''; prot100El.value=''; fat100El.value=''; kcal100El.value=''; giEl.value='';

  measuresTextEl && (measuresTextEl.value='');
  MEASURES={}; renderMeasuresChips();

  SELECTED_FILE=null; REMOVE_IMAGE=false; imgFileEl.value=''; imgProg.classList.add('hidden'); imgProg.value=0;
  imgPrev.src = autoImg();
  window.scrollTo({top:0,behavior:'smooth'});
}
function openEdit(it){
  formTitle.textContent='تعديل صنف';
  itemId.value=it.id; currentImageUrl.value=it.imageUrl||'';
  nameEl.value=it.name||''; categoryEl.value=it.category||''; brandEl.value=it.brand||''; unitEl.value=it.unit||'g';

  const n=it.nutrPer100g||{};
  carb100El.value=n.carbs_g??''; fiber100El.value=n.fiber_g??''; prot100El.value=n.protein_g??''; fat100El.value=n.fat_g??''; kcal100El.value=n.cal_kcal??'';
  giEl.value=it.gi??'';

  measuresTextEl && (measuresTextEl.value = it.measuresText || '');
  MEASURES = {...(it.measureQty || it.measures || {})};
  renderMeasuresChips();

  SELECTED_FILE=null; REMOVE_IMAGE=false; imgFileEl.value=''; imgProg.classList.add('hidden'); imgProg.value=0;
  imgPrev.src = it.imageUrl || autoImg(it.name);
  window.scrollTo({top:0,behavior:'smooth'});
}

/* Image handlers */
btnPick && btnPick.addEventListener('click', ()=> imgFileEl.click());
imgFileEl && imgFileEl.addEventListener('change', ()=>{
  const f = imgFileEl.files?.[0]||null;
  if (f){
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) { alert('صيغة غير مدعومة'); imgFileEl.value=''; return; }
    if (f.size > MAX_IMAGE_MB*1024*1024){ alert(`الحد الأقصى ${MAX_IMAGE_MB}MB`); imgFileEl.value=''; return; }
  }
  SELECTED_FILE=f; REMOVE_IMAGE=false;
  imgPrev.src = f ? URL.createObjectURL(f) : (currentImageUrl.value || autoImg(nameEl.value||'صنف'));
});
btnRemoveImg && btnRemoveImg.addEventListener('click', ()=>{
  SELECTED_FILE=null; REMOVE_IMAGE=true; imgFileEl.value='';
  imgPrev.src = autoImg(nameEl.value||'صنف');
});

/* Upload helpers */
async function uploadImage(itemId, file){
  const storage=getStorage();
  const path=`foodItems/${itemId}/${Date.now()}_${file.name}`.replace(/\s+/g,'_');
  const r=ref(storage, path);
  const task=uploadBytesResumable(r, file);
  return await new Promise((resolve,reject)=>{
    imgProg.classList.remove('hidden'); imgProg.value=0;
    task.on('state_changed', s=> imgProg.value=Math.round(100*s.bytesTransferred/s.totalBytes), reject, async()=>{
      imgProg.classList.add('hidden');
      resolve(await getDownloadURL(task.snapshot.ref));
    });
  });
}
async function deleteImage(url){
  if(!url) return;
  try{
    const storage=getStorage();
    const r=ref(storage, url);
    await deleteObject(r);
  }catch(e){/* ignore */}
}

/* المقادير: chips */
function renderMeasuresChips(){
  if(!measuresWrap) return;
  const entries = Object.entries(MEASURES);
  if(!entries.length){ measuresWrap.innerHTML='<span class="meta">لا توجد مقادير معرفة.</span>'; return; }
  measuresWrap.innerHTML = entries.map(([label,grams])=>(
    `<span class="unit" data-k="${esc(label)}">${esc(label)} = ${grams} جم <span class="x" title="حذف">×</span></span>`
  )).join('');
  measuresWrap.querySelectorAll('.unit .x').forEach(x=>{
    x.addEventListener('click', ()=>{
      const chip = x.closest('.unit');
      const k = chip?.getAttribute('data-k');
      if(k && (k in MEASURES)){ delete MEASURES[k]; renderMeasuresChips(); }
    });
  });
}
btnAddMeasure && btnAddMeasure.addEventListener('click', ()=>{
  const label=(measureNameEl?.value||'').trim();
  const grams=num(measureWeightEl?.value);
  if(!label){ alert('اكتب اسم المقدار (مثل: كوب)'); return; }
  if(!(grams>0)){ alert('اكتب وزن المقدار بالجرام (رقم موجب)'); return; }
  MEASURES[label]=grams;
  measureNameEl.value=''; measureWeightEl.value='';
  renderMeasuresChips();
});

/* Save */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!nameEl.value.trim()){ alert('الاسم مطلوب'); return; }

  const col = collection(db,'admin','global','foodItems');
  const base = {
    name: nameEl.value.trim(),
    nameLower: nameEl.value.trim().toLowerCase(),
    category: (categoryEl.value||'').trim() || null,
    brand: (brandEl.value||'').trim() || null,
    unit: unitEl.value || 'g',
    gi: num(giEl.value),
    nutrPer100g:{
      carbs_g:   num(carb100El.value) ?? 0,
      fiber_g:   num(fiber100El.value) ?? 0,
      protein_g: num(prot100El.value) ?? 0,
      fat_g:     num(fat100El.value)  ?? 0,
      cal_kcal:  num(kcal100El.value) ?? Math.round(4*(+carb100El.value||0)+4*(+prot100El.value||0)+9*(+fat100El.value||0))
    },
    measuresText: (measuresTextEl?.value || '').trim() || null,
    measureQty: Object.keys(MEASURES).length ? MEASURES : null,
    updatedAt: serverTimestamp()
  };

  try{
    let id=itemId.value;
    if (!id){
      const refId = doc(col); id = refId.id;
      let imageUrl = currentImageUrl.value || null;
      if (SELECTED_FILE) imageUrl = await uploadImage(id, SELECTED_FILE);
      else if (REMOVE_IMAGE) imageUrl = null;
      await setDoc(refId, { ...base, imageUrl, createdAt: serverTimestamp() }, { merge:true });
      itemId.value=id;
    } else {
      let imageUrl = currentImageUrl.value || null;
      if (REMOVE_IMAGE && currentImageUrl.value){ await deleteImage(currentImageUrl.value); imageUrl = null; }
      if (SELECTED_FILE){
        const newUrl = await uploadImage(id, SELECTED_FILE);
        if (currentImageUrl.value) await deleteImage(currentImageUrl.value);
        imageUrl = newUrl;
      }
      await updateDoc(doc(col, id), { ...base, imageUrl });
    }

    SELECTED_FILE=null; REMOVE_IMAGE=false; currentImageUrl.value='';
    await loadItems();
    openNew();
    alert('تم الحفظ ✅');
  }catch(err){
    console.error(err);
    alert('تعذّر الحفظ: '+(err.message||''));
  }
});

/* Reset & Delete */
btnReset.addEventListener('click', openNew);
btnDelete.addEventListener('click', async ()=>{
  const id=itemId.value; if(!id){ alert('اختر صنفًا أولاً'); return; }
  if(!confirm('حذف الصنف؟')) return;
  await deleteDoc(doc(db,'admin','global','foodItems', id));
  await loadItems(); openNew();
});
