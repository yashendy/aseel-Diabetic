// analytics.js — التحليلات (وضع "متوسط الأيام" + إصلاحات الرسم/السبينر)
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- DOM & Helpers ---------- */
const $ = (id)=>document.getElementById(id);
const toast = (m)=>{ const t=$('toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',1800); };

const todayISO = ()=> new Date().toISOString().slice(0,10);
const addDays = (iso, d)=>{ const t=new Date(iso); t.setDate(t.getDate()+d); return t.toISOString().slice(0,10); };
const toStart = (iso)=> new Date(`${iso}T00:00:00`);
const toEnd   = (iso)=> new Date(`${iso}T23:59:59`);
const round1 = (n)=> Math.round((Number(n)||0)*10)/10;

function normalizeState(s){
  if(!s) return s;
  const t=String(s).trim().toLowerCase();
  if(t==='normal'||s==='داخل النطاق'||s==='طبيعي') return 'داخل النطاق';
  if(t==='low'||s==='هبوط') return 'هبوط';
  if(t==='high'||s==='ارتفاع') return 'ارتفاع';
  if(t==='severe high'||s==='ارتفاع شديد') return 'ارتفاع شديد';
  if(t==='critical low'||s==='هبوط حرج') return 'هبوط حرج';
  if(t==='critical high'||s==='ارتفاع حرج') return 'ارتفاع حرج';
  return s;
}

/* ---------- State ---------- */
let currentUser, childId, childRef, childDoc, measCol;
let lineChart, pieChart;
let chartMode = 'series'; // 'series' | 'avgday'

