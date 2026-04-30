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

let currentUser, childId=new URLSearchParams(location.search).get('child')||localStorage.getItem('selectedChildId'), childRef, child;
let unitSel, fromDate, toDate, reportGrid, emptyGrid, pie, cmpElems, aiTable;

// النطاقات الديناميكية من الإعدادات
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
    initDefaultRange();
    await renderReport();
    wireEvents();
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
}

async function loadChild(uid){
  childRef=doc(db,'parents',uid,'children',childId);
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
    return { low: round1(mgdl2mmol(sysLimits.low)), upper: round1(mgdl2mmol(sysLimits.high)), severe: round1(mgdl2mmol(sysLimits.critHigh)), critHigh: round1(mgdl2mmol(sysLimits.critHigh) + 2) }; // تقريبي
  }
  if (targetUnit === 'mg/dL' && sysUnit === 'mmol/L') {
    return { low: round1(mmol2mgdl(sysLimits.low)), upper: round1(mmol2mgdl(sysLimits.high)), severe: round1(mmol2mgdl(sysLimits.critHigh)), critHigh: round1(mmol2mgdl(sysLimits.critHigh) + 36) };
  }
  return { ...sysLimits };
}

function fillThresholdChips(){
  const u = unitSel.value;
  const L = limitsInUnit(u);
  $('thresholdChips').innerHTML = `
    <span class="chip">هبوط: <b>${L.low} ${u}</b></span>
    <span class="chip">ارتفاع: <b>${L.upper} ${u}</b></span>
    <span class="chip">ارتفاع حرج: <b>${L.severe} ${u}</b></span>
  `;
}

function initDefaultRange(){
  const now=new Date();
  const to=now.toISOString().slice(0,10);
  const from=new Date(now); from.setDate(from.getDate()-6);
  fromDate.value=from.toISOString().slice(0,10); toDate.value=to;
  cmpElems.AFrom.value=fromDate.value; cmpElems.ATo.value=toDate.value;
  const prevFrom=new Date(from); prevFrom.setDate(prevFrom.getDate()-7);
  const prevTo=new Date(from); prevTo.setDate(prevTo.getDate()-1);
  cmpElems.BFrom.value=prevFrom.toISOString().slice(0,10);
  cmpElems.BTo.value=prevTo.toISOString().slice(0,10);
}

function classFor(val,u){
  if(val == null) return '';
  const L=limitsInUnit(u);
  if(val>=L.severe) return 'crit';
  if(val>L.upper) return 'mild';
  if(val<L.low) return 'sev';
  return 'ok';
}

