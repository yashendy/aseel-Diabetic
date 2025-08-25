// js/meals.js v7 — نسخة كاملة
// - دعم "مساعد الوجبة" (Gemini) بإصلاح الصيغة
// - مودال المكتبة مع حماية العناصر
// - بناء جدول الوجبة، الحسابات، الجرعة، الحفظ/التعديل/الحذف
// - قائمة وجبات اليوم + تكرار آخر وجبة
// -----------------------------------------------------------

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ========== عناصر عامة من DOM ========== */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const toastEl       = document.getElementById('toast');
const toastMsgEl    = toastEl?.querySelector('.msg');
const childNameEl   = document.getElementById('childName');
const childMetaEl   = document.getElementById('childMeta');

const mealDateEl    = document.getElementById('mealDate');
const mealTypeEl    = document.getElementById('mealType');
const preReadingEl  = document.getElementById('preReading');
const postReadingEl = document.getElementById('postReading');

const itemsBodyEl   = document.getElementById('itemsBody');
const addItemBtn    = document.getElementById('addItemBtn');
const repeatLastBtn = document.getElementById('repeatLastBtn');
const backBtn       = document.getElementById('backBtn');

// إجماليات
const tGramsEl = document.getElementById('tGrams');
const tCarbsEl = document.getElementById('tCarbs');
const tFiberEl = document.getElementById('tFiber');
const tNetEl   = document.getElementById('tNetCarbs');
const tCalEl   = document.getElementById('tCal');
const tProtEl  = document.getElementById('tProt');
const tFatEl   = document.getElementById('tFat');
const tGLEl    = document.getElementById('tGL');
const tGLBadge = document.getElementById('tGLBadge');

// الجرعة
const suggestedDoseEl = document.getElementById('suggestedDose');
const doseExplainEl   = document.getElementById('doseExplain');
const doseRangeEl     = document.getElementById('doseRange');
const appliedDoseEl   = document.getElementById('appliedDose');
const mealNotesEl     = document.getElementById('mealNotes');

const saveMealBtn     = document.getElementById('saveMealBtn');
const resetMealBtn    = document.getElementById('resetMealBtn');
const printDayBtn     = document.getElementById('printDayBtn');

// قائمة اليوم
const tableDateEl     = document.getElementById('tableDate');
const filterTypeEl    = document.getElementById('filterType');
const mealsListEl     = document.getElementById('mealsList');
const noMealsEl       = document.getElementById('noMeals');

// مودال مكتبة الأصناف
const pickerModal     = document.getElementById('pickerModal');
const closePicker     = document.getElementById('closePicker');
const pickSearchEl    = document.getElementById('pickSearch');
const pickCategoryEl  = document.getElementById('pickCategory');
const pickerGrid      = document.getElementById('pickerGrid');
const pickerEmpty     = document.getElementById('pickerEmpty');

// مودال مساعد الوجبة (Gemini)
const aiHelperBtn = document.getElementById('aiHelperBtn');
const aiModal     = document.getElementById('aiModal');
const closeAi     = document.getElementById('closeAi');
const aiKeyEl     = document.getElementById('aiKey');
const aiGoalEl    = document.getElementById('aiGoal');
const aiNoteEl    = document.getElementById('aiNote');
const aiRunBtn    = document.getElementById('aiRun');
const aiClearBtn  = document.getElementById('aiClear');
const aiOutEl     = document.getElementById('aiOut');

/* ========== حالة عامة ========== */
let currentUser, childData;
let editingMealId = null;
let currentItems = [];     // صفوف الوجبة الحالية
let cachedFood = [];       // كاش مكتبة الأصناف
let cachedMeasurements = [];

