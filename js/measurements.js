// measurements.js — نسخة نهائية مُراجَعة وفق المطلوب
// (فلترة/بحث/إحصائيات/Sparkline/Undo-Redo/Export + Panels ديناميكية + توحيد الحالة للعربية)
// تحديثات هذه النسخة:
// - منع قراءة = 0
// - خانة "رفعنا بإيه؟" للهبوط
// - خانة "جرعة التصحيح" تُملأ تلقائياً عند الارتفاع + قابلة للتعديل فوراً
// - منع تكرار Slots يوميًّا باستثناء: OTHER (أخرى) و EXERCISE (رياضة)
// - تنبيه واضح عند محاولة إدخال Slot مكرر
// - الحفاظ على ثيم فاتح وألوان غير داكنة

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
function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200); }

/* ---------- Normalize state to Arabic ---------- */
function normalizeState(s){
  if(!s) return s;
  const t = String(s).trim().toLowerCase();
  if (t==='normal' || t==='in range' || t==='in-range' || t==='range' || s==='داخل النطاق' || s==='طبيعي') return 'داخل النطاق';
  if (t==='low' || t==='hypo' || s==='هبوط') return 'هبوط';
  if (t==='high' || t==='hyper' || s==='ارتفاع') return 'ارتفاع';
  if (t==='severe high' || t==='very high' || s==='ارتفاع شديد') return 'ارتفاع شديد';
  if (t==='critical low' || t==='severe low' || s==='هبوط حرج') return 'هبوط حرج';
  if (t==='critical high' || s==='ارتفاع حرج') return 'ارتفاع حرج';
  return s;
}

/* ---------- Slots ---------- */
const SLOT_ORDER = {
  FASTING:10, PRE_BREAKFAST:20, POST_BREAKFAST:25,
  PRE_LUNCH:30,  POST_LUNCH:35,
  PRE_DINNER:40, POST_DINNER:45,
  SNACK:50, EXERCISE:60, BEDTIME:90, DURING_SLEEP:100, OTHER:200
};
const SLOT_LABEL = {
  FASTING:'صائم', PRE_BREAKFAST:'قبل الفطار', POST_BREAKFAST:'بعد الفطار',
  PRE_LUNCH:'قبل الغداء', POST_LUNCH:'بعد الغداء',
  PRE_DINNER:'قبل العشاء', POST_DINNER:'بعد العشاء',
  SNACK:'سناك', EXERCISE:'رياضة', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم', OTHER:'أخرى'
};
const slotOrder = key => SLOT_ORDER[key] ?? 200;

/* Slots المسموح تكرارها في نفس اليوم */
const DUP_ALLOWED = new Set(['EXERCISE','OTHER']);

/* ---------- DOM ---------- */
const params = new URLSearchParams(location.search);
const childId = (params.get('child')||'').trim();

let dayPicker, slotSel, readingInp, unitSel, convertedBox, stateBadge, corrDoseView;
let childNameEl, childMetaEl, chipsBar, targetsChips, backToChildBtn;
let gridEl, emptyEl, sortSel, liveToggle, toMealsBtn, saveBtn, exportCsvBtn, exportXlsxBtn;
let filtersBar, searchBox, statsBar, sparklineBox, undoBtn, redoBtn, autoSlotToggle;
let actionsPanel, alertBarEl, corrRow, corrDoseInput, hypoRow, hypoInput, notesRow, notesInput;
let lastComputedCorr = 0;
let corrDirty = false; // المستخدم عدّل الجرعة يدويًا؟

let currentUser=null, childRef=null, childData=null, measCol=null, unsubscribe=null;
let cache=[];    // كل قياسات اليوم (بعد الجلب)
let filterState = { group:'ALL', state:'ALL', search:'', auto:false };
let lastOps = [], redoStack = [];

/* ---------- Boot ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  currentUser=user;
  wireDom(); injectUI(); ensureActionPanel();
  await loadChild(user.uid); applyChildUI();
  dayPicker.value = dayPicker.value || todayISO();
  unitSel.value = (childData?.glucoseUnit || 'mg/dL');
  await refreshList(); wireEvents(); updateDerived(); updateSlotDuplicateHint();
});

/* ---------- Wire base DOM ---------- */
function wireDom(){
  dayPicker=$('dayPicker'); slotSel=$('slotKey'); readingInp=$('reading'); unitSel=$('unitSel');
  convertedBox=$('converted'); stateBadge=$('stateBadge'); corrDoseView=$('corrDoseView');
  childNameEl=$('childName'); childMetaEl=$('childMeta'); chipsBar=$('therapyChips'); targetsChips=$('targetsChips');
  gridEl=$('grid'); emptyEl=$('empty'); sortSel=$('sortSel'); liveToggle=$('liveToggle');
  toMealsBtn=$('toMeals'); saveBtn=$('saveBtn'); exportCsvBtn=$('exportCsvBtn'); exportXlsxBtn=$('exportXlsxBtn');
  backToChildBtn=$('backToChild');
}

