// js/measurements.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, addDoc, deleteDoc, onSnapshot, query, where, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  esc, round, localDateStr, localTimeStr, whenFromParts, toDateObj, convert, roundToStep, SLOT_ORDER,
  getTherapy, glucoseState, glucoseFields, calcIOB, extractDoseEntries
} from './dose-engine.js';
 
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
function toast(msg, duration = 2500) { const t = $('toast'); if (t) { t.innerHTML = msg; t.classList.remove('hidden'); t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => { t.classList.add('hidden'); t.style.display = 'none'; }, duration); } }
 
const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId');
 
let currentUser = null;
const parentIdParam = params.get('parentId');
let parentId = null;
let therapy = getTherapy({});
let todayMeasurements = [];
let unsubscribe = null;     // إلغاء المستمع القديم عند تغيير اليوم
let currentIOB = 0;         // الأنسولين النشط وقت القراءة المحددة
 
const SLOT_NAMES = { FASTING: 'صائم', PRE_BREAKFAST: 'قبل الفطار', POST_BREAKFAST: 'بعد الفطار', PRE_LUNCH: 'قبل الغدا', POST_LUNCH: 'بعد الغدا', PRE_DINNER: 'قبل العشا', POST_DINNER: 'بعد العشا', SNACK: 'سناك', BEDTIME: 'قبل النوم', EXERCISE: 'رياضة', OTHER: 'أخرى' };
 
const measRef = () => collection(db, "parents", parentId, "children", childId, "measurements");
 
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('index.html'); return; }
  currentUser = user;
  parentId = parentIdParam || localStorage.getItem('selectedParentId') || user.uid;
  if (parentIdParam) localStorage.setItem('selectedParentId', parentIdParam);
  if (!childId) { location.href = "parent.html"; return; }
 
  if ($('dayPicker')) $('dayPicker').value = localDateStr();
  if ($('timePicker')) $('timePicker').value = localTimeStr();
  autoSelectSlot();
 
  await loadChildSettings();
  initUnitSmartSwitch();
  listenToDayMeasurements();
  setupEventListeners();
  refreshIOB();
});
 
