/* التقارير – يعمل داخل صفحة واحدة مع تبديل العروض (report/analysis/print) */

// =====================[ الإعدادات العامة ]=====================
const $ = (sel, p = document) => p.querySelector(sel);
const $$ = (sel, p = document) => Array.from(p.querySelectorAll(sel));

/* فترات اليوم (مع إضافة PRE_SLEEP ق.النوم) */
const COLS = [
  ["WAKE","الاستيقاظ"],
  ["PRE_BREAKFAST","ق.الفطار"],
  ["POST_BREAKFAST","ب.الفطار"],
  ["PRE_LUNCH","ق.الغدا"],
  ["POST_LUNCH","ب.الغدا"],
  ["PRE_DINNER","ق.العشا"],
  ["POST_DINNER","ب.العشا"],
  ["SNACK","سناك"],
  ["PRE_SLEEP","ق.النوم"],     // جديد
  ["DURING_SLEEP","أثناء النوم"],
];

/* Aliases لتوحيد الأسماء القادمة من المصدر */
const SLOT_ALIAS = {
  WAKE:["WAKE","UPON_WAKE","UPONWAKE"],
  PRE_BREAKFAST:["PRE_BREAKFAST","PRE_BF","PREBREAKFAST"],
  POST_BREAKFAST:["POST_BREAKFAST","POST_BF","POSTBREAKFAST"],
  PRE_LUNCH:["PRE_LUNCH","PRELUNCH"],
  POST_LUNCH:["POST_LUNCH","POSTLUNCH"],
  PRE_DINNER:["PRE_DINNER","PREDINNER"],
  POST_DINNER:["POST_DINNER","POSTDINNER"],
  SNACK:["SNACK"],
  PRE_SLEEP:["PRE_SLEEP","BEFORE_SLEEP","BEFORESLEEP","PRE-SLEEP"], // جديد
  DURING_SLEEP:["DURING_SLEEP","NIGHT"]
};

const SLOT_MAP = (()=> {
  const m = {};
  for (const [k, list] of Object.entries(SLOT_ALIAS)) {
    for (const a of list) m[a.toUpperCase()] = k;
  }
  return m;
})();

/* تنسيق التاريخ (محلي وليس UTC) */
const fmtISO = (d)=>{
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,'0');
  const dd = String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
};
const addDays = (d, n)=> {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate()+n);
  return x;
};

// =====================[ عناصر الصفحة ]=====================
const presetEl = $("#preset");
const datesBox = $("#datesBox");
const fromEl = $("#from");
const toEl = $("#to");
const runEl = $("#run");
const btnPrint = $("#btnPrint");
const btnBlank = $("#btnBlank");
const toggleNotes = $("#toggleNotes");
const rowsEl = $("#rows");
const headRowEl = $("#headRow");
const metaEl = $("#meta");
const loaderEl = $("#loader");
const childNav = $("#childNav");
const childBanner = $("#childBanner");
const bannerName = $("#bannerName");
const metaHead = $("#metaHead");
const lnkHome = $("#lnkHome");

const analysisBtn = $("#btnAnalyticsPage");
const reportPrintBtn = $("#btnReportPrintPage");

const analysisContainer = $("#analysisContainer");
const headRowPrint = $("#headRowPrint");
const rowsPrint = $("#rowsPrint");

// =====================[ متغيرات حالة ]=====================
let parentId = "";
let childId = "";
let childInfo = null;
let limits = { severeLow: 55, normalMin: 70, normalMax: 180, severeHigh: 300 };

let currentDataByDay = {};   // سنحتفظ بها لإعادة استخدام الجدول نفسه في print/analysis

// =====================[ أدوات مساعدة ]=====================
const setLoader = (v)=> loaderEl.style.display = v ? "flex" : "none";
const num = (x)=> (x==null || isNaN(+x)) ? null : +(+x).toFixed(1);

const classify = (v)=>{
  if (v==null) return null;
  if (v <= limits.severeLow) return "b-sevlow";
  if (v < limits.normalMin) return "b-low";
  if (v <= limits.normalMax) return "b-ok";
  if (v < limits.severeHigh) return "b-high";
  return "b-sevhigh";
};

function qparam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name) || "";
}

// =====================[ بناء رأس الجدول ]=====================
function buildHead(targetTheadRow){
  targetTheadRow.innerHTML = "";
  const thDate = document.createElement("th");
  thDate.textContent = "التاريخ";
  thDate.className = "date";
  targetTheadRow.appendChild(thDate);

  for (const [, label] of COLS) {
    const th = document.createElement("th");
    th.textContent = label;
    targetTheadRow.appendChild(th);
  }
}

