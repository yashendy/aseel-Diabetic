// js/meals.js (v7) — أهداف كارب لكل نوع + فلترة قياسات ق./ب. + وحدة mg/dL أو mmol/L + AI عبر Function (خطة أ) + باقي مزايا v6

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// (اختياري) لو فعّلتِ Functions على المشروع تقدري تستوردي callables
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js";

/* ========= عناصر عامة ========= */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const toastEl       = document.getElementById('toast');
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
const settingsLink  = document.getElementById('settingsLink');

const tGramsEl     = document.getElementById('tGrams');
const tCarbsEl     = document.getElementById('tCarbs');
const tFiberEl     = document.getElementById('tFiber');
const tNetCarbsEl  = document.getElementById('tNetCarbs');
const tCalEl       = document.getElementById('tCal');
const tProtEl      = document.getElementById('tProt');
const tFatEl       = document.getElementById('tFat');
const tGLEl        = document.getElementById('tGL');
const useNetCarbsEl= document.getElementById('useNetCarbs');

const goalTypeEl   = document.getElementById('goalType');
const goalMinEl    = document.getElementById('goalMin');
const goalMaxEl    = document.getElementById('goalMax');
const unitChipEl   = document.getElementById('unitChip');
const carbProgress = document.getElementById('carbProgress');
const carbStateEl  = document.getElementById('carbState');
const reachTargetBtn = document.getElementById('reachTargetBtn');

const suggestedDoseEl = document.getElementById('suggestedDose');
const doseExplainEl   = document.getElementById('doseExplain');
const doseRangeEl     = document.getElementById('doseRange');
const appliedDoseEl   = document.getElementById('appliedDose');
const mealNotesEl     = document.getElementById('mealNotes');

const saveMealBtn     = document.getElementById('saveMealBtn');
const resetMealBtn    = document.getElementById('resetMealBtn');
const printDayBtn     = document.getElementById('printDayBtn');

const tableDateEl     = document.getElementById('tableDate');
const filterTypeEl    = document.getElementById('filterType');
const mealsListEl     = document.getElementById('mealsList');
const noMealsEl       = document.getElementById('noMeals');

/* مودال الأصناف */
const pickerModal     = document.getElementById('pickerModal');
const closePicker     = document.getElementById('closePicker');
const pickSearchEl    = document.getElementById('pickSearch');
const pickCategoryEl  = document.getElementById('pickCategory');
const pickerGrid      = document.getElementById('pickerGrid');
const pickerEmpty     = document.getElementById('pickerEmpty');

/* مودال AI نصّي */
const aiBtn     = document.getElementById('aiBtn');
const aiModal   = document.getElementById('aiModal');
const aiClose   = document.getElementById('aiClose');
const aiText    = document.getElementById('aiText');
const aiAnalyze = document.getElementById('aiAnalyze');
const aiApply   = document.getElementById('aiApply');
const aiResultsEl = document.getElementById('aiResults');

/* مودال الوجبات الجاهزة */
const presetBtn   = document.getElementById('presetBtn');
const presetSaveBtn = document.getElementById('presetSaveBtn');
const presetModal = document.getElementById('presetModal');
const presetClose = document.getElementById('presetClose');
const presetGrid  = document.getElementById('presetGrid');
const presetEmpty = document.getElementById('presetEmpty');
const presetTabs  = document.querySelectorAll('.preset-tabs .tab');

/* ========= حالة ========= */
let currentUser, childData;
let editingMealId = null;
let currentItems = [];
let cachedFood = [];
let cachedMeasurements = [];
let lastUsedMap = {};
let aiSuggestions = [];
let cachedPresets = [];
let activePresetType = 'فطار';
let functions; let aiSuggestFn; // Callable if available

/* ========= أدوات ========= */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); }
setMaxToday(mealDateEl);

function esc(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function toNumber(x){ const n = Number(String(x ?? '').replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round((x||0)*10)/10; }
function roundHalf(x){ return Math.round((x||0)*2)/2; }
function showToast(msg){ toastEl.innerHTML = `<div class="msg">${esc(msg)}</div>`; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 2200); }

function typeKeyFromArabic(t){ return t==='فطار'?'breakfast': t==='غدا'?'lunch': t==='عشا'?'dinner':'snack'; }
function typeArabicFromKey(k){ return k==='breakfast'?'فطار': k==='lunch'?'غدا': k==='dinner'?'عشا':'سناك'; }

const SLOT_LABELS = {
  'فطار': { pre:'ق.الفطار', post:'ب.الفطار', win:[{s:'04:30',e:'09:30'}] },
  'غدا':  { pre:'ق.الغدا',  post:'ب.الغدا',  win:[{s:'11:00',e:'15:30'}] },
  'عشا':  { pre:'ق.العشا',  post:'ب.العشا',  win:[{s:'17:00',e:'21:30'}] },
  'سناك': { pre:'سناك',     post:'سناك',     win:[{s:'00:00',e:'23:59'}] }
};

function inWindow(dateObj, win){
  if(!dateObj || !win?.length) return true;
  const [h,m] = [dateObj.getHours(), dateObj.getMinutes()];
  const cur = h*60+m;
  const [{s,e}] = win;
  const [sh,sm] = s.split(':').map(Number);
  const [eh,em] = e.split(':').map(Number);
  const start = sh*60+sm, end = eh*60+em;
  return cur>=start && cur<=end;
}

/* ========= تهيئة ========= */
(function init(){
  mealDateEl.value = todayStr();
  tableDateEl.textContent = mealDateEl.value;
  backBtn.addEventListener('click', ()=> history.back());
})();

/* ========= جلسة + طفل ========= */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;
  settingsLink.href = `child-edit.html?child=${encodeURIComponent(childId)}`;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `${childData.gender || '-'} • العمر: ${calcAge(childData.birthDate)} سنة`;

  // وحدة العرض
  unitChipEl.textContent = `وحدة: ${childData.glucoseUnit==='mmol'?'mmol/L':'mg/dL'}`;

  // تهيئة Functions (لو متاحة)
  try{
    functions = getFunctions(); aiSuggestFn = httpsCallable(functions, 'aiSuggestFromText');
  }catch(_){ /* optional */ }

  lastUsedMap = loadLastUsed();
  await loadMeasurements();
  await loadMealsOfDay();
  await ensureFoodCache();
  await loadPresets();
  loadDraft();
  applyCarbGoalUI(); // هدف الكارب حسب النوع
  recalcAll();
});

