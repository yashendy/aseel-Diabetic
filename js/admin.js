// js/food-items.js — إدارة مكتبة الأصناف (لوحة الأدمن)
// يعمل مع IDs التالية في admin.html:
//  - #btnNew  (زر إضافة صنف)
//  - #q       (حقل البحث)
//  - #foodsGrid أو #grid  (شبكة العرض)
//  - <dialog id="dlg"></dialog>  (فارغ — السكربت يبني المحتوى ديناميكيًا)

import { db } from './firebase-config.js';
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, deleteDoc,
  serverTimestamp, orderBy, query
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $  = (sel, root=document)=>root.querySelector(sel);
const $$ = (sel, root=document)=>root.querySelectorAll(sel);
const esc = (s)=> (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
const num = (v)=> Number.isFinite(Number(v)) ? Number(v) : 0;

// عناصر الصفحة (مع دعم foodsGrid/grid)
const btnNew  = $('#btnNew');
const qInput  = $('#q');
const grid    = $('#foodsGrid') || $('#grid');
const dlg     = $('#dlg');
const toastEl = $('#toast');

function toast(msg, type='info'){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(()=>toastEl.classList.add('hidden'), 1600);
}

// مصدر البيانات
const collRef = collection(db, 'admin', 'global', 'foodItems');

// حالة
let ALL = [], CURRENT = [];

/* ==================== تحميل الكتالوج ==================== */
async function refreshList(){
  if(!grid) return;
  try{
    let snap;
    try{ snap = await getDocs(query(collRef, orderBy('name'))); }
    catch{ snap = await getDocs(collRef); } // fallback بدون فهرس

    ALL = [];
    snap.forEach(s=>{
      const d = s.data();
      ALL.push({
        id: s.id,
        name: d.name || '',
        brand: d.brand || null,
        category: d.category || null,
        gi: (typeof d.gi==='number') ? d.gi : null,
        imageUrl: d.imageUrl || null,
        tags: Array.isArray(d.tags) ? d.tags : [],
        nutrPer100g: {
          carbs_g : num(d?.nutrPer100g?.carbs_g),
          fiber_g : num(d?.nutrPer100g?.fiber_g),
          protein_g: num(d?.nutrPer100g?.protein_g),
          fat_g   : num(d?.nutrPer100g?.fat_g),
          cal_kcal: num(d?.nutrPer100g?.cal_kcal),
        },
        measures: Array.isArray(d.measures)
          ? d.measures.filter(m=>m?.name && num(m?.grams)>0).map(m=>({name:m.name, grams:num(m.grams)}))
          : []
      });
    });

    ALL.sort((a,b)=> a.name.localeCompare(b.name,'ar'));
    renderList();
  }catch(e){ console.error(e); toast('تعذّر تحميل الأصناف','error'); }
}

function renderList(){
  if(!grid) return;
  const q = (qInput?.value || '').trim().toLowerCase();
  CURRENT = ALL.filter(it=>{
    if(!q) return true;
    return (it.name||'').toLowerCase().includes(q)
        || (it.brand||'').toLowerCase().includes(q)
        || (it.tags||[]).some(t=>(t||'').toLowerCase().includes(q));
  });

  if(!CURRENT.length){
    grid.innerHTML = `<div class="empty">لا نتائج.</div>`;
    return;
  }

  grid.innerHTML = CURRENT.map(it=>`
    <div class="card item">
      <div class="row">
        <div class="left">
          ${it.imageUrl ? `<img src="${esc(it.imageUrl)}" class="thumb" alt="">` : `<div class="thumb placeholder">📦</div>`}
          <div class="txt">
            <div class="name">${esc(it.name)}</div>
            <div class="meta">${esc(it.brand||'-')} • ${esc(it.category||'-')} ${typeof it.gi==='number'?`• GI ${it.gi}`:''}</div>
            <div class="meta tiny">ك/100جم: ${it.nutrPer100g.carbs_g} • ألياف/100جم: ${it.nutrPer100g.fiber_g} • بروتين/100جم: ${it.nutrPer100g.protein_g}</div>
            ${(it.tags?.length? `<div class="tags">${it.tags.map(t=>`<span class="chip">#${esc(t)}</span>`).join(' ')}</div>`:'')}
          </div>
        </div>
        <div class="right">
          <button class="btn sm" data-act="edit" data-id="${esc(it.id)}">تعديل</button>
          <button class="btn sm danger" data-act="del" data-id="${esc(it.id)}">حذف</button>
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-act="edit"]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const it = ALL.find(x=>x.id===b.dataset.id);
      if(it) openEditor(it);
    });
  });
  grid.querySelectorAll('[data-act="del"]').forEach(b=>{
    b.addEventListener('click', ()=> handleDelete(b.dataset.id));
  });
}

/* ==================== نموذج الإضافة/التعديل ==================== */
function openEditor(existing=null){
  if(!dlg) return;

  const TITLE = existing ? 'تعديل صنف' : 'إضافة صنف';
  dlg.innerHTML = `
    <form id="form" method="dialog" class="form" style="min-width:min(92vw,640px)">
      <h3 style="display:flex;justify-content:space-between;align-items:center">
        <span>${TITLE}</span>
        <span class="muted tiny">القيم المدخلة لكل 100 جم</span>
      </h3>

      <div class="grid2">
        <div>
          <label>اسم الصنف</label>
          <input id="name" type="text" value="${existing?esc(existing.name):''}" required>
        </div>
        <div>
          <label>العلامة التجارية</label>
          <input id="brand" type="text" value="${existing?esc(existing.brand||''):''}">
        </div>
      </div>

      <div class="grid3">
        <div>
          <label>الفئة</label>
          <input id="category" type="text" value="${existing?esc(existing.category||''):''}">
        </div>
        <div>
          <label>GI</label>
          <input id="gi" type="number" min="0" max="100" step="1" value="${(existing&&typeof existing.gi==='number')?existing.gi:''}">
        </div>
        <div>
          <label>وسوم (افصليها بمسافة)</label>
          <input id="tags" type="text" value="${existing?(existing.tags||[]).join(' '):''}">
        </div>
      </div>

      <div class="grid1">
        <label>رابط صورة (URL)</label>
        <div class="row" style="gap:8px">
          <input id="imageUrl" type="url" value="${existing?esc(existing.imageUrl||''):''}" placeholder="https://...">
          <button id="btnPreview" class="btn sm" type="button">معاينة</button>
        </div>
        <div style="margin-top:8px"><img id="img" src="${existing?esc(existing.imageUrl||''):''}" style="max-width:180px;border-radius:10px"></div>
      </div>

      <fieldset class="box">
        <legend>لكل 100 جم</legend>
        <div class="grid5">
          <div><label>كارب</label>   <input id="carbs" type="number" step="0.1" min="0" value="${existing?existing.nutrPer100g.carbs_g:0}"></div>
          <div><label>ألياف</label>  <input id="fiber" type="number" step="0.1" min="0" value="${existing?existing.nutrPer100g.fiber_g:0}"></div>
          <div><label>بروتين</label><input id="prot"  type="number" step="0.1" min="0" value="${existing?existing.nutrPer100g.protein_g:0}"></div>
          <div><label>دهون</label>  <input id="fat"   type="number" step="0.1" min="0" value="${existing?existing.nutrPer100g.fat_g:0}"></div>
          <div><label>سعرات</label> <input id="cal"   type="number" step="0.1" min="0" value="${existing?existing.nutrPer100g.cal_kcal:0}"></div>
        </div>
      </fieldset>

      <fieldset class="box">
        <legend>تقديرات منزلية (اختياري)</legend>
        <div class="row" style="gap:8px">
          <input id="measName"  placeholder="اسم التقدير (كوب/ملعقة...)">
          <input id="measGrams" type="number" step="1" min="1" placeholder="جرام/وحدة">
          <button id="btnAddMeas" class="btn sm" type="button">إضافة</button>
        </div>
        <div id="measList" class="chips" style="margin-top:8px"></div>
      </fieldset>

      <div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end">
        ${existing ? `<button id="btnDelete" class="btn danger" type="button">حذف</button>` : ``}
        <button id="btnSave" class="btn primary" type="button">${existing?'حفظ التعديل':'حفظ'}</button>
        <button id="btnClose" class="btn" type="button">إغلاق</button>
      </div>
    </form>
  `;

  // فتح الـ dialog
  if(typeof dlg.showModal==='function') dlg.showModal();
  else dlg.classList.remove('hidden');

  // عناصر النموذج — لاحظي أننا بنبحث داخل dlg
  const form        = $('#form', dlg);
  const nameEl      = $('#name', dlg);
  const brandEl     = $('#brand', dlg);
  const categoryEl  = $('#category', dlg);
  const giEl        = $('#gi', dlg);
  const tagsEl      = $('#tags', dlg);

  const imageUrlEl  = $('#imageUrl', dlg);
  const btnPreviewEl= $('#btnPreview', dlg);
  const imgEl       = $('#img', dlg);

  const carbsEl     = $('#carbs', dlg);
  const fiberEl     = $('#fiber', dlg);
  const protEl      = $('#prot', dlg);
  const fatEl       = $('#fat', dlg);
  const calEl       = $('#cal', dlg);

  const measNameEl  = $('#measName', dlg);
  const measGramsEl = $('#measGrams', dlg);
  const btnAddMeasEl= $('#btnAddMeas', dlg);
  const measListEl  = $('#measList', dlg);

  const btnSaveEl   = $('#btnSave', dlg);
  const btnCloseEl  = $('#btnClose', dlg);
  const btnDeleteEl = $('#btnDelete', dlg);

  // مصفوفة القياسات الحالية
  let measures = existing ? (existing.measures || []) : [];

  function renderMeasures(){
    measListEl.innerHTML = measures.map((m,i)=>`
      <span class="chip">${esc(m.name)} (${m.grams}جم)
        <button type="button" class="x" data-i="${i}" title="حذف">×</button>
      </span>
    `).join('');
    measListEl.querySelectorAll('.x').forEach(b=>{
      b.addEventListener('click', ()=>{ measures.splice(Number(b.dataset.i),1); renderMeasures(); });
    });
  }
  renderMeasures();

  // ——— ربط الأحداث داخل الـ dialog ———
  if(btnPreviewEl){
    btnPreviewEl.addEventListener('click', ()=>{
      const url = (imageUrlEl?.value||'').trim();
      imgEl.src = url || '';
    });
  }
  if(btnAddMeasEl){
    btnAddMeasEl.addEventListener('click', ()=>{
      const n = (measNameEl.value||'').trim();
      const g = num(measGramsEl.value);
      if(!n || g<=0){ toast('أدخلي اسم التقدير والجرامات','error'); return; }
      measures.push({ name:n, grams:g });
      measNameEl.value=''; measGramsEl.value='';
      renderMeasures();
    });
  }
  if(btnCloseEl){
    btnCloseEl.addEventListener('click', closeDialog);
  }
  if(btnDeleteEl && existing){
    btnDeleteEl.addEventListener('click', async ()=>{
      if(!confirm('حذف هذا الصنف؟')) return;
      try{
        await deleteDoc(doc(collRef, existing.id));
        toast('تم الحذف','success');
        closeDialog(); await refreshList();
      }catch(e){ console.error(e); toast('تعذّر الحذف','error'); }
    });
  }
  if(btnSaveEl){
    btnSaveEl.addEventListener('click', async ()=>{
      const name = (nameEl.value||'').trim();
      if(!name){ toast('الاسم مطلوب','error'); return; }

      const payload = {
        name,
        brand    : (brandEl.value||'').trim()    || null,
        category : (categoryEl.value||'').trim() || null,
        gi       : giEl.value==='' ? null : Math.min(100, Math.max(0, num(giEl.value))),
        imageUrl : (imageUrlEl.value||'').trim() || null,
        tags     : (tagsEl.value||'').trim() ? (tagsEl.value.trim().split(/\s+/).map(s=>s.replace(/^#/,'')).slice(0,20)) : [],
        nutrPer100g:{
          carbs_g : Math.max(0, num(carbsEl.value)),
          fiber_g : Math.max(0, num(fiberEl.value)),
          protein_g: Math.max(0, num(protEl.value)),
          fat_g   : Math.max(0, num(fatEl.value)),
          cal_kcal: Math.max(0, num(calEl.value)),
        },
        measures : measures.map(m=>({ name:m.name, grams:Math.max(1, Math.round(m.grams)) })),
        updatedAt: serverTimestamp()
      };

      try{
        if(existing){
          await updateDoc(doc(collRef, existing.id), payload);
          toast('تم حفظ التعديل','success');
        }else{
          await addDoc(collRef, { ...payload, createdAt:serverTimestamp() });
          toast('تمت الإضافة','success');
        }
        closeDialog(); await refreshList();
      }catch(e){ console.error(e); toast('تعذّر الحفظ','error'); }
    });
  }
}

function closeDialog(){
  if(!dlg) return;
  if(typeof dlg.close==='function') dlg.close();
  dlg.classList.add('hidden');   // fallback لو كان <div>
  dlg.innerHTML='';              // تنظيف
}

/* ==================== حذف صنف ==================== */
async function handleDelete(id){
  const it = ALL.find(x=>x.id===id); if(!it) return;
  if(!confirm(`حذف "${it.name}"؟`)) return;
  try{
    await deleteDoc(doc(collRef, id));
    toast('تم الحذف','success');
    await refreshList();
  }catch(e){ console.error(e); toast('تعذّر الحذف','error'); }
}

/* ==================== أحداث عامة ==================== */
if(btnNew) btnNew.addEventListener('click', ()=> openEditor());
if(qInput) qInput.addEventListener('input', renderList);

/* ==================== تشغيل ==================== */
refreshList().catch(console.error);
