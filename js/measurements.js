// القياسات — إدخال بوحدتين + بولس + منطق إظهار/إخفاء الخانات حسب النطاق + جدول اليوم
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, getDocs, query, where, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* DOM */
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

const wrapBolus = document.getElementById('wrapBolus');
const bolusDoseEl = document.getElementById('bolusDose');

const wrapHypo = document.getElementById('wrapHypo');
const hypoTreatmentEl = document.getElementById('hypoTreatment');

const notesEl = document.getElementById('notes');
const btnSave = document.getElementById('btnSave');
const btnReset= document.getElementById('btnReset');

const outUnitEl = document.getElementById('outUnit');
const tbody = document.getElementById('tbody');

/* Helpers */
const pad=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
function loader(show){loaderEl?.classList.toggle('hidden',!show);}

const toMgdl = mmol => Math.round(Number(mmol)*18);
const toMmol = mgdl => Number(mgdl)/18;
const fmtMmol = v => (v==null||isNaN(+v)?'—':Number(v).toFixed(1));
const fmtMgdl = v => (v==null||isNaN(+v)?'—':Math.round(Number(v)));

/* سلوطات (أوقات القياس) */
const SLOTS = [
  ['wake','الاستيقاظ'],
  ['pre_bf','ق.الفطار'], ['post_bf','ب.الفطار'],
  ['pre_ln','ق.الغدا'],  ['post_ln','ب.الغدا'],
  ['pre_dn','ق.العشا'],  ['post_dn','ب.العشا'],
  ['snack','سناك'],
  ['pre_sleep','ق.النوم'], ['during_sleep','أثناء النوم'],
];
const ALLOW_DUP = new Set(['snack']); // مسموح تكرار السناك فقط

function slotLabel(k){ return SLOTS.find(s=>s[0]===k)?.[1] || k; }

/* تقييم الحالة */
function getState(mmol, min, max){
  if(mmol==null||isNaN(+mmol)) return '';
  if(mmol < min) return 'low';
  if(mmol > max) return 'high';
  return 'normal';
}
function stateLabel(s){ return {normal:'طبيعي', high:'ارتفاع', low:'هبوط'}[s] || '—'; }

/* Child globals */
let USER=null, CHILD=null;
let normalMin=4.0, normalMax=7.0, CR=null, CF=null, severeHigh=13.9; // severeHigh افتراضي 13.9 mmol/L (~250 mg/dL)
let editingId=null;
let _rows=[];

/* Init */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER=user;
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }

  // تعبئة الخيارات
  slotEl.innerHTML = SLOTS.map(([k,ar])=> `<option value="${k}">${ar}</option>`).join('');
  dayEl.value = todayStr();
  inUnitEl.value = localStorage.getItem('meas_in_unit') || 'mmol';
  outUnitEl.value= localStorage.getItem('meas_out_unit')|| 'mmol';

  await loadChild();
  await loadTable();

  // أحداث
  valueEl.addEventListener('input', updatePreviewAndVisibility);
  inUnitEl.addEventListener('change', ()=>{ localStorage.setItem('meas_in_unit', inUnitEl.value); updatePreviewAndVisibility(); });
  dayEl.addEventListener('change', async ()=>{
    const t = todayStr();
    if(dayEl.value > t){ alert('لا يمكن اختيار تاريخ مستقبلي'); dayEl.value=t; }
    await loadTable();
  });
  outUnitEl.addEventListener('change', ()=>{ localStorage.setItem('meas_out_unit', outUnitEl.value); renderRows(_rows); });

  btnSave.addEventListener('click', saveMeasurement);
  btnReset.addEventListener('click', ()=> fillForm({}));
});

/* تحميل بيانات الطفل */
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

    normalMin = Number(CHILD.normalRange?.min ?? 4.0);
    normalMax = Number(CHILD.normalRange?.max ?? 7.0);
    CR = CHILD.carbRatio!=null ? Number(CHILD.carbRatio) : null;
    CF = CHILD.correctionFactor!=null ? Number(CHILD.correctionFactor) : null;
    severeHigh = Number(CHILD.severeHigh ?? 13.9);

    chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
    chipCREl.textContent    = `CR: ${CR ?? '—'} g/U`;
    chipCFEl.textContent    = `CF: ${CF ?? '—'} mmol/L/U`;

    updatePreviewAndVisibility();
  }finally{
    loader(false);
  }
}

