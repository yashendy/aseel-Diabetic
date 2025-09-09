/* reports-print.js
 * - التلوين حسب Hypo/Hyper
 * - سهام الاتجاه
 * - خانة جديدة: ق. النوم (PRE_SLEEP)
 * - نموذج فارغ أسبوعين يطبع في ورقة واحدة
 */

// عناصر الواجهة
const tbody       = document.getElementById("tbody");
const unitSelect  = document.getElementById("unitSelect");
const colorizeEl  = document.getElementById("colorize");
const maskTreatEl = document.getElementById("maskTreat");
const weeklyMode  = document.getElementById("weeklyMode");
const manualMode  = document.getElementById("manualMode");

const fromDateEl  = document.getElementById("fromDate");
const toDateEl    = document.getElementById("toDate");
const notesEl     = document.getElementById("notes");

const periodFromEl = document.getElementById("periodFrom");
const periodToEl   = document.getElementById("periodTo");
const periodUnitEl = document.getElementById("periodUnit");
const reportNotes  = document.getElementById("reportNotes");

const applyBtn = document.getElementById("applyBtn");
const printBtn = document.getElementById("printBtn");
const blankBtn = document.getElementById("blankBtn");

// ثوابت التحويل
const MGDL_PER_MMOL = 18;

// العتبات (سيتم تحديثها من بيانات الطفل إن كانت متاحة)
let HYPO_M = 3.9;   // mmol/L
let HYPER_M = 10.0; // mmol/L

// خريطة الخانات العربية -> مفاتيح منطقية
const SLOTS = {
  // عربي : المفتاح المنطقي
  "الاستيقاظ":   "FASTING",
  "ق. الفطار":   "PRE_BREAKFAST",
  "ب. الفطار":   "POST_BREAKFAST",
  "ق. الغدا":    "PRE_LUNCH",
  "ب. الغدا":    "POST_LUNCH",
  "ق. العشا":    "PRE_DINNER",
  "ب. العشا":    "POST_DINNER",
  "سناك":        "RANDOM",
  "ق. النوم":    "PRE_SLEEP",     // << الجديد
  "أثناء النوم": "OVERNIGHT",
};

// ترتيب العرض النهائي
const DISPLAY_ORDER = [
  "FASTING",
  "PRE_BREAKFAST", "POST_BREAKFAST",
  "PRE_LUNCH", "POST_LUNCH",
  "PRE_DINNER", "POST_DINNER",
  "RANDOM",
  "PRE_SLEEP",
  "OVERNIGHT",
];

// مرادفات قديمة/إنجليزية -> توحيد
const CANON = {
  PRE_SLEEP: ["PRE_SLEEP", "PRE SLEEP", "BEFORE SLEEP", "ق.النوم", "ق. النوم"],
  OVERNIGHT: ["OVERNIGHT", "NIGHT", "أثناء النوم"],
  FASTING: ["FASTING", "الاستيقاظ", "صيام", "Fasting"],
  PRE_BREAKFAST: ["PRE_BREAKFAST", "PRE BREAKFAST", "ق.الفطار", "ق. الفطار"],
  POST_BREAKFAST: ["POST_BREAKFAST", "POST BREAKFAST", "ب.الفطار", "ب. الفطار"],
  PRE_LUNCH: ["PRE_LUNCH", "PRE LUNCH", "ق.الغدا", "ق. الغدا"],
  POST_LUNCH: ["POST_LUNCH", "POST LUNCH", "ب.الغدا", "ب. الغدا"],
  PRE_DINNER: ["PRE_DINNER", "PRE DINNER", "ق.العشا", "ق. العشا"],
  POST_DINNER: ["POST_DINNER", "POST DINNER", "ب.العشا", "ب. العشا"],
  RANDOM: ["RANDOM", "SNACK", "سناك", "عشوائي"],
};

// بيانات الواجهة
let rows = []; // [{date: 'YYYY-MM-DD', slotKey:valueInUnit, notes:'...'}]

// ====== أدوات عامة ======
const toMmol = (val, unit) => unit === "mgdl" ? (val / MGDL_PER_MMOL) : val;
const fromMmol = (mmol, unit) =>
  unit === "mgdl" ? Math.round(mmol * MGDL_PER_MMOL) : +mmol.toFixed(1);

function classifyByMmol(mmol){
  if (mmol < HYPO_M) return "low";
  if (mmol > HYPER_M) return "high";
  return "okv";
}

