// reports-print.js — تقرير الطباعة مع شريط/سطر البيانات الأساسية + تصنيف severe

import { auth, db } from './firebase-config.js';
import {
  collection, query, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ===================== Helpers ===================== */
const pick = (ids=[])=>{
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
};
const pickQS = (sels=[])=>{
  for (const s of sels){
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
};
const fmtDate = d => d.toISOString().slice(0,10);
const MS_DAY = 24*60*60*1000;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
const endOfDay   = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);

/* ===================== عناصر الصفحة ===================== */
const params   = new URLSearchParams(location.search);
const parentId = params.get('parent');
const childId  = params.get('child');

const unitSelect     = pick(['unitSelect','unitSel','unit']);
const fromInput      = pick(['fromDate','from','dateFrom']);
const toInput        = pick(['toDate','to','dateTo']);
const colorizeChk    = pick(['colorizeChk','colorize','colorizePrint']);
const hideNotesPrint = pick(['hideNotesPrint','hideNotes','hideNotesChk']);
const applyBtn       = pick(['applyBtn','apply','run','filterApply']);
const printBtn       = pick(['printBtn','print','btnPrint']);
const childNameEl    = pick(['childName','name','titleChild']);
const childMetaEl    = pick(['childMeta','metaChild','childAge']);

// شريط وسطر وملاحظات أعلى التقرير
const basicsHost    = pick(['basicsBar','childBasics','basics','chipsBar']);
const topNotesInput = pick(['reportNotes','topNotes','notesInput','notesBox']);
const topNotesOut   = pick(['notesTopOut','reportTopText']);

// tbody (ببدائل ذكية)
let tableBody = pick(['daysTableBody','reportBody','daysBody']);
if (!tableBody) {
  tableBody = pickQS(['tbody[data-role="days"]', '#daysTable tbody', 'table#print tbody', 'table tbody']);
}
const emptyMsg = pick(['emptyMsg','noData','msgEmpty']);

/* ===================== نطاقات الطفل ===================== */
let childData = null;
function getRanges() {
  const r = childData?.normalRange || {};
  // Fallbacks من النورمال
  const fallbackMin = Number(r.min ?? 4.5);
  const fallbackMax = Number(r.max ?? 7);
  // Severe = إن وُجدت، وإلا خُذ من النورمال، وإلا 4.5/7
  const severeLow  = Number((r.severeLow  ?? r.severe_low  ?? fallbackMin));
  const severeHigh = Number((r.severeHigh ?? r.severe_high ?? fallbackMax));
  return { min: fallbackMin, max: fallbackMax, severeLow, severeHigh };
}

/* ===================== خانات الجدول ===================== */
const SLOTS = [
  'FASTING','PRE_BREAKFAST','POST_BREAKFAST',
  'PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER',
  'BEDTIME','OVERNIGHT','RANDOM'
];
// يرتّب الأعمدة من اليمين لليسار حسب رؤوسك
const DISPLAY_ORDER = [
  'OVERNIGHT','FASTING','PRE_BREAKFAST','POST_BREAKFAST',
  'PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER',
  'BEDTIME','RANDOM'
];

function mapSlotSafe(raw){
  const s = (raw||'').toString().trim().toUpperCase();
  if (SLOTS.includes(s)) return s;
  // aliases مختصرة
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
    'RND':'RANDOM','عشوائي':'RANDOM'
  };
  return aliases[s] || 'RANDOM';
}

/* ===================== وحدات ===================== */
function toMmol(val, unit){
  if (val==null) return null;
  const n = Number(val); if (Number.isNaN(n)) return null;
  return (unit==='mgdl' || unit==='mg/dL' || unit==='MGDL' || unit==='MG/DL') ? n/18 : n;
}
function fromMmol(v, outUnit){ return (outUnit==='mgdl') ? v*18 : v; }
function formatValue(mmol, outUnit){
  if (mmol==null) return '';
  const v = fromMmol(mmol, (outUnit||'mmol').toLowerCase());
  return (outUnit||'mmol').toLowerCase()==='mgdl' ? Math.round(v).toString() : v.toFixed(1);
}

