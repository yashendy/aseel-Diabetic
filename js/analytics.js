// analytics.js  (ESM)
import { auth } from "./js/firebase-config.js";

// Firebase v10 modules from CDN (app is already initialized in firebase-config)
import {
  getFirestore, doc, getDoc, collection, query, where, orderBy, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore();

// ---------- DOM ----------
const errBox = document.getElementById("errBox");
const unitSelect = document.getElementById("unitSelect");
const rangeSel   = document.getElementById("rangeSel");
const customBox  = document.getElementById("customDates");
const fromDate   = document.getElementById("fromDate");
const toDate     = document.getElementById("toDate");
const applyCustom= document.getElementById("applyCustom");
const spinnerLine= document.getElementById("spinnerLine");
const spinnerPie = document.getElementById("spinnerPie");
const lineLegend = document.getElementById("lineLegend");
const pieLegend  = document.getElementById("pieLegend");

// ---------- Utils ----------
const qs = new URLSearchParams(location.search);
const childId = qs.get("child");
if (!childId) showError("من فضلك افتح صفحة التحليلات من صفحة التقارير (لا يوجد childId في الرابط).");

function showError(msg) {
  errBox.textContent = msg;
  errBox.style.display = "block";
}
function hideError() {
  errBox.style.display = "none";
}

function beginSpin(el){ el.style.display = "inline-block"; }
function endSpin(el){ el.style.display = "none"; }

// Unit helpers
function toMmol(value, unit) {
  if (value == null || isNaN(value)) return null;
  if (!unit || unit.toLowerCase() === "mmol") return +value;
  // mg/dL -> mmol/L
  return (+value) / 18;
}
function toMgdl(value, unit) {
  if (value == null || isNaN(value)) return null;
  if (!unit || unit.toLowerCase() === "mgdl") return +value;
  // mmol/L -> mg/dL
  return (+value) * 18;
}
function convertForDisplay(v, inUnit, wantUnit) {
  return wantUnit === "mgdl" ? toMgdl(v, inUnit) : toMmol(v, inUnit);
}
function formatValue(v, unit) {
  if (v == null) return "-";
  return unit === "mgdl" ? Math.round(v) : (+v).toFixed(1);
}

function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfWeek(d){
  const x = new Date(d); const day = (x.getDay()+6)%7; // ISO week start Monday
  x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x;
}
function endOfWeek(d){
  const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999); return e;
}
function startOfMonth(d){ const x=new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d){ const x=new Date(d); x.setMonth(x.getMonth()+1,0); x.setHours(23,59,59,999); return x; }

// Compute range from selector value
function computeRange(sel, custom=null) {
  const now = new Date();
  let start, end = now;

  const mapDays = (n)=> { const s=new Date(); s.setDate(s.getDate()-n+1); return {start:startOfDay(s), end:endOfDay(now)}; };

  switch(sel){
    case "7d":  return mapDays(7);
    case "14d": return mapDays(14);
    case "30d": return mapDays(30);
    case "90d": return mapDays(90);
    case "2w":  return mapDays(14);
    case "2m":  { const s=new Date(); s.setMonth(s.getMonth()-2); return {start:startOfDay(s), end:endOfDay(now)}; }
    case "this_w": return { start: startOfWeek(now), end: endOfWeek(now) };
    case "prev_w": {
      const s = startOfWeek(now); s.setDate(s.getDate()-7);
      const e = new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999);
      return { start: s, end: e };
    }
    case "this_m": return { start: startOfMonth(now), end: endOfMonth(now) };
    case "prev_m": {
      const s = startOfMonth(now); s.setMonth(s.getMonth()-1);
      const e = endOfMonth(s);
      return { start: s, end: e };
    }
    case "custom": {
      if (!custom || !custom.start || !custom.end) throw new Error("يرجى اختيار تاريخ البداية والنهاية.");
      return { start: startOfDay(custom.start), end: endOfDay(custom.end) };
    }
    default: return mapDays(14);
  }
}

// Chart instances
let lineChart, pieChart;

