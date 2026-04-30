// js/measurements.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, addDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// --- الأدوات الأساسية ---
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const round1 = n => Math.round((Number(n)||0)*10)/10;
const todayISO = () => new Date().toISOString().slice(0,10);
const nowTime = () => { const d=new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function toast(msg) { const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'), 2500); }

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId');

let currentUser = null;
let childData = {};
let todayMeasurements = []; // لحفظ قراءات اليوم لاكتشاف التكرار

// المعاملات المحفوظة
let sysUnit = 'mg/dL';
let sysTarget = 100, sysCF = 50, sysCR = { breakfast: 10, lunch: 10, dinner: 10, snack: 15 };
let sysLimits = { critLow: 54, low: 70, high: 180, critHigh: 250 };

// قاموس الأوقات
const SLOT_NAMES = {
  FASTING: 'صائم', PRE_BREAKFAST: 'قبل الفطار', POST_BREAKFAST: 'بعد الفطار',
  PRE_LUNCH: 'قبل الغدا', POST_LUNCH: 'بعد الغدا', PRE_DINNER: 'قبل العشا',
  POST_DINNER: 'بعد العشا', SNACK: 'سناك', BEDTIME: 'قبل النوم', EXERCISE: 'رياضة', OTHER: 'أخرى'
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('index.html'); return; }
  currentUser = user;
  
  if(!childId) { alert("خطأ: لم يتم تحديد الطفل."); location.href="parent.html"; return; }

  // تهيئة الواجهة
  $('dayPicker').value = todayISO();
  $('timePicker').value = nowTime();
  autoSelectSlot();

  await loadChildSettings();
  listenToTodayMeasurements();
  setupEventListeners();
});

// 1. تحميل إعدادات الطفل الجديدة
async function loadChildSettings() {
  $('#loader').classList.remove('hidden');
  try {
    const snap = await getDoc(doc(db, "parents", currentUser.uid, "children", childId));
    if (!snap.exists()) return;
    childData = snap.data();

    // الهوية
    $('childName').textContent = childData.name || 'الطفل';
    sysUnit = childData.glucoseUnit || 'mg/dL';

    // المعاملات والحدود (الـ Schema الجديدة)
    if(childData.cf) sysCF = Number(childData.cf);
    if(childData.cr) sysCR = childData.cr;
    if(childData.glucose_limits) {
      sysTarget = Number(childData.glucose_limits.target) || (sysUnit==='mmol/L'? 5.5 : 100);
      sysLimits.low = Number(childData.glucose_limits.low) || (sysUnit==='mmol/L'? 3.9 : 70);
      sysLimits.high = Number(childData.glucose_limits.high) || (sysUnit==='mmol/L'? 10.0 : 180);
      sysLimits.critLow = Number(childData.glucose_limits.critical_low) || (sysUnit==='mmol/L'? 3.0 : 54);
      sysLimits.critHigh = Number(childData.glucose_limits.critical_high) || (sysUnit==='mmol/L'? 13.9 : 250);
    }

    $('unitLabel').textContent = sysUnit;
    
    // شريط المعاملات العلوي
    $('therapyChips').innerHTML = `
      <span class="v-chip">🎯 الهدف: ${sysTarget}</span>
      <span class="v-chip">💉 CF: ${sysCF}</span>
      <span class="v-chip">📊 الوحدة: ${sysUnit}</span>
    `;

    // تحديث رابط الرجوع للوحة
    $('backToChild').onclick = () => location.href = `child.html?child=${childId}`;

  } catch(e) { console.error(e); }
  finally { $('#loader').classList.add('hidden'); }
}

// 2. الاختيار التلقائي للوقت
function autoSelectSlot() {
  const h = new Date().getHours();
  let slot = 'OTHER';
  if(h >= 5 && h < 11) slot = 'PRE_BREAKFAST';
  else if(h >= 11 && h < 16) slot = 'PRE_LUNCH';
  else if(h >= 16 && h < 22) slot = 'PRE_DINNER';
  else if(h >= 22 || h < 5) slot = 'BEDTIME';
  $('slotKey').value = slot;
}