function calcAge(bd){
  if(!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

/* ========= القياسات ========= */
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
      value_mmol: Number(mmol || 0),
      value_mgdl: m.value_mgdl ?? Math.round((mmol||0)*18)
    });
  });
  populateReadingSelects();
}

function populateReadingSelects(){
  const type = mealTypeEl.value;
  const pref  = SLOT_LABELS[type]?.pre || null;
  const postf = SLOT_LABELS[type]?.post || null;
  const win   = SLOT_LABELS[type]?.win;

  const preferredUnit = (childData?.glucoseUnit==='mmol')?'mmol':'mgdl';

  const makeLabel = (m)=>{
    const time = m.when? `${pad(m.when.getHours())}:${pad(m.when.getMinutes())}` : '';
    const valStr = preferredUnit==='mmol' ? `${m.value_mmol.toFixed(1)} mmol/L` : `${m.value_mgdl} mg/dL`;
    return `${m.slot} • ${valStr}${time?` • ${time}`:''}`;
  };

  const sorted = [...cachedMeasurements].sort((a,b)=>{
    const ta = a.when ? a.when.getTime() : 0;
    const tb = b.when ? b.when.getTime() : 0;
    return ta - tb;
  });

  const build = (isPre, prefSlot)=>{
    const opts = ['<option value="">— لا يوجد —</option>'];
    // قسم 1: مطابق النوع داخل النافذة
    sorted.forEach(m=>{
      const inWin = inWindow(m.when, win);
      if (prefSlot && m.slot===prefSlot && inWin){
        opts.push(`<option value="${m.id}">${esc(makeLabel(m))} (مفضّل)</option>`);
      }
    });
    // قسم 2: مطابق النوع خارج النافذة
    sorted.forEach(m=>{
      const inWin = inWindow(m.when, win);
      if (prefSlot && m.slot===prefSlot && !inWin){
        opts.push(`<option value="${m.id}">${esc(makeLabel(m))} (خارج النطاق)</option>`);
      }
    });
    // قسم 3: باقي اليوم
    sorted.forEach(m=>{
      if (!prefSlot || m.slot===prefSlot) return;
      opts.push(`<option value="${m.id}">${esc(makeLabel(m))}</option>`);
    });
    return opts.join('');
  };

  preReadingEl.innerHTML  = build(true,  pref);
  postReadingEl.innerHTML = build(false, postf);
}

/* ========= وجبات اليوم ========= */
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
      <div>كارب: <strong>${round1(r.totals?.carbs_g||0)}</strong> g • سعرات: ${Math.round(r.totals?.cal_kcal||0)} kcal</div>
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

/* ========= الأصناف ========= */
async function ensureFoodCache(){
  if (cachedFood.length) return;
  const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
  const snap = await getDocs(query(ref, orderBy('nameLower','asc')));
  cachedFood = [];
  snap.forEach(d=> cachedFood.push({ id:d.id, ...d.data() }));
}

function addItemRow(itemDoc){
  const lastQty = lastUsedMap[itemDoc.id]?.qty ?? 100;
  const gi = toNumber(itemDoc?.gi) || null;
  const row = {
    itemId: itemDoc.id,
    name: itemDoc.name,
    brand: itemDoc.brand || null,
    unit: 'grams',
    qty: lastQty,
    measure: null,
    grams: lastQty,
    per100: {
      carbs: toNumber(itemDoc?.nutrPer100g?.carbs_g),
      fiber: toNumber(itemDoc?.nutrPer100g?.fiber_g),
      cal:   toNumber(itemDoc?.nutrPer100g?.cal_kcal),
      prot:  toNumber(itemDoc?.nutrPer100g?.protein_g),
      fat:   toNumber(itemDoc?.nutrPer100g?.fat_g)
    },
    gi,
    calc:{carbs:0,fiber:0,cal:0,prot:0,fat:0,gl:0},
    measures: Array.isArray(itemDoc.measures) ? itemDoc.measures.filter(m=>m.name && m.grams>0) : []
  };
  currentItems.push(row);
  renderItems(); recalcAll(); saveDraft();
}

