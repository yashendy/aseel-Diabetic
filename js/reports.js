/* التقارير — قراءة بيانات الطفل والقياسات بنفس منطق النسخة القديمة
   - المسار: parents/{parent}/children/{child}/measurements
   - يدعم slotKey وقيم value_mmol/value_mgdl
   - يعمل مع firebase-config.js كـ Module ويستورد db
   - لو parent مش موجود في الرابط نستخدم user.uid (Auth)
*/

import { db } from "./firebase-config.js";
import {
  doc, getDoc,
  collection, query, where, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const auth = getAuth();

/* عناصر واجهة */
const $  = (s, p=document)=> p.querySelector(s);
const fmtISO = (d)=> d.toISOString().slice(0,10);
const addDays = (d,n)=>{ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; };

const presetEl = $("#preset"), datesBox=$("#datesBox"), fromEl=$("#from"), toEl=$("#to"), runEl=$("#run");
const btnPrint=$("#btnPrint"), btnBlank=$("#btnBlank"), toggleNotes=$("#toggleNotes");
const rowsEl=$("#rows"), headRowEl=$("#headRow"), metaEl=$("#meta"), loaderEl=$("#loader");
const childNav=$("#childNav");
const bannerName=$("#bannerName");
const metaHead = $("#metaHead") || $("#bannerMeta"); // دعم الاسمين
const lnkHome=$("#lnkHome");
const analysisBtn=$("#btnAnalyticsPage"), reportPrintBtn=$("#btnReportPrintPage");
const headRowPrint=$("#headRowPrint"), rowsPrint=$("#rowsPrint"), analysisContainer=$("#analysisContainer");

let parentId="", childId="", childDoc=null;
let limits = { severeLow:55, normalMin:70, normalMax:180, severeHigh:300 };
let currentDataByDay={};

/* الأعمدة والفترات (مع ق.النوم) */
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
  PRE_SLEEP:["PRE_SLEEP","BEFORE_SLEEP","BEFORESLEEP","PRE-SLEEP"],  // جديد
  DURING_SLEEP:["DURING_SLEEP","NIGHT"]
};
function normalizeSlotKey(k){
  const x = String(k||"").toUpperCase();
  for (const std in SLOT_ALIAS) if (SLOT_ALIAS[std].includes(x)) return std;
  return null;
}

/* أدوات عرض */
const setLoader = (v)=> loaderEl && (loaderEl.style.display = v ? "flex" : "none");
const round1 = (n)=> (Number.isFinite(+n) ? Math.round(+n*10)/10 : null);

/* تحويل القيم إلى mmol/L */
function toMmol(rec){
  if (typeof rec?.value_mmol === "number") return rec.value_mmol;
  if (typeof rec?.value === "number" && (rec?.unit||"").toLowerCase()==="mmol/l") return rec.value;
  const mgdl = (typeof rec?.value_mgdl === "number") ? rec.value_mgdl
              : (typeof rec?.value === "number" ? rec.value : null);
  return (mgdl==null) ? null : (mgdl/18);
}

/* تصنيف حسب حدود الطفل */
function classify(v){
  if (!Number.isFinite(v)) return "b-ok";
  if (limits.severeLow!=null && v <= limits.severeLow) return "b-sevlow";
  if (limits.normalMin!=null && v <  limits.normalMin) return "b-low";
  if (limits.severeHigh!=null && v >= limits.severeHigh) return "b-sevhigh";
  if (limits.normalMax!=null && v >  limits.normalMax) return "b-high";
  return "b-ok";
}

/* بناء رأس الجدول */
function buildHead(row){
  row.innerHTML = "";
  const thDate = document.createElement("th"); thDate.textContent="التاريخ"; thDate.className="date"; row.appendChild(thDate);
  for (const [,label] of COLS){ const th=document.createElement("th"); th.textContent=label; row.appendChild(th); }
}

/* رسائل فارغة */
function emptyRows(tbody, txt="لا توجد بيانات ضمن المدى المحدد"){
  tbody.innerHTML = `<tr><td colspan="${COLS.length+1}" class="center muted">${txt}</td></tr>`;
}

