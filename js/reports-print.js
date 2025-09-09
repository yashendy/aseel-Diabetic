/* reports-print.js (v8)
 * - تحويل داخلي mmol فقط، والعرض حسب الوحدة المختارة
 * - إزالة اسم الوحدة من الخلايا (أرقام + أسهم فقط)
 * - بيانات الطفل أعلى التقرير
 * - تلوين Hypo/Hyper + سهام اتجاه
 * - Landscape print + نموذج أسبوعين في ورقة واحدة
 */

// عناصر DOM
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
const applyBtn     = document.getElementById("applyBtn");
const printBtn     = document.getElementById("printBtn");
const blankBtn     = document.getElementById("blankBtn");

// Chips بيانات الطفل
const cName   = document.getElementById("cName");
const cAge    = document.getElementById("cAge");
const cWeight = document.getElementById("cWeight");
const cBasal  = document.getElementById("cBasal");
const cBolus  = document.getElementById("cBolus");
const cCF     = document.getElementById("cCF");
const cCR     = document.getElementById("cCR");

// ثوابت
const MGDL_PER_MMOL = 18;

// عتبات hypo/hyper بالـ mmol (تُحدَّث من وثيقة الطفل إن وجدت)
let HYPO_M = 3.9;
let HYPER_M = 10.0;

// خريطة الخانات (القيم تُحفظ داخليًا بالـ mmol)
const DISPLAY_ORDER = [
  "FASTING",
  "PRE_BREAKFAST","POST_BREAKFAST",
  "PRE_LUNCH","POST_LUNCH",
  "PRE_DINNER","POST_DINNER",
  "RANDOM",
  "PRE_SLEEP",
  "OVERNIGHT",
];

// مرادفات لتطبيع slotKey
const CANON = {
  FASTING: ["FASTING","Fasting","الاستيقاظ","صيام"],
  PRE_BREAKFAST: ["PRE_BREAKFAST","PRE BREAKFAST","ق.الفطار","ق. الفطار"],
  POST_BREAKFAST:["POST_BREAKFAST","POST BREAKFAST","ب.الفطار","ب. الفطار"],
  PRE_LUNCH: ["PRE_LUNCH","PRE LUNCH","ق.الغدا","ق. الغدا"],
  POST_LUNCH: ["POST_LUNCH","POST LUNCH","ب.الغدا","ب. الغدا"],
  PRE_DINNER: ["PRE_DINNER","PRE DINNER","ق.العشا","ق. العشا"],
  POST_DINNER:["POST_DINNER","POST DINNER","ب.العشا","ب. العشا"],
  RANDOM: ["RANDOM","SNACK","سناك","RANDOM MEAL","RANDOM GLUCOSE"],
  PRE_SLEEP: ["PRE_SLEEP","PRE SLEEP","BEFORE SLEEP","ق.النوم","ق. النوم"],
  OVERNIGHT: ["OVERNIGHT","NIGHT","أثناء النوم"]
};

const rows = []; // [{date:string, slots:{key:mmol|null}, notes:string}]
function mkBaseRow(date){ return { date, slots:Object.fromEntries(DISPLAY_ORDER.map(k=>[k,null])), notes:"" }; }

// ===== أدوات =====
const toMmol = (val, unit) => unit === "mgdl" ? (val / MGDL_PER_MMOL) : val;
const fromMmol = (mmol, unit) =>
  unit === "mgdl" ? Math.round(mmol * MGDL_PER_MMOL) : +mmol.toFixed(1);

function normalizeSlot(key){
  const K = (key||"").toString().trim().toUpperCase().replace(/\s+/g," ");
  for (const canon in CANON){
    if (CANON[canon].some(s => s.toUpperCase() === K)) return canon;
  }
  return null;
}

function classifyByMmol(mmol){
  if (mmol == null || isNaN(mmol)) return null;
  if (mmol < HYPO_M) return "low";
  if (mmol > HYPER_M) return "high";
  return "okv";
}

function trendArrow(currMmol, prevMmol){
  if (currMmol == null || prevMmol == null) return "";
  const diff = currMmol - prevMmol;
  if (Math.abs(diff) < 0.2) return "";
  return diff > 0 ? "<span class='arrow up'>▲</span>" : "<span class='arrow down'>▼</span>";
}

