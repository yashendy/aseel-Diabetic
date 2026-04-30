// js/measurements.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// --- الأدوات الأساسية ---
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const todayISO = () => new Date().toISOString().slice(0,10);
const nowTime = () => { const d=new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function toast(msg) { const t=$('toast'); if(t){ t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'), 2500); } }
function showLoader(show) { const l = $('#loader'); if(l) { if(show) l.classList.remove('hidden'); else l.classList.add('hidden'); } }

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId');

let currentUser = null;
let childData = {};
let todayMeasurements = []; 

// المعاملات المحفوظة
let sysUnit = 'mg/dL';
let sysTarget = 100, sysCF = 50, sysCR = { breakfast: 10, lunch: 10, dinner: 10, snack: 15 };
let sysLimits = { critLow: 54, low: 70, high: 180, critHigh: 250 };

// قاموس الأوقات (نفس القديم)
const SLOT_NAMES = {
  FASTING: 'صائم', PRE_BREAKFAST: 'قبل الفطار', POST_BREAKFAST: 'بعد الفطار',
  PRE_LUNCH: 'قبل الغدا', POST_LUNCH: 'بعد الغدا', PRE_DINNER: 'قبل العشا',
  POST_DINNER: 'بعد العشا', SNACK: 'سناك', BEDTIME: 'قبل النوم', EXERCISE: 'رياضة', OTHER: 'أخرى'
};
// الترتيب للفرز
const SLOT_ORDER = { FASTING:10, PRE_BREAKFAST:20, POST_BREAKFAST:25, PRE_LUNCH:30, POST_LUNCH:35, PRE_DINNER:40, POST_DINNER:45, SNACK:50, EXERCISE:60, BEDTIME:90, OTHER:200 };

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('index.html'); return; }
  currentUser = user;
  
  if(!childId) { alert("خطأ: لم يتم تحديد الطفل."); location.href="parent.html"; return; }

  // تهيئة الواجهة
  if($('dayPicker')) $('dayPicker').value = todayISO();
  if($('timePicker')) $('timePicker').value = nowTime();
  autoSelectSlot();

  await loadChildSettings();
  listenToTodayMeasurements();
  setupEventListeners();
});

// 1. تحميل الإعدادات
async function loadChildSettings() {
  showLoader(true);
  try {
    const snap = await getDoc(doc(db, "parents", currentUser.uid, "children", childId));
    if (!snap.exists()) return;
    childData = snap.data();

    if($('childName')) $('childName').textContent = childData.name || 'الطفل';
    sysUnit = childData.glucoseUnit || 'mg/dL';

    if(childData.cf) sysCF = Number(childData.cf);
    if(childData.cr) sysCR = childData.cr;
    if(childData.glucose_limits) {
      sysTarget = Number(childData.glucose_limits.target) || (sysUnit==='mmol/L'? 5.5 : 100);
      sysLimits.low = Number(childData.glucose_limits.low) || (sysUnit==='mmol/L'? 3.9 : 70);
      sysLimits.high = Number(childData.glucose_limits.high) || (sysUnit==='mmol/L'? 10.0 : 180);
      sysLimits.critLow = Number(childData.glucose_limits.critical_low) || (sysUnit==='mmol/L'? 3.0 : 54);
      sysLimits.critHigh = Number(childData.glucose_limits.critical_high) || (sysUnit==='mmol/L'? 13.9 : 250);
    }

    if($('unitLabel')) $('unitLabel').textContent = sysUnit;
    
    if($('therapyChips')) {
      $('therapyChips').innerHTML = `
        <span class="v-chip">🎯 الهدف: ${sysTarget}</span>
        <span class="v-chip">💉 CF: ${sysCF}</span>
        <span class="v-chip">📊 الوحدة: ${sysUnit}</span>
      `;
    }

    if($('backToChild')) $('backToChild').onclick = () => location.href = `child.html?child=${childId}`;

  } catch(e) { console.error(e); }
  finally { showLoader(false); }
}

function autoSelectSlot() {
  const h = new Date().getHours();
  let slot = 'OTHER';
  if(h >= 5 && h < 11) slot = 'PRE_BREAKFAST';
  else if(h >= 11 && h < 16) slot = 'PRE_LUNCH';
  else if(h >= 16 && h < 22) slot = 'PRE_DINNER';
  else if(h >= 22 || h < 5) slot = 'BEDTIME';
  if($('slotKey')) $('slotKey').value = slot;
}

