import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, getDocs, query, where, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* DOM */
const params = new URLSearchParams(location.search);
const childId = params.get('child');
const loaderEl = document.getElementById('loader');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');

const dayEl   = document.getElementById('day');
const slotEl  = document.getElementById('slot');
const valueEl = document.getElementById('value');
const inUnitEl= document.getElementById('inUnit');
const convHint= document.getElementById('convHint');

const correctionDoseEl = document.getElementById('correctionDose');
const corrHint = document.getElementById('corrHint');
const bolusDoseEl = document.getElementById('bolusDose');
const hypoTreatmentEl = document.getElementById('hypoTreatment');
const notesEl = document.getElementById('notes');

const btnSave = document.getElementById('btnSave');
const btnReset= document.getElementById('btnReset');

const outUnitEl = document.getElementById('outUnit');
const tbody = document.getElementById('tbody');

/* Helpers */
const pad=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const toMgdl=mmol=>Math.round(mmol*18);
const toMmol=mgdl=>mgdl/18;

function loader(show){loaderEl.classList.toggle('hidden',!show);}

/* خانة التصنيف */
const SLOTS=[
  ['wake','الاستيقاظ'],['pre_bf','ق.الفطار'],['post_bf','ب.الفطار'],
  ['pre_ln','ق.الغدا'],['post_ln','ب.الغدا'],
  ['pre_dn','ق.العشا'],['post_dn','ب.العشا'],
  ['snack','سناك'],['pre_sleep','ق.النوم'],['during_sleep','أثناء النوم']
];

/* حالة القراءة */
function getState(mmol,min,max){
  if(mmol<min) return 'low';
  if(mmol>max) return 'high';
  return 'normal';
}
function stateLabel(s){return {normal:'طبيعي',high:'ارتفاع',low:'هبوط'}[s]||'—';}

/* Globals */
let USER=null, child=null, normalMin=4, normalMax=7, CF=null;
let editingId=null;

/* Init */
onAuthStateChanged(auth, async(user)=>{
  if(!user) return location.href='index.html';
  USER=user;
  if(!childId){alert('لا يوجد معرف طفل');return;}
  slotEl.innerHTML=SLOTS.map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  dayEl.value=todayStr();
  await loadChild(); await loadTable();
  btnSave.onclick=saveMeas; btnReset.onclick=()=>fillForm({});
  outUnitEl.onchange=()=>renderRows(_rows);
});

/* Load child */
async function loadChild(){
  loader(true);
  const snap=await getDoc(doc(db,`parents/${USER.uid}/children/${childId}`));
  if(!snap.exists()){alert('لم يتم العثور على الطفل');return;}
  child=snap.data();
  childNameEl.textContent=child.name||'طفل';
  childMetaEl.textContent=`${child.gender||'—'} • ${child.birthDate||'—'}`;
  normalMin=Number(child.normalRange?.min||4);
  normalMax=Number(child.normalRange?.max||7);
  CF=child.correctionFactor||null;
  chipRangeEl.textContent=`${normalMin}–${normalMax} mmol/L`;
  chipCREl.textContent=`CR: ${child.carbRatio||'—'}`;
  chipCFEl.textContent=`CF: ${CF||'—'}`;
  loader(false);
}

/* Table */
let _rows=[];
async function loadTable(){
  loader(true);
  const base=collection(db,`parents/${USER.uid}/children/${childId}/measurements`);
  const snap=await getDocs(query(base,where('date','==',dayEl.value)));
  _rows=snap.docs.map(d=>({id:d.id,...d.data()}));
  renderRows(_rows); loader(false);
}
function renderRows(rows){
  if(!rows.length){tbody.innerHTML=`<tr><td colspan="8">لا يوجد</td></tr>`;return;}
  const outU=outUnitEl.value;
  tbody.innerHTML=rows.map(r=>{
    const mmol=r.value_mmol,mgdl=r.value_mgdl;
    const val=(outU==='mmol'? `${mmol.toFixed(1)} mmol/L`:`${mgdl} mg/dL`);
    const st=getState(mmol,normalMin,normalMax);
    return `<tr>
      <td>${SLOTS.find(s=>s[0]===r.slot)?.[1]||r.slot}</td>
      <td>${val}</td>
      <td class="state-${st}">${stateLabel(st)}</td>
      <td>${r.correctionDose||'—'}</td>
      <td>${r.bolusDose||'—'}</td>
      <td>${r.hypoTreatment||'—'}</td>
      <td>${r.notes||'—'}</td>
      <td><button onclick="editRow('${r.id}')">✏</button></td>
    </tr>`;
  }).join('');
}
window.editRow=id=>{
  editingId=id;
  const row=_rows.find(r=>r.id===id);
  fillForm(row);
};

/* Form */
function fillForm(r={}){
  slotEl.value=r.slot||SLOTS[0][0];
  valueEl.value=r.value||'';
  correctionDoseEl.value=r.correctionDose||'';
  bolusDoseEl.value=r.bolusDose||'';
  hypoTreatmentEl.value=r.hypoTreatment||'';
  notesEl.value=r.notes||'';
}

/* Save */
async function saveMeas(){
  const slot=slotEl.value, raw=Number(valueEl.value);
  if(isNaN(raw)) return alert('ادخل قيمة');
  const mmol=(inUnitEl.value==='mmol')?raw:toMmol(raw);
  const mgdl=(inUnitEl.value==='mgdl')?raw:toMgdl(raw);
  const payload={
    date:dayEl.value,slot,
    value:raw,unit:inUnitEl.value,
    value_mmol:mmol,value_mgdl:mgdl,
    correctionDose:correctionDoseEl.value||null,
    bolusDose:bolusDoseEl.value||null,
    hypoTreatment:hypoTreatmentEl.value||null,
    notes:notesEl.value||null,
    state:getState(mmol,normalMin,normalMax)
  };
  const base=collection(db,`parents/${USER.uid}/children/${childId}/measurements`);
  if(editingId) await updateDoc(doc(db,`${base.path}/${editingId}`),payload);
  else await addDoc(base,payload);
  editingId=null; fillForm({}); loadTable();
}
