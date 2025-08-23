// js/analytics.js
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

/* جلسة */
onAuthStateChanged(auth, async user=>{
  if(!user){ location.href='child.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  await loadChild();
  await reloadAll();
});

/* تحميل بيانات الطفل */
async function loadChild(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap= await getDoc(ref);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  const min = childData?.normalRange?.min ?? 4.5;
  const max = childData?.normalRange?.max ?? 11;
  const cr  = childData?.carbRatio ?? '—';
  const cf  = childData?.correctionFactor ?? '—';
  childMetaEl.innerHTML = `النطاق: ${min}–${max} mmol/L • CR: ${cr} g/U • CF: ${cf} mmol/L/U`;
}

/* حساب المدى من الاختيار */
function computeRange(key){
  const now = new Date();
  let from, to;
  switch(key){
    case '7d':   to=now; from=addDays(to,-6); break;
    case '14d':  to=now; from=addDays(to,-13); break;
    case '30d':  to=now; from=addDays(to,-29); break;
    case '90d':  to=now; from=addDays(to,-89); break;
    case '2w':   to=now; from=addDays(to,-13); break;
    case '2m':   to=now; from=new Date(now.getFullYear(), now.getMonth()-1, 1); to=endOfMonth(now); break;
    case 'this_w': from=startOfWeek(now); to=endOfWeek(now); break;
    case 'prev_w': { const e=endOfWeek(addDays(now,-7)); to=e; from=addDays(e,-6); } break;
    case 'this_m': from=startOfMonth(now); to=endOfMonth(now); break;
    case 'prev_m': { const d=new Date(now.getFullYear(), now.getMonth()-1, 15); from=startOfMonth(d); to=endOfMonth(d); } break;
    default:      to=now; from=addDays(to,-13);
  }
  from.setHours(0,0,0,0);
  to.setHours(23,59,59,999);
  return {from, to};
}

/* تحميل القياسات لفترة معينة */
async function fetchMeasurements(from, to){
  const ref  = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy   = query(ref, where('when','>=', from), where('when','<=', to), orderBy('when','asc'));
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach(d=>{
    const m = d.data();
    const ts = m.when?.toDate ? m.when.toDate() : new Date(`${m.date}T00:00:00`);
    const mmol = m.value_mmol ?? (m.value_mgdl ? (m.value_mgdl/18) : (m.value? m.value/18 : null));
    if (mmol!=null) {
      rows.push({
        when: ts,
        date: m.date || fmtDate(ts),
        mmol: Number(mmol),
        state: m.state || null,
        slotKey: m.slotKey || null
      });
    }
  });
  return rows;
}

/* إعادة تحميل الفترة الحالية + السابقة لو مطلوبة */
async function reloadAll(){
  let from = new Date(`${fromEl.value}T00:00:00`);
  let to   = new Date(`${toEl.value}T23:59:59.999`);
  allMeas  = await fetchMeasurements(from, to);

  if (compareChk.checked){
    // فترة سابقة مساوية الطول
    const days = Math.max(1, Math.ceil((to-from)/86400000)+1);
    const prevTo   = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days-1));
    prevMeas = await fetchMeasurements(prevFrom, prevTo);
  } else {
    prevMeas = [];
  }

  renderKPIsAndCharts();
}

/* KPIs لمصفوفة */
function computeKPIs(meas){
  const min = childData?.normalRange?.min ?? 4.5;
  const max = childData?.normalRange?.max ?? 11;
  const vals = meas.map(m=> m.mmol);
  const count = vals.length;
  const mean  = count? (vals.reduce((a,b)=>a+b,0)/count) : 0;
  const sd    = count? Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/count) : 0;
  const inRange = count? vals.filter(v=> v>=min && v<=max).length / count * 100 : 0;
  const highs   = count? vals.filter(v=> v>max).length / count * 100 : 0;
  const lows    = count? vals.filter(v=> v<min).length /  count * 100 : 0;
  return {count, mean, sd, inRange, highs, lows, min, max};
}

/* خيارات Legend تعرض النِّسَب */
function legendWithPercents(){
  return {
    position: 'bottom',
    labels: {
      generateLabels(chart){
        // استخدم التوليد الافتراضي ثم عدّل النص
        const def = Chart.defaults.plugins.legend.labels.generateLabels(chart);
        const ds  = chart.data.datasets[0];
        const data = (ds?.data || []).map(Number);
        // البيانات بالفعل نسب مئوية، لكن نضمن التقريب
        return def.map((item, i)=>({
          ...item,
          text: `${chart.data.labels[i]} — ${Math.round(data[i] ?? 0)}%`
        }));
      }
    }
  };
}

