// js/analytics.js — صفحة التحليلات (منحنى + توزيعات + KPIs)
// يعتمد حساب الارتفاع/الهبوط على severeHigh / severeLow، بينما TIR على min/max.

// ======= Firebase =======
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// ======= عناصر الواجهة =======
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const goBackBtn   = document.getElementById('goBack');
const printBtn    = document.getElementById('printBtn');
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');

const rangeSel = document.getElementById('rangeSel');
const fromEl   = document.getElementById('fromDate');
const toEl     = document.getElementById('toDate');

const unitSel   = document.getElementById('unitSel');   // mmol | mgdl (لعرض الواجهة فقط)
const compareChk= document.getElementById('compareChk');
const applyBtn  = document.getElementById('applyBtn');

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

// 👇 غير المعرفات هنا لو مختلفة في HTML
const lineCtx   = document.getElementById('glucoseLine')?.getContext('2d');
const pieNowCtx = document.getElementById('pieNow')?.getContext('2d');
const piePrevCtx= document.getElementById('piePrev')?.getContext('2d');

// ======= متغيرات عامة =======
let currentUser, childData;
let allMeas = [];   // الفترة الحالية (mmol + Date)
let prevMeas = [];  // فترة المقارنة (mmol + Date)

let chartLine = null;
let pieNow = null;
let piePrev = null;

// ======= أدوات مساعدة للتاريخ =======
const MS_DAY = 24*60*60*1000;
const addDays = (d, n)=> new Date(d.getTime() + n*MS_DAY);
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
const endOfDay   = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
const startOfWeek= d => {
  const day = (d.getDay()+6)%7; // اجعل الاثنين 0
  const s = addDays(startOfDay(d), -day);
  return s;
};
const endOfWeek = d => addDays(startOfWeek(d), 6);
const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = d => new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59,999);
const fmtDate = d => d.toISOString().slice(0,10);

// ======= ترجمات (اختياري) =======
const SLOT_AR = {
  PRE_BREAKFAST:'ق.الفطار', POST_BREAKFAST:'ب.الفطار',
  PRE_LUNCH:'ق.الغدا', POST_LUNCH:'ب.الغدا',
  PRE_DINNER:'ق.العشا', POST_DINNER:'ب.العشا',
  BEDTIME:'ق.النوم', OVERNIGHT:'أثناء النوم', FASTING:'الاستيقاظ', RANDOM:'عشوائي'
};

// ======= نطاقات الطفل (min/max/severe) =======
function getRanges() {
  const r = childData?.normalRange || {};
  // min/max للنطاق الطبيعي
  const min = Number(r.min ?? 4.5);
  const max = Number(r.max ?? 7);
  // severe thresholds للهبوط/الارتفاع
  const severeLow  = Number(r.severeLow  ?? r.severe_low  ?? 3.5);
  const severeHigh = Number(r.severeHigh ?? r.severe_high ?? 12);
  return { min, max, severeLow, severeHigh };
}

// ======= تحميل الفترة المختارة =======
function computeRange(kind){
  const today = new Date();
  if(kind==='7d'){ const to=today; const from=addDays(to,-6); return {from, to}; }
  if(kind==='14d'){ const to=today; const from=addDays(to,-13); return {from, to}; }
  if(kind==='w'){ const from=startOfWeek(today), to=endOfWeek(today); return {from, to}; }
  if(kind==='m'){ const from=startOfMonth(today), to=endOfMonth(today); return {from, to}; }
  return {from: addDays(today,-13), to: today};
}

rangeSel.addEventListener('change', ()=>{
  if(rangeSel.value!=='custom'){
    const {from,to} = computeRange(rangeSel.value);
    fromEl.value = fmtDate(from);
    toEl.value   = fmtDate(to);
  }
  document.querySelectorAll('.custom-range')
    .forEach(el=> el.classList.toggle('hidden', rangeSel.value!=='custom'));
});

// ======= أحداث عامة =======
goBackBtn?.addEventListener('click', ()=> history.back());
printBtn?.addEventListener('click', ()=> window.print());
applyBtn?.addEventListener('click', reloadAll);
unitSel?.addEventListener('change', renderKPIsAndCharts);
compareChk?.addEventListener('change', reloadAll);

