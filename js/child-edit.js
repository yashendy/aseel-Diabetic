// ===== Firestore imports =====
// عدّلي الإصدار/المسارات لتطابق مشروعك (9.x كمثال):
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db } from "./firebase.js"; // <-- ضعي ملف تهيئة Firebase لديك

// ===== عناصر DOM سريعة =====
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

// Param: child id
const childId = new URLSearchParams(location.search).get("id") || "current";
const childRef = doc(db, "children", childId);

// عناصر عامة
const btnSave = $("#btnSave");
const statusEl = $("#status");
const loader = $("#loader");

// Inputs
const nameEl   = $("#f_name");
const civilEl  = $("#f_civilId");
const genderEl = $("#f_gender");
const bdateEl  = $("#f_birthDate");
const unitEl   = $("#f_unit");
const hEl      = $("#f_heightCm");
const wEl      = $("#f_weightKg");

// Glucose bounds
const f_criticalLow   = $("#f_criticalLow");
const f_severeLow     = $("#f_severeLow");
const f_hypo          = $("#f_hypo");
const f_hyper         = $("#f_hyper");
const f_severeHigh    = $("#f_severeHigh");
const f_criticalHigh  = $("#f_criticalHigh");
const normalBadge     = $("#normalBadge");
const normalHint      = $("#normalHint");
const glOrderHint     = $("#glOrderHint");

// Carb goals
const g_b_min = $("#f_carb_b_min"), g_b_max = $("#f_carb_b_max");
const g_l_min = $("#f_carb_l_min"), g_l_max = $("#f_carb_l_max");
const g_d_min = $("#f_carb_d_min"), g_d_max = $("#f_carb_d_max");
const g_s_min = $("#f_carb_s_min"), g_s_max = $("#f_carb_s_max");
const err_b = $("#err_b"), err_l = $("#err_l"), err_d = $("#err_d"), err_s = $("#err_s");

// Insulin general
const crEl = $("#f_carbRatio");
const cfEl = $("#f_correctionFactor");
const targetPrefEl = $("#f_targetPref");

// Insulin by meal (optional)
const crB=$("#f_cr_b"), crL=$("#f_cr_l"), crD=$("#f_cr_d"), crS=$("#f_cr_s");
const cfB=$("#f_cf_b"), cfL=$("#f_cf_l"), cfD=$("#f_cf_d"), cfS=$("#f_cf_s");

// Insulin types & device
const basalEl = $("#f_basalType");
const bolusEl = $("#f_bolusType");
const devTypeEl = $("#f_deviceType");
const devModelEl = $("#f_deviceModel");
const injSitesWrap = $("#injectionSitesInput");
const insulinNotesEl = $("#f_insulinNotes");

// Diet flags & chips
const flagWrap = $("#dietFlags");
const flagsInputs = $$(".diet-flag", flagWrap);
const allergiesWrap = $("#allergiesInput");
const preferredWrap = $("#preferredInput");
const dislikedWrap  = $("#dislikedInput");

// Summary
const hdrName   = $("#hdrName");
const hdrCivil  = $("#hdrCivil");
const hdrAge    = $("#hdrAge");
const hdrUnit   = $("#hdrUnit");
const hdrUpdated= $("#hdrUpdated");
const hdrDietChips = $("#hdrDietChips");
const unitChangeWarn = $("#unitChangeWarn");

let originalUnit = null;

// ===== Chip helpers =====
function chipInput(wrap){
  const input = wrap?.querySelector("input");
  function add(t){
    t=(t||"").trim(); if(!t) return;
    const exists = [...wrap.querySelectorAll(".chip .t")].some(n=>n.textContent===t);
    if(exists) return;
    const c=document.createElement("span");
    c.className="chip"; c.innerHTML=`<span class="t">${t}</span><button class="x" aria-label="إزالة">✕</button>`;
    wrap.insertBefore(c,input);
    c.querySelector(".x").addEventListener("click",()=>c.remove());
  }
  input?.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){ e.preventDefault(); add(input.value); input.value=""; }
    if(e.key==="Backspace" && !input.value){ wrap.querySelector(".chip:last-of-type")?.remove(); }
  });
  wrap?.addEventListener("click", ()=>input?.focus());
  return {
    get:()=>[...wrap.querySelectorAll(".chip .t")].map(n=>n.textContent),
    set:(arr)=>{ [...wrap.querySelectorAll(".chip")].forEach(x=>x.remove()); (arr||[]).forEach(add); }
  };
}
const allergies = chipInput(allergiesWrap);
const preferred = chipInput(preferredWrap);
const disliked  = chipInput(dislikedWrap);
const injSites  = chipInput(injSitesWrap);

