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
let unit = 'mg/dL', normalMin = 80, normalMax = 140, hypoLevel = 70, hyperLevel = 180, correctionFactor = null;

let editingId = null; // في وضع التعديل نخزن docId

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
function toMgdl(value, unit){
  const v = Number(arabicToDot(value));
  return unit === 'mmol/L' ? v * 18 : v;
}
function roundHalf(x){ return Math.round(x*2)/2; }

/* =========================
   تحميل بيانات الطفل والجلسة
   ========================= */
populateSlots();

onAuthStateChanged(auth, async (user) => {
  if (!user) return location.href = 'index.html';
  if (!childId) { alert('لا يوجد معرف طفل'); return history.back(); }

  currentUser = user;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()) { alert('لم يتم العثور على الطفل'); return history.back(); }

  childData = snap.data();

  unit        = 'mg/dL'; // العرض والمعالجة دائمًا أمريكي
  normalMin   = Number(childData.normalRange?.min ?? 80);
  normalMax   = Number(childData.normalRange?.max ?? 140);
  hypoLevel   = Number(childData.hypoLevel ?? normalMin);
  hyperLevel  = Number(childData.hyperLevel ?? normalMax);
  correctionFactor = childData.correctionFactor ? Number(childData.correctionFactor) : null;

  childNameEl.textContent = childData.name || 'طفل';
  rangeEl.textContent     = `${normalMin}–${normalMax}`;
  childMetaEl.textContent = `الوحدة: mg/dL • الطبيعي: ${normalMin}-${normalMax}`;

  // تواريخ افتراضية
  const t = todayStr();
  selDate.value   = t;
  tableDate.value = t;
  dayLabel.textContent = t;

  // حساب الإحصائيات اليومية + تحميل الجدول
  await refreshDayPanel(t);
});

/* ===================================
   منطق إظهار حقول التصحيح/الهبوط ديناميكيًا
   =================================== */
