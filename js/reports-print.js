// reports-print.js — v3
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== DOM ===== */
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl = document.getElementById('chipCR');
const chipCFEl = document.getElementById('chipCF');

const unitSel = document.getElementById('unitSel');
const notesModeSel = document.getElementById('notesMode');

const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const applyBtn = document.getElementById('applyRange');

const tbody = document.getElementById('tbody');

const slotBar = document.getElementById('slotBar');
const dailyLine = document.getElementById('dailyLine');
const insightsList = document.getElementById('insightsList');

const loaderEl = document.getElementById('loader');
const loader = (v)=> loaderEl.classList.toggle('hidden', !v);

/* ===== Helpers ===== */
const pad = n => String(n).padStart(2,'0');
const todayStr= (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (d,dd)=>{const x=new Date(d);x.setDate(x.getDate()+dd);return x;};
const fmtDate = (d)=> `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const toMgdl = mmol => Math.round(Number(mmol)*18);
const toMmol = mgdl => Number(mgdl)/18;

const SLOTS = [
  ['wake','الاستيقاظ'],
  ['pre_bf','ق.الفطار'], ['post_bf','ب.الفطار'],
  ['pre_ln','ق.الغداء'], ['post_ln','ب.الغداء'],
  ['pre_dn','ق.العشاء'], ['post_dn','ب.العشاء'],
  ['snack','سناك'],
  ['pre_sleep','ق.النوم'], ['during_sleep','أثناء النوم'],
  ['pre_ex','ق.الرياضة'], ['post_ex','ب.الرياضة'],
];
const SLOT_LABEL = Object.fromEntries(SLOTS.map(s=>[s[0],s[1]]));

function slotLabel(k){ return SLOT_LABEL[k] || k || '—'; }

function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return `${a} سنة`;
}
function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    if(/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    const tryDate = new Date(any);
    if(!isNaN(tryDate)) return todayStr(tryDate);
    return any;
  }
  const d=(any?.toDate && typeof any.toDate==='function')? any.toDate(): new Date(any);
  if(!isNaN(d)) return todayStr(d);
  return '';
}

/* ===== State ===== */
let USER=null, CHILD=null;
let normalMin=4, normalMax=7, CR=null, CF=null;

/* ===== Run ===== */
const qs = new URLSearchParams(location.search);
const childId = qs.get('child') || localStorage.getItem('lastChildId') || '';
const qFrom = qs.get('from'); const qTo = qs.get('to'); const qUnit = qs.get('unit');

onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  USER=u;
  localStorage.setItem('lastChildId', childId);

  try{
    loader(true);
    await loadChild();

    // default range
    const end = qTo ? new Date(qTo) : new Date();
    const start = qFrom ? new Date(qFrom) : addDays(end, -13);
    fromEl.value = fmtDate(start);
    toEl.value   = fmtDate(end);

    if(qUnit) unitSel.value = (qUnit==='mg' || qUnit==='mgdl') ? 'mgdl' : 'mmol';

    // load first time
    await loadAndRender();

    // UI events
    unitSel.addEventListener('change', ()=> renderTable(_rowsCache));
    notesModeSel.addEventListener('change', ()=> renderTable(_rowsCache));
    applyBtn.addEventListener('click', loadAndRender);
  }finally{
    loader(false);
  }
});

/* ===== Load child ===== */
async function loadChild(){
  const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if(!snap.exists()){ throw new Error('child not found'); }
  CHILD = snap.data();

  childNameEl.textContent = CHILD.name || 'طفل';
  childMetaEl.textContent = `${CHILD.gender||'—'} • العمر: ${calcAge(CHILD.birthDate)}`;

  normalMin = Number(CHILD.normalRange?.min ?? 4);
  normalMax = Number(CHILD.normalRange?.max ?? 7);
  CR = CHILD.carbRatio!=null ? Number(CHILD.carbRatio) : null;
  CF = CHILD.correctionFactor!=null ? Number(CHILD.correctionFactor) : null;

  chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
  chipCREl.textContent    = `CR: ${CR ?? '—'} g/U`;
  chipCFEl.textContent    = `CF: ${CF ?? '—'} mmol/L/U`;
}

/* ===== Load rows for range ===== */
let _rowsCache = [];

async function loadAndRender(){
  loader(true);
  try{
    const s = fromEl.value, e = toEl.value;
    const col = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);

    // نجلب بتاريخ النطاق (التاريخ مخزن yyyy-mm-dd)
    const qy = query(col, where('date','>=', s), where('date','<=', e));
    const snap = await getDocs(qy);

    const rows = [];
    snap.forEach(d=>{
      const r = d.data();
      const date = normalizeDateStr(r.date);
      if(!date) return;

      // حساب القيم بوحدتين
      const mmol = r.value_mmol!=null ? Number(r.value_mmol)
                 : (r.unit==='mmol/L' ? Number(r.value) : (r.value_mgdl!=null ? Number(r.value_mgdl)/18 : null));
      if(mmol==null || !isFinite(mmol)) return;

      const mgdl = r.value_mgdl!=null ? Number(r.value_mgdl)
                 : (r.unit==='mg/dL' ? Number(r.value) : Math.round(mmol*18));

      rows.push({
        id: d.id,
        date,
        slot: r.slot || '',
        mmol,
        mgdl,
        correctionDose: (r.correctionDose===''? null : r.correctionDose),
        notes: r.notes || '',
        state: getState(mmol),
      });
    });

    // ترتيب
    const order = new Map(SLOTS.map(([k],i)=>[k,i]));
    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1)
             : ( (order.get(a.slot)||999) - (order.get(b.slot)||999) ));

    _rowsCache = rows;

    renderTable(rows);
    renderCharts(rows);
    renderInsights(rows);
  }catch(e){
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="3" class="muted">خطأ في تحميل البيانات.</td></tr>`;
  }finally{
    loader(false);
  }
}

