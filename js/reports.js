// js/reports.js — v3 (Arabic slots + pagination + filters/sort + AI insights + assistant + heatmap/hist)
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
const loader = (v)=> loaderEl?.classList.toggle('hidden', !v);
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
/* Accept input in Arabic or English in many forms */
const AR2KEY = {
  'الاستيقاظ':'wake',
  'ق.الفطار':'pre_bf','ق الفطار':'pre_bf','قبل الافطار':'pre_bf','قبل الإفطار':'pre_bf',
  'ب.الفطار':'post_bf','ب الفطار':'post_bf','بعد الافطار':'post_bf','بعد الإفطار':'post_bf',
  'ق.الغداء':'pre_ln','ق الغداء':'pre_ln','قبل الغداء':'pre_ln',
  'ب.الغداء':'post_ln','ب الغداء':'post_ln','بعد الغداء':'post_ln',
  'ق.العشاء':'pre_dn','ق العشاء':'pre_dn','قبل العشاء':'pre_dn',
  'ب.العشاء':'post_dn','ب العشاء':'post_dn','بعد العشاء':'post_dn',
  'ق.النوم':'pre_sleep','ق النوم':'pre_sleep','قبل النوم':'pre_sleep',
  'أثناء النوم':'during_sleep','اثناء النوم':'during_sleep',
  'سناك':'snack',
  'ق.الرياضة':'pre_sport','ق الرياضة':'pre_sport','قبل الرياضة':'pre_sport',
  'ب.الرياضة':'post_sport','ب الرياضة':'post_sport','بعد الرياضة':'post_sport'
};
/* English aliases → canonical key */
const EN2KEY = {
  'prebreakfast':'pre_bf', 'postbreakfast':'post_bf',
  'pre_lunch':'pre_ln',    'prelunch':'pre_ln',  'post_lunch':'post_ln', 'postlunch':'post_ln',
  'pre_dinner':'pre_dn',   'predinner':'pre_dn', 'post_dinner':'post_dn','postdinner':'post_dn',
  'wake':'wake','wakeup':'wake','morningwake':'wake',
  'pre_sleep':'pre_sleep','presleep':'pre_sleep',
  'during_sleep':'during_sleep','sleep':'during_sleep',
  'snack':'snack',
  'pre_sport':'pre_sport','presport':'pre_sport','preexercise':'pre_sport',
  'post_sport':'post_sport','postsport':'post_sport','postexercise':'post_sport'
};
function normalizeSlot(raw){
  if(!raw) return '';
  let s = String(raw).trim();
  // Arabic direct
  const sAR = s.replaceAll('.','').replaceAll('ـ','').replace(/\s+/g,' ').trim();
  if(AR2KEY[sAR]) return AR2KEY[sAR];
  // English various shapes
  const en = s.toLowerCase().replaceAll(' ','').replaceAll('-','_');
  if(EN2KEY[en]) return EN2KEY[en];
  // Upper-case like PRE_DINNER
  const up = s.toLowerCase();
  if(EN2KEY[up]) return EN2KEY[up];
  if(EN2KEY[up.replaceAll('-','').replaceAll('_','')]) return EN2KEY[up.replaceAll('-','').replaceAll('_','')];
  // Fallback
  return s;
}

