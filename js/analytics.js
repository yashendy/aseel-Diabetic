// analytics.js — متوسط لكل يوم + مقارنة بالفترة السابقة + دائرتين صغيرتين للمقارنة
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- DOM & Helpers ---------- */
const $ = (id)=>document.getElementById(id);
const qs = (sel)=>document.querySelector(sel);
const qsa= (sel)=>Array.from(document.querySelectorAll(sel));
const toast = (m)=>{ const t=$('toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',1800); };

const MS_DAY = 24*60*60*1000;
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
let lineChart, pieNow, piePrev;
let chartMode = 'avgbyday'; // 'series' | 'avgbyday'

/* ---------- Severe lines plugin ---------- */
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

/* ---------- Daily Average helpers ---------- */
function groupDailyAvg(list, unitOut){
  const map = new Map(); // key=YYYY-MM-DD => [values...]
  for(const p of list){
    if(!(p.when instanceof Date)) continue;
    const key = p.when.toISOString().slice(0,10);
    const y = unitOut.includes('mg') ? Number(p.val_mgdl) : Number(p.val_mmol);
    if(!Number.isFinite(y)) continue;
    (map.get(key) || map.set(key, []).get(key)).push(y);
  }
  const pts=[];
  for(const [key,arr] of map){
    const avg = arr.reduce((a,b)=>a+b,0)/arr.length;
    pts.push({ x: new Date(`${key}T12:00:00`), y: round1(avg), dateKey:key });
  }
  pts.sort((a,b)=>a.x-b.x);
  return pts;
}

/* حاذي الفترة السابقة على نافذة الحالية */
function shiftPointsToCurrentWindow(prevPts, currentStart, prevStart){
  const shift = currentStart.getTime() - prevStart.getTime();
  return prevPts.map(p => ({
    x: new Date(p.x.getTime() + shift),
    y: p.y,
    prevDate: p.dateKey
  }));
}

/* ---------- Charts ---------- */
function destroyCharts(){
  try{ lineChart?.destroy(); }catch{}
  try{ pieNow?.destroy(); }catch{}
  try{ piePrev?.destroy(); }catch{}
}

function renderLineChartDaily(currentPts, prevPtsShifted, unitOut, sevLow, sevHigh){
  const ctx = $('dayChart').getContext('2d');

  const datasets = [
    {
      label: 'متوسط كل يوم (حالي)',
      data: currentPts,
      borderColor: '#4f46e5',
      backgroundColor: 'rgba(79,70,229,.08)',
      tension: .25,
      pointRadius: 3,
      pointHoverRadius: 5,
      parsing: false
    }
  ];

  if(prevPtsShifted?.length){
    datasets.push({
      label: 'متوسط كل يوم (سابق)',
      data: prevPtsShifted,
      borderColor: '#9ca3af',
      backgroundColor: 'transparent',
      borderDash: [6,4],
      pointRadius: 2,
      pointHoverRadius: 4,
      parsing: false
    });
  }

  lineChart = new Chart(ctx, {
    type:'line',
    data:{ datasets },
    options:{
      animation:false,
      normalized:true,
      scales:{
        x:{ type:'time', grid:{display:false} },
        y:{ beginAtZero:false }
      },
      plugins:{
        legend:{ position:'bottom' },
        tooltip:{
          callbacks:{
            label: (c)=> `${c.dataset.label}: ${c.raw.y} ${unitOut}` +
              (c.raw.prevDate ? ` (تاريخ سابق: ${c.raw.prevDate})` : '')
          }
        },
        severeLinesPlugin: { low: sevLow, high: sevHigh, unit: unitOut }
      }
    },
    plugins:[severeLinesPlugin]
  });
}

function renderPie(canvasId, stats){
  const ctx = $(canvasId).getContext('2d');
  return new Chart(ctx,{
    type:'doughnut',
    data:{
      labels:['TBR','TIR','TAR'],
      datasets:[{
        data:[stats.tbr, stats.tir, stats.tar],
        backgroundColor:['#e0f2fe','#dcfce7','#fee2e2'],
        borderWidth:1,
        borderColor:'#e5e7eb'
      }]
    },
    options:{
      plugins:{ legend:{display:false} },
      cutout:'62%'
    }
  });
}

