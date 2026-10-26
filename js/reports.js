// js/reports.js
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

function formatDecHour(dec) {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const $ = id => document.getElementById(id);
const setText = (el, v) => { if (el) el.textContent = (v == null || v === '') ? '—' : v; };
const round1 = n => Math.round((+n || 0) * 10) / 10;
const mgdl2mmol = v => v / 18.0182, mmol2mgdl = v => v * 18.0182;

function calcAge(bd) {
  if (!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

const SLOT_ORDER = ["WAKE","FASTING","PRE_BREAKFAST","POST_BREAKFAST","PRE_LUNCH","POST_LUNCH","PRE_DINNER","POST_DINNER","SNACK","BEDTIME","DURING_SLEEP"];
const SLOT_LABEL = {
  FASTING:'صائم', PRE_BREAKFAST:'ق.الفطار', POST_BREAKFAST:'ب.الفطار',
  PRE_LUNCH:'ق.الغداء', POST_LUNCH:'ب.الغداء',
  PRE_DINNER:'ق.العشاء', POST_DINNER:'ب.العشاء',
  SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم', WAKE:'استيقاظ'
};

function formatDate(d) { return d.toLocaleDateString('ar-EG', { weekday: 'short', day: '2-digit', month: 'numeric' }); }
function toast(m) {
  const t = $('toast');
  if (!t) return;
  t.textContent = m;
  t.style.display = 'block';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.display = 'none', 2200);
}
function showLoader(v) { const l = $('appLoader'); if (l) l.style.display = v ? 'flex' : 'none'; }

const urlParams = new URLSearchParams(location.search);
let currentUser;
let childId = urlParams.get('child') || localStorage.getItem('selectedChildId') || localStorage.getItem('lastChildId');
let childRef, child;
let unitSel, fromDate, toDate, reportGrid, emptyGrid, pie, cmpElems, aiTable, modalDayChart;
let sysLimits = { critLow: 54, low: 70, high: 180, critHigh: 250 };
let sysUnit = 'mg/dL';
let reportDays = [];
let parentIdForQuery = null;
let lastLabHba1cVal = null;

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  currentUser = u;

  parentIdForQuery = urlParams.get('parentId') || localStorage.getItem('selectedParentId') || u.uid;
  const isDoctorMode = urlParams.has('parentId') && parentIdForQuery !== u.uid;

  if (isDoctorMode) {
    document.body.classList.add('doctor-mode');
  }

  const backBtn = $('backBtn');
  const workstationUrl = `doctor-child.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}`;

  if (isDoctorMode) {
    $('navHome')?.classList.add('hidden');
    $('navMeas')?.classList.add('hidden');$('navMeals')?.classList.add('hidden');

    if ($('navWorkstation')) {
      $('navWorkstation').classList.remove('hidden');$('navWorkstation').href = workstationUrl;
    }

    if (backBtn) {
      backBtn.innerHTML = '🩺 المحطة السريرية';
      backBtn.onclick = () => location.href = workstationUrl;
    }
    if ($('doctorQuickBanner')) {$('doctorQuickBanner').classList.remove('hidden');
    }
    if ($('btnGoWorkstationBanner')) {$('btnGoWorkstationBanner').href = workstationUrl;
    }
    if ($('breadRootLink')) {$('breadRootLink').textContent = 'بوابة الأطباء 🩺';
      $('breadRootLink').href = 'doctor-dashboard.html';
    }
  } else {
    $('navHome')?.classList.remove('hidden');$('navMeas')?.classList.remove('hidden');
    $('navMeals')?.classList.remove('hidden');$('navWorkstation')?.classList.add('hidden');

    if (backBtn) {
      backBtn.innerHTML = '🏠 رجوع للوحة الطفل';
      backBtn.onclick = () => location.href = `child.html?child=${encodeURIComponent(childId)}`;
    }
  }

  $('logoutBtn')?.addEventListener('click', () => signOut(auth).then(() => location.href = 'index.html').catch(() => {}));

  wire();
  showLoader(true);
  try {
    await loadChild(parentIdForQuery);
    unitSel.value = sysUnit;
    fillThresholdChips();
    setQuickRange('1w');
    await renderReport();
  } catch (e) {
    console.error(e);
    alert('تعذر تحميل بيانات التقرير، يرجى التأكد من الصلاحيات أو الاتصال.');
  } finally {
    showLoader(false);
  }
});

