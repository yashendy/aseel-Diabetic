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

const kpiTIR  = $('#kpiTIR');
const kpiHigh = $('#kpiHigh');
const kpiLow  = $('#kpiLow');
const kpiMean = $('#kpiMean');
const kpiSD   = $('#kpiSD');
const kpiCount= $('#kpiCount');

const slotBar  = $('#slotBar');
const dailyLine= $('#dailyLine');

const insightsList = $('#insightsList');

const SLOTS = [
  {key:'WAKE',label:'الاستيقاظ'},{key:'PRE_BF',label:'ق.الفطار'},{key:'POST_BF',label:'ب.الفطار'},
  {key:'PRE_LUNCH',label:'ق.الغداء'},{key:'POST_LUNCH',label:'ب.الغداء'},
  {key:'PRE_DIN',label:'ق.العشاء'},{key:'POST_DIN',label:'ب.العشاء'},
  {key:'SNACK',label:'سناك'},{key:'PRE_SLEEP',label:'ق.النوم'},{key:'MIDNIGHT',label:'أثناء النوم'},
  {key:'PRE_SPORT',label:'ق.الرياضة'},{key:'POST_SPORT',label:'ب.الرياضة'},
];
const SLOT_LABEL = Object.fromEntries(SLOTS.map(s=>[s.key,s.label]));

const pad=(n)=>String(n).padStart(2,'0');
const fmtDate=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays=(d,dd)=>{const x=new Date(d);x.setDate(x.getDate()+dd);return x;};

let user, child, limits = {min:4,max:7}, cf=null, cr=null;

