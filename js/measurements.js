// js/measurements.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, query, where, orderBy,
  doc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* =============================
   إعدادات ثابتة / قائمة الأوقات
   ============================= */
const SLOTS = [
  "الاستيقاظ","ق.الفطار","ب.الفطار","ق.الغدا","ب.الغدا",
  "ق.العشا","ب.العشا","سناك","ق.النوم","أثناء النوم",
  "ق.الرياضة","ب.الرياضة"
];
const REPEATABLE = new Set(["سناك","ق.الرياضة","ب.الرياضة"]); // يُسمح بالتكرار لنفس اليوم

/* ==============
   عناصر الواجهة
   ============== */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const rangeEl     = document.getElementById('range');
const statsEl     = document.getElementById('todayStats');

const form      = document.getElementById('mForm');
const tableDate = document.getElementById('tableDate');
const dayLabel  = document.getElementById('dayLabel');
const list      = document.getElementById('list');

const selDate   = document.getElementById('selDate');
const slotEl    = document.getElementById('slot');
const valueEl   = document.getElementById('value');
const unitEl    = document.getElementById('inputUnit');
const clockEl   = document.getElementById('clock');
const notesEl   = document.getElementById('notes');

const corrWrap  = document.getElementById('corrWrap');
const corrInput = document.getElementById('correctionDose');
const corrHint  = document.getElementById('corrHint');

const raisedWrap= document.getElementById('raisedWrap');
const raisedEl  = document.getElementById('raisedWith');

const resetBtn  = document.getElementById('resetBtn');
const saveBtn   = document.getElementById('saveBtn');

/* ==========
   متغيرات
   ========== */
let currentUser, childData;
let normalMin = 4.4, normalMax = 7.8; // mmol/L افتراضياً
let hypoLevel = 4.0, hyperLevel = 10.0;
let correctionFactor_mmol = null; // CF بالـ mmol/L
let editingId = null; // وضع التعديل

/* ====================
   أدوات مساعدة
   ==================== */
