// js/reports.js  — FINAL
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- DOM ---------- */
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');

const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const tbody  = document.getElementById('tbody');

const openAnalyticsBtn = document.getElementById('openAnalytics');

/* ---------- helpers ---------- */
const pad = n => String(n).padStart(2,'0');
function todayStr(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDays(dateStr, delta){ const d=new Date(dateStr); d.setDate(d.getDate()+delta); return todayStr(d); }

function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

// توحيد التاريخ إلى "YYYY-MM-DD"
function normalizeDateStr(any){
  if(!any) return '';
  // نص جاهز؟
  if (typeof any === 'string'){
    // حاول نطبعها كـ Date لو فيها timezone أو صيغة غريبة
    const d = new Date(any);
    if (!isNaN(d)) return todayStr(d);
    // وإلا لو شكلها أصلاً YYYY-MM-DD نرجعها كما هي
    if (/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    return any; // fallback
  }
  // لو Timestamp-like أو Date
  const d = (any.toDate && typeof any.toDate==='function') ? any.toDate() : new Date(any);
  if (!isNaN(d)) return todayStr(d);
  return '';
}

// State label
function stateLabel(s){
  const map = { normal:'طبيعي', high:'ارتفاع', low:'هبوط' };
  return map[s] || '—';
}
// Slot label: لو عربي بنسيبه، لو مفتاح بنترجمه
function slotLabel(key){
  const map = {
    wake:'الاستيقاظ',
    pre_bf:'قبل الإفطار', post_bf:'بعد الإفطار',
    pre_ln:'قبل الغداء',  post_ln:'بعد الغداء',
    pre_dn:'قبل العشاء',  post_dn:'بعد العشاء',
    snack:'سناك',
    pre_sleep:'قبل النوم', during_sleep:'أثناء النوم',
    pre_ex:'قبل الرياضة', post_ex:'بعد الرياضة'
  };
  if (!key) return '—';
  if (map[key]) return map[key];
  // احتمال يكون مكتوب عربي أصلاً
  return key;
}
function formatVal(v, unit){
  if (v==null || v==='') return '—';
  const n = Number(v);
  if (unit === 'mg/dL') return `${n} mg/dL`;
  return `${n} mmol/L`;
}

/* ---------- child id ---------- */
const params  = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

/* ---------- main flow ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
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
    }else{
      const cached = localStorage.getItem('lastChildName');
      cached && childNameEl && (childNameEl.textContent = cached);
    }
  }catch(e){ console.error('[reports] child load error:', e); }

  // 2) تواريخ افتراضية (آخر 7 أيام)
  const today = todayStr();
  if (!toEl.value)   toEl.value   = today;
  if (!fromEl.value) fromEl.value = addDays(today, -7);

  // 3) تحميل الجدول أول مرة + عند تغيير التاريخ
  fromEl.addEventListener('change', loadRange);
  toEl.addEventListener('change', loadRange);
  await loadRange();

  // 4) زر تحليل القياسات
  if (openAnalyticsBtn) {
    const href = `analytics.html?child=${encodeURIComponent(childId)}&range=14d`;
    if (openAnalyticsBtn.tagName === 'A') openAnalyticsBtn.href = href;
    else openAnalyticsBtn.addEventListener('click', ()=> location.href = href);
  }
});

/* ---------- load & render ---------- */
async function loadRange(){
  if (!tbody) return;
  const startRaw = fromEl.value;
  const endRaw   = toEl.value;
  if (!startRaw || !endRaw) return;

  const start = normalizeDateStr(startRaw);
  const end   = normalizeDateStr(endRaw);

  tbody.innerHTML = `<tr><td colspan="7" class="muted">جارِ التحميل…</td></tr>`;

  try{
    // نجلب كل القياسات مرتبة بالتاريخ فقط
    // (ونفلتر على الجهاز بصيغة تاريخ موحدة)
    const base = collection(
      db, `parents/${auth.currentUser.uid}/children/${childId}/measurements`
    );
    const q = query(base, orderBy('date','asc'));
    const snap = await getDocs(q);

    const rows = [];
    snap.forEach(d=>{
      const r = d.data();
      const dstr = normalizeDateStr(r.date);
      if (!dstr) return;

      if (dstr >= start && dstr <= end){
        rows.push({
          id: d.id,
          date: dstr,
          slot: r.slot || r.input?.slot || '',
          value: r.value ?? r.input?.value ?? r.input?.value_mmol ?? r.input?.value_mgdl,
          unit:  r.unit  ?? r.input?.unit  ?? 'mmol/L',
          state: r.state || r.input?.state || '',
          correctionDose: r.correctionDose ?? r.input?.correctionDose ?? null,
          hypoTreatment:  r.hypoTreatment  ?? r.input?.raisedWith  ?? '',
          notes: r.notes ?? r.input?.notes ?? ''
        });
      }
    });

    // ترتيب حسب اليوم ثم خانة الوقت (لو عربي نسيبه كما هو)
    rows.sort((a,b)=>{
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return String(a.slot).localeCompare(String(b.slot), 'ar');
    });

    renderTable(rows);
  }catch(e){
    console.error('[reports] loadRange error:', e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted">خطأ في تحميل البيانات.</td></tr>`;
  }
}

function renderTable(rows){
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="7" class="muted">لا يوجد قياسات للفترة المحددة.</td></tr>`;
    return;
  }

  const html = rows.map(r=>{
    const corr = (r.correctionDose!=null && r.correctionDose!=='') ? r.correctionDose : '—';
    const hypo = (r.hypoTreatment && String(r.hypoTreatment).trim()) ? r.hypoTreatment : '—';
    const notes= (r.notes && String(r.notes).trim()) ? r.notes : '—';
    return `<tr>
      <td>${r.date}</td>
      <td>${slotLabel(r.slot)}</td>
      <td>${formatVal(r.value, r.unit)}</td>
      <td>${stateLabel(r.state)}</td>
      <td>${corr}</td>
      <td>${hypo}</td>
      <td class="notes">${notes}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = html;
}
