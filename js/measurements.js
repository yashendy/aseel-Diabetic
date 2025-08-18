// js/measurements.js
// ===========================================================
// 0) الحصول على childId مع fallback + إعادة توجيه عند غيابه
// ===========================================================
const qsInit = new URLSearchParams(location.search);
let childId = qsInit.get('child') || localStorage.getItem('lastChildId');
if (!childId) {
  // لا يوجد معرف طفل → ارجعي لاختيار الطفل
  location.replace('parent.html?pickChild=1');
  throw new Error('Missing childId → redirecting to parent.html');
}
// خزني آخر طفل كـ fallback لاحقًا
localStorage.setItem('lastChildId', childId);

// ===========================================================
// 1) استيراد Firebase + عناصر الصفحة + fallback للـ loader
// ===========================================================
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  where, query, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// fallback للودر لو غير موجود لمنع crash مبكر
const loaderEl = document.getElementById('loader') || (() => {
  const d = document.createElement('div');
  d.id = 'loader';
  d.className = 'loader hidden';
  d.textContent = 'جارِ التحميل…';
  document.body.appendChild(d);
  return d;
})();
function loader(show){ loaderEl.classList.toggle('hidden', !show); }

// عناصر
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl = document.getElementById('chipCR');
const chipCFEl = document.getElementById('chipCF');
const chipSevereLowEl  = document.getElementById('chipSevereLow');
const chipSevereHighEl = document.getElementById('chipSevereHigh');

const dayInput   = document.getElementById('day');
const slotSelect = document.getElementById('slot');
const valueInput = document.getElementById('value');

const wrapCorrection       = document.getElementById('wrapCorrection');
const correctionDoseInput  = document.getElementById('correctionDose');
const corrHint             = document.getElementById('corrHint');

const wrapHypo            = document.getElementById('wrapHypo');
const hypoTreatmentInput  = document.getElementById('hypoTreatment');

const notesInput = document.getElementById('notes');
const btnSave    = document.getElementById('btnSave');

const tbody = document.getElementById('tbody');

