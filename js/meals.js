// js/meals.js — نفس واجهة الوجبات لديك، مع قراءة الكتالوج من admin/global/foodItems
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ========= عناصر من DOM ========= */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const $ = (id)=>document.getElementById(id);
const toastEl       = $('toast');
const childNameEl   = $('childName');
const childMetaEl   = $('childMeta');

const mealDateEl    = $('mealDate');
const mealTypeEl    = $('mealType');
const preReadingEl  = $('preReading');
const postReadingEl = $('postReading');

const itemsBodyEl   = $('itemsBody');
const addItemBtn    = $('addItemBtn');
const repeatLastBtn = $('repeatLastBtn');
const backBtn       = $('backBtn');
const settingsLink  = $('settingsLink');

const tGramsEl     = $('tGrams');
const tCarbsEl     = $('tCarbs');
const tFiberEl     = $('tFiber');
const tNetCarbsEl  = $('tNetCarbs');
const tCalEl       = $('tCal');
const tProtEl      = $('tProt');
const tFatEl       = $('tFat');
const tGLEl        = $('tGL');
const useNetCarbsEl= $('useNetCarbs');

const goalTypeEl   = $('goalType');
const goalMinEl    = $('goalMin');
const goalMaxEl    = $('goalMax');
const unitChipEl   = $('unitChip');
const carbProgress = $('carbProgress');
const carbStateEl  = $('carbState');
const reachTargetBtn = $('reachTargetBtn');

const suggestedDoseEl = $('suggestedDose');
const doseExplainEl   = $('doseExplain');
const doseRangeEl     = $('doseRange');
const appliedDoseEl   = $('appliedDose');
const mealNotesEl     = $('mealNotes');

const saveMealBtn     = $('saveMealBtn');
const resetMealBtn    = $('resetMealBtn');
const printDayBtn     = $('printDayBtn');

const tableDateEl     = $('tableDate');
const filterTypeEl    = $('filterType');
const mealsListEl     = $('mealsList');
const noMealsEl       = $('noMeals');

/* مودال الأصناف */
const pickerModal     = $('pickerModal');
const closePicker     = $('closePicker');
const pickSearchEl    = $('pickSearch');
const pickCategoryEl  = $('pickCategory');
const pickerGrid      = $('pickerGrid');
const pickerEmpty     = $('pickerEmpty');

/* ========= حالة ========= */
let currentUser, childData;
let editingMealId = null;
let currentItems = [];
let cachedFood = [];          // ← سنملؤها من admin/global/foodItems
let cachedMeasurements = [];
let lastUsedMap = {};
let ROUND = 0.5;

/* ========= أدوات صغيرة ========= */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); }
setMaxToday(mealDateEl);

function esc(s){ return (s||'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function toNumber(x){ const n = Number(String(x ?? '').replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round((x||0)*10)/10; }
function roundHalf(x){ return Math.round((x||0)/ROUND)*ROUND; }
function showToast(msg){ toastEl.innerHTML = `<div class="msg">${esc(msg)}</div>`; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 2000); }

function typeKeyFromArabic(t){ return t==='فطار'?'breakfast': t==='غدا'?'lunch': t==='عشا'?'dinner':'snack'; }
const SLOT_LABELS = {
  'فطار': { pre:'ق.الفطار', post:'ب.الفطار' },
  'غدا':  { pre:'ق.الغدا',  post:'ب.الغدا'  },
  'عشا':  { pre:'ق.العشا',  post:'ب.العشا'  },
  'سناك': { pre:'سناك',     post:'سناك'     }
};

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

  ROUND = Number(childData?.bolusRounding ?? 0.5) || 0.5;
  unitChipEl.textContent = `وحدة: ${childData.glucoseUnit==='mmol'?'mmol/L':'mg/dL'}`;
  mealDateEl.value = todayStr();
  tableDateEl.textContent = mealDateEl.value;

  lastUsedMap = loadLastUsed();

  await loadMeasurements();
  await loadMealsOfDay();
  await ensureFoodCache();   // ← من مكتبة الأدمن
  applyCarbGoalUI();
  recalcAll();
});

