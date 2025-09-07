// reports-print.js — طباعة تقرير القياسات (آمن ضد undefined .push)
// ملاحظات:
// - عدّل معرفات عناصر الواجهة هنا لو مختلفة في reports-print.html
// - يعتمد على Firebase v12 (auth/firestore) مثل باقي المشروع

// ===== Firebase =====
import { auth, db } from './firebase-config.js';
import {
  collection, query, where, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// ===== عناصر الواجهة (عدّل IDs لو لزم) =====
const params = new URLSearchParams(location.search);
const parentId = params.get('parent');
const childId  = params.get('child');

const unitSelect     = document.getElementById('unitSelect');     // 'mmol' | 'mgdl'
const fromInput      = document.getElementById('fromDate');
const toInput        = document.getElementById('toDate');
const colorizeChk    = document.getElementById('colorizeChk');    // تلويـن (هبوط/طبيعي/ارتفاع)
const hideNotesPrint = document.getElementById('hideNotesPrint'); // إخفاء الملاحظات في الطباعة
const applyBtn       = document.getElementById('applyBtn');
const printBtn       = document.getElementById('printBtn');
const childNameEl    = document.getElementById('childName');
const childMetaEl    = document.getElementById('childMeta');
const tableBody      = document.getElementById('daysTableBody');  // <tbody> لصفوف الأيام
const emptyMsg       = document.getElementById('emptyMsg');       // رسالة "لا توجد قياسات"

// ===== نطاقات الطفل (من وثيقة الطفل) =====
let childData = null;
function getRanges() {
  const r = childData?.normalRange || {};
  return {
    min: Number(r.min ?? 4.5),
    max: Number(r.max ?? 7),
    severeLow: Number(r.severeLow ?? r.severe_low ?? 3.5),
    severeHigh: Number(r.severeHigh ?? r.severe_high ?? 12)
  };
}

// ===== أدوات تاريخ =====
const MS_DAY = 24*60*60*1000;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
const endOfDay   = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
const fmtDate    = d => d.toISOString().slice(0,10);

// ===== خانات الجدول (SLOTS) =====
const SLOTS = [
  'FASTING', 'PRE_BREAKFAST', 'POST_BREAKFAST',
  'PRE_LUNCH', 'POST_LUNCH', 'PRE_DINNER', 'POST_DINNER',
  'BEDTIME', 'OVERNIGHT', 'RANDOM'
];

// ترتيب العرض في الجدول (يمكن تغييره ليتماشى مع رؤوس الأعمدة لديك)
const DISPLAY_ORDER = [
  'OVERNIGHT',     // أثناء النوم
  'FASTING',       // الاستيقاظ
  'PRE_BREAKFAST', // ق.الفطار
  'POST_BREAKFAST',// ب.الفطار
  'PRE_LUNCH',     // ق.الغدا
  'POST_LUNCH',    // ب.الغدا
  'PRE_DINNER',    // ق.العشا
  'POST_DINNER',   // ب.العشا
  'BEDTIME',       // ق.النوم
  'RANDOM'         // عشوائي
];

// خريطة أسماء عربية اختياريًا (لو حابب توليد رؤوس/عناوين)
const SLOT_AR = {
  FASTING:'الاستيقاظ', PRE_BREAKFAST:'ق.الفطار', POST_BREAKFAST:'ب.الفطار',
  PRE_LUNCH:'ق.الغدا', POST_LUNCH:'ب.الغدا',
  PRE_DINNER:'ق.العشا', POST_DINNER:'ب.العشا',
  BEDTIME:'ق.النوم', OVERNIGHT:'أثناء النوم', RANDOM:'عشوائي'
};

// ===== تطبيع أسماء الخانات =====
function mapSlotSafe(raw){
  const s = (raw || '').toString().trim().toUpperCase();
  if (SLOTS.includes(s)) return s;
  const aliases = {
    'FAST':'FASTING','AWAKE':'FASTING','استيقاظ':'FASTING',
    'PREBREAKFAST':'PRE_BREAKFAST','ق.الفطار':'PRE_BREAKFAST',
    'POSTBREAKFAST':'POST_BREAKFAST','ب.الفطار':'POST_BREAKFAST',
    'PRELUNCH':'PRE_LUNCH','ق.الغدا':'PRE_LUNCH',
    'POSTLUNCH':'POST_LUNCH','ب.الغدا':'POST_LUNCH',
    'PREDINNER':'PRE_DINNER','ق.العشا':'PRE_DINNER',
    'POSTDINNER':'POST_DINNER','ب.العشا':'POST_DINNER',
    'SLEEP':'BEDTIME','BED':'BEDTIME','ق.النوم':'BEDTIME',
    'NIGHT':'OVERNIGHT','OVERNITE':'OVERNIGHT','أثناء النوم':'OVERNIGHT',
    'RND':'RANDOM','عشوائي':'RANDOM','RANDOM':'RANDOM'
  };
  return aliases[s] || 'RANDOM';
}

// ===== وحدات =====
function toMmol(val, unit){
  if (val == null) return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  return (unit==='mgdl' || unit==='mg/dL' || unit==='MGDL' || unit==='MG/DL') ? n/18 : n;
}
function fromMmol(val, outUnit){
  return (outUnit==='mgdl') ? val*18 : val;
}
function formatValue(mmol, outUnit){
  if (mmol == null) return '';
  const v = fromMmol(mmol, outUnit);
  return outUnit==='mgdl' ? Math.round(v).toString() : v.toFixed(1);
}

// ===== إنشاء صف اليوم افتراضيًا =====
function makeDayRow(dateKey){
  const cols = {};
  SLOTS.forEach(s => cols[s] = []);
  return { dateKey, cols, notes: [], state: null, bolusDose: null, correctionDose: null };
}

// ===== تحميل القياسات وتجميعها =====
async function loadSnapshot(uid, childId){
  const col = collection(db, `parents/${uid}/children/${childId}/measurements`);
  // نرتّب حسب when و date (لو بعض السجلات بدون when)
  const qs = [
    query(col, orderBy('when', 'asc')),
    query(col, orderBy('date', 'asc'))
  ];
  const results = await Promise.allSettled(qs.map(getDocs));
  // دمج النتائج
  const docs = [];
  for (const r of results){
    if (r.status==='fulfilled'){
      r.value.forEach(d => docs.push(d));
    }
  }
  return docs;
}

function normalizeDoc(dsnap){
  const m = dsnap.data?.() || dsnap.data || null;
  if (!m) return null;
  const when = m.when?.toDate?.() || (m.date ? new Date(m.date) : null);
  if (!when || isNaN(when.getTime())) return null;

  const raw = m.mmol ?? m.value ?? m.glucose ?? m.mgdl;
  const unit = (m.unit || (m.mgdl != null ? 'mgdl':'mmol')).toString().toLowerCase();
  const mmol = toMmol(raw, unit);
  if (mmol == null) return null;

  return {
    when,
    mmol,
    slot: mapSlotSafe(m.slotKey || m.slot || m.timeLabel || m.slotLabel),
    notes: m.notes || '',
    state: m.state || null,
    bolusDose: m.bolusDose ?? null,
    correctionDose: m.correctionDose ?? null
  };
}

function buildDaysMap(allDocs, fromD, toD){
  const byDate = new Map();
  const fromTs = startOfDay(fromD).getTime();
  const toTs   = endOfDay(toD).getTime();

  allDocs.forEach(snap => {
    const n = normalizeDoc(snap);
    if(!n) return;
    const t = n.when.getTime();
    if (t < fromTs || t > toTs) return;

    const key = n.when.toISOString().slice(0,10);
    let day = byDate.get(key);
    if(!day){
      day = makeDayRow(key);
      byDate.set(key, day);
    }
    if (!Array.isArray(day.cols[n.slot])) day.cols[n.slot] = [];
    day.cols[n.slot].push({ t: n.when, mmol: n.mmol, notes: n.notes });

    if (n.notes) day.notes.push(n.notes);
    if (n.state && !day.state) day.state = n.state;
    if (n.bolusDose != null && day.bolusDose == null) day.bolusDose = n.bolusDose;
    if (n.correctionDose != null && day.correctionDose == null) day.correctionDose = n.correctionDose;
  });

  return Array.from(byDate.values()).sort((a,b)=> a.dateKey.localeCompare(b.dateKey));
}

// ===== تلوين القيم حسب النطاق =====
function classify(mmol){
  const {min, max, severeLow, severeHigh} = getRanges();
  if (mmol < severeLow) return 'low';           // هبوط
  if (mmol > severeHigh) return 'high';         // ارتفاع
  if (mmol >= min && mmol <= max) return 'in';  // طبيعي
  return 'mid'; // خارج طبيعي لكن مش شديد (اختياري)
}
function spanValue(mmol, outUnit, colorize){
  const val = formatValue(mmol, outUnit);
  if (!colorize) return `<span>${val}</span>`;
  const cls = classify(mmol); // low | in | high | mid
  // CSS: .v-low{background:#fee2e2} .v-in{background:#dcfce7} .v-high{background:#fde68a} .v-mid{background:#e5e7eb}
  return `<span class="v-${cls}">${val}</span>`;
}

// ===== رسم الجدول =====
function clearTable(){
  if (tableBody) tableBody.innerHTML = '';
}
function renderTable(days, outUnit){
  if (!tableBody) return;
  clearTable();

  if (!days.length){
    emptyMsg && emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg && emptyMsg.classList.add('hidden');

  days.forEach(day=>{
    const tr = document.createElement('tr');

    // عمود التاريخ
    const tdDate = document.createElement('td');
    tdDate.textContent = day.dateKey;
    tr.appendChild(tdDate);

    // أعمدة الخانات بالترتيب المحدد
    DISPLAY_ORDER.forEach(slot=>{
      const td = document.createElement('td');
      const arr = Array.isArray(day.cols?.[slot]) ? day.cols[slot] : [];
      if (!arr.length){
        td.innerHTML = '<span class="muted">—</span>';
      } else {
        // قيَم اليوم داخل الخانة
        const colorize = !!(colorizeChk && colorizeChk.checked);
        td.innerHTML = arr
          .sort((a,b)=> a.t - b.t)
          .map(x => spanValue(x.mmol, outUnit, colorize))
          .join(' ');
      }
      tr.appendChild(td);
    });

    // عمود ملاحظات (اختياري حسب التفعيل)
    const tdNotes = document.createElement('td');
    const hideNotes = !!(hideNotesPrint && hideNotesPrint.checked);
    tdNotes.innerHTML = hideNotes ? '<span class="muted">—</span>'
                                  : (day.notes && day.notes.length ? day.notes.join(' • ') : '<span class="muted">—</span>');
    tr.appendChild(tdNotes);

    tableBody.appendChild(tr);
  });
}

// ===== تحميل الطفل + القياسات + التشغيل =====
let currentUser = null;
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  currentUser = user;

  // وثيقة الطفل
  const cs = await getDoc(doc(db, `parents/${parentId || user.uid}/children/${childId}`));
  if (!cs.exists()){
    alert('الطفل غير موجود'); history.back(); return;
  }
  childData = cs.data();

  // رأس الصفحة (الاسم + العمر تقريبًا)
  const name = childData.name || '—';
  const b = childData.birthDate ? new Date(childData.birthDate) : null;
  const ageYears = b ? Math.max(0, (new Date().getFullYear() - b.getFullYear())) : '';
  if (childNameEl) childNameEl.textContent = name;
  if (childMetaEl) childMetaEl.textContent = ageYears ? `العمر ~ ${ageYears} سنة` : '';

  // نطاق التاريخ الافتراضي: آخر 7 أيام
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()-6);
  if (fromInput && !fromInput.value) fromInput.value = fmtDate(from);
  if (toInput && !toInput.value)     toInput.value   = fmtDate(today);

  // تحميل القياسات ثم العرض
  await refresh();
});