// يقارن بقيمة نفس الخانة في السطر السابق
function trendArrow(currVal, prevVal, unit){
  if (currVal == null || prevVal == null) return "";
  const currM = toMmol(currVal, unit);
  const prevM = toMmol(prevVal, unit);
  const diff = currM - prevM;
  if (Math.abs(diff) < 0.2) return ""; // تجاهل ضوضاء
  return diff > 0 ? "<span class='arrow up'>▲</span>" : "<span class='arrow down'>▼</span>";
}

// تطبيع اسم خانة إلى المفتاح القانوني
function normalizeSlot(key){
  const k = (key||"").toString().trim().toUpperCase().replace(/\s+/g, " ");
  for (const canon in CANON){
    if (CANON[canon].some(s => s.toUpperCase() === k)) return canon;
  }
  return key; // كما هو إن لم نجد
}

// ====== بناء الجدول ======
function renderTable(){
  const unit = unitSelect.value; // mmol | mgdl
  tbody.innerHTML = "";

  // رؤوس الشريط
  periodUnitEl.textContent = unit === "mgdl" ? "mg/dL" : "mmol/L";
  reportNotes.textContent = notesEl.value || "";

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    // التاريخ
    const tdDate = document.createElement("td");
    tdDate.textContent = r.date || "";
    tr.appendChild(tdDate);

    // لكل خانة بالترتيب الثابت
    DISPLAY_ORDER.forEach(slotKey => {
      const td = document.createElement("td");
      const val = r[slotKey]; // القيمة مخزّنة بوحدة العرض الحالية
      if (val == null || val === ""){
        td.textContent = "-";
      } else {
        const mmol = toMmol(val, unit);
        const cls = classifyByMmol(mmol);
        if (colorizeEl.checked) td.classList.add(cls);

        // سهم مقارنة بالسطر السابق
        const prev = rows[idx-1]?.[slotKey] ?? null;
        const arrow = trendArrow(val, prev, unit);

        // القيمة + السهم
        td.innerHTML = `${arrow}${fromMmol(mmol, unit)} ${unit === "mgdl" ? "mg/dL" : "mmol/L"}`;
      }
      tr.appendChild(td);
    });

    // الملاحظات
    const tdNotes = document.createElement("td");
    tdNotes.textContent = maskTreatEl.checked ? "•••" : (r.notes || "");
    tr.appendChild(tdNotes);

    tbody.appendChild(tr);
  });
}

// ====== تحميل البيانات ======
// ملاحظة: لو Firebase متاح عالميًا ستقرأ البيانات فعليًا.
// إن لم يتوفر، سنستخدم بيانات تجريبية كي لا تتعطل الصفحة.

