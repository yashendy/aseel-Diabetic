// measurements.js — نسخة محسّنة (فلاتر + إحصائيات + بحث + اختصارات + Undo/Redo + Sparkline + Auto-slot-filter)
// لا تعديل على HTML ولا القواعد. كل العناصر الجديدة تُحقن عبر JS.

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => (s??'').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const round1 = n => Math.round((Number(n)||0)*10)/10;
const todayISO = () => new Date().toISOString().slice(0,10);
const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const mgdl2mmol = mg => mg/18;
const mmol2mgdl = mmol => mmol*18;
function toast(msg,type='info'){ const t=$('toast')||(()=>{const x=document.createElement('div');x.id='toast';x.className='toast';document.body.appendChild(x);return x;})(); t.textContent=msg; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200); }

/* ---------- Slots ordering (زمني حقيقي) ---------- */
const SLOT_ORDER = {
  FASTING:10, PRE_BREAKFAST:20, POST_BREAKFAST:25,
  PRE_LUNCH:30,  POST_LUNCH:35,
  PRE_DINNER:40, POST_DINNER:45,
  SNACK:50, EXERCISE:60,
  BEDTIME:90, DURING_SLEEP:100,
  OTHER:200
};
const SLOT_LABEL = {
  FASTING:'صائم', PRE_BREAKFAST:'قبل الفطار', POST_BREAKFAST:'بعد الفطار',
  PRE_LUNCH:'قبل الغداء', POST_LUNCH:'بعد الغداء',
  PRE_DINNER:'قبل العشاء', POST_DINNER:'بعد العشاء',
  SNACK:'سناك', EXERCISE:'رياضة',
  BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم',
  OTHER:'أخرى'
};
const slotOrder = key => SLOT_ORDER[key] ?? 200;

/* ---------- DOM ---------- */
const params = new URLSearchParams(location.search);
const childId = (params.get('child')||'').trim();

let dayPicker, slotSel, readingInp, unitSel, convertedBox, stateBadge, corrDoseView;
let childNameEl, childMetaEl, chipsBar, targetsChips, backToChildBtn;
let gridEl, emptyEl, sortSel, liveToggle, toMealsBtn, saveBtn, exportCsvBtn, exportXlsxBtn;

// injected
let filtersBar, searchBox, statsBar, sparklineBox, undoBtn, redoBtn, autoSlotToggle;

let currentUser=null, childRef=null, childData=null;
let measCol=null;
let unsubscribe=null; // onSnapshot
let cache=[];         // raw (كل اليوم)
let filterState = { group:'ALL', state:'ALL', search:'', auto:false };
let lastOps = [];     // stack للـ undo
let redoStack = [];

/* ---------- Boot ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  currentUser=user;
  wireDom();
  injectUI();
  await loadChild(user.uid);
  applyChildUI();
  dayPicker.value = dayPicker.value || todayISO();
  unitSel.value = (childData?.glucoseUnit || 'mg/dL');
  await refreshList();
  wireEvents();
  updateDerived();
});

/* ---------- Wire base DOM ---------- */
function wireDom(){
  dayPicker = $('dayPicker'); slotSel=$('slotKey'); readingInp=$('reading'); unitSel=$('unitSel');
  convertedBox=$('converted'); stateBadge=$('stateBadge'); corrDoseView=$('corrDoseView');
  childNameEl=$('childName'); childMetaEl=$('childMeta'); chipsBar=$('therapyChips'); targetsChips=$('targetsChips');
  gridEl=$('grid'); emptyEl=$('empty'); sortSel=$('sortSel'); liveToggle=$('liveToggle');
  toMealsBtn=$('toMeals'); saveBtn=$('saveBtn'); exportCsvBtn=$('exportCsvBtn'); exportXlsxBtn=$('exportXlsxBtn');
  backToChildBtn=$('backToChild');
}

