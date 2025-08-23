// js/reports.js — محسّن
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, query, where, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر DOM */
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');

const fromEl     = document.getElementById('fromDate');
const toEl       = document.getElementById('toDate');
const outUnitEl  = document.getElementById('outUnit');
const tbody      = document.getElementById('tbody');

const openAnalytics = document.getElementById('openAnalytics');
const openPrint     = document.getElementById('openPrint');
const openBlank     = document.getElementById('openBlank');
const toggleNotesBtn= document.getElementById('toggleNotes');

const csvBtn     = document.getElementById('csvBtn');
const loaderEl   = document.getElementById('loader');
const densityHint= document.getElementById('densityHint');

/* أدوات */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (ds,delta)=>{ const d=new Date(ds); d.setDate(d.getDate()+delta); return d.toISOString().slice(0,10); };
const escapeHTML = s=>s.replace(/[&<>"']/g, c=>({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);

// ترجمة مفاتيح الفترات الزمنية
const KEY2AR = {
  awake: 'الاستيقاظ',
  pre_breakfast: 'ق.الفطار',
  post_breakfast: 'ب.الفطار',
  pre_lunch: 'ق.الغداء',
  post_lunch: 'ب.الغداء',
  pre_dinner: 'ق.العشاء',
  post_dinner: 'ب.العشاء',
  pre_sleep: 'ق.النوم'
};

/* دوال رئيسية */
let rowsCache = []; // لتخزين النتائج مؤقتًا
let childDataCache = {};

// تحميل البيانات
async function loadData(uid, childId) {
  loaderEl.classList.remove('hidden');
  const from = new Date(fromEl.value);
  const to   = new Date(toEl.value);

  const mcol = collection(db, `parents/${uid}/children/${childId}/measurements`);
  const q = query(mcol, orderBy('date'), where('date', '>=', from), where('date', '<=', to));

  const snp = await getDocs(q);
  rowsCache = [];
  snp.forEach(d => rowsCache.push(d.data()));

  loaderEl.classList.add('hidden');
  renderTable();
}

// عرض الجدول
function renderTable() {
  const tbody = document.getElementById('tbody');
  const unit = outUnitEl.value;

  const html = rowsCache.map(r => {
    const reading = unit === 'mgdl' ? r.mgdl : r.mmol.toFixed(1);
    const state = r.state === 'low' ? 'low' : r.state === 'high' ? 'high' : 'ok';
    const hasNotes = r.notes && String(r.notes).trim();

    return `<tr class="state-${state} ${hasNotes ? 'has-notes' : ''}">
      <td>${r.date}</td>
      <td class="col-slot">${KEY2AR[r.slot] || r.slot || '—'}</td>
      <td class="reading">
        ${reading} ${unit === 'mgdl' ? 'mg/dL' : 'mmol/L'}
        <span class="state-icon arrow ${r.trend || ''}"></span>
      </td>
      <td>
        <span class="status-chip ${state}">
          ${state === 'low' ? 'هبوط' : state === 'high' ? 'ارتفاع' : 'طبيعي'}
        </span>
      </td>
      <td>${r.corr !== null && r.corr !== '' ? r.corr : '—'}</td>
      <td>${r.hypo && String(r.hypo).trim() ? escapeHTML(r.hypo) : '—'}</td>
      <td class="col-notes notes">${r.notes && String(r.notes).trim() ? escapeHTML(r.notes) : '—'}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = html;
}

/* تنزيل CSV من المعروض حاليًا */
async function downloadCSV(){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  const unit  = outUnitEl.value;
  const rows  = rowsCache;

  const headers = ['date','slot','reading','state','correction','hypoTreatment','notes'];
  const toRow = (r)=> {
    const reading = unit === 'mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;
    const state   = r.state === 'low' ? 'هبوط' : r.state === 'high' ? 'ارتفاع' : 'طبيعي';
    return [
      r.date, (KEY2AR[r.slot] || r.slot || '—'), reading, state,
      (r.corr !== '' && r.corr != null) ? r.corr : '',
      (r.hypo && String(r.hypo).trim()) ? r.hypo : '',
      (r.notes && String(r.notes).trim()) ? r.notes : ''
    ];
  };

  const lines = [headers.join(','), ...rows.map(r => toRow(r).map(csvCell).join(','))];
  const blob  = new Blob(['\uFEFF' + lines.join('\n')], {type: 'text/csv;charset=utf-8;'});
  const url   = URL.createObjectURL(blob);
  const link  = document.createElement('a');
  link.href = url;
  link.download = `reports_${start}_to_${end}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(s){
  if (typeof s !== 'string') s = String(s || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// تحميل البيانات عند تغيير التواريخ أو الوحدة
function initControls(uid, childId){
  fromEl.value = addDays(todayStr(), -30);
  toEl.value   = todayStr();

  const handleChanges = ()=>loadData(uid, childId);
  fromEl.addEventListener('change', handleChanges);
  toEl.addEventListener('change', handleChanges);
  outUnitEl.addEventListener('change', handleChanges);
  csvBtn.addEventListener('click', downloadCSV);
}

// عرض/إخفاء الملاحظات
toggleNotesBtn.addEventListener('click', ()=>{
  document.body.classList.toggle('notes-hidden');
  toggleNotesBtn.textContent = document.body.classList.contains('notes-hidden') ? 'إظهار الملاحظات' : 'إخفاء الملاحظات';
});

// إعداد الروابط
function setLinks(childId, from, to){
  const base = 'reports.html';
  openAnalytics.href = `reports-analytics.html?child=${childId}&from=${from}&to=${to}`;
  openPrint.href     = `reports-print.html?child=${childId}&from=${from}&to=${to}`;
  openBlank.href     = `reports-print.html?child=${childId}&blank=true`;
}

// بداية التطبيق
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = 'index.html'; return; }
  const params = new URLSearchParams(location.search);
  const childId = params.get('child');
  if (!childId) { alert('No child ID provided.'); return; }

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const childSnap = await getDoc(childRef);
  childDataCache = childSnap.exists() ? childSnap.data() : null;
  if (!childDataCache) { alert('Child data not found.'); location.href = 'index.html'; return; }

  childNameEl.textContent = childDataCache.name || 'طفل';
  childMetaEl.textContent = `CR: ${childDataCache.cr || '—'} / CF: ${childDataCache.cf || '—'}`;
  chipRangeEl.textContent = `النطاق: ${childDataCache.low || '—'} - ${childDataCache.high || '—'}`;
  chipCREl.textContent = `CR: ${childDataCache.cr || '—'}`;
  chipCFEl.textContent = `CF: ${childDataCache.cf || '—'}`;
  
  initControls(user.uid, childId);
  await loadData(user.uid, childId);
  setLinks(childId, fromEl.value, toEl.value);
});
