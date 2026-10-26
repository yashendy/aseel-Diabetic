// js/reports-print.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId') || localStorage.getItem('lastChildId');
const parentIdParam = params.get('parentId');
const fromDateParam = params.get('from');
const toDateParam = params.get('to');
const isBlank = params.get('blank') === '1';
const urlUnit = params.get('unit');

const SLOT_KEYS = ['FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP'];
const SLOT_LABELS = ['صائم/استيقاظ','ق.الفطار','ب.الفطار','ق.الغداء','ب.الغداء','ق.العشاء','ب.العشاء','سناك','ق.النوم','أثناء النوم'];

const mgdl2mmol = v => v / 18.0182;
const mmol2mgdl = v => v * 18.0182;
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

function limitsInUnit(targetUnit) {
  if (targetUnit === sysUnit) return { ...sysLimits };
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
    sysUnit = childData.glucoseUnit || 'mg/dL';
    if (childData.glucose_limits) {
      sysLimits.low = Number(childData.glucose_limits.low) || (sysUnit === 'mmol/L' ? 3.9 : 70);
      sysLimits.high = Number(childData.glucose_limits.high) || (sysUnit === 'mmol/L' ? 10.0 : 180);
      sysLimits.critLow = Number(childData.glucose_limits.critical_low) || (sysUnit === 'mmol/L' ? 3.0 : 54);
      sysLimits.critHigh = Number(childData.glucose_limits.critical_high) || (sysUnit === 'mmol/L' ? 13.9 : 250);
    } else if (sysUnit === 'mmol/L') {
      sysLimits = { critLow: 3.0, low: 3.9, high: 10.0, critHigh: 13.9 };
    }

    const displayUnit = urlUnit || sysUnit;

    // تحديد نطاق التواريخ
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
        // توحيد الاستيقاظ مع الصائم
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

    // في السجل الفارغ نطبع صفحة واحدة أنيقة لـ 7 أيام، وفي التقرير المليان نقسم الأسابيع + صفحة الملخص الأخيرة
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

    // إضافة الصفحة الأخيرة (الدائرة + نسب الهبوط والارتفاع والعادي + التقرير الذكي عن حالة الطفل)
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

// بناء 7 أيام للسجل الفارغ تبدأ من اليوم
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
  const cf = child.cf || child.correctionFactor || '—';
  const crObj = child.cr || {};
  const crStr = (crObj.breakfast || crObj.lunch || crObj.dinner)
    ? `ف:${crObj.breakfast || '-'} / غ:${crObj.lunch || '-'} / ع:${crObj.dinner || '-'}`
    : (child.carbRatio || '—');
  const basalDose = child.insulin?.basalDose || child.basalDose || '—';
  const docName = child.assignedDoctorInfo?.name || '—';

  div.innerHTML = `
    <div>
      <header class="header">
        <div class="header-right">
          <h2>منصة أسيل — سجل المتابعة اليومي لسكري الأطفال ${isBlank ? '(سجل يدوي فارغ 📝)' : '(تقرير القياسات والوجبات 📊)'}</h2>
          <div class="muted">الفترة: من <b>${esc(start)}</b> إلى <b>${esc(end)}</b> • الطبيب المتابع: <b>${esc(docName)}</b></div>
        </div>
        <div class="header-left">
          <b>اسم الطفل:</b> ${esc(child.name || '—')} (${calcAge(child.birthDate)} سنة) | <b>الوحدة:</b> ${esc(displayUnit)}<br>
          <b>معامل الكارب (CR):</b> ${esc(crStr)} | <b>التصحيح (CF):</b> ${esc(cf)} | <b>القاعدي:</b> ${esc(basalDose)}U
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

  const defaultBasal = Number(child?.insulin?.basalDose || child?.basalDose) || 0;
  const dailyBasal = basalMap[dateStr] != null ? basalMap[dateStr] : defaultBasal;
  const dailyTDD = round1(dailyBasal + dailyBolus);

  let html = `<div class="cell"><b>${esc(dateStr)}</b><small style="color:#475569">${esc(dayName)}</small></div>`;

  if (isBlank) {
    html += `<div class="cell" style="background:#f8fafc; font-size:9px; color:#94a3b8;">كارب: ......<br>قاعدي: ......</div>`;
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
          <div class="blank-line" title="السكر"></div>
          <div style="display:flex; justify-content:space-between; width:100%; padding-top:2px;">
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
  const defaultBasal = Number(child?.insulin?.basalDose || child?.basalDose) || 0;
  const childWeight = Number(child?.vitals?.weight || child?.weight) || null;

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
          <b>اسم الطفل:</b> ${esc(child.name || '—')} (${calcAge(child.birthDate)} سنة)<br>
          <b>النظام العلاجي:</b> ${child.regimen === 'pump' ? 'مضخة إنسولين' : 'حقن يومية (MDI)'} | <b>الوزن:</b> ${childWeight ? childWeight + ' كجم' : '—'}
        </div>
      </header>

      <!-- 1. جدول المؤشرات السريرية المعيارية -->
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

      <!-- 2. الدائرة البيانية + التقرير الذكي عن حالة الطفل -->
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

      <!-- 3. توقيع الطبيب -->
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

  const patterns = [];
  const n = valid.length;
  const lows = valid.filter(x => x.displayValue < L.low).length;
  const highs = valid.filter(x => x.displayValue > L.high).length;
  const inRange = valid.filter(x => x.displayValue >= L.low && x.displayValue <= L.high).length;

  const tirPct = Math.round((inRange / n) * 100);
  const tbrPct = Math.round((lows / n) * 100);
  const tarPct = Math.round((highs / n) * 100);

  // 1. التقييم العام للتحكم السكري
  if (tbrPct >= 4) {
    patterns.push({
      cls: 'crit',
      name: `🚨 أولوية علاجية: رصد نوبات هبوط متكررة (${tbrPct}% من القراءات تحت ${L.low} ${displayUnit})`,
      desc: `سجل الطفل ${lows} قراءة منخفضة خلال هذه الفترة. طبياً، منع الهبوط له الأولوية القصوى قبل خفض الارتفاعات.`,
      rec: 'مراجعة أوقات الهبوط وتخفيف الجرعة المسببة لها (القاعدي أو معامل الوجبة السابقة للهبوط) مع الالتزام بقاعدة 15 جرام سكريات سريعة.'
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

  // 2. تحليل فترة النوم والصباح (ظاهرة الفجر مقابل سوموجي)
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

  // 3. تحليل كفاءة جرعات الوجبات (الإفطار / الغداء / العشاء)
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

  // نكتفي بأهم 4 ملاحظات سريرية لتناسب مساحة الصفحة الواحدة بأناقة
  const topPatterns = patterns.slice(0, 4);
  aiContainer.innerHTML = topPatterns.map(p => `
    <div class="ai-pattern-row ${p.cls}">
      <div style="font-weight:800; color:#0f172a; font-size:12px; margin-bottom:2px;">${p.name}</div>
      <div style="color:#475569; font-size:11px; margin-bottom:3px;">${p.desc}</div>
      <div style="color:#1d4ed8; font-size:11px; font-weight:700;">💡 التوصية: ${p.rec}</div>
    </div>
  `).join('');
}