// --------- تشغيل ----------
onAuthStateChanged(auth, async (u)=>{
  if(!u){location.href='index.html';return;}
  user=u;

  try{
    loader(true);
    await loadChild();
    initFilters();
    await apply();
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
  btnApply.addEventListener('click', apply);
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
async function apply(){
  loader(true);
  try{
    const {start,end} = resolveRange();

    const col = collection(db, `parents/${user.uid}/children/${childId}/measurements`);
    // بما إن التاريخ مُخزن كسلسلة yyyy-mm-dd ينفع مقارنة نصية
    const qy = query(col, where('date','>=',start), where('date','<=',end));
    const snap = await getDocs(qy);

    const rows = snap.docs.map(d=>d.data())
      .filter(r => typeof r.value_mmol === 'number' && !isNaN(r.value_mmol));

    renderKPIs(rows);
    renderSlotBar(rows);
    renderDailyLine(rows);
    renderInsights(rows);
  }catch(e){
    console.error(e); alert('تعذر تحميل التحليل');
  }finally{ loader(false); }
}

// --------- KPIs ----------
function renderKPIs(rows){
  const toUnit = (x)=> unitSel.value==='mgdl' ? (x*18) : x;

  const vals = rows.map(r=>r.value_mmol);
  const n = vals.length || 1;
  const inRange = vals.filter(v=> v>=limits.min && v<=limits.max ).length;
  const highs   = vals.filter(v=> v>limits.max).length;
  const lows    = vals.filter(v=> v<limits.min).length;

  const mean = vals.reduce((a,b)=>a+b,0)/n;
  const sd   = Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/n);

  kpiTIR.textContent  = ((inRange/n)*100).toFixed(0)+'%';
  kpiHigh.textContent = ((highs/n)*100).toFixed(0)+'%';
  kpiLow.textContent  = ((lows/n)*100).toFixed(0)+'%';
  kpiMean.textContent = formatVal(toUnit(mean));
  kpiSD.textContent   = formatVal(toUnit(sd));
  kpiCount.textContent= vals.length || 0;
}

function formatVal(v){
  if(!isFinite(v)) return '—';
  return (unitSel.value==='mgdl') ? v.toFixed(0) : v.toFixed(1);
}

// --------- رسم: توزيع حسب وقت القياس ----------
function renderSlotBar(rows){
  const ctx = slotBar.getContext('2d');
  ctx.clearRect(0,0,slotBar.width,slotBar.height);

  const groups = {};
  SLOTS.forEach(s=>groups[s.key]=[]);
  rows.forEach(r=>{
    (groups[r.slotKey]??=([])).push(r.value_mmol);
  });

  const keys = SLOTS.map(s=>s.key);
  const labels = SLOTS.map(s=>SLOT_LABEL[s.key]);
  const counts = keys.map(k=> (groups[k]||[]).length );
  const maxC = Math.max(1, ...counts);

  // رسم بسيط
  const w = slotBar.width, h = slotBar.height;
  const pad = 24, gap = 6;
  const barW = (w - pad*2 - gap*(keys.length-1)) / keys.length;

  ctx.fillStyle = '#748094';
  ctx.font = '12px Segoe UI';
  ctx.textAlign='center';

  keys.forEach((k,i)=>{
    const c = counts[i];
    const bh = (c/maxC)*(h-60);
    const x = pad + i*(barW+gap);
    const y = h-30 - bh;

    // لون بناءً على جودة هذا السلوك (أكثر هبوط/ارتفاع يبان أحمر/أصفر)
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(x,y,barW,bh);

    ctx.fillStyle = '#111';
    ctx.fillText(c, x+barW/2, y-4);
    ctx.fillStyle = '#555';
    ctx.fillText(labels[i], x+barW/2, h-10);
  });
}

// --------- رسم: متوسط كل يوم ----------
function renderDailyLine(rows){
  const ctx = dailyLine.getContext('2d');
  ctx.clearRect(0,0,dailyLine.width,dailyLine.height);

  // تجميع حسب التاريخ
  const byDate = {};
  rows.forEach(r=>{
    (byDate[r.date]??=([])).push(r.value_mmol);
  });
  const dates = Object.keys(byDate).sort(); // نصيًا كفاية لـ yyyy-mm-dd
  const avgs = dates.map(d=>{
    const a=byDate[d]; return a.reduce((x,y)=>x+y,0)/a.length;
  });

  if(!dates.length){
    // لا شيء
    return;
  }

  const toUnit = x => unitSel.value==='mgdl' ? x*18 : x;

  const w = dailyLine.width, h = dailyLine.height;
  const pad = 28;

  const minY = Math.min(...avgs, limits.min) - 0.5;
  const maxY = Math.max(...avgs, limits.max) + 0.5;

  const xOf = i => pad + i * ( (w-2*pad)/(dates.length-1||1) );
  const yOf = v => h - pad - ( (toUnit(v)-toUnit(minY)) / (toUnit(maxY)-toUnit(minY)) ) * (h-2*pad);

  // محاور
  const ctxAxis = ctx;
  ctxAxis.strokeStyle='#e5e7eb';
  ctxAxis.lineWidth=1;
  ctxAxis.beginPath();
  ctxAxis.moveTo(pad,h-pad); ctxAxis.lineTo(w-pad,h-pad); // X
  ctxAxis.moveTo(pad,pad);   ctxAxis.lineTo(pad,h-pad);   // Y
  ctxAxis.stroke();

  // نطاق طبيعي
  ctx.fillStyle='rgba(22,163,74,.1)';
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

  const vals = rows.map(r=>r.value_mmol);
  const n = vals.length || 1;

  const highs = rows.filter(r=>r.value_mmol>limits.max);
  const lows  = rows.filter(r=>r.value_mmol<limits.min);

  const bySlot = {};
  rows.forEach(r=>{
    (bySlot[r.slotKey]??=([])).push(r.value_mmol);
  });

  // أكثر وقت يحدث فيه هبوط/ارتفاع
  const slotHigh = topSlot(bySlot, v=> v>limits.max );
  const slotLow  = topSlot(bySlot, v=> v<limits.min );

  const ul = insightsList;

  if(slotHigh)
    ul.append(li(`أكثر ارتفاعات تظهر في: <b>${SLOT_LABEL[slotHigh.key]||slotHigh.key}</b> (%${slotHigh.percent}) — راجع جرعات الكارب (CR) إن كانت الارتفاعات <b>بعد الوجبة</b>، أو راجع CF/القاعدي إن كانت <b>قبل الوجبة</b>.`));

  if(slotLow)
    ul.append(li(`أكثر هبوطات تظهر في: <b>${SLOT_LABEL[slotLow.key]||slotLow.key}</b> (%${slotLow.percent}) — راجع توقيت الجرعات والوجبات، وقد تحتاج وجبة سناك أو ضبط القاعدي.`));

  // إن كان هناك Corrections كثيرة بدون هبوط كافٍ
  const manyCorrections = rows.filter(r => (r.correctionDose||0) > 0).length / n > 0.25;
  if(manyCorrections && highs.length/n > .2)
    ul.append(li(`تم استخدام جرعات تصحيحية بشكل متكرر مع استمرار الارتفاعات. قد يشير هذا إلى أن <b>CF</b> أقل من المطلوب.`));

  // اليوم الأكثر استقرارًا (أعلى TIR)
  const byDate = {};
  rows.forEach(r=> (byDate[r.date]??=([])).push(r.value_mmol));
  const best = Object.entries(byDate).map(([d,arr])=>{
    const inR = arr.filter(v=> v>=limits.min && v<=limits.max).length;
    return {date:d, tir: (inR/arr.length)*100};
  }).sort((a,b)=>b.tir-a.tir)[0];
  if(best) ul.append(li(`اليوم الأكثر استقرارًا: <b>${best.date}</b> (TIR ${best.tir.toFixed(0)}%).`));

  // لو مفيش أي بند طلع
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
