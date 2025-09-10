// doctor-child.js — صفحة الطبيب/ولي الأمر مع تقرير ووجبات وتحليلات + تصدير CSV + تصنيف SL/SH + ألوان موحّدة
import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, collection, query, where, orderBy, getDocs,
  collectionGroup, documentId, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ============ DOM ============ */
const $  = (s,p=document)=>p.querySelector(s);
const $$ = (s,p=document)=>Array.from(p.querySelectorAll(s));

const childTitle=$("#childTitle");
const CARD = {
  name:$("#c_name"), age:$("#c_age"), gender:$("#c_gender"), unit:$("#c_unit"),
  range:$("#c_range"), cr:$("#c_cr"), cf:$("#c_cf"),
  device:$("#c_device"), basal:$("#c_basal"), bolus:$("#c_bolus"),
  weight:$("#c_weight"), height:$("#c_height"),
  doc:$("#c_doc"), share:$("#c_share"), updated:$("#c_updated"),
};

const presetEl=$("#preset"), datesBox=$("#datesBox"), fromEl=$("#from"), toEl=$("#to"),
      runEl=$("#run"), exportBtn=$("#exportCsv");
const toggleNotes=$("#toggleNotes");
const analysisNumbers=$("#analysisNumbers"), smartSummary=$("#smartSummary");
const doughnutCanvas=$("#doughnutChart");
const mHeadRow=$("#mHeadRow"), mRows=$("#mRows"), measureMeta=$("#measureMeta");
const mealHeadRow=$("#mealHeadRow"), mealRows=$("#mealRows");
const statusEl=$("#status"), loader=$("#loader");

const F = {
  name:$("#f_name"), gender:$("#f_gender"), birthDate:$("#f_birthDate"), unit:$("#f_unit"),
  carbRatio:$("#f_carbRatio"), correctionFactor:$("#f_correctionFactor"),
  basalType:$("#f_basalType"), bolusType:$("#f_bolusType"),
  heightCm:$("#f_heightCm"), weightKg:$("#f_weightKg"),
  hypo:$("#f_hypo"), hyper:$("#f_hyper"),
  severeLow:$("#f_severeLow"), severeHigh:$("#f_severeHigh"),
  carb_b_min:$("#f_carb_b_min"), carb_b_max:$("#f_carb_b_max"),
  carb_l_min:$("#f_carb_l_min"), carb_l_max:$("#f_carb_l_max"),
  carb_d_min:$("#f_carb_d_min"), carb_d_max:$("#f_carb_d_max"),
  carb_s_min:$("#f_carb_s_min"), carb_s_max:$("#f_carb_s_max"),
  save:$("#btnSave")
};

/* ============ حالة عامة ============ */
let authUser=null, userRole="parent", parentId="", childId="";
let childData=null, chartInst=null, currentDataByDay={}, currentMealsByDay={};
const showLoader=(v)=> loader?.classList.toggle("hidden", !v);
const setStatus=(t,ok=false)=>{ if(!statusEl) return; statusEl.textContent=t||""; statusEl.className="status "+(ok?"ok":"err"); };

/* ============ تواريخ ============ */
const fmtISO = (d)=> d.toISOString().slice(0,10);
const addDays=(d,n)=>{ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); x.setDate(x.getDate()+n); return x; };

function applyPreset(v){
  if(!datesBox) return;
  datesBox.classList.toggle("hidden", v!=="custom");
  if(v==="custom") return;
  const today=new Date(); let days=7;
  if(v==="14") days=14; else if(v==="30") days=30; else if(v==="90") days=90;
  if (toEl)   toEl.value  = fmtISO(today);
  if (fromEl) fromEl.value= fmtISO(addDays(today,-(days-1)));
}