async function loadChildSettings() {
  try {
    let snap = await getDoc(doc(db, "parents", parentId, "children", childId));
    if (!snap.exists() && parentId !== currentUser?.uid) {
      const fallbackSnap = await getDoc(doc(db, "parents", currentUser.uid, "children", childId));
      if (fallbackSnap.exists()) {
        parentId = currentUser.uid;
        snap = fallbackSnap;
        localStorage.setItem('selectedParentId', parentId);
      }
    }
    if (!snap.exists()) return;
    const c = snap.data();
    therapy = getTherapy(c);
 
    const childName = c.name || 'الطفل';
    if ($('childName')) $('childName').textContent = childName;
    if ($('topChildName')) $('topChildName').textContent = childName;
    if ($('topAvatar')) $('topAvatar').textContent = childName.trim().charAt(0) || 'أ';
    if ($('topChildMeta')) $('topChildMeta').textContent = `${c.gender === 'female' ? 'أنثى' : 'ذكر'} • ${therapy.unit}`;
    if ($('breadChildName')) $('breadChildName').textContent = childName;

    if ($('unitSel')) $('unitSel').value = therapy.unit;

    if ($('therapyChips')) {
      $('therapyChips').innerHTML =
        `<span class="chip">🎯 الهدف: ${esc(therapy.target ?? '—')}</span><span class="chip">💉 CF: ${esc(therapy.CF ?? '—')}</span><span class="chip">📊 ${esc(therapy.unit)}</span>` +
        (therapy.missing.length ? `<span class="chip" style="background:#fef2f2;color:#991b1b;">⚠️ ناقص: ${esc(therapy.missing.join('، '))}</span>` : '');
    }

    const isDoctor = parentId !== currentUser?.uid;
    const safeChild = encodeURIComponent(childId);
    const safeParent = encodeURIComponent(parentId);
    const qDoc = `?child=${safeChild}&parentId=${safeParent}`;
    const qChild = `?child=${safeChild}`;
    const qDocParams = isDoctor ? qDoc : qChild;
    const qParams = qDocParams;
    const workstationUrl = `doctor-child.html${qDoc}`;

    const parentNav = $('parentNav');
    const doctorNav = $('doctorNav');
    const backBtn = $('backBtn');
    const breadRoot = $('breadRootLink');

    if (isDoctor) {
      if (parentNav) { parentNav.classList.add('hidden'); parentNav.style.display = 'none'; }
      if (doctorNav) { doctorNav.classList.remove('hidden'); doctorNav.style.display = 'flex'; }

      $('navDocStation')?.setAttribute('href', workstationUrl);
      $('navDocReports')?.setAttribute('href', `reports.html${qDoc}`);
      $('navDocLabs')?.setAttribute('href', `labs.html${qDoc}`);
      $('navDocVisits')?.setAttribute('href', `visits.html${qDoc}`);
      $('navDocDoses')?.setAttribute('href', `${workstationUrl}#protocolSection`);

      if (backBtn) {
        backBtn.textContent = '🏠 رجوع للوحة العيادة';
        backBtn.onclick = () => location.href = 'doctor-dashboard.html';
      }
      if (breadRoot) {
        breadRoot.textContent = 'عيادتي (قائمة المرضى) 👨‍⚕️';
        breadRoot.href = 'doctor-dashboard.html';
      }
      $('breadChildName')?.setAttribute('href', workstationUrl);
    } else {
      if (doctorNav) { doctorNav.classList.add('hidden'); doctorNav.style.display = 'none'; }
      if (parentNav) { parentNav.classList.remove('hidden'); parentNav.style.display = 'flex'; }

      $('navHome')?.setAttribute('href', `child.html${qChild}`);
      $('navMeas')?.setAttribute('href', `measurements.html${qChild}`);
      $('navMeals')?.setAttribute('href', `meals.html${qChild}`);
      $('navReports')?.setAttribute('href', `reports.html${qChild}`);
      $('navLabs')?.setAttribute('href', `labs.html${qChild}`);
      $('navVisits')?.setAttribute('href', `visits.html${qChild}`);

      if (backBtn) {
        backBtn.textContent = '🏠 رجوع للوحة الطفل';
        backBtn.onclick = () => location.href = `child.html${qChild}`;
      }
      if (breadRoot) {
        breadRoot.textContent = 'أطفالي 👨‍👩‍👧‍👦';
        breadRoot.href = 'parent.html';
      }
      $('breadChildName')?.setAttribute('href', `child.html${qChild}`);
    }
    $('logoutBtn')?.addEventListener('click', () => signOut(auth).then(() => location.href = 'index.html').catch(() => {}));
  } catch (e) { console.error(e); }
}
 
function autoSelectSlot() {
  const h = new Date().getHours();
  let slot = 'OTHER';
  if (h >= 5 && h < 11) slot = 'PRE_BREAKFAST';
  else if (h >= 11 && h < 16) slot = 'PRE_LUNCH';
  else if (h >= 16 && h < 22) slot = 'PRE_DINNER';
  else if (h >= 22 || h < 5) slot = 'BEDTIME';
  if ($('slotKey')) $('slotKey').value = slot;
}
 
function initUnitSmartSwitch() {
  const unitSel = $('unitSel'); const readingInput = $('reading');
  if (!unitSel || !readingInput) return;
  let previousUnit = unitSel.value;
  unitSel.addEventListener('change', (e) => {
    const newUnit = e.target.value;
    readingInput.placeholder = newUnit === 'mmol/L' ? 'مثال: 6.5' : 'مثال: 120';
    const val = parseFloat(readingInput.value);
    if (!isNaN(val) && previousUnit !== newUnit) {
      const v = convert(val, previousUnit, newUnit);
      readingInput.value = newUnit === 'mmol/L' ? v.toFixed(1) : Math.round(v);
    }
    previousUnit = newUnit;
    calculateSmartAlert();
  });
}
 