/* رسم + ملخص */
function renderKPIsAndCharts(){
  const unit = unitSel.value;

  // KPIs الحالية
  const K = computeKPIs(allMeas);
  // KPIs السابقة
  const P = prevMeas.length ? computeKPIs(prevMeas) : null;

  // تعبئة القيم
  kpiCount.textContent = String(K.count);
  kpiAvg.textContent   = unit==='mgdl' ? (K.mean*18).toFixed(1) : K.mean.toFixed(1);
  kpiStd.textContent   = unit==='mgdl' ? (K.sd*18).toFixed(1) : K.sd.toFixed(1);
  kpiTir.textContent   = `${Math.round(K.inRange)}%`;
  kpiHigh.textContent  = `${Math.round(K.highs)}%`;
  kpiLow.textContent   = `${Math.round(K.lows)}%`;

  // دلتا مقارنة
  setDelta(kpiCountDelta, P ? (K.count - P.count) : null, 'قراءة');
  setDelta(kpiAvgDelta,   P ? ((unit==='mgdl'?K.mean*18:K.mean) - (unit==='mgdl'?P.mean*18:P.mean)) : null, unit==='mgdl'?'mg/dL':'mmol/L', true);
  setDelta(kpiStdDelta,   P ? ((unit==='mgdl'?K.sd*18:K.sd) - (unit==='mgdl'?P.sd*18:P.sd)) : null, unit==='mgdl'?'mg/dL':'mmol/L', true);
  setDelta(kpiTirDelta,   P ? (K.inRange - P.inRange) : null, '%', true);
  setDelta(kpiHighDelta,  P ? (K.highs   - P.highs)   : null, '%', true, false);
  setDelta(kpiLowDelta,   P ? (K.lows    - P.lows)    : null, '%', true, false);

  // نقاط الرسم الخطي
  const pointsNow = allMeas.map(m=> ({ x: m.when, y: toUnit(m.mmol, unit), slotKey: m.slotKey })).sort((a,b)=> a.x-b.x);
  const pointsPrev= prevMeas.map(m=> ({ x: m.when, y: toUnit(m.mmol, unit), slotKey: m.slotKey })).sort((a,b)=> a.x-b.x);

  emptyMsg.classList.toggle('hidden', pointsNow.length>0);

  if (chart){ chart.destroy(); chart=null; }
  if (pieNow){ pieNow.destroy(); pieNow=null; }
  if (piePrev){ piePrev.destroy(); piePrev=null; }

  // Line Chart (مع مقارنة اختيارية)
  const ctx = document.getElementById('dayChart').getContext('2d');
  const datasets = [{
    label: unit==='mgdl' ? 'الجلوكوز (الحالي) mg/dL' : 'الجلوكوز (الحالي) mmol/L',
    data: pointsNow,
    borderColor: '#4F46E5',
    backgroundColor: 'rgba(79,70,229,0.08)',
    pointRadius: 2,
    tension: .25,
    fill: false,
    spanGaps: true
  }];
  if (pointsPrev.length){
    datasets.push({
      label: unit==='mgdl' ? 'الفترة السابقة mg/dL' : 'الفترة السابقة mmol/L',
      data: pointsPrev,
      borderColor: '#0ea5e9',
      borderDash: [6,4],
      pointRadius: 0,
      tension: .25,
      fill: false,
      spanGaps: true
    });
  }
  chart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      interaction:{ mode:'nearest', intersect:false },
      plugins:{
        legend:{ position:'bottom' },
        tooltip:{ callbacks:{
          label:(c)=>{
            const v = c.parsed.y;
            const d = new Date(c.parsed.x);
            const slotKey = c.raw?.slotKey;
            const slotAr  = slotKey ? (SLOT_AR[slotKey] || slotKey) : '';
            const timeStr = d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
            const dateStr = d.toLocaleDateString();
            const value   = unit==='mgdl' ? `${Math.round(v)}` : `${Number(v).toFixed(1)}`;
            return `${c.dataset.label}: ${value} @ ${dateStr} ${timeStr}${slotAr?` — ${slotAr}`:''}`;
          }
        }}
      },
      scales:{
        x:{ type:'time', time:{ unit:'day', tooltipFormat:'yyyy-MM-dd HH:mm' }, title:{ display:true, text:'التاريخ' }},
        y:{ title:{ display:true, text: unit==='mgdl' ? 'mg/dL' : 'mmol/L' }, suggestedMin: unit==='mgdl' ? 60 : 3, suggestedMax: unit==='mgdl' ? 250 : 15 }
      }
    }
  });

  // Doughnut الحالي (Legend بالنِّسَب)
  const pNow = document.getElementById('pieNow').getContext('2d');
  pieNow = new Chart(pNow, {
    type: 'doughnut',
    data: {
      labels: ['داخل النطاق', 'ارتفاعات', 'هبوطات'],
      datasets: [{
        data: [K.inRange.toFixed(1), K.highs.toFixed(1), K.lows.toFixed(1)],
        backgroundColor: ['rgba(34,197,94,0.25)','rgba(239,68,68,0.25)','rgba(59,130,246,0.25)'],
        borderColor: ['#22c55e','#ef4444','#3b82f6']
      }]
    },
    options:{ plugins:{ legend: legendWithPercents() }, cutout: '65%' }
  });

  // Doughnut السابق (إن وُجدت مقارنة) بنفس أسلوب النِّسَب
  if (P){
    piePrevBox.classList.remove('hidden');
    const pPrev = document.getElementById('piePrev').getContext('2d');
    piePrev = new Chart(pPrev, {
      type: 'doughnut',
      data: {
        labels: ['داخل النطاق', 'ارتفاعات', 'هبوطات'],
        datasets: [{
          data: [P.inRange.toFixed(1), P.highs.toFixed(1), P.lows.toFixed(1)],
          backgroundColor: ['rgba(34,197,94,0.18)','rgba(239,68,68,0.18)','rgba(59,130,246,0.18)'],
          borderColor: ['#16a34a','#dc2626','#2563eb']
        }]
      },
      options:{ plugins:{ legend: legendWithPercents() }, cutout: '65%' }
    });
  } else {
    piePrevBox.classList.add('hidden');
  }

  renderAISummary({unit, K, pointsNow});
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
