// js/reports-print.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, query, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* DOM */
const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const outUnitEl = document.getElementById('outUnit');
const printArea = document.getElementById('printArea');

const childNameEl = document.getElementById('childName');
const childAgeEl  = document.getElementById('childAge');
const childGenderEl = document.getElementById('childGender');
const chipRangeEl = document.getElementById('chipRange');
const chipCFEl = document.getElementById('chipCF');
const chipCREl = document.getElementById('chipCR');
const unitEl = document.getElementById('unit');
const genAtEl = document.getElementById('generatedAt');

const btnLoad  = document.getElementById('btnLoad');
const btnBlank = document.getElementById('btnBlank');
const btnPrint = document.getElementById('btnPrint');
const chkNotes = document.getElementById('chkNotes');

/* Helpers */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (ds,delta)=>{ const d=new Date(ds); d.setDate(d.getDate()+delta); return todayStr(d); };

function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    const tryD = new Date(any);
    if(!isNaN(tryD)) return todayStr(tryD);
    if(/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    return any;
  }
  const d=(any?.toDate && typeof any.toDate==='function')? any.toDate(): new Date(any);
  if(!isNaN(d)) return todayStr(d);
  return '';
}
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a + ' سنة';
}

/* 🟣 تطبيع خانة الوقت: عربي → مفتاح قياسي */
function normalizeSlot(raw){
  if(!raw) return '';
  const s = String(raw).trim();
  const map = new Map([
    // الاستيقاظ
    ['الاستيقاظ','wake'], ['استيقاظ','wake'],
    // الإفطار
    ['قبل الإفطار','pre_bf'], ['ق.الفطار','pre_bf'], ['ق.الافطار','pre_bf'],
    ['بعد الإفطار','post_bf'], ['ب.الفطار','post_bf'], ['ب.الافطار','post_bf'],
    // الغداء
    ['قبل الغداء','pre_ln'], ['ق.الغدا','pre_ln'],
    ['بعد الغداء','post_ln'], ['ب.الغدا','post_ln'],
    // العشاء
    ['قبل العشاء','pre_dn'], ['ق.العشا','pre_dn'],
    ['بعد العشاء','post_dn'], ['ب.العشا','post_dn'],
    // احتمالات عامة
    ['ق.الفطور','pre_bf'], ['ب.الفطور','post_bf'],
  ]);
  return map.get(s) || s; // لو كان بالفعل مفتاح انجليزي نرجّعه كما هو
}

/* أعمدة التقرير (بدون سناك/رياضة) */
const PRINT_SLOTS = ['wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn'];
const SLOT_TITLES = {
  wake:'الاستيقاظ',
  pre_bf:'ق.الفطار', post_bf:'ب.الفطار',
  pre_ln:'ق.الغدا',  post_ln:'ب.الغدا',
  pre_dn:'ق.العشا',  post_dn:'ب.العشا'
};

/* استخراج القيم + التحويل للوحدة المطلوبة */
function extractValues(r){
  // نحاول نلقط من أكثر من مكان
  const mmol = r.value_mmol ?? r.input?.value_mmol ?? (r.unit==='mmol/L' ? (r.value ?? r.input?.value) : null);
  const mgdl = r.value_mgdl ?? r.input?.value_mgdl ?? (r.unit==='mg/dL' ? (r.value ?? r.input?.value) : null);
  return { mmol, mgdl, unit: (r.unit || r.input?.unit || (mgdl!=null?'mg/dL':'mmol/L')) };
}
function formatByUnit(vals, want){ // want: 'mmol' | 'mgdl'
  let outVal, outUnit;
  if(want==='mgdl'){
    if(vals.mgdl!=null) outVal = Math.round(Number(vals.mgdl));
    else if(vals.mmol!=null) outVal = Math.round(Number(vals.mmol)*18);
    outUnit = 'mg/dL';
  }else{ // mmol
    if(vals.mmol!=null) outVal = Number(vals.mmol).toFixed(1);
    else if(vals.mgdl!=null) outVal = (Number(vals.mgdl)/18).toFixed(1);
    outUnit = 'mmol/L';
  }
  return (outVal==null || outVal==='NaN') ? {text:'—', unit:outUnit} : {text:`${outVal} ${outUnit}`, unit:outUnit};
}

