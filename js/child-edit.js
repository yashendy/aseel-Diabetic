// js/child-edit.js — إعداد الطفل (Role-aware: Parent / Doctor)
// يعمل مع قواعد Firestore الحالية بدون تعديل

import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collectionGroup, query, where, getDocs, documentId
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ========= أدوات DOM ========= */
const el = (id)=>document.getElementById(id);
const childIdBadge = el("childIdBadge");
const loader = el("loader");
const toast = el("toast");
const linkStatus = el("linkStatus");
const doctorState = el("doctorState");

const fields = {
  // أساسية
  name: el("f_name"),
  gender: el("f_gender"),
  birthDate: el("f_birthDate"),
  unit: el("f_unit"),              // نكتب دائمًا glucoseUnit
  deviceName: el("f_deviceName"),  // يfallback إلى device
  weightKg: el("f_weightKg"),
  heightCm: el("f_heightCm"),

  // أنسولين
  basalType: el("f_basalType"),    // نكتب أيضًا Top-level للطبيب
  bolusType: el("f_bolusType"),
  longInsulin: el("f_longInsulin"),
  longTime: el("f_longTime"),
  longUnits: el("f_longUnits"),

  // Carb & Correction
  carbRatio: el("f_carbRatio"),
  correctionFactor: el("f_correctionFactor"),

  // Net carbs
  useNetCarbs: el("f_useNetCarbs"),
  netCarbRule: el("f_netCarbRule"),

  // Carb Targets
  carb_b_min: el("f_carb_b_min"), carb_b_max: el("f_carb_b_max"),
  carb_l_min: el("f_carb_l_min"), carb_l_max: el("f_carb_l_max"),
  carb_d_min: el("f_carb_d_min"), carb_d_max: el("f_carb_d_max"),
  carb_s_min: el("f_carb_s_min"), carb_s_max: el("f_carb_s_max"),

  // Ranges (mmol/L)
  norm_min: el("f_norm_min"),
  norm_max: el("f_norm_max"),
  severeLow: el("f_severeLow"),
  severeHigh: el("f_severeHigh"),

  // Hypo/Hyper (للعرض والحفظ لدى وليّ الأمر)
  hypo: el("f_hypo"),
  hyper: el("f_hyper"),

  // مشاركة الطبيب
  shareDoctor: el("f_shareDoctor"),
  linkCode: el("f_linkCode"),

  // أزرار
  btnSave: el("btnSave"),
  btnBack: el("btnBack"),
  btnLinkDoctor: el("btnLinkDoctor"),
  btnUnlinkDoctor: el("btnUnlinkDoctor"),
};

/* ========= حالة عامة ========= */
let auth = null;
let currentUser = null;
let parentId = null;
let childId  = null;
let userRole = "parent"; // parent | doctor | admin | doctor-pending...
let childData = null;

/* ========= أدوات مساعدة ========= */
const num = (v)=> (v===''||v===null||v===undefined) ? null : Number(v);
const clampNull = (v)=> (v===''||v===null||v===undefined) ? null : Number(v);
const qs = (k)=> new URLSearchParams(location.search).get(k) || "";
const showLoader = (v=true)=> loader?.classList.toggle("hidden", !v);
function showToast(msg="تم"){ if(!toast) return; const box = toast.querySelector(".msg") || toast; box.textContent = msg; toast.classList.remove("hidden"); setTimeout(()=>toast.classList.add("hidden"), 1800); }
function setStatus(msg, ok=false){ if(!linkStatus) return; linkStatus.textContent = msg; linkStatus.className = "status " + (ok ? "ok" : "err"); }
function clearStatus(){ setStatus("", true); }
function setDoctorBadge(uid, name){
  if (!doctorState) return;
  if (uid) { doctorState.textContent = name ? `مرتبط: ${name}` : `مرتبط (${uid})`; }
  else { doctorState.textContent = "غير مرتبط"; }
}
async function fetchUserDoc(uid){
  try{
    const s = await getDoc(doc(db,"users",uid));
    return s.exists() ? s.data() : null;
  }catch{ return null; }
}
function saveContextToStorage(pid, cid){
  try{ sessionStorage.setItem("lastParent", pid||""); sessionStorage.setItem("lastChild", cid||""); }catch{}
}
function readContextFromStorage(){
  try{
    return {
      parent: sessionStorage.getItem("lastParent") || "",
      child:  sessionStorage.getItem("lastChild")  || ""
    };
  }catch{ return {parent:"", child:""}; }
}

