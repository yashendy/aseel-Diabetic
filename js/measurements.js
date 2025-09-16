// measurements.js — موحّد مع صفحة الوجبات، دون تعديل القواعد/المسارات
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc,
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
function toast(msg,type='info'){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200); }

/* ---------- Slots ordering (زمني حقيقي) ---------- */
const SLOT_ORDER = {
  FASTING:10, PRE_BREAKFAST:20, POST_BREAKFAST:25,
  PRE_LUNCH:30, POST_LUNCH:35,
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
function slotOrder(key){ return SLOT_ORDER[key] ?? 200; }

/* ---------- DOM ---------- */
const params = new URLSearchParams(location.search);
const childId = (params.get('child')||'').trim();

let dayPicker, slotSel, readingInp, unitSel, convertedBox, stateBadge, corrDoseView;
let childNameEl, childMetaEl, chipsBar, targetsChips, backToChildBtn;
let gridEl, emptyEl, sortSel, liveToggle, toMealsBtn, saveBtn, exportCsvBtn, exportXlsxBtn;

let currentUser=null, childRef=null, childData=null;
let measCol=null;
let unsubscribe=null; // onSnapshot
let cache=[];

/* ---------- Boot ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  currentUser=user;
  wireDom();
  await loadChild(user.uid);
  applyChildUI();
  dayPicker.value = dayPicker.value || todayISO();
  unitSel.value = (childData?.glucoseUnit || 'mg/dL');
  await refreshList();
  wireEvents();
});

function wireDom(){
  dayPicker = $('dayPicker'); slotSel=$('slotKey'); readingInp=$('reading'); unitSel=$('unitSel');
  convertedBox=$('converted'); stateBadge=$('stateBadge'); corrDoseView=$('corrDoseView');
  childNameEl=$('childName'); childMetaEl=$('childMeta'); chipsBar=$('therapyChips'); targetsChips=$('targetsChips');
  gridEl=$('grid'); emptyEl=$('empty'); sortSel=$('sortSel'); liveToggle=$('liveToggle');
  toMealsBtn=$('toMeals'); saveBtn=$('saveBtn'); exportCsvBtn=$('exportCsvBtn'); exportXlsxBtn=$('exportXlsxBtn');
  backToChildBtn=$('backToChild');
}

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
  const maxDual = dualUnit(max,u);
  const minDual = Number.isFinite(min) ? dualUnit(min,u) : null;

  targetsChips.innerHTML = `
    ${minDual? `<span class="chip">الطبيعي (أدنى): <b class="tiny">${minDual}</b></span>` : ''}
    <span class="chip">الطبيعي (أعلى): <b class="tiny">${maxDual}</b></span>
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
  // نحتاج حساب الحالة والتصحيحي بوحدة الطفل
  const valueInChildUnit = childUnit===unit ? v : (childUnit.includes('mmol') ? mgdl2mmol(v) : mmol2mgdl(v));

  // conversion preview (عكسي)
  const other = unit.includes('mmol') ? `${round1(mmol2mgdl(v))} mg/dL` : `${round1(mgdl2mmol(v))} mmol/L`;
  convertedBox.textContent = other;

  // state
  const min = getTargetLower(); const max = getTargetUpper();
  let st='داخل النطاق', css='ok';
  if(Number.isFinite(min) && valueInChildUnit < min){ st='هبوط'; css='err'; }
  else if(Number.isFinite(max) && valueInChildUnit > max){ st='ارتفاع'; css='warn'; }
  stateBadge.textContent = st; stateBadge.className=`badge ${css}`;

  // correction (upper target فقط)
  const cf = Number(childData?.correctionFactor)||0;
  let corr=0;
  if(cf>0 && Number.isFinite(max) && valueInChildUnit>max) corr = (valueInChildUnit - max) / cf;
  corrDoseView.textContent = String(round1(Math.max(0,corr)));
}

/* ---------- List / Query ---------- */
async function refreshList(){
  // live toggle (onSnapshot) أو getDocs
  if(unsubscribe){ unsubscribe(); unsubscribe=null; }
  const qy = query(measCol, orderBy('when','desc'), limit(300));
  if(liveToggle.checked){
    unsubscribe = onSnapshot(qy, snap=>{ cache=[]; snap.forEach(s=>cache.push({id:s.id, ...s.data()})); renderList(); });
  }else{
    const snap = await getDocs(qy); cache=[]; snap.forEach(s=>cache.push({id:s.id,...s.data()})); renderList();
  }
}

function renderList(){
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
      return {
        id:x.id, when, val, unit, key,
        slotOrder: x.slotOrder ?? slotOrder(key),
        state: x.state || inferState(val, unit),
        corr: Number(x.correctionDose)||0,
        notes: x.notes||null
      };
    })
    .filter(Boolean);

  // sort
  const s = sortSel.value || 'time-asc';
  if(s==='value-desc') arr.sort((a,b)=>b.val-a.val);
  else if(s==='value-asc') arr.sort((a,b)=>a.val-b.val);
  else arr.sort((a,b)=> (a.slotOrder-b.slotOrder) || (a.when-b.when));

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
      <div class="cell">${r.corr? `<span class="badge info">${round1(r.corr)} U</span>`:'—'} ${r.notes?`<span class="muted" style="margin-inline-start:6px">${esc(r.notes)}</span>`:''}</div>
    `;
    gridEl.appendChild(row);
  }
}
function statePill(st){
  const dot = st==='هبوط' ? 'state-low' : st==='ارتفاع' ? 'state-high' : 'state-norm';
  const badge = st==='هبوط' ? 'err' : st==='ارتفاع' ? 'warn' : 'ok';
  return `<span class="state-dot ${dot}"></span><span class="badge ${badge}" style="margin-inline-start:6px">${st}</span>`;
}
function inferState(v, unit){
  const min = getTargetLower(), max=getTargetUpper();
  if(Number.isFinite(min) && v<min) return 'هبوط';
  if(Number.isFinite(max) && v>max) return 'ارتفاع';
  return 'داخل النطاق';
}

/* ---------- Save ---------- */
async function saveMeasurement(){
  const unit = unitSel.value;
  const v = Number(readingInp.value);
  if(!Number.isFinite(v)){ toast('أدخل قراءة صحيحة','error'); return; }

  const dateStr = dayPicker.value || todayISO();
  const when = new Date(`${dateStr}T${new Date().toTimeString().slice(0,8)}`);

  // value in both units
  const value_mmol = unit==='mmol/L' ? v : mgdl2mmol(v);
  const value_mgdl = unit==='mg/dL' ? v : mmol2mgdl(v);

  // correction (upper target) — بوحدة الطفل
  const childUnit = childData?.glucoseUnit || 'mg/dL';
  const valInChild = childUnit===unit ? v : (childUnit.includes('mmol') ? mgdl2mmol(v) : mmol2mgdl(v));
  const max = getTargetUpper();
  const cf = Number(childData?.correctionFactor)||0;
  let correctionDose = 0;
  if(cf>0 && Number.isFinite(max) && valInChild>max) correctionDose = (valInChild - max)/cf;

  const payload = {
    value: v, unit,
    value_mmol: round1(value_mmol),
    value_mgdl: round1(value_mgdl),
    when, slotKey: slotSel.value, slotOrder: slotOrder(slotSel.value),
    state: inferState(valInChild, childUnit),
    correctionDose: round1(Math.max(0,correctionDose)),
    createdAt: serverTimestamp()
  };

  await addDoc(measCol, payload);
  toast('تم حفظ القياس ✔️');
  readingInp.value=''; updateDerived();
}

/* ---------- Export ---------- */
function exportCSV(){
  const unit = childData?.glucoseUnit || 'mg/dL';
  const rows = [['Time','Slot','Value','State','Correction(U)']];
  qaListForDay().forEach(r=>{
    rows.push([
      r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}),
      SLOT_LABEL[r.key]||r.key,
      `${round1(r.val)} ${unit}`, r.state, r.corr||0
    ]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`measurements-${dayPicker.value||todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
function qaListForDay(){
  const targetDate = new Date((dayPicker.value||todayISO())+'T00:00:00');
  const unit = childData?.glucoseUnit || 'mg/dL';
  return cache.map(x=>{
    const when = x.when?.toDate ? x.when.toDate() : (x.ts?.toDate ? x.ts.toDate() : null);
    if(!when || !sameDay(when,targetDate)) return null;
    let val = unit.includes('mmol') ? (x.value_mmol ?? x.value ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value)) 
                                    : (x.value_mgdl ?? x.value ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
    val = Number(val);
    if(!Number.isFinite(val)) return null;
    const key = x.slotKey || 'OTHER';
    return {
      when, key, val, unit, state: x.state || inferState(val,unit),
      corr: Number(x.correctionDose)||0
    };
  }).filter(Boolean).sort((a,b)=> (slotOrder(a.key)-slotOrder(b.key)) || (a.when-b.when));
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

  const header = ['Time','Slot','Value','State','Correction(U)'];
  const rows = qaListForDay().map(r=>[
    r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}),
    SLOT_LABEL[r.key]||r.key, `${round1(r.val)} ${unit}`, r.state, r.corr||0
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{wch:12},{wch:18},{wch:18},{wch:14},{wch:14}];

  const max = getTargetUpper(); const min=getTargetLower();
  const meta = [
    ['Child', childData?.displayName||childData?.name||'—'],
    ['Date', dayPicker.value||todayISO()],
    ['Unit', unit],
    ['Upper Target', dualUnit(max,unit)],
    ['Lower Target', Number.isFinite(min)? dualUnit(min,unit) : '—'],
    ['CR (g/U)', Number(childData?.carbRatio)||'—'],
    [`CF (${unit}/U)`, Number(childData?.correctionFactor)||'—']
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(meta);
  ws2['!cols']=[{wch:20},{wch:40}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Measurements');
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  XLSX.writeFile(wb, `measurements-${dayPicker.value||todayISO()}.xlsx`);
}

/* ---------- Events ---------- */
function wireEvents(){
  unitSel.addEventListener('change', updateDerived);
  readingInp.addEventListener('input', updateDerived);
  dayPicker.addEventListener('change', refreshList);
  slotSel.addEventListener('change', updateDerived);
  sortSel.addEventListener('change', renderList);
  liveToggle.addEventListener('change', refreshList);

  saveBtn.addEventListener('click', saveMeasurement);
  exportCsvBtn.addEventListener('click', exportCSV);
  exportXlsxBtn.addEventListener('click', exportXLSX);

  toMealsBtn.addEventListener('click', ()=>{
    // فتح صفحة الوجبات لنفس اليوم ونوع الوجبة (مع الحفاظ على المسار)
    const type = slotToMealType(slotSel.value);
    location.href = `meals.html?child=${encodeURIComponent(childId)}${type?`&type=${encodeURIComponent(type)}`:''}&date=${encodeURIComponent(dayPicker.value||todayISO())}`;
  });
}
function slotToMealType(slot){
  if(/^PRE_BREAKFAST|POST_BREAKFAST|FASTING$/.test(slot)) return 'فطار';
  if(/^PRE_LUNCH|POST_LUNCH$/.test(slot)) return 'غدا';
  if(/^PRE_DINNER|POST_DINNER$/.test(slot)) return 'عشا';
  if(/^SNACK$/.test(slot)) return 'سناك';
  return '';
}
