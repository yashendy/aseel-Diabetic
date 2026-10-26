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

  const backBtn = $('backBtn');
  const workstationUrl = `doctor-child.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}`;

  if (isDoctorMode) {
    // 1. إخفاء أزرار صفحات الطفل اليومية عن الطبيب لمنع التشتت
    $('navHome')?.classList.add('hidden');
    $('navMeas')?.classList.add('hidden');
    $('navMeals')?.classList.add('hidden');

    // 2. إظهار زر المحطة السريرية للطبيب
    if ($('navWorkstation')) {
      $('navWorkstation').classList.remove('hidden');
      $('navWorkstation').href = workstationUrl;
    }

    // 3. ضبط زر الرجوع ومسار التنقل للطبيب
    if (backBtn) {
      backBtn.innerHTML = '🩺 المحطة السريرية';
      backBtn.onclick = () => location.href = workstationUrl;
    }
    if ($('doctorQuickBanner')) {
      $('doctorQuickBanner').classList.remove('hidden');
    }
    if ($('btnGoWorkstationBanner')) {
      $('btnGoWorkstationBanner').href = workstationUrl;
    }
    if ($('breadRootLink')) {
      $('breadRootLink').textContent = 'بوابة الأطباء 🩺';
      $('breadRootLink').href = 'doctor-dashboard.html';
    }
  } else {
    // وضع ولي الأمر والطفل المعتاد
    $('navHome')?.classList.remove('hidden');
    $('navMeas')?.classList.remove('hidden');
    $('navMeals')?.classList.remove('hidden');
    $('navWorkstation')?.classList.add('hidden');

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
  unitSel = $('unitSel'); fromDate = $('fromDate'); toDate = $('toDate');
  reportGrid = $('reportGrid'); emptyGrid = $('emptyGrid'); aiTable = $('aiTable');
  cmpElems = { AFrom: $('cmpAFrom'), ATo: $('cmpATo'), BFrom: $('cmpBFrom'), BTo: $('cmpBTo') };

  $('openPrint').onclick = () => window.open(`reports-print.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}`, '_blank');
  $('openPrintBlank').onclick = () => window.open(`reports-print.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}&blank=1`, '_blank');
  $('exportPdf').onclick = exportPdf;
  $('exportCsv').onclick = exportCSV;
  $('exportXlsx').onclick = exportXLSX;
  $('applyBtn').onclick = renderReport;
  $('cmpRun').onclick = runCompare;

  unitSel.onchange = () => { fillThresholdChips(); renderReport(); };
  $('quickRange').onchange = (e) => {
    if (e.target.value === 'custom') return;
    setQuickRange(e.target.value);
    renderReport();
  };
  $('measureType').onchange = renderReport;

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

  $('toDate').value = isoLocal(to);
  $('fromDate').value = isoLocal(from);
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

  // مسار احتياطي للطبيب عبر سجل مرضى العيادة
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
  if ($('topAvatar')) $('topAvatar').textContent = (child.name || 'أ').trim().charAt(0);

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
        setText($('statLastLab'), `${lastLabHba1cVal.toFixed(1)}% ${dateStr ? `(${dateStr})` : ''}`);
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
  if ($('statTIRRangeSub')) $('statTIRRangeSub').textContent = `${L.low} - ${L.high} ${u}`;
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
    const slotKey = r.slot === 'WAKE' ? 'FASTING' : r.slot; // توحيد صائم واستيقاظ في عمود واحد
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
          <div style="font-size:9.5px; color:#64748b; line-height:1.2; text-align:center;">
            ق: ${round1(d.dailyBasal)} | س: ${round1(d.dailyBolus)}
          </div>
        ` : (d.dailyBolus > 0 ? `<div class="badge-ins">💉 ${round1(d.dailyBolus)}U</div>` : '')}
        ${d.dailyCarbs === 0 && d.dailyTDD === 0 ? '<span class="muted">—</span>' : ''}
      </div>`;

    row.innerHTML = `
      <div class="grid-cell" style="font-weight:bold; color:#475569;">${formatDate(d.date)}</div>
      <div class="grid-cell col-total">${totalCell}</div>
      ` +
      ['FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP']
      .map(k => cellWrap(d, k, unit)).join('');
    body.appendChild(row);
  }

  updateStats(data, days);
  const parts = calcParts(data, unit);
  drawPie(parts);
  drawModalDayProfile(data, unit);
  buildAI(data, unit, days);
  showLoader(false);
}

