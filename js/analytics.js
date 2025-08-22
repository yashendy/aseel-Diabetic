// js/analytics.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر */
const qs = s => document.querySelector(s);
const childNameEl = qs('#childName');
const childMetaEl = qs('#childMeta');

const dateFromEl = qs('#dateFrom');
const dateToEl   = qs('#dateTo');
const unitSel    = qs('#unitSelect');
const applyBtn   = qs('#applyBtn');
const rangeBtns  = [...document.querySelectorAll('.range-btn')];
const slotBtns   = [...document.querySelectorAll('.slot')];

const stCount = qs('#stCount'), stAvg=qs('#stAvg'), stStd=qs('#stStd'),
      stTir=qs('#stTir'), stHigh=qs('#stHigh'), stLow=qs('#stLow');

const btnCSV = qs('#btnCSV'), btnPDF=qs('#btnPDF'), backBtn=qs('#backBtn');

/* AI */
const aiWidget = qs('#aiWidget'), aiMin=qs('#aiMin'), aiClose=qs('#aiClose'),
      aiMessages=qs('#aiMessages'), aiInput=qs('#aiInput'), aiSend=qs('#aiSend'),
      aiContext=qs('#aiContext'), btnAI=qs('#btnAI');

/* حالة */
const params = new URLSearchParams(location.search);
const childId = params.get('child');
let currentUser, childData;
let allPoints = []; // {t:Date, mmol:number, slotKey:'PRE_BREAKFAST', raw:{}}
let activeSlot = 'ALL';

/* توابع مساعدة */
const pad = n=>String(n).padStart(2,'0');
const todayStr = ()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
function addDays(d,delta){const x=new Date(d);x.setDate(x.getDate()+delta);return x;}
function fmtDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function safeNumber(x){ const n=Number(x); return isNaN(n)?0:n; }
function stddev(arr, avg){
  const n=arr.length; if(!n) return 0;
  const v = arr.reduce((a,x)=>a+Math.pow(x-avg,2),0)/n;
  return Math.sqrt(v);
}

/* تعريب/تطبيع slot */
const AR_TO_KEY = {
  'ق.الفطار':'PRE_BREAKFAST','ب.الفطار':'POST_BREAKFAST',
  'ق.الغدا':'PRE_LUNCH','ب.الغدا':'POST_LUNCH',
  'ق.العشا':'PRE_DINNER','ب.العشا':'POST_DINNER',
  'سناك':'SNACK'
};
const KEY_TO_AR = Object.entries(AR_TO_KEY).reduce((a,[ar,key])=> (a[key]=ar,a),{});

/* ضبط مبدئي */
(function initUI(){
  const today = new Date();
  const from = addDays(today,-13);
  dateFromEl.value = fmtDate(from);
  dateToEl.value   = fmtDate(today);
  unitSel.value    = 'mmol';
})();

/* جلسة */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href='index.html';
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;
  await loadChild();
  await loadMeasurements();
  computeAndRender();
});

/* تحميل بيانات الطفل */
async function loadChild(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const s = await getDoc(ref);
  if(!s.exists()) { alert('لم يتم العثور على الطفل'); return; }
  childData = s.data();

  const age = (()=>{ if(!childData.birthDate) return '—';
    const b=new Date(childData.birthDate), t=new Date();
    let a=t.getFullYear()-b.getFullYear();
    const m=t.getMonth()-b.getMonth();
    if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
    return a;
  })();

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent =
    `السن: ${age} • النطاق: ${childData?.normalRange?.min ?? '—'}–${childData?.normalRange?.max ?? '—'} mmol/L • CR: ${childData?.carbRatio ?? '—'} g/U • CF: ${childData?.correctionFactor ?? '—'} mmol/L/U`;
}

