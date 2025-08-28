// js/login.js
import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== عناصر الواجهة ===== */
const emailEl   = document.getElementById('email');
const passEl    = document.getElementById('password');
const btnLogin  = document.getElementById('btnSubmit');
const btnGoReg  = document.getElementById('btnGoRegister');   // يفتح صفحة التسجيل
const btnGoForgot = document.getElementById('btnGoForgot');    // يفتح صفحة استرجاع الباسوورد
const infoEl    = document.getElementById('msg');              // مكان الرسائل (اختياري)
const btnGoDashboard = document.getElementById('btnGoDashboard'); // زر الذهاب للوحة حين يكون مسجلًا
const btnLogout = document.getElementById('btnLogout');            // زر تسجيل الخروج (اختياري)

// وظيفة صغيرة للرسائل
function showMsg(text, type='info') {
  if (!infoEl) return;
  infoEl.textContent = text;
  infoEl.className = `msg ${type}`; // وفّر CSS بسيط: .msg.info / .msg.error / .msg.success
}

// منع الدخول التلقائي بين الجلسات (اختياري):
// نخلي الـ persistence على مستوى جلسة المتصفح فقط
setPersistence(auth, browserSessionPersistence).catch(()=>{});

/* ===== قراءة الدور وتوجيه مناسب ===== */
async function getUserRole(uid) {
  // أولاً: users/{uid}
  const refUser = doc(db, 'users', uid);
  const snapUser = await getDoc(refUser);
  if (snapUser.exists()) {
    const role = snapUser.data()?.role || 'parent';
    return role;
  }
  // ثانيًا (دعم قديم): admin/{uid}
  const refAdmin = doc(db, 'admin', uid);
  const snapAdmin = await getDoc(refAdmin);
  if (snapAdmin.exists()) {
    return 'admin';
  }
  return 'parent';
}

async function routeByRole(uid) {
  const role = await getUserRole(uid);
  if (role === 'admin') {
    window.location.href = 'admin-doctors.html';
  } else {
    // غيّر parent.html لاسم صفحة وليّ الأمر عندك لو مختلف
    window.location.href = 'parent.html';
  }
}

/* ===== أحداث الواجهة ===== */

// زر الدخول
btnLogin?.addEventListener('click', async () => {
  const email = (emailEl?.value || '').trim();
  const pass  = (passEl?.value || '').trim();

  if (!email || !pass) {
    showMsg('من فضلك أدخل البريد وكلمة المرور.', 'error');
    return;
  }

  try {
    btnLogin.disabled = true;
    btnLogin.textContent = '...جارِ الدخول';

    const cred = await signInWithEmailAndPassword(auth, email, pass);

    // بعد نجاح الدخول: نقرأ الدور ونوجّه
    await routeByRole(cred.user.uid);
  } catch (err) {
    console.error(err);
    showMsg(err?.message?.includes('auth/') ? 'بيانات الدخول غير صحيحة.' : ('حدث خطأ: ' + err.message), 'error');
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.textContent = 'دخول';
    }
  }
});

// زر فتح صفحة التسجيل
btnGoReg?.addEventListener('click', () => {
  window.location.href = 'register.html';
});

// زر فتح صفحة نسيت الباسوورد
btnGoForgot?.addEventListener('click', () => {
  window.location.href = 'forgot.html';
});

// زر الذهاب للوحة (يظهر فقط لو المستخدم كان مسجلاً بالفعل) — بدون تحويل تلقائي
btnGoDashboard?.addEventListener('click', async () => {
  try {
    const user = auth.currentUser;
    if (!user) {
      showMsg('لا يوجد جلسة مسجلة حالياً.', 'error');
      return;
    }
    await routeByRole(user.uid);
  } catch (e) {
    showMsg('تعذّر الانتقال للوحة.', 'error');
  }
});

// زر تسجيل الخروج (اختياري)
btnLogout?.addEventListener('click', async () => {
  await signOut(auth);
  showMsg('تم تسجيل الخروج.', 'success');
});

/* ===== عدم التحويل تلقائيًا عند فتح الصفحة =====
   فقط نحدّث حالة الواجهة لو المستخدم كان مسجّل دخول سابقًا */
onAuthStateChanged(auth, (user) => {
  if (user) {
    // لا نقوم بالتحويل — فقط نعرض ملاحظة للمستخدم ونمنحه خيار الذهاب أو الخروج
    showMsg('أنت مسجّل دخول بالفعل. يمكنك الذهاب للوحة أو تسجيل الخروج.', 'info');
    // لو عندك عناصر لعرضها/إخفائها:
    btnGoDashboard?.classList.remove('hidden');
    btnLogout?.classList.remove('hidden');
  } else {
    // إخفاء الأزرار الخاصة بالمستخدم المسجّل
    btnGoDashboard?.classList.add('hidden');
    btnLogout?.classList.add('hidden');
    showMsg('من فضلك سجّل الدخول.', 'info');
  }
});
