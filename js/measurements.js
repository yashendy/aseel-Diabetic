// js/measurements.js — النسخة الموحدة (slotKey/slotOrder + when)
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

/* ========= Slot Enum (ثابت) =========
   key ثابت + order + ترجمة عربية/إنجليزية */
const SLOT_ENUM = [
  { key:'WAKE',            ar:'الاستيقاظ',    en:'Wake',            order:10 },
  { key:'PRE_BREAKFAST',   ar:'ق.الفطار',     en:'Pre‑Breakfast',   order:20 },
  { key:'POST_BREAKFAST',  ar:'ب.الفطار',     en:'Post‑Breakfast',  order:30 },
  { key:'PRE_LUNCH',       ar:'ق.الغدا',      en:'Pre‑Lunch',       order:40 },
  { key:'POST_LUNCH',      ar:'ب.الغدا',      en:'Post‑Lunch',      order:50 },
  { key:'PRE_DINNER',      ar:'ق.العشا',      en:'Pre‑Dinner',      order:60 },
  { key:'POST_DINNER',     ar:'ب.العشا',      en:'Post‑Dinner',     order:70 },
  { key:'SNACK',           ar:'سناك',         en:'Snack',           order:80 },
  { key:'PRE_BED',         ar:'ق.النوم',      en:'Pre‑Bed',         order:90 },
  { key:'DURING_SLEEP',    ar:'أثناء النوم',  en:'During Sleep',    order:100 },
  { key:'PRE_SPORT',       ar:'ق.الرياضة',    en:'Pre‑Exercise',    order:110 },
  { key:'POST_SPORT',      ar:'ب.الرياضة',    en:'Post‑Exercise',   order:120 },
];
const SLOT_BY_KEY = new Map(SLOT_ENUM.map(s=>[s.key,s]));
const SLOT_BY_AR  = new Map(SLOT_ENUM.map(s=>[s.ar,s]));
const SLOT_BY_EN  = new Map(SLOT_ENUM.map(s=>[s.en,s]));

// سماح بتكرار Slot (سناك فقط)
const ALLOW_DUP_KEYS = new Set(['SNACK']);

// للعرض بالعربي
const arLabel = key => (SLOT_BY_KEY.get(key)?.ar || key);

/* تطبيع أي قيمة قديمة (عربي/إنجليزي/مفاتيح قديمة) → {key, order, ar, en} */
function normalizeSlot(value){
  if(!value) return null;
  // 1) إن كانت key حديثة
  if (SLOT_BY_KEY.has(value)) return SLOT_BY_KEY.get(value);
  // 2) عربي/إنجليزي مطابقين
  if (SLOT_BY_AR.has(value))  return SLOT_BY_AR.get(value);
  if (SLOT_BY_EN.has(value))  return SLOT_BY_EN.get(value);

  // 3) مفاتيح قديمة مختصرة (من نسخ سابقة)
  const LEGACY = {
    'pre_bf':'PRE_BREAKFAST','post_bf':'POST_BREAKFAST',
    'pre_ln':'PRE_LUNCH','post_ln':'POST_LUNCH',
    'pre_dn':'PRE_DINNER','post_dn':'POST_DINNER',
    'snack':'SNACK','wake':'WAKE','pre_bed':'PRE_BED','sleep':'DURING_SLEEP',
    'pre_sport':'PRE_SPORT','post_sport':'POST_SPORT',
    'ق.الفطار':'PRE_BREAKFAST','ب.الفطار':'POST_BREAKFAST',
    'ق.الغدا':'PRE_LUNCH','ب.الغدا':'POST_LUNCH',
    'ق.العشا':'PRE_DINNER','ب.العشا':'POST_DINNER',
    'سناك':'SNACK','الاستيقاظ':'WAKE','ق.النوم':'PRE_BED','أثناء النوم':'DURING_SLEEP'
  };
  const mapped = LEGACY[value];
  if (mapped && SLOT_BY_KEY.has(mapped)) return SLOT_BY_KEY.get(mapped);

  return null;
}

