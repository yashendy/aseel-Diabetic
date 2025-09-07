// measurements.js — بدون ساعة: تاريخ فقط، جدول اليوم المختار، إظهار/إخفاء الحقول حسب الحالة، تعديل قياس

import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, doc, getDoc, getDocs, query, where, serverTimestamp
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
const saveEditBtn    = document.getElementById('saveEditBtn');
const cancelEditBtn  = document.getElementById('cancelEditBtn');
const editBar        = document.getElementById('editBar');

const tbody          = document.getElementById('measTableBody');

/* ===== State ===== */
let currentUser = null;
let childId     = null;
let childData   = null;
let editMode    = null; // { id }

/* ===== Consts ===== */
const ALLOW_DUP_KEYS = new Set(['SNACK','PRE_SPORT','POST_SPORT']);
const MEAL_SLOTS = new Set(['PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK']);
const ROUND_STEP = 0.5;

/* ===== Units ===== */
function toMmol(val, unit){
  if (val==null || val==='') return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
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
function selectedDateKey(){
  return (dateInput?.value || new Date().toISOString().slice(0,10));
}
function selectedWhen(){
  // نخزن when كـ تاريخ فقط (منتصف الليل) للسجل
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
async function existsDuplicate(dateKey, slotKey, excludedId=null){
  const col = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(col, where('date','==',dateKey), where('slotKey','==',slotKey));
  const snap= await getDocs(qy);
  let found = false;
  snap.forEach(d=>{
    if (excludedId && d.id===excludedId) return;
    found = true;
  });
  return found;
}

/* ===== Doses ===== */
function computeCorrection(mmol){
  const cf = childData?.cf ?? childData?.correctionFactor ?? null;
  const { max } = getRanges();
  if (cf==null || mmol==null) return 0;
  const delta = mmol - max;
  if (delta <= 0) return 0;
  return roundDose(delta / Number(cf));
}
function computeMealBolus(carbs){
  const cr = childData?.cr ?? childData?.carbRatio ?? null;
  if (cr==null || !carbs) return 0;
  return roundDose(Number(carbs) / Number(cr));
}

/* ===== UI updates ===== */
function updatePreviewAndUI(){
  const unit = unitSel.value;
  const mmol = toMmol(valueInput.value, unit);

  // conversion
  if (mmol!=null) {
    const other = unit==='mgdl' ? 'mmol/L' : 'mg/dL';
    const otherVal = fmtVal(mmol, unit==='mgdl'?'mmol':'mgdl');
    convHint.textContent = `${other} ≈ ${otherVal}`;
  } else {
    convHint.textContent = `${unit==='mgdl'?'mmol/L':'mg/dL'} ≈ 0`;
  }

  // state / severe
  const { severeLow, severeHigh, min, max } = getRanges();
  const c = classify(mmol);
  const severe = (mmol!=null) && (mmol<=severeLow || mmol>=severeHigh);
  setCardState(c, severe);

  // show/hide correction & treat-low
  const isHigh = mmol!=null && mmol > max;
  const isLow  = mmol!=null && mmol < min;

  wrapCorr.hidden      = !isHigh;
  wrapTreatLow.hidden  = !isLow;

  // correction value
  if (isHigh)  { corrDose.value = computeCorrection(mmol) || ''; }
  else         { corrDose.value = ''; }

  // meal section visibility (كما هي)
  const showMeal = MEAL_SLOTS.has((slotSel.value||'').toUpperCase());
  document.getElementById('wrapBolus').style.display = showMeal ? '' : 'none';

  // chips
  renderChips();
}

/* ===== Form helpers ===== */
function clearForm(keepDate=true){
  const dk = selectedDateKey();
  editMode = null;
  valueInput.value = '';
  corrDose.value   = '';
  bolusDose.value  = '';
  carbsInput.value = '';
  treatLowInput.value = '';
  notesInput.value = '';
  saveBtn.hidden = false;
  saveEditBtn.hidden = true;
  editBar.hidden = true;
  setCardState('ok', false);
  if (!keepDate) initDateDefault();
  else dateInput.value = dk;
  updatePreviewAndUI();
}
function fillFormFromDoc(d){
  // date only
  const dk = d.date || new Date().toISOString().slice(0,10);
  dateInput.value = dk;

  const unit = (d.unit || (d.mgdl!=null?'mgdl':'mmol')).toLowerCase();
  unitSel.value = unit;
  if (d.mmol!=null) valueInput.value = fmtVal(d.mmol, unit);
  else if (d.mgdl!=null) valueInput.value = unit==='mgdl' ? d.mgdl : (d.mgdl/18).toFixed(1);

  slotSel.value    = d.slotKey || d.slot || 'RANDOM';
  corrDose.value   = d.correctionDose ?? '';
  bolusDose.value  = d.bolusDose ?? '';
  treatLowInput.value = d.treatLow || '';
  notesInput.value = d.notes ?? '';

  updatePreviewAndUI();
}

/* ===== Load child + table for a date ===== */
async function loadChild(){
  const qs = new URLSearchParams(location.search);
  childId = qs.get('child');
  if (!childId) throw new Error('لا يوجد child في الرابط');

  const cs = await getDoc(doc(db, `parents/${currentUser.uid}/children/${childId}`));
  if (!cs.exists()) throw new Error('الطفل غير موجود');
  childData = cs.data();
  renderChips();
}

async function loadTableFor(dateKey){
  tbody.innerHTML = '';
  const col  = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy   = query(col, where('date','==', dateKey));
  const snap = await getDocs(qy);

  const rows = [];
  snap.forEach(ds=>{
    const d = ds.data();
    const when = d.when?.toDate?.() || new Date(`${d.date}T00:00:00`);
    rows.push({ id: ds.id, ...d, when });
  });

  // فرز محلي (معظمها نفس التوقيت لكن للحفاظ على ترتيب ثابت)
  rows.sort((a,b)=> (a.slotKey||'').localeCompare(b.slotKey||''));

  rows.forEach(d=>{
    const unit = (d.unit || (d.mgdl!=null?'mgdl':'mmol')).toLowerCase();
    const mmol = d.mmol!=null ? d.mmol : (d.mgdl/18);
    const cls  = classify(mmol);
    const dateKeyOut = d.date || dateKey;

    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = dateKeyOut;
    tr.appendChild(tdDate);

    const tdSlot = document.createElement('td');
    tdSlot.textContent = d.slotKey || d.slot || '—';
    tr.appendChild(tdSlot);

    const tdVal = document.createElement('td');
    const span = document.createElement('span');
    span.className = `v-${cls==='low'?'low':cls==='high'?'high':'in'}`;
    span.textContent = unit==='mgdl' ? Math.round(fromMmol(mmol,'mgdl')) : mmol.toFixed(1);
    tdVal.appendChild(span);
    tdVal.appendChild(document.createTextNode(` ${unit==='mgdl'?'mg/dL':'mmol/L'}`));
    tr.appendChild(tdVal);

    const tdBolus = document.createElement('td');
    tdBolus.textContent = d.bolusDose ?? '—';
    tr.appendChild(tdBolus);

    const tdCorr = document.createElement('td');
    tdCorr.textContent = d.correctionDose ?? '—';
    tr.appendChild(tdCorr);

    const tdNotes = document.createElement('td');
    const extra = d.treatLow ? ` • صححنا بإيه: ${d.treatLow}` : '';
    tdNotes.textContent = (d.notes || '—') + extra;
    tr.appendChild(tdNotes);

    const tdAct = document.createElement('td');
    tdAct.className = 'row-actions';
    const btn = document.createElement('button');
    btn.className = 'edit';
    btn.textContent = 'تعديل ✏️';
    btn.addEventListener('click', ()=> enterEditMode(d.id));
    tdAct.appendChild(btn);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });
}

/* ===== Edit mode ===== */
async function enterEditMode(id){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/measurements/${id}`);
  const s   = await getDoc(ref);
  if (!s.exists()) return alert('القياس غير موجود');
  fillFormFromDoc(s.data());
  editMode = { id };
  saveBtn.hidden = true;
  saveEditBtn.hidden = false;
  editBar.hidden = false;
}

/* ===== Save new / edit ===== */
async function saveCommon(isEdit){
  const unit    = unitSel.value;
  const mmol    = toMmol(valueInput.value, unit);
  if (mmol==null) return alert('من فضلك أدخل قيمة صحيحة');

  const dateKey = selectedDateKey();
  const when    = selectedWhen();
  const slotKey = (slotSel.value || 'RANDOM').toUpperCase();

  if (!ALLOW_DUP_KEYS.has(slotKey)){
    const dup = await existsDuplicate(dateKey, slotKey, isEdit ? editMode?.id : null);
    if (dup) return alert('هذا الوقت مسجّل بالفعل لهذا اليوم.');
  }

  const { min, max } = getRanges();
  const isHigh = mmol > max;
  const isLow  = mmol < min;

  const payload = {
    mmol, unit,
    when, date: dateKey,
    slotKey,
    // جرعة الوجبة اختيارية
    bolusDose:   bolusDose.value? Number(bolusDose.value): null,
    // التصحيحي يظهر فقط عند High
    correctionDose: isHigh && corrDose.value ? Number(corrDose.value) : null,
    // علاج الهبوط يظهر فقط عند Low
    treatLow: isLow && treatLowInput.value ? treatLowInput.value.trim() : null,
    notes: (notesInput.value||'').trim(),
    [isEdit ? 'updatedAt' : 'createdAt']: serverTimestamp()
  };
  if (unit==='mgdl'){ payload.mgdl = Number(valueInput.value); }

  if (isEdit){
    const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/measurements/${editMode.id}`);
    await updateDoc(ref, payload);
  } else {
    await addDoc(collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`), payload);
  }

  const dk = selectedDateKey();
  clearForm(true);
  await loadTableFor(dk);
}

const saveNew  = ()=> saveCommon(false);
const saveEdit = ()=> saveCommon(true);

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
saveEditBtn.addEventListener('click', saveEdit);
cancelEditBtn.addEventListener('click', ()=> clearForm(false));

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
    await loadTableFor(selectedDateKey()); // يعرض قياسات نفس التاريخ المختار
  }catch(e){
    console.error(e);
    alert(e.message || 'خطأ أثناء التحميل');
  }
});
