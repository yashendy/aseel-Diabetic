/* reports-print.js (v9)
 * - البيانات داخليًا mmol فقط، والعرض حسب الوحدة
 * - الفترة تعمل بدقة (من/إلى) مع وضع أسبوعي اختياري
 * - الملاحظات أسفل القياس داخل الخلية
 * - بيانات الطفل (الاسم/العمر/الوزن/أنسولين/CF/CR + وحدة التصحيحي) في الرأس
 * - Hypo/Hyper تلوين + أسهم اتجاه
 * - طباعة Landscape + نموذج أسبوعين في ورقة واحدة
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

// ترتيب العرض
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

// بنية الصف داخليًا: mmol + ملاحظات لكل خانة
function mkBaseRow(date){
  const slots = {};
  DISPLAY_ORDER.forEach(k => slots[k] = { mmol:null, note:"" });
  return { date, slots, rowNotes:"" };
}

const rows = []; // [{date, slots:{KEY:{mmol,note}}, rowNotes}]

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

function fmtCF(cf, unit){
  if (cf == null || cf === "" || isNaN(cf)) return "—";
  // افتراضيًا CF يُقاس mg/dL لكل 1U؛ لو عايزة mmol بدلاً من mg/dL ممكن نحسب تحويل.
  return `${cf} mg/dL لكل 1U`;
}
function fmtCR(cr){
  if (cr == null || cr === "" || isNaN(cr)) return "—";
  return `1U : ${cr}g`;
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
      const mmol = row.slots[key].mmol;
      const note = row.slots[key].note;

      if (mmol == null){
        td.textContent = "-";
      } else {
        const cls = classifyByMmol(mmol);
        if (colorizeEl.checked && cls) td.classList.add(cls);

        const prevMmol = rows[idx-1]?.slots?.[key]?.mmol ?? null;
        const arrow = trendArrow(mmol, prevMmol);

        // قيمة + (اختياري) ملاحظة أسفلها
        const valHtml = `${arrow}${fromMmol(mmol, unit)}`;
        const noteHtml = note && !maskTreatEl.checked
          ? `<div class="cell-note">${escapeHtml(note)}</div>` : "";

        td.innerHTML = `<div class="cell-wrap">${valHtml}${noteHtml}</div>`;
      }
      tr.appendChild(td);
    });

    const tdNotes = document.createElement("td");
    tdNotes.textContent = maskTreatEl.checked ? "•••" : (row.rowNotes || "");
    tr.appendChild(tdNotes);

    tbody.appendChild(tr);
  });
}

function escapeHtml(s){
  return String(s).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ===== تحميل بيانات الطفل + القياسات =====
async function loadAll(){
  // الفترة
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
    for (let i=0;i<14;i++) rows.push(mkBaseRow(""));
    render();
    return;
  }

  rows.length = 0;

  // Firebase؟
  const qs = new URLSearchParams(location.search);
  const parentId = qs.get("parent");
  const childId  = qs.get("child") || qs.get("cid"); // بديل

  try{
    if (window.firebase && firebase.firestore){
      const db = firebase.firestore();

      // بيانات الطفل
      let childData = null;
      if (parentId && childId){
        const snap = await db.collection("parents").doc(parentId)
          .collection("children").doc(childId).get();
        childData = snap.exists ? snap.data() : null;
      }
      if (!childData && childId){
        const snap2 = await db.collection("children").doc(childId).get();
        childData = snap2.exists ? snap2.data() : null;
      }

      if (childData){
        HYPO_M  = Number(childData.severeLow  ?? childData.severe_low  ?? HYPO_M);
        HYPER_M = Number(childData.severeHigh ?? childData.severe_high ?? HYPER_M);

        cName.textContent   = childData.name || "—";
        cAge.textContent    = humanAgeFromBirth(childData.birthDate || childData.birthdate);
        cWeight.textContent = childData.weight || childData.weightKg || childData.weight_kg || "—";

        const basalType = childData.basalType || childData.basal || "—";
        const basalDose = childData.basalDose || childData.basal_units || null;
        cBasal.textContent = basalDose ? `${basalType} — ${basalDose}U` : basalType;

        const bolusType = childData.bolusType || childData.rapidType || "—";
        cBolus.textContent = bolusType;

        cCF.textContent = fmtCF(childData.correctionFactor ?? childData.cf, unitSelect.value);
        cCR.textContent = fmtCR(childData.carbRatio ?? childData.cr);
      } else {
        cName.textContent = cAge.textContent = cWeight.textContent =
        cBasal.textContent = cBolus.textContent = cCF.textContent = cCR.textContent = "—";
      }

      // قياسات في الفترة المحددة
      const start = new Date(from); start.setHours(0,0,0,0);
      const end   = new Date(to);   end.setHours(23,59,59,999);

      const byDate = new Map(); // dateKey -> row
      const rowFor = (dkey) => (byDate.get(dkey) || byDate.set(dkey, mkBaseRow(dkey)).get(dkey));

      // المسار الأول (لو parent/child متاح)
      let snaps = [];
      if (parentId && childId){
        const q1 = await db.collection("parents").doc(parentId)
          .collection("children").doc(childId)
          .collection("measurements")
          .where("when", ">=", start)
          .where("when", "<=", end)
          .orderBy("when","asc").get();
        snaps = q1.docs;
      } else {
        // collectionGroup كبديل عام
        const q2 = await db.collectionGroup("measurements")
          .where("when", ">=", start)
          .where("when", "<=", end)
          .orderBy("when","asc").get();
        snaps = q2.docs;
      }

      for (const doc of snaps){
        const d = doc.data();
        const dkey = (d.date || tsToDateKey(d.when));
        const row = rowFor(dkey);

        const slot = normalizeSlot(d.slotKey || d.slot || "");
        if (!slot || !DISPLAY_ORDER.includes(slot)) continue;

        // طبّع إلى mmol داخليًا
        let mmol = null;
        if (typeof d.value_mmol === "number") mmol = d.value_mmol;
        else if (typeof d.value_mgdl === "number") mmol = d.value_mgdl / MGDL_PER_MMOL;
        else if (typeof d.value === "number"){
          if ((d.unit||"").toLowerCase().includes("mg")) mmol = d.value / MGDL_PER_MMOL;
          else mmol = d.value;
        }
        if (mmol == null || isNaN(mmol)) continue;

        row.slots[slot].mmol = mmol;

        // ملاحظة القياس (تحت الرقم)
        if (d.notes) row.slots[slot].note = String(d.notes);

        // ملاحظات الصف (حقل عام)
        if (d.rowNotes) row.rowNotes = String(d.rowNotes);
      }

      rows.push(...Array.from(byDate.values()));
      render();
      return;
    }
  } catch (e){
    console.error("Firebase error:", e);
  }

  // ——— إن لم يتوفر Firebase: بيانات تجريبية (mmol داخليًا) ———
  HYPO_M = 3.9; HYPER_M = 10.0;
  rows.push(demoRow("2025-09-01"), demoRow("2025-09-02"), demoRow("2025-09-03"));
  // بيانات طفل تجريبية
  cName.textContent = "Demo Child";
  cAge.textContent  = "11س 4ش";
  cWeight.textContent = "32";
  cBasal.textContent = "Lantus — 10U";
  cBolus.textContent = "NovoRapid";
  cCF.textContent = fmtCF(40, unitSelect.value);
  cCR.textContent = fmtCR(12);

  render();
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
  r.slots.FASTING.mmol = 5.2;
  r.slots.PRE_BREAKFAST.mmol = 4.1;
  r.slots.POST_BREAKFAST.mmol = 7.8;
  r.slots.PRE_LUNCH.mmol = 5.6;
  r.slots.POST_LUNCH.mmol = 11.2; r.slots.POST_LUNCH.note = "بعد وجبة ثقيلة";
  r.slots.PRE_DINNER.mmol = 5.4;
  r.slots.POST_DINNER.mmol = 12.6; r.slots.POST_DINNER.note = "تصحيح مطلوب";
  r.slots.RANDOM.mmol = 6.2;
  r.slots.PRE_SLEEP.mmol = 5.0;
  r.slots.OVERNIGHT.mmol = 5.6;
  r.rowNotes = "Demo";
  return r;
}

// ===== أحداث =====
applyBtn.addEventListener("click", loadAll);
blankBtn.addEventListener("click", () => { manualMode.checked = true; loadAll(); });
printBtn.addEventListener("click", () => window.print());

unitSelect.addEventListener("change", () => render());   // تحويل عرض فقط
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
