// measurements.js — عرض/إخفاء حسب الحالة، تطبيع وتعريب الوقت، fallback عند تحميل الجدول، منع NaN، إخفاء عمود التصحيح تلقائيًا

import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, deleteDoc, doc, getDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ===== DOM ===== */
const card           = document.getElementById('measCard');
const chipsHost      = document.getElementById('chips');
const severeBanner   = document.getElementById('severeBanner');

const dateInput      = document.getElementById('dateInput');

const unitSel        = document.getElementById('unitSelect');
const valueInput     = document.getElementById('valueInput');
const convHint       = document.getElementById('convHint');

const slotSel        = document.getElementById('slotSelect');
const carbsInput     = document.getElementById('carbsInput');
const bolusDose      = document.getElementById('bolusDose');

const wrapCorr       = document.getElementById('wrapCorr');
const corrDose       = document.getElementById('corrDose');

const wrapTreatLow   = document.getElementById('wrapTreatLow');
const treatLowInput  = document.getElementById('treatLowInput');

const notesInput     = document.getElementById('notesInput');

const saveBtn        = document.getElementById('saveBtn');
const printBtn       = document.getElementById('printBtn');

const sortSelect     = document.getElementById('sortSelect');
const table          = document.getElementById('measTable');
const tbody          = document.getElementById('measTableBody');

/* ===== State ===== */
let currentUser = null;
let childId     = null;
let childData   = null;

/* ===== Consts ===== */
const ALLOW_DUP_KEYS = new Set(['SNACK','PRE_SPORT','POST_SPORT']);
const MEAL_SLOTS = new Set(['PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK']);
const ROUND_STEP = 0.5;

/* ===== Slot التطبيع + التعريب ===== */
const SLOT_NORMALIZE = {
  DURING_SLEEP: 'OVERNIGHT',
  PRE_BED: 'BEDTIME',
  BEFORE_BREAKFAST: 'PRE_BREAKFAST',
  AFTER_BREAKFAST: 'POST_BREAKFAST',
  BEFORE_LUNCH: 'PRE_LUNCH',
  AFTER_LUNCH: 'POST_LUNCH',
  BEFORE_DINNER: 'PRE_DINNER',
  AFTER_DINNER: 'POST_DINNER',
};
const SLOT_AR = {
  FASTING:'الاستيقاظ', PRE_BREAKFAST:'قبل الفطار', POST_BREAKFAST:'بعد الفطار',
  PRE_LUNCH:'قبل الغداء', POST_LUNCH:'بعد الغداء',
  PRE_SPORT:'قبل الرياضة', POST_SPORT:'بعد الرياضة',
  SNACK:'سناك',
  PRE_DINNER:'قبل العشاء', POST_DINNER:'بعد العشاء',
  BEDTIME:'قبل النوم', OVERNIGHT:'أثناء النوم',
  RANDOM:'عشوائي'
};
function normalizeSlot(k){ const up=(k||'').toUpperCase(); return SLOT_NORMALIZE[up] || up || 'RANDOM'; }
function slotToAr(k){ return SLOT_AR[normalizeSlot(k)] || normalizeSlot(k); }

/* ===== Helpers / Units ===== */
function toMmol(val, unit){
  if (val==null || val==='') return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return (unit==='mgdl') ? n/18 : n;
}
function fromMmol(mmol, outUnit){
  if (mmol==null) return null;
  return (outUnit==='mgdl') ? mmol*18 : mmol;
}
function fmtVal(mmol, outUnit){
  const v = fromMmol(mmol, outUnit);
  if (v==null) return '';
  return outUnit==='mgdl' ? Math.round(v).toString() : v.toFixed(1);
}
function roundDose(x){ return Math.round(Number(x)/ROUND_STEP)*ROUND_STEP; }

/* ===== Ranges ===== */
function getRanges(){
  const r = childData?.normalRange || {};
  const min = Number(r.min ?? 4.5);
  const max = Number(r.max ?? 7);
  const severeLow  = Number((r.severeLow  ?? r.severe_low  ?? min));
  const severeHigh = Number((r.severeHigh ?? r.severe_high ?? max));
  const hypoLevel  = Number(r.hypo  ?? severeLow);
  const hyperLevel = Number(r.hyper ?? severeHigh);
  return { min, max, severeLow, severeHigh, hypoLevel, hyperLevel };
}

