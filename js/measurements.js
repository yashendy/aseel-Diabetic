// js/measurements.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const todayISO = () => new Date().toISOString().slice(0,10);
const nowTime = () => { const d=new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function toast(msg) { const t=$('toast'); if(t){ t.textContent=msg; t.classList.remove('hidden'); t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>{t.classList.add('hidden'); t.style.display='none';}, 2500); } }

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId');

let currentUser = null;
let childData = {};
let todayMeasurements = []; 

// إعدادات النظام للطفل
let sysUnit = 'mg/dL';
let sysTarget = 100, sysCF = 50, sysCR = { breakfast: 10, lunch: 10, dinner: 10, snack: 15 };
let sysLimits = { critLow: 54, low: 70, high: 180, critHigh: 250 };

const SLOT_NAMES = { FASTING: 'صائم', PRE_BREAKFAST: 'قبل الفطار', POST_BREAKFAST: 'بعد الفطار', PRE_LUNCH: 'قبل الغدا', POST_LUNCH: 'بعد الغدا', PRE_DINNER: 'قبل العشا', POST_DINNER: 'بعد العشا', SNACK: 'سناك', BEDTIME: 'قبل النوم', EXERCISE: 'رياضة', OTHER: 'أخرى' };
const SLOT_ORDER = { FASTING:10, PRE_BREAKFAST:20, POST_BREAKFAST:25, PRE_LUNCH:30, POST_LUNCH:35, PRE_DINNER:40, POST_DINNER:45, SNACK:50, EXERCISE:60, BEDTIME:90, OTHER:200 };

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('index.html'); return; }
  currentUser = user;
  if(!childId) { location.href="parent.html"; return; }

  if($('dayPicker')) $('dayPicker').value = todayISO();
  if($('timePicker')) $('timePicker').value = nowTime();
  autoSelectSlot();

  await loadChildSettings();
  initUnitSmartSwitch(); 
  listenToTodayMeasurements();
  setupEventListeners();
});

async function loadChildSettings() {
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

    if($('unitSel')) $('unitSel').value = sysUnit;
    if($('therapyChips')) {
      $('therapyChips').innerHTML = `<span class="chip">🎯 الهدف: ${sysTarget}</span><span class="chip">💉 CF: ${sysCF}</span><span class="chip">📊 ${sysUnit}</span>`;
    }
    if($('backToChild')) $('backToChild').onclick = () => location.href = `child.html?child=${childId}`;

  } catch(e) { console.error(e); }
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

function initUnitSmartSwitch() {
  const unitSel = $('unitSel');
  const readingInput = $('reading');
  if(!unitSel || !readingInput) return;

  let previousUnit = unitSel.value;
  unitSel.addEventListener('change', (e) => {
    const newUnit = e.target.value;
    readingInput.placeholder = newUnit === 'mmol/L' ? 'مثال: 6.5' : 'مثال: 120';
    if (readingInput.value) {
      let val = parseFloat(readingInput.value);
      if (!isNaN(val)) {
        if (newUnit === 'mmol/L' && previousUnit === 'mg/dL') readingInput.value = (val / 18.0182).toFixed(1);
        else if (newUnit === 'mg/dL' && previousUnit === 'mmol/L') readingInput.value = Math.round(val * 18.0182);
      }
    }
    previousUnit = newUnit;
    calculateSmartAlert(); 
  });
}

function normalizeGlucose(val, fromUnit) {
  if (fromUnit === sysUnit) return val;
  if (fromUnit === 'mmol/L' && sysUnit === 'mg/dL') return val * 18.0182;
  if (fromUnit === 'mg/dL' && sysUnit === 'mmol/L') return val / 18.0182;
  return val;
}

