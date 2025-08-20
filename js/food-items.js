// js/food-items.js — مكتبة الأصناف (مطوّرة)
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs,
  doc, query, orderBy, serverTimestamp, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* --------- Helpers --------- */
const $$  = id => document.getElementById(id);
const on  = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };
const must= (el, name) => { if(!el) console.warn(`[food-items] عنصر مفقود: #${name}`); return el; };

const grid       = must($$('grid'), 'grid');

const qEl        = $$('#q');
const fCat       = $$('#fCat');
const fSource    = $$('#fSource');
const fPhoto     = $$('#fPhoto');
const fFav       = $$('#fFav');
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
const prot100El  = $$('#prot100'); // ✅ إصلاح
const fat100El   = $$('#fat100');
const kcal100El  = $$('#kcal100');

const unitsList  = $$('#unitsList');
const uNameEl    = $$('#uName');
const uGramsEl   = $$('#uGrams');
const btnAddUnit = $$('#btnAddUnit');

const supplierNameEl = $$('#supplierName');
const supplierUrlEl  = $$('#supplierUrl');

const imageUrlEl   = $$('#imageUrl');
const btnAutoImage = $$('#btnAutoImage');

const offBarcodeEl = $$('#offBarcode');
const btnImportByBarcode = $$('#btnImportByBarcode');
const btnImportByName    = $$('#btnImportByName');

const tagsEl    = $$('#tags');
const notesEl   = $$('#notes');
const favoriteEl= $$('#favorite');
const sourceEl  = $$('#source');
const metaText  = $$('#metaText');

const snack     = $$('#snack');
const snackText = $$('#snackText');
const snackUndo = $$('#snackUndo');

const qrModal   = $$('#qrModal');
const qrClose   = $$('#qrClose');
const qrImage   = $$('#qrImage');
const qrHint    = $$('#qrHint');

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

const ABSORPTION_THRESHOLD = 20; // بروتين/دهون ≥ 20g = بطء امتصاص
const HIGH_CARB = 60; // تحذير كارب عالي
const HIGH_FAT  = 20; // تحذير دهون عالية

/* --------- UI Basics --------- */
function showLoading(){ setGrid(`<div class="meta">جارِ التحميل…</div>`); }
function showError(msg, retryFn){
  setGrid(`
    <div class="card">
      <div style="color:#b91c1c;font-weight:600">تعذر التحميل</div>
      <div class="meta" style="margin:6px 0">${esc(msg)}</div>
      <button class="btn" id="__retry">إعادة المحاولة</button>
    </div>
  `);
  on(document.getElementById('__retry'),'click', retryFn);
}

/* --------- Auth + Load --------- */
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

/* --------- Filters + Sorting + Grid --------- */
if(togglePick){
  togglePick.checked = localStorage.getItem('fi_pickmode')==='1';
  on(togglePick,'change', ()=>{
    localStorage.setItem('fi_pickmode', togglePick.checked?'1':'0');
    renderGrid();
  });
}

[qEl,fCat,fSource,fPhoto,fFav,fSort].forEach(el=> on(el,'input', renderGrid));
on(btnClear,'click', ()=>{
  if(qEl) qEl.value='';
  if(fCat) fCat.value='';
  if(fSource) fSource.value='';
  if(fPhoto) fPhoto.value='';
  if(fFav) fFav.value='';
  if(fSort) fSort.value='name_asc';
  renderGrid();
});

