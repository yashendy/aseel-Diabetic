// js/child.js
// -----------------------------------------------------------
// - نقرأ childId من رابط الصفحة أو من localStorage كـ fallback
// - لو مش موجود نحول تلقائيًا إلى parent.html?pickChild=1
// - نحفظ آخر طفل تم فتحه في localStorage
// - نملأ معلومات الهيدر والكروت + نفعِّل الروابط للصفحات الأخرى
// -----------------------------------------------------------

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ---- childId مع fallback ----
const params   = new URLSearchParams(location.search);
let   childId  = params.get('child') || localStorage.getItem('lastChildId');
if (!childId) {
  // لا يوجد طفل محدد: ارجعي لاختيار طفل
  location.replace('parent.html?pickChild=1');
  throw new Error('Missing child id → redirecting to parent.html');
}
// خزِّني آخر طفل كـ fallback لاحقًا
localStorage.setItem('lastChildId', childId);

// ---- عناصر DOM (مع حراسة) ----
const $ = (id) => document.getElementById(id);

const loaderEl      = $('loader');

const childNameEl   = $('childName');
const childMetaEl   = $('childMeta');
const chipRangeEl   = $('chipRange');
const chipCREl      = $('chipCR');
const chipCFEl      = $('chipCF');

const todayMeasuresEl = $('todayMeasures');
const todayMealsEl    = $('todayMeals');
const nextVisitEl     = $('nextVisit');

const miniMeasuresEl  = $('miniMeasures');
const miniMealsEl     = $('miniMeals');
const miniFollowUpEl  = $('miniFollowUp');

const goMeasurements  = $('goMeasurements');
const goMeals         = $('goMeals');
const goFoodItems     = $('goFoodItems');
const goReports       = $('goReports');
const goVisits        = $('goVisits');
const goChildEdit     = $('goChildEdit');

const infoNameEl    = $('infoName');
const infoAgeEl     = $('infoAge');
const infoGenderEl  = $('infoGender');
const infoWeightEl  = $('infoWeight');
const infoHeightEl  = $('infoHeight');
const infoDeviceEl  = $('infoDevice');
const infoInsulinEl = $('infoInsulin');
const infoRangeEl   = $('infoRange');
const infoCREl      = $('infoCR');
const infoCFEl      = $('infoCF');