/* ========== أدوات مساعدة ========== */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); } setMaxToday(mealDateEl);
function esc(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function toNumber(x){ const n = Number(String(x ?? '').replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round((x||0)*10)/10; }
function roundHalf(x){ return Math.round((x||0)*2)/2; }
function showToast(msg){ if(!toastEl) return; toastMsgEl.textContent = msg; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 1800); }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function calcAge(bd){ if(!bd) return '-'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; }

const SLOT_MAP = {
  'فطور': { pre:'ق.الفطار', post:'ب.الفطار', window:[{s:'04:30',e:'09:30'}] },
  'غداء': { pre:'ق.الغدا',  post:'ب.الغدا',  window:[{s:'11:00',e:'15:30'}] },
  'عشاء': { pre:'ق.العشا',  post:'ب.العشا',  window:[{s:'17:00',e:'21:30'}] },
  'سناك': { pre:'سناك',     post:'سناك',     window:[{s:'00:00',e:'23:59'}] }
};
const SLOTS_ORDER = ["الاستيقاظ","ق.الفطار","ب.الفطار","ق.الغدا","ب.الغدا","ق.العشا","ب.العشا","سناك","ق.النوم","أثناء النوم","ق.الرياضة","ب.الرياضة"];

function glLevel(gl){ if (gl < 10) return {cls:'low',text:'منخفض'}; if (gl < 20) return {cls:'medium',text:'متوسط'}; return {cls:'high',text:'مرتفع'}; }
function updateGLBadge(totalGL){ const {cls,text} = glLevel(totalGL||0); if(!tGLBadge) return; tGLBadge.className = `gl-badge ${cls}`; tGLBadge.textContent = text; }

/* ========== تهيئة أولية ========== */
(function init(){
  if (mealDateEl){ mealDateEl.value = todayStr(); }
  if (tableDateEl){ tableDateEl.textContent = mealDateEl.value; }
  backBtn?.addEventListener('click', ()=> history.back());
})();

/* ========== جلسة + تحميل بيانات الطفل ========== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  childData = snap.data();

  // إعدادات الكارب الصافي الافتراضية
  if (childData.useNetCarbs === undefined) childData.useNetCarbs = true;
  if (!childData.netCarbRule) childData.netCarbRule = 'fullFiber';

  childNameEl && (childNameEl.textContent = childData.name || 'طفل');
  childMetaEl && (childMetaEl.textContent = `${childData.gender || '-'} • العمر: ${calcAge(childData.birthDate)} سنة`);

  await loadMeasurements();
  await loadMealsOfDay();
  recalcAll();
});

/* ========== القياسات اليومية ========== */
async function loadMeasurements(){
  const d = mealDateEl.value;
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, where('date','==', d), orderBy('when','asc'));
  const snap= await getDocs(qy);
  cachedMeasurements = [];
  snap.forEach(s=>{
    const m = s.data();
    const when = m.when?.toDate ? m.when.toDate() : (m.when ? new Date(m.when) : null);
    const mmol = m.value_mmol ?? ((m.value_mgdl||0)/18);
    cachedMeasurements.push({
      id: s.id, slot: m.slot || '-', when,
      value_mmol: Number(mmol || 0), value_mgdl: m.value_mgdl ?? Math.round((mmol||0)*18)
    });
  });
  populateReadingSelects();
}
function inWindow(dateObj, win){
  if(!dateObj || !win) return true;
  const [h,m] = [dateObj.getHours(), dateObj.getMinutes()];
  const cur = h*60+m;
  const [sh,sm] = win.s.split(':').map(Number);
  const [eh,em] = win.e.split(':').map(Number);
  const start = sh*60+sm, end = eh*60+em;
  return cur>=start && cur<=end;
}
function populateReadingSelects(){
  const type = mealTypeEl.value;
  const pref  = SLOT_MAP[type]?.pre || null;
  const postf = SLOT_MAP[type]?.post || null;
  const win   = SLOT_MAP[type]?.window?.[0];

  const sorted = [...cachedMeasurements].sort((a,b)=>{
    const ia = SLOTS_ORDER.indexOf(a.slot);
    const ib = SLOTS_ORDER.indexOf(b.slot);
    if (ia!==ib) return ia-ib;
    const ta = a.when ? a.when.getTime() : 0;
    const tb = b.when ? b.when.getTime() : 0;
    return ta - tb;
  });

  const build = (prefSlot)=>{
    const opts = ['<option value="">— لا يوجد —</option>'];
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (prefSlot && m.slot===prefSlot && inWindow(m.when, win)){ opts.push(`<option value="${m.id}">${esc(label)} (مفضّل)</option>`); }
    });
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (inWindow(m.when, win) && (!prefSlot || m.slot!==prefSlot)){ opts.push(`<option value="${m.id}">${esc(label)}</option>`); }
    });
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (!inWindow(m.when, win)){ opts.push(`<option value="${m.id}">${esc(label)} (خارج النطاق)</option>`); }
    });
    return opts.join('');
  };

  preReadingEl.innerHTML  = build(pref);
  postReadingEl.innerHTML = build(postf);
}

