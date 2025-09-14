// ===== Firebase v12.1.0 =====
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { db, auth } from "./firebase-config.js";

// ===== DOM helpers =====
const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const setStatus=t=>{const el=$("#status"); if(el) el.textContent=t||"—";};

// Header
const roleBadge=$("#roleBadge"), doctorLink=$("#doctorLink");
const hdrName=$("#hdrName"), hdrCivil=$("#hdrCivil"), hdrAge=$("#hdrAge"), hdrUnit=$("#hdrUnit"), hdrUpdated=$("#hdrUpdated"), hdrDietChips=$("#hdrDietChips");

// Identity
const nameEl=$("#f_name"), civilEl=$("#f_civilId"), genderEl=$("#f_gender"), bdateEl=$("#f_birthDate"), unitEl=$("#f_unit"), hEl=$("#f_heightCm"), wEl=$("#f_weightKg");

// Glucose limits
const f_criticalLow=$("#f_criticalLow"), f_severeLow=$("#f_severeLow"), f_hypo=$("#f_hypo"), f_hyper=$("#f_hyper"), f_severeHigh=$("#f_severeHigh"), f_criticalHigh=$("#f_criticalHigh");
const normalBadge=$("#normalBadge"), normalHint=$("#normalHint"), glOrderHint=$("#glOrderHint");

// Carb goals UI (breakfast/lunch/dinner/snack)
const g_b_min=$("#f_carb_b_min"), g_b_max=$("#f_carb_b_max");
const g_l_min=$("#f_carb_l_min"), g_l_max=$("#f_carb_l_max");
const g_d_min=$("#f_carb_d_min"), g_d_max=$("#f_carb_d_max");
const g_s_min=$("#f_carb_s_min"), g_s_max=$("#f_carb_s_max");
const err_b=$("#err_b"), err_l=$("#err_l"), err_d=$("#err_d"), err_s=$("#err_s");

// Insulin
const crEl=$("#f_carbRatio"), cfEl=$("#f_correctionFactor"), targetPrefEl=$("#f_targetPref");
const crB=$("#f_cr_b"), crL=$("#f_cr_l"), crD=$("#f_cr_d"), crS=$("#f_cr_s");
const cfB=$("#f_cf_b"), cfL=$("#f_cf_l"), cfD=$("#f_cf_d"), cfS=$("#f_cf_s");
const basalEl=$("#f_basalType"), bolusEl=$("#f_bolusType"), devTypeEl=$("#f_deviceType"), devModelEl=$("#f_deviceModel"), insulinNotesEl=$("#f_insulinNotes");

// Diet & chips
const injSitesWrap=$("#injectionSitesInput"), allergiesWrap=$("#allergiesInput"), preferredWrap=$("#preferredInput"), dislikedWrap=$("#dislikedInput");
const flagWrap=$("#dietFlags"), flagsInputs=$$(".diet-flag",flagWrap);

// Buttons
const btnSave=$("#btnSave"), loader=$("#loader"), unitChangeWarn=$("#unitChangeWarn");

// ===== Utils =====
const n=v=>Number.isFinite(+v)?+v:null; const n0=v=>Number.isFinite(+v)?+v:0;
const fmtDate=ms=>{try{if(!ms)return"—";const d=new Date(ms);return d.toLocaleString('ar')}catch{return"—"}};
const calcAge=dStr=>{if(!dStr)return"—";const d=new Date(dStr);if(isNaN(d))return"—";const years=Math.floor((Date.now()-d.getTime())/(365.25*24*3600*1000));return `${years} سنة`;};
const arrayPair=(a,b)=> (n(a)==null && n(b)==null) ? null : [n(a),n(b)];

function fillDietSummary(flags=[]) {
  if(!hdrDietChips) return; hdrDietChips.innerHTML="";
  const map={halal:"حلال",vegetarian:"نباتي",vegan:"نباتي صارم",gluten_free:"خالٍ من الجلوتين",lactose_free:"خالٍ من اللاكتوز",low_sugar:"قليل السكر",low_carb:"قليل الكارب",low_fat:"قليل الدهون",low_sodium:"قليل الصوديوم",low_satfat:"دهون مشبعة قليلة"};
  (flags||[]).forEach(f=>{const s=document.createElement("span"); s.className="chip"; s.textContent=map[f]||f; hdrDietChips.appendChild(s);});
}
function chipInput(wrap){
  const input=wrap?.querySelector("input");
  function add(t){t=(t||"").trim(); if(!t)return; const exists=[...wrap.querySelectorAll(".chip .t")].some(n=>n.textContent===t); if(exists)return;
    const c=document.createElement("span"); c.className="chip"; c.innerHTML=`<span class="t">${t}</span><button class="x" aria-label="إزالة">✕</button>`;
    wrap.insertBefore(c,input); c.querySelector(".x").addEventListener("click",()=>c.remove());}
  input?.addEventListener("keydown",(e)=>{if(e.key==="Enter"){e.preventDefault();add(input.value);input.value="";} if(e.key==="Backspace"&&!input.value){wrap.querySelector(".chip:last-of-type")?.remove();}});
  wrap?.addEventListener("click",()=>input?.focus());
  return {get:()=>[...wrap.querySelectorAll(".chip .t")].map(n=>n.textContent), set:(arr)=>{[...wrap.querySelectorAll(".chip")].forEach(x=>x.remove()); (arr||[]).forEach(add);} };
}
const allergies=chipInput(allergiesWrap), preferred=chipInput(preferredWrap), disliked=chipInput(dislikedWrap), injSites=chipInput(injSitesWrap);

