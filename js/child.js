// js/child.js
// -----------------------------------------------------------
// - تحديث لحل مشكلة التاريخ (استخدام when بدلاً من date)
// - تفعيل onSnapshot للتحديث اللحظي لعدادات اليوم
// - ملء بيانات الطفل مع دعم التوافقية (Legacy Data)
// -----------------------------------------------------------

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ---- childId مع fallback ----
const params   = new URLSearchParams(location.search);
let   childId  = params.get('child') || localStorage.getItem('lastChildId');
if (!childId) {
  location.replace('parent.html');
  throw new Error('Missing child id → redirecting');
}
localStorage.setItem('lastChildId', childId);

// ---- عناصر DOM ----
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

// عناصر ملخص بيانات الطفل
const infoName    = $('infoName'), infoAge     = $('infoAge'), infoGender  = $('infoGender');
const infoWeight  = $('infoWeight'), infoHeight  = $('infoHeight'), infoDevice  = $('infoDevice');
const infoInsulin = $('infoInsulin'), infoRange   = $('infoRange');
const infoCR      = $('infoCR'), infoCF      = $('infoCF');

// بطاقة التحاليل
const labCard       = $('labCard'), labHba1cVal   = $('labHba1cVal'), labHba1cDelta = $('labHba1cDelta');
const labLastSince  = $('labLastSince'), labLastDate   = $('labLastDate'), labDueBadge   = $('labDueBadge');
const openLabsBtn   = $('openLabsBtn'), openLastPdfBtn= $('openLastPdfBtn'), addLabBtn     = $('addLabBtn');
const progressFill  = $('progressFill'), progressLabel = $('progressLabel');

// --- أدوات مساعدة ---
const pad = (n) => String(n).padStart(2,'0');
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
function calcAge(bd){
  if(!bd) return '-';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}