function renderGrid(){
  if(!grid) return;
  const q   = qEl?.value.trim().toLowerCase() || '';
  const cat = fCat?.value || '';
  const src = fSource?.value || '';
  const ph  = fPhoto?.value || '';
  const fav = fFav?.value || '';
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
  if(fav==='only') arr=arr.filter(it=>!!it.favorite);
  if(fav==='none') arr=arr.filter(it=>!it.favorite);

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
  arr.forEach(async it=>{
    const kcal = it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g);
    const img  = it.imageUrl || autoImageFor(it.name||'صنف');

    const slowAbsorp = (toNumber(it.protein_100g) >= ABSORPTION_THRESHOLD || toNumber(it.fat_100g) >= ABSORPTION_THRESHOLD);
    const highCarb   = (toNumber(it.carbs_100g) >= HIGH_CARB);
    const highFat    = (toNumber(it.fat_100g)   >= HIGH_FAT);

    // إحصائيات الاستهلاك (اختيارية لو موجودة في usage)
    let usage = { timesUsed: 0, totalGrams: 0 };
    try{
      const udoc = await getDoc(doc(db, `parents/${USER.uid}/usage/foodItems/${it.id}`));
      if(udoc.exists()){
        const u = udoc.data();
        usage.timesUsed  = u.timesUsed  ?? 0;
        usage.totalGrams = u.totalGrams ?? 0;
      }
    }catch{ /* تجاهل بهدوء */ }

    const card = document.createElement('div');
    card.className='card';
    card.innerHTML=`
      <div class="head">
        <img class="thumb" src="${esc(img)}" onerror="this.src='${autoImageFor(it.name||'صنف')}'" alt="">
        <div>
          <div class="title">${esc(it.name||'—')}</div>
          <div class="meta">${esc(it.brand||'—')} • ${esc(it.category||'—')}</div>
          ${it.supplierName || it.supplierUrl ? `
            <div class="supplier">المورد: ${
              it.supplierUrl ? `<a href="${esc(it.supplierUrl)}" target="_blank" rel="noopener">${esc(it.supplierName||'رابط')}</a>` 
                             : esc(it.supplierName||'—')
            }</div>` : ''
          }
          <div class="chips">
            <span class="chip">كارب/100g: <strong>${fmt(it.carbs_100g)}</strong></span>
            <span class="chip">بروتين/100g: ${fmt(it.protein_100g)}</span>
            <span class="chip">دهون/100g: ${fmt(it.fat_100g)}</span>
            <span class="chip">سعرات/100g: ${isNaN(kcal)?'—':kcal}</span>
            ${highCarb ? '<span class="badge warn">⚠ كارب مرتفع</span>' : ''}
            ${highFat  ? '<span class="badge warn">⚠ دهون مرتفعة</span>' : ''}
            ${slowAbsorp ? '<span class="badge danger">⚠ بطء امتصاص</span>' : '<span class="badge ok">✓ امتصاص عادي</span>'}
            <span class="badge">${esc(it.source||'manual')}</span>
            ${(it.householdUnits?.length>0)?'<span class="badge">مقادير منزلية</span>':''}
            ${(it.tags?.length>0)?'<span class="badge">تاجات</span>':''}
          </div>
        </div>
      </div>

      <div class="chips" style="margin-top:6px">
        <span class="chip">الاستخدام: ${usage.timesUsed} مرة</span>
        <span class="chip">الإجمالي: ${usage.totalGrams} g</span>
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
        <button class="btn star ${it.favorite?'active':''} qFav">${it.favorite?'⭐ مفضل':'☆ مفضلة'}</button>
        <button class="btn qQR">QR</button>
        ${pickMode && currentChild ? `<button class="btn primary qSend">استخدام داخل الوجبات</button>`:''}
        <button class="btn qEdit">تعديل</button>
        <button class="btn qCopy">نسخ</button>
        <button class="btn qDel">حذف</button>
      </div>

      <div class="meta">${esc((it.tags||[]).join(', '))}</div>
    `;

    // الحساب السريع
    const qG=card.querySelector('.qG'), qU=card.querySelector('.qU'), qOut=card.querySelector('.qOut');
    card.querySelector('.qCalc')?.addEventListener('click', ()=>{
      const grams=Number(qU.value||qG.value);
      if(!grams){ qOut.textContent='أدخل وزنًا أو اختر مقدار'; return; }
      const factor=grams/100;
      const carbs=factor*(it.carbs_100g||0);
      const kcal2=factor*(it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g));
      qOut.textContent=`كارب: ${carbs.toFixed(1)}g • سعرات: ${Math.round(kcal2)} kcal`;
    });

    // استخدام داخل الوجبات
    if(pickMode && currentChild){
      card.querySelector('.qSend')?.addEventListener('click', ()=>{
        const grams=Number(qU.value||qG.value);
        if(!grams){ alert('أدخل وزنًا أو اختر مقدار'); return; }
        location.href=`meals.html?child=${encodeURIComponent(currentChild)}&item=${encodeURIComponent(it.id)}&grams=${grams}`;
      });
    }

    // مفضلة
    card.querySelector('.qFav')?.addEventListener('click', async ()=>{
      const nowFav = !it.favorite;
      try{
        await updateDoc(doc(db, `parents/${USER.uid}/foodItems/${it.id}`), { favorite: nowFav, updatedAt: serverTimestamp() });
        it.favorite = nowFav;
        renderGrid();
      }catch(e){ alert('تعذر تحديث المفضلة'); }
    });

    // QR
    card.querySelector('.qQR')?.addEventListener('click', ()=>{
      openQR(it);
    });

    // إجراءات
    card.querySelector('.qEdit')?.addEventListener('click', ()=> openEdit(it));
    card.querySelector('.qCopy')?.addEventListener('click', ()=> openCopy(it));
    card.querySelector('.qDel')?.addEventListener('click', async ()=>{
      if(!confirm(`حذف الصنف «${it.name}»؟`)) return;
      lastDeleted={...it};
      await deleteDoc(doc(db, `parents/${USER.uid}/foodItems/${it.id}`));
      await safeLoadItems();
      showSnack(`تم حذف «${it.name}»`);
    });

    grid.appendChild(card);
  });
}

