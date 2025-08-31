// js/login.js (بديل كامل)
import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* صفحات التحويل */
const ROUTES = {
  parent:  'parent.html',
  doctor:  'doctor-dashboard.html',
  admin:   'admin.html',
  pending: 'pending.html'
};

/* عناصر الواجهة */
const form = document.getElementById('formLogin');
const emailEl = document.getElementById('email');
const passEl  = document.getElementById('password');
const btn     = document.getElementById('btnSubmit');
const msg     = document.getElementById('msg');

function say(t, type='info'){ if(!msg) return; msg.textContent=t; msg.className=`msg ${type}`; }

/* جلب الدور */
async function getRole(uid){
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return 'parent';                // افتراضيًا
  const u = snap.data();
  // دعم قديم لحقل rule
  const legacy = (u.rule === 'doctors') ? 'doctor' : u.rule;
  return (u.role || legacy || 'parent');
}

/* تحويل طبقًا للدور */
async function route(uid){
  const role = (await getRole(uid)).toLowerCase();
  if (role === 'admin')           { location.href = ROUTES.admin;   return; }
  if (role === 'doctor')          { location.href = ROUTES.doctor;  return; }
  if (role === 'doctor-pending')  { location.href = ROUTES.pending; return; }
  location.href = ROUTES.parent;
}

/* لو المستخدم داخل بالفعل */
onAuthStateChanged(auth, (user)=>{ if(user) route(user.uid); });

/* معالجة الدخول */
form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = emailEl?.value?.trim();
  const pass  = passEl?.value;
  if(!email || !pass){ say('أدخل البريد وكلمة المرور','warn'); return; }

  try{
    btn && (btn.disabled = true); say('جارٍ تسجيل الدخول…','info');
    const { user } = await signInWithEmailAndPassword(auth, email, pass);
    await route(user.uid);
  }catch(err){
    const code = err?.code || '';
    const map = {
      'auth/invalid-credential':'البريد/كلمة المرور غير صحيحة',
      'auth/user-not-found':'هذا البريد غير مسجل',
      'auth/wrong-password':'كلمة المرور غير صحيحة',
      'auth/invalid-email':'صيغة البريد غير صحيحة',
      'auth/user-disabled':'تم إيقاف الحساب'
    };
    say(map[code] || 'تعذّر تسجيل الدخول. حاول ثانية','error');
  }finally{
    btn && (btn.disabled = false);
  }
});