// Doughnut labels + center text plugin
const DoughnutWritePlugin = {
  id: "doughnutWrite",
  afterDraw(chart, args, opts) {
    const { ctx, chartArea: { width, height } } = chart;
    const total = chart.data.datasets[0]?.data?.reduce((a,b)=>a+b,0) ?? 0;
    if (!total) return;

    // center text
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111";
    ctx.font = "600 18px system-ui";
    const tir = chart.data.datasets[0].data[1] || 0; // [TBR, TIR, TAR]
    const perc = Math.round((tir/total)*100);
    ctx.fillText(`${perc}% TIR`, chart.getDatasetMeta(0).data[0].x, chart.getDatasetMeta(0).data[0].y);
    ctx.restore();

    // slice labels
    ctx.save();
    ctx.font = "12px system-ui";
    const meta = chart.getDatasetMeta(0);
    const labels = chart.data.labels || [];
    meta.data.forEach((el, i) => {
      const val = chart.data.datasets[0].data[i];
      if (!val) return;
      const pct = Math.round((val/total)*100);
      const { x, y } = el.tooltipPosition();
      ctx.fillStyle = "#333";
      ctx.textAlign = "center";
      ctx.fillText(`${labels[i]}: ${pct}%`, x, y);
    });
    ctx.restore();
  }
};

