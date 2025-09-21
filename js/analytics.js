import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $=id=>document.getElementById(id), round1=n=>Math.round((+n||0)*10)/10;
const mgdl2mmol=v=>v/18, mmol2mgdl=v=>v*18;
const FIXED_MMOL={low:3.9,upper:7.1,severe:10.9,critHigh:14.1};
function limitsInUnit(u){return u.includes('mmol')?{...FIXED_MMOL}:{low:round1(mmol2mgdl(3.9)),upper:round1(mmol2mgdl(7.1)),severe:round1(mmol2mgdl(10.9)),critHigh:round1(mmol2mgdl(14.1))}}
function toast(m){const t=$('toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200);}

let childId=new URLSearchParams(location.search).get('child')||'', childRef, child, unitSel, fromDate, toDate, lineChart, pieChart;

onAuthStateChanged(auth, async (u)=>{
  if(!u){location.href='index.html';return;}
  childRef=doc(db,'parents',u.uid,'children',childId);
  const s=await getDoc(childRef); child=s.data();
  $('childName').textContent=child?.displayName||child?.name||'—';
  $('childMeta').textContent=`وحدة: ${child.glucoseUnit||'mg/dL'} • CF: ${child.correctionFactor||'—'} • CR: ${child.carbRatio||'—'}`;
  wire(); initDefault(); await refreshAll();
  $('toReport').onclick=()=>location.href=`reports.html?child=${encodeURIComponent(childId)}`;
});

function wire(){
  unitSel=$('unitSel'); fromDate=$('fromDate'); toDate=$('toDate');
  $('applyBtn').onclick=refreshAll; $('cmpRun').onclick=runCompare;
  unitSel.onchange=()=>{ fillThresholdChips(); refreshAll(); };
  $('exportCsv').onclick=exportCSV; $('exportPdf').onclick=exportPDF;
}
function initDefault(){
  unitSel.value = child?.glucoseUnit || 'mg/dL';
  const now=new Date(); const to=now.toISOString().slice(0,10); const from=new Date(now); from.setDate(from.getDate()-13);
  fromDate.value=from.toISOString().slice(0,10); toDate.value=to;
  $('cmpAFrom').value=fromDate.value; $('cmpATo').value=toDate.value;
  const prevFrom=new Date(from); prevFrom.setDate(prevFrom.getDate()-14);
  const prevTo=new Date(from); prevTo.setDate(prevTo.getDate()-1);
  $('cmpBFrom').value=prevFrom.toISOString().slice(0,10); $('cmpBTo').value=prevTo.toISOString().slice(0,10);
  fillThresholdChips();
}
function fillThresholdChips(){
  const u=unitSel.value, L=limitsInUnit(u);
  $('thresholdChips').innerHTML = `
    <span class="chip">هبوط: <b>${L.low} ${u}</b></span>
    <span class="chip">ارتفاع: <b>${L.upper} ${u}</b></span>
    <span class="chip">ارتفاع شديد: <b>${L.severe} ${u}</b></span>
    <span class="chip">ارتفاع حرج: <b>${L.critHigh} ${u}</b></span>
  `;
}

async function fetchRange(fromISO,toISO){
  const col=collection(childRef,'measurements');
  const qy=query(col, where('when','>=',new Date(fromISO+'T00:00:00')), where('when','<=',new Date(toISO+'T23:59:59')), orderBy('when','asc'));
  const snap=await getDocs(qy);
  const u=unitSel.value, arr=[];
  snap.forEach(s=>{
    const x=s.data();
    let v = u.includes('mmol') ? (x.value_mmol ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
                               : (x.value_mgdl ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
    if(!Number.isFinite(+v)) return;
    arr.push({t:x.when.toDate(), v:round1(+v), slot:x.slotKey||'OTHER'});
  }); return arr;
}

async function refreshAll(){
  const u=unitSel.value; const list=await fetchRange(fromDate.value,toDate.value);
  drawLine(list,u); drawPie(list,u); buildAI(list,u);
}
function drawLine(list,u){
  const ctx=$('lineChart').getContext('2d'); const labels=list.map(x=>x.t.toLocaleString('ar-EG',{weekday:'short',hour:'2-digit',minute:'2-digit'}));
  const data=list.map(x=>x.v);
  if(lineChart) lineChart.destroy();
  lineChart=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'Glucose',data,pointRadius:2,borderWidth:1.6}]},
    options:{scales:{y:{ticks:{},grid:{}}}}
  });
}
function drawPie(list,u){
  const L=limitsInUnit(u); const n=list.length||1;
  const tbr=list.filter(x=>x.v<L.low).length/n*100;
  const tir=list.filter(x=>x.v>=L.low && x.v<=L.severe).length/n*100;
  const tar=100-tir-tbr;
  const ctx=$('pieChart').getContext('2d'); if(pieChart) pieChart.destroy();
  pieChart=new Chart(ctx,{type:'doughnut',data:{labels:['داخل النطاق','انخفاض','ارتفاع'],datasets:[{data:[Math.round(tir),Math.round(tbr),Math.round(tar)]}]},options:{plugins:{legend:{position:'bottom'}},cutout:'70%'}});
}