// 2. إظهار الإجراءات المطلوبة حسب السكر
function calculateSmartAlert() {
  const val = parseFloat($('reading').value);
  const panel = $('actionsPanel');
  if(!val || val <= 0) { panel.classList.add('hidden'); return; }

  panel.classList.remove('hidden');
  const alertBox = $('smartAlert');
  const icon = $('alertIcon'); const title = $('alertTitle'); const msg = $('alertMsg');
  const corrRow = $('corrRow'); const hypoRow = $('hypoRow'); const corrInput = $('corrDoseInput');

  alertBox.className = 'smart-alert'; 

  const slot = $('slotKey').value;
  let currentCR = sysCR.snack || 15;
  if(slot.includes('BREAKFAST')) currentCR = sysCR.breakfast || 10;
  if(slot.includes('LUNCH')) currentCR = sysCR.lunch || 10;
  if(slot.includes('DINNER')) currentCR = sysCR.dinner || 10;

  if (val <= sysLimits.critLow || val < sysLimits.low) {
    // هبوط
    alertBox.classList.add(val <= sysLimits.critLow ? 'alert-danger' : 'alert-warn');
    icon.textContent = '🧃'; title.textContent = val <= sysLimits.critLow ? 'هبوط حرج!' : 'هبوط في السكر';
    const raisePerGram = sysCF / currentCR; 
    let neededCarbs = 15;
    if(raisePerGram > 0 && sysTarget > val) neededCarbs = Math.round((sysTarget - val) / raisePerGram);
    msg.innerHTML = `للوصول للهدف، يحتاج الطفل <b>${neededCarbs} جرام</b> من الكربوهيدرات السريعة.`;
    
    hypoRow.classList.remove('hidden');
    corrRow.classList.add('hidden');
    corrInput.value = '';

  } else if (val >= sysLimits.critHigh || val > sysLimits.high) {
    // ارتفاع
    alertBox.classList.add(val >= sysLimits.critHigh ? 'alert-danger' : 'alert-warn');
    icon.textContent = '💉'; title.textContent = val >= sysLimits.critHigh ? 'ارتفاع حرج!' : 'مستوى السكر مرتفع';
    
    let dose = 0;
    if(sysCF > 0 && val > sysTarget) dose = Math.round(((val - sysTarget) / sysCF) * 2) / 2;
    msg.innerHTML = dose > 0 ? `الجرعة المقترحة للتصحيح هي: <b>${dose} وحدة</b>.` : `ارتفاع بسيط.`;
    
    corrRow.classList.remove('hidden');
    hypoRow.classList.add('hidden');
    if(!$('corrDoseInput').dataset.dirty) corrInput.value = dose > 0 ? dose : '';

  } else {
    // طبيعي
    alertBox.classList.add('alert-ok');
    icon.textContent = '🎉'; title.textContent = 'في النطاق الطبيعي';
    msg.innerHTML = `استمر على هذا الأداء الممتاز.`;
    
    hypoRow.classList.add('hidden');
    corrRow.classList.add('hidden');
    corrInput.value = '';
    $('hypoTreatment').value = '';
  }
}

function getGlucoseStateCSS(val) {
  if(val <= sysLimits.critLow) return { dot: 'danger', bg: 'bg-danger', text: 'هبوط حرج' };
  if(val < sysLimits.low) return { dot: 'warn', bg: 'bg-warn', text: 'هبوط' };
  if(val >= sysLimits.critHigh) return { dot: 'danger', bg: 'bg-danger', text: 'ارتفاع حرج' };
  if(val > sysLimits.high) return { dot: 'warn', bg: 'bg-warn', text: 'ارتفاع' };
  return { dot: 'ok', bg: 'bg-ok', text: 'في النطاق' };
}

// 3. الحفظ الموحد 
async function saveMeasurement() {
  const val = parseFloat($('reading').value);
  if(!val) { toast("يرجى إدخال قراءة صحيحة"); return; }

  const day = $('dayPicker').value;
  const time = $('timePicker').value;
  const slotKey = $('slotKey').value;
  const notes = $('mNotes').value.trim();
  const corrDose = parseFloat($('corrDoseInput').value) || 0;
  const hypoTreat = $('hypoTreatment').value.trim();

  const dateTimeObj = new Date(`${day}T${time}`);

  // الـ Payload الموحد الذي سيفهمه الـ Meals والـ Reports
  const payload = {
    value: val,
    unit: sysUnit,
    date: day,
    time: time,
    when: dateTimeObj, 
    slotKey: slotKey, // حفظ النوع كما هو بالضبط كما طلبتِ
    slotOrder: SLOT_ORDER[slotKey] || 200,
    state: getGlucoseStateCSS(val).text,
    correctionDose: corrDose > 0 ? corrDose : null,
    hypoTreatment: hypoTreat || null,
    notes: notes || null,
    createdAt: serverTimestamp()
  };

  showLoader(true);
  try {
    await addDoc(collection(db, "parents", currentUser.uid, "children", childId, "measurements"), payload);
    toast("تم الحفظ بنجاح! ✔️");
    
    // إعادة التصفير
    $('reading').value = ''; $('mNotes').value = '';
    $('corrDoseInput').value = ''; $('corrDoseInput').dataset.dirty = "";
    $('hypoTreatment').value = '';
    $('actionsPanel').classList.add('hidden');
  } catch(e) {
    alert("حدث خطأ أثناء الحفظ"); console.error(e);
  } finally {
    showLoader(false);
  }
}