/* ========= تمكين/تعطيل الحقول حسب الدور ========= */
function isOwner(){ return currentUser && parentId && currentUser.uid === parentId; }

function applyRolePermissions(){
  const doctorMode = (userRole === "doctor" && !isOwner());

  // أزرار الربط تظهر للمالك/الأدمن فقط
  if (fields.btnLinkDoctor)  fields.btnLinkDoctor.disabled  = !isOwner() && userRole !== "admin";
  if (fields.btnUnlinkDoctor)fields.btnUnlinkDoctor.disabled= !isOwner() && userRole !== "admin";
  if (fields.linkCode)       fields.linkCode.disabled       = !isOwner() && userRole !== "admin";

  // عناصر تُعطّل للطبيب
  const disableIfDoctor = [
    fields.deviceName, fields.weightKg, fields.heightCm,
    fields.useNetCarbs, fields.netCarbRule,
    fields.longInsulin, fields.longTime, fields.longUnits,
    fields.shareDoctor,
    fields.hypo, fields.hyper // الطبيب لا يغيّر هذه الحقول مباشرة (يستخدم normalRange)
  ];
  disableIfDoctor.forEach(inp => inp && (inp.disabled = doctorMode));

  // عناصر مسموحة للطبيب حسب القواعد
  const enableIfDoctor = [
    fields.name, fields.gender, fields.birthDate,
    fields.unit, fields.carbRatio, fields.correctionFactor,
    fields.basalType, fields.bolusType,
    fields.norm_min, fields.norm_max, fields.severeLow, fields.severeHigh,
    fields.carb_b_min, fields.carb_b_max,
    fields.carb_l_min, fields.carb_l_max,
    fields.carb_d_min, fields.carb_d_max,
    fields.carb_s_min, fields.carb_s_max,
  ];
  enableIfDoctor.forEach(inp => inp && (inp.disabled = false));
}

/* ========= استنتاج parentId من childId (مفيد للطبيب عند غياب parent=) ========= */
async function ensureParentFromChildIfMissing(){
  if (parentId || !childId) return;
  try{
    const qy = query(
      collectionGroup(db, "children"),
      where(documentId(), "==", `children/${childId}`)
    );
    const snaps = await getDocs(qy);
    if (!snaps.empty){
      const s = snaps.docs[0];
      parentId = s.ref.parent.parent.id;
      saveContextToStorage(parentId, childId);
    }
  }catch(e){
    // تجاهل؛ فقط تحسين تجربة للطبيب
  }
}

