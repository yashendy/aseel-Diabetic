// js/reports.js
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $=id=>document.getElementById(id);
const round1=n=>Math.round((+n||0)*10)/10;
const mgdl2mmol=v=>v/18.0182, mmol2mgdl=v=>v*18.0182;

const SLOT_ORDER = ["WAKE","FASTING","PRE_BREAKFAST","POST_BREAKFAST","PRE_LUNCH","POST_LUNCH","PRE_DINNER","POST_DINNER","SNACK","BEDTIME","DURING_SLEEP"];
const SLOT_LABEL = {
  FASTING:'صائم', PRE_BREAKFAST:'ق.الفطار', POST_BREAKFAST:'ب.الفطار',
  PRE_LUNCH:'ق.الغداء', POST_LUNCH:'ب.الغداء',
  PRE_DINNER:'ق.العشاء', POST_DINNER:'ب.العشاء',
  SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم', WAKE:'استيقاظ'
};
function formatDate(d){return d.toLocaleDateString('ar-EG',{weekday:'short', day:'2-digit', month:'numeric'})}
function toast(m){const t=$('toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200);}
function showLoader(v){ const l=$('appLoader'); if(l) l.style.display = v ? 'flex' : 'none'; }

let currentUser, childId=new URLSearchParams(location.search).get('child')||localStorage.getItem('selectedChildId');
let childRef, child;
let unitSel, fromDate, toDate, reportGrid, emptyGrid, pie, cmpElems, aiTable;

let sysLimits = { critLow: 54, low: 70, high: 180, critHigh: 250 };
let sysUnit = 'mg/dL';

onAuthStateChanged(auth, async (u)=>{
  if(!u) return;
  currentUser=u;
  wire(); 
  showLoader(true);
  try {
    await loadChild(u.uid);
    unitSel.value = sysUnit;
    fillThresholdChips();
    setQuickRange('1w'); // افتراضي آخر أسبوع
    await renderReport();
  } catch(e) { console.error(e); }
  finally { showLoader(false); }
});

function wire(){
  unitSel=$('unitSel'); fromDate=$('fromDate'); toDate=$('toDate');
  reportGrid=$('reportGrid'); emptyGrid=$('emptyGrid'); aiTable=$('aiTable');
  cmpElems={AFrom:$('cmpAFrom'), ATo:$('cmpATo'), BFrom:$('cmpBFrom'), BTo:$('cmpBTo')};
  
  $('openPrint').onclick=()=>window.open(`reports-print.html?child=${encodeURIComponent(childId)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}`,'_blank');
  $('openPrintBlank').onclick=()=>window.open(`reports-print.html?child=${encodeURIComponent(childId)}&from=${fromDate.value}&to=${toDate.value}&unit=${encodeURIComponent(unitSel.value)}&blank=1`,'_blank');
  
  $('exportPdf').onclick=exportPdf; $('exportCsv').onclick=exportCSV; $('exportXlsx').onclick=exportXLSX;
  
  $('applyBtn').onclick = renderReport;
  $('cmpRun').onclick = runCompare;
  unitSel.onchange = () => { fillThresholdChips(); renderReport(); };

  // تفاعل الفترات السريعة
  $('quickRange').onchange = (e) => {
    if(e.target.value === 'custom') return;
    setQuickRange(e.target.value);
    renderReport();
  };

  $('measureType').onchange = renderReport;
}

function setQuickRange(range) {
  const to = new Date();
  const from = new Date();
  if (range === '1w') from.setDate(from.getDate() - 7);
  else if (range === '2w') from.setDate(from.getDate() - 14);
  else if (range === '1m') from.setMonth(from.getMonth() - 1);
  else if (range === '3m') from.setMonth(from.getMonth() - 3);
  
  $('toDate').value = to.toISOString().slice(0, 10);
  $('fromDate').value = from.toISOString().slice(0, 10);
  
  // تحديث المقارنة تلقائياً
  cmpElems.AFrom.value = $('fromDate').value; 
  cmpElems.ATo.value = $('toDate').value;
  const diffTime = Math.abs(to - from);
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo.getTime() - diffTime);
  cmpElems.BFrom.value = prevFrom.toISOString().slice(0, 10);
  cmpElems.BTo.value = prevTo.toISOString().slice(0, 10);
}

async function loadChild(uid){
  const parentId = new URLSearchParams(location.search).get('parentId') || uid;
  childRef=doc(db,'parents',parentId,'children',childId);
  const snap=await getDoc(childRef);
  if(!snap.exists()) { throw new Error('child-not-found'); }
  child=snap.data();
  sysUnit = child.glucoseUnit || 'mg/dL';

  if(child.glucose_limits) {
    sysLimits.low = Number(child.glucose_limits.low) || (sysUnit==='mmol/L'? 3.9 : 70);
    sysLimits.high = Number(child.glucose_limits.high) || (sysUnit==='mmol/L'? 10.0 : 180);
    sysLimits.critLow = Number(child.glucose_limits.critical_low) || (sysUnit==='mmol/L'? 3.0 : 54);
    sysLimits.critHigh = Number(child.glucose_limits.critical_high) || (sysUnit==='mmol/L'? 13.9 : 250);
  }
}

function limitsInUnit(targetUnit){
  if (targetUnit === sysUnit) return { ...sysLimits };
  if (targetUnit === 'mmol/L' && sysUnit === 'mg/dL') {
    return { critLow: round1(mgdl2mmol(sysLimits.critLow)), low: round1(mgdl2mmol(sysLimits.low)), high: round1(mgdl2mmol(sysLimits.high)), critHigh: round1(mgdl2mmol(sysLimits.critHigh)) }; 
  }
  if (targetUnit === 'mg/dL' && sysUnit === 'mmol/L') {
    return { critLow: round1(mmol2mgdl(sysLimits.critLow)), low: round1(mmol2mgdl(sysLimits.low)), high: round1(mmol2mgdl(sysLimits.high)), critHigh: round1(mmol2mgdl(sysLimits.critHigh)) };
  }
  return { ...sysLimits };
}

function fillThresholdChips(){
  const u = unitSel.value;
  const L = limitsInUnit(u);
  $('thresholdChips').innerHTML = `
    <span class="chip">هبوط: <b>${L.low} ${u}</b></span>
    <span class="chip">ارتفاع: <b>${L.high} ${u}</b></span>
    <span class="chip">ارتفاع حرج: <b>${L.critHigh} ${u}</b></span>
  `;
}

function classFor(val,u){
  if(val == null) return '';
  const L=limitsInUnit(u);
  if(val >= L.critHigh) return 'crit';   
  if(val > L.high) return 'mild';        
  if(val <= L.critLow) return 'crit';    
  if(val < L.low) return 'sev';          
  return 'ok';                           
}

async function fetchRange(fromISO,toISO){
  const col=collection(childRef,'measurements');
  const qy=query(col, where('date','>=',fromISO), where('date','<=',toISO));
  const snap=await getDocs(qy);
  const unit=unitSel.value;
  const mType = $('measureType').value; // تصفية نوع القياس
  const arr=[];
  
  snap.forEach(s=>{
    const x=s.data();
    // تصفية حسب نوع القياس (لو السجل يحتوي على measureMethod)
    if(mType !== 'all' && x.measureMethod && x.measureMethod !== mType) return;
    
    let v = unit.includes('mmol') ? (x.value_mmol ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
                                  : (x.value_mgdl ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
    
    arr.push({
      date: x.date,
      when: x.when?.toDate() || new Date(x.date), 
      slot: x.slotKey||'OTHER', 
      val: Number.isFinite(+v) ? round1(+v) : null,
      carbs: x.carbs || 0,
      ins: x.totalInsulin || x.correctionDose || x.totalDose || 0,
      notes: x.notes||''
    });
  });
  return arr.sort((a,b)=> a.when - b.when);
}

function groupByDaySlot(list){
  const days={};
  for(const r of list){
    const key=r.date;
    days[key] = days[key] || {date:new Date(key), slots:{}, dailyCarbs:0, dailyInsulin:0};
    days[key].slots[r.slot]=days[key].slots[r.slot]||[];
    days[key].slots[r.slot].push(r);
    
    days[key].dailyCarbs += (r.carbs || 0);
    days[key].dailyInsulin += (r.ins || 0);
  }
  return Object.values(days).sort((a,b)=>a.date-b.date);
}

function cellHTML(vals,u){
  if(!vals || !vals.length) return '';
  const v = vals[vals.length-1];
  let html = `<div class="cell-data">`;
  if (v.val !== null) {
    const cls=classFor(v.val,u);
    html += `<div class="v ${cls}">${v.val}</div>`;
  }
  if (v.carbs > 0) html += `<div class="badge-carb">🍔 ${v.carbs}g</div>`;
  if (v.ins > 0 || (v.carbs > 0 && v.ins === 0)) html += `<div class="badge-ins">💉 ${v.ins}U</div>`;
  html += `</div>`;
  return html;
}

async function renderReport(){
  showLoader(true);
  const unit=unitSel.value, from=fromDate.value, to=toDate.value;
  const data=await fetchRange(from,to);
  const days=groupByDaySlot(data);

  const body= $('reportGrid'); body.innerHTML='';
  if(!days.length){
    $('emptyGrid').classList.remove('hidden');
    updateStats([]); drawPie({TIR:0,TBR:0,TAR:0}); buildAI([],unit); 
    showLoader(false); return;
  }
  $('emptyGrid').classList.add('hidden');

  for(const d of days){
    const row=document.createElement('div'); row.className='grid-row';
    const totalCell = `
      <div class="cell-data" style="justify-content:center;">
        ${d.dailyCarbs > 0 ? `<div class="badge-carb">${d.dailyCarbs}g</div>` : ''}
        ${d.dailyInsulin > 0 ? `<div class="badge-ins">${d.dailyInsulin}U</div>` : ''}
        ${d.dailyCarbs===0 && d.dailyInsulin===0 ? '<span class="muted">—</span>' : ''}
      </div>`;

    row.innerHTML = `
      <div class="grid-cell" style="font-weight:bold; color:#475569;">${formatDate(d.date)}</div>
      <div class="grid-cell col-total">${totalCell}</div>
      ` +
      ['FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP']
      .map(k=>`<div class="grid-cell">${cellHTML(d.slots[k],unit)}</div>`).join('');
    body.appendChild(row);
  }

  updateStats(data);
  const parts=calcParts(data,unit); drawPie(parts);
  buildAI(data,unit);
  showLoader(false);
}

// ... (نفس دوال updateStats, drawPie, runCompare, و buildAI الأصلية التي برمجتيها)
// سأضع لكِ الجزء الخاص بالتصدير (Export) هنا مباشرة لإكمال الكود:

function updateStats(list){
  const validList = list.filter(x => x.val !== null);
  const unit=unitSel.value, L=limitsInUnit(unit);
  const avgCard = $('statAvg').parentElement; 

  if(!validList.length){ 
    $('statTIR').textContent='0%'; $('statLow').textContent='0%'; $('statHigh').textContent='0%'; $('statAvg').textContent='—'; $('statSD').textContent='—'; $('statCrit').textContent='0'; 
    avgCard.className = 'card'; avgCard.style.backgroundColor = ''; return; 
  }
  
  const n=validList.length;
  const lows=validList.filter(x=>x.val<L.low).length;
  const highs=validList.filter(x=>x.val>L.high).length;
  const crit=validList.filter(x=>x.val>=L.critHigh || x.val<=L.critLow).length;
  const TIR = validList.filter(x=>x.val>=L.low && x.val<=L.high).length;
  const mean=validList.reduce((a,x)=>a+x.val,0)/n;
  const sd=Math.sqrt(validList.reduce((a,x)=>a+Math.pow(x.val-mean,2),0)/n);
  
  $('statTIR').textContent=`${Math.round(TIR/n*100)}%`;
  $('statLow').textContent=`${Math.round(lows/n*100)}%`;
  $('statHigh').textContent=`${Math.round(highs/n*100)}%`;
  $('statCrit').textContent=String(crit);
  $('statAvg').textContent=`${round1(mean)} ${unit}`;
  $('statSD').textContent=round1(sd);

  avgCard.className = 'card';
  if (mean < L.low) { avgCard.classList.add('low'); avgCard.style.backgroundColor = ''; } 
  else if (mean > L.high) { avgCard.classList.add('high'); avgCard.style.backgroundColor = ''; } 
  else { avgCard.style.backgroundColor = '#dcfce7'; }
}

function calcParts(list,unit){
  const validList = list.filter(x => x.val !== null);
  const L=limitsInUnit(unit), n=validList.length||1;
  const tbr=validList.filter(x=>x.val<L.low).length/n*100;
  const tir=validList.filter(x=>x.val>=L.low && x.val<=L.high).length/n*100;
  const tar=validList.filter(x=>x.val>L.high).length/n*100;
  return {TIR:Math.round(tir), TBR:Math.round(tbr), TAR:Math.round(tar)};
}

function drawPie({TIR,TBR,TAR}){
  const ctx=$('pieTIR').getContext('2d');
  if(pie) pie.destroy();
  pie=new Chart(ctx,{type:'doughnut',
    data:{labels:['داخل النطاق','انخفـــــاض','ارتـــــــفاع'], datasets:[{data:[TIR,TBR,TAR], backgroundColor:['#16a34a','#ef4444','#f59e0b']}]},
    options:{plugins:{legend:{position:'bottom'}}, cutout:'70%'}
  });
}

function rowCmp(label,a,b,fmt='%'){
  const diff = (a-b);
  const cls = diff>=0 ? (label==='انخفاض'||label==='ارتفاع'?'diff-down':'diff-up') : (label==='انخفاض'||label==='ارتفاع'?'diff-up':'diff-down');
  return `<div>${label}</div><div>${fmtVal(a,fmt)}</div><div>${fmtVal(b,fmt)}</div><div class="${cls}">${fmtVal(diff,fmt,true)}</div>`;
}
function fmtVal(v,fmt,isDiff=false){
  if(isNaN(v)) return '—';
  if(fmt==='%') return `${Math.round(v)}%`;
  return isDiff? (v>0?`+${round1(v)}`:round1(v)) : round1(v);
}
async function runCompare(){
  showLoader(true);
  const unit=unitSel.value;
  const A=await fetchRange(cmpElems.AFrom.value, cmpElems.ATo.value);
  const B=await fetchRange(cmpElems.BFrom.value, cmpElems.BTo.value);
  const vA = A.filter(x=>x.val!==null), vB = B.filter(x=>x.val!==null);
  
  const pa=calcParts(vA,unit), pb=calcParts(vB,unit);
  const nA=vA.length||1, nB=vB.length||1;
  const meanA=vA.reduce((a,x)=>a+x.val,0)/nA, meanB=vB.reduce((a,x)=>a+x.val,0)/nB;
  const sdA=Math.sqrt(vA.reduce((a,x)=>a+Math.pow(x.val-meanA,2),0)/nA);
  const sdB=Math.sqrt(vB.reduce((a,x)=>a+Math.pow(x.val-meanB,2),0)/nB);

  $('cmpTable').innerHTML = `
    <div>المؤشر</div><div>الحالية</div><div>السابقة</div><div>الفرق</div>
    ${rowCmp('داخل النطاق',pa.TIR,pb.TIR,'%')}
    ${rowCmp('انخفاض',pa.TBR,pb.TBR,'%')}
    ${rowCmp('ارتفاع',pa.TAR,pb.TAR,'%')}
    ${rowCmp('المتوسط',meanA,meanB,'num')}
    ${rowCmp('SD الانحراف',sdA,sdB,'num')}
    ${rowCmp('عدد القياسات',nA,nB,'num')}
  `;
  showLoader(false);
}

function buildAI(list,unit){
  const L=limitsInUnit(unit);
  const patt=[];
  const valid = list.filter(x=>x.val!==null);

  if(valid.length === 0) {
    $('aiTable').innerHTML = `<div style="grid-column:1/-1; padding:15px; text-align:center; color:#64748b;">لا توجد بيانات كافية للتحليل.</div>`;
    return;
  }

  const SLOT_NAMES = { FASTING:'صائم', WAKE:'استيقاظ', PRE_BREAKFAST:'ق. الفطار', POST_BREAKFAST:'ب. الفطار', PRE_LUNCH:'ق. الغداء', POST_LUNCH:'ب. الغداء', PRE_DINNER:'ق. العشاء', POST_DINNER:'ب. العشاء', SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم' };

  const total = valid.length;
  const pctTBR = Math.round((valid.filter(x => x.val < L.low).length / total) * 100);
  const pctTAR = Math.round((valid.filter(x => x.val > L.high).length / total) * 100);
  const pctTIR = Math.round((valid.filter(x => x.val >= L.low && x.val <= L.high).length / total) * 100);

  if (pctTBR > 15) patt.push({ name: 'كثرة الهبوطات (TBR)', desc: `نسبة الهبوط (${pctTBR}%) تتخطى الحد المسموح (15%).`, rec: 'تقليل الجرعات أو مراجعة النشاط البدني.', conf: 'حرج 🚨', color: '#dc2626' });
  if (pctTAR > 25) patt.push({ name: 'كثرة الارتفاعات (TAR)', desc: `نسبة الارتفاع (${pctTAR}%) تتخطى الحد المسموح (25%).`, rec: 'قد يحتاج المريض لتعديل المعاملات (CR/CF).', conf: 'عالي 🔴', color: '#b45309' });
  if (pctTIR < 60 && pctTBR <= 15 && pctTAR <= 25) patt.push({ name: 'ضعف السيطرة (TIR)', desc: `نسبة البقاء في النطاق (${pctTIR}%) أقل من 60%.`, rec: 'مراجعة شاملة للخطة وجرعات الإنسولين.', conf: 'متوسط 🟡', color: '#d97706' });

  const vals = valid.map(x => x.val);
  const mean = vals.reduce((a, b) => a + b, 0) / total;
  const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / total;
  const cv = (Math.sqrt(variance) / mean) * 100;

  if (cv > 36) {
    patt.push({ name: 'تذبذب عالي (Glycemic Variability)', desc: `السكر يتأرجح بشدة (CV: ${Math.round(cv)}%).`, rec: 'التركيز على استقرار القراءات قبل محاولة خفض المتوسط.', conf: 'عالي 🔴', color: '#b45309' });
  }

  let reboundCount = 0; let weakCFCount = 0;
  for(let i=0; i < valid.length - 1; i++) {
    const curr = valid[i]; const next = valid[i+1];
    const diffHours = (next.when - curr.when) / (1000 * 60 * 60);

    if (curr.val < L.low && next.val > L.high && diffHours <= 6) reboundCount++;
    if (curr.val > L.high && curr.ins > 0 && next.val > L.high && diffHours <= 4) weakCFCount++;
  }

  if (reboundCount >= 2) patt.push({ name: 'إفراط علاج الهبوط', desc: `تم رصد ارتداد عكسي بعد الهبوط ${reboundCount} مرات.`, rec: 'توعية بقاعدة الـ 15 لتجنب الإفراط في إعطاء السكريات.', conf: 'حرج 🚨', color: '#dc2626' });
  if (weakCFCount >= 3) patt.push({ name: 'ضعف معامل التصحيح', desc: `جرعات التصحيح لا تخفض السكر للمعدل الطبيعي.`, rec: 'قد يحتاج الـ CF للتقليل لزيادة قوة الجرعة.', conf: 'متوسط 🟡', color: '#d97706' });

  const slotsData = {};
  valid.forEach(m => {
    if(!slotsData[m.slot]) slotsData[m.slot] = [];
    slotsData[m.slot].push(m.val);
  });

  for(let s in slotsData) {
    const sVals = slotsData[s];
    if(sVals.length >= 3) {
      const highPct = sVals.filter(v => v > L.high).length / sVals.length;
      const lowPct = sVals.filter(v => v < L.low).length / sVals.length;
      const slotName = SLOT_NAMES[s] || s;

      if(highPct >= 0.5) patt.push({ name: `ارتفاع متكرر (${slotName})`, desc: `السكر يرتفع بنسبة >50% في هذه الفترة.`, rec: 'راجع الجرعة المرتبطة بها.', conf: 'متوسط 🟡', color: '#d97706' });
      if(lowPct >= 0.4) patt.push({ name: `هبوط متكرر (${slotName})`, desc: `نمط هبوط متكرر في هذه الفترة.`, rec: 'تقليل الجرعة لتجنب المخاطر.', conf: 'حرج 🚨', color: '#dc2626' });
    }
  }

  if(!patt.length) patt.push({name:'✅ استقرار ممتاز', desc:'المؤشرات الحيوية ضمن الحدود المطلوبة.', rec:'استمر على نفس الخطة الرائعة!', conf:'ممتاز 🟢', color: '#16a34a'});

  const uniquePatt = Array.from(new Set(patt.map(p => JSON.stringify(p)))).map(str => JSON.parse(str));

  aiTable.innerHTML = `
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

// --- الأكواد المضافة للتصدير الفعلي للبيانات ---

async function exportCSV(){
  showLoader(true);
  try {
    const data = await fetchRange(fromDate.value, toDate.value);
    let csv = '\uFEFF'; 
    csv += 'التاريخ,الوقت,الفترة,القراءة,الوحدة,كارب (جرام),إنسولين (وحدة),ملاحظات\n';
    
    data.forEach(d => {
      const time = d.when.toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'});
      const period = SLOT_LABEL[d.slot] || d.slot;
      const val = d.val !== null ? d.val : '';
      csv += `${d.date},${time},${period},${val},${unitSel.value},${d.carbs||0},${d.ins||0},"${d.notes||''}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Logbook_${fromDate.value}_to_${toDate.value}.csv`;
    link.click();
    toast("✅ تم تصدير ملف CSV بنجاح");
  } catch(e) { console.error(e); alert('خطأ في تصدير CSV'); }
  showLoader(false);
}

async function exportXLSX(){
  showLoader(true);
  try {
    const data = await fetchRange(fromDate.value, toDate.value);
    const exportData = data.map(d => ({
      "التاريخ": d.date,
      "الوقت": d.when.toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}),
      "الفترة": SLOT_LABEL[d.slot] || d.slot,
      "القراءة": d.val !== null ? d.val : '—',
      "الوحدة": unitSel.value,
      "كارب (g)": d.carbs || 0,
      "إنسولين (U)": d.ins || 0,
      "ملاحظات": d.notes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "اللوجبوك");
    XLSX.writeFile(wb, `Logbook_${fromDate.value}_to_${toDate.value}.xlsx`);
    toast("✅ تم تصدير ملف Excel بنجاح");
  } catch(e) { 
    console.error(e); 
    alert('حدث خطأ. تأكد من الاتصال لتشغيل مكتبة التصدير.'); 
  }
  showLoader(false);
}

function exportPdf(){
  const node=document.querySelector('.container'); 
  const opt={
    margin: 10,
    filename:`report-${fromDate.value}_${toDate.value}.pdf`, 
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas:{ scale:2, useCORS: true }, 
    jsPDF:{ unit: 'mm', format: 'a4', orientation:'landscape' }
  };
  window.html2pdf().from(node).set(opt).save();
}
