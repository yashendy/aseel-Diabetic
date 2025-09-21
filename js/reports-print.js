import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const mgdl2mmol=v=>v/18, mmol2mgdl=v=>v*18, round1=n=>Math.round((+n||0)*10)/10;
const FIXED_MMOL={low:3.9,upper:7.1,severe:10.9,critHigh:14.1};
function limitsInUnit(u){return u.includes('mmol')?{...FIXED_MMOL}:{low:round1(mmol2mgdl(3.9)),upper:round1(mmol2mgdl(7.1)),severe:round1(mmol2mgdl(10.9)),critHigh:round1(mmol2mgdl(14.1))}}
const SLOT_LABEL={ FASTING:'صائم/استيقاظ', PRE_BREAKFAST:'ق.الفطار', POST_BREAKFAST:'ب.الفطار', PRE_LUNCH:'ق.الغداء', POST_LUNCH:'ب.الغداء', PRE_DINNER:'ق.العشاء', POST_DINNER:'ب.العشاء', SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم' };
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search); const childId=params.get('child'); const from=params.get('from'); const to=params.get('to');
let childRef, child;

onAuthStateChanged(auth, async (u)=>{
  if(!u){return;}
  childRef=doc(db,'parents',u.uid,'children',childId);
  const s=await getDoc(childRef); child=s.data(); $('childName').textContent=child?.displayName||child?.name||'—';
  $('childMeta').textContent=`وحدة: ${child.glucoseUnit||'mg/dL'} • CF: ${child.correctionFactor||'—'} • CR: ${child.carbRatio||'—'}`;
  $('rangeTxt').textContent = `من ${from} إلى ${to}`; $('now').textContent = new Date().toLocaleString('ar-EG');
  await render();
  setTimeout(()=>window.print(), 300);
});

function classFor(v,u){ const L=limitsInUnit(u); if(v>L.critHigh) return 'crit'; if(v>L.severe) return 'sev'; if(v>L.upper) return 'mild'; if(v<L.low) return 'sev'; return 'ok'; }
function formatDate(d){return d.toLocaleDateString('ar-EG',{weekday:'long', day:'2-digit', month:'numeric'})}

async function fetchRange(fromISO,toISO){
  const col=collection(childRef,'measurements');
  const qy=query(col, where('when','>=',new Date(fromISO+'T00:00:00')), where('when','<=',new Date(toISO+'T23:59:59')), orderBy('when','asc'));
  const snap=await getDocs(qy); const unit=(child?.glucoseUnit)||'mg/dL';
  const arr=[]; snap.forEach(s=>{
    const x=s.data();
    let v = unit.includes('mmol') ? (x.value_mmol ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
                                  : (x.value_mgdl ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
    if(!Number.isFinite(+v)) return;
    arr.push({when:x.when.toDate(), slot:x.slotKey||'OTHER', val:round1(+v), corr:+(x.correctionDose||0)});
  }); return arr;
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
  const v=vals[vals.length-1];
  const cls=classFor(v.val,u);
  return `<span class="v ${cls}">${v.val}</span>${v.corr?`<span class="u">U ${round1(v.corr)}</span>`:''}`;
}
async function render(){
  const unit=child?.glucoseUnit||'mg/dL', body=$('grid');
  const list=await fetchRange(from,to); const days=groupByDaySlot(list);
  body.innerHTML='';
  if(!days.length){ $('empty').style.display='block'; for(let i=0;i<7;i++){ const r=document.createElement('div'); r.className='grid-row';
    r.innerHTML=`<div class="cell">${from}</div>`+new Array(10).fill(0).map(()=>`<div class="cell">&nbsp;</div>`).join(''); body.appendChild(r);} return;}
  $('empty').style.display='none';
  for(const d of days){
    const row=document.createElement('div'); row.className='grid-row';
    row.innerHTML=`<div class="cell">${formatDate(d.date)}</div>`+[
      'FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP'
    ].map(k=>`<div class="cell">${cellHTML(d.slots[k],unit)}</div>`).join('');
    body.appendChild(row);
  }
}
