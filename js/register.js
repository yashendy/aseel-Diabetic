// js/register.js
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر */
const suName  = document.getElementById("suName");
const suEmail = document.getElementById("suEmail");
const suPass  = document.getElementById("suPass");
const btnSignup = document.getElementById("btnSignup");

const siEmail = document.getElementById("siEmail");
const siPass  = document.getElementById("siPass");
const btnSignin = document.getElementById("btnSignin");
const btnDemoLogout = document.getElementById("btnDemoLogout");

const signupErr = document.getElementById("signupErr");
const signupOk  = document.getElementById("signupOk");
const signinErr = document.getElementById("signinErr");

/* أدوات */
function show(el, msg){ if(!el) return; el.textContent = msg; el.style.display = "block"; }
function hide(el){ if(!el) return; el.style.display = "none"; el.textContent=""; }
function roleToDest(role){
  switch(role){
    case "admin": return "admin.html";
    case "doctor": return "doctor-dashboard.html";
    case "doctor-pending": return "pending.html";
    case "parent": return "parent-dashboard.html";
    default: return "register.html"; // ابقَ هنا
  }
}
async function fetchUserRole(uid){
  try{
    const snap = await getDoc(doc(db,"users",uid));
    if (snap.exists()) return snap.data()?.role || null;
  }catch{}
  return null;
}

/* توجيه مركزي عند وجود جلسة */
onAuthStateChanged(auth, async (user)=>{
  if (!user) return; // خلي المستخدم يقرر يسجّل أو ينشئ

  // جيب الدور من users/{uid}; لو مش موجود لا نوجّه الآن
  const role = await fetchUserRole(user.uid);

  if (!role){
    // مستخدم بلا وثيقة users (حالة نادرة) — نرجعه لصفحة التسجيل
    return;
  }
  const dest = roleToDest(role);
  if (dest && dest !== "register.html") {
    location.replace(dest);
  }
});

/* إنشاء حساب جديد */
btnSignup?.addEventListener("click", async ()=>{
  hide(signupErr); hide(signupOk);

  const name  = (suName.value || "").trim();
  const email = (suEmail.value || "").trim();
  const pass  = (suPass.value || "").trim();
  const acct  = /** @type {HTMLInputElement} */(document.querySelector('input[name="acctType"]:checked'))?.value || "parent";

  if (!email || !pass) { show(signupErr, "أدخل البريد وكلمة المرور."); return; }
  if (!name) { show(signupErr, "أدخل الاسم."); return; }
  if (!["parent","doctor"].includes(acct)) { show(signupErr, "اختر نوع الحساب."); return; }

  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (auth.currentUser && name) {
      await updateProfile(auth.currentUser, { displayName: name });
    }

    // حددي الدور بدقة: parent أو doctor-pending
    const role = (acct === "doctor") ? "doctor-pending" : "parent";

    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email,
      name,
      displayName: name,
      role,
      createdAt: serverTimestamp()
    }, { merge: true });

    show(signupOk, "تم إنشاء الحساب، سيتم تحويلك الآن…");

    const dest = roleToDest(role);
    // نستخدم replace حتى لا يعود زر الرجوع لهذه الصفحة
    setTimeout(()=> location.replace(dest), 400);

  }catch(err){
    console.error(err);
    show(signupErr, niceAuthError(err));
  }
});

/* تسجيل الدخول */
btnSignin?.addEventListener("click", async ()=>{
  hide(signinErr);
  const email = (siEmail.value || "").trim();
  const pass  = (siPass.value || "").trim();
  if (!email || !pass){ show(signinErr,"أدخل البريد وكلمة المرور."); return; }

  try{
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged سيتولى توجيه المستخدم حسب الدور
  }catch(err){
    console.error(err);
    show(signinErr, niceAuthError(err));
  }
});

/* تسجيل خروج (للتجربة) */
btnDemoLogout?.addEventListener("click", async ()=>{
  await signOut(auth);
  // ابقَ هنا
});

/* رسائل أخطاء ودّية */
function niceAuthError(e){
  const code = e?.code || "";
  const map = {
    "auth/email-already-in-use": "هذا البريد مستخدم بالفعل.",
    "auth/invalid-email": "بريد غير صالح.",
    "auth/weak-password": "كلمة المرور ضعيفة.",
    "auth/user-not-found": "المستخدم غير موجود.",
    "auth/wrong-password": "كلمة المرور غير صحيحة.",
    "auth/too-many-requests": "محاولات كثيرة. جرّب لاحقًا."
  };
  return map[code] || "تعذّر تنفيذ العملية. حاول مرة أخرى.";
}