/* ===== Date helpers ===== */
function initDateDefault(){
  const now = new Date();
  dateInput.value = now.toISOString().slice(0,10);
}
function selectedDateKey(){ return (dateInput?.value || new Date().toISOString().slice(0,10)); }
function selectedWhen(){
  const dk = selectedDateKey();
  const dt = new Date(`${dk}T00:00:00`);
  return isNaN(dt.getTime()) ? new Date() : dt;
}

/* ===== Chips ===== */
function renderChips(){
  if (!chipsHost || !childData) return;
  const { min, max, severeLow, severeHigh } = getRanges();
  chipsHost.innerHTML = [
    `<span class="chip">التاريخ: ${selectedDateKey()}</span>`,
    `<span class="chip">الوحدة: ${unitSel.value==='mgdl'?'mg/dL':'mmol/L'}</span>`,
    `<span class="chip">طبيعي (التقرير): ${severeLow}–${severeHigh} mmol/L</span>`,
    `<span class="chip">النطاق القياسي: ${min}–${max} mmol/L</span>`
  ].join('');
}

/* ===== Card state / severe ===== */
function setCardState(state, severe=false){
  card.classList.remove('state-low','state-ok','state-high','severe');
  if (state==='low')  card.classList.add('state-low');
  if (state==='high') card.classList.add('state-high');
  if (state==='ok')   card.classList.add('state-ok');
  if (severe) card.classList.add('severe');
  severeBanner.hidden = !severe;
}
function classify(mmol){
  const { hypoLevel, hyperLevel } = getRanges();
  if (mmol==null) return 'ok';
  if (mmol < hypoLevel)  return 'low';
  if (mmol > hyperLevel) return 'high';
  return 'ok';
}

/* ===== Duplicate protection ===== */
async function existsDuplicate(dateKey, slotKey){
  const col = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(col, where('date','==',dateKey), where('slotKey','==',slotKey));
  const snap= await getDocs(qy);
  let found = false;
  snap.forEach(()=> found = true);
  return found;
}

/* ===== Doses ===== */
function computeCorrection(mmol){
  const cf = childData?.cf ?? childData?.correctionFactor ?? null;
  const { max } = getRanges();
  if (!cf || mmol==null) return 0;
  const delta = mmol - max;
  if (delta <= 0) return 0;
  return roundDose(delta / Number(cf));
}
function computeMealBolus(carbs){
  const cr = childData?.cr ?? childData?.carbRatio ?? null;
  if (!cr || !carbs) return 0;
  return roundDose(Number(carbs) / Number(cr));
}

/* ===== UI updates ===== */
function updatePreviewAndUI(){
  const unit = unitSel.value;
  const mmol = toMmol(valueInput.value, unit);

  // تحويل عرضي
  if (mmol!=null) {
    const other = unit==='mgdl' ? 'mmol/L' : 'mg/dL';
    const otherVal = fmtVal(mmol, unit==='mgdl'?'mmol':'mgdl');
    convHint.textContent = `${other} ≈ ${otherVal}`;
  } else {
    convHint.textContent = `${unit==='mgdl'?'mmol/L':'mg/dL'} ≈ 0`;
  }

  // الحالة/التحذير
  const { severeLow, severeHigh, min, max } = getRanges();
  const c = classify(mmol);
  const severe = (mmol!=null) && (mmol<=severeLow || mmol>=severeHigh);
  setCardState(c, severe);

  // إظهار/إخفاء الحقول حسب الحالة (بدون الاعتماد على CSS فقط)
  const isHigh = mmol!=null && mmol > max;
  const isLow  = mmol!=null && mmol < min;

  // التصحيحي High فقط
  wrapCorr.hidden = !isHigh;
  wrapCorr.style.display = isHigh ? '' : 'none';
  if (isHigh) { corrDose.value = computeCorrection(mmol) || ''; }
  else { corrDose.value = ''; }

  // رفعنا بإيه Low فقط
  wrapTreatLow.hidden = !isLow;
  wrapTreatLow.style.display = isLow ? '' : 'none';
  if (!isLow) { treatLowInput.value = ''; }

  // كارب/جرعة الوجبة لخانات الوجبات والسناك
  const showMeal = MEAL_SLOTS.has(normalizeSlot(slotSel.value));
  document.getElementById('wrapBolus').style.display = showMeal ? '' : 'none';
  const carbs = Number(carbsInput.value || 0);
  if (showMeal && carbs>0) bolusDose.value = computeMealBolus(carbs) || '';
  else if (!showMeal){ bolusDose.value=''; carbsInput.value=''; }

  renderChips();
}