/* Date/age */
function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    if(/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    const d = new Date(any);
    if(!isNaN(d)) return todayStr(d);
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

const toMgdl = mmol => Math.round(Number(mmol)*18);

/* ===== State ===== */
const params = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');
let normalMin = 4, normalMax = 7;
let rowsCache = [];           // جميع الصفوف للفترة
let viewRowsCache = [];       // بعد الفلاتر/الترتيب
let notesVisible = true;
let visibleCount = 10;
const pageSize = 10;

/* Slots order */
const SLOT_ORDER = ['wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn','snack','pre_sleep','during_sleep','pre_sport','post_sport'];
const SLOT_ORDER_MAP = new Map(SLOT_ORDER.map((k,i)=>[k,i]));
const DAYS_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']);

/* ===== Boot ===== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  localStorage.setItem('lastChildId', childId);

  // Header child info
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

  // default dates (last 7 days)
  const today = todayStr();
  if(!toEl.value)   toEl.value   = today;
  if(!fromEl.value) fromEl.value = addDays(today,-7);

  // Events
  fromEl.addEventListener('change', loadRange);
  toEl.addEventListener('change', loadRange);
  outUnitEl.addEventListener('change', ()=> { renderAll(); });

  toggleNotesBtn.addEventListener('click', ()=>{
    notesVisible = !notesVisible;
    document.body.classList.toggle('notes-hidden', !notesVisible);
    toggleNotesBtn.textContent = notesVisible ? 'إخفاء الملاحظات' : 'إظهار الملاحظات';
  });

  csvBtn.addEventListener('click', downloadCSV);

  openAnalytics?.addEventListener('click', ()=>{
    const href = new URL('analytics.html', location.href);
    href.searchParams.set('child', childId);
    href.searchParams.set('range', '14d');
    location.href = href.toString();
  });

  openPrint?.addEventListener('click', ()=>{
    const href = new URL('reports-print.html', location.href);
    href.searchParams.set('child', childId);
    if(fromEl.value) href.searchParams.set('from', fromEl.value);
    if(toEl.value)   href.searchParams.set('to', toEl.value);
    href.searchParams.set('unit', outUnitEl.value);
    location.href = href.toString();
  });

  openBlank?.addEventListener('click', ()=>{
    const blankUrl = new URL('reports-print.html', location.href);
    blankUrl.searchParams.set('child', childId);
    blankUrl.searchParams.set('mode', 'blank');
    location.href = blankUrl.toString();
  });

  // Filters/sort events
  [filterStateEl, filterSlotEl, filterCorrEl, filterHypoEl, filterNotesEl, sortByEl].forEach(el=>{
    el?.addEventListener('change', ()=> { visibleCount = pageSize; applyFiltersSort(); renderAll(); });
  });

  showMoreBtn?.addEventListener('click', ()=>{
    visibleCount += pageSize;
    renderTable(viewRowsCache);
  });

  // Chat assistant events
  chatToggleBtn?.addEventListener('click', ()=> toggleChat(true));
  chatCloseBtn?.addEventListener('click', ()=> toggleChat(false));
  chatSend?.addEventListener('click', sendChat);
  chatQ?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); sendChat(); } });

  // Load first time
  await loadRange();
});

/* ===== Data flow ===== */
function getState(mmol){
  if(mmol < normalMin) return 'low';
  if(mmol > normalMax) return 'high';
  return 'ok';
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
      slot = normalizeSlot(slot); // NEW: normalize any form to canonical key

      let mmol = null;
      if(typeof r.value_mmol === 'number') mmol = Number(r.value_mmol);
      else if (typeof r.value_mgdl === 'number') mmol = Number(r.value_mgdl)/18;
      else if (r.unit === 'mmol/L' && typeof r.value === 'number') mmol = Number(r.value);
      else if (r.unit === 'mg/dL' && typeof r.value === 'number') mmol = Number(r.value)/18;
      if(mmol==null || !isFinite(mmol)) return;

      const mgdl = (typeof r.value_mgdl === 'number') ? Number(r.value_mgdl) : toMgdl(mmol);

      const notes = r.notes || r.input?.notes || '';
      const corr  = r.correctionDose ?? r.input?.correctionDose ?? '';
      const hypo  = r.hypoTreatment  ?? r.input?.raisedWith     ?? '';

      const state = getState(mmol);
      rows.push({date, slot, mmol, mgdl, state, corr, hypo, notes});
    });

    // Order by date then slot within day
    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1) : ((SLOT_ORDER_MAP.get(a.slot)||999) - (SLOT_ORDER_MAP.get(b.slot)||999)));

    rowsCache = rows;
    visibleCount = pageSize;
    autoDensity(rows.length);

    // build slot filter options once
    buildSlotFilterOptions();

    // derive view with filters/sort then render
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
  const stateF = filterStateEl?.value || 'all';
  const slotF  = filterSlotEl?.value || 'all';
  const corrF  = filterCorrEl?.value || 'any';
  const hypoF  = filterHypoEl?.value || 'any';
  const notesF = filterNotesEl?.value || 'any';
  const sortBy = sortByEl?.value   || 'date_desc';

  let arr = rowsCache.slice();

  // filters
  if(stateF!=='all') arr = arr.filter(r => r.state===stateF);
  if(slotF!=='all')  arr = arr.filter(r => r.slot===slotF);
  if(corrF==='with') arr = arr.filter(r => r.corr!=='' && r.corr!=null);
  if(corrF==='without') arr = arr.filter(r => r.corr==='' || r.corr==null);
  if(hypoF==='with') arr = arr.filter(r => r.hypo && String(r.hypo).trim());
  if(hypoF==='without') arr = arr.filter(r => !(r.hypo && String(r.hypo).trim()));
  if(notesF==='with') arr = arr.filter(r => r.notes && String(r.notes).trim());
  if(notesF==='without') arr = arr.filter(r => !(r.notes && String(r.notes).trim()));

  // sort
  if(sortBy==='date_desc') arr.sort((a,b)=> (a.date===b.date ? 0 : (a.date>b.date?-1:1)));
  if(sortBy==='date_asc')  arr.sort((a,b)=> (a.date===b.date ? 0 : (a.date<b.date?-1:1)));
  if(sortBy==='read_asc')  arr.sort((a,b)=> a.mmol-b.mmol);
  if(sortBy==='read_desc') arr.sort((a,b)=> b.mmol-a.mmol);

  viewRowsCache = arr;
}