/* قراءة قيمة الإدخال بوحدتين */
function readInputMmol(){
  const raw = Number(valueEl.value);
  if(isNaN(raw)) return null;
  return inUnitEl.value==='mmol' ? raw : toMmol(raw);
}
function readInputMgdl(){
  const raw = Number(valueEl.value);
  if(isNaN(raw)) return null;
  return inUnitEl.value==='mgdl' ? raw : toMgdl(raw);
}

/* تحديث المعاينة + إظهار/إخفاء الخانات حسب المنطق الجديد */
function updatePreviewAndVisibility(){
  const mmol = readInputMmol();
  const mgdl = readInputMgdl();

  // معاينة التحويل
  if(mmol==null){ convHint.textContent='—'; }
  else{
    convHint.textContent = inUnitEl.value==='mmol'
      ? `≈ ${fmtMgdl(mgdl)} mg/dL`
      : `≈ ${fmtMmol(mmol)} mmol/L`;
  }

  // منطق عرض الخانات:
  // - لو هبوط (< normalMin): إظهار "رفعنا بإيه؟" فقط
  // - لو ارتفاع شديد (>= severeHigh): إظهار "جرعة تصحيحية" فقط (+ اقتراح لو CF)
  // - خلاف ذلك (بين الطبيعي وحتى ما قبل الشديد): إخفاء الاثنين
  const isLow = (mmol!=null && mmol < normalMin);
  const isSevereHigh = (mmol!=null && mmol >= severeHigh);

  wrapHypo.classList.toggle('hidden', !isLow);
  wrapCorrection.classList.toggle('hidden', !isSevereHigh);

  // تلميح الاقتراح للتصحيح لو Severe High ومعنا CF
  if(isSevereHigh && CF){
    const over = mmol - normalMax;
    const sugg = Math.max(0, over / CF);
    corrHint.textContent = `اقتراح: ${sugg.toFixed(1)} U (فرق ${over.toFixed(1)} ÷ CF ${CF})`;
  }else{
    corrHint.textContent = '—';
    // لا نفرّغ الحقول تلقائيًا؛ المستخدم قد يُدخل يدويًا حسب توجيه الطبيب
  }
}

/* تحميل جدول اليوم (كل قياسات اليوم المحدّد) */
async function loadTable(){
  loader(true);
  try{
    const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    const snap = await getDocs(query(base, where('date','==', dayEl.value)));
    _rows = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    // ترتيب بالـ slot
    const order = new Map(SLOTS.map(([k],i)=>[k,i]));
    _rows.sort((a,b)=> (order.get(a.slot)||999) - (order.get(b.slot)||999));
    renderRows(_rows);
  }catch(e){
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="8" class="muted">خطأ في التحميل</td></tr>`;
  }finally{
    loader(false);
  }
}

function renderRows(rows){
  if(!rows.length){ tbody.innerHTML = `<tr><td colspan="8" class="muted">لا يوجد قياسات لهذا اليوم.</td></tr>`; return; }
  const out = outUnitEl.value;

  const formatVal = (r)=>{
    const mmol = (r.value_mmol!=null) ? r.value_mmol :
                 (r.unit==='mmol/L' ? r.value :
                  (r.value_mgdl!=null ? toMmol(r.value_mgdl) : null));
    const mgdl = (r.value_mgdl!=null) ? r.value_mgdl :
                 (r.unit==='mg/dL' ? r.value :
                  (r.value_mmol!=null ? toMgdl(r.value_mmol) : null));
    return out==='mgdl' ? `${fmtMgdl(mgdl)} mg/dL` : `${fmtMmol(mmol)} mmol/L`;
  };

  const stateOf = (r)=>{
    const mmol = (r.value_mmol!=null) ? r.value_mmol :
                 (r.unit==='mmol/L' ? r.value :
                  (r.value_mgdl!=null ? toMmol(r.value_mgdl) : null));
    return getState(mmol, normalMin, normalMax);
  };

  tbody.innerHTML = rows.map(r=>{
    const st = stateOf(r);
    const stClass = st==='high'?'state-high': st==='low'?'state-low':'state-ok';
    return `<tr data-id="${r.id}">
      <td>${slotLabel(r.slot)}</td>
      <td>${formatVal(r)}</td>
      <td class="${stClass}">${stateLabel(st)}</td>
      <td>${(r.correctionDose!=null && r.correctionDose!=='') ? r.correctionDose : '—'}</td>
      <td>${(r.bolusDose!=null && r.bolusDose!=='') ? r.bolusDose : '—'}</td>
      <td>${r.hypoTreatment && String(r.hypoTreatment).trim()? r.hypoTreatment : '—'}</td>
      <td>${r.notes && String(r.notes).trim()? r.notes : '—'}</td>
      <td><button class="btn" data-edit="${r.id}">تعديل</button></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> startEdit(btn.dataset.edit));
  });
}