/* أربطي الأحداث بحذر */
if (presetEl) presetEl.addEventListener("change",()=>applyPreset(presetEl.value));
if (runEl) runEl.addEventListener("click",()=>{
  const v=presetEl?.value||"7"; if(v!=="custom") applyPreset(v);
  const from= fromEl?.value || fmtISO(addDays(new Date(),-6));
  const to  = toEl?.value   || fmtISO(new Date());
  buildAll(from, to);
});
if (toggleNotes) toggleNotes.addEventListener("change",()=>{
  renderMeasurementRows(mRows, currentDataByDay);
});
if (exportBtn) exportBtn.addEventListener("click", ()=>{
  const from= fromEl?.value || fmtISO(addDays(new Date(),-6));
  const to  = toEl?.value   || fmtISO(new Date());
  exportCsvAll(from, to);
});

/* ============ تقسيم الأوقات ============ */
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
  PRE_SLEEP:["PRE_SLEEP","BEFORE_SLEEP","PRE-SLEEP","BEFORESLEEP"],
  DURING_SLEEP:["DURING_SLEEP","NIGHT","SLEEP"],
};
function normSlot(k){
  const x=String(k||"").toUpperCase();
  for(const std in SLOT_ALIAS) if(SLOT_ALIAS[std].includes(x)) return std;
  return null;
}

/* ============ حدود التصنيف: نعتمد Severe Low/High =========== */
let limits = {
  min:3.9, max:10.0,
  severeLow:3.0, severeHigh:16.7,
  lowBound:null, highBound:null
};
function refreshBounds(){
  limits.lowBound  = (limits.severeLow  ?? limits.min);
  limits.highBound = (limits.severeHigh ?? limits.max);
}
const round1=(n)=> Number.isFinite(+n)? Math.round(+n*10)/10 : null;
function toMmol(rec){
  if (typeof rec?.value_mmol === "number") return rec.value_mmol;
  const unit=(rec?.unit||"").toLowerCase();
  if (typeof rec?.value === "number" && unit==="mmol/l") return rec.value;
  const mg = (typeof rec?.value_mgdl==="number")? rec.value_mgdl : (typeof rec?.value==="number"? rec.value:null);
  return mg==null?null: mg/18;
}
function classify(v){
  if(!Number.isFinite(v)) return "b-ok";
  if(limits.lowBound  != null && v <= limits.lowBound ) return "b-low";
  if(limits.highBound != null && v >= limits.highBound) return "b-high";
  return "b-ok";
}

/* ============ قراءة الطفل + ترويسة ============ */
async function fetchRole(uid){
  const s=await getDoc(doc(db,"users",uid));
  return s.exists()? (s.data().role||"parent") : "parent";
}

/* استرجاع معرفات parent/child بشكل قوي */
async function resolveIds(){
  const url=new URL(location.href);
  parentId = url.searchParams.get("parent") || sessionStorage.getItem("lastParent") || "";
  childId  = url.searchParams.get("child")  || sessionStorage.getItem("lastChild")  || "";

  // لو معايا child فقط: استخرج الـ parent عبر collectionGroup (docId == childId)
  if (!parentId && childId){
    try{
      const qy=query(collectionGroup(db,"children"), where(documentId(),"==", childId));
      const snaps=await getDocs(qy);
      if(!snaps.empty) parentId = snaps.docs[0].ref.parent.parent.id;
    }catch(e){ console.warn("resolveIds cg error", e); }
  }

  sessionStorage.setItem("lastParent", parentId || "");
  sessionStorage.setItem("lastChild",  childId  || "");
}