function calculateSmartAlert() {
  const rawVal = parseFloat($('reading').value);
  const selectedUnit = $('unitSel').value;
  const panel = $('actionsPanel');
  
  if(!rawVal || rawVal <= 0) { panel.classList.add('hidden'); return; }

  const val = normalizeGlucose(rawVal, selectedUnit);
  panel.classList.remove('hidden');
  
  const alertBox = $('smartAlert');
  const corrRow = $('corrRow'); const hypoRow = $('hypoRow'); const corrInput = $('corrDoseInput');
  alertBox.className = 'alert'; 

  const slot = $('slotKey').value;
  let currentCR = sysCR.snack || 15;
  if(slot.includes('BREAKFAST')) currentCR = sysCR.breakfast || 10;
  if(slot.includes('LUNCH')) currentCR = sysCR.lunch || 10;
  if(slot.includes('DINNER')) currentCR = sysCR.dinner || 10;

  if (val <= sysLimits.critLow || val < sysLimits.low) {
    alertBox.classList.add(val <= sysLimits.critLow ? 'danger' : 'warn');
    const raisePerGram = sysCF / currentCR; 
    let neededCarbs = 15;
    if(raisePerGram > 0 && sysTarget > val) neededCarbs = Math.round((sysTarget - val) / raisePerGram);
    alertBox.innerHTML = `<div>🧃</div><div><b>هبوط!</b> يحتاج الطفل <b>${neededCarbs}g</b> كارب للوصول للهدف.</div>`;
    hypoRow.classList.remove('hidden'); corrRow.classList.add('hidden'); corrInput.value = '';

  } else if (val >= sysLimits.critHigh || val > sysLimits.high) {
    alertBox.classList.add(val >= sysLimits.critHigh ? 'danger' : 'warn');
    let dose = 0;
    if(sysCF > 0 && val > sysTarget) dose = Math.round(((val - sysTarget) / sysCF) * 2) / 2;
    alertBox.innerHTML = `<div>💉</div><div><b>ارتفاع!</b> الجرعة المقترحة للتصحيح هي: <b>${dose}U</b>.</div>`;
    corrRow.classList.remove('hidden'); hypoRow.classList.add('hidden');
    if(!$('corrDoseInput').dataset.dirty) corrInput.value = dose > 0 ? dose : '';

  } else {
    alertBox.classList.add('ok');
    alertBox.innerHTML = `<div>🎉</div><div><b>طبيعي!</b> استمر على هذا الأداء الممتاز.</div>`;
    hypoRow.classList.add('hidden'); corrRow.classList.add('hidden');
    corrInput.value = ''; $('hypoTreatment').value = '';
  }
}

function getGlucoseStateCSS(val) {
  if(val <= sysLimits.critLow) return { dot: 'danger', bg: 'bg-danger', text: 'هبوط حرج' };
  if(val < sysLimits.low) return { dot: 'warn', bg: 'bg-warn', text: 'هبوط' };
  if(val >= sysLimits.critHigh) return { dot: 'danger', bg: 'bg-danger', text: 'ارتفاع حرج' };
  if(val > sysLimits.high) return { dot: 'warn', bg: 'bg-warn', text: 'ارتفاع' };
  return { dot: 'ok', bg: 'bg-ok', text: 'في النطاق' };
}

async function saveMeasurement() {
  const rawVal = parseFloat($('reading').value);
  const selectedUnit = $('unitSel').value;
  if(!rawVal) { toast("يرجى إدخال قراءة صحيحة"); return; }

  const day = $('dayPicker').value;
  const time = $('timePicker').value;
  const slotKey = $('slotKey').value;
  const notes = $('mNotes').value.trim();
  const corrDose = parseFloat($('corrDoseInput').value) || 0;
  const hypoTreat = $('hypoTreatment').value.trim();

  const dateTimeObj = new Date(`${day}T${time}`);
  const normalizedValue = normalizeGlucose(rawVal, selectedUnit);

  const payload = {
    value: rawVal, unit: selectedUnit, normalizedValue: normalizedValue,
    date: day, time: time, when: dateTimeObj, 
    slotKey: slotKey, slotOrder: SLOT_ORDER[slotKey] || 200,
    state: getGlucoseStateCSS(normalizedValue).text,
    correctionDose: corrDose > 0 ? corrDose : null,
    hypoTreatment: hypoTreat || null, notes: notes || null,
    createdAt: serverTimestamp()
  };

  try {
    await addDoc(collection(db, "parents", currentUser.uid, "children", childId, "measurements"), payload);
    toast("تم الحفظ بنجاح! ✔️");
    $('reading').value = ''; $('mNotes').value = '';
    $('corrDoseInput').value = ''; $('corrDoseInput').dataset.dirty = "";
    $('hypoTreatment').value = ''; $('actionsPanel').classList.add('hidden');
  } catch(e) { alert("حدث خطأ أثناء الحفظ"); console.error(e); }
}

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
  const grid = $('timelineGrid'); const empty = $('empty');
  const searchQuery = $('searchBox').value.toLowerCase();

  let filtered = dataArray;
  if(searchQuery) filtered = filtered.filter(m => (m.notes||'').toLowerCase().includes(searchQuery) || (m.hypoTreatment||'').toLowerCase().includes(searchQuery) || (SLOT_NAMES[m.slotKey]||'').toLowerCase().includes(searchQuery));

  grid.innerHTML = '';
  if(filtered.length === 0) { grid.classList.add('hidden'); empty.classList.remove('hidden'); return; }
  grid.classList.remove('hidden'); empty.classList.add('hidden');

  filtered.forEach(m => {
    const mUnit = m.unit || sysUnit;
    const normalizedVal = m.normalizedValue || normalizeGlucose(m.value, mUnit);
    const css = getGlucoseStateCSS(normalizedVal);
    const slotName = SLOT_NAMES[m.slotKey] || m.slotKey;
    const mTime = m.time || (m.when?.toDate ? pad(m.when.toDate().getHours()) + ':' + pad(m.when.toDate().getMinutes()) : '');

    let detailsHTML = '';
    if (m.correctionDose || m.hypoTreatment || m.carbs || m.mealDose || m.totalDose) {
      detailsHTML = `<div class="tl-details mt-10">`;
      if(m.hypoTreatment) detailsHTML += `<div class="tl-detail-item"><span>🧃 علاج هبوط</span><b style="color:#b45309;">${m.hypoTreatment}</b></div>`;
      if(m.correctionDose) detailsHTML += `<div class="tl-detail-item"><span>💧 تصحيح</span><b style="color:#ef4444;">${m.correctionDose} U</b></div>`;
      if(m.carbs) detailsHTML += `<div class="tl-detail-item"><span>🍔 كارب وجبة</span><b>${m.carbs}g</b></div>`;
      if(m.mealDose) detailsHTML += `<div class="tl-detail-item"><span>💉 جرعة أكل</span><b>${m.mealDose} U</b></div>`;
      if(m.totalDose) detailsHTML += `<div class="tl-detail-item" style="border-right:2px solid #cbd5e1; padding-right:10px;"><span>⚡ الإجمالي</span><b style="color:#2563eb;">${m.totalDose} U</b></div>`;
      detailsHTML += `</div>`;
    }

    const card = document.createElement('div'); card.className = 'tl-item';
    card.innerHTML = `
      <div class="tl-dot ${css.dot}"></div>
      <div class="tl-card">
        <div class="tl-head"><div><span class="tl-time">🕒 ${mTime}</span> | <span class="tl-slot">${slotName}</span></div><button class="icon-btn del-btn" data-id="${m.id}">🗑️</button></div>
        <div class="tl-body"><div class="tl-bg ${css.bg}">${m.value} <span style="font-size:14px;">${mUnit}</span></div><div style="font-size:13px; font-weight:bold;">${css.text}</div></div>
        ${detailsHTML} ${m.notes ? `<div class="tl-notes">📝 ${m.notes}</div>` : ''}
      </div>`;
    grid.appendChild(card);
  });

  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = async () => { if(confirm('تأكيد الحذف؟')) { await deleteDoc(doc(db, "parents", currentUser.uid, "children", childId, "measurements", btn.dataset.id)); toast('تم الحذف'); } };
  });
}