function wire() {
  unitSel = $('unitSel'); fromDate = $('fromDate'); toDate =$('toDate');
  reportGrid = $('reportGrid'); emptyGrid = $('emptyGrid'); aiTable =$('aiTable');
  cmpElems = { AFrom: $('cmpAFrom'), ATo:$('cmpATo'), BFrom: $('cmpBFrom'), BTo:$('cmpBTo') };

  $('openPrint').onclick = () => window.open(`reports-print.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}`, '_blank');
  $('openPrintBlank').onclick = () => window.open(`reports-print.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}&blank=1`, '_blank');
  $('exportPdf').onclick = exportPdf;
  $('exportCsv').onclick = exportCSV;
  $('exportXlsx').onclick = exportXLSX;
  $('applyBtn').onclick = renderReport;
  $('cmpRun').onclick = runCompare;

  unitSel.onchange = () => { fillThresholdChips(); renderReport(); };
  $('quickRange').onchange = (e) => { if (e.target.value === 'custom') return; setQuickRange(e.target.value); renderReport(); };$('measureType').onchange = renderReport;

  ensureModal();
  reportGrid.addEventListener('click', e => {
    const c = e.target.closest('.grid-cell.clickable'); if (!c) return;
    openDetail(c.dataset.day, c.dataset.slot);
  });
  reportGrid.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.grid-cell.clickable'); if (!c) return;
    e.preventDefault(); openDetail(c.dataset.day, c.dataset.slot);
  });
}

const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function setQuickRange(range) {
  const to = new Date();
  const from = new Date();
  if (range === '1w') from.setDate(from.getDate() - 7);
  else if (range === '2w') from.setDate(from.getDate() - 14);
  else if (range === '1m') from.setMonth(from.getMonth() - 1);
  else if (range === '3m') from.setMonth(from.getMonth() - 3);

  $('toDate').value = isoLocal(to);$('fromDate').value = isoLocal(from);
  cmpElems.AFrom.value = $('fromDate').value;
  cmpElems.ATo.value = $('toDate').value;

  const diffTime = Math.abs(to - from);
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo.getTime() - diffTime);
  cmpElems.BFrom.value = isoLocal(prevFrom);
  cmpElems.BTo.value = isoLocal(prevTo);
}