/* ChildId */
const params = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  localStorage.setItem('lastChildId', childId);

  // dates
  const urlFrom = params.get('from'), urlTo = params.get('to');
  const today = todayStr();
  toEl.value   = urlTo   || today;
  fromEl.value = urlFrom || addDays(today,-7);
  genAtEl.textContent = new Date().toLocaleString('ar-EG');

  // child header
  try{
    const cref = doc(db, `parents/${user.uid}/children/${childId}`);
    const csnap = await getDoc(cref);
    if(csnap.exists()){
      const c = csnap.data();
      childNameEl.textContent = c.name || 'طفل';
      childAgeEl.textContent  = calcAge(c.birthDate);
      childGenderEl.textContent = c.gender || '—';
      chipRangeEl.textContent = `${c.normalRange?.min ?? 4}–${c.normalRange?.max ?? 7} mmol/L`;
      chipCFEl.textContent    = c.correctionFactor!=null? `${c.correctionFactor} mmol/L/U` : '—';
      chipCREl.textContent    = c.carbRatio!=null? `${c.carbRatio} g/U` : '—';
    }
  }catch(e){ console.error('child load', e); }

  // actions
  const reload = ()=> buildFilled(user.uid);
  btnLoad.addEventListener('click', reload);
  outUnitEl.addEventListener('change', ()=>{ unitEl.textContent = (outUnitEl.value==='mgdl'?'mg/dL':'mmol/L'); reload(); });
  btnBlank.addEventListener('click', buildBlankSheet);
  btnPrint.addEventListener('click', ()=> window.print());
  chkNotes.addEventListener('change', ()=>{
    printArea.classList.toggle('show-notes', chkNotes.checked);
    printArea.classList.toggle('hide-notes', !chkNotes.checked);
  });

  unitEl.textContent = (outUnitEl.value==='mgdl'?'mg/dL':'mmol/L');
  // first load
  buildFilled(user.uid);
});

async function buildFilled(uid){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  if(!start || !end){ alert('حددي فترة صحيحة'); return; }

  const base = collection(db, `parents/${uid}/children/${childId}/measurements`);
  const snap = await getDocs(query(base, orderBy('date','asc')));

  const byDate = {}; // {date: {slot:{text, notes, corr}}}
  const want = outUnitEl.value; // 'mmol' | 'mgdl'

  snap.forEach(d=>{
    const r = d.data();
    const dstr = normalizeDateStr(r.date);
    if(!dstr || dstr < start || dstr > end) return;

    const rawSlot = r.slot || r.input?.slot || '';
    const slot = normalizeSlot(rawSlot);
    if(!PRINT_SLOTS.includes(slot)) return; // تجاهل السناك/الرياضة وأي خانة غير مطلوبة

    const vals = extractValues(r);
    const disp = formatByUnit(vals, want);

    const notes = r.notes || r.input?.notes || '';
    const corr  = r.correctionDose ?? r.input?.correctionDose ?? null;

    if(!byDate[dstr]) byDate[dstr] = {};
    byDate[dstr][slot] = { text: disp.text, notes, corr };
  });

  const dates = Object.keys(byDate).sort();
  const table = makeSheet(dates, (date)=> byDate[date] || {});
  renderSheet(table);
}

function buildBlankSheet(){
  const rows = Array.from({length:7}, ()=> '');
  const table = makeSheet(rows, ()=> ({}), true);
  renderSheet(table);
}

function makeSheet(dates, rowGetter, blank=false){
  const thead = `<thead><tr>
      <th style="width:110px">التاريخ</th>
      ${PRINT_SLOTS.map(k=>`<th>${SLOT_TITLES[k]}</th>`).join('')}
    </tr></thead>`;

  const rows = dates.map(date=>{
    const row = rowGetter(date);
    return `<tr>
      <td class="cell">${blank? '____' : date}</td>
      ${PRINT_SLOTS.map(slot=>{
        const c = row[slot] || {};
        const valTxt  = c.text ?? '—';
        const corrTxt = (c.corr!=null && c.corr!=='') ? c.corr : '____';
        const noteTxt = (c.notes && String(c.notes).trim()) ? c.notes : '____';
        return `<td class="cell">
          <div class="val">${blank? '____' : valTxt}</div>
          <div class="sub">
            <span class="corr">جرعة التصحيحي: ${blank? '____' : corrTxt}</span>
            <span class="note">ملاحظات: ${blank? '____' : noteTxt}</span>
          </div>
        </td>`;
      }).join('')}
    </tr>`;
  }).join('');

  return `<table class="sheet ${chkNotes.checked? '' : 'hide-notes'}">${thead}<tbody>${rows || `<tr><td colspan="8" class="cell">لا يوجد بيانات ضمن الفترة المحددة.</td></tr>`}</tbody></table>`;
}
function renderSheet(html){
  printArea.innerHTML = html;
  printArea.classList.toggle('show-notes', chkNotes.checked);
  printArea.classList.toggle('hide-notes', !chkNotes.checked);
}
