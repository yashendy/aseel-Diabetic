import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword, updateProfile, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const ROUTES = {
  parent:  'parent-dashboard.html',
  doctor:  'doctor-dashboard.html',
  admin:   'admin.html',
  pending: 'pending.html'
};

const f = document.getElementById('registerForm');
const nameEl = document.getElementById('reg-name');
const emailEl= document.getElementById('reg-email');
const passEl = document.getElementById('reg-pass');
const pass2El= document.getElementById('reg-pass2');
const msg    = document.getElementById('msg');

function say(t, ok=false){ msg.textContent=t; msg.className = ok? 'ok' : 'err'; }

document.querySelectorAll('input[name="role"]').forEach(r=>{
  r.addEventListener('change', ()=>{
    const isDoc = document.querySelector('input[name="role"]:checked').value === 'doctor';
    document.getElementById('doctorFields').style.display = isDoc ? 'grid' : 'none';
    document.getElementById('pendingNote').style.display  = isDoc ? 'block' : 'none';
  });
});

onAuthStateChanged(auth, async (u)=>{
  if(!u) return;
  // لو داخل بالفعل، وجّهه حسب دوره الحالي
  const snap = await getDoc(doc(db,'users', u.uid));
  const role = snap.exists()? (snap.data().role || 'parent') : 'parent';
  if (role==='admin') location.href = ROUTES.admin;
  else if (role==='doctor') location.href = ROUTES.doctor;
  else if (role==='doctor-pending') location.href = ROUTES.pending;
  else location.href = ROUTES.parent;
});

f.addEventListener('submit', async (e)=>{
  e.preventDefault();
  msg.textContent='';

  if(!nameEl.value.trim()){ say('الاسم مطلوب'); return; }
  if(passEl.value !== pass2El.value){ say('تأكيد كلمة المرور لا يطابق'); return; }

  const picked = document.querySelector('input[name="role"]:checked').value; // parent | doctor
  const role   = (picked === 'doctor') ? 'doctor-pending' : 'parent';

  try{
    const cred = await createUserWithEmailAndPassword(auth, emailEl.value.trim(), passEl.value);
    await updateProfile(cred.user, { displayName: nameEl.value.trim() });

    // users/{uid}
    await setDoc(doc(db,'users', cred.user.uid), {
      uid: cred.user.uid,
      displayName: nameEl.value.trim(),
      email: emailEl.value.trim(),
      role, // parent | doctor-pending
      specialty: role==='doctor-pending' ? (document.getElementById('reg-specialty').value.trim() || null) : null,
      clinic:    role==='doctor-pending' ? (document.getElementById('reg-clinic').value.trim() || null) : null,
      createdAt: serverTimestamp()
    }, { merge:true });

    // ===== [GPT5 PATCH START] إنشاء ملف الطبيب في doctors/{uid} بحالة pending =====
    if (role === 'doctor-pending') {
      const specialty = (document.getElementById('reg-specialty')?.value || '').trim() || null;
      const clinic    = (document.getElementById('reg-clinic')?.value || '').trim() || null;
      await setDoc(doc(db, 'doctors', cred.user.uid), {
        uid: cred.user.uid,
        name: nameEl.value.trim(),
        email: emailEl.value.trim(),
        specialty,
        clinic,
        status: 'pending',
        createdAt: serverTimestamp()
      }, { merge: true });
    }
    // ===== [GPT5 PATCH END] =====

    // parents/{uid} — فقط لو Parent
    if (role === 'parent'){
      await setDoc(doc(db, `parents/${cred.user.uid}`), {
        ownerUid: cred.user.uid,
        name: nameEl.value.trim(),
        email: emailEl.value.trim(),
        createdAt: serverTimestamp()
      }, { merge:true });
    }

    say('تم إنشاء الحساب ✅', true);
    // التحويل حسب الدور
    if (role === 'doctor-pending') location.href = ROUTES.pending;
    else location.href = ROUTES.parent;
  }catch(err){
    say(err.message || 'تعذّر إنشاء الحساب');
  }
});
