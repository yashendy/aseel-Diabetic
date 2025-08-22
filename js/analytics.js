// js/analytics.js
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

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

let currentUser, childData;
let chart; // Chart.js instance
let allMeas = []; // القياسات المحملة

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
firebase.auth().onAuthStateChanged(async user=>{
  if(!user){ location.href='child.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  await loadChild();
  await loadMeasurements();
  renderKPIsAndChart();
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

/* تحميل القياسات حسب الفترة */
async function loadMeasurements(){
  const from = fromEl.value;
  const to   = toEl.value;
  const ref  = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);

  // where(date >= from && date <= to) + orderBy('date','asc')
  const qy   = query(ref, where('date','>=', from), where('date','<=', to), orderBy('date','asc'));
  const snap = await getDocs(qy);

  allMeas = [];
  snap.forEach(d=>{
    const m = d.data();
    const ts = m.when?.toDate ? m.when.toDate() : new Date(`${m.date}T00:00:00`);
    const mmol = m.value_mmol ?? (m.value_mgdl ? (m.value_mgdl/18) : null);
    if (mmol!=null) {
      allMeas.push({
        when: ts,
        date: m.date,
        mmol: Number(mmol),
        state: m.state || null
      });
    }
  });
}

/* حساب الإحصائيات + رسم المنحنى بالأيام */
function renderKPIsAndChart(){
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

  // تجهيز بيانات الرسم — كل نقطة = تاريخ كامل (محور X days)
  const points = allMeas.map(m=> ({ x: m.when, y: toUnit(m.mmol, unit) })).sort((a,b)=> a.x - b.x);

  // إظهار رسالة عدم وجود بيانات
  emptyMsg.classList.toggle('hidden', points.length>0);

  // تدمير رسم قديم
  if (chart){ chart.destroy(); chart=null; }

  const ctx = document.getElementById('dayChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: unit==='mgdl' ? 'الجلوكوز (mg/dL)' : 'الجلوكوز (mmol/L)',
        data: points,
        borderColor: '#4F46E5',
        backgroundColor: 'rgba(79,70,229,.08)',
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
            return `${v} @ ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
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
}

/* تفعيل الفلاتر */
applyBtn.addEventListener('click', async ()=>{
  await loadMeasurements();
  renderKPIsAndChart();
});
unitSel.addEventListener('change', ()=> renderKPIsAndChart());
quicks.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const r = btn.dataset.range;
    if (r==='all'){
      // ابحث لأبعد تاريخ موجود وسجله كنطاق كامل
      if (allMeas.length){
        const first = allMeas.reduce((a,b)=> a.when<b.when?a:b).when;
        fromEl.value = fmtDate(first);
        toEl.value   = fmtDate(new Date());
      }
    }else{
      const days = Number(r);
      const to   = new Date();
      const from = addDays(to, -(days-1));
      fromEl.value = fmtDate(from);
      toEl.value   = fmtDate(to);
    }
  });
});