/* ========= حالة عامة ========= */
let USER=null, CHILD=null;
let normalMin=4.0, normalMax=7.0, CR=null, CF=null, severeHigh=13.9;
let editingId=null;
let _rows=[];

/* ========= Init ========= */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER=user;
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }

  // إعداد اليوم
  dayEl.value = todayStr();
  btnToday.addEventListener('click', ()=>{ dayEl.value=todayStr(); loadTable(); });

  // وحدات الإدخال/العرض
  inUnitEl.value  = localStorage.getItem('meas_in_unit') || 'mmol';
  outUnitEl.value = localStorage.getItem('meas_out_unit')|| 'mmol';

  inUnitEl.addEventListener('change', ()=>{
    localStorage.setItem('meas_in_unit', inUnitEl.value);
    updatePreviewAndVisibility();
  });
  outUnitEl.addEventListener('change', ()=>{
    localStorage.setItem('meas_out_unit', outUnitEl.value);
    renderRows(_rows);
  });

  // القوائم: وقت القياس بالعربي مع قيمة key
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

  // تحميل بيانات الطفل وجدول اليوم
  await loadChild();
  await loadTable();

  // أحداث فورية
  valueEl.addEventListener('input', updatePreviewAndVisibility);
  slotEl.addEventListener('change', updatePreviewAndVisibility);
  dayEl.addEventListener('change', async ()=>{
    const t = todayStr();
    if(dayEl.value > t){ alert('لا يمكن اختيار تاريخ مستقبلي'); dayEl.value=t; }
    await loadTable();
  });

  btnSave.addEventListener('click', saveMeasurement);
  btnReset.addEventListener('click', ()=> fillForm({}));
});

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

/* ========= Preview & Visibility ========= */
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

function getState(mmol, min, max){
  if(mmol==null||isNaN(+mmol)) return '';
  if(mmol < min) return 'low';
  if(mmol > max) return 'high';
  return 'normal';
}

function updatePreviewAndVisibility(){
  const mmol = readInputMmol();
  const mgdl = readInputMgdl();

  if(mmol==null){ convHint.textContent='—'; }
  else{
    convHint.textContent = inUnitEl.value==='mmol'
      ? `≈ ${fmtMgdl(mgdl)} mg/dL`
      : `≈ ${fmtMmol(mmol)} mmol/L`;
  }

  const isLow = (mmol!=null && mmol < normalMin);
  const isSevereHigh = (mmol!=null && mmol >= severeHigh);

  // Meal times: pre-*
  const mealKeys = new Set(['PRE_BREAKFAST','PRE_LUNCH','PRE_DINNER','SNACK']);
  const isMealTime = mealKeys.has(slotEl.value);

  wrapHypo.classList.toggle('hidden', !isLow);
  wrapCorrection.classList.toggle('hidden', !isSevereHigh);
  wrapBolus.classList.toggle('hidden', !isMealTime);

  if(isSevereHigh && CF){
    const over = mmol - normalMax;
    const sugg = Math.max(0, over / CF);
    corrHint.textContent = `اقتراح: ${sugg.toFixed(1)} U (فرق ${over.toFixed(1)} ÷ CF ${CF})`;
  }else{
    corrHint.textContent = '—';
  }
}