/* ===== Render ===== */
function renderAll(){
  renderTable(viewRowsCache);
  const stats = computeStats(viewRowsCache);
  const patterns = detectPatterns(viewRowsCache);
  renderInsights(stats, patterns);
  renderHeatmap(viewRowsCache);
  renderHistogram(viewRowsCache);
}

/* Render table with pagination */
function renderTable(rows){
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="7" class="muted center">لا يوجد قياسات للفترة المحددة.</td></tr>`;
    visibleInfoEl.textContent = '—';
    showMoreBtn?.classList.add('hidden');
    return;
  }
  const unit = outUnitEl.value; // 'mmol' | 'mgdl'
  const toTxt = r => unit==='mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;

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

  // Visible info + show more
  visibleInfoEl.textContent = `تم عرض ${slice.length} من ${rows.length}`;
  if(slice.length < rows.length) {
    showMoreBtn?.classList.remove('hidden');
  }else{
    showMoreBtn?.classList.add('hidden');
  }
}

/* ===== CSV Export (all rows of current period) ===== */
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

/* ===== AI: Stats & Patterns (local) ===== */
function computeStats(rows){
  const n = rows.length;
  if(!n) return {n:0, avg:0, med:0, sd:0, tir:0, nLow:0, nHigh:0};

  const arr = rows.map(r=>r.mmol).sort((a,b)=>a-b);
  const sum = arr.reduce((a,b)=>a+b,0);
  const avg = sum/n;
  const med = n%2? arr[(n-1)/2] : (arr[n/2-1]+arr[n/2])/2;
  const sd  = Math.sqrt(arr.reduce((a,x)=>a+(x-avg)**2,0)/n);
  const nLow  = rows.filter(r=>r.state==='low').length;
  const nHigh = rows.filter(r=>r.state==='high').length;
  const tir   = Math.round(((n - nLow - nHigh) / n) * 100);

  return {n, avg, med, sd, tir, nLow, nHigh};
}
function detectPatterns(rows){
  // counts by slot/state
  const map = new Map(); // key: slot -> {total, low, ok, high}
  rows.forEach(r=>{
    const m = map.get(r.slot) || {total:0,low:0,ok:0,high:0};
    m.total++; m[r.state]++; map.set(r.slot,m);
  });

  const findings = [];
  // thresholds
  const minCount = 3; // at least 3 occurrences to consider pattern
  map.forEach((m,slot)=>{
    if(m.total >= minCount){
      if(m.high/m.total >= 0.6) findings.push(`ارتفاعات متكررة في ${KEY2AR_SHORT[slot]||slot}`);
      if(m.low/m.total >= 0.6)  findings.push(`هبوطات متكررة في ${KEY2AR_SHORT[slot]||slot}`);
    }
  });

  // dawn-like high (wake)
  const w = map.get('wake');
  if(w && w.total>=minCount && w.high/w.total>=0.5) findings.push('ارتفاعات صباحية بعد الاستيقاظ');

  // post-meal spikes
  ['post_bf','post_ln','post_dn'].forEach(k=>{
    const m = map.get(k);
    if(m && m.total>=minCount && m.high/m.total>=0.5)
      findings.push(`ارتفاع بعد ${KEY2AR_SHORT[k].replace('ب. ','')}`);
  });

  return {bySlot:map, findings};
}
function renderInsights(stats, patterns){
  const unit = outUnitEl.value;
  const fmt = (v)=> unit==='mgdl' ? `${Math.round(v*18)} mg/dL` : `${v.toFixed(1)} mmol/L`;
  const kpi = (label, val)=> `<div class="k"><div class="t small muted">${label}</div><div class="v">${val}</div></div>`;

  insightsKPIs.innerHTML = [
    kpi('عدد القياسات', stats.n),
    kpi('المتوسط', fmt(stats.avg||0)),
    kpi('الوسيط', fmt(stats.med||0)),
    kpi('الانحراف المعياري', unit==='mgdl' ? Math.round(stats.sd*18) : stats.sd.toFixed(2)),
    kpi('داخل النطاق (TIR)', `${stats.tir}%`),
    kpi('هبوط / ارتفاع', `${stats.nLow} / ${stats.nHigh}`)
  ].join('');

  const list = patterns.findings?.length
    ? `<ul>${patterns.findings.map(f=>`<li>${escapeHTML(f)}</li>`).join('')}</ul>`
    : `<p class="muted">لا توجد أنماط غير اعتيادية بارزة في هذه الفترة.</p>`;
  insightsFindings.innerHTML = list;
}

/* ===== Mini Analytics: Heatmap & Histogram ===== */
function renderHeatmap(rows){
  if(!heatmapEl) return;
  // grid: header row (empty + days) + slots rows
  const grid = [];
  // header
  grid.push(`<div class="hm-head">—</div>`);
  for(let d=0; d<7; d++) grid.push(`<div class="hm-head">${DAYS_AR[d].slice(0,3)}</div>`);

  // aggregate by (weekday, slot)
  const agg = {}; // key: slot|day -> {total, low, ok, high}
  rows.forEach(r=>{
    const day = (new Date(r.date)).getDay(); // 0=Sun
    const key = `${r.slot}|${day}`;
    const obj = agg[key] || {total:0,low:0,ok:0,high:0};
    obj.total++; obj[r.state]++; agg[key]=obj;
  });

  SLOT_ORDER.forEach(slot=>{
    grid.push(`<div class="hm-head">${escapeHTML(KEY2AR_SHORT[slot]||slot)}</div>`);
    for(let d=0; d<7; d++){
      const key = `${slot}|${d}`;
      const m = agg[key];
      if(!m) { grid.push(`<div class="hm-cell hm-empty" title="لا قياسات"></div>`); continue; }
      // choose dominant state
      let cls='hm-ok'; let title='طبيعي';
      if(m.high>=m.low && m.high>=m.ok){ cls='hm-high'; title='ارتفاع غالب'; }
      else if(m.low>=m.high && m.low>=m.ok){ cls='hm-low'; title='هبوط غالب'; }
      // intensity by total count (opacity via inline style)
      const intensity = clamp(m.total/8, 0.18, 0.95);
      grid.push(`<div class="hm-cell ${cls}" style="opacity:${intensity.toFixed(2)}" title="${DAYS_AR[d]} • ${KEY2AR_SHORT[slot]} • ${m.total} قراءات • ${title}"></div>`);
    }
  });

  heatmapEl.innerHTML = grid.join('');
}

function renderHistogram(rows){
  if(!histogramEl) return;
  if(!rows.length){ histogramEl.innerHTML=''; return; }
  const unit = outUnitEl.value;
  const values = unit==='mgdl' ? rows.map(r=>r.mgdl) : rows.map(r=>r.mmol);
  const min = Math.min(...values), max = Math.max(...values);
  const bins = 12;
  const step = (max-min || 1)/bins;

  const counts = new Array(bins).fill(0);
  values.forEach(v=>{
    let idx = Math.floor((v-min)/step);
    if(idx>=bins) idx=bins-1;
    counts[idx]++;
  });
  const maxC = Math.max(...counts) || 1;

  const bars = counts.map((c,i)=>{
    const h = Math.round((c/maxC)*100);
    const from = (min + i*step);
    const to   = (min + (i+1)*step);
    const label = unit==='mgdl'
      ? `${Math.round(from)}–${Math.round(to)}`
      : `${from.toFixed(1)}–${to.toFixed(1)}`;
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center">
      <div class="bar" style="height:${h}%;" title="${label} • ${c} قياسات"></div>
      <div class="tick">${escapeHTML(label)}</div>
    </div>`;
  }).join('');

  histogramEl.innerHTML = bars;
}

