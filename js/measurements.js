// js/measurements.js — يعتمد التلوين على hypo/hyper ويظهر التصحيحي فوق normalMax
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, getDocs, query, where, doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ========= DOM ========= */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const loaderEl   = document.getElementById('loader');
const toastEl    = document.getElementById('toast');

const childNameEl= document.getElementById('childName');
const childMetaEl= document.getElementById('childMeta');
const chipRangeEl= document.getElementById('chipRange');
const chipCREl   = document.getElementById('chipCR');
const chipCFEl   = document.getElementById('chipCF');

const dayEl      = document.getElementById('day');
const btnToday   = document.getElementById('btnToday');
const btnBack    = document.getElementById('btnBack');
const btnMeals   = document.getElementById('btnMeals');

const slotEl     = document.getElementById('slot');
const valueEl    = document.getElementById('value');
const inUnitEl   = document.getElementById('inUnit');
const convHint   = document.getElementById('convHint');
const valueErr   = document.getElementById('valueErr');

const wrapCorrection   = document.getElementById('wrapCorrection');
const correctionDoseEl = document.getElementById('correctionDose');
const corrHint         = document.getElementById('corrHint');

const wrapBolus   = document.getElementById('wrapBolus');
const bolusDoseEl = document.getElementById('bolusDose');

const wrapHypo    = document.getElementById('wrapHypo');
const hypoTreatmentEl = document.getElementById('hypoTreatment');

const notesEl     = document.getElementById('notes');
const btnSave     = document.getElementById('btnSave');
const btnReset    = document.getElementById('btnReset');

const outUnitEl   = document.getElementById('outUnit');
const tbody       = document.getElementById('tbody');

/* ========= Helpers ========= */
const pad=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const showToast=(msg)=>{ if(!toastEl) return; toastEl.textContent=msg; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 2000); };
function loader(show){ loaderEl?.classList.toggle('hidden', !show); }
const toMgdl = mmol => Math.round(Number(mmol)*18);
const toMmol = mgdl => Number(mgdl)/18;
const fmtMmol = v => (v==null||isNaN(+v)?'—':Number(v).toFixed(1));
const fmtMgdl = v => (v==null||isNaN(+v)?'—':Math.round(Number(v)));

const MIN_MMOL = 2.0;
const MIN_MGDL = 36;

/* ========= Slot Enum ========= */
const SLOT_ENUM = [
  { key:'WAKE',            ar:'الاستيقاظ',    en:'Wake',            order:10 },
  { key:'PRE_BREAKFAST',   ar:'ق.الفطار',     en:'Pre-Breakfast',   order:20 },
  { key:'POST_BREAKFAST',  ar:'ب.الفطار',     en:'Post-Breakfast',  order:30 },
  { key:'PRE_LUNCH',       ar:'ق.الغدا',      en:'Pre-Lunch',       order:40 },
  { key:'POST_LUNCH',      ar:'ب.الغدا',      en:'Post-Lunch',      order:50 },
  { key:'PRE_DINNER',      ar:'ق.العشا',      en:'Pre-Dinner',      order:60 },
  { key:'POST_DINNER',     ar:'ب.العشا',      en:'Post-Dinner',     order:70 },
  { key:'SNACK',           ar:'سناك',         en:'Snack',           order:80 },
  { key:'PRE_BED',         ar:'ق.النوم',      en:'Pre-Bed',         order:90 },
  { key:'DURING_SLEEP',    ar:'أثناء النوم',  en:'During Sleep',    order:100 },
  { key:'PRE_SPORT',       ar:'ق.الرياضة',    en:'Pre-Exercise',    order:110 },
  { key:'POST_SPORT',      ar:'ب.الرياضة',    en:'Post-Exercise',   order:120 },
];
const SLOT_BY_KEY = new Map(SLOT_ENUM.map(s=>[s.key,s]));
const SLOT_BY_AR  = new Map(SLOT_ENUM.map(s=>[s.ar,s]));
const SLOT_BY_EN  = new Map(SLOT_ENUM.map(s=>[s.en,s]));
const ALLOW_DUP_KEYS = new Set(['SNACK']);
const arLabel = key => (SLOT_BY_KEY.get(key)?.ar || key);