function humanAgeFromBirth(dateStr){
  if (!dateStr) return "—";
  const bd = new Date(dateStr);
  if (isNaN(+bd)) return "—";
  const now = new Date();
  let years = now.getFullYear() - bd.getFullYear();
  let months = now.getMonth() - bd.getMonth();
  if (months < 0){ years -= 1; months += 12; }
  return `${years}س ${months}ش`;
}

// ===== ريندر الجدول =====
function render(){
  const unit = unitSelect.value; // mmol | mgdl
  tbody.innerHTML = "";
  periodUnitEl.textContent = unit === "mgdl" ? "mg/dL" : "mmol/L";
  reportNotes.textContent = notesEl.value || "";

  rows.sort((a,b)=> a.date.localeCompare(b.date));

  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.textContent = row.date || "";
    tr.appendChild(tdDate);

    DISPLAY_ORDER.forEach(key => {
      const td = document.createElement("td");
      const mmol = row.slots[key]; // داخليًا mmol
      if (mmol == null){
        td.textContent = "-";
      } else {
        // تلوين الخلية
        const cls = classifyByMmol(mmol);
        if (colorizeEl.checked && cls) td.classList.add(cls);

        // سهم الاتجاه بمقارنة صف سابق
        const prevMmol = rows[idx-1]?.slots?.[key] ?? null;
        const arrow = trendArrow(mmol, prevMmol);

        // الرقم فقط (لا وحدة داخل الخلية)
        td.innerHTML = `${arrow}${fromMmol(mmol, unit)}`;
      }
      tr.appendChild(td);
    });

    const tdNotes = document.createElement("td");
    tdNotes.textContent = maskTreatEl.checked ? "•••" : (row.notes || "");
    tr.appendChild(tdNotes);

    tbody.appendChild(tr);
  });
}

// ===== تحميل بيانات الطفل + القياسات =====
async function loadAll(){
  // تواريخ
  let from = fromDateEl.value;
  let to   = toDateEl.value;

  if (weeklyMode.checked){
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate()-6);
    from = start.toISOString().slice(0,10);
    to   = now.toISOString().slice(0,10);
    fromDateEl.value = from; toDateEl.value = to;
  }

  if (!from) from = new Date().toISOString().slice(0,10);
  if (!to)   to   = new Date().toISOString().slice(0,10);

  periodFromEl.textContent = from;
  periodToEl.textContent   = to;

  // نموذج يدوي فارغ (14 صف)
  if (manualMode.checked){
    rows.length = 0;
    for (let i=0;i<14;i++){
      rows.push(mkBaseRow(""));
    }
    render();
    return;
  }

  // إعادة ضبط
  rows.length = 0;

  // Firebase؟
  const qs = new URLSearchParams(location.search);
  const parentId = qs.get("parent");
  const childId  = qs.get("child");

  try{
    if (window.firebase && firebase.firestore){
      const db = firebase.firestore();

      // بيانات الطفل
      if (parentId && childId){
        const childSnap = await db.collection("parents").doc(parentId)
          .collection("children").doc(childId).get();
        const ch = childSnap.data() || {};

        // عتبات
        HYPO_M  = Number(ch.severeLow  ?? ch.severe_low  ?? HYPO_M);
        HYPER_M = Number(ch.severeHigh ?? ch.severe_high ?? HYPER_M);

        // Chips
        cName.textContent   = ch.name || "—";
        cAge.textContent    = humanAgeFromBirth(ch.birthDate || ch.birthdate);
        cWeight.textContent = ch.weight || ch.weightKg || ch.weight_kg || "—";

        const basalType = ch.basalType || ch.basal || "—";
        const basalDose = ch.basalDose || ch.bolusDose || ch.basal_units || null;
        cBasal.textContent = basalDose ? `${basalType} — ${basalDose}U` : basalType;

        const bolusType = ch.bolusType || ch.rapidType || "—";
        cBolus.textContent = bolusType;

        cCF.textContent = ch.correctionFactor ?? ch.cf ?? "—";
        cCR.textContent = ch.carbRatio ?? ch.cr ?? "—";
      }

      // قياسات من مسار الطفل المحدد (مفضل)
      const start = new Date(from); start.setHours(0,0,0,0);
      const end   = new Date(to);   end.setHours(23,59,59,999);

      const map = new Map(); // dateKey -> row
      function rowFor(dateKey){
        if (!map.has(dateKey)) map.set(dateKey, mkBaseRow(dateKey));
        return map.get(dateKey);
      }

      if (parentId && childId){
        const qs1 = await db.collection("parents").doc(parentId)
          .collection("children").doc(childId)
          .collection("measurements")
          .where("when", ">=", start)
          .where("when", "<=", end)
          .orderBy("when","asc").get();

        qs1.forEach(doc => addDocToRows(doc.data(), rowFor, maskTreatEl.checked));
      } else {
        // بديل: collectionGroup (لو ما وصلنا للـ path)
        const qs2 = await db.collectionGroup("measurements")
          .where("when", ">=", start)
          .where("when", "<=", end)
          .orderBy("when","asc").get();

        qs2.forEach(doc => addDocToRows(doc.data(), rowFor, maskTreatEl.checked));
      }

      rows.push(...Array.from(map.values()));
      render();
      return;
    }
  } catch (e){
    console.error("Firebase error:", e);
  }

  // إن لم يتوفر Firebase — بيانات تجريبية (mmol داخليًا)
  HYPO_M = 3.9; HYPER_M = 10;
  rows.push(
    demoRow("2025-09-01"),
    demoRow("2025-09-02"),
    demoRow("2025-09-03")
  );
  render();
}