// أدوات
const pad = n => String(n).padStart(2,'0');
const fmtDate = (d)=> `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const arDate  = (d)=> d.toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

// ترتيب الأوقات
const SLOTS = [
  {key:'WAKE',       label:'الاستيقاظ',     order: 1, multi:false},
  {key:'PRE_BF',     label:'ق.الفطار',      order: 2, multi:false},
  {key:'POST_BF',    label:'ب.الفطار',      order: 3, multi:false},
  {key:'PRE_LUNCH',  label:'ق.الغداء',      order: 4, multi:false},
  {key:'POST_LUNCH', label:'ب.الغداء',      order: 5, multi:false},
  {key:'PRE_DIN',    label:'ق.العشاء',      order: 6, multi:false},
  {key:'POST_DIN',   label:'ب.العشاء',      order: 7, multi:false},
  {key:'SNACK',      label:'سناك',          order: 8, multi:true },
  {key:'PRE_SLEEP',  label:'ق.النوم',       order: 9, multi:false},
  {key:'MIDNIGHT',   label:'أثناء النوم',   order:10, multi:false},
  {key:'PRE_SPORT',  label:'ق.الرياضة',     order:11, multi:true },
  {key:'POST_SPORT', label:'ب.الرياضة',     order:12, multi:true },
];
const SLOT_BY_KEY = Object.fromEntries(SLOTS.map(s=>[s.key,s]));

// حالة الطفل
let currentUser;
let childData = {
  normalRange:{min:4,max:7},
  carbRatio:null,
  correctionFactor:null,
  severeLow:null,
  severeHigh:null,
};

// تهيئة
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  currentUser = user;

  try{
    loader(true);
    initSlotsSelect();
    await loadChildHeader();
    initDate();
    bindEvents();
    await loadDayTable();
  }catch(err){
    console.error('[init error]', err);
    alert('حدث خطأ في تحميل الصفحة');
  }finally{
    loader(false);
  }
});

// تعبئة قائمة الأوقات
function initSlotsSelect(){
  slotSelect.innerHTML = SLOTS
    .map(s => `<option value="${s.key}">${s.label}</option>`)
    .join('');
  // ✅ عيّن اختيار افتراضي علشان مايبقاش فاضي
  if (!slotSelect.value) slotSelect.value = SLOTS[0].key; // 'WAKE'
}


// تحميل بيانات الطفل للواجهة
async function loadChildHeader(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  console.log('[firestore] child path:', ref.path);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    alert('❌ لم يتم العثور على هذا الطفل.'); 
    location.replace('parent.html?pickChild=1');
    throw new Error('child not found');
  }
  const c = snap.data();

  childData.normalRange = {
    min: Number(c.normalRange?.min ?? 4),
    max: Number(c.normalRange?.max ?? 7),
  };
  childData.carbRatio        = c.carbRatio != null ? Number(c.carbRatio) : null;
  childData.correctionFactor = c.correctionFactor != null ? Number(c.correctionFactor) : null;
  childData.severeLow        = c.severeLow  != null ? Number(c.severeLow)  : null;
  childData.severeHigh       = c.severeHigh != null ? Number(c.severeHigh) : null;

  childNameEl.textContent = c.name || 'طفل';
  childMetaEl.textContent = `${c.gender || '—'} • العمر: ${calcAge(c.birthDate)} سنة`;

  chipRangeEl.textContent      = `النطاق: ${childData.normalRange.min}–${childData.normalRange.max} mmol/L`;
  chipCREl.textContent         = `CR: ${childData.carbRatio ?? '—'} g/U`;
  chipCFEl.textContent         = `CF: ${childData.correctionFactor ?? '—'} mmol/L/U`;
  chipSevereLowEl.textContent  = `Low≤${childData.severeLow ?? '—'}`;
  chipSevereHighEl.textContent = `High≥${childData.severeHigh ?? '—'}`;
}

function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

function initDate(){
  const now = new Date();
  dayInput.value = fmtDate(now);
  dayInput.max   = fmtDate(now); // منع إدخال المستقبل
}

function bindEvents(){
  valueInput.addEventListener('input', onValueChange);
  dayInput.addEventListener('change', onDayChange);
  btnSave.addEventListener('click', onSave);
}

async function onDayChange(){
  if(!dayInput.value) return;
  const sel = new Date(dayInput.value);
  const today = new Date(fmtDate(new Date())); // منتصف ليل اليوم
  if(sel > today){
    alert('⛔ لا يمكن اختيار تاريخ بعد تاريخ اليوم');
    dayInput.value = fmtDate(new Date());
  }
  await loadDayTable();
}

function onValueChange(){
  const v = Number(valueInput.value);
  const {min, max} = childData.normalRange;
  const cf = Number(childData.correctionFactor || 0);

  if (wrapHypo) wrapHypo.classList.toggle('hidden', !(v>0 && v < min));

  if(v>0 && v > max && cf>0){
    if (wrapCorrection){
      const diff = v - max;                                // بداية الحساب من الحد الأعلى
      const dose = Math.round((diff / cf) * 10) / 10;      // جرعة مقترحة
      wrapCorrection.classList.remove('hidden');
      correctionDoseInput.value = dose;
      if (corrHint) corrHint.textContent = `فرق: ${diff.toFixed(1)} mmol/L • CF=${cf} ⇒ جرعة ≈ ${dose}U`;
    }
  }else{
    if (wrapCorrection){
      wrapCorrection.classList.add('hidden');
      correctionDoseInput.value = '';
      if (corrHint) corrHint.textContent = '—';
    }
  }
}

// حفظ القياس
async function onSave(){
  const date = dayInput.value;
  const slotKey = slotSelect.value;
  const slotDef = SLOT_BY_KEY[slotKey];
  const value = Number(valueInput.value);

  if(!date){ alert('اختاري التاريخ'); return; }
  if(!slotKey){ alert('اختاري وقت القياس'); return; }
  if(!(value>0)){ alert('أدخلي قيمة القياس (mmol/L)'); return; }

  const data = {
    date,
    slotKey,
    slotLabel: slotDef.label,
    slotOrder: slotDef.order,
    value_mmol: value,
    correctionDose: correctionDoseInput.value ? Number(correctionDoseInput.value) : null,
    hypoTreatment: wrapHypo && !wrapHypo.classList.contains('hidden') ? (hypoTreatmentInput.value || null) : null,
    notes: notesInput.value || null,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  try{
    loader(true);
    const col = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);

    if(slotDef.multi){
      // الأوقات المسموح فيها بتكرارات (سناك/رياضة)
      await addDoc(col, data);
    }else{
      // غير مسموح بتكرار (اليوم+الوقت)
      const id = `${date}__${slotKey}`;
      const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/measurements/${id}`);
      const exists = await getDoc(ref);
      if(exists.exists()){
        alert('⛔ لا يمكن تسجيل نفس الوقت لنفس اليوم. يمكنك تعديل السجل من الجدول.');
        return;
      }
      await setDoc(ref, data, {merge:true});
    }

    // تنظيف الحقول + تحديث الجدول
    valueInput.value = '';
    correctionDoseInput.value = '';
    hypoTreatmentInput.value = '';
    notesInput.value = '';
    onValueChange();
    await loadDayTable();
  }catch(e){
    console.error(e);
    alert('تعذّر الحفظ. تأكدي من الاتصال بالإنترنت.');
  }finally{
    loader(false);
  }
}