/* ---------- Inject UI (filters + stats + undo/redo) ---------- */
function injectUI(){
  if(!$('filtersBar')){
    const head=document.createElement('div');
    head.id='filtersBar'; head.className='filters';
    head.innerHTML=`
      <div class="chips">
        <button class="chip" data-g="ALL">الكل</button>
        <button class="chip" data-g="PRE">قبل</button>
        <button class="chip" data-g="POST">بعد</button>
        <button class="chip" data-g="FASTING">صائم</button>
        <button class="chip" data-g="SNACK">سناك</button>
        <button class="chip" data-g="EXERCISE">رياضة</button>
        <button class="chip" data-g="BEDTIME">قبل النوم</button>
        <span class="sep"></span>
        <button class="chip" data-s="NORMAL">داخل النطاق</button>
        <button class="chip" data-s="LOW">انخفاض</button>
        <button class="chip" data-s="HIGH">ارتفاع</button>
        <span class="sep"></span>
        <button class="chip warn" id="clearFilters">مسح الفلاتر</button>
        <label class="chip"><input type="checkbox" id="autoSlotToggle" style="margin-inline-end:6px"> Auto</label>
      </div>
      <div class="search"><input id="searchBox" type="search" placeholder="بحث في القياسات (الوقت/النوع/الحالة/ملاحظات) — اضغط F للتركيز"></div>
    `;
    const tbl=document.querySelector('.table-wrap'); tbl?.parentElement?.insertBefore(head,tbl);
  }
  filtersBar=$('filtersBar'); searchBox=$('searchBox'); autoSlotToggle=$('autoSlotToggle');

  if(!$('statsBar')){
    const s=document.createElement('div'); s.id='statsBar'; s.className='stats';
    s.innerHTML=`
      <div class="stats-cards">
        <div class="card"><span class="k">داخل النطاق</span><b id="statTIR">—</b></div>
        <div class="card"><span class="k">المتوسط</span><b id="statAvg">—</b></div>
        <div class="card"><span class="k">الانحراف (SD)</span><b id="statSD">—</b></div>
        <div class="card low"><span class="k">انخفاضات</span><b id="statLow">—</b></div>
        <div class="card high"><span class="k">ارتفاعات</span><b id="statHigh">—</b></div>
        <div class="card crit"><span class="k">حالات حرجة</span><b id="statCrit">—</b></div>
      </div>
      <div id="sparklineBox" class="sparkline"></div>
    `;
    const tbl=document.querySelector('.table-wrap'); tbl?.parentElement?.insertBefore(s,tbl);
  }
  statsBar=$('statsBar'); sparklineBox=$('sparklineBox');

  if(!$('undoBtn')){
    undoBtn=document.createElement('button'); undoBtn.id='undoBtn'; undoBtn.className='btn btn--ghost'; undoBtn.textContent='↩️ تراجع';
    redoBtn=document.createElement('button'); redoBtn.id='redoBtn'; redoBtn.className='btn btn--ghost'; redoBtn.textContent='↪️ إعادة';
    exportXlsxBtn?.after(redoBtn); exportXlsxBtn?.after(undoBtn);
  }else{ undoBtn=$('undoBtn'); redoBtn=$('redoBtn'); }
}