// 3. التنبيه الذكي (حساب الجرعة وكمية الكارب للرفع)
function calculateSmartAlert() {
  const val = parseFloat($('reading').value);
  const alertBox = $('smartAlert');
  if(!val || val <= 0) { alertBox.classList.add('hidden'); return; }

  const icon = $('alertIcon'); const title = $('alertTitle'); const msg = $('alertMsg');
  alertBox.className = 'smart-alert'; // reset classes

  // تحديد الـ CR الحالي بناءً على الوقت المختار (للحسابات المتقدمة للهبوط)
  const slot = $('slotKey').value;
  let currentCR = sysCR.snack || 15;
  if(slot.includes('BREAKFAST')) currentCR = sysCR.breakfast || 10;
  if(slot.includes('LUNCH')) currentCR = sysCR.lunch || 10;
  if(slot.includes('DINNER')) currentCR = sysCR.dinner || 10;

  // الحالات
  if (val <= sysLimits.critLow || val < sysLimits.low) {
    // هبوط! حساب الكارب المطلوب للرفع للهدف
    alertBox.classList.add(val <= sysLimits.critLow ? 'alert-danger' : 'alert-warn');
    icon.textContent = '🧃';
    title.textContent = val <= sysLimits.critLow ? 'هبوط حرج!' : 'هبوط في السكر';
    
    // المعادلة الذكية: 1 جرام كارب يرفع السكر بمقدار (CF / CR)
    const raisePerGram = sysCF / currentCR; 
    let neededCarbs = 15; // افتراضي Rule of 15
    if(raisePerGram > 0 && sysTarget > val) {
      neededCarbs = Math.round((sysTarget - val) / raisePerGram);
    }
    msg.innerHTML = `للوصول للهدف (<b>${sysTarget}</b>)، يحتاج الطفل تقريباً <b>${neededCarbs} جرام</b> من الكربوهيدرات السريعة. (قس بعد 15 دقيقة).`;

  } else if (val >= sysLimits.critHigh || val > sysLimits.high) {
    // ارتفاع! حساب جرعة التصحيح
    alertBox.classList.add(val >= sysLimits.critHigh ? 'alert-danger' : 'alert-warn');
    icon.textContent = '💉';
    title.textContent = val >= sysLimits.critHigh ? 'ارتفاع حرج!' : 'مستوى السكر مرتفع';
    
    let dose = 0;
    if(sysCF > 0 && val > sysTarget) {
      dose = (val - sysTarget) / sysCF;
      // تقريب لأقرب نصف وحدة أو ربع حسب المضخة/القلم (سنقرب لأقرب نصف)
      dose = Math.round(dose * 2) / 2; 
    }
    msg.innerHTML = dose > 0 ? `جرعة التصحيح المقترحة للوصول للهدف (<b>${sysTarget}</b>) هي: <b>${dose} وحدة</b>.` : `الارتفاع بسيط لا يحتاج تصحيح قوي.`;

  } else {
    // في النطاق
    alertBox.classList.add('alert-ok');
    icon.textContent = '🎉';
    title.textContent = 'رائع! السكر في النطاق الطبيعي';
    msg.innerHTML = `استمر على هذا الأداء الممتاز. الهدف هو البقاء حول <b>${sysTarget}</b>.`;
  }
}

// 4. نظام المتابعة الذكي (لتكرار نفس الـ Slot)
function generateSlotName(baseSlot) {
  const sameSlots = todayMeasurements.filter(m => m.slotKey && m.slotKey.startsWith(baseSlot));
  if(sameSlots.length === 0) return baseSlot;
  return `${baseSlot}_FW${sameSlots.length}`; // يضيف FW1, FW2...
}

function getSlotDisplayName(fullSlotKey) {
  const parts = fullSlotKey.split('_FW');
  const baseName = SLOT_NAMES[parts[0]] || parts[0];
  if(parts.length > 1) return `${baseName} <span class="tl-slot" style="background:#fee2e2; color:#b91c1c;">(متابعة ${parts[1]})</span>`;
  return `<span class="tl-slot">${baseName}</span>`;
}

function getGlucoseStateCSS(val) {
  if(val <= sysLimits.critLow) return { dot: 'danger', bg: 'bg-danger', text: 'هبوط حرج' };
  if(val < sysLimits.low) return { dot: 'warn', bg: 'bg-warn', text: 'هبوط' };
  if(val >= sysLimits.critHigh) return { dot: 'danger', bg: 'bg-danger', text: 'ارتفاع حرج' };
  if(val > sysLimits.high) return { dot: 'warn', bg: 'bg-warn', text: 'ارتفاع' };
  return { dot: 'ok', bg: 'bg-ok', text: 'في النطاق' };
}

// 5. حفظ القياس الجديد
async function saveMeasurement() {
  const val = parseFloat($('reading').value);
  if(!val) { toast("يرجى إدخال قراءة صحيحة"); return; }

  const day = $('dayPicker').value;
  const time = $('timePicker').value;
  const baseSlot = $('slotKey').value;
  const notes = $('mNotes').value.trim();

  // الحصول على اسم الـ Slot النهائي (معالج التكرار)
  const finalSlotKey = generateSlotName(baseSlot);
  const dateTimeObj = new Date(`${day}T${time}`);

  // حساب التصحيح (لتخزينه كمرجع)
  let calcCorr = 0;
  if(val > sysLimits.high && sysCF > 0) {
    calcCorr = Math.max(0, (val - sysTarget) / sysCF);
    calcCorr = Math.round(calcCorr * 2) / 2;
  }

  const payload = {
    value: val,
    unit: sysUnit,
    date: day,
    time: time,
    when: dateTimeObj, // للترتيب
    slotKey: finalSlotKey,
    state: getGlucoseStateCSS(val).text,
    suggestedCorrection: calcCorr,
    notes: notes,
    createdAt: serverTimestamp()
    // ملاحظة: لو اتسجلت وجبة بعدين، صفحة الوجبات هتعمل Update للـ Document ده وتضيف (carbs, mealDose, totalDose).
  };

  $('#loader').classList.remove('hidden');
  try {
    await addDoc(collection(db, "parents", currentUser.uid, "children", childId, "measurements"), payload);
    toast("تم الحفظ بنجاح! ✔️");
    
    // تصفير الحقول للقياس التالي
    $('reading').value = '';
    $('mNotes').value = '';
    $('smartAlert').classList.add('hidden');
  } catch(e) {
    alert("حدث خطأ أثناء الحفظ"); console.error(e);
  } finally {
    $('#loader').classList.add('hidden');
  }
}

