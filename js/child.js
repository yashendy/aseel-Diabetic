import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, getDocs, query, where, orderBy, limit, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const params = new URLSearchParams(location.search);
const childId = params.get('child');
const loaderEl = document.getElementById('loader');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl = document.getElementById('chipCR');
const chipCFEl = document.getElementById('chipCF');

const todayMeasuresEl = document.getElementById('todayMeasures');
const todayMealsEl = document.getElementById('todayMeals');
const nextVisitEl = document.getElementById('nextVisit');

const miniMeasuresEl = document.getElementById('miniMeasures');
const miniMealsEl = document.getElementById('miniMeals');
const miniFollowUpEl = document.getElementById('miniFollowUp');

const goMeasurements = document.getElementById('goMeasurements');
const goMeals = document.getElementById('goMeals');
const goFoodItems = document.getElementById('goFoodItems');
const goReports = document.getElementById('goReports');
const goVisits = document.getElementById('goVisits');
const goChildEdit = document.getElementById('goChildEdit');

const infoNameEl = document.getElementById('infoName');
const infoAgeEl = document.getElementById('infoAge');
const infoGenderEl = document.getElementById('infoGender');
const infoWeightEl = document.getElementById('infoWeight');
const infoHeightEl = document.getElementById('infoHeight');
const infoDeviceEl = document.getElementById('infoDevice');
const infoInsulinEl = document.getElementById('infoInsulin');
const infoRangeEl = document.getElementById('infoRange');
const infoCREl = document.getElementById('infoCR');
const infoCFEl = document.getElementById('infoCF');

function pad(n){return String(n).padStart(2,'0')}
function todayStr(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function calcAge(bd){if(!bd)return '-';const b=new Date(bd),t=new Date();let a=t.getFullYear()-b.getFullYear();const m=t.getMonth()-b.getMonth();if(m<0||(m===0&&t.getDate()<b.getDate()))a--;return a}
function loader(show){loaderEl?.classList.toggle('hidden',!show)}

onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href='index.html';
  if(!childId){alert('لا يوجد معرف طفل');history.back();return;}

  try{
    loader(true);
    const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(childRef);
    if(!snap.exists()){alert('لم يتم العثور على الطفل');history.back();return;}
    const c = snap.data();

    childNameEl.textContent = c.name || 'طفل';
    childMetaEl.textContent = `${c.gender || '-'} • العمر: ${calcAge(c.birthDate)} سنة`;

    const min = Number(c.normalRange?.min ?? 4.4);
    const max = Number(c.normalRange?.max ?? 7.8);
    const cr  = Number(c.carbRatio ?? 12);
    const cf  = c.correctionFactor!=null?Number(c.correctionFactor):null;

    chipRangeEl.textContent = `النطاق الطبيعي: ${min}–${max} mmol/L`;
    chipCREl.textContent    = `CarbRatio: ${cr} g/U`;
    chipCFEl.textContent    = `CF: ${cf ?? '—'} mmol/L per U`;

    goMeasurements.href=`measurements.html?child=${childId}`;
    goMeals.href=`meals.html?child=${childId}`;
    goFoodItems.href=`food-items.html?child=${childId}`;
    goReports.href=`reports.html?child=${childId}`;
    goVisits.href=`visits.html?child=${childId}`;
    goChildEdit.href = `child-edit.html?child=${encodeURIComponent(childId)}`;


    const today=todayStr();
    const measRef=collection(db,`parents/${user.uid}/children/${childId}/measurements`);
    const snapMeas=await getDocs(query(measRef,where('date','==',today)));
    const mealsRef=collection(db,`parents/${user.uid}/children/${childId}/meals`);
    const snapMeals=await getDocs(query(mealsRef,where('date','==',today)));
    const visitsRef=collection(db,`parents/${user.uid}/children/${childId}/visits`);
    const snapVisit=await getDocs(query(visitsRef,where('followUpDate','>=',today),orderBy('followUpDate','asc'),limit(1)));

    todayMeasuresEl.textContent=miniMeasuresEl.textContent=snapMeas.size||0;
    todayMealsEl.textContent=miniMealsEl.textContent=snapMeals.size||0;
    nextVisitEl.textContent=miniFollowUpEl.textContent=!snapVisit.empty?snapVisit.docs[0].data().followUpDate:'—';

    infoNameEl.textContent=c.name||'طفل';
    infoAgeEl.textContent=`${calcAge(c.birthDate)} سنة`;
    infoGenderEl.textContent=c.gender||'—';
    infoWeightEl.textContent=c.weightKg?`${c.weightKg} كجم`:'—';
    infoHeightEl.textContent=c.heightCm?`${c.heightCm} سم`:'—';
    infoDeviceEl.textContent=c.deviceName||c.device?.name||'—';

    const basal=c.insulin?.basalType||c.insulinBasalType||null;
    const bolus=c.insulin?.bolusType||c.insulinBolusType||null;
    const insulinType=c.insulinType||null;
    infoInsulinEl.textContent=basal||bolus?(basal?`قاعدي: ${basal}`:'')+(basal&&bolus?' • ':'')+(bolus?`للوجبات: ${bolus}`:''):(insulinType||'—');

    infoRangeEl.textContent=`${min}–${max} mmol/L`;
    infoCREl.textContent=`${cr} g/U`;
    infoCFEl.textContent=cf!=null?`${cf} mmol/L/U`:'—';

  }catch(e){console.error(e);alert('تعذر تحميل البيانات');}
  finally{loader(false);}
});
