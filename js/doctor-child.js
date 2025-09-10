// doctor-child.js — صفحة الطبيب/ولي الأمر مع تقرير ووجبات وتحليلات
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

const presetEl=$("#preset"), datesBox=$("#datesBox"), fromEl=$("#from"), toEl=$("#to"), runEl=$("#run");
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

/* اربطي الأحداث فقط لو العناصر موجودة */
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

/* ============ حدود التصنيف ============ */
let limits = { min:3.9, max:10.0, severeLow:3.0, severeHigh:16.7 }; // mmol/L
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
  if(limits.severeLow!=null && v<=limits.severeLow) return "b-sevlow";
  if(limits.min!=null && v<limits.min) return "b-low";
  if(limits.severeHigh!=null && v>=limits.severeHigh) return "b-sevhigh";
  if(limits.max!=null && v>limits.max) return "b-high";
  return "b-ok";
}

/* ============ قراءة الطفل + ترويسة ============ */
async function fetchRole(uid){
  const s=await getDoc(doc(db,"users",uid));
  return s.exists()? (s.data().role||"parent") : "parent";
}
function isOwner(){ return authUser && parentId && authUser.uid===parentId; }

/* (اختياري) إنشاء بطاقة الطفل تلقائيًا إذا مفقودة */
function ensureChildCard(){
  if (document.getElementById("c_name")) return; // موجود
  const holder=document.createElement("section");
  holder.className="card"; holder.id="childCard";
  holder.innerHTML=`
    <div class="card-row">
      <div><b>الاسم:</b> <span id="c_name">—</span></div>
      <div><b>العمر:</b> <span id="c_age">—</span></div>
      <div><b>الجنس:</b> <span id="c_gender">—</span></div>
      <div><b>الوحدة:</b> <span id="c_unit">—</span></div>
    </div>
    <div class="card-row">
      <div><b>النطاق:</b> <span id="c_range">—</span></div>
      <div><b>CR:</b> <span id="c_cr">—</span></div>
      <div><b>CF:</b> <span id="c_cf">—</span></div>
      <div><b>الجهاز:</b> <span id="c_device">—</span></div>
    </div>
    <div class="card-row">
      <div><b>Basal:</b> <span id="c_basal">—</span></div>
      <div><b>Bolus:</b> <span id="c_bolus">—</span></div>
      <div><b>الوزن:</b> <span id="c_weight">—</span></div>
      <div><b>الطول:</b> <span id="c_height">—</span></div>
    </div>
    <div class="card-row muted">
      <div><b>الطبيب المرتبط:</b> <span id="c_doc">—</span></div>
      <div><b>المشاركة:</b> <span id="c_share">—</span></div>
      <div><b>آخر تحديث:</b> <span id="c_updated">—</span></div>
    </div>`;
  document.body.insertBefore(holder, document.querySelector(".controls") || null);

  // أعد ربط مؤشرات CARD بعد إنشاء البلوك
  CARD.name=$("#c_name");  CARD.age=$("#c_age");   CARD.gender=$("#c_gender"); CARD.unit=$("#c_unit");
  CARD.range=$("#c_range");CARD.cr=$("#c_cr");     CARD.cf=$("#c_cf");         CARD.device=$("#c_device");
  CARD.basal=$("#c_basal");CARD.bolus=$("#c_bolus");CARD.weight=$("#c_weight");CARD.height=$("#c_height");
  CARD.doc=$("#c_doc");    CARD.share=$("#c_share");CARD.updated=$("#c_updated");
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

  // خزّن لصفحات تانية
  sessionStorage.setItem("lastParent", parentId || "");
  sessionStorage.setItem("lastChild",  childId  || "");
}

