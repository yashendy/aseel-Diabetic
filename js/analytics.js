// --------- إعدادات أساسية ----------
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, where,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (s)=>document.querySelector(s);
const loaderEl = $('#loader'); const loader = (v)=>loaderEl.classList.toggle('hidden',!v);

const qs = new URLSearchParams(location.search);
const childId = qs.get('child') || localStorage.getItem('lastChildId');
if(!childId){ location.replace('parent.html?pickChild=1'); throw new Error('no child'); }

const childNameEl = $('#childName');
const childMetaEl = $('#childMeta');
const chipRangeEl = $('#chipRange');
const chipCREl = $('#chipCR');
const chipCFEl = $('#chipCF');

const rangeSel = $('#range');
const startInp = $('#start');
const endInp   = $('#end');
const unitSel  = $('#unit');
const btnApply = $('#apply');

const slotBar  = $('#slotBar');
const dailyLine= $('#dailyLine');
const insightsList = $('#insightsList');
const printBtn = $('#printBtn');

// KPIs
const kpiTIR  = $('#kpiTIR');
const kpiHigh = $('#kpiHigh');
const kpiLow  = $('#kpiLow');
const kpiMean = $('#kpiMean');
const kpiSD   = $('#kpiSD');
const kpiCount= $('#kpiCount');
// deltas
const deltaTIR  = $('#deltaTIR');
const deltaHigh = $('#deltaHigh');
const deltaLow  = $('#deltaLow');
const deltaMean = $('#deltaMean');
const deltaSD   = $('#deltaSD');
const deltaCount= $('#deltaCount');

// خريطة سلوطات موحّدة (lowercase مثل القياسات)
const SLOT_MAP = {
  WAKE:'wake',
  PRE_BF:'pre_bf', POST_BF:'post_bf',
  PRE_LUNCH:'pre_ln', POST_LUNCH:'post_ln',
  PRE_DIN:'pre_dn', POST_DIN:'post_dn',
  SNACK:'snack',
  PRE_SLEEP:'pre_sleep', MIDNIGHT:'during_sleep',
  PRE_SPORT:'pre_sport', POST_SPORT:'post_sport',
};
const SLOTS = [
  {key:'wake',label:'الاستيقاظ'},
  {key:'pre_bf',label:'ق.الفطار'},{key:'post_bf',label:'ب.الفطار'},
  {key:'pre_ln',label:'ق.الغداء'},{key:'post_ln',label:'ب.الغداء'},
  {key:'pre_dn',label:'ق.العشاء'},{key:'post_dn',label:'ب.العشاء'},
  {key:'snack',label:'سناك'},
  {key:'pre_sleep',label:'ق.النوم'},{key:'during_sleep',label:'أثناء النوم'},
];
const SLOT_LABEL = Object.fromEntries(SLOTS.map(s=>[s.key,s.label]));

// مجموعات فلترة
const GROUPS = {
  all: new Set(SLOTS.map(s=>s.key)),
  pre: new Set(['wake','pre_bf','pre_ln','pre_dn','pre_sleep','pre_sport']),
  post:new Set(['post_bf','post_ln','post_dn','post_sport']),
  sleep:new Set(['pre_sleep','during_sleep']),
  snack:new Set(['snack']),
};
let activeGroup = 'all';

const pad=(n)=>String(n).padStart(2,'0');
const fmtDate=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays=(d,dd)=>{const x=new Date(d);x.setDate(x.getDate()+dd);return x;};
const toMgdl = mmol => Math.round(Number(mmol)*18);
const toMmol = mgdl => Number(mgdl)/18;

let user, child, limits = {min:4,max:7}, cf=null, cr=null;

// --------- تشغيل ----------
onAuthStateChanged(auth, async (u)=>{
  if(!u){location.href='index.html';return;}
  user=u;

  try{
    loader(true);
    await loadChild();
    initFilters();
    readRangeFromURL();
    await apply(true); // with comparison
  }finally{
    loader(false);
  }
});