/* تحميل القياسات */
async function loadMeasurements(){
  const from = new Date(dateFromEl.value);
  const to   = new Date(dateToEl.value);
  // تو تاريخ النهاية ليس شاملاً: نزوده يوم
  const toInc = addDays(to,1);

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, where('when','>=', from), where('when','<', toInc), orderBy('when','asc'));
  const snap= await getDocs(qy);

  allPoints = [];
  snap.forEach(d=>{
    const m = d.data();

    // وقت القياس
    const when = m.when?.toDate ? m.when.toDate() : (m.when ? new Date(m.when) : null);
    if(!when || isNaN(when)) return;

    // القيمة: نجمع كل الاحتمالات
    let mmol = null;
    if (typeof m.value_mmol === 'number') mmol = m.value_mmol;
    else if (typeof m.value === 'number' && (m.unit?.toLowerCase()||'')==='mmol/l') mmol = m.value;
    else if (typeof m.value_mgdl === 'number') mmol = m.value_mgdl / 18;
    else if (typeof m.value === 'number' && (m.unit?.toLowerCase()||'')==='mg/dl') mmol = m.value / 18;
    if (mmol==null) return;

    // Slot باللغة الإنجليزية إن أمكن
    let key = m.slotKey || null;
    if(!key && m.slot && AR_TO_KEY[m.slot]) key = AR_TO_KEY[m.slot];
    if(!key) key = 'OTHER';

    allPoints.push({ t: when, mmol: Number(mmol), slotKey: key, raw: m });
  });
}

/* إحصاءات + رسوم */
let lineChart, pieChart;

function filteredPoints(){
  if(activeSlot==='ALL') return allPoints;
  return allPoints.filter(p=> p.slotKey===activeSlot);
}

function computeAndRender(){
  const pts = filteredPoints();
  const unit = unitSel.value; // 'mmol' | 'mgdl'

  // تحويل للقيمة المطلوبة للعرض
  const toDisp = (x)=> unit==='mmol' ? x : Math.round(x*18);
  const dispUnit = unit==='mmol' ? 'mmol/L' : 'mg/dL';

  // بيانات المنحنى
  const dataset = pts.map(p=> ({ x:p.t, y: toDisp(p.mmol) }));

  // إحصاءات
  const arrMmol = pts.map(p=> p.mmol);
  const count = arrMmol.length;
  const avgM = count ? (arrMmol.reduce((a,b)=>a+b,0)/count) : 0;
  const stdM = stddev(arrMmol, avgM);

  // TIR حسب نطاق الطفل
  const nMin = Number(childData?.normalRange?.min ?? 4.0);
  const nMax = Number(childData?.normalRange?.max ?? 10.0);

  let inRange=0, high=0, low=0;
  arrMmol.forEach(v=>{
    if (v < nMin) low++; else if (v>nMax) high++; else inRange++;
  });
  const tir = count? Math.round((inRange/count)*100):0;

  stCount.textContent = count || '—';
  stAvg.textContent   = count? (unit==='mmol'? avgM.toFixed(1) : Math.round(avgM*18)) : '—';
  stStd.textContent   = count? (unit==='mmol'? stdM.toFixed(1) : Math.round(stdM*18)) : '—';
  stTir.textContent   = count? `${tir}%`:'—';
  stHigh.textContent  = count? `${Math.round(high*100/count)}%`:'—';
  stLow.textContent   = count? `${Math.round(low*100/count)}%`:'—';

  // خط الزمن
  renderLine(dataset, dispUnit, unit==='mmol'? null : {y: {suggestedMin:40, suggestedMax:220}});

  // باي حسب slot
  renderPie();
}

function renderLine(data, unitLabel, opts){
  const ctx = document.getElementById('lineChart');
  if(lineChart) lineChart.destroy();

  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: `Glucose (${unitLabel})`,
        data,
        borderColor: '#4F46E5',
        backgroundColor: 'rgba(79,70,229,.12)',
        pointRadius: 2,
        tension: .25
      }]
    },
    options: {
      parsing:false,
      responsive:true,
      maintainAspectRatio:false,
      scales:{
        x:{
          type:'time',
          adapters:{ date: { locale: dateFns.localeArEG } },
          time:{ unit:'day' }
        },
        y:{ title:{ display:true, text:unitLabel }, grid:{ color:'#eee' }, ...opts?.y }
      },
      plugins:{
        legend:{ display:false },
        tooltip:{ mode:'nearest', intersect:false }
      }
    }
  });
}

function renderPie(){
  const counts = {
    PRE_BREAKFAST:0, POST_BREAKFAST:0,
    PRE_LUNCH:0, POST_LUNCH:0,
    PRE_DINNER:0, POST_DINNER:0,
    SNACK:0, OTHER:0
  };
  allPoints.forEach(p=>{ counts[p.slotKey] = (counts[p.slotKey]||0)+1; });

  const labels = Object.keys(counts).map(k=> KEY_TO_AR[k] || k);
  const values = Object.keys(counts).map(k=> counts[k]);

  const ctx = document.getElementById('pieChart');
  if(pieChart) pieChart.destroy();

  pieChart = new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data:values }]},
    options:{ plugins:{ legend:{ position:'bottom' } } }
  });
}