const loader = (show) => { loaderEl && loaderEl.classList.toggle('hidden', !show); };
const setText = (el, v) => { if(el) el.textContent = (v==null || v==='') ? '—' : v; };
const setHref = (el, url) => { if(el) el.href = url; };
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${d.getDate().toString().padStart(2,'0')}`;
const dayDiff = (a,b) => Math.ceil((a-b)/86400000);
function addMonths(date, m=4){ const d = new Date(date); const day = d.getDate(); d.setMonth(d.getMonth()+m); if (d.getDate() < day) d.setDate(0); return d; }

// --- تشغيل النظام ---
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }

  try{
    loader(true);

    // 1. قراءة بيانات الطفل
    const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(childRef);
    if(!snap.exists()){
      alert('لم يتم العثور على الطفل');
      localStorage.removeItem('lastChildId');
      location.replace('parent.html');
      return;
    }
    const c = snap.data();

    // 2. تعبئة واجهة المستخدم الأساسية
    setText(childNameEl, c.name || 'طفل');
    setText(childMetaEl, `${c.gender === 'female' ? 'أنثى' : 'ذكر'} • العمر: ${calcAge(c.birthDate)} سنة`);

    const min = Number(c.normalRange?.min ?? c.hypo ?? 3.9);
    const max = Number(c.normalRange?.max ?? c.hyper ?? 10.0);
    const cr  = Number(c.carbRatio ?? 12);
    const cf  = (c.correctionFactor != null) ? Number(c.correctionFactor) : null;
    const unit = c.glucoseUnit || 'mg/dL';

    setText(chipRangeEl, `النطاق الطبيعي: ${min}–${max} ${unit}`);
    setText(chipCREl,    `CarbRatio: ${cr} g/U`);
    setText(chipCFEl,    `CF: ${cf ?? '—'} ${unit}/U`);

    // ملخص بيانات الطفل
    setText(infoName, c.name); setText(infoAge, calcAge(c.birthDate)); setText(infoGender, c.gender);
    setText(infoWeight, c.weightKg ? `${c.weightKg} كجم` : '—');
    setText(infoHeight, c.heightCm ? `${c.heightCm} سم` : '—');
    setText(infoDevice, c.device?.name || c.deviceName || '—');
    
    let insulinStr = [c.insulin?.bolusType, c.insulin?.basalType].filter(Boolean).join(' • ');
    setText(infoInsulin, insulinStr || '—');
    setText(infoRange, `${min}–${max} ${unit}`); setText(infoCR, `${cr} g/U`); setText(infoCF, cf ? `${cf} ${unit}/U` : '—');

    // 3. تحديث الروابط
    setHref(goMeasurements, `measurements.html?child=${encodeURIComponent(childId)}`);
    setHref(goMeals,        `meals.html?child=${encodeURIComponent(childId)}`);
    setHref(goFoodItems,    `food-items.html?child=${encodeURIComponent(childId)}`);
    setHref(goReports,      `reports.html?child=${encodeURIComponent(childId)}`);
    setHref(goVisits,       `visits.html?child=${encodeURIComponent(childId)}`);
    setHref(goChildEdit,    `child-edit.html?parentId=${encodeURIComponent(user.uid)}&id=${encodeURIComponent(childId)}`);

    // 4. الإحصائيات الحية (Live Stats)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    // قياسات اليوم - باستخدام onSnapshot للتحديث التلقائي و حقل when للوقت
    const measRef = collection(db, `parents/${user.uid}/children/${childId}/measurements`);
    const qMeas = query(measRef, where('when', '>=', startOfDay), where('when', '<', endOfDay));
    onSnapshot(qMeas, (snap) => {
      setText(todayMeasuresEl, snap.size);
      setText(miniMeasuresEl, snap.size);
    });

    // وجبات اليوم (تأكدي أن الوجبات تستخدم حقل تاريخ date كنص، أو بدليه بـ when إذا تم توحيد القاعدة)
    const mealsRef = collection(db, `parents/${user.uid}/children/${childId}/meals`);
    const todayStrFormat = todayStr();
    const qMeals = query(mealsRef, where('date', '==', todayStrFormat));
    onSnapshot(qMeals, (snap) => {
      setText(todayMealsEl, snap.size);
      setText(miniMealsEl, snap.size);
    });

    // أقرب متابعة طبية
    const visitsRef = collection(db, `parents/${user.uid}/children/${childId}/visits`);
    const qVisits = query(visitsRef, where('date', '>=', todayStrFormat), orderBy('date', 'asc'), limit(1));
    const snapVisit = await getDocs(qVisits);
    if (!snapVisit.empty) {
      const nextDate = snapVisit.docs[0].data().date;
      setText(nextVisitEl, nextDate);
      setText(miniFollowUpEl, nextDate);
    }

    // 5. بطاقة التحاليل (Labs)
    await renderLabCard(user.uid);

  }catch(err){
    console.error(err);
    alert('حدث خطأ أثناء تحميل لوحة الطفل.');
  }finally{
    loader(false);
  }
});

// وظائف فتح التحاليل (تم تبسيطها)
$('addLabBtn')?.addEventListener('click', (e)=>{ e.stopPropagation(); location.href = `labs.html?child=${encodeURIComponent(childId)}`; });
$('openLabsBtn')?.addEventListener('click', (e)=>{ e.stopPropagation(); location.href = `labs.html?child=${encodeURIComponent(childId)}`; });

async function renderLabCard(uid){
  if (!labCard) return;
  const labsRef = collection(db, `parents/${uid}/children/${childId}/labs`);
  const sn = await getDocs(query(labsRef, orderBy('when','desc'), limit(4)));
  const labs = sn.docs.map(d=>({ id:d.id, ...d.data() }));

  if (labs.length === 0) return; // تم إخفاء التفاصيل إن كانت فارغة لتنظيف الكود

  const last = labs[0];
  const when = last.when?.toDate ? last.when.toDate() : new Date();
  setText(labLastDate, fmt(when));
  setText(labLastSince, `${dayDiff(new Date(), when)} يوم`);

  const hba = Number(last?.hba1c?.value);
  if (!Number.isNaN(hba)){
    setText(labHba1cVal, `${hba.toFixed(1)}%`);
    labHba1cVal.className = `value tone ${hba > 9 ? 'bad' : hba >= 7.5 ? 'mid' : 'good'}`;
  }

  // حساب موعد التحليل القادم (كل 4 شهور)
  const nextDue = addMonths(when, 4);
  const totalDays = Math.max(1, dayDiff(nextDue, when));
  const passedDays = Math.max(0, Math.min(totalDays, dayDiff(new Date(), when)));
  const pct = Math.round((passedDays / totalDays) * 100);
  
  progressFill.style.width = `${pct}%`;
  setText(progressLabel, `${passedDays} / ${totalDays} يوم`);
}
