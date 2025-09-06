// js/reports.js — التلوين والحساب على hypo/hyper (بدون تغيير DOM/CSS)
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, query, where, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== DOM ===== */
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

/* New UI */
const insightsKPIs     = document.getElementById('insightsKPIs');
const insightsFindings = document.getElementById('insightsFindings');

const filterStateEl = document.getElementById('filterState');
const filterSlotEl  = document.getElementById('filterSlot');
const filterCorrEl  = document.getElementById('filterCorr');
const filterHypoEl  = document.getElementById('filterHypo');
const filterNotesEl = document.getElementById('filterNotes');
const sortByEl      = document.getElementById('sortBy');

const showMoreBtn   = document.getElementById('showMore');
const visibleInfoEl = document.getElementById('visibleInfo');

const heatmapEl     = document.getElementById('heatmap');
const histogramEl   = document.getElementById('histogram');

const chatToggleBtn = document.getElementById('chatToggle');
const chatPanel     = document.getElementById('chatPanel');
const chatCloseBtn  = document.getElementById('chatClose');
const chatBody      = document.getElementById('chatBody');
const chatQ         = document.getElementById('chatQ');
const chatSend      = document.getElementById('chatSend');

/* ===== Utils ===== */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (ds,delta)=>{ const d=new Date(ds); d.setDate(d.getDate()+delta); return todayStr(d); };
const loader = (v)=> loaderEl && loaderEl.classList.toggle('hidden', !v);
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

/* Arabic Slots Mapping (Short) */
const KEY2AR_SHORT = {
  wake:'الاستيقاظ',
  pre_bf:'ق. الفطار',   post_bf:'ب. الفطار',
  pre_ln:'ق. الغداء',   post_ln:'ب. الغداء',
  pre_dn:'ق. العشاء',   post_dn:'ب. العشاء',
  snack:'سناك',
  pre_sleep:'ق. النوم', during_sleep:'أثناء النوم',
  pre_sport:'ق. الرياضة', post_sport:'ب. الرياضة'
};
/* Arabic input → canonical */
const AR2KEY = {
  'الاستيقاظ':'wake',
  'ق. الفطار':'pre_bf', 'ب. الفطار':'post_bf',
  'ق. الغداء':'pre_ln', 'ب. الغداء':'post_ln',
  'ق. العشاء':'pre_dn', 'ب. العشاء':'post_dn',
  'سناك':'snack',
  'ق. النوم':'pre_sleep', 'أثناء النوم':'during_sleep',
  'ق. الرياضة':'pre_sport', 'ب. الرياضة':'post_sport'
};

/* ===== State ===== */
const params = new URLSearchParams(location.search);
const childId = params.get('child');
let normalMin=4.5, normalMax=7.0;
let hypoLevel=4.0, hyperLevel=11.0;

let rowsCache = [];
let viewRowsCache = [];
let visibleCount = 50;
const pageSize = 50;

const SLOT_ORDER = ['wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn','snack','pre_sleep','during_sleep','pre_sport','post_sport'];
const SLOT_ORDER_MAP = new Map(SLOT_ORDER.map((k,i)=>[k,i]));

/* ===== Session ===== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }

  // افتراض الفتره: أسبوع
  toEl.value   = todayStr();
  fromEl.value = addDays(toEl.value, -6);

  // تحميل الطفل لقراءة الحدود
  const s = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
  if(!s.exists()){ alert('الطفل غير موجود'); history.back(); return; }
  const c = s.data();

  normalMin = Number(c?.normalRange?.min ?? 4.5);
  normalMax = Number(c?.normalRange?.max ?? 7.0);

  // حدود التلوين الجديدة
  hypoLevel  = Number(c?.hypoLevel  ?? normalMin);
  hyperLevel = Number(c?.hyperLevel ?? normalMax);

  childNameEl.textContent = c.name || 'طفل';
  const age = (()=>{ if(!c.birthDate) return '—'; const b=new Date(c.birthDate), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return `${a} سنة`})();
  childMetaEl.textContent = `${c.gender||'—'} • ${age}`;
  chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
  chipCREl.textContent    = `CR: ${c.carbRatio ?? '—'} g/U`;
  chipCFEl.textContent    = `CF: ${c.correctionFactor ?? '—'} mmol/L/U`;

  /* روابط */
  openAnalytics && openAnalytics.addEventListener('click', ()=>{
    const href = new URL('analytics.html', location.href);
    href.searchParams.set('child', childId);
    location.href = href.toString();
  });
  openPrint && openPrint.addEventListener('click', ()=>{
    const href = new URL('reports-print.html', location.href);
    href.searchParams.set('child', childId);
    if(fromEl.value) href.searchParams.set('from', fromEl.value);
    if(toEl.value)   href.searchParams.set('to', toEl.value);
    href.searchParams.set('unit', outUnitEl.value);
    location.href = href.toString();
  });
  openBlank && openBlank.addEventListener('click', ()=>{
    const blankUrl = new URL('reports-print.html', location.href);
    blankUrl.searchParams.set('child', childId);
    blankUrl.searchParams.set('mode', 'blank');
    location.href = blankUrl.toString();
  });

  // Filters/sort events
  [filterStateEl, filterSlotEl, filterCorrEl, filterHypoEl, filterNotesEl, sortByEl].forEach(el=>{
    if(el) el.addEventListener('change', ()=> { visibleCount = pageSize; applyFiltersSort(); renderAll(); });
  });

  showMoreBtn && showMoreBtn.addEventListener('click', ()=>{
    visibleCount += pageSize;
    renderTable(viewRowsCache);
  });

  await loadRange();
});