/* ========== وجبات اليوم ========== */
async function loadMealsOfDay(){
  const d = mealDateEl.value;
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
  const snap = await getDocs(query(ref, where('date','==', d), orderBy('createdAt','asc')));
  const rows = []; snap.forEach(s=> rows.push({ id:s.id, ...s.data() }));
  renderMealsList(rows);
}
function renderMealsList(rows){
  const typeFilter = filterTypeEl.value || 'الكل';
  const list = typeFilter==='الكل' ? rows : rows.filter(r=> (r.type||'')===typeFilter);

  mealsListEl.innerHTML = '';
  if(!list.length){ noMealsEl.classList.remove('hidden'); return; }
  noMealsEl.classList.add('hidden');

  list.forEach(r=>{
    const card = document.createElement('div');
    card.className = 'meal-card';
    const doseWarn = r.suggestedMealDose && r.appliedMealDose!=null && Math.abs(r.appliedMealDose - r.suggestedMealDose) >= 1.5;
    card.innerHTML = `
      <div class="type">${esc(r.type||'-')}</div>
      <div>كارب: <strong>${round1(r.totals?.carbs_g||0)}</strong> g • صافي: <strong>${round1(r.totals?.netCarbs_g||0)}</strong> g</div>
      <div>جرعة مقترحة: <span class="dose-badge ${doseWarn?'danger':''}">${r.suggestedMealDose ?? '-' } U</span> ${r.appliedMealDose!=null?`• المعطاة: <strong>${r.appliedMealDose}</strong> U`:''}</div>
      <div>${r.preReading?.id?`ق.الوجبة ✔️`:'ق.الوجبة —'} ${r.postReading?.id?` • ب.الوجبة ✔️`:''}</div>
      <div class="actions">
        <button class="editBtn">تعديل</button>
        <button class="delBtn secondary">حذف</button>
      </div>
    `;
    card.querySelector('.editBtn').addEventListener('click', ()=> editMeal(r));
    card.querySelector('.delBtn').addEventListener('click', ()=> deleteMeal(r));
    mealsListEl.appendChild(card);
  });
}

/* ========== منطقة إنشاء الوجبة ========== */
addItemBtn?.addEventListener('click', openPicker);
repeatLastBtn?.addEventListener('click', repeatLastMealTemplate);