/* ===== Render table ===== */
function getState(mmol){
  if(mmol<normalMin) return 'low';
  if(mmol>normalMax) return 'high';
  return 'ok';
}
function arrowFor(state){
  return state==='low' ? '↓' : state==='high' ? '↑' : '↔';
}
function fmtVal(outUnit, mmol, mgdl){
  return outUnit==='mgdl' ? `${Math.round(mgdl)} mg/dL` : `${mmol.toFixed(1)} mmol/L`;
}

function renderTable(rows){
  if(!rows.length){ tbody.innerHTML = `<tr><td colspan="3" class="muted">لا يوجد قياسات للفترة.</td></tr>`; return; }
  const out = unitSel.value;            // 'mmol' | 'mgdl'
  const hideNotes = notesModeSel.value==='hide';

  // نخفي "سناك" من الجدول فقط
  const filtered = rows.filter(r=> r.slot!=='snack');

  tbody.innerHTML = filtered.map(r=>{
    const vTxt = fmtVal(out, r.mmol, r.mgdl);
    const st = r.state; // low|ok|high
    const cls = `value ${st==='low'?'low':st==='high'?'high':'ok'}`;
    // التفاصيل: (قياس) سطر أول — (جرعة) سطر ثاني — (ملاحظات) ثالث
    const notesHtml = r.notes && !hideNotes ? `<div class="sub">${escapeHtml(r.notes)}</div>` : '';
    const corrHtml  = (r.correctionDose!=null && r.correctionDose!=='') ? `<div class="sub">جرعة تصحيح: ${r.correctionDose} U</div>` : '';
    return `<tr>
      <td>${r.date}</td>
      <td>${escapeHtml(slotLabel(r.slot))}</td>
      <td class="details">
        <div class="${cls}">${arrowFor(st)} ${vTxt}</div>
        ${corrHtml}
        ${notesHtml}
      </td>
    </tr>`;
  }).join('');
}

function escapeHtml(s){
  return (s || '').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}