/* ===================== Data Layer ===================== */
function makeDayRow(dateKey){ const cols={}; SLOTS.forEach(s=>cols[s]=[]); return { dateKey, cols, notes:[] }; }

async function loadSnapshot(uid, childId){
  const col = collection(db, `parents/${uid}/children/${childId}/measurements`);
  const qs = [ query(col, orderBy('when','asc')), query(col, orderBy('date','asc')) ];
  const results = await Promise.allSettled(qs.map(getDocs));
  const docs = [];
  for (const r of results){
    if (r.status==='fulfilled'){ r.value.forEach(d=> docs.push(d)); }
  }
  return docs;
}
function normalizeDoc(dsnap){
  const m = dsnap.data?.() || dsnap.data || null;
  if (!m) return null;
  const when = m.when?.toDate?.() || (m.date ? new Date(m.date) : null);
  if (!when || isNaN(when.getTime())) return null;
  const raw  = m.mmol ?? m.value ?? m.glucose ?? m.mgdl;
  const unit = (m.unit || (m.mgdl!=null ? 'mgdl' : 'mmol')).toLowerCase();
  const mmol = toMmol(raw, unit);
  if (mmol==null) return null;
  return { when, mmol, slot: mapSlotSafe(m.slotKey || m.slot || m.timeLabel || m.slotLabel), notes: m.notes || '' };
}
function buildDaysMap(allDocs, fromD, toD){
  const fromTs = startOfDay(fromD).getTime();
  const toTs   = endOfDay(toD).getTime();
  const byDate = new Map();

  allDocs.forEach(snap=>{
    const n = normalizeDoc(snap); if(!n) return;
    const t = n.when.getTime();  if (t<fromTs || t>toTs) return;

    const key = n.when.toISOString().slice(0,10);
    let day = byDate.get(key);
    if (!day){ day = makeDayRow(key); byDate.set(key, day); }
    if (!Array.isArray(day.cols[n.slot])) day.cols[n.slot] = [];
    day.cols[n.slot].push({ t:n.when, mmol:n.mmol, notes:n.notes });
    if (n.notes) day.notes.push(n.notes);
  });

  return Array.from(byDate.values()).sort((a,b)=> a.dateKey.localeCompare(b.dateKey));
}

/* ===================== التلوين/التصنيف ===================== */
function classify(mmol){
  const { severeLow, severeHigh } = getRanges();
  if (mmol < severeLow)  return 'low';   // هبوط
  if (mmol > severeHigh) return 'high';  // ارتفاع
  return 'in';                           // طبيعي = بين ال-severeين
}
function spanValue(mmol, outUnit, colorize){
  const v = formatValue(mmol, outUnit);
  if (!colorize) return `<span>${v}</span>`;
  const cls = classify(mmol); // low | in | high
  return `<span class="v-${cls}">${v}</span>`;
}

/* ===================== العرض في الجدول ===================== */
function ensureTableBody(){
  if (tableBody) return true;
  const host = pickQS(['#tableHost','.table-host','main','.container','.content']) || document.body;
  const warn = document.createElement('div');
  warn.style.margin='1rem 0';
  warn.style.padding='12px';
  warn.style.background='#fff3cd';
  warn.style.border='1px solid #ffeeba';
  warn.style.borderRadius='8px';
  warn.innerText = '⚠️ لم يتم العثور على tbody. تأكد من وجود <tbody id="daysTableBody"> أو حدده داخل الكود.';
  host.prepend(warn);
  return false;
}
function clearTable(){ if (tableBody) tableBody.innerHTML = ''; }