function addItemRow(item){
  const row = {
    id: crypto.randomUUID(),
    name: item.name,
    unit: 'grams',           // grams | household
    qty: 100,
    measure: item.measures?.[0]?.name || '',
    measures: Array.isArray(item.measures) ? item.measures : [],
    per100: {
      carbs: toNumber(item.nutrPer100?.carbs_g),
      fiber: toNumber(item.nutrPer100?.fiber_g),
      calories: toNumber(item.nutrPer100?.cal_kcal),
      protein: toNumber(item.nutrPer100?.protein_g),
      fat: toNumber(item.nutrPer100?.fat_g)
    },
    gi: (item.gi==null || isNaN(Number(item.gi))) ? null : Number(item.gi),
    tags: item.tags || [],
    calc: {}
  };
  currentItems.push(row);
  renderItems(); recalcAll();
}
function renderItems(){
  itemsBodyEl.innerHTML = '';
  currentItems.forEach((r)=>{
    // ✅ احسبي قيم الصف قبل البناء
    recomputeRow(r);

    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = `
      <div>${esc(r.name)}</div>
      <div>
        <select data-id="${r.id}" data-k="unit">
          <option value="grams" ${r.unit==='grams'?'selected':''}>جرامات</option>
          <option value="household" ${r.unit==='household'?'selected':''}>تقدير بيتي</option>
        </select>
      </div>
      <div><input type="number" step="0.1" value="${r.qty}" data-id="${r.id}" data-k="qty"/></div>
      <div>
        <select data-id="${r.id}" data-k="measure" ${r.unit==='household'?'':'disabled'}>
          ${(r.measures||[]).map(m=>`<option ${m.name===r.measure?'selected':''}>${esc(m.name)}</option>`).join('')}
        </select>
      </div>
      <div class="g">${round1(r.calc.grams||0)}</div>
      <div class="c">${round1(r.calc.carbs||0)}</div>
      <div class="f">${round1(r.calc.fiber||0)}</div>
      <div class="n">${round1(r.calc.netCarbs||0)}</div>
      <div class="k">${round1(r.calc.cal||0)}</div>
      <div class="p">${round1(r.calc.prot||0)}</div>
      <div class="fa">${round1(r.calc.fat||0)}</div>
      <div><button class="secondary del" data-id="${r.id}">حذف</button></div>
    `;
    itemsBodyEl.appendChild(el);
  });

  // ربط الأحداث
  itemsBodyEl.querySelectorAll('select, input').forEach(inp=>{
    inp.addEventListener('change', onRowChange);
  });
  itemsBodyEl.querySelectorAll('.del').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.currentTarget.dataset.id;
      const i = currentItems.findIndex(x=>x.id===id);
      if (i>-1){ currentItems.splice(i,1); renderItems(); recalcAll(); }
    });
  });

  // ✅ بعد ما رسمنا الصفوف والقيم مظبوطة، حدّثي الإجماليات
  recalcAll();
}


  // ربط الحقول
  itemsBodyEl.querySelectorAll('select, input').forEach(inp=>{
    inp.addEventListener('change', onRowChange);
  });
  itemsBodyEl.querySelectorAll('.del').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.currentTarget.dataset.id;
      const i = currentItems.findIndex(x=>x.id===id);
      if (i>-1){ currentItems.splice(i,1); renderItems(); recalcAll(); }
    });
  });

  // إعادة حساب
  currentItems.forEach(recomputeRow);
}
function onRowChange(e){
  const id = e.target.dataset.id;
  const k  = e.target.dataset.k;
  const row= currentItems.find(r=> r.id===id);
  if (!row) return;
  if (k==='unit'){ row.unit = e.target.value; }
  if (k==='qty'){ row.qty = toNumber(e.target.value); }
  if (k==='measure'){ row.measure = e.target.value; }
  // تفعيل/تعطيل measure
  const sel = e.target.parentElement?.parentElement?.querySelector('select[data-k="measure"]');
  if (k==='unit' && sel){ sel.disabled = (row.unit!=='household'); }
  recomputeRow(row); recalcAll();
}
function recomputeRow(r){
  let grams = 0;
  if (r.unit==='grams'){ grams = toNumber(r.qty); }
  else{
    const m = (r.measures||[]).find(mm=> mm.name===r.measure) || (r.measures||[])[0];
    grams = m ? (toNumber(m.grams) * toNumber(r.qty)) : 0;
  }
  const factor = grams/100;
  const carbs = r.per100.carbs * factor;
  const fiber = r.per100.fiber * factor;
  const net   = childData.netCarbRule==='halfFiber' ? (carbs - 0.5*fiber) : (carbs - fiber);
  const cal   = r.per100.calories * factor;
  const prot  = r.per100.protein * factor;
  const fat   = r.per100.fat * factor;

  let gl = 0;
  if (r.gi && carbs>0){ gl = (r.gi * carbs)/100; }

  r.calc = { grams, carbs, fiber, netCarbs: Math.max(0,net), cal, prot, fat, gl };
}
function recalcAll(){
  let tg=0, tc=0, tf=0, tn=0, kcal=0, pr=0, ft=0, tgl=0;
  currentItems.forEach(r=>{
    tg += r.calc.grams||0; tc += r.calc.carbs||0; tf += r.calc.fiber||0; tn += r.calc.netCarbs||0;
    kcal += r.calc.cal||0; pr += r.calc.prot||0; ft += r.calc.fat||0; tgl += r.calc.gl||0;
  });
  tGramsEl.textContent = round1(tg);
  tCarbsEl.textContent = round1(tc);
  tFiberEl.textContent = round1(tf);
  tNetEl.textContent   = round1(tn);
  tCalEl.textContent   = round1(kcal);
  tProtEl.textContent  = round1(pr);
  tFatEl.textContent   = round1(ft);
  tGLEl.textContent    = round1(tgl);
  updateGLBadge(tgl);

  // الجرعة (صافي/كلي)
  const cr = Number(childData.carbRatio || 12);  // g/U
  const useNet = childData.useNetCarbs!==false;
  const carbsForDose = useNet ? tn : tc;
  const dose = carbsForDose>0 && cr>0 ? (carbsForDose/cr) : 0;
  suggestedDoseEl.textContent = roundHalf(dose);
  doseExplainEl.textContent = useNet ? ' (اعتمادًا على الكارب الصافي)' : ' (اعتمادًا على الكارب الكلي)';
  doseRangeEl.textContent = dose ? `U ${roundHalf(Math.max(0,dose-0.5))}–${roundHalf(dose+0.5)}` : '—';
}