// 6. الاستماع المباشر لقياسات اليوم (لـ Timeline)
function listenToTodayMeasurements() {
  const measRef = collection(db, "parents", currentUser.uid, "children", childId, "measurements");
  
  // الاستماع لكل التحديثات، الفلترة تتم محلياً لتسريع الواجهة
  onSnapshot(query(measRef, orderBy('when', 'desc')), (snapshot) => {
    const allMeas = [];
    snapshot.forEach(doc => allMeas.push({ id: doc.id, ...doc.data() }));
    
    renderTimeline(allMeas);
    
    // نحتفظ ببيانات اليوم المختار فقط عشان نكتشف التكرار
    const selectedDay = $('dayPicker').value;
    todayMeasurements = allMeas.filter(m => m.date === selectedDay);
  });
}

// 7. رسم الخط الزمني (Timeline)
function renderTimeline(allData) {
  const grid = $('timelineGrid');
  const empty = $('empty');
  const selectedDay = $('dayPicker').value;
  const searchQuery = $('searchBox').value.toLowerCase();

  // فلترة حسب اليوم والبحث
  let filtered = allData.filter(m => m.date === selectedDay);
  if(searchQuery) {
    filtered = filtered.filter(m => 
      (m.notes || '').toLowerCase().includes(searchQuery) ||
      (SLOT_NAMES[m.slotKey.split('_FW')[0]] || '').toLowerCase().includes(searchQuery)
    );
  }

  grid.innerHTML = '';
  if(filtered.length === 0) {
    grid.classList.add('hidden'); empty.classList.remove('hidden'); return;
  }
  
  grid.classList.remove('hidden'); empty.classList.add('hidden');

  filtered.forEach(m => {
    const css = getGlucoseStateCSS(m.value);
    const slotName = getSlotDisplayName(m.slotKey);
    const mTime = m.time || (m.when?.toDate ? pad(m.when.toDate().getHours()) + ':' + pad(m.when.toDate().getMinutes()) : '');

    // التحقق هل توجد بيانات وجبة مربوطة بهذا القياس (من صفحة الوجبات)؟
    let detailsHTML = '';
    if (m.carbs > 0 || m.totalDose > 0) {
      detailsHTML = `
        <div class="tl-details mt-10">
          ${m.carbs ? `<div class="tl-detail-item"><span>🍔 كاربالوجبة</span><b>${m.carbs}g</b></div>` : ''}
          ${m.mealDose ? `<div class="tl-detail-item"><span>💉 أنسولين أكل</span><b>${m.mealDose}U</b></div>` : ''}
          ${m.correctionDose ? `<div class="tl-detail-item"><span>💧 تصحيح</span><b>${m.correctionDose}U</b></div>` : ''}
          ${m.totalDose ? `<div class="tl-detail-item" style="border-right:2px solid #cbd5e1; padding-right:10px;"><span>⚡ الإجمالي</span><b style="color:#2563eb;">${m.totalDose}U</b></div>` : ''}
        </div>
      `;
    }

    const card = document.createElement('div');
    card.className = 'tl-item';
    card.innerHTML = `
      <div class="tl-dot ${css.dot}"></div>
      <div class="tl-card">
        <div class="tl-head">
          <div><span class="tl-time">🕒 ${mTime}</span> | ${slotName}</div>
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

  // تفعيل أزرار الحذف
  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = async () => {
      if(confirm('هل أنت متأكد من حذف هذا السجل؟ (سيحذف بيانات الوجبة المرتبطة به إن وجدت)')) {
        await deleteDoc(doc(db, "parents", currentUser.uid, "children", childId, "measurements", btn.dataset.id));
        toast('تم الحذف');
      }
    };
  });
}

// 8. إرسال البيانات لحاسبة الوجبات
function sendToMeals() {
  const val = $('reading').value;
  const slot = $('slotKey').value;
  const date = $('dayPicker').value;
  // التوجيه مع تمرير البيانات في الرابط
  location.href = `meals.html?child=${childId}&bg=${val || ''}&slot=${slot}&date=${date}`;
}

// 9. ربط الأحداث (Event Listeners)
function setupEventListeners() {
  $('reading').addEventListener('input', calculateSmartAlert);
  $('slotKey').addEventListener('change', calculateSmartAlert);
  $('saveBtn').addEventListener('click', saveMeasurement);
  $('toMealsBtn').addEventListener('click', sendToMeals);
  
  $('dayPicker').addEventListener('change', () => {
    listenToTodayMeasurements(); // إعادة رسم التايم لاين حسب اليوم الجديد
  });
  
  $('searchBox').addEventListener('input', () => {
    renderTimeline(todayMeasurements); // الفلترة الحية
  });
}