function sendToMeals() {
  const val = $('reading').value; const unit = $('unitSel').value; const slot = $('slotKey').value; const date = $('dayPicker').value;
  location.href = `meals.html?child=${childId}&bg=${val || ''}&unit=${unit}&slot=${slot}&date=${date}`;
}

// --- استعادة ميزة التصدير (Export) ---
function getExportData() {
  return todayMeasurements.map(m => {
    const time = m.time || (m.when?.toDate ? pad(m.when.toDate().getHours()) + ':' + pad(m.when.toDate().getMinutes()) : '');
    return [ time, SLOT_NAMES[m.slotKey] || m.slotKey, `${m.value} ${m.unit}`, m.state, m.correctionDose || 0, m.carbs || 0, m.totalDose || 0, m.hypoTreatment || '', m.notes || '' ];
  });
}

function exportCSV() {
  const rows = [['الوقت', 'النوع', 'القيمة', 'الحالة', 'تصحيح (U)', 'كارب (g)', 'إجمالي الأنسولين', 'علاج الهبوط', 'ملاحظات'], ...getExportData()];
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `سجل_${$('dayPicker').value}.csv`; a.click();
}

async function exportXLSX() {
  if(!window.XLSX) {
    await new Promise((res,rej)=>{const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s);});
  }
  const rows = [['الوقت', 'النوع', 'القيمة', 'الحالة', 'تصحيح (U)', 'كارب (g)', 'إجمالي الأنسولين', 'علاج الهبوط', 'ملاحظات'], ...getExportData()];
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, "القياسات");
  window.XLSX.writeFile(wb, `سجل_${$('dayPicker').value}.xlsx`);
}

function setupEventListeners() {
  $('reading').addEventListener('input', calculateSmartAlert);
  $('slotKey').addEventListener('change', calculateSmartAlert);
  $('saveBtn').addEventListener('click', saveMeasurement);
  $('toMealsBtn').addEventListener('click', sendToMeals);
  $('corrDoseInput').addEventListener('input', () => $('corrDoseInput').dataset.dirty = "true");
  document.querySelectorAll('.chip-btn').forEach(btn => btn.addEventListener('click', () => $('hypoTreatment').value = btn.dataset.val));
  $('dayPicker').addEventListener('change', () => listenToTodayMeasurements());
  $('searchBox').addEventListener('input', () => renderTimeline(todayMeasurements));
  
  // زراير التصدير
  $('exportCsvBtn').addEventListener('click', exportCSV);
  $('exportXlsxBtn').addEventListener('click', exportXLSX);
}