function updateStats(list, days = []) {
  const validList = list.filter(x => x.val !== null && Number.isFinite(+x.val));
  const unit = unitSel.value, L = limitsInUnit(unit);
  if (!validList.length) {
    setText($('statTIR'), '0%');
    setText($('statLow'), '0%');
    setText($('statLowL1'), '0%');
    setText($('statCritLow'), '0%');
    setText($('statHigh'), '0%');
    setText($('statHighL1'), '0%');
    setText($('statCritHigh'), '0%');
    setText($('statGMI'), '—');
    setText($('statCV'), '—');
    setText($('statSD'), '—');
    setText($('statAvg'), '—');
    setText($('statCount'), '0');
    setText($('statTDDPerKg'), '—');
    setText($('statAvgTDD'), '—');
    setText($('statBasalBolusRatio'), '—');
    setText($('statChildWeight'), '—');
    return;
  }

  const n = validList.length;
  const critLows = validList.filter(x => x.val < L.critLow).length;
  const mildLows = validList.filter(x => x.val >= L.critLow && x.val < L.low).length;
  const totalLows = critLows + mildLows;
  const inRange = validList.filter(x => x.val >= L.low && x.val <= L.high).length;
  const mildHighs = validList.filter(x => x.val > L.high && x.val <= L.critHigh).length;
  const critHighs = validList.filter(x => x.val > L.critHigh).length;
  const totalHighs = mildHighs + critHighs;

  const tirPct = Math.round((inRange / n) * 100);
  const tbrPct = Math.round((totalLows / n) * 100);
  const tbrL1Pct = round1((mildLows / n) * 100);
  const tbrL2Pct = round1((critLows / n) * 100);
  const tarPct = Math.round((totalHighs / n) * 100);
  const tarL1Pct = round1((mildHighs / n) * 100);
  const tarL2Pct = round1((critHighs / n) * 100);

  const mean = validList.reduce((a, x) => a + x.val, 0) / n;
  const sd = Math.sqrt(validList.reduce((a, x) => a + Math.pow(x.val - mean, 2), 0) / n);
  const cv = mean > 0 ? (sd / mean) * 100 : 0;

  const meanMgdl = unit === 'mmol/L' ? mmol2mgdl(mean) : mean;
  const gmi = 3.31 + (0.02392 * meanMgdl);

  setText($('statTIR'), `${tirPct}%`);
  const tirBadge = $('statTIRBadge');
  if (tirBadge) {
    tirBadge.className = `target-badge ${tirPct >= 70 ? 'ok' : (tirPct >= 50 ? 'warn' : 'bad')}`;
    tirBadge.textContent = `الهدف: > 70% (${tirPct >= 70 ? 'متحقق ✅' : 'يحتاج تحسين ⚠️'})`;
  }

  setText($('statLow'), `${tbrPct}%`);
  setText($('statLowL1'), `${tbrL1Pct}%`);
  setText($('statCritLow'), `${tbrL2Pct}%`);
  const tbrBadge = $('statTBRBadge');
  if (tbrBadge) {
    tbrBadge.className = `target-badge ${tbrPct < 4 ? 'ok' : (tbrPct <= 9 ? 'warn' : 'bad')}`;
    tbrBadge.textContent = `الهدف: < 4% (${tbrPct < 4 ? 'آمن 🟢' : 'انتبه ⚠️'})`;
  }

  setText($('statHigh'), `${tarPct}%`);
  setText($('statHighL1'), `${tarL1Pct}%`);
  setText($('statCritHigh'), `${tarL2Pct}%`);
  const tarBadge = $('statTARBadge');
  if (tarBadge) {
    tarBadge.className = `target-badge ${tarPct < 25 ? 'ok' : (tarPct <= 35 ? 'warn' : 'bad')}`;
    tarBadge.textContent = `الهدف: < 25% (${tarPct < 25 ? 'ممتاز 🟢' : 'مرتفع ⚠️'})`;
  }

  setText($('statGMI'), `${gmi.toFixed(1)}%`);
  setText($('statCV'), `${round1(cv)}%`);
  const cvBadge = $('statCVBadge');
  if (cvBadge) {
    cvBadge.className = `target-badge ${cv <= 36 ? 'ok' : 'warn'}`;
    cvBadge.textContent = `الهدف: ≤ 36% (${cv <= 36 ? 'مستقر 🟢' : 'تذبذب عالي ⚠️'})`;
  }

  setText($('statSD'), `${round1(sd)} ${unit}`);
  setText($('statAvg'), `${round1(mean)} ${unit}`);
  setText($('statCount'), String(n));

  const weight = Number(child?.vitals?.weight || child?.weight) || null;
  setText($('statChildWeight'), weight ? `${weight}` : '—');

  const daysList = (days && days.length) ? days : (reportDays || []);
  const activeDays = daysList.filter(d => (d.dailyTDD > 0 || d.dailyBolus > 0));
  if (activeDays.length > 0) {
    const sumTDD = activeDays.reduce((acc, d) => acc + (d.dailyTDD || 0), 0);
    const sumBasal = activeDays.reduce((acc, d) => acc + (d.dailyBasal || 0), 0);
    const sumBolus = activeDays.reduce((acc, d) => acc + (d.dailyBolus || 0), 0);
    const avgTDD = sumTDD / activeDays.length;
    const avgBasal = sumBasal / activeDays.length;
    const basalRatio = avgTDD > 0 ? Math.round((avgBasal / avgTDD) * 100) : 0;
    const bolusRatio = avgTDD > 0 ? (100 - basalRatio) : 0;

    setText($('statAvgTDD'), `${round1(avgTDD)}`);
    setText($('statBasalBolusRatio'), `${basalRatio}% / ${bolusRatio}%`);

    if (weight && weight > 0) {
      const tddPerKg = (avgTDD / weight).toFixed(2);
      setText($('statTDDPerKg'), `${tddPerKg}`);
      const tddBadge = $('statTDDBadge');
      if (tddBadge) {
        if (tddPerKg >= 0.5 && tddPerKg <= 1.0) {
          tddBadge.className = 'target-badge ok';
          tddBadge.textContent = '0.6 - 1.0 (طبيعي ✅)';
        } else if (tddPerKg > 1.0 && tddPerKg <= 1.5) {
          tddBadge.className = 'target-badge warn';
          tddBadge.textContent = '1.0 - 1.5 (بلوغ / مقاومة ℹ️)';
        } else if (tddPerKg > 1.5) {
          tddBadge.className = 'target-badge bad';
          tddBadge.textContent = '> 1.5 (مرتفع جداً ⚠️)';
        } else {
          tddBadge.className = 'target-badge info';
          tddBadge.textContent = '< 0.5 (شهر عسل 🍯)';
        }
      }
    } else {
      setText($('statTDDPerKg'), '—');
      const tddBadge = $('statTDDBadge');
      if (tddBadge) {
        tddBadge.className = 'target-badge info';
        tddBadge.textContent = 'سجل وزن الطفل';
      }
    }
  } else {
    setText($('statAvgTDD'), '—');
    setText($('statBasalBolusRatio'), '—');
    setText($('statTDDPerKg'), '—');
  }
}