/* ===== Form ===== */
function clearForm(keepDate=true){
  const dk = selectedDateKey();
  valueInput.value = '';
  corrDose.value   = '';
  bolusDose.value  = '';
  carbsInput.value = '';
  treatLowInput.value = '';
  notesInput.value = '';
  setCardState('ok', false);
  if (!keepDate) initDateDefault(); else dateInput.value = dk;
  updatePreviewAndUI();
}

/* ===== Load child ===== */
async function loadChild(){
  const qs = new URLSearchParams(location.search);
  childId = qs.get('child');
  if (!childId) throw new Error('لا يوجد child في الرابط');

  const cs = await getDoc(doc(db, `parents/${currentUser.uid}/children/${childId}`));
  if (!cs.exists()) throw new Error('الطفل غير موجود');
  childData = cs.data();
  renderChips();
}

/* ===== Load table (date or when-range fallback) ===== */
async function loadTableFor(dateKey){
  tbody.innerHTML = '';
  const col  = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);

  let snap = await getDocs(query(col, where('date','==', dateKey)));

  // Fallback: مستندات قديمة بصيغة when فقط
  if (snap.empty) {
    const start = new Date(`${dateKey}T00:00:00`);
    const end   = new Date(`${dateKey}T23:59:59.999`);
    snap = await getDocs(query(
      col,
      where('when', '>=', start),
      where('when', '<=', end)
    ));
  }

  const toNum = (v)=>{ const n=Number(v); return Number.isFinite(n) ? n : null; };

  let rows = [];
  let anyCorr = false;

  snap.forEach(ds=>{
    const d = ds.data();

    // قيمة آمنة: mmol أولاً، وإلا mgdl/18، وإلا null
    let mmol = toNum(d.mmol);
    if (mmol == null && toNum(d.mgdl) != null) mmol = toNum(d.mgdl) / 18;

    const unit = (d.unit || (toNum(d.mgdl)!=null ? 'mgdl' : 'mmol')).toLowerCase();
    const valueOut = mmol == null ? '—' : (unit==='mgdl' ? Math.round(mmol*18) : mmol.toFixed(1));

    const slotKey = normalizeSlot(d.slotKey || d.slot || 'RANDOM');
    const slotAr  = slotToAr(slotKey);

    const corr = toNum(d.correctionDose);
    if (corr != null && corr !== 0) anyCorr = true;

    rows.push({
      id: ds.id,
      date: d.date || dateKey,
      slotKey, slotAr,
      unit,
      mmol, valueOut,
      bolusDose: toNum(d.bolusDose),
      correctionDose: corr,
      notes: (d.notes || ''),
      treatLow: (d.treatLow || ''),
      cls: mmol == null ? 'ok' : classify(mmol)
    });
  });

  // ترتيب حسب اختيار المستخدم
  const sortBy = (sortSelect?.value || 'slot');
  if (sortBy === 'value-asc')      rows.sort((a,b)=> (a.mmol??Infinity) - (b.mmol??Infinity));
  else if (sortBy === 'value-desc')rows.sort((a,b)=> (b.mmol??-Infinity) - (a.mmol??-Infinity));
  else                             rows.sort((a,b)=> (a.slotKey||'').localeCompare(b.slotKey||''));

  // إخفاء عمود التصحيحي تلقائيًا
  if (anyCorr) table.classList.remove('hide-corr');
  else         table.classList.add('hide-corr');

  // رسم الصفوف
  rows.forEach(d=>{
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td'); tdDate.textContent = d.date; tr.appendChild(tdDate);
    const tdSlot = document.createElement('td'); tdSlot.textContent = d.slotAr; tr.appendChild(tdSlot);

    const tdVal = document.createElement('td');
    const span = document.createElement('span');
    span.className = `v-${d.cls==='low'?'low':d.cls==='high'?'high':'in'}`;
    span.textContent = d.valueOut;
    tdVal.appendChild(span);
    tdVal.appendChild(document.createTextNode(d.valueOut==='—' ? '' : ` ${d.unit==='mgdl'?'mg/dL':'mmol/L'}`));
    tr.appendChild(tdVal);

    const tdBolus = document.createElement('td'); tdBolus.textContent = d.bolusDose != null ? d.bolusDose : '—'; tr.appendChild(tdBolus);
    const tdCorr  = document.createElement('td');  tdCorr.textContent  = d.correctionDose != null ? d.correctionDose : '—'; tr.appendChild(tdCorr);

    const tdNotes = document.createElement('td');
    const extra   = d.treatLow ? ` • رفعنا بإيه: ${d.treatLow}` : '';
    tdNotes.textContent = (d.notes || '—') + extra;
    tr.appendChild(tdNotes);

    const tdAct = document.createElement('td');
    tdAct.className = 'row-actions';
    const del = document.createElement('button');
    del.className = 'delete';
    del.textContent = 'حذف 🗑️';
    del.addEventListener('click', ()=> deleteMeasurement(d.id, dateKey));
    tdAct.appendChild(del);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });
}