// ======= حسابات أساسية =======
function toMmol(value, unit){
  if(value==null || Number.isNaN(value)) return null;
  if(unit==='mgdl' || unit==='mg/dL') return Number(value)/18;
  return Number(value);
}
function toUnit(vMmol, outUnit){ // للعرض فقط
  return outUnit==='mgdl' ? vMmol*18 : vMmol;
}

function normalizeDoc(d){
  // متوقع وجود واحد من: when(Timestamp) أو date(yyyy-mm-dd)
  const rawWhen = d.when ? d.when.toDate?.() || new Date(d.when) : null;
  const date = rawWhen ? rawWhen : (d.date ? new Date(d.date) : null);
  let val = d.mmol ?? d.value ?? d.glucose ?? null;
  let unit = d.unit ?? (d.mgdl ? 'mgdl' : 'mmol');
  if(val==null && typeof d.mgdl==='number'){ val = d.mgdl; unit='mgdl'; }
  const mmol = toMmol(val, unit);
  if(!date || mmol==null || Number.isNaN(mmol)) return null;
  return { date, mmol, slot: d.slot || d.period || d.tag || '' };
}

function sortAsc(a,b){ return a.date - b.date; }

function computeKPIs(points){
  const {min,max,severeLow,severeHigh} = getRanges();
  if(!points.length){
    return {count:0, mean:0, sd:0, inRange:0, highs:0, lows:0};
  }
  // إحصاءات
  const arr = points.map(p=>p.mmol);
  const count = arr.length;
  const mean = arr.reduce((s,x)=>s+x,0)/count;
  const sd = Math.sqrt(arr.reduce((s,x)=> s + Math.pow(x-mean,2),0) / count);

  // TIR على min..max
  const inRangeCount = points.filter(p=> p.mmol>=min && p.mmol<=max).length;
  // highs/lows على severe
  const highsCount = points.filter(p=> p.mmol>severeHigh).length;
  const lowsCount  = points.filter(p=> p.mmol<severeLow).length;

  return {
    count,
    mean,
    sd,
    inRange: (inRangeCount/count)*100,
    highs:   (highsCount/count)*100,
    lows:    (lowsCount/count)*100
  };
}

function setDelta(el, diff, unit='', signed=false, higherIsGood=true){
  if(!el) return;
  if(diff==null || Number.isNaN(diff)){ el.textContent=''; el.className='delta neutral'; return; }
  const sign = diff>0 ? '+' : (diff<0 ? '−' : '±');
  const abs  = Math.abs(diff);
  const txt  = signed ? `${sign}${abs.toFixed( (unit==='%')?0:1 )} ${unit}` : `${abs.toFixed(0)} ${unit}`;
  let cls = 'neutral';
  if(diff!==0){
    const good = higherIsGood ? diff<0 : diff>0; // لو "الأقل أفضل" نعكس
    cls = good ? 'good' : 'bad';
  }
  el.textContent = txt;
  el.className = `delta ${cls}`;
}

// ======= رسم الرسوم =======
function destroyCharts(){
  if(chartLine){ chartLine.destroy(); chartLine = null; }
  if(pieNow){ pieNow.destroy(); pieNow = null; }
  if(piePrev){ piePrev.destroy(); piePrev = null; }
}

function renderLine(pointsNow, pointsPrev){
  if(!lineCtx) return;
  const unit = unitSel?.value || 'mmol';
  const dsNow = pointsNow.map(p=> ({x:p.date, y: toUnit(p.mmol, unit)}));
  const dsPrev= pointsPrev.map(p=> ({x:p.date, y: toUnit(p.mmol, unit)}));

  const minX = pointsNow.length ? pointsNow[0].date : null;
  const maxX = pointsNow.length ? pointsNow[pointsNow.length-1].date : null;

  chartLine = new Chart(lineCtx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'الحالي',
          data: dsNow,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0
        },
        ...(pointsPrev.length ? [{
          label: 'السابق',
          data: dsPrev,
          tension: 0.3,
          borderWidth: 2,
          borderDash: [6,4],
          pointRadius: 0
        }] : [])
      ]
    },
    options: {
      responsive: true,
      parsing: false,
      scales: {
        x: {
          type: 'time',
          time: { unit: 'day' },
          min: minX || undefined,
          max: maxX || undefined
        },
        y: {
          title: { display: true, text: unit==='mgdl'?'mg/dL':'mmol/L' }
        }
      },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => {
              const y = ctx.parsed.y;
              const d = new Date(ctx.parsed.x);
              return `${d.toLocaleString()} — ${y.toFixed(1)} ${unit==='mgdl'?'mg/dL':'mmol/L'}`;
            }
          }
        }
      }
    }
  });
}