function calcParts(list, unit) {
  const validList = list.filter(x => x.val !== null && Number.isFinite(+x.val));
  const L = limitsInUnit(unit), n = validList.length || 1;
  const tbr = (validList.filter(x => x.val < L.low).length / n) * 100;
  const tir = (validList.filter(x => x.val >= L.low && x.val <= L.high).length / n) * 100;
  const tar = (validList.filter(x => x.val > L.high).length / n) * 100;
  return { TIR: Math.round(tir), TBR: Math.round(tbr), TAR: Math.round(tar) };
}

function drawPie({ TIR, TBR, TAR }) {
  const canvas = $('pieTIR');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (pie) pie.destroy();
  pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['داخل النطاق (TIR)', 'انخفـــــاض (TBR)', 'ارتـــــــفاع (TAR)'],
      datasets: [{
        data: [TIR, TBR, TAR],
        backgroundColor: ['#16a34a', '#ef4444', '#f59e0b'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }
      },
      cutout: '70%'
    }
  });
}

function drawModalDayProfile(list, unit) {
  const canvas = $('modalDayCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (modalDayChart) {
    modalDayChart.destroy();
    modalDayChart = null;
  }
  const validList = list.filter(x => x.val !== null && Number.isFinite(+x.val) && x.when);
  const L = limitsInUnit(unit);
  if (!validList.length) {
    modalDayChart = new Chart(ctx, {
      type: 'scatter',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'لا توجد بيانات مسجلة لعرض منحنى اليوم النمطي' }
        }
      }
    });
    return;
  }

  const colors = validList.map(item => {
    const v = item.val;
    if (v < L.critLow || v > L.critHigh) return '#dc2626';
    if (v < L.low) return '#3b82f6';
    if (v > L.high) return '#f59e0b';
    return '#10b981';
  });

  const scatterPoints = validList.map(item => {
    const d = item.when instanceof Date ? item.when : new Date(item.when);
    const decHour = d.getHours() + (d.getMinutes() / 60);
    return {
      x: round1(decHour),
      y: item.val,
      when: d,
      slot: item.slot,
      carbs: item.carbs,
      ins: item.ins
    };
  });

  const trendPoints = [];
  const step = 0.5;
  for (let h = 0; h <= 24; h += step) {
    const nearby = scatterPoints.filter(p => Math.abs(p.x - h) <= 1.5);
    if (nearby.length > 0) {
      const avgY = nearby.reduce((acc, p) => acc + p.y, 0) / nearby.length;
      trendPoints.push({ x: round1(h), y: round1(avgY) });
    }
  }

  const chartDatasets = [
    {
      label: `الحد الأدنى (${L.low} ${unit})`,
      data: [{ x: 0, y: L.low }, { x: 24, y: L.low }],
      type: 'line',
      borderColor: '#10b981',
      borderWidth: 1.5,
      borderDash: [5, 5],
      pointRadius: 0,
      fill: false,
      order: 3
    },
    {
      label: `الحد الأعلى (${L.high} ${unit})`,
      data: [{ x: 0, y: L.high }, { x: 24, y: L.high }],
      type: 'line',
      borderColor: '#10b981',
      borderWidth: 1.5,
      borderDash: [5, 5],
      pointRadius: 0,
      fill: '-1',
      backgroundColor: 'rgba(16, 185, 129, 0.08)',
      order: 2
    }
  ];

  if (trendPoints.length >= 2) {
    chartDatasets.push({
      label: 'منحنى رادار الجلوكوز (24h Trend)',
      data: trendPoints,
      type: 'line',
      borderColor: '#2563eb',
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0.35,
      spanGaps: true,
      fill: false,
      order: 1
    });
  }

  chartDatasets.push({
    label: 'قراءات السكر',
    data: scatterPoints,
    pointBackgroundColor: colors,
    pointBorderColor: '#ffffff',
    pointBorderWidth: 1,
    pointRadius: 4.5,
    pointHoverRadius: 7,
    order: 0
  });

  modalDayChart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets: chartDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 24,
          title: { display: true, text: 'ساعات اليوم (24h)', font: { family: 'inherit', size: 11, weight: 'bold' } },
          ticks: {
            stepSize: 3,
            callback: (val) => `${String(Math.floor(val)).padStart(2, '0')}:00`
          },
          grid: { color: '#f1f5f9' }
        },
        y: {
          min: 0,
          suggestedMax: unit === 'mmol/L' ? 18 : 300,
          title: { display: true, text: `مستوى السكر (${unit})`, font: { family: 'inherit', size: 11, weight: 'bold' } },
          grid: { color: '#f1f5f9' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          callbacks: {
            label: (context) => {
              const raw = context.raw;
              if (context.dataset.label && context.dataset.label.includes('الحد')) return context.dataset.label;
              if (context.dataset.label && context.dataset.label.includes('منحنى رادار')) {
                return 'منحنى رادار الجلوكوز: ' + raw.y + ' ' + unit + ' (الساعة ' + formatDecHour(raw.x) + ')';
              }
              if (!raw || !raw.when) return '';
              const timeStr = raw.when.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
              const dateStr = raw.when.toLocaleDateString('ar-EG', { month: 'numeric', day: 'numeric' });
              let res = `${dateStr} (${timeStr}): ${raw.y} ${unit}`;
              if (raw.carbs > 0) res += ` • كارب: ${round1(raw.carbs)}g`;
              if (raw.ins > 0) res += ` • إنسولين: ${round1(raw.ins)}U`;
              return res;
            }
          }
        }
      }
    }
  });
}