/* ===== Charts (Canvas بسيط بدون مكتبات) ===== */
function renderCharts(rows){
  // بالرسم نأخذ كل الأوقات (حتى سناك) عادي
  const ctxBar = slotBar.getContext('2d');
  const ctxLine= dailyLine.getContext('2d');
  ctxBar.clearRect(0,0,slotBar.width,slotBar.height);
  ctxLine.clearRect(0,0,dailyLine.width,dailyLine.height);

  // 1) توزيع حسب وقت القياس
  const keys = SLOTS.map(s=>s[0]);
  const labels = SLOTS.map(s=>s[1]);
  const bySlot = Object.fromEntries(keys.map(k=>[k,0]));
  rows.forEach(r=>{ if(keys.includes(r.slot)) bySlot[r.slot]++; });

  const counts = keys.map(k=> bySlot[k]||0 );
  const maxC = Math.max(1, ...counts);
  const w = slotBar.width, h= slotBar.height, pad=28, gap=6;
  const barW = (w - 2*pad - gap*(keys.length-1)) / keys.length;

  const barColor = '#4f46e5';
  const base = '#748094';

  ctxBar.font='12px Segoe UI';
  ctxBar.textAlign='center';

  keys.forEach((k,i)=>{
    const c = counts[i];
    const bh = (c/maxC)*(h-70);
    const x = pad + i*(barW+gap);
    const y = h - 40 - bh;

    ctxBar.fillStyle = barColor;
    ctxBar.fillRect(x,y,barW,bh);

    ctxBar.fillStyle = base;
    ctxBar.fillText(labels[i], x+barW/2, h-18);
    ctxBar.fillStyle = '#111';
    ctxBar.fillText(c, x+barW/2, y-6);
  });

  // 2) متوسط يومي (بالـ mmol)
  const byDate = {};
  rows.forEach(r=>{ (byDate[r.date]??=([])).push(r.mmol); });
  const dates = Object.keys(byDate).sort();
  if(!dates.length) return;

  const avgs = dates.map(d=> {
    const a=byDate[d]; return a.reduce((x,y)=>x+y,0)/a.length;
  });

  // محاور
  const ctx = ctxLine;
  const W = dailyLine.width, H = dailyLine.height, P = 30;

  const minY = Math.min(...avgs, normalMin) - .5;
  const maxY = Math.max(...avgs, normalMax) + .5;

  const toUnit = v => unitSel.value==='mgdl' ? (v*18) : v;
  const yOf = v => H - P - ( (toUnit(v)-toUnit(minY)) / (toUnit(maxY)-toUnit(minY)) ) * (H - 2*P);
  const xOf = i => P + i * ((W - 2*P) / Math.max(1, dates.length-1));

  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(P, H-P); ctx.lineTo(W-P, H-P); ctx.moveTo(P,P); ctx.lineTo(P,H-P); ctx.stroke();

  // نطاق طبيعي
  ctx.fillStyle = 'rgba(22,163,74,.12)';
  ctx.fillRect(P, yOf(normalMax), W-2*P, yOf(normalMin)-yOf(normalMax));

  // خط
  ctx.strokeStyle = '#4f46e5'; ctx.lineWidth=2;
  ctx.beginPath();
  dates.forEach((d,i)=>{ const x=xOf(i), y=yOf(avgs[i]); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();

  // نقاط + تسميات
  ctx.fillStyle='#4f46e5'; ctx.font='12px Segoe UI'; ctx.textAlign='center';
  dates.forEach((d,i)=>{ const x=xOf(i), y=yOf(avgs[i]); ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#748094'; ctx.fillText(d.slice(5), x, H-6); ctx.fillStyle='#4f46e5'; });
}

/* ===== Insights ===== */
function renderInsights(rows){
  insightsList.innerHTML = '';
  if(!rows.length){ insightsList.innerHTML = '<li>لا توجد قياسات في هذه الفترة.</li>'; return; }

  // توزيع
  const vals = rows.map(r=>r.mmol);
  const n = vals.length || 1;

  const highs = rows.filter(r=>r.mmol>normalMax);
  const lows  = rows.filter(r=>r.mmol<normalMin);

  // أكثر slot ارتفاعًا/هبوطًا
  const group = {};
  rows.forEach(r=>{ (group[r.slot]??=([])).push(r.mmol); });
  const top = (pred)=>{
    let best=null;
    for(const [k,arr] of Object.entries(group)){
      const hits = arr.filter(pred).length;
      const p = Math.round((hits/Math.max(1,arr.length))*100);
      if(!best || p>best.percent) best={key:k,percent:p};
    }
    return (best && best.percent>0) ? best : null;
  };
  const sHigh = top(v=> v>normalMax);
  const sLow  = top(v=> v<normalMin);

  const add = (t)=>{ const li=document.createElement('li'); li.innerHTML=t; insightsList.appendChild(li); };

  const mean = vals.reduce((a,b)=>a+b,0)/n;
  const sd   = Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/n);
  add(`متوسط: ${unitSel.value==='mgdl' ? Math.round(mean*18) : mean.toFixed(1)} ${unitSel.value==='mgdl'?'mg/dL':'mmol/L'} (SD ${unitSel.value==='mgdl'? Math.round(sd*18): sd.toFixed(1)}).`);
  add(`داخل النطاق: ${(rows.filter(r=>r.mmol>=normalMin && r.mmol<=normalMax).length/n*100).toFixed(0)}%، ارتفاعات: ${(highs.length/n*100).toFixed(0)}%، هبوطات: ${(lows.length/n*100).toFixed(0)}%.`);

  if(sHigh) add(`أكثر وقت يظهر فيه ارتفاع: <b>${slotLabel(sHigh.key)}</b> (%${sHigh.percent}).`);
  if(sLow)  add(`أكثر وقت يظهر فيه هبوط: <b>${slotLabel(sLow.key)}</b> (%${sLow.percent}).`);

  if(highs.length>=3) add(`ارتفاعات متكررة — راجعي <b>CF</b> أو توقيت الجرعات.`);
  if(lows.length>=2)  add(`هبوطات متكررة — راجعي الوجبات الخفيفة أو الجرعة القاعدية قبل النوم.`);

  // توصية تخص الوجبات بعد المتوسط
  const postMeals = ['post_bf','post_ln','post_dn'];
  postMeals.forEach(k=>{
    const arr = group[k]; if(!arr || !arr.length) return;
    const m = arr.reduce((a,b)=>a+b,0)/arr.length;
    if(m > normalMax + 1.5) add(`بعد ${slotLabel(k)} أعلى من المتوقع — قد يحتاج <b>CR</b> ضبطًا.`);
  });
}