async function loadChild(parentId) {
  childRef = doc(db, 'parents', parentId, 'children', childId);
  let snap = await getDoc(childRef);

  if (!snap.exists() && parentId !== currentUser?.uid) {
    const fallbackRef = doc(db, 'parents', currentUser.uid, 'children', childId);
    const fallbackSnap = await getDoc(fallbackRef);
    if (fallbackSnap.exists()) {
      childRef = fallbackRef;
      snap = fallbackSnap;
      parentIdForQuery = currentUser.uid;
      localStorage.setItem('selectedParentId', currentUser.uid);
    }
  }

  if (!snap.exists()) {
    try {
      const docPatSnap = await getDoc(doc(db, `doctors/${currentUser.uid}/patients/${childId}`));
      if (docPatSnap.exists() && docPatSnap.data()?.parentId) {
        parentIdForQuery = docPatSnap.data().parentId;
        childRef = doc(db, 'parents', parentIdForQuery, 'children', childId);
        snap = await getDoc(childRef);
      }
    } catch (e) {}
  }

  if (!snap.exists()) throw new Error('child-not-found');
  child = snap.data();

  sysUnit = child.glucoseUnit || 'mg/dL';
  if (child.glucose_limits) {
    sysLimits.low = Number(child.glucose_limits.low) || (sysUnit === 'mmol/L' ? 3.9 : 70);
    sysLimits.high = Number(child.glucose_limits.high) || (sysUnit === 'mmol/L' ? 10.0 : 180);
    sysLimits.critLow = Number(child.glucose_limits.critical_low) || (sysUnit === 'mmol/L' ? 3.0 : 54);
    sysLimits.critHigh = Number(child.glucose_limits.critical_high) || (sysUnit === 'mmol/L' ? 13.9 : 250);
  } else if (sysUnit === 'mmol/L') {
    sysLimits = { critLow: 3.0, low: 3.9, high: 10.0, critHigh: 13.9 };
  }

  const isDoc = parentIdForQuery !== currentUser?.uid;
  const qParams = childId ? `?child=${encodeURIComponent(childId)}${isDoc ? `&parentId=${encodeURIComponent(parentIdForQuery)}` : ''}` : '';

  $('navHome')?.setAttribute('href', `child.html${qParams}`);
  $('navMeas')?.setAttribute('href', `measurements.html${qParams}`);
  $('navMeals')?.setAttribute('href', `meals.html${qParams}`);
  $('navLabs')?.setAttribute('href', `labs.html${qParams}`);
  $('navVisits')?.setAttribute('href', `visits.html${qParams}`);
  $('breadChildName')?.setAttribute('href', isDoc ? `doctor-child.html${qParams}` : `child.html${qParams}`);

  setText($('breadChildName'), child.name || 'الطفل');
  setText($('topChildName'), child.name || 'الطفل');
  if ($('topAvatar'))$('topAvatar').textContent = (child.name || 'أ').trim().charAt(0);

  const age = calcAge(child.birthDate);
  const genderStr = child.gender === 'female' ? 'أنثى' : (child.gender === 'male' ? 'ذكر' : '');
  const regimenStr = child.regimen === 'pump' ? 'مضخة إنسولين' : 'حقن يومية (MDI)';
  const metaParts = [];
  if (age !== '-') metaParts.push(`العمر: ${age} سنة`);
  if (genderStr) metaParts.push(genderStr);
  if (regimenStr) metaParts.push(regimenStr);
  setText($('topChildMeta'), metaParts.join(' • ') || '—');

  try {
    const labQ = query(collection(db, `parents/${parentIdForQuery}/children/${childId}/labs`), orderBy('when', 'desc'), limit(1));
    const labSnap = await getDocs(labQ);
    if (!labSnap.empty) {
      const lastLab = labSnap.docs[0].data();
      if (lastLab?.hba1c?.value != null && !Number.isNaN(Number(lastLab.hba1c.value))) {
        lastLabHba1cVal = Number(lastLab.hba1c.value);
        const when = lastLab.when?.toDate ? lastLab.when.toDate() : (lastLab.date ? new Date(lastLab.date) : null);
        const dateStr = when ? when.toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' }) : '';
        setText($('statLastLab'), `${lastLabHba1cVal.toFixed(1)}\% ${dateStr ? `(${dateStr})` : ''}`);
      } else {
        setText($('statLastLab'), '—');
      }
    } else {
      setText($('statLastLab'), 'لا توجد تحاليل');
    }
  } catch (err) {
    console.warn('Could not fetch last lab:', err);
    setText($('statLastLab'), '—');
  }
}

function limitsInUnit(targetUnit) {
  if (targetUnit === sysUnit) return { ...sysLimits };
  if (targetUnit === 'mmol/L' && sysUnit === 'mg/dL') {
    return { critLow: round1(mgdl2mmol(sysLimits.critLow)), low: round1(mgdl2mmol(sysLimits.low)), high: round1(mgdl2mmol(sysLimits.high)), critHigh: round1(mgdl2mmol(sysLimits.critHigh)) };
  }
  if (targetUnit === 'mg/dL' && sysUnit === 'mmol/L') {
    return { critLow: Math.round(mmol2mgdl(sysLimits.critLow)), low: Math.round(mmol2mgdl(sysLimits.low)), high: Math.round(mmol2mgdl(sysLimits.high)), critHigh: Math.round(mmol2mgdl(sysLimits.critHigh)) };
  }
  return { ...sysLimits };
}

