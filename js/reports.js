/* التقارير – صفحة واحدة مع تبديل العروض + استرجاع بيانات Firestore */

// ===================== Firebase (تهيئة آمنة) =====================
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc,
  collection, collectionGroup,
  query, where, orderBy, getDocs,
  documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let app = null, db = null;
try {
  const cfg = getApps().length ? null : (window.firebaseConfig || null);
  app = getApps().length ? getApp() : (cfg ? initializeApp(cfg) : null);
  db  = app ? getFirestore(app) : null;
} catch (e) {
  console.warn("Firebase init warning:", e);
}

// ===================== أدوات عامة =====================
const $  = (s, p=document)=> p.querySelector(s);
const $$ = (s, p=document)=> Array.from(p.querySelectorAll(s));
function qparam(name){ const u = new URL(location.href); return u.searchParams.get(name) || ""; }
function linkWithParams(href, extra = {}) {
  const qs = new URLSearchParams();
  if (parentId) qs.set("parent", parentId);
  if (childId)  qs.set("child", childId);
  for (const [k,v] of Object.entries(extra)) if (v != null) qs.set(k, v);
  return href + (href.includes("?") ? "&" : "?") + qs.toString();
}

// ===================== الفترات (تشمل ق.النوم) =====================
const COLS = [
  ["WAKE","الاستيقاظ"],
  ["PRE_BREAKFAST","ق.الفطار"],
  ["POST_BREAKFAST","ب.الفطار"],
  ["PRE_LUNCH","ق.الغدا"],
  ["POST_LUNCH","ب.الغدا"],
  ["PRE_DINNER","ق.العشا"],
  ["POST_DINNER","ب.العشا"],
  ["SNACK","سناك"],
  ["PRE_SLEEP","ق.النوم"],
  ["DURING_SLEEP","أثناء النوم"],
];

const SLOT_ALIAS = {
  WAKE:["WAKE","UPON_WAKE","UPONWAKE"],
  PRE_BREAKFAST:["PRE_BREAKFAST","PRE_BF","PREBREAKFAST"],
  POST_BREAKFAST:["POST_BREAKFAST","POST_BF","POSTBREAKFAST"],
  PRE_LUNCH:["PRE_LUNCH","PRELUNCH"],
  POST_LUNCH:["POST_LUNCH","POSTLUNCH"],
  PRE_DINNER:["PRE_DINNER","PREDINNER"],
  POST_DINNER:["POST_DINNER","POSTDINNER"],
  SNACK:["SNACK"],
  PRE_SLEEP:["PRE_SLEEP","BEFORE_SLEEP","BEFORESLEEP","PRE-SLEEP"],
  DURING_SLEEP:["DURING_SLEEP","NIGHT"]
};
const SLOT_MAP = (()=>{ const m={}; for (const [k,a] of Object.entries(SLOT_ALIAS)) a.forEach(x=>m[x.toUpperCase()]=k); return m; })();

// ===================== تواريخ =====================
const fmtISO = (d)=> d.toISOString().slice(0,10); // كما كان
const addDays = (d, n)=> { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate()+n); return x; };

// ===================== عناصر الواجهة =====================
const presetEl=$("#preset"), datesBox=$("#datesBox"), fromEl=$("#from"), toEl=$("#to"), runEl=$("#run");
const btnPrint=$("#btnPrint"), btnBlank=$("#btnBlank"), toggleNotes=$("#toggleNotes");
const rowsEl=$("#rows"), headRowEl=$("#headRow"), metaEl=$("#meta"), loaderEl=$("#loader");
const childNav=$("#childNav"), childBanner=$("#childBanner"), bannerName=$("#bannerName"), metaHead=$("#metaHead");
const lnkHome=$("#lnkHome");
const analysisBtn=$("#btnAnalyticsPage"), reportPrintBtn=$("#btnReportPrintPage");
const headRowPrint=$("#headRowPrint"), rowsPrint=$("#rowsPrint"), analysisContainer=$("#analysisContainer");