/* ---------- Refresh ---------- */
async function refresh(){
  const fromISO = $('fromDate').value || todayISO();
  const toISO   = $('toDate').value   || todayISO();
  const unitOut = $('unitSelect').value;
  const compare = $('compareToggle').checked;

  $('periodFrom').textContent = new Date(fromISO).toLocaleDateString('ar-EG');
  $('periodTo').textContent   = new Date(toISO).toLocaleDateString('ar-EG');

  // واجهة
  destroyCharts();
  show('spinnerLine', true);
  show('errLine', false);
  show('spinnerPieNow', true); show('errPieNow', false);
  show('spinnerPiePrev', compare); show('errPiePrev', false);
  qs('.compareOnly').style.display = compare ? '' : 'none';

  try{
    // الفترة الحالية
    const curList = await fetchRange(fromISO, toISO);
    if(!curList.length){
      show('errLine', true, 'لا توجد قراءات في الفترة الحالية');
      show('errPieNow', true, 'لا توجد قراءات في الفترة الحالية');
      return;
    }
    const curStats = computeStats(curList, unitOut);
    setStatsUI(curStats);

    // الفترة السابقة
    let prevList = [];
    if(compare){
      const days = Math.max(1, Math.round((toEnd(toISO)-toStart(fromISO))/MS_DAY)+0);
      const prevTo   = addDays(fromISO, -1);
      const prevFrom = addDays(prevTo, -(days-1));
      prevList = await fetchRange(prevFrom, prevTo);
    }

    // متوسطات يومية
    const curPts = groupDailyAvg(curList, unitOut);
    let prevPtsShifted = [];
    if(compare && prevList.length){
      const prevPts = groupDailyAvg(prevList, unitOut);
      if(prevPts.length){
        prevPtsShifted = shiftPointsToCurrentWindow(prevPts, toStart(fromISO), toStart(prevList[0].date || prevPts[0].dateKey));
      }
    }

    renderLineChartDaily(curPts, prevPtsShifted, unitOut, curStats.sevLow, curStats.sevHigh);

    // الدوائر
    pieNow  = renderPie('rangePieNow', curStats);
    show('spinnerPieNow', false);

    if(compare){
      if(prevList.length){
        const prevStats = computeStats(prevList, unitOut);
        piePrev = renderPie('rangePiePrev', prevStats);
        show('spinnerPiePrev', false);
      }else{
        show('spinnerPiePrev', false);
        show('errPiePrev', true, 'لا توجد قراءات في الفترة السابقة');
      }
    }
  }catch(e){
    console.error(e);
    show('errLine', true, 'حدث خطأ أثناء التحميل');
    show('errPieNow', true, 'حدث خطأ أثناء التحميل');
    show('spinnerPiePrev', false);
  }finally{
    show('spinnerLine', false);
  }
}

/* ---------- UI helpers ---------- */
function show(id, showIt, msg){
  const el=$(id); if(!el) return;
  const isErr = el.classList.contains('error');
  if(isErr && msg!=null) el.textContent = msg;
  el.style.display = showIt ? '' : 'none';
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
  $('compareToggle').addEventListener('change', refresh);

  qsa('.quick-range .chip').forEach(b=>b.addEventListener('click',()=>{
    const days=Number(b.dataset.days)||7;
    const to=todayISO(), from=addDays(to, -(days-1));
    $('fromDate').value=from; $('toDate').value=to; refresh();
  }));

  qsa('#modeSeg .seg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      qsa('#modeSeg .seg-btn').forEach(x=>x.classList.remove('is-active'));
      btn.classList.add('is-active');
      chartMode = btn.dataset.mode;  // 'series' | 'avgbyday'
      refresh();
    });
  });

  $('btnSaveLine').addEventListener('click', ()=>{
    const name = `line-${chartMode}-${$('fromDate').value}_to_${$('toDate').value}.png`;
    saveCanvas('dayChart', name);
  });
}

function saveCanvas(id, name){
  const c=$(id); if(!c){ toast('لا يوجد رسم'); return; }
  const a=document.createElement('a');
  a.href=c.toDataURL('image/png',1.0); a.download=name; a.click();
}