/* ========= قراءة الطفل ========= */
async function loadChild(){
  if (!parentId || !childId){
    setStatus("يجب تحديد الطفل (parent & child).", false);
    return;
  }
  showLoader(true);
  try{
    const ref = doc(db, "parents", parentId, "children", childId);
    const snap = await getDoc(ref);
    childData = snap.exists() ? snap.data() : {};
    if (childIdBadge) childIdBadge.textContent = childId || "—";

    // أساسية (قراءة مرنة)
    if (fields.name)       fields.name.value       = childData?.name || "";
    if (fields.gender)     fields.gender.value     = childData?.gender || "";
    if (fields.birthDate)  fields.birthDate.value  = childData?.birthDate || "";
    const unitVal = childData?.glucoseUnit || childData?.unit || "";
    if (fields.unit)       fields.unit.value       = unitVal;
    const deviceVal = childData?.deviceName ?? childData?.device ?? "";
    if (fields.deviceName) fields.deviceName.value = deviceVal;
    if (fields.weightKg)   fields.weightKg.value   = childData?.weightKg ?? childData?.weight ?? "";
    if (fields.heightCm)   fields.heightCm.value   = childData?.heightCm ?? childData?.height ?? "";

    // أنسولين (قراءة مرنة)
    if (fields.basalType)  fields.basalType.value  = childData?.insulin?.basalType ?? childData?.basalType ?? "";
    if (fields.bolusType)  fields.bolusType.value  = childData?.insulin?.bolusType ?? childData?.bolusType ?? "";
    if (fields.longInsulin)fields.longInsulin.value= childData?.longActingDose?.insulin ?? "";
    if (fields.longTime)   fields.longTime.value   = childData?.longActingDose?.time ?? "";
    if (fields.longUnits)  fields.longUnits.value  = childData?.longActingDose?.units ?? "";

    // Carb/Correction
    if (fields.carbRatio)        fields.carbRatio.value        = childData?.carbRatio ?? "";
    if (fields.correctionFactor) fields.correctionFactor.value = childData?.correctionFactor ?? "";

    // Net carbs
    if (fields.useNetCarbs) fields.useNetCarbs.checked = !!childData?.useNetCarbs;
    if (fields.netCarbRule) fields.netCarbRule.value   = childData?.mealsDoses?.netCarbRule || "";

    // Carb targets
    const b = childData?.carbTargets?.breakfast || {};
    const l = childData?.carbTargets?.lunch     || {};
    const d = childData?.carbTargets?.dinner    || {};
    const s = childData?.carbTargets?.snack     || {};
    if (fields.carb_b_min) fields.carb_b_min.value = b.min ?? "";
    if (fields.carb_b_max) fields.carb_b_max.value = b.max ?? "";
    if (fields.carb_l_min) fields.carb_l_min.value = l.min ?? "";
    if (fields.carb_l_max) fields.carb_l_max.value = l.max ?? "";
    if (fields.carb_d_min) fields.carb_d_min.value = d.min ?? "";
    if (fields.carb_d_max) fields.carb_d_max.value = d.max ?? "";
    if (fields.carb_s_min) fields.carb_s_min.value = s.min ?? "";
    if (fields.carb_s_max) fields.carb_s_max.value = s.max ?? "";

    // Ranges + Hypo/Hyper
    const nr = childData?.normalRange || {};
    if (fields.norm_min)   fields.norm_min.value    = nr.min ?? "";
    if (fields.norm_max)   fields.norm_max.value    = nr.max ?? "";
    if (fields.severeLow)  fields.severeLow.value   = nr.severeLow ?? "";
    if (fields.severeHigh) fields.severeHigh.value  = nr.severeHigh ?? "";

    // Hypo/Hyper (لو غير مخزنين، اعرض حدود الطبيعي)
    const hypoV  = childData?.hypoLevel  ?? nr.min ?? "";
    const hyperV = childData?.hyperLevel ?? nr.max ?? "";
    if (fields.hypo)  fields.hypo.value  = hypoV;
    if (fields.hyper) fields.hyper.value = hyperV;

    // حالة الربط
    const assignedDoctor = childData?.assignedDoctor || null;
    const assignedName   = childData?.assignedDoctorInfo?.name || null;
    setDoctorBadge(assignedDoctor, assignedName);

    clearStatus();
  }catch(e){
    console.error(e);
    setStatus("تعذر قراءة بيانات الطفل.", false);
  }finally{
    showLoader(false);
  }
}

/* ========= بناء الكائنات من الواجهة ========= */
function buildCarbTargetsFromUI(){
  const v = (x)=> clampNull(x?.value);
  return {
    breakfast: { min: v(fields.carb_b_min), max: v(fields.carb_b_max) },
    lunch:     { min: v(fields.carb_l_min), max: v(fields.carb_l_max) },
    dinner:    { min: v(fields.carb_d_min), max: v(fields.carb_d_max) },
    snack:     { min: v(fields.carb_s_min), max: v(fields.carb_s_max) },
  };
}
function buildNormalRangeFromUI(){
  return {
    min:        clampNull(fields.norm_min?.value),
    max:        clampNull(fields.norm_max?.value),
    severeLow:  clampNull(fields.severeLow?.value),
    severeHigh: clampNull(fields.severeHigh?.value),
  };
}

