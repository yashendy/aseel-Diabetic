import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, writeBatch, deleteField, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

/* DOM */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const btnBack = document.getElementById('btnBack');
const childMetaEl = document.getElementById('childMeta');
const docSummary = document.getElementById('docSummary');
const consentSummary = document.getElementById('consentSummary');

const doctorCodeEl = document.getElementById('doctorCode');
const consentToggle = document.getElementById('consentToggle');
const btnSave = document.getElementById('btnSave');
const btnUnlink = document.getElementById('btnUnlink');

const loaderEl = document.getElementById('loader');
const toastEl  = document.getElementById('toast');

function toast(s){ toastEl.textContent=s; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 1800); }
function busy(b){ loaderEl.classList.toggle('hidden', !b); }

/* حالة */
let USER=null, CHILD=null;

/* الموافقة: الشكل المعتمد  sharingConsent = { doctor: true/false }
   ونقرأ الشكل القديم (قيمة منطقية) حتى لا تظهر الحالة خطأً. (نفس منطق قواعد Firestore) */
function consentOn(c){
  if (c === false) return false;
  if (c && typeof c === 'object' && c.doctor === false) return false;
  return true;
}
function consentObj(c, doctorOn){
  const base = (c && typeof c === 'object') ? c : {};
  return { ...base, doctor: !!doctorOn };
}

/* Init */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('رابط غير كامل'); history.back(); return; }
  USER=user;
  btnBack.addEventListener('click', ()=> history.back());
  await loadChild();
});

async function loadChild(){
  busy(true);
  try{
    const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
    const snap = await getDoc(ref);
    if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
    CHILD = snap.data();

    childMetaEl.textContent = `${CHILD.name||'طفل'} • العمر: ${age(CHILD.birthDate)} سنة`;
    renderState();
  }finally{ busy(false); }
}

function renderState(){
  const d = CHILD.assignedDoctorInfo;
  if (CHILD.assignedDoctor && d){
    docSummary.textContent = [d.name || 'طبيب', d.center || d.email || ''].filter(Boolean).join(' — ');
  }else if (CHILD.assignedDoctor){
    docSummary.textContent = `مرتبط بطبيب (لا توجد معلومات إضافية)`;
  }else{
    docSummary.textContent = 'غير مرتبط بطبيب';
  }
  const on = CHILD.assignedDoctor ? consentOn(CHILD.sharingConsent) : false;
  consentSummary.textContent = on ? 'مفعلة' : 'موقوفة';
  consentToggle.checked = on;
}

/* حفظ/تغيير الربط */
btnSave.addEventListener('click', async ()=>{
  const code = (doctorCodeEl.value||'').trim().toUpperCase();
  const wantConsent = !!consentToggle.checked;

  busy(true);
  try{
    let docUid = CHILD.assignedDoctor || null;
    let docInfo = CHILD.assignedDoctorInfo || null;
    let codeRef = null;

    if (code){ // استبدال الطبيب بكود ربط صالح (نفس نظام الربط في صفحة أولياء الأمور)
      const found = await readLinkCode(code);
      if (!found){ alert('الكود غير صحيح أو مستخدم أو منتهي'); return; }
      codeRef = found.ref;
      docUid = found.doctorId;
      docInfo = { uid: found.doctorId, name: found.name, center: found.center };
    }

    const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
    const nextConsent = consentObj(CHILD.sharingConsent, wantConsent);
    const batch = writeBatch(db);
    batch.update(ref, {
      assignedDoctor: docUid || null,
      assignedDoctorInfo: docUid ? docInfo : null,
      sharingConsent: nextConsent,
      shareDoctor: deleteField()      // حقل قديم لم يعد يُستخدم
    });
    if (codeRef) batch.update(codeRef, { used: true, parentId: USER.uid, usedAt: serverTimestamp() });
    await batch.commit();

    // حدث النسخة المحلية لعرض الحالة فورًا
    CHILD.assignedDoctor = docUid || null;
    CHILD.assignedDoctorInfo = docUid ? docInfo : null;
    CHILD.sharingConsent = nextConsent;
    delete CHILD.shareDoctor;
    if (codeRef) doctorCodeEl.value = '';

    renderState();
    toast('تم الحفظ ✅');
  }catch(e){
    console.error(e); alert('تعذر الحفظ');
  }finally{ busy(false); }
});

/* إزالة الربط بالكامل */
btnUnlink.addEventListener('click', async ()=>{
  if(!confirm('هل تريدين إزالة الربط بالكامل؟ سيتم أيضًا إيقاف الموافقة.')) return;
  busy(true);
  try{
    const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
    const nextConsent = consentObj(CHILD.sharingConsent, false);
    await updateDoc(ref, {
      assignedDoctor: null,
      assignedDoctorInfo: null,
      sharingConsent: nextConsent,
      shareDoctor: deleteField()      // حقل قديم لم يعد يُستخدم
    });
    CHILD.assignedDoctor = null;
    CHILD.assignedDoctorInfo = null;
    CHILD.sharingConsent = nextConsent;
    delete CHILD.shareDoctor;
    renderState();
    doctorCodeEl.value = '';
    consentToggle.checked = false;
    toast('تمت إزالة الربط ✅');
  }catch(e){
    console.error(e); alert('تعذر الإزالة');
  }finally{ busy(false); }
});

/* قراءة كود ربط صالح من linkCodes (غير مستخدم وغير منتهي) */
async function readLinkCode(code){
  const ref = doc(db, 'linkCodes', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data();
  if (d.used || !d.doctorId) return null;
  // الأكواد القديمة بدون expiresAt تبقى صالحة
  const expMs = d.expiresAt && typeof d.expiresAt.toMillis === 'function' ? d.expiresAt.toMillis() : null;
  if (expMs !== null && expMs < Date.now()) return null;
  return { ref, doctorId: d.doctorId, name: d.doctorName || null, center: d.doctorCenter || null };
}

function age(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return a<0? '-' : a;
}
