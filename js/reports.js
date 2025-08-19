// js/reports.js — UPDATED
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, query, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* DOM */
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl = document.getElementById('chipCR');
const chipCFEl = document.getElementById('chipCF');

const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const outUnitEl = document.getElementById('outUnit');
const tbody  = document.getElementById('tbody');

const openAnalytics = document.getElementById('openAnalytics');
const openPrint     = document.getElementById('openPrint');
const openBlank     = document.getElementById('openBlank');
const toggleNotesBtn= document.getElementById('toggleNotes');

/* Helpers */
const pad = n => String(n).padStart(2,'0');
function todayStr(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDays(ds,delta){ const d=new Date(ds); d.setDate(d.getDate()+delta); return todayStr(d); }

function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    const tryDate = new Date(any);
    if(!isNaN(tryDate)) return todayStr(tryDate);
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
  return `${a} سنة`;
}

function stateLabel(s){ return {ok:'طبيعي', high:'ارتفاع', low:'هبوط'}[s] || '—'; }
function slotLabel(key){
  const map={
    wake:'الاستيقاظ',
    pre_bf:'قبل الإفطار', post_bf:'بعد الإفطار',
    pre_ln:'قبل الغداء',  post_ln:'بعد الغداء',
    pre_dn:'قبل العشاء',  post_dn:'بعد العشاء',
    snack:'سناك', pre_sleep:'قبل النوم', during_sleep:'أثناء النوم',
    pre_ex:'قبل الرياضة', post_ex:'بعد الرياضة'
  };
  if(!key) return '—';
  return map[key] || key; // لو عربي مسبقًا
}

/* Child Id */
const params = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

/* State */
let normalMin = 4, normalMax = 7;
let rowsCache = [];
let notesVisible = true;

/* Main */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  localStorage.setItem('lastChildId', childId);

  // Load child header
  try{
    const cref = doc(db, `parents/${user.uid}/children/${childId}`);
    const csnap = await getDoc(cref);
    if(csnap.exists()){
      const c = csnap.data();
      childNameEl.textContent = c.name || 'طفل';
      childMetaEl.textContent = `${c.gender || '—'} • العمر: ${calcAge(c.birthDate)}`;
      normalMin = Number(c.normalRange?.min ?? 4);
      normalMax = Number(c.normalRange?.max ?? 7);
      chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
      chipCREl.textContent    = `CR: ${c.carbRatio ?? '—'} g/U`;
      chipCFEl.textContent    = `CF: ${c.correctionFactor ?? '—'} mmol/L/U`;
      localStorage.setItem('lastChildName', c.name || 'طفل');
    }else{
      const cached = localStorage.getItem('lastChildName');
      if (cached) childNameEl.textContent = cached;
    }
  }catch(e){ console.error('child load error', e); }

  // default dates (آخر 7 أيام)
  const today = todayStr();
  if(!toEl.value)   toEl.value   = today;
  if(!fromEl.value) fromEl.value = addDays(today,-7);

  // events
  fromEl.addEventListener('change', loadRange);
  toEl.addEventListener('change', loadRange);
  outUnitEl.addEventListener('change', ()=> renderTable(rowsCache));

  toggleNotesBtn.addEventListener('click', ()=>{
    notesVisible = !notesVisible;
    document.querySelector('.table')?.classList.toggle('hide-notes', !notesVisible);
    toggleNotesBtn.textContent = notesVisible ? 'إخفاء الملاحظات' : 'إظهار الملاحظات';
  });

  // Buttons
  openAnalytics.addEventListener('click', ()=>{
    const href = new URL('analytics.html', location.href);
    href.searchParams.set('child', childId);
    href.searchParams.set('range', '14d');
    location.href = href.toString();
  });

  openPrint.addEventListener('click', ()=>{
    const href = new URL('reports-print.html', location.href);
    href.searchParams.set('child', childId);
    if(fromEl.value) href.searchParams.set('from', fromEl.value);
    if(toEl.value)   href.searchParams.set('to', toEl.value);
    href.searchParams.set('unit', outUnitEl.value);
    location.href = href.toString();
  });

  openBlank.addEventListener('click', ()=>{
    // لو عندك صفحة reports-blank.html استخدميها؛ وإلا نفتح reports-print بوضع فارغ
    const blankUrl = new URL('reports-print.html', location.href);
    blankUrl.searchParams.set('child', childId);
    blankUrl.searchParams.set('mode', 'blank'); // مدعومة في صفحة الطباعة لو أحببتِ
    location.href = blankUrl.toString();
  });

  // load first time
  await loadRange();
});