// تحميل قياسات اليوم
async function loadDayTable(){
  try {
    loader(true);
    tbody.innerHTML = `<tr><td colspan="7">جار التحميل...</td></tr>`;

    const day = dayInput.value;
    if(!day){
      tbody.innerHTML = `<tr><td colspan="7">اختر تاريخاً</td></tr>`;
      return;
    }

    const qRef = collection(db, `parents/${auth.currentUser.uid}/children/${childId}/measurements`);
    const q = query(qRef, where('date','==',day), orderBy('time','asc'));
    const snap = await getDocs(q);

    if (snap.empty){
      tbody.innerHTML = `<tr><td colspan="7">لا توجد قياسات لهذا اليوم.</td></tr>`;
      return;
    }

    // ✅ املى الجدول بالنتائج
    let rows = '';
    snap.forEach(docSnap=>{
      const m = docSnap.data();
      rows += `
        <tr>
          <td>${m.time||'-'}</td>
          <td>${m.value||'-'}</td>
          <td>${m.state||'-'}</td>
          <td>${m.correction||'-'}</td>
          <td>${m.lowTreat||'-'}</td>
          <td>${m.notes||''}</td>
          <td><button class="btn small" onclick="editMeasure('${docSnap.id}')">✎</button></td>
        </tr>`;
    });
    tbody.innerHTML = rows;

  } catch(e){
    console.error("❌ loadDayTable error:", e);
    tbody.innerHTML = `<tr><td colspan="7">خطأ في تحميل البيانات</td></tr>`;
  } finally {
    loader(false);   // ✅ يضمن إخفاء "جار التحميل..."
  }
}


/* تحرير صف */
function attachRowEditing(tr, r){
  const btnEdit = tr.querySelector('.btn-edit');
  const btnSave = tr.querySelector('.btn-save');
  const btnCancel = tr.querySelector('.btn-cancel');

  const toInputs = ()=>{
    tr.classList.add('edit-row');
    const tds = tr.querySelectorAll('td');
    tds[1].innerHTML = `<input class="inp-val" type="number" step="0.1" min="0" value="${r.value_mmol ?? ''}">`;
    tds[3].innerHTML = `<input class="inp-corr" type="number" step="0.1" min="0" value="${r.correctionDose ?? ''}">`;
    tds[4].innerHTML = `<input class="inp-hypo" placeholder="رفعنا بإيه؟" value="${r.hypoTreatment ?? ''}">`;
    tds[5].innerHTML = `<input class="inp-notes" placeholder="ملاحظات" value="${escapeHtml(r.notes ?? '')}">`;
    btnEdit.classList.add('hidden');
    btnSave.classList.remove('hidden');
    btnCancel.classList.remove('hidden');
  };

  const toDisplay = async ()=>{ await loadDayTable(); };

  btnEdit.addEventListener('click', toInputs);
  btnCancel.addEventListener('click', toDisplay);

  btnSave.addEventListener('click', async ()=>{
    const val  = Number(tr.querySelector('.inp-val').value);
    const corr = tr.querySelector('.inp-corr').value ? Number(tr.querySelector('.inp-corr').value) : null;
    const hypo = tr.querySelector('.inp-hypo').value || null;
    const notes= tr.querySelector('.inp-notes').value || null;

    if(!(val>0)){ alert('أدخلي قيمة قياس صحيحة'); return; }

    try{
      loader(true);
      const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/measurements/${r.id}`);
      await updateDoc(ref, {
        value_mmol: val, correctionDose: corr, hypoTreatment: hypo, notes,
        updatedAt: serverTimestamp()
      });
      await loadDayTable();
    }catch(e){
      console.error(e);
      alert('تعذّر الحفظ.');
    }finally{
      loader(false);
    }
  });
}

// تصنيف الحالة
function classify(v){
  const {min,max} = childData.normalRange;
  const sl = childData.severeLow;
  const sh = childData.severeHigh;
  if(sl!=null && v < sl) return 'severe-low';
  if(sh!=null && v > sh) return 'severe-high';
  if(v < min) return 'low';
  if(v > max) return 'high';
  return 'ok';
}
function renderBadge(state){
  switch(state){
    case 'ok':           return `<span class="badge ok">✔️ طبيعي</span>`;
    case 'high':         return `<span class="badge up">⬆️ ارتفاع</span>`;
    case 'low':          return `<span class="badge down">⬇️ هبوط</span>`;
    case 'severe-high':  return `<span class="badge up">⛔ ارتفاع شديد</span>`;
    case 'severe-low':   return `<span class="badge down">⛔ هبوط شديد</span>`;
    default:             return '—';
  }
}

function fmtNum(n){ return (n==null || isNaN(n)) ? '—' : Number(n).toFixed(1); }
function escapeHtml(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
