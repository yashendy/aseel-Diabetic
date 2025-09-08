// js/child-edit.js
import { auth, db } from "./firebase-config.js";
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
const btnLinkDoctor  = el("btnLinkDoctor");
const btnUnlinkDoctor = el("btnUnlinkDoctor");

/* عناصر الإدخال */
const fields = {
  name: el("f_name"),
  gender: el("f_gender"),
  birthDate: el("f_birthDate"),
  unit: el("f_unit"),
  deviceName: el("f_deviceName"),
  weightKg: el("f_weightKg"),
  heightCm: el("f_heightCm"),

  basalType: el("f_basalType"),
  bolusType: el("f_bolusType"),
  longInsulin: el("f_longInsulin"),
  longTime: el("f_longTime"),
  longUnits: el("f_longUnits"),

  carbRatio: el("f_carbRatio"),
  correctionFactor: el("f_correctionFactor"),

  useNetCarbs: el("f_useNetCarbs"),
  netCarbRule: el("f_netCarbRule"),

  // carb targets (المفاتيح بدون f_ عشان نستخدمها في validate)
  carb_b_min: el("f_carb_b_min"),
  carb_b_max: el("f_carb_b_max"),
  carb_l_min: el("f_carb_l_min"),
  carb_l_max: el("f_carb_l_max"),
  carb_d_min: el("f_carb_d_min"),
  carb_d_max: el("f_carb_d_max"),
  carb_s_min: el("f_carb_s_min"),
  carb_s_max: el("f_carb_s_max"),

  // glucose ranges
  norm_min: el("f_norm_min"),
  norm_max: el("f_norm_max"),
  hypo: el("f_hypo"),
  hyper: el("f_hyper"),
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
function qs(key){ const u=new URLSearchParams(location.search); return u.get(key) || ""; }
function showLoader(v=true){ loader.classList.toggle("hidden", !v); }
function showToast(msg="تم"){ toast.querySelector(".msg").textContent=msg; toast.classList.remove("hidden"); setTimeout(()=>toast.classList.add("hidden"), 1800); }
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
const num = (v)=> (v===''||v==null) ? null : (Number(v));
function clampNull(n){ return (n===''||n==null||Number.isNaN(Number(n))) ? null : Number(n); }

/* تحميل الوثيقة */
async function loadChild(){
  clearStatus();
  if (!parentId || !childId){ setStatus("رابط الصفحة غير صحيح: مفقود parent أو child.", false); return; }
  childDocPath = `parents/${parentId}/children/${childId}`;

  try{
    showLoader(true);
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
    const s_ = childData?.carbTargets?.snack    || {};

    fields.carb_b_min.value = b.min ?? "";
    fields.carb_b_max.value = b.max ?? "";
    fields.carb_l_min.value = l.min ?? "";
    fields.carb_l_max.value = l.max ?? "";
    fields.carb_d_min.value = d.min ?? "";
    fields.carb_d_max.value = d.max ?? "";
    fields.carb_s_min.value = s_.min ?? "";
    fields.carb_s_max.value = s_.max ?? "";

    // نطاقات السكر
    const norm = childData?.normalRange || {};
    fields.norm_min.value   = norm.min ?? "";
    fields.norm_max.value   = norm.max ?? "";
    fields.severeLow.value  = norm.severeLow ?? "";
    fields.severeHigh.value = norm.severeHigh ?? "";
    fields.hypo.value       = childData?.hypoLevel ?? "";
    fields.hyper.value      = childData?.hyperLevel ?? "";

    // الخصوصية + الطبيب
    fields.shareDoctor.checked = !!childData?.shareDoctor;
    setDoctorBadge(childData?.doctorUid || childData?.assignedDoctor || null, childData?.doctorName || childData?.assignedDoctorInfo?.name || null);
    setStatus("تم تحميل البيانات.", true);
  }catch(e){
    console.error(e);
    setStatus("تعذر تحميل البيانات.", false);
  }finally{
    showLoader(false);
  }
}

/* تحقق قبل الحفظ */
function validate(){
  const pairs = [
    ["carb_b_min","carb_b_max","فطور"],
    ["carb_l_min","carb_l_max","غداء"],
    ["carb_d_min","carb_d_max","عشاء"],
    ["carb_s_min","carb_s_max","سناك"],
    ["norm_min","norm_max","النطاق الطبيعي"]
  ];
  for (const [a,b,name] of pairs){
    if (!fields[a] || !fields[b]){ alert(`حقل غير موجود: ${a} أو ${b}`); return false; }
    const v1 = num(fields[a].value), v2 = num(fields[b].value);
    if (v1!=null && v2!=null && v1>v2){
      alert(`قيمة Min أكبر من Max في قسم "${name}"`);
      return false;
    }
  }
  return true;
}

/* حفظ */
async function save(){
  if (!validate()) return;
  if (!parentId || !childId){ setStatus("رابط الصفحة غير صحيح.", false); return; }

  const unitSel = fields.unit.value; // 'mmol' | 'mgdl'
  const updateObj = {
    name: (fields.name.value||"").trim() || null,
    gender: fields.gender.value || null,
    birthDate: fields.birthDate.value || null,
    deviceName: (fields.deviceName.value||"").trim() || null,
    unit: unitSel || null,
    weightKg: clampNull(fields.weightKg.value),
    heightCm: clampNull(fields.heightCm.value),

    // insulin
    insulin: {
      basalType: (fields.basalType.value||"").trim() || null,
      bolusType: (fields.bolusType.value||"").trim() || null,
    },

    longActingDose: {
      insulin: (fields.longInsulin.value||"").trim() || null,
      time: fields.longTime.value || null,
      units: clampNull(fields.longUnits.value),
    },

    carbRatio: clampNull(fields.carbRatio.value),
    correctionFactor: clampNull(fields.correctionFactor.value),

    useNetCarbs: !!fields.useNetCarbs.checked,
    mealsDoses: {
      name: childData?.mealsDoses?.name || null, // نترك الاسم كما هو إن كان موجود
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

  try{
    showLoader(true);
    if (childData){ // تحديث
      await updateDoc(doc(db, childDocPath), updateObj);
      setStatus("تم حفظ التغييرات.", true);
    }else{ // إنشاء
      await setDoc(doc(db, childDocPath), updateObj);
      setStatus("تم إنشاء السجل.", true);
    }
    showToast("تم الحفظ ✅");
  }catch(e){
    console.error(e);
    setStatus("تعذر الحفظ.", false);
  }finally{
    showLoader(false);
  }
}

/* ربط/فك الطبيب — أمثلة (تكمل لاحقًا حسب تطبيقك) */
async function linkDoctor(){
  // نستخدم prompt مؤقتًا لإدخال الكود بدون تعديل كبير في الواجهة
  const raw = prompt("أدخل كود الربط من الطبيب:");
  const code = (raw || "").trim();
  if (!code){ return; }
  if (!parentId || !childId){ setStatus("الرابط غير صحيح: مفقود parent أو child.", false); return; }

  try{
    showLoader(true);

    // نقرأ الكود
    const codeRef = doc(db, "linkCodes", code);
    const codeSnap = await getDoc(codeRef);
    if (!codeSnap.exists()){
      setStatus("الكود غير موجود ❌", false);
      return;
    }
    const codeData = codeSnap.data();

    if (codeData.used){
      setStatus("هذا الكود تم استخدامه من قبل ❌", false);
      return;
    }

    const doctorId = codeData.doctorId;
    if (!doctorId){
      setStatus("الكود غير صالح ❌", false);
      return;
    }

    // معلومات الطبيب لعرض الاسم والإيميل
    let doctorInfo = { uid: doctorId };
    try{
      const uSnap = await getDoc(doc(db, "users", doctorId));
      if (uSnap.exists()){
        const u = uSnap.data();
        doctorInfo.name  = u.displayName || u.name || null;
        doctorInfo.email = u.email || null;
      }
    }catch{ /* تجاهل أي خطأ هنا */ }

    // نحدّث الكود + وثيقة الطفل في Batch واحد
    const batch = writeBatch(db);

    batch.update(codeRef, {
      used: true,
      parentId: parentId,
      childId: childId,
      usedAt: serverTimestamp()
    });

    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    batch.update(childRef, {
      assignedDoctor: doctorId,
      assignedDoctorInfo: doctorInfo,
      // نضمن وجود الموافقة لتسمح القواعد بقراءة الطبيب
      sharingConsent: (childData?.sharingConsent && typeof childData.sharingConsent === "object")
        ? { ...childData.sharingConsent, doctor: true }
        : { doctor: true },
      // حقول قديمة للعرض إن كانت واجهتك تستخدمها
      doctorUid: doctorId,
      doctorName: doctorInfo.name || null,
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    setStatus("تم ربط الطفل بالدكتور ✅", true);
    showToast("تم الربط");
    await loadChild();
  }catch(e){
    console.error(e);
    setStatus("فشل الربط ❌", false);
  }finally{
    showLoader(false);
  }
}

async function unlinkDoctor(){
  if (!parentId || !childId){ setStatus("الرابط غير صحيح: مفقود parent أو child.", false); return; }
  if (!confirm("هل تريد فك الربط مع الطبيب؟")) return;

  try{
    showLoader(true);

    const childRef = doc(db, `parents/${parentId}/children/${childId}`);

    // نحدّث فقط وثيقة الطفل (لا نُعيد تفعيل الكود المستهلك)
    const nextSharing =
      (childData?.sharingConsent && typeof childData.sharingConsent === "object")
        ? { ...childData.sharingConsent, doctor: false }
        : { doctor: false };

    await updateDoc(childRef, {
      assignedDoctor: null,
      assignedDoctorInfo: null,
      doctorUid: null,
      doctorName: null,
      sharingConsent: nextSharing,
      updatedAt: serverTimestamp()
    });

    setStatus("تم فك الربط مع الطبيب ✅", true);
    showToast("تم فك الربط");
    await loadChild();
  }catch(e){
    console.error(e);
    setStatus("تعذر فك الربط ❌", false);
  }finally{
    showLoader(false);
  }
}

/* الأحداث */
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
  await loadChild();
});