// ===================== حالة عامة =====================
let parentId="", childId="", childInfo=null;
let limits = { severeLow:55, normalMin:70, normalMax:180, severeHigh:300 };
let currentDataByDay = {};

// ===================== مساعدات =====================
const setLoader = (v)=> loaderEl.style.display = v ? "flex" : "none";
const num = (x)=> (x==null || isNaN(+x)) ? null : +(+x).toFixed(1);
const classify = (v)=>{
  if (v==null) return null;
  if (v <= limits.severeLow) return "b-sevlow";
  if (v <  limits.normalMin) return "b-low";
  if (v <= limits.normalMax) return "b-ok";
  if (v <  limits.severeHigh) return "b-high";
  return "b-sevhigh";
};

// ===================== بانر الطفل =====================
function calcAge(birthISO){
  if(!birthISO) return "—";
  const b = new Date(birthISO), n = new Date();
  let y=n.getFullYear()-b.getFullYear(), m=n.getMonth()-b.getMonth(), d=n.getDate()-b.getDate();
  if (d<0) m--; if (m<0){ y--; m+=12; }
  return y>0 ? `${y} سنة${m?` و${m} شهر`:''}` : `${m} شهر`;
}

async function loadChild(){
  if (!db || !parentId || !childId) { bannerName.textContent="الطفل"; metaHead.textContent="—"; return null; }
  const ref = doc(db, "parents", parentId, "children", childId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { bannerName.textContent="الطفل"; metaHead.textContent="—"; return null; }
  const c = snap.data(); childInfo = c;

  const name = c.name || c.fullName || childId;
  bannerName.textContent = name;

  const age  = calcAge(c.birthDate || c.birth || c.dob);
  const carb = c.carbRatio ?? c.carb ?? "—";
  const corr = c.correctionFactor ?? c.correction ?? "—";
  metaHead.textContent = `العمر: ${age} • معامل الكارب: ${carb} • التصحيحي: ${corr}`;

  if (c.normalRange) {
    if (c.normalRange.min!=null) limits.normalMin = c.normalRange.min;
    if (c.normalRange.max!=null) limits.normalMax = c.normalRange.max;
  }
  if (c.severeLow  != null) limits.severeLow  = c.severeLow;
  if (c.severeHigh != null) limits.severeHigh = c.severeHigh;

  return c;
}

// يحاول استنتاج parent من child لو لم يُمرَّر في الرابط
async function tryResolveParentFromChildId(){
  if (!db || !childId || parentId) return;
  try {
    const q = query(collectionGroup(db, "children"), where(documentId(), "==", childId));
    const snaps = await getDocs(q);
    if (!snaps.empty) {
      const s = snaps.docs[0];
      parentId = s.ref.parent.parent.id;
      sessionStorage.setItem("lastParent", parentId);
    }
  } catch (e) {
    console.warn("resolve parent failed:", e);
  }
}

// ===================== Firestore: القياسات =====================
async function fetchMeasurements(fromISO, toISO){
  if (!db || !parentId) return [];
  const col = collection(db, "parents", parentId, "measurements");

  // المحاولة 1: حقل تاريخ ISO
  let snaps = [];
  try {
    const q1 = query(col,
      where("date", ">=", fromISO),
      where("date", "<=", toISO),
      orderBy("date","asc")
    );
    snaps = (await getDocs(q1)).docs;
  } catch(_){}

  // المحاولة 2: حقل Timestamp
  if (snaps.length === 0) {
    try {
      const fromTs = new Date(fromISO+"T00:00:00");
      const toTs   = new Date(toISO+"T23:59:59");
      const q2 = query(col,
        where("ts", ">=", fromTs),
        where("ts", "<=", toTs),
        orderBy("ts","asc")
      );
      snaps = (await getDocs(q2)).docs;
    } catch(_){}
  }

  const list = [];
  for (const d of snaps) {
    const x = d.data();
    const dateISO = x.date || (x.ts?.toDate ? fmtISO(x.ts.toDate()) : null);
    const rawSlot = (x.slot || x.period || x.timeSlot || "").toString().toUpperCase();
    const slot    = SLOT_MAP[rawSlot] || rawSlot;
    list.push({
      date: dateISO,
      slot,
      value: x.value ?? x.glucose ?? x.bg ?? null,
      bolus: x.bolus ?? x.mealBolus ?? null,
      correction: x.correction ?? x.corr ?? null,
      note: x.note ?? x.notes ?? null
    });
  }
  return list.filter(r=> r.date && r.slot);
}

function groupByDay(list){
  const byDay = {};
  for (const r of list) {
    const slotKey = SLOT_MAP[(r.slot||"").toUpperCase()] || (COLS.find(c=>c[0]===r.slot)?.[0] ?? null);
    if (!slotKey) continue;
    (byDay[r.date] ||= {})[slotKey] = { value:r.value, bolus:r.bolus, correction:r.correction, note:r.note };
  }
  return byDay;
}

// ===================== بناء الجدول =====================
function buildHead(targetRow){
  targetRow.innerHTML = "";
  const thDate = document.createElement("th");
  thDate.textContent = "التاريخ";
  thDate.className = "date";
  targetRow.appendChild(thDate);
  for (const [,label] of COLS) {
    const th = document.createElement("th");
    th.textContent = label;
    targetRow.appendChild(th);
  }
}
function buildEmptyMessage(tbody, text="لا توجد بيانات ضمن المدى المحدد"){
  const span = COLS.length + 1;
  tbody.innerHTML = `<tr><td colspan="${span}" class="center muted">${text}</td></tr>`;
}
function renderRows(tbody, byDay){
  const days = Object.keys(byDay).sort();
  if (!days.length) return buildEmptyMessage(tbody);
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
        b.textContent = (v==null ? "—" : v);

        const dot = document.createElement("span");
        dot.className = `state-dot ${cls}`;
        dot.textContent = "●";

        line.appendChild(b);
        line.appendChild(dot);
        td.appendChild(line);

        if (rec.bolus || rec.correction) {
          const dl = document.createElement("div");
          dl.className = "dose-line";
          const parts = [];
          if (rec.bolus) parts.push(`وجبة: ${rec.bolus}`);
          if (rec.correction) parts.push(`تصحيح: ${rec.correction}`);
          dl.textContent = parts.join(" • ");
          td.appendChild(dl);
        }

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

  tbody.innerHTML = "";
  tbody.appendChild(frag);
}

// ===================== بناء التقرير =====================
async function buildReport(fromISO, toISO){
  setLoader(true);
  try {
    metaEl.textContent = `من ${fromISO} إلى ${toISO}`;

    const list = await fetchMeasurements(fromISO, toISO);
    const byDay = groupByDay(list);
    currentDataByDay = byDay;

    buildHead(headRowEl); buildHead(headRowPrint);
    renderRows(rowsEl, byDay); renderRows(rowsPrint, byDay);

    if (!list.length) { buildEmptyMessage(rowsEl); buildEmptyMessage(rowsPrint); }
  } catch (e) {
    console.error(e);
    buildEmptyMessage(rowsEl, "حدث خطأ أثناء تحميل البيانات");
  } finally {
    setLoader(false);
  }
}

// ===================== العروض داخل الصفحة =====================
window.showView = function(which){
  const reportSec=$("#reportView"), analysisSec=$("#analysisView"), printSec=$("#printView");
  [reportSec,analysisSec,printSec].forEach(el=>el?.classList.add("hidden"));
  if (which==="analysis"){ analysisSec?.classList.remove("hidden"); buildAnalysis(); }
  else if (which==="print"){ printSec?.classList.remove("hidden"); }
  else { reportSec?.classList.remove("hidden"); }
};

function buildAnalysis(){
  if (!currentDataByDay || !Object.keys(currentDataByDay).length) {
    analysisContainer.textContent = "لا توجد بيانات لعرض التحليلات.";
    return;
  }
  let total=0, count=0;
  for (const d of Object.values(currentDataByDay))
    for (const r of Object.values(d))
      if (r?.value!=null){ total+=+r.value; count++; }
  analysisContainer.innerHTML = `<div class="badge b-ok">متوسط القياسات: ${count ? (total/count).toFixed(1) : "—"}</div>`;
}

// ===================== واجهة المستخدم =====================
function applyPreset(val){
  const today = new Date(); let from=null, to=null;
  if (val==="custom"){ datesBox.classList.remove("hidden"); fromEl.focus(); return; }
  datesBox.classList.add("hidden");
  if (val==="90_only"){ to=today; from=addDays(today,-89); }
  else { const days=Number(val||7); to=today; from=addDays(today, -(days-1)); }
  fromEl.value = fmtISO(from); toEl.value = fmtISO(to);
}

function wireUI(){
  toggleNotes?.addEventListener("change", ()=>{
    document.body.classList.toggle("notes-hidden", !toggleNotes.checked);
  });

  presetEl?.addEventListener("change", ()=> applyPreset(presetEl.value));

  runEl?.addEventListener("click", ()=>{
    const p = presetEl.value;
    if (p !== "custom") applyPreset(p);
    const fromISO = fromEl.value;
    const toISO   = toEl.value || fmtISO(new Date());
    buildReport(fromISO, toISO);
    showView("report");
  });

  btnPrint?.addEventListener("click", ()=> window.print());

  btnBlank?.addEventListener("click", ()=>{
    const start = new Date();
    const days = Array.from({length:7}, (_,i)=> fmtISO(addDays(start, i)));
    const byDay = {}; for (const d of days) byDay[d] = {};
    currentDataByDay = byDay;
    buildHead(headRowEl); buildHead(headRowPrint);
    renderRows(rowsEl, byDay); renderRows(rowsPrint, byDay);
    metaEl.textContent = "ورقة فارغة للأسبوع القادم";
  });

  analysisBtn?.addEventListener("click", (e)=>{ e.preventDefault(); showView("analysis"); });
  reportPrintBtn?.addEventListener("click", (e)=>{ e.preventDefault(); showView("print"); });
  $("#btnRecalcAnalysis")?.addEventListener("click", ()=> buildAnalysis());

  if (lnkHome) lnkHome.href = parentId ? `parent.html?parent=${encodeURIComponent(parentId)}` : "parent.html";
}

// شريط التنقّل (يمرّر ?parent&child)
function buildNav(){
  const nav = [
    ["parent.html","الرئيسية","page"],
    ["measurements.html","قياسات السكر","page"],
    ["meals.html","الوجبات","page"],
    ["reports.html","التقارير","self"],
    ["#","التحاليل","view:analysis"],
    ["visits.html","الزيارات الطبية","page"],
  ];
  childNav.innerHTML = "";
  for (const [href, label, type] of nav) {
    const a = document.createElement("a");
    a.className = "btn gray";
    a.textContent = label;

    if (type && type.startsWith("view:")) {
      a.href = "#";
      a.addEventListener("click", (e)=>{ e.preventDefault(); showView(type.split(":")[1]); });
    } else if (type === "self") {
      a.href = linkWithParams("reports.html");
    } else {
      a.href = linkWithParams(href);
    }
    childNav.appendChild(a);
  }
}

// ===================== بدء التشغيل =====================
async function main(){
  try {
    parentId = qparam("parent") || sessionStorage.getItem("lastParent") || "";
    childId  = qparam("child")  || sessionStorage.getItem("lastChild")  || "";

    if (!parentId && childId) {               // يستنتج الـ parent إذا كان مفقودًا
      await tryResolveParentFromChildId();
    }

    if (parentId) sessionStorage.setItem("lastParent", parentId);
    if (childId)  sessionStorage.setItem("lastChild",  childId);

    childBanner.style.display = "block";
    await loadChild();                         // اسم الطفل + بياناته

    wireUI();                                  // تفعيل الأزرار
    buildNav();                                // شريط التنقّل
    applyPreset("14");                         // افتراضي
    runEl.click();                             // بناء التقرير مباشرة
  } catch (err) {
    console.error(err);
    metaEl.textContent = "حدثت مشكلة في التهيئة. تأكدي من ملف Firebase.";
  }
}
document.addEventListener("DOMContentLoaded", main);