/* ---------- Panels: alert + correction + hypo + notes ---------- */
function ensureActionPanel(){
  if(actionsPanel) return;
  const toolbar=document.querySelector('.toolbar');
  actionsPanel=document.createElement('div'); actionsPanel.id='actionsPanel';
  actionsPanel.innerHTML=`
    <div id="alertBar" class="alert" style="display:none;"></div>

    <div id="corrRow" class="row-actions" style="display:none;">
      <label class="field"><span>جرعة التصحيح (U)</span><input id="corrDoseInput" type="number" step="0.5" min="0" placeholder="مثال: 1.5"></label>
      <div class="slot-hint" id="slotDupHint" style="display:none;">⚠️ هذا النوع مُسجّل اليوم — لن يُسمح بتكراره.</div>
    </div>

    <div id="hypoRow" class="row-actions" style="display:none;">
      <label class="field" style="grid-column:1/-1;"><span>رفعنا بإيه؟</span><input id="hypoTreatment" type="text" placeholder="مثال: جلوكوز 15جم / عصير 100مل / تمر"></label>
      <div class="chips">
        <button class="chip chip-suggest" data-val="جلوكوز 15جم">جلوكوز 15جم</button>
        <button class="chip chip-suggest" data-val="عصير 100مل">عصير 100مل</button>
        <button class="chip chip-suggest" data-val="٣ تمرات">٣ تمرات</button>
      </div>
    </div>

    <div id="notesRow" class="row-actions"><label class="field" style="grid-column:1/-1;"><span>ملاحظات</span><textarea id="mNotes" rows="2" placeholder="اكتب أي ملاحظات مهمة..."></textarea></label></div>
  `;
  toolbar.after(actionsPanel);

  alertBarEl=$('alertBar'); corrRow=$('corrRow'); corrDoseInput=$('corrDoseInput');
  hypoRow=$('hypoRow'); hypoInput=$('hypoTreatment'); notesRow=$('notesRow'); notesInput=$('mNotes');

  actionsPanel.querySelectorAll('.chip-suggest').forEach(btn=>btn.addEventListener('click',()=>{ hypoInput.value=btn.dataset.val; }));
  corrDoseInput.addEventListener('input',()=>{ corrDirty=true; });
}
const show = el => { if(el) el.style.display=''; };
const hide = el => { if(el) el.style.display='none'; };
function setAlert(type, text){
  if(!alertBarEl) return;
  if(!text){ hide(alertBarEl); alertBarEl.textContent=''; alertBarEl.className='alert'; return; }
  alertBarEl.textContent=text; alertBarEl.className=`alert ${type}`; show(alertBarEl);
}

/* ---------- Child ---------- */
async function loadChild(uid){
  const ref=doc(db,'parents',uid,'children',childId);
  const snap=await getDoc(ref);
  if(!snap.exists()){ toast('لا يوجد طفل بهذا المعرف'); throw new Error('child-not-found'); }
  childRef=ref; childData=snap.data()||{}; measCol=collection(childRef,'measurements');
}
function applyChildUI(){
  childNameEl.textContent=childData.displayName||childData.name||'الطفل';
  childMetaEl.textContent=`تاريخ الميلاد: ${childData?.birthDate||'—'} • وحدة السكر: ${childData?.glucoseUnit||'mg/dL'}`;

  const unit=childData?.glucoseUnit||'mg/dL';
  const cr = childData?.carbRatio ? `${childData.carbRatio} g/U` : '—';
  const cf = childData?.correctionFactor ? `${childData.correctionFactor} ${unit}/U` : '—';
  const bolus = childData?.bolusType || childData?.bolus || '—';
  chipsBar.innerHTML=`<span class="chip">CR: ${esc(cr)}</span><span class="chip">CF: ${esc(cf)}</span><span class="chip">Bolus: ${esc(bolus)}</span>`;

  const u=(childData?.glucoseUnit||'mg/dL'); const max=getTargetUpper(); const min=getTargetLower();
  const sev=getSevereUpper(); const cl=getCriticalLow(); const ch=getCriticalHigh();
  targetsChips.innerHTML = `
    ${Number.isFinite(min)? `<span class="chip">هبوط: <b class="tiny">${dualUnit(min,u)}</b></span>` : ''}
    <span class="chip">ارتفاع: <b class="tiny">${dualUnit(max,u)}</b></span>
    <span class="chip">ارتفاع شديد: <b class="tiny">${dualUnit(sev,u)}</b></span>
    ${Number.isFinite(cl)? `<span class="chip err">هبوط حرج: <b class="tiny">${dualUnit(cl,u)}</b></span>` : ''}
    ${Number.isFinite(ch)? `<span class="chip danger">ارتفاع حرج: <b class="tiny">${dualUnit(ch,u)}</b></span>` : ''}
  `;
  backToChildBtn.addEventListener('click',()=>location.href=`child.html?child=${encodeURIComponent(childId)}`);
}

/* ---------- Ranges / Units ---------- */
function getTargetUpper(){ const u=(childData?.glucoseUnit||'mg/dL').toLowerCase();
  let t=(childData?.normalRange?.max??childData?.hyperLevel); t=Number(t);
  if(!Number.isFinite(t)) t=u.includes('mmol')?7:130; return t; }
