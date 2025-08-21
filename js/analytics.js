// === Firebase
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// === Helpers
const $ = s => document.querySelector(s);
const loaderEl = $('#loader'); const loader = v => loaderEl.classList.toggle('hidden', !v);

const qs = new URLSearchParams(location.search);
const childId = qs.get('child') || localStorage.getItem('lastChildId');
if (!childId) { location.replace('parent.html?pickChild=1'); throw new Error('no-child'); }

// UI refs
const childNameEl = $('#childName');
const childMetaEl = $('#childMeta');
const chipRangeEl = $('#chipRange');
const chipCREl = $('#chipCR');
const chipCFEl = $('#chipCF');

const rangeSel = $('#range'); const startInp = $('#start'); const endInp = $('#end');
const unitSel = $('#unit'); const applyBtn = $('#apply'); const printBtn = $('#printBtn'); const csvBtn = $('#csvBtn');

const slotBarCanvas = $('#slotBar'); const dailyCanvas = $('#dailyLine');
const insightsUl = $('#insightsList');

// KPIs elements
const kpiTIR=$('#kpiTIR'), kpiHigh=$('#kpiHigh'), kpiLow=$('#kpiLow'), kpiMean=$('#kpiMean'), kpiSD=$('#kpiSD'), kpiCount=$('#kpiCount');
const deltaTIR=$('#deltaTIR'), deltaHigh=$('#deltaHigh'), deltaLow=$('#deltaLow'), deltaMean=$('#deltaMean'), deltaSD=$('#deltaSD'), deltaCount=$('#deltaCount');

// AI (اختياري)
const aiBtn = $('#aiBtn'); const aiBox = $('#aiBox'); const aiOut = $('#aiOut');
const GEMINI_API_KEY = window.GEMINI_API_KEY;

// === Mapping موحّد للسلوتات
const AR2KEY = {
  'الاستيقاظ':'wake',
  'ق.الفطار':'pre_bf','ب.الفطار':'post_bf',
  'ق.الغداء':'pre_ln','ب.الغداء':'post_ln',
  'ق.العشاء':'pre_dn','ب.العشاء':'post_dn',
  'سناك':'snack',
  'ق.النوم':'pre_sleep','أثناء النوم':'during_sleep',
  'ق.الرياضة':'pre_sport','ب.الرياضة':'post_sport'
};
const SLOTS = [
  'wake','pre_bf','post_bf','pre_ln','post_ln',
  'pre_dn','post_dn','snack','pre_sleep','during_sleep'
];
const LABEL = {
  wake:'الاستيقاظ', pre_bf:'ق.الفطار', post_bf:'ب.الفطار',
  pre_ln:'ق.الغداء', post_ln:'ب.الغداء', pre_dn:'ق.العشاء', post_dn:'ب.العشاء',
  snack:'سناك', pre_sleep:'ق.النوم', during_sleep:'أثناء النوم'
};
const GROUPS = {
  all:new Set(SLOTS),
  pre:new Set(['wake','pre_bf','pre_ln','pre_dn','pre_sleep','pre_sport']),
  post:new Set(['post_bf','post_ln','post_dn','post_sport']),
  sleep:new Set(['pre_sleep','during_sleep']),
  snack:new Set(['snack']),
};
let activeGroup='all';

// === Unit helpers
const toMgdl = mmol => Math.round(Number(mmol)*18);
const toMmol = mgdl => Number(mgdl)/18;
const pad = n=>String(n).padStart(2,'0');
const fmtDate = d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays=(d,dd)=>{const x=new Date(d);x.setDate(x.getDate()+dd);return x;};

// Child state
let user, child, limits={min:4,max:7}, cr=null, cf=null;

// Charts
let barChart=null, lineChart=null;

// === Start
onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  user=u;
  try{
    loader(true);
    await loadChild();
    initUI();
    if(GEMINI_API_KEY) aiBtn.classList.remove('hidden');
    await apply(true);
  } finally { loader(false); }
});

// Load child info
async function loadChild(){
  const snap=await getDoc(doc(db,`parents/${user.uid}/children/${childId}`));
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); throw 0; }
  child=snap.data();

  limits={min:Number(child.normalRange?.min ?? 4), max:Number(child.normalRange?.max ?? 7)};
  cr=child.carbRatio!=null?Number(child.carbRatio):null;
  cf=child.correctionFactor!=null?Number(child.correctionFactor):null;

  childNameEl.textContent=child.name||'طفل';
  childMetaEl.textContent=`${child.gender||'—'} • العمر: ${calcAge(child.birthDate)} سنة`;
  chipRangeEl.textContent=`النطاق: ${limits.min}–${limits.max} mmol/L`;
  chipCREl.textContent=`CR: ${cr??'—'} g/U`;
  chipCFEl.textContent=`CF: ${cf??'—'} mmol/L/U`;
}
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return a;
}

