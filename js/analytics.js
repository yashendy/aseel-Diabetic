import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = id => document.getElementById(id);
const round1 = n => Math.round((+n||0)*10)/10;
const mgdl2mmol = v => v / 18.0182;
const mmol2mgdl = v => v * 18.0182;

function toast(m) { const t=$('toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200); }

let childId = new URLSearchParams(location.search).get('child') || '';
let childRef, child, unitSel, fromDate, toDate, lineChart, pieChart;

// --- 1. جلب النطاقات الديناميكية للطفل (بدل الثابتة القديمة) ---
function getLimits(u) {
  if (child?.glucose_limits) {
    return {
      critLow: Number(child.glucose_limits.critical_low) || (u.includes('mmol')? 3.0 : 54),
      low: Number(child.glucose_limits.low) || (u.includes('mmol')? 3.9 : 70),
      target: Number(child.glucose_limits.target) || (u.includes('mmol')? 5.5 : 100),
      high: Number(child.glucose_limits.high) || (u.includes('mmol')? 10.0 : 180),
      critHigh: Number(child.glucose_limits.critical_high) || (u.includes('mmol')? 13.9 : 250)
    };
  }
  return u.includes('mmol')
    ? { critLow: 3.0, low: 3.9, target: 5.5, high: 10.0, critHigh: 13.9 }
    : { critLow: 54, low: 70, target: 100, high: 180, critHigh: 250 };
}

onAuthStateChanged(auth, async (u) => {
  if(!u){ location.href='index.html'; return; }
  
  // إذا كان المستخدم طبيباً وفتح التقرير، قد نحتاج لمعرفة parentId، لكن حالياً نفترض أن الهيكل كالتالي:
  const parentId = new URLSearchParams(location.search).get('parentId') || u.uid;
  childRef = doc(db, 'parents', parentId, 'children', childId);
  
  const s = await getDoc(childRef); 
  child = s.data();
  
  $('childName').textContent = child?.displayName || child?.name || '—';
  $('childMeta').textContent = `وحدة: ${child.glucoseUnit||'mg/dL'} • CF: ${child.cf||child.correctionFactor||'—'} • CR: ${child.cr?.breakfast||child.carbRatio||'—'}`;
  
  wire(); 
  initDefault(); 
  await refreshAll();
});

function wire() {
  unitSel = $('unitSel'); fromDate = $('fromDate'); toDate = $('toDate');
  $('applyBtn').onclick = refreshAll; 
  $('cmpRun').onclick = runCompare;
  unitSel.onchange = () => { fillThresholdChips(); refreshAll(); };
  $('exportCsv').onclick = exportCSV; 
  $('exportPdf').onclick = exportPDF;
}

function initDefault() {
  unitSel.value = child?.glucoseUnit || 'mg/dL';
  const now = new Date(); const to = now.toISOString().slice(0,10); 
  const from = new Date(now); from.setDate(from.getDate()-13);
  
  fromDate.value = from.toISOString().slice(0,10); 
  toDate.value = to;
  
  $('cmpAFrom').value = fromDate.value; 
  $('cmpATo').value = toDate.value;
  
  const prevFrom = new Date(from); prevFrom.setDate(prevFrom.getDate()-14);
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate()-1);
  
  $('cmpBFrom').value = prevFrom.toISOString().slice(0,10); 
  $('cmpBTo').value = prevTo.toISOString().slice(0,10);
  
  fillThresholdChips();
}

function fillThresholdChips() {
  const u = unitSel.value; 
  const L = getLimits(u);
  $('thresholdChips').innerHTML = `
    <span class="chip" style="border-color:#fca5a5; background:#fef2f2; color:#991b1b">هبوط حرج: <b>${L.critLow}</b></span>
    <span class="chip" style="border-color:#fcd34d; background:#fffbeb; color:#b45309">هبوط: <b>${L.low}</b></span>
    <span class="chip" style="border-color:#86efac; background:#f0fdf4; color:#166534">الهدف: <b>${L.target}</b></span>
    <span class="chip" style="border-color:#fcd34d; background:#fffbeb; color:#b45309">ارتفاع: <b>${L.high}</b></span>
    <span class="chip" style="border-color:#fca5a5; background:#fef2f2; color:#991b1b">ارتفاع حرج: <b>${L.critHigh}</b></span>
  `;
}

// --- 2. جلب البيانات (مع تعديل لجلب الإنسولين للذكاء الاصطناعي) ---
async function fetchRange(fromISO, toISO) {
  const col = collection(childRef, 'measurements');
  const qy = query(col, where('when','>=',new Date(fromISO+'T00:00:00')), where('when','<=',new Date(toISO+'T23:59:59')), orderBy('when','asc'));
  const snap = await getDocs(qy);
  
  const u = unitSel.value; 
  const arr = [];
  
  snap.forEach(s => {
    const x = s.data();
    let v = u.includes('mmol') ? (x.value_mmol ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
                               : (x.value_mgdl ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
    if(!Number.isFinite(+v)) return;
    arr.push({
      t: x.when.toDate(), 
      v: round1(+v), 
      slot: x.slotKey || x.slot || 'OTHER',
      ins: x.totalInsulin || x.totalDose || x.correctionDose || 0
    });
  }); 
  return arr;
}

async function refreshAll() {
  const u = unitSel.value; 
  const list = await fetchRange(fromDate.value, toDate.value);
  drawLine(list, u); 
  drawPie(list, u); 
  buildAI(list, u);
}

// --- 3. المخططات ---
function drawLine(list, u) {
  const ctx = $('lineChart').getContext('2d'); 
  const labels = list.map(x => x.t.toLocaleString('ar-EG',{weekday:'short',hour:'2-digit',minute:'2-digit'}));
  const data = list.map(x => x.v);
  
  if(lineChart) lineChart.destroy();
  lineChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: `الجلوكوز (${u})`, data, pointRadius: 3, borderWidth: 2, borderColor: '#2563eb', backgroundColor: '#bfdbfe' }] },
    options: { scales: { y: { ticks: {}, grid: {} } }, plugins: { legend: { display: false } } }
  });
}