function fillThresholdChips() {
  const u = unitSel.value;
  const L = limitsInUnit(u);
  if ($('statTIRRangeSub'))$('statTIRRangeSub').textContent = `${L.low} - ${L.high} ${u}`;
  $('thresholdChips').innerHTML = `
    <span class="chip">هبوط حرج: <b>&lt; ${L.critLow} ${u}</b></span>
    <span class="chip">هبوط: <b>&lt; ${L.low} ${u}</b></span>
    <span class="chip">النطاق الطبيعي: <b>${L.low} – ${L.high} ${u}</b></span>
    <span class="chip">ارتفاع: <b>&gt; ${L.high} ${u}</b></span>
    <span class="chip">ارتفاع حرج: <b>&gt; ${L.critHigh} ${u}</b></span>
  `;
}

function classFor(val, u) {
  if (val == null) return '';
  const L = limitsInUnit(u);
  if (val >= L.critHigh) return 'crit';
  if (val > L.high) return 'mild';
  if (val <= L.critLow) return 'crit';
  if (val < L.low) return 'sev';
  return 'ok';
}

async function fetchRange(fromISO, toISO) {
  const col = collection(childRef, 'measurements');
  const qy = query(col, where('date', '>=', fromISO), where('date', '<=', toISO));
  const snap = await getDocs(qy);
  const unit = unitSel.value;
  const mType = $('measureType').value;
  const arr = [];

  snap.forEach(s => {
    const x = s.data();
    if (mType !== 'all' && x.measureMethod && x.measureMethod !== mType) return;

    let v = unit.includes('mmol')
      ? (x.value_mmol ?? (x.unit === 'mg/dL' ? mgdl2mmol(x.value) : x.value))
      : (x.value_mgdl ?? (x.unit === 'mmol/L' ? mmol2mgdl(x.value) : x.value));

    let mWhen = null;
    if (x.when?.toDate) mWhen = x.when.toDate();
    else if (x.timestamp?.toDate) mWhen = x.timestamp.toDate();
    else if (x.date) mWhen = new Date(x.date + (x.time ? 'T' + x.time : 'T00:00:00'));
    else mWhen = new Date();

    arr.push({
      date: x.date || isoLocal(mWhen),
      when: mWhen,
      slot: x.slotKey || x.slot || 'OTHER',
      val: Number.isFinite(+v) ? round1(+v) : null,
      carbs: Number(x.carbs) || 0,
      ins: Number(x.totalInsulin || x.correctionDose || x.totalDose || x.dose) || 0,
      notes: x.notes || '',
      id: s.id,
      raw: x
    });
  });
  return arr.sort((a, b) => a.when - b.when);
}

async function fetchBasalLogs(fromISO, toISO) {
  const basalMap = {};
  if (!childRef) return basalMap;
  try {
    const col = collection(db, `parents/${parentIdForQuery}/children/${childId}/basalLogs`);
    try {
      const qy = query(col, where('date', '>=', fromISO), where('date', '<=', toISO));
      const snap = await getDocs(qy);
      snap.forEach(s => {
        const d = s.data();
        const k = d.date || s.id;
        if (d.taken !== false) basalMap[k] = Number(d.dose) || 0;
      });
    } catch (e1) {
      const snap = await getDocs(col);
      snap.forEach(s => {
        const d = s.data();
        const k = d.date || s.id;
        if (k >= fromISO && k <= toISO && d.taken !== false) basalMap[k] = Number(d.dose) || 0;
      });
    }
  } catch (err) {
    console.warn('fetchBasalLogs error:', err);
  }
  return basalMap;
}

