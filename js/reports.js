import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- helpers ---------- */
const $=id=>document.getElementById(id);
const round1=n=>Math.round((+n||0)*10)/10;
const mgdl2mmol=v=>v/18, mmol2mgdl=v=>v*18;
const FIXED_MMOL = Object.freeze({ low:3.9, upper:7.1, severe:10.9, critHigh:14.1 });
const SLOT_ORDER = ["WAKE","FASTING","PRE_BREAKFAST","POST_BREAKFAST","PRE_LUNCH","POST_LUNCH","PRE_DINNER","POST_DINNER","SNACK","BEDTIME","DURING_SLEEP"];
const SLOT_LABEL = {
  FASTING:'صائم/استيقاظ', PRE_BREAKFAST:'ق.الفطار', POST_BREAKFAST:'ب.الفطار',
  PRE_LUNCH:'ق.الغداء', POST_LUNCH:'ب.الغداء',
  PRE_DINNER:'ق.العشاء', POST_DINNER:'ب.العشاء',
  SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم', WAKE:'الاستيقاظ'
};
function formatDate(d){return d.toLocaleDateString('ar-EG',{weekday:'long', day:'2-digit', month:'numeric'})}
function toast(m){const t=$('toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200);}

/* ---------- globals ---------- */
let currentUser, childId=new URLSearchParams(location.search).get('child')||'', childRef, child;
let unitSel, fromDate, toDate, reportGrid, emptyGrid, pie, cmpElems, aiTable;

/* ---------- boot ---------- */
onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  currentUser=u;

  wire(); await loadChild(u.uid);
  unitSel.value = child?.glucoseUnit || 'mg/dL';
  fillThresholdChips();
  initDefaultRange();
  await renderReport();
  wireEvents();
});