function getState(mmol){
  if(mmol < normalMin) return 'low';
  if(mmol > normalMax) return 'high';
  return 'ok';
}
const toMgdl = mmol => Math.round(Number(mmol)*18);

/* تحميل وعرض */
async function loadRange(){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  if(!start || !end) return;

  tbody.innerHTML = `<tr><td colspan="7" class="muted">جارِ التحميل…</td></tr>`;

  try{
    const base = collection(db, `parents/${auth.currentUser.uid}/children/${childId}/measurements`);
    const snap = await getDocs(query(base, orderBy('date','asc')));

    const rows=[];
    snap.forEach(d=>{
      const r = d.data();
      const date = normalizeDateStr(r.date);
      if(!date || date < start || date > end) return;

      // mmoll value
      const mmol = (r.value_mmol!=null) ? Number(r.value_mmol)
                 : (r.unit==='mmol/L' ? Number(r.value)
                 :  (r.value_mgdl!=null ? Number(r.value_mgdl)/18 : null));
      if(mmol==null || !isFinite(mmol)) return;

      const mgdl = (r.value_mgdl!=null) ? Number(r.value_mgdl) : toMgdl(mmol);

      const slot = r.slot || r.input?.slot || '';
      const notes = r.notes || r.input?.notes || '';
      const corr  = r.correctionDose ?? r.input?.correctionDose ?? null;
      const hypo  = r.hypoTreatment  ?? r.input?.raisedWith   ?? '';

      const state = getState(mmol);
      rows.push({date, slot, mmol, mgdl, state, corr, hypo, notes});
    });

    // ترتيب
    const order = new Map([
      ['wake',0],'pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn','snack','pre_sleep','during_sleep','pre_ex','post_ex'
    ].flatMap((k,i)=>[[k,i]]));
    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1) : ((order.get(a.slot)||999) - (order.get(b.slot)||999)));

    rowsCache = rows;
    renderTable(rows);
  }catch(e){
    console.error('loadRange error', e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted">خطأ في تحميل البيانات.</td></tr>`;
  }
}

function renderTable(rows){
  if(!rows.length){ tbody.innerHTML = `<tr><td colspan="7" class="muted">لا يوجد قياسات للفترة المحددة.</td></tr>`; return; }
  const unit = outUnitEl.value; // 'mmol' | 'mgdl'

  tbody.innerHTML = rows.map(r=>{
    const valTxt = unit==='mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;
    const arrow  = r.state==='low'?'↓': r.state==='high'?'↑':'↔';
    const valCls = `val ${r.state==='low'?'low':r.state==='high'?'high':'ok'}`;
    const trCls  = `state-${r.state}`;

    return `<tr class="${trCls}">
      <td>${r.date}</td>
      <td>${slotLabel(r.slot)}</td>
      <td><span class="${valCls}">${arrow} ${valTxt}</span></td>
      <td>${stateLabel(r.state)}</td>
      <td>${(r.corr!=null && r.corr!=='') ? r.corr : '—'}</td>
      <td>${r.hypo && String(r.hypo).trim() ? r.hypo : '—'}</td>
      <td class="notes">${r.notes && String(r.notes).trim() ? r.notes : '—'}</td>
    </tr>`;
  }).join('');
}