function groupByDaySlot(list, basalMap = {}) {
  const days = {};
  const defaultBasal = Number(child?.insulin?.basalDose || child?.basalDose) || 0;
  for (const r of list) {
    const key = r.date;
    days[key] = days[key] || {
      key,
      date: new Date(key + 'T00:00:00'),
      slots: {},
      dailyCarbs: 0,
      dailyInsulin: 0,
      dailyBolus: 0,
      dailyBasal: (basalMap[key] != null ? basalMap[key] : defaultBasal),
      dailyTDD: 0,
      basalRatio: 0,
      bolusRatio: 0
    };
    const slotKey = r.slot === 'WAKE' ? 'FASTING' : r.slot;
    days[key].slots[slotKey] = days[key].slots[slotKey] || [];
    days[key].slots[slotKey].push(r);
    days[key].dailyCarbs += (r.carbs || 0);
    days[key].dailyInsulin += (r.ins || 0);
  }
  for (const k in days) {
    const d = days[k];
    d.dailyBolus = d.dailyInsulin;
    if (d.dailyBasal == null) d.dailyBasal = (basalMap[k] != null ? basalMap[k] : defaultBasal);
    d.dailyTDD = round1(d.dailyBasal + d.dailyBolus);
    d.basalRatio = d.dailyTDD > 0 ? Math.round((d.dailyBasal / d.dailyTDD) * 100) : 0;
    d.bolusRatio = d.dailyTDD > 0 ? (100 - d.basalRatio) : 0;
  }
  return Object.values(days).sort((a, b) => a.date - b.date);
}

function cellHTML(vals, u) {
  if (!vals || !vals.length) return '';
  vals.sort((a, b) => {
    const tA = a.when instanceof Date ? a.when.getTime() : (a.when ? new Date(a.when).getTime() : 0);
    const tB = b.when instanceof Date ? b.when.getTime() : (b.when ? new Date(b.when).getTime() : 0);
    return tA - tB;
  });
  const v = vals[vals.length - 1];
  let html = `<div class="cell-data">`;
  if (v.val !== null) {
    const cls = classFor(v.val, u);
    html += `<div class="v ${cls}">${v.val}</div>`;
  }
  if (v.carbs > 0) html += `<div class="badge-carb">🍔 ${round1(v.carbs)}g</div>`;
  if (v.ins > 0 || (v.carbs > 0 && v.ins === 0)) html += `<div class="badge-ins">💉 ${round1(v.ins)}U</div>`;
  if (vals.length > 1) html += `<div class="badge-more">+${vals.length - 1} قياس</div>`;
  html += `</div>`;
  return html;
}

function cellWrap(d, k, unit) {
  const vals = d.slots[k];
  if (!vals || !vals.length) return `<div class="grid-cell"></div>`;
  return `<div class="grid-cell clickable" tabindex="0" role="button" data-day="${d.key}" data-slot="${k}" title="اضغط لعرض التفاصيل">${cellHTML(vals, unit)}</div>`;
}

async function renderReport() {
  showLoader(true);
  const unit = unitSel.value, from = fromDate.value, to = toDate.value;
  const [data, basalMap] = await Promise.all([
    fetchRange(from, to),
    fetchBasalLogs(from, to)
  ]);
  const days = groupByDaySlot(data, basalMap);
  reportDays = days;
  const body = $('reportGrid');
  body.innerHTML = '';

  if (!days.length) {
    $('emptyGrid').classList.remove('hidden');
    updateStats([], []);
    drawPie({ TIR: 0, TBR: 0, TAR: 0 });
    drawModalDayProfile([], unit);
    buildAI([], unit, []);
    showLoader(false);
    return;
  }

  $('emptyGrid').classList.add('hidden');
  for (const d of days) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    const totalCell = `
      <div class="cell-data" style="justify-content:center;">
        ${d.dailyCarbs > 0 ? `<div class="badge-carb" title="إجمالي النشويات">${round1(d.dailyCarbs)}g</div>` : ''}
        ${d.dailyTDD > 0 ? `
          <div class="badge-tdd" title="إجمالي الأنسولين TDD: ${round1(d.dailyTDD)}U (قاعدي ${round1(d.dailyBasal)}U / سريع ${round1(d.dailyBolus)}U)">
            ⚡ ${round1(d.dailyTDD)}U
          </div>
          <div style="font-size:9.5px; color:#64748b; line-height