// --------- تحميل بيانات الطفل ----------
async function loadChild(){
  const ref = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); throw 0; }
  child = snap.data();

  limits = {
    min: Number(child.normalRange?.min ?? 4),
    max: Number(child.normalRange?.max ?? 7),
  };
  cr = child.carbRatio!=null?Number(child.carbRatio):null;
  cf = child.correctionFactor!=null?Number(child.correctionFactor):null;

  childNameEl.textContent = child.name||'طفل';
  childMetaEl.textContent = `${child.gender||'—'} • العمر: ${calcAge(child.birthDate)} سنة`;
  chipRangeEl.textContent = `النطاق: ${limits.min}–${limits.max} mmol/L`;
  chipCREl.textContent = `CR: ${cr ?? '—'} g/U`;
  chipCFEl.textContent = `CF: ${cf ?? '—'} mmol/L/U`;
}

function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return a;
}

// --------- فلاتر ----------
function initFilters(){
  const end=new Date(); const start=addDays(end,-14);
  startInp.value=fmtDate(start); endInp.value=fmtDate(end);

  rangeSel.addEventListener('change',()=>{
    const custom = rangeSel.value==='custom';
    startInp.classList.toggle('hidden',!custom);
    endInp.classList.toggle('hidden',!custom);
  });
  btnApply.addEventListener('click', ()=>apply(true));
  unitSel.addEventListener('change', ()=>apply(false)); // مجرد إعادة رسم/حساب

  // slot group buttons
  document.querySelectorAll('.slot-filters .seg').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.slot-filters .seg').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activeGroup = btn.dataset.slot || 'all';
      apply(false); // فلترة محلية
    });
  });

  // print
  printBtn?.addEventListener('click', ()=> window.print());

  // اضبط الكانفاس للدقة العالية
  makeCrispCanvas(slotBar);
  makeCrispCanvas(dailyLine);
}

function readRangeFromURL(){
  const s = qs.get('start'), e = qs.get('end');
  if(s && e){
    rangeSel.value='custom';
    startInp.classList.remove('hidden');
    endInp.classList.remove('hidden');
    startInp.value = s;
    endInp.value = e;
  }
}

function resolveRange(){
  if(rangeSel.value==='custom'){
    return {start:startInp.value, end:endInp.value};
  }
  const now=new Date(); const map={ '7d':7, '14d':14, '30d':30 };
  const d=map[rangeSel.value]||14;
  return { start: fmtDate(addDays(now,-d)), end: fmtDate(now) };
}

// --------- تحميل القياسات + التحليل ----------
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
      const prevAll   = await fetchRows(prevStart, prevEnd);
      const prevRows  = filterByGroup(prevAll, activeGroup);
      renderDeltas(rows, prevRows);
    }
  }catch(e){
    console.error(e); alert('تعذر تحميل التحليل');
  }finally{ loader(false); }
}

function diffDays(a,b){
  const d1=new Date(a), d2=new Date(b);
  return Math.round((d2 - d1)/(1000*60*60*24));
}

async function fetchRows(start,end){
  const col = collection(db, `parents/${user.uid}/children/${childId}/measurements`);
  const qy = query(col, where('date','>=',start), where('date','<=',end));
  const snap = await getDocs(qy);

  // طبيع القيم: slot و value_mmol
  return snap.docs.map(d=>d.data()).map(r=>{
    const slot = r.slot || SLOT_MAP[r.slotKey] || r.slotKey || 'other';
    let mmol = (typeof r.value_mmol==='number') ? r.value_mmol : null;
    if(mmol==null && typeof r.value_mgdl==='number') mmol = toMmol(r.value_mgdl);
    return {
      ...r,
      slot,
      value_mmol: mmol,
    };
  }).filter(r=> typeof r.value_mmol === 'number' && !isNaN(r.value_mmol));
}

