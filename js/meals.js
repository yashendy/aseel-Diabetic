// meals.js — صفحة الوجبات
// الهدف في هذا التعديل: عند قراءة كتالوج الأصناف، ندعم الحالتين:
// - measures (Array) جاهزة
// - measureQty (Map) ونعمل لها تحويل إلى Array {name, grams}
// وباقي منطق الصفحة يظل كما هو.

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ====== مسارات Firestore ====== */
const PUBLIC_FOOD_COLLECTION = () => collection(db, 'admin', 'global', 'foodItems');
const params = new URLSearchParams(location.search);
const childId = params.get('child');

/* ====== DOM Helpers (نفس العناصر الموجودة عندك) ====== */
const $ = (id)=>document.getElementById(id);
const itemsBodyEl = $('itemsBody');
const addBtn = $('addBtn');
const foodPicker = $('foodPicker');
const pickSearch = $('pickSearch');
const pickList   = $('pickList');
const totalCarbsEl = $('totalCarbs');
const totalCalEl   = $('totalCal');
const totalGLel    = $('totalGL');
const doseFormEl   = $('doseForm');
const doseResultEl = $('doseResult');

/* ====== حالة الصفحة ====== */
let cachedFood = [];     // الكتالوج المؤقّت
let currentItems = [];   // عناصر الوجبة الحالية

/* ====== أدوات مساعدة ====== */
const esc=(s)=> (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const toNumber=(v)=>{ const n=Number(v); return Number.isFinite(n)?n:0; };
const round1=(n)=> Math.round((Number(n)||0)*10)/10;

/* ---------- تحويل المقادير إلى Array موحّدة ---------- */
function normalizeMeasures(docData){
  // 1) لو فيه measures Array وصحيحة، رجع نسخة نظيفة منها
  if (Array.isArray(docData?.measures)) {
    return docData.measures
      .filter(m=>m && m.name && Number(m.grams)>0)
      .map(m=>({ name: m.name, grams: Number(m.grams) }));
  }
  // 2) لو فيه measureQty كـ Map — حوّلها إلى Array
  if (docData?.measureQty && typeof docData.measureQty === 'object') {
    return Object.entries(docData.measureQty)
      .filter(([n,g])=> n && Number(g)>0)
      .map(([n,g])=>({ name:n, grams:Number(g) }));
  }
  // 3) بدائل تاريخية (householdUnits)
  if (Array.isArray(docData?.householdUnits)) {
    return docData.householdUnits
      .filter(m=>m && m.name && Number(m.grams)>0)
      .map(m=>({ name:m.name, grams:Number(m.grams) }));
  }
  return [];
}

/* ---------- بناء عنصر الكتالوج ---------- */
function mapAdminItem(d){
  const nutr = d.nutrPer100g || {
    carbs_g:   Number(d.carbs_100g ?? 0),
    fiber_g:   Number(d.fiber_100g ?? 0),
    protein_g: Number(d.protein_100g ?? 0),
    fat_g:     Number(d.fat_100g ?? 0),
    cal_kcal:  Number(d.calories_100g ?? 0),
  };
  return {
    id: d.id,
    name: d.name,
    brand: d.brand || null,
    category: d.category || null,
    imageUrl: d.imageUrl || null,
    tags: d.tags || [],
    nutrPer100g: nutr,
    gi: d.gi ?? null,
    measures: normalizeMeasures(d)
  };
}

/* ---------- تحميل الكتالوج مرة واحدة ---------- */
async function ensureFoodCache(){
  if (cachedFood.length) return;
  let snap;
  try {
    snap = await getDocs(query(PUBLIC_FOOD_COLLECTION(), orderBy('name')));
  } catch {
    snap = await getDocs(PUBLIC_FOOD_COLLECTION());
  }
  cachedFood = [];
  snap.forEach(s => cachedFood.push(mapAdminItem({ id: s.id, ...s.data() })));
}

/* ---------- فتح منتقي الصنف ---------- */
addBtn.addEventListener('click', async ()=>{
  await ensureFoodCache();
  pickSearch.value='';
  renderPickList('');
  foodPicker.showModal();
});
pickSearch.addEventListener('input', ()=> renderPickList(pickSearch.value));

function renderPickList(q){
  q=(q||'').trim();
  const list = cachedFood.filter(it=>{
    if(!q) return true;
    return (it.name||'').includes(q) || (it.brand||'').includes(q) || (it.category||'').includes(q);
  });
  pickList.innerHTML = list.map(it=>`
    <button class="pick" data-id="${esc(it.id)}">
      <img src="${esc(it.imageUrl || '')}" alt="">
      <div class="txt">
        <div class="n">${esc(it.name)}</div>
        ${it.brand?`<div class="b">${esc(it.brand)}</div>`:''}
        ${(it.measures?.length||0) ? `<div class="m">${it.measures.map(m=>`<span class="chip">${esc(m.name)} (${m.grams}جم)</span>`).join(' ')}</div>`: '<div class="m muted">لا تقديرات بيتية</div>'}
      </div>
    </button>
  `).join('') || '<div class="hint">لا نتائج</div>';

  pickList.querySelectorAll('.pick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const it = cachedFood.find(x=>x.id===btn.dataset.id);
      if(it) { addRowFromCatalog(it); foodPicker.close(); }
    });
  });
}

