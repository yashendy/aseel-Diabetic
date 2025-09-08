// js/child-edit.js
import { auth, db } from "./firebase-config.js";
import { saveContextToStorage } from "./js/common-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر الواجهة */
const el = (id)=>document.getElementById(id);
const childIdBadge = el("childIdBadge");
const loader = el("loader");
const toast = el("toast");
const linkStatus = el("linkStatus");
const doctorState = el("doctorState");

const btnRefresh = el("btnRefresh");
const btnSave = el("btnSave");
const btnBack = el("btnBack");
const btnLinkDoctor = el("btnLinkDoctor");
const btnUnlinkDoctor = el("btnUnlinkDoctor");

const fields = {
  name: el("f_name"),
  gender: el("f_gender"),
  birthDate: el("f_birthDate"),

  unit: el("f_unit"),
  deviceName: el("f_deviceName"),
  weightKg: el("f_weightKg"),
  heightCm: el("f_heightCm"),

  bolusType: el("f_bolusType"),
  basalType: el("f_basalType"),
  longInsulin: el("f_longInsulin"),
  longTime: el("f_longTime"),
  longUnits: el("f_longUnits"),

  carbRatio: el("f_carbRatio"),
  correctionFactor: el("f_correctionFactor"),

  // net carbs
  useNetCarbs: el("f_useNetCarbs"),
  netCarbRule: el("f_netCarbRule"),

  // carb targets
  carb_b_min: el("f_carb_b_min"),
  carb_b_max: el("f_carb_b_max"),
  carb_l_min: el("f_carb_l_min"),
  carb_l_max: el("f_carb_l_max"),
  carb_d_min: el("f_carb_d_min"),
  carb_d_max: el("f_carb_d_max"),
  carb_s_min: el("f_carb_s_min"),
  carb_s_max: el("f_carb_s_max"),

  // normal range + severe
  norm_min: el("f_norm_min"),
  norm_max: el("f_norm_max"),
  severeLow: el("f_severeLow"),
  severeHigh: el("f_severeHigh"),

  // privacy
  shareDoctor: el("f_shareDoctor"),
};

let currentParent = null;
let parentId = null;
let childId  = null;
let childDocPath = null;
let childData = null;

/* أدوات */
function num(v){ return (v===''||v===null||v===undefined)? null : Number(v); }
function clampNull(v){ return v==='' ? null : Number(v); }
function qs(key){ const u=new URLSearchParams(location.search); return u.get(key) || ""; }
function showLoader(v=true){ loader.classList.toggle("hidden", !v); }
function showToast(msg="تم"){ toast.querySelector(".msg").textContent = msg; toast.classList.remove("hidden"); setTimeout(()=>toast.classList.add("hidden"), 1800); }
function setStatus(msg, ok=false){ linkStatus.textContent = msg; linkStatus.className = "status " + (ok ? "ok" : "err"); }
function clearStatus(){ setStatus("", true); linkStatus.classList.add("hidden"); requestAnimationFrame(()=>linkStatus.classList.remove("hidden")); }
function setDoctorBadge(uid, name){
  if (uid) { doctorState.textContent = name ? `مرتبط: ${name}` : `مرتبط (${uid})`; }
  else { doctorState.textContent = "غير مرتبط"; }
}
async function fetchUserName(uid){
  try{
    const s = await getDoc(doc(db,"users",uid));
    if (s.exists()) return s.data()?.displayName || s.data()?.name || uid;
  }catch{}
  return uid;
}