// Fetch child info (unit + severe limits)
async function getChildInfo(uid, childId) {
  const ref = doc(db, "parents", uid, "children", childId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("الطفل غير موجود أو ليس لديك صلاحية.");
  const d = snap.data() || {};

  // Default unit
  let unit = (d.glucoseUnit || "mmol").toLowerCase();
  if (!["mmol","mgdl"].includes(unit)) unit = "mmol";

  // Severe limits (required for lines)
  const rng = d.normalRange || {};
  let severeLow  = rng.severeLow;
  let severeHigh = rng.severeHigh;

  if (severeLow == null || severeHigh == null) {
    console.warn("لا توجد severeLow/severeHigh في وثيقة الطفل؛ استخدم افتراضات 3.0 و 13.9 mmol/L.");
    severeLow = 3.0; severeHigh = 13.9;
  }
  return { unit, severeLow, severeHigh };
}

// Fetch measurements between dates
async function getMeasurements(uid, childId, start, end) {
  const coll = collection(db, "parents", uid, "children", childId, "measurements");
  const q = query(
    coll,
    where("when", ">=", Timestamp.fromDate(start)),
    where("when", "<=", Timestamp.fromDate(end)),
    orderBy("when", "asc")
  );
  const snap = await getDocs(q);
  const items = [];
  snap.forEach(docSnap => {
    const m = docSnap.data();
    const when = (m.when && m.when.toDate) ? m.when.toDate() :
                 (m.when instanceof Date ? m.when : (m.date ? new Date(m.date) : null));
    if (!when) return;

    // value & unit detection
    const unitIn = (m.unit || m.units || (m.mmol!=null?"mmol": (m.mgdl!=null?"mgdl": null)) || "mmol").toLowerCase();
    let value = null;
    if (m.mmol != null) value = +m.mmol;
    else if (m.value != null) value = +m.value;
    else if (m.glucose != null) value = +m.glucose;
    else if (m.mgdl != null) value = +m.mgdl;

    // final push
    if (value != null) items.push({ when, value, unit: unitIn });
  });
  return items;
}

// Build datasets for line chart with 2 horizontal severe lines
function buildLineDatasets(points, severeLow, severeHigh, displayUnit) {
  const data = points.map(p => ({ x: p.when, y: convertForDisplay(p.value, p.unit, displayUnit) }));
  // horizontal lines
  const timeMin = points.length ? points[0].when : new Date();
  const timeMax = points.length ? points[points.length-1].when : new Date();

  const sLow  = convertForDisplay(severeLow,  "mmol", displayUnit);
  const sHigh = convertForDisplay(severeHigh, "mmol", displayUnit);

  return [
    {
      label: "Glucose",
      data,
      borderWidth: 2,
      pointRadius: 0,
      tension: .2
    },
    {
      label: "Severe Low",
      data: [
        { x: timeMin, y: sLow },
        { x: timeMax, y: sLow }
      ],
      borderDash: [6,6],
      borderWidth: 1.5,
      pointRadius: 0
    },
    {
      label: "Severe High",
      data: [
        { x: timeMin, y: sHigh },
        { x: timeMax, y: sHigh }
      ],
      borderDash: [6,6],
      borderWidth: 1.5,
      pointRadius: 0
    }
  ];
}

// Build data for pie (TBR/TIR/TAR) based on severeLow/high
function buildPieData(points, severeLow, severeHigh, displayUnit) {
  let tbr=0, tir=0, tar=0;
  for (const p of points) {
    const v = convertForDisplay(p.value, p.unit, "mmol"); // قارن دائمًا بالـ mmol داخليًا
    if (v == null) continue;
    if (v < severeLow) tbr++;
    else if (v > severeHigh) tar++;
    else tir++;
  }
  return {
    labels: ["TBR", "TIR", "TAR"],
    datasets: [{
      data: [tbr, tir, tar]
    }]
  };
}

// Render legends
function renderLegend(container, labels) {
  container.innerHTML = "";
  labels.forEach(text => {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = text;
    container.appendChild(span);
  });
}

// Main loader
async function loadAll() {
  hideError();
  if (!auth.currentUser) {
    showError("يجب تسجيل الدخول أولًا.");
    return;
  }
  const uid = auth.currentUser.uid;

  // Unit preference + severe limits
  const child = await getChildInfo(uid, childId);
  if (!unitSelect.dataset.userTouched) {
    unitSelect.value = child.unit; // default from child
  }

  // Range
  let range;
  if (rangeSel.value === "custom") {
    range = computeRange("custom", { start: fromDate.valueAsDate, end: toDate.valueAsDate });
  } else {
    range = computeRange(rangeSel.value);
  }

  // Fetch measurements
  beginSpin(spinnerLine); beginSpin(spinnerPie);
  const raw = await getMeasurements(uid, childId, range.start, range.end);
  endSpin(spinnerLine); endSpin(spinnerPie);

  // Sort to be safe
  raw.sort((a,b)=>a.when-b.when);

  // Prepare charts
  const displayUnit = unitSelect.value;

  // Line
  const lineDataSets = buildLineDatasets(raw, child.severeLow, child.severeHigh, displayUnit);
  const lineCfg = {
    type: "line",
    data: { datasets: lineDataSets },
    options: {
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: {
          type: "time",
          time: { unit: "day" },
          ticks: { autoSkip: true, maxTicksLimit: 10 }
        },
        y: {
          title: { display: true, text: displayUnit === "mgdl" ? "mg/dL" : "mmol/L" }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.parsed.y;
              return `${formatValue(v, displayUnit)} ${displayUnit === "mgdl" ? "mg/dL":"mmol/L"}`;
            }
          }
        }
      }
    }
  };

  if (lineChart) { lineChart.destroy(); }
  lineChart = new Chart(document.getElementById("dayChart"), lineCfg);

  renderLegend(lineLegend, [
    `Severe Low = ${formatValue(convertForDisplay(child.severeLow,"mmol",displayUnit), displayUnit)}`,
    `Severe High = ${formatValue(convertForDisplay(child.severeHigh,"mmol",displayUnit), displayUnit)}`
  ]);

  // Pie
  const pie = buildPieData(raw, child.severeLow, child.severeHigh, displayUnit);
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById("rangePie"), {
    type: "doughnut",
    data: pie,
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    },
    plugins: [DoughnutWritePlugin]
  });

  renderLegend(pieLegend, ["TBR: دون Severe Low", "TIR: داخل النطاق", "TAR: فوق Severe High"]);
}

// ---------- Events ----------
rangeSel.addEventListener("change", () => {
  customBox.style.display = rangeSel.value === "custom" ? "flex" : "none";
  if (rangeSel.value !== "custom") loadAll();
});
applyCustom.addEventListener("click", () => loadAll());

unitSelect.addEventListener("change", () => {
  unitSelect.dataset.userTouched = "1";
  loadAll();
});

// ---------- Startup ----------
window.addEventListener("load", async () => {
  // wait for auth state to be ready (firebase-config likely already sets onAuthStateChanged)
  if (auth.currentUser) {
    await loadAll();
  } else {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (u) { await loadAll(); unsub(); }
    });
  }
});