// UI init
function initUI(){
  const end=new Date(); const start=addDays(end,-14);
  startInp.value=fmtDate(start); endInp.value=fmtDate(end);

  rangeSel.addEventListener('change',()=>{
    const c=rangeSel.value==='custom';
    startInp.classList.toggle('hidden',!c);
    endInp.classList.toggle('hidden',!c);
  });

  applyBtn.addEventListener('click', ()=>apply(true));
  unitSel.addEventListener('change', ()=>apply(false));
  printBtn.addEventListener('click', ()=>window.print());
  csvBtn.addEventListener('click', downloadCSV);

  document.querySelectorAll('.slot-filters .seg').forEach(b=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('.slot-filters .seg').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); activeGroup=b.dataset.slot||'all'; apply(false);
    });
  });

  aiBtn.addEventListener('click', aiAnalyze);
}

function resolveRange(){
  if(rangeSel.value==='custom') return {start:startInp.value, end:endInp.value};
  const now=new Date(); const map={ '7d':7, '14d':14, '30d':30 };
  const d = map[rangeSel.value] || 14;
  return { start: fmtDate(addDays(now,-d)), end: fmtDate(now) };
}

async function apply(withComparison){
  loader(true);
  try{
    const {start,end} = resolveRange();
    const rowsAll = await fetchRows(start,end);
    const rows = filterByGroup(rowsAll, activeGroup);

    renderKPIs(rows);
    renderSlotBar(rows);
    renderDailyLine(rows);
    renderInsights(rows);

    if(withComparison){
      const prevStart = fmtDate(addDays(new Date(start), -(diffDays(start,end)+1)));
      const prevEnd   = fmtDate(addDays(new Date(start), -1));
      const prevRows  = filterByGroup(await fetchRows(prevStart,prevEnd), activeGroup);
      renderDeltas(rows, prevRows);
    }

    aiBtn.dataset.payload = JSON.stringify({ rows, start, end });
  }catch(e){ console.error(e); alert('تعذر تحميل التحليل'); }
  finally{ loader(false); }
}

function diffDays(a,b){ const d1=new Date(a), d2=new Date(b); return Math.round((d2-d1)/86400000); }

async function fetchRows(start,end){
  const col = collection(db,`parents/${user.uid}/children/${childId}/measurements`);
  const qy = query(col, where('date','>=',start), where('date','<=',end));
  const snap = await getDocs(qy);
  return snap.docs.map(d=>d.data()).map(r=>{
    let slot = (r.slotKey || r.slot || '').toString();
    // موحّد: لو عربي حوّله
    if(AR2KEY[slot]) slot = AR2KEY[slot];
    // لو مازال غير معروف تجاهل
    let mmol = (typeof r.value_mmol==='number') ? r.value_mmol : null;
    if(mmol==null && typeof r.value_mgdl==='number') mmol = toMmol(r.value_mgdl);
    return { ...r, slot, value_mmol:mmol };
  }).filter(r=> SLOTS.includes(r.slot) && isFinite(r.value_mmol));
}

function filterByGroup(rows, group){ const set = GROUPS[group]||GROUPS.all; return rows.filter(r=> set.has(r.slot)); }