async function isDuplicate(date, slot, ignoreId=null){
  if(ALLOW_DUP.has(slot)) return false;
  const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
  const snap = await getDocs(query(base, where('date','==',date), where('slot','==',slot)));
  if(snap.empty) return false;
  if(ignoreId) return snap.docs.some(d=> d.id!==ignoreId);
  return true;
}

/* حفظ قياس */
async function saveMeasurement(){
  const date = dayEl.value || todayStr();
  const slot = slotEl.value;
  const raw  = Number(valueEl.value);

  if(isNaN(raw) || raw<0){ alert('أدخلي قيمة قياس صحيحة'); return; }

  const mmol = (inUnitEl.value==='mmol') ? raw : toMmol(raw);
  const mgdl = (inUnitEl.value==='mgdl') ? raw : toMgdl(raw);
  const unitLabel = (inUnitEl.value==='mgdl') ? 'mg/dL' : 'mmol/L';
  const state = getState(mmol, normalMin, normalMax);

  if(await isDuplicate(date, slot, editingId)){
    alert('لا يمكن تكرار نفس وقت القياس لنفس اليوم (سناك فقط مسموح).');
    return;
  }

  const payload = {
    date, slot,
    unit: unitLabel,
    value: (unitLabel==='mg/dL') ? Number(mgdl) : Number(mmol.toFixed(1)), // للتوافق القديم
    value_mmol: Number(mmol.toFixed(2)),
    value_mgdl: Number(mgdl),
    state,
    correctionDose: (correctionDoseEl.value==='') ? null : Number(correctionDoseEl.value),
    bolusDose:      (bolusDoseEl.value==='')      ? null : Number(bolusDoseEl.value),
    hypoTreatment:  (state==='low' && hypoTreatmentEl.value) ? hypoTreatmentEl.value : (hypoTreatmentEl.value || null),
    notes:          notesEl.value || null
  };

  try{
    loader(true);
    const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    if(editingId){
      await updateDoc(doc(db, `parents/${USER.uid}/children/${childId}/measurements/${editingId}`), payload);
      alert('تم تحديث القياس');
    }else{
      await addDoc(base, payload);
      alert('تم حفظ القياس');
    }
    editingId=null;
    fillForm({});
    await loadTable();
  }catch(e){
    console.error(e);
    alert('تعذر الحفظ');
  }finally{
    loader(false);
  }
}

/* تعبئة النموذج للتحرير */
function fillForm(r={}){
  slotEl.value = r.slot || SLOTS[0][0];

  if(r.id){
    const prefer = inUnitEl.value; // 'mmol'|'mgdl'
    const mmol = (r.value_mmol!=null)? r.value_mmol :
                 (r.unit==='mmol/L' ? r.value : (r.value_mgdl!=null ? toMmol(r.value_mgdl) : null));
    const mgdl = (r.value_mgdl!=null)? r.value_mgdl :
                 (r.unit==='mg/dL' ? r.value : (r.value_mmol!=null ? toMgdl(r.value_mmol) : null));
    valueEl.value = (prefer==='mgdl') ? (mgdl ?? '') : (mmol ?? '');
    correctionDoseEl.value = r.correctionDose ?? '';
    bolusDoseEl.value      = r.bolusDose ?? '';
    hypoTreatmentEl.value  = r.hypoTreatment ?? '';
    notesEl.value          = r.notes ?? '';
  }else{
    valueEl.value = '';
    correctionDoseEl.value = '';
    bolusDoseEl.value = '';
    hypoTreatmentEl.value = '';
    notesEl.value = '';
  }

  updatePreviewAndVisibility();
}

async function startEdit(id){
  try{
    loader(true);
    editingId = id;
    const ref = doc(db, `parents/${USER.uid}/children/${childId}/measurements/${id}`);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    const r = snap.data();
    fillForm({ id, ...r });
  }catch(e){
    console.error(e);
    alert('تعذر فتح التعديل');
  }finally{
    loader(false);
  }
}