function filterByGroup(rows, groupKey){
  const set = GROUPS[groupKey] || GROUPS.all;
  return rows.filter(r => set.has(r.slot));
}

// --------- KPIs ----------
function renderKPIs(rows){
  const toU = (x)=> unitSel.value==='mgdl' ? (x*18) : x;

  const vals = rows.map(r=>r.value_mmol);
  const n = vals.length;

  if(n===0){
    kpiTIR.textContent='0%'; kpiHigh.textContent='0%'; kpiLow.textContent='0%';
    kpiMean.textContent='—'; kpiSD.textContent='—'; kpiCount.textContent='0';
    return;
  }

  const inRange = vals.filter(v=> v>=limits.min && v<=limits.max ).length;
  const highs   = vals.filter(v=> v>limits.max).length;
  const lows    = vals.filter(v=> v<limits.min).length;

  const mean = vals.reduce((a,b)=>a+b,0)/n;
  const sd   = Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/n);

  kpiTIR.textContent  = ((inRange/n)*100).toFixed(0)+'%';
  kpiHigh.textContent = ((highs/n)*100).toFixed(0)+'%';
  kpiLow.textContent  = ((lows/n)*100).toFixed(0)+'%';
  kpiMean.textContent = unitSel.value==='mgdl' ? Math.round(toU(mean)) : mean.toFixed(1);
  kpiSD.textContent   = unitSel.value==='mgdl' ? Math.round(toU(sd))   : sd.toFixed(1);
  kpiCount.textContent= String(n);
}

function setDelta(el, val, betterIfDown=false){
  if(el==null) return;
  if(!isFinite(val)){ el.textContent='—'; el.className='d neu'; return; }
  const sign = val>0 ? '+' : (val<0? '−' : '±');
  const abs  = Math.abs(val);
  el.textContent = (abs>=0.1 ? `${sign}${abs.toFixed(1)}` : '±0.0');
  const good = betterIfDown ? (val<0) : (val>0);
  el.className = 'd ' + (val===0 ? 'neu' : (good?'pos':'neg'));
}

function renderDeltas(currRows, prevRows){
  const percent = (p)=> isFinite(p) ? Math.round(p*100) : 0;

  const pct = rows=>{
    const n = rows.length || 1;
    const vals = rows.map(r=>r.value_mmol);
    const inR = vals.filter(v=> v>=limits.min && v<=limits.max ).length / n;
    const hi  = vals.filter(v=> v>limits.max).length / n;
    const lo  = vals.filter(v=> v<limits.min).length / n;
    const mean = vals.reduce((a,b)=>a+b,0)/(rows.length||1);
    const sd   = Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/(rows.length||1));
    return { tir:inR, high:hi, low:lo, mean, sd, count:rows.length };
  };

  const a = pct(currRows), b = pct(prevRows);
  setDelta(deltaTIR,  percent(a.tir - b.tir), false); // higher is better
  setDelta(deltaHigh, percent(b.high - a.high), false); // show as improvement when down
  setDelta(deltaLow,  percent(b.low  - a.low ), false); // down is better (أقل هبوطات)
  setDelta(deltaMean, (unitSel.value==='mgdl' ? (toMgdl(a.mean)-toMgdl(b.mean)) : (a.mean-b.mean)), true);
  setDelta(deltaSD,   (unitSel.value==='mgdl' ? (toMgdl(a.sd)-toMgdl(b.sd))     : (a.sd-b.sd)), true);
  setDelta(deltaCount, a.count - b.count, false);
}