/* ========= Payload وليّ الأمر ========= */
function buildPayloadParent(){
  const payload = {
    name: fields.name?.value?.trim() || null,
    gender: fields.gender?.value || null,
    birthDate: fields.birthDate?.value || null,

    glucoseUnit: fields.unit?.value || null,
    unit: fields.unit?.value || null, // توافق

    deviceName: fields.deviceName?.value || null,
    device: fields.deviceName?.value || null,     // توافق
    weightKg: num(fields.weightKg?.value),
    heightCm: num(fields.heightCm?.value),

    insulin: {
      basalType: fields.basalType?.value || null,
      bolusType: fields.bolusType?.value || null,
    },
    basalType: fields.basalType?.value || null, // Top-level
    bolusType: fields.bolusType?.value || null,

    longActingDose: {
      insulin: fields.longInsulin?.value || null,
      time: fields.longTime?.value || null,
      units: num(fields.longUnits?.value),
    },

    carbRatio: num(fields.carbRatio?.value),
    correctionFactor: num(fields.correctionFactor?.value),

    useNetCarbs: !!fields.useNetCarbs?.checked,
    mealsDoses: {
      netCarbRule: fields.netCarbRule?.value || null
    },

    carbTargets: buildCarbTargetsFromUI(),

    normalRange: buildNormalRangeFromUI(),

    // حفظ hypo/hyper دعمًا للصفحات الأخرى
    hypoLevel: clampNull(fields.hypo?.value),
    hyperLevel: clampNull(fields.hyper?.value),

    // مشاركة (لو ظاهرة في الواجهة)
    sharingConsent: (fields.shareDoctor ? !!fields.shareDoctor.checked : (childData?.sharingConsent ?? false)),

    updatedAt: serverTimestamp(),
  };
  return payload;
}

/* ========= Payload الطبيب ========= */
function buildPayloadDoctor(){
  // الطبيب يرسل فقط المفاتيح المسموح بها في القواعد
  const nr = buildNormalRangeFromUI();
  // لو الطبيب غيّر حقول hypo/hyper في الواجهة، نُسقطها على normalRange (لا نحفظ hypoLevel/hyperLevel)
  if (fields.hypo && fields.hypo.value !== "") nr.min = clampNull(fields.hypo.value);
  if (fields.hyper && fields.hyper.value !== "") nr.max = clampNull(fields.hyper.value);

  const payload = {
    name: fields.name?.value?.trim() || null,
    gender: fields.gender?.value || null,
    birthDate: fields.birthDate?.value || null,

    glucoseUnit: fields.unit?.value || null,

    carbRatio: num(fields.carbRatio?.value),
    correctionFactor: num(fields.correctionFactor?.value),

    carbTargets: buildCarbTargetsFromUI(),
    normalRange: nr,

    // Top-level فقط
    bolusType: fields.bolusType?.value || null,
    basalType: fields.basalType?.value || null,

    updatedAt: serverTimestamp(),
  };
  return payload;
}

/* ========= حفظ ========= */
async function save(){
  if (!parentId || !childId){
    setStatus("يجب تحديد الطفل (parent & child).", false);
    return;
  }
  showLoader(true);
  try{
    const ref = doc(db, "parents", parentId, "children", childId);
    const payload = (isOwner() || userRole === "admin") ? buildPayloadParent() : buildPayloadDoctor();
    await setDoc(ref, payload, { merge: true });
    setStatus("تم الحفظ.", true);
    showToast("تم الحفظ");
  }catch(e){
    console.error(e);
    setStatus("تعذر الحفظ.", false);
  }finally{
    showLoader(false);
  }
}