function getTargetLower(){ let t=(childData?.normalRange?.min??childData?.hypoLevel); t=Number(t); return Number.isFinite(t)?t:NaN; }
function getSevereUpper(){ const u=(childData?.glucoseUnit||'mg/dL').toLowerCase();
  let t=(childData?.normalRange?.severeHigh??childData?.severeHighLevel??childData?.veryHighLevel); t=Number(t);
  if(!Number.isFinite(t)){ const upper=getTargetUpper(); t=u.includes('mmol')?(upper+3):(upper+54); } return t; }
function getCriticalLow(){ let t=(childData?.normalRange?.criticalLow??childData?.criticalLowLevel); t=Number(t); return Number.isFinite(t)?t:NaN; }
function getCriticalHigh(){ let t=(childData?.normalRange?.criticalHigh??childData?.criticalHighLevel); t=Number(t); return Number.isFinite(t)?t:NaN; }
function dualUnit(val, unit){
  if(!Number.isFinite(val)) return '—';
  return unit.includes('mmol') ? `${round1(val)} mmol/L (${round1(mmol2mgdl(val))} mg/dL)` : `${round1(val)} mg/dL (${round1(mgdl2mmol(val))} mmol/L)`;
}

/* ---------- Derived + Slot duplicate hint ---------- */
function updateDerived(){
  const unit=unitSel.value; const v=Number(readingInp.value);
  // منع صفر أو قيم غير صالحة
  if(!Number.isFinite(v) || v<=0){
    convertedBox.textContent='—'; stateBadge.textContent='—'; stateBadge.className='badge';
    corrDoseView.textContent='0'; lastComputedCorr=0;
    if(actionsPanel){ hide(hypoRow); hide(corrRow); setAlert(null,null); }
    return;
  }

  const childUnit=childData?.glucoseUnit||'mg/dL';
  const valueInChildUnit = childUnit===unit ? v : (childUnit.includes('mmol') ? mgdl2mmol(v) : mmol2mgdl(v));
  convertedBox.textContent = unit.includes('mmol') ? `${round1(mmol2mgdl(v))} mg/dL` : `${round1(mgdl2mmol(v))} mmol/L`;

  const min=getTargetLower(), upper=getTargetUpper(), severe=getSevereUpper(), critL=getCriticalLow(), critH=getCriticalHigh();
  let st='داخل النطاق', css='ok';
  if(Number.isFinite(critL) && valueInChildUnit<=critL){ st='هبوط حرج'; css='err'; }
  else if(Number.isFinite(critH) && valueInChildUnit>=critH){ st='ارتفاع حرج'; css='danger'; }
  else if(Number.isFinite(severe) && valueInChildUnit>severe){ st='ارتفاع شديد'; css='warn'; }
  else if(Number.isFinite(upper) && valueInChildUnit>upper){ st='ارتفاع'; css='warn'; }
  else if(Number.isFinite(min) && valueInChildUnit<min){ st='هبوط'; css='err'; }

  stateBadge.textContent=st; stateBadge.className=`badge ${css}`;

  // حساب جرعة التصحيح الحسابية
  const cf=Number(childData?.correctionFactor)||0;
  let corr=0; if(cf>0 && Number.isFinite(upper) && valueInChildUnit>upper) corr=(valueInChildUnit-upper)/cf;
  lastComputedCorr=corr; corrDoseView.textContent=String(round1(Math.max(0,corr)));

  // عرض الصف المناسب
  ensureActionPanel(); setAlert(null,null);
  if(st==='هبوط' || st==='هبوط حرج'){
    show(hypoRow); hide(corrRow);
    setAlert(st==='هبوط حرج'?'danger':'warn', st==='هبوط حرج'?'يجب التدخل السريع لمعالجة الهبوط':'فضلاً قم بمعالجة الهبوط ثم دوّن ما استُخدم للرفع.');
  }else if(st==='ارتفاع' || st==='ارتفاع شديد' || st==='ارتفاع حرج'){
    hide(hypoRow); show(corrRow);
    // تعبئة تلقائية دون فرض readOnly — مع احترام التعديل اليدوي
    if(!corrDirty){ corrDoseInput.value=String(round1(Math.max(0,corr))); }
    setAlert(st==='ارتفاع حرج'?'danger':(st==='ارتفاع شديد'?'warn':null), st==='ارتفاع حرج'?'يجب معالجة الارتفاع بسرعة':(st==='ارتفاع شديد'?'القراءة أعلى من حد الارتفاع الشديد.':null));
  }else{
    hide(hypoRow); hide(corrRow);
  }
  show(notesRow);

  updateSlotDuplicateHint();
}