/* ---------- Inject new UI (no HTML edits) ---------- */
function injectUI(){
  // Filters & search
  if(!$('filtersBar')){
    const head = document.createElement('div');
    head.id='filtersBar';
    head.className='filters';
    head.innerHTML = `
      <div class="chips">
        <button class="chip" data-g="ALL">الكل</button>
        <button class="chip" data-g="PRE">قبل</button>
        <button class="chip" data-g="POST">بعد</button>
        <button class="chip" data-g="FASTING">صائم</button>
        <button class="chip" data-g="SNACK">سناك</button>
        <button class="chip" data-g="EXERCISE">رياضة</button>
        <button class="chip" data-g="BEDTIME">قبل النوم</button>
        <span class="sep"></span>
        <button class="chip" data-s="NORMAL">طبيعي</button>
        <button class="chip" data-s="LOW">انخفاض</button>
        <button class="chip" data-s="HIGH">ارتفاع</button>
        <span class="sep"></span>
        <button class="chip warn" id="clearFilters">مسح الفلاتر</button>
        <label class="chip">
          <input type="checkbox" id="autoSlotToggle" style="margin-inline-end:6px"> Auto
        </label>
      </div>
      <div class="search">
        <input id="searchBox" type="search" placeholder="بحث في القياسات (الوقت/النوع/الحالة/ملاحظات) — اضغط F للتركيز">
      </div>
    `;
    // ضعها قبل table-head
    const tbl = document.querySelector('.table-wrap');
    tbl?.insertBefore(head, tbl.firstChild);
  }
  filtersBar = $('filtersBar');
  searchBox = $('searchBox');
  autoSlotToggle = $('autoSlotToggle');

  // Stats & sparkline
  if(!$('statsBar')){
    const s = document.createElement('div');
    s.id='statsBar'; s.className='stats';
    s.innerHTML = `
      <div class="stats-cards">
        <div class="card"><span class="k">TIR</span><b id="statTIR">—</b></div>
        <div class="card"><span class="k">Avg</span><b id="statAvg">—</b></div>
        <div class="card"><span class="k">SD</span><b id="statSD">—</b></div>
        <div class="card low"><span class="k">Lows</span><b id="statLow">—</b></div>
        <div class="card high"><span class="k">Highs</span><b id="statHigh">—</b></div>
        <div class="card crit"><span class="k">Critical</span><b id="statCrit">—</b></div>
      </div>
      <div id="sparklineBox" class="sparkline"></div>
    `;
    const tbl = document.querySelector('.table-wrap');
    tbl?.parentElement?.insertBefore(s, tbl);
  }
  statsBar = $('statsBar'); sparklineBox=$('sparklineBox');

  // Undo/Redo buttons near export
  if(!$('undoBtn')){
    undoBtn = document.createElement('button'); undoBtn.id='undoBtn'; undoBtn.className='btn btn--ghost'; undoBtn.textContent='↩️ تراجع';
    redoBtn = document.createElement('button'); redoBtn.id='redoBtn'; redoBtn.className='btn btn--ghost'; redoBtn.textContent='↪️ إعادة';
    exportXlsxBtn?.after(redoBtn); exportXlsxBtn?.after(undoBtn);
  }else{ undoBtn=$('undoBtn'); redoBtn=$('redoBtn'); }
}

/* ---------- Child loading ---------- */
async function loadChild(uid){
  const ref=doc(db,'parents',uid,'children',childId);
  const snap=await getDoc(ref);
  if(!snap.exists()){ toast('لا يوجد طفل بهذا المعرف','error'); throw new Error('child-not-found'); }
  childRef=ref; childData=snap.data()||{};
  measCol=collection(childRef,'measurements');
}