// ===== Utils =====
function setVal(selOrEl, v){ const el = (typeof selOrEl==="string")? $(selOrEl) : selOrEl; if(el) el.value = (v ?? ""); }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function n0(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function fmtDate(ms){ try{ if(!ms) return "—"; const d=new Date(ms); return d.toLocaleString('ar'); }catch{ return "—"; } }
function calcAge(dateStr){
  if(!dateStr) return "—";
  const d=new Date(dateStr); if(isNaN(d)) return "—";
  const diff=Date.now()-d.getTime(); const years = Math.floor(diff/(365.25*24*3600*1000));
  return `${years} سنة`;
}
function arrayPair(min,max){ const a=num(min), b=num(max); return (a==null && b==null)? null : [a,b]; }
function fillDietSummary(flags=[]){
  hdrDietChips.innerHTML="";
  (flags||[]).forEach(f=>{
    const span=document.createElement("span");
    span.className="chip";
    span.textContent = flagTitle(f);
    hdrDietChips.appendChild(span);
  });
}
function flagTitle(val){
  const map={
    halal:"حلال", vegetarian:"نباتي", vegan:"نباتي صارم",
    gluten_free:"خالٍ من الجلوتين", lactose_free:"خالٍ من اللاكتوز",
    low_sugar:"قليل السكر", low_carb:"قليل الكارب", low_fat:"قليل الدهون",
    low_sodium:"قليل الصوديوم", low_satfat:"دهون مشبعة قليلة"
  };
  return map[val] || val;
}

// ===== Normal range (3.5–7 mmol/L) logic =====
function computeNormalRange(unit, custom){
  // custom: [min,max] بنفس وحدة الطفل إن وُجدت
  if(Array.isArray(custom) && custom.length===2 && custom[0]!=null && custom[1]!=null){
    return { min:+custom[0], max:+custom[1], source:"custom" };
  }
  if(unit==="mmol/L"){ return { min:3.5, max:7.0, source:"default" }; }
  if(unit==="mg/dL"){ return { min:63,  max:126, source:"default" }; }
  return { min:null, max:null, source:"unknown" };
}

// ===== Load child =====
btnSave?.addEventListener("click", saveChild);
unitEl?.addEventListener("change", ()=>{
  if(!originalUnit) return;
  unitChangeWarn.classList.toggle("hidden", unitEl.value===originalUnit);
  updateNormalBadge();
});

(async function loadChild(){
  try{
    status("جارٍ التحميل…");
    const snap = await getDoc(childRef);
    if(!snap.exists()){
      status("لم يتم العثور على مستند الطفل — سيتم الإنشاء عند الحفظ.");
      return;
    }
    const c = snap.data();

    // الهوية
    setVal(nameEl,   c.name);
    setVal(civilEl,  c.civilId);
    setVal(genderEl, c.gender);
    setVal(bdateEl,  c.birthDate);
    setVal(unitEl,   c.unit); originalUnit = c.unit || null;
    setVal(hEl,      c.heightCm);
    setVal(wEl,      c.weightKg);

    // سكر الدم
    setVal(f_criticalLow,  c.criticalLow);
    setVal(f_severeLow,    c.severeLow);
    setVal(f_hypo,         c.hypo);
    setVal(f_hyper,        c.hyper);
    setVal(f_severeHigh,   c.severeHigh);
    setVal(f_criticalHigh, c.criticalHigh);

    // الأهداف
    if(c.carbGoals){
      setVal(g_b_min, c.carbGoals.b?.[0]); setVal(g_b_max, c.carbGoals.b?.[1]);
      setVal(g_l_min, c.carbGoals.l?.[0]); setVal(g_l_max, c.carbGoals.l?.[1]);
      setVal(g_d_min, c.carbGoals.d?.[0]); setVal(g_d_max, c.carbGoals.d?.[1]);
      setVal(g_s_min, c.carbGoals.s?.[0]); setVal(g_s_max, c.carbGoals.s?.[1]);
    }

    // الأنسولين
    setVal(crEl, c.carbRatio);
    setVal(cfEl, c.correctionFactor);
    setVal(targetPrefEl, c?.glucoseTargets?.targetPref || "max");

    if(c.carbRatioByMeal){
      setVal(crB, c.carbRatioByMeal.b); setVal(crL, c.carbRatioByMeal.l);
      setVal(crD, c.carbRatioByMeal.d); setVal(crS, c.carbRatioByMeal.s);
    }
    if(c.correctionFactorByMeal){
      setVal(cfB, c.correctionFactorByMeal.b); setVal(cfL, c.correctionFactorByMeal.l);
      setVal(cfD, c.correctionFactorByMeal.d); setVal(cfS, c.correctionFactorByMeal.s);
    }

    setVal(basalEl, c.basalType);
    setVal(bolusEl, c.bolusType);
    setVal(devTypeEl, c.deviceType);
    setVal(devModelEl, c.deviceModel);
    injSites.set(c.injectionSites || []);
    setVal(insulinNotesEl, c.insulinNotes);

    // أنظمة وغذاء
    applyDietFlags(c.dietaryFlags || []);
    allergies.set(c.allergies || []);
    preferred.set(c.preferred || []);
    disliked.set(c.disliked || []);

    // ملخص
    hdrName.textContent = c.name || "—";
    hdrCivil.textContent= c.civilId || "—";
    hdrAge.textContent  = calcAge(c.birthDate);
    hdrUnit.textContent = c.unit || "—";
    hdrUpdated.textContent = fmtDate(c.updated);
    fillDietSummary(c.dietaryFlags || []);

    // المدى الطبيعي Badge
    updateNormalBadge(c);

    status("✅ تم التحميل");
  }catch(e){
    console.error(e);
    status("❌ خطأ أثناء التحميل");
  }
})();

function status(t){ statusEl.textContent = t; }

function applyDietFlags(arr){
  const set = new Set(arr||[]);
  flagsInputs.forEach(i=> i.checked = set.has(i.value));
}

function collectDietFlags(){
  return flagsInputs.filter(i=> i.checked).map(i=> i.value);
}

function updateNormalBadge(child){
  const unit = unitEl.value || (child?.unit) || "";
  const custom = child?.glucoseTargets?.normal;
  const n = computeNormalRange(unit, custom);
  const text = (n.min==null || n.max==null) ? "—" : `${n.min}–${n.max} ${unit||""}`;
  normalBadge.textContent = `المدى الطبيعي: ${text}`;
  normalHint.textContent = n.source==="custom"
    ? "معروض من القيم المخصصة."
    : "يُحسب تلقائيًا حسب الوحدة (3.5–7 mmol/L أو 63–126 mg/dL).";
}

// ===== Validation (لا يمنع الحفظ إلا لأهداف الكارب غير المنطقية) =====
function validateGlucoseOrder(){
  const a = n0(f_criticalLow.value);
  const b = n0(f_severeLow.value);
  const c = n0(f_hypo.value);
  const d = n0(f_hyper.value);
  const e = n0(f_severeHigh.value);
  const f = n0(f_criticalHigh.value);
  const ok = (a<=b && b<=c && c<=d && d<=e && e<=f);
  glOrderHint.classList.toggle("warn", !ok);
  return ok;
}
[f_criticalLow,f_severeLow,f_hypo,f_hyper,f_severeHigh,f_criticalHigh].forEach(el=>{
  el?.addEventListener("input", ()=>{ validateGlucoseOrder(); });
});

function validateMealGoal(minEl,maxEl,errEl){
  const min = num(minEl.value), max = num(maxEl.value);
  errEl.textContent = "";
  if(min==null && max==null) return true;
  if(min==null || max==null){ errEl.textContent="أدخلي القيمتين أو اتركيهما فارغتين."; return false; }
  if(min>max){ errEl.textContent="القيمة (من) يجب أن تكون ≤ (إلى)."; return false; }
  return true;
}

// ===== Save =====
async function saveChild(){
  try{
    // تحقق خفيف
    const okB = validateMealGoal(g_b_min,g_b_max,err_b);
    const okL = validateMealGoal(g_l_min,g_l_max,err_l);
    const okD = validateMealGoal(g_d_min,g_d_max,err_d);
    const okS = validateMealGoal(g_s_min,g_s_max,err_s);
    // ترتيب سكر الدم — تحذير فقط
    validateGlucoseOrder();

    if(!(okB && okL && okD && okS)){
      status("⚠️ راجعي أخطاء أهداف الكارب.");
      return;
    }

    const payload = {
      // الهوية
      name: nameEl.value.trim() || null,
      civilId: civilEl.value.trim() || null,
      gender: genderEl.value || null,
      birthDate: bdateEl.value || null,
      unit: unitEl.value || null,
      heightCm: num(hEl.value),
      weightKg: num(wEl.value),

      // سكر الدم (حقول مسطحة — نفس الأسماء)
      criticalLow:   num(f_criticalLow.value),
      severeLow:     num(f_severeLow.value),
      hypo:          num(f_hypo.value),
      hyper:         num(f_hyper.value),
      severeHigh:    num(f_severeHigh.value),
      criticalHigh:  num(f_criticalHigh.value),

      // أهداف الكارب
      carbGoals: {
        b: arrayPair(g_b_min.value, g_b_max.value),
        l: arrayPair(g_l_min.value, g_l_max.value),
        d: arrayPair(g_d_min.value, g_d_max.value),
        s: arrayPair(g_s_min.value, g_s_max.value)
      },

      // الأنسولين (عام)
      carbRatio: num(crEl.value),
      correctionFactor: num(cfEl.value),
      glucoseTargets: {
        targetPref: targetPrefEl.value || "max"
        // normal: [min,max] — يمكن إضافتها لاحقًا لو وفّرتِ إدخالًا يدويًا
      },

      // الأنسولين (حسب الوجبة) — اختياري
      carbRatioByMeal: {
        b: num(crB.value), l: num(crL.value), d: num(crD.value), s: num(crS.value)
      },
      correctionFactorByMeal: {
        b: num(cfB.value), l: num(cfL.value), d: num(cfD.value), s: num(cfS.value)
      },

      // الأنواع والجهاز
      basalType: basalEl.value.trim() || null,
      bolusType: bolusEl.value.trim() || null,
      deviceType: devTypeEl.value || null,
      deviceModel: devModelEl.value.trim() || null,
      injectionSites: injSites.get(),

      insulinNotes: insulinNotesEl.value.trim() || null,

      // أنظمة وغذاء
      dietaryFlags: collectDietFlags(),
      allergies: allergies.get(),
      preferred: preferred.get(),
      disliked: disliked.get(),

      updated: Date.now()
    };

    loader.classList.remove("hidden");
    status("جارٍ الحفظ…");
    await setDoc(childRef, payload, { merge:true });

    // بعد الحفظ: تحديث الملخص والبادجات
    hdrName.textContent = payload.name || "—";
    hdrCivil.textContent= payload.civilId || "—";
    hdrAge.textContent  = calcAge(payload.birthDate);
    hdrUnit.textContent = payload.unit || "—";
    hdrUpdated.textContent = fmtDate(payload.updated);
    fillDietSummary(payload.dietaryFlags);

    // تحديث تحذير الوحدة المرجعية
    originalUnit = payload.unit || originalUnit;
    unitChangeWarn.classList.add("hidden");

    // تحديث Badge المدى الطبيعي
    updateNormalBadge({ unit: payload.unit, glucoseTargets: payload.glucoseTargets });

    status("✅ تم الحفظ بنجاح");
  }catch(e){
    console.error(e);
    status("❌ حدث خطأ أثناء الحفظ");
  }finally{
    loader.classList.add("hidden");
  }
}
