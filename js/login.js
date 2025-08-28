// js/login.js
import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// --------- عناصر الواجهة ----------
const form = document.getElementById('formLogin');
const emailEl = document.getElementById('email');
const passEl  = document.getElementById('password');
const btn     = document.getElementById('btnSubmit');
const msg     = document.getElementById('msg');

// تأكيد وجود العناصر
(function sanity(){
  const missing = [];
  if(!form) missing.push('#formLogin');
  if(!emailEl) missing.push('#email');
  if(!passEl) missing.push('#password');
  if(!btn) missing.push('#btnSubmit');
  if(!msg) missing.push('#msg');
  if(missing.length){
    console.error('[login] عناصر مفقودة في HTML:', missing.join(', '));
    alert('هناك عناصر ناقصة في صفحة الدخول: ' + missing.join(', '));
  }else{
    console.log('[login] DOM ok');
  }
})();

function showMsg(text, type='info'){
  if(!msg) return;
  msg.textContent = text;
  msg.className = `msg ${type}`;
}

function basePath(){
  // لو المشروع مستضاف على GitHub Pages داخل مجلد (مثلاً /aseel-Diabetic/)
  // خليه يلتقط المسار تلقائيًا.
  const p = location.pathname;
  const i = p.lastIndexOf('/');
  return p.slice(0, i + 1); // مسار المجلد الحالي
}
function go(page){
  // يفتح الصفحة ضمن نفس المجلد
  const url = basePath() + page;
  console.log('[login] redirect ->', url);
  location.assign(url);
}

form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = emailEl.value.trim();
  const pass  = passEl.value;

  if(!email || !pass){
    showMsg('أدخل البريد وكلمة المرور', 'warn');
    return;
  }

  btn.disabled = true; showMsg('جارٍ تسجيل الدخول…', 'info');
  console.log('[login] signing in…', email);

  try{
    // 1) تسجيل الدخول
    const { user } = await signInWithEmailAndPassword(auth, email, pass);
    console.log('[login] signed in, uid =', user.uid);

    // 2) قراءة وثيقة users/{uid}
    const ref  = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    console.log('[login] users doc exists?', snap.exists());

    if(!snap.exists()){
      showMsg('لا توجد صلاحيات محددة لهذا الحساب (users/'+user.uid+'). راجع الأدمن.', 'error');
      btn.disabled = false;
      return;
    }

    const data = snap.data();
    console.log('[login] role =', data.role);

    if(data.role === 'admin'){
      go('admin-doctors.html');     // ← اسم صفحة الأدمن
    }else if(data.role === 'parent'){
      go('parent.html');            // ← عدّلي اسم صفحة وليّ الأمر إن لزم
    }else{
      showMsg('دور غير معروف في users/'+user.uid+' . راجع الأدمن.', 'error');
      btn.disabled = false;
    }

  }catch(err){
    console.error('[login] error:', err);
    // رسائل أدقّ
    const msgMap = {
      'auth/invalid-credential': 'البريد/كلمة المرور غير صحيحة.',
      'auth/invalid-email': 'صيغة البريد غير صحيحة.',
      'auth/user-disabled': 'تم إيقاف هذا الحساب.',
      'auth/user-not-found': 'هذا البريد غير مسجل.',
      'auth/wrong-password': 'كلمة المرور غير صحيحة.',
      'permission-denied': 'ليس لديك صلاحية الوصول للبيانات.'
    };
    const code = err?.code || (err?.message?.includes('Missing or insufficient permissions') ? 'permission-denied' : '');
    showMsg(msgMap[code] || 'تعذّر تسجيل الدخول. حاول ثانية.', 'error');
    btn.disabled = false;
  }
});