/* ========= ربط/فك الطبيب ========= */
// ربط الطبيب يتم من حساب وليّ الأمر أو الأدمن فقط، ويقرأ الكود من input#f_linkCode
async function linkDoctor(){
  try{
    if (!currentUser || !parentId || !childId) {
      setStatus("يجب تحديد الطفل وتسجيل الدخول.", false);
      return;
    }
    if (!isOwner() && userRole !== "admin") {
      showToast("الربط يتم من حساب وليّ الأمر فقط.");
      return;
    }

    const code = fields.linkCode?.value?.trim();
    if (!code){ setStatus("أدخلي كود الربط أولًا.", false); return; }

    // لا تربطي لو مربوط أصلًا بطبيب آخر
    const childRef = doc(db, "parents", parentId, "children", childId);
    const cur = await getDoc(childRef);
    const curData = cur.exists() ? cur.data() : {};
    if (curData?.assignedDoctor && curData.assignedDoctor !== currentUser.uid){
      setStatus("الطفل مربوط بطبيب بالفعل. فضّلي الربط الحالي أولًا.", false);
      return;
    }

    showLoader(true);

    // 1) التحقق من الكود
    const codeRef = doc(db, "linkCodes", code);
    const codeSnap = await getDoc(codeRef);
    if (!codeSnap.exists()) { setStatus("الكود غير صحيح.", false); return; }

    const codeData = codeSnap.data();
    if (codeData.used === true) { setStatus("تم استخدام هذا الكود من قبل.", false); return; }
    const doctorId = codeData.doctorId;
    if (!doctorId) { setStatus("الكود لا يحتوي مُعرّف الطبيب.", false); return; }

    // 2) تحديث مستند الطفل
    await updateDoc(childRef, {
      assignedDoctor: doctorId,
      assignedDoctorInfo: { uid: doctorId }, // يمكن لاحقًا ملؤها عبر Cloud Function
      sharingConsent: { doctor: true },
      updatedAt: serverTimestamp(),
    });

    // 3) تعليم الكود كمستخدم
    await updateDoc(codeRef, {
      used: true,
      doctorId,
      parentId: currentUser.uid,
      usedAt: serverTimestamp(),
    });

    setDoctorBadge(doctorId, null);
    setStatus("تم ربط الطبيب بنجاح.", true);
    showToast("تم ربط الطبيب");
  } catch (e){
    console.error(e);
    setStatus("تعذر ربط الطبيب. تحققي من الصلاحيات أو الكود.", false);
  } finally {
    showLoader(false);
  }
}

async function unlinkDoctor(){
  try{
    if (!currentUser || !parentId || !childId) {
      setStatus("يجب تحديد الطفل وتسجيل الدخول.", false);
      return;
    }
    if (!isOwner() && userRole !== "admin") {
      showToast("فك الربط يتم من حساب وليّ الأمر فقط.");
      return;
    }

    const ok = window.confirm("هل تريدين فك ربط الطبيب من هذا الطفل؟");
    if (!ok) return;

    showLoader(true);

    const childRef = doc(db, "parents", parentId, "children", childId);
    await updateDoc(childRef, {
      assignedDoctor: null,
      assignedDoctorInfo: null,
      sharingConsent: false,       // أو { doctor:false }
      updatedAt: serverTimestamp(),
    });

    setDoctorBadge(null, null);
    setStatus("تم فك الربط.", true);
    showToast("تم فك ربط الطبيب");
  } catch (e){
    console.error(e);
    setStatus("تعذر فك الربط.", false);
  } finally {
    showLoader(false);
  }
}

/* ========= ربط الأحداث ========= */
fields.btnSave?.addEventListener("click", save);
fields.btnBack?.addEventListener("click", ()=>history.back());
fields.btnLinkDoctor?.addEventListener("click", linkDoctor);
fields.btnUnlinkDoctor?.addEventListener("click", unlinkDoctor);

/* ========= تهيئة ========= */
(async function init(){
  auth = getAuth();
  onAuthStateChanged(auth, async (user)=>{
    if (!user){ location.href = "/login.html"; return; }
    currentUser = user;

    // اجلب الدور من users/{uid}
    const udoc = await fetchUserDoc(user.uid);
    userRole = udoc?.role || "parent";

    // IDs من الرابط أو الذاكرة
    const ctx = readContextFromStorage();
    parentId = qs("parent") || ctx.parent || (userRole === "parent" ? user.uid : "");
    childId  = qs("child")  || ctx.child  || "";

    // للطبيب: استنتج parentId من childId لو ناقص
    if (!parentId && childId && userRole === "doctor") {
      await ensureParentFromChildIfMissing();
    }

    saveContextToStorage(parentId, childId);
    applyRolePermissions();
    await loadChild();
  });
})();
