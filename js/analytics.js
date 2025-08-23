// js/analytics.js
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر */
const params = new URLSearchParams(location.search);
const childId = params.get('child');
const rangeParam = params.get('range'); // مثل 14d  (اختياري)

const goBackBtn = document.getElementById('goBack');
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');

const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const unitSel = document.getElementById('unitSel');
const applyBtn= document.getElementById('applyBtn');
const quicks  = document.querySelectorAll('.quicks .chip');

const kpiCount = document.getElementById('kpiCount');
const kpiAvg   = document.getElementById('kpiAvg');
const kpiStd   = document.getElementById('kpiStd');
const kpiTir   = document.getElementById('kpiTir');
const kpiHigh  = document.getElementById('kpiHigh');
const kpiLow   = document.getElementById('kpiLow');

const emptyMsg = document.getElementById('emptyMsg');
const aiBox    = document.getElementById('aiBox');

let currentUser, childData;
let chart;    // Line chart
let pieChart; // Doughnut chart
let allMeas = []; // القياسات المحملة

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

/* أدوات بسيطة */
const pad = n => String(n).padStart(2,'0');
function fmtDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDays(base, n){ const d = new Date(base); d.setDate(d.getDate()+n); return d; }
function daysAgo(n){ const today=new Date(); return addDays(today, -n); }

function toUnit(mmol, unit){
  if (unit==='mgdl') return Math.round((mmol||0)*18);
  return Number(mmol||0);
}
function fromUnit(val, unit){
  if (unit==='mgdl') return Number(val||0)/18;
  return Number(val||0);
}

/* تهيئة تواريخ افتراضية */
(function initDates(){
  const today = new Date();
  const from  = daysAgo(13);
  fromEl.value = fmtDate(from);
  toEl.value   = fmtDate(today);

  if (rangeParam && /\d+d/i.test(rangeParam)){
    const d = Number(rangeParam.replace(/\D/g,''));
    fromEl.value = fmtDate(daysAgo(d-1));
  }
})();

/* رجوع */
goBackBtn.addEventListener('click', ()=> history.back());