/* ===== Data flow ===== */
function getState(mmol){
  if(mmol < hypoLevel) return 'low';
  if(mmol > hyperLevel) return 'high';
  return 'ok';
}

function normalizeDateStr(s){
  if(!s) return '';
  const d = new Date(s);
  if(Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function normalizeSlot(slot){
  if(!slot) return '';
  const k = (AR2KEY[slot] || String(slot).toLowerCase()).trim();
  return SLOT_ORDER.includes(k) ? k : k;
}

/* Load range with server-side filtering + order */
async function loadRange(){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  if(!start || !end) return;

  tbody.innerHTML = `<tr><td colspan="7" class="muted center">جارِ التحميل…</td></tr>`;
  loader(true);

  try{
    const base = collection(db, `parents/${auth.currentUser.uid}/children/${childId}/measurements`);
    const qy = query(base, where('date','>=',start), where('date','<=',end), orderBy('date','asc'));
    const snap = await getDocs(qy);

    const rows=[];
    snap.forEach(d=>{
      const r = d.data();
      const date = normalizeDateStr(r.date);
      if(!date) return;

      let slot = String(r.slotKey || r.slot || r.timeLabel || '').trim();
      slot = normalizeSlot(slot);

      let mmol = null;
      if(typeof r.value_mmol === 'number') mmol = Number(r.value_mmol);
      else if (typeof r.value_mgdl === 'number') mmol = Number(r.value_mgdl)/18;
      else if (r.unit === 'mmol/L' && typeof r.value === 'number') mmol = Number(r.value);
      else if (r.unit === 'mg/dL' && typeof r.value === 'number') mmol = Number(r.value)/18;
      if(mmol==null || !isFinite(mmol)) return;

      const mgdl = (typeof r.value_mgdl === 'number') ? Number(r.value_mgdl) : Math.round(mmol*18);
      const corr = r.correctionDose ?? '';
      const hypo = r.hypoTreatment ?? '';
      const notes= r.notes ?? '';
      const state = getState(mmol);
      rows.push({date, slot, mmol, mgdl, state, corr, hypo, notes});
    });

    // Order by date then slot
    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1) : ((SLOT_ORDER_MAP.get(a.slot)||999) - (SLOT_ORDER_MAP.get(b.slot)||999)));

    rowsCache = rows;
    visibleCount = pageSize;
    autoDensity(rows.length);

    buildSlotFilterOptions();
    applyFiltersSort();
    renderAll();
  }catch(e){
    console.error('loadRange error', e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted center">خطأ في تحميل البيانات.</td></tr>`;
  }finally{
    loader(false);
  }
}

/* Auto density hint */
function autoDensity(n){
  document.body.classList.remove('dense','very-dense');
  if(n>300) document.body.classList.add('very-dense');
  else if(n>150) document.body.classList.add('dense');
  densityHint.textContent = n>150
    ? `تم تفعيل العرض الكثيف تلقائيًا (${n} صف).`
    : `سيتم تفعيل عرض كثيف تلقائيًا عند تعدّي 150 صف.`;
}

/* ===== Filters & Sort ===== */
function buildSlotFilterOptions(){
  if(!filterSlotEl || filterSlotEl.__filled) return;
  SLOT_ORDER.forEach(key=>{
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = KEY2AR_SHORT[key] || key;
    filterSlotEl.appendChild(opt);
  });
  filterSlotEl.__filled = true;
}
function applyFiltersSort(){
  const stateF = (filterStateEl && filterStateEl.value) || 'all';
  const slotF  = (filterSlotEl  && filterSlotEl.value)  || 'all';
  const corrF  = (filterCorrEl  && filterCorrEl.value)  || 'any';
  const hypoF  = (filterHypoEl  && filterHypoEl.value)  || 'any';
  const notesF = (filterNotesEl && filterNotesEl.value) || 'any';
  const sortBy = (sortByEl     && sortByEl.value)      || 'date_desc';

  let arr = rowsCache.slice();

  if(stateF!=='all') arr = arr.filter(r => r.state===stateF);
  if(slotF!=='all')  arr = arr.filter(r => r.slot===slotF);
  if(corrF==='with') arr = arr.filter(r => r.corr!=='' && r.corr!=null);
  if(corrF==='without') arr = arr.filter(r => r.corr==='' || r.corr==null);
  if(hypoF==='with') arr = arr.filter(r => r.hypo && String(r.hypo).trim());
  if(hypoF==='without') arr = arr.filter(r => !(r.hypo && String(r.hypo).trim()));
  if(notesF==='with') arr = arr.filter(r => r.notes && String(r.notes).trim());
  if(notesF==='without') arr = arr.filter(r => !(r.notes && String(r.notes).trim()));

  // sort
  if(sortBy==='date_asc') arr.sort((a,b)=> a.date.localeCompare(b.date));
  if(sortBy==='date_desc') arr.sort((a,b)=> b.date.localeCompare(a.date));
  if(sortBy==='high_first') arr.sort((a,b)=> (b.state==='high') - (a.state==='high'));
  if(sortBy==='low_first')  arr.sort((a,b)=> (b.state==='low')  - (a.state==='low'));

  viewRowsCache = arr;
}
function renderAll(){
  renderTable(viewRowsCache);
}

/* ===== Render table ===== */
function toTxt(r){
  return outUnitEl.value==='mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;
}
function renderTable(rows){
  const slice = rows.slice(0, visibleCount);
  const html = slice.map(r=>{
    const arrow  = r.state==='low'?'↓': r.state==='high'?'↑':'↔';
    const trCls  = (r.state==='low'?'state-low': r.state==='high'?'state-high':'state-ok');
    return `<tr class="${trCls}">
      <td>${r.date}</td>
      <td>${KEY2AR_SHORT[r.slot] || r.slot || '—'}</td>
      <td class="reading"><span class="val ${r.state}">${toTxt(r)}</span><span class="arrow ${r.state==='low'?'down':r.state==='high'?'up':''}">${arrow}</span></td>
      <td>${r.state==='low'?'هبوط': r.state==='high'?'ارتفاع':'طبيعي'}</td>
      <td>${(r.corr!=='' && r.corr!=null) ? r.corr : '—'}</td>
      <td>${r.hypo && String(r.hypo).trim() ? r.hypo : '—'}</td>
      <td class="notes col-notes">${r.notes && String(r.notes).trim() ? escapeHTML(r.notes) : '—'}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = html;

  if(visibleInfoEl) visibleInfoEl.textContent = `تم عرض ${slice.length} من ${rows.length}`;
  if(showMoreBtn){
    if(slice.length < rows.length) showMoreBtn.classList.remove('hidden');
    else showMoreBtn.classList.add('hidden');
  }
}

/* ===== CSV ===== */
function csvCell(x){
  if(x==null) return '';
  const s=String(x);
  if(/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
async function downloadCSV(){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  const unit  = outUnitEl.value;
  const rows  = rowsCache;

  const headers = ['date','slot','reading','state','correction','hypoTreatment','notes'];
  const toRow = (r)=>{
    const reading = unit==='mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;
    const state   = r.state==='low'?'هبوط': r.state==='high'?'ارتفاع':'طبيعي';
    return [
      r.date, (KEY2AR_SHORT[r.slot]||r.slot||'—'), reading, state,
      (r.corr!=='' && r.corr!=null) ? r.corr : '',
      (r.hypo && String(r.hypo).trim()) ? r.hypo : '',
      (r.notes && String(r.notes).trim()) ? r.notes : ''
    ];
  };

  const lines = [headers.join(','), ...rows.map(r => toRow(r).map(csvCell).join(','))];
  const blob  = new Blob(['\uFEFF'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reports_${start}_to_${end}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===== Events ===== */
csvBtn && csvBtn.addEventListener('click', downloadCSV);