// KPIs
function renderKPIs(rows){
  const n = rows.length;
  if(n===0){ kpiTIR.textContent='0%'; kpiHigh.textContent='0%'; kpiLow.textContent='0%'; kpiMean.textContent='—'; kpiSD.textContent='—'; kpiCount.textContent='0'; return; }
  const vals = rows.map(r=>r.value_mmol);
  const inR = vals.filter(v=>v>=limits.min&&v<=limits.max).length/n;
  const hi  = vals.filter(v=>v>limits.max).length/n;
  const lo  = vals.filter(v=>v<limits.min).length/n;
  const mean = vals.reduce((a,b)=>a+b,0)/n;
  const sd   = Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/n);

  const toUnit = x => unitSel.value==='mgdl'? x*18 : x;
  kpiTIR.textContent = Math.round(inR*100)+'%';
  kpiHigh.textContent= Math.round(hi*100)+'%';
  kpiLow.textContent = Math.round(lo*100)+'%';
  kpiMean.textContent= unitSel.value==='mgdl'? Math.round(toUnit(mean)) : mean.toFixed(1);
  kpiSD.textContent  = unitSel.value==='mgdl'? Math.round(toUnit(sd))   : sd.toFixed(1);
  kpiCount.textContent= String(n);
}
function setDelta(el, val, betterIfDown=false){
  if(!isFinite(val)){ el.textContent='—'; el.className='d neu'; return; }
  const sign = val>0? '+' : (val<0? '−':'±'); const abs = Math.abs(val);
  el.textContent = abs>=0.1 ? `${sign}${abs.toFixed(1)}` : '±0.0';
  el.className = 'd ' + (val===0? 'neu' : ((betterIfDown? val<0 : val>0)? 'pos':'neg'));
}
function renderDeltas(curr, prev){
  const pct=(rows)=>{
    const n=rows.length||1; const v=rows.map(r=>r.value_mmol);
    const inR=v.filter(x=>x>=limits.min&&x<=limits.max).length/n;
    const hi =v.filter(x=>x>limits.max).length/n;
    const lo =v.filter(x=>x<limits.min).length/n;
    const m =v.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/n);
    return {inR,hi,lo,m,sd,n:rows.length};
  };
  const a=pct(curr), b=pct(prev);
  setDelta(deltaTIR,  Math.round((a.inR - b.inR)*100), false);
  setDelta(deltaHigh, Math.round((b.hi  - a.hi )*100), false);
  setDelta(deltaLow,  Math.round((b.lo  - a.lo )*100), false);
  setDelta(deltaMean, (unitSel.value==='mgdl'? (toMgdl(a.m)-toMgdl(b.m)) : (a.m-b.m)), true);
  setDelta(deltaSD,   (unitSel.value==='mgdl'? (toMgdl(a.sd)-toMgdl(b.sd)) : (a.sd-b.sd)), true);
  setDelta(deltaCount, a.n-b.n, false);
}

// Charts
function renderSlotBar(rows){
  const counts = SLOTS.map(k => rows.filter(r=>r.slot===k).length);
  const colors = SLOTS.map(k=>{
    const g = rows.filter(r=>r.slot===k);
    if(!g.length) return '#4f46e5';
    const hi = g.filter(x=>x.value_mmol>limits.max).length/g.length;
    const lo = g.filter(x=>x.value_mmol<limits.min).length/g.length;
    if(hi>0.5) return '#ef4444';
    if(lo>0.5) return '#2563eb';
    return '#4f46e5';
  });
  if(barChart) barChart.destroy();
  barChart = new Chart(slotBarCanvas, {
    type:'bar',
    data:{
      labels:SLOTS.map(k=>LABEL[k]),
      datasets:[{ label:'عدد القياسات', data:counts, backgroundColor:colors }]
    },
    options:{
      responsive:true,
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }
    }
  });
}

function renderDailyLine(rows){
  const byDate={}; rows.forEach(r=> (byDate[r.date]??=([])).push(r.value_mmol));
  const dates=Object.keys(byDate).sort();
  const avgs=dates.map(d=> byDate[d].reduce((a,b)=>a+b,0)/byDate[d].length );
  const toU=v=> unitSel.value==='mgdl'? v*18 : v;

  if(lineChart) lineChart.destroy();
  lineChart = new Chart(dailyCanvas, {
    type:'line',
    data:{
      labels:dates.map(d=>d.slice(5)),
      datasets:[{
        label:'متوسط اليوم',
        data:avgs.map(toU),
        borderColor:'#4f46e5',
        pointRadius:3,
        tension:.2
      }]
    },
    options:{
      responsive:true,
      scales:{
        y:{
          beginAtZero:false,
          suggestedMin: toU(Math.min(...avgs, limits.min)-0.5),
          suggestedMax: toU(Math.max(...avgs, limits.max)+0.5)
        }
      },
      plugins:{
        legend:{display:false},
        // نطاق النطاق الطبيعي كخلفية خضراء فاتحة
        annotation:{
          annotations:{
            target:{
              type:'box',
              yMin: toU(limits.min),
              yMax: toU(limits.max),
              backgroundColor:'rgba(22,163,74,.12)',
              borderWidth:0
            }
          }
        }
      }
    },
    plugins:[Chart.registry.getPlugin('annotation') || {}]
  });
}

