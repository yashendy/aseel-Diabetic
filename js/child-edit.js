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
const btnLink = el("btnLink");
const btnUnlink = el("btnUnlink");
const codeInput = el("codeInput");

/* حقول */
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
  // carb targets
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
    const snap = await getDoc(doc(db, childDocPath));
    if (!snap.exists()){ setStatus("وثيقة الطفل غير موجودة.", false); showLoader(false); return; }
    childData = snap.data() || {};

    childIdBadge.textContent = childId;

    // قراءة الحقول
    fields.name.value = childData.name || "";
    fields.gender.value = childData.gender || "";
    fields.birthDate.value = childData.birthDate || childData.dob || "";
    const unit = (childData.unitType || childData.glucoseUnit || "mmol").toLowerCase();
    fields.unit.value = (unit.startsWith("mg")) ? "mgdl" : "mmol";
    fields.deviceName.value = childData.deviceName || "";

    const weight = childData.weightKg ?? childData.weight ?? null;
    const height = childData.heightCm ?? childData.height ?? null;
    fields.weightKg.value = weight ?? "";
    fields.heightCm.value = height ?? "";

    const ins = childData.insulin || {};
    fields.basalType.value = ins.basalType || childData.basalType || "";
    fields.bolusType.value = ins.bolusType || childData.bolusType || "";

    const long = childData.longActingDose || {};
    fields.longInsulin.value = long.insulin || "";
    fields.longTime.value   = long.time || "";
    fields.longUnits.value  = long.units ?? "";

    fields.carbRatio.value = childData.carbRatio ?? "";
    fields.correctionFactor.value = childData.correctionFactor ?? "";

    const mealsDoses = childData.mealsDoses || {};
    fields.useNetCarbs.checked = Boolean(childData.useNetCarbs);
    fields.netCarbRule.value = mealsDoses.netCarbRule || "";

    const carbTargets = childData.carbTargets || {};
    const b = carbTargets.breakfast || {};
    const l = carbTargets.lunch || {};
    const d = carbTargets.dinner || {};
    const s = carbTargets.snack || {};
    fields.carb_b_min.value = b.min ?? "";
    fields.carb_b_max.value = b.max ?? "";
    fields.carb_l_min.value = l.min ?? "";
    fields.carb_l_max.value = l.max ?? "";
    fields.carb_d_min.value = d.min ?? "";
    fields.carb_d_max.value = d.max ?? "";
    fields.carb_s_min.value = s.min ?? "";
    fields.carb_s_max.value = s.max ?? "";

    const norm = childData.normalRange || {};
    fields.norm_min.value = norm.min ?? "";
    fields.norm_max.value = norm.max ?? "";
    fields.severeLow.value = norm.severeLow ?? "";
    fields.severeHigh.value = norm.severeHigh ?? "";

    fields.hypo.value = childData.hypoLevel ?? "";
    fields.hyper.value = childData.hyperLevel ?? "";

    const did = childData.assignedDoctor || null;
    if (did) {
      const dname = await fetchUserName(did); setDoctorBadge(did, dname);
      fields.shareDoctor.checked = !!(childData.sharingConsent?.doctor ?? true);
    } else {
      setDoctorBadge(null, null);
      fields.shareDoctor.checked = !!(childData.sharingConsent?.doctor ?? false);
    }

    showLoader(false);
  }catch(e){
    console.error(e);
    setStatus("تعذّر تحميل بيانات الطفل (تحقق من الصلاحيات).", false);
    showLoader(false);
  }
}

/* تحقق قبل الحفظ */
function validate(){
  const pairs = [
    ["f_carb_b_min","f_carb_b_max","فطور"],
    ["f_carb_l_min","f_carb_l_max","غداء"],
    ["f_carb_d_min","f_carb_d_max","عشاء"],
    ["f_carb_s_min","f_carb_s_max","سناك"],
    ["f_norm_min","f_norm_max","النطاق الطبيعي"]
  ];
  for (const [a,b,name] of pairs){
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
    deviceName: fields.deviceName.value || null,

    // الوزن/الطول: نكتب الكيلوجرام والسم إن توفّرا
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

    // الخصوصية
    sharingConsent: { ...childData?.sharingConsent, doctor: !!fields.shareDoctor.checked },

    // التحديث الآلي
    updatedAt: serverTimestamp()
  };

  // توافق الحقول المختلفة للوحدة
  updateObj.unitType = (unitSel === "mgdl") ? "mg/dL" : "mmol/L";
  updateObj.glucoseUnit = (unitSel === "mgdl") ? "mg/dL" : "mmol/L";

  // دعم الحقول البديلة (height / heightCm, weight / weightKg) مع الحفاظ على الموجود
  if (updateObj.heightCm!=null) updateObj.height = updateObj.heightCm;
  if (updateObj.weightKg!=null) updateObj.weight = updateObj.weightKg;

  try{
    showLoader(true);
    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    await setDoc(childRef, updateObj, { merge:true });
    showLoader(false);
    showToast("تم حفظ التغييرات ✅");
    await loadChild();
  }catch(e){
    console.error(e);
    showLoader(false);
    alert("تعذّر الحفظ، حاول لاحقًا.");
  }
}