/* --------- Drawer & Form --------- */
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

function resetForm(){
  if(!form) return;
  itemId.value=''; if(formTitle) formTitle.textContent='إضافة صنف';
  nameEl.value=''; brandEl.value=''; categoryEl.value='';
  carb100El.value=''; prot100El.value=''; fat100El.value=''; kcal100El.value='';
  UNITS=[]; renderUnits();
  imageUrlEl.value=''; tagsEl.value=''; notesEl.value='';
  supplierNameEl.value=''; supplierUrlEl.value='';
  favoriteEl.checked=false;
  sourceEl.value='manual'; if(metaText) metaText.textContent='—';
  checkAbsorptionDelay();
}
function openDrawer(){ drawer?.classList.add('open'); }
function closeDrawer(){ drawer?.classList.remove('open'); resetForm(); }

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

function fillForm(it){
  if(!form) return;
  itemId.value=it.id||''; if(formTitle) formTitle.textContent= it.id?'تعديل صنف':'إضافة صنف';
  nameEl.value=it.name||''; brandEl.value=it.brand||''; categoryEl.value=it.category||'';
  carb100El.value=it.carbs_100g ?? ''; prot100El.value=it.protein_100g ?? ''; fat100El.value=it.fat_100g ?? ''; kcal100El.value=it.calories_100g ?? '';
  UNITS=(it.householdUnits||[]).map(u=>({name:u.name, grams:u.grams})); renderUnits();
  imageUrlEl.value=it.imageUrl||''; tagsEl.value=(it.tags||[]).join(', '); notesEl.value=it.notes||'';
  supplierNameEl.value=it.supplierName||''; supplierUrlEl.value=it.supplierUrl||'';
  favoriteEl.checked=!!it.favorite;
  sourceEl.value=it.source||'manual';
  const c=it.createdAt?.toDate?it.createdAt.toDate():null, u=it.updatedAt?.toDate?it.updatedAt.toDate():null;
  if(metaText) metaText.textContent=`أُنشئ: ${c?c.toLocaleString('ar-EG'):'—'} • آخر تحديث: ${u?u.toLocaleString('ar-EG'):'—'}`;
  checkAbsorptionDelay();
}
function openEdit(it){ fillForm(it); openDrawer(); }
function openCopy(it){ const x={...it}; delete x.id; x.name=(x.name||'')+' - نسخة'; fillForm(x); openDrawer(); }

/* --------- Bindings --------- */
on(btnAdd,'click', ()=>{ resetForm(); openDrawer(); });
on(btnClose,'click', closeDrawer);
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

on(prot100El,'input', checkAbsorptionDelay);
on(fat100El,'input', checkAbsorptionDelay);

