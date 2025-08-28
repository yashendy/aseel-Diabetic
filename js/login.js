// js/login.js
import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر الواجهة */
const form = document.getElementById('loginForm');
const emailEl = document.getElementById('login-email');
const passEl  = document.getElementById('login-password');
const btn     = document.getElementById('btnLogin');
const msgEl   = document.getElementById('msg');

function say(text, ok=false){
  msgEl.textContent = text;
  msgEl.className = ok? 'ok' : 'err';
}

/* الحصول على الدور:
   1) users/{uid}.role (إن وُجد)
   2) admin/{uid}.role (توافقاً مع هيكل بياناتك الحالي)
*/
async function resolveUserRole(uid){
  // users/{uid}
  try{
    const s1 = await getDoc(doc(db, `users/${uid}`));
    if (s1.exists()){
      const role = s1.data()?.role;
      if (role) return role;
    }
  }catch{}
  // admin/{uid}
  try{
    const s2 = await getDoc(doc(db, `admin/${uid}`));
    if (s2.exists()){
      const role = s2.data()?.role;
      if (role) return role;
    }
  }catch{}
  // افتراضي = ولي أمر
  return 'parent';
}

/* توجيه حسب الدور */
async function routeAfterLogin(user){
  const role = await resolveUserRole(user.uid);
  if (role === 'admin'){
    location.href = 'admin-doctors.html';
  }else{
    // وليّ أمر
    location.href = 'parent.html';
  }
}

/* حدث تسجيل الدخول */
form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  say('');
  btn.disabled = true; btn.textContent = '...جارٍ الدخول';

  try{
    const cred = await signInWithEmailAndPassword(auth, emailEl.value.trim(), passEl.value);
    await routeAfterLogin(cred.user);
  }catch(err){
    say(err.message || 'تعذّر تسجيل الدخول');
  }finally{
    btn.disabled = false; btn.textContent = 'دخول';
  }
});

/* لو المستخدم مسجّل أصلاً */
onAuthStateChanged(auth, (user)=>{
  if (user){
    routeAfterLogin(user);
  }
});