/* ---------- Severe lines plugin (آمن) ---------- */
const severeLinesPlugin = {
  id: 'severeLinesPlugin',
  afterDatasetsDraw(chart, args, opts) {
    const y = chart.scales?.y;
    const area = chart.chartArea;
    if (!y || !area) return;

    const unit = opts?.unit || 'mmol/L';
    const low  = Number(opts?.low);
    const high = Number(opts?.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;

    const L = unit.includes('mg') ? low  * 18 : low;
    const H = unit.includes('mg') ? high * 18 : high;

    const ctx = chart.ctx;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;

    // low (أزرق)
    ctx.strokeStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.moveTo(area.left,  y.getPixelForValue(L));
    ctx.lineTo(area.right, y.getPixelForValue(L));
    ctx.stroke();

    // high (أحمر)
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(area.left,  y.getPixelForValue(H));
    ctx.lineTo(area.right, y.getPixelForValue(H));
    ctx.stroke();

    ctx.restore();
  }
};

/* ---------- Boot ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  currentUser=user;

  const p = new URLSearchParams(location.search);
  childId = (p.get('child')||'').trim();
  if(!childId){ toast('لا يوجد child في الرابط'); return; }

  const urlFrom=p.get('from'), urlTo=p.get('to');
  const to = todayISO(), from = addDays(to,-13);
  $('fromDate').value = urlFrom || from;
  $('toDate').value   = urlTo   || to;

  await loadChild();
  $('unitSelect').value = childDoc.glucoseUnit || 'mg/dL';

  wire();
  await refresh();
});

/* ---------- Load child ---------- */
async function loadChild(){
  childRef = doc(db,'parents',auth.currentUser.uid,'children',childId);
  const s = await getDoc(childRef);
  if(!s.exists()) throw new Error('child-not-found');
  childDoc = s.data()||{};
  measCol  = collection(childRef,'measurements');

  const unit = childDoc.glucoseUnit || 'mg/dL';
  $('childName').textContent = childDoc.displayName || childDoc.name || 'الطفل';
  $('childMeta').textContent = `الوحدة الافتراضية: ${unit} • CR: ${childDoc.carbRatio??'—'} g/U • CF: ${childDoc.correctionFactor??'—'} ${unit}/U`;

  $('childChips').innerHTML = `
    <span class="chip">الوحدة: ${unit}</span>
    <span class="chip">CR: ${childDoc.carbRatio??'—'} g/U</span>
    <span class="chip">CF: ${childDoc.correctionFactor??'—'} ${unit}/U</span>`;
}

/* ---------- Fetch by when ---------- */
async function fetchRange(fromISO, toISO){
  const qy = query(
    measCol,
    where('when','>=', toStart(fromISO)),
    where('when','<=', toEnd(toISO)),
    orderBy('when','asc')
  );
  const snap = await getDocs(qy);

  const rows=[];
  snap.forEach(d=>{
    const x=d.data();
    let when = x.when?.toDate ? x.when.toDate() : (x.when ? new Date(x.when) : null);
    const dateStr = x.date || (when ? when.toISOString().slice(0,10) : null);
    if (!when && dateStr) when = new Date(`${dateStr}T12:00:00`);

    const valMmol = Number.isFinite(x.value_mmol) ? Number(x.value_mmol)
                  : (x.unit==='mg/dL' ? Number(x.value)/18 : Number(x.value));
    const valMgdl = Number.isFinite(x.value_mgdl) ? Number(x.value_mgdl)
                  : (x.unit==='mmol/L' ? Number(x.value)*18 : Number(x.value));

    rows.push({
      id:d.id, when, date: dateStr,
      val_mmol: valMmol, val_mgdl: valMgdl,
      state: normalizeState(x.state)
    });
  });
  return rows;
}

/* ---------- Stats ---------- */
function computeStats(list, unitOut='mmol/L'){
  if(!list.length) return {count:0, avg:0, sd:0, cv:0, tbr:0, tir:0, tar:0, sevLow:3.0, sevHigh:13.9};

  const R = childDoc?.normalRange || {};
  const sevLow  = Number.isFinite(R.severeLow)  ? R.severeLow  : (Number.isFinite(R.criticalLow) ? R.criticalLow : 3.0);
  const sevHigh = Number.isFinite(R.severeHigh) ? R.severeHigh : (Number.isFinite(R.criticalHigh)? R.criticalHigh: 13.9);

  const valsMmol = list.map(p=>p.val_mmol);
  const n = valsMmol.length;
  const mean = valsMmol.reduce((a,x)=>a+x,0)/n;
  const sd = Math.sqrt(valsMmol.reduce((a,x)=>a+(x-mean)**2,0)/n);
  const cv = mean>0 ? sd/mean*100 : 0;

  const tbr = valsMmol.filter(v=> v < sevLow ).length / n * 100;
  const tar = valsMmol.filter(v=> v > sevHigh).length / n * 100;
  const tir = 100 - tbr - tar;

  const avgOut = unitOut.includes('mg') ? round1(mean*18) : round1(mean);
  return {count:n, avg:avgOut, sd:round1(sd), cv:Math.round(cv), tbr:Math.round(tbr), tir:Math.round(tir), tar:Math.round(tar), sevLow, sevHigh};
}

function setStatsUI(stats){
  const u = $('unitSelect').value;
  $('stCount').textContent = String(stats.count);
  $('stAvg').textContent = `${stats.avg} ${u}`;
  $('stSD').textContent  = String(stats.sd);
  $('stCV').textContent  = `${stats.cv}%`;
  $('stTIR').textContent = `${stats.tir}%`;
  $('stTBR').textContent = `${stats.tbr}%`;
  $('stTAR').textContent = `${stats.tar}%`;

  const sevLowLbl  = u.includes('mg') ? `${round1(stats.sevLow*18)} mg/dL` : `${round1(stats.sevLow)} mmol/L`;
  const sevHighLbl = u.includes('mg') ? `${round1(stats.sevHigh*18)} mg/dL` : `${round1(stats.sevHigh)} mmol/L`;
  $('sevLowLbl').textContent  = sevLowLbl;
  $('sevHighLbl').textContent = sevHighLbl;
}

/* ---------- Helpers: متوسط الأيام ---------- */
function makeAvgDayData(list, unitOut, bucketMin=30){
  // base = 1970-01-01؛ نستخدم time scale لعرض ساعات اليوم
  const base = new Date('1970-01-01T00:00:00');
  const bucketCount = Math.ceil(1440 / bucketMin);
  const buckets = Array.from({length: bucketCount}, ()=> []);

  for(const p of list){
    const d = p.when;
    if(!(d instanceof Date)) continue;
    const mins = d.getHours()*60 + d.getMinutes();
    const idx = Math.min(bucketCount-1, Math.floor(mins / bucketMin));
    const y = unitOut.includes('mg') ? Number(p.val_mgdl) : Number(p.val_mmol);
    if(Number.isFinite(y)) buckets[idx].push(y);
  }

  const pts=[];
  for(let i=0;i<bucketCount;i++){
    const arr=buckets[i];
    if(!arr.length) continue;
    const avg = arr.reduce((a,b)=>a+b,0)/arr.length;
    const x = new Date(base.getTime() + i*bucketMin*60000);
    pts.push({x, y: round1(avg)});
  }
  return pts;
}

/* ---------- Charts ---------- */
function ensureChartsDestroyed(){
  try{ lineChart?.destroy(); }catch(e){}
  try{ pieChart?.destroy();  }catch(e){}
}

function renderLineChart(list, unitOut, sevLow, sevHigh){
  const canvas = $('dayChart');
  const ctx = canvas.getContext('2d');

  let data;
  let xScale;

  if(chartMode === 'avgday'){
    // متوسط الأيام
    data = makeAvgDayData(list, unitOut, 30);
    xScale = {
      type:'time',
      time:{ unit:'hour', displayFormats:{hour:'h a'} },
      ticks:{ source:'auto' },
      grid:{ display:false }
    };
  }else{
    // زمني عادي
    data = list.map(p => ({
      x: p.when,
      y: unitOut.includes('mg') ? round1(p.val_mgdl) : round1(p.val_mmol)
    }));
    xScale = { type:'time', grid:{ display:false } };
  }

  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: (chartMode==='avgday' ? 'متوسط الأيام' : 'القياس'),
        data,
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79,70,229,.08)',
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: .25,
        spanGaps: true,
        parsing: false
      }]
    },
    options: {
      animation: false,
      normalized: true,
      scales: {
        x: xScale,
        y: { beginAtZero: false }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx)=> `${ctx.raw.y} ${unitOut}` } },
        severeLinesPlugin: { low: sevLow, high: sevHigh, unit: unitOut }
      }
    },
    plugins: [severeLinesPlugin]
  });

  requestAnimationFrame(()=> lineChart?.resize());
}

