// child-edit.js — صفحة إعداد الطفل (بيانات شخصية/إكلينيكية فقط)
import { db } from "./firebase-config.js"; // عدِّلي إلى "./firebase-config.js" لو الملف داخل نفس مجلد js
import {
  doc, getDoc, setDoc, collectionGroup, query, where, getDocs,
  documentId, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ===== DOM ===== */
const $ = (s,p=document)=>p.querySelector(s);

const hdrName = $("#hdrName");
const roleBadge = $("#roleBadge");
const statusEl = $("#status");
const loader = $("#loader");
const saveBtn = $("#btnSave");

/* بطاقة مختصرة */
const CARD = {
  name:$("#c_name"), age:$("#c_age"), gender:$("#c_gender"), unit:$("#c_unit"),
  cr:$("#c_cr"), cf:$("#c_cf"), basal:$("#c_basal"), bolus:$("#c_bolus"),
  device:$("#c_device"), height:$("#c_height"), weight:$("#c_weight"),
  bmi:$("#c_bmi"), doctor:$("#c_doctor"), docEmail:$("#c_docEmail"),
  share:$("#c_share"), updated:$("#c_updated"),
};

/* حقول النموذج */
const F = {
  name:$("#f_name"), gender:$("#f_gender"), birthDate:$("#f_birthDate"), unit:$("#f_unit"),
  heightCm:$("#f_heightCm"), weightKg:$("#f_weightKg"),
  carbRatio:$("#f_carbRatio"), correctionFactor:$("#f_correctionFactor"),
  basalType:$("#f_basalType"), bolusType:$("#f_bolusType"),
  device:$("#f_device"),

  hypo:$("#f_hypo"), hyper:$("#f_hyper"),
  severeLow:$("#f_severeLow"), severeHigh:$("#f_severeHigh"),
  criticalLow:$("#f_criticalLow"), criticalHigh:$("#f_criticalHigh"),

  cb_min:$("#f_carb_b_min"), cb_max:$("#f_carb_b_max"),
  cl_min:$("#f_carb_l_min"), cl_max:$("#f_carb_l_max"),
  cd_min:$("#f_carb_d_min"), cd_max:$("#f_carb_d_max"),
  cs_min:$("#f_carb_s_min"), cs_max:$("#f_carb_s_max"),

  share:$("#shareToggle"),
  bmiValue:$("#bmiValue"),
};

/* ===== حالة عامة ===== */
let authUser=null, userRole="parent", parentId="", childId="";
let childData=null;

const setStatus=(txt,ok=null)=>{
  if(!statusEl) return;
  statusEl.textContent=txt||"";
  statusEl.className="status"+(ok===true?" ok": ok===false?" err":"");
};
const showLoader=(v)=> loader?.classList.toggle("hidden", !v);

/* ===== مُساعدات ===== */
const qs=(k)=> new URL(location.href).searchParams.get(k)||"";
const vNum=(x)=>{ const n=Number(x); return Number.isFinite(n)? n : null; };

const ageStr = (dob)=>{
  if(!dob) return "—";
  const b=new Date(dob), n=new Date();
  let y=n.getFullYear()-b.getFullYear(), m=n.getMonth()-b.getMonth(), d=n.getDate()-b.getDate();
  if(d<0)m--; if(m<0){y--; m+=12;}
  return y>0? `${y} سنة${m?` و${m} شهر`:''}` : `${m} شهر`;
};
const calcBMI = ()=>{
  const h = vNum(F.heightCm?.value); const w = vNum(F.weightKg?.value);
  if (!h || !w || h<=0) return null;
  const m = h/100; return +(w/(m*m)).toFixed(1);
};

async function fetchRole(uid){
  const snap = await getDoc(doc(db,"users",uid));
  return snap.exists()? (snap.data().role || "parent") : "parent";
}

/* لو معايا child فقط، استنتج parent عبر collectionGroup */
async function ensureParentFromChildIfMissing(){
  if (parentId || !childId) return;
  try{
    const q = query(
      collectionGroup(db,"children"),
      where(documentId(),"==",`children/${childId}`)
    );
    const snaps = await getDocs(q);
    if(!snaps.empty){
      parentId = snaps.docs[0].ref.parent.parent.id;
      sessionStorage.setItem("lastParent", parentId);
      sessionStorage.setItem("lastChild", childId);
    }
  }catch(e){ console.warn("resolve parent via cg error", e); }
}

/* ===== تحميل وملء البيانات ===== */
async function loadChild(){
  const ref = doc(db,"parents",parentId,"children",childId);
  const s = await getDoc(ref);
  childData = s.exists()? s.data() : {};

  const name = childData?.name || childId || "—";
  hdrName.textContent = name;
  document.title = `إعدادات ${name}`;

  // بطاقة: الطبيب + البريد
  const dName  = childData?.assignedDoctorInfo?.name || childData?.doctorName || childData?.assignedDoctor || "غير مرتبط";
  const dEmail = childData?.assignedDoctorInfo?.email || "";
  CARD.doctor.textContent  = dName;
  CARD.docEmail.textContent= dEmail? `(${dEmail})` : "";

  // بطاقة: باقي الحقول
  CARD.name.textContent   = name;
  CARD.gender.textContent = childData?.gender || "—";
  CARD.unit.textContent   = childData?.glucoseUnit || childData?.unit || "—";
  CARD.age.textContent    = ageStr(childData?.birthDate);
  CARD.cr.textContent     = childData?.carbRatio ?? "—";
  CARD.cf.textContent     = childData?.correctionFactor ?? "—";
  CARD.basal.textContent  = childData?.insulin?.basalType ?? childData?.basalType ?? "—";
  CARD.bolus.textContent  = childData?.insulin?.bolusType ?? childData?.bolusType ?? "—";
  CARD.device.textContent = childData?.device || childData?.deviceName || "—";
  CARD.height.textContent = childData?.heightCm ?? childData?.height ?? "—";
  CARD.weight.textContent = childData?.weightKg ?? childData?.weight ?? "—";
  const bmi = calcBMI() ?? (()=>{
    const h = childData?.heightCm ?? childData?.height;
    const w = childData?.weightKg ?? childData?.weight;
    if(!h || !w) return null;
    const m=h/100; return +(w/(m*m)).toFixed(1);
  })();
  CARD.bmi.textContent = bmi ?? "—";
  CARD.share.textContent  = (childData?.sharingConsent===true || childData?.sharingConsent?.doctor===true) ? "مفعل" : "معطّل";
  CARD.updated.textContent= childData?.updatedAt?.toDate?.()?.toLocaleString?.() || "—";

  // نموذج
  F.name.value = childData?.name||"";
  F.gender.value = childData?.gender||"";
  F.birthDate.value = childData?.birthDate||"";
  F.unit.value = childData?.glucoseUnit || childData?.unit || "";

  F.heightCm.value = childData?.heightCm ?? childData?.height ?? "";
  F.weightKg.value = childData?.weightKg ?? childData?.weight ?? "";
  F.bmiValue.textContent = calcBMI() ?? "—";

  F.carbRatio.value = childData?.carbRatio ?? "";
  F.correctionFactor.value = childData?.correctionFactor ?? "";
  F.basalType.value = childData?.insulin?.basalType ?? childData?.basalType ?? "";
  F.bolusType.value = childData?.insulin?.bolusType ?? childData?.bolusType ?? "";
  F.device.value = childData?.device || childData?.deviceName || "";

  const nr = childData?.normalRange || {};
  F.hypo.value         = nr.min ?? childData?.hypoLevel ?? "";
  F.hyper.value        = nr.max ?? childData?.hyperLevel ?? "";
  F.severeLow.value    = nr.severeLow ?? "";
  F.severeHigh.value   = nr.severeHigh ?? "";
  F.criticalLow.value  = nr.criticalLow ?? childData?.criticalLowLevel ?? "";
  F.criticalHigh.value = nr.criticalHigh ?? childData?.criticalHighLevel ?? "";

  F.cb_min.value = childData?.carbTargets?.breakfast?.min ?? "";
  F.cb_max.value = childData?.carbTargets?.breakfast?.max ?? "";
  F.cl_min.value = childData?.carbTargets?.lunch?.min ?? "";
  F.cl_max.value = childData?.carbTargets?.lunch?.max ?? "";
  F.cd_min.value = childData?.carbTargets?.dinner?.min ?? "";
  F.cd_max.value = childData?.carbTargets?.dinner?.max ?? "";
  F.cs_min.value = childData?.carbTargets?.snack?.min ?? "";
  F.cs_max.value = childData?.carbTargets?.snack?.max ?? "";

  // مشاركة الطبيب
  const sharing = (childData?.sharingConsent===true || childData?.sharingConsent?.doctor===true);
  if (F.share) F.share.checked = !!sharing;
}

/* ===== صلاحيات ===== */
function applyPermissions(){
  roleBadge.textContent = (userRole==="doctor")? "طبيب" : (userRole==="admin"?"أدمن":"وليّ أمر");

  const isParent = (userRole==="parent" || userRole==="admin");
  const isDoctor = (userRole==="doctor");

  // الجهاز + المشاركة: وليّ الأمر فقط
  if (F.device) F.device.disabled = !isParent;
  if (F.share)  F.share.disabled  = !isParent;

  const allow = (isParent || isDoctor);
  [
    F.name,F.gender,F.birthDate,F.unit,
    F.heightCm,F.weightKg,
    F.carbRatio,F.correctionFactor,
    F.basalType,F.bolusType,
    F.hypo,F.hyper,F.severeLow,F.severeHigh,F.criticalLow,F.criticalHigh,
    F.cb_min,F.cb_max,F.cl_min,F.cl_max,F.cd_min,F.cd_max,F.cs_min,F.cs_max,
  ].forEach(el => el && (el.disabled = !allow));

  saveBtn.disabled = !allow && !isParent;
}

/* ===== تحققات ===== */
function checkRanges(){
  const cl = vNum(F.criticalLow.value);
  const sl = vNum(F.severeLow.value);
  const lo = vNum(F.hypo.value);
  const hi = vNum(F.hyper.value);
  const sh = vNum(F.severeHigh.value);
  const ch = vNum(F.criticalHigh.value);

  const ok =
    (cl==null || sl==null || cl<=sl) &&
    (sl==null || lo==null || sl<=lo) &&
    (lo==null || hi==null || lo<=hi) &&
    (hi==null || sh==null || hi<=sh) &&
    (sh==null || ch==null || sh<=ch);

  const box = $("#rangeError");
  if (!ok){ box.classList.remove("hidden"); }
  else { box.classList.add("hidden"); }
  return ok;
}

["input","change"].forEach(evt=>{
  F.heightCm?.addEventListener(evt,()=>{ F.bmiValue.textContent = calcBMI() ?? "—"; });
  F.weightKg?.addEventListener(evt,()=>{ F.bmiValue.textContent = calcBMI() ?? "—"; });
  [F.hypo,F.hyper,F.severeLow,F.severeHigh,F.criticalLow,F.criticalHigh].forEach(el=> el?.addEventListener(evt,checkRanges));
});

/* ===== حفظ ===== */
function buildPayload(){
  const normalRange = {
    min:        vNum(F.hypo.value),
    max:        vNum(F.hyper.value),
    severeLow:  vNum(F.severeLow.value),
    severeHigh: vNum(F.severeHigh.value),
    criticalLow:  vNum(F.criticalLow.value),
    criticalHigh: vNum(F.criticalHigh.value),
  };

  // قيم مسطّحة مطلوبة لصفحات أخرى
  const flat = {
    glucoseUnit: F.unit.value || null,
    heightCm:    vNum(F.heightCm.value),
    height:      vNum(F.heightCm.value), // مرآة للحقول القديمة
    weightKg:    vNum(F.weightKg.value),
    hypoLevel:   vNum(F.hypo.value),
    hyperLevel:  vNum(F.hyper.value),
    criticalLowLevel:  vNum(F.criticalLow.value),
    criticalHighLevel: vNum(F.criticalHigh.value),
  };

  return {
    name: F.name.value?.trim() || null,
    gender: F.gender.value || null,
    birthDate: F.birthDate.value || null,

    ...flat,

    carbRatio: vNum(F.carbRatio.value),
    correctionFactor: vNum(F.correctionFactor.value),
    basalType: F.basalType.value || null,
    bolusType: F.bolusType.value || null,

    device: F.device.disabled ? (childData?.device||null) : (F.device.value?.trim() || null),

    normalRange,

    carbTargets: {
      breakfast:{min:vNum(F.cb_min.value),max:vNum(F.cb_max.value)},
      lunch:{min:vNum(F.cl_min.value),max:vNum(F.cl_max.value)},
      dinner:{min:vNum(F.cd_min.value),max:vNum(F.cd_max.value)},
      snack:{min:vNum(F.cs_min.value),max:vNum(F.cs_max.value)},
    },

    sharingConsent: F.share?.disabled ? childData?.sharingConsent ?? null :
      (F.share.checked ? {doctor:true} : {doctor:false}),

    updatedAt: serverTimestamp(),
  };
}

async function save(){
  if (!checkRanges()){ setStatus("تحقّق من ترتيب حدود الجلوكوز.", false); return; }
  try{
    setStatus("جارٍ الحفظ…"); showLoader(true);
    await setDoc(doc(db,"parents",parentId,"children",childId), buildPayload(), {merge:true});
    setStatus("تم الحفظ بنجاح.", true);
    await loadChild();
  }catch(e){
    console.error(e);
    setStatus("تعذر الحفظ (الصلاحيات/الاتصال).", false);
  }finally{ showLoader(false); }
}
saveBtn?.addEventListener("click", save);

/* ===== init ===== */
(async function init(){
  const auth = getAuth();
  onAuthStateChanged(auth, async (u)=>{
    if(!u){ location.href="login.html"; return; }
    // جلب الدور
    const roleSnap = await getDoc(doc(db,"users",u.uid));
    userRole = roleSnap.exists()? (roleSnap.data().role || "parent") : "parent";

    // معرفات السياق
    parentId = qs("parent") || sessionStorage.getItem("lastParent") || (userRole==="parent" ? u.uid : "");
    childId  = qs("child")  || sessionStorage.getItem("lastChild")  || "";
    if (!parentId && childId) await ensureParentFromChildIfMissing();

    sessionStorage.setItem("lastParent", parentId||"");
    sessionStorage.setItem("lastChild",  childId||"");

    applyPermissions();
    await loadChild();

    setStatus("—");
  });
})();
