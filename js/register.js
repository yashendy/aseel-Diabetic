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

// ✅ متغير لمنع التضارب أثناء إنشاء الحساب الجديد
let isSigningUp = false; 

/* أدوات */
function show(el, msg){ if(!el) return; el.textContent = msg; el.style.display = "block"; }
function hide(el){ if(!el) return; el.style.display = "none"; el.textContent=""; }

// ✅ دالة جديدة لإدارة حالة التحميل للأزرار
function setLoading(btn, isLoading, originalText) {
  if(!btn) return;
  if(isLoading) {
    btn.disabled = true;
    btn.textContent = "جارِ التحميل...";
    btn.style.opacity = "0.7";
    btn.style.cursor = "not-allowed";
  } else {
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = "1";
    btn.style.cursor = "pointer";
  }
}

// ✅ توحيد أسماء المسارات لتطابق الملفات
function roleToDest(role){
  switch(role){
    case "admin": return "admin.html";
    case "doctor": return "doctor.html"; // تم التعديل
    case "doctor-pending": return "pending.html";
    case "parent": return "parent.html"; // تم التعديل
    default: return "register.html"; 
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
  // ✅ تجاهل التوجيه التلقائي إذا كنا في منتصف عملية إنشاء حساب جديد
  if (!user || isSigningUp) return; 

  const role = await fetchUserRole(user.uid);
  if (!role) return;
  
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
  const acct  = document.querySelector('input[name="acctType"]:checked')?.value || "parent";

  if (!email || !pass) { show(signupErr, "أدخل البريد وكلمة المرور."); return; }
  if (!name) { show(signupErr, "أدخل الاسم."); return; }
  if (!["parent","doctor"].includes(acct)) { show(signupErr, "اختر نوع الحساب."); return; }

  // ✅ تفعيل وضع التحميل وإيقاف التوجيه التلقائي
  isSigningUp = true; 
  setLoading(btnSignup, true, "إنشاء الحساب");

  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if (auth.currentUser && name) {
      await updateProfile(auth.currentUser, { displayName: name });
    }

    const role = (acct === "doctor") ? "doctor-pending" : "parent";

    // إنشاء وثيقة المستخدم في قاعدة البيانات
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
    setTimeout(()=> location.replace(dest), 600);

  }catch(err){
    console.error(err);
    show(signupErr, niceAuthError(err));
    // ✅ في حال الفشل، نعيد الزر لحالته الطبيعية ونلغي الإيقاف
    isSigningUp = false; 
    setLoading(btnSignup, false, "إنشاء الحساب");
  }
});

/* تسجيل الدخول */
btnSignin?.addEventListener("click", async ()=>{
  hide(signinErr);
  const email = (siEmail.value || "").trim();
  const pass  = (siPass.value || "").trim();
  if (!email || !pass){ show(signinErr,"أدخل البريد وكلمة المرور."); return; }

  // ✅ تفعيل وضع التحميل
  setLoading(btnSignin, true, "دخول");

  try{
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged سيتولى توجيه المستخدم
  }catch(err){
    console.error(err);
    show(signinErr, niceAuthError(err));
    // ✅ في حال الفشل نرفع وضع التحميل
    setLoading(btnSignin, false, "دخول");
  }
});

/* تسجيل خروج (للتجربة) */
btnDemoLogout?.addEventListener("click", async ()=>{
  await signOut(auth);
});

/* رسائل أخطاء ودّية (مجهزة لاحقاً للنقل إلى utils.js) */
function niceAuthError(e){
  const code = e?.code || "";
  const map = {
    "auth/email-already-in-use": "هذا البريد مستخدم بالفعل.",
    "auth/invalid-email": "بريد غير صالح.",
    "auth/weak-password": "كلمة المرور ضعيفة جدًا.",
    "auth/user-not-found": "المستخدم غير موجود.",
    "auth/wrong-password": "كلمة المرور غير صحيحة.",
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.", // تحديث مهم لفايربيز
    "auth/too-many-requests": "محاولات كثيرة. جرّب لاحقًا."
  };
  return map[code] || "تعذّر تنفيذ العملية. حاول مرة أخرى.";
}