// ---------- IOB وقت القراءة المحددة ----------
async function refreshIOB() {
  try {
    const at = whenFromParts($('dayPicker').value, $('timePicker').value);
    const since = new Date(at.getTime() - therapy.diaHours * 3600e3);
    const snap = await getDocs(query(measRef(), where('when', '>=', since), where('when', '<', at)));
    currentIOB = calcIOB(extractDoseEntries(snap.docs.map(d => d.data())), at, therapy.diaHours);
  } catch (e) { console.error(e); currentIOB = 0; }
  calculateSmartAlert();
}
 
function calculateSmartAlert() {
  const rawVal = parseFloat($('reading').value);
  const selectedUnit = $('unitSel').value;
  const panel = $('actionsPanel');
  if (!rawVal || rawVal <= 0) { panel.classList.add('hidden'); return; }
 
  const val = convert(rawVal, selectedUnit, therapy.unit);
  panel.classList.remove('hidden');
 
  const alertBox = $('smartAlert');
  const corrRow = $('corrRow'); const hypoRow = $('hypoRow'); const corrInput = $('corrDoseInput');
  alertBox.className = 'alert';
  const L = therapy.limits;
 
  if (val < L.low) {
    // علاج الهبوط: كمية ثابتة يحددها الطبيب (الافتراضي 15 جم) ثم إعادة القياس
    alertBox.classList.add(val <= L.critLow ? 'danger' : 'warn');
    alertBox.innerHTML = `<div>🧃</div><div><b>هبوط!</b> أعطي <b>${therapy.hypoCarbs}g</b> كارب سريع وأعيدي القياس بعد 15 دقيقة. لا تعطي أنسولين الآن.</div>`;
    hypoRow.classList.remove('hidden'); corrRow.classList.add('hidden'); corrInput.value = '';
 
  } else if (val > L.high) {
    alertBox.classList.add(val >= L.critHigh ? 'danger' : 'warn');
    if (!therapy.CF || !therapy.target) {
      alertBox.innerHTML = `<div>⚠️</div><div><b>ارتفاع!</b> لا يمكن اقتراح جرعة تصحيح لأن الإعدادات ناقصة (${esc(therapy.missing.join('، '))}). راجعي الطبيب وأكملي إعدادات الطفل.</div>`;
      corrRow.classList.remove('hidden'); hypoRow.classList.add('hidden');
    } else {
      let dose = roundToStep(Math.max(0, (val - therapy.target) / therapy.CF - currentIOB), therapy.step);
      let capNote = '';
      if (therapy.maxDose && dose > therapy.maxDose) { dose = therapy.maxDose; capNote = ` (تم تحديدها بالحد الأقصى ${therapy.maxDose}U)`; }
      const iobNote = currentIOB > 0 ? ` بعد خصم أنسولين نشط ${round(currentIOB, 2)}U` : '';
      const ket = val >= L.critHigh ? '<br>🧪 اتبعي تعليمات الطبيب بشأن فحص الكيتونات.' : '';
      alertBox.innerHTML = `<div>💉</div><div><b>ارتفاع!</b> الجرعة المقترحة للتصحيح: <b>${dose}U</b>${iobNote}${capNote}.${ket}</div>`;
      corrRow.classList.remove('hidden'); hypoRow.classList.add('hidden');
      if (!corrInput.dataset.dirty) corrInput.value = dose > 0 ? dose : '';
    }
 
  } else {
    alertBox.classList.add('ok');
    alertBox.innerHTML = `<div>🎉</div><div><b>طبيعي!</b> استمر على هذا الأداء الممتاز.</div>`;
    hypoRow.classList.add('hidden'); corrRow.classList.add('hidden');
    corrInput.value = ''; $('hypoTreatment').value = '';
  }
}
 