/* ========== حفظ/تعديل/حذف الوجبة ========== */
saveMealBtn?.addEventListener('click', saveMeal);
resetMealBtn?.addEventListener('click', ()=> resetForm(true));
printDayBtn?.addEventListener('click', ()=> window.print());

async function saveMeal(){
  if (!currentItems.length){ showToast('أضيفي مكونات أولًا'); return; }
  const d = mealDateEl.value;
  const type = mealTypeEl.value;

  const payload = {
    date: d,
    type,
    items: currentItems.map(r=>({
      name:r.name, unit:r.unit, qty:r.qty, measure:r.measure, measures:r.measures,
      per100:r.per100, gi:r.gi, tags:r.tags, calc:r.calc
    })),
    totals: {
      grams_g: Number(tGramsEl.textContent)||0,
      carbs_g: Number(tCarbsEl.textContent)||0,
      fiber_g: Number(tFiberEl.textContent)||0,
      netCarbs_g: Number(tNetEl.textContent)||0,
      calories_kcal: Number(tCalEl.textContent)||0,
      protein_g: Number(tProtEl.textContent)||0,
      fat_g: Number(tFatEl.textContent)||0,
      gl_total: Number(tGLEl.textContent)||0
    },
    preReading: preReadingEl.value ? { id: preReadingEl.value } : null,
    postReading: postReadingEl.value ? { id: postReadingEl.value } : null,
    suggestedMealDose: Number(suggestedDoseEl.textContent) || 0,
    appliedMealDose: appliedDoseEl.value ? Number(appliedDoseEl.value) : null,
    notes: mealNotesEl.value || null,
    createdAt: serverTimestamp()
  };

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
  if (editingMealId){
    await updateDoc(doc(ref, editingMealId), payload);
    showToast('تم تحديث الوجبة');
  }else{
    await addDoc(ref, payload);
    showToast('تم حفظ الوجبة');
  }
  editingMealId = null;
  await loadMealsOfDay(); resetForm(false);
}
async function editMeal(r){
  editingMealId = r.id;
  mealTypeEl.value = r.type || 'فطور';
  preReadingEl.value = r.preReading?.id || '';
  postReadingEl.value = r.postReading?.id || '';
  appliedDoseEl.value = r.appliedMealDose ?? '';
  mealNotesEl.value   = r.notes || '';

  currentItems = (r.items||[]).map(x=> ({...structuredClone(x), id: crypto.randomUUID()}));
  renderItems(); recalcAll();
  window.scrollTo({ top: 0, behavior:'smooth' });
}
async function deleteMeal(r){
  if (!confirm('حذف الوجبة؟')) return;
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/meals/${r.id}`);
  await deleteDoc(ref);
  showToast('تم الحذف'); await loadMealsOfDay();
}
function resetForm(clear=true){
  if (clear){ currentItems = []; renderItems(); recalcAll(); }
  editingMealId = null; appliedDoseEl.value=''; mealNotesEl.value='';
}

/* ========== مودال مكتبة الأصناف ========== */
function bindPickerOnce(){
  // حماية: لو العناصر غير موجودة لا نربط (لعلاج addEventListener على null)
  if (!pickerModal || !closePicker || !pickSearchEl || !pickCategoryEl) return;
  if (bindPickerOnce.__bound) return;
  closePicker.addEventListener('click', ()=> pickerModal.classList.add('hidden'));
  pickSearchEl.addEventListener('input', debounce(applyPickerFilters, 250));
  pickCategoryEl.addEventListener('change', applyPickerFilters);
  bindPickerOnce.__bound = true;
}
async function openPicker(){
  bindPickerOnce();
  if (!pickerModal){ alert('كتلة مودال المكتبة غير موجودة في الصفحة'); return; }
  pickerModal.classList.remove('hidden');
  pickSearchEl.value='';
  pickCategoryEl.value='الكل';
  await loadFoodItems();
  applyPickerFilters();
}
async function loadFoodItems(){
  if (cachedFood.length) return;
  const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
  const snap = await getDocs(ref);
  cachedFood = [];
  snap.forEach(s=>{
    const d = s.data();
    cachedFood.push({
      id: s.id,
      name: d.name || d.measures?.[0]?.name || 'صنف',
      nutrPer100: {
        carbs_g: Number(d.nutrPer100?.carbs_g ?? 0),
        fiber_g: Number(d.nutrPer100?.fiber_g ?? 0),
        cal_kcal: Number(d.nutrPer100?.cal_kcal ?? 0),
        protein_g: Number(d.nutrPer100?.protein_g ?? 0),
        fat_g: Number(d.nutrPer100?.fat_g ?? 0)
      },
      measures: d.measures || [],
      gi: Number(d.gi ?? 0) || null,
      tags: d.tags || [],
      category: d.category || 'أخرى'
    });
  });
}
function applyPickerFilters(){
  if (!pickerGrid || !pickerEmpty) return;
  const q  = (pickSearchEl.value||'').trim().toLowerCase();
  const cat= pickCategoryEl.value || 'الكل';

  let list = cachedFood;
  if (cat && cat!=='الكل'){ list = list.filter(x=> (x.category||'').includes(cat)); }

  if (q){
    if (q.startsWith('#')){
      const tag = q.slice(1);
      list = list.filter(x=> (x.tags||[]).some(t=> (t||'').toLowerCase().includes(tag)));
    }else{
      list = list.filter(x=> (x.name||'').toLowerCase().includes(q));
    }
  }

  renderPickerGrid(list);
}
function renderPickerGrid(list){
  if (!pickerGrid || !pickerEmpty) return;
  pickerGrid.innerHTML = '';
  if (!list.length){ pickerEmpty.classList.remove('hidden'); return; }
  pickerEmpty.classList.add('hidden');

  list.forEach(it=>{
    const card = document.createElement('div');
    card.className = 'food-card';
    const info = `
      <div>
        <div><strong>${esc(it.name)}</strong></div>
        <div class="meta">كارب/100g: ${round1(it.nutrPer100.carbs_g)} • ألياف: ${round1(it.nutrPer100.fiber_g)}${it.gi?` • GI: ${it.gi}`:''}</div>
      </div>
    `;
    const btn = document.createElement('button'); btn.className='add'; btn.textContent='إضافة';
    btn.addEventListener('click', ()=>{
      addItemRow(it);
      pickerModal.classList.add('hidden');
    });
    card.innerHTML = info; card.appendChild(btn);
    pickerGrid.appendChild(card);
  });
}

/* ========== تكرار آخر وجبة كقالب ========== */
async function repeatLastMealTemplate(){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
  const sn = await getDocs(query(ref, orderBy('createdAt','desc'), limit(1)));
  if (sn.empty){ showToast('لا توجد وجبة سابقة'); return; }
  const last = sn.docs[0].data();
  currentItems = (last.items||[]).map(x=> ({...structuredClone(x), id: crypto.randomUUID()}));
  renderItems(); recalcAll(); showToast('تم تكرار آخر وجبة');
}

/* ========== مساعد الوجبة (Gemini) ========== */
aiHelperBtn?.addEventListener('click', ()=>{
  aiModal.classList.remove('hidden');
  const k = localStorage.getItem('gemini_api_key') || '';
  aiKeyEl.value = k;
});
closeAi?.addEventListener('click', ()=> aiModal.classList.add('hidden'));
aiClearBtn?.addEventListener('click', ()=> { aiOutEl.innerHTML = '— تم المسح —'; });

aiRunBtn?.addEventListener('click', runAiHelper);

async function runAiHelper(){
  try{
    const key = (aiKeyEl.value||'').trim();
    if (!key){ alert('ضعي مفتاح Gemini أولًا'); return; }
    localStorage.setItem('gemini_api_key', key);

    if (!currentItems.length){
      aiOutEl.innerHTML = 'لا توجد مكوّنات حالياً — أضيفي صنفًا ثم أعيدي المحاولة.';
      return;
    }

    const payload = buildMealSummary();
    const goal = aiGoalEl.value || '';
    const note = (aiNoteEl.value||'').trim();

    aiOutEl.innerHTML = '⏳ جارٍ توليد الاقتراحات…';

    // تحميل الـ SDK (ESM) — الصيغة المتوافقة
    const { GoogleGenerativeAI } = await import('https://cdn.jsdelivr.net/npm/@google/generative-ai/dist/index.min.mjs');
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const sys = `
أنت مساعد تغذية للسكري من النوع الأول للأطفال. ارجع JSON **صالح فقط** بدون أي نص خارج JSON:
{
 "explain": "جملة مختصرة",
 "suggestions": [
   { "type":"adjustQuantity", "itemName":"...", "newGrams": 120, "reason":"..." },
   { "type":"replace", "itemName":"...", "withTags":["حبوب_كاملة"], "reason":"..." },
   { "type":"addItem", "name":"...", "tags":["خضار","ألياف"], "grams": 80, "reason":"..." }
 ]
}
الشروط: لا Markdown، لا كود، JSON فقط. إذا لا اقتراحات: {"explain":"لا اقتراحات","suggestions":[]}
    `.trim();

    const prompt = `
الهدف: ${goal || 'عام'}
تعليمات إضافية: ${note || 'لا'}
بيانات الوجبة (JSON):
${JSON.stringify(payload, null, 2)}
    `.trim();

    // ✅ نص مباشر — بدلاً من role/parts (اللي سبّبت 400)
    const res = await model.generateContent(sys + "\n\n" + prompt);
    const text = res?.response?.text?.() || '';

    // استخراج JSON
    const jsonText = (() => {
      const t = text.trim();
      if (t.startsWith('{') && t.endsWith('}')) return t;
      const m = t.match(/\{[\s\S]*\}/);
      return m ? m[0] : '';
    })();

    if (!jsonText) {
      aiOutEl.innerHTML = 'تعذّر فهم استجابة الذكاء الاصطناعي.';
      console.error('AI raw:', text);
      return;
    }

    let data;
    try{
      data = JSON.parse(jsonText);
    }catch(e){
      aiOutEl.innerHTML = 'تعذّر تحليل JSON المُستلم.';
      console.error('AI parse error:', jsonText);
      return;
    }

    renderAiSuggestions(data);

  }catch(err){
    console.error(err);
    aiOutEl.innerHTML = 'حدث خطأ أثناء طلب الذكاء الاصطناعي.';
  }
}
function buildMealSummary(){
  const items = currentItems.map(r=>({
    name: r.name,
    grams: round1(Number(r.calc?.grams||0)),
    carbs: round1(Number(r.calc?.carbs||0)),
    fiber: round1(Number(r.calc?.fiber||0)),
    netCarbs: round1(Number(r.calc?.netCarbs||0)),
    gi: (r.gi==null || isNaN(Number(r.gi))) ? null : Number(r.gi),
    gl: round1(Number(r.calc?.gl||0))
  }));

  const totals = {
    grams: Number(tGramsEl.textContent)||0,
    carbs: Number(tCarbsEl.textContent)||0,
    fiber: Number(tFiberEl.textContent)||0,
    netCarbs: Number(tNetEl.textContent)||0,
    cal: Number(tCalEl.textContent)||0,
    prot: Number(tProtEl.textContent)||0,
    fat: Number(tFatEl.textContent)||0,
    gl: Number(tGLEl.textContent)||0
  };

  const protToNet = totals.netCarbs>0 ? round1(totals.prot / totals.netCarbs) : 0;

  return {
    type: mealTypeEl.value,
    totals,
    items,
    ratios: { proteinToNetCarb: protToNet }
  };
}
function renderAiSuggestions(data){
  const explain = data?.explain || '';
  const suggs = Array.isArray(data?.suggestions) ? data.suggestions : [];

  const wrap = document.createElement('div');
  if (explain){ const p = document.createElement('div'); p.className = 'badge-soft'; p.textContent = explain; wrap.appendChild(p); }

  if (!suggs.length){
    const d = document.createElement('div'); d.className='ai-card'; d.textContent='لا توجد اقتراحات حالياً.'; wrap.appendChild(d);
  }else{
    suggs.forEach(s=>{
      const card = document.createElement('div'); card.className='ai-card';
      const title = document.createElement('h4'); card.appendChild(title);

      if (s.type==='adjustQuantity'){
        title.textContent = `تعديل كمية: ${s.itemName} → ${s.newGrams} جم`;
        const btn = document.createElement('button'); btn.className='btn'; btn.textContent='تطبيق الكمية';
        btn.onclick = ()=> applyAdjustQuantity(s.itemName, Number(s.newGrams)||0);
        if (s.reason){ const r=document.createElement('div'); r.className='tiny muted'; r.textContent=s.reason; card.appendChild(r); }
        const act=document.createElement('div'); act.className='ai-actions'; act.appendChild(btn); card.appendChild(act);
      }
      else if (s.type==='replace'){
        title.textContent = `استبدال: ${s.itemName}`;
        const btn = document.createElement('button'); btn.className='btn'; btn.textContent='فتح بدائل مناسبة';
        btn.onclick = ()=> openPickerWithTags(s.withTags||[]);
        if (s.reason){ const r=document.createElement('div'); r.className='tiny muted'; r.textContent=s.reason; card.appendChild(r); }
        const chips=document.createElement('div'); (s.withTags||[]).forEach(t=>{ const c=document.createElement('span'); c.className='badge-soft'; c.textContent='#'+t; chips.appendChild(c); }); card.appendChild(chips);
        const act=document.createElement('div'); act.className='ai-actions'; act.appendChild(btn); card.appendChild(act);
      }
      else if (s.type==='addItem'){
        title.textContent = `إضافة صنف: ${s.name} (${s.grams} جم)`;
        const btn = document.createElement('button'); btn.className='btn'; btn.textContent='ابحث في المكتبة';
        btn.onclick = ()=> openPickerWithSearch(s.name);
        if (s.reason){ const r=document.createElement('div'); r.className='tiny muted'; r.textContent=s.reason; card.appendChild(r); }
        const chips=document.createElement('div'); (s.tags||[]).forEach(t=>{ const c=document.createElement('span'); c.className='badge-soft'; c.textContent='#'+t; chips.appendChild(c); }); card.appendChild(chips);
        const act=document.createElement('div'); act.className='ai-actions'; act.appendChild(btn); card.appendChild(act);
      } else {
        title.textContent = 'معلومة';
        const r=document.createElement('div'); r.className='tiny muted'; r.textContent=JSON.stringify(s);
        card.appendChild(r);
      }

      wrap.appendChild(card);
    });
  }

  aiOutEl.innerHTML = '';
  aiOutEl.appendChild(wrap);
}
function applyAdjustQuantity(itemName, newGrams){
  if (!(newGrams>0)) return;
  const row = currentItems.find(r=> (r.name||'').trim() === (itemName||'').trim());
  if (!row){ showToast('لم يتم العثور على الصنف المقترح'); return; }
  if (row.unit==='household' && row.measures?.length){
    const m = row.measures.find(mm=> mm.name===row.measure) || row.measures[0];
    row.qty = m ? round1(newGrams / (toNumber(m.grams)||1)) : row.qty;
  }else{
    row.unit = 'grams'; row.qty = newGrams;
  }
  renderItems(); recalcAll(); showToast('تم تطبيق الكمية المقترحة');
}
function openPickerWithTags(tags){
  openPicker();
  if (pickCategoryEl){ pickCategoryEl.value='الكل'; }
  if (pickSearchEl){ pickSearchEl.value = tags && tags.length ? '#'+tags[0] : ''; }
  applyPickerFilters();
}
function openPickerWithSearch(q){
  openPicker();
  if (pickCategoryEl){ pickCategoryEl.value='الكل'; }
  if (pickSearchEl){ pickSearchEl.value = q || ''; }
  applyPickerFilters();
}

/* ========== فلاتر/أحداث عامة للصفحة ========== */
filterTypeEl?.addEventListener('change', async ()=>{ await loadMealsOfDay(); });
mealTypeEl?.addEventListener('change', ()=>{ populateReadingSelects(); recalcAll(); });
mealDateEl?.addEventListener('change', async ()=>{
  if (mealDateEl.value > todayStr()){ mealDateEl.value = todayStr(); }
  tableDateEl && (tableDateEl.textContent = mealDateEl.value);
  await loadMeasurements();
  await loadMealsOfDay();
  recalcAll();
});
preReadingEl?.addEventListener('change', ()=> recalcAll());
postReadingEl?.addEventListener('change', ()=> {/* للحفظ فقط */});
