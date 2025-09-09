/* التقارير — كل الإضافات بدون حذف أي جزء شغّال */

/* استيراد Firestore من موديولك */
import { db } from "./firebase-config.js";

import {
  doc, getDoc,
  collection, query, where, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== أدوات عامة ===== */
const $  = (s, p=document)=> p.querySelector(s);
const $$ = (s, p=document)=> Array.from(p.querySelectorAll(s));
const fmtISO = (d)=> d.toISOString().slice(0,10);
const addDays = (d,n)=>{ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; };
function qparam(name){ const u = new URL(location.href); return u.searchParams.get(name) || ""; }
function linkWithParams(href, extra = {}) {
  const qs = new URLSearchParams();
  if (parentId) qs.set("parent", parentId);
  if (childId)  qs.set("child", childId);
  for (const [k,v] of Object.entries(extra)) if (v != null) qs.set(k, v);
  return href + (href.includes("?") ? "&" : "?") + qs.toString();
}

/* ===== عناصر الواجهة ===== */
const presetEl=$("#preset"), datesBox=$("#datesBox"), fromEl=$("#from"), toEl=$("#to"), runEl=$("#run");
const btnPrint=$("#btnPrint"), btnBlank=$("#btnBlank"), toggleNotes=$("#toggleNotes");
const rowsEl=$("#rows"), headRowEl=$("#headRow"), metaEl=$("#meta"), loaderEl=$("#loader");
const childNav=$("#childNav"), childBanner=$("#childBanner"), bannerName=$("#bannerName"), metaHead=$("#metaHead");
const lnkHome=$("#lnkHome");
const analysisBtn=$("#btnAnalyticsPage"), reportPrintBtn=$("#btnReportPrintPage");
const headRowPrint=$("#headRowPrint"), rowsPrint=$("#rowsPrint"), analysisContainer=$("#analysisContainer");
const childInfoCard=$("#childInfoCard"), childInfoContent=$("#childInfoContent");
const printHeader=$("#printHeader");
const hypoInput=$("#hypoInput"), hyperInput=$("#hyperInput");
const analysisNumbers=$("#analysisNumbers"), smartSummary=$("#smartSummary");
const doughnutCanvas = $("#doughnutChart");
const btnCompare=$("#btnCompare"), cmpFrom=$("#cmpFrom"), cmpTo=$("#cmpTo");
const chkPrintNotes=$("#chkPrintNotes"), btnPrintPDF=$("#btnPrintPDF"), btnPrintBlank=$("#btnPrintBlank");

/* ===== حالة عامة ===== */
let parentId="", childId="", childDoc=null;
let limits = { severeLow:55/18, normalMin:70/18, normalMax:180/18, severeHigh:300/18 }; // mmol/L
let currentDataByDay = {};
let chartInst = null;

/* ===== فترات اليوم (تشمل ق.النوم) ===== */
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
function normalizeSlotKey(k){
  const x = String(k||"").toUpperCase();
  for (const std in SLOT_ALIAS) if (SLOT_ALIAS[std].includes(x)) return std;
  return null;
}

/* ===== مساعدات ===== */
const setLoader = (v)=> loaderEl && (loaderEl.style.display = v ? "flex" : "none");
const round1 = (n)=> (Number.isFinite(+n) ? Math.round(+n*10)/10 : null);

/* تحويل أي قيمة إلى mmol/L */
function toMmol(rec){
  if (typeof rec?.value_mmol === "number") return rec.value_mmol;
  if (typeof rec?.value === "number" && (rec?.unit||"").toLowerCase()==="mmol/l") return rec.value;
  const mgdl = (typeof rec?.value_mgdl === "number") ? rec.value_mgdl
              : (typeof rec?.value === "number" ? rec.value : null);
  return (mgdl==null) ? null : (mgdl/18);
}

/* تصنيف قيمة واحدة بناءً على حدود الطفل */
function classifyByLimits(v){
  if (!Number.isFinite(v)) return "b-ok";
  if (limits.severeLow!=null && v <= limits.severeLow) return "b-sevlow";
  if (limits.normalMin!=null && v <  limits.normalMin) return "b-low";
  if (limits.severeHigh!=null && v >= limits.severeHigh) return "b-sevhigh";
  if (limits.normalMax!=null && v >  limits.normalMax) return "b-high";
  return "b-ok";
}

/* ===== بطاقة بيانات الطفل ===== */
function renderChildInfoCard(c){
  if (!c) return;
  const ageTxt = (()=> {
    const dob = c?.birthDate || c?.dob; if(!dob) return "—";
    const b = new Date(dob), n=new Date();
    let y=n.getFullYear()-b.getFullYear(), m=n.getMonth()-b.getMonth(), d=n.getDate()-b.getDate();
    if (d<0) m--; if (m<0){ y--; m+=12; }
    return y>0 ? `${y} سنة${m?` و${m} شهر`:''}` : `${m} شهر`;
  })();
  const carb = c?.carbRatio ?? c?.carb ?? "—";
  const corr = c?.correctionFactor ?? c?.correction ?? "—";
  const gender = c?.gender ?? "—";
  const weight = (c?.weight!=null)? `${c.weight} كجم` : "—";
  const height = (c?.height!=null)? `${c.height} سم` : "—";
  const device = c?.device ?? "—";
  const basal  = c?.insulin?.basal ?? c?.basal ?? "—";
  const bolus  = c?.insulin?.bolus ?? c?.bolus ?? "—";
  const nmin = c?.normalRange?.min ?? round1(limits.normalMin);
  const nmax = c?.normalRange?.max ?? round1(limits.normalMax);

  childInfoContent.innerHTML = `
    <b>الاسم:</b> ${c?.name || "—"} •
    <b>العمر:</b> ${ageTxt} •
    <b>الجنس:</b> ${gender} •
    <b>الوزن:</b> ${weight} •
    <b>الطول:</b> ${height} •
    <b>الجهاز:</b> ${device} •
    <b>الإنسولين</b>: <b>Basal:</b> ${basal} • <b>Bolus:</b> ${bolus} •
    <b>النطاق:</b> ${nmin}–${nmax} mmol/L •
    <b>CR:</b> ${carb} g/U • <b>CF:</b> ${corr} mmol/L/U
  `;

  childInfoCard.classList.remove("hidden");

  // نسخة مصغرة للطباعة
  printHeader.textContent = childInfoContent.textContent;
}

/* ===== رأس الجدول ===== */
function buildHead(row){
  row.innerHTML = "";
  const thDate = document.createElement("th"); thDate.textContent="التاريخ"; thDate.className="date"; row.appendChild(thDate);
  for (const [,label] of COLS){ const th=document.createElement("th"); th.textContent=label; row.appendChild(th); }
}
function emptyRows(tbody, txt="لا توجد بيانات ضمن المدى المحدد"){
  tbody.innerHTML = `<tr><td colspan="${COLS.length+1}" class="center muted">${txt}</td></tr>`;
}

/* ===== الصفوف (القيمة + الملاحظات/الجرعات تحت كل قياس) ===== */
function renderRows(tbody, byDay){
  const days = Object.keys(byDay).sort();
  if (!days.length){ emptyRows(tbody); return; }
  const frag = document.createDocumentFragment();

  for (const d of days){
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.className="date";
    tdDate.textContent=d;
    tr.appendChild(tdDate);

    const prev = byDay[fmtISO(addDays(new Date(d),-1))] || {};

    for (const [slot] of COLS){
      const td = document.createElement("td");
      const rec = byDay[d]?.[slot]; const prevRec = prev?.[slot];
      if (rec){
        const mmol = toMmol(rec); const v = round1(mmol);
        const cls = classifyByLimits(mmol);

        const val = document.createElement("div"); val.className="value-line";
        const b = document.createElement("b"); b.textContent = (v!=null ? v.toFixed(1) : "—");
        const dot = document.createElement("span"); dot.className=`state-dot ${cls}`; dot.textContent="●";
        val.appendChild(b); val.appendChild(dot); td.appendChild(val);

        if (rec?.bolusDose!=null || rec?.correctionDose!=null){
          const dl = document.createElement("div"); dl.className="dose-line";
          const parts=[]; if(rec.bolusDose!=null) parts.push(`جرعة: ${rec.bolusDose}U`);
          if(rec.correctionDose!=null) parts.push(`تصحيح: ${rec.correctionDose}U`);
          dl.textContent = parts.join(" • "); td.appendChild(dl);
        }
        if (rec?.notes || rec?.hypoTreatment){
          const nl = document.createElement("div"); nl.className="note-line";
          nl.textContent = rec.notes || rec.hypoTreatment || ""; td.appendChild(nl);
        }
      } else td.textContent="—";
      tr.appendChild(td);
    }

    frag.appendChild(tr);
  }

  tbody.innerHTML=""; tbody.appendChild(frag);
}

/* ===== جلب بيانات الطفل + الحدود ===== */
async function loadChild(){
  const snap = await getDoc(doc(db, "parents", parentId, "children", childId));
  childDoc = snap.exists() ? snap.data() : {};
  bannerName.textContent = childDoc?.name || "الطفل";

  // metaHead القديم يظل كما هو
  const ageTxt = (()=> {
    const dob = childDoc?.birthDate || childDoc?.dob; if(!dob) return "—";
    const b = new Date(dob), n=new Date();
    let y=n.getFullYear()-b.getFullYear(), m=n.getMonth()-b.getMonth(), d=n.getDate()-b.getDate();
    if (d<0) m--; if (m<0){ y--; m+=12; }
    return y>0 ? `${y} سنة${m?` و${m} شهر`:''}` : `${m} شهر`;
  })();
  if (metaHead) {
    const carb = childDoc?.carbRatio ?? childDoc?.carb ?? "—";
    const corr = childDoc?.correctionFactor ?? childDoc?.correction ?? "—";
    metaHead.textContent = `العمر: ${ageTxt} • معامل الكارب: ${carb} • التصحيحي: ${corr}`;
  }

  // حدود الطفل
  if (childDoc?.normalRange){
    if (childDoc.normalRange.min!=null) limits.normalMin = +childDoc.normalRange.min;
    if (childDoc.normalRange.max!=null) limits.normalMax = +childDoc.normalRange.max;
    if (childDoc.normalRange.severeLow!=null) limits.severeLow = +childDoc.normalRange.severeLow;
    if (childDoc.normalRange.severeHigh!=null) limits.severeHigh = +childDoc.normalRange.severeHigh;
  }

  renderChildInfoCard(childDoc);

  // حطّ القيم الافتراضية لحقول Hypo/Hyper في التحاليل
  hypoInput.value  = (limits.normalMin ?? 3.9).toFixed(1);
  hyperInput.value = (limits.normalMax ?? 10.0).toFixed(1);
}

/* ===== القياسات: نفس مسار النسخة القديمة ===== */
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

  const byDay = {};
  snap.forEach(docSnap=>{
    const r = docSnap.data();
    const date = r?.date; if(!date) return;
    const slot = normalizeSlotKey(r?.slotKey || r?.slot || r?.period || r?.timeSlot);
    if(!slot) return;
    (byDay[date] ||= {});
    const prev = byDay[date][slot];
    const currTs = r?.when?.toMillis ? r.when.toMillis() : (r?.when || 0);
    const prevTs = prev?.when?.toMillis ? prev.when.toMillis() : (prev?.when || 0);
    if(!prev || currTs >= prevTs) byDay[date][slot] = r;
  });
  return byDay;
}