/* ---------- إضافة صف إلى الوجبة ---------- */
function addRowFromCatalog(itemDoc){
  const gi = itemDoc.gi ?? null;
  const row = {
    id: crypto.randomUUID(),
    itemId: itemDoc.id,
    name: itemDoc.name,
    brand: itemDoc.brand || null,
    unit: 'grams',          // الافتراضي جرام
    qty: 0,
    measure: null,          // اسم المقياس المختار عند اختيار "تقدير بيتي"
    grams: 0,
    per100: {
      carbs: toNumber(itemDoc?.nutrPer100g?.carbs_g),
      fiber: toNumber(itemDoc?.nutrPer100g?.fiber_g),
      cal:   toNumber(itemDoc?.nutrPer100g?.cal_kcal),
      prot:  toNumber(itemDoc?.nutrPer100g?.protein_g),
      fat:   toNumber(itemDoc?.nutrPer100g?.fat_g)
    },
    gi,
    calc:{carbs:0,fiber:0,cal:0,prot:0,fat:0,gl:0},
    measures: Array.isArray(itemDoc?.measures) ? itemDoc.measures : []
  };
  currentItems.push(row);
  renderItems(); recalcAll();
}

/* ---------- رسم الصفوف ---------- */
function renderItems(){
  itemsBodyEl.innerHTML = '';
  currentItems.forEach((r, idx)=>{
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `
      <div class="name">
        <div><strong>${esc(r.name)}</strong>${r.brand?` <span class="sub">(${esc(r.brand)})</span>`:''}</div>
      </div>
      <div>
        <select class="unit">
          <option value="grams" ${r.unit==='grams'?'selected':''}>جرام</option>
          <option value="household" ${r.unit==='household'?'selected':''}>تقدير بيتي</option>
        </select>
      </div>
      <div><input type="number" step="any" class="qty" value="${r.qty}" min="0" max="100000"></div>
      <div>
        <select class="measure">
          ${(r.measures||[]).map(m=>`<option value="${esc(m.name)}" ${r.measure===m.name?'selected':''}>${esc(m.name)} (${m.grams} جم)</option>`).join('')}
        </select>
      </div>
      <div><span class="grams">${round1(r.grams)}</span></div>
      <div><span class="carbs">${round1(r.calc.carbs)}</span></div>
      <div><button class="secondary delBtn">حذف</button></div>
    `;
    itemsBodyEl.appendChild(div);

    const unitSel=div.querySelector('.unit');
    const qtyInp=div.querySelector('.qty');
    const measSel=div.querySelector('.measure');
    const gramsEl=div.querySelector('.grams');
    const carbsEl=div.querySelector('.carbs');

    unitSel.addEventListener('change', ()=>{
      r.unit = unitSel.value;
      if(r.unit==='grams'){
        r.measure=null;
        r.grams = toNumber(qtyInp.value);
      }else{
        // household
        const m = r.measures.find(x=>x.name===measSel.value);
        r.measure = m?.name || null;
        const pieces = toNumber(qtyInp.value);
        r.grams = pieces * (m?.grams || 0);
      }
      recalcRow(r, gramsEl, carbsEl);
    });

    qtyInp.addEventListener('input', ()=>{
      if(r.unit==='grams'){
        r.grams = toNumber(qtyInp.value);
      }else{
        const m = r.measures.find(x=>x.name===measSel.value);
        r.grams = toNumber(qtyInp.value) * (m?.grams || 0);
      }
      recalcRow(r, gramsEl, carbsEl);
    });

    measSel.addEventListener('change', ()=>{
      const m = r.measures.find(x=>x.name===measSel.value);
      r.measure = m?.name || null;
      if(r.unit==='household'){
        r.grams = toNumber(qtyInp.value) * (m?.grams || 0);
        recalcRow(r, gramsEl, carbsEl);
      }
    });

    div.querySelector('.delBtn').addEventListener('click', ()=>{
      currentItems = currentItems.filter(x=>x!==r);
      renderItems(); recalcAll();
    });
  });
}

/* ---------- حسابات بسيطة ---------- */
function recalcRow(r, gramsEl, carbsEl){
  const carbs = (r.per100.carbs || 0) * (r.grams/100);
  r.calc.carbs = carbs;
  gramsEl.textContent = round1(r.grams);
  carbsEl.textContent = round1(carbs);
  recalcAll();
}
function recalcAll(){
  const totalCarbs = currentItems.reduce((a,r)=> a + (r.calc.carbs||0), 0);
  totalCarbsEl.textContent = round1(totalCarbs);
  // (لو عندك حسابات إضافية للسعرات/GL… تفضل كما هي)
}

/* ---------- تهيئة ---------- */
onAuthStateChanged(auth, async user=>{
  await ensureFoodCache();
});