function renderPieChart(stats){
  const ctx = $('rangePie').getContext('2d');
  try{
    pieChart = new Chart(ctx,{
      type:'doughnut',
      data:{
        labels:['TBR (تحت الحرج المنخفض)','TIR (داخل النطاق الحرج)','TAR (فوق الحرج المرتفع)'],
        datasets:[{
          data:[stats.tbr, stats.tir, stats.tar],
          backgroundColor:['#e0f2fe','#dcfce7','#fee2e2'],
          borderWidth:1,
          borderColor:'#e5e7eb'
        }]
      },
      options:{
        plugins:{
          legend:{position:'bottom'},
          tooltip:{callbacks:{label:(c)=> `${c.label}: ${Math.round(c.parsed)}%`}}
        },
        cutout:'62%'
      }
    });
  } finally {
    showSpinner('spinnerPie', false);
  }
}

/* Feedback helpers */
function showSpinner(id, show){
  const el = $(id);
  if (!el) return;
  el.style.display = show ? '' : 'none';
}
function showError(id, msg){
  const el = $(id);
  if (!el) return;
  el.style.display = '';
  el.textContent = msg || 'تعذّر التحميل';
}

/* ---------- Refresh ---------- */
async function refresh(){
  const from = $('fromDate').value || todayISO();
  const to   = $('toDate').value   || todayISO();
  $('periodFrom').textContent = new Date(from).toLocaleDateString('ar-EG');
  $('periodTo').textContent   = new Date(to).toLocaleDateString('ar-EG');

  const unitOut = $('unitSelect').value;

  ensureChartsDestroyed();
  showSpinner('spinnerLine', true);
  showSpinner('spinnerPie',  true);
  $('errLine').style.display = 'none';
  $('errPie').style.display  = 'none';

  try{
    const list = await fetchRange(from,to);
    if(!list.length){
      showError('errLine','لا توجد قراءات في هذه الفترة');
      showError('errPie','لا توجد قراءات في هذه الفترة');
      setStatsUI({count:0,avg:0,sd:0,cv:0,tbr:0,tir:0,tar:0,sevLow:3.0,sevHigh:13.9});
      return;
    }
    const stats = computeStats(list, unitOut);
    setStatsUI(stats);
    renderLineChart(list, unitOut, stats.sevLow, stats.sevHigh);
    renderPieChart(stats);
  }catch(e){
    console.error(e);
    showError('errLine','حدث خطأ أثناء تحميل البيانات');
    showError('errPie','حدث خطأ أثناء تحميل البيانات');
  }finally{
    showSpinner('spinnerLine', false);
    showSpinner('spinnerPie',  false);
  }
}

/* ---------- Events ---------- */
function wire(){
  $('btnBack').addEventListener('click', ()=>{
    const url = new URL(location.origin + location.pathname.replace('analytics.html','reports.html'));
    url.searchParams.set('child', childId);
    url.searchParams.set('from', $('fromDate').value);
    url.searchParams.set('to', $('toDate').value);
    location.href = url.toString();
  });

  $('btnRefresh').addEventListener('click', refresh);
  $('unitSelect').addEventListener('change', refresh);
  $('fromDate').addEventListener('change', refresh);
  $('toDate').addEventListener('change', refresh);

  document.querySelectorAll('.quick-range .chip').forEach(b=>b.addEventListener('click',()=>{
    const days=Number(b.dataset.days)||7;
    const to=todayISO(), from=addDays(to, -(days-1));
    $('fromDate').value=from; $('toDate').value=to; refresh();
  }));

  // سويتش وضع الرسم
  document.querySelectorAll('#modeSeg .seg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#modeSeg .seg-btn').forEach(x=>x.classList.remove('is-active'));
      btn.classList.add('is-active');
      chartMode = btn.dataset.mode;  // 'series' | 'avgday'
      refresh();
    });
  });

  $('btnSaveLine').addEventListener('click', ()=> saveCanvasAsPng('dayChart', `line-${chartMode}-${$('fromDate').value}_to_${$('toDate').value}.png`));
  $('btnSavePie').addEventListener('click',  ()=> saveCanvasAsPng('rangePie', `tir-pie-${$('fromDate').value}_to_${$('toDate').value}.png`));
}

function saveCanvasAsPng(canvasId, fileName){
  const c = $(canvasId);
  if(!c){ toast('لا يوجد رسم للحفظ'); return; }
  const a=document.createElement('a');
  a.href=c.toDataURL('image/png', 1.0);
  a.download=fileName||'chart.png';
  a.click();
}