/* ربط/إلغاء ربط الطبيب عبر كود */
async function linkWithCode(){
  clearStatus();
  const code = (codeInput.value || "").trim().toUpperCase();
  if (!code){ setStatus("أدخل كودًا صحيحًا.", false); return; }

  try{
    // استخدم كتابة batch صغيرة لتحديث الطفل وكود الربط
    const { getDoc, writeBatch, collection } = await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
    const codeSnap = await getDoc(doc(db, "linkCodes", code));
    if (!codeSnap.exists()){ setStatus("الكود غير صحيح.", false); return; }
    const c = codeSnap.data();
    if (c.used){ setStatus("هذا الكود مستخدم بالفعل.", false); return; }
    if (!c.doctorId){ setStatus("الكود غير صالح (لا يحتوي على doctorId).", false); return; }
    const doctorUid = c.doctorId;

    const batch = writeBatch(db);
    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    const codeRef  = doc(db, `linkCodes/${code}`);

    batch.update(childRef, {
      assignedDoctor: doctorUid,
      sharingConsent: { doctor: true },
      assignedDoctorInfo: { uid: doctorUid },
      updatedAt: serverTimestamp()
    });
    batch.update(codeRef, { used: true, parentId, childId, usedAt: serverTimestamp() });

    await batch.commit();

    const dname = await fetchUserName(doctorUid);
    setDoctorBadge(doctorUid, dname);
    fields.shareDoctor.checked = true;
    setStatus(`تم الربط مع الدكتور: ${dname} ✅`, true);
    codeInput.value = "";
  }catch(e){
    console.error(e);
    setStatus("تعذّر الربط. تأكّد من الحساب والكود.", false);
  }
}

async function unlinkDoctor(){
  clearStatus();
  if (!childData?.assignedDoctor){ setStatus("لا يوجد ربط لإزالته.", false); return; }
  if (!confirm("تأكيد إلغاء الربط مع الطبيب؟")) return;
  try{
    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    await updateDoc(childRef, {
      assignedDoctor: null,
      sharingConsent: { doctor: false },
      assignedDoctorInfo: { uid: null },
      updatedAt: serverTimestamp()
    });
    setDoctorBadge(null, null);
    fields.shareDoctor.checked = false;
    setStatus("تم إلغاء الربط.", true);
  }catch(e){
    console.error(e);
    setStatus("تعذّر إلغاء الربط.", false);
  }
}

/* تشغيل */
onAuthStateChanged(auth, async (user)=>{
  if (!user){
    document.body.innerHTML = `
      <div style="max-width:720px;margin:40px auto;padding:24px;border:1px solid #1f2b5b;border-radius:16px;background:#0f1531;color:#e8edfb">
        <h2>تسجيل الدخول مطلوب</h2>
        <p>يرجى تسجيل الدخول بحساب وليّ الأمر للوصول لهذه الصفحة.</p>
      </div>`;
    return;
  }
  currentParent = user;
  parentId = user.uid;
  childId  = qs("child") || "";  // ?child=XXX
  await loadChild();
});

/* أحداث */
btnRefresh?.addEventListener("click", loadChild);
btnSave?.addEventListener("click", save);
btnBack?.addEventListener("click", ()=>history.back());
btnLink?.addEventListener("click", linkWithCode);
btnUnlink?.addEventListener("click", unlinkDoctor);
fields.shareDoctor?.addEventListener("change", async ()=>{
  // مجرد تحديث فوري للموافقة بدون تغيير الربط
  try{
    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    await updateDoc(childRef, { sharingConsent: { doctor: !!fields.shareDoctor.checked }, updatedAt: serverTimestamp() });
    showToast( fields.shareDoctor.checked ? "تم تفعيل المشاركة" : "تم إيقاف المشاركة" );
  }catch(e){ console.error(e); }
});