/* تحميل الطفل */
async function loadChild(){
  try{
    showLoader(true);
    clearStatus();

    childDocPath = `parents/${parentId}/children/${childId}`;
    const s = await getDoc(doc(db, childDocPath));
    childData = s.exists() ? s.data() : null;

    childIdBadge.textContent = childId || "—";

    // بيانات عامة
    fields.name.value       = childData?.name || "";
    fields.gender.value     = childData?.gender || "";
    fields.birthDate.value  = childData?.birthDate || "";
    fields.unit.value       = childData?.unit || "";
    fields.deviceName.value = childData?.deviceName || "";
    fields.weightKg.value   = childData?.weightKg ?? "";
    fields.heightCm.value   = childData?.heightCm ?? "";

    // أنسولين
    fields.basalType.value  = childData?.insulin?.basalType || "";
    fields.bolusType.value  = childData?.insulin?.bolusType || "";
    fields.longInsulin.value= childData?.longActingDose?.insulin || "";
    fields.longTime.value   = childData?.longActingDose?.time || "";
    fields.longUnits.value  = childData?.longActingDose?.units ?? "";

    fields.carbRatio.value        = childData?.carbRatio ?? "";
    fields.correctionFactor.value = childData?.correctionFactor ?? "";

    // Net carbs
    fields.useNetCarbs.checked = !!childData?.useNetCarbs;
    fields.netCarbRule.value   = childData?.mealsDoses?.netCarbRule || "";

    // مستهدفات الكارب
    const b = childData?.carbTargets?.breakfast || {};
    const l = childData?.carbTargets?.lunch     || {};
    const d = childData?.carbTargets?.dinner    || {};
    const sTarget = childData?.carbTargets?.snack || {};
    fields.carb_b_min.value = b.min ?? "";
    fields.carb_b_max.value = b.max ?? "";
    fields.carb_l_min.value = l.min ?? "";
    fields.carb_l_max.value = l.max ?? "";
    fields.carb_d_min.value = d.min ?? "";
    fields.carb_d_max.value = d.max ?? "";
    fields.carb_s_min.value = sTarget.min ?? "";
    fields.carb_s_max.value = sTarget.max ?? "";

    // Normal + severe
    fields.norm_min.value    = childData?.normalRange?.min ?? "";
    fields.norm_max.value    = childData?.normalRange?.max ?? "";
    fields.severeLow.value   = childData?.normalRange?.severeLow ?? "";
    fields.severeHigh.value  = childData?.normalRange?.severeHigh ?? "";

    // Hypo/Hyper
    fields.hypo.value  = childData?.hypoLevel ?? "";
    fields.hyper.value = childData?.hyperLevel ?? "";

    // الخصوصية
    fields.shareDoctor.checked = !!(childData?.sharingConsent === true ||
      (childData?.sharingConsent && typeof childData.sharingConsent === "object" && childData.sharingConsent.doctor === true) ||
      childData?.shareDoctor === true);

    setDoctorBadge(childData?.assignedDoctorInfo?.uid || childData?.assignedDoctor);

    setStatus("تم تحميل بيانات الطفل.", true);
  }catch(e){
    console.error(e);
    setStatus("تعذر تحميل البيانات.", false);
  }finally{
    showLoader(false);
  }
}

/* حفظ التعديلات */
async function save(){
  try{
    showLoader(true);
    clearStatus();

    const payload = {
      name: fields.name.value || null,
      gender: fields.gender.value || null,
      birthDate: fields.birthDate.value || null,

      unit: fields.unit.value || null,
      deviceName: fields.deviceName.value || null,
      weightKg: clampNull(fields.weightKg.value),
      heightCm: clampNull(fields.heightCm.value),

      insulin: {
        basalType: fields.basalType.value || null,
        bolusType: fields.bolusType.value || null,
      },

      longActingDose: {
        insulin: fields.longInsulin.value || null,
        time: fields.longTime.value || null,
        units: clampNull(fields.longUnits.value),
      },

      carbRatio: clampNull(fields.carbRatio.value),
      correctionFactor: clampNull(fields.correctionFactor.value),

      useNetCarbs: !!fields.useNetCarbs.checked,
      mealsDoses: {
        name: childData?.mealsDoses?.name || null,
        netCarbRule: fields.netCarbRule.value || null,
      },

      carbTargets: {
        breakfast: { min: clampNull(fields.carb_b_min.value), max: clampNull(fields.carb_b_max.value) },
        lunch:     { min: clampNull(fields.carb_l_min.value), max: clampNull(fields.carb_l_max.value) },
        dinner:    { min: clampNull(fields.carb_d_min.value), max: clampNull(fields.carb_d_max.value) },
        snack:     { min: clampNull(fields.carb_s_min.value), max: clampNull(fields.carb_s_max.value) },
      },

      normalRange: {
        min: clampNull(fields.norm_min.value),
        max: clampNull(fields.norm_max.value),
        severeLow: clampNull(fields.severeLow.value),
        severeHigh: clampNull(fields.severeHigh.value),
      },

      hypoLevel: clampNull(fields.hypo.value),
      hyperLevel: clampNull(fields.hyper.value),

      shareDoctor: !!fields.shareDoctor.checked,
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, childDocPath), payload, { merge: true });
    setStatus("تم الحفظ.", true);
    showToast("تم الحفظ");
  }catch(e){
    console.error(e);
    setStatus("تعذر الحفظ.", false);
  }finally{
    showLoader(false);
  }
}

/* ربط/إلغاء ربط الطبيب (الأزرار) */
async function linkDoctor(){
  // … كودك القديم كما هو …
}
async function unlinkDoctor(){
  // … كودك القديم كما هو …
}

/* أحداث */
btnRefresh?.addEventListener("click", loadChild);
btnSave?.addEventListener("click", save);
btnBack?.addEventListener("click", ()=>history.back());
btnLinkDoctor?.addEventListener("click", linkDoctor);
btnUnlinkDoctor?.addEventListener("click", unlinkDoctor);

/* تهيئة */
onAuthStateChanged(auth, async (user)=>{
  if (!user){ location.href = "/login.html"; return; }
  currentParent = user;
  parentId = qs("parent") || user.uid;
  childId  = qs("child")  || "";
  saveContextToStorage(parentId, childId);
  await loadChild();
});