// 4. الخط الزمني للقياسات
function listenToTodayMeasurements() {
  const measRef = collection(db, "parents", currentUser.uid, "children", childId, "measurements");
  onSnapshot(query(measRef, orderBy('when', 'desc')), (snapshot) => {
    const allMeas = [];
    snapshot.forEach(doc => allMeas.push({ id: doc.id, ...doc.data() }));
    
    const selectedDay = $('dayPicker').value;
    todayMeasurements = allMeas.filter(m => m.date === selectedDay || (m.when && m.when.toDate().toISOString().slice(0,10) === selectedDay));
    renderTimeline(todayMeasurements);
  });
}

function renderTimeline(dataArray) {
  const grid = $('timelineGrid');
  const empty = $('empty');
  const searchQuery = $('searchBox').value.toLowerCase();

  let filtered = dataArray;
  if(searchQuery) {
    filtered = filtered.filter(m => 
      (m.notes || '').toLowerCase().includes(searchQuery) ||
      (m.hypoTreatment || '').toLowerCase().includes(searchQuery) ||
      (SLOT_NAMES[m.slotKey] || '').toLowerCase().includes(searchQuery)
    );
  }

  grid.innerHTML = '';
  if(filtered.length === 0) {
    grid.classList.add('hidden'); empty.classList.remove('hidden'); return;
  }
  
  grid.classList.remove('hidden'); empty.classList.add('hidden');

  filtered.forEach(m => {
    const css = getGlucoseStateCSS(m.value);
    const slotName = SLOT_NAMES[m.slotKey] || m.slotKey;
    const mTime = m.time || (m.when?.toDate ? pad(m.when.toDate().getHours()) + ':' + pad(m.when.toDate().getMinutes()) : '');

    // إظهار الحقول المكتملة
    let detailsHTML = '';
    const hasDetails = m.correctionDose || m.hypoTreatment || m.carbs || m.mealDose || m.totalDose;
    
    if (hasDetails) {
      detailsHTML = `<div class="tl-details mt-10">`;
      if(m.hypoTreatment) detailsHTML += `<div class="tl-detail-item"><span>🧃 علاج هبوط</span><b style="color:#b45309;">${m.hypoTreatment}</b></div>`;
      if(m.correctionDose) detailsHTML += `<div class="tl-detail-item"><span>💧 تصحيح</span><b style="color:#ef4444;">${m.correctionDose} U</b></div>`;
      if(m.carbs) detailsHTML += `<div class="tl-detail-item"><span>🍔 كارب وجبة</span><b>${m.carbs}g</b></div>`;
      if(m.mealDose) detailsHTML += `<div class="tl-detail-item"><span>💉 جرعة أكل</span><b>${m.mealDose} U</b></div>`;
      if(m.totalDose) detailsHTML += `<div class="tl-detail-item" style="border-right:2px solid #cbd5e1; padding-right:10px;"><span>⚡ الإجمالي</span><b style="color:#2563eb;">${m.totalDose} U</b></div>`;
      detailsHTML += `</div>`;
    }

    const card = document.createElement('div');
    card.className = 'tl-item';
    card.innerHTML = `
      <div class="tl-dot ${css.dot}"></div>
      <div class="tl-card">
        <div class="tl-head">
          <div><span class="tl-time">🕒 ${mTime}</span> | <span class="tl-slot">${slotName}</span></div>
          <button class="icon-btn del-btn" data-id="${m.id}" title="حذف">🗑️</button>
        </div>
        <div class="tl-body">
          <div class="tl-bg ${css.bg}">${m.value}</div>
          <div style="font-size:13px; color:#475569; font-weight:bold;">${css.text}</div>
        </div>
        ${detailsHTML}
        ${m.notes ? `<div class="tl-notes">📝 ${m.notes}</div>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });

  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = async () => {
      if(confirm('تأكيد الحذف؟')) {
        await deleteDoc(doc(db, "parents", currentUser.uid, "children", childId, "measurements", btn.dataset.id));
        toast('تم الحذف');
      }
    };
  });
}

function sendToMeals() {
  const val = $('reading').value;
  const slot = $('slotKey').value;
  const date = $('dayPicker').value;
  location.href = `meals.html?child=${childId}&bg=${val || ''}&slot=${slot}&date=${date}`;
}

function setupEventListeners() {
  $('reading').addEventListener('input', calculateSmartAlert);
  $('slotKey').addEventListener('change', calculateSmartAlert);
  $('saveBtn').addEventListener('click', saveMeasurement);
  $('toMealsBtn').addEventListener('click', sendToMeals);
  
  $('corrDoseInput').addEventListener('input', () => $('corrDoseInput').dataset.dirty = "true");
  
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => $('hypoTreatment').value = btn.dataset.val);
  });

  $('dayPicker').addEventListener('change', () => listenToTodayMeasurements());
  $('searchBox').addEventListener('input', () => renderTimeline(todayMeasurements));
}
