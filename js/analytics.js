// js/analytics.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, orderBy, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- عناصر ---------- */
const params      = new URLSearchParams(location.search);
const childId     = params.get('child');
const rangeParam  = params.get('range') || '14d';

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');

const backBtn  = document.getElementById('backBtn');
const aiBtn    = document.getElementById('aiBtn');

const dateFromEl = document.getElementById('dateFrom');
const dateToEl   = document.getElementById('dateTo');
const unitSel    = document.getElementById('unitSel');
const applyBtn   = document.getElementById('applyBtn');

const rangeChips = [...document.querySelectorAll('[data-range]')];
const slotChips  = [...document.querySelectorAll('.chip.filter')];

const kCount = document.getElementById('kCount');
const kAvg   = document.getElementById('kAvg');
const kStd   = document.getElementById('kStd');
const kTIR   = document.getElementById('kTIR');
const kHigh  = document.getElementById('kHigh');
const kLow   = document.getElementById('kLow');

const cmpRangeEl = document.getElementById('cmpRange');

/* ---------- حالة ---------- */
let currentUser, childData;
let allMeasure = []; // {when:Date, value_mmol, value_mgdl, slotKey:'PRE_BREAKFAST'|'POST_LUNCH'|...}
let lineChart, cmpChart;

/* ---------- أدوات ---------- */
const df = window.dateFns; // من UMD
const pad = n => String(n).padStart(2,'0');
const toDayStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function convert(val, fromUnit, toUnit){
  if (val==null) return null;
  if (fromUnit === toUnit) return val;
  // mg/dL <-> mmol/L
  return (toUnit === 'mmol') ? (val/18) : (val*18);
}

function slotGroup(slotKey){
  if (!slotKey) return 'OTHER';
  if (slotKey.startsWith('PRE_'))  return 'PRE';
  if (slotKey.startsWith('POST_')) return 'POST';
  if (slotKey.includes('SNACK'))   return 'SNACK';
  if (slotKey.includes('SLEEP') || slotKey.includes('BED')) return 'SLEEP';
  return 'OTHER';
}

function withinRange(v, min, max){ return v>=min && v<=max; }

function stats(values){
  const n = values.length;
  if (!n) return { n:0, avg:0, std:0, hiPct:0, loPct:0, tir:0 };
  const avg = values.reduce((a,b)=>a+b,0)/n;
  const std = Math.sqrt(values.reduce((a,b)=>a+Math.pow(b-avg,2),0)/n);
  return { n, avg, std };
}

/* ---------- تهيئة نطاق التاريخ ---------- */
(function initDates(){
  const today = new Date();
  const from  = df.addDays(today, -13);
  dateFromEl.value = toDayStr(from);
  dateToEl.value   = toDayStr(today);
})();

/* نطاق جاهز */
rangeChips.forEach(ch=>{
  ch.addEventListener('click', ()=>{
    rangeChips.forEach(x=>x.classList.remove('active'));
    ch.classList.add('active');
    const v = ch.dataset.range;
    const to = new Date();
    let from;
    if (v==='14d') from=df.addDays(to,-13);
    else if (v==='30d') from=df.addDays(to,-29);
    else if (v==='90d') from=df.addDays(to,-89);
    else from = df.addYears(to, -10); // الكل
    dateFromEl.value = toDayStr(from);
    dateToEl.value   = toDayStr(to);
  });
});

/* فلاتر */
slotChips.forEach(ch=>{
  ch.addEventListener('click', ()=>{
    slotChips.forEach(x=>x.classList.remove('active'));
    ch.classList.add('active');
  });
});

/* رجوع */
backBtn.addEventListener('click', ()=>{
  history.length>1 ? history.back() : location.href = `parent.html`;
});

/* AI */
aiBtn.addEventListener('click', async ()=>{
  const prompt = buildAIPrompt();
  const reply = await window.askGemini(prompt);
  alert(reply);
});

/* حساب الفترة */
function getRange(){
  const from = new Date(dateFromEl.value+'T00:00:00');
  const to   = new Date(dateToEl.value+'T23:59:59');
  return { from, to };
}