function applyChildUI(){
  childNameEl.textContent = childData.displayName || childData.name || 'الطفل';
  childMetaEl.textContent = `تاريخ الميلاد: ${childData?.birthDate||'—'} • وحدة السكر: ${childData?.glucoseUnit||'mg/dL'}`;

  // therapy chips
  const unit = childData?.glucoseUnit || 'mg/dL';
  const cr = childData?.carbRatio ? `${childData.carbRatio} g/U` : '—';
  const cf = childData?.correctionFactor ? `${childData.correctionFactor} ${unit}/U` : '—';
  const bolus = childData?.bolusType || childData?.bolus || '—';
  chipsBar.innerHTML = `
    <span class="chip">CR: ${esc(cr)}</span>
    <span class="chip">CF: ${esc(cf)}</span>
    <span class="chip">Bolus: ${esc(bolus)}</span>
  `;

  // targets chips (both units)
  const u = (childData?.glucoseUnit || 'mg/dL');
  const max = getTargetUpper();         // بوحدة الطفل
  const min = getTargetLower();         // بوحدة الطفل إن توفّر
  const sev = getSevereUpper();
  const critL = getCriticalLow();
  const critH = getCriticalHigh();

  targetsChips.innerHTML = `
    ${Number.isFinite(min)? `<span class="chip">هبوط: <b class="tiny">${dualUnit(min,u)}</b></span>` : ''}
    <span class="chip">ارتفاع: <b class="tiny">${dualUnit(max,u)}</b></span>
    <span class="chip">ارتفاع شديد: <b class="tiny">${dualUnit(sev,u)}</b></span>
    ${Number.isFinite(critL)? `<span class="chip err">هبوط حرج: <b class="tiny">${dualUnit(critL,u)}</b></span>` : ''}
    ${Number.isFinite(critH)? `<span class="chip danger">ارتفاع حرج: <b class="tiny">${dualUnit(critH,u)}</b></span>` : ''}
  `;

  backToChildBtn.addEventListener('click',()=>location.href=`child.html?child=${encodeURIComponent(childId)}`);
}

/* ---------- Ranges / Units ---------- */
function getTargetUpper(){
  const u = (childData?.glucoseUnit || 'mg/dL').toLowerCase();
  let t = (childData?.normalRange && childData.normalRange.max!=null)
            ? Number(childData.normalRange.max)
            : (childData?.hyperLevel!=null ? Number(childData.hyperLevel) : NaN);
  if(!Number.isFinite(t)) t = u.includes('mmol') ? 7 : 130;
  return t;
}
function getTargetLower(){
  const u=(childData?.glucoseUnit||'mg/dL').toLowerCase();
  let t = (childData?.normalRange && childData.normalRange.min!=null) ? Number(childData.normalRange.min) : (childData?.hypoLevel!=null ? Number(childData.hypoLevel) : NaN);
  return Number.isFinite(t)? t : NaN;
}
function getSevereUpper(){
  const u = (childData?.glucoseUnit || 'mg/dL').toLowerCase();
  let t =
    (childData?.normalRange && childData.normalRange.severeHigh != null) ? Number(childData.normalRange.severeHigh) :
    (childData?.severeHighLevel != null ? Number(childData.severeHighLevel) :
    (childData?.veryHighLevel != null ? Number(childData.veryHighLevel) : NaN));
  if(!Number.isFinite(t)) {
    const upper = getTargetUpper();
    t = u.includes('mmol') ? (upper + 3) : (upper + 54);
  }
  return t;
}
function getCriticalLow(){
  const u=(childData?.glucoseUnit||'mg/dL').toLowerCase();
  let t =
    (childData?.normalRange && childData.normalRange.criticalLow != null) ? Number(childData.normalRange.criticalLow) :
    (childData?.criticalLowLevel != null ? Number(childData.criticalLowLevel) : NaN);
  if(!Number.isFinite(t)) return NaN;
  return t;
}
function getCriticalHigh(){
  const u=(childData?.glucoseUnit||'mg/dL').toLowerCase();
  let t =
    (childData?.normalRange && childData.normalRange.criticalHigh != null) ? Number(childData.normalRange.criticalHigh) :
    (childData?.criticalHighLevel != null ? Number(childData.criticalHighLevel) : NaN);
  if(!Number.isFinite(t)) return NaN;
  return t;
}
function dualUnit(val, unit){
  if(!Number.isFinite(val)) return '—';
  return unit.includes('mmol')
    ? `${round1(val)} mmol/L (${round1(mmol2mgdl(val))} mg/dL)`
    : `${round1(val)} mg/dL (${round1(mgdl2mmol(val))} mmol/L)`;
}