async function loadChild(){
  const ref=doc(db,"parents",parentId,"children",childId);
  const s=await getDoc(ref);
  childData = s.exists()? s.data(): {};
  const name = childData?.name || childId || "—";
  childTitle && (childTitle.textContent=name);
  document.title=`ملف ${name}`;

  // حدود من الداتا
  const nr=childData?.normalRange||{};
  limits.min        = (nr.min        ?? childData?.hypoLevel  ?? limits.min);
  limits.max        = (nr.max        ?? childData?.hyperLevel ?? limits.max);
  limits.severeLow  = (nr.severeLow  ?? limits.severeLow);
  limits.severeHigh = (nr.severeHigh ?? limits.severeHigh);
  refreshBounds();

  // بطاقة
  CARD?.name && (CARD.name.textContent = name);
  CARD?.gender && (CARD.gender.textContent = childData?.gender || "—");
  CARD?.unit   && (CARD.unit.textContent   = childData?.glucoseUnit || childData?.unit || "—");

  CARD?.age && (CARD.age.textContent = (()=> {
    const dob=childData?.birthDate; if(!dob) return "—";
    const b=new Date(dob), n=new Date(); let y=n.getFullYear()-b.getFullYear(), m=n.getMonth()-b.getMonth(), d=n.getDate()-b.getDate(); if(d<0)m--; if(m<0){y--;m+=12;}
    return y>0? `${y} سنة${m?` و${m} شهر`:''}` : `${m} شهر`;
  })());

  CARD?.range && (CARD.range.textContent =
    `${round1(limits.lowBound)}–${round1(limits.highBound)} mmol/L (شديد)`
  );

  CARD?.cr && (CARD.cr.textContent = (childData?.carbRatio ?? "—"));
  CARD?.cf && (CARD.cf.textContent = (childData?.correctionFactor ?? "—"));
  CARD?.basal && (CARD.basal.textContent = (childData?.insulin?.basalType ?? childData?.basalType ?? "—"));
  CARD?.bolus && (CARD.bolus.textContent = (childData?.insulin?.bolusType ?? childData?.bolusType ?? "—"));
  CARD?.device&& (CARD.device.textContent= (childData?.deviceName ?? childData?.device ?? "—"));
  CARD?.weight&& (CARD.weight.textContent= (childData?.weightKg ?? childData?.weight ?? "—"));
  CARD?.height&& (CARD.height.textContent= (childData?.heightCm ?? childData?.height ?? "—"));
  CARD?.doc   && (CARD.doc.textContent   = childData?.assignedDoctorInfo?.name || childData?.assignedDoctor || "—");
  CARD?.share && (CARD.share.textContent = (childData?.sharingConsent===true || childData?.sharingConsent?.doctor===true) ? "مفعل" : "معطّل");
  CARD?.updated && (CARD.updated.textContent = childData?.updatedAt?.toDate?.()?.toLocaleString?.() || "—");

  // نموذج الطبيب
  F.name      && (F.name.value = childData?.name||"");
  F.gender    && (F.gender.value = childData?.gender||"");
  F.birthDate && (F.birthDate.value = childData?.birthDate||"");
  F.unit      && (F.unit.value = childData?.glucoseUnit || childData?.unit || "");
  F.carbRatio && (F.carbRatio.value = childData?.carbRatio ?? "");
  F.correctionFactor && (F.correctionFactor.value = childData?.correctionFactor ?? "");
  F.basalType && (F.basalType.value = childData?.insulin?.basalType ?? childData?.basalType ?? "");
  F.bolusType && (F.bolusType.value = childData?.insulin?.bolusType ?? childData?.bolusType ?? "");
  F.heightCm  && (F.heightCm.value = childData?.heightCm ?? childData?.height ?? "");
  F.weightKg  && (F.weightKg.value = childData?.weightKg ?? childData?.weight ?? "");

  F.hypo       && (F.hypo.value       = limits.min ?? "");
  F.hyper      && (F.hyper.value      = limits.max ?? "");
  F.severeLow  && (F.severeLow.value  = limits.lowBound  ?? "");
  F.severeHigh && (F.severeHigh.value = limits.highBound ?? "");

  F.carb_b_min && (F.carb_b_min.value = childData?.carbTargets?.breakfast?.min ?? "");
  F.carb_b_max && (F.carb_b_max.value = childData?.carbTargets?.breakfast?.max ?? "");
  F.carb_l_min && (F.carb_l_min.value = childData?.carbTargets?.lunch?.min ?? "");
  F.carb_l_max && (F.carb_l_max.value = childData?.carbTargets?.lunch?.max ?? "");
  F.carb_d_min && (F.carb_d_min.value = childData?.carbTargets?.dinner?.min ?? "");
  F.carb_d_max && (F.carb_d_max.value = childData?.carbTargets?.dinner?.max ?? "");
  F.carb_s_min && (F.carb_s_min.value = childData?.carbTargets?.snack?.min ?? "");
  F.carb_s_max && (F.carb_s_max.value = childData?.carbTargets?.snack?.max ?? "");
}