// ===== Resolve IDs & refs =====
const qs=new URLSearchParams(location.search);
const parentId= qs.get("parentId") || localStorage.getItem("selectedParentId") || (auth?.currentUser?.uid ?? null);
const childId = qs.get("id")       || localStorage.getItem("selectedChildId") || null;
const childRef=(parentId && childId)? doc(db,"parents",parentId,"children",childId):null;
let child={}, originalUnit=null;

// Roles
async function getCurrentUserRole(){ try{ if(!auth?.currentUser?.uid) return "parent"; const uref=doc(db,"users",auth.currentUser.uid); const usnap=await getDoc(uref); return usnap.exists()?(usnap.data().role||"parent"):"parent"; }catch{return "parent";}}

// Normal range
function computeNormalRange(unit,custom){ if(Array.isArray(custom)&&custom.length===2&&custom[0]!=null&&custom[1]!=null){return {min:+custom[0],max:+custom[1],source:"custom"}}
  if(unit==="mmol/L") return {min:3.5,max:7,source:"default"}; if(unit==="mg/dL") return {min:63,max:126,source:"default"}; return {min:null,max:null,source:"unknown"};}
function updateNormalBadge(c){ if(!normalBadge||!normalHint) return; const unit=unitEl.value||c?.unit||c?.glucoseUnit||""; const custom=c?.glucoseTargets?.normal||c?.normalRange; const nrm=computeNormalRange(unit,custom);
  const text=(nrm.min==null||nrm.max==null)?"—":`${nrm.min}–${nrm.max} ${unit||""}`; normalBadge.textContent=`المدى الطبيعي: ${text}`; normalHint.textContent=nrm.source==="custom"?"معروض من القيم المخصصة.":"يُحسب تلقائيًا حسب الوحدة (3.5–7 mmol/L أو 63–126 mg/dL).";}

// ===== Load =====
(async function init(){
  try{
    setStatus("جارٍ التحميل…");
    if(!childRef){ setStatus("⚠️ لا يوجد معرّف للطفل"); return; }
    const snap=await getDoc(childRef); if(!snap.exists()){ setStatus("❌ لا توجد بيانات للطفل"); return; }
    child=snap.data()||{};

    // Identity
    nameEl.value=child.name||""; civilEl.value=child.civilId||""; genderEl.value=child.gender||""; bdateEl.value=child.birthDate||"";
    unitEl.value=child.unit||child.glucoseUnit||""; hEl.value=child.heightCm??""; wEl.value=child.weightKg??""; originalUnit=unitEl.value||null;

    // Glucose
    f_criticalLow.value = child.criticalLow  ?? child.criticalLowLevel  ?? "";
    f_severeLow.value   = child.severeLow    ?? "";
    f_hypo.value        = child.hypo        ?? child.hypoLevel         ?? "";
    f_hyper.value       = child.hyper       ?? child.hyperLevel        ?? "";
    f_severeHigh.value  = child.severeHigh  ?? "";
    f_criticalHigh.value= child.criticalHigh?? child.criticalHighLevel ?? "";

    // ✅ Carb targets: read from carbTargets OR legacy carbGoals
    const ct = child.carbTargets || child.carbGoals || {};
    g_b_min.value = ct.breakfast?.[0] ?? ct.b?.[0] ?? "";
    g_b_max.value = ct.breakfast?.[1] ?? ct.b?.[1] ?? "";
    g_l_min.value = ct.lunch    ?. [0] ?? ct.l?.[0] ?? "";
    g_l_max.value = ct.lunch    ?. [1] ?? ct.l?.[1] ?? "";
    g_d_min.value = ct.dinner   ?. [0] ?? ct.d?.[0] ?? "";
    g_d_max.value = ct.dinner   ?. [1] ?? ct.d?.[1] ?? "";
    g_s_min.value = ct.snack    ?. [0] ?? ct.s?.[0] ?? "";
    g_s_max.value = ct.snack    ?. [1] ?? ct.s?.[1] ?? "";

    // Insulin
    crEl.value=child.carbRatio??""; cfEl.value=child.correctionFactor??""; targetPrefEl.value=child?.glucoseTargets?.targetPref||"max";
    crB.value=child.carbRatioByMeal?.b??""; crL.value=child.carbRatioByMeal?.l??""; crD.value=child.carbRatioByMeal?.d??""; crS.value=child.carbRatioByMeal?.s??"";
    cfB.value=child.correctionFactorByMeal?.b??""; cfL.value=child.correctionFactorByMeal?.l??""; cfD.value=child.correctionFactorByMeal?.d??""; cfS.value=child.correctionFactorByMeal?.s??"";
    basalEl.value=child.basalType||""; bolusEl.value=child.bolusType||""; devTypeEl.value=child.deviceType||""; devModelEl.value=child.deviceModel||"";
    insulinNotesEl.value=child.insulinNotes||""; injSites.set(child.injectionSites||[]);

    // Diet
    applyDietFlags(child.dietaryFlags||[]); allergies.set(child.allergies||[]); preferred.set(child.preferred||[]); disliked.set(child.disliked||[]);

    // Header
    if(hdrName) hdrName.textContent=child.name||"—";
    if(hdrCivil) hdrCivil.textContent=child.civilId||"—";
    if(hdrAge) hdrAge.textContent=calcAge(child.birthDate);
    if(hdrUnit) hdrUnit.textContent=unitEl.value||"—";
    if(hdrUpdated) hdrUpdated.textContent=fmtDate(child.updated||child.updatedAt);
    if(roleBadge) roleBadge.textContent=child.role||"وليّ أمر";
    await fillDoctorLink(child);

    updateNormalBadge(child); attachValidation();
    setStatus("✅ تم التحميل");
  }catch(e){ console.error(e); setStatus("❌ خطأ أثناء التحميل"); }
})();

