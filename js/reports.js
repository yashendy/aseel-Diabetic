// js/reports.js  v4
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// عناصر واجهة الرأس
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');
const openAnalyticsBtn = document.getElementById('openAnalytics');

// عناصر التاريخ والجدول
const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const tbody  = document.getElementById('tbody');

const SLOT_ORDER = [
  'wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn',
  'snack','pre_sleep','during_sleep','pre_ex','post_ex'
];

const pad = n => String(n).padStart(2,'0');
function todayStr(d=new Date()){
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function addDays(dateStr, delta){
  const d = new Date(dateStr); d.setDate(d.getDate()+delta); return todayStr(d);
}
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

const params  = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = 'index.html'; return; }
  if (!childId) { alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  localStorage.setItem('lastChildId', childId);

  // 1) حمّل بيانات الطفل للهيدر
  try{
    const cref  = doc(db, `parents/${user.uid}/children/${childId}`);
    const csnap = await getDoc(cref);
    if (csnap.exists()){
      const c = csnap.data();
      childNameEl && (childNameEl.textContent = c.name || 'طفل');
      childMetaEl && (childMetaEl.textContent =
        `${c.gender || '—'} • العمر: ${calcAge(c.birthDate)} سنة`);
      const min = Number(c.normalRange?.min ?? 4);
      const max = Number(c.normalRange?.max ?? 7);
      const cr  = c.carbRatio != null ? Number(c.carbRatio) : null;
      const cf  = c.correctionFactor != null ? Number(c.correctionFactor) : null;
      chipRangeEl && (chipRangeEl.textContent = `النطاق: ${min}–${max} mmol/L`);
      chipCREl    && (chipCREl.textContent    = `CR: ${cr ?? '—'} g/U`);
      chipCFEl    && (chipCFEl.textContent    = `CF: ${cf ?? '—'} mmol/L/U`);
      localStorage.setItem('lastChildName', c.name || 'طفل');
    } else {
      const cached = localStorage.getItem('lastChildName');
      if (cached && childNameEl) childNameEl.textContent = cached;
    }
  }catch(e){ console.error(e); }

  // 2) اضبطي تاريخ افتراضي: آخر 7 أيام
  const today = todayStr();
  if (!toEl.value)   toEl.value   = today;
  if (!fromEl.value) fromEl.value = addDays(today, -7);

  // 3) ابدأ تحميل الجدول + على تغيير التاريخ
  fromEl.addEventListener('change', loadRange);
  toEl.addEventListener('change', loadRange);
  await loadRange();

  // 4) زر التحليل الطبي
  if (openAnalyticsBtn) {
    const href = `analytics.html?child=${encodeURIComponent(childId)}&range=14d`;
    if (openAnalyticsBtn.tagName === 'A') openAnalyticsBtn.href = href;
    else openAnalyticsBtn.addEventListener('click', ()=> location.href = href);
  }
});

async function loadRange(){
  if (!tbody) return;
  const from = fromEl.value;
  const to   = toEl.value;
  if (!from || !to) return;
  tbody.innerHTML = `<tr><td colspan="7" class="muted">جارِ التحميل…</td></tr>`;

  try{
    // ⚠️ مهم: حقل التاريخ في القياس لازم يكون "date" بصيغة YYYY-MM-DD (string)
    // ولو بتستخدمين Timestamps لازم تغيّري where/format بما يناسبك.
    const base = collection(db, `parents/${auth.currentUser.uid}/children/${childId}/measurements`);
    const q = query(
      base,
      where('date','>=',from),
      where('date','<=',to),
      orderBy('date','asc'),
      orderBy('slotOrder','asc') // إن كان عندك slotOrder عدد أو index في الداتا
    );

    const snap = await getDocs(q);
    if (snap.empty){
      tbody.innerHTML = `<tr><td colspan="7" class="muted">لا يوجد قياسات للفترة المحددة.</td></tr>`;
      return;
    }

    // رتّبي fallback لو مفيش slotOrder
    const rows = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    rows.sort((a,b)=>{
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ai = SLOT_ORDER.indexOf(a.slot || '');
      const bi = SLOT_ORDER.indexOf(b.slot || '');
      return (ai - bi);
    });

    const trHtml = rows.map(r=>{
      const st = r.state || ''; // normal/high/low...
      const corr = (r.correctionDose!=null && r.correctionDose!=='' ) ? r.correctionDose : '—';
      const hypo = (r.hypoTreatment && r.hypoTreatment.trim()) ? r.hypoTreatment : '—';
      const notes = (r.notes && r.notes.trim()) ? r.notes : '—';
      return `<tr>
        <td>${r.date || '—'}</td>
        <td>${slotLabel(r.slot) || '—'}</td>
        <td>${formatVal(r.value, r.unit || 'mmol/L')}</td>
        <td>${stateLabel(st)}</td>
        <td>${corr}</td>
        <td>${hypo}</td>
        <td class="notes">${notes}</td>
      </tr>`;
    }).join('');

    tbody.innerHTML = trHtml;

  }catch(e){
    console.error('loadRange error:', e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted">خطأ في تحميل البيانات.</td></tr>`;
  }
}

function slotLabel(key){
  const map = {
    wake:'الاستيقاظ',
    pre_bf:'قبل الإفطار', post_bf:'بعد الإفطار',
    pre_ln:'قبل الغداء',   post_ln:'بعد الغداء',
    pre_dn:'قبل العشاء',   post_dn:'بعد العشاء',
    snack:'سناك',
    pre_sleep:'قبل النوم', during_sleep:'أثناء النوم',
    pre_ex:'قبل الرياضة',  post_ex:'بعد الرياضة'
  };
  return map[key] || key || '—';
}
function stateLabel(s){
  const map = { normal:'طبيعي', high:'ارتفاع', low:'هبوط' };
  return map[s] || '—';
}
function formatVal(v, unit){
  if (v==null || v==='') return '—';
  const n = Number(v);
  if (unit==='mg/dL') return `${n} mg/dL`;
  // default mmol/L
  return `${n} mmol/L`;
}
