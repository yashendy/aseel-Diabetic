// js/reports-print.js — FULL
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, orderBy, getDocs, doc, getDoc, where
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ========== DOM + Params ========== */
const qs        = new URLSearchParams(location.search);
const childId   = qs.get('child') || localStorage.getItem('lastChildId');
const paramFrom = qs.get('from')  || '';
const paramTo   = qs.get('to')    || '';
const paramUnit = (qs.get('unit') || 'mmol').toLowerCase();   // 'mmol'|'mgdl'
const mode      = (qs.get('mode') || '').toLowerCase();       // 'blank' => ورقة فارغة

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');

const unitSel   = document.getElementById('unitSel');
const notesMode = document.getElementById('notesMode');
const btnPrint  = document.getElementById('btnPrint');

const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const btnApply = document.getElementById('apply');

const tbody  = document.getElementById('tbody');
const loaderEl = document.getElementById('loader');

/* ========== Helpers ========== */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (ds,delta)=>{const d=new Date(ds);d.setDate(d.getDate()+delta);return todayStr(d);};
const toMgdl = mmol => Math.round(Number(mmol)*18);

function escapeHtml(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function showLoader(v){ loaderEl.classList.toggle('hidden', !v); }

function slotLabel(key){
  const map = {
    wake:'الاستيقاظ',
    pre_bf:'قبل الإفطار', post_bf:'بعد الإفطار',
    pre_ln:'قبل الغداء',  post_ln:'بعد الغداء',
    pre_dn:'قبل العشاء',  post_dn:'بعد العشاء',
    snack:'سناك', pre_sleep:'قبل النوم', during_sleep:'أثناء النوم',
    pre_ex:'قبل الرياضة', post_ex:'بعد الرياضة'
  };
  return map[key] || key || '—';
}
function stateOf(mmol, min, max){
  if(mmol < min) return 'low';
  if(mmol > max) return 'high';
  return 'ok';
}
function stateLabel(s){ return {low:'هبوط',ok:'طبيعي',high:'ارتفاع'}[s] || '—'; }

/* ========== State ========== */
let USER=null, CHILD=null;
let normalMin=4, normalMax=7, CR=null, CF=null;
let rowsCache=[];

/* ========== Auth ========== */
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

/* ========== Load Child ========== */
async function loadChild(){
  const ref = doc(db, `parents/${USER.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); throw 0; }
  CHILD = snap.data();

  childNameEl.textContent = CHILD.name || 'طفل';
  const age = calcAge(CHILD.birthDate);
  childMetaEl.textContent = `${CHILD.gender || '—'} • العمر: ${age} سنة`;

  normalMin = Number(CHILD.normalRange?.min ?? 4);
  normalMax = Number(CHILD.normalRange?.max ?? 7);
  CR = CHILD.carbRatio!=null ? Number(CHILD.carbRatio) : null;
  CF = CHILD.correctionFactor!=null ? Number(CHILD.correctionFactor) : null;

  chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
  chipCREl.textContent = `CR: ${CR ?? '—'} g/U`;
  chipCFEl.textContent = `CF: ${CF ?? '—'} mmol/L/U`;
}

function calcAge(bd){
  if(!bd) return '—';
  const b = new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return a;
}

/* ========== Controls ========== */
function initControls(){
  // تاريخ افتراضي
  const today = todayStr();
  fromEl.value = paramFrom || addDays(today,-7);
  toEl.value   = paramTo   || today;
  unitSel.value = (paramUnit === 'mgdl') ? 'mgdl' : 'mmol';

  btnApply.addEventListener('click', loadAndRender);
  unitSel.addEventListener('change', ()=> renderTable(rowsCache));
  notesMode.addEventListener('change', ()=> renderTable(rowsCache));
  btnPrint.addEventListener('click', ()=> window.print());
}

/* ========== Load Data & Render ========== */
async function loadAndRender(){
  const from = fromEl.value;
  const to   = toEl.value;

  if(!from || !to){ return; }
  showLoader(true);
  try{
    const base = collection(db, `parents/${USER.uid}/children/${childId}/measurements`);
    // شرط التاريخ في Firestore (لو محفوظ كنص yyyy-mm-dd يسمح بالمقارنة النصية)
    const qy = query(base, where('date','>=',from), where('date','<=',to), orderBy('date','asc'));
    const snap = await getDocs(qy);

    const rows=[];
    snap.forEach(d=>{
      const r = d.data();
      const date = r.date;
      const slot = r.slot || r.input?.slot || '';

      // اقرأ بالـ mmol
      const mmol = (r.value_mmol!=null) ? Number(r.value_mmol)
                 : (r.unit==='mmol/L' ? Number(r.value)
                 :  (r.value_mgdl!=null ? Number(r.value_mgdl)/18 : null));
      if(mmol==null || !isFinite(mmol)) return;

      const mgdl = (r.value_mgdl!=null) ? Number(r.value_mgdl) : toMgdl(mmol);
      const corr = r.correctionDose ?? r.input?.correctionDose ?? null;
      const notes= r.notes || r.input?.notes || '';

      rows.push({date, slot, mmol, mgdl, corr, notes});
    });

    // ترتيب الأوقات داخل اليوم
    const order = new Map(
      ['wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn','snack','pre_sleep','during_sleep','pre_ex','post_ex']
      .map((k,i)=>[k,i])
    );
    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1) : ((order.get(a.slot)||999)-(order.get(b.slot)||999)));

    rowsCache = rows;
    renderTable(rows);

    renderQR(); // بعد اكتمال بيانات الهيدر والفترة
  }catch(e){
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="3" class="muted">خطأ في تحميل البيانات.</td></tr>`;
  }finally{
    showLoader(false);
  }
}

/* ========== Render Table ========== */
function renderTable(rows){
  if(!rows.length){ tbody.innerHTML = `<tr><td colspan="3" class="muted">لا يوجد قياسات للفترة المحددة.</td></tr>`; return; }

  const unit = unitSel.value; // 'mmol'|'mgdl'
  const showNotes = (notesMode.value!=='hide');

  tbody.innerHTML = rows.map(r=>{
    const state = stateOf(r.mmol, normalMin, normalMax);
    const arrow = state==='low'?'↓' : state==='high'?'↑' : '↔';
    const valText = unit==='mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;
    const valCls = `val ${state}`;
    const trCls  = `state-${state} ${r.slot==='snack'?'is-snack':''}`;

    const corrLine = (r.corr!=null && r.corr!=='') ? `جرعة تصحيح: ${r.corr} U` : 'جرعة تصحيحية: —';
    const notesHtml = showNotes
      ? `<span class="line notesLine">${r.notes && String(r.notes).trim()? 'ملاحظات: '+escapeHtml(r.notes) : 'ملاحظات: —'}</span>`
      : `<span class="line notesLine hidden">—</span>`;

    return `
      <tr class="${trCls}">
        <td>${r.date}</td>
        <td>${slotLabel(r.slot)}</td>
        <td class="details">
          <span class="line"><span class="arrow">${arrow}</span> <span class="${valCls}">${valText}</span></span>
          <span class="line">${corrLine}</span>
          ${notesHtml}
        </td>
      </tr>
    `;
  }).join('');
}

/* ========== QR ========== */
function renderQR(){
  const img = document.getElementById('qrImg');
  if(!img) return;

  const from = fromEl.value;
  const to   = toEl.value;
  const unit = unitSel.value;
  const childName = CHILD?.name || '';
  const deepLink = new URL(location.origin + location.pathname, location.href);
  deepLink.searchParams.set('child', childId);
  deepLink.searchParams.set('from', from);
  deepLink.searchParams.set('to', to);
  deepLink.searchParams.set('unit', unit);

  const payload = [
    `Child: ${childName}`,
    `ID: ${childId}`,
    `Range: ${from} -> ${to}`,
    `Unit: ${unit === 'mgdl' ? 'mg/dL' : 'mmol/L'}`,
    deepLink.toString()
  ].join('\n');

  // Google Chart API (خفيف وسريع)
  const url = 'https://chart.googleapis.com/chart?cht=qr&chs=150x150&chl=' + encodeURIComponent(payload);
  img.src = url;
}