// =====================[ بناء صفوف الجدول ]=====================
function buildEmptyMessage(targetBody, text="لا توجد بيانات ضمن المدى المحدد"){
  const span = COLS.length + 1; // +1 للتاريخ
  targetBody.innerHTML = `<tr><td colspan="${span}" class="center muted">${text}</td></tr>`;
}

function renderRows(targetBody, byDay){
  const days = Object.keys(byDay).sort(); // تصاعدي
  if (days.length === 0) {
    buildEmptyMessage(targetBody);
    return;
  }
  const frag = document.createDocumentFragment();

  for (const d of days) {
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.className = "date";
    tdDate.textContent = d;
    tr.appendChild(tdDate);

    for (const [slotKey] of COLS) {
      const td = document.createElement("td");
      const rec = byDay[d]?.[slotKey] || null;

      if (rec && rec.value != null) {
        const v = num(rec.value);
        const cls = classify(v) || "";
        const line = document.createElement("div");
        line.className = "value-line";

        const b = document.createElement("b");
        b.textContent = (v==null?"—":v);
        const dot = document.createElement("span");
        dot.className = `state-dot ${cls}`;
        dot.textContent = "●";

        line.appendChild(b);
        line.appendChild(dot);
        td.appendChild(line);

        // جرعات
        if (rec.bolus || rec.correction) {
          const dl = document.createElement("div");
          dl.className = "dose-line";
          const parts = [];
          if (rec.bolus) parts.push(`وجبة: ${rec.bolus}`);
          if (rec.correction) parts.push(`تصحيح: ${rec.correction}`);
          dl.textContent = parts.join(" • ");
          td.appendChild(dl);
        }

        // ملاحظات
        if (rec.note) {
          const nl = document.createElement("div");
          nl.className = "note-line";
          nl.textContent = rec.note;
          td.appendChild(nl);
        }
      } else {
        td.textContent = "—";
      }
      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  targetBody.innerHTML = "";
  targetBody.appendChild(frag);
}

// =====================[ جلب البيانات (نموذج) ]=====================
/* ملاحظة: ادمجي هنا كود Firebase الأصلي عندك.
   لتجربة سريعة، هنستخدم مصدر بيانات وهمي إذا مفيش Firebase. */
async function fetchMeasurements(fromISO, toISO){
  // TODO: استبدلي هذا بمصدر بياناتك من Firestore:
  // parents/{parentId}/measurements? where date between fromISO..toISO
  // يجب أن يعيد عناصر بشكل: {date:'YYYY-MM-DD', slot:'PRE_SLEEP'.., value:123, bolus?, correction?, note?}
  return [];
}

// تطبيع السجل إلى byDay[date][slotKey]
function groupByDay(list){
  const byDay = {};
  for (const r of list) {
    const date = r.date;
    const slotKey = SLOT_MAP[(r.slot||"").toUpperCase()] || (COLS.find(c=>c[0]===r.slot)?.[0] ?? null);
    if (!date || !slotKey) continue;
    byDay[date] ||= {};
    byDay[date][slotKey] = {
      value: r.value,
      bolus: r.bolus,
      correction: r.correction,
      note: r.note
    };
  }
  return byDay;
}

// =====================[ بناء التقرير ]=====================
async function buildReport(fromISO, toISO){
  setLoader(true);
  try {
    // وصف المدى
    metaEl.textContent = `من ${fromISO} إلى ${toISO}`;

    // جلب بيانات الطفل وحدوده لو متاحة لديك (يمكنك استبداله بكودك)
    // limits = { severeLow, normalMin, normalMax, severeHigh } ← في مشروعك اقرئيها من مستند الطفل

    // قياسات
    const list = await fetchMeasurements(fromISO, toISO);
    const byDay = groupByDay(list);

    currentDataByDay = byDay; // للاستخدام في الطباعة/التحاليل

    // بناء الرأس
    buildHead(headRowEl);
    buildHead(headRowPrint);

    // الصفوف
    renderRows(rowsEl, byDay);
    renderRows(rowsPrint, byDay);

    if (!list.length) {
      buildEmptyMessage(rowsEl);
      buildEmptyMessage(rowsPrint);
    }
  } catch (e) {
    console.error(e);
    buildEmptyMessage(rowsEl, "حدث خطأ أثناء تحميل البيانات");
  } finally {
    setLoader(false);
  }
}

// =====================[ التبديل بين العروض داخل الصفحة ]=====================
window.showView = function(which){
  const reportSec   = $("#reportView");
  const analysisSec = $("#analysisView");
  const printSec    = $("#printView");

  for (const el of [reportSec, analysisSec, printSec]) el?.classList.add("hidden");
  if (which === "analysis") {
    analysisSec?.classList.remove("hidden");
    buildAnalysis();
  } else if (which === "print") {
    printSec?.classList.remove("hidden");
  } else {
    reportSec?.classList.remove("hidden");
  }
};

// تحليل بسيط كمثال (استبدليه بتحليلك التفصيلي)
function buildAnalysis(){
  if (!currentDataByDay || !Object.keys(currentDataByDay).length) {
    analysisContainer.textContent = "لا توجد بيانات لعرض التحليلات.";
    return;
  }
  let total = 0, count = 0;
  for (const d of Object.values(currentDataByDay)) {
    for (const [slot, rec] of Object.entries(d)) {
      if (rec?.value != null) { total += +rec.value; count++; }
    }
  }
  const avg = count ? (total / count).toFixed(1) : "—";
  analysisContainer.innerHTML = `
    <div class="badge b-ok">متوسط القياسات: ${avg}</div>
  `;
}

// =====================[ واجهة المستخدم والأحداث ]=====================
function applyPreset(val){
  const today = new Date();
  let from = null, to = null;

  if (val === "custom") {
    datesBox.classList.remove("hidden");
    fromEl.focus();
    return;
  } else {
    datesBox.classList.add("hidden");
  }

  if (val === "90_only") {
    // آخر 90 يوم من اليوم فقط (بدون تغيير to)
    to = today;
    from = addDays(today, -89);
  } else {
    const days = Number(val || 7);
    to = today;
    from = addDays(today, -(days-1));
  }

  fromEl.value = fmtISO(from);
  toEl.value = fmtISO(to);
}

function wireUI(){
  // تبديل الملاحظات
  toggleNotes?.addEventListener("change", ()=>{
    document.body.classList.toggle("notes-hidden", !toggleNotes.checked);
  });

  // المدى السريع
  presetEl?.addEventListener("change", ()=>{
    applyPreset(presetEl.value);
  });

  // عرض
  runEl?.addEventListener("click", ()=>{
    const p = presetEl.value;
    if (p !== "custom") applyPreset(p);
    const fromISO = fromEl.value;
    const toISO = toEl.value || fmtISO(new Date());
    buildReport(fromISO, toISO);
    showView("report");
  });

  // طباعة
  btnPrint?.addEventListener("click", ()=> window.print());

  // ورقة فارغة (7 أيام)
  btnBlank?.addEventListener("click", ()=>{
    const start = new Date();
    const days = Array.from({length:7}, (_,i)=> fmtISO(addDays(start, i)));
    const byDay = {};
    for (const d of days) byDay[d] = {};
    currentDataByDay = byDay;
    buildHead(headRowEl);
    buildHead(headRowPrint);
    renderRows(rowsEl, byDay);
    renderRows(rowsPrint, byDay);
    metaEl.textContent = "ورقة فارغة للأسبوع القادم";
  });

  // عرض التحليلات والطباعة داخل نفس الصفحة
  analysisBtn?.addEventListener("click", (e)=> { e.preventDefault(); showView("analysis"); });
  reportPrintBtn?.addEventListener("click", (e)=> { e.preventDefault(); showView("print"); });

  // زر الرجوع للصفحة الرئيسية مع تمرير parent
  if (lnkHome) {
    const p = encodeURIComponent(parentId || "");
    lnkHome.href = `parent.html?parent=${p}`;
  }
}

// إنشاء شريط التنقل العلوي
function buildNav(){
  const nav = [
    ["parent.html","الرئيسية"],                // تم التعديل
    ["measurements.html","قياسات السكر"],      // تم التعديل
    ["meals.html","الوجبات"],
    ["reports.html","التقارير"],
    ["#","التحاليل","analysis"],               // يبدل View
    ["visits.html","الزيارات الطبية"],
  ];

  childNav.innerHTML = "";
  for (const [href, label, type] of nav) {
    const a = document.createElement("a");
    a.className = "btn gray";
    a.textContent = label;

    if (type === "analysis") {
      a.addEventListener("click", (e)=>{ e.preventDefault(); showView("analysis"); });
    } else {
      a.href = href;
    }
    childNav.appendChild(a);
  }
}

// =====================[ بدء التشغيل ]=====================
async function main(){
  parentId = qparam("parent");
  childId = qparam("child");

  // بانر
  childBanner.style.display = "block";
  bannerName.textContent = childId ? `الطفل: ${childId}` : "الطفل";
  metaHead.textContent = "—";

  // UI
  wireUI();
  buildNav();
  applyPreset("7");            // افتراضي: أسبوع
  runEl.click();               // يبني التقرير مباشرة
}

document.addEventListener("DOMContentLoaded", main);
