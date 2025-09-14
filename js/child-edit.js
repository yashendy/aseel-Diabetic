// ===== Firebase (عدّلي المسارات إن لزم) =====
import {
  doc, getDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db, auth } from "./firebase.js";

// ===== DOM helpers =====
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
function status(t){ $("#status").textContent = t; }

// ===== Header elements =====
const roleBadge  = $("#roleBadge");
const doctorLink = $("#doctorLink");
const hdrName    = $("#hdrName");
const hdrCivil   = $("#hdrCivil");
const hdrAge     = $("#hdrAge");
const hdrUnit    = $("#hdrUnit");
const hdrUpdated = $("#hdrUpdated");
const hdrDietChips = $("#hdrDietChips");

// ===== Form controls =====
const nameEl   = $("#f_name");
const civilEl  = $("#f_civilId");
const genderEl = $("#f_gender");
const bdateEl  = $("#f_birthDate");
const unitEl   = $("#f_unit");
const hEl      = $("#f_heightCm");
const wEl      = $("#f_weightKg");

const f_criticalLow = $("#f_criticalLow");
const f_severeLow   = $("#f_severeLow");
const f_hypo        = $("#f_hypo");
const f_hyper       = $("#f_hyper");
const f_severeHigh  = $("#f_severeHigh");
const f_criticalHigh= $("#f_criticalHigh");
const normalBadge   = $("#normalBadge");
const normalHint    = $("#normalHint");
const glOrderHint   = $("#glOrderHint");

const g_b_min=$("#f_carb_b_min"), g_b_max=$("#f_carb_b_max");
const g_l_min=$("#f_carb_l_min"), g_l_max=$("#f_carb_l_max");
const g_d_min=$("#f_carb_d_min"), g_d_max=$("#f_carb_d_max");
const g_s_min=$("#f_carb_s_min"), g_s_max=$("#f_carb_s_max");
const err_b=$("#err_b"), err_l=$("#err_l"), err_d=$("#err_d"), err_s=$("#err_s");

const crEl=$("#f_carbRatio");
const cfEl=$("#f_correctionFactor");
const targetPrefEl=$("#f_targetPref");

const crB=$("#f_cr_b"), crL=$("#f_cr_l"), crD=$("#f_cr_d"), crS=$("#f_cr_s");
const cfB=$("#f_cf_b"), cfL=$("#f_cf_l"), cfD=$("#f_cf_d"), cfS=$("#f_cf_s");

const basalEl=$("#f_basalType");
const bolusEl=$("#f_bolusType");
const devTypeEl=$("#f_deviceType");
const devModelEl=$("#f_deviceModel");
const insulinNotesEl=$("#f_insulinNotes");

// Chips
const injSitesWrap = $("#injectionSitesInput");
const allergiesWrap=$("#allergiesInput");
const preferredWrap=$("#preferredInput");
const dislikedWrap =$("#dislikedInput");
const flagWrap     = $("#dietFlags");
const flagsInputs  = $$(".diet-flag", flagWrap);

// Buttons
const btnSave   = $("#btnSave");
const loader    = $("#loader");
const unitChangeWarn = $("#unitChangeWarn");