function renderPies(pointsNow, pointsPrev){
  const {min,max,severeLow,severeHigh} = getRanges();
  const mkCounts = (pts)=>{
    const n = pts.length || 1;
    const inR = pts.filter(p=>p.mmol>=min && p.mmol<=max).length;
    const hi  = pts.filter(p=>p.mmol>severeHigh).length;
    const lo  = pts.filter(p=>p.mmol<severeLow).length;
    return [inR/n*100, hi/n*100, lo/n*100];
  };
  const nowP = mkCounts(pointsNow);
  if(pieNowCtx){
    pieNow = new Chart(pieNowCtx, {
      type:'doughnut',
      data:{ labels:['داخل النطاق','ارتفاعات','هبوطات'], datasets:[{ data: nowP }] },
      options:{ cutout:'60%', plugins:{ legend:{ position:'bottom' } } }
    });
  }

  const hasPrev = pointsPrev.length>0;
  if(piePrevBox) piePrevBox.classList.toggle('hidden', !hasPrev);

  if(hasPrev && piePrevCtx){
    const prevP = mkCounts(pointsPrev);
    piePrev = new Chart(piePrevCtx, {
      type:'doughnut',
      data:{ labels:['داخل النطاق','ارتفاعات','هبوطات'], datasets:[{ data: prevP }] },
      options:{ cutout:'60%', plugins:{ legend:{ position:'bottom' } } }
    });
  }
}

// ======= تلخيص ذكي بسيط (اختياري) =======
function renderAISummary(points){
  if(!aiBox) return;
  const unit = unitSel?.value || 'mmol';
  const K = computeKPIs(points);
  const avgOut = toUnit(K.mean, unit).toFixed(1);
  const sdOut  = toUnit(K.sd, unit).toFixed(1);
  const cv = K.mean ? (K.sd/K.mean*100) : 0;
  const trendTxt = (()=>{
    if(points.length<2) return 'غير واضح';
    const first = points[0].mmol, last = points[points.length-1].mmol;
    return last>first ? 'اتجاه صاعد' : (last<first ? 'اتجاه هابط' : 'ثابت');
  })();

  aiBox.innerHTML = `
    <div>تم تحليل <strong>${points.length}</strong> قراءة في الفترة المختارة.</div>
    <div>المتوسط <strong>${avgOut} ${unit==='mgdl'?'mg/dL':'mmol/L'}</strong> — SD <strong>${sdOut}</strong> — CV% <strong>${cv.toFixed(0)}%</strong>.</div>
    <div>داخل النطاق <strong>${Math.round(K.inRange)}%</strong> • ارتفاعات <strong>${Math.round(K.highs)}%</strong> • هبوطات <strong>${Math.round(K.lows)}%</strong>.</div>
    <div>الاتجاه العام: <strong>${trendTxt}</strong>.</div>
  `;
}

// ======= تحميل الداتا من Firestore =======
async function loadMeasurements(uid, childId, from, to){
  const col = collection(db, `parents/${uid}/children/${childId}/measurements`);
  // نجلب نطاق واسع ونرشّح محلياً لمرونة اختلاف الحقل
  const q1 = query(col, orderBy('when', 'asc'));
  const q2 = query(col, orderBy('date', 'asc')); // لو بعض السجلات بدون when
  const snaps = await Promise.allSettled([getDocs(q1), getDocs(q2)]);

  const rows = [];
  for (const s of snaps){
    if(s.status==='fulfilled'){
      s.value.forEach(docSnap=>{
        const d = docSnap.data();
        const nd = normalizeDoc(d);
        if(nd) rows.push(nd);
      });
    }
  }
  // ترشيح الفترة المختارة
  const fromS = startOfDay(from).getTime();
  const toE   = endOfDay(to).getTime();
  return rows
    .filter(r=> r.date.getTime()>=fromS && r.date.getTime()<=toE)
    .sort(sortAsc);
}

