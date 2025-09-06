// js/analytics.js — KPIs على hypo/hyper، مع إبقاء عرض النطاق الطبيعي كما هو
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const goBackBtn = document.getElementById('goBack');
const printBtn  = document.getElementById('printBtn');
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');

const rangeSel = document.getElementById('rangeSel');
const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');

const unitSel = document.getElementById('unitSel');
const compareChk = document.getElementById('compareChk');
const applyBtn= document.getElementById('applyBtn');

const kpiCount = document.getElementById('kpiCount');
const kpiAvg   = document.getElementById('kpiAvg');
const kpiStd   = document.getElementById('kpiStd');
const kpiTir   = document.getElementById('kpiTir');
const kpiHigh  = document.getElementById('kpiHigh');
const kpiLow   = document.getElementById('kpiLow');

const kpiCountDelta = document.getElementById('kpiCountDelta');
const kpiAvgDelta   = document.getElementById('kpiAvgDelta');
const kpiStdDelta   = document.getElementById('kpiStdDelta');
const kpiTirDelta   = document.getElementById('kpiTirDelta');
const kpiHighDelta  = document.getElementById('kpiHighDelta');
const kpiLowDelta   = document.getElementById('kpiLowDelta');

const emptyMsg = document.getElementById('emptyMsg');
const aiBox    = document.getElementById('aiBox');

const piePrevBox = document.getElementById('piePrevBox');

let currentUser, childData;
let chart;            // Line chart
let pieNow, piePrev;  // Doughnuts
let allMeas = [];     // الفترة الرئيسية
let prevMeas = [];    // فترة المقارنة

/* ترجمة الفترات */
const SLOT_AR = {
  PRE_BREAKFAST:  'ق. الفطار',
  POST_BREAKFAST: 'ب. الفطار',
  PRE_LUNCH:      'ق. الغدا',
  POST_LUNCH:     'ب. الغدا',
  PRE_DINNER:     'ق. العشا',
  POST_DINNER:    'ب. العشا',
  BEDTIME:        'ق.النوم',
  OVERNIGHT:      'أثناء النوم',
  FASTING:        'الاستيقاظ',
  RANDOM:         'عشوائي'
};

/* أدوات وقت */
const pad = n => String(n).padStart(2,'0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (base, n)=>{ const dd = new Date(base); dd.setDate(dd.getDate()+n); return dd; };
const startOfWeek = d => { const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }; // Monday
const endOfWeek   = d => addDays(startOfWeek(d),6);
const startOfMonth= d => { const x=new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0,0,0,0); return x; };
const endOfMonth  = d => { const x=new Date(d.getFullYear(), d.getMonth()+1, 0); x.setHours(23,59,59,999); return x; };

function toUnit(mmol, unit){ return unit==='mgdl' ? Math.round((mmol||0)*18) : Number(mmol||0); }

/* تهيئة واجهة المدى */
(function initUI(){
  const today = new Date();
  const from  = addDays(today, -13);
  fromEl.value = fmtDate(from);
  toEl.value   = fmtDate(today);
})();
rangeSel.addEventListener('change', ()=>{
  if (rangeSel.value!=='custom'){
    const {from, to} = computeRange(rangeSel.value);
    fromEl.value = fmtDate(from);
    toEl.value   = fmtDate(to);
  }
  document.querySelectorAll('.custom-range').forEach(el=> el.classList.toggle('hidden', rangeSel.value!=='custom'));
});

/* أزرار */
goBackBtn.addEventListener('click', ()=> history.back());
printBtn.addEventListener('click', ()=> window.print());

/* حساب فترة جاهزة */
function computeRange(kind){
  const today=new Date();
  if(kind==='7d'){ const to=today; const from=addDays(to,-6); return {from, to}; }
  if(kind==='14d'){ const to=today; const from=addDays(to,-13); return {from, to}; }
  if(kind==='m'){ const from=startOfMonth(today), to=endOfMonth(today); return {from, to}; }
  if(kind==='w'){ const from=startOfWeek(today), to=endOfWeek(today); return {from, to}; }
  return {from: addDays(today,-13), to: today};
}

/* جلسة */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }
  currentUser = user;

  // رأس الصفحة (اسم/عمر)
  const snap = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
  if(!snap.exists()){ alert('الطفل غير موجود'); history.back(); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  const age = (()=>{ if(!childData.birthDate) return '—'; const b=new Date(childData.birthDate), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return `${a} سنة`})();
  childMetaEl.textContent = `${childData.gender||'—'} • ${age}`;

  await reloadAll();
});

/* تحميل وتهيئة الرسوم/KPIs */
async function reloadAll(){
  const from = new Date(fromEl.value), to=new Date(toEl.value);
  const main = await fetchRange(from, to);
  allMeas = main;

  if (compareChk.checked){
    const prevFrom = addDays(from, -(to-from+1));
    const prevTo   = addDays(to,   -(to-from+1));
    prevMeas = await fetchRange(prevFrom, prevTo);
    piePrevBox.classList.remove('hidden');
  } else {
    prevMeas = [];
    piePrevBox.classList.add('hidden');
  }

  renderKPIsAndCharts();
}

/* قراءة القياسات للفترة */
async function fetchRange(from, to){
  const start = fmtDate(from), end = fmtDate(to);
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, where('date','>=', start), where('date','<=', end), orderBy('date','asc'));
  const snap= await getDocs(qy);
  const arr=[];
  snap.forEach(d=>{
    const r=d.data();
    let mmol=null;
    if(typeof r.value_mmol === 'number') mmol = Number(r.value_mmol);
    else if (typeof r.value_mgdl === 'number') mmol = Number(r.value_mgdl)/18;
    else if (r.unit === 'mmol/L' && typeof r.value === 'number') mmol = Number(r.value);
    else if (r.unit === 'mg/dL' && typeof r.value === 'number') mmol = Number(r.value)/18;
    if(mmol==null || !isFinite(mmol)) return;
    arr.push({date:r.date, mmol});
  });
  return arr;
}