/* ---------- Derived view ---------- */
function updateDerived(){
  const unit = unitSel.value;
  const v = Number(readingInp.value);
  if(!Number.isFinite(v)){ convertedBox.textContent='—'; stateBadge.textContent='—'; stateBadge.className='badge'; corrDoseView.textContent='0'; return; }

  const childUnit = childData?.glucoseUnit || 'mg/dL';
  const valueInChildUnit = childUnit===unit ? v : (childUnit.includes('mmol') ? mgdl2mmol(v) : mmol2mgdl(v));

  // preview conversion
  const other = unit.includes('mmol') ? `${round1(mmol2mgdl(v))} mg/dL` : `${round1(mgdl2mmol(v))} mmol/L`;
  convertedBox.textContent = other;

  // state (priority: critical low -> severe high -> critical high -> high -> low -> normal)
  const min = getTargetLower();
  const upper = getTargetUpper();
  const severe = getSevereUpper();
  const critL = getCriticalLow();
  const critH = getCriticalHigh();

  let st='داخل النطاق', css='ok';
  if(Number.isFinite(critL) && valueInChildUnit <= critL){ st='هبوط حرج'; css='err'; }
  else if(Number.isFinite(critH) && valueInChildUnit >= critH){ st='ارتفاع حرج'; css='danger'; }
  else if(Number.isFinite(severe) && valueInChildUnit > severe){ st='ارتفاع شديد'; css='warn'; }
  else if(Number.isFinite(upper) && valueInChildUnit > upper){ st='ارتفاع'; css='warn'; }
  else if(Number.isFinite(min) && valueInChildUnit < min){ st='هبوط'; css='err'; }

  stateBadge.textContent = st; stateBadge.className=`badge ${css}`;

  // correction (always vs upper)
  const cf = Number(childData?.correctionFactor)||0;
  let corr=0;
  if(cf>0 && Number.isFinite(upper) && valueInChildUnit>upper) corr = (valueInChildUnit - upper) / cf;
  corrDoseView.textContent = String(round1(Math.max(0,corr)));
}

/* ---------- List / Query ---------- */
async function refreshList(){
  if(unsubscribe){ unsubscribe(); unsubscribe=null; }
  const qy = query(measCol, orderBy('when','desc'), limit(300));
  if(liveToggle.checked){
    unsubscribe = onSnapshot(qy, snap=>{ cache=[]; snap.forEach(s=>cache.push({id:s.id, ...s.data()})); renderList(); });
  }else{
    const snap = await getDocs(qy); cache=[]; snap.forEach(s=>cache.push({id:s.id,...s.data()})); renderList();
  }
}

function buildDayArray(){
  const targetDate = new Date((dayPicker.value||todayISO())+'T00:00:00');
  const unit = childData?.glucoseUnit || 'mg/dL';

  const arr = cache
    .map(x=>{
      const when = x.when?.toDate ? x.when.toDate() : (x.ts?.toDate ? x.ts.toDate() : null);
      if(!when) return null;
      if(!sameDay(when,targetDate)) return null;
      // pick value by child's unit
      let val = unit.includes('mmol') ? (x.value_mmol ?? x.value ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value)) 
                                      : (x.value_mgdl ?? x.value ?? (x.unit==='mmol/L'? mmol2mgdl(x.value) : x.value));
      val = Number(val);
      if(!Number.isFinite(val)) return null;
      const key = x.slotKey || 'OTHER';
      const state = x.state || inferState(val, unit);
      const notes = x.notes || null;
      const hypo = x.hypoTreatment || null;
      return {
        id:x.id, when, val, unit, key,
        slotOrder: x.slotOrder ?? slotOrder(key),
        state, corr: Number(x.correctionDose)||0,
        notes, hypo
      };
    })
    .filter(Boolean);

  return arr;
}