/* ---------- compare ---------- */
function rowCmp(label,a,b,fmt='%'){ const diff=(a-b); const cls=diff>=0?'diff-up':'diff-down';
  const fmtVal=(v)=>fmt==='%'?`${Math.round(v)}%`:Math.round(v*10)/10;
  return `<div>${label}</div><div>${fmtVal(a)}</div><div>${fmtVal(b)}</div><div class="${cls}">${diff>0?'+':''}${fmtVal(diff)}</div>`;
}
async function runCompare(){
  const u=unitSel.value;
  const A=await fetchRange($('cmpAFrom').value,$('cmpATo').value);
  const B=await fetchRange($('cmpBFrom').value,$('cmpBTo').value);
  const L=limitsInUnit(u); const nA=A.length||1, nB=B.length||1;
  const pa={ TBR: A.filter(x=>x.v<L.low).length/nA*100, TIR: A.filter(x=>x.v>=L.low&&x.v<=L.severe).length/nA*100 };
  const pb={ TBR: B.filter(x=>x.v<L.low).length/nB*100, TIR: B.filter(x=>x.v>=L.low&&x.v<=L.severe).length/nB*100 };
  const meanA=A.reduce((a,x)=>a+x.v,0)/nA, meanB=B.reduce((a,x)=>a+x.v,0)/nB;
  const sdA=Math.sqrt(A.reduce((a,x)=>a+Math.pow(x.v-meanA,2),0)/nA);
  const sdB=Math.sqrt(B.reduce((a,x)=>a+Math.pow(x.v-meanB,2),0)/nB);
  $('cmpTable').innerHTML = `
    <div>المؤشر</div><div>الحالية</div><div>السابقة</div><div>الفرق</div>
    ${rowCmp('TIR',pa.TIR,pb.TIR,'%')}
    ${rowCmp('TBR',pa.TBR,pb.TBR,'%')}
    ${rowCmp('TAR',100-pa.TIR-pa.TBR,100-pb.TIR-pb.TBR,'%')}
    ${rowCmp('المتوسط',meanA,meanB,'n')}
    ${rowCmp('SD',sdA,sdB,'n')}
    ${rowCmp('عدد القياسات',nA,nB,'n')}
  `;
}

/* ---------- AI ---------- */
function buildAI(list,u){
  const L=limitsInUnit(u), ai=[];
  const buckets={}; list.forEach(x=>{ const d=x.t.getDay(); buckets[d]=buckets[d]||[]; buckets[d].push(x.v); });
  // مثالين قواعد
  const evenings=list.filter(x=>x.t.getHours()>=18 && x.t.getHours()<=23).map(x=>x.v);
  if(evenings.length && evenings.filter(v=>v>L.severe).length>=3) ai.push(['ارتفاعات مسائية','ارتفاع شديد متكرر مساءً','اقترح ضبط تصحيح المساء','عالٍ']);
  const mornings=list.filter(x=>x.t.getHours()<=9).map(x=>x.v);
  if(mornings.length && mornings.filter(v=>v<L.low).length>=2) ai.push(['هبوط صباحي','هبوطات صباحية متكررة','وجبة خفيفة ليلًا أو تقليل تصحيح النوم','متوسط']);

  $('aiTable').innerHTML=['<div>النمط</div><div>الوصف</div><div>التوصية</div><div>الثقة</div><div>إدراج</div>'].join('') +
    (ai.length? ai.map(r=>`<div>${r[0]}</div><div>${r[1]}</div><div>${r[2]}</div><div>${r[3]}</div><div><button class="btn btn--ghost" style="height:30px;border-radius:8px">إدراج</button></div>`).join('')
              : `<div colspan="5" style="grid-column:1/-1;padding:10px;color:#64748b">لا توجد أنماط لافتة.</div>`);
}

/* ---------- export ---------- */
async function exportCSV(){
  const u=unitSel.value; const list=await fetchRange(fromDate.value,toDate.value);
  const rows=[['الوقت','القيمة']].concat(list.map(x=>[x.t.toLocaleString('ar-EG'), `${x.v} ${u}`]));
  const csv=rows.map(r=>r.join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`analytics-${fromDate.value}_${toDate.value}.csv`; a.click();
}
function exportPDF(){
  const node=document.querySelector('.container'); const opt={filename:`analytics-${fromDate.value}_${toDate.value}.pdf`, html2canvas:{scale:2}};
  window.html2pdf().from(node).set(opt).save();
}