async function fetchRange(fromISO,toISO){
  const col=collection(childRef,'measurements');
  const qy=query(col, where('date','>=',fromISO), where('date','<=',toISO));
  const snap=await getDocs(qy);
  const unit=unitSel.value;
  const arr=[];
  snap.forEach(s=>{
    const x=s.data();
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
  fillThresholdChips();
  const unit=unitSel.value, from=fromDate.value, to=toDate.value;
  const data=await fetchRange(from,to);
  const days=groupByDaySlot(data);

  const body= $('reportGrid'); body.innerHTML='';
  if(!days.length){
    $('emptyGrid').classList.remove('hidden');
    updateStats([]); drawPie({TIR:0,TBR:0,TAR:0}); buildAI([],unit); 
    showLoader(false);
    return;
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

function updateStats(list){
  const validList = list.filter(x => x.val !== null);
  const unit=unitSel.value, L=limitsInUnit(unit);
  if(!validList.length){ $('statTIR').textContent='0%'; $('statLow').textContent='0%'; $('statHigh').textContent='0%'; $('statAvg').textContent='—'; $('statSD').textContent='—'; $('statCrit').textContent='0'; return; }
  const n=validList.length;
  const lows=validList.filter(x=>x.val<L.low).length;
  const highs=validList.filter(x=>x.val>L.upper).length;
  const crit=validList.filter(x=>x.val>=L.severe).length;
  const TIR = validList.filter(x=>x.val>=L.low && x.val<=L.upper).length;
  const mean=validList.reduce((a,x)=>a+x.val,0)/n;
  const sd=Math.sqrt(validList.reduce((a,x)=>a+Math.pow(x.val-mean,2),0)/n);
  
  $('statTIR').textContent=`${Math.round(TIR/n*100)}%`;
  $('statLow').textContent=`${Math.round(lows/n*100)}%`;
  $('statHigh').textContent=`${Math.round(highs/n*100)}%`;
  $('statCrit').textContent=String(crit);
  $('statAvg').textContent=`${round1(mean)} ${unit}`;
  $('statSD').textContent=round1(sd);
}

function calcParts(list,unit){
  const validList = list.filter(x => x.val !== null);
  const L=limitsInUnit(unit), n=validList.length||1;
  const tbr=validList.filter(x=>x.val<L.low).length/n*100;
  const tir=validList.filter(x=>x.val>=L.low && x.val<=L.upper).length/n*100;
  const tar=100 - tir - tbr;
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
  
  const fast = valid.filter(x=>x.slot==='FASTING' || x.slot==='WAKE').map(x=>x.val);
  const sleep = valid.filter(x=>x.slot==='DURING_SLEEP' || x.slot==='BEDTIME').map(x=>x.val);
  const pBreakfast = valid.filter(x=>x.slot==='POST_BREAKFAST').map(x=>x.val);
  const pDinner = valid.filter(x=>x.slot==='POST_DINNER').map(x=>x.val);

  if(fast.length >= 3 && sleep.length >= 2) {
    const highFasting = fast.filter(v => v > L.upper).length;
    const normalSleep = sleep.filter(v => v >= L.low && v <= L.severe).length;
    if (highFasting >= 2 && normalSleep >= 2) {
      patt.push({ name: 'ظاهرة الفجر (Dawn Phenomenon)', desc: 'السكر يكون طبيعياً أثناء النوم، ولكنه يرتفع بشكل ملحوظ عند الاستيقاظ.', rec: 'قد يقترح الطبيب زيادة طفيفة في جرعة المنظم (Basal) أو تغيير توقيتها.', conf: 'عالي 🔴' });
    }
  }

  if(fast.length >= 3 && sleep.length >= 2) {
    const highFasting = fast.filter(v => v > L.upper).length;
    const lowSleep = sleep.filter(v => v < L.low).length;
    if (highFasting >= 2 && lowSleep >= 1) {
      patt.push({ name: 'هبوط ليلي وارتداد (Somogyi Effect)', desc: 'اكتشف النظام هبوطاً في السكر أثناء الليل، يتبعه ارتفاع ارتدادي في الصباح.', rec: 'يُرجى مناقشة الطبيب في تقليل جرعة المنظم المسائية أو إضافة سناك قبل النوم.', conf: 'حرج 🚨' });
    }
  }

  if(pBreakfast.length >= 3 && pBreakfast.filter(v=>v>=L.severe).length >= 2) {
    patt.push({ name: 'ارتفاع حاد بعد الإفطار', desc: 'السكر يرتفع بشدة بعد الإفطار في معظم الأيام.', rec: 'قد يحتاج معامل الكارب (CR) للإفطار إلى التقليل (أخذ أنسولين أكثر).', conf: 'متوسط 🟡' });
  }

  if(pDinner.length >= 3 && pDinner.filter(v=>v<L.low).length >= 2) {
    patt.push({ name: 'هبوط متكرر بعد العشاء', desc: 'تم تسجيل هبوط للسكر بعد وجبة العشاء أكثر من مرة.', rec: 'قد يحتاج معامل الكارب (CR) للعشاء إلى الزيادة (أخذ أنسولين أقل).', conf: 'عالي 🔴' });
  }

  if(!patt.length) patt.push({name:'✅ استقرار عام', desc:'الأنماط الحيوية للطفل ضمن الحدود الآمنة غالباً.', rec:'استمر على نفس الخطة الرائعة!', conf:'—'});

  aiTable.innerHTML = ['<div>النمط</div><div>الوصف</div><div>التوصية الطبية</div><div>مستوى الأهمية</div>'].join('')
   + patt.map(p=>`<div><b>${p.name}</b></div><div>${p.desc}</div><div style="color:#2563eb">${p.rec}</div><div>${p.conf}</div>`).join('');
}

async function exportCSV(){ }
async function exportXLSX(){ }
function exportPdf(){
  const node=document.querySelector('.container'); const opt={filename:`report-${fromDate.value}_${toDate.value}.pdf`, html2canvas:{scale:2}, jsPDF:{orientation:'landscape'}};
  window.html2pdf().from(node).set(opt).save();
}

function wireEvents(){
  $('applyBtn').onclick=renderReport;
  $('cmpRun').onclick=runCompare;
  unitSel.onchange=()=>{ fillThresholdChips(); renderReport(); };
}