function applyFilters(arr){
  // auto filter by selected slot
  if(filterState.auto){
    const s = slotSel.value;
    if(/^PRE_/.test(s)) filterState.group='PRE';
    else if(/^POST_/.test(s)) filterState.group='POST';
    else if(/^FASTING$/.test(s)) filterState.group='FASTING';
    else if(/^SNACK$/.test(s)) filterState.group='SNACK';
    else if(/^EXERCISE$/.test(s)) filterState.group='EXERCISE';
    else if(/^BEDTIME$/.test(s)) filterState.group='BEDTIME';
    else filterState.group='ALL';
  }

  let out = arr.slice();

  if(filterState.group!=='ALL'){
    out = out.filter(r=>{
      switch(filterState.group){
        case 'PRE':      return /^PRE_/.test(r.key);
        case 'POST':     return /^POST_/.test(r.key);
        case 'FASTING':  return r.key==='FASTING';
        case 'SNACK':    return r.key==='SNACK';
        case 'EXERCISE': return r.key==='EXERCISE';
        case 'BEDTIME':  return r.key==='BEDTIME';
        default: return true;
      }
    });
  }

  if(filterState.state!=='ALL'){
    out = out.filter(r=>{
      if(filterState.state==='NORMAL') return r.state==='داخل النطاق';
      if(filterState.state==='LOW') return r.state==='هبوط' || r.state==='هبوط حرج';
      if(filterState.state==='HIGH') return r.state==='ارتفاع' || r.state==='ارتفاع شديد' || r.state==='ارتفاع حرج';
      return true;
    });
  }

  const q = (filterState.search||'').trim();
  if(q){
    const qq = q.toLowerCase();
    out = out.filter(r=>{
      const time = r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
      const label = (SLOT_LABEL[r.key]||r.key).toLowerCase();
      const st = (r.state||'').toLowerCase();
      const notes = (r.notes||'').toLowerCase();
      const hypo = (r.hypo||'').toLowerCase();
      return time.includes(qq) || label.includes(qq) || st.includes(qq) || notes.includes(qq) || hypo.includes(qq);
    });
  }

  // sorting
  const s = sortSel.value || 'time-asc';
  if(s==='value-desc') out.sort((a,b)=>b.val-a.val);
  else if(s==='value-asc') out.sort((a,b)=>a.val-b.val);
  else out.sort((a,b)=> (a.slotOrder-b.slotOrder) || (a.when-b.when));

  return out;
}