async function fillDoctorLink(c){
  try{
    const did=c.assignedDoctor||c.assignedDoctorId||c.doctorId;
    if(did){ if(doctorLink){ doctorLink.textContent=c.doctorName||c.assignedDoctorInfo?.name||"الطبيب المعالج"; doctorLink.href=`doctor-dashboard.html?id=${encodeURIComponent(did)}`; } }
    else { if(doctorLink){ doctorLink.textContent="—"; doctorLink.href="#"; } }
  }catch{ if(doctorLink){ doctorLink.textContent="—"; doctorLink.href="#"; } }
}
function applyDietFlags(arr){ const set=new Set(arr||[]); flagsInputs.forEach(i=> i.checked=set.has(i.value)); }
function collectDietFlags(){ return flagsInputs.filter(i=>i.checked).map(i=>i.value); }

function validateGlucoseOrder(){
  if(!glOrderHint) return true;
  const a=n0(f_criticalLow.value), b=n0(f_severeLow.value), c=n0(f_hypo.value),
        d=n0(f_hyper.value), e=n0(f_severeHigh.value), f=n0(f_criticalHigh.value);
  const ok=(a<=b && b<=c && c<=d && d<=e && e<=f); glOrderHint.classList.toggle("warn",!ok); return ok;
}
function validateMealGoal(minEl,maxEl,errEl){
  const min=n(minEl.value), max=n(maxEl.value); if(errEl) errEl.textContent="";
  if(min==null && max==null) return true;
  if(min==null || max==null){ if(errEl) errEl.textContent="أدخلي القيمتين أو اتركيهما فارغتين."; return false; }
  if(min>max){ if(errEl) errEl.textContent="القيمة (من) يجب أن تكون ≤ (إلى)."; return false; }
  return true;
}
function attachValidation(){
  [f_criticalLow,f_severeLow,f_hypo,f_hyper,f_severeHigh,f_criticalHigh].forEach(el=>el?.addEventListener("input",validateGlucoseOrder));
  unitEl?.addEventListener("change",()=>{ if(unitChangeWarn) unitChangeWarn.classList.toggle("hidden",unitEl.value===originalUnit); updateNormalBadge({unit:unitEl.value,glucoseTargets:child?.glucoseTargets}); });
}