/* KPIs على hypo/hyper */
function computeKPIs(meas){
  const hypo  = Number(childData?.hypoLevel  ?? childData?.normalRange?.min ?? 4.5);
  const hyper = Number(childData?.hyperLevel ?? childData?.normalRange?.max ?? 11);

  const vals  = meas.map(m=> m.mmol);
  const count = vals.length;
  const mean  = count? (vals.reduce((a,b)=>a+b,0)/count) : 0;
  const sd    = count? Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/count) : 0;

  const inRange = count? vals.filter(v=> v>=hypo && v<=hyper).length / count * 100 : 0;
  const highs   = count? vals.filter(v=> v> hyper).length / count * 100 : 0;
  const lows    = count? vals.filter(v=> v< hypo ).length /  count * 100 : 0;

  return {count, mean, sd, inRange, highs, lows, min:hypo, max:hyper};
}

/* رسم/تحديث KPIs والرسوم */
function renderKPIsAndCharts(){
  const unit = unitSel.value; // mmol | mgdl
  const K = computeKPIs(allMeas);
  kpiCount.textContent = K.count;
  kpiAvg.textContent   = unit==='mgdl' ? (K.mean*18).toFixed(1) : K.mean.toFixed(1);
  kpiStd.textContent   = unit==='mgdl' ? (K.sd*18).toFixed(1)  : K.sd.toFixed(1);
  kpiTir.textContent   = Math.round(K.inRange) + '%';
  kpiHigh.textContent  = Math.round(K.highs)   + '%';
  kpiLow.textContent   = Math.round(K.lows)    + '%';

  // مقارنة (لو متاحة)
  if (prevMeas.length){
    const P = computeKPIs(prevMeas);
    setDelta(kpiCountDelta, K.count - P.count);
    setDelta(kpiAvgDelta,   K.mean  - P.mean,   unit==='mgdl'?'mg/dL':'mmol/L', true, false);
    setDelta(kpiStdDelta,   K.sd    - P.sd,     unit==='mgdl'?'mg/dL':'mmol/L', true, false);
    setDelta(kpiTirDelta,   K.inRange - P.inRange, '%', true, true);
    setDelta(kpiHighDelta,  K.highs - P.highs, '%', true, false);
    setDelta(kpiLowDelta,   K.lows  - P.lows,  '%', true, false);
  }else{
    [kpiCountDelta,kpiAvgDelta,kpiStdDelta,kpiTirDelta,kpiHighDelta,kpiLowDelta].forEach(el=> el.textContent='');
  }

  renderAISummary({unit, K, pointsNow: allMeas.map(m=> ({x:new Date(m.date), y:m.mmol}))});
}

/* إظهار الدلتا بشكل أنيق */
function setDelta(el, diff, unit='', signed=false, higherIsGood=true){
  if (diff===null || Number.isNaN(diff)){ el.textContent=''; el.className='delta neutral'; return; }
  const sign = diff>0 ? '+' : (diff<0 ? '−' : '±');
  const abs  = Math.abs(diff);
  const val  = (typeof diff==='number' && !Number.isInteger(diff)) ? abs.toFixed(1) : abs;
  el.textContent = `${sign}${val} ${unit}`.trim();
  if (diff===0){ el.className='delta neutral'; return; }
  const good = higherIsGood ? (diff>0) : (diff<0);
  el.className = `delta ${good?'up':'down'}`;
}

/* ملخص ذكي */
function renderAISummary({unit, K, pointsNow}){
  if (!pointsNow.length){ aiBox.textContent = 'لا توجد بيانات كافية لعرض الملخص.'; return; }

  const mean = K.mean, sd = K.sd;
  const cv = mean ? (sd/mean*100) : 0;
  const lastN = pointsNow.slice(-7).map(p=> p.y);
  const trend = lastN.length>=2 ? (lastN[lastN.length-1] - lastN[0]) : 0;
  const trendTxt = trend>0 ? 'اتجاه صعود بسيط' : (trend<0 ? 'اتجاه هبوط بسيط' : 'مستقر تقريبًا');

  const unitLabel = unit==='mgdl' ? 'mg/dL' : 'mmol/L';
  const avgOut = unit==='mgdl' ? (mean*18).toFixed(1) : mean.toFixed(1);
  const sdOut  = unit==='mgdl' ? (sd*18).toFixed(1)  : sd.toFixed(1);

  aiBox.innerHTML = `
    <div>تم تحليل <strong>${pointsNow.length}</strong> قراءة في الفترة المختارة.</div>
    <div>المتوسط <strong>${avgOut} ${unitLabel}</strong> — SD <strong>${sdOut}</strong> — CV% <strong>${cv.toFixed(0)}%</strong>.</div>
    <div>داخل النطاق <strong>${Math.round(K.inRange)}%</strong> • ارتفاعات <strong>${Math.round(K.highs)}%</strong> • هبوطات <strong>${Math.round(K.lows)}%</strong>.</div>
    <div>الاتجاه العام: <strong>${trendTxt}</strong>.</div>
  `;
}

/* أحداث */
applyBtn.addEventListener('click', reloadAll);
unitSel.addEventListener('change', renderKPIsAndCharts);
compareChk.addEventListener('change', reloadAll);
