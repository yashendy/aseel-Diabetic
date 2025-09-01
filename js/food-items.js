// إدارة مكتبة الأصناف (إضافة/تعديل/حذف + عرض)
// - يدعم measures كـ Array أو التحويل من measureQty (Map)
// - زرارين: حفظ جديد / تعديل
// - صورة صغيرة 60×60 مع اختيار ملف
import { auth, db, storage } from './firebase-config.js';
import {
  collection, query, orderBy, getDocs, getDoc, doc,
  setDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* ====== DOM ====== */
const $ = (id)=>document.getElementById(id);
const qEl=$('q'), grid=$('grid'), dlg=$('dlg'), form=$('form');
const btnNew=$('btnNew'), btnSave=$('btnSave'), btnUpdate=$('btnUpdate'), btnDelete=$('btnDelete'), btnAddMeas=$('btnAddMeas');

const nameEl=$('name'), brandEl=$('brand'), categoryEl=$('category'), imgEl=$('img'), fileEl=$('file');
const carbsEl=$('carbs'), fiberEl=$('fiber'), protEl=$('prot'), fatEl=$('fat'), calEl=$('cal'), giEl=$('gi');
const measList=$('measList'), measNameEl=$('measName'), measGramsEl=$('measGrams');

let ITEMS=[], MEASURES={}, SELECTED_FILE=null;

/* ====== Helpers ====== */
const ADMIN_ITEMS = ()=> collection(db,'admin','global','foodItems');
const esc=(s)=> (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const nn=(v)=>{ const n=Number(v); return Number.isFinite(n)?n:null; };

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

/* ====== Measures ====== */
function normalizeMeasures(d){
  if (Array.isArray(d?.measures)){
    return d.measures
      .filter(m=>m && m.name && Number(m.grams)>0)
      .map(m=>({name:m.name, grams:Number(m.grams)}));
  }
  if (d?.measureQty && typeof d.measureQty==='object'){
    return Object.entries(d.measureQty)
      .filter(([n,g])=>n && Number(g)>0)
      .map(([n,g])=>({name:n, grams:Number(g)}));
  }
  if (Array.isArray(d?.householdUnits)){
    return d.householdUnits
      .filter(m=>m && m.name && Number(m.grams)>0)
      .map(m=>({name:m.name, grams:Number(m.grams)}));
  }
  return [];
}

/* ====== Load Grid ====== */
async function loadGrid(){
  grid.innerHTML='<div class="muted">⏳ جاري التحميل…</div>';
  let snap;
  try{ snap = await getDocs(query(ADMIN_ITEMS(), orderBy('name'))); }
  catch{ snap = await getDocs(ADMIN_ITEMS()); }

  ITEMS=[]; const parts=[];
  snap.forEach(s=>{
    const d = { id:s.id, ...s.data() };
    ITEMS.push(d);
    const tags = normalizeMeasures(d).map(m=>`<span class="badge">${esc(m.name)} (${m.grams}جم)</span>`).join(' ');
    parts.push(`
      <div class="card-item" data-id="${esc(d.id)}">
        <img src="${esc(d.imageUrl || autoImg(d.name||'صنف'))}" alt="">
        <div class="title">${esc(d.name||'-')}</div>
        ${d.brand?`<div class="brand">${esc(d.brand)}</div>`:''}
        <div>${tags || '<span class="muted">لا تقديرات بيتية</span>'}</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="secondary btnEdit">تعديل</button>
          <button class="danger btnRemove">حذف</button>
        </div>
      </div>
    `);
  });
  grid.innerHTML = parts.join('') || '<div class="muted">لا توجد أصناف بعد</div>';
  grid.querySelectorAll('.btnEdit').forEach(b=> b.addEventListener('click', ()=> openEdit(b.closest('.card-item').dataset.id)));
  grid.querySelectorAll('.btnRemove').forEach(b=> b.addEventListener('click', ()=> removeItem(b.closest('.card-item').dataset.id)));
}

/* ====== Render Measures Pills ====== */
function renderMeasures(){
  const entries = Object.entries(MEASURES);
  measList.innerHTML = entries.length
    ? entries.map(([n,g])=>`
        <div class="pill">
          <span>${esc(n)} = ${g} جم</span>
          <button type="button" class="x" data-k="${esc(n)}">×</button>
        </div>
      `).join('')
    : '<div class="muted">أضِف تقديرات بيتية (مثال: كوب = 200 جم)</div>';
  measList.querySelectorAll('.x').forEach(b=>{
    b.addEventListener('click', ()=>{ delete MEASURES[b.dataset.k]; renderMeasures(); });
  });
}

/* ====== Collect Form Data ====== */
function collectFormData(){
  const nutrPer100g = {
    carbs_g:  nn(carbsEl.value) ?? 0,
    fiber_g:  nn(fiberEl.value) ?? 0,
    protein_g:nn(protEl.value) ?? 0,
    fat_g:    nn(fatEl.value) ?? 0,
    cal_kcal: nn(calEl.value) ?? 0
  };
  const measureQty = Object.fromEntries(
    Object.entries(MEASURES)
      .filter(([n,g])=>n && Number(g)>0)
      .map(([n,g])=>[n, Number(g)])
  );
  const measures = Object.entries(measureQty).map(([n,g])=>({name:n, grams:g}));

  return {
    name: (nameEl.value||'').trim(),
    brand: (brandEl.value||'').trim() || null,
    category: (categoryEl.value||'').trim() || null,
    nutrPer100g,
    gi: nn(giEl.value),
    measureQty,
    measures,
    updatedAt: serverTimestamp()
  };
}

/* ====== Image Select ====== */
imgEl.addEventListener('click', ()=> fileEl.click());
fileEl.addEventListener('change', (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  SELECTED_FILE=f; const fr=new FileReader(); fr.onload=()=> imgEl.src=fr.result; fr.readAsDataURL(f);
});

/* ====== New Item ====== */
btnNew.addEventListener('click', ()=>{
  form.reset(); MEASURES={}; renderMeasures(); SELECTED_FILE=null;
  imgEl.src = autoImg('صنف');
  delete form.dataset.id;
  btnSave.style.display='inline-block';
  btnUpdate.style.display='none';
  btnDelete.style.display='none';
  dlg.showModal();
});

/* ====== Add measure ====== */
btnAddMeas.addEventListener('click', ()=>{
  const n=(measNameEl.value||'').trim(); const g=nn(measGramsEl.value);
  if(!n || !g || g<=0) return;
  MEASURES[n]=g; measNameEl.value=''; measGramsEl.value=''; renderMeasures();
});

/* ====== Save New ====== */
btnSave.addEventListener('click', async (e)=>{
  e.preventDefault();
  if(!nameEl.value.trim()){ alert('اكتبي اسم الصنف'); return; }

  // صورة (اختياري)
  let imageUrl=null;
  if(SELECTED_FILE){
    const r = ref(storage, `food/${Date.now()}_${SELECTED_FILE.name}`);
    await uploadBytesResumable(r, SELECTED_FILE);
    imageUrl = await getDownloadURL(r);
  }

  const toSave = collectFormData();
  await setDoc(doc(ADMIN_ITEMS(), crypto.randomUUID()), {
    ...toSave,
    ...(imageUrl?{imageUrl}:{}),
    createdAt: serverTimestamp()
  });

  delete form.dataset.id;
  dlg.close(); loadGrid();
});

/* ====== Update Existing ====== */
btnUpdate.addEventListener('click', async (e)=>{
  e.preventDefault();
  const id=form.dataset.id;
  if(!id){ alert('لا يوجد صنف محدد للتعديل'); return; }

  let imageUrl=null;
  if(SELECTED_FILE){
    const r = ref(storage, `food/${Date.now()}_${SELECTED_FILE.name}`);
    await uploadBytesResumable(r, SELECTED_FILE);
    imageUrl = await getDownloadURL(r);
  }

  const toSave = collectFormData();
  await updateDoc(doc(ADMIN_ITEMS(), id), {
    ...toSave,
    ...(imageUrl!==null ? { imageUrl } : {}) // لا تغيّر الصورة إن لم تُرفع واحدة جديدة
  });

  delete form.dataset.id;
  dlg.close(); loadGrid();
});

/* ====== Delete ====== */
btnDelete.addEventListener('click', async ()=>{
  const id=form.dataset.id;
  if(!id) return;
  if(!confirm('حذف هذا الصنف؟')) return;
  await deleteDoc(doc(ADMIN_ITEMS(), id));
  delete form.dataset.id;
  dlg.close(); loadGrid();
});

/* ====== Open Edit ====== */
async function openEdit(id){
  const s=await getDoc(doc(ADMIN_ITEMS(), id)); if(!s.exists()) return;
  const d=s.data();

  form.reset(); SELECTED_FILE=null; MEASURES={};
  nameEl.value=d.name||''; brandEl.value=d.brand||''; categoryEl.value=d.category||'';
  carbsEl.value=d?.nutrPer100g?.carbs_g ?? d?.carbs_100g ?? '';
  fiberEl.value=d?.nutrPer100g?.fiber_g ?? d?.fiber_100g ?? '';
  protEl.value =d?.nutrPer100g?.protein_g ?? d?.protein_100g ?? '';
  fatEl.value  =d?.nutrPer100g?.fat_g ?? d?.fat_100g ?? '';
  calEl.value  =d?.nutrPer100g?.cal_kcal ?? d?.calories_100g ?? '';
  giEl.value   =d?.gi ?? '';

  // مقاييس
  normalizeMeasures(d).forEach(m=>{ MEASURES[m.name]=m.grams; });
  renderMeasures();

  imgEl.src = d.imageUrl || autoImg(d.name||'صنف');

  form.dataset.id = s.id;
  btnSave.style.display='none';
  btnUpdate.style.display='inline-block';
  btnDelete.style.display='inline-block';

  dlg.showModal();
}

/* ====== Quick filter ====== */
qEl.addEventListener('input', ()=>{
  const q=(qEl.value||'').trim();
  grid.querySelectorAll('.card-item').forEach(c=>{
    const name=c.querySelector('.title').textContent;
    const brand=c.querySelector('.brand')?.textContent || '';
    c.style.display = (!q || name.includes(q) || brand.includes(q)) ? '' : 'none';
  });
});

/* ====== Init ====== */
loadGrid().catch(console.error);