/* ===== Delete ===== */
async function deleteMeasurement(id, dateKey){
  if (!confirm('هل تريد حذف هذا القياس؟')) return;
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/measurements/${id}`);
  await deleteDoc(ref);
  await loadTableFor(dateKey);
}

/* ===== Save new ===== */
async function saveNew(){
  const unit = unitSel.value;
  const mmol = toMmol(valueInput.value, unit);
  if (!Number.isFinite(mmol)) { alert('من فضلك أدخل قيمة صحيحة'); return; }

  const dateKey = selectedDateKey();
  const when    = selectedWhen();
  const slotKey = normalizeSlot(slotSel.value || 'RANDOM');

  if (!ALLOW_DUP_KEYS.has(slotKey)){
    const dup = await existsDuplicate(dateKey, slotKey);
    if (dup) return alert('هذا الوقت مسجّل بالفعل لهذا اليوم.');
  }

  const { min, max } = getRanges();
  const isHigh = mmol > max;
  const isLow  = mmol < min;

  const payload = {
    unit,
    mmol: Number(mmol),
    mgdl: Math.round(mmol*18),
    when, date: dateKey, slotKey,
    bolusDose:   bolusDose.value ? Number(bolusDose.value) : null,
    correctionDose: isHigh && corrDose.value ? Number(corrDose.value) : null,
    treatLow: isLow && treatLowInput.value ? treatLowInput.value.trim() : null,
    notes: (notesInput.value||'').trim(),
    createdAt: serverTimestamp()
  };

  await addDoc(collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`), payload);
  clearForm(true);
  await loadTableFor(dateKey);
}

/* ===== Events ===== */
unitSel.addEventListener('change', ()=>{ renderChips(); updatePreviewAndUI(); });
valueInput.addEventListener('input', updatePreviewAndUI);
slotSel.addEventListener('change', updatePreviewAndUI);
carbsInput.addEventListener('input', updatePreviewAndUI);
notesInput.addEventListener('input', ()=>{});
dateInput.addEventListener('change', async ()=>{
  renderChips();
  await loadTableFor(selectedDateKey());
});
saveBtn.addEventListener('click', saveNew);
printBtn.addEventListener('click', ()=> window.print());
sortSelect.addEventListener('change', ()=> loadTableFor(selectedDateKey()));

/* ===== Boot ===== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  currentUser = user;
  try{
    initDateDefault();
    const qs = new URLSearchParams(location.search);
    childId = qs.get('child');
    await loadChild();
    updatePreviewAndUI();
    await loadTableFor(selectedDateKey());
  }catch(e){
    console.error(e);
    alert(e.message || 'خطأ أثناء التحميل');
  }
});