function drawPie(list, u) {
  const L = getLimits(u); 
  const n = list.length || 1;
  const tbr = list.filter(x => x.v < L.low).length / n * 100;
  const tir = list.filter(x => x.v >= L.low && x.v <= L.high).length / n * 100;
  const tar = list.filter(x => x.v > L.high).length / n * 100;
  
  const ctx = $('pieChart').getContext('2d'); 
  if(pieChart) pieChart.destroy();
  
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: { 
      labels: ['في النطاق', 'هبوط', 'ارتفاع'], 
      datasets: [{ data: [Math.round(tir), Math.round(tbr), Math.round(tar)], backgroundColor: ['#16a34a', '#ef4444', '#f59e0b'] }] 
    },
    options: { plugins: { legend: { position: 'bottom' } }, cutout: '70%' }
  });
}

// --- 4. المقارنة ---
function rowCmp(label, a, b, fmt='%') { 
  const diff = (a-b); 
  const cls = diff >= 0 ? 'diff-up' : 'diff-down';
  const fmtVal = (v) => fmt === '%' ? `${Math.round(v)}%` : Math.round(v*10)/10;
  return `<div>${label}</div><div>${fmtVal(a)}</div><div>${fmtVal(b)}</div><div style="direction:ltr" class="${cls}">${diff>0?'+':''}${fmtVal(diff)}</div>`;
}