// Insights
function renderInsights(rows){
  insightsUl.innerHTML='';
  if(!rows.length){ insightsUl.innerHTML='<li>لا توجد قياسات في هذه الفترة.</li>'; return; }

  const bySlot={}; rows.forEach(r=> (bySlot[r.slot]??=([])).push(r.value_mmol));
  const slotHigh = topSlot(bySlot, v=> v>limits.max );
  const slotLow  = topSlot(bySlot, v=> v<limits.min );

  if(slotHigh) addLi(`أكثر ارتفاعات تظهر في: <b>${LABEL[slotHigh.key]}</b> (%${slotHigh.p}) — راجعي CR إن كانت بعد الوجبة، أو CF/القاعدي إن كانت قبل الوجبة.`);
  if(slotLow)  addLi(`أكثر هبوطات تظهر في: <b>${LABEL[slotLow.key]}</b> (%${slotLow.p}) — راجعي توقيت الجرعات والوجبات، وقد تحتاج سناك أو ضبط القاعدي.`);

  const manyCorrections = rows.filter(r=> (r.correctionDose||0)>0 ).length/(rows.length||1) > .25;
  const highs = rows.filter(r=> r.value_mmol>limits.max ).length/(rows.length||1);
  if(manyCorrections && highs>.2) addLi(`جرعات تصحيحية متكررة مع استمرار الارتفاعات — قد يشير إلى أن <b>CF</b> أقل من المطلوب.`);

  const byDate={}; rows.forEach(r=> (byDate[r.date]??=([])).push(r.value_mmol));
  const best = Object.entries(byDate).map(([d,arr])=>{
    const inR=arr.filter(v=>v>=limits.min&&v<=limits.max).length/arr.length; return {d, tir:Math.round(inR*100)}
  }).sort((a,b)=>b.tir-a.tir)[0];
  if(best) addLi(`اليوم الأكثر استقرارًا: <b>${best.d}</b> (TIR ${best.tir}%).`);

  if(!insightsUl.children.length) addLi('لا توجد ملاحظات لافتة — استمري على نفس الخطة 👏');

  function addLi(html){ const li=document.createElement('li'); li.innerHTML=html; insightsUl.appendChild(li); }
  function topSlot(map, pred){
    let best=null; for(const [k,arr] of Object.entries(map)){
      if(!arr.length) continue; const p=Math.round(arr.filter(pred).length/arr.length*100);
      if(!best || p>best.p) best={key:k,p};
    } return best && best.p>0 ? best : null;
  }
}

// CSV
async function downloadCSV(){
  const {start,end}=resolveRange();
  const rows=await fetchRows(start,end);
  const headers=['date','slot','value_mmol','value_mgdl','notes','correctionDose'];
  const toRow=r=>[
    r.date||'', LABEL[r.slot]||r.slot, (r.value_mmol??''),
    r.value_mmol!=null? Math.round(r.value_mmol*18): (r.value_mgdl??''),
    (r.notes||''), (r.correctionDose??'')
  ];
  const lines=[headers.join(','), ...rows.map(r=> toRow(r).map(x=> `"${String(x).replace(/"/g,'""')}"`).join(','))];
  const blob=new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`measurements-${start}_to_${end}.csv`; a.click();
}

// AI (اختياري)
async function aiAnalyze(){
  if(!GEMINI_API_KEY){ alert('أضف مفتاح Gemini أولاً'); return; }
  aiBox.classList.remove('hidden'); aiOut.textContent='جارٍ توليد التحليل…';

  const p=JSON.parse(aiBtn.dataset.payload||'{}'); const rows=p.rows||[];
  const vals=rows.map(r=>r.value_mmol); const n=vals.length||1;
  const mean=vals.reduce((a,b)=>a+b,0)/n;
  const inR=vals.filter(v=>v>=limits.min&&v<=limits.max).length/n;
  const hi =vals.filter(v=>v>limits.max).length/n;
  const lo =vals.filter(v=>v<limits.min).length/n;

  const prompt=`
أنت مساعد صحي تعليمي لسكري الأطفال (نوع 1). قدم توصيات عامة غير علاجية.
الطفل: ${child.name||'غير معروف'}، النطاق ${limits.min}–${limits.max} mmol/L، CR ${cr??'—'} g/U، CF ${cf??'—'} mmol/L/U.
الفترة: ${p.start} → ${p.end}. TIR ${(inR*100).toFixed(0)}%، ارتفاع ${(hi*100).toFixed(0)}%، هبوط ${(lo*100).toFixed(0)}%، المتوسط ${mean.toFixed(1)} mmol/L.
اعطِ 4-6 نقاط عملية موجزة لتقليل الارتفاع/الهبوط وتحسين قبل/بعد الوجبة وتوقيت القياس، واذكر متى نفكر بمراجعة CF أو CR بشكل إرشادي فقط.
`.trim();

  try{
    const res=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY},
      body:JSON.stringify({ contents:[{parts:[{text:prompt}]}] })
    });
    if(!res.ok){ aiOut.textContent='تعذر الاتصال بـ Gemini'; return; }
    const data=await res.json();
    aiOut.textContent=data?.candidates?.[0]?.content?.parts?.[0]?.text || 'لم يصل رد.';
  }catch(e){ console.error(e); aiOut.textContent='حدث خطأ أثناء التحليل.'; }
}