function renderTable(days, outUnit){
  if (!ensureTableBody()) return;
  clearTable();

  if (!days.length){
    emptyMsg && emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg && emptyMsg.classList.add('hidden');

  days.forEach(day=>{
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = day.dateKey;
    tr.appendChild(tdDate);

    const colorize = !!(colorizeChk && colorizeChk.checked);

    DISPLAY_ORDER.forEach(slot=>{
      const td = document.createElement('td');
      const arr = Array.isArray(day.cols?.[slot]) ? day.cols[slot] : [];
      td.innerHTML = arr.length
        ? arr.sort((a,b)=>a.t-b.t).map(x=> spanValue(x.mmol, (unitSelect?.value||'mmol').toLowerCase(), colorize)).join(' ')
        : '<span class="muted">—</span>';
      tr.appendChild(td);
    });

    const tdNotes = document.createElement('td');
    const hideNotes = !!(hideNotesPrint && hideNotesPrint.checked);
    tdNotes.innerHTML = hideNotes ? '<span class="muted">—</span>'
                                  : (day.notes?.length ? day.notes.join(' • ') : '<span class="muted">—</span>');
    tr.appendChild(tdNotes);

    tableBody.appendChild(tr);
  });
}

/* ===================== شريط/سطر البيانات الأساسية ===================== */
function renderBasicsChips() {
  if (!basicsHost) return;
  const unitOut = (unitSelect?.value || 'mmol').toLowerCase() === 'mgdl' ? 'mg/dL' : 'mmol/L';
  const { min, max, severeLow, severeHigh } = getRanges();

  // العمر التقريبي
  let ageTxt = '';
  const b = childData?.birthDate ? new Date(childData.birthDate) : null;
  if (b && !isNaN(b.getTime())) {
    const yrs = Math.max(0, new Date().getFullYear() - b.getFullYear());
    ageTxt = `العمر: ${yrs} سنة`;
  }

  // CF/CR (محاولة أكثر من اسم حقل)
  const cf = childData?.cf ?? childData?.correctionFactor ?? null; // mmol/L لكل وحدة
  const cr = childData?.cr ?? childData?.carbRatio ?? null;        // g لكل وحدة

  basicsHost.innerHTML = [
    ageTxt && `<span class="chip"> ${ageTxt} </span>`,
    `<span class="chip">الوحدة: ${unitOut}</span>`,
    `<span class="chip">طبيعي (تعريف التقرير): ${severeLow}–${severeHigh} mmol/L</span>`,
    `<span class="chip muted">النطاق القياسي: ${min}–${max} mmol/L</span>`,
    (cf!=null) && `<span class="chip">CF: ${cf} mmol/L/U</span>`,
    (cr!=null) && `<span class="chip">CR: ${cr} g/U</span>`
  ].filter(Boolean).join('');

  // ستايل للشيبس لو مش موجود
  if (!document.getElementById('chips-style')){
    const s = document.createElement('style');
    s.id = 'chips-style';
    s.textContent = `
      .chip{display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid #e5e7eb;background:#f9fafb;font-size:12px}
      .chip.muted{opacity:.7}
      @media print {.chip{background:#fff}}
      .muted{opacity:.5}
      .v-low{padding:2px 6px;border-radius:6px;background:#fee2e2}
      .v-in{padding:2px 6px;border-radius:6px;background:#dcfce7}
      .v-high{padding:2px 6px;border-radius:6px;background:#fde68a}
    `;
    document.head.appendChild(s);
  }
}

// يضيف سطر البيانات الأساسية أول الجدول (يطبع دائمًا)
function injectBasicsRow() {
  if (!tableBody) return;

  // تقدير عدد الأعمدة
  let cols = 1 + DISPLAY_ORDER.length + 1;
  const thead = tableBody.closest('table')?.querySelector('thead tr');
  if (thead) cols = thead.querySelectorAll('th').length || cols;

  const unitOut = (unitSelect?.value || 'mmol').toLowerCase()==='mgdl' ? 'mg/dL' : 'mmol/L';
  const { min, max, severeLow, severeHigh } = getRanges();
  const cf = childData?.cf ?? childData?.correctionFactor ?? null;
  const cr = childData?.cr ?? childData?.carbRatio ?? null;

  const parts = [
    `الوحدة: ${unitOut}`,
    `طبيعي: ${severeLow}–${severeHigh} mmol/L`,
    `النطاق القياسي: ${min}–${max} mmol/L`,
    (cf!=null) && `CF: ${cf} mmol/L/U`,
    (cr!=null) && `CR: ${cr} g/U`
  ].filter(Boolean);

  const tr = document.createElement('tr');
  tr.className = 'basics-row';
  const td = document.createElement('td');
  td.colSpan = cols;
  td.style.background = '#f8fafc';
  td.style.borderBottom = '1px solid #e5e7eb';
  td.style.fontSize = '12px';
  td.style.padding = '8px 12px';
  td.innerHTML = parts.map(p=>`<span style="margin-inline-end:14px">${p}</span>`).join('');
  tr.appendChild(td);

  // أضِف كسطر أول
  tableBody.prepend(tr);
}

// ملاحظات أعلى التقرير (تُعرض قبل الجدول)
function renderTopNotes() {
  const txt = (topNotesInput && topNotesInput.value || '').trim();
  const host = topNotesOut || topNotesInput?.parentElement;
  if (!host) return;

  const old = host.querySelector('.top-notes-render');
  if (old) old.remove();

  if (txt) {
    const box = document.createElement('div');
    box.className = 'top-notes-render';
    box.style.margin = '.5rem 0';
    box.style.padding = '10px 12px';
    box.style.border = '1px dashed #cbd5e1';
    box.style.borderRadius = '8px';
    box.style.background = '#f8fafc';
    box.innerHTML = `<strong>ملاحظات:</strong> ${txt}`;
    host.appendChild(box);
  }
}

/* ===================== دورة الحياة ===================== */
let currentUser = null;
let __cache_days = [];

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  currentUser = user;

  // وثيقة الطفل
  const cs = await getDoc(doc(db, `parents/${parentId || user.uid}/children/${childId}`));
  if (!cs.exists()){ alert('الطفل غير موجود'); history.back(); return; }
  childData = cs.data();

  // العنوان
  const name = childData.name || '—';
  const b = childData.birthDate ? new Date(childData.birthDate) : null;
  const ageYears = b ? Math.max(0, new Date().getFullYear() - b.getFullYear()) : '';
  if (childNameEl) childNameEl.textContent = name;
  if (childMetaEl) childMetaEl.textContent = ageYears ? `العمر ~ ${ageYears} سنة` : '';

  // تاريخ افتراضي (آخر 7 أيام)
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()-6);
  if (fromInput && !fromInput.value) fromInput.value = fmtDate(from);
  if (toInput && !toInput.value)     toInput.value   = fmtDate(today);

  // عرض الشريط والملاحظات ثم تحميل البيانات
  renderBasicsChips();
  renderTopNotes();
  await refresh();
});