/* تطبيع */
function normalizeSlot(value){
  if(!value) return null;
  if (SLOT_BY_KEY.has(value)) return SLOT_BY_KEY.get(value);
  if (SLOT_BY_AR.has(value))  return SLOT_BY_AR.get(value);
  if (SLOT_BY_EN.has(value))  return SLOT_BY_EN.get(value);
  return {key:String(value), ar:String(value), order:9999};
}

/* ========= حالة ========= */
let USER=null, CHILD=null;
let normalMin=4.0, normalMax=7.0, CR=null, CF=null;
let hypoLevel=3.5, hyperLevel=12;     // حدود التلوين
let severeLow=3.0, severeHigh=13.9;   // للتنبيهات الحرجة
let _rows=[];

/* ========= تحميل بيانات الطفل ========= */
async function loadChild(){
  loader(true);
  try{
    const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
    const snap = await getDoc(ref);
    if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
    CHILD = snap.data();

    childNameEl.textContent = CHILD.name || 'طفل';
    const age = (()=>{ if(!CHILD.birthDate) return '—'; const b=new Date(CHILD.birthDate), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return `${a} سنة`})();
    childMetaEl.textContent = `${CHILD.gender||'—'} • العمر: ${age}`;

    // النطاق الطبيعي للعرض + التصحيحي
    normalMin = Number(CHILD.normalRange?.min ?? 4.0);
    normalMax = Number(CHILD.normalRange?.max ?? 7.0);

    // حدود Low/High للتلوين والحساب
    hypoLevel  = Number(CHILD.hypoLevel  ?? normalMin);
    hyperLevel = Number(CHILD.hyperLevel ?? normalMax);

    // حدود شديدة (اختياري)
    severeLow  = Number(CHILD.normalRange?.severeLow  ?? (hypoLevel-0.5));
    severeHigh = Number(CHILD.normalRange?.severeHigh ?? 13.9);

    CR = CHILD.carbRatio!=null ? Number(CHILD.carbRatio) : null;
    CF = CHILD.correctionFactor!=null ? Number(CHILD.correctionFactor) : null;

    chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
    chipCREl.textContent    = `CR: ${CR ?? '—'} g/U`;
    chipCFEl.textContent    = `CF: ${CF ?? '—'} mmol/L/U`;
  }finally{
    loader(false);
  }
}

/* ====== إعداد min حسب الوحدة ====== */
function setInputMinByUnit(){
  if (inUnitEl.value === 'mmol') {
    valueEl.min = String(MIN_MMOL);
    valueEl.step = '0.1';
    valueEl.placeholder = 'مثال: 6.5';
  } else {
    valueEl.min = String(MIN_MGDL);
    valueEl.step = '1';
    valueEl.placeholder = 'مثال: 120';
  }
}

/* ====== التحقق الأدنى ====== */
function validateValue(){
  const raw = Number(valueEl.value);
  let ok = true;

  if (isNaN(raw)) {
    ok = false;
  } else {
    ok = (inUnitEl.value === 'mmol') ? (raw >= MIN_MMOL) : (raw >= MIN_MGDL);
  }
  valueErr.classList.toggle('hidden', ok || valueEl.value==='');
  btnSave.disabled = !ok;
  return ok;
}

/* ====== قراءة المدخل كـ mmol ====== */
function readInputMmol(){
  const v = Number(valueEl.value);
  if(Number.isNaN(v)) return null;
  return inUnitEl.value==='mmol' ? v : toMmol(v);
}
function readInputMgdl(){
  const v = Number(valueEl.value);
  if(Number.isNaN(v)) return null;
  return inUnitEl.value==='mgdl' ? v : toMgdl(v);
}

/* ====== حالة القياس بناءً على hypo/hyper ====== */
const getState = (mmol)=> (mmol==null||isNaN(+mmol)) ? '' :
  (mmol < hypoLevel ? 'low' : (mmol > hyperLevel ? 'high' : 'normal'));