async function saveMeasurement() {
  const rawVal = parseFloat($('reading').value);
  const selectedUnit = $('unitSel').value;
  if (!rawVal) { toast("يرجى إدخال قراءة صحيحة"); return; }
 
  const day = $('dayPicker').value || localDateStr(new Date());
  const time = $('timePicker').value || localTimeStr(new Date());
  const slotKey = $('slotKey').value || 'OTHER';
  const notes = $('mNotes').value.trim();
  const corrDose = parseFloat($('corrDoseInput').value) || 0;
  const hypoTreat = $('hypoTreatment').value.trim();
 
  if (therapy.maxDose && corrDose > therapy.maxDose) {
    alert(`⛔ جرعة التصحيح (${corrDose}U) أعلى من الحد الأقصى المحدد للطفل (${therapy.maxDose}U).`);
    return;
  }
  const norm = convert(rawVal, selectedUnit, therapy.unit);
  if (corrDose > 0 && norm < therapy.limits.low && !confirm("⚠️ السكر منخفض! هل أنت متأكدة من تسجيل جرعة أنسولين؟")) return;
 
  const payload = {
    ...glucoseFields(rawVal, selectedUnit, therapy),
    date: day, time, when: whenFromParts(day, time),
    slotKey, slotOrder: SLOT_ORDER[slotKey] || 200,
    correctionDose: corrDose > 0 ? corrDose : null,
    iobUsed: currentIOB > 0 ? currentIOB : null,
    cfUsed: therapy.CF, targetUsed: therapy.target,
    hypoTreatment: hypoTreat || null, notes: notes || null,
    createdAt: serverTimestamp()
  };
 
  try {
    await addDoc(measRef(), payload);
    const isPreMeal = ['PRE_BREAKFAST', 'PRE_LUNCH', 'PRE_DINNER', 'SNACK', 'FASTING'].includes(slotKey);
    if (isPreMeal) {
      const mealUrl = `meals.html?child=${encodeURIComponent(childId)}&bg=${encodeURIComponent(rawVal)}&unit=${encodeURIComponent(selectedUnit)}&slot=${encodeURIComponent(slotKey)}&date=${encodeURIComponent(day)}&time=${encodeURIComponent(time)}`;
      toast(`تم الحفظ بنجاح! ✔️ <a href="${mealUrl}" style="color:#60a5fa; text-decoration:underline; font-weight:bold; margin-right:8px;">🍽️ تسجيل وجبة بهذه القراءة ➔</a>`, 6000);
    } else {
      toast("تم الحفظ بنجاح! ✔️");
    }
    $('reading').value = ''; $('mNotes').value = '';
    $('corrDoseInput').value = ''; $('corrDoseInput').dataset.dirty = "";
    $('hypoTreatment').value = ''; $('actionsPanel').classList.add('hidden');
    refreshIOB();
  } catch (e) { alert("حدث خطأ أثناء الحفظ"); console.error(e); }
}
 
// مستمع لليوم المحدد فقط (بدل كل التاريخ) مع إلغاء المستمع السابق
function listenToDayMeasurements() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  const day = $('dayPicker').value;
  const start = whenFromParts(day, '00:00');
  const end = new Date(start.getTime() + 24 * 3600e3);
  const q = query(measRef(), where('when', '>=', start), where('when', '<', end), orderBy('when', 'desc'));
  unsubscribe = onSnapshot(q, (snapshot) => {
    todayMeasurements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTimeline(todayMeasurements);
  }, (err) => { console.error(err); toast('تعذر تحميل القياسات'); });
}
 