/* ===== بناء التقرير ===== */
async function buildReport(fromISO, toISO){
  setLoader(true);
  try{
    metaEl.textContent = `من ${fromISO} إلى ${toISO}`;
    buildHead(headRowEl); buildHead(headRowPrint);
    rowsEl.innerHTML = `<tr><td colspan="${COLS.length+1}" class="center muted">جاري التحميل…</td></tr>`;
    const byDay = await fetchAggregated(fromISO, toISO);
    currentDataByDay = byDay;
    renderRows(rowsEl, byDay);
    renderRows(rowsPrint, byDay);
    if (!Object.keys(byDay).length){
      emptyRows(rowsEl);
      emptyRows(rowsPrint);
    }
  }catch(e){
    console.error(e);
    emptyRows(rowsEl, "حدث خطأ أثناء تحميل البيانات");
  }finally{
    setLoader(false);
  }
}

/* ===== التحاليل ===== */
function computeStats(byDay, hypo, hyper){
  let hypoC=0, normC=0, hyperC=0, sum=0, cnt=0;
  const perSlotCounts = {}; // لمعرفة أكثر فترة خروجًا
  for (const day of Object.values(byDay)){
    for (const [slot, rec] of Object.entries(day)){
      const v = toMmol(rec);
      if (v==null) continue;
      cnt++; sum += v;
      if (v < hypo){ hypoC++; perSlotCounts[slot]=(perSlotCounts[slot]||0)+1; }
      else if (v > hyper){ hyperC++; perSlotCounts[slot]=(perSlotCounts[slot]||0)+1; }
      else { normC++; }
    }
  }
  const avg = cnt ? +(sum/cnt).toFixed(1) : null;
  const tir = cnt ? Math.round((normC/cnt)*100) : 0;
  // أكثر فترة خروجًا عن النطاق
  let worstSlot=null, wVal=0;
  for (const [s,c] of Object.entries(perSlotCounts)){ if(c>wVal){wVal=c; worstSlot=s;} }
  return {hypo:hypoC, normal:normC, hyper:hyperC, avg, tir, worstSlot, total:cnt};
}