/* ====== واجهة المعاينة (تصحيحي/هبوط/وجبة) ====== */
function updatePreviewAndVisibility(){
  const mmol = readInputMmol();
  const mgdl = readInputMgdl();

  convHint.textContent = (mmol==null) ? '—' :
    (inUnitEl.value==='mmol' ? `≈ ${fmtMgdl(mgdl)} mg/dL` : `≈ ${fmtMmol(mmol)} mmol/L`);

  const isLow        = (mmol!=null && mmol < hypoLevel);
  const aboveTarget  = (mmol!=null && mmol > normalMax); // التصحيحي على الحد الأعلى للنطاق الطبيعي
  const mealKeys = new Set(['PRE_BREAKFAST','PRE_LUNCH','PRE_DINNER','SNACK']);
  const isMealTime = mealKeys.has(slotEl.value);

  wrapHypo.classList.toggle('hidden', !isLow);
  wrapCorrection.classList.toggle('hidden', !aboveTarget);
  wrapBolus.classList.toggle('hidden', !isMealTime);

  // تلميح التصحيحي
  if (aboveTarget && CF){
    const delta = mmol - normalMax; // للوصول لحد النطاق الأعلى
    const dose  = Math.max(0, +(delta / CF).toFixed(1));
    corrHint.textContent = `اقتراح تقريبي للوصول إلى حد النطاق الأعلى (${normalMax} mmol/L)`;
    correctionDoseEl.value = dose ? String(dose) : '';
  } else {
    corrHint.textContent = '';
    correctionDoseEl.value = '';
  }
}

/* ====== تحميل جدول اليوم ====== */
async function loadTable(){
  loader(true);
  try{
    const ref = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    const qy  = query(ref, where('date','==', dayEl.value));
    const snap= await getDocs(qy);

    const rows=[];
    snap.forEach(d=>{
      const r=d.data();
      let mmol=null, mgdl=null;

      if(typeof r.value_mmol === 'number'){ mmol=Number(r.value_mmol); mgdl=toMgdl(mmol); }
      else if (typeof r.value_mgdl === 'number'){ mgdl=Number(r.value_mgdl); mmol=toMmol(mgdl); }
      else if (r.unit==='mmol/L' && typeof r.value==='number'){ mmol=Number(r.value); mgdl=toMgdl(mmol); }
      else if (r.unit==='mg/dL' && typeof r.value==='number'){ mgdl=Number(r.value); mmol=toMmol(mgdl); }

      const slotKey = (normalizeSlot(r.slotKey || r.slot || r.timeLabel || '')?.key) || 'RANDOM';
      const state = getState(mmol);

      rows.push({
        id:d.id, slotKey, mmol, mgdl,
        corr: r.correctionDose ?? '',
        bolus: r.bolusDose ?? '',
        hypo:  r.hypoTreatment ?? '',
        notes: r.notes ?? ''
      });
    });

    // ترتيب بسيط حسب slot.order
    rows.sort((a,b)=> (SLOT_BY_KEY.get(a.slotKey)?.order||999) - (SLOT_BY_KEY.get(b.slotKey)?.order||999));
    _rows = rows;
    renderRows(rows);
  }catch(e){
    console.error(e);
  }finally{
    loader(false);
  }
}

