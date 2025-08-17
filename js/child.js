import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// read childId from URL
const params = new URLSearchParams(location.search);
const childId = params.get('id');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const goMeasurements = document.getElementById('goMeasurements');

onAuthStateChanged(auth, async (user) => {
  if (!user) return location.href = 'index.html';
  if (!childId) return alert('لا يوجد معرف طفل في الرابط');

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()) {
    alert('لم يتم العثور على بيانات الطفل'); 
    return history.back();
  }

  const c = snap.data();
  childNameEl.textContent = c.name || 'بدون اسم';
  const ageTxt = c.birthDate ? `${calcAge(c.birthDate)} سنة` : '-';
  const insulinTxt = c.longActingDose?.insulin ? `، طويل: ${c.longActingDose.insulin}` : '';
  childMetaEl.textContent = `${c.gender || '-'} • العمر: ${ageTxt} • الوحدة: ${c.unitType || 'mg/dL'}${insulinTxt}`;

  // route to measurements with childId
  goMeasurements.href = `measurements.html?child=${childId}`;
});

function calcAge(dStr){
  const d=new Date(dStr), t=new Date();
  let a=t.getFullYear()-d.getFullYear();
  const m=t.getMonth()-d.getMonth();
  if(m<0||(m===0&&t.getDate()<d.getDate())) a--;
  return a;
}