function buildAnalytics(){
  if (!currentDataByDay || !Object.keys(currentDataByDay).length) {
    analysisNumbers.innerHTML = `<div class="muted">لا توجد بيانات لعرض التحاليل.</div>`;
    smartSummary.textContent = "";
    if (chartInst) { chartInst.destroy(); chartInst=null; }
    return;
  }
  const hypo  = parseFloat(hypoInput.value)  || 3.9;
  const hyper = parseFloat(hyperInput.value) || 10.0;

  const st = computeStats(currentDataByDay, hypo, hyper);

  analysisNumbers.innerHTML = `
    <div class="badge b-ok">المتوسط: ${st.avg ?? "—"} mmol/L</div>
    <div class="badge b-ok">ضمن النطاق: ${st.tir}%</div>
    <div class="badge b-low">هبوط: ${st.hypo}</div>
    <div class="badge b-high">ارتفاع: ${st.hyper}</div>
  `;

  // ملخص ذكي مبسّط (بدون خوادم)
  const tips = [];
  if (st.tir < 60) tips.push("النطاق منخفض — راجعي أهداف الوجبات والتصحيح.");
  if (st.hypo > st.hyper) tips.push("الهبوطات أكثر من الارتفاعات — فكري في تقليل جرعات الوجبات أو التصحيح.");
  if (st.hyper > st.hypo) tips.push("الارتفاعات أعلى — ربما نحتاج زيادة طفيفة في التصحيح أو مراجعة الكارب.");
  if (st.worstSlot) tips.push(`أكثر فترة خروجًا: ${COLS.find(c=>c[0]===st.worstSlot)?.[1] || st.worstSlot}.`);
  smartSummary.textContent = tips.join(" ");

  // Doughnut Hypo/Normal/Hyper
  if (chartInst) chartInst.destroy();
  chartInst = new Chart(doughnutCanvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: ["هبوط", "طبيعي", "ارتفاع"],
      datasets: [{
        data: [st.hypo, st.normal, st.hyper]
      }]
    },
    options: { responsive:true, plugins:{ legend:{ position:"bottom" } } }
  });
}

