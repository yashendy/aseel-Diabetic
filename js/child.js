import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const loaderEl      = document.getElementById('loader');

const childNameEl   = document.getElementById('childName');
const childMetaEl   = document.getElementById('childMeta');
const chipRangeEl   = document.getElementById('chipRange');
const chipCREl      = document.getElementById('chipCR');
const chipCFEl      = document.getElementById('chipCF');

const todayMeasuresEl = document.getElementById('todayMeasures');
const todayMealsEl    = document.getElementById('todayMeals');
const nextVisitEl     = document.getElementById('nextVisit');

const miniMeasuresEl  = document.getElementById('miniMeasures');
const miniMealsEl     = document.getElementById('miniMeals');
const miniFollowUpEl  = document.getElementById('miniFollowUp');

const goMeasurements  = document.getElementById('goMeasurements');
const goMeals         = document.getElementById('goMeals');
const goFoodItems     = document.getElementById('goFoodItems');
const goReports       = document.getElementById('goReports');
const goVisits        = document.getElementById('goVisits');
const goChildEdit     = document.getElementById('goChildEdit');

/* أدوات */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function calcAge(bd){
  if(!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}
function esc(s){ return (s||'').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;')
  .replaceAll("'",'&#039;'); }
function loader(show){ loaderEl.classList.toggle('hidden', !show); }

/* تهيئة */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href = 'index.html';
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); history.back(); return; }

  try{
    loader(true);

    // بيانات الطفل
    const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(childRef);
    if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
    const c = snap.data();

    childNameEl.textContent = c.name || 'طفل';
    childMetaEl.textContent = `${c.gender || '-'} • العمر: ${calcAge(c.birthDate)} سنة`;

    const min = Number(c.normalRange?.min ?? 4.4);
    const max = Number(c.normalRange?.max ?? 7.8);
    const cr  = Number(c.carbRatio ?? 12);
    const cf  = c.correctionFactor != null ? Number(c.correctionFactor) : null;

    chipRangeEl.textContent = `النطاق الطبيعي: ${min}–${max} mmol/L`;
    chipCREl.textContent    = `CarbRatio: ${cr} g/U`;
    chipCFEl.textContent    = `CF: ${cf ?? '—'} mmol/L per U`;

    // روابط الصفحات بنفس childId
    goMeasurements.href = `measurements.html?child=${encodeURIComponent(childId)}`;
    goMeals.href        = `meals.html?child=${encodeURIComponent(childId)}`;
    goFoodItems.href    = `food-items.html?child=${encodeURIComponent(childId)}`;
    goReports.href      = `reports.html?child=${encodeURIComponent(childId)}`;
    goVisits.href       = `visits.html?child=${encodeURIComponent(childId)}`;
    goChildEdit.href    = `add-child.html?child=${encodeURIComponent(childId)}`;

    // إحصائيات اليوم
    const today = todayStr();

    // قياسات اليوم
    const measRef = collection(db, `parents/${user.uid}/children/${childId}/measurements`);
    const qMeas   = query(measRef, where('date','==', today));
    const snapMeas= await getDocs(qMeas);
    const measuresCount = snapMeas.size || 0;

    // وجبات اليوم
    const mealsRef = collection(db, `parents/${user.uid}/children/${childId}/meals`);
    const qMeals   = query(mealsRef, where('date','==', today));
    const snapMeals= await getDocs(qMeals);
    const mealsCount = snapMeals.size || 0;

    // أقرب متابعة طبية
    const visitsRef = collection(db, `parents/${user.uid}/children/${childId}/visits`);
    const qVisits   = query(visitsRef, where('followUpDate','>=', today), orderBy('followUpDate','asc'), limit(1));
    const snapVisit = await getDocs(qVisits);
    const nextFup   = !snapVisit.empty ? (snapVisit.docs[0].data().followUpDate || '—') : '—';

    todayMeasuresEl.textContent = measuresCount;
    miniMeasuresEl.textContent  = measuresCount;
    todayMealsEl.textContent    = mealsCount;
    miniMealsEl.textContent     = mealsCount;
    nextVisitEl.textContent     = nextFup;
    miniFollowUpEl.textContent  = nextFup;

  }catch(e){
    console.error(e);
    alert('تعذر تحميل بيانات الداشبورد');
  }finally{
    loader(false);
  }
});