async function loadData(){
  const unit = unitSelect.value;

  // تواريخ
  const f = fromDateEl.value || new Date().toISOString().slice(0,10);
  const t = toDateEl.value || new Date().toISOString().slice(0,10);
  periodFromEl.textContent = f;
  periodToEl.textContent = t;

  // وضع يدوي = نموذج فارغ 14 صف
  if (manualMode.checked){
    rows = Array.from({length:14}, () => {
      const r = { date:"", notes:"" };
      DISPLAY_ORDER.forEach(k => r[k] = null);
      return r;
    });
    renderTable();
    return;
  }

  // weekly mode = أسبوع حالي (7 أيام)
  if (weeklyMode.checked){
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate()-6);
    fromDateEl.value = start.toISOString().slice(0,10);
    toDateEl.value = now.toISOString().slice(0,10);
    periodFromEl.textContent = fromDateEl.value;
    periodToEl.textContent = toDateEl.value;
  }

  // محاولة القراءة من Firebase إن وُجد
  try{
    if (window.firebase && firebase.firestore){
      const db = firebase.firestore();

      // التقاط معرّفات الوالد/الطفل من الـ URL (parent, child)
      const qs = new URLSearchParams(location.search);
      const parentId = qs.get("parent");
      const childId  = qs.get("child");

      // قراءة عتبات الطفل (إن وجدت)
      if (parentId && childId){
        const childDoc = await db
          .collection("parents").doc(parentId)
          .collection("children").doc(childId).get();
        const child = childDoc.data() || {};
        const severeLow  = +child.severeLow  || +child.severe_low  || null;
        const severeHigh = +child.severeHigh || +child.severe_high || null;
        if (!isNaN(severeLow))  HYPO_M  = severeLow;
        if (!isNaN(severeHigh)) HYPER_M = severeHigh;
      }

      // تحميل القياسات من measurements في الفترة المحددة
      const start = new Date(fromDateEl.value);
      const end   = new Date(toDateEl.value);
      end.setHours(23,59,59,999);

      // نجمع حسب اليوم
      const mapByDate = new Map();

      const q = await db.collectionGroup("measurements")
        .where("when",">=", start)
        .where("when","<=", end)
        .orderBy("when","asc").get();

      q.forEach(doc => {
        const d = doc.data();
        const dateKey = (d.date || new Date(d.when?.toDate?.() || d.when || Date.now()).toISOString().slice(0,10));
        if (!mapByDate.has(dateKey)){
          const base = { date: dateKey, notes:"" };
          DISPLAY_ORDER.forEach(k => base[k] = null);
          mapByDate.set(dateKey, base);
        }
        const row = mapByDate.get(dateKey);

        // التطبيع
        let key = normalizeSlot(d.slotKey || d.slot || "");
        if (!DISPLAY_ORDER.includes(key)) return; // نتجاهل الخانات غير المعروفة

        // القيمة محفوظة غالبًا بوحدة mg/dL أو mmol حسب d.unit
        let val = +d.value_mmol || +d.value_mgdl || +d.value || null;
        if (val == null || isNaN(val)) return;

        // نخزن القيمة بوحدة العرض الحالية:
        // إن كانت القيمة mmol ونريد mg/dL نحول … والعكس
        if (d.unit === "mg/dL" || d.unit === "mgdl"){
          const mmol = toMmol(val, "mgdl");
          val = fromMmol(mmol, unit);
        } else {
          // mmol
          val = fromMmol(val, unit);
        }

        row[key] = val;

        // الملاحظات (نجمع باختصار)
        if (d.notes && !maskTreatEl.checked){
          row.notes = (row.notes ? row.notes+" | " : "") + (d.notes || "");
        }
      });

      rows = Array.from(mapByDate.values()).sort((a,b)=> (a.date > b.date ? 1 : -1));
      renderTable();
      return;
    }
  }catch(err){
    console.error("Firebase read error:", err);
  }

  // ——— fallback بيانات تجريبية لو مفيش Firebase ———
  rows = [
    // القيم هنا بالـ mmol افتراضيًا؛ هنعرض حسب الوحدة المختارة
    mkRow("2025-09-01", {FASTING:5.6, PRE_BREAKFAST:4.1, POST_BREAKFAST:7.8, PRE_LUNCH:5.5, POST_LUNCH:9.1, PRE_DINNER:5.2, POST_DINNER:10.8, RANDOM:6.0, PRE_SLEEP:6.3, OVERNIGHT:5.8}, "OK"),
    mkRow("2025-09-02", {FASTING:3.6, PRE_BREAKFAST:3.4, POST_BREAKFAST:6.9, PRE_LUNCH:5.1, POST_LUNCH:11.2, PRE_DINNER:4.9, POST_DINNER:12.4, RANDOM:6.2, PRE_SLEEP:4.0, OVERNIGHT:4.3}, "Hypo قبل الفطار"),
    mkRow("2025-09-03", {FASTING:5.1, PRE_BREAKFAST:4.7, POST_BREAKFAST:8.8, PRE_LUNCH:6.2, POST_LUNCH:15.3, PRE_DINNER:6.1, POST_DINNER:13.9, RANDOM:6.4, PRE_SLEEP:5.5, OVERNIGHT:5.2}, "Hyper بعد الغداء"),
  ].map(r => convertRowToUnit(r, unit));

  renderTable();
}

function mkRow(date, slots, notes){
  const r = { date, notes: notes||"" };
  DISPLAY_ORDER.forEach(k => r[k] = slots[k] ?? null);
  return r;
}

function convertRowToUnit(row, unit){
  const out = { ...row };
  DISPLAY_ORDER.forEach(k => {
    if (out[k] == null) return;
    // row is mmol by default
    out[k] = fromMmol(out[k], unit);
  });
  return out;
}

// ====== الأحداث ======
applyBtn.addEventListener("click", loadData);
blankBtn.addEventListener("click", () => {
  manualMode.checked = true;
  loadData();
});
printBtn.addEventListener("click", () => window.print());

unitSelect.addEventListener("change", () => renderTable());
colorizeEl.addEventListener("change", () => renderTable());
maskTreatEl.addEventListener("change", () => renderTable());
weeklyMode.addEventListener("change", () => loadData());
manualMode.addEventListener("change", () => loadData());

// تاريخ افتراضي للأسبوع الحالي
(function initDates(){
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate()-6);
  fromDateEl.value = start.toISOString().slice(0,10);
  toDateEl.value = now.toISOString().slice(0,10);
  notesEl.value = "";
  loadData();
})();