/* ===== Assistant (local, no external calls) ===== */
function toggleChat(v){
  chatPanel?.classList.toggle('hidden', !v);
  chatPanel?.setAttribute('aria-hidden', String(!v));
  if(v) chatQ?.focus();
}
function sendChat(){
  const q = (chatQ.value||'').trim();
  if(!q) return;
  addMsg(q, true);
  chatQ.value='';
  const a = askAssistant(q);
  addMsg(a, false);
  chatBody.scrollTop = chatBody.scrollHeight;
}
function addMsg(text, me=false){
  const div = document.createElement('div');
  div.className = 'msg'+(me?' me':'');
  div.innerHTML = escapeHTML(text);
  chatBody.appendChild(div);
}
function askAssistant(q){
  const lower = q.toLowerCase();
  // Unit change
  if(/بدل|غيّر|غير/.test(q) && /وحدة|unit/.test(q)){
    outUnitEl.value = (outUnitEl.value==='mmol'?'mgdl':'mmol');
    renderAll();
    return 'تم تغيير الوحدة.';
  }
  // Notes toggle
  if(/اخف|إخف|اظه|إظه/.test(q) && /ملاحظ/.test(q)){
    toggleNotesBtn.click();
    return notesVisible ? 'تم إظهار الملاحظات.' : 'تم إخفاء الملاحظات.';
  }
  // Summary
  if(/لخص|خلاصة|ملخص|summary/.test(lower)){
    const s = computeStats(viewRowsCache);
    return `عدد القياسات ${s.n}، متوسط ${fmtUnit(s.avg)}, وسيط ${fmtUnit(s.med)}, TIR ${s.tir}%. هبوط ${s.nLow} وارتفاع ${s.nHigh}.`;
  }
  // Explain a reading: extract number
  const num = Number(q.match(/(\d+(\.\d+)?)/)?.[1]);
  if(!isNaN(num)){
    // If user provided mg/dL assume mg/dL when > 30, otherwise mmol
    let mmol = num;
    if(num>30 || /mg|دل|mg\/dl/i.test(q)) mmol = num/18;
    const state = getState(mmol);
    const stateAr = state==='low'?'هبوط':state==='high'?'ارتفاع':'طبيعي';
    return `القراءة تعادل ${fmtUnit(mmol)} وهي حالة ${stateAr} بالنسبة لنطاقك ${normalMin}–${normalMax} mmol/L.`;
  }
  // Why high/low?
  if(/ليه|لماذا|سبب|why/.test(lower)){
    const p = detectPatterns(viewRowsCache);
    if(p.findings.length){
      return `الأنماط الملحوظة: • ${p.findings.join(' • ')}. فضّلي مراجعة أوقات/كميات الكربوهيدرات والتصحيح. (ليست نصيحة طبية)`;
    }else{
      return 'لا توجد أنماط بارزة في هذه الفترة. جرّبي توسيع المدة أو إزالة بعض الفلاتر.';
    }
  }
  return 'أقدّر سؤالك! جرّبي: "لخّص الأسبوع"، "ماذا تعني 250؟"، أو "بدّل الوحدة".';
}
function fmtUnit(mmol){ return (outUnitEl.value==='mgdl') ? `${Math.round(mmol*18)} mg/dL` : `${mmol.toFixed(1)} mmol/L`; }

/* ===== Helpers ===== */
function escapeHTML(s){ return String(s)
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;')
  .replaceAll("'",'&#039;'); }
function csvCell(s){ return `"${String(s??'').replace(/"/g,'""')}"`; }
