import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs
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
    docSummary.textContent = `${d.name || 'طبيب'} — ${d.email || ''}`.trim();
  }else if (CHILD.assignedDoctor){
    docSummary.textContent = `مرتبط بطبيب (لا توجد معلومات إضافية)`;
  }else{
    docSummary.textContent = 'غير مرتبط بطبيب';
  }
  const on = !!(CHILD.sharingConsent?.doctor);
  consentSummary.textContent = on ? 'مفعلة' : 'موقوفة';
  consentToggle.checked = on;
}

/* حفظ/تغيير الربط */
btnSave.addEventListener('click', async ()=>{
  const code = (doctorCodeEl.value||'').trim();
  const wantConsent = !!consentToggle.checked;

  let docUid = CHILD.assignedDoctor || null;
  let docInfo = CHILD.assignedDoctorInfo || null;

  if (code){ // استبدال الطبيب بناءً على الكود
    const found = await findDoctorByCode(code);
    if (!found){ alert('لم يتم العثور على طبيب بهذا الكود'); return; }
    docUid = found.uid;
    docInfo = { name: found.name || null, email: found.email || null, code };
  }

  busy(true);
  try{
    const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
    await updateDoc(ref, {
      assignedDoctor: docUid || null,
      assignedDoctorInfo: docUid ? docInfo : null,
      'sharingConsent.doctor': wantConsent
    });
    // حدث النسخة المحلية لعرض الحالة فورًا
    CHILD.assignedDoctor = docUid || null;
    CHILD.assignedDoctorInfo = docUid ? docInfo : null;
    CHILD.sharingConsent = { ...(CHILD.sharingConsent||{}), doctor: wantConsent };

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
    await updateDoc(ref, {
      assignedDoctor: null,
      assignedDoctorInfo: null,
      'sharingConsent.doctor': false
    });
    CHILD.assignedDoctor = null;
    CHILD.assignedDoctorInfo = null;
    CHILD.sharingConsent = { ...(CHILD.sharingConsent||{}), doctor: false };
    renderState();
    doctorCodeEl.value = '';
    consentToggle.checked = false;
    toast('تمت إزالة الربط ✅');
  }catch(e){
    console.error(e); alert('تعذر الإزالة');
  }finally{ busy(false); }
});

/* البحث عن الطبيب بالكود */
async function findDoctorByCode(code){
  // نتوقع Collection باسم users وفيه role='doctor' و doctorCode
  const qy = query(collection(db, 'users'), where('role','==','doctor'), where('doctorCode','==', code));
  const snap = await getDocs(qy);
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  return { uid: snap.docs[0].id, name: d.name || null, email: d.email || null };
}

function age(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return a<0? '-' : a;
}