async function runCompare() {
  const u = unitSel.value;
  const A = await fetchRange($('cmpAFrom').value, $('cmpATo').value);
  const B = await fetchRange($('cmpBFrom').value, $('cmpBTo').value);
  const L = getLimits(u); 
  
  const nA = A.length || 1, nB = B.length || 1;
  const pa = { TBR: A.filter(x=>x.v < L.low).length/nA*100, TIR: A.filter(x=>x.v >= L.low && x.v <= L.high).length/nA*100 };
  const pb = { TBR: B.filter(x=>x.v < L.low).length/nB*100, TIR: B.filter(x=>x.v >= L.low && x.v <= L.high).length/nB*100 };
  
  const meanA = A.reduce((a,x)=>a+x.v, 0)/nA, meanB = B.reduce((a,x)=>a+x.v, 0)/nB;
  const sdA = Math.sqrt(A.reduce((a,x)=>a+Math.pow(x.v-meanA,2), 0)/nA);
  const sdB = Math.sqrt(B.reduce((a,x)=>a+Math.pow(x.v-meanB,2), 0)/nB);
  
  $('cmpTable').innerHTML = `
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">المؤشر</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">الحالية</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">السابقة</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">الفرق</div>
    ${rowCmp('TIR (النطاق)', pa.TIR, pb.TIR, '%')}
    ${rowCmp('TBR (هبوط)', pa.TBR, pb.TBR, '%')}
    ${rowCmp('TAR (ارتفاع)', 100-pa.TIR-pa.TBR, 100-pb.TIR-pb.TBR, '%')}
    ${rowCmp('المتوسط', meanA, meanB, 'n')}
    ${rowCmp('التذبذب (SD)', sdA, sdB, 'n')}
    ${rowCmp('القياسات', nA, nB, 'n')}
  `;
}