const pad = n => String(n).padStart(2,'0');
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function asDateStr(d){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function fmtDateTime(d){
  return `${asDateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function arabicToDot(s){ return (s||'').toString().replace(',', '.').trim(); }
function toBothUnits(value, unit){
  const v = Number(arabicToDot(value));
  if (unit === 'mg/dL'){
    const mmol = v/18;
    return { mmol: mmol, mgdl: v };
  } else {
    const mgdl = v*18;
    return { mmol: v, mgdl: mgdl };
  }
}
function roundHalf(x){ return Math.round(x*2)/2; }

/* ====================
   تهيئة قائمة الأوقات
   ==================== */
function populateSlots(){
  SLOTS.forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    slotEl.appendChild(opt);
  });
}

/* =========================
   تحميل بيانات الطفل والجلسة
   ========================= */
populateSlots();

// ضبط أقصى تاريخ ليكون اليوم (منع المستقبل)
function setMaxToday(...inputs){
  const t = todayStr();
  inputs.forEach(inp => inp && (inp.setAttribute('max', t)));
}
setMaxToday(selDate, tableDate);

onAuthStateChanged(auth, async (user) => {
  if (!user) return location.href = 'index.html';
  if (!childId) { alert('لا يوجد معرف طفل'); return history.back(); }

  currentUser = user;

  // تحميل إعدادات الطفل
  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()) { alert('لم يتم العثور على الطفل'); return history.back(); }

  childData = snap.data();

  // الحدود والمعاملات بالـ mmol/L
  normalMin   = Number(childData.normalRange?.min ?? 4.4);
  normalMax   = Number(childData.normalRange?.max ?? 7.8);
  hypoLevel   = Number(childData.hypoLevel ?? normalMin);
  hyperLevel  = Number(childData.hyperLevel ?? normalMax);
  correctionFactor_mmol = childData.correctionFactor ? Number(childData.correctionFactor) : null;

  childNameEl.textContent = childData.name || 'طفل';
  rangeEl.textContent     = `${normalMin}–${normalMax}`;
  childMetaEl.textContent = `الوحدة المرجعية: mmol/L • الطبيعي: ${normalMin}-${normalMax}`;

  // تواريخ افتراضية
  const t = todayStr();
  selDate.value   = t;
  tableDate.value = t;
  dayLabel.textContent = t;

  await refreshDayPanel(t);
  await loadDay(t);
});

/* ===================================
   منطق إظهار التصحيح/الهبوط ديناميكيًا
   =================================== */
function updateDynamicHelpers(){
  const rawVal = arabicToDot(valueEl.value);
  if (!rawVal) { hideHelpers(); return; }

  const { mmol } = toBothUnits(rawVal, unitEl.value);

  // تصحيح عند الارتفاع (بالـ mmol/L)
  if (mmol > normalMax) {
    corrWrap.classList.remove('hidden');
    if (correctionFactor_mmol && correctionFactor_mmol > 0) {
      const suggested = roundHalf((mmol - normalMax) / correctionFactor_mmol);
      corrInput.value = suggested > 0 ? suggested : '';
      corrHint.textContent = `اقتراح: ${(suggested || 0)} وحدة (محسوب من (${mmol.toFixed(1)} - ${normalMax}) / ${correctionFactor_mmol})`;
    } else {
      corrInput.value = '';
      corrHint.textContent = 'أدخل معامل التصحيح في ملف الطفل لاقتراح تلقائي (بالـ mmol/L).';
    }
  } else {
    corrWrap.classList.add('hidden');
    corrInput.value = ''; corrHint.textContent = '';
  }

  // "رفعنا بإيه؟" عند الهبوط
  if (mmol < normalMin) {
    raisedWrap.classList.remove('hidden');
  } else {
    raisedWrap.classList.add('hidden');
    raisedEl.value = '';
  }
}
function hideHelpers(){
  corrWrap.classList.add('hidden'); corrInput.value=''; corrHint.textContent='';
  raisedWrap.classList.add('hidden'); raisedEl.value='';
}
valueEl.addEventListener('input', updateDynamicHelpers);
unitEl.addEventListener('change', updateDynamicHelpers);

/* ==============================
   منع التكرار (عدا سناك/الرياضة)
   ============================== */
async function isDuplicate(dateStr, slot, excludeId=null){
  if (REPEATABLE.has(slot)) return false;
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy = query(ref, where('date','==',dateStr), where('slot','==',slot));
  const snap = await getDocs(qy);
  const others = [];
  snap.forEach(d => { if (d.id !== excludeId) others.push(d.id); });
  return others.length > 0;
}

/* ========================
   حفظ/تحديث قياس (Submit)
   ======================== */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();

  try {
    // قراءة القيم
    const dateStr = selDate.value;
    const slot = (slotEl.value || '').trim();
    if (!dateStr || !slot) { alert('اختر التاريخ ووقت القياس'); return; }

    // منع المستقبل
    const t = todayStr();
    if (dateStr > t){ alert('تاريخ مستقبلي غير مسموح'); return; }

    const rawVal = arabicToDot(valueEl.value);
    if (!rawVal) { alert('أدخل قيمة القياس'); return; }

    // تحويل للوحدتين وتحقق النطاق المنطقي
    const { mmol, mgdl } = toBothUnits(rawVal, unitEl.value);
    if (isNaN(mmol) || mmol < 1.1 || mmol > 33){
      alert('قيمة غير منطقية (mmol/L بين ~1.1 و ~33).'); return;
    }

    // منع التكرار
    const dup = await isDuplicate(dateStr, slot, editingId);
    if (dup){
      alert('لا يمكن تكرار نفس وقت القياس في نفس اليوم (باستثناء سناك/الرياضة).');
      return;
    }

    // بناء الـ when
    let when;
    if (selDate.value && clockEl.value) {
      when = new Date(`${selDate.value}T${clockEl.value}:00`);
    } else if (selDate.value) {
      when = new Date(`${selDate.value}T08:00:00`); // افتراضي
    } else {
      when = new Date();
    }

    // الحقول الإضافية
    const notes = (notesEl.value || '').trim();
    const correctionDose = corrWrap.classList.contains('hidden') ? null : Number(arabicToDot(corrInput.value)||0) || null;
    const raisedWith = raisedWrap.classList.contains('hidden') ? '' : (raisedEl.value || '').trim();

    const payload = {
      value_mmol: Number(mmol.toFixed(2)),
      value_mgdl: Math.round(mgdl), // كقيمة تقريبية
      input: { value: Number(arabicToDot(valueEl.value)), unit: unitEl.value },
      date: dateStr,
      slot,
      when,
      notes,
      correctionDose,
      raisedWith,
      updatedAt: serverTimestamp()
    };

    const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);

    if (editingId){
      await updateDoc(doc(ref, editingId), payload);
      alert('✅ تم تحديث القياس بنجاح');
      editingId = null;
      saveBtn.textContent = 'حفظ';
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(ref, payload);
      alert('✅ تم حفظ القياس');
    }

    form.reset();
    hideHelpers();
    dayLabel.textContent = tableDate.value || dateStr;
    await loadDay(tableDate.value || dateStr);
    await refreshDayPanel(tableDate.value || dateStr);

  } catch (err){
    console.error(err);
    alert('حدث خطأ أثناء الحفظ');
  }
});

/* ===========================
   تفريغ النموذج وإلغاء التعديل
   =========================== */
resetBtn.addEventListener('click', ()=>{
  form.reset();
  hideHelpers();
  editingId = null;
  saveBtn.textContent = 'حفظ';
});

/* ==============================
   تحميل جدول يوم محدد
   ============================== */
tableDate.addEventListener('change', async ()=>{
  const d = tableDate.value || todayStr();

  // منع المستقبل
  const t = todayStr();
  if (d > t){ tableDate.value = t; dayLabel.textContent = t; await loadDay(t); await refreshDayPanel(t); return; }

  dayLabel.textContent = d;
  await loadDay(d);
  await refreshDayPanel(d);
});

function slotIndex(slot){
  const i = SLOTS.indexOf(slot);
  return i === -1 ? 999 : i;
}

async function loadDay(dateStr){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  // نقرأ كل اليوم ونرتب لاحقًا بالواجهة
  const qy = query(ref, where('date','==',dateStr), orderBy('when','asc'));
  const snap = await getDocs(qy);

  if (snap.empty){
    list.innerHTML = `<div class="row"><div class="pill">لا توجد قياسات لهذا اليوم</div></div>`;
    return;
  }

  // جهّز البيانات للعرض (نرتّب حسب ترتيب الأوقات ثم التوقيت)
  const rows = [];
  snap.forEach(d=>{
    const m = d.data();
    rows.push({ id:d.id, ...m, whenDate: m.when?.toDate ? m.when.toDate() : new Date(m.when) });
  });

  rows.sort((a,b)=>{
    const si = slotIndex(a.slot) - slotIndex(b.slot);
    if (si !== 0) return si;
    return a.whenDate - b.whenDate;
  });

  list.innerHTML = '';
  rows.forEach(m=>{
    // الحالة تُحسب بالـ mmol/L
    const valM = Number(m.value_mmol);
    const status = valM < normalMin ? 'low' : (valM > normalMax ? 'high' : 'good');

    // عرض القيمة حسب وحدة الإدخال لذلك الصف
    const inUnit = m.input?.unit || 'mmol/L';
    const shownVal = inUnit === 'mg/dL' ? m.value_mgdl : valM;
    const shownTxt = inUnit === 'mg/dL' ? `${shownVal} mg/dL` : `${shownVal} mmol/L`;

    const row = document.createElement('div');
    row.className = `row ${status}`;
    row.innerHTML = `
      <div><span class="pill">${m.slot}</span></div>
      <div>
        <span class="val">${shownTxt}</span><br>
        <small class="pill">${fmtDateTime(m.whenDate)}</small>
      </div>
      <div>${m.correctionDose ? `تصحيح: <span class="pill">${m.correctionDose}U</span>` : ''}</div>
      <div>${m.raisedWith ? `رفعنا بـ: <span class="pill">${m.raisedWith}</span>` : ''}</div>
      <div class="actions-row">
        <button class="edit">تعديل</button>
      </div>
    `;

    // زر تعديل: يملأ النموذج بالقيم كما أُدخلت
    row.querySelector('.edit').addEventListener('click', ()=>{
      editingId = m.id;
      selDate.value = m.date;
      tableDate.value = m.date;
      dayLabel.textContent = m.date;
      slotEl.value = m.slot;

      // نعيد القيم كما أُدخلت
      valueEl.value = m.input?.value ?? (inUnit==='mg/dL' ? m.value_mgdl : valM);
      unitEl.value  = inUnit;

      const dt = m.whenDate;
      clockEl.value = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      notesEl.value = m.notes || '';

      // helpers
      valueEl.dispatchEvent(new Event('input'));
      if (m.correctionDose){ corrWrap.classList.remove('hidden'); corrInput.value = m.correctionDose; }
      else { corrWrap.classList.add('hidden'); corrInput.value=''; }
      if (m.raisedWith){ raisedWrap.classList.remove('hidden'); raisedEl.value = m.raisedWith; }
      else { raisedWrap.classList.add('hidden'); raisedEl.value=''; }

      saveBtn.textContent = 'تحديث';
      window.scrollTo({top:0,behavior:'smooth'});
    });

    list.appendChild(row);
  });
}

/* ==============================
   ملخصات اليوم (mmol/L)
   ============================== */
async function refreshDayPanel(dateStr){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy = query(ref, where('date','==',dateStr));
  const snap = await getDocs(qy);

  if (snap.empty){
    statsEl.innerHTML = '';
    return;
  }
  const values = [];
  snap.forEach(d => {
    const v = Number(d.data().value_mmol);
    if (!isNaN(v)) values.push(v);
  });
  if (!values.length){ statsEl.innerHTML=''; return; }

  const count = values.length;
  const sum = values.reduce((a,b)=>a+b,0);
  const avg = Math.round((sum/count)*10)/10;
  const min = Math.min(...values);
  const max = Math.max(...values);

  statsEl.innerHTML = `
    <span class="badge">عدد: ${count}</span>
    <span class="badge">متوسط: ${avg} mmol/L</span>
    <span class="badge">أدنى: ${min}</span>
    <span class="badge">أعلى: ${max}</span>
  `;
}

/* ==========================
   مزامنة التواريخ
   ========================== */
selDate.addEventListener('change', ()=>{
  const t = todayStr();
  if (selDate.value > t) selDate.value = t; // منع المستقبل
  if (!tableDate.value){ tableDate.value = selDate.value; }
  dayLabel.textContent = tableDate.value || selDate.value;
});
