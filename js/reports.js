// js/reports.js — يقرأ من parents/.../measurements (سجل لكل قراءة) ويجمّع يوميًا
import { auth, db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر */
const $ = (id)=>document.getElementById(id);
const presetEl = $("preset");
const datesBox = $("datesBox");
const fromEl = $("from");
const toEl = $("to");
const runBtn = $("run");
const rowsEl = $("rows");
const metaEl = $("meta");
const loader = $("loader");
const navRow = $("childNav");
const nameEl = $("bannerName");
const metaHeadEl = $("bannerMeta");
const banner = $("childBanner");
const lnkHome = $("lnkHome");
const btnBlank = $("btnBlank");
const btnPrint = $("btnPrint");
const btnReportPrintPage = $("btnReportPrintPage");
const btnAnalyticsPage = $("btnAnalyticsPage");

/* أدوات */
const fmtISO = (d)=> d.toISOString().slice(0,10);
const addDays = (d, n)=>{ const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const escapeHTML = (s)=> String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
const round1 = (n)=> (Number.isFinite(Number(n))? Math.round(Number(n)*10)/10 : null);
const qs = (k)=> new URLSearchParams(location.search).get(k) || "";

/* الأوقات (ترتيب الأعمدة) + تحويل slotKey القادِم من الداتا */
const COLS = [
  ["WAKE","الاستيقاظ"],
  ["PRE_BREAKFAST","ق.الفطار"],
  ["POST_BREAKFAST","ب.الفطار"],
  ["PRE_LUNCH","ق.الغدا"],
  ["POST_LUNCH","ب.الغدا"],
  ["PRE_DINNER","ق.العشا"],
  ["POST_DINNER","ب.العشا"],
  ["SNACK","سناك"],
  ["DURING_SLEEP","أثناء النوم"],
];
// بعض السجلات قد تُحفظ بأسماء مختلفة؛ ضيفي خرائط إضافية هنا لو لزم
const SLOT_ALIAS = {
  WAKE:["WAKE","UPON_WAKE","UPONWAKE"],
  PRE_BREAKFAST:["PRE_BREAKFAST","PRE_BF","PREBREAKFAST"],
  POST_BREAKFAST:["POST_BREAKFAST","POST_BF","POSTBREAKFAST"],
  PRE_LUNCH:["PRE_LUNCH","PRELUNCH"],
  POST_LUNCH:["POST_LUNCH","POSTLUNCH"],
  PRE_DINNER:["PRE_DINNER","PREDINNER"],
  POST_DINNER:["POST_DINNER","POSTDINNER"],
  SNACK:["SNACK"],
  DURING_SLEEP:["DURING_SLEEP","NIGHT","BEFORE_SLEEP","BEFORESLEEP"] // لو عندك "قبل النوم" بدّلي الترويسة لو حبيتي
};
function normalizeSlotKey(key){
  const k = String(key||"").toUpperCase();
  for(const std in SLOT_ALIAS){
    if(SLOT_ALIAS[std].includes(k)) return std;
  }
  return null;
}

/* حالة المستخدم/المسارات */
let parentId=null, childId=null, childDoc=null;

function setLoader(v){ loader && (loader.style.display = v? "flex" : "none"); }

function buildNav(){
  if(!navRow) return;
  navRow.innerHTML = "";
  const items = [
    ["child-dashboard.html","الرئيسية"],
    ["measures.html","قياسات السكر"],
    ["meals.html","الوجبات"],
    ["reports.html","التقارير"],
    ["analytics.html","التحاليل"],
    ["visits.html","الزيارات الطبية"],
  ];
  for(const [href,label] of items){
    const a = document.createElement("a");
    a.className = "btn gray";
    a.href = `${href}?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`;
    a.textContent = label;
    a.target = (href==="analytics.html") ? "_blank" : "_self";
    a.rel = (a.target==="_blank") ? "noopener" : "";
    navRow.appendChild(a);
  }
  if(lnkHome) lnkHome.href=`child-dashboard.html?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`;
  if(btnReportPrintPage){
    btnReportPrintPage.href=`reports-print.html?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`;
    btnReportPrintPage.target="_blank"; btnReportPrintPage.rel="noopener";
  }
  if(btnAnalyticsPage){
    btnAnalyticsPage.href=`analytics.html?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`;
    btnAnalyticsPage.target="_blank"; btnAnalyticsPage.rel="noopener";
  }
}

async function loadChild(){
  const snap = await getDoc(doc(db,"parents",parentId,"children",childId));
  childDoc = snap.exists()? snap.data(): {};
  if(nameEl) nameEl.textContent = childDoc?.name || "—";
  if(metaHeadEl){
    const g = childDoc?.gender || "—";
    const w = childDoc?.weightKg ?? "—";
    const h = childDoc?.heightCm ?? "—";
    metaHeadEl.textContent = `${g} • ${w} كجم • ${h} سم`;
  }
  if(banner) banner.style.display="block";
}

/* تحويل القيمة للعرض بالـ mmol/L */
function valueToMmol(rec){
  if (typeof rec?.value_mmol === "number") return rec.value_mmol;
  if (typeof rec?.value === "number" && (rec?.unit||"").toLowerCase()==="mmol/l") return rec.value;
  const mgdl = (typeof rec?.value_mgdl === "number") ? rec.value_mgdl
             : (typeof rec?.value === "number" ? rec.value : null);
  if (mgdl==null) return null;
  return mgdl/18;
}

/* تحميل البيانات وتجميعها يوميًا */
async function fetchAggregated(fromISO, toISO){
  const col = collection(db, "parents", parentId, "children", childId, "measurements");
  const qy = query(
    col,
    where("date", ">=", fromISO),
    where("date", "<=", toISO),
    orderBy("date","asc"),
    orderBy("when","asc")
  );
  const snap = await getDocs(qy);

  // هيكل: { [date]: { [STD_SLOT]: record } }
  const byDay = {};
  snap.forEach(d=>{
    const rec = d.data();
    const date = rec?.date; if(!date) return;
    const slot = normalizeSlotKey(rec?.slotKey); if(!slot) return;
    if(!byDay[date]) byDay[date] = {};
    // لو أكتر من قراءة لنفس اليوم/الوقت: ناخد الأحدث حسب "when"
    const prev = byDay[date][slot];
    if(!prev || (rec.when && (!prev.when || (rec.when.toMillis?.()||0) > (prev.when?.toMillis?.()||0)))){
      byDay[date][slot] = rec;
    }
  });
  return byDay;
}

/* بناء الجدول */
function buildTableSkeleton(){
  const thead = document.querySelector("#rep thead tr");
  thead.innerHTML = `<th>التاريخ</th>` + COLS.map(([,ar])=>`<th>${ar}</th>`).join("");
}

function cellHTML(rec){
  if(!rec) return "—";
  const mmol = valueToMmol(rec);
  const v = round1(mmol);
  const doseParts = [];
  if (rec?.bolusDose != null)       doseParts.push(`جرعة: ${rec.bolusDose}U`);
  if (rec?.correctionDose != null)  doseParts.push(`تصحيح: ${rec.correctionDose}U`);
  const doses = doseParts.join(" • ");
  const note = rec?.notes || rec?.hypoTreatment || "";
  const noteHtml  = note ? `<div class="note">${escapeHTML(note)}</div>` : "";
  const dosesHtml = doses? `<div class="note">${escapeHTML(doses)}</div>`: "";
  return `<div><b>${v!=null ? v.toFixed(1) : "—"}</b></div>${dosesHtml}${noteHtml}`;
}

function listDates(fromISO, toISO){
  const out=[]; let d=new Date(fromISO); const end=new Date(toISO);
  while(d<=end){ out.push(fmtISO(d)); d.setDate(d.getDate()+1); }
  return out;
}

function renderTable(fromISO, toISO, byDay){
  const dates = listDates(fromISO,toISO);
  const html = dates.map(date=>{
    const day = byDay[date] || {};
    const tds = COLS.map(([std])=>`<td>${cellHTML(day[std])}</td>`).join("");
    return `<tr><td class="date">${date}</td>${tds}</tr>`;
  }).join("");
  rowsEl.innerHTML = html || `<tr><td colspan="10" class="center muted">لا توجد بيانات.</td></tr>`;
}

/* تحميل وبناء */
async function buildReport(fromISO, toISO){
  setLoader(true);
  rowsEl.innerHTML = `<tr><td colspan="10" class="center muted">جاري التحميل…</td></tr>`;
  const byDay = await fetchAggregated(fromISO, toISO);
  buildTableSkeleton();
  renderTable(fromISO, toISO, byDay);

  const unitText = "mmol/L";
  metaEl.textContent = `الفترة: ${fromISO} → ${toISO} • الوحدة: ${unitText}`;
  setLoader(false);
}

/* سلوك القائمة المنسدلة */
function applyPreset(val){
  // إظهار/إخفاء التاريخين
  const custom = (val==="custom");
  datesBox.classList.toggle("hidden", !custom);

  if(custom) return; // المستخدم سيختار يدوي

  const today = new Date();
  let days = 7;
  if(val==="14") days=14;
  else if(val==="30") days=30;
  else if(val==="90" || val==="90_only") days=90;

  const to = fmtISO(today);
  const from = fmtISO(addDays(today, -(days-1)));
  fromEl.value = from; toEl.value = to;
}

function wireUI(){
  presetEl?.addEventListener("change", ()=>{
    applyPreset(presetEl.value);
  });

  runBtn?.addEventListener("click", async ()=>{
    const val = presetEl?.value || "7";
    if(val!=="custom"){
      // preset يحدد التواريخ تلقائيًا
      applyPreset(val);
    }
    const fromISO = fromEl.value || fmtISO(addDays(new Date(), -6));
    const toISO   = toEl.value   || fmtISO(new Date());
    await buildReport(fromISO, toISO);
  });

  btnPrint?.addEventListener("click", ()=> window.print());

  btnBlank?.addEventListener("click", ()=>{
    const today=new Date();
    const days=Array.from({length:7},(_,i)=>fmtISO(addDays(today,i)));
    rowsEl.innerHTML = days.map(d=>`<tr><td class="date">${d}</td>${"<td>—</td>".repeat(9)}</tr>`).join("");
  });
}

/* إقلاع */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href="/login.html"; return; }
  parentId = qs("parent") || user.uid;
  childId  = qs("child")  || "";

  // ربط الروابط تبويب جديد (حسب طلبك)
  buildNav();
  if(btnReportPrintPage) btnReportPrintPage.target="_blank";
  if(btnAnalyticsPage)   btnAnalyticsPage.target="_blank";

  await loadChild();

  // افتراض: أسبوع
  presetEl.value = "7";
  applyPreset("7"); // يملأ from/to (مخفيين)
  wireUI();

  // تحميل أولي
  await buildReport(fromEl.value, toEl.value);
});