// ======= إعادة التحميل الشاملة =======
async function reloadAll(){
  destroyCharts();
  emptyMsg?.classList.add('hidden');

  if(!currentUser || !childId){ return; }

  // الفترة الحالية
  const from = new Date(fromEl.value);
  const to   = new Date(toEl.value);
  allMeas = (await loadMeasurements(currentUser.uid, childId, from, to)) || [];

  // الفترة السابقة (بنفس الطول)
  prevMeas = [];
  if(compareChk?.checked){
    const days = Math.max(1, Math.round((endOfDay(to)-startOfDay(from))/MS_DAY)+1);
    const prevTo   = addDays(startOfDay(from), -1);
    const prevFrom = addDays(prevTo, -(days-1));
    prevMeas = (await loadMeasurements(currentUser.uid, childId, prevFrom, prevTo)) || [];
  }

  renderKPIsAndCharts();
}

function renderKPIsAndCharts(){
  const unit = unitSel?.value || 'mmol';

  if(!allMeas.length){
    destroyCharts();
    emptyMsg?.classList.remove('hidden');
    [kpiCount,kpiAvg,kpiStd,kpiTir,kpiHigh,kpiLow].forEach(el=> el && (el.textContent='—'));
    [kpiCountDelta,kpiAvgDelta,kpiStdDelta,kpiTirDelta,kpiHighDelta,kpiLowDelta].forEach(el=> el && (el.textContent=''));
    aiBox && (aiBox.innerHTML = '');
    return;
  }

  // KPIs للآن
  const K = computeKPIs(allMeas);
  kpiCount && (kpiCount.textContent = K.count);
  kpiAvg   && (kpiAvg.textContent   = toUnit(K.mean, unit).toFixed(1));
  kpiStd   && (kpiStd.textContent   = toUnit(K.sd, unit).toFixed(1));
  kpiTir   && (kpiTir.textContent   = Math.round(K.inRange) + '%');
  kpiHigh  && (kpiHigh.textContent  = Math.round(K.highs)   + '%');
  kpiLow   && (kpiLow.textContent   = Math.round(K.lows)    + '%');

  // Delta للمقارنة
  if(prevMeas.length){
    const P = computeKPIs(prevMeas);
    setDelta(kpiCountDelta, K.count - P.count, '', false, false);
    setDelta(kpiAvgDelta,   toUnit(K.mean-P.mean, unit), unit==='mgdl'?'mg/dL':'mmol/L', true, false);
    setDelta(kpiStdDelta,   toUnit(K.sd-P.sd, unit),     unit==='mgdl'?'mg/dL':'mmol/L', true, false);
    setDelta(kpiTirDelta,   K.inRange - P.inRange, '%',  true, true);
    setDelta(kpiHighDelta,  K.highs - P.highs, '%',      true, false);
    setDelta(kpiLowDelta,   K.lows  - P.lows,  '%',      true, false);
  }else{
    [kpiCountDelta,kpiAvgDelta,kpiStdDelta,kpiTirDelta,kpiHighDelta,kpiLowDelta].forEach(el=> el && (el.textContent=''));
  }

  // الرسوم
  destroyCharts();
  renderLine(allMeas, prevMeas);
  renderPies(allMeas, prevMeas);
  renderAISummary(allMeas);
}

// ======= جلسة المستخدم =======
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }
  currentUser = user;

  // بيانات الطفل
  const snap = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
  if(!snap.exists()){ alert('الطفل غير موجود'); history.back(); return; }
  childData = snap.data();

  // رأس الصفحة: الاسم + العمر التقريبي
  const name = childData.name || '—';
  const b = childData.birthDate ? new Date(childData.birthDate) : null;
  const ageYears = b ? Math.max(0, (new Date().getFullYear() - b.getFullYear())) : '';
  childNameEl && (childNameEl.textContent = name);
  childMetaEl && (childMetaEl.textContent = ageYears ? `العمر ~ ${ageYears} سنة` : '');

  // ضبط الفترة الابتدائية
  const {from,to} = computeRange(rangeSel?.value || '14d');
  fromEl && (fromEl.value = fmtDate(from));
  toEl   && (toEl.value   = fmtDate(to));

  // تحميل أولي
  await reloadAll();
});