// ===== واجهة المستخدم =====
applyBtn && applyBtn.addEventListener('click', refresh);
printBtn && printBtn.addEventListener('click', ()=> window.print());
unitSelect && unitSelect.addEventListener('change', refresh);
colorizeChk && colorizeChk.addEventListener('change', ()=> renderCurrentCache());
hideNotesPrint && hideNotesPrint.addEventListener('change', ()=> renderCurrentCache());

// كاش آخر نتائج لتحسين إعادة العرض عند تغيير التلوين فقط
let __cache_days = [];

async function refresh(){
  try{
    if (!currentUser || !childId) return;

    clearTable();
    emptyMsg && emptyMsg.classList.add('hidden');

    const allDocs = await loadSnapshot(currentUser.uid, childId);
    const from = fromInput?.value ? new Date(fromInput.value) : new Date(Date.now()-6*MS_DAY);
    const to   = toInput?.value   ? new Date(toInput.value)   : new Date();
    const days = buildDaysMap(allDocs, from, to);
    __cache_days = days;

    const outUnit = (unitSelect?.value || 'mmol').toLowerCase();
    renderTable(days, outUnit);
  }catch(e){
    console.error('refresh error:', e);
    emptyMsg && (emptyMsg.textContent = 'حدث خطأ أثناء تحميل البيانات'); 
    emptyMsg && emptyMsg.classList.remove('hidden');
  }
}

function renderCurrentCache(){
  const outUnit = (unitSelect?.value || 'mmol').toLowerCase();
  renderTable(__cache_days || [], outUnit);
}

// ===== تنسيقات بسيطة (اختيارية) =====
// أضِف هذه الفئات في CSS إن لم تكن موجودة:
/*
.muted { opacity: .5 }
.v-low  { padding:2px 6px; border-radius:6px; background:#fee2e2; }  // أحمر فاتح
.v-in   { padding:2px 6px; border-radius:6px; background:#dcfce7; }  // أخضر فاتح
.v-high { padding:2px 6px; border-radius:6px; background:#fde68a; }  // أصفر فاتح
.v-mid  { padding:2px 6px; border-radius:6px; background:#e5e7eb; }  // رمادي فاتح
*/