/* جلسة + تحميل بيانات الطفل ثم القياسات */
onAuthStateChanged(auth, async user=>{
  if(!user){ location.href='child.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  await loadChild();
  await loadMeasurements();
  renderKPIsAndCharts();
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
  childMetaEl.innerHTML =
    `النطاق: ${min}–${max} mmol/L • CR: ${cr} g/U • CF: ${cf} mmol/L/U`;
}

/* تحميل القياسات حسب الفترة — باستخدام when (Timestamp) */
async function loadMeasurements(){
  const fromStr = fromEl.value;
  const toStr   = toEl.value;
  const ref  = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);

  // نطاق زمني شامل ليوم النهاية
  const from = new Date(`${fromStr}T00:00:00.000`);
  const to   = new Date(`${toStr}T23:59:59.999`);

  // where(when between) + orderBy('when')
  const qy   = query(ref, where('when','>=', from), where('when','<=', to), orderBy('when','asc'));
  const snap = await getDocs(qy);

  allMeas = [];
  snap.forEach(d=>{
    const m = d.data();
    const ts = m.when?.toDate ? m.when.toDate() : new Date(`${m.date}T00:00:00`);
    const mmol = m.value_mmol ?? (m.value_mgdl ? (m.value_mgdl/18) : (m.value? m.value/18 : null));
    if (mmol!=null) {
      allMeas.push({
        when: ts,
        date: m.date || fmtDate(ts),
        mmol: Number(mmol),
        state: m.state || null,
        slotKey: m.slotKey || null
      });
    }
  });
}

/* حساب الإحصائيات + رسم المنحنى + الرسم الدائري + الملخص الذكي */
function renderKPIsAndCharts(){
  const unit = unitSel.value; // mmol | mgdl
  const min = childData?.normalRange?.min ?? 4.5;
  const max = childData?.normalRange?.max ?? 11;

  // مجموعات
  const valsMmol = allMeas.map(m=> m.mmol);
  const valsUnit = allMeas.map(m=> toUnit(m.mmol, unit));

  // KPIs
  const count = valsMmol.length;
  const avgM  = count? (valsMmol.reduce((a,b)=>a+b,0)/count) : 0;
  const sdM   = count? Math.sqrt(valsMmol.reduce((a,b)=>a+Math.pow(b-avgM,2),0)/count) : 0;

  const inRange = count? valsMmol.filter(v=> v>=min && v<=max).length / count * 100 : 0;
  const highs   = count? valsMmol.filter(v=> v>max).length / count * 100 : 0;
  const lows    = count? valsMmol.filter(v=> v<min).length / count * 100 : 0;

  kpiCount.textContent = String(count);
  kpiAvg.textContent   = unit==='mgdl' ? (avgM*18).toFixed(1) : avgM.toFixed(1);
  kpiStd.textContent   = unit==='mgdl' ? (sdM*18).toFixed(1) : sdM.toFixed(1);
  kpiTir.textContent   = `${Math.round(inRange)}%`;
  kpiHigh.textContent  = `${Math.round(highs)}%`;
  kpiLow.textContent   = `${Math.round(lows)}%`;

  // بيانات الرسم الخطي — كل نقطة = تاريخ كامل
  const points = allMeas.map(m=> ({ x: m.when, y: toUnit(m.mmol, unit), slotKey: m.slotKey })).sort((a,b)=> a.x - b.x);

  // إظهار رسالة عدم وجود بيانات
  emptyMsg.classList.toggle('hidden', points.length>0);

  // تدمير رسومات قديمة
  if (chart){ chart.destroy(); chart=null; }
  if (pieChart){ pieChart.destroy(); pieChart=null; }

  // Line Chart
  const ctx = document.getElementById('dayChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: unit==='mgdl' ? 'الجلوكوز (mg/dL)' : 'الجلوكوز (mmol/L)',
        data: points,
        borderColor: '#4F46E5',
        backgroundColor: 'rgba(79,70,229,0.08)',
        pointRadius: 3,
        tension: .25,
        fill: false,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      interaction:{ mode:'nearest', intersect:false },
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{
          label:(ctx)=>{
            const v = ctx.parsed.y;
            const d = new Date(ctx.parsed.x);
            const slotKey = ctx.raw?.slotKey;
            const slotAr  = slotKey ? (SLOT_AR[slotKey] || slotKey) : '';
            const timeStr = d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
            const dateStr = d.toLocaleDateString();
            const value   = unit==='mgdl' ? `${Math.round(v)}` : `${Number(v).toFixed(1)}`;
            return `${value} @ ${dateStr} ${timeStr}${slotAr?` — ${slotAr}`:''}`;
          }
        }}
      },
      scales:{
        x:{
          type:'time',
          time:{ unit:'day', tooltipFormat:'yyyy-MM-dd HH:mm' },
          title:{ display:true, text:'التاريخ' }
        },
        y:{
          title:{ display:true, text: unit==='mgdl' ? 'mg/dL' : 'mmol/L' },
          suggestedMin: unit==='mgdl' ? 60 : 3,
          suggestedMax: unit==='mgdl' ? 250 : 15
        }
      }
    }
  });

  // Doughnut (TIR/High/Low)
  const pctx = document.getElementById('pieChart').getContext('2d');
  pieChart = new Chart(pctx, {
    type: 'doughnut',
    data: {
      labels: ['داخل النطاق', 'ارتفاعات', 'هبوطات'],
      datasets: [{
        data: [inRange.toFixed(1), highs.toFixed(1), lows.toFixed(1)],
        backgroundColor: ['rgba(34,197,94,0.25)','rgba(239,68,68,0.25)','rgba(59,130,246,0.25)'],
        borderColor: ['#22c55e','#ef4444','#3b82f6']
      }]
    },
    options:{
      plugins:{
        legend:{ position:'bottom' }
      },
      cutout: '60%'
    }
  });

  // ملخص ذكي
  renderAISummary({unit, avgM, sdM, inRange, highs, lows, points, min, max});
}

/* ذكاء اصطناعي مبسّط — يُولّد خلاصة بالعربي */
function renderAISummary({unit, avgM, sdM, inRange, highs, lows, points, min, max}){
  if (!points.length){ aiBox.textContent = 'لا توجد بيانات كافية لعرض الملخص.'; return; }

  // اتجاه آخر 7 قراءات
  const lastN = points.slice(-7).map(p=> p.y);
  const trend = lastN.length>=2 ? (lastN[lastN.length-1] - lastN[0]) : 0;

  // تجميع حسب slotKey لمعرفة الأكثر تكرارًا أو المشاكل
  const bySlot = {};
  allMeas.forEach(m=>{
    const key = m.slotKey || 'غير محدد';
    bySlot[key] = bySlot[key] || {count:0, highs:0, lows:0};
    bySlot[key].count++;
    if (m.mmol>max) bySlot[key].highs++;
    if (m.mmol<min) bySlot[key].lows++;
  }