function buildCarbTargetsFromUI(){
  const breakfast=arrayPair(g_b_min.value,g_b_max.value);
  const lunch=arrayPair(g_l_min.value,g_l_max.value);
  const dinner=arrayPair(g_d_min.value,g_d_max.value);
  const snack=arrayPair(g_s_min.value,g_s_max.value);
  const obj={}; if(breakfast) obj.breakfast=breakfast; if(lunch) obj.lunch=lunch; if(dinner) obj.dinner=dinner; if(snack) obj.snack=snack;
  return Object.keys(obj).length?obj:null;
}
function fullPayloadCommon(){
  const carbTargets=buildCarbTargetsFromUI(); const now=Date.now();
  return {
    name:(nameEl.value||"").trim()||null, civilId:(civilEl.value||"").trim()||null, gender:genderEl.value||null, birthDate:bdateEl.value||null,
    unit:unitEl.value||null, glucoseUnit:unitEl.value||null, heightCm:n(hEl.value), weightKg:n(wEl.value),
    criticalLow:n(f_criticalLow.value), severeLow:n(f_severeLow.value), hypo:n(f_hypo.value), hyper:n(f_hyper.value), severeHigh:n(f_severeHigh.value), criticalHigh:n(f_criticalHigh.value),
    carbTargets,                       // ✅ صيغة القواعد
    carbGoals: carbTargets ? { b:carbTargets.breakfast, l:carbTargets.lunch, d:carbTargets.dinner, s:carbTargets.snack } : null, // توافق قديم
    carbRatio:n(crEl.value), correctionFactor:n(cfEl.value),
    glucoseTargets:{...(child.glucoseTargets||{}), targetPref:targetPrefEl.value||"max"},
    carbRatioByMeal:{b:n(crB.value),l:n(crL.value),d:n(crD.value),s:n(crS.value)},
    correctionFactorByMeal:{b:n(cfB.value),l:n(cfL.value),d:n(cfD.value),s:n(cfS.value)},
    basalType:(basalEl.value||"").trim()||null, bolusType:(bolusEl.value||"").trim()||null, deviceType:devTypeEl.value||null, deviceModel:(devModelEl.value||"").trim()||null,
    injectionSites:injSites.get(), insulinNotes:(insulinNotesEl.value||"").trim()||null,
    dietaryFlags:collectDietFlags(), allergies:allergies.get(), preferred:preferred.get(), disliked:disliked.get(),
    parentId, updated:now, updatedAt:now
  };
}
function doctorAllowedPayloadFrom(full){
  return {
    name:full.name, gender:full.gender, birthDate:full.birthDate, unit:full.unit, glucoseUnit:full.glucoseUnit,
    updated:full.updated, updatedAt:full.updatedAt,
    carbRatio:full.carbRatio, correctionFactor:full.correctionFactor,
    basalType:full.basalType, bolusType:full.bolusType,
    heightCm:full.heightCm, weightKg:full.weightKg,
    criticalLow:full.criticalLow, severeLow:full.severeLow, hypo:full.hypo, hyper:full.hyper, severeHigh:full.severeHigh, criticalHigh:full.criticalHigh,
    carbTargets:full.carbTargets,                   // ✅ مطابق للـ Rules
    assignedDoctorInfo: child.assignedDoctorInfo || null
  };
}

// Save
$("#btnSave")?.addEventListener("click",saveChild);
async function saveChild(){
  try{
    const okB=validateMealGoal(g_b_min,g_b_max,err_b);
    const okL=validateMealGoal(g_l_min,g_l_max,err_l);
    const okD=validateMealGoal(g_d_min,g_d_max,err_d);
    const okS=validateMealGoal(g_s_min,g_s_max,err_s);
    validateGlucoseOrder();
    if(!(okB&&okL&&okD&&okS)){ setStatus("⚠️ راجعي أخطاء أهداف الكارب."); return; }
    if(!childRef){ setStatus("⚠️ لا يوجد مرجع للطفل"); return; }

    const role=await getCurrentUserRole();
    const isOwner= !!auth?.currentUser?.uid && (auth.currentUser.uid===parentId);
    const isDoctor = role==="doctor";

    const full=fullPayloadCommon();
    const doctorPld=doctorAllowedPayloadFrom(full);
    const payloadToWrite=(isOwner || !isDoctor)? full : doctorPld;

    if(loader) loader.classList.remove("hidden"); setStatus("جارٍ الحفظ…");
    await setDoc(childRef, payloadToWrite, { merge:true });

    if(hdrName) hdrName.textContent=full.name||"—";
    if(hdrCivil) hdrCivil.textContent=full.civilId||"—";
    if(hdrAge) hdrAge.textContent=calcAge(full.birthDate);
    if(hdrUnit) hdrUnit.textContent=full.unit||"—";
    if(hdrUpdated) hdrUpdated.textContent=fmtDate(full.updated);
    fillDietSummary(full.dietaryFlags);

    originalUnit=full.unit||originalUnit; if(unitChangeWarn) unitChangeWarn.classList.add("hidden");
    updateNormalBadge({unit:full.unit,glucoseTargets:full.glucoseTargets});
    setStatus("✅ تم الحفظ بنجاح");
  }catch(e){ console.error(e); setStatus("❌ حدث خطأ أثناء الحفظ"); }
  finally{ if(loader) loader.classList.add("hidden"); }
}