function renderItems(){
  itemsBodyEl.innerHTML = '';
  currentItems.forEach((r, idx)=>{
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `
      <div class="name">
        <div>
          <strong>${esc(r.name)}</strong>${r.brand?` <span class="sub">(${esc(r.brand)})</span>`:''}
          ${r.gi!=null?` <span class="sub">• GI: ${r.gi}</span>`:''}
        </div>
        <div class="chips"><span class="gl-chip" data-chip="gl">GL: —</span></div>
      </div>
      <div>
        <select class="unit">
          <option value="grams" ${r.unit==='grams'?'selected':''}>جرام</option>
          <option value="household" ${r.unit==='household'?'selected':''}>تقدير بيتي</option>
        </select>
      </div>
      <div><input type="number" step="any" class="qty" value="${r.qty}" min="0" max="10000"></div>
      <div>
        <select class="measure">
          ${r.measures.map(m=>`<option value="${esc(m.name)}" ${r.measure===m.name?'selected':''}>${esc(m.name)} (${m.grams} جم)</option>`).join('')}
        </select>
      </div>
      <div><span class="grams">${round1(r.grams)}</span></div>
      <div><span class="carbs">${round1(r.calc.carbs)}</span></div>
      <div><span class="fiber">${round1(r.calc.fiber)}</span></div>
      <div><span class="cal">${Math.round(r.calc.cal)}</span></div>
      <div><span class="prot">${round1(r.calc.prot)}</span></div>
      <div><span class="fat">${round1(r.calc.fat)}</span></div>
      <div><button class="del">حذف</button></div>
    `;

    const unitSel = div.querySelector('.unit');
    const qtyInp  = div.querySelector('.qty');
    const measSel = div.querySelector('.measure');
    const delBtn  = div.querySelector('.del');

    measSel.disabled = (r.unit !== 'household');
    if (r.unit==='household' && !r.measure && r.measures.length) r.measure = r.measures[0].name;

    unitSel.addEventListener('change', ()=>{
      r.unit = unitSel.value;
      if (r.unit==='grams'){ r.measure = null; }
      else if (r.unit==='household' && r.measures.length && !r.measure){ r.measure = r.measures[0].name; }
      recomputeRow(r, div); renderItems(); recalcAll(); saveDraft();
    });

    qtyInp.addEventListener('input', ()=>{
      r.qty = Math.max(0, Math.min(10000, toNumber(qtyInp.value)));
      recomputeRow(r, div); recalcAll(); saveDraft();
    });

    measSel.addEventListener('change', ()=>{
      r.measure = measSel.value || null;
      recomputeRow(r, div); recalcAll(); saveDraft();
    });

    delBtn.addEventListener('click', ()=>{
      currentItems.splice(idx,1);
      renderItems(); recalcAll(); saveDraft();
    });

    recomputeRow(r, div);
    itemsBodyEl.appendChild(div);
  });
}

function recomputeRow(r, div){
  let grams = 0;
  if (r.unit==='grams'){ grams = r.qty; }
  else {
    const m = r.measures.find(x=> x.name===r.measure);
    grams = m ? (r.qty * m.grams) : 0;
  }
  r.grams = grams;
  r.calc.carbs = (r.per100.carbs * grams)/100;
  r.calc.fiber = (r.per100.fiber * grams)/100;
  r.calc.cal   = (r.per100.cal   * grams)/100;
  r.calc.prot  = (r.per100.prot  * grams)/100;
  r.calc.fat   = (r.per100.fat   * grams)/100;
  r.calc.gl    = r.gi ? (r.gi * (r.calc.carbs/100)) : 0;

  if (div){
    div.querySelector('.grams').textContent = round1(r.grams);
    div.querySelector('.carbs').textContent = round1(r.calc.carbs);
    div.querySelector('.fiber').textContent = round1(r.calc.fiber);
    div.querySelector('.cal').textContent   = Math.round(r.calc.cal);
    div.querySelector('.prot').textContent  = round1(r.calc.prot);
    div.querySelector('.fat').textContent   = round1(r.calc.fat);

    const chip = div.querySelector('[data-chip="gl"]');
    if (chip){
      const lv = r.calc.gl||0;
      chip.className = `gl-chip ${lv<10?'low': lv<20?'medium':'high'}`;
      chip.textContent = `GL: ${round1(lv)} — ${lv<10?'منخفض': lv<20?'متوسط':'مرتفع'}`;
    }
    const measSel = div.querySelector('.measure');
    if (measSel) measSel.disabled = (r.unit!=='household');
  }
}

/* ========= الجرعة + GL الإجمالي + الهدف ========= */
function recalcAll(){
  const totals = currentItems.reduce((a,r)=>{
    a.grams += r.grams||0;
    a.carbs += r.calc.carbs||0;
    a.fiber += r.calc.fiber||0;
    a.cal   += r.calc.cal||0;
    a.prot  += r.calc.prot||0;
    a.fat   += r.calc.fat||0;
    a.gl    += r.calc.gl||0;
    return a;
  }, {grams:0,carbs:0,fiber:0,cal:0,prot:0,fat:0,gl:0});

  const net = Math.max(0, totals.carbs - totals.fiber);

  tGramsEl.textContent   = round1(totals.grams);
  tCarbsEl.textContent   = round1(totals.carbs);
  tFiberEl.textContent   = round1(totals.fiber);
  tNetCarbsEl.textContent= round1(net);
  tCalEl.textContent     = Math.round(totals.cal);
  tProtEl.textContent    = round1(totals.prot);
  tFatEl.textContent     = round1(totals.fat);
  if (tGLEl){ tGLEl.textContent = round1(totals.gl); updateGLBadge(totals.gl); }

  // جرعة (تعليمي)
  const carbForDose = useNetCarbsEl?.checked ? net : totals.carbs;
  const carbRatio = Number(childData?.carbRatio || 12);
  const mealDose = carbForDose>0 ? (carbForDose / carbRatio) : 0;

  let corr = 0, explain = `${useNetCarbsEl?.checked?'netCarbs':'carbs'} ${round1(carbForDose)} / CR ${carbRatio}`;
  const preId = preReadingEl.value;
  if (preId){
    const pre = cachedMeasurements.find(m=> m.id===preId);
    const mmol = pre?.value_mmol || 0;
    const nMax = Number(childData?.normalRange?.max ?? 7.8);
    const CF   = Number(childData?.correctionFactor || 0);
    if (CF>0 && mmol>nMax){
      corr = (mmol - nMax)/CF;
      explain += ` + ((pre ${mmol.toFixed(1)} - ${nMax}) / CF ${CF})`;
    }
  }
  const totalDose = roundHalf(mealDose + corr);
  suggestedDoseEl.textContent = Number.isFinite(totalDose) ? (totalDose.toFixed(1).replace('.0','')) : '0';
  doseExplainEl.textContent = `= ${mealDose.toFixed(2)} + ${corr.toFixed(2)} ⇒ تقريب ${totalDose.toFixed(1)}`;

  const range = computeDoseRange(carbForDose, carbRatio, preId);
  doseRangeEl.textContent = range ? `${range.min}–${range.max} U` : '—';

  // تقدّم الهدف
  updateGoalProgress(totals.carbs);
}

