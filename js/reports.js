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

  $('openPrint').onclick = () => window.open(`reports-print.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}`, '_blank'); $('openPrintBlank').onclick = () => window.open(`reports-print.html?child=${encodeURIComponent(childId)}&parentId=${encodeURIComponent(parentIdForQuery)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}&blank=1`, '_blank');
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

const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;  function setQuickRange(range) { const to = new Date(); const from = new Date(); if (range === '1w') from.setDate(from.getDate() - 7); else if (range === '2w') from.setDate(from.getDate() - 14); else if (range === '1m') from.setMonth(from.getMonth() - 1); else if (range === '3m') from.setMonth(from.getMonth() - 3);  $('toDate').value = isoLocal(to); $('fromDate').value = isoLocal(from); cmpElems.AFrom.value = $('fromDate').value; cmpElems.ATo.value = $('toDate').value;  const diffTime = Math.abs(to - from); const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1); const prevFrom = new Date(prevTo.getTime() - diffTime); cmpElems.BFrom.value = isoLocal(prevFrom); cmpElems.BTo.value = isoLocal(prevTo); }  async function loadChild(parentId) { childRef = doc(db, 'parents', parentId, 'children', childId); let snap = await getDoc(childRef);  if (!snap.exists() && parentId !== currentUser?.uid) { const fallbackRef = doc(db, 'parents', currentUser.uid, 'children', childId); const fallbackSnap = await getDoc(fallbackRef); if (fallbackSnap.exists()) { childRef = fallbackRef; snap = fallbackSnap; parentIdForQuery = currentUser.uid; localStorage.setItem('selectedParentId', currentUser.uid); } }  // مسار احتياطي للطبيب عبر سجل مرضى العيادة if (!snap.exists()) { try { const docPatSnap = await getDoc(doc(db, `doctors/${currentUser.uid}/patients/${childId}`)); if (docPatSnap.exists() && docPatSnap.data()?.parentId) { parentIdForQuery = docPatSnap.data().parentId; childRef = doc(db, 'parents', parentIdForQuery, 'children', childId); snap = await getDoc(childRef); } } catch (e) {} }  if (!snap.exists()) throw new Error('child-not-found'); child = snap.data();  sysUnit = child.glucoseUnit \vert{}\vert{} 'mg/dL'; if (child.glucose_limits) { sysLimits.low = Number(child.glucose_limits.low) \vert{}\vert{} (sysUnit === 'mmol/L' ? 3.9 : 70); sysLimits.high = Number(child.glucose_limits.high) \vert{}\vert{} (sysUnit === 'mmol/L' ? 10.0 : 180); sysLimits.critLow = Number(child.glucose_limits.critical_low) \vert{}\vert{} (sysUnit === 'mmol/L' ? 3.0 : 54); sysLimits.critHigh = Number(child.glucose_limits.critical_high) \vert{}\vert{} (sysUnit === 'mmol/L' ? 13.9 : 250); } else if (sysUnit === 'mmol/L') { sysLimits = { critLow: 3.0, low: 3.9, high: 10.0, critHigh: 13.9 }; }  const isDoc = parentIdForQuery !== currentUser?.uid; const qParams = childId ? `?child=${encodeURIComponent(childId)}${isDoc ? `&parentId=${encodeURIComponent(parentIdForQuery)}` : ''}` : '';  $('navHome')?.setAttribute('href', `child.html${qParams}`);
  $('navMeas')?.setAttribute('href', `measurements.html${qParams}`); $('navMeals')?.setAttribute('href', `meals.html${qParams}`);
  $('navLabs')?.setAttribute('href', `labs.html${qParams}`); $('navVisits')?.setAttribute('href', `visits.html${qParams}`);
  $('breadChildName')?.setAttribute('href', isDoc ? `doctor-child.html${qParams}` : `child.html${qParams}`);

  setText($('breadChildName'), child.name || 'الطفل');
  setText($('topChildName'), child.name || 'الطفل');
  if ($('topAvatar')) $('topAvatar').textContent = (child.name || 'أ').trim().charAt(0);

  const age = calcAge(child.birthDate);
  const genderStr = child.gender === 'female' ? 'أنثى' : (child.gender === 'male' ? 'ذكر' : '');
  const regimenStr = child.regimen === 'pump' ? 'مضخة إنسولين' : 'حقن يومية (MDI)';
  const metaParts = [];
  if (age !== '-') metaParts.push(`العمر: ${age} سنة`); if (genderStr) metaParts.push(genderStr); if (regimenStr) metaParts.push(regimenStr); setText($('topChildMeta'), metaParts.join(' • ') \vert{}\vert{} '—');  try { const labQ = query(collection(db, `parents/${parentIdForQuery}/children/${childId}/labs`), orderBy('when', 'desc'), limit(1)); const labSnap = await getDocs(labQ); if (!labSnap.empty) { const lastLab = labSnap.docs[0].data(); if (lastLab?.hba1c?.value != null && !Number.isNaN(Number(lastLab.hba1c.value))) { lastLabHba1cVal = Number(lastLab.hba1c.value); const when = lastLab.when?.toDate ? lastLab.when.toDate() : (lastLab.date ? new Date(lastLab.date) : null); const dateStr = when ? when.toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' }) : ''; setText($('statLastLab'), `${lastLabHba1cVal.toFixed(1)}% ${dateStr ? `(${dateStr})` : ''}`); } else { setText($('statLastLab'), '—'); } } else { setText($('statLastLab'), 'لا توجد تحاليل'); } } catch (err) { console.warn('Could not fetch last lab:', err); setText($('statLastLab'), '—'); } }  function limitsInUnit(targetUnit) { if (targetUnit === sysUnit) return { ...sysLimits }; if (targetUnit === 'mmol/L' && sysUnit === 'mg/dL') { return { critLow: round1(mgdl2mmol(sysLimits.critLow)), low: round1(mgdl2mmol(sysLimits.low)), high: round1(mgdl2mmol(sysLimits.high)), critHigh: round1(mgdl2mmol(sysLimits.critHigh)) }; } if (targetUnit === 'mg/dL' && sysUnit === 'mmol/L') { return { critLow: Math.round(mmol2mgdl(sysLimits.critLow)), low: Math.round(mmol2mgdl(sysLimits.low)), high: Math.round(mmol2mgdl(sysLimits.high)), critHigh: Math.round(mmol2mgdl(sysLimits.critHigh)) }; } return { ...sysLimits }; }  function fillThresholdChips() { const u = unitSel.value; const L = limitsInUnit(u); if ($('statTIRRangeSub')) $('statTIRRangeSub').textContent = `${L.low} - ${L.high}${u}`;
  $('thresholdChips').innerHTML = `
    <span class="chip">هبوط حرج: <b>&lt; ${L.critLow}${u}</b></span>
    <span class="chip">هبوط: <b>&lt; ${L.low}${u}</b></span>
    <span class="chip">النطاق الطبيعي:
