// reports-print.js — Pivot print: Date | WAKE | PRE/POST meals | PRE_SLEEP | DURING_SLEEP
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ==== DOM & Params ==== */
const qs        = new URLSearchParams(location.search);
const childId   = qs.get('child') || localStorage.getItem('lastChildId');
const paramFrom = qs.get('from') || '';
const paramTo   = qs.get('to')   || '';
const paramUnit = (qs.get('unit') || 'mmol').toLowerCase();
const paramBlank= qs.get('blank') === '1';

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');

const unitSel   = document.getElementById('unitSel');
const notesMode = document.getElementById('notesMode');
const btnPrint  = document.getElementById('btnPrint');
const blankMode = document.getElementById('blankMode');

const fromEl  = document.getElementById('fromDate');
const toEl    = document.getElementById('toDate');
const applyEl = document.getElementById('apply');

const thead = document.getElementById('thead');
const tbody = document.getElementById('tbody');

const loaderEl = document.getElementById('loader');
const showLoader = v => loaderEl.classList.toggle('hidden', !v);

/* ==== helpers ==== */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (ds,delta)=>{const d=new Date(ds);d.setDate(d.getDate()+delta);return todayStr(d);};
const toMgdl = mmol => Math.round(Number(mmol)*18);
const esc = s => (s??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

function stateOf(mmol, min, max){ if(mmol<min) return 'low'; if(mmol>max) return 'high'; return 'ok'; }
function valueText(mmol, mgdl, unit){ return unit==='mgdl' ? `${Math.round(mgdl)} mg/dL` : `${Number(mmol).toFixed(1)} mmol/L`; }
function arrowOf(st){ return st==='low'?'↓':(st==='high'?'↑':'↔'); }

const SLOT_ORDER = [
  ['wake','الاستيقاظ'],
  ['pre_bf','ق.الفطار'],  ['post_bf','ب.الفطار'],
  ['pre_ln','ق.الغدا'],   ['post_ln','ب.الغدا'],
  ['pre_dn','ق.العشا'],   ['post_dn','ب.العشا'],
  ['pre_sleep','قبل النوم'], ['during_sleep','أثناء النوم'],
  // snack مستبعد من الأعمدة المطبوعة
];

let USER=null, CHILD=null;
let limits={min:4,max:7}, CR=null, CF=null;
let pivotDates=[];  // sorted dates
let pivotRows={};   // date -> { slotKey: {mmol,mgdl,corr,notes,state} }

/* ==== boot ==== */
onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }
  USER=u;

  try{
    showLoader(true);
    await loadChild();
    initControls();
    await loadAndRender();
  }finally{
    showLoader(false);
  }
});

/* ==== child ==== */
async function loadChild(){
  const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); throw 0; }
  const c = snap.data();
  CHILD=c;

  childNameEl.textContent = c.name || 'طفل';
  childMetaEl.textContent = `${c.gender || '—'} • العمر: ${calcAge(c.birthDate)} سنة`;

  limits = {
    min: Number(c.normalRange?.min ?? 4),
    max: Number(c.normalRange?.max ?? 7),
  };
  CR = c.carbRatio!=null?Number(c.carbRatio):null;
  CF = c.correctionFactor!=null?Number(c.correctionFactor):null;

  chipRangeEl.textContent = `النطاق: ${limits.min}–${limits.max} mmol/L`;
  chipCREl.textContent = `CR: ${CR ?? '—'} g/U`;
  chipCFEl.textContent = `CF: ${CF ?? '—'} mmol/L/U`;
}
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return a;
}

/* ==== controls ==== */
function initControls(){
  const today=todayStr();
  fromEl.value = paramFrom || addDays(today,-7);
  toEl.value   = paramTo   || today;
  unitSel.value = (paramUnit==='mgdl') ? 'mgdl' : 'mmol';
  blankMode.checked = paramBlank;

  applyEl.addEventListener('click', loadAndRender);
  unitSel.addEventListener('change', renderTable);
  notesMode.addEventListener('change', renderTable);
  blankMode.addEventListener('change', loadAndRender);
  btnPrint.addEventListener('click', ()=>window.print());
}