/* ========= أعمار ========= */
function calcAge(bd){
  if(!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

/* ========= القياسات (اليوم) ========= */
async function loadMeasurements(){
  const d = mealDateEl.value || todayStr();
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

  const build = (prefSlot)=>{
    const opts = ['<option value="">— لا يوجد —</option>'];
    sorted.forEach(m=>{ if (prefSlot && m.slot===prefSlot) opts.push(`<option value="${m.id}">${esc(makeLabel(m))}</option>`); });
    sorted.forEach(m=>{ if (!prefSlot || m.slot!==prefSlot) opts.push(`<option value="${m.id}">${esc(makeLabel(m))}</option>`); });
    return opts.join('');
  };

  preReadingEl.innerHTML  = build(pref);
  postReadingEl.innerHTML = build(postf);
}

/* ========= وجبات اليوم ========= */
async function loadMealsOfDay(){
  const d = mealDateEl.value || todayStr();
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

/* ========= تحميل كتالوج الأصناف (من مكتبة الأدمن) ========= */
function mapAdminItem(d){
  // دعم الشكلين
  const nutr = d.nutrPer100g || {
    carbs_g:   Number(d.carbs_100g ?? 0),
    fiber_g:   Number(d.fiber_100g ?? 0),
    protein_g: Number(d.protein_100g ?? 0),
    fat_100g: undefined, // احتياطي
    fat_g:     Number(d.fat_100g ?? 0),
    cal_kcal:  Number(d.calories_100g ?? 0),
  };
  const measures = d.measures || d.householdUnits || [];
  return {
    id: d.id,
    name: d.name,
    brand: d.brand || null,
    category: d.category || null,
    imageUrl: d.imageUrl || null,
    tags: d.tags || [],
    nutrPer100g: nutr,
    measures: Array.isArray(measures) ? measures.filter(m=>m.name && Number(m.grams)>0).map(m=>({name:m.name, grams:Number(m.grams)})) : [],
    gi: d.gi ?? null
  };
}

async function ensureFoodCache(){
  if (cachedFood.length) return;

  // نقرأ الكتالوج العام
  let snap;
  try {
    snap = await getDocs(query(PUBLIC_FOOD_COLLECTION(), orderBy('name')));
  } catch {
    // لو الترتيب بالاسم مش متاح، نقرأ بدون ترتيب
    snap = await getDocs(PUBLIC_FOOD_COLLECTION());
  }

  cachedFood = [];
  snap.forEach(s => {
    // mapAdminItem يتكفل بتطبيع الحقول (carbs_100g/fiber_100g/... أو nutrPer100g)
    cachedFood.push(mapAdminItem({ id: s.id, ...s.data() }));
  });
}


/* ========= إضافة صف عنصر للوجبة ========= */
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

/* ========= رسم عناصر الوجبة ========= */
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

/* ========= الحسابات والجرعات ========= */
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
  if (tGLEl){ tGLEl.textContent = round1(totals.gl); }

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

  updateGoalProgress(totals.carbs);
}

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

  // محاولة جلب المقاييس من مكتبة الأدمن أولًا ثم من مكتبة ولي الأمر (توافق للخلف)
  Promise.all(currentItems.map(async (row)=>{
    if (!row.itemId) return;
    let d = await getDoc(doc(db, 'admin','global','foodItems', row.itemId));
    if (!d.exists()){
      d = await getDoc(doc(db, `parents/${currentUser.uid}/foodItems/${row.itemId}`));
    }
    if (d.exists()){
      const it = d.data();
      const measures = it.measures || it.householdUnits || [];
      row.measures = Array.isArray(measures)? measures.filter(m=>m.name && Number(m.grams)>0).map(m=>({name:m.name, grams:Number(m.grams)})) : [];
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

function openPicker(){
  pickerModal.classList.remove('hidden');
  pickSearchEl.value=''; pickCategoryEl.value='الكل';
  ensureFoodCache().then(applyPickerFilters);
}

pickSearchEl.addEventListener('input', debounce(applyPickerFilters, 250));
pickCategoryEl.addEventListener('change', applyPickerFilters);

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

/* ========= تكرار آخر وجبة (كما هو) ========= */
repeatLastBtn.addEventListener('click', repeatLastMealTemplate);
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

/* ========= مسودّة محلية ========= */
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
  }catch(e){ /* no-op */ }
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
  }catch(e){}
}
function clearDraft(){
  try{
    const key = `mealDraft:${currentUser?.uid||'u'}:${childId||'c'}`;
    localStorage.removeItem(key);
  }catch(e){}
}

/* ========= أدوات ========= */
function debounce(fn, ms=250){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
function setBusy(btn, busy){ btn.disabled = !!busy; btn.textContent = busy ? 'جارٍ الحفظ…' : 'حفظ الوجبة'; }