/* ====== رسم الجدول ====== */
function renderRows(rows){
  const unit = outUnitEl.value;
  const html = rows.map(r=>{
    const stClass = r.mmol==null ? '' : (r.mmol<hypoLevel?'state-low': (r.mmol>hyperLevel?'state-high':'state-ok'));
    const valTxt = unit==='mgdl' ? `${fmtMgdl(r.mgdl)} mg/dL` : `${fmtMmol(r.mmol)} mmol/L`;
    const stateTxt = r.mmol==null ? '—' : (r.mmol<hypoLevel ? 'انخفاض' : (r.mmol>hyperLevel ? 'ارتفاع' : 'طبيعي'));
    return `<tr class="${stClass}">
      <td>${arLabel(r.slotKey)}</td>
      <td class="reading">${valTxt}</td>
      <td>${stateTxt}</td>
      <td>${r.corr!=='' && r.corr!=null ? r.corr : '—'}</td>
      <td>${r.bolus!=='' && r.bolus!=null ? r.bolus : '—'}</td>
      <td>${r.hypo && String(r.hypo).trim() ? r.hypo : '—'}</td>
      <td>${r.notes && String(r.notes).trim() ? r.notes : '—'}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = html || `<tr><td colspan="7" class="muted center">لا توجد قياسات لليوم.</td></tr>`;
}

/* ====== حفظ قياس ====== */
async function saveMeasurement(){
  if(!validateValue()) return;

  const slotKey = (normalizeSlot(slotEl.value)?.key) || 'RANDOM';
  const mmol = readInputMmol();
  const mgdl = readInputMgdl();

  const state = getState(mmol);
  const data = {
    date: dayEl.value,
    slotKey,
    unit: inUnitEl.value==='mmol' ? 'mmol/L' : 'mg/dL',
    value_mmol: mmol==null? null : Number(mmol),
    value_mgdl: mgdl==null? null : Number(mgdl),
    state, // low|normal|high
    correctionDose: correctionDoseEl.value ? Number(correctionDoseEl.value) : null,
    bolusDose:      bolusDoseEl.value ? Number(bolusDoseEl.value) : null,
    hypoTreatment:  (hypoTreatmentEl.value||'').trim() || null,
    notes:          (notesEl.value||'').trim() || null,
    createdAt: serverTimestamp()
  };

  try{
    loader(true);
    const ref = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    await addDoc(ref, data);
    showToast('تم حفظ القياس ✅');
    notesEl.value = '';
    correctionDoseEl.value = '';
    bolusDoseEl.value = '';
    hypoTreatmentEl.value = '';
    valueEl.value = '';
    renderRows([]);
    await loadTable();
  }catch(e){
    console.error(e);
    alert('تعذّر الحفظ');
  }finally{
    loader(false);
  }
}

/* ========= Init ========= */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER=user;
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }

  dayEl.value = todayStr();
  btnToday.addEventListener('click', ()=>{ dayEl.value=todayStr(); loadTable(); });

  // إعداد الوحدات الافتراضية
  inUnitEl.value  = localStorage.getItem('meas_in_unit') || 'mmol';
  outUnitEl.value = localStorage.getItem('meas_out_unit')|| 'mmol';

  inUnitEl.addEventListener('change', ()=>{
    localStorage.setItem('meas_in_unit', inUnitEl.value);
    setInputMinByUnit();
    validateValue();
    updatePreviewAndVisibility();
  });
  outUnitEl.addEventListener('change', ()=>{
    localStorage.setItem('meas_out_unit', outUnitEl.value);
    renderRows(_rows);
  });

  // بناء قائمة الـ Slots
  slotEl.innerHTML = SLOT_ENUM
    .sort((a,b)=>a.order-b.order)
    .map(s=> `<option value="${s.key}">${s.ar}</option>`).join('');

  // تنقّل يحافظ على ?child
  btnBack.addEventListener('click', ()=>{
    location.href = `child.html?child=${encodeURIComponent(childId)}`;
  });
  btnMeals.addEventListener('click', ()=>{
    location.href = `meals.html?child=${encodeURIComponent(childId)}`;
  });

  await loadChild();
  await loadTable();

  // أحداث فورية
  valueEl.addEventListener('input', ()=>{
    validateValue();
    updatePreviewAndVisibility();
  });
  slotEl.addEventListener('change', updatePreviewAndVisibility);
  dayEl.addEventListener('change', async ()=>{
    const t = todayStr();
    if(dayEl.value > t){ alert('لا يمكن اختيار تاريخ مستقبلي'); dayEl.value=t; }
    await loadTable();
  });

  btnSave.addEventListener('click', saveMeasurement);
  btnReset.addEventListener('click', ()=> { valueEl.value=''; notesEl.value=''; correctionDoseEl.value=''; bolusDoseEl.value=''; hypoTreatmentEl.value=''; updatePreviewAndVisibility(); });

  // اضبط min الأولي حسب الوحدة
  setInputMinByUnit();
  validateValue();
  updatePreviewAndVisibility();
});