function renderTimeline(dataArray) {
  const grid = $('timelineGrid'); const empty = $('empty');
  const searchQuery = $('searchBox').value.toLowerCase();
 
  let filtered = dataArray;
  if (searchQuery) filtered = filtered.filter(m => (m.notes || '').toLowerCase().includes(searchQuery) || (m.hypoTreatment || '').toLowerCase().includes(searchQuery) || (SLOT_NAMES[m.slotKey] || '').toLowerCase().includes(searchQuery));
 
  grid.innerHTML = '';
  if (filtered.length === 0) { grid.classList.add('hidden'); empty.classList.remove('hidden'); return; }
  grid.classList.remove('hidden'); empty.classList.add('hidden');
 
  filtered.forEach(m => {
    const mUnit = m.unit || therapy.unit;
    const normalizedVal = m.normalizedValue ?? convert(Number(m.value), mUnit, therapy.unit);
    const css = glucoseState(normalizedVal, therapy.limits);
    const slotName = SLOT_NAMES[m.slotKey] || m.slotKey;
    const dt = toDateObj(m.when);
    const mTime = m.time || (dt ? pad(dt.getHours()) + ':' + pad(dt.getMinutes()) : '');
 
    let detailsHTML = '';
    if (m.correctionDose || m.hypoTreatment || m.carbs || m.mealDose || m.totalDose) {
      detailsHTML = `<div class="tl-details mt-10">`;
      if (m.hypoTreatment) detailsHTML += `<div class="tl-detail-item"><span>🧃 علاج هبوط</span><b style="color:#b45309;">${esc(m.hypoTreatment)}</b></div>`;
      if (m.correctionDose) detailsHTML += `<div class="tl-detail-item"><span>💧 تصحيح</span><b style="color:#ef4444;">${esc(m.correctionDose)} U</b></div>`;
      if (m.carbs) detailsHTML += `<div class="tl-detail-item"><span>🍔 كارب وجبة</span><b>${esc(m.carbs)}g</b></div>`;
      if (m.mealDose) detailsHTML += `<div class="tl-detail-item"><span>💉 جرعة أكل</span><b>${esc(m.mealDose)} U</b></div>`;
      if (m.totalDose) detailsHTML += `<div class="tl-detail-item" style="border-right:2px solid #cbd5e1; padding-right:10px;"><span>⚡ الإجمالي</span><b style="color:#2563eb;">${esc(m.totalDose)} U</b></div>`;
      detailsHTML += `</div>`;
    }

    // مقارنة ما بعد الوجبة بما قبل الوجبة إن وُجدت
    let diffBadgeHTML = '';
    if (m.slotKey && m.slotKey.startsWith('POST_')) {
      const preSlotMap = { POST_BREAKFAST: ['PRE_BREAKFAST', 'FASTING'], POST_LUNCH: ['PRE_LUNCH'], POST_DINNER: ['PRE_DINNER'] };
      const targets = preSlotMap[m.slotKey] || [];
      const preDoc = dataArray.find(x => x.id !== m.id && targets.includes(x.slotKey));
      if (preDoc) {
        const preNorm = preDoc.normalizedValue ?? convert(Number(preDoc.value), preDoc.unit || therapy.unit, therapy.unit);
        const diff = round(normalizedVal - preNorm, 1);
        const diffSign = diff > 0 ? `+${diff}` : `${diff}`;
        const diffColor = (diff > 50) ? '#ea580c' : (diff < 0) ? '#10b981' : '#166534';
        diffBadgeHTML = `<div class="tl-diff-badge" style="margin-top:6px;"><span>📊 الفارق عن قبل الأكل:</span><b style="color:${diffColor};">${diffSign} ${therapy.unit}</b></div>`;
      }
    }

    // أزرار الإجراءات السريعة (ربط الوجبات بالقياسات)
    let actionsHTML = '';
    const dayVal = m.date || $('dayPicker').value;
    if (m.carbs > 0 || m.totalDose > 0) {
      actionsHTML = `<div class="tl-action-bar"><a href="meals.html?child=${encodeURIComponent(childId)}&slot=${encodeURIComponent(m.slotKey)}&date=${encodeURIComponent(dayVal)}" class="tl-action-link edit-meal">🍽️ عرض / تعديل تفاصيل الوجبة</a></div>`;
    } else if (['PRE_BREAKFAST', 'PRE_LUNCH', 'PRE_DINNER', 'SNACK', 'FASTING'].includes(m.slotKey)) {
      actionsHTML = `<div class="tl-action-bar"><a href="meals.html?child=${encodeURIComponent(childId)}&bg=${encodeURIComponent(m.value)}&unit=${encodeURIComponent(mUnit)}&slot=${encodeURIComponent(m.slotKey)}&date=${encodeURIComponent(dayVal)}&time=${encodeURIComponent(mTime)}" class="tl-action-link to-meal">🍱 تسجيل وجبة بهذه القراءة ➔</a></div>`;
    }

    const card = document.createElement('div'); card.className = 'tl-item';
    card.innerHTML = `
      <div class="tl-dot ${css.dot}"></div>
      <div class="tl-card">
        <div class="tl-head"><div><span class="tl-time">🕒 ${esc(mTime)}</span> | <span class="tl-slot">${esc(slotName)}</span></div><button class="icon-btn del-btn" data-id="${esc(m.id)}" data-meal="${(m.carbs > 0 || m.totalDose > 0) ? '1' : ''}">🗑️</button></div>
        <div class="tl-body"><div class="tl-bg ${css.bg}">${esc(m.value)} <span style="font-size:14px;">${esc(mUnit)}</span></div><div style="font-size:13px; font-weight:bold;">${css.text}</div></div>
        ${diffBadgeHTML}
        ${detailsHTML}
        ${m.notes ? `<div class="tl-notes">📝 ${esc(m.notes)}</div>` : ''}
        ${actionsHTML}
      </div>`;
    grid.appendChild(card);
  });
 
  grid.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = async () => {
      const msg = btn.dataset.meal ? 'هذا السجل يحتوي وجبة وجرعة أنسولين، وسيُحذف كله معهم. تأكيد الحذف؟' : 'تأكيد الحذف؟';
      if (confirm(msg)) {
        await deleteDoc(doc(db, "parents", parentId, "children", childId, "measurements", btn.dataset.id));
        toast('تم الحذف'); refreshIOB();
      }
    };
  });
}
 
