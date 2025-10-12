// js/child.js
// -----------------------------------------------------------
// - يملأ بطاقة "بيانات الطفل" بالبيانات (الجهاز/الأنسولين) مع دعم القديم
// - يجعل بطاقة التحاليل الطبية غير قابلة للنقر بالكامل؛ الأزرار فقط تفعل
// - يحافظ على سلوك البطاقات الأخرى كرابط كامل
// -----------------------------------------------------------

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ---- childId مع fallback ----
const params   = new URLSearchParams(location.search);
let   childId  = params.get('child') || localStorage.getItem('lastChildId');
if (!childId) {
  location.replace('parent.html?pickChild=1');
  throw new Error('Missing child id → redirecting to parent.html');
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

// ✅ عناصر ملخص بيانات الطفل داخل البطاقة
const infoName    = $('infoName');
const infoAge     = $('infoAge');
const infoGender  = $('infoGender');
const infoWeight  = $('infoWeight');
const infoHeight  = $('infoHeight');
const infoDevice  = $('infoDevice');
const infoInsulin = $('infoInsulin');
const infoRange   = $('infoRange');
const infoCR      = $('infoCR');
const infoCF      = $('infoCF');

// بطاقة التحاليل
const labCard       = $('labCard');
const labHba1cVal   = $('labHba1cVal');
const labHba1cDelta = $('labHba1cDelta');
const labLastSince  = $('labLastSince');
const labLastDate   = $('labLastDate');
const labDueBadge   = $('labDueBadge');
const openLabsBtn   = $('openLabsBtn');
const openLastPdfBtn= $('openLastPdfBtn');
const addLabBtn     = $('addLabBtn');
const progressFill  = $('progressFill');
const progressLabel = $('progressLabel');

// أدوات
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
function setText(el, v){ if(el) el.textContent = (v==null || v==='') ? '—' : v; }
function setHref(el, url){ if(el) el.href = url; }
function fmt(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${d.getDate().toString().padStart(2,'0')}`; }
function dayDiff(a,b){ return Math.ceil((a-b)/86400000); }
function addMonths(date, m=4){
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth()+m);
  if (d.getDate() < day) d.setDate(0);
  return d;
}
// === Helpers for visits countdown ===
function monthsDaysBetween(from, to){
  let m = (to.getFullYear()-from.getFullYear())*12 + (to.getMonth()-from.getMonth());
  let anchor = addMonths(from, m);
  if (to.getDate() < from.getDate()) { m -= 1; anchor = addMonths(from, m); }
  const d = Math.max(0, dayDiff(to, anchor));
  return { months: Math.max(0, m), days: d };
}
function formatCountdown(baseDate, dueDate){
  const dLeft = dayDiff(dueDate, baseDate);
  if (dLeft < 0) return `متأخر ${Math.abs(dLeft)} يوم`;
  if (dLeft === 0) return "اليوم";
  const md = monthsDaysBetween(baseDate, dueDate);
  const parts = [];
  if (md.months > 0) parts.push(`${md.months} شهر`);
  if (md.days > 0) parts.push(`${md.days} يوم`);
  return `باقي ${parts.join(" و ")}`;
}


// زر خروج (اختياري لو عندك بالهيدر)
document.getElementById('logoutBtn')?.addEventListener('click', ()=> signOut(auth).catch(()=>{}));

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
      localStorage.removeItem('lastChildId');
      location.replace('parent.html?pickChild=1');
      return;
    }
    const c = snap.data();
    localStorage.setItem('lastChildId', childId);

    // الهيدر والشرائط
    setText(childNameEl, c.name || 'طفل');
    setText(childMetaEl, `${c.gender || '-'} • العمر: ${calcAge(c.birthDate)} سنة`);

    const min = Number(c.normalRange?.min ?? 4.4);
    const max = Number(c.normalRange?.max ?? 7.8);
    const cr  = Number(c.carbRatio ?? 12);
    const cf  = (c.correctionFactor != null) ? Number(c.correctionFactor) : null;

    setText(chipRangeEl, `النطاق الطبيعي: ${min}–${max} mmol/L`);
    setText(chipCREl,    `CarbRatio: ${cr} g/U`);
    setText(chipCFEl,    `CF: ${cf ?? '—'} mmol/L per U`);

    // ✅ تعبئة بطاقة "بيانات الطفل" (مع دعم الصيغ القديمة)
    const ageStr    = calcAge(c.birthDate);
    const weightStr = (c.weightKg!=null ? `${c.weightKg} كجم` : (c.weight!=null ? `${c.weight} كجم` : '—'));
    const heightStr = (c.heightCm!=null ? `${c.heightCm} سم` : (c.height!=null ? `${c.height} سم` : '—'));

    const devType  = c.device?.type || null;
    const devName  = c.device?.name || c.deviceName || null;
    const devModel = c.device?.model || null;
    let deviceStr  = devName || devType || '—';
    if (devType && devName) deviceStr = `${devType} — ${devName}`;
    if (devModel) deviceStr += ` (${devModel})`;

    const bolus = c.insulin?.bolusType || c.insulinBolusType || c.insulinType || null;
    const basal = c.insulin?.basalType || c.insulinBasalType || null;
    let insulinStr = '—';
    if (bolus || basal){
      insulinStr = `${bolus ? `Bolus: ${bolus}` : ''}${(bolus && basal) ? ' • ' : ''}${basal ? `Basal: ${basal}` : ''}`;
    }

    setText(infoName,    c.name ?? '—');
    setText(infoAge,     ageStr);
    setText(infoGender,  c.gender ?? '—');
    setText(infoWeight,  weightStr);
    setText(infoHeight,  heightStr);
    setText(infoDevice,  deviceStr);
    setText(infoInsulin, insulinStr);
    setText(infoRange,   `${min}–${max} mmol/L`);
    setText(infoCR,      `${cr} g/U`);
    setText(infoCF,      (cf==null ? '—' : `${cf} mmol/L/U`));

    // الروابط للصفحات الأخرى (نضمن childId)
    setHref(goMeasurements, `measurements.html?child=${encodeURIComponent(childId)}`);
    setHref(goMeals,        `meals.html?child=${encodeURIComponent(childId)}`);
    setHref(goFoodItems,    `food-items.html?child=${encodeURIComponent(childId)}`);
    setHref(goReports,      `reports.html?child=${encodeURIComponent(childId)}`);
    setHref(goVisits,       `visits.html?child=${encodeURIComponent(childId)}`);

    // ✅ تعديل رابط "بيانات الطفل" ليمرر parentId + id + تخزينهما كـ fallback
    localStorage.setItem('selectedParentId', user.uid);
    localStorage.setItem('selectedChildId',  childId);
    setHref(goChildEdit, `child-edit.html?parentId=${encodeURIComponent(user.uid)}&id=${encodeURIComponent(childId)}`);

    // إحصائيات اليوم
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
    let displayFollow = nextFollow || "—";
    if (nextFollow && nextFollow !== "—"){
      const due  = new Date(nextFollow);
      const base = new Date(today);
      displayFollow = `${nextFollow} — ${formatCountdown(base, due)}`;
    }


    // عرض الأرقام في الكروت
    setText(todayMeasuresEl, measCount);
    setText(miniMeasuresEl,  measCount);

    setText(todayMealsEl,    mealsCount);
    setText(miniMealsEl,     mealsCount);

    setText(nextVisitEl, displayFollow);
    setText(miniFollowUpEl, displayFollow);

    // ----- بطاقة التحاليل الطبية -----
    await renderLabCard(user.uid);

    // ✅ الأزرار فقط تفتح الصفحات/التقارير
    addLabBtn?.addEventListener('click', (e)=>{
      e.stopPropagation();
      location.href = `labs.html?child=${encodeURIComponent(childId)}`;
    });
    openLabsBtn?.addEventListener('click', (e)=>{
      e.stopPropagation();
      location.href = `labs.html?child=${encodeURIComponent(childId)}`;
    });
    openLastPdfBtn?.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const lastId = await getLastLabId(user.uid);
      if (lastId){
        window.open(`labs.html?child=${encodeURIComponent(childId)}&lab=${encodeURIComponent(lastId)}`, '_blank');
      } else {
        location.href = `labs.html?child=${encodeURIComponent(childId)}`;
      }
    });

    // ❌ لا نجعل البطاقة كاملة قابلة للنقر — لا Listeners على labCard

  }catch(err){
    console.error(err);
    alert('حدث خطأ غير متوقع');
  }finally{
    loader(false);
  }
});

// ----- وظائف بطاقة التحاليل -----
async function getLastLabId(uid){
  const labsRef = collection(db, `parents/${uid}/children/${childId}/labs`);
  const sn = await getDocs(query(labsRef, orderBy('when','desc'), limit(1)));
  return sn.empty ? null : sn.docs[0].id;
}

async function renderLabCard(uid){
  if (!labCard) return;

  const labsRef = collection(db, `parents/${uid}/children/${childId}/labs`);
  const sn = await getDocs(query(labsRef, orderBy('when','desc'), limit(4)));
  const labs = sn.docs.map(d=>({ id:d.id, ...d.data() }));

  if (labs.length === 0){
    setText(labHba1cVal, '—'); labHba1cVal.className = 'value tone';
    setText(labHba1cDelta, 'لا توجد بيانات');
    setText(labLastSince, '—'); setText(labLastDate, '—');
    setText(labDueBadge, 'لا توجد تقارير بعد'); labDueBadge.className='pill tiny';
    progressFill.style.width='0%'; setText(progressLabel, '—');
    if (window._spark){ window._spark.destroy(); }
    return;
  }

  const last   = labs[0];
  const prev   = labs[1] || null;

  // تواريخ
  const when = last.when?.toDate ? last.when.toDate() : (last.date ? new Date(last.date) : new Date());
  setText(labLastDate, fmt(when));
  setText(labLastSince, `${dayDiff(new Date(), when)} يوم`);

  // HbA1c + تلوين
  const hba = last?.hba1c?.value;
  if (hba==null || Number.isNaN(Number(hba))){
    setText(labHba1cVal, '—'); labHba1cVal.className = 'value tone';
  } else {
    const v = Number(hba);
    setText(labHba1cVal, `${v.toFixed(1)}%`);
    let tone = 'good'; if (v>=7.5 && v<=9) tone='mid'; if (v>9) tone='bad';
    labHba1cVal.className = `value tone ${tone}`;
  }

  // دلتا
  if (prev?.hba1c?.value!=null && hba!=null){
    const pv = Number(prev.hba1c.value);
    if (!Number.isNaN(pv)){
      const diff = Number(hba) - pv;
      const sign = diff>0? '+' : (diff<0? '−' : '±');
      setText(labHba1cDelta, `مقارنة بالسابق: ${sign}${Math.abs(diff).toFixed(1)}%`);
      labHba1cVal.title = `السابق: ${pv.toFixed(1)}% • الفرق: ${sign}${Math.abs(diff).toFixed(1)}%`;
    }
  } else {
    setText(labHba1cDelta, '—');
    labHba1cVal.title = '—';
  }

  // nextDue (كل 4 شهور)
  const nextDue = last.nextDue?.toDate ? last.nextDue.toDate() : addMonths(when, 4);
  const daysToDue = dayDiff(nextDue, new Date());
  if (daysToDue < 0){
    setText(labDueBadge, `متأخر — ${fmt(nextDue)}`); labDueBadge.className='pill tiny bad';
  } else if (daysToDue <= 14){
    setText(labDueBadge, `قرب الموعد — ${fmt(nextDue)}`); labDueBadge.className='pill tiny warn';
  } else {
    setText(labDueBadge, `التحليل القادم: ${fmt(nextDue)}`); labDueBadge.className='pill tiny ok';
  }

  // شريط التقدّم
  const totalDays = Math.max(1, dayDiff(nextDue, when));
  const passedDays = Math.max(0, Math.min(totalDays, dayDiff(new Date(), when)));
  const pct = Math.round((passedDays / totalDays) * 100);
  progressFill.style.width = `${pct}%`;
  setText(progressLabel, `${passedDays} / ${totalDays} يوم (${pct}%)`);

  // Sparkline آخر 4 تقارير (تصاعدي للزمن)
  const sorted = [...labs].reverse();
  const labels = sorted.map(l=>{
    const d = l.when?.toDate ? l.when.toDate() : (l.date ? new Date(l.date) : new Date());
    return fmt(d);
  });
  const data = sorted.map(l=>{
    const v = l?.hba1c?.value;
    return (v==null || Number.isNaN(Number(v))) ? null : Number(v);
  });

  if (window._spark){ window._spark.destroy(); }
  const ctx = document.getElementById('hbaSpark').getContext('2d');
  window._spark = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#8E24AA',
        backgroundColor: 'rgba(142,36,170,0.08)',
        pointRadius: 1.5,
        tension: .25,
        fill: false,
        spanGaps: true
      }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{display:false}, tooltip:{enabled:true} },
      elements:{ point:{ hitRadius:6 } },
      scales:{ x:{ display:false }, y:{ display:false, suggestedMin:5, suggestedMax:12 } }
    }
  });
}