function wire(){
  unitSel=$('unitSel'); fromDate=$('fromDate'); toDate=$('toDate');
  reportGrid=$('reportGrid'); emptyGrid=$('emptyGrid'); aiTable=$('aiTable');
  cmpElems={AFrom:$('cmpAFrom'), ATo:$('cmpATo'), BFrom:$('cmpBFrom'), BTo:$('cmpBTo')};
  $('openPrint').onclick=()=>window.open(`reports-print.html?child=${encodeURIComponent(childId)}&from=${fromDate.value}&to=${toDate.value}`,'_blank');
  $('exportPdf').onclick=exportPdf; $('exportCsv').onclick=exportCSV; $('exportXlsx').onclick=exportXLSX;
}
async function loadChild(uid){
  childRef=doc(db,'parents',uid,'children',childId);
  const snap=await getDoc(childRef);
  if(!snap.exists()) { toast('لا يوجد طفل'); throw new Error('child-not-found'); }
  child=snap.data();
  $('childName').textContent=child.displayName||child.name||'الطفل';
  $('childMeta').textContent=`وحدة: ${child.glucoseUnit||'mg/dL'} • CF: ${child.correctionFactor||'—'} • CR: ${child.carbRatio||'—'}`;
}
function limitsInUnit(unit){
  if((unit||'').includes('mmol')) return {...FIXED_MMOL};
  return {
    low: round1(mmol2mgdl(FIXED_MMOL.low)),
    upper: round1(mmol2mgdl(FIXED_MMOL.upper)),
    severe: round1(mmol2mgdl(FIXED_MMOL.severe)),
    critHigh: round1(mmol2mgdl(FIXED_MMOL.critHigh))
  };
}
function fillThresholdChips(){
  const u = unitSel.value;
  const L = limitsInUnit(u);
  $('thresholdChips').innerHTML = `
    <span class="chip">هبوط: <b>${L.low} ${u}</b></span>
    <span class="chip">ارتفاع: <b>${L.upper} ${u}</b></span>
    <span class="chip">ارتفاع شديد: <b>${L.severe} ${u}</b></span>
    <span class="chip">ارتفاع حرج: <b>${L.critHigh} ${u}</b></span>
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
  const L=limitsInUnit(u);
  if(val>L.critHigh) return 'crit';
  if(val>L.severe)   return 'sev';
  if(val>L.upper)    return 'mild';
  if(val<L.low)      return 'sev';
  return 'ok';
}

/* ---------- fetch & render ---------- */
async function fetchRange(fromISO,toISO){
  const col=collection(childRef,'measurements');
  const qy=query(col, where('when','>=',new Date(fromISO+'T00:00:00')), where('when','<=',new Date(toISO+'T23:59:59')), orderBy('when','asc'));
  const snap=await getDocs(qy);
  const unit=unitSel.value;
  const arr=[];
  snap.forEach(s=>{
    const x=s.data();
    let v = unit.includes('mmol') ? (x.value_mmol ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
                                  : (x.value_mgdl ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
    if(!Number.isFinite(+v)) return;
    arr.push({when:x.when.toDate(), slot:x.slotKey||'OTHER', val:round1(+v), notes:x.notes||'', corr:+(x.correctionDose||0)});
  });
  return arr;
}
function groupByDaySlot(list){
  const days={};
  for(const r of list){
    const key=r.when.toISOString().slice(0,10);
    days[key] = days[key] || {date:new Date(key), slots:{}};
    days[key].slots[r.slot]=days[key].slots[r.slot]||[];
    days[key].slots[r.slot].push(r);
  }
  return Object.values(days).sort((a,b)=>a.date-b.date);
}
function cellHTML(vals,u){
  if(!vals || !vals.length) return '';
  // نعرض آخر قيمة في الخلية (+ جرعة التصحيح كبادج صغيرة)
  const v=vals[vals.length-1];
  const cls=classFor(v.val,u);
  return `<span class="v ${cls}">${v.val}</span> ${v.corr? `<span class="u">U ${round1(v.corr)}</span>`:''}`;
}
async function renderReport(){
  fillThresholdChips();
  const unit=unitSel.value, from=fromDate.value, to=toDate.value;
  const data=await fetchRange(from,to);
  const days=groupByDaySlot(data);

  const body= $('reportGrid'); body.innerHTML='';
  if(!days.length){
    $('emptyGrid').classList.remove('hidden');
    // شبكة فارغة بنفس التصميم (7 صفوف)
    for(let i=0;i<7;i++){
      const row=document.createElement('div'); row.className='grid-row';
      row.innerHTML= `<div class="grid-cell">${formatDate(new Date(from))}</div>` + 
        new Array(10).fill(0).map(()=>`<div class="grid-cell">&nbsp;</div>`).join('');
      body.appendChild(row);
    }
    updateStats([]); drawPie({TIR:0,TBR:0,TAR:0}); buildAI([],unit); return;
  }
  $('emptyGrid').classList.add('hidden');

  for(const d of days){
    const row=document.createElement('div'); row.className='grid-row';
    row.innerHTML = `<div class="grid-cell">${formatDate(d.date)}</div>` +
      [
        'FASTING','PRE_BREAKFAST','POST_BREAKFAST',
        'PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER',
        'SNACK','BEDTIME','DURING_SLEEP'
      ].map(k=>`<div class="grid-cell">${cellHTML(d.slots[k],unit)}</div>`).join('');
    body.appendChild(row);
  }

  updateStats(data);
  const parts=calcParts(data,unit); drawPie(parts);
  buildAI(data,unit);
}

/* ---------- stats / pie ---------- */
function updateStats(list){
  const unit=unitSel.value, L=limitsInUnit(unit);
  if(!list.length){ $('statTIR').textContent='0%'; $('statLow').textContent='0%'; $('statHigh').textContent='0%'; $('statAvg').textContent='—'; $('statSD').textContent='—'; $('statCrit').textContent='0'; return; }
  const n=list.length;
  const lows=list.filter(x=>x.val<L.low).length;
  const highs=list.filter(x=>x.val>L.upper).length;
  const crit=list.filter(x=>x.val>L.critHigh).length;
  const TIR = list.filter(x=>x.val>=L.low && x.val<=L.severe).length; // 3.9–10.9
  const mean=list.reduce((a,x)=>a+x.val,0)/n;
  const sd=Math.sqrt(list.reduce((a,x)=>a+Math.pow(x.val-mean,2),0)/n);
  $('statTIR').textContent=`${Math.round(TIR/n*100)}%`;
  $('statLow').textContent=`${Math.round(lows/n*100)}%`;
  $('statHigh').textContent=`${Math.round(highs/n*100)}%`;
  $('statCrit').textContent=String(crit);
  $('statAvg').textContent=`${round1(mean)} ${unit}`;
  $('statSD').textContent=round1(sd);
}
function calcParts(list,unit){
  const L=limitsInUnit(unit), n=list.length||1;
  const tbr=list.filter(x=>x.val<L.low).length/n*100;
  const tir=list.filter(x=>x.val>=L.low && x.val<=L.severe).length/n*100;
  const tar=100 - tir - tbr;
  return {TIR:Math.round(tir), TBR:Math.round(tbr), TAR:Math.round(tar)};
}
function drawPie({TIR,TBR,TAR}){
  const ctx=$('pieTIR').getContext('2d');
  if(pie) pie.destroy();
  pie=new Chart(ctx,{type:'doughnut',
    data:{labels:['داخل النطاق','انخفاض','ارتفاع'], datasets:[{data:[TIR,TBR,TAR]}]},
    options:{plugins:{legend:{position:'bottom'}}, cutout:'70%'}
  });
}

/* ---------- compare two ranges ---------- */
function rowCmp(label,a,b,fmt='%'){
  const diff = (a-b);
  const cls = diff>=0 ? 'diff-up' : 'diff-down';
  return `<div>${label}</div><div>${fmtVal(a,fmt)}</div><div>${fmtVal(b,fmt)}</div><div class="${cls}">${fmtVal(diff,fmt,true)}</div>`;
}
function fmtVal(v,fmt,isDiff=false){
  if(fmt==='%') return `${Math.round(v)}%`;
  return isDiff? (v>0?`+${round1(v)}`:round1(v)) : round1(v);
}
async function runCompare(){
  const unit=unitSel.value;
  const A=await fetchRange(cmpElems.AFrom.value, cmpElems.ATo.value);
  const B=await fetchRange(cmpElems.BFrom.value, cmpElems.BTo.value);
  const pa=calcParts(A,unit), pb=calcParts(B,unit);
  const nA=A.length||1, nB=B.length||1;
  const meanA=A.reduce((a,x)=>a+x.val,0)/nA, meanB=B.reduce((a,x)=>a+x.val,0)/nB;
  const sdA=Math.sqrt(A.reduce((a,x)=>a+Math.pow(x.val-meanA,2),0)/nA);
  const sdB=Math.sqrt(B.reduce((a,x)=>a+Math.pow(x.val-meanB,2),0)/nB);

  $('cmpTable').innerHTML = `
    <div>المؤشر</div><div>الحالية</div><div>السابقة</div><div>الفرق</div>
    ${rowCmp('TIR',pa.TIR,pb.TIR,'%')}
    ${rowCmp('TBR',pa.TBR,pb.TBR,'%')}
    ${rowCmp('TAR',pa.TAR,pb.TAR,'%')}
    ${rowCmp('المتوسط',meanA,meanB,'num')}
    ${rowCmp('SD',sdA,sdB,'num')}
    ${rowCmp('عدد القياسات',nA,nB,'num')}
  `;
}

/* ---------- AI (horizontal table) ---------- */
function buildAI(list,unit){
  const L=limitsInUnit(unit);
  // قواعد بسيطة: نمط ارتفاع بعد الفطار/العشاء، هبوط قبل النوم...
  const bySlot = s => list.filter(x=>x.slot===s).map(x=>x.val);
  const mean = arr => arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const patt=[];
  const pb = bySlot('POST_BREAKFAST'), pd=bySlot('POST_DINNER'), bed=bySlot('BEDTIME');
  if(pb.length && pb.filter(v=>v>L.upper).length>=3) patt.push({
    name:'ارتفاع متكرر بعد الفطار', desc:`عدد ${pb.filter(v=>v>L.upper).length} من ${pb.length} قراءات فوق ${L.upper} ${unit}`,
    rec:'راجع CR للفطار أو أضف تصحيحًا صغيرًا', conf:'متوسط'
  });
  if(pd.length && pd.filter(v=>v>L.severe).length>=3) patt.push({
    name:'ارتفاع شديد بعد العشاء', desc:`${pd.filter(v=>v>L.severe).length} قراءة > ${L.severe} ${unit}`,
    rec:'تصحيح بعد العشاء ومراجعة توقيت الجرعة', conf:'عالٍ'
  });
  if(bed.length && bed.filter(v=>v<L.low).length>=2) patt.push({
    name:'هبوط قبل النوم', desc:`${bed.filter(v=>v<L.low).length} قراءتين دون ${L.low} ${unit}`,
    rec:'وجبة خفيفة أو تقليل تصحيح المساء', conf:'عالٍ'
  });
  if(!patt.length) patt.push({name:'لا توجد أنماط لافتة', desc:'البيانات ضمن الحدود غالبًا', rec:'—', conf:'—'});

  aiTable.innerHTML = ['<div>النمط</div><div>الوصف</div><div>التوصية</div><div>الثقة</div><div>إدراج</div>'].join('')
   + patt.map(p=>`<div>${p.name}</div><div>${p.desc}</div><div>${p.rec}</div><div>${p.conf}</div><div><button class="btn btn--ghost btn-mini">إدراج</button></div>`).join('');
}

/* ---------- export ---------- */
async function exportCSV(){
  const unit=unitSel.value; const rows=[['التاريخ','النوع','القيمة','U']];
  const list=await fetchRange(fromDate.value,toDate.value);
  groupByDaySlot(list).forEach(d=>{
    Object.keys(d.slots).forEach(k=>{
      const v=d.slots[k][d.slots[k].length-1];
      rows.push([formatDate(d.date), SLOT_LABEL[k]||k, `${v.val} ${unit}`, v.corr||0]);
    });
  });
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`report-${fromDate.value}_${toDate.value}.csv`; a.click();
}
async function exportXLSX(){
  const XLSX=window.XLSX; const unit=unitSel.value;
  const rows=[['التاريخ','النوع','القيمة','U']];
  const list=await fetchRange(fromDate.value,toDate.value);
  groupByDaySlot(list).forEach(d=>{
    Object.keys(d.slots).forEach(k=>{
      const v=d.slots[k][d.slots[k].length-1];
      rows.push([formatDate(d.date), SLOT_LABEL[k]||k, `${v.val} ${unit}`, v.corr||0]);
    });
  });
  const ws=XLSX.utils.aoa_to_sheet(rows); const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Report'); XLSX.writeFile(wb,`report-${fromDate.value}_${toDate.value}.xlsx`);
}
function exportPdf(){
  const node=document.querySelector('.container'); const opt={filename:`report-${fromDate.value}_${toDate.value}.pdf`, html2canvas:{scale:2}, jsPDF:{orientation:'landscape'}};
  window.html2pdf().from(node).set(opt).save();
}

/* ---------- events ---------- */
function wireEvents(){
  $('applyBtn').onclick=renderReport;
  $('cmpRun').onclick=runCompare;
  unitSel.onchange=()=>{ fillThresholdChips(); renderReport(); };
}