function addDocToRows(d, rowFor, maskNotes){
  const dateKey = (d.date || tsToDateKey(d.when));
  const row = rowFor(dateKey);

  // Normalize slot
  const slot = normalizeSlot(d.slotKey || d.slot || "");
  if (!slot || !DISPLAY_ORDER.includes(slot)) return;

  // استخرج القيمة وطبّعها إلى mmol داخليًا
  let mmol = null;
  if (typeof d.value_mmol === "number") mmol = d.value_mmol;
  else if (typeof d.value_mgdl === "number") mmol = d.value_mgdl / MGDL_PER_MMOL;
  else if (typeof d.value === "number"){
    if ((d.unit||"").toLowerCase().includes("mg")) mmol = d.value / MGDL_PER_MMOL;
    else mmol = d.value; // مفترض mmol
  }
  if (mmol == null || isNaN(mmol)) return;

  row.slots[slot] = mmol;

  if (d.notes && !maskNotes){
    row.notes = (row.notes ? row.notes+" | " : "") + d.notes;
  }
}

function tsToDateKey(when){
  try{
    if (!when) return new Date().toISOString().slice(0,10);
    if (when.toDate) return when.toDate().toISOString().slice(0,10);
    const t = new Date(when);
    return isNaN(+t) ? new Date().toISOString().slice(0,10) : t.toISOString().slice(0,10);
  }catch{ return new Date().toISOString().slice(0,10); }
}

// بيانات تجريبية
function demoRow(date){
  const r = mkBaseRow(date);
  r.slots.FASTING = 5.2;
  r.slots.PRE_BREAKFAST = 4.1;
  r.slots.POST_BREAKFAST = 7.8;
  r.slots.PRE_LUNCH = 5.6;
  r.slots.POST_LUNCH = 11.2;
  r.slots.PRE_DINNER = 5.4;
  r.slots.POST_DINNER = 12.6;
  r.slots.RANDOM = 6.2;
  r.slots.PRE_SLEEP = 5.0;
  r.slots.OVERNIGHT = 5.6;
  r.notes = "Demo";
  return r;
}

// ===== أحداث =====
applyBtn.addEventListener("click", loadAll);
blankBtn.addEventListener("click", () => { manualMode.checked = true; loadAll(); });
printBtn.addEventListener("click", () => window.print());

unitSelect.addEventListener("change", () => render());
colorizeEl.addEventListener("change", () => render());
maskTreatEl.addEventListener("change", () => render());
weeklyMode.addEventListener("change", () => loadAll());
manualMode.addEventListener("change", () => loadAll());

// تواريخ افتراضية (أسبوع حالي)
(function init(){
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate()-6);
  fromDateEl.value = start.toISOString().slice(0,10);
  toDateEl.value   = now.toISOString().slice(0,10);
  notesEl.value = "";
  loadAll();
})();
