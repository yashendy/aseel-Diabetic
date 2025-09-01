// food-items.js — صفحة إدارة الأصناف (Admin)
// الهدف في هذا التعديل: عند الحفظ نخزّن المقاييس بصيغتين:
// 1) measureQty كـ Map { label: grams } (متوافق مع الموجود حالياً)
// 2) measures كـ Array [{name, grams}] (لتكون صفحة الوجبات قادرة تقرأها مباشرة)

// يفترض وجود firebase-config.js يجهّز auth و db
import { auth, db } from './firebase-config.js';
import {
  collection, updateDoc, deleteDoc, getDocs, doc, query, orderBy,
  serverTimestamp, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* DOM helpers (نفس العناصر الموجودة عندك) */
const $=(id)=>document.getElementById(id);
const qEl=$('q'), fCat=$('fCat'), grid=$('grid'), btnNew=$('btnNew');
const form=$('form'), dlg=$('dlg');
const nameEl=$('name'), brandEl=$('brand'), categoryEl=$('category'), imgEl=$('img');
const carbsEl=$('carbs'), fiberEl=$('fiber'), protEl=$('prot'), fatEl=$('fat'), calEl=$('cal');
const giEl=$('gi');
const measList=$('measList'), measNameEl=$('measName'), measGramsEl=$('measGrams'), btnAddMeas=$('btnAddMeas');
const btnSave=$('btnSave'), btnReset=$('btnReset'), btnDelete=$('btnDelete');

let ITEMS=[], SELECTED_FILE=null, REMOVE_IMAGE=false;
const MAX_IMAGE_MB=3;

/* حالة المقادير المحلية: { label: grams } */
let MEASURES={};

/* Utilities */
const esc=(s)=> (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const num=(v)=>{ const n=Number(v); return Number.isFinite(n)?n:null; };
function autoImg(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
      <defs><linearGradient id="g" x1="0" x2="1">
        <stop offset="0" stop-color="hsl(${hue},70%,90%)"/><stop offset="1" stop-color="hsl(${(hue+40)%360},70%,85%)"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <text x="50%" y="54%" font-family="Segoe UI,Tahoma" font-size="26" text-anchor="middle" fill="#18303d">${esc(name)}</text>
    </svg>`
  );
}

/* Firebase Collections */
const ADMIN_ITEMS = () => collection(db, 'admin', 'global', 'foodItems');

/* تحميل الشبكة */
async function loadGrid(){
  grid.innerHTML = '<div class="hint">⏳ جاري التحميل…</div>';
  const parts=[];
  let snap;
  try{
    snap = await getDocs(query(ADMIN_ITEMS(), orderBy('name')));
  }catch{
    snap = await getDocs(ADMIN_ITEMS());
  }
  ITEMS=[];
  snap.forEach(s=>{
    const d = { id: s.id, ...s.data() };
    ITEMS.push(d);

    // كل المقادير (إن وُجدت) — نعرض أي شكل موجود
    const measMapOrArr = d.measureQty || d.measures || null;
    let measHtml = '';
    if (measMapOrArr){
      // دعم الشكلين (Map أو Array)
      const entries = Array.isArray(measMapOrArr)
        ? measMapOrArr.map(m=>[m.name, m.grams])
        : Object.entries(measMapOrArr);

      measHtml = entries
        .filter(([label, grams]) => (label && Number(grams)>0))
        .map(([label, grams])=>`<span class="badge">${esc(label)} = ${Number(grams)} جم</span>`)
        .join(' ');
    }

    parts.push(`
      <div class="card" data-id="${esc(d.id)}">
        <img src="${esc(d.imageUrl || autoImg(d.name))}" alt="">
        <div class="title">
          <div class="name">${esc(d.name)}</div>
          ${d.brand?`<div class="brand">${esc(d.brand)}</div>`:''}
        </div>
        <div class="meta">
          <span>${Number(d?.nutrPer100g?.carbs_g ?? d?.carbs_100g ?? 0)} كربوهيدرات / 100جم</span>
          ${d.category?`<span class="chip">${esc(d.category)}</span>`:''}
        </div>
        <div class="measures">${measHtml || '<span class="muted">لا توجد مقادير منزلية</span>'}</div>
        <div class="actions">
          <button class="secondary btnEdit">تعديل</button>
          <button class="danger btnRemove">حذف</button>
        </div>
      </div>
    `);
  });
  grid.innerHTML = parts.join('') || '<div class="hint">لا توجد أصناف بعد</div>';

  grid.querySelectorAll('.btnEdit').forEach(btn=>{
    btn.addEventListener('click', ()=> openEdit(btn.closest('.card').dataset.id));
  });
  grid.querySelectorAll('.btnRemove').forEach(btn=>{
    btn.addEventListener('click', ()=> removeItem(btn.closest('.card').dataset.id));
  });
}

/* نموذج جديد */
btnNew.addEventListener('click', ()=>{
  SELECTED_FILE=null; REMOVE_IMAGE=false; MEASURES={};
  form.reset();
  imgEl.src = autoImg('صنف');
  dlg.showModal();
  renderMeasures();
});

/* إضافة/حذف مقياس */
btnAddMeas.addEventListener('click', (e)=>{
  e.preventDefault();
  const n=(measNameEl.value||'').trim();
  const g=num(measGramsEl.value);
  if(!n || !g || g<=0) return;
  MEASURES[n]=g;
  measNameEl.value=''; measGramsEl.value='';
  renderMeasures();
});
function renderMeasures(){
  measList.innerHTML = Object.keys(MEASURES).length
    ? Object.entries(MEASURES).map(([n,g],i)=>`
        <div class="pill">
          <span>${esc(n)} = ${g} جم</span>
          <button type="button" data-k="${esc(n)}" class="x">×</button>
        </div>
      `).join('')
    : '<div class="muted">أضِف تقديرات بيتية (مثال: كوب = 200 جم)</div>';
  measList.querySelectorAll('.x').forEach(b=>{
    b.addEventListener('click', ()=>{
      const k=b.dataset.k; delete MEASURES[k]; renderMeasures();
    });
  });
}

/* تحميل عنصر للتعديل */
async function openEdit(id){
  const s = await getDoc(doc(ADMIN_ITEMS(), id));
  if(!s.exists()) return;
  const d = s.data();

  SELECTED_FILE=null; REMOVE_IMAGE=false;
  form.reset();

  nameEl.value = d.name || '';
  brandEl.value = d.brand || '';
  categoryEl.value = d.category || '';
  carbsEl.value = d?.nutrPer100g?.carbs_g ?? d?.carbs_100g ?? '';
  fiberEl.value = d?.nutrPer100g?.fiber_g ?? d?.fiber_100g ?? '';
  protEl.value  = d?.nutrPer100g?.protein_g ?? d?.protein_100g ?? '';
  fatEl.value   = d?.nutrPer100g?.fat_g ?? d?.fat_100g ?? '';
  calEl.value   = d?.nutrPer100g?.cal_kcal ?? d?.calories_100g ?? '';
  giEl.value    = d?.gi ?? '';

  // حمّل المقادير أياً كان شكلها
  MEASURES = {};
  if (Array.isArray(d.measures)) {
    d.measures.forEach(m=>{
      if(m?.name && Number(m?.grams)>0) MEASURES[m.name]=Number(m.grams);
    });
  } else if (d.measureQty && typeof d.measureQty==='object') {
    Object.entries(d.measureQty).forEach(([n,g])=>{
      if(n && Number(g)>0) MEASURES[n]=Number(g);
    });
  }
  renderMeasures();

  imgEl.src = d.imageUrl || autoImg(d.name || 'صنف');

  // افتح النافذة
  dlg.showModal();

  // اربط الحذف لهذا العنصر
  btnDelete.onclick = async ()=>{
    if(!confirm('حذف هذا الصنف؟')) return;
    await deleteDoc(doc(ADMIN_ITEMS(), s.id));
    dlg.close(); loadGrid();
  }
}

/* اختيار صورة */
imgEl.addEventListener('click', ()=> document.getElementById('file').click());
document.getElementById('file').addEventListener('change', (e)=>{
  const f=e.target.files?.[0];
  if(!f) return;
  if(f.size > MAX_IMAGE_MB*1024*1024){ alert(`أقصى حجم ${MAX_IMAGE_MB}MB`); return; }
  SELECTED_FILE = f;
  const fr=new FileReader(); fr.onload=()=> imgEl.src = fr.result; fr.readAsDataURL(f);
});

/* حفظ */
btnSave.addEventListener('click', async (e)=>{
  e.preventDefault();
  const name=(nameEl.value||'').trim();
  if(!name){ alert('اكتبي اسم الصنف'); return; }

  const nutrPer100g = {
    carbs_g:  num(carbsEl.value) ?? 0,
    fiber_g:  num(fiberEl.value) ?? 0,
    protein_g:num(protEl.value) ?? 0,
    fat_g:    num(fatEl.value) ?? 0,
    cal_kcal: num(calEl.value) ?? 0
  };
  const base = {
    name,
    brand: (brandEl.value||'').trim() || null,
    category: (categoryEl.value||'').trim() || null,
    nutrPer100g,
    gi: num(giEl.value),
    updatedAt: serverTimestamp()
  };

  // جهّزي الصورة (إن وُجدت)
  let imageUrl = null;
  if(SELECTED_FILE){
    const storage = getStorage();
    const r = ref(storage, `food/${Date.now()}_${SELECTED_FILE.name}`);
    await uploadBytesResumable(r, SELECTED_FILE);
    imageUrl = await getDownloadURL(r);
  } else if (REMOVE_IMAGE) {
    imageUrl = null;
  }

  // --- أهم جزء: تجهيز المقاييس بصيغتين ---
  // 1) Map للمتوافق مع القديم
  const measureQty = Object.fromEntries(
    Object.entries(MEASURES)
      .filter(([n,g])=> n && Number(g)>0)
      .map(([n,g])=>[n, Number(g)])
  );

  // 2) Array للمتوافق مع صفحة الوجبات
  const measures = Object.entries(measureQty).map(([n,g])=>({name:n, grams:g}));

  // بناء كائن الحفظ النهائي (مع تصحيح الـ spread)
  const toSave = {
    ...base,
    ...(imageUrl!==null ? { imageUrl } : {}), // لا تغيّر الصورة إن لم تُرفع واحدة جديدة ولم يُطلب حذفها
    measureQty,
    measures
  };

  const id = form.dataset.id || null;
  if(id){
    await updateDoc(doc(ADMIN_ITEMS(), id), toSave);
  }else{
    await setDoc(doc(ADMIN_ITEMS(), crypto.randomUUID()), {
      ...toSave,
      createdAt: serverTimestamp()
    });
  }

  dlg.close(); loadGrid();
});

/* إلغاء وإغلاق */
btnReset.addEventListener('click', (e)=>{ e.preventDefault(); dlg.close(); });

/* حذف من الشبكة (اختصار) */
async function removeItem(id){
  if(!confirm('حذف هذا الصنف؟')) return;
  await deleteDoc(doc(ADMIN_ITEMS(), id));
  loadGrid();
}

/* بحث سريع */
qEl.addEventListener('input', ()=>{
  const q=(qEl.value||'').trim();
  grid.querySelectorAll('.card').forEach(card=>{
    const name=card.querySelector('.name').textContent;
    const brand=card.querySelector('.brand')?.textContent || '';
    const ok = !q || name.includes(q) || brand.includes(q);
    card.style.display = ok ? '' : 'none';
  });
});

/* تهيئة */
onAuthStateChanged(auth, async user=>{
  await loadGrid();
});
