// js/measurements.js — إدخال بوحدتين + بولس قبل الأكل + تصحيح/هبوط + جدول قابل للتعديل
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, getDocs, query, where, orderBy,
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- DOM ---------- */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const loaderEl = document.getElementById('loader');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');

const dayEl   = document.getElementById('day');
const slotEl  = document.getElementById('slot');
const valueEl = document.getElementById('value');
const inUnitEl= document.getElementById('inUnit');
const convHint= document.getElementById('convHint');

const wrapCorrection = document.getElementById('wrapCorrection');
const correctionDoseEl = document.getElementById('correctionDose');
const corrHint = document.getElementById('corrHint');

const wrapHypo = document.getElementById('wrapHypo');
const hypoTreatmentEl = document.getElementById('hypoTreatment');

const wrapBolus = document.getElementById('wrapBolus');
const bolusDoseEl = document.getElementById('bolusDose');
const bolusHintEl = document.getElementById('bolusHint');

const notesEl = document.getElementById('notes');
const btnSave = document.getElementById('btnSave');
const btnReset = document.getElementById('btnReset');

const outUnitEl = document.getElementById('outUnit');
const tbody = document.getElementById('tbody');

/* ---------- Helpers ---------- */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    const t=new Date(any);
    if(!isNaN(t)) return todayStr(t);
    if(/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    return any;
  }
  const d=(any?.toDate && typeof any.toDate==='function')? any.toDate(): new Date(any);
  return isNaN(d) ? '' : todayStr(d);
}
function loader(show){ loaderEl?.classList.toggle('hidden', !show); }

/* تحويل الوحدات */
const toMgdl  = mmol => Math.round(Number(mmol)*18);
const toMmol  = mgdl => Number(mgdl)/18;
const fmtMmol = v => (v==null||v==='')?'—':Number(v).toFixed(1);
const fmtMgdl = v => (v==null||v==='')?'—':Math.round(Number(v));

/* تعريف الخانات */
const SLOTS = [
  ['wake','الاستيقاظ'],
  ['pre_bf','ق.الفطار'], ['post_bf','ب.الفطار'],
  ['pre_ln','ق.الغدا'],  ['post_ln','ب.الغدا'],
  ['pre_dn','ق.العشا'],  ['post_dn','ب.العشا'],
  ['snack','سناك'],
  ['pre_sleep','ق.النوم'], ['during_sleep','أثناء النوم'],
  ['pre_ex','ق.الرياضة'], ['post_ex','ب.الرياضة'],
];
const PRE_MEAL = new Set(['pre_bf','pre_ln','pre_dn']);
const ALLOW_DUP = new Set(['snack','pre_ex','post_ex']);

/* حالة + اقتراح تصحيح */
function getState(mmol, min, max){
  if(mmol==null||isNaN(mmol)) return '';
  if(mmol < min) return 'low';
  if(mmol > max) return 'high';
  return 'normal';
}
function stateLabel(s){ return {normal:'طبيعي', high:'ارتفاع', low:'هبوط'}[s] || '—'; }

/* ---------- Child globals ---------- */
let USER=null, child=null;
let normalMin=4.0, normalMax=7.0, CR=null, CF=null;