// ===== Utils =====
const n  = (v)=>Number.isFinite(+v)? +v : null;
const n0 = (v)=>Number.isFinite(+v)? +v : 0;
const fmtDate = (ms)=> { try{ if(!ms) return "—"; const d=new Date(ms); return d.toLocaleString('ar'); }catch{ return "—"; } };
const calcAge = (dateStr)=>{
  if(!dateStr) return "—";
  const d=new Date(dateStr); if(isNaN(d)) return "—";
  const diff=Date.now()-d.getTime(); const years = Math.floor(diff/(365.25*24*3600*1000));
  return `${years} سنة`;
};
const arrayPair = (a,b)=> (n(a)==null && n(b)==null) ? null : [n(a),n(b)];
const fillDietSummary = (flags=[])=>{
  hdrDietChips.innerHTML="";
  const map={
    halal:"حلال", vegetarian:"نباتي", vegan:"نباتي صارم", gluten_free:"خالٍ من الجلوتين",
    lactose_free:"خالٍ من اللاكتوز", low_sugar:"قليل السكر", low_carb:"قليل الكارب",
    low_fat:"قليل الدهون", low_sodium:"قليل الصوديوم", low_satfat:"دهون مشبعة قليلة"
  };
  (flags||[]).forEach(f=>{
    const s=document.createElement("span");
    s.className="chip"; s.textContent=map[f]||f;
    hdrDietChips.appendChild(s);
  });
};
function chipInput(wrap){
  const input=wrap?.querySelector("input");
  function add(t){
    t=(t||"").trim(); if(!t) return;
    const exists=[...wrap.querySelectorAll(".chip .t")].some(n=>n.textContent===t);
    if(exists) return;
    const c=document.createElement("span");
    c.className="chip"; c.innerHTML=`<span class="t">${t}</span><button class="x" aria-label="إزالة">✕</button>`;
    wrap.insertBefore(c,input); c.querySelector(".x").addEventListener("click",()=>c.remove());
  }
  input?.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){ e.preventDefault(); add(input.value); input.value=""; }
    if(e.key==="Backspace" && !input.value){ wrap.querySelector(".chip:last-of-type")?.remove(); }
  });
  wrap?.addEventListener("click", ()=>input?.focus());
  return { get:()=>[...wrap.querySelectorAll(".chip .t")].map(n=>n.textContent), set:(arr)=>{ [...wrap.querySelectorAll(".chip")].forEach(x=>x.remove()); (arr||[]).forEach(add); } };
}
const allergies = chipInput(allergiesWrap);
const preferred = chipInput(preferredWrap);
const disliked  = chipInput(dislikedWrap);
const injSites  = chipInput(injSitesWrap);

// ===== childId resolution =====
const childId =
  new URLSearchParams(location.search).get("id") ||
  localStorage.getItem("selectedChildId") ||
  (auth?.currentUser?.uid ?? null);

const childRef = childId ? doc(db,"children",childId) : null;
let child = {};
let originalUnit = null;

// ===== normal range =====
function computeNormalRange(unit, custom){
  if(Array.isArray(custom) && custom.length===2 && custom[0]!=null && custom[1]!=null){
    return { min:+custom[0], max:+custom[1], source:"custom" };
  }
  if(unit==="mmol/L") return { min:3.5, max:7, source:"default" };
  if(unit==="mg/dL")  return { min:63,  max:126, source:"default" };
  return { min:null, max:null, source:"unknown" };
}
function updateNormalBadge(c){
  const unit = unitEl.value || c?.unit || "";
  const custom = c?.glucoseTargets?.normal;
  const nrm = computeNormalRange(unit, custom);
  const text = (nrm.min==null || nrm.max==null) ? "—" : `${nrm.min}–${nrm.max} ${unit||""}`;
  normalBadge.textContent = `المدى الطبيعي: ${text}`;
  normalHint.textContent = nrm.source==="custom"
    ? "معروض من القيم المخصصة."
    : "يُحسب تلقائيًا حسب الوحدة (3.5–7 mmol/L أو 63–126 mg/dL).";
}

