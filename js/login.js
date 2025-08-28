import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const form = document.getElementById('formLogin');
const emailEl = document.getElementById('email');
const passEl  = document.getElementById('password');
const btn     = document.getElementById('btnSubmit');
const msg     = document.getElementById('msg');

function showMsg(text, type='info'){
  if(!msg) return;
  msg.textContent = text;
  msg.className = `msg ${type}`;
}

form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = emailEl.value.trim();
  const pass  = passEl.value;

  if(!email || !pass){
    showMsg('أدخل البريد وكلمة المرور', 'warn');
    return;
  }

  btn.disabled = true; showMsg('جارٍ تسجيل الدخول…');

  try{
    // 1) تسجيل الدخول
    const { user } = await signInWithEmailAndPassword(auth, email, pass);
    const uid = user.uid;

    // 2) قراءة وثيقة الدور من users/{uid}
    const snap = await getDoc(doc(db, 'users', uid));

    if(!snap.exists()){
      // مفيش وثيقة؛ خليه وليّ أمر افتراضي أو عرّفه بالخطأ
      showMsg('لا توجد صلاحيات محدّدة لهذا الحساب. راجع الأدمن.', 'error');
      btn.disabled = false;
      return;
    }

    const role = snap.data().role;
    console.log('role =', role);

    // 3) التوجيه حسب الدور
    if(role === 'admin'){
      location.href = 'admin-doctors.html';
    }else if(role === 'parent'){
      location.href = 'parent.html'; // عدّل للاسم المناسب عندك
    }else{
      showMsg('دور غير معروف. راجع الأدمن.', 'error');
      btn.disabled = false;
    }

  }catch(err){
    console.error(err);
    showMsg(err.message?.includes('auth/invalid-credential')
      ? 'بيانات الدخول غير صحيحة'
      : 'تعذّر تسجيل الدخول', 'error');
    btn.disabled = false;
  }
});
