// js/child-edit.js
import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, serverTimestamp,
  writeBatch, collection, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر */
const cNameEl   = document.getElementById("cName");
const cGenderEl = document.getElementById("cGender");
const cBirthEl  = document.getElementById("cBirth");
const cUnitEl   = document.getElementById("cUnit");
const childIdBadge = document.getElementById("childIdBadge");

const doctorState = document.getElementById("doctorState");
const codeInput   = document.getElementById("codeInput");
const btnLink     = document.getElementById("btnLink");
const btnUnlink   = document.getElementById("btnUnlink");
const btnRefresh  = document.getElementById("btnRefresh");
const linkStatus  = document.getElementById("linkStatus");

/* حالة */
let currentParent = null;
let parentId = null;
let childId  = null;
let childDocPath = null;
let childData = null;

/* أدوات */
function qs(key){
  const u = new URLSearchParams(location.search);
  return u.get(key) || "";
}
function setStatus(msg, ok=false){
  linkStatus.textContent = msg;
  linkStatus.className = "status " + (ok ? "ok" : "err");
}
function clearStatus(){ linkStatus.textContent = ""; linkStatus.className = "status"; }
function setDoctorBadge(uid, name){
  if (uid) {
    doctorState.textContent = name ? `مرتبط: ${name}` : `مرتبط (${uid})`;
  } else {
    doctorState.textContent = "غير مرتبط";
  }
}

/* قراءة اسم مستخدم من users/{uid} */
async function fetchUserName(uid){
  try{
    const s = await getDoc(doc(db,"users",uid));
    if (s.exists()) return s.data()?.displayName || s.data()?.name || uid;
  }catch{}
  return uid;
}

async function loadChild(){
  clearStatus();

  if (!parentId || !childId){
    setStatus("رابط الصفحة غير صحيح: مفقود parent أو child.", false);
    return;
  }
  childDocPath = `parents/${parentId}/children/${childId}`;
  try{
    const snap = await getDoc(doc(db, childDocPath));
    if (!snap.exists()){
      setStatus("وثيقة الطفل غير موجودة.", false);
      return;
    }
    childData = snap.data();

    childIdBadge.textContent = childId;
    cNameEl.textContent   = childData.name || "—";
    cGenderEl.textContent = childData.gender || "—";
    cBirthEl.textContent  = childData.birthDate || "—";
    cUnitEl.textContent   = childData.glucoseUnit || "—";

    // حالة الربط
    const did = childData.assignedDoctor || null;
    if (did) {
      const dname = await fetchUserName(did);
      setDoctorBadge(did, dname);
    } else {
      setDoctorBadge(null, null);
    }
  }catch(e){
    console.error(e);
    setStatus("تعذّر تحميل بيانات الطفل (تحقق من الصلاحيات).", false);
  }
}

async function linkWithCode(){
  clearStatus();
  const code = (codeInput.value || "").trim().toUpperCase();
  if (!code){ setStatus("أدخل كودًا صحيحًا.", false); return; }
  if (!parentId || !childId){ setStatus("رابط الصفحة غير صحيح.", false); return; }

  try{
    // 1) إحضار الكود
    const codeSnap = await getDoc(doc(db, "linkCodes", code));
    if (!codeSnap.exists()){ setStatus("الكود غير صحيح.", false); return; }
    const c = codeSnap.data();
    if (c.used){ setStatus("هذا الكود مستخدم بالفعل.", false); return; }
    if (!c.doctorId){ setStatus("الكود غير صالح (لا يحتوي على doctorId).", false); return; }

    const doctorUid = c.doctorId;

    // 2) Batch: تحديث الطفل + تحديث الكود
    const batch = writeBatch(db);
    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    const codeRef  = doc(db, `linkCodes/${code}`);

    batch.update(childRef, {
      assignedDoctor: doctorUid,
      sharingConsent: { doctor: true },
      assignedDoctorInfo: { uid: doctorUid }
    });

    batch.update(codeRef, {
      used: true,
      parentId: parentId,
      childId: childId,
      usedAt: serverTimestamp()
    });

    await batch.commit();

    const dname = await fetchUserName(doctorUid);
    setDoctorBadge(doctorUid, dname);
    setStatus(`تم الربط مع الدكتور: ${dname} ✅`, true);
    codeInput.value = "";

  }catch(e){
    console.error(e);
    // أخطاء شائعة: الصلاحيات أو السباق (الكود اتستخدم قبل لحظات)
    setStatus("تعذّر الربط. تأكّد من أنّك مسجّل بحساب وليّ الأمر وأن الكود صالح.", false);
  }
}

async function unlinkDoctor(){
  clearStatus();
  if (!parentId || !childId){ setStatus("رابط الصفحة غير صحيح.", false); return; }
  if (!childData?.assignedDoctor){
    setStatus("لا يوجد ربط لإزالته.", false); return;
  }
  if (!confirm("تأكيد إلغاء الربط مع الطبيب؟")) return;

  try{
    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    await updateDoc(childRef, {
      assignedDoctor: null,
      sharingConsent: { doctor: false },
      assignedDoctorInfo: { uid: null }
    });
    setDoctorBadge(null, null);
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
  parentId = user.uid;        // وليّ الأمر الحالي هو المالك
  childId  = qs("child") || "";  // من رابط الصفحة: ?child=XXX
  // ملاحظة: يجوز إضافة ?parent=... لاحقًا لو أردتِ تحرير طفل ليس المالك الحالي.

  await loadChild();
});

/* أحداث */
btnRefresh?.addEventListener("click", loadChild);
btnLink?.addEventListener("click", linkWithCode);
btnUnlink?.addEventListener("click", unlinkDoctor);