/* ============ صلاحيات الطبيب ============ */
function applyPermissions(){
  [
    F.name,F.gender,F.birthDate,F.unit,
    F.carbRatio,F.correctionFactor,
    F.basalType,F.bolusType,
    F.heightCm,F.weightKg,
    F.hypo,F.hyper,F.severeLow,F.severeHigh,
    F.carb_b_min,F.carb_b_max,
    F.carb_l_min,F.carb_l_max,
    F.carb_d_min,F.carb_d_max,
    F.carb_s_min,F.carb_s_max,
  ].forEach(x=> x && (x.disabled=false));
}

/* ============ القياسات ============ */
function buildHead(row, cols){
  if(!row) return;
  row.innerHTML="";
  const th=document.createElement("th"); th.textContent="التاريخ"; row.appendChild(th);
  for (const [,label] of cols){ const t=document.createElement("th"); t.textContent=label; row.appendChild(t); }
}
async function fetchMeasurements(fromISO,toISO){
  const col=collection(db,"parents",parentId,"children",childId,"measurements");
  const qy=query(col, where("date",">=",fromISO), where("date","<=",toISO), orderBy("date","asc"), orderBy("when","asc"));
  const snaps=await getDocs(qy);
  const by={}; snaps.forEach(d=>{
    const r=d.data(); const date=r?.date; if(!date) return;
    const slot=normSlot(r?.slotKey||r?.slot||r?.timeSlot||r?.period); if(!slot) return;
    (by[date] ||= {});
    const prev=by[date][slot]; const ts = r?.when?.toMillis? r.when.toMillis(): (r?.when||0);
    const pts= prev?.when?.toMillis? prev.when.toMillis(): (prev?.when||0);
    if(!prev || ts>=pts) by[date][slot]=r;
  });
  return by;
}
function renderMeasurementRows(tbody, byDay){
  if(!tbody) return;
  const days=Object.keys(byDay).sort();
  if(!days.length){ tbody.innerHTML=`<tr><td colspan="${COLS.length+1}" class="muted">لا توجد بيانات ضمن المدى</td></tr>`; return; }
  const showNotes = !!(toggleNotes?.checked);
  const frag=document.createDocumentFragment();
  for(const d of days){
    const tr=document.createElement("tr");
    const td0=document.createElement("td"); td0.textContent=d; tr.appendChild(td0);
    for (const [slot] of COLS){
      const td=document.createElement("td");
      const rec=byDay[d]?.[slot];
      if(rec){
        const mmol=toMmol(rec); const v=round1(mmol); const cls=classify(mmol);
        const line=document.createElement("div"); line.className="value-line";
        line.innerHTML=`<b>${v!=null? v.toFixed(1):"—"}</b><span class="state-dot ${cls}">●</span>`;
        td.appendChild(line);
        if (showNotes) {
          if (rec?.bolusDose!=null || rec?.correctionDose!=null){
            const dl=document.createElement("div"); dl.className="dose-line";
            const parts=[]; if(rec.bolusDose!=null) parts.push(`جرعة: ${rec.bolusDose}U`);
            if(rec.correctionDose!=null) parts.push(`تصحيح: ${rec.correctionDose}U`);
            dl.textContent=parts.join(" • "); td.appendChild(dl);
          }
          if(rec?.notes || rec?.hypoTreatment){
            const nl=document.createElement("div"); nl.className="note-line";
            nl.textContent= rec.notes || rec.hypoTreatment || ""; td.appendChild(nl);
          }
        }
      }else td.textContent="—";
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }
  tbody.innerHTML=""; tbody.appendChild(frag);
}

/* ============ الوجبات ============ */
const MEAL_COLS = [
  ["BREAKFAST","الفطار"],
  ["LUNCH","الغدا"],
  ["DINNER","العشا"],
  ["SNACK","سناك"],
];
function normMealSlot(k){
  const x=String(k||"").toUpperCase();
  if(["BREAKFAST","BF","B"].includes(x)) return "BREAKFAST";
  if(["LUNCH","L"].includes(x)) return "LUNCH";
  if(["DINNER","D"].includes(x)) return "DINNER";
  if(["SNACK","S"].includes(x)) return "SNACK";
  return null;
}
async function fetchMeals(fromISO,toISO){
  const col=collection(db,"parents",parentId,"children",childId,"meals");
  const qy=query(col, where("date",">=",fromISO), where("date","<=",toISO), orderBy("date","asc"));
  const snaps=await getDocs(qy);
  const by={};
  snaps.forEach(d=>{
    const r=d.data(); const date=r?.date; if(!date) return;
    const slot=normMealSlot(r?.mealType||r?.slot||r?.type); if(!slot) return;
    (by[date] ||= {});
    const prev=by[date][slot] || {carbs:0, bolus:0, count:0};
    const carbs = Number(r?.totalCarbs ?? r?.carbs ?? 0);
    const bolus = Number(r?.bolusDose ?? r?.dose ?? 0);
    by[date][slot] = { carbs: prev.carbs + (isNaN(carbs)?0:carbs), bolus: prev.bolus + (isNaN(bolus)?0:bolus), count: prev.count+1 };
  });
  return by;
}
function buildMealHead(row){
  if(!row) return;
  row.innerHTML="";
  const th=document.createElement("th"); th.textContent="التاريخ"; row.appendChild(th);
  for(const [,lbl] of MEAL_COLS){ const t=document.createElement("th"); t.textContent=lbl; row.appendChild(t); }
}
function renderMealRows(tbody, byDay){
  if(!tbody) return;
  const days=Object.keys(byDay).sort();
  if(!days.length){ tbody.innerHTML=`<tr><td colspan="${MEAL_COLS.length+1}" class="muted">لا توجد وجبات ضمن المدى</td></tr>`; return; }
  const frag=document.createDocumentFragment();
  for(const d of days){
    const tr=document.createElement("tr");
    const td0=document.createElement("td"); td0.textContent=d; tr.appendChild(td0);

    const none = !MEAL_COLS.some(([slot]) => byDay[d]?.[slot]);
    if (none){
      const td=document.createElement("td");
      td.colSpan=MEAL_COLS.length;
      td.className="muted"; td.textContent="لا توجد وجبة لهذا اليوم";
      tr.appendChild(td);
    }else{
      for(const [slot] of MEAL_COLS){
        const td=document.createElement("td");
        const m=byDay[d]?.[slot];
        if(m){
          const parts=[];
          if (m.carbs) parts.push(`كارب ${m.carbs}g`);
          if (m.bolus) parts.push(`جرعة ${m.bolus}U`);
          parts.push(`x${m.count}`);
          td.textContent=parts.join(" • ");
        }else td.textContent="—";
        tr.appendChild(td);
      }
    }
    frag.appendChild(tr);
  }
  tbody.innerHTML=""; tbody.appendChild(frag);
}

/* ============ التحليلات ============ */
function computeStats(byDay){
  let hypo=0, normal=0, hyper=0, sum=0, cnt=0, perSlot={};
  for(const day of Object.values(byDay)){
    for(const [slot,rec] of Object.entries(day)){
      const v=toMmol(rec); if(v==null) continue;
      cnt++; sum+=v;
      const c=classify(v);
      if(c==="b-low"){ hypo++; perSlot[slot]=(perSlot[slot]||0)+1; }
      else if(c==="b-high"){ hyper++; perSlot[slot]=(perSlot[slot]||0)+1; }
      else normal++;
    }
  }
  const avg = cnt? +(sum/cnt).toFixed(1) : null;
  const worstSlot = Object.entries(perSlot).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
  return {hypo,normal,hyper,total:cnt,avg,worstSlot};
}
function buildAnalytics(){
  if (!Object.keys(currentDataByDay).length){
    analysisNumbers && (analysisNumbers.innerHTML=`<div class="muted">لا توجد بيانات لعرض التحاليل.</div>`);
    if(chartInst){ chartInst.destroy(); chartInst=null; }
    smartSummary && (smartSummary.textContent="");
    return;
  }
  const st = computeStats(currentDataByDay);
  const pct = (n,t)=> t? Math.round(n*1000/t)/10 : 0;
  const pHypo=pct(st.hypo,st.total), pHyper=pct(st.hyper,st.total); let pNorm=+(100-pHypo-pHyper).toFixed(1); if(pNorm<0) pNorm=0;

  if(analysisNumbers){
    analysisNumbers.innerHTML = `
      <span class="badge ok">المتوسط: ${st.avg ?? "—"} mmol/L</span>
      <span class="badge ok">TIR: ${pNorm}%</span>
      <span class="badge low">هبوط: ${pHypo}%</span>
      <span class="badge ok">طبيعي: ${pNorm}%</span>
      <span class="badge high">ارتفاع: ${pHyper}%</span>
    `;
  }

  if(doughnutCanvas){
    if(chartInst) chartInst.destroy();
    chartInst = new Chart(doughnutCanvas.getContext("2d"), {
      type:"doughnut",
      data:{
        labels:["هبوط","طبيعي","ارتفاع"],
        datasets:[{
          data:[pHypo,pNorm,pHyper],
          backgroundColor:["#60a5fa","#22c55e","#ef4444"], // Low/OK/High
          borderColor:["#dbeafe","#dcfce7","#fee2e2"],
          borderWidth:1
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,   // يملأ .chart-box
        cutout:"68%",
        plugins:{
          legend:{ position:"bottom", labels:{ boxWidth:10, boxHeight:10, padding:8, font:{ size:11 } } },
          tooltip:{ callbacks:{ label:(c)=>`${c.label}: ${c.parsed}%` } }
        },
        layout:{ padding:0 }
      }
    });
  }

  const tips=[];
  if (pNorm<60) tips.push("ضمن النطاق أقل من 60% — راجعي أهداف الوجبات والتصحيح.");
  if (pHypo>pHyper) tips.push("الهبوطات أعلى — قلّلي جرعات الوجبة/التصحيح بحذر.");
  if (pHyper>pHypo) tips.push("الارتفاعات أعلى — راجعي CR/CF.");
  if (st.worstSlot){ const ar = COLS.find(c=>c[0]===st.worstSlot)?.[1] || st.worstSlot; tips.push(`أكثر فترة خروجًا: ${ar}.`); }
  smartSummary && (smartSummary.textContent = tips.join(" "));
}

/* ============ الحفظ (صلاحيات الطبيب) ============ */
function vNum(x){ const n=Number(x); return Number.isFinite(n)? n : null; }
function buildDoctorPayload(){
  const payload = {
    name: F.name?.value?.trim()||null,
    gender: F.gender?.value || null,
    birthDate: F.birthDate?.value || null,
    glucoseUnit: F.unit?.value || null,

    carbRatio: vNum(F.carbRatio?.value),
    correctionFactor: vNum(F.correctionFactor?.value),

    carbTargets:{
      breakfast:{min:vNum(F.carb_b_min?.value),max:vNum(F.carb_b_max?.value)},
      lunch:{min:vNum(F.carb_l_min?.value),max:vNum(F.carb_l_max?.value)},
      dinner:{min:vNum(F.carb_d_min?.value),max:vNum(F.carb_d_max?.value)},
      snack:{min:vNum(F.carb_s_min?.value),max:vNum(F.carb_s_max?.value)},
    },

    normalRange:{
      min:       vNum(F.hypo?.value),
      max:       vNum(F.hyper?.value),
      severeLow: vNum(F.severeLow?.value),
      severeHigh:vNum(F.severeHigh?.value),
    },

    basalType: F.basalType?.value || null,
    bolusType: F.bolusType?.value || null,

    heightCm: vNum(F.heightCm?.value),
    weightKg: vNum(F.weightKg?.value),

    updatedAt: serverTimestamp(),
  };

  // عدّلي الحدود المحلية + فعّلي SL/SH
  limits.min = payload.normalRange.min ?? limits.min;
  limits.max = payload.normalRange.max ?? limits.max;
  limits.severeLow  = payload.normalRange.severeLow  ?? limits.severeLow;
  limits.severeHigh = payload.normalRange.severeHigh ?? limits.severeHigh;
  refreshBounds();

  return payload;
}
async function saveDoctor(){
  if(!parentId||!childId) return;
  try{
    setStatus("",true); showLoader(true);
    const ref=doc(db,"parents",parentId,"children",childId);
    await setDoc(ref, buildDoctorPayload(), {merge:true});
    setStatus("تم الحفظ.",true);
    await loadChild();
    buildAnalytics();
    renderMeasurementRows(mRows, currentDataByDay);
  }catch(e){ console.error(e); setStatus("تعذر الحفظ. الصلاحيات أو الحقول.",false); }
  finally{ showLoader(false); }
}
if (F.save) F.save.addEventListener("click", saveDoctor);

/* ============ تصدير CSV (Excel) ============ */
function downloadCsv(filename, rows){
  // BOM علشان العربي يبان صح في Excel
  const BOM = "\uFEFF";
  const csv = rows.map(r => r.map(c => {
    if (c==null) return "";
    const s = String(c).replace(/"/g,'""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob([BOM + csv], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportCsvMeasurements(from,to){
  const header = ["التاريخ", ...COLS.map(c=>c[1])];
  const days = Object.keys(currentDataByDay).sort();
  const rows = [header];

  if (!days.length){
    rows.push(["لا توجد بيانات ضمن المدى"]);
  }else{
    for (const d of days){
      const line=[d];
      for (const [slot] of COLS){
        const rec=currentDataByDay[d]?.[slot];
        if(rec){
          const mmol = round1(toMmol(rec));
          line.push(mmol!=null? mmol.toFixed(1):"");
        }else line.push("");
      }
      rows.push(line);
    }
  }
  const name = childData?.name || childId || "child";
  downloadCsv(`${name}_${from}_to_${to}_measurements.csv`, rows);
}

function exportCsvMeals(from,to){
  const header = ["التاريخ", ...MEAL_COLS.map(c=>c[1])];
  const days = Object.keys(currentMealsByDay).sort();
  const rows = [header];

  if (!days.length){
    rows.push(["لا توجد وجبات ضمن المدى"]);
  }else{
    for (const d of days){
      const line=[d];
      for (const [slot] of MEAL_COLS){
        const m=currentMealsByDay[d]?.[slot];
        if(m){
          // نعرض إجمالي الكارب + عدد الوجبات
          const txt = `${m.carbs||0}g x${m.count}`;
          line.push(txt);
        }else line.push("");
      }
      rows.push(line);
    }
  }
  const name = childData?.name || childId || "child";
  downloadCsv(`${name}_${from}_to_${to}_meals.csv`, rows);
}

function exportCsvAll(from,to){
  exportCsvMeasurements(from,to);
  exportCsvMeals(from,to);
}

/* ============ بناء الكل ============ */
function buildMHead(){ buildHead(mHeadRow, COLS); }
function buildMealsHead(){ buildMealHead(mealHeadRow); }
async function buildAll(fromISO,toISO){
  showLoader(true);
  try{
    measureMeta && (measureMeta.textContent=`من ${fromISO} إلى ${toISO}`);
    buildMHead(); buildMealsHead();

    currentDataByDay = await fetchMeasurements(fromISO,toISO);
    renderMeasurementRows(mRows,currentDataByDay);
    currentMealsByDay = await fetchMeals(fromISO,toISO);
    renderMealRows(mealRows,currentMealsByDay);

    buildAnalytics();
  }finally{ showLoader(false); }
}

/* ============ تهيئة ============ */
(async function init(){
  const auth=getAuth();
  onAuthStateChanged(auth, async (u)=>{
    if(!u){ location.href="/login.html"; return; }
    authUser=u;

    await resolveIds();
    userRole = await fetchRole(u.uid);

    await loadChild();
    applyPermissions();

    // افتراضي: أسبوع
    const from = fromEl?.value || fmtISO(addDays(new Date(), -6));
    const to   = toEl?.value   || fmtISO(new Date());
    buildAll(from,to);
  });
})();