/* CSV */
btnCSV?.addEventListener('click', ()=>{
  const unit = unitSel.value;
  const header = 'date,time,slot,value,'+unit+'\n';
  const rows = filteredPoints().map(p=>{
    const d = p.t; const ds = fmtDate(d); const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const v = unit==='mmol' ? p.mmol.toFixed(1) : Math.round(p.mmol*18);
    return `${ds},${ts},${KEY_TO_AR[p.slotKey]||p.slotKey},${v},${unit}`;
  }).join('\n');
  const blob = new Blob([header+rows], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='measurements.csv'; a.click();
  URL.revokeObjectURL(url);
});

/* PDF/طباعة */
btnPDF?.addEventListener('click', ()=> window.print() );

/* Range / Apply */
applyBtn.addEventListener('click', async ()=>{
  await loadMeasurements(); computeAndRender();
});
rangeBtns.forEach(b=>{
  b.addEventListener('click', async ()=>{
    rangeBtns.forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const r = b.dataset.range;
    const to = new Date();
    let from = new Date('2000-01-01');
    if (r==='14d') from = addDays(to,-13);
    if (r==='30d') from = addDays(to,-29);
    if (r==='90d') from = addDays(to,-89);
    dateFromEl.value=fmtDate(from); dateToEl.value=fmtDate(to);
    await loadMeasurements(); computeAndRender();
  });
});
slotBtns.forEach(b=>{
  b.addEventListener('click', ()=>{
    slotBtns.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    activeSlot = b.dataset.slot || 'ALL';
    computeAndRender();
  });
});
unitSel.addEventListener('change', computeAndRender);

/* رجوع */
backBtn?.addEventListener('click', ()=>{
  // لو وصلنا من child.html نرجع له بنفس childId
  location.href = `child.html?child=${encodeURIComponent(childId)}`;
});

/* ========== مساعد Gemini (اختياري) ========== */
// ضعي مفتاح Gemini في window.GEMINI_API_KEY من صفحة parent.html أو ملف منفصل
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

btnAI?.addEventListener('click', ()=>{
  aiWidget.classList.remove('hidden');
  aiContext.textContent = `سياق: ${childData?.name || 'طفل'} / ${filteredPoints().length} قياسًا في الفترة المحددة.`;
  addMsg('sys', 'مرحبًا! اسأل عن المتوسط، TIR، المرتفعات، أو امنحني فترة محددة للمقارنة.');
});
aiClose?.addEventListener('click', ()=> aiWidget.classList.add('hidden'));
aiMin?.addEventListener('click', ()=>{
  const b = aiWidget.style.height==='54px';
  aiWidget.style.height = b? '' : '54px';
  qs('.ai-body').style.display = b? '' : 'none';
  qs('.ai-input').style.display= b? '' : 'none';
});
aiSend?.addEventListener('click', sendAI);
aiInput?.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){e.preventDefault(); sendAI();}});

function addMsg(role, text){
  const div=document.createElement('div');
  div.className = 'msg ' + (role==='assistant'?'assistant': role==='user'?'user':'sys');
  div.textContent = text;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

async function sendAI(){
  const key = (window.GEMINI_API_KEY||'').trim();
  const q = aiInput.value.trim();
  if(!q) return;
  aiInput.value=''; addMsg('user', q);

  const stats = {
    count: stCount.textContent, avg: stAvg.textContent, std: stStd.textContent,
    tir: stTir.textContent, high: stHigh.textContent, low: stLow.textContent,
    unit: unitSel.value
  };
  const prompt = `
حلّل القياسات لطفل سكري بناءً على الإحصاءات التالية:
count=${stats.count}, avg=${stats.avg}, std=${stats.std}, tir=${stats.tir}, high=${stats.high}, low=${stats.low}, unit=${stats.unit}.
سؤال المستخدم: ${q}
قدّم إجابة عربية مبسطة وتعليمية، وتجنّب أي إرشادات علاجية إلزامية.
`.trim();

  if(!key){ addMsg('assistant','⚠️ لم يتم ضبط مفتاح Gemini.'); return; }

  addMsg('assistant','… جارِ التحليل');

  try{
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        contents:[{ parts:[{text: prompt}] }]
      })
    });
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'لم أحصل على رد.';
    aiMessages.lastChild.textContent = text;
  }catch(e){
    aiMessages.lastChild.textContent = 'تعذّر الاتصال بالمساعد.';
    console.error(e);
  }
}