/* ==== data ==== */
async function loadAndRender(){
  const from=fromEl.value, to=toEl.value;
  if(!from||!to){ return; }

  showLoader(true);
  try{
    pivotDates=[]; pivotRows={};

    if(blankMode.checked){
      // أسبوع فارغ للكتابة اليدوية يبدأ من "من"
      for(let i=0;i<7;i++){
        const d = addDays(from, i);
        pivotDates.push(d);
        pivotRows[d] = {};
      }
    }else{
      const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
      const qy = query(base, where('date','>=',from), where('date','<=',to), orderBy('date','asc'));
      const snap = await getDocs(qy);

      snap.forEach(docSnap=>{
        const r = docSnap.data();
        const date = r.date;
        const slot = r.slot || r.input?.slot || '';
        if(!date || !slot) return;

        // استبعاد السناك من الطباعة
        if(slot==='snack') return;

        const mmol = (r.value_mmol!=null) ? Number(r.value_mmol)
                    : (r.unit==='mmol/L' ? Number(r.value)
                    :  (r.value_mgdl!=null ? Number(r.value_mgdl)/18 : null));
        if(mmol==null || !isFinite(mmol)) return;
        const mgdl = (r.value_mgdl!=null) ? Number(r.value_mgdl) : toMgdl(mmol);
        const corr = r.correctionDose ?? r.input?.correctionDose ?? null;
        const notes= r.notes || r.input?.notes || '';

        (pivotRows[date]??=( {} ))[slot] = { mmol, mgdl, corr, notes, state: stateOf(mmol, limits.min, limits.max) };
      });

      pivotDates = Object.keys(pivotRows).sort();
    }

    renderHeader();
    renderTable();
    renderQR();

  }catch(e){
    console.error(e);
    tbody.innerHTML = `<tr><td class="muted" style="text-align:center;padding:12px" colspan="10">خطأ في تحميل البيانات.</td></tr>`;
  }finally{
    showLoader(false);
  }
}

/* ==== header row ==== */
function renderHeader(){
  const cells = ['<th class="datecol">التاريخ</th>']
    .concat(SLOT_ORDER.map(([k,lab])=>`<th class="slot ${k}">${lab}</th>`))
    .join('');
  thead.innerHTML = `<tr>${cells}</tr>`;
}

/* ==== table body ==== */
function renderTable(){
  const unit = unitSel.value;
  const showNotes = (notesMode.value!=='hide');

  if(!pivotDates.length){
    tbody.innerHTML = `<tr><td class="muted" style="text-align:center;padding:12px" colspan="10">لا يوجد قياسات للفترة المحددة.</td></tr>`;
    return;
  }

  tbody.innerHTML = pivotDates.map(d=>{
    const row = pivotRows[d] || {};
    const tds = SLOT_ORDER.map(([slotKey])=>{
      const cell = row[slotKey];
      if(!cell){
        return `<td class="cell ${slotKey}">
          <span class="line dash">ـــ</span>
          <span class="line dash">جرعة التصحيح: ـــ</span>
          <span class="line ${showNotes?'dash':'dash'}">${showNotes?'ملاحظات: ـــ':''}</span>
        </td>`;
      }
      const valTxt = valueText(cell.mmol, cell.mgdl, unit);
      const st = cell.state;
      const clsBg = st==='low'?'bg-low':(st==='high'?'bg-high':'bg-ok');
      const corrLine = (cell.corr!=null && cell.corr!=='') ? `${cell.corr} U` : 'ـــ';
      const notesLine = showNotes ? (cell.notes && String(cell.notes).trim()? esc(cell.notes) : 'ـــ') : '';

      return `<td class="cell ${slotKey} ${clsBg}">
        <span class="line"><span class="val ${st}">${valTxt}</span><span class="arrow">${arrowOf(st)}</span></span>
        <span class="line">جرعة التصحيح: ${corrLine}</span>
        ${showNotes?`<span class="line">ملاحظات: ${notesLine}</span>`:''}
      </td>`;
    }).join('');

    return `<tr>
      <th class="datecol">${d}</th>
      ${tds}
    </tr>`;
  }).join('');
}

/* ==== QR ==== */
function renderQR(){
  const img = document.getElementById('qrImg');
  if(!img) return;

  const from = fromEl.value, to = toEl.value;
  const unit = unitSel.value;
  const deep = new URL(location.origin + location.pathname, location.href);
  deep.searchParams.set('child', childId);
  deep.searchParams.set('from', from);
  deep.searchParams.set('to', to);
  deep.searchParams.set('unit', unit);
  if(blankMode.checked) deep.searchParams.set('blank','1');

  const payload = [
    `Child: ${CHILD?.name || ''}`,
    `ID: ${childId}`,
    `Range: ${from} -> ${to}`,
    `Unit: ${unit==='mgdl'?'mg/dL':'mmol/L'}`,
    deep.toString()
  ].join('\n');

  const url1 = 'https://chart.googleapis.com/chart?cht=qr&chs=130x130&chl='+encodeURIComponent(payload);
  const url2 = 'https://api.qrserver.com/v1/create-qr-code/?size=130x130&data='+encodeURIComponent(payload);

  img.onerror = ()=>{ img.onerror=null; img.src=url2; };
  img.src = url1;
}