async function loadChild(){
  const ref=doc(db,"parents",parentId,"children",childId);
  const s=await getDoc(ref);
  childData = s.exists()? s.data(): {};
  const name = childData?.name || childId || "—";
  if (childTitle) { childTitle.textContent=name; }
  document.title=`ملف ${name}`;

  const nr=childData?.normalRange||{};
  limits.min = (nr.min ?? childData?.hypoLevel ?? limits.min);
  limits.max = (nr.max ?? childData?.hyperLevel ?? limits.max);
  limits.severeLow  = (nr.severeLow  ?? limits.severeLow);
  limits.severeHigh = (nr.severeHigh ?? limits.severeHigh);

  CARD?.name && (CARD.name.textContent = name);
  CARD?.gender && (CARD.gender.textContent = childData?.gender || "—");
  CARD?.unit   && (CARD.unit.textContent   = childData?.glucoseUnit || childData?.unit || "—");

  CARD?.age && (CARD.age.textContent = (()=> {
    const dob=childData?.birthDate; if(!dob) return "—";
    const b=new Date(dob), n=new Date(); let y=n.getFullYear()-b.getFullYear(), m=n.getMonth()-b.getMonth(), d=n.getDate()-b.getDate(); if(d<0)m--; if(m<0){y--;m+=12;}
    return y>0? `${y} سنة${m?` و${m} شهر`:''}` : `${m} شهر`;
  })());

  CARD?.range && (CARD.range.textContent =
    `${round1(limits.min)}–${round1(limits.max)} mmol/L` +
    (limits.severeLow||limits.severeHigh? ` (شديد: ${round1(limits.severeLow)||"—"} / ${round1(limits.severeHigh)||"—"})`:"")
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
  F.severeLow  && (F.severeLow.value  = limits.severeLow ?? "");
  F.severeHigh && (F.severeHigh.value = limits.severeHigh ?? "");

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
      if(v<limits.min){ hypo++; perSlot[slot]=(perSlot[slot]||0)+1; }
      else if(v>limits.max){ hyper++; perSlot[slot]=(perSlot[slot]||0)+1; }
      else normal++;
    }
  }
  const avg = cnt? +(sum/cnt).toFixed(1) : null;
  const worstSlot = Object.entries(perSlot).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
  return {hypo,normal,hyper,total:cnt,avg,worstSlot};
}
function buildAnalytics(){
  if (!Object.keys(currentDataByDay).length){
    if(analysisNumbers) analysisNumbers.innerHTML=`<div class="muted">لا توجد بيانات لعرض التحاليل.</div>`;
    if(chartInst){ chartInst.destroy(); chartInst=null; }
    if(smartSummary) smartSummary.textContent="";
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
      data:{ labels:["هبوط","طبيعي","ارتفاع"], datasets:[{ data:[pHypo,pNorm,pHyper] }] },
      options:{ responsive:true, plugins:{ legend:{position:"bottom"}, tooltip:{callbacks:{label:(c)=>`${c.label}: ${c.parsed}%`}}}}
    });
  }

  const tips=[];
  if (pNorm<60) tips.push("ضمن النطاق أقل من 60% — راجعي أهداف الوجبات والتصحيح.");
  if (pHypo>pHyper) tips.push("الهبوطات أعلى — قللي جرعات الوجبة/التصحيح بحذر.");
  if (pHyper>pHypo) tips.push("الارتفاعات أعلى — راجعي CR/CF.");
  if (st.worstSlot){ const ar = COLS.find(c=>c[0]===st.worstSlot)?.[1] || st.worstSlot; tips.push(`أكثر فترة خروجًا: ${ar}.`); }
  if(smartSummary) smartSummary.textContent = tips.join(" ");
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

  limits.min = payload.normalRange.min ?? limits.min;
  limits.max = payload.normalRange.max ?? limits.max;
  limits.severeLow  = payload.normalRange.severeLow  ?? limits.severeLow;
  limits.severeHigh = payload.normalRange.severeHigh ?? limits.severeHigh;

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
  }catch(e){ console.error(e); setStatus("تعذر الحفظ.",false); }
  finally{ showLoader(false); }
}
if (F.save) F.save.addEventListener("click", saveDoctor);

/* ============ بناء الكل ============ */
function buildMHead(){ buildHead(mHeadRow, COLS); }
function buildMealsHead(){ buildMealHead(mealHeadRow); }
async function buildAll(fromISO,toISO){
  showLoader(true);
  try{
    if(measureMeta) measureMeta.textContent=`من ${fromISO} إلى ${toISO}`;
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

    // ids
    await resolveIds();

    // تأكّد من وجود بطاقة الطفل (لو حد حذفها في HTML)
    ensureChildCard();

    // الدور
    userRole = await fetchRole(u.uid);

    await loadChild();
    applyPermissions();

    // افتراضي: أسبوع
    const defaultPreset = presetEl?.value || "7";
    applyPreset(defaultPreset);
    // شغّل القراءة مرة واحدة
    const from = fromEl?.value || fmtISO(addDays(new Date(),-6));
    const to   = toEl?.value   || fmtISO(new Date());
    buildAll(from,to);
  });
})();