/* ---------- Init ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER=user;
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }

  // تعبئة الخانات
  slotEl.innerHTML = SLOTS.map(([k,ar])=>`<option value="${k}">${ar}</option>`).join('');

  // افتراضات
  const today=todayStr();
  if(!dayEl.value) dayEl.value = today;
  inUnitEl.value = localStorage.getItem('meas_in_unit') || 'mmol';
  outUnitEl.value= localStorage.getItem('meas_out_unit')|| 'mmol';

  await loadChild();
  await loadTable();

  // Events
  dayEl.addEventListener('change', ()=>{
    const d = new Date(dayEl.value);
    const now = new Date(todayStr());
    if(d>now){ alert('لا يمكن اختيار تاريخ مستقبلي'); dayEl.value=today; }
    loadTable();
  });
  slotEl.addEventListener('change', updateUIByContext);
  valueEl.addEventListener('input', updateUIByContext);
  inUnitEl.addEventListener('change', ()=>{ localStorage.setItem('meas_in_unit', inUnitEl.value); updateUIByContext(); });

  outUnitEl.addEventListener('change', ()=>{ localStorage.setItem('meas_out_unit', outUnitEl.value); renderRows(_rowsCache); });

  btnSave.addEventListener('click', saveMeasurement);
  btnReset.addEventListener('click', resetForm);
});

/* ---------- Load child ---------- */
async function loadChild(){
  loader(true);
  try{
    const cref = doc(db, `parents/${USER.uid}/children/${childId}`);
    const csnap = await getDoc(cref);
    if(!csnap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
    child = csnap.data();

    childNameEl.textContent = child.name || 'طفل';
    const age = (()=>{ if(!child.birthDate) return '—'; const b=new Date(child.birthDate), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return `${a} سنة`;})();
    childMetaEl.textContent = `${child.gender || '—'} • العمر: ${age}`;

    normalMin = Number(child.normalRange?.min ?? 4.0);
    normalMax = Number(child.normalRange?.max ?? 7.0);
    CR = child.carbRatio!=null ? Number(child.carbRatio) : null;
    CF = child.correctionFactor!=null ? Number(child.correctionFactor) : null;

    chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
    chipCREl.textContent    = `CR: ${CR ?? '—'} g/U`;
    chipCFEl.textContent    = `CF: ${CF ?? '—'} mmol/L/U`;

    updateUIByContext();
  }finally{ loader(false); }
}

/* ---------- UI reactions ---------- */
function readInputMmol(){
  const val = Number(valueEl.value);
  if(isNaN(val)) return null;
  return inUnitEl.value==='mmol' ? val : toMmol(val);
}
function readInputMgdl(){
  const val = Number(valueEl.value);
  if(isNaN(val)) return null;
  return inUnitEl.value==='mgdl' ? val : toMgdl(val);
}
function updateUIByContext(){
  // تحويل فوري
  const mmol = readInputMmol();
  const mgdl = readInputMgdl();
  if(mmol!=null) convHint.textContent = inUnitEl.value==='mmol' ? `≈ ${fmtMgdl(mgdl)} mg/dL` : `≈ ${fmtMmol(mmol)} mmol/L`;
  else convHint.textContent = '—';

  // حالة القراءة
  const state = (mmol==null)? '' : getState(mmol, normalMin, normalMax);

  // إظهار/إخفاء التصحيح/هبوط
  wrapCorrection.classList.toggle('hidden', !(state==='high'));
  if(state==='high'){
    const suggest = (CF && mmol!=null && mmol>normalMax) ? Math.max(0, (mmol-normalMax)/CF) : null;
    corrHint.textContent = (suggest!=null) ? `اقتراح: ${(Math.round(suggest*10)/10)} U (من ${(mmol-normalMax).toFixed(1)} فوق الحد ÷ CF)` : '—';
  }
  wrapHypo.classList.toggle('hidden', !(state==='low'));

  // إظهار بولس قبل الأكل
  const s=slotEl.value;
  wrapBolus.classList.toggle('hidden', !PRE_MEAL.has(s));
}

/* ---------- Table ---------- */
let _rowsCache = [];

async function loadTable(){
  loader(true);
  try{
    const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    const snap = await getDocs(query(base, where('date','==', normalizeDateStr(dayEl.value))));
    const rows = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    // sort by slot order then time (if you had time)
    const order = new Map(SLOTS.map(([k],i)=>[k,i]));
    rows.sort((a,b)=>{
      const as = order.get(a.slot)||999, bs = order.get(b.slot)||999;
      if(as!==bs) return as-bs;
      return 0;
    });
    _rowsCache = rows;
    renderRows(rows);
  }catch(e){
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="8" class="muted">خطأ في تحميل البيانات.</td></tr>`;
  }finally{ loader(false); }
}

function renderRows(rows){
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="8" class="muted">لا يوجد قياسات لهذا اليوم.</td></tr>`;
    return;
  }
  const out = outUnitEl.value; // 'mmol'|'mgdl'

  const slotName = (k)=> (SLOTS.find(s=>s[0]===k)?.[1] || k);
  const fmtVal = (r)=>{
    const mmol = (r.value_mmol!=null)? r.value_mmol :
                 (r.unit==='mmol/L' ? r.value : (r.value_mgdl!=null ? toMmol(r.value_mgdl) : null));
    const mgdl = (r.value_mgdl!=null)? r.value_mgdl :
                 (r.unit==='mg/dL' ? r.value : (r.value_mmol!=null ? toMgdl(r.value_mmol) : null));
    return out==='mgdl' ? `${fmtMgdl(mgdl)} mg/dL` : `${fmtMmol(mmol)} mmol/L`;
  };
  const stateOf = (r)=>{
    const mmol = (r.value_mmol!=null)? r.value_mmol :
                 (r.unit==='mmol/L' ? r.value : (r.value_mgdl!=null ? toMmol(r.value_mgdl) : null));
    return getState(mmol, normalMin, normalMax);
  }

  tbody.innerHTML = rows.map(r=>{
    const st = stateOf(r);
    const stClass = st==='high'?'state-high': st==='low'?'state-low':'state-ok';
    return `<tr data-id="${r.id}">
      <td>${slotName(r.slot)}</td>
      <td>${fmtVal(r)}</td>
      <td class="${stClass}">${stateLabel(st)}</td>
      <td>${(r.correctionDose!=null && r.correctionDose!=='') ? r.correctionDose : '—'}</td>
      <td>${(r.bolusDose!=null && r.bolusDose!=='') ? r.bolusDose : '—'}</td>
      <td>${r.hypoTreatment && String(r.hypoTreatment).trim() ? r.hypoTreatment : '—'}</td>
      <td class="note">${r.notes && String(r.notes).trim() ? r.notes : '—'}</td>
      <td><button class="btn btn-sm" data-edit="${r.id}">تعديل</button></td>
    </tr>`;
  }).join('');

  // تهيئة أزرار التعديل
  tbody.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> startEdit(btn.dataset.edit));
  });
}