/* مقارنة فترتين */
async function buildComparison(){
  const f = cmpFrom.value, t = cmpTo.value;
  if (!f || !t){ $("#compareArea").innerHTML = `<div class="muted">اختاري فترة ثانية ثم اضغطي "قارن".</div>`; return; }
  const other = await fetchAggregated(f, t);
  const hypo  = parseFloat(hypoInput.value)  || 3.9;
  const hyper = parseFloat(hyperInput.value) || 10.0;

  const A = computeStats(currentDataByDay, hypo, hyper);
  const B = computeStats(other,             hypo, hyper);

  const diffAvg = (A.avg!=null && B.avg!=null) ? (A.avg - B.avg).toFixed(1) : "—";
  const diffTir = (A.tir - B.tir);

  $("#compareArea").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      <div class="card"><b>الفترة الحالية</b>
        <div>متوسط: ${A.avg ?? "—"}</div>
        <div>ضمن النطاق: ${A.tir}%</div>
        <div>هبوط/طبيعي/ارتفاع: ${A.hypo}/${A.normal}/${A.hyper}</div>
      </div>
      <div class="card"><b>الفترة المقارنة</b>
        <div>متوسط: ${B.avg ?? "—"}</div>
        <div>ضمن النطاق: ${B.tir}%</div>
        <div>هبوط/طبيعي/ارتفاع: ${B.hypo}/${B.normal}/${B.hyper}</div>
      </div>
      <div class="card"><b>الفروقات</b>
        <div>Δ متوسط: ${diffAvg}</div>
        <div>Δ ضمن النطاق: ${diffTir > 0 ? "+"+diffTir : diffTir}%</div>
      </div>
    </div>
  `;
}

/* ===== بدائل الطباعة ===== */
function syncPrintNotes(){
  const pv = $("#printView");
  pv.classList.toggle("notes-hidden", !chkPrintNotes.checked);
}

/* ===== واجهة المستخدم ===== */
function applyPreset(val){
  const custom = (val==="custom");
  datesBox.classList.toggle("hidden", !custom);
  if (custom) return;
  const today = new Date();
  let days = 7;
  if (val==="14") days=14; else if (val==="30") days=30; else if(val==="90"||val==="90_only") days=90;
  const to = fmtISO(today), from = fmtISO(addDays(today, -(days-1)));
  fromEl.value = from; toEl.value = to;
}

function wireUI(){
  toggleNotes?.addEventListener("change", ()=>{
    document.body.classList.toggle("notes-hidden", !toggleNotes.checked);
  });

  presetEl?.addEventListener("change", ()=> applyPreset(presetEl.value));

  runEl?.addEventListener("click", ()=>{
    const v = presetEl?.value || "7";
    if (v!=="custom") applyPreset(v);
    const fromISO = fromEl.value || fmtISO(addDays(new Date(), -6));
    const toISO   = toEl.value   || fmtISO(new Date());
    buildReport(fromISO, toISO);
    showView("report");
  });

  // الطباعة
  btnPrint?.addEventListener("click", ()=> window.print());
  btnPrintPDF?.addEventListener("click", ()=> window.print());
  chkPrintNotes?.addEventListener("change", syncPrintNotes);

  btnPrintBlank?.addEventListener("click", ()=>{
    const start=new Date();
    const days=Array.from({length:7},(_,i)=>fmtISO(addDays(start,i)));
    const byDay={}; days.forEach(d=>byDay[d]={});
    currentDataByDay=byDay;
    buildHead(headRowPrint);
    renderRows(rowsPrint, byDay);
  });

  // التقرير الفارغ (في العرض الرئيسي)
  btnBlank?.addEventListener("click", ()=>{
    const start=new Date();
    const days=Array.from({length:7},(_,i)=>fmtISO(addDays(start,i)));
    const byDay={}; days.forEach(d=>byDay[d]={});
    currentDataByDay=byDay;
    buildHead(headRowEl); buildHead(headRowPrint);
    renderRows(rowsEl, byDay); renderRows(rowsPrint, byDay);
    metaEl.textContent = "ورقة فارغة للأسبوع القادم";
  });

  // التنقل بين العروض
  analysisBtn?.addEventListener("click", (e)=>{ e.preventDefault(); showView("analysis"); buildAnalytics(); });
  reportPrintBtn?.addEventListener("click", (e)=>{ e.preventDefault(); showView("print"); });

  $("#btnRecalcAnalysis")?.addEventListener("click", ()=> buildAnalytics());
  btnCompare?.addEventListener("click", ()=> buildComparison());

  // زر رجوع
  if (lnkHome) lnkHome.href = parentId ? `parent.html?parent=${encodeURIComponent(parentId)}` : "parent.html";
}

/* ===== تبديل العروض ===== */
window.showView = function(which){
  const reportSec=$("#reportView"), analysisSec=$("#analysisView"), printSec=$("#printView");
  [reportSec,analysisSec,printSec].forEach(el=>el?.classList.add("hidden"));
  if (which==="analysis"){ analysisSec?.classList.remove("hidden"); }
  else if (which==="print"){ printSec?.classList.remove("hidden"); syncPrintNotes(); }
  else { reportSec?.classList.remove("hidden"); }
};

/* ===== التنقّل ===== */
function buildNav(){
  if(!childNav) return;
  childNav.innerHTML = "";
  const items = [
    ["parent.html","الرئيسية"],
    ["measurements.html","قياسات السكر"],
    ["meals.html","الوجبات"],
    ["reports.html","التقارير"],
    ["#","التحاليل", "view:analysis"],
    ["visits.html","الزيارات الطبية"],
  ];
  for (const it of items){
    const [href,label,type] = it;
    const a = document.createElement("a");
    a.className="btn gray"; a.textContent=label;
    if (type==="view:analysis"){ a.href="#"; a.addEventListener("click",(e)=>{e.preventDefault(); showView("analysis"); buildAnalytics();}); }
    else { a.href = linkWithParams(href); }
    childNav.appendChild(a);
  }
}

/* ===== تشغيل ===== */
async function start(){
  parentId = qparam("parent") || sessionStorage.getItem("lastParent") || "";
  childId  = qparam("child")  || sessionStorage.getItem("lastChild")  || "";

  if (parentId) sessionStorage.setItem("lastParent", parentId);
  if (childId)  sessionStorage.setItem("lastChild",  childId);

  childBanner.style.display = "block";
  await loadChild();
  buildNav();
  wireUI();

  presetEl.value = "7";
  applyPreset("7");
  runEl.click(); // يبني التقرير مباشرة
}

document.addEventListener("DOMContentLoaded", start);
