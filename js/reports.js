// js/reports.js — FINAL
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
const tbody  = document.getElementById('tbody');

const openAnalytics = document.getElementById('openAnalytics');
const openPrint     = document.getElementById('openPrint');

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

function stateLabel(s){ return {normal:'طبيعي', high:'ارتفاع', low:'هبوط'}[s] || '—'; }
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
function formatVal(v,unit){
  if(v==null || v==='') return '—';
  return unit==='mg/dL' ? `${v} mg/dL` : `${v} mmol/L`;
}

/* Child Id */
const params = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

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
      chipRangeEl.textContent = `النطاق: ${(c.normalRange?.min ?? 4)}–${(c.normalRange?.max ?? 7)} mmol/L`;
      chipCREl.textContent    = `CR: ${c.carbRatio ?? '—'} g/U`;
      chipCFEl.textContent    = `CF: ${c.correctionFactor ?? '—'} mmol/L/U`;
      localStorage.setItem('lastChildName', c.name || 'طفل');
    }else{
      const cached = localStorage.getItem('lastChildName');
      if (cached) childNameEl.textContent = cached;
    }
  }catch(e){ console.error('child load error', e); }

  // default dates (last 7 days)
  const today = todayStr();
  if(!toEl.value)   toEl.value   = today;
  if(!fromEl.value) fromEl.value = addDays(today,-7);

  // load once + on change
  fromEl.addEventListener('change', loadRange);
  toEl.addEventListener('change', loadRange);
  await loadRange();

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
    location.href = href.toString();
  });
});

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

      const slot = r.slot || r.input?.slot || '';
      const value = (r.value!=null? r.value :
                     r.input?.value!=null? r.input.value :
                     r.input?.value_mmol!=null? r.input.value_mmol :
                     r.input?.value_mgdl!=null? r.input.value_mgdl : null);
      const unit  = r.unit || r.input?.unit || 'mmol/L';
      const notes = r.notes || r.input?.notes || '';
      const corr  = r.correctionDose ?? r.input?.correctionDose ?? null;
      const hypo  = r.hypoTreatment  ?? r.input?.raisedWith   ?? '';

      const state = r.state || r.input?.state || '';
      rows.push({date, slot, value, unit, state, corr, hypo, notes});
    });

    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1) : String(a.slot).localeCompare(String(b.slot),'ar'));

    if(!rows.length){
      tbody.innerHTML = `<tr><td colspan="7" class="muted">لا يوجد قياسات للفترة المحددة.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(r=>`
      <tr>
        <td>${r.date}</td>
        <td>${slotLabel(r.slot)}</td>
        <td>${formatVal(r.value, r.unit)}</td>
        <td>${stateLabel(r.state)}</td>
        <td>${r.corr!=null && r.corr!=='' ? r.corr : '—'}</td>
        <td>${r.hypo && String(r.hypo).trim() ? r.hypo : '—'}</td>
        <td class="notes">${r.notes && String(r.notes).trim() ? r.notes : '—'}</td>
      </tr>
    `).join('');
  }catch(e){
    console.error('loadRange error', e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted">خطأ في تحميل البيانات.</td></tr>`;
  }
}