/* ---------- جلسة وتحميل ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href = 'index.html';
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;
  await loadChild();
  await loadMeasurements();
  renderAll();
});

/* الطفل */
async function loadChild(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap= await getDoc(ref);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); return; }
  childData = snap.data();
  childNameEl.textContent = childData.name || 'طفل';
  const age = (()=>{ if(!childData.birthDate) return '-';
    const b=new Date(childData.birthDate),t=new Date();
    let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth();
    if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
    return a; })();
  const cr = childData.carbRatio ?? '—';
  const cf = childData.correctionFactor ?? '—';
  const min= childData.normalRange?.min ?? 4.0;
  const max= childData.normalRange?.max ?? 11.0;
  childMetaEl.textContent = `النطاق: ${min}–${max} mmol/L • CR: ${cr} g/U • CF: ${cf} mmol/L/U`;
}

/* القياسات */
async function loadMeasurements(){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, orderBy('when','asc'));
  const snap= await getDocs(qy);
  allMeasure = [];
  snap.forEach(s=>{
    const d = s.data();
    const when = d.when?.toDate ? d.when.toDate() : (d.when ? new Date(d.when) : null);
    const mmol = d.value_mmol ?? (d.value_mgdl!=null ? d.value_mgdl/18 : null);
    const mgdl = d.value_mgdl ?? (d.value_mmol!=null ? Math.round(d.value_mmol*18) : null);
    allMeasure.push({
      id:s.id, when, date: d.date || (when?toDayStr(when):null),
      unit: d.unit || 'mmol/L',
      value_mmol: mmol, value_mgdl: mgdl,
      slotKey: d.slot || d.slotKey || ''
    });
  });
}

/* ---------- عرض وتحليل ---------- */
applyBtn.addEventListener('click', renderAll);

function pickSlot(arr){
  const want = document.querySelector('.chip.filter.active')?.dataset.slot || 'ALL';
  if (want==='ALL') return arr;
  return arr.filter(x=> slotGroup(x.slotKey) === want);
}

function inRange(arr){
  const {from,to} = getRange();
  return arr.filter(x=> x.when && x.when>=from && x.when<=to);
}

function valuesInUnit(arr, unit){
  return arr.map(x => unit==='mmol' ? x.value_mmol : x.value_mgdl).filter(v=>v!=null);
}

function limitsInUnit(unit){
  const minM = Number(childData?.normalRange?.min ?? 4.0);
  const maxM = Number(childData?.normalRange?.max ?? 11.0);
  return unit==='mmol' ? {min:minM,max:maxM} : {min:Math.round(minM*18),max:Math.round(maxM*18)};
}

function computeKPI(arr, unit){
  const vals = valuesInUnit(arr, unit);
  const {min,max} = limitsInUnit(unit);
  const N = vals.length;
  const st = stats(vals);
  const highs = vals.filter(v=> v>max).length;
  const lows  = vals.filter(v=> v<min).length;
  const tir   = N? Math.round((N-highs-lows)*100/N) : 0;
  return {
    n:N, avg:st.avg, std:st.std,
    hiPct: N? Math.round(highs*100/N):0,
    loPct: N? Math.round(lows*100/N):0,
    tir
  };
}

function renderKPIs(kpi, unit){
  const fmt = (x,dec=1)=> isFinite(x)? (unit==='mmol'? x.toFixed(dec): Math.round(x)) : '—';
  kCount.textContent = kpi.n || 0;
  kAvg.textContent   = fmt(kpi.avg);
  kStd.textContent   = isFinite(kpi.std)? kpi.std.toFixed(1) : '—';
  kTIR.textContent   = (kpi.tir||0)+'%';
  kHigh.textContent  = (kpi.hiPct||0)+'%';
  kLow.textContent   = (kpi.loPct||0)+'%';
}

function renderLine(arr, unit){
  const {min,max} = limitsInUnit(unit);
  const data = arr.map(x=>({
    x: x.when, y: unit==='mmol' ? x.value_mmol : x.value_mgdl
  })).filter(p=> p.x && p.y!=null);

  const ds = [{
    label: unit==='mmol'?'mmol/L':'mg/dL',
    data, borderWidth:2, pointRadius:0, tension:.2
  },{
    label:'الحد الأعلى', data:data.map(p=>({x:p.x,y:max})), borderDash:[6,6], borderWidth:1, pointRadius:0
  },{
    label:'الحد الأدنى', data:data.map(p=>({x:p.x,y:min})), borderDash:[6,6], borderWidth:1, pointRadius:0
  }];

  const cfg = {
    type:'line',
    data:{ datasets: ds },
    options:{
      responsive:true,
      parsing:false,
      scales:{
        x:{ type:'time', time:{unit:'day'} },
        y:{ beginAtZero:false }
      },
      plugins:{
        legend:{display:false},
        tooltip:{mode:'nearest',intersect:false}
      }
    }
  };
  if(lineChart){ lineChart.destroy(); }
  const ctx = document.getElementById('lineChart').getContext('2d');
  lineChart = new Chart(ctx, cfg);
}