/* --------- OpenFoodFacts Import --------- */
on(btnImportByBarcode,'click', async ()=>{
  const code = (offBarcodeEl?.value||'').trim();
  if(!code){ alert('ادخل الباركود'); return; }
  await importOFF({ barcode: code });
});
on(btnImportByName,'click', async ()=>{
  const q = nameEl.value.trim();
  if(!q){ alert('اكتب اسمًا للبحث'); return; }
  await importOFF({ name: q });
});

async function importOFF({ barcode, name }){
  try{
    let data=null;
    if(barcode){
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
      const j = await r.json();
      if(j?.product){ data=j.product; }
    }else if(name){
      const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=1`);
      const j = await r.json();
      if(j?.products?.length) data=j.products[0];
    }
    if(!data){ alert('لم يتم العثور على بيانات'); return; }

    // تعيين حقول
    nameEl.value       = nameEl.value || (data.product_name_ar || data.product_name || nameEl.value);
    brandEl.value      = brandEl.value || (data.brands || '');
    imageUrlEl.value   = imageUrlEl.value || (data.image_url || data.image_front_url || '');
    sourceEl.value     = 'openfoodfacts';

    const n = data.nutriments || {};
    carb100El.value = n.carbohydrates_100g ?? carb100El.value;
    prot100El.value = n.proteins_100g      ?? prot100El.value;
    fat100El.value  = n.fat_100g           ?? fat100El.value;
    kcal100El.value = n['energy-kcal_100g'] ?? n.energy_kcal ?? kcal100El.value;

    checkAbsorptionDelay();
    alert('تم الاستيراد من OpenFoodFacts');
  }catch(e){
    console.error(e); alert('فشل الاستيراد من OpenFoodFacts');
  }
}

/* --------- Absorption hint --------- */
function checkAbsorptionDelay(){
  const prot = toNumber(prot100El?.value);
  const fat  = toNumber(fat100El?.value);
  const hintEl = $$('#absorptionHint');
  if(!hintEl) return;
  if(prot >= ABSORPTION_THRESHOLD || fat >= ABSORPTION_THRESHOLD){
    hintEl.textContent='⚠ هذه الوجبة قد تكون بطيئة الامتصاص بسبب الدهون أو البروتين المرتفع';
  }else{
    hintEl.textContent='';
  }
}

/* --------- QR --------- */
function openQR(it){
  const payload = {
    type: 'foodItem',
    id: it.id,
    name: it.name,
    grams: 100
  };
  // خدمة QR مجانية (بدون تبعية): ترميز نص JSON صغير
  const data = encodeURIComponent(JSON.stringify(payload));
  const src  = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${data}`;
  if(qrImage) qrImage.src = src;
  if(qrHint)  qrHint.textContent = `امسح QR لإضافة «${it.name}» بسرعة (يُستخدم داخل الوجبات).`;
  qrModal?.classList.remove('hidden');
}
on(qrClose,'click', ()=> qrModal?.classList.add('hidden'));
on(qrModal,'click', (e)=>{ if(e.target===qrModal) qrModal.classList.add('hidden'); });

/* --------- Submit + Snackbar/Undo --------- */
on(form,'submit', async (e)=>{
  e.preventDefault();
  const name=nameEl.value.trim(), category=categoryEl.value, carbs=Number(carb100El.value);
  if(!name||!category||isNaN(carbs)){ alert('الاسم + التصنيف + كارب/100g مطلوبة'); return; }
  if(carbs<0||toNumber(prot100El.value)<0||toNumber(fat100El.value)<0){ alert('القيم ≥ 0'); return; }

  let kcal = (kcal100El.value === '')
    ? calcCalories(carb100El.value, prot100El.value, fat100El.value)
    : Number(kcal100El.value);
  if(isNaN(kcal)) kcal=0;

  const payload={
    name,
    brand:brandEl.value.trim()||null, category,
    carbs_100g:+carb100El.value||0, protein_100g:+prot100El.value||0, fat_100g:+fat100El.value||0,
    calories_100g:+kcal||0, householdUnits:UNITS.slice(),
    imageUrl:imageUrlEl.value.trim()||null, tags:normalTags(tagsEl.value), notes:notesEl.value.trim()||null,
    supplierName: supplierNameEl.value.trim() || null,
    supplierUrl:  supplierUrlEl.value.trim()  || null,
    favorite: !!favoriteEl.checked,
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