// ===== load =====
(async function init(){
  try{
    status("جارٍ التحميل…");
    if(!childRef){ status("⚠️ لا يوجد معرّف للطفل"); return; }
    const snap = await getDoc(childRef);
    if(!snap.exists()){ status("❌ لا توجد بيانات للطفل"); return; }
    child = snap.data()||{};

    // Identity
    nameEl.value   = child.name||"";
    civilEl.value  = child.civilId||"";
    genderEl.value = child.gender||"";
    bdateEl.value  = child.birthDate||"";
    unitEl.value   = child.unit||"";
    hEl.value      = child.heightCm ?? "";
    wEl.value      = child.weightKg ?? "";

    originalUnit = child.unit||null;

    // Glucose limits
    f_criticalLow.value  = child.criticalLow ?? "";
    f_severeLow.value    = child.severeLow ?? "";
    f_hypo.value         = child.hypo ?? "";
    f_hyper.value        = child.hyper ?? "";
    f_severeHigh.value   = child.severeHigh ?? "";
    f_criticalHigh.value = child.criticalHigh ?? "";

    // Carb goals
    g_b_min.value = child.carbGoals?.b?.[0] ?? "";
    g_b_max.value = child.carbGoals?.b?.[1] ?? "";
    g_l_min.value = child.carbGoals?.l?.[0] ?? "";
    g_l_max.value = child.carbGoals?.l?.[1] ?? "";
    g_d_min.value = child.carbGoals?.d?.[0] ?? "";
    g_d_max.value = child.carbGoals?.d?.[1] ?? "";
    g_s_min.value = child.carbGoals?.s?.[0] ?? "";
    g_s_max.value = child.carbGoals?.s?.[1] ?? "";

    // Insulin
    crEl.value = child.carbRatio ?? "";
    cfEl.value = child.correctionFactor ?? "";
    targetPrefEl.value = child?.glucoseTargets?.targetPref || "max";

    crB.value = child.carbRatioByMeal?.b ?? "";
    crL.value = child.carbRatioByMeal?.l ?? "";
    crD.value = child.carbRatioByMeal?.d ?? "";
    crS.value = child.carbRatioByMeal?.s ?? "";

    cfB.value = child.correctionFactorByMeal?.b ?? "";
    cfL.value = child.correctionFactorByMeal?.l ?? "";
    cfD.value = child.correctionFactorByMeal?.d ?? "";
    cfS.value = child.correctionFactorByMeal?.s ?? "";

    basalEl.value     = child.basalType || "";
    bolusEl.value     = child.bolusType || "";
    devTypeEl.value   = child.deviceType || "";
    devModelEl.value  = child.deviceModel || "";
    insulinNotesEl.value = child.insulinNotes || "";
    injSites.set(child.injectionSites || []);

    // Diet
    applyDietFlags(child.dietaryFlags||[]);
    allergies.set(child.allergies||[]);
    preferred.set(child.preferred||[]);
    disliked.set(child.disliked||[]);

    // Header
    hdrName.textContent  = child.name || "—";
    hdrCivil.textContent = child.civilId || "—";
    hdrAge.textContent   = calcAge(child.birthDate);
    hdrUnit.textContent  = child.unit || "—";
    hdrUpdated.textContent = fmtDate(child.updated);

    if(roleBadge) roleBadge.textContent = child.role || "وليّ أمر";
    // doctor link
    await fillDoctorLink(child);

    // Normal range
    updateNormalBadge(child);

    // listeners
    attachValidation();

    status("✅ تم التحميل");
  }catch(e){
    console.error(e);
    status("❌ خطأ أثناء التحميل");
  }
})();

// ===== fill doctor link =====
async function fillDoctorLink(c){
  try{
    const did = c.assignedDoctorId || c.doctorId;
    if(did){
      doctorLink.textContent = c.doctorName || "الطبيب المعالج";
      doctorLink.href = `doctor-dashboard.html?id=${encodeURIComponent(did)}`;
    }else{
      doctorLink.textContent = "—";
      doctorLink.href = "#";
    }
  }catch{
    doctorLink.textContent = "—";
    doctorLink.href = "#";
  }
}

// ===== diet flags helpers =====
function applyDietFlags(arr){
  const set = new Set(arr||[]);
  flagsInputs.forEach(i=> i.checked = set.has(i.value));
}
function collectDietFlags(){
  return flagsInputs.filter(i=> i.checked).map(i=> i.value);
}

// ===== validation & hints =====
function validateGlucoseOrder(){
  const a=n0(f_criticalLow.value), b=n0(f_severeLow.value), c=n0(f_hypo.value),
        d=n0(f_hyper.value),      e=n0(f_severeHigh.value), f=n0(f_criticalHigh.value);
  const ok=(a<=b && b<=c && c<=d && d<=e && e<=f);
  glOrderHint.classList.toggle("warn", !ok);
  return ok;
}
function validateMealGoal(minEl,maxEl,errEl){
  const min=n(minEl.value), max=n(maxEl.value);
  errEl.textContent="";
  if(min==null && max==null) return true;
  if(min==null || max==null){ errEl.textContent="أدخلي القيمتين أو اتركيهما فارغتين."; return false; }
  if(min>max){ errEl.textContent="القيمة (من) يجب أن تكون ≤ (إلى)."; return false; }
  return true;
}
function attachValidation(){
  [f_criticalLow,f_severeLow,f_hypo,f_hyper,f_severeHigh,f_criticalHigh].forEach(el=>{
    el?.addEventListener("input", validateGlucoseOrder);
  });
  unitEl?.addEventListener("change", ()=>{
    unitChangeWarn.classList.toggle("hidden", unitEl.value===originalUnit);
    updateNormalBadge({ unit: unitEl.value, glucoseTargets: child?.glucoseTargets });
  });
}