function updateDynamicHelpers(){
  const rawVal = arabicToDot(valueEl.value);
  if (!rawVal) { hideHelpers(); return; }

  const vMgdl = toMgdl(rawVal, unitEl.value);

  // تصحيح عند الارتفاع
  if (vMgdl > normalMax) {
    corrWrap.classList.remove('hidden');
    if (correctionFactor && correctionFactor > 0) {
      const suggested = roundHalf((vMgdl - normalMax) / correctionFactor);
      corrInput.value = suggested > 0 ? suggested : '';
      corrHint.textContent = `اقتراح: ${(suggested || 0)} وحدة (محسوب من (${vMgdl} - ${normalMax}) / ${correctionFactor})`;
    } else {
      corrInput.value = '';
      corrHint.textContent = 'أدخل معامل التصحيح في ملف الطفل لاقتراح تلقائي';
    }
  } else {
    corrWrap.classList.add('hidden');
    corrInput.value = ''; corrHint.textContent = '';
  }

  // "رفعنا بإيه؟" عند الهبوط
  if (vMgdl < normalMin) {
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
  if (REPEATABLE.has(slot)) return false; // مسموح بالتكرار

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const q = query(ref, where('date','==',dateStr), where('slot','==',slot));
  const snap = await getDocs(q);

  // لا يعتبر تكرارًا إذا كان نفس الوثيقة أثناء التعديل
  const others = [];
  snap.forEach(d => {
    if (d.id !== excludeId) others.push(d.id);
  });
  return others.length > 0;
}

/* ========================
   حفظ/تحديث قياس (Submit)
   ======================== */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();

  try {
    // قراءة قيم النموذج
    const dateStr = selDate.value;
    const slot = (slotEl.value || '').replace(/\s+/g,'').replace(/\. /g,'.'); // تطبيع بسيط
    if (!dateStr || !slot) { alert('اختر التاريخ ووقت القياس'); return; }

    // القيمة والتحويل
    const rawVal = arabicToDot(valueEl.value);
    if (!rawVal) { alert('أدخل قيمة القياس'); return; }

    const vMgdl = toMgdl(rawVal, unitEl.value);
    if (isNaN(vMgdl) || vMgdl < 20 || vMgdl > 600) {
      alert('قيمة غير منطقية بعد التحويل إلى mg/dL (20–600)');
      return;
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
      // وقت افتراضي 08:00 إذا لم يُدخل ساعة
      when = new Date(`${selDate.value}T08:00:00`);
    } else {
      when = new Date();
    }

    // الحقول الإضافية
    const notes = (notesEl.value || '').trim();
    const correctionDose = corrWrap.classList.contains('hidden') ? null : Number(arabicToDot(corrInput.value)||0) || null;
    const raisedWith = raisedWrap.classList.contains('hidden') ? '' : (raisedEl.value || '').trim();

    const payload = {
      value_mgdl: vMgdl,
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
    // تحديث جدول اليوم المختار
    dayLabel.textContent = tableDate.value || dateStr;
    await loadDay(tableDate.value || dateStr);
    // تحديث إحصائيات اليوم
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
   تحميل جدول يوم محدد + ملخصات
   ============================== */
tableDate.addEventListener('change', async ()=>{
  const d = tableDate.value || todayStr();
  dayLabel.textContent = d;
  await loadDay(d);
  await refreshDayPanel(d);
});

async function loadDay(dateStr){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy = query(ref, where('date','==',dateStr), orderBy('when','desc'));
  const snap = await getDocs(qy);

  if (snap.empty){
    list.innerHTML = `<div class="row"><div class="pill">لا توجد قياسات لهذا اليوم</div></div>`;
    return;
  }

  list.innerHTML = '';
  snap.forEach(d=>{
    const m = d.data();
    const val = Number(m.value_mgdl);
    const status = val < normalMin ? 'low' : (val > normalMax ? 'high' : 'good');

    const row = document.createElement('div');
    row.className = `row ${status}`;
    row.innerHTML = `
      <div><span class="pill">${m.slot}</span></div>
      <div><span class="val">${val}</span> mg/dL<br><small class="pill">${fmtDateTime(m.when?.toDate ? m.when.toDate() : new Date(m.when))}</small></div>
      <div>${m.correctionDose ? `تصحيح: <span class="pill">${m.correctionDose}U</span>` : ''}</div>
      <div>${m.raisedWith ? `رفعنا بـ: <span class="pill">${m.raisedWith}</span>` : ''}</div>
      <div class="actions-row">
        <button class="edit">تعديل</button>
      </div>
    `;

    // زر تعديل: يملأ النموذج ويدخل وضع التعديل
    row.querySelector('.edit').addEventListener('click', ()=>{
      editingId = d.id;
      selDate.value = m.date;
      tableDate.value = m.date;
      dayLabel.textContent = m.date;
      slotEl.value = m.slot;
      valueEl.value = m.input?.value ?? m.value_mgdl;
      unitEl.value  = m.input?.unit ?? 'mg/dL';
      const dt = m.when?.toDate ? m.when.toDate() : new Date(m.when);
      clockEl.value = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
      notesEl.value = m.notes || '';

      // helpers
      valueEl.dispatchEvent(new Event('input'));
      if (m.correctionDose){ corrWrap.classList.remove('hidden'); corrInput.value = m.correctionDose; }
      if (m.raisedWith){ raisedWrap.classList.remove('hidden'); raisedEl.value = m.raisedWith; }

      saveBtn.textContent = 'تحديث';
      window.scrollTo({top:0,behavior:'smooth'});
    });

    list.appendChild(row);
  });
}

/* ==============================
   ملخص اليوم (عدد/متوسط/أدنى/أعلى)
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
    const v = Number(d.data().value_mgdl);
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
    <span class="badge">متوسط: ${avg} mg/dL</span>
    <span class="badge">أدنى: ${min}</span>
    <span class="badge">أعلى: ${max}</span>
  `;

  // آخر قراءة لعنوان الطفل (اختياري)
  const last = values[0];
}

/* ==========================
   مزامنة تاريخ النموذج/الجدول
   ========================== */
selDate.addEventListener('change', ()=>{
  if (!tableDate.value){ tableDate.value = selDate.value; }
  dayLabel.textContent = tableDate.value || selDate.value;
});