// --- 5. محرك الذكاء الاصطناعي الطبي الاستشاري 🧠 ---
function buildAI(list, u) {
  const L = getLimits(u);
  const patt = [];
  const valid = list.filter(x => x.v !== null);
  
  if(valid.length === 0) {
    $('aiTable').innerHTML = `<div style="grid-column:1/-1; padding:15px; text-align:center; color:#64748b;">لا توجد بيانات كافية للتحليل.</div>`;
    return;
  }

  const SLOT_NAMES = { FASTING:'صائم', WAKE:'الاستيقاظ', PRE_BREAKFAST:'ق. الفطار', POST_BREAKFAST:'ب. الفطار', PRE_LUNCH:'ق. الغداء', POST_LUNCH:'ب. الغداء', PRE_DINNER:'ق. العشاء', POST_DINNER:'ب. العشاء', SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم' };

  // 1. تقييم النسب العامة
  const total = valid.length;
  const pctTBR = Math.round((valid.filter(x => x.v < L.low).length / total) * 100);
  const pctTAR = Math.round((valid.filter(x => x.v > L.high).length / total) * 100);
  const pctTIR = Math.round((valid.filter(x => x.v >= L.low && x.v <= L.high).length / total) * 100);

  if (pctTBR > 15) patt.push({ name: 'كثرة الهبوطات (TBR)', desc: `نسبة الهبوط (${pctTBR}%) تتخطى 15%.`, rec: 'تقليل الجرعات أو مراجعة النشاط.', conf: 'حرج 🚨', color: '#dc2626' });
  if (pctTAR > 25) patt.push({ name: 'كثرة الارتفاعات (TAR)', desc: `نسبة الارتفاع (${pctTAR}%) تتخطى 25%.`, rec: 'قد يحتاج لتعديل المعاملات (CR/CF).', conf: 'عالي 🔴', color: '#b45309' });
  if (pctTIR < 60 && pctTBR <= 15 && pctTAR <= 25) patt.push({ name: 'ضعف السيطرة (TIR)', desc: `نسبة البقاء في النطاق (${pctTIR}%) أقل من 60%.`, rec: 'مراجعة شاملة للخطة.', conf: 'متوسط 🟡', color: '#d97706' });

  // 2. تحليل التذبذب الجلايسيمي (CV)
  const vals = valid.map(x => x.v);
  const mean = vals.reduce((a, b) => a + b, 0) / total;
  const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / total;
  const cv = (Math.sqrt(variance) / mean) * 100;
  
  if (cv > 36) {
    patt.push({ name: 'تذبذب عالي (CV)', desc: `تأرجح شديد (CV: ${Math.round(cv)}%).`, rec: 'التركيز على الاستقرار قبل محاولة خفض المتوسط.', conf: 'عالي 🔴', color: '#b45309' });
  }

  // 3. الإفراط في علاج الهبوط & كفاءة التصحيح
  let reboundCount = 0;
  let weakCFCount = 0;
  
  for(let i=0; i < valid.length - 1; i++) {
    const curr = valid[i];
    const next = valid[i+1];
    const diffHours = (next.t - curr.t) / (1000 * 60 * 60);
    
    if (curr.v < L.low && next.v > L.high && diffHours <= 6) reboundCount++;
    if (curr.v > L.high && curr.ins > 0 && next.v > L.high && diffHours <= 4) weakCFCount++;
  }
  
  if (reboundCount >= 2) patt.push({ name: 'إفراط علاج الهبوط', desc: `تم رصد ارتداد عكسي بعد الهبوط ${reboundCount} مرات.`, rec: 'توعية بقاعدة الـ 15 لتجنب الإفراط بالسكريات.', conf: 'حرج 🚨', color: '#dc2626' });
  if (weakCFCount >= 3) patt.push({ name: 'ضعف معامل التصحيح', desc: `جرعات التصحيح لا تخفض السكر.`, rec: 'قد يحتاج الـ CF للتقليل لزيادة الجرعة.', conf: 'متوسط 🟡', color: '#d97706' });

  // 4. الكاشف الديناميكي للفترات
  const slotsData = {};
  valid.forEach(m => {
    if(!slotsData[m.slot]) slotsData[m.slot] = [];
    slotsData[m.slot].push(m.v);
  });

  for(let s in slotsData) {
    const sVals = slotsData[s];
    if(sVals.length >= 3) {
      const highPct = sVals.filter(v => v > L.high).length / sVals.length;
      const lowPct = sVals.filter(v => v < L.low).length / sVals.length;
      const slotName = SLOT_NAMES[s] || s;
      
      if(highPct >= 0.5) patt.push({ name: `ارتفاع متكرر (${slotName})`, desc: `السكر يرتفع بنسبة >50% بهذه الفترة.`, rec: 'راجع الجرعة المرتبطة بها.', conf: 'متوسط 🟡', color: '#d97706' });
      if(lowPct >= 0.4) patt.push({ name: `هبوط متكرر (${slotName})`, desc: `نمط هبوط متكرر بهذه الفترة.`, rec: 'تقليل الجرعة لتجنب المخاطر.', conf: 'حرج 🚨', color: '#dc2626' });
    }
  }

  // طباعة النتائج في الجدول (مكون من 4 أعمدة رئيسية)
  if(!patt.length) patt.push({name:'✅ استقرار ممتاز', desc:'المؤشرات الحيوية ضمن الحدود المطلوبة.', rec:'استمر على نفس الخطة الرائعة!', conf:'ممتاز 🟢', color: '#16a34a'});

  const uniquePatt = Array.from(new Set(patt.map(p => JSON.stringify(p)))).map(str => JSON.parse(str));

  $('aiTable').innerHTML = `
    <div style="font-weight:bold; background:#f1f5f9; padding:8px; border-radius: 0 8px 0 0;">النمط</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">الوصف</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px;">التوصية الطبية</div>
    <div style="font-weight:bold; background:#f1f5f9; padding:8px; border-radius: 8px 0 0 0;">مستوى الأهمية</div>
  ` + uniquePatt.map(p => `
    <div style="font-weight:bold; color:${p.color}">${p.name}</div>
    <div style="font-size:13px;">${p.desc}</div>
    <div style="font-size:13px; color:#2563eb;">${p.rec}</div>
    <div style="font-size:13px; font-weight:bold; color:${p.color}">${p.conf}</div>
  `).join('');
}

// --- 6. التصدير ---
async function exportCSV() {
  const u = unitSel.value; 
  const list = await fetchRange(fromDate.value, toDate.value);
  const BOM = "\uFEFF";
  const rows = [['التاريخ والوقت', 'القيمة', 'الوحدة']].concat(list.map(x => [x.t.toLocaleString('ar-EG'), x.v, u]));
  const csv = rows.map(r => r.join(',')).join('\n'); 
  const blob = new Blob([BOM + csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); 
  a.href = URL.createObjectURL(blob); 
  a.download = `analytics-${fromDate.value}_${toDate.value}.csv`; 
  a.click();
}

function exportPDF() {
  const node = document.querySelector('.container'); 
  const opt = { filename: `analytics-${fromDate.value}_${toDate.value}.pdf`, html2canvas: {scale:2} };
  window.html2pdf().from(node).set(opt).save();
}