// ---- أدوات ----
function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){
  const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function calcAge(bd){
  if(!bd) return '-';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}
function loader(show){ loaderEl && loaderEl.classList.toggle('hidden', !show); }

// ---- تشغيل ----
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }

  try{
    loader(true);

    // قراءة بيانات الطفل
    const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(childRef);
    if(!snap.exists()){
      alert('لم يتم العثور على الطفل');
      // امسح lastChildId لأنه غير صالح ثم رجِّع لاختيار طفل
      localStorage.removeItem('lastChildId');
      location.replace('parent.html?pickChild=1');
      return;
    }
    const c = snap.data();
    // تأكيد حفظ آخر طفل صالح
    localStorage.setItem('lastChildId', childId);

    // ---- الهيدر والشرائط ----
    if (childNameEl) childNameEl.textContent = c.name || 'طفل';
    if (childMetaEl) childMetaEl.textContent = `${c.gender || '-'} • العمر: ${calcAge(c.birthDate)} سنة`;

    const min = Number(c.normalRange?.min ?? 4.4);
    const max = Number(c.normalRange?.max ?? 7.8);
    const cr  = Number(c.carbRatio ?? 12);
    const cf  = (c.correctionFactor != null) ? Number(c.correctionFactor) : null;

    if (chipRangeEl) chipRangeEl.textContent = `النطاق الطبيعي: ${min}–${max} mmol/L`;
    if (chipCREl)    chipCREl.textContent    = `CarbRatio: ${cr} g/U`;
    if (chipCFEl)    chipCFEl.textContent    = `CF: ${cf ?? '—'} mmol/L per U`;

    // ---- الروابط للصفحات الأخرى (نضمن childId) ----
    setHref(goMeasurements, `measurements.html?child=${encodeURIComponent(childId)}`);
    setHref(goMeals,        `meals.html?child=${encodeURIComponent(childId)}`);
    setHref(goFoodItems,    `food-items.html?child=${encodeURIComponent(childId)}`);
    setHref(goReports,      `reports.html?child=${encodeURIComponent(childId)}`);
    setHref(goVisits,       `visits.html?child=${encodeURIComponent(childId)}`);
    setHref(goChildEdit,    `child-edit.html?child=${encodeURIComponent(childId)}`);

    // ---- إحصائيات اليوم ----
    const today = todayStr();

    // قياسات اليوم
    const measRef   = collection(db, `parents/${user.uid}/children/${childId}/measurements`);
    const snapMeas  = await getDocs(query(measRef, where('date','==',today)));
    const measCount = snapMeas.size || 0;

    // وجبات اليوم
    const mealsRef   = collection(db, `parents/${user.uid}/children/${childId}/meals`);
    const snapMeals  = await getDocs(query(mealsRef, where('date','==',today)));
    const mealsCount = snapMeals.size || 0;

    // أقرب متابعة
    const visitsRef  = collection(db, `parents/${user.uid}/children/${childId}/visits`);
    const qVisits    = query(
      visitsRef,
      where('followUpDate','>=', today),
      orderBy('followUpDate','asc'),
      limit(1)
    );
    const snapVisit  = await getDocs(qVisits);
    const nextFollow = !snapVisit.empty ? (snapVisit.docs[0].data().followUpDate || '—') : '—';

    // عرض الأرقام في الكروت (كبير + مصغّر)
    setText(todayMeasuresEl, measCount);
    setText(miniMeasuresEl,  measCount);

    setText(todayMealsEl,    mealsCount);
    setText(miniMealsEl,     mealsCount);

    setText(nextVisitEl,     nextFollow);
    setText(miniFollowUpEl,  nextFollow);

    // ---- بطاقة "بيانات الطفل" ----
    setText(infoNameEl,   c.name || 'طفل');
    setText(infoAgeEl,    `${calcAge(c.birthDate)} سنة`);
    setText(infoGenderEl, c.gender || '—');
    setText(infoWeightEl, c.weightKg ? `${c.weightKg} كجم` : '—');
    setText(infoHeightEl, c.heightCm ? `${c.heightCm} سم` : '—');

    // الجهاز
    const deviceName = c.deviceName || c.device?.name || '—';
    setText(infoDeviceEl, deviceName);

    // الأنسولين
    const basal = c.insulin?.basalType || c.insulinBasalType || null;
    const bolus = c.insulin?.bolusType || c.insulinBolusType || null;
    const insulinType = c.insulinType || null;

    if (basal || bolus) {
      const text = (basal ? `قاعدي: ${basal}` : '') +
                   (basal && bolus ? ' • ' : '') +
                   (bolus ? `للوجبات: ${bolus}` : '');
      setText(infoInsulinEl, text);
    } else {
      setText(infoInsulinEl, insulinType || '—');
    }

    // الحدود والمعاملات
    setText(infoRangeEl, `${min}–${max} mmol/L`);
    setText(infoCREl,    `${cr} g/U`);
    setText(infoCFEl,    (cf != null) ? `${cf} mmol/L/U` : '—');

  }catch(e){
    console.error(e);
    alert('تعذر تحميل البيانات');
  }finally{
    loader(false);
  }
});

// ---- مساعدين صغارين ----
function setHref(el, href){
  if (!el) return;
  el.setAttribute('href', href);
  // احتياط: لو المتصفح منع تنقل رابط فارغ لأي سبب
  el.addEventListener('click', (ev)=>{
    if (!href) { ev.preventDefault(); }
  });
}
function setText(el, value){
  if (el) el.textContent = (value ?? '—');
}