function rowCmp(label, a, b, fmt = '%') {
  const diff = (a - b);
  const cls = diff >= 0 ? (label === 'انخفاض' || label === 'ارتفاع' ? 'diff-down' : 'diff-up') : (label === 'انخفاض' || label === 'ارتفاع' ? 'diff-up' : 'diff-down');
  return `<div>${label}</div><div>${fmtVal(a, fmt)}</div><div>${fmtVal(b, fmt)}</div><div class="${cls}">${fmtVal(diff, fmt, true)}</div>`;
}

function fmtVal(v, fmt, isDiff = false) {
  if (isNaN(v)) return '—';
  if (fmt === '%') return `${Math.round(v)}%`;
  return isDiff ? (v > 0 ? `+${round1(v)}` : round1(v)) : round1(v);
}

async function runCompare() {
  showLoader(true);
  const unit = unitSel.value;
  const [A, B] = await Promise.all([
    fetchRange(cmpElems.AFrom.value, cmpElems.ATo.value),
    fetchRange(cmpElems.BFrom.value, cmpElems.BTo.value)
  ]);
  const vA = A.filter(x => x.val !== null), vB = B.filter(x => x.val !== null);
  const pa = calcParts(vA, unit), pb = calcParts(vB, unit);
  const nA = vA.length || 1, nB = vB.length || 1;
  const meanA = vA.reduce((a, x) => a + x.val, 0) / nA, meanB = vB.reduce((a, x) => a + x.val, 0) / nB;
  const sdA = Math.sqrt(vA.reduce((a, x) => a + Math.pow(x.val - meanA, 2), 0) / nA);
  const sdB = Math.sqrt(vB.reduce((a, x) => a + Math.pow(x.val - meanB, 2), 0) / nB);

  $('cmpTable').innerHTML = `
    <div>المؤشر</div><div>الحالية</div><div>السابقة</div><div>الفرق</div>
    ${rowCmp('داخل النطاق', pa.TIR, pb.TIR, '%')}
    ${rowCmp('انخفاض', pa.TBR, pb.TBR, '%')}
    ${rowCmp('ارتفاع', pa.TAR, pb.TAR, '%')}
    ${rowCmp('المتوسط', meanA, meanB, 'num')}
    ${rowCmp('SD الانحراف', sdA, sdB, 'num')}
    ${rowCmp('عدد القياسات', nA, nB, 'num')}
  `;
  showLoader(false);
}