/* إظهار/إخفاء تلميح منع التكرار للـ Slot الحالي */
function updateSlotDuplicateHint(){
  const hint = $('slotDupHint'); if(!hint) return;
  if (isSlotTakenToday(slotSel.value) && !DUP_ALLOWED.has(slotSel.value)){
    hint.style.display='inline-flex';
  }else{
    hint.style.display='none';
  }
}

/* ---------- List/Query ---------- */
async function refreshList(){
  if(unsubscribe){ unsubscribe(); unsubscribe=null; }
  const qy=query(measCol,orderBy('when','desc'),limit(300));
  if(liveToggle.checked){ unsubscribe=onSnapshot(qy,snap=>{cache=[];snap.forEach(s=>cache.push({id:s.id,...s.data()}));renderList();updateSlotDuplicateHint();}); }
  else{ const snap=await getDocs(qy); cache=[]; snap.forEach(s=>cache.push({id:s.id,...s.data()})); renderList(); updateSlotDuplicateHint(); }
}
function buildDayArray(){
  const targetDate=new Date((dayPicker.value||todayISO())+'T00:00:00');
  const unit=childData?.glucoseUnit||'mg/dL';
  return cache.map(x=>{
    const when=x.when?.toDate?x.when.toDate():(x.ts?.toDate?x.ts.toDate():null); if(!when||!sameDay(when,targetDate)) return null;
    let val = unit.includes('mmol') ? (x.value_mmol ?? x.value ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
                                    : (x.value_mgdl ?? x.value ?? (x.unit==='mmol/L'? mmol2mgdl(x.value) : x.value));
    val=Number(val); if(!Number.isFinite(val)) return null;
    const key=x.slotKey||'OTHER';
    const state = x.state ? normalizeState(x.state) : inferState(val,unit);
    return { id:x.id, when, val, unit, key, slotOrder:(x.slotOrder??SLOT_ORDER[key]??200), state, corr:Number(x.correctionDose)||0, notes:x.notes||null, hypo:x.hypoTreatment||null };
  }).filter(Boolean);
}
function applyFilters(arr){
  if(filterState.auto){
    const s=slotSel.value;
    filterState.group = /^PRE_/.test(s)?'PRE' : /^POST_/.test(s)?'POST' : s==='FASTING'?'FASTING' : s==='SNACK'?'SNACK' : s==='EXERCISE'?'EXERCISE' : s==='BEDTIME'?'BEDTIME':'ALL';
  }
  let out=arr.slice();
  if(filterState.group!=='ALL'){
    out=out.filter(r=>{
      switch(filterState.group){
        case 'PRE': return /^PRE_/.test(r.key);
        case 'POST': return /^POST_/.test(r.key);
        case 'FASTING': return r.key==='FASTING';
        case 'SNACK': return r.key==='SNACK';
        case 'EXERCISE': return r.key==='EXERCISE';
        case 'BEDTIME': return r.key==='BEDTIME';
        default: return true;
      }
    });
  }
  if(filterState.state!=='ALL'){
    out=out.filter(r=>{
      if(filterState.state==='NORMAL') return r.state==='داخل النطاق';
      if(filterState.state==='LOW') return r.state==='هبوط' || r.state==='هبوط حرج';
      if(filterState.state==='HIGH') return r.state==='ارتفاع' || r.state==='ارتفاع شديد' || r.state==='ارتفاع حرج';
      return true;
    });
  }
  const q=(filterState.search||'').trim().toLowerCase();
  if(q){
    out=out.filter(r=>{
      const time=r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
      const label=(SLOT_LABEL[r.key]||r.key).toLowerCase();
      return time.includes(q)||label.includes(q)||(r.state||'').toLowerCase().includes(q)||(r.notes||'').toLowerCase().includes(q)||(r.hypo||'').toLowerCase().includes(q);
    });
  }
  const s=sortSel.value||'time-asc';
  if(s==='value-desc') out.sort((a,b)=>b.val-a.val);
  else if(s==='value-asc') out.sort((a,b)=>a.val-b.val);
  else out.sort((a,b)=>(a.slotOrder-b.slotOrder)||(a.when-b.when));
  return out;
}
function renderList(){
  const unit=childData?.glucoseUnit||'mg/dL';
  const all=buildDayArray(); const arr=applyFilters(all);
  renderStats(arr,unit); renderSparkline(arr);
  gridEl.innerHTML=''; if(!arr.length){ emptyEl.classList.remove('hidden'); return; } emptyEl.classList.add('hidden');
  for(const r of arr){
    const row=document.createElement('div'); row.className='row';
    row.innerHTML=`
      <div class="cell"><span class="mono">${r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</span></div>
      <div class="cell">${SLOT_LABEL[r.key]||r.key}<span class="muted tiny" style="margin-inline-start:6px">#${r.slotOrder}</span></div>
      <div class="cell"><span class="mono">${round1(r.val)} ${unit}</span></div>
      <div class="cell">${statePill(r.state)}</div>
      <div class="cell">
        ${r.corr? `<span class="badge info">U ${round1(r.corr)}</span>`:''}
        ${r.hypo? `<span class="chip">رفع: ${esc(r.hypo)}</span>`:''}
        ${r.notes? `<span class="muted" style="margin-inline-start:6px">${esc(r.notes)}</span>`:''}
      </div>`;
    gridEl.appendChild(row);
  }
}

/* ---------- Slots uniqueness helpers ---------- */
function isSlotTakenToday(slotKey){
  const arr=buildDayArray();
  return arr.some(r=>r.key===slotKey);
}

/* ---------- Stats & Sparkline ---------- */
function renderStats(arr, unit){
  const TIR=$('statTIR'), AVG=$('statAvg'), SD=$('statSD'), LOW=$('statLow'), HIGH=$('statHigh'), CRIT=$('statCrit');
  if(!arr.length){ TIR.textContent=AVG.textContent=SD.textContent=LOW.textContent=HIGH.textContent=CRIT.textContent='—'; return; }
  const n=arr.length, inRange=arr.filter(r=>r.state==='داخل النطاق').length;
  const lows=arr.filter(r=>r.state==='هبوط').length;
  const highs=arr.filter(r=>r.state==='ارتفاع'||r.state==='ارتفاع شديد').length;
  const critical=arr.filter(r=>r.state==='هبوط حرج'||r.state==='ارتفاع حرج').length;
  const mean=arr.reduce((a,r)=>a+r.val,0)/n;
  const sd=Math.sqrt(arr.reduce((a,r)=>a+Math.pow(r.val-mean,2),0)/n);
  TIR.textContent=`${Math.round((inRange/n)*100)}%`;
  AVG.textContent=`${round1(mean)} ${unit}`;
  SD.textContent=`${round1(sd)}`; LOW.textContent=String(lows); HIGH.textContent=String(highs); CRIT.textContent=String(critical);
}
function renderSparkline(arr){
  if(!sparklineBox) return; sparklineBox.innerHTML=''; if(arr.length<2) return;
  const w=260,h=48,p=4,minV=Math.min(...arr.map(r=>r.val)),maxV=Math.max(...arr.map(r=>r.val));
  const xs=arr.map((_,i)=>p+i*(w-2*p)/(arr.length-1)), ys=arr.map(r=>h-p-((r.val-minV)/(maxV-minV||1))*(h-2*p));
  let d=`M ${xs[0]} ${ys[0]}`; for(let i=1;i<xs.length;i++) d+=` L ${xs[i]} ${ys[i]}`;
  sparklineBox.innerHTML=`<svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="#2563eb" stroke-width="2"/></svg>`;
}

/* ---------- Save + Undo/Redo ---------- */
async function saveMeasurement(){
  const unit=unitSel.value; const v=Number(readingInp.value);
  // منع قراءة 0 أو أقل
  if(!Number.isFinite(v) || v<=0){ toast('أدخل قراءة صحيحة (> 0)'); return; }

  // منع تكرار Slot يوميًا إلا للأنواع المسموح بها
  const slot = slotSel.value;
  if(!DUP_ALLOWED.has(slot) && isSlotTakenToday(slot)){
    toast(`لا يمكن تسجيل قياس آخر لنوع "${SLOT_LABEL[slot]||slot}" اليوم. استخدم "أخرى" أو "رياضة" لو قياس إضافي.`); 
    setAlert('warn','هذا النوع مُسجّل اليوم بالفعل — التكرار غير مسموح.');
    return;
  }

  const dateStr=dayPicker.value||todayISO();
  const when=new Date(`${dateStr}T${new Date().toTimeString().slice(0,8)}`);

  const value_mmol = unit==='mmol/L'? v : mgdl2mmol(v);
  const value_mgdl = unit==='mg/dL'? v : mmol2mgdl(v);

  const childUnit=childData?.glucoseUnit||'mg/dL';
  const valInChild = childUnit===unit ? v : (childUnit.includes('mmol') ? mgdl2mmol(v) : mmol2mgdl(v));
  const upper=getTargetUpper(); const cf=Number(childData?.correctionFactor)||0;

  // جرعة التصحيح: لو الصف ظاهر نأخذ قيمة الحقل (مع الافتراضي التلقائي)، وإلا نحسب
  let correctionDose = 0;
  if(corrRow && corrRow.style.display!=='none'){
    const manual=Number(corrDoseInput.value);
    if(Number.isFinite(manual) && manual>=0){ correctionDose = manual; }
    else if(cf>0 && Number.isFinite(upper) && valInChild>upper){ correctionDose=(valInChild-upper)/cf; }
  }else{
    if(cf>0 && Number.isFinite(upper) && valInChild>upper) correctionDose=(valInChild-upper)/cf;
  }

  const notes=(notesInput?.value||'').trim()||null;
  const hypoTreatment=(hypoInput?.value||'').trim()||null;

  const payload={
    value:v, unit,
    value_mmol:round1(value_mmol), value_mgdl:round1(value_mgdl),
    when, slotKey:slotSel.value, slotOrder:slotOrder(slotSel.value),
    state: inferState(valInChild,childUnit),
    correctionDose: round1(Math.max(0,correctionDose)),
    hypoTreatment: hypoTreatment||null, notes,
    createdAt: serverTimestamp()
  };

  const ref=await addDoc(measCol,payload);
  lastOps.push({id:ref.id,data:payload}); redoStack=[];
  toast('تم حفظ القياس ✔️'); 
  readingInp.value=''; corrDoseInput.value=''; corrDirty=false; 
  updateDerived(); refreshList();
}
async function undoLast(){ const op=lastOps.pop(); if(!op){toast('لا توجد عملية للتراجع');return;} await deleteDoc(doc(measCol,op.id)); redoStack.push(op); toast('تم التراجع عن آخر قياس'); refreshList(); }
async function redoLast(){ const op=redoStack.pop(); if(!op){toast('لا توجد عملية لإعادة التراجع');return;} const ref=await addDoc(measCol,op.data); lastOps.push({id:ref.id,data:op.data}); toast('تمت الإعادة'); refreshList(); }

/* ---------- Export ---------- */
function qaListForDay(visibleOnly=true){
  const unit=childData?.glucoseUnit||'mg/dL'; const base=buildDayArray(); const arr=visibleOnly?applyFilters(base):base;
  return arr.map(r=>({when:r.when,key:r.key,val:r.val,unit,state:r.state,corr:r.corr||0,notes:r.notes||'',hypo:r.hypo||''}));
}
function exportCSV(){
  const unit=childData?.glucoseUnit||'mg/dL';
  const rows=[['الوقت','النوع','القيمة','الحالة','جرعة التصحيح (U)','رفع الهبوط','ملاحظات']];
  qaListForDay(true).forEach(r=>rows.push([
    r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}),
    SLOT_LABEL[r.key]||r.key, `${round1(r.val)} ${unit}`, r.state, r.corr||0,
    `"${r.hypo.replace(/"/g,'""')}"`, `"${r.notes.replace(/"/g,'""')}"`
  ]));
  const csv=rows.map(r=>r.join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`measurements-${dayPicker.value||todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
async function ensureXLSX(){ if(window.XLSX) return window.XLSX;
  await new Promise((res,rej)=>{const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload=res; s.onerror=()=>rej(new Error('XLSX load failed')); document.head.appendChild(s);});
  return window.XLSX;
}
async function exportXLSX(){
  const XLSX=await ensureXLSX(); const unit=childData?.glucoseUnit||'mg/dL';
  const header=['الوقت','النوع','القيمة','الحالة','جرعة التصحيح (U)','رفع الهبوط','ملاحظات'];
  const rows=qaListForDay(true).map(r=>[
    r.when.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}),
    SLOT_LABEL[r.key]||r.key, `${round1(r.val)} ${unit}`, r.state, r.corr||0, r.hypo, r.notes
  ]);
  const ws=XLSX.utils.aoa_to_sheet([header,...rows]); ws['!cols']=[{wch:12},{wch:18},{wch:18},{wch:14},{wch:18},{wch:20},{wch:40}];
  const max=getTargetUpper(),min=getTargetLower(),sev=getSevereUpper(),cl=getCriticalLow(),ch=getCriticalHigh();
  const meta=[['الطفل',childData?.displayName||childData?.name||'—'],['التاريخ',dayPicker.value||todayISO()],['الوحدة',unit],
    ['هبوط',dualUnit(min,unit)],['ارتفاع',dualUnit(max,unit)],['ارتفاع شديد',dualUnit(sev,unit)],['هبوط حرج',dualUnit(cl,unit)],['ارتفاع حرج',dualUnit(ch,unit)],
    ['CR (g/U)',Number(childData?.carbRatio)||'—'],[`CF (${unit}/U)`,Number(childData?.correctionFactor)||'—']];
  const ws2=XLSX.utils.aoa_to_sheet(meta); ws2['!cols']=[{wch:26},{wch:40}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'القياسات (مُفلترة)'); XLSX.utils.book_append_sheet(wb,ws2,'ملخّص');
  XLSX.writeFile(wb,`measurements-${dayPicker.value||todayISO()}.xlsx`);
}

/* ---------- Events ---------- */
function wireEvents(){
  unitSel.addEventListener('change',()=>{ corrDirty=false; updateDerived(); });
  readingInp.addEventListener('input',()=>{ corrDirty=false; updateDerived(); });
  dayPicker.addEventListener('change',()=>{ corrDirty=false; refreshList(); updateSlotDuplicateHint(); });
  slotSel.addEventListener('change',()=>{ corrDirty=false; updateDerived(); updateSlotDuplicateHint(); });
  sortSel.addEventListener('change',renderList);
  liveToggle.addEventListener('change',refreshList);

  saveBtn.addEventListener('click',saveMeasurement);
  exportCsvBtn.addEventListener('click',exportCSV);
  exportXlsxBtn.addEventListener('click',exportXLSX);
  toMealsBtn.addEventListener('click',()=>{ const type=slotToMealType(slotSel.value);
    location.href=`meals.html?child=${encodeURIComponent(childId)}${type?`&type=${encodeURIComponent(type)}`:''}&date=${encodeURIComponent(dayPicker.value||todayISO())}`; });

  filtersBar.querySelectorAll('[data-g]').forEach(b=>b.addEventListener('click',()=>{filterState.group=b.dataset.g; renderList();}));
  filtersBar.querySelectorAll('[data-s]').forEach(b=>b.addEventListener('click',()=>{filterState.state=b.dataset.s; renderList();}));
  $('clearFilters').addEventListener('click',()=>{ filterState={...filterState,group:'ALL',state:'ALL',search:''}; searchBox.value=''; renderList(); });
  autoSlotToggle.addEventListener('change',()=>{ filterState.auto=!!autoSlotToggle.checked; renderList(); });

  $('undoBtn').addEventListener('click',undoLast); $('redoBtn').addEventListener('click',redoLast);

  window.addEventListener('keydown',(e)=>{
    const k=e.key.toLowerCase();
    if(k==='s'){ e.preventDefault(); saveMeasurement(); }
    else if(k==='l'){ e.preventDefault(); liveToggle.checked=!liveToggle.checked; refreshList(); }
    else if(k==='e'){ e.preventDefault(); exportXLSX(); }
    else if(k==='c'){ e.preventDefault(); exportCSV(); }
    else if(k==='m'){ e.preventDefault(); const type=slotToMealType(slotSel.value); location.href=`meals.html?child=${encodeURIComponent(childId)}${type?`&type=${encodeURIComponent(type)}`:''}&date=${encodeURIComponent(dayPicker.value||todayISO())}`; }
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
function inferState(v){ const min=getTargetLower(),upper=getTargetUpper(),severe=getSevereUpper(),cl=getCriticalLow(),ch=getCriticalHigh();
  if(Number.isFinite(cl) && v<=cl) return 'هبوط حرج';
  if(Number.isFinite(ch) && v>=ch) return 'ارتفاع حرج';
  if(Number.isFinite(severe) && v>severe) return 'ارتفاع شديد';
  if(Number.isFinite(upper) && v>upper) return 'ارتفاع';
  if(Number.isFinite(min) && v<min) return 'هبوط';
  return 'داخل النطاق';
}