// ===== save =====
$("#btnSave")?.addEventListener("click", saveChild);

async function saveChild(){
  try{
    const okB = validateMealGoal(g_b_min,g_b_max,err_b);
    const okL = validateMealGoal(g_l_min,g_l_max,err_l);
    const okD = validateMealGoal(g_d_min,g_d_max,err_d);
    const okS = validateMealGoal(g_s_min,g_s_max,err_s);
    validateGlucoseOrder();
    if(!(okB && okL && okD && okS)){ status("⚠️ راجعي أخطاء أهداف الكارب."); return; }

    const payload = {
      // Identity
      name: nameEl.value.trim() || null,
      civilId: civilEl.value.trim() || null,
      gender: genderEl.value || null,
      birthDate: bdateEl.value || null,
      unit: unitEl.value || null,
      heightCm: n(hEl.value),
      weightKg: n(wEl.value),

      // Glucose limits (flat)
      criticalLow:  n(f_criticalLow.value),
      severeLow:    n(f_severeLow.value),
      hypo:         n(f_hypo.value),
      hyper:        n(f_hyper.value),
      severeHigh:   n(f_severeHigh.value),
      criticalHigh: n(f_criticalHigh.value),

      // Carb goals
      carbGoals: {
        b: arrayPair(g_b_min.value, g_b_max.value),
        l: arrayPair(g_l_min.value, g_l_max.value),
        d: arrayPair(g_d_min.value, g_d_max.value),
        s: arrayPair(g_s_min.value, g_s_max.value)
      },

      // Insulin
      carbRatio: n(crEl.value),
      correctionFactor: n(cfEl.value),
      glucoseTargets: {
        ...(child.glucoseTargets||{}),
        targetPref: targetPrefEl.value || "max"
        // normal: [min,max] — لو هتضيفي إدخال يدوي لاحقًا
      },
      carbRatioByMeal: {
        b: n(crB.value), l: n(crL.value), d: n(crD.value), s: n(crS.value)
      },
      correctionFactorByMeal: {
        b: n(cfB.value), l: n(cfL.value), d: n(cfD.value), s: n(cfS.value)
      },

      // Device & types
      basalType: basalEl.value.trim() || null,
      bolusType: bolusEl.value.trim() || null,
      deviceType: devTypeEl.value || null,
      deviceModel: devModelEl.value.trim() || null,
      injectionSites: injSites.get(),
      insulinNotes: insulinNotesEl.value.trim() || null,

      // Diet
      dietaryFlags: collectDietFlags(),
      allergies: allergies.get(),
      preferred: preferred.get(),
      disliked: disliked.get(),

      updated: Date.now()
    };

    loader.classList.remove("hidden");
    status("جارٍ الحفظ…");
    await setDoc(childRef, payload, { merge:true });

    // update header
    hdrName.textContent  = payload.name || "—";
    hdrCivil.textContent = payload.civilId || "—";
    hdrAge.textContent   = calcAge(payload.birthDate);
    hdrUnit.textContent  = payload.unit || "—";
    hdrUpdated.textContent = fmtDate(payload.updated);
    fillDietSummary(payload.dietaryFlags);

    originalUnit = payload.unit || originalUnit;
    unitChangeWarn.classList.add("hidden");
    updateNormalBadge({ unit: payload.unit, glucoseTargets: payload.glucoseTargets });

    status("✅ تم الحفظ بنجاح");
  }catch(e){
    console.error(e);
    status("❌ حدث خطأ أثناء الحفظ");
  }finally{
    loader.classList.add("hidden");
  }
}
