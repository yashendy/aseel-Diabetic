// js/reports-print.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { MGDL_PER_MMOL, STANDARD_LIMITS, getProtocol, normalizeUnit } from './child-protocol.js';

// حقن التنسيق المعتمد لمنصة أسيل تلقائياً داخل الصفحة لضمان ظهوره دائماً بدون مشاكل مسارات أو كاش
(function injectPrintStyles() {
  if (document.getElementById('aseelPrintStyles')) return;
  const style = document.createElement('style');
  style.id = 'aseelPrintStyles';
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    :root {
      --brand-dark: #1e3a8a;
      --brand-primary: #2563eb;
      --brand-light: #eff6ff;
      --brand-border: #bfdbfe;
      --text-main: #0f172a;
      --text-muted: #475569;
      --border: #cbd5e1;
      --bg-alt: #f8fafc;
      --ok-bg: #dcfce7; --ok-text: #166534; --ok-border: #86efac;
      --mild-bg: #fef3c7; --mild-text: #92400e; --mild-border: #fcd34d;
      --sev-bg: #dbeafe; --sev-text: #1e40af; --sev-border: #93c5fd;
      --crit-bg: #fee2e2; --crit-text: #991b1b; --crit-border: #fca5a5;
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @page { size: A4 landscape; margin: 8mm; }
    body { margin: 0; font-family: 'Cairo', system-ui, -apple-system, sans-serif; color: var(--text-main); background: #e2e8f0; direction: rtl; }

    /* شريط الأدوات العلوي للشاشة */
    .screen-toolbar { position: sticky; top: 0; z-index: 50; background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); color: #fff; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 15px rgba(15, 23, 42, 0.25); }
    .st-right { display: flex; align-items: center; gap: 12px; font-size: 15px; }
    .st-badge { background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.25); padding: 3px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: #e0f2fe; }
    .st-actions { display: flex; gap: 10px; }
    .st-btn { font-family: inherit; font-size: 13px; font-weight: 700; padding: 7px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.1); color: #fff; cursor: pointer; }
    .st-btn.primary { background: #10b981; border-color: #059669; color: #fff; }

    /* صفحات التقرير A4 */
    #printContainer { max-width: 285mm; margin: 18px auto; display: flex; flex-direction: column; gap: 20px; }
    .print-page { background: #ffffff; width: 100%; min-height: 192mm; padding: 8mm 10mm; border-radius: 12px; box-shadow: 0 6px 24px rgba(15, 23, 42, 0.12); position: relative; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; break-after: page; }
    .print-page:last-child { page-break-after: auto; break-after: auto; }

    /* الهيدر */
    .header { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: linear-gradient(90deg, #eff6ff 0%, #f8fafc 60%, #eff6ff 100%); border: 1.5px solid var(--brand-border); border-right: 6px solid var(--brand-primary); border-radius: 10px; padding: 9px 14px; margin-bottom: 10px; }
    .header-right h2 { margin: 0 0 3px 0; color: var(--brand-dark); font-size: 16px; font-weight: 800; }
    .header-right .muted { font-size: 11px; color: var(--text-muted); }
    .header-left { text-align: right; font-size: 11px; line-height: 1.65; background: #ffffff; padding: 6px 12px; border-radius: 8px; border: 1px solid #e2e8f0; color: var(--text-main); }
    .header-left b { color: var(--brand-dark); }

    /* الجدول الأسبوعي */
    .grid-wrap { border: 1.5px solid #94a3b8; border-radius: 10px; overflow: hidden; background: #fff; }
    .grid-head, .grid-row { display: grid; grid-template-columns: 92px 86px repeat(10, 1fr); font-size: 11px; }
    .grid-head { background: linear-gradient(180deg, #1e3a8a 0%, #1d4ed8 100%); color: #ffffff; font-weight: 700; border-bottom: 1.5px solid #1e3a8a; }
    .grid-head > div { padding: 7px 3px; border-inline-start: 1px solid rgba(255, 255, 255, 0.18); text-align: center; font-size: 10.5px; display: flex; align-items: center; justify-content: center; }
    .grid-head > div:first-child, .grid-row > .cell:first-child { border-inline-start: none; }
    .grid-row { border-bottom: 1px solid var(--border); min-height: 47px; }
    .grid-row:last-child { border-bottom: none; }
    .grid-row:nth-child(even) { background: var(--bg-alt); }
    .cell { padding: 4px 3px; border-inline-start: 1px solid var(--border); text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .grid-row > .cell:first-child { background: #f1f5f9; font-size: 11px; line-height: 1.25; }
    .grid-row > .cell:first-child b { color: var(--brand-dark); font-size: 11px; direction: ltr; }

    /* خلايا القراءات */
    .v-cell { gap: 2px; padding: 3px; }
    .val { font-weight: 800; font-size: 12.5px; padding: 1px 6px; border-radius: 6px; width: 92%; line-height: 1.3; border: 1px solid transparent; }
    .val.ok { background: var(--ok-bg); color: var(--ok-text); border-color: var(--ok-border); }
    .val.mild { background: var(--mild-bg); color: var(--mild-text); border-color: var(--mild-border); }
    .val.sev { background: var(--sev-bg); color: var(--sev-text); border-color: var(--sev-border); }
    .val.crit { background: var(--crit-bg); color: var(--crit-text); border-color: var(--crit-border); }
    .c-badge { font-size: 9.5px; font-weight: 700; color: #6d28d9; background: #f3e8ff; padding: 0 5px; border-radius: 4px; }
    .i-badge { font-size: 9.5px; font-weight: 800; color: #b91c1c; background: #fee2e2; padding: 0 5px; border-radius: 4px; }

    /* السجل اليدوي الفارغ + الشريط التوضيحي */
    .blank-guide { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: space-between; padding: 2px 6px; }
    .blank-line { border-bottom: 1px dashed #94a3b8; height: 17px; width: 100%; }
    .blank-sub { display: flex; justify-content: space-between; width: 100%; padding-top: 3px; font-size: 9.5px; font-weight: 700; color: #64748b; }
    .print-legend { margin-top: 8px; padding: 6px 12px; background: #f8fafc; border: 1px solid #cbd5e1; border-right: 4px solid var(--brand-primary); border-radius: 8px; font-size: 10px; line-height: 1.6; color: #334155; display: flex; flex-direction: column; gap: 3px; }
    .print-legend-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .print-legend b { color: var(--brand-dark); }

    /* صفحة الملخص السريري AGP */
    .agp-metrics-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; border: 1.5px solid #94a3b8; border-radius: 8px; overflow: hidden; }
    .agp-metrics-table th, .agp-metrics-table td { border: 1px solid #cbd5e1; padding: 4.5px 8px; text-align: center; }
    .agp-metrics-table td:first-child { text-align: right; background: #f8fafc; }
    .agp-metrics-table th { background: linear-gradient(180deg, #1e3a8a 0%, #1d4ed8 100%); color: #ffffff; font-weight: 700; }
    .agp-metrics-table .highlight-green { background: var(--ok-bg); color: var(--ok-text); font-weight: 800; }
    .agp-metrics-table .highlight-red { background: var(--crit-bg); color: var(--crit-text); font-weight: 800; }
    .agp-metrics-table .highlight-amber { background: var(--mild-bg); color: var(--mild-text); font-weight: 800; }
    .agp-metrics-table .highlight-blue { background: var(--brand-light); color: var(--brand-dark); font-weight: 800; }

    .summary-grid-layout { display: grid; grid-template-columns: 240px 1fr; gap: 12px; align-items: stretch; margin-bottom: 8px; }
    .chart-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; text-align: center; }
    .range-pills { width: 100%; display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
    .rp-item { display: flex; justify-content: space-between; align-items: center; padding: 3px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 700; }
    .rp-item.ok { background: var(--ok-bg); color: var(--ok-text); border: 1px solid var(--ok-border); }
    .rp-item.high { background: var(--mild-bg); color: var(--mild-text); border: 1px solid var(--mild-border); }
    .rp-item.low { background: var(--crit-bg); color: var(--crit-text); border: 1px solid var(--crit-border); }

    .ai-box { background: #ffffff; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--brand-border); display: flex; flex-direction: column; justify-content: space-between; }
    .ai-smart-report-content { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ai-pattern-row { padding: 6px 9px; border-radius: 8px; border: 1px solid #e2e8f0; border-right-width: 4px; background: #f8fafc; }
    .ai-pattern-row.crit { background: #fff1f2; border-color: #fecdd3; border-right-color: #dc2626; }
    .ai-pattern-row.warn { background: #fffbeb; border-color: #fde68a; border-right-color: #d97706; }
    .ai-pattern-row.good { background: #f0fdf4; border-color: #bbf7d0; border-right-color: #16a34a; }

    .doctor-sign-row { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 8px; padding: 8px 12px; background: #f8fafc; border: 1px dashed #94a3b8; border-radius: 8px; font-size: 11px; page-break-inside: avoid; }
    .footer { width: 100%; font-size: 9.5px; font-weight: 600; color: #64748b; text-align: center; padding-top: 5px; border-top: 1px solid #e2e8f0; margin-top: 6px; }
    .print-loader { position: fixed; inset: 0; background: rgba(255, 255, 255, 0.95); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 100; font-weight: 700; color: var(--brand-dark); }
    .spinner { width: 34px; height: 34px; border: 3.5px solid #dbeafe; border-top: 3.5px solid var(--brand-primary); border-radius: 50%; animation: spin 0.9s linear infinite; margin-bottom: 10px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

    @media print {
      body { background: #ffffff !important; }
      .no-print, .screen-toolbar, .print-loader { display: none !important; }
      #printContainer { max-width: none; margin: 0; gap: 0; }
      .print-page { box-shadow: none; border-radius: 0; padding: 2mm 4mm; min-height: 190mm; }
    }
  `;
  document.head.appendChild(style);
})();

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId') || localStorage.getItem('lastChildId');
const parentIdParam = params.get('parentId');
const fromDateParam = params.get('from');
const toDateParam = params.get('to');
const isBlank = params.get('blank') === '1';
const urlUnit = params.get('unit');

const SLOT_KEYS = ['FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP'];
const SLOT_LABELS = ['صائم/استيقاظ','ق.الفطار','ب.الفطار','ق.الغداء','ب.الغداء','ق.العشاء','ب.العشاء','سناك','ق.النوم','أثناء النوم'];

const mgdl2mmol = v => v / MGDL_PER_MMOL;
const mmol2mgdl = v => v * MGDL_PER_MMOL;
const round1 = n => Math.round((+n || 0) * 10) / 10;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calcAge(bd) {
  if (!bd) return '—';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return Math.max(0, a);
}

let sysLimits = { critLow: 54, low: 70, high: 180, critHigh: 250 };
let sysUnit = 'mg/dL';
let childProto = null;

function limitsInUnit(targetUnit) {
  if (targetUnit === sysUnit) return { ...sysLimits };
  if (childProto && !childProto.limitsCustom && STANDARD_LIMITS[targetUnit]) {
    const std = STANDARD_LIMITS[targetUnit];
    return {
      critLow: std.critical_low,
      low: std.low,
      high: std.high,
      critHigh: std.critical_high
    };
  }
  if (targetUnit === 'mmol/L' && sysUnit === 'mg/dL') {
    return {
      critLow: round1(mgdl2mmol(sysLimits.critLow)),
      low: round1(mgdl2mmol(sysLimits.low)),
      high: round1(mgdl2mmol(sysLimits.high)),
      critHigh: round1(mgdl2mmol(sysLimits.critHigh))
    };
  }
  if (targetUnit === 'mg/dL' && sysUnit === 'mmol/L') {
    return {
      critLow: Math.round(mmol2mgdl(sysLimits.critLow)),
      low: Math.round(mmol2mgdl(sysLimits.low)),
      high: Math.round(mmol2mgdl(sysLimits.high)),
      critHigh: Math.round(mmol2mgdl(sysLimits.critHigh))
    };
  }
  return { ...sysLimits };
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

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = 'index.html'; return; }
  const container = document.getElementById('printContainer');
  const modeLabel = document.getElementById('printModeLabel');
  if (modeLabel) {
    modeLabel.textContent = isBlank ? '📝 سجل فارغ للكتابة اليدوية' : '📊 تقرير مليء بالقياسات + الملخص السريري الذكي';
  }

  try {
    let parentId = parentIdParam || localStorage.getItem('selectedParentId') || user.uid;
    let childRef = doc(db, `parents/${parentId}/children/${childId}`);
    let childSnap = await getDoc(childRef);

    if (!childSnap.exists() && parentId !== user.uid) {
      childRef = doc(db, `parents/${user.uid}/children/${childId}`);
      childSnap = await getDoc(childRef);
      if (childSnap.exists()) parentId = user.uid;
    }

    if (!childSnap.exists()) {
      alert('تعذر العثور على ملف الطفل للطباعة.');
      return;
    }

    const childData = childSnap.data();
    childProto = getProtocol(childData);
    sysUnit = childProto.unit;
    sysLimits = {
      critLow: childProto.limits.critical_low,
      low: childProto.limits.low,
      high: childProto.limits.high,
      critHigh: childProto.limits.critical_high
    };

    const displayUnit = normalizeUnit(urlUnit) || sysUnit;

    const today = new Date();
    const defaultFrom = new Date();
    defaultFrom.setDate(today.getDate() - 6);
    const fromDate = fromDateParam || localDateISO(defaultFrom);
    const toDate = toDateParam || localDateISO(today);

    let data = [];
    const basalMap = {};

    if (!isBlank) {
      const [measSnap, basalSnap] = await Promise.all([
        getDocs(query(collection(childRef, 'measurements'), where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'asc'))),
        getDocs(collection(db, `parents/${parentId}/children/${childId}/basalLogs`)).catch(() => null)
      ]);

      measSnap.forEach(d => {
        const x = d.data();
        let v = displayUnit.includes('mmol')
          ? (x.value_mmol ?? (x.unit === 'mg/dL' ? mgdl2mmol(x.value) : x.value))
          : (x.value_mgdl ?? (x.unit === 'mmol/L' ? mmol2mgdl(x.value) : x.value));
        x.displayValue = Number.isFinite(+v) ? round1(+v) : null;
        x.normalizedSlot = (x.slotKey === 'WAKE' || x.slot === 'WAKE') ? 'FASTING' : (x.slotKey || x.slot || 'OTHER');
        data.push(x);
      });

      if (basalSnap) {
        basalSnap.forEach(d => {
          const dt = d.data();
          const k = dt.date || d.id;
          if (k >= fromDate && k <= toDate && dt.taken !== false) {
            basalMap[k] = Number(dt.dose) || 0;
          }
        });
      }
    }

    const weeks = isBlank ? [buildBlankSevenDays()] : chunkIntoWeeks(fromDate, toDate);
    const allDates = weeks.flat();
    const totalPagesCount = isBlank ? weeks.length : (weeks.length + 1);

    weeks.forEach((weekDays, index) => {
      const page = createPageStructure(childData, weekDays[0], weekDays[weekDays.length - 1], index + 1, totalPagesCount, displayUnit);
      const grid = page.querySelector('.grid-body');

      weekDays.forEach(dateStr => {
        const dayData = data.filter(d => d.date === dateStr);
        grid.appendChild(createDayRow(dateStr, dayData, childData, displayUnit, basalMap));
      });

      container.appendChild(page);
    });

    if (!isBlank) {
      const summaryPage = createSummaryPage(childData, data, displayUnit, basalMap, allDates, totalPagesCount, fromDate, toDate);
      container.appendChild(summaryPage);
      renderSummaryPieChart(summaryPage, data, displayUnit);
      renderSmartChildReport(summaryPage, data, displayUnit, childData, basalMap, allDates);
    }

    document.getElementById('appLoader').style.display = 'none';
    setTimeout(() => window.print(), 450);
  } catch (e) {
    console.error('Print error:', e);
    alert('حدث خطأ أثناء تجهيز التقرير للطباعة.');
  }
});

function buildBlankSevenDays() {
  const arr = [];
  const curr = new Date();
  for (let i = 0; i < 7; i++) {
    arr.push(localDateISO(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return arr;
}

function chunkIntoWeeks(start, end) {
  const days = [];
  const curr = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (curr <= last) {
    days.push(localDateISO(curr));
    curr.setDate(curr.getDate() + 1);
  }
  if (!days.length) days.push(localDateISO(new Date()));
  const chunks = [];
  for (let i = 0; i < days.length; i += 7) {
    chunks.push(days.slice(i, i + 7));
  }
  return chunks;
}

function createPageStructure(child, start, end, pageNum, totalPages, displayUnit) {
  const div = document.createElement('div');
  div.className = 'print-page';
  const p = childProto || getProtocol(child);
  const cf = p.CF ?? '—';
  const crObj = p.CR || {};
  const crStr = (crObj.breakfast || crObj.lunch || crObj.dinner || crObj.snack)
    ? `فطار: ${crObj.breakfast || '-'} / غداء: ${crObj.lunch || '-'} / عشاء: ${crObj.dinner || '-'}${crObj.snack ? ` / سناك: ${crObj.snack}` : ''}`
    : '—';
  const basalDose = p.insulin.basalDose != null ? `${p.insulin.basalDose} وحدة (U)` : '—';
  const docName = child.assignedDoctorInfo?.name || '—';
  const childName = child.identity?.name || child.name || '—';
  const dob = child.identity?.dob || child.birthDate;
  const L = limitsInUnit(displayUnit);

  const legendHtml = isBlank
    ? `<div class="print-legend">
         <div class="print-legend-row">
           <span>📌 <b>دليل التسجيل اليدوي داخل المربعات:</b></span>
           <span><b>الخط العلوي المنقط (........):</b> قراءة السكر (${esc(displayUnit)})</span>
           <span>•</span>
           <span><b>ك:</b> كمية الكارب بالجرام (g)</span>
           <span>•</span>
           <span><b>ج:</b> جرعة الأنسولين السريع بالوحدات (U)</span>
           <span>•</span>
           <span><b>النطاق المستهدف للطفل:</b> ${L.low} – ${L.high} ${esc(displayUnit)}</span>
         </div>
         <div class="print-legend-row">
           <span>📖 <b>شرح رموز الجدول والملف الطبي:</b></span>
           <span><b>ق.</b> = قبل الوجبة</span>
           <span>•</span>
           <span><b>ب.</b> = بعد الوجبة بساعتين</span>
           <span>•</span>
           <span><b>CR (معامل الكارب):</b> جرامات الكارب لكل 1 وحدة أنسولين</span>
           <span>•</span>
           <span><b>CF (معامل التصحيح):</b> مقدار انخفاض السكر (${esc(displayUnit)}) لكل 1 وحدة أنسولين</span>
           <span>•</span>
           <span><b>U:</b> وحدة أنسولين</span>
         </div>
       </div>`
    : `<div class="print-legend">
         <div class="print-legend-row">
           <span>📌 <b>دليل الألوان والرموز:</b></span>
           <span>🟢 <b>أخضر:</b> في النطاق (${L.low}–${L.high} ${esc(displayUnit)})</span>
           <span>🟠 <b>كهرماني:</b> ارتفاع (&gt; ${L.high})</span>
           <span>🔵 <b>أزرق:</b> هبوط (&lt; ${L.low})</span>
           <span>🔴 <b>أحمر:</b> حرج (&lt; ${L.critLow} أو &gt; ${L.critHigh})</span>
           <span>•</span>
           <span>🍔 <b>جرامات الكارب (g)</b></span>
           <span>•</span>
           <span>💉 <b>جرعة الأنسولين السريع (U)</b></span>
           <span>•</span>
           <span>⚡ <b>إجمالي أنسولين اليوم (ق=قاعدي | س=سريع)</b></span>
         </div>
         <div class="print-legend-row">
           <span>📖 <b>شرح اختصارات الجدول والملف الطبي:</b></span>
           <span><b>ق.</b> = قبل الوجبة</span>
           <span>•</span>
           <span><b>ب.</b> = بعد الوجبة بساعتين</span>
           <span>•</span>
           <span><b>CR (معامل الكارب):</b> جرامات الكارب لكل 1 وحدة أنسولين</span>
           <span>•</span>
           <span><b>CF (معامل التصحيح):</b> مقدار انخفاض السكر (${esc(displayUnit)}) لكل 1 وحدة أنسولين</span>
           <span>•</span>
           <span><b>U:</b> وحدة أنسولين</span>
         </div>
       </div>`;

  div.innerHTML = `
    <div>
      <header class="header">
        <div class="header-right">
          <h2>منصة أسيل — سجل المتابعة اليومي لسكري الأطفال ${isBlank ? '(سجل يدوي فارغ 📝)' : '(تقرير القياسات والوجبات 📊)'}</h2>
          <div class="muted">الفترة: من <b>${esc(start)}</b> إلى <b>${esc(end)}</b> • الطبيب المتابع: <b>${esc(docName)}</b></div>
        </div>
        <div class="header-left">
          <b>اسم الطفل:</b> ${esc(childName)} (${calcAge(dob)} سنة) | <b>وحدة القياس:</b> ${esc(displayUnit)} | <b>القاعدي اليومي:</b> ${esc(basalDose)}<br>
          <b>معامل الكارب (CR):</b> ${esc(crStr)} | <b>معامل التصحيح (CF):</b> ${esc(cf)}
        </div>
      </header>
      <div class="grid-wrap">
        <div class="grid-head">
          <div>التاريخ / اليوم</div>
          <div>إجمالي اليوم</div>
          ${SLOT_LABELS.map(l => `<div>${l}</div>`).join('')}
        </div>
        <div class="grid-body"></div>
      </div>
      ${legendHtml}
    </div>
    <div class="footer">صفحة ${pageNum} من ${totalPages} — تم الإنشاء بواسطة منصة أسيل الطبية لمتابعة سكري الأطفال</div>
  `;
  return div;
}

function createDayRow(dateStr, dayData, child, displayUnit, basalMap = {}) {
  const row = document.createElement('div');
  row.className = 'grid-row';
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = d.toLocaleDateString('ar-EG', { weekday: 'short' });

  let dailyCarbs = 0, dailyBolus = 0;
  dayData.forEach(m => {
    dailyCarbs += Number(m.carbs) || 0;
    dailyBolus += Number(m.totalInsulin || m.correctionDose || m.totalDose || m.dose) || 0;
  });

  const p = childProto || getProtocol(child);
  const defaultBasal = p.insulin.basalDose || 0;
  const dailyBasal = basalMap[dateStr] != null ? basalMap[dateStr] : defaultBasal;
  const dailyTDD = round1(dailyBasal + dailyBolus);

  let html = `<div class="cell"><b>${esc(dateStr)}</b><small style="color:#475569">${esc(dayName)}</small></div>`;

  if (isBlank) {
    html += `<div class="cell" style="background:#f8fafc; font-size:9.5px; color:#64748b; line-height:1.6;">كارب: .........<br>قاعدي: .........</div>`;
  } else if (dailyCarbs > 0 || dailyTDD > 0 || dailyBolus > 0) {
    html += `<div class="cell" style="background:#f8fafc; font-size:10px; line-height:1.25;">
      ${dailyCarbs > 0 ? `<div style="color:#6d28d9; font-weight:700;">🍔 ${round1(dailyCarbs)}g</div>` : ''}
      ${dailyTDD > 0 ? `
        <div style="color:#047857; font-weight:800;">⚡ ${round1(dailyTDD)}U</div>
        <div style="font-size:8.5px; color:#64748b;">ق:${round1(dailyBasal)} | س:${round1(dailyBolus)}</div>
      ` : ''}
    </div>`;
  } else {
    html += `<div class="cell" style="background:#f8fafc; color:#cbd5e1;">—</div>`;
  }

  SLOT_KEYS.forEach(key => {
    if (isBlank) {
      html += `<div class="cell">
        <div class="blank-guide">
          <div class="blank-line" title="قراءة السكر"></div>
          <div class="blank-sub">
            <span>ك:</span><span>ج:</span>
          </div>
        </div>
      </div>`;
      return;
    }

    const matches = dayData.filter(item => item.normalizedSlot === key);
    matches.sort((a, b) => {
      const tA = a.when?.toDate ? a.when.toDate().getTime() : (a.when ? new Date(a.when).getTime() : 0);
      const tB = b.when?.toDate ? b.when.toDate().getTime() : (b.when ? new Date(b.when).getTime() : 0);
      return tA - tB;
    });

    const m = matches.length ? matches[matches.length - 1] : null;
    const ins = m ? Number(m.totalInsulin || m.correctionDose || m.totalDose || m.dose || 0) : 0;
    const carbs = m ? Number(m.carbs || 0) : 0;

    html += `<div class="cell v-cell">
      ${m ? `
        ${m.displayValue !== null ? `<div class="val ${classFor(m.displayValue, displayUnit)}">${m.displayValue}</div>` : ''}
        ${carbs > 0 ? `<span class="c-badge">🍔 ${round1(carbs)}g</span>` : ''}
        ${ins > 0 ? `<span class="i-badge">💉 ${round1(ins)}U</span>` : ''}
      ` : ''}
    </div>`;
  });

  row.innerHTML = html;
  return row;
}

function createSummaryPage(child, allData, displayUnit, basalMap, allDates, totalPages, fromDate, toDate) {
  const p = childProto || getProtocol(child);
  const defaultBasal = p.insulin.basalDose || 0;
  const childWeight = p.weightKg || null;
  const childName = child.identity?.name || child.name || '—';
  const dob = child.identity?.dob || child.birthDate;

  let totalBasalSum = 0, totalBolusSum = 0, tddDaysCount = 0;
  allDates.forEach(dStr => {
    const dayMatches = allData.filter(d => d.date === dStr);
    let dayBolus = 0;
    dayMatches.forEach(m => { dayBolus += Number(m.totalInsulin || m.correctionDose || m.totalDose || m.dose) || 0; });
    const dayBasal = basalMap[dStr] != null ? basalMap[dStr] : defaultBasal;
    if (dayMatches.length > 0 || basalMap[dStr] != null) {
      totalBasalSum += dayBasal;
      totalBolusSum += dayBolus;
      tddDaysCount++;
    }
  });

  const avgTDD = tddDaysCount > 0 ? round1((totalBasalSum + totalBolusSum) / tddDaysCount) : 0;
  const avgBasal = tddDaysCount > 0 ? round1(totalBasalSum / tddDaysCount) : 0;
  const basalRatio = avgTDD > 0 ? Math.round((avgBasal / avgTDD) * 100) : 0;
  const bolusRatio = avgTDD > 0 ? (100 - basalRatio) : 0;
  const tddPerKg = (childWeight && avgTDD > 0) ? (avgTDD / childWeight).toFixed(2) : null;

  const L = limitsInUnit(displayUnit);
  const valid = allData.filter(x => x.displayValue != null && Number.isFinite(+x.displayValue));
  const totalCount = valid.length;
  const n = totalCount || 1;

  const critLows = valid.filter(x => x.displayValue < L.critLow).length;
  const mildLows = valid.filter(x => x.displayValue >= L.critLow && x.displayValue < L.low).length;
  const totalLows = critLows + mildLows;
  const inRange = valid.filter(x => x.displayValue >= L.low && x.displayValue <= L.high).length;
  const mildHighs = valid.filter(x => x.displayValue > L.high && x.displayValue <= L.critHigh).length;
  const critHighs = valid.filter(x => x.displayValue > L.critHigh).length;
  const totalHighs = mildHighs + critHighs;

  const tirPct = totalCount ? Math.round((inRange / n) * 100) : 0;
  const tbrPct = totalCount ? Math.round((totalLows / n) * 100) : 0;
  const tbrL1Pct = totalCount ? round1((mildLows / n) * 100) : 0;
  const tbrL2Pct = totalCount ? round1((critLows / n) * 100) : 0;
  const tarPct = totalCount ? Math.round((totalHighs / n) * 100) : 0;
  const tarL1Pct = totalCount ? round1((mildHighs / n) * 100) : 0;
  const tarL2Pct = totalCount ? round1((critHighs / n) * 100) : 0;

  const mean = totalCount ? (valid.reduce((a, x) => a + x.displayValue, 0) / n) : 0;
  const sd = totalCount ? Math.sqrt(valid.reduce((a, x) => a + Math.pow(x.displayValue - mean, 2), 0) / n) : 0;
  const cv = mean > 0 ? (sd / mean) * 100 : 0;
  const meanMgdl = displayUnit === 'mmol/L' ? mmol2mgdl(mean) : mean;
  const gmi = totalCount ? (3.31 + (0.02392 * meanMgdl)).toFixed(1) : '—';

  const docName = child.assignedDoctorInfo?.name || '';

  const div = document.createElement('div');
  div.className = 'print-page';
  div.innerHTML = `
    <div>
      <header class="header">
        <div class="header-right">
          <h2>منصة أسيل — الملخص السريري المعياري والتقرير الذكي لحالة الطفل (AGP)</h2>
          <div class="muted">تحليل الفترة من <b>${esc(fromDate)}</b> إلى <b>${esc(toDate)}</b> • وفق معايير (ADA / ISPAD)</div>
        </div>
        <div class="header-left">
          <b>اسم الطفل:</b> ${esc(childName)} (${calcAge(dob)} سنة)<br>
          <b>النظام العلاجي:</b> ${child.regimen === 'pump' ? 'مضخة إنسولين' : 'حقن يومية (MDI)'} | <b>الوزن:</b> ${childWeight ? childWeight + ' كجم' : '—'}
        </div>
      </header>

      <table class="agp-metrics-table">
        <thead>
          <tr>
            <th>المؤشر السريري</th>
            <th>الهدف القياسي (ADA / ISPAD)</th>
            <th>النتيجة الفعلية للطفل</th>
            <th>التقييم السريري</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>الوقت في النطاق الطبيعي (العادي TIR: ${L.low}–${L.high} ${displayUnit})</b></td>
            <td>أكثر من 70% (&gt; 70%)</td>
            <td class="${tirPct >= 70 ? 'highlight-green' : (tirPct >= 50 ? 'highlight-amber' : 'highlight-red')}"><b>${tirPct}%</b> (${inRange} قراءة)</td>
            <td>${tirPct >= 70 ? 'ممتاز، ضمن الهدف الدولي ✅' : 'يحتاج لتحسين ضبط النطاق ⚠️'}</td>
          </tr>
          <tr>
            <td><b>نسبة الهبوط الإجمالية (TBR &lt; ${L.low} ${displayUnit})</b></td>
            <td>أقل من 4% (&lt; 4%)</td>
            <td class="${tbrPct < 4 ? 'highlight-green' : 'highlight-red'}"><b>${tbrPct}%</b> (خفيف: ${tbrL1Pct}% | حرج: ${tbrL2Pct}%)</td>
            <td>${tbrPct < 4 ? 'آمن وضمن المعدل الطبيعي 🟢' : 'مرتفع، أولوية قصوى لمنع الهبوط 🚨'}</td>
          </tr>
          <tr>
            <td><b>نسبة الارتفاعات الإجمالية (TAR &gt; ${L.high} ${displayUnit})</b></td>
            <td>أقل من 25% (&lt; 25%)</td>
            <td class="${tarPct < 25 ? 'highlight-green' : 'highlight-amber'}"><b>${tarPct}%</b> (مرتفع: ${tarL1Pct}% | حرج: ${tarL2Pct}%)</td>
            <td>${tarPct < 25 ? 'ممتاز 🟢' : 'مرتفع، مراجعة معاملات الكارب والتصحيح ⚠️'}</td>
          </tr>
          <tr>
            <td><b>التراكمي التقديري (GMI) ومتوسط السكر</b></td>
            <td>GMI أقل من 7.0%</td>
            <td class="highlight-blue"><b>GMI: ${gmi}%</b> | المتوسط: <b>${totalCount ? round1(mean) + ' ' + displayUnit : '—'}</b></td>
            <td>إجمالي القراءات المحللة: <b>${totalCount} قراءة</b></td>
          </tr>
          <tr>
            <td><b>معامل التذبذب السكري (CV%) وإجمالي الإنسولين (TDD)</b></td>
            <td>CV ≤ 36% | TDD: 0.6–1.0 U/kg</td>
            <td class="${cv <= 36 ? 'highlight-green' : 'highlight-amber'}">
              <b>CV: ${totalCount ? round1(cv) + '%' : '—'}</b> |
              <b>TDD: ${avgTDD > 0 ? avgTDD + ' U/يوم' : '—'}</b> ${tddPerKg ? `(${tddPerKg} U/kg)` : ''}
            </td>
            <td>${avgTDD > 0 ? `توزيع الإنسولين: قاعدي ${basalRatio}% / سريع ${bolusRatio}%` : (cv <= 36 ? 'سكر مستقر 🟢' : 'تذبذب مرتفع ⚠️')}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary-grid-layout">
        <div class="chart-card">
          <h4 style="margin:0 0 6px 0; color:#0f172a; font-size:13px;">📊 دائرة توزيع القراءات (العادي / الهبوط / الارتفاع)</h4>
          <div style="width:145px; height:145px; position:relative;">
            <canvas class="print-pie-canvas"></canvas>
          </div>
          <div class="range-pills">
            <div class="rp-item ok">
              <span>🟢 النطاق العادي (TIR)</span>
              <span>${tirPct}% (${inRange})</span>
            </div>
            <div class="rp-item high">
              <span>🟠 الارتفاعات (TAR)</span>
              <span>${tarPct}% (${totalHighs})</span>
            </div>
            <div class="rp-item low">
              <span>🔴 الهبوط (TBR)</span>
              <span>${tbrPct}% (${totalLows})</span>
            </div>
          </div>
        </div>

        <div class="ai-box">
          <div>
            <h3 style="margin:0 0 8px 0; color:#1e3a8a; font-size:14.5px; border-bottom:1px solid #cbd5e1; padding-bottom:5px;">
              🧠 التقرير الطبي الذكي عن حالة الطفل والأنماط المكتشفة
            </h3>
            <div class="ai-smart-report-content"></div>
          </div>
          ${child.doctor_note ? `
            <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:6px 10px; font-size:11.5px; color:#1e3a8a; margin-top:6px;">
              <b>🩺 آخر توجيه مسجل من الطبيب المعالج:</b> ${esc(child.doctor_note)}
            </div>
          ` : ''}
        </div>
      </div>

      <div class="doctor-sign-row">
        <div style="flex:1;">
          <b>توصيات الطبيب المعالج وخطة التعديل بعد مراجعة التقرير:</b>
          <div style="border-bottom: 1px dotted #94a3b8; height: 18px; margin-top:2px;"></div>
          <div style="border-bottom: 1px dotted #94a3b8; height: 18px; margin-top:2px;"></div>
        </div>
        <div style="width:230px; text-align:left; padding-inline-start:20px;">
          <div><b>الطبيب المعالج:</b> ${docName ? esc(docName) : '....................................'}</div>
          <div style="margin-top:6px;"><b>التاريخ:</b> ${localDateISO()}</div>
          <div style="margin-top:6px;"><b>التوقيع / الختم:</b> ....................................</div>
        </div>
      </div>
    </div>

    <div class="footer">صفحة ${totalPages} من ${totalPages} (نهاية التقرير الطبي المعتمد) — منصة أسيل لرعاية أطفال السكري</div>
  `;
  return div;
}

function renderSummaryPieChart(summaryPage, allData, displayUnit) {
  const canvas = summaryPage.querySelector('.print-pie-canvas');
  if (!canvas) return;
  const L = limitsInUnit(displayUnit);
  const valid = allData.filter(x => x.displayValue != null && Number.isFinite(+x.displayValue));
  const n = valid.length || 1;

  const inRange = valid.filter(x => x.displayValue >= L.low && x.displayValue <= L.high).length;
  const lows = valid.filter(x => x.displayValue < L.low).length;
  const highs = valid.filter(x => x.displayValue > L.high).length;

  const tirPct = valid.length ? Math.round((inRange / n) * 100) : 0;
  const tbrPct = valid.length ? Math.round((lows / n) * 100) : 0;
  const tarPct = valid.length ? Math.round((highs / n) * 100) : 0;

  new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: [`عادي (${tirPct}%)`, `هبوط (${tbrPct}%)`, `ارتفاع (${tarPct}%)`],
      datasets: [{
        data: valid.length ? [tirPct, tbrPct, tarPct] : [100, 0, 0],
        backgroundColor: valid.length ? ['#16a34a', '#ef4444', '#f59e0b'] : ['#e2e8f0', '#e2e8f0', '#e2e8f0'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      cutout: '64%'
    }
  });
}

function renderSmartChildReport(summaryPage, list, displayUnit, child, basalMap, allDates) {
  const aiContainer = summaryPage.querySelector('.ai-smart-report-content');
  if (!aiContainer) return;

  const L = limitsInUnit(displayUnit);
  const valid = list.filter(x => typeof x.displayValue === 'number' && !isNaN(x.displayValue));

  if (valid.length === 0) {
    aiContainer.innerHTML = `<div class="ai-pattern-row warn"><b>ℹ️ لا توجد قراءات مسجلة في هذه الفترة</b><div style="font-size:11.5px; color:#475569;">يرجى اختيار فترة زمنية تحتوي على قراءات مسجلة لاستخراج التحليل الذكي لحالة الطفل.</div></div>`;
    return;
  }

  const p = childProto || getProtocol(child);
  const hypoGrams = p.safety.hypoCarbs || 15;
  const patterns = [];
  const n = valid.length;
  const lows = valid.filter(x => x.displayValue < L.low).length;
  const highs = valid.filter(x => x.displayValue > L.high).length;
  const inRange = valid.filter(x => x.displayValue >= L.low && x.displayValue <= L.high).length;

  const tirPct = Math.round((inRange / n) * 100);
  const tbrPct = Math.round((lows / n) * 100);
  const tarPct = Math.round((highs / n) * 100);

  if (tbrPct >= 4) {
    patterns.push({
      cls: 'crit',
      name: `🚨 أولوية علاجية: رصد نوبات هبوط متكررة (${tbrPct}% من القراءات تحت ${L.low} ${displayUnit})`,
      desc: `سجل الطفل ${lows} قراءة منخفضة خلال هذه الفترة. طبياً، منع الهبوط له الأولوية القصوى قبل خفض الارتفاعات.`,
      rec: `مراجعة أوقات الهبوط وتخفيف الجرعة المسببة لها (القاعدي أو معامل الوجبة السابقة للهبوط) مع الالتزام بإعطاء ${hypoGrams} جرام سكريات سريعة.`
    });
  } else if (tirPct >= 70) {
    patterns.push({
      cls: 'good',
      name: `✅ تحكم سكري ممتاز: ${tirPct}% من القراءات في النطاق الطبيعي (${L.low}–${L.high} ${displayUnit})`,
      desc: `أداء متميز ومستقر يحقق الهدف الدولي للجمعية الدولية لسكري الأطفال (>70%) مع أمان عالٍ ضد الهبوط.`,
      rec: 'الاستمرار على البروتوكول العلاجي والغذائي الحالي مع المداومة على تدوير أماكن الحقن.'
    });
  } else if (tarPct > 25) {
    patterns.push({
      cls: 'warn',
      name: `⬆️ ميل للارتفاعات: ${tarPct}% من القراءات أعلى من النطاق (${L.high} ${displayUnit})`,
      desc: `تم تسجيل ${highs} قراءة مرتفعة مما يرفع التراكمي التقديري للطفل.`,
      rec: 'التأكد من إعطاء جرعة الإنسولين السريع قبل الوجبة بـ 15 دقيقة، ومراجعة دقة حساب جرامات الكارب ومعامل التصحيح.'
    });
  }

  const slots = {};
  valid.forEach(m => {
    const k = m.normalizedSlot || m.slotKey || 'OTHER';
    if (!slots[k]) slots[k] = [];
    slots[k].push(m.displayValue);
  });

  const countHigh = arr => arr ? arr.filter(v => v > L.high).length : 0;
  const countLow = arr => arr ? arr.filter(v => v < L.low).length : 0;

  const sleep = slots['DURING_SLEEP'] || [];
  const fast = [...(slots['FASTING'] || []), ...(slots['PRE_BREAKFAST'] || [])];

  if (fast.length >= 2) {
    const fastHighRatio = countHigh(fast) / fast.length;
    const sleepLowRatio = sleep.length > 0 ? (countLow(sleep) / sleep.length) : 0;
    if (fastHighRatio >= 0.5 && sleepLowRatio >= 0.25) {
      patterns.push({
        cls: 'crit',
        name: '🌙 اشتباه تأثير سوموجي (هبوط ليلي يتبعه ارتفاع صباحي ارتدادي)',
        desc: 'رُصد انخفاض أثناء النوم يتبعه ارتفاع حاد في قراءات الصائم/الصباح.',
        rec: 'تجنب زيادة جرعة القاعدي؛ يُنصح بمناقشة تقليل جرعة المساء أو تناول وجبة خفيفة قبل النوم لمنع الهبوط الليلي.'
      });
    } else if (fastHighRatio >= 0.5) {
      patterns.push({
        cls: 'warn',
        name: '🌅 نمط ارتفاع الصباح الباكر (ظاهرة الفجر Dawn Phenomenon)',
        desc: `يرتفع سكر الصائم في ${Math.round(fastHighRatio * 100)}% من القراءات الصباحية دون تسجيل هبوط ليلي.`,
        rec: 'مراجعة الطبيب لضبط جرعة الإنسولين القاعدي أو توقيت حقنه لتغطية هرمونات الصباح.'
      });
    }
  }

  const mealsCheck = [
    { name: 'الإفطار', arr: slots['POST_BREAKFAST'] },
    { name: 'الغداء', arr: slots['POST_LUNCH'] },
    { name: 'العشاء', arr: slots['POST_DINNER'] }
  ];
  mealsCheck.forEach(meal => {
    if (meal.arr && meal.arr.length >= 2) {
      const hRatio = countHigh(meal.arr) / meal.arr.length;
      const lRatio = countLow(meal.arr) / meal.arr.length;
      if (hRatio >= 0.5) {
        patterns.push({
          cls: 'warn',
          name: `🍽️ ارتفاع متكرر بعد وجبة ${meal.name} (${Math.round(hRatio * 100)}%)`,
          desc: `القراءات بعد ${meal.name} تتجاوز ${L.high} ${displayUnit} بشكل متكرر.`,
          rec: `يُوصى بمراجعة معامل الكارب (CR) لوجبة ${meal.name} مع الطبيب لتقوية التغطية.`
        });
      } else if (lRatio >= 0.35) {
        patterns.push({
          cls: 'crit',
          name: `📉 هبوط متكرر بعد وجبة ${meal.name}`,
          desc: `يتعرض الطفل لانخفاض السكر بعد وجبة ${meal.name}.`,
          rec: `تخفيف جرعة وجبة ${meal.name} (رفع رقم معامل الكارب CR) بالتنسيق مع الطبيب.`
        });
      }
    }
  });

  const topPatterns = patterns.slice(0, 4);
  aiContainer.innerHTML = topPatterns.map(p => `
    <div class="ai-pattern-row ${p.cls}">
      <div style="font-weight:800; color:#0f172a; font-size:12px; margin-bottom:2px;">${p.name}</div>
      <div style="color:#475569; font-size:11px; margin-bottom:3px;">${p.desc}</div>
      <div style="color:#1d4ed8; font-size:11px; font-weight:700;">💡 التوصية: ${p.rec}</div>
    </div>
  `).join('');
}
