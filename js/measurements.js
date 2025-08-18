import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, where, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const loaderEl = document.getElementById('loader');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl = document.getElementById('chipCR');
const chipCFEl = document.getElementById('chipCF');
const chipSevereLowEl = document.getElementById('chipSevereLow');
const chipSevereHighEl= document.getElementById('chipSevereHigh');

const dayInput = document.getElementById('day');
const slotSelect= document.getElementById('slot');
const valueInput= document.getElementById('value');
const wrapCorrection = document.getElementById('wrapCorrection');
const correctionDoseInput = document.getElementById('correctionDose');
const corrHint = document.getElementById('corrHint');
const wrapHypo = document.getElementById('wrapHypo');
const hypoTreatmentInput = document.getElementById('hypoTreatment');
const notesInput = document.getElementById('notes');
const btnSave = document.getElementById('btnSave');

const tbody = document.getElementById('tbody');

/* أدوات */
const pad = n => String(n).padStart(2,'0');
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const arDate = d => d.toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
function loader(b){ loaderEl.classList.toggle('hidden', !b); }

/* ثوابت الأوقات وترتيبها */
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
const SLOT_BY_LABEL = Object.fromEntries(SLOTS.map(s=>[s.label,s]));
const SLOT_BY_KEY   = Object.fromEntries(SLOTS.map(s=>[s.key,s]));

/* حالة الطفل */
let currentUser;
let childData = {
  normalRange:{min:4,max:7},
  carbRatio:null,
  correctionFactor:null,
  severeLow:null,
  severeHigh:null,
};

/* تهيئة */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href='index.html';
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }
  currentUser = user;

  try{
    loader(true);
    await initSlotsSelect();
    await loadChildHeader();
    initDate();
    bindEvents();
    await loadDayTable();
  }catch(e){
    console.error(e);
    alert('حدث خطأ في تحميل الصفحة');
  }finally{
    loader(false);
  }
});

/* تعبئة قائمة الأوقات */
async function initSlotsSelect(){
  slotSelect.innerHTML = SLOTS.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
}

/* تحميل بيانات الطفل وعرض الهيدر */
async function loadChildHeader(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error('child not found');
  const c = snap.data();
  childData.normalRange = {
    min: Number(c.normalRange?.min ?? 4),
    max: Number(c.normalRange?.max ?? 7),
  };
  childData.carbRatio = c.carbRatio != null ? Number(c.carbRatio) : null;
  childData.correctionFactor = c.correctionFactor != null ? Number(c.correctionFactor) : null;
  childData.severeLow  = c.severeLow  != null ? Number(c.severeLow)  : null;
  childData.severeHigh = c.severeHigh != null ? Number(c.severeHigh) : null;

  childNameEl.textContent = c.name || 'طفل';
  childMetaEl.textContent = `${c.gender || '-'} • العمر: ${calcAge(c.birthDate)} سنة`;

  chipRangeEl.textContent = `النطاق: ${childData.normalRange.min}–${childData.normalRange.max} mmol/L`;
  chipCREl.textContent    = `CR: ${childData.carbRatio ?? '—'} g/U`;
  chipCFEl.textContent    = `CF: ${childData.correctionFactor ?? '—'} mmol/L/U`;
  chipSevereLowEl.textContent  = `Low≤${childData.severeLow ?? '—'}`;
  chipSevereHighEl.textContent = `High≥${childData.severeHigh ?? '—'}`;
}

/* تاريخ اليوم + منع المستقبل */
function initDate(){
  const now = new Date();
  dayInput.value = fmtDate(now);
  dayInput.max   = fmtDate(now);   // منع المستقبل
  updateDayLabel();
}

function fmtDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function calcAge(bd){
  if(!bd) return '-';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}
function bindEvents(){
  // التحكم في إظهار التصحيح/الهبوط حسب القيمة
  valueInput.addEventListener('input', onValueChange);
  dayInput.addEventListener('change', onDayChange);
  btnSave.addEventListener('click', onSave);
}

/* عند تغيير التاريخ */
async function onDayChange(){
  if(!dayInput.value) return;
  const sel = new Date(dayInput.value);
  const today = new Date(fmtDate(new Date())); // منتصف ليل اليوم
  if (sel > today){
    alert('⛔ لا يمكن اختيار تاريخ بعد تاريخ اليوم');
    dayInput.value = fmtDate(new Date());
  }
  updateDayLabel();
  await loadDayTable();
}
function updateDayLabel(){
  const v = dayInput.value ? new Date(dayInput.value) : new Date();
  const metaDate = arDate(v);
  // نزيد التاريخ في سطر الهيدر (نفس child-info block)
  // (اختياري) ممكن نعرضه بوضوح داخل الجدول فقط
}

/* منطق إظهار التصحيح/الهبوط */
function onValueChange(){
  const v = Number(valueInput.value);
  const {min, max} = childData.normalRange;
  const cf = Number(childData.correctionFactor || 0);

  // إظهار علاج الهبوط
  wrapHypo.classList.toggle('hidden', !(v>0 && v < min));

  // إظهار/حساب التصحيح
  if(v>0 && v > max && cf>0){
    const diff = v - max;                // نبدأ من الحد الأعلى الطبيعي
    const dose = round1(diff / cf);
    wrapCorrection.classList.remove('hidden');
    correctionDoseInput.value = dose;    // اقتراح كقيمة افتراضية قابل للتعديل
    corrHint.textContent = `فرق: ${diff.toFixed(1)} mmol/L • CF=${cf} ⇒ جرعة مقترحة ≈ ${dose}U`;
  }else{
    wrapCorrection.classList.add('hidden');
    correctionDoseInput.value = '';
    corrHint.textContent = '—';
  }
}
function round1(x){ return Math.round(x*10)/10; }

/* حفظ القياس */
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
    hypoTreatment: wrapHypo.classList.contains('hidden') ? null : (hypoTreatmentInput.value || null),
    notes: notesInput.value || null,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  try{
    loader(true);
    const col = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);

    if(slotDef.multi){
      // يُسمح بتكرارات: استخدم addDoc
      await addDoc(col, data);
    }else{
      // غير مسموح بتكرار (اليوم+الوقت): استخدم setDoc مع id ثابت وتحقق
      const id = `${date}__${slotKey}`;
      const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/measurements/${id}`);
      const exists = await getDoc(ref);
      if(exists.exists()){
        alert('⛔ لا يمكن تسجيل نفس الوقت لنفس اليوم. يمكنك تعديل السجل من الجدول بالأسفل.');
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

/* تحميل جدول اليوم */
async function loadDayTable(){
  tbody.innerHTML = '<tr><td colspan="7" class="muted">جارِ التحميل…</td></tr>';
  const date = dayInput.value;
  const col = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const q  = query(col, where('date','==', date));
  const snap = await getDocs(q);

  // رتب حسب slotOrder ثم createdAt
  const rows = snap.docs.map(d=>({id:d.id, ...d.data()}))
    .sort((a,b)=>{
      if(a.slotOrder!==b.slotOrder) return a.slotOrder-b.slotOrder;
      const ta=(a.createdAt?.seconds||0), tb=(b.createdAt?.seconds||0);
      return ta-tb;
    });

  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="7" class="muted">لا توجد قياسات لهذا اليوم.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  for(const r of rows){
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;

    const state = classify(r.value_mmol);
    const badge = renderBadge(state);

    tr.innerHTML = `
      <td>${r.slotLabel||'-'}</td>
      <td>${fmtNum(r.value_mmol)}</td>
      <td>${badge}</td>
      <td>${r.correctionDose ?? '—'}</td>
      <td>${r.hypoTreatment ?? '—'}</td>
      <td>${escapeHtml(r.notes ?? '')}</td>
      <td>
        <div class="edit-actions">
          <button class="icon-btn btn-edit">✏️ تعديل</button>
          <button class="icon-btn btn-save hidden">💾 حفظ</button>
          <button class="icon-btn btn-cancel hidden">↩ إلغاء</button>
        </div>
      </td>
    `;
    attachRowEditing(tr, r);
    tbody.appendChild(tr);
  }
}

/* تحرير الصف في المكان */
function attachRowEditing(tr, r){
  const btnEdit = tr.querySelector('.btn-edit');
  const btnSave = tr.querySelector('.btn-save');
  const btnCancel = tr.querySelector('.btn-cancel');

  const toInputs = ()=>{
    tr.classList.add('edit-row');
    const tds = tr.querySelectorAll('td');
    tds[1].innerHTML = `<input class="inp-val" type="number" step="0.1" min="0" value="${r.value_mmol ?? ''}">`;
    // الحالة تُعاد حسابها تلقائيًا عند الحفظ
    tds[3].innerHTML = `<input class="inp-corr" type="number" step="0.1" min="0" value="${r.correctionDose ?? ''}">`;
    tds[4].innerHTML = `<input class="inp-hypo" placeholder="رفعنا بإيه؟" value="${r.hypoTreatment ?? ''}">`;
    tds[5].innerHTML = `<input class="inp-notes" placeholder="ملاحظات" value="${escapeHtml(r.notes ?? '')}">`;
    btnEdit.classList.add('hidden');
    btnSave.classList.remove('hidden');
    btnCancel.classList.remove('hidden');
  };

  const toDisplay = async ()=>{
    // إعادة التحميل للسجل من جديد لضمان الدقة
    await loadDayTable();
  };

  btnEdit.addEventListener('click', toInputs);
  btnCancel.addEventListener('click', toDisplay);

  btnSave.addEventListener('click', async ()=>{
    const val = Number(tr.querySelector('.inp-val').value);
    const corr = tr.querySelector('.inp-corr').value ? Number(tr.querySelector('.inp-corr').value) : null;
    const hypo = tr.querySelector('.inp-hypo').value || null;
    const notes= tr.querySelector('.inp-notes').value || null;

    if(!(val>0)){ alert('أدخلي قيمة قياس صحيحة'); return; }

    try{
      loader(true);
      const ref = doc(db, `parents/${currentUser.uid}/children/${childId}/measurements/${r.id}`);
      await updateDoc(ref, {
        value_mmol: val,
        correctionDose: corr,
        hypoTreatment: hypo,
        notes,
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

/* تصنيف القراءة حسب حدود الطفل */
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
    case 'ok': return `<span class="badge ok">✔️ طبيعي</span>`;
    case 'high': return `<span class="badge up">⬆️ ارتفاع</span>`;
    case 'low': return `<span class="badge down">⬇️ هبوط</span>`;
    case 'severe-high': return `<span class="badge up">⛔ ارتفاع شديد</span>`;
    case 'severe-low':  return `<span class="badge down">⛔ هبوط شديد</span>`;
    default: return '—';
  }
}

function fmtNum(n){ return (n==null || isNaN(n)) ? '—' : Number(n).toFixed(1); }
function escapeHtml(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