/* ---------- Save / Edit ---------- */
let editingId = null;

function resetForm(){
  editingId = null;
  slotEl.value = SLOTS[0][0];
  valueEl.value = '';
  correctionDoseEl.value = '';
  bolusDoseEl.value = '';
  hypoTreatmentEl.value = '';
  notesEl.value = '';
  updateUIByContext();
}

async function saveMeasurement(){
  const date = normalizeDateStr(dayEl.value);
  if(!date){ alert('اختاري يومًا صحيحًا'); return; }
  const today = todayStr();
  if(new Date(date) > new Date(today)){ alert('لا يمكن اختيار تاريخ مستقبلي'); dayEl.value=today; return; }

  const slot = slotEl.value;
  const raw  = Number(valueEl.value);
  if(isNaN(raw) || raw<0){ alert('أدخلي قيمة قياس صحيحة'); return; }

  const inUnit = inUnitEl.value; // 'mmol' or 'mgdl'
  const mmol = readInputMmol();
  const mgdl = readInputMgdl();
  if(mmol==null || mgdl==null){ alert('القيمة غير صالحة'); return; }

  const state = getState(mmol, normalMin, normalMax);
  const correctionDose = correctionDoseEl.value===''? null : Number(correctionDoseEl.value);
  const bolusDose = (PRE_MEAL.has(slot) && bolusDoseEl.value!=='') ? Number(bolusDoseEl.value) : null;
  const hypoTreatment = (state==='low' && hypoTreatmentEl.value.trim()) ? hypoTreatmentEl.value.trim() : null;
  const notes = notesEl.value.trim() || null;

  // منع التكرار (عدا سناك/رياضة)
  if(!ALLOW_DUP.has(slot)){
    const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    const snap = await getDocs(query(base, where('date','==',date), where('slot','==',slot)));
    const exists = snap.docs.some(d=> d.id !== editingId);
    if(exists){ alert('لا يمكن تكرار نفس الوقت لنفس اليوم'); return; }
  }

  const payload = {
    date, slot,
    unit: inUnit==='mgdl' ? 'mg/dL' : 'mmol/L',
    value: inUnit==='mgdl' ? Number(raw) : Number(raw), // نفس ما أدخله المستخدم
    value_mmol: Number(mmol),
    value_mgdl: Number(mgdl),
    state,
    correctionDose,
    bolusDose,
    hypoTreatment,
    notes
  };

  loader(true);
  try{
    const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    if(editingId){
      await updateDoc(doc(db, `parents/${USER.uid}/children/${childId}/measurements/${editingId}`), payload);
      alert('تم التحديث بنجاح');
    }else{
      await addDoc(base, payload);
      alert('تم الحفظ');
    }
    await loadTable();
    resetForm();
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ');
  }finally{ loader(false); }
}

function fillFormFromRow(r){
  // اليوم ثابت من شريط التاريخ
  slotEl.value = r.slot || SLOTS[0][0];

  // املأ القيمة بوحدة الإدخال الحالية أو بوحدة القياس المحفوظة
  const prefer = inUnitEl.value; // 'mmol' | 'mgdl'
  const mmol = (r.value_mmol!=null)? r.value_mmol :
               (r.unit==='mmol/L' ? r.value : (r.value_mgdl!=null? toMmol(r.value_mgdl) : null));
  const mgdl = (r.value_mgdl!=null)? r.value_mgdl :
               (r.unit==='mg/dL' ? r.value : (r.value_mmol!=null? toMgdl(r.value_mmol) : null));
  valueEl.value = prefer==='mgdl' ? (mgdl ?? '') : (mmol ?? '');
  // التصحيح/الهبوط/البولس
  correctionDoseEl.value = (r.correctionDose!=null && r.correctionDose!=='') ? r.correctionDose : '';
  hypoTreatmentEl.value  = r.hypoTreatment || '';
  bolusDoseEl.value      = (r.bolusDose!=null && r.bolusDose!=='') ? r.bolusDose : '';
  notesEl.value          = r.notes || '';

  updateUIByContext();
}

function startEdit(id){
  editingId = id;
  const row = _rowsCache.find(r=> r.id===id);
  if(!row) return;
  fillFormFromRow(row);
  // تمرير المستخدم لوحدة الإدخال التي حُفظ بها القياس (اختياري):
  if(row.unit==='mg/dL'){ inUnitEl.value='mgdl'; localStorage.setItem('meas_in_unit','mgdl'); }
  else { inUnitEl.value='mmol'; localStorage.setItem('meas_in_unit','mmol'); }
  updateUIByContext();
}