function buildAI(list, unit, days = []) {
  const L = limitsInUnit(unit);
  const patt = [];
  const valid = list.filter(x => x.val !== null);
  if (valid.length === 0) {
    $('aiTable').innerHTML = `<div style="grid-column:1/-1; padding:15px; text-align:center; color:#64748b;">لا توجد بيانات كافية للتحليل الذكي</div>`;
    return;
  }

  const SLOT_NAMES = { FASTING:'صائم', WAKE:'استيقاظ', PRE_BREAKFAST:'ق. الفطار', POST_BREAKFAST:'ب. الفطار', PRE_LUNCH:'ق. الغداء', POST_LUNCH:'ب. الغداء', PRE_DINNER:'ق. العشاء', POST_DINNER:'ب. العشاء', SNACK:'سناك', BEDTIME:'ق. النوم', DURING_SLEEP:'أثناء النوم' };
  const total = valid.length;
  const pctTBR = Math.round((valid.filter(x => x.val < L.low).length / total) * 100);
  const pctTAR = Math.round((valid.filter(x => x.val > L.high).length / total) * 100);
  const pctTIR = Math.round((valid.filter(x => x.val >= L.low && x.val <= L.high).length / total) * 100);

  const daysList = (days && days.length) ? days : (reportDays || []);
  const activeDays = daysList.filter(d => (d.dailyTDD > 0 || d.dailyBolus > 0));
  if (activeDays.length > 0) {
    const sumTDD = activeDays.reduce((acc, d) => acc + (d.dailyTDD || 0), 0);
    const sumBasal = activeDays.reduce((acc, d) => acc + (d.dailyBasal || 0), 0);
    const avgTDD = sumTDD / activeDays.length;
    const basalRatio = avgTDD > 0 ? Math.round((sumBasal / sumTDD) * 100) : 0;
    const weight = Number(child?.vitals?.weight || child?.weight) || null;
    const tddPerKg = weight && avgTDD > 0 ? (avgTDD / weight).toFixed(2) : null;

    const nocturnalLows = valid.filter(x => (x.slot === 'FASTING' || x.slot === 'DURING_SLEEP' || x.slot === 'BEDTIME') && x.val < L.low).length;

    if (basalRatio > 55 || (basalRatio >= 50 && nocturnalLows >= 2)) {
      patt.push({
        name: 'إفراط الأنسولين القاعدي (Over-basalization)',
        desc: `نسبة القاعدي تمثل ${basalRatio}% من إجمالي الجرعة اليومية (المعدل الطبيعي 40-50%) مع رصد ${nocturnalLows > 0 ? `${nocturnalLows} هبوط أثناء الصيام/النوم` : 'ارتفاع عبء القاعدي'}.`,
        rec: 'يوصى بمراجعة الطبيب لتقليل جرعة الأنسولين طويل المفعول بنسبة 10-15% لمنع هبوط الصيام/النوم ونقل التغطية للأنسولين السريع عند الوجبات.',
        conf: 'أهمية قصوى',
        color: '#dc2626'
      });
    } else if (basalRatio < 35 && basalRatio > 0) {
      const fastingHighs = valid.filter(x => (x.slot === 'FASTING' || x.slot === 'WAKE') && x.val > L.high).length;
      if (fastingHighs >= 2) {
        patt.push({
          name: 'نقص الأنسولين القاعدي (Under-basalization)',
          desc: `نسبة القاعدي منخفضة (${basalRatio}%) مع رصد ارتفاعات متكررة في قراءات الصيام قبل الإفطار.`,
          rec: 'قد يحتاج الطفل لزيادة طفيفة في جرعة القاعدي لتأمين استقرار خط الأساس على مدار 24 ساعة وتقليل الحاجة لجرعات تصحيحية متعددة.',
          conf: 'أهمية عالية',
          color: '#d97706'
        });
      }
    }

    if (tddPerKg && Number(tddPerKg) > 1.25 && pctTAR > 25) {
      patt.push({
        name: 'جرعة عالية مع عدم استقرار (اشتباه تضخم شحمي)',
        desc: `الجرعة اليومية للطفل (${tddPerKg} وحدة/كجم) مرتفعة قياساً بوزنه دون تحقيق الاستقرار المطلوب (نسبة الارتفاع ${pctTAR}%).`,
        rec: 'افحص مواضع الحقن بعناية للتأكد من عدم وجود تكتلات دهنية (Lipohypertrophy) تعيق امتصاص الإنسولين، واحرص على تدوير أماكن الحقن وتغيير سن القلم بانتظام.',
        conf: 'تنبيه سريري',
        color: '#b45309'
      });
    }
  }

  if (pctTBR > 15) patt.push({ name: 'كثرة الهبوطات (TBR)', desc: `نسبة الهبوط (${pctTBR}%) تتخطى الحد المسموح به دولياً (<4%).`, rec: 'مراجعة معامل الكارب CR وجرعات الأنسولين بالتشاور مع الطبيب لتقليل خطر الهبوط المتكرر.', conf: 'أهمية قصوى', color: '#dc2626' });
  if (pctTAR > 25) patt.push({ name: 'كثرة الارتفاعات (TAR)', desc: `نسبة الارتفاع (${pctTAR}%) تتخطى الحد الموصى به (<25%).`, rec: 'مراجعة حساب الكارب وضبط مواعيد الحقن قبل الوجبات بـ 15 دقيقة والتأكد من ملاءمة جرعة القاعدي.', conf: 'أهمية متوسطة', color: '#d97706' });
  if (pctTIR < 60 && pctTBR <= 15 && pctTAR <= 25) patt.push({ name: 'ضعف السيطرة (TIR)', desc: `نسبة البقاء في النطاق (${pctTIR}%) أقل من الهدف الدولي (70%).`, rec: 'مراجعة الروتين الغذائي وتدقيق معاملات الجرعات بدعم الفريق المعالج.', conf: 'أهمية متوسطة', color: '#0284c7' });

  const vals = valid.map(x => x.val);
  const mean = vals.reduce((a, b) => a + b, 0) / total;
  const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / total;
  const cv = (Math.sqrt(variance) / mean) * 100;
  if (cv > 36) {
    patt.push({ name: 'تذبذب عالي (Glycemic Variability)', desc: `السكر يتأرجح بشدة (CV: ${Math.round(cv)}%).`, rec: 'تثبيت مواعيد الوجبات، وتجنب الإفراط في تصحيح الهبوط، وإعطاء الأنسولين قبل الأكل بوقت كافٍ.', conf: 'أهمية عالية', color: '#b45309' });
  }

  let reboundCount = 0, weakCFCount = 0, stackingCount = 0;
  for (let i = 0; i < valid.length - 1; i++) {
    const curr = valid[i], next = valid[i + 1];
    const diffHours = (next.when - curr.when) / (1000 * 60 * 60);
    if (curr.val < L.low && next.val > L.high && diffHours <= 6) reboundCount++;
    if (curr.val > L.high && curr.ins > 0 && next.val > L.high && diffHours <= 4) weakCFCount++;
    if (curr.ins > 0 && next.ins > 0 && diffHours <= 3 && next.val < L.low) stackingCount++;
  }
  if (reboundCount >= 2) patt.push({ name: 'إفراط علاج الهبوط (Rebound)', desc: `تم رصد ارتداد عكسي بعد الهبوط ${reboundCount} مرات، مما يشير لاستهلاك سكريات سريعة أكثر من قاعدة 15.`, rec: 'الالتزام الصارم بـ "قاعدة 15" (15 جم كارب سريع والانتظار 15 دقيقة) وتجنب تناول كميات عشوائية.', conf: 'أهمية عالية', color: '#ea580c' });
  if (weakCFCount >= 3) patt.push({ name: 'ضعف معامل التصحيح (CF)', desc: `جرعات التصحيح لا تخفض السكر للمعدل الطبيعي بشكل ملحوظ في أوقات متكررة.`, rec: 'استشارة الطبيب لتحديث وتعديل معامل التصحيح CF وجعله أكثر فعالية.', conf: 'تنبيه سريري', color: '#2563eb' });
  if (stackingCount >= 1) patt.push({ name: 'تراكم الإنسولين (Insulin Stacking)', desc: `تم رصد جرعات إنسولين سريعة متقاربة (أقل من 3 ساعات) تلاها هبوط حاد.`, rec: 'احرص على مراعاة مدة عمل الإنسولين النشط (IOB) والانتظار 3 ساعات على الأقل قبل إعطاء جرعة تصحيحية جديدة.', conf: 'أهمية قصوى', color: '#dc2626' });

  const slotsData = {};
  valid.forEach(m => {
    if (!slotsData[m.slot]) slotsData[m.slot] = [];
    slotsData[m.slot].push(m.val);
  });
  for (let s in slotsData) {
    const sVals = slotsData[s];
    if (sVals.length >= 3) {
      const highPct = sVals.filter(v => v > L.high).length / sVals.length;
      const lowPct = sVals.filter(v => v < L.low).length / sVals.length;
      const slotName = SLOT_NAMES[s] || s;
      if (highPct >= 0.5) patt.push({ name: `ارتفاع متكرر (${slotName})`, desc: `السكر يرتفع بنسبة >50% في هذه الفترة المحددة (${slotName}).`, rec: `مراجعة جرعة الأنسولين أو كمية الكارب للوجبة السابقة لهذه الفترة.`, conf: 'نمط متكرر', color: '#d97706' });
      if (lowPct >= 0.4) patt.push({ name: `هبوط متكرر (${slotName})`, desc: `نمط هبوط متكرر في هذه الفترة (${slotName}).`, rec: `تقليل الجرعة المغطية لهذه الفترة أو إضافة وجبة خفيفة لتفادي الهبوط.`, conf: 'أهمية قصوى', color: '#dc2626' });
    }
  }

  if (!patt.length) patt.push({ name: '✅ استقرار ممتاز', desc: 'المؤشرات الحيوية وتوزيع الجرعات ضمن الحدود المطلوبة دولياً.', rec: 'استمر بنفس الخطة العلاجية والغذائية الممتازة.', conf: 'مستقر', color: '#16a34a' });

  const uniquePatt = Array.from(new Set(patt.map(p => JSON.stringify(p)))).map(str => JSON.parse(str));
  aiTable.innerHTML = `
    <div style="font-weight:bold; background:#f1f5f9; padding:8px; border-radius: 0 8px 0 0;">النمط</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">الوصف</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">التوصية الطبية والسبب المحتمل</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px; border-radius: 8px 0 0 0;">مستوى الأهمية</div>
  ` + uniquePatt.map(p => `
    <div style="font-weight:bold; color:${p.color}">${p.name}</div>
    <div style="font-size:13px;">${p.desc}</div>
    <div style="font-size:13px; color:#2563eb;">${p.rec}</div>
    <div style="font-size:13px; font-weight:bold; color:${p.color}">${p.conf}</div>
  `).join('');
}