function updateGoalProgress(totalCarbs){
  const key = typeKeyFromArabic(mealTypeEl.value);
  const tgt = childData?.carbTargets?.[key] || null;
  if (!tgt){ carbProgress.style.width='0%'; carbStateEl.textContent='—'; return; }
  const min = Number(tgt.min||0), max = Number(tgt.max||0);
  const pct = max>0 ? Math.min(100, Math.round((totalCarbs / max)*100)) : 0;
  carbProgress.style.width = `${pct}%`;

  let state = '';
  if (totalCarbs < min) state = `أقل من الهدف بـ ${round1(min-totalCarbs)}g`;
  else if (totalCarbs > max) state = `أعلى من الهدف بـ ${round1(totalCarbs-max)}g`;
  else state = `داخل الهدف 🎯`;
  carbStateEl.textContent = state;
}

function applyCarbGoalUI(){
  const key = typeKeyFromArabic(mealTypeEl.value);
  const tgt = childData?.carbTargets?.[key] || null;
  goalTypeEl.textContent = mealTypeEl.value;
  goalMinEl.textContent = tgt?.min ?? '—';
  goalMaxEl.textContent = tgt?.max ?? '—';
  updateGoalProgress(Number(tCarbsEl.textContent||0));
}

useNetCarbsEl?.addEventListener('change', ()=>{ recalcAll(); saveDraft(); });

function computeDoseRange(carbs, CR, preId){
  if(!(carbs>0) || !(CR>0)) return null;
  let corr=0;
  if (preId){
    const pre = cachedMeasurements.find(m=> m.id===preId);
    const mmol = pre?.value_mmol || 0;
    const target = Number(childData?.normalRange?.max ?? 7.8);
    const CF = Number(childData?.correctionFactor || 0);
    if(CF>0 && mmol>target) corr = (mmol-target)/CF;
  }
  const low  = roundHalf( (carbs*0.9)/CR + corr );
  const high = roundHalf( (carbs*1.1)/CR + corr );
  const min = Math.max(0, Math.min(low, high));
  const max = Math.max(low, high);
  return { min: Number(min.toFixed(1)), max: Number(max.toFixed(1)) };
}

/* ========= حفظ/تعديل/حذف ========= */
saveMealBtn.addEventListener('click', saveMeal);
resetMealBtn.addEventListener('click', ()=> resetForm(false));
printDayBtn.addEventListener('click', ()=> window.print());
filterTypeEl.addEventListener('change', async ()=>{ await loadMealsOfDay(); });

mealTypeEl.addEventListener('change', ()=>{ populateReadingSelects(); applyCarbGoalUI(); recalcAll(); saveDraft(); });
mealDateEl.addEventListener('change', async ()=>{
  if (mealDateEl.value > todayStr()){ mealDateEl.value = todayStr(); }
  tableDateEl.textContent = mealDateEl.value;
  await loadMeasurements();
  await loadMealsOfDay();
  loadDraft();
  recalcAll();
});
preReadingEl.addEventListener('change', ()=>{ recalcAll(); saveDraft(); });
postReadingEl.addEventListener('change', ()=>{ saveDraft(); });

async function saveMeal(){
  if (!currentItems.length){ alert('أضف عنصرًا واحدًا على الأقل'); return; }
  const date = mealDateEl.value;
  if (!date || date>todayStr()){ alert('اختر تاريخًا صحيحًا (ليس مستقبلًا)'); return; }

  setBusy(saveMealBtn, true);

  const items = currentItems.map(r=> ({
    itemId: r.itemId, name: r.name, brand: r.brand || null,
    unit: r.unit, qty: Number(r.qty)||0, measure: r.measure || null,
    grams: round1(r.grams || 0),
    carbs_g: round1(r.calc.carbs || 0),
    fiber_g: round1(r.calc.fiber || 0),
    cal_kcal: Math.round(r.calc.cal || 0),
    protein_g: round1(r.calc.prot || 0),
    fat_g: round1(r.calc.fat || 0),
    gi: r.gi || null,
    gl: round1(r.calc.gl || 0)
  }));

  const totals = {
    grams: round1(items.reduce((a,i)=>a+i.grams,0)),
    carbs_g: round1(items.reduce((a,i)=>a+i.carbs_g,0)),
    fiber_g: round1(items.reduce((a,i)=>a+i.fiber_g,0)),
    net_carbs_g: Math.max(0, round1(items.reduce((a,i)=>a+i.carbs_g,0) - items.reduce((a,i)=>a+i.fiber_g,0))),
    cal_kcal: Math.round(items.reduce((a,i)=>a+i.cal_kcal,0)),
    protein_g: round1(items.reduce((a,i)=>a+i.protein_g,0)),
    fat_g: round1(items.reduce((a,i)=>a+i.fat_g,0)),
    gl: round1(items.reduce((a,i)=>a+i.gl,0))
  };

  items.forEach(i=> { lastUsedMap[i.itemId]={ qty:i.qty, ts:Date.now() }; });
  saveLastUsed(lastUsedMap);

  const payload = {
    date,
    type: mealTypeEl.value,
    items,
    totals,
    useNetCarbs: !!useNetCarbsEl?.checked,
    preReading: preReadingEl.value ? { id: preReadingEl.value } : null,
    postReading: postReadingEl.value ? { id: postReadingEl.value } : null,
    suggestedMealDose: Number(suggestedDoseEl.textContent) || 0,
    appliedMealDose: appliedDoseEl.value ? Number(appliedDoseEl.value) : null,
    notes: mealNotesEl.value?.trim() || null,
    updatedAt: serverTimestamp()
  };

  try{
    const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
    if (editingMealId){
      await updateDoc(doc(ref, editingMealId), payload);
      showToast('✅ تم تحديث الوجبة');
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(ref, payload);
      showToast('✅ تم حفظ الوجبة');
      saveLastMealTemplate(mealTypeEl.value, payload);
    }
    await loadMealsOfDay();
    resetForm(false);
    clearDraft();
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ');
  }finally{
    setBusy(saveMealBtn, false);
  }
}