/* بناء صفوف */
function renderRows(tbody, byDay){
  const days = Object.keys(byDay).sort();
  if (!days.length){ emptyRows(tbody); return; }
  const frag = document.createDocumentFragment();
  for (const d of days){
    const tr = document.createElement("tr");
    const tdDate = document.createElement("td"); tdDate.className="date"; tdDate.textContent=d; tr.appendChild(tdDate);
    const prev = byDay[fmtISO(addDays(new Date(d),-1))] || {};
    for (const [slot] of COLS){
      const td = document.createElement("td");
      const rec = byDay[d]?.[slot]; const prevRec = prev?.[slot];
      if (rec){
        const mmol = toMmol(rec); const v = round1(mmol);
        const cls = classify(mmol);
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

/* جلب بيانات الطفل + الحدود */
async function loadChild(){
  const snap = await getDoc(doc(db, "parents", parentId, "children", childId));
  childDoc = snap.exists() ? snap.data() : {};
  bannerName.textContent = childDoc?.name || "الطفل";
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

  if (childDoc?.normalRange){
    if (childDoc.normalRange.min!=null) limits.normalMin = childDoc.normalRange.min;
    if (childDoc.normalRange.max!=null) limits.normalMax = childDoc.normalRange.max;
    if (childDoc.normalRange.severeLow!=null) limits.severeLow = childDoc.normalRange.severeLow;
    if (childDoc.normalRange.severeHigh!=null) limits.severeHigh = childDoc.normalRange.severeHigh;
  }
}

/* جلب القياسات من المسار القديم */
async function fetchAggregated(fromISO, toISO){
  // NOTE: نفس مسار النسخة القديمة
  const col = collection(db, "parents", parentId, "children", childId, "measurements");
  const qy = query(
    col,
    where("date", ">=", fromISO),
    where("date", "<=", toISO),
    orderBy("date","asc"),
    orderBy("when","asc") // يختار أحدث قراءة للفترة في نفس اليوم
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
    // نخزن الأحدث حسب "when"
    const currTs = r?.when?.toMillis ? r.when.toMillis() : (r?.when || 0);
    const prevTs = prev?.when?.toMillis ? prev.when.toMillis() : (prev?.when || 0);
    if(!prev || currTs >= prevTs) byDay[date][slot] = r;
  });
  return byDay;
}

/* بناء التقرير */
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

/* تحليل بسيط داخل نفس الصفحة */
function buildAnalysis(){
  if (!currentDataByDay || !Object.keys(currentDataByDay).length) {
    analysisContainer.textContent = "لا توجد بيانات لعرض التحليلات.";
    return;
  }
  let total=0, count=0;
  for (const d of Object.values(currentDataByDay))
    for (const r of Object.values(d))
      if (r?.value_mmol!=null || r?.value_mgdl!=null || r?.value!=null){ total += toMmol(r) || 0; count++; }
  analysisContainer.innerHTML = `<div class="badge b-ok">متوسط القياسات: ${count ? (total/count).toFixed(1) : "—"}</div>`;
}

/* واجهة المستخدم */
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
  presetEl?.addEventListener("change", ()=> applyPreset(presetEl.value));

  runEl?.addEventListener("click", ()=>{
    const v = presetEl?.value || "7";
    if (v!=="custom") applyPreset(v);
    const fromISO = fromEl.value || fmtISO(addDays(new Date(), -6));
    const toISO   = toEl.value   || fmtISO(new Date());
    buildReport(fromISO, toISO);
  });

  btnPrint?.addEventListener("click", ()=> window.print());

  btnBlank?.addEventListener("click", ()=>{
    const start=new Date();
    const days=Array.from({length:7},(_,i)=>fmtISO(addDays(start,i)));
    const byDay={}; days.forEach(d=>byDay[d]={});
    currentDataByDay=byDay;
    buildHead(headRowEl); buildHead(headRowPrint);
    renderRows(rowsEl, byDay); renderRows(rowsPrint, byDay);
    metaEl.textContent = "ورقة فارغة للأسبوع القادم";
  });

  toggleNotes?.addEventListener("change", ()=> {
    document.body.classList.toggle("notes-hidden", !toggleNotes.checked);
  });

  analysisBtn?.addEventListener("click", (e)=>{ e.preventDefault(); showView("analysis"); buildAnalysis(); });
  reportPrintBtn?.addEventListener("click", (e)=>{ e.preventDefault(); showView("print"); });
}

/* تبديل العروض */
window.showView = function(which){
  const reportSec=$("#reportView"), analysisSec=$("#analysisView"), printSec=$("#printView");
  [reportSec,analysisSec,printSec].forEach(el=>el?.classList.add("hidden"));
  if (which==="analysis") analysisSec?.classList.remove("hidden");
  else if (which==="print") printSec?.classList.remove("hidden");
  else reportSec?.classList.remove("hidden");
};

/* تنقّل */
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
    if (type==="view:analysis"){ a.href="#"; a.addEventListener("click",(e)=>{e.preventDefault(); showView("analysis"); buildAnalysis();}); }
    else { a.href = `${href}?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`; }
    childNav.appendChild(a);
  }
  if (lnkHome) lnkHome.href = parentId ? `parent.html?parent=${encodeURIComponent(parentId)}` : "parent.html";
}

/* تشغيل */
function qs(k){ return new URLSearchParams(location.search).get(k) || ""; }

async function startWithKnownIds(){
  bannerName.textContent = "الطفل";
  await loadChild();
  buildNav();
  wireUI();
  presetEl.value = "7";
  applyPreset("7");
  runEl.click(); // يبني التقرير
}

document.addEventListener("DOMContentLoaded", async ()=>{
  parentId = qs("parent") || "";
  childId  = qs("child")  || "";

  if (!parentId){
    // لو مفيش parent في الرابط، استخدم user.uid زي النسخة القديمة
    onAuthStateChanged(auth, async (user)=>{
      if(!user){ /* لو عندك صفحة تسجيل */ return startWithKnownIds(); }
      parentId = user.uid;
      await startWithKnownIds();
    });
  } else {
    await startWithKnownIds();
  }
});
