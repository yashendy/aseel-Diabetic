// js/login.js
// تسجيل الدخول / إنشاء حساب / استعادة كلمة المرور + إعادة التوجيه حسب الدور (admin / parent)

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== عناصر الواجهة ===== */
const btnTabLogin    = document.getElementById('btn-tab-login');
const btnTabRegister = document.getElementById('btn-tab-register');
const btnTabReset    = document.getElementById('btn-tab-reset');

const emailEl    = document.getElementById('email');
const passEl     = document.getElementById('password');
const btnSubmit  = document.getElementById('btnSubmit');
const msgEl      = document.getElementById('msg'); // <div id="msg"></div> اختياري للرسائل

/* ===== حالة الوضع الحالي ===== */
let mode = 'login'; // login | register | reset

function setMode(m) {
  mode = m;
  // تمييز أزرار التبويب
  [btnTabLogin, btnTabRegister, btnTabReset].forEach(b => b?.classList.remove('active'));
  if (m === 'login')    btnTabLogin?.classList.add('active');
  if (m === 'register') btnTabRegister?.classList.add('active');
  if (m === 'reset')    btnTabReset?.classList.add('active');

  // الحقول المطلوبة حسب الوضع
  if (m === 'reset') {
    passEl?.setAttribute('disabled', 'disabled');
    passEl?.classList.add('disabled');
    btnSubmit.textContent = 'إرسال رابط الاستعادة';
  } else if (m === 'register') {
    passEl?.removeAttribute('disabled');
    passEl?.classList.remove('disabled');
    btnSubmit.textContent = 'إنشاء حساب';
  } else {
    passEl?.removeAttribute('disabled');
    passEl?.classList.remove('disabled');
    btnSubmit.textContent = 'دخول';
  }

  clearMsg();
}

btnTabLogin?.addEventListener('click',   () => setMode('login'));
btnTabRegister?.addEventListener('click',() => setMode('register'));
btnTabReset?.addEventListener('click',   () => setMode('reset'));

// بداية افتراضيًا على "تسجيل الدخول"
setMode('login');

/* ===== أدوات مساعدة ===== */
function showMsg(text, type='info') {
  if (!msgEl) return alert(text);
  msgEl.textContent = text;
  msgEl.className = `msg ${type}`; // .msg.info / .msg.error / .msg.success
}
function clearMsg(){ if(msgEl){ msgEl.textContent=''; msgEl.className='msg'; } }
function lockUI(lock=true){
  if (lock) {
    btnSubmit.disabled = true;
    btnSubmit.dataset._old = btnSubmit.textContent;
    btnSubmit.textContent = '…جارٍ المعالجة';
  } else {
    btnSubmit.disabled = false;
    if (btnSubmit.dataset._old) btnSubmit.textContent = btnSubmit.dataset._old;
  }
}

/* ===== توجيه بعد الدخول حسب الدور ===== */
async function redirectByRole(uid) {
  try {
    const uref = doc(db, 'users', uid);
    const snap = await getDoc(uref);

    if (snap.exists()) {
      const role = snap.data().role;
      if (role === 'admin') {
        location.href = 'admin-doctors.html?uid=' + encodeURIComponent(uid);
        return;
      }
      // ممكن تضيفي أدوار أخرى لاحقًا (doctor …)
    }
    // الافتراضي: وليّ أمر
    location.href = 'parent.html?uid=' + encodeURIComponent(uid);
  } catch (e) {
    // لو حصلت مشكلة في القراءة، نرجّع للوضع الافتراضي
    location.href = 'parent.html?uid=' + encodeURIComponent(uid);
  }
}

/* ===== إنشاء وثائق أولية للمستخدم الجديد (وليّ أمر) ===== */
async function ensureInitialParentDocs(uid, email) {
  // users/{uid} لو مش موجودة، هننشئ role=parent
  const uref = doc(db, 'users', uid);
  const usnap = await getDoc(uref);
  if (!usnap.exists()) {
    await setDoc(uref, {
      role: 'parent',
      email: email || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  // parents/{uid} كمجلد مالك (لو حابة تضيفي حقول أساسية)
  const pref = doc(db, 'parents', uid);
  const psnap = await getDoc(pref);
  if (!psnap.exists()) {
    await setDoc(pref, {
      owner: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
}

/* ===== تنفيذ الإجراء حسب الوضع ===== */
btnSubmit?.addEventListener('click', async (e) => {
  e.preventDefault();
  clearMsg();

  const email = (emailEl?.value || '').trim();
  const pass  = passEl?.value || '';

  if (!email) { showMsg('من فضلك أدخل البريد الإلكتروني.', 'error'); return; }

  try {
    lockUI(true);

    if (mode === 'login') {
      if (!pass) { showMsg('أدخل كلمة المرور.', 'error'); lockUI(false); return; }
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await redirectByRole(cred.user.uid);

    } else if (mode === 'register') {
      if (!pass || pass.length < 6) {
        showMsg('كلمة المرور يجب ألا تقل عن 6 أحرف.', 'error'); lockUI(false); return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      // إنشاء مستندات أولية للمستخدم الجديد كوليّ أمر
      await ensureInitialParentDocs(cred.user.uid, email);
      showMsg('تم إنشاء الحساب بنجاح ✅ سيتم تحويلك...', 'success');
      await redirectByRole(cred.user.uid);

    } else if (mode === 'reset') {
      await sendPasswordResetEmail(auth, email);
      showMsg('تم إرسال رابط استعادة كلمة المرور إلى بريدك ✉️', 'success');
      setMode('login');
    }

  } catch (err) {
    console.error(err);
    // رسائل عربية بسيطة للأخطاء الشائعة
    let m = 'حدث خطأ. حاول مجددًا.';
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') m = 'بيانات الدخول غير صحيحة.';
    if (err.code === 'auth/user-not-found') m = 'لا يوجد مستخدم بهذا البريد.';
    if (err.code === 'auth/email-already-in-use') m = 'هذا البريد مستخدم بالفعل.';
    if (err.code === 'auth/invalid-email') m = 'بريد إلكتروني غير صالح.';
    if (err.code === 'permission-denied') m = 'لا توجد صلاحية كافية. تواصلي مع الأدمن.';
    showMsg(m, 'error');

  } finally {
    lockUI(false);
  }
});

/* ===== لو المستخدم داخل بالفعل وجاهز ===== */
onAuthStateChanged(auth, async (u) => {
  if (u) {
    // في حالة رجع للصفحة وهو مسجّل مسبقًا
    await redirectByRole(u.uid);
  }
});