// --------- رسم: إعداد Canvas بدقة عالية ----------
function makeCrispCanvas(canvas){
  if(!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  // ملاحظة: عند تغيير حجم الوعاء (CSS) أعِد استدعاء makeCrispCanvas ثم أعد الرسم
  window.addEventListener('resize', ()=>{ makeCrispCanvas(canvas); apply(false); }, {passive:true});
}

function clearCanvas(c){ c.getContext('2d').clearRect(0,0,c.width,c.height); }

// --------- رسم: توزيع حسب وقت القياس ----------
function renderSlotBar(rows){
  makeCrispCanvas(slotBar);
  const ctx = slotBar.getContext('2d');
  clearCanvas(slotBar);

  // تجميع حسب slot
  const groups = {};
  SLOTS.forEach(s=>groups[s.key]=[]);
  rows.forEach(r=>{
    (groups[r.slot]??=([])).push(r.value_mmol);
  });

  const keys = SLOTS.map(s=>s.key);
  const labels = SLOTS.map(s=>SLOT_LABEL[s.key]);
  const counts = keys.map(k=> (groups[k]||[]).length );
  const maxC = Math.max(1, ...counts);

  // رسم
  const rect = slotBar.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  const pad = 28, gap = 6;
  const barW = Math.max(6, (w - pad*2 - gap*(keys.length-1)) / keys.length);

  ctx.font = '12px Segoe UI';
  ctx.textAlign='center';

  keys.forEach((k,i)=>{
    const group = groups[k] || [];
    const c = group.length;
    const bh = (c/maxC)*Math.max(40,(h-80));
    const x = pad + i*(barW+gap);
    const y = h-34 - bh;

    // ألوان حسب الحالة
    const highs = group.filter(v=>v>limits.max).length;
    const lows  = group.filter(v=>v<limits.min).length;
    let color = '#4f46e5'; // افتراضي
    if (c>0){
      if (highs / c > 0.5) color = '#ef4444'; // أحمر ارتفاعات
      else if (lows / c > 0.5) color = '#2563eb'; // أزرق هبوطات
    }

    ctx.fillStyle = color;
    ctx.fillRect(x,y,barW,bh);

    // العدد
    ctx.fillStyle = '#111';
    if(c>0) ctx.fillText(String(c), x+barW/2, y-4);
    // الليبل
    ctx.fillStyle = '#555';
    const lbl = labels[i];
    ctx.save(); // لو ضيّق، نقلب نص بزاوية خفيفة في الشاشات الصغيرة
    ctx.translate(x+barW/2, h-12);
    if(barW<40){ ctx.rotate(-Math.PI/12); }
    ctx.fillText(lbl, 0, 0);
    ctx.restore();
  });

  // المحور
  ctx.strokeStyle='#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(pad,h-28); ctx.lineTo(w-pad,h-28);
  ctx.stroke();
}

// --------- رسم: متوسط كل يوم ----------
function renderDailyLine(rows){
  makeCrispCanvas(dailyLine);
  const ctx = dailyLine.getContext('2d');
  clearCanvas(dailyLine);

  // تجميع حسب التاريخ
  const byDate = {};
  rows.forEach(r=>{
    (byDate[r.date]??=([])).push(r.value_mmol);
  });
  const dates = Object.keys(byDate).sort(); // yyyy-mm-dd
  const avgs = dates.map(d=>{
    const a=byDate[d]; return a.reduce((x,y)=>x+y,0)/a.length;
  });

  if(!dates.length){ return; }

  const toUnit = x => unitSel.value==='mgdl' ? x*18 : x;

  const rect = dailyLine.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  const pad = 32;

  const minY = Math.min(...avgs, limits.min) - 0.5;
  const maxY = Math.max(...avgs, limits.max) + 0.5;

  const xOf = i => pad + i * ( (w-2*pad)/(dates.length-1||1) );
  const yOf = v => h - pad - ( (toUnit(v)-toUnit(minY)) / Math.max(0.0001,(toUnit(maxY)-toUnit(minY))) ) * (h-2*pad);

  // محاور
  ctx.strokeStyle='#e5e7eb';
  ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(pad,h-pad); ctx.lineTo(w-pad,h-pad); // X
  ctx.moveTo(pad,pad);   ctx.lineTo(pad,h-pad);   // Y
  ctx.stroke();

  // نطاق طبيعي
  ctx.fillStyle='rgba(22,163,74,.12)';
  const yTop = yOf(limits.max), yBot = yOf(limits.min);
  ctx.fillRect(pad, yTop, w-2*pad, (yBot-yTop));

  // خط المتوسطات
  ctx.strokeStyle='#4f46e5'; ctx.lineWidth=2;
  ctx.beginPath();
  dates.forEach((d,i)=>{
    const x=xOf(i), y=yOf(avgs[i]);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // نقاط
  ctx.fillStyle='#4f46e5';
  dates.forEach((d,i)=>{
    const x=xOf(i), y=yOf(avgs[i]);
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
  });

  // تسميات بسيطة
  ctx.fillStyle='#748094'; ctx.font='12px Segoe UI'; ctx.textAlign='center';
  dates.forEach((d,i)=>{ ctx.fillText(d.slice(5), xOf(i), h-6); });
}

// --------- رؤى واقتراحات ----------
function renderInsights(rows){
  insightsList.innerHTML = '';
  if(!rows.length){ insightsList.innerHTML = '<li>لا توجد قياسات في هذه الفترة.</li>'; return; }

  const highs = rows.filter(r=>r.value_mmol>limits.max);
  const lows  = rows.filter(r=>r.value_mmol<limits.min);

  const bySlot = {};
  rows.forEach(r=>{
    (bySlot[r.slot]??=([])).push(r.value_mmol);
  });

  const slotHigh = topSlot(bySlot, v=> v>limits.max );
  const slotLow  = topSlot(bySlot, v=> v<limits.min );

  const ul = insightsList;

  if(slotHigh)
    ul.append(li(`أكثر ارتفاعات تظهر في: <b>${SLOT_LABEL[slotHigh.key]||slotHigh.key}</b> (%${slotHigh.percent}) — راجعي جرعات الكارب (CR) إن كانت الارتفاعات <b>بعد الوجبة</b>، أو راجعي CF/القاعدي إن كانت <b>قبل الوجبة</b>.`));

  if(slotLow)
    ul.append(li(`أكثر هبوطات تظهر في: <b>${SLOT_LABEL[slotLow.key]||slotLow.key}</b> (%${slotLow.percent}) — راجعي توقيت الجرعات والوجبات، وقد تحتاج وجبة سناك أو ضبط القاعدي.`));

  const manyCorrections = rows.filter(r => (r.correctionDose||0) > 0).length / (rows.length||1) > 0.25;
  if(manyCorrections && highs.length/(rows.length||1) > .2)
    ul.append(li(`تم استخدام جرعات تصحيحية بشكل متكرر مع استمرار الارتفاعات. قد يشير هذا إلى أن <b>CF</b> أقل من المطلوب.`));

  const byDate = {};
  rows.forEach(r=> (byDate[r.date]??=([])).push(r.value_mmol));
  const best = Object.entries(byDate).map(([d,arr])=>{
    const inR = arr.filter(v=> v>=limits.min && v<=limits.max).length;
    return {date:d, tir: (inR/arr.length)*100};
  }).sort((a,b)=>b.tir-a.tir)[0];
  if(best) ul.append(li(`اليوم الأكثر استقرارًا: <b>${best.date}</b> (TIR ${best.tir.toFixed(0)}%).`));

  if(!ul.children.length)
    ul.append(li('لا توجد ملاحظات لافتة — استمري على نفس الخطة 👏'));
}

function topSlot(bySlot, pred){
  let best=null;
  for(const [k,arr] of Object.entries(bySlot)){
    if(!arr.length) continue;
    const hits = arr.filter(pred).length;
    const p = Math.round((hits/arr.length)*100);
    if(!best || p>best.percent) best={key:k, percent:p};
  }
  return best && best.percent>0 ? best : null;
}

function li(html){ const e=document.createElement('li'); e.innerHTML=html; return e; }