async function refresh(){
  try{
    if(!currentUser || !childId) return;

    clearTable();
    emptyMsg && emptyMsg.classList.add('hidden');

    const allDocs = await loadSnapshot(currentUser.uid, childId);
    const from = fromInput?.value ? new Date(fromInput.value) : new Date(Date.now()-6*MS_DAY);
    const to   = toInput?.value   ? new Date(toInput.value)   : new Date();
    const days = buildDaysMap(allDocs, from, to);
    __cache_days = days;

    const outUnit = (unitSelect?.value || 'mmol').toLowerCase();
    renderTable(days, outUnit);
    injectBasicsRow();
  }catch(err){
    console.error('refresh error:', err);
    if (emptyMsg){
      emptyMsg.textContent = 'حدث خطأ أثناء تحميل البيانات';
      emptyMsg.classList.remove('hidden');
    }
  }
}

function renderCurrentCache(){
  const outUnit = (unitSelect?.value || 'mmol').toLowerCase();
  renderTable(__cache_days || [], outUnit);
  injectBasicsRow();
}

/* ===================== Events ===================== */
applyBtn       && applyBtn.addEventListener('click', refresh);
printBtn       && printBtn.addEventListener('click', ()=> window.print());
unitSelect     && unitSelect.addEventListener('change', ()=>{ renderBasicsChips(); refresh(); });
colorizeChk    && colorizeChk.addEventListener('change', renderCurrentCache);
hideNotesPrint && hideNotesPrint.addEventListener('change', renderCurrentCache);
topNotesInput  && topNotesInput.addEventListener('input',  renderTopNotes);
topNotesInput  && topNotesInput.addEventListener('change', renderTopNotes);

/* ===================== ملاحظات CSS (إن لم تكن موجودة) ===================== */
/*
.muted{opacity:.5}
.v-low{padding:2px 6px;border-radius:6px;background:#fee2e2}
.v-in{padding:2px 6px;border-radius:6px;background:#dcfce7}
.v-high{padding:2px 6px;border-radius:6px;background:#fde68a}
*/