function sendToMeals() {
  const val = $('reading').value; const unit = $('unitSel').value; const slot = $('slotKey').value; const date = $('dayPicker').value; const time = $('timePicker').value;
  location.href = `meals.html?child=${encodeURIComponent(childId)}&bg=${encodeURIComponent(val || '')}&unit=${encodeURIComponent(unit)}&slot=${encodeURIComponent(slot)}&date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`;
}
 
// --- التصدير ---
function getExportData() {
  return todayMeasurements.map(m => {
    const dt = toDateObj(m.when);
    const time = m.time || (dt ? pad(dt.getHours()) + ':' + pad(dt.getMinutes()) : '');
    return [time, SLOT_NAMES[m.slotKey] || m.slotKey, `${m.value} ${m.unit}`, m.state, m.correctionDose || 0, m.carbs || 0, m.totalDose || 0, m.hypoTreatment || '', m.notes || ''];
  });
}
// حماية CSV: اقتباس الحقول + منع حقن الصيغ في Excel
const csvCell = c => { let s = String(c ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
 
function exportCSV() {
  const rows = [['الوقت', 'النوع', 'القيمة', 'الحالة', 'تصحيح (U)', 'كارب (g)', 'إجمالي الأنسولين', 'علاج الهبوط', 'ملاحظات'], ...getExportData()];
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `سجل_${$('dayPicker').value}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
 
async function exportXLSX() {
  if (!window.XLSX) {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
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
  $('dayPicker').addEventListener('change', () => { listenToDayMeasurements(); refreshIOB(); });
  $('timePicker').addEventListener('change', refreshIOB);
  $('searchBox').addEventListener('input', () => renderTimeline(todayMeasurements));
  $('exportCsvBtn').addEventListener('click', exportCSV);
  $('exportXlsxBtn').addEventListener('click', exportXLSX);
}