/* ========= جدول اليوم ========= */
async function loadTable(){
  loader(true);
  try{
    const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    const snap = await getDocs(query(base, where('date','==', dayEl.value)));
    _rows = snap.docs.map(d=> normalizeRow({ id:d.id, ...d.data() }));
    // ترتيب حسب order ثم when (إن وجد)
    _rows.sort((a,b)=>{
      const ao = a.slotOrder ?? 999, bo = b.slotOrder ?? 999;
      if(ao!==bo) return ao-bo;
      const aw = a.whenTs || 0, bw = b.whenTs || 0;
      return aw - bw;
    });
    renderRows(_rows);
  }catch(e){
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="8" class="muted">خطأ في التحميل</td></tr>`;
  }finally{
    loader(false);
  }
}

/* تطبيع صف قديم → يحوي دومًا slotKey/slotOrder لسهولة العرض */
function normalizeRow(r){
  // لو عنده key جاهز
  if (r.slotKey && (r.slotOrder!=null)) {
    return {
      ...r,
      whenTs: r.when?.toMillis ? r.when.toMillis() : (r.when || 0)
    };
  }
  // لو قديم: فيه slot (عربي/قديم)
  const norm = normalizeSlot(r.slot || r.slotAr || r.slotEn);
  if (norm) {
    return {
      ...r,
      slotKey: norm.key,
      slotOrder: norm.order,
      whenTs: r.when?.toMillis ? r.when.toMillis() : (r.when || 0)
    };
  }
  // غير معروف: حطه في آخر القائمة
  return { ...r, slotKey:'UNKNOWN', slotOrder:999, whenTs:0 };
}

function renderRows(rows){
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="8" class="muted">لا يوجد قياسات لهذا اليوم.</td></tr>`;
    return;
  }
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
      <td>${arLabel(r.slotKey)}</td>
      <td>${formatVal(r)}</td>
      <td class="${stClass}">${{normal:'طبيعي', high:'ارتفاع', low:'هبوط'}[st] || '—'}</td>
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

/* منع التكرار لنفس اليوم/slotKey (عدا SNACK) */
async function isDuplicate(date, slotKey, ignoreId=null){
  if(ALLOW_DUP_KEYS.has(slotKey)) return false;
  const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
  const snap = await getDocs(query(base, where('date','==',date), where('slotKey','==',slotKey)));
  if(snap.empty) return false;
  if(ignoreId) return snap.docs.some(d=> d.id!==ignoreId);
  return true;
}

/* ========= حفظ ========= */
async function saveMeasurement(){
  const date = dayEl.value || todayStr();
  const slotKey = slotEl.value;         // قيمة المفتاح الحديث
  const slotObj = SLOT_BY_KEY.get(slotKey);

  if(!slotObj){ alert('اختيار وقت القياس غير صالح'); return; }

  const raw  = Number(valueEl.value);
  if(isNaN(raw) || raw<0){ alert('أدخلي قيمة قياس صحيحة'); return; }

  const mmol = (inUnitEl.value==='mmol') ? raw : toMmol(raw);
  const mgdl = (inUnitEl.value==='mgdl') ? raw : toMgdl(raw);
  const unitLabel = (inUnitEl.value==='mgdl') ? 'mg/dL' : 'mmol/L';
  const state = getState(mmol, normalMin, normalMax);

  if(await isDuplicate(date, slotKey, editingId)){
    alert('لا يمكن تكرار نفس وقت القياس لنفس اليوم (سناك فقط مسموح).');
    return;
  }

  const payload = {
    // مفاتيح موحّدة
    date,
    when: serverTimestamp(),
    slotKey,
    slotOrder: slotObj.order,

    // قيم القياس بصيغ متعددة (للتوافق)
    unit: unitLabel,
    value: (unitLabel==='mg/dL') ? Number(mgdl) : Number(mmol.toFixed(1)),
    value_mmol: Number(mmol.toFixed(2)),
    value_mgdl: Number(mgdl),

    // حالة وحقول إضافية
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
      await updateDoc(doc(base, editingId), payload);
      showToast('تم تحديث القياس ✅');
    }else{
      await addDoc(base, payload);
      showToast('تم حفظ القياس ✅');
    }
    editingId=null;
    fillForm({});
    await loadTable();
  }catch(e){
    console.error(e);
    alert('تعذّر الحفظ');
  }finally{
    loader(false);
  }
}

/* تعبئة النموذج */
function fillForm(r={}){
  slotEl.value = r.slotKey || r.slot || 'PRE_BREAKFAST';

  if(r.id){
    const prefer = inUnitEl.value;
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

/* بدء التعديل */
async function startEdit(id){
  try{
    loader(true);
    editingId = id;
    const ref = doc(db, `parents/${USER.uid}/children/${childId}/measurements/${id}`);
    const snap = await getDoc(ref);
    if(!snap.exists()) return;
    const r = normalizeRow({ id, ...snap.data() });
    fillForm(r);
  }catch(e){
    console.error(e);
    alert('تعذر فتح التعديل');
  }finally{
    loader(false);
  }
}