function resetForm(restoreType=true){
  editingMealId = null;
  currentItems = [];
  itemsBodyEl.innerHTML = '';
  if (restoreType){ mealTypeEl.value = 'فطار'; }
  appliedDoseEl.value = '';
  mealNotesEl.value = '';
  preReadingEl.value = '';
  postReadingEl.value = '';
  recalcAll();
  clearDraft();
}

function editMeal(r){
  editingMealId = r.id;
  mealDateEl.value = r.date || todayStr();
  mealTypeEl.value = r.type || 'فطار';
  tableDateEl.textContent = mealDateEl.value;

  loadMeasurements().then(()=>{
    preReadingEl.value  = r.preReading?.id || '';
    postReadingEl.value = r.postReading?.id || '';
  });

  useNetCarbsEl.checked = !!r.useNetCarbs;

  currentItems = (r.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: {
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      fiber: i.grams>0 ? (i.fiber_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0
    },
    gi: i.gi ?? null,
    calc:{carbs: i.carbs_g, fiber:i.fiber_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, gl: i.gl||0},
    measures: []
  }));

  Promise.all(currentItems.map(async (row)=>{
    if (!row.itemId) return;
    const d = await getDoc(doc(db, `parents/${currentUser.uid}/foodItems/${row.itemId}`));
    if (d.exists()){
      const item = d.data();
      row.measures = Array.isArray(item.measures)? item.measures.filter(m=>m.name && m.grams>0) : [];
    }
  })).then(()=>{
    renderItems(); recalcAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function deleteMeal(r){
  if(!confirm('هل تريد حذف هذه الوجبة؟')) return;
  try{
    await deleteDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/meals/${r.id}`));
    showToast('🗑️ تم حذف الوجبة');
    await loadMealsOfDay();
  }catch(e){
    console.error(e);
    alert('تعذر حذف الوجبة');
  }
}

function setBusy(btn, busy){
  btn.disabled = !!busy;
  btn.textContent = busy ? 'جارٍ الحفظ…' : 'حفظ الوجبة';
}

/* ========= مودال الأصناف ========= */
addItemBtn.addEventListener('click', openPicker);
closePicker.addEventListener('click', ()=> pickerModal.classList.add('hidden'));
pickSearchEl.addEventListener('input', debounce(applyPickerFilters, 250));
pickCategoryEl.addEventListener('change', applyPickerFilters);
repeatLastBtn.addEventListener('click', repeatLastMealTemplate);

function openPicker(){
  pickerModal.classList.remove('hidden');
  pickSearchEl.value=''; pickCategoryEl.value='الكل';
  ensureFoodCache().then(applyPickerFilters);
}

function applyPickerFilters(){
  const q = (pickSearchEl.value||'').trim();
  const cat = pickCategoryEl.value;
  let list = [...cachedFood];
  if (cat!=='الكل'){ list = list.filter(x=> (x.category||'')===cat); }

  if (q.startsWith('#') && q.length>1){
    const tag = q.slice(1).toLowerCase();
    list = list.filter(x=> Array.isArray(x.tags) && x.tags.some(t=> String(t).toLowerCase()===tag));
  } else if (q){
    const token = q.toLowerCase();
    list = list.filter(x=>{
      return (x.name||'').toLowerCase().includes(token)
          || (x.brand||'').toLowerCase().includes(token)
          || (x.category||'').toLowerCase().includes(token)
          || (Array.isArray(x.tags)&&x.tags.some(t=> String(t).toLowerCase().includes(token)))
          || (Array.isArray(x.keywords)&&x.keywords.includes(token));
    });
  }
  renderPicker(list);
}

function renderPicker(list){
  pickerGrid.innerHTML = '';
  if(!list.length){ pickerEmpty.classList.remove('hidden'); return; }
  pickerEmpty.classList.add('hidden');

  list.forEach(x=>{
    const div = document.createElement('div');
    div.className = 'pick-card';
    const thumb = x.imageUrl ? `<img src="${esc(x.imageUrl)}" alt="">` : `<span class="pick-thumb">🍽️</span>`;
    const giTag = (x.gi!=null) ? `<span class="badge">GI: ${x.gi}</span>` : '';
    div.innerHTML = `
      <div class="pick-thumb">${thumb}</div>
      <div class="pick-meta">
        <div><strong>${esc(x.name)}</strong> ${x.brand?`<small>(${esc(x.brand)})</small>`:''}</div>
        <div class="badges">
          <span class="badge">${esc(x.category||'-')}</span>
          <span class="badge">ك/100g: ${x?.nutrPer100g?.carbs_g||0}</span>
          ${x?.nutrPer100g?.fiber_g?`<span class="badge">ألياف/100g: ${x.nutrPer100g.fiber_g}</span>`:''}
          ${giTag}
          ${(x.tags||[]).slice(0,3).map(t=>`<span class="badge">#${esc(t)}</span>`).join('')}
        </div>
        <div class="pick-actions"><button class="secondary addBtn">إضافة</button></div>
      </div>
    `;
    div.querySelector('.addBtn').addEventListener('click', ()=>{
      addItemRow({
        id:x.id,
        name:x.name, brand:x.brand||null,
        nutrPer100g: x.nutrPer100g||{carbs_g:0,fiber_g:0,cal_kcal:0,protein_g:0,fat_g:0},
        measures: Array.isArray(x.measures)? x.measures : [],
        gi: x.gi ?? null
      });
      pickerModal.classList.add('hidden');
    });
    pickerGrid.appendChild(div);
  });
}

/* ========= تكرار آخر وجبة ========= */
function saveLastMealTemplate(type, payload){
  const key = `lastMealTemplate:${currentUser?.uid||'u'}:${childId||'c'}:${type}`;
  localStorage.setItem(key, JSON.stringify({ items: payload.items || [], type }));
}
function repeatLastMealTemplate(){
  const key = `lastMealTemplate:${currentUser?.uid||'u'}:${childId||'c'}:${mealTypeEl.value||'فطار'}`;
  const raw = localStorage.getItem(key);
  if(!raw){ showToast('لا توجد وجبة محفوظة لهذا النوع'); return; }
  try{
    const d = JSON.parse(raw);
    currentItems = (d.items||[]).map(i=>({
      itemId: i.itemId, name: i.name, brand: i.brand || null,
      unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
      grams: Number(i.grams)||0,
      per100: {
        carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
        fiber: i.grams>0 ? (i.fiber_g*100/i.grams) : 0,
        cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
        prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
        fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0
      },
      gi: i.gi ?? null,
      calc:{carbs: i.carbs_g, fiber:i.fiber_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, gl: i.gl||0},
      measures: []
    }));
    renderItems(); recalcAll(); saveDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }catch(_){ showToast('تعذر استرجاع القالب'); }
}

/* ========= كاش آخر كميات ========= */
function loadLastUsed(){
  const key = `lastUsedQty:${currentUser?.uid||'u'}:${childId||'c'}`;
  try{ return JSON.parse(localStorage.getItem(key)||'{}'); }catch(_){ return {}; }
}
function saveLastUsed(map){
  const key = `lastUsedQty:${currentUser?.uid||'u'}:${childId||'c'}`;
  localStorage.setItem(key, JSON.stringify(map||{}));
}

/* ========= AI (خطة أ) + fallback محلي ========= */
aiBtn?.addEventListener('click', async ()=>{
  aiModal.classList.remove('hidden');
  aiText.focus();
  if (!cachedFood.length) await ensureFoodCache();
});
aiClose?.addEventListener('click', ()=> aiModal.classList.add('hidden'));

aiAnalyze?.addEventListener('click', async ()=>{
  const text = aiText.value.trim();
  if (!text){ aiResultsEl.innerHTML='<div class="empty">اكتبي وصفًا أولًا.</div>'; return; }

  // لو فيه Function مفعّلة هنستخدمها، وإلا fallback محلي
  try{
    if (aiSuggestFn){
      const mealType = mealTypeEl.value;
      const key = typeKeyFromArabic(mealType);
      const target = childData?.carbTargets?.[key] || null;
      const resp = await aiSuggestFn({ text, mealType, target });
      aiSuggestions = Array.isArray(resp.data?.suggestions)? resp.data.suggestions : [];
      if (!aiSuggestions.length) throw new Error('no-suggestions');
    } else {
      aiSuggestions = parseMealTextLocal(text);
    }
  }catch(_){
    aiSuggestions = parseMealTextLocal(text);
  }
  renderAISuggestions();
  aiApply.disabled = aiSuggestions.length===0;
});

aiApply?.addEventListener('click', ()=>{
  aiSuggestions.forEach(s=>{
    addItemRow({
      id: s.item.id,
      name: s.item.name,
      brand: s.item.brand||null,
      nutrPer100g: s.item.nutrPer100g||{carbs_g:0,fiber_g:0,cal_kcal:0,protein_g:0,fat_g:0},
      measures: Array.isArray(s.item.measures)? s.item.measures : [],
      gi: s.item.gi ?? null
    });
    const row = currentItems[currentItems.length-1];
    row.unit = s.unit; row.qty = s.qty; row.measure = s.measure;
  });
  renderItems(); recalcAll(); saveDraft();
  aiModal.classList.add('hidden');
});

// محلي بسيط (نفس اللي استخدمناه سابقًا)
function normalizeArabic(s){
  return (s||'').toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g,'')
    .replace(/[اأإآ]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه')
    .replace(/[٠-٩]/g, d=> '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
}
const FRACTIONS = { 'نصف':0.5, 'نص':0.5, 'ربع':0.25, 'ثلث':1/3 };
function toFloatInText(s){ const m = s.match(/(\d+([.,]\d+)?)/); return m? Number(m[0].replace(',','.')) : 0; }

function parseMealTextLocal(text){
  const parts = text.split(/[,+؛]| و /).map(p=>p.trim()).filter(Boolean);
  if(!cachedFood.length) return [];
  const food = cachedFood.map(x=> ({
    ...x, _nameN: normalizeArabic(x.name||''),
    _tagsN: (x.tags||[]).map(t=> normalizeArabic(t||'')),
    _brandN: normalizeArabic(x.brand||'')
  }));
  const suggestions = [];
  parts.forEach(p=>{
    const pN = normalizeArabic(p);
    let qty = toFloatInText(pN); Object.entries(FRACTIONS).forEach(([k,v])=>{ if (pN.includes(k)) qty = qty? qty+v : v; });
    if (!qty) qty = 1;
    let unit = /(كوب|نصف كوب|ربع كوب|ملعقه( كبيره| صغيره)?|شريحه|حبه)/.test(pN) ? 'household' : 'grams';
    let measureName = null;
    const nameGuess = pN.replace(/(\d+([.,]\d+)?)/g,'')
      .replace(/(جرام|جم|غ|g|كوب|نصف كوب|ربع كوب|ملعقه كبيره|ملعقه صغيره|ملعقه|ملعقة|شريحه|حبه)/g,'')
      .replace(/\b(من|ال)\b/g,' ').trim();
    let best = null, bestScore = 0;
    food.forEach(it=>{
      let s=0;
      if (it._nameN.includes(nameGuess)) s+=3;
      if (nameGuess.includes(it._nameN)) s+=3;
      if (it._brandN && nameGuess.includes(it._brandN)) s+=1;
      if (Array.isArray(it._tagsN) && it._tagsN.some(t=> nameGuess.includes(t))) s+=1;
      if (s>bestScore){ bestScore=s; best=it; }
    });
    if (!best || bestScore===0) return;
    if (unit==='household' && Array.isArray(best.measures)){
      const m = best.measures.find(m=> normalizeArabic(m.name) && pN.includes(normalizeArabic(m.name)));
      measureName = m ? m.name : (best.measures[0]?.name || null);
    }
    suggestions.push({ part:p, qty, unit, measure: unit==='household'? measureName : null, item: best, note: bestScore>=3 ? 'ok' : 'weak' });
  });
  return suggestions;
}

function renderAISuggestions(){
  aiResultsEl.innerHTML = '';
  if (!aiSuggestions.length){
    aiResultsEl.innerHTML = `<div class="empty">لم أجد أصنافًا مطابقة. جرّبي أسماء أوضح أو اضيفي الأصناف للمكتبة أولًا.</div>`;
    return;
  }
  aiSuggestions.forEach(s=>{
    const div = document.createElement('div');
    div.className = 'ai-card';
    div.innerHTML = `
      <div class="title">${esc(s.item.name)} ${s.item.brand?`<small>(${esc(s.item.brand)})</small>`:''}</div>
      <div class="meta">من النص: <em>${esc(s.part)}</em></div>
      <div class="meta">الوحدة: <strong>${s.unit==='grams'?'جرام':'تقدير بيتي'}</strong> • الكمية: <strong>${s.qty}</strong> ${s.unit==='household'&&s.measure?`• المقياس: <strong>${esc(s.measure)}</strong>`:''}</div>
      <div class="${s.note==='ok'?'ok':'warn'}">${s.note==='ok'?'تطابق جيد':'تطابق تقريبي'}</div>
    `;
    aiResultsEl.appendChild(div);
  });
}

/* ========= الوجبات الجاهزة ========= */
presetBtn?.addEventListener('click', ()=>{
  presetModal.classList.remove('hidden');
  setActivePresetTab(mealTypeEl.value || 'فطار');
  renderPresets();
});
presetClose?.addEventListener('click', ()=> presetModal.classList.add('hidden'));
presetTabs.forEach(b=>{
  b.addEventListener('click', ()=>{
    presetTabs.forEach(x=> x.classList.remove('active'));
    b.classList.add('active');
    activePresetType = b.dataset.type;
    renderPresets();
  });
});
presetSaveBtn?.addEventListener('click', async ()=>{
  if (!currentItems.length){ alert('أضف عنصرًا واحدًا على الأقل لحفظه كوجبة جاهزة'); return; }
  const name = prompt('اسم الوجبة الجاهزة (مثال: فطور بيض وجبن)');
  if (!name) return;
  const payload = {
    name: name.trim(),
    type: mealTypeEl.value || 'فطار',
    items: currentItems.map(i=>({
      itemId:i.itemId, name:i.name, brand:i.brand||null,
      unit:i.unit, qty:Number(i.qty)||0, measure:i.measure||null,
      grams: round1(i.grams || 0),
      carbs_g: round1(i.calc.carbs || 0),
      fiber_g: round1(i.calc.fiber || 0),
      cal_kcal: Math.round(i.calc.cal || 0),
      protein_g: round1(i.calc.prot || 0),
      fat_g: round1(i.calc.fat || 0),
      gi: i.gi || null, gl: round1(i.calc.gl || 0)
    })),
    createdAt: serverTimestamp()
  };
  await addDoc(collection(db, `parents/${currentUser.uid}/children/${childId}/presetMeals`), payload);
  showToast('✅ تم حفظ الوجبة كوجبة جاهزة');
  await loadPresets();
});

async function loadPresets(){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/presetMeals`);
  const snap = await getDocs(query(ref, orderBy('createdAt','desc')));
  cachedPresets = [];
  snap.forEach(d=> cachedPresets.push({ id:d.id, ...d.data() }));
}
function setActivePresetTab(type){
  activePresetType = type;
  presetTabs.forEach(x=> x.classList.toggle('active', x.dataset.type===type));
}
function renderPresets(){
  const list = cachedPresets.filter(p=> (p.type||'')===activePresetType);
  presetGrid.innerHTML = '';
  if (!list.length){ presetEmpty.classList.remove('hidden'); return; }
  presetEmpty.classList.add('hidden');

  list.forEach(p=>{
    const carbs = round1((p.items||[]).reduce((a,i)=>a+(i.carbs_g||0),0));
    const cal   = Math.round((p.items||[]).reduce((a,i)=>a+(i.cal_kcal||0),0));
    const gl    = round1((p.items||[]).reduce((a,i)=>a+(i.gl||0),0));

    const div = document.createElement('div');
    div.className = 'preset-card';
    div.innerHTML = `
      <div class="preset-top">
        <div class="thumb">${pickPresetThumb(p.type)}</div>
        <div class="meta">
          <div class="title">${esc(p.name||'-')}</div>
          <div class="muted tiny">${esc(p.type||'-')}</div>
        </div>
      </div>
      <div class="preset-body">
        ${(p.items||[]).slice(0,3).map(i=> esc(i.name)).join(' + ')}${(p.items||[]).length>3?'…':''}
        <div class="tiny muted" style="margin-top:6px">🥖 كارب: ${carbs}g • 🔥 ${cal} kcal • GL: ${gl}</div>
      </div>
      <div class="preset-footer">
        <button class="secondary useBtn">إضافة</button>
        <button class="secondary delBtn">حذف</button>
      </div>
    `;
    div.querySelector('.useBtn').addEventListener('click', ()=>{
      applyPresetToCurrent(p);
      presetModal.classList.add('hidden');
    });
    div.querySelector('.delBtn').addEventListener('click', async ()=>{
      if (!confirm('حذف هذه الوجبة الجاهزة؟')) return;
      await deleteDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/presetMeals`));
      await loadPresets(); renderPresets();
    });
    presetGrid.appendChild(div);
  });
}
function pickPresetThumb(type){ const map = { 'فطار':'🥚', 'غدا':'🍗', 'عشا':'🍽️' }; return `<span style="font-size:28px">${map[type]||'🍱'}</span>`; }
function applyPresetToCurrent(p){
  currentItems = (p.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: {
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      fiber: i.grams>0 ? (i.fiber_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0
    },
    gi: i.gi ?? null,
    calc:{carbs: i.carbs_g, fiber:i.fiber_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, gl: i.gl||0},
    measures: []
  }));
  renderItems(); recalcAll(); saveDraft();
}

/* ========= هدف الكارب: زر الضبط التلقائي ========= */
reachTargetBtn?.addEventListener('click', ()=>{
  const key = typeKeyFromArabic(mealTypeEl.value);
  const tgt = childData?.carbTargets?.[key]; if (!tgt) return;
  const min = Number(tgt.min||0), max = Number(tgt.max||0);
  let total = currentItems.reduce((a,r)=>a+(r.calc.carbs||0),0);
  if (total===0 || currentItems.length===0){ showToast('أضيفي عناصر أولًا'); return; }

  // خوارزمية بسيطة: نوزّع الزيادة/النقصان على أصناف بها كارب
  const want = Math.min(max, Math.max(min, total));
  const diff = want - total; // + زيادة، - تخفيض
  const carbItemsIdx = currentItems.map((r,i)=>({i, per100:r.per100.carbs||0})).filter(x=>x.per100>0);
  if (!carbItemsIdx.length){ showToast('لا توجد أصناف كارب قابلة للضبط'); return; }

  const deltaPerItem = diff / carbItemsIdx.length;
  carbItemsIdx.forEach(({i})=>{
    const r = currentItems[i];
    // نحافظ على نفس الوحدة: لو grams نزود/نقلّل الجرامات مباشرة، لو household نزود qty بشكل تقريبي
    if (r.unit==='grams'){
      const addGrams = (deltaPerItem / Math.max(1e-6, r.per100.carbs))*100;
      r.qty = Math.max(0, round1(r.qty + addGrams));
    }else{
      // تقدير تقريبي: نعدّل qty بما يعادل الجرامات/المقياس
      const m = r.measures.find(x=> x.name===r.measure);
      const gramsPerUnit = m? m.grams : 0;
      if (gramsPerUnit>0){
        const addUnits = (deltaPerItem / Math.max(1e-6, r.per100.carbs))*100 / gramsPerUnit;
        r.qty = Math.max(0, round1(r.qty + addUnits));
      }
    }
  });
  renderItems(); recalcAll(); saveDraft();
});

/* ========= Draft محلي ========= */
function loadDraft(){
  try{
    const key = `mealDraft:${currentUser?.uid||'u'}:${childId||'c'}`;
    const raw = localStorage.getItem(key);
    if(!raw) return;
    const d = JSON.parse(raw);
    if (!d) return;

    mealTypeEl.value = d.type || 'فطار';
    preReadingEl.value  = d.preReading || '';
    postReadingEl.value = d.postReading || '';
    useNetCarbsEl.checked = !!d.useNetCarbs;
    appliedDoseEl.value = d.appliedDose || '';
    mealNotesEl.value   = d.notes || '';
    currentItems = Array.isArray(d.items)? d.items : [];
    renderItems(); recalcAll();
  }catch(e){ console.warn('loadDraft failed',e); }
}
function saveDraft(){
  try{
    const key = `mealDraft:${currentUser?.uid||'u'}:${childId||'c'}`;
    const d = {
      type: mealTypeEl.value,
      preReading: preReadingEl.value,
      postReading: postReadingEl.value,
      useNetCarbs: !!useNetCarbsEl?.checked,
      appliedDose: appliedDoseEl.value,
      notes: mealNotesEl.value,
      items: currentItems
    };
    localStorage.setItem(key, JSON.stringify(d));
  }catch(e){ console.warn('saveDraft failed',e); }
}
function clearDraft(){
  try{
    const key = `mealDraft:${currentUser?.uid||'u'}:${childId||'c'}`;
    localStorage.removeItem(key);
  }catch(e){}
}

/* ========= أدوات ========= */
function updateGLBadge(totalGL){
  let b = document.getElementById('tGLBadge');
  if (!b){ b = document.createElement('span'); b.id='tGLBadge'; b.className='gl-badge'; (tGLEl.parentElement||tGLEl).appendChild(b); }
  const lv = totalGL||0;
  b.className = `gl-badge ${lv<10?'low': lv<20?'medium':'high'}`;
  b.textContent = lv<10?'منخفض': lv<20?'متوسط':'مرتفع';
}
function debounce(fn, ms=250){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