function renderCompare(arr, unit){
  // آخر 7 أيام مقابل الأسبوع السابق (مبني على تاريخ "إلى")
  const to   = new Date(dateToEl.value+'T23:59:59');
  const from = df.addDays(to, -6);
  const prevFrom = df.addDays(from,-7);
  const prevTo   = df.addDays(from,-1);

  const cur = arr.filter(x=> x.when>=from && x.when<=to);
  const prv = arr.filter(x=> x.when>=prevFrom && x.when<=prevTo);

  const curK = computeKPI(cur, unit);
  const prvK = computeKPI(prv, unit);

  cmpRangeEl.textContent = `الحالي: ${toDayStr(from)} → ${toDayStr(to)} • السابق: ${toDayStr(prevFrom)} → ${toDayStr(prevTo)}`;

  const labels = ['المتوسط', 'الارتفاعات %', 'الهبوطات %'];
  const curVals = [
    unit==='mmol' ? Number(curK.avg.toFixed(1)) : Math.round(curK.avg),
    curK.hiPct, curK.loPct
  ];
  const prvVals = [
    unit==='mmol' ? Number(prvK.avg.toFixed(1)) : Math.round(prvK.avg),
    prvK.hiPct, prvK.loPct
  ];

  const cfg = {
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'الأسبوع الحالي', data:curVals},
        {label:'الأسبوع السابق', data:prvVals}
      ]
    },
    options:{
      responsive:true,
      scales:{ x:{stacked:false}, y:{beginAtZero:true} }
    }
  };
  if(cmpChart){ cmpChart.destroy(); }
  const ctx = document.getElementById('cmpChart').getContext('2d');
  cmpChart = new Chart(ctx, cfg);
}

function renderAll(){
  // 1) فلترة بالمدى + الفئة
  const inR   = inRange(allMeasure);
  const pick  = pickSlot(inR);
  const unit  = unitSel.value; // 'mmol' | 'mgdl'

  // 2) KPIs
  const k = computeKPI(pick, unit);
  renderKPIs(k, unit);

  // 3) الرسوم
  renderLine(pick, unit);
  renderCompare(inR, unit);
}

/* CSV / PDF */
document.getElementById('csvBtn').addEventListener('click', ()=>{
  const unit  = unitSel.value;
  const rows  = inRange(pickSlot(allMeasure)).map(x=>[
    toDayStr(x.when), x.when.toTimeString().slice(0,8),
    unit==='mmol' ? (x.value_mmol?.toFixed(1) ?? '') : (x.value_mgdl ?? ''),
    x.slotKey || ''
  ]);
  const head = ['date','time', unit==='mmol'?'mmol/L':'mg/dL','slot'];
  const csv = [head, ...rows].map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='analytics.csv'; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('pdfBtn').addEventListener('click', ()=> window.print());

/* مساعد Gemini: نبني ملخصاً للسياق */
function buildAIPrompt(){
  const unit  = unitSel.value;
  const {min,max} = limitsInUnit(unit);
  const arr   = pickSlot(inRange(allMeasure));
  const k     = computeKPI(arr, unit);
  const avg   = unit==='mmol'? k.avg.toFixed(1) : Math.round(k.avg);
  const unitLabel = unit==='mmol'?'mmol/L':'mg/dL';

  return `
أنت مساعد صحي تعليمي. حلّل هذه الأرقام لطفل اسمه "${childData?.name || 'طفل'}".
- الوحدة: ${unitLabel}, النطاق المستهدف: ${min}–${max} ${unitLabel}
- عدد القياسات: ${k.n}
- المتوسط: ${avg}, الانحراف المعياري: ${k.std.toFixed(1)}
- وقت داخل النطاق (TIR): ${k.tir}%
- ارتفاعات: ${k.hiPct}%, هبوطات: ${k.loPct}%

اكتب ملخصًا موجزًا (٤-٦ أسطر) عن الوضع العام ومقترحات تحسين السلوك الغذائي/النشاط دون نصائح دوائية مباشرة.
`.trim();
}