async function exportCSV() {
  showLoader(true);
  try {
    const data = await fetchRange(fromDate.value, toDate.value);
    let csv = '\uFEFFالتاريخ,الوقت,الفترة,القراءة,الوحدة,كارب (جرام),إنسولين (وحدة),ملاحظات\n';
    data.forEach(d => {
      const time = d.when.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      const period = SLOT_LABEL[d.slot] || d.slot;
      const val = d.val !== null ? d.val : '';
      csv += `${d.date},${time},${period},${val},${unitSel.value},${d.carbs || 0},${d.ins || 0},"${(d.notes || '').replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Logbook_${fromDate.value}_to_${toDate.value}.csv`;
    link.click();
    toast("✅ تم تصدير ملف CSV بنجاح");
  } catch (e) { console.error(e); alert('خطأ في تصدير CSV'); }
  showLoader(false);
}

async function exportXLSX() {
  showLoader(true);
  try {
    const data = await fetchRange(fromDate.value, toDate.value);
    const exportData = data.map(d => ({
      "التاريخ": d.date,
      "الوقت": d.when.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      "الفترة": SLOT_LABEL[d.slot] || d.slot,
      "القراءة": d.val !== null ? d.val : '—',
      "الوحدة": unitSel.value,
      "كارب (g)": d.carbs || 0,
      "إنسولين (U)": d.ins || 0,
      "ملاحظات": d.notes || ''
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "اللوجبوك");
    XLSX.writeFile(wb, `Logbook_${fromDate.value}_to_${toDate.value}.xlsx`);
    toast("✅ تم تصدير ملف Excel بنجاح");
  } catch (e) { console.error(e); alert('حدث خطأ.'); }
  showLoader(false);
}

function exportPdf() {
  const node = document.querySelector('.container');
  const opt = { margin: 10, filename: `report-${fromDate.value}_${toDate.value}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } };
  window.html2pdf().from(node).set(opt).save();
}

// ============================================================
// نافذة تفاصيل القياس: القراءة + الأصناف + التصحيح + علاج الهبوط
// ============================================================
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const SLOT_FULL = {
  FASTING:'صائم / استيقاظ', WAKE:'استيقاظ', PRE_BREAKFAST:'قبل الفطار', POST_BREAKFAST:'بعد الفطار',
  PRE_LUNCH:'قبل الغداء', POST_LUNCH:'بعد الغداء', PRE_DINNER:'قبل العشاء', POST_DINNER:'بعد العشاء',
  SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم'
};
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function stateText(val, unit) {
  const L = limitsInUnit(unit);
  if (val >= L.critHigh) return 'ارتفاع حرج';
  if (val > L.high) return 'ارتفاع';
  if (val <= L.critLow) return 'هبوط حرج';
  if (val < L.low) return 'هبوط';
  return 'في النطاق';
}

function kv(icon, label, value, cls = '') {
  return `<div class="md-kv ${cls}"><span>${icon} ${label}</span><b>${value}</b></div>`;
}

function measurementCardHTML(v, unit, isLatest = false) {
  const x = v.raw || {};
  let time = x.time;
  if (!time && v.when instanceof Date && !isNaN(v.when.getTime())) {
    time = v.when.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }
  const method = x.measureMethod === 'sensor' ? '📡 حساس' : x.measureMethod === 'blood' ? '🩸 وخز' : '';
  const latestBadge = isLatest ? `<span style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">⚡ أحدث قياس مسجل</span>` : '';

  let html = `<div class="md-card ${isLatest ? 'is-latest' : ''}"><div class="md-card-head"><span class="md-time">🕒 ${esc(time || '—')}</span> <div style="display:flex; align-items:center; gap:6px;">${latestBadge}<span class="md-method">${method}</span></div></div>`;
  if (v.val !== null) {
    html += `<div class="md-bg-row"><span class="md-bg ${classFor(v.val, unit)}">${esc(v.val)} <small>${esc(unit)}</small></span><span class="md-state">${stateText(v.val, unit)}</span></div>`;
  }

  if (x.hypoTreatment) html += `<div class="md-box md-hypo"><b>🧃 علاج الهبوط</b><div>${esc(x.hypoTreatment)}</div></div>`;

  const carbDose = num(x.carbDose), corr = num(x.correctionDose), earlier = num(x.earlierCorrectionDose);
  const total = num(x.totalDose ?? x.totalInsulin ?? x.dose), iob = num(x.iobUsed);
  const isMeal = !!(x.mealSaved || num(x.carbs) > 0 || carbDose > 0);
  let doses = '';
  if (isMeal) {
    if (carbDose > 0) doses += kv('🍽️', 'جرعة الأكل', `${round1(carbDose)} U`);
    if (corr > 0) doses += kv('💧', 'جرعة تصحيح', `${round1(corr)} U`, 'is-corr');
  } else if (corr > 0) {
    doses += kv('💧', 'جرعة تصحيح', `${round1(corr)} U`, 'is-corr');
  }
  if (earlier > 0) doses += kv('💧', 'تصحيح سابق (قبل الوجبة)', `${round1(earlier)} U`, 'is-corr');
  if (iob > 0) doses += kv('⏳', 'أنسولين نشط تم خصمه', `${round1(iob)} U`);
  if (total > 0) doses += kv('⚡', 'إجمالي الجرعة', `${round1(total)} U`, 'is-total');
  if (x.doseOverridden && x.suggestedDose != null && Math.abs(num(x.totalDose) - num(x.suggestedDose)) > 1e-9) {
    doses += kv('✏️', 'عُدّلت يدوياً — المقترح كان', `${round1(num(x.suggestedDose))} U`, 'is-warn');
  }
  if (doses) html += `<div class="md-box">${doses}</div>`;

  const items = Array.isArray(x.mealItemsRef) ? x.mealItemsRef : [];
  if (items.length) {
    html += `<div class="md-box"><b>🍔 الأصناف المختارة</b><table class="md-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>كارب صافي</th></tr></thead><tbody>` +
      items.map(it => {
        const q = [it.qty, it.unit].filter(z => z !== undefined && z !== null && z !== '').join(' ');
        const net = it.netCarb_g != null ? `${round1(it.netCarb_g)}g` : '—';
        return `<tr><td>${esc(it.name)}</td><td>${esc(q)}</td><td>${net}</td></tr>`;
      }).join('') + `</tbody></table></div>`;
  }
  if (num(x.carbs) > 0 || num(x.calories) > 0) {
    let chips = '';
    if (num(x.carbs) > 0) chips += `<span class="md-chip">كارب ${round1(num(x.carbs))}g</span>`;
    if (num(x.calories) > 0) chips += `<span class="md-chip">${Math.round(num(x.calories))} kcal</span>`;
    if (num(x.protein) > 0) chips += `<span class="md-chip">بروتين ${round1(num(x.protein))}g</span>`;
    if (num(x.fat) > 0) chips += `<span class="md-chip">دهون ${round1(num(x.fat))}g</span>`;
    if (num(x.fiber) > 0) chips += `<span class="md-chip">ألياف ${round1(num(x.fiber))}g</span>`;
    html += `<div class="md-chips">${chips}</div>`;
    if (!items.length) html += `<div class="md-muted">الكارب مُدخل يدوياً بدون أصناف من المكتبة.</div>`;
  }

  if (!doses && !items.length && !x.hypoTreatment && !(num(x.carbs) > 0)) {
    html += `<div class="md-muted">لا توجد وجبة أو جرعة أو علاج مسجل لهذا القياس.</div>`;
  }
  if (x.notes) html += `<div class="md-notes">📝 ${esc(x.notes)}</div>`;
  return html + `</div>`;
}

function detailHTML(day, slot, unit) {
  const list = (day && day.slots[slot]) || [];
  const sorted = [...list].sort((a, b) => {
    const tA = a.when instanceof Date ? a.when.getTime() : (a.when ? new Date(a.when).getTime() : 0);
    const tB = b.when instanceof Date ? b.when.getTime() : (b.when ? new Date(b.when).getTime() : 0);
    return tB - tA;
  });
  return {
    title: SLOT_FULL[slot] || esc(slot),
    sub: `${formatDate(day.date)}${sorted.length > 1 ? ` — مكتبة القياسات المسجلة (${sorted.length} قياسات)` : ''}`,
    body: sorted.map((v, idx) => measurementCardHTML(v, unit, idx === 0 && sorted.length > 1)).join('')
  };
}

function ensureModal() {
  let m = $('mDetailModal'); if (m) return m;
  m = document.createElement('div');
  m.id = 'mDetailModal'; m.className = 'md-overlay hidden';
  m.innerHTML = `
    <div class="md-sheet" role="dialog" aria-modal="true" aria-labelledby="mdTitle">
      <div class="md-head">
        <div><div id="mdTitle" class="md-title"></div><div id="mdSub" class="md-sub"></div></div>
        <button type="button" class="md-close" aria-label="إغلاق">✕</button>
      </div>
      <div id="mdBody" class="md-body"></div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m || e.target.closest('.md-close')) closeDetail(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
  return m;
}

let _lastFocus = null;
function openDetail(dayKey, slot) {
  const day = reportDays.find(d => d.key === dayKey);
  if (!day || !day.slots[slot]) return;
  const m = ensureModal();
  const d = detailHTML(day, slot, unitSel.value);
  $('mdTitle').textContent = d.title;
  $('mdSub').textContent = d.sub;
  $('mdBody').innerHTML = d.body;
  _lastFocus = document.activeElement;
  m.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  m.querySelector('.md-close').focus();
}

function closeDetail() {
  const m = $('mDetailModal'); if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  document.body.style.overflow = '';
  if (_lastFocus && _lastFocus.focus) _lastFocus.focus();
}