function renderList(){
  const unit = childData?.glucoseUnit || 'mg/dL';
  const all = buildDayArray();
  const arr = applyFilters(all);

  // stats (للنتائج المعروضة)
  renderStats(arr, unit);
  renderSparkline(arr);

  // table
  gridEl.innerHTML='';
  if(!arr.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  for(const r of arr){
    const row = document.createElement('div'); row.className='row';
    row.innerHTML = `
      <div class="cell"><span class="mono">${r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</span></div>
      <div class="cell">${SLOT_LABEL[r.key]||r.key}<span class="muted tiny" style="margin-inline-start:6px">#${r.slotOrder}</span></div>
      <div class="cell"><span class="mono">${round1(r.val)} ${unit}</span></div>
      <div class="cell">${statePill(r.state)}</div>
      <div class="cell">
        ${r.corr? `<span class="badge info">U ${round1(r.corr)}</span>`:''}
        ${r.hypo? `<span class="chip">رفع: ${esc(r.hypo)}</span>`:''}
        ${r.notes? `<span class="muted" style="margin-inline-start:6px">${esc(r.notes)}</span>`:''}
      </div>
    `;
    gridEl.appendChild(row);
  }
}

function statePill(st){
  let badge = 'ok', dot = 'state-norm';
  if(st === 'هبوط'){ badge='err'; dot='state-low'; }
  else if(st === 'ارتفاع'){ badge='warn'; dot='state-high'; }
  else if(st === 'ارتفاع شديد'){ badge='warn'; dot='state-vhigh'; }
  else if(st === 'هبوط حرج'){ badge='err'; dot='state-critlow'; }
  else if(st === 'ارتفاع حرج'){ badge='danger'; dot='state-crithigh'; }
  return `<span class="state-dot ${dot}"></span><span class="badge ${badge}" style="margin-inline-start:6px">${st}</span>`;
}

/* ---------- Stats & Sparkline ---------- */
function renderStats(arr, unit){
  const elTIR = $('statTIR'), elAvg=$('statAvg'), elSD=$('statSD'), elLow=$('statLow'), elHigh=$('statHigh'), elCrit=$('statCrit');
  if(!arr.length){ elTIR.textContent=elAvg.textContent=elSD.textContent=elLow.textContent=elHigh.textContent=elCrit.textContent='—'; return; }

  const n = arr.length;
  const inRange = arr.filter(r=>r.state==='داخل النطاق').length;
  const lows = arr.filter(r=>r.state==='هبوط').length;
  const highs = arr.filter(r=>r.state==='ارتفاع' || r.state==='ارتفاع شديد').length;
  const critical = arr.filter(r=>r.state==='هبوط حرج' || r.state==='ارتفاع حرج').length;
  const mean = arr.reduce((a,r)=>a+r.val,0)/n;
  const sd = Math.sqrt(arr.reduce((a,r)=>a+Math.pow(r.val-mean,2),0)/n);

  elTIR.textContent = `${Math.round((inRange/n)*100)}%`;
  elAvg.textContent = `${round1(mean)} ${unit}`;
  elSD.textContent  = `${round1(sd)}`;
  elLow.textContent = String(lows);
  elHigh.textContent= String(highs);
  elCrit.textContent= String(critical);
}

function renderSparkline(arr){
  if(!sparklineBox) return;
  sparklineBox.innerHTML='';
  if(arr.length<2){ sparklineBox.textContent=''; return; }
  const w=260,h=48,pad=4;
  const minV=Math.min(...arr.map(r=>r.val));
  const maxV=Math.max(...arr.map(r=>r.val));
  const xs=arr.map((_,i)=> pad + (i*(w-2*pad)/(arr.length-1)) );
  const ys=arr.map(r=>{
    const t = (r.val-minV)/(maxV-minV || 1);
    return h - pad - t*(h-2*pad);
  });
  let d = `M ${xs[0]} ${ys[0]}`;
  for(let i=1;i<xs.length;i++){ d+=` L ${xs[i]} ${ys[i]}`; }
  sparklineBox.innerHTML = `
    <svg width="${w}" height="${h}">
      <path d="${d}" fill="none" stroke="#2563eb" stroke-width="2"/>
    </svg>
  `;
}

/* ---------- Save + Undo/Redo ---------- */
async function saveMeasurement(){
  const unit = unitSel.value;
  const v = Number(readingInp.value);
  if(!Number.isFinite(v)){ toast('أدخل قراءة صحيحة','error'); return; }

  const dateStr = dayPicker.value || todayISO();
  const when = new Date(`${dateStr}T${new Date().toTimeString().slice(0,8)}`);

  // value in both units
  const value_mmol = unit==='mmol/L' ? v : mgdl2mmol(v);
  const value_mgdl = unit==='mg/dL' ? v : mmol2mgdl(v);

  // derive vs child's unit
  const childUnit = childData?.glucoseUnit || 'mg/dL';
  const valInChild = childUnit===unit ? v : (childUnit.includes('mmol') ? mgdl2mmol(v) : mmol2mgdl(v));
  const upper = getTargetUpper();
  const cf = Number(childData?.correctionFactor)||0;
  let correctionDose = 0;
  if(cf>0 && Number.isFinite(upper) && valInChild>upper) correctionDose = (valInChild - upper)/cf;

  // optional extra fields (لو حقنتها في واجهة تانية)
  const notes = ($('mNotes')?.value||'').trim() || null;
  const hypoTreatment = ($('hypoTreatment')?.value||'').trim() || null;

  const payload = {
    value: v, unit,
    value_mmol: round1(value_mmol),
    value_mgdl: round1(value_mgdl),
    when, slotKey: slotSel.value, slotOrder: slotOrder(slotSel.value),
    state: inferState(valInChild, childUnit),
    correctionDose: round1(Math.max(0,correctionDose)),
    hypoTreatment: hypoTreatment || null,
    notes,
    createdAt: serverTimestamp()
  };

  const ref = await addDoc(measCol, payload);
  lastOps.push({ id: ref.id, data: payload });
  redoStack = [];
  toast('تم حفظ القياس ✔️');
  readingInp.value=''; updateDerived(); // reset preview
}

async function undoLast(){
  const op = lastOps.pop();
  if(!op){ toast('لا توجد عملية للتراجع','info'); return; }
  await deleteDoc(doc(measCol, op.id));
  redoStack.push(op);
  toast('تم التراجع عن آخر قياس');
}
async function redoLast(){
  const op = redoStack.pop();
  if(!op){ toast('لا توجد عملية لإعادة التراجع','info'); return; }
  const ref = await addDoc(measCol, op.data);
  lastOps.push({ id: ref.id, data: op.data });
  toast('تمت الإعادة');
}

/* ---------- Export ---------- */
function qaListForDay(visibleOnly=true){
  const unit = childData?.glucoseUnit || 'mg/dL';
  const base = buildDayArray();
  const arr = visibleOnly ? applyFilters(base) : base.slice();
  return arr.map(r=>({
    when:r.when, key:r.key, val:r.val, unit,
    state:r.state, corr:r.corr||0, notes:r.notes||'', hypo:r.hypo||''
  }));
}
function exportCSV(){
  const unit = childData?.glucoseUnit || 'mg/dL';
  const rows = [['Time','Slot','Value','State','Correction(U)','Hypo Tx','Notes']];
  qaListForDay(true).forEach(r=>{
    rows.push([
      r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}),
      SLOT_LABEL[r.key]||r.key, `${round1(r.val)} ${unit}`,
      r.state, r.corr||0, `"${r.hypo.replace(/"/g,'""')}"`, `"${r.notes.replace(/"/g,'""')}"`
    ]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`measurements-${dayPicker.value||todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
async function ensureXLSX(){
  if(window.XLSX) return window.XLSX;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=res; s.onerror=()=>rej(new Error('XLSX load failed'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}
async function exportXLSX(){
  const XLSX = await ensureXLSX();
  const unit = childData?.glucoseUnit || 'mg/dL';

  const header = ['Time','Slot','Value','State','Correction(U)','Hypo Tx','Notes'];
  const rows = qaListForDay(true).map(r=>[
    r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}),
    SLOT_LABEL[r.key]||r.key, `${round1(r.val)} ${unit}`, r.state, r.corr||0, r.hypo, r.notes
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{wch:12},{wch:18},{wch:18},{wch:14},{wch:14},{wch:20},{wch:40}];

  const max = getTargetUpper(); const min=getTargetLower();
  const sev = getSevereUpper(); const cl=getCriticalLow(); const ch=getCriticalHigh();
  const meta = [
    ['Child', childData?.displayName||childData?.name||'—'],
    ['Date', dayPicker.value||todayISO()],
    ['Unit', unit],
    ['Lower (هبوط)', dualUnit(min,unit)],
    ['Upper (ارتفاع)', dualUnit(max,unit)],
    ['Severe High (شديد)', dualUnit(sev,unit)],
    ['Critical Low (حرج)', dualUnit(cl,unit)],
    ['Critical High (حرج)', dualUnit(ch,unit)],
    ['CR (g/U)', Number(childData?.carbRatio)||'—'],
    [`CF (${unit}/U)`, Number(childData?.correctionFactor)||'—']
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(meta);
  ws2['!cols']=[{wch:26},{wch:40}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Measurements (filtered)');
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  XLSX.writeFile(wb, `measurements-${dayPicker.value||todayISO()}.xlsx`);
}

/* ---------- Events ---------- */
function wireEvents(){
  unitSel.addEventListener('change', updateDerived);
  readingInp.addEventListener('input', updateDerived);
  dayPicker.addEventListener('change', refreshList);
  slotSel.addEventListener('change', ()=>{ if(filterState.auto) renderList(); updateDerived(); });
  sortSel.addEventListener('change', renderList);
  liveToggle.addEventListener('change', refreshList);

  saveBtn.addEventListener('click', saveMeasurement);
  exportCsvBtn.addEventListener('click', exportCSV);
  exportXlsxBtn.addEventListener('click', exportXLSX);
  toMealsBtn.addEventListener('click', ()=>{
    const type = slotToMealType(slotSel.value);
    location.href = `meals.html?child=${encodeURIComponent(childId)}${type?`&type=${encodeURIComponent(type)}`:''}&date=${encodeURIComponent(dayPicker.value||todayISO())}`;
  });

  // Filters chips
  filtersBar.querySelectorAll('[data-g]').forEach(b=>{
    b.addEventListener('click',()=>{ filterState.group=b.dataset.g; renderList(); });
  });
  filtersBar.querySelectorAll('[data-s]').forEach(b=>{
    b.addEventListener('click',()=>{ filterState.state=b.dataset.s; renderList(); });
  });
  $('clearFilters').addEventListener('click',()=>{ filterState={...filterState, group:'ALL', state:'ALL', search:''}; searchBox.value=''; renderList(); });
  autoSlotToggle.addEventListener('change',()=>{ filterState.auto = !!autoSlotToggle.checked; renderList(); });

  // Search
  searchBox.addEventListener('input',()=>{ filterState.search=searchBox.value; renderList(); });

  // Undo/Redo
  $('undoBtn').addEventListener('click', undoLast);
  $('redoBtn').addEventListener('click', redoLast);

  // Shortcuts
  window.addEventListener('keydown', (e)=>{
    const k = e.key.toLowerCase();
    if(k==='s'){ e.preventDefault(); saveMeasurement(); }
    else if(k==='l'){ e.preventDefault(); liveToggle.checked=!liveToggle.checked; refreshList(); }
    else if(k==='e'){ e.preventDefault(); exportXLSX(); }
    else if(k==='c'){ e.preventDefault(); exportCSV(); }
    else if(k==='m'){ e.preventDefault(); const type = slotToMealType(slotSel.value); location.href = `meals.html?child=${encodeURIComponent(childId)}${type?`&type=${encodeURIComponent(type)}`:''}&date=${encodeURIComponent(dayPicker.value||todayISO())}`; }
    else if(k==='f'){ e.preventDefault(); searchBox.focus(); }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); if(e.shiftKey) redoLast(); else undoLast(); }
  });
}

function slotToMealType(slot){
  if(/^PRE_BREAKFAST|POST_BREAKFAST|FASTING$/.test(slot)) return 'فطار';
  if(/^PRE_LUNCH|POST_LUNCH$/.test(slot)) return 'غدا';
  if(/^PRE_DINNER|POST_DINNER$/.test(slot)) return 'عشا';
  if(/^SNACK$/.test(slot)) return 'سناك';
  return '';
}

function inferState(v, unit){
  const min = getTargetLower(), upper=getTargetUpper(), severe=getSevereUpper(), cl=getCriticalLow(), ch=getCriticalHigh();
  if(Number.isFinite(cl) && v<=cl) return 'هبوط حرج';
  if(Number.isFinite(ch) && v>=ch) return 'ارتفاع حرج';
  if(Number.isFinite(severe) && v>severe) return 'ارتفاع شديد';
  if(Number.isFinite(upper) && v>upper) return 'ارتفاع';
  if(Number.isFinite(min) && v<min) return 'هبوط';
  return 'داخل النطاق';
}
