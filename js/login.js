// js/login.js
import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* صفحات التوجيه */
const PARENT_HOME = 'parent.html';
const ADMIN_HOME  = 'admin-doctors.html';

/* إدارة التبويبات */
const tabs = [...document.querySelectorAll('.tab')];
const views = {
  login:    document.getElementById('login-form'),
  register: document.getElementById('register-form'),
  reset:    document.getElementById('reset-form')
};
function show(name){
  Object.entries(views).forEach(([k,el])=> el.classList.toggle('hidden', k!==name));
  tabs.forEach(t=> t.classList.toggle('active', t.dataset.go===name));
}
tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.go)));
document.querySelectorAll('[data-go]').forEach(b=>{
  b.addEventListener('click', (e)=>{ e.preventDefault(); show(b.dataset.go); });
});

/* فحص الأدمن */
async function checkAdmin(uid){
  const refs = [doc(db,'admin',uid), doc(db,'admins',uid)];
  try{
    for (const r of refs){
      const s = await getDoc(r);
      if (s.exists()){
        const d = s.data() || {};
        if (d.role === 'admin' || d.isAdmin === true) return true;
      }
    }
  }catch(err){
    console.warn('checkAdmin: no permission (fallback to parent)', err);
  }
  return false;
}

/* مستخدم بالفعل مسجل دخول */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return;
  const isAdmin = await checkAdmin(user.uid);
  location.replace(isAdmin ? ADMIN_HOME : PARENT_HOME);
});

/* تسجيل الدخول */
views.login.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  try{
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const isAdmin = await checkAdmin(cred.user.uid);
    location.href = isAdmin ? ADMIN_HOME : PARENT_HOME;
  }catch(err){
    alert('❌ خطأ في تسجيل الدخول:\n' + (err.message || err));
  }
});

/* إنشاء حساب */
views.register.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const name  = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const pass  = document.getElementById('register-password').value;
  const pass2 = document.getElementById('register-confirm').value;
  if(pass !== pass2){ alert('❌ كلمتا المرور غير متطابقتين'); return; }
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    if(name) await updateProfile(cred.user, { displayName: name });
    location.href = PARENT_HOME; // المستخدم الجديد وليّ أمر افتراضيًا
  }catch(err){
    alert('❌ خطأ أثناء التسجيل:\n' + (err.message || err));
  }
});

/* نسيت كلمة المرور */
views.reset.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('reset-email').value.trim();
  try{
    await sendPasswordResetEmail(auth, email);
    alert('📧 تم إرسال رابط إعادة تعيين كلمة المرور.');
    show('login');
  }catch(err){
    alert('❌ تعذّر الإرسال:\n' + (err.message || err));
  }
});
