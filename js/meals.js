/* meals.js — Pro build (measurements by meal/date + upper-target correction in child's unit)
 * - Admin catalog (read-only) from admin/global/foodItems
 * - Measurements lists (pre/post) filtered by meal type & date; display converted to child's unit ONLY for UI
 * - Accurate totals (grams/household), NetCarbs, GL (if GI exists)
 * - Auto doses (carb + correction + total) with manual override
 * - Correction uses UPPER target (normalRange.max or hyperLevel) in CHILD'S UNIT (no internal conversion)
 * - Manual pre-reading has priority
 * - Presets save/import by type (parent-owned) + repeat last meal by type + templateName field
 * - Therapy chips (CR/CF/Bolus) + Child Settings button
 * - Auto-Tuner + What-If + CSV + Excel (.xlsx) export
 * - No HTML edits: everything is injected if missing
 * - Firestore paths & rules preserved exactly
 */

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc,
  query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref as sRef, getDownloadURL, onSnapshot } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ============ Tiny utils ============ */
const $ = id => document.getElementById(id);
const q = (sel, root=document) => root.querySelector(sel);
const qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const toNum = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round1 = n => Math.round((Number(n)||0) * 10) / 10;
const todayISO = () => new Date().toISOString().slice(0,10);
const mgdl2mmol = mg => mg / 18;
const mmol2mgdl = mmol => mmol * 18;

/* Date helpers */
const sameDay = (d1, d2) => d1.getFullYear()===d2.getFullYear() && d1.getMonth()===d2.getMonth() && d1.getDate()===d2.getDate();
function timeWindowForMeal(type){
  // [startHour, endHour) local time windows (approx)
  switch(type){
    case 'فطار': return [4, 11];
    case 'غدا' : return [11, 16];
    case 'عشا' : return [16, 22];
    case 'سناك': return [22, 28]; // night snacks
    default: return [0, 24];
  }
}

/* ============ DOM handles ============ */
let childNameEl, childMetaEl, mealDateEl, mealTypeEl;
let preReadingEl, preReadingManualEl, postReadingEl;
let unitChipEl, carbProgress, carbStateEl;
let addItemBtn, repeatLastBtn, aiBtn, presetBtn;
let itemsBodyEl;
let tGramsEl, tCarbsEl, tFiberEl, tNetCarbsEl, tCalEl, tProtEl, tFatEl, tGLEl;
let useNetCarbsEl;
let suggestedDoseEl, doseExplainEl, doseRangeEl;
let carbDoseEl, corrDoseEl, totalDoseEl, appliedDoseEl, mealNotesEl;
let saveMealBtn, resetMealBtn, printDayBtn, exportCsvBtn, exportXlsxBtn;
let pickerModal, pickSearchEl, pickCategoryEl, hideAllergyEl, hideDietEl, pickerGrid, pickerEmpty, closePicker;
let aiModal, aiClose, aiText, aiAnalyze, aiApply, aiResults;
let presetModal, presetClose, presetGrid, presetTabs;
let tunerModal, tunerApplyBtn, tunerCancelBtn, tunerList, tunerSeveritySel;
let whatIfSlider, whatIfValue, whatIfResetBtn;
let childSettingsBtn, templateNameEl, therapyChipsBar;
let toastEl;

/* ============ State ============ */
const params = new URLSearchParams(location.search);
const childId = (params.get('child')||'').trim();

let currentUser=null, childRef=null, childData=null;
let mealsCol=null, measurementsCol=null, presetsCol=null;
let foodCache=[], items=[];
let manualCarb=false, manualCorr=false, manualTotal=false;
let presetsCache=[];
let plannedChanges=[]; // auto-tuner proposed ops

/* ============ Toast ============ */
function toast(msg,type='info'){
  if(!toastEl){ toastEl=document.createElement('div'); toastEl.id='toast'; toastEl.className='toast'; document.body.appendChild(toastEl); }
  toastEl.textContent=msg; toastEl.className=`toast ${type}`; toastEl.style.display='block';
  clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>{toastEl.style.display='none';},2500);
}

/* ============ Injection (no HTML edits required) ============ */
function ensureElById(id, creator){
  let el = $(id);
  if(!el){ el = creator(); el.id=id; }
  return el;
}
function ensureBasicSkeleton(){
  // Header bits
  childNameEl = ensureElById('childName', ()=>{ const s=document.createElement('strong'); q('.container')?.prepend(s); return s; });
  childMetaEl = ensureElById('childMeta', ()=>{ const span=document.createElement('span'); childNameEl.after(span); return span; });

  mealDateEl = ensureElById('mealDate', ()=>{ const i=document.createElement('input'); i.type='date'; q('.container')?.prepend(i); return i; });
  mealTypeEl = ensureElById('mealType', ()=>{ const s=document.createElement('select'); ['فطار','غدا','عشا','سناك'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; s.appendChild(o);}); q('.container')?.prepend(s); return s; });

  preReadingEl = ensureElById('preReading', ()=>{ const s=document.createElement('select'); q('.container')?.prepend(s); return s; });
  postReadingEl = ensureElById('postReading', ()=>{ const s=document.createElement('select'); q('.container')?.append(s); return s; });

  // Manual pre-reading input
  preReadingManualEl = $('preReadingManual');
  if(!preReadingManualEl){
    preReadingManualEl = document.createElement('input');
    preReadingManualEl.id='preReadingManual'; preReadingManualEl.type='number'; preReadingManualEl.step='any'; preReadingManualEl.placeholder='إدخال يدوي';
    preReadingEl?.parentElement?.insertBefore(preReadingManualEl, preReadingEl.nextSibling);
  }

  unitChipEl = ensureElById('unitChip', ()=>{ const s=document.createElement('span'); s.className='chip'; q('.container')?.prepend(s); return s; });
  carbProgress = ensureElById('carbProgress', ()=>{ const bar=document.createElement('span'); const wrap=document.createElement('div'); wrap.className='progress'; wrap.appendChild(bar); q('.container')?.prepend(wrap); return bar; });
  carbStateEl = ensureElById('carbState', ()=>{ const s=document.createElement('span'); q('.container')?.prepend(s); return s; });

  // Builder buttons
  addItemBtn = ensureElById('addItemBtn', ()=>{ const b=document.createElement('button'); b.textContent='➕ إضافة صنف'; q('.container')?.append(b); return b; });
  repeatLastBtn = ensureElById('repeatLastBtn', ()=>{ const b=document.createElement('button'); b.textContent='↩️ تكرار آخر وجبة'; addItemBtn.after(b); return b; });
  aiBtn = ensureElById('aiBtn', ()=>{ const b=document.createElement('button'); b.textContent='🤖 من نص'; repeatLastBtn.after(b); return b; });
  presetBtn = ensureElById('presetBtn', ()=>{ const b=document.createElement('button'); b.textContent='📦 وجبة جاهزة'; aiBtn.after(b); return b; });

  // Items table body
  itemsBodyEl = ensureElById('itemsBody', ()=>{ const div=document.createElement('div'); div.className='table__body'; q('.container')?.append(div); return div; });

  // Template Name field (optional)
  templateNameEl = $('mealTemplateName');
  if(!templateNameEl){
    const wrap = document.createElement('label');
    wrap.className='field';
    wrap.innerHTML = `<span>اسم الوجبة/القالب (اختياري)</span>
                      <input type="text" id="mealTemplateName" placeholder="مثال: عشاء خفيف">`;
    const anchor = itemsBodyEl || q('.container');
    anchor?.parentElement?.insertBefore(wrap, anchor);
    templateNameEl = $('mealTemplateName');
  }

  // Summary fields
  tGramsEl = ensureElById('tGrams', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });
  tCarbsEl = ensureElById('tCarbs', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });
  tFiberEl = ensureElById('tFiber', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });
  tNetCarbsEl = ensureElById('tNetCarbs', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });
  tCalEl = ensureElById('tCal', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });
  tProtEl = ensureElById('tProt', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });
  tFatEl = ensureElById('tFat', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });
  tGLEl = ensureElById('tGL', ()=>{ const s=document.createElement('span'); q('.container')?.append(s); return s; });

  // Net carbs toggle
  useNetCarbsEl = ensureElById('useNetCarbs', ()=>{ const i=document.createElement('input'); i.type='checkbox'; q('.container')?.append(i); return i; });

  // Dose fields block
  carbDoseEl = $('carbDose'); corrDoseEl=$('corrDose'); totalDoseEl=$('totalDose'); appliedDoseEl=$('appliedDose');
  if(!carbDoseEl || !corrDoseEl || !totalDoseEl){
    const wrap = document.createElement('div'); wrap.className='dose-grid';
    const mk = (id,label,ro=false)=>{ const l=document.createElement('label'); l.className='field';
      const s=document.createElement('span'); s.textContent=label; const i=document.createElement('input'); i.id=id; i.type='number'; i.step='0.5'; if(ro) i.readOnly=true; l.append(s,i); wrap.appendChild(l); return i; };
    carbDoseEl = carbDoseEl || mk('carbDose','جرعة الكارب');
    corrDoseEl = corrDoseEl || mk('corrDose','جرعة التصحيح');
    totalDoseEl = totalDoseEl || mk('totalDose','المجموع الكلي');
    (q('.dose')||q('.container')).appendChild(wrap);
  }
  appliedDoseEl = appliedDoseEl || ensureElById('appliedDose', ()=>{ const i=document.createElement('input'); i.type='number'; i.step='0.5'; (q('.dose')||q('.container')).appendChild(i); return i; });
  mealNotesEl = ensureElById('mealNotes', ()=>{ const i=document.createElement('input'); i.type='text'; (q('.dose')||q('.container')).appendChild(i); return i; });

  // Suggested dose text
  suggestedDoseEl = ensureElById('suggestedDose', ()=>{ const b=document.createElement('b'); (q('.dose')||q('.container')).appendChild(b); return b; });
  doseExplainEl = ensureElById('doseExplain', ()=>{ const sm=document.createElement('small'); sm.className='muted'; (q('.dose')||q('.container')).appendChild(sm); return sm; });
  doseRangeEl = ensureElById('doseRange', ()=>{ const sp=document.createElement('span'); sp.className='badge'; (q('.dose')||q('.container')).appendChild(sp); return sp; });

  // Actions
  saveMealBtn = ensureElById('saveMealBtn', ()=>{ const b=document.createElement('button'); b.textContent='حفظ الوجبة'; q('.container')?.append(b); return b; });
  resetMealBtn = ensureElById('resetMealBtn', ()=>{ const b=document.createElement('button'); b.textContent='إعادة الضبط'; saveMealBtn.after(b); return b; });
  printDayBtn = ensureElById('printDayBtn', ()=>{ const b=document.createElement('button'); b.textContent='🖨️ طباعة وجبات اليوم'; resetMealBtn.after(b); return b; });
  exportCsvBtn = $('exportCsvBtn'); if(!exportCsvBtn){ exportCsvBtn=document.createElement('button'); exportCsvBtn.id='exportCsvBtn'; exportCsvBtn.textContent='⬇️ تصدير CSV'; printDayBtn.after(exportCsvBtn); }
  exportXlsxBtn = $('exportXlsxBtn'); if(!exportXlsxBtn){ exportXlsxBtn=document.createElement('button'); exportXlsxBtn.id='exportXlsxBtn'; exportXlsxBtn.textContent='⬇️ تصدير Excel'; exportCsvBtn.after(exportXlsxBtn); }

  // Child Settings button
  childSettingsBtn = $('childSettingsBtn');
  if(!childSettingsBtn){
    childSettingsBtn = document.createElement('a');
    childSettingsBtn.id='childSettingsBtn';
    childSettingsBtn.className='btn btn--link';
    childSettingsBtn.textContent='إعداد الطفل';
    (q('.goals__top') || q('.container')).prepend(childSettingsBtn);
  }

  // Therapy chips
  therapyChipsBar = $('therapyChips');
  if(!therapyChipsBar){
    therapyChipsBar = document.createElement('div');
    therapyChipsBar.id='therapyChips';
    therapyChipsBar.style.display='flex';
    therapyChipsBar.style.gap='8px';
    (q('.goals__top') || q('.container')).appendChild(therapyChipsBar);
  }

  // Picker modal
  pickerModal = $('pickerModal');
  if(!pickerModal){
    pickerModal = document.createElement('div'); pickerModal.id='pickerModal'; pickerModal.className='modal hidden';
    pickerModal.innerHTML = `
      <div class="modal__body">
        <div class="modal__header"><h3>اختيار صنف من مكتبة الأدمن</h3><button id="closePicker" class="close">✕</button></div>
        <div class="grid">
          <label class="field"><span>بحث</span><input type="text" id="pickSearch" placeholder="اسم أو #وسم"></label>
          <label class="field">
            <span>التصنيف</span>
            <select id="pickCategory">
              <option value="الكل">الكل</option><option value="حبوب">حبوب</option><option value="فاكهة">فاكهة</option>
              <option value="خضار">خضار</option><option value="ألبان">ألبان</option><option value="مسليات">مسليات</option><option value="مشروبات">مشروبات</option>
            </select>
          </label>
          <div class="filters">
            <label class="switch"><input type="checkbox" id="hideAllergy"><span>إخفاء ما يسبب حساسية 🚫</span></label>
            <label class="switch"><input type="checkbox" id="hideDiet"><span>إخفاء المخالف للحمية ⚠️</span></label>
          </div>
        </div>
        <div id="pickerGrid" class="picker-grid"></div>
        <div id="pickerEmpty" class="empty hidden">لا توجد نتائج.</div>
      </div>`;
    document.body.appendChild(pickerModal);
  }
  closePicker = $('closePicker'); pickSearchEl=$('pickSearch'); pickCategoryEl=$('pickCategory');
  hideAllergyEl=$('hideAllergy'); hideDietEl=$('hideDiet'); pickerGrid=$('pickerGrid'); pickerEmpty=$('pickerEmpty');

  // AI modal
  aiModal = $('aiModal');
  if(!aiModal){
    aiModal=document.createElement('div'); aiModal.id='aiModal'; aiModal.className='modal hidden';
    aiModal.innerHTML = `
      <div class="modal__body">
        <div class="modal__header"><h3>🤖 مساعد تكوين الوجبة من نص</h3><button id="aiClose" class="close">✕</button></div>
        <label class="field"><span>اكتب وصف الوجبة</span><textarea id="aiText" rows="4" placeholder="مثال: كوب ونصف أرز + 2 توست ..."></textarea></label>
        <div class="actions" style="justify-content:flex-end">
          <button id="aiAnalyze" class="btn btn--ghost">تحليل</button>
          <button id="aiApply" class="btn" disabled>إضافة العناصر</button>
        </div>
        <div id="aiResults" class="ai-results"></div>
      </div>`;
    document.body.appendChild(aiModal);
  }
  aiClose=$('aiClose'); aiText=$('aiText'); aiAnalyze=$('aiAnalyze'); aiApply=$('aiApply'); aiResults=$('aiResults');

  // Preset modal
  presetModal = $('presetModal');
  if(!presetModal){
    presetModal=document.createElement('div'); presetModal.id='presetModal'; presetModal.className='modal hidden';
    presetModal.innerHTML = `
      <div class="modal__body">
        <div class="modal__header"><h3>📦 وجبة جاهزة</h3><button id="presetClose" class="close">✕</button></div>
        <div class="preset-tabs">
          <button class="tab" data-type="فطار">🍳 فطار</button>
          <button class="tab" data-type="غدا">🍲 غدا</button>
          <button class="tab" data-type="عشا">🍽️ عشا</button>
          <button class="tab" data-type="سناك">🥪 سناك</button>
        </div>
        <div class="actions" style="justify-content:flex-start;gap:8px;margin:6px 0">
          <button id="presetSaveBtn" class="btn btn--ghost">⭐ حفظ الحالية كقالب</button>
        </div>
        <div id="presetGrid" class="preset-grid"></div>
        <div id="presetEmpty" class="empty hidden">لا توجد وجبات جاهزة لهذا النوع.</div>
      </div>`;
    document.body.appendChild(presetModal);
  }
  presetClose=$('presetClose'); presetGrid=$('presetGrid'); presetTabs=qa('.preset-tabs .tab'); $('presetEmpty');

  // Auto-Tuner modal
  tunerModal = $('tunerModal');
  if(!tunerModal){
    tunerModal=document.createElement('div'); tunerModal.id='tunerModal'; tunerModal.className='modal hidden';
    tunerModal.innerHTML = `
      <div class="modal__body">
        <div class="modal__header"><h3>🔧 تعديل للنطاق</h3><button id="tunerCancelBtn" class="close">✕</button></div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
          <label class="field" style="min-width:200px">
            <span>مستوى الحِدّة</span>
            <select id="tunerSeveritySel">
              <option value="light">خفيف</option>
              <option value="balanced" selected>متوازن</option>
              <option value="max">أقصى</option>
            </select>
          </label>
          <button id="tunerApplyBtn" class="btn">تطبيق التعديلات</button>
        </div>
        <div id="tunerList" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>`;
    document.body.appendChild(tunerModal);
  }
  tunerApplyBtn=$('tunerApplyBtn'); tunerCancelBtn=$('tunerCancelBtn'); tunerList=$('tunerList'); tunerSeveritySel=$('tunerSeveritySel');

  // What-If controls
  if(!$('whatIfSlider')){
    const wrap=document.createElement('div'); wrap.style.display='flex'; wrap.style.gap='8px'; wrap.style.alignItems='center';
    wrap.innerHTML = `
      <span>What-If:</span>
      <input type="range" id="whatIfSlider" min="-30" max="30" step="10" value="0"/>
      <span id="whatIfValue">0%</span>
      <button id="whatIfResetBtn" class="btn btn--ghost">إعادة</button>
    `;
    (q('.goals__bar')||q('.container'))?.appendChild(wrap);
  }
  whatIfSlider=$('whatIfSlider'); whatIfValue=$('whatIfValue'); whatIfResetBtn=$('whatIfResetBtn');

  // Goal labels
  if(!$('goalType')){ const sp=document.createElement('span'); sp.id='goalType'; (q('.goals__top')||q('.container')).appendChild(sp); }
  if(!$('goalMin')){ const b=document.createElement('b'); b.id='goalMin'; (q('.goals__top')||q('.container')).appendChild(b); }
  if(!$('goalMax')){ const b=document.createElement('b'); b.id='goalMax'; (q('.goals__top')||q('.container')).appendChild(b); }
}

/* ============ Child meta & targets ============ */
function applyUnitChip(){ const u=(childData?.insulinUnit||'U'); if(unitChipEl) unitChipEl.textContent=`وحدة: ${u}`; }
function renderTherapyChips(){
  const bar = therapyChipsBar; if(!bar) return;
  const unit = childData?.glucoseUnit || 'mg/dL';
  const cr = childData?.carbRatio ? `${childData.carbRatio} g/U` : '—';
  const cf = childData?.correctionFactor ? `${childData.correctionFactor} ${unit}/U` : '—';
  const bolus = childData?.bolusType || childData?.bolus || '—';
  bar.innerHTML = `
    <span class="chip">CR: ${cr}</span>
    <span class="chip">CF: ${cf}</span>
    <span class="chip">Bolus: ${esc(bolus)}</span>
  `;
}
function getTargetRangeForType(type){
  const cd = childData||{};
  const t1 = cd.carbTargets || cd.targets || {};
  const map = { 'فطار':['فطار','breakfast','Breakfast'], 'غدا':['غدا','lunch','Lunch'], 'عشا':['عشا','dinner','Dinner'], 'سناك':['سناك','snack','Snack'] };
  const keys = map[type] || [type];
  for(const k of keys){
    const v = t1?.[k];
    if(v && (v.min!=null || v.max!=null)) return {min:Number(v.min)||0,max:Number(v.max)||0};
  }
  return {min:0,max:0};
}
function applyTargets(){
  const type=mealTypeEl?.value||'فطار';
  $('goalType').textContent=type;
  const {min,max}=getTargetRangeForType(type);
  $('goalMin').textContent=min||'—';
  $('goalMax').textContent=max||'—';
  recalcAll();
}
function getTargetUpper(){
  const u=(childData?.glucoseUnit || 'mg/dL').toLowerCase();
  let t = (childData?.normalRange && childData.normalRange.max != null)
            ? Number(childData.normalRange.max)
            : (childData?.hyperLevel != null ? Number(childData.hyperLevel) : NaN);
  if(!Number.isFinite(t)) t = u.includes('mmol') ? 7 : 130; // safe default
  return t;
}

/* ============ Load child & collections ============ */
async function resolveChildRef(uid,cid){
  const r = doc(db,'parents',uid,'children',cid);
  const s = await getDoc(r);
  if(s.exists()) return {ref:r,data:s.data()};
  return {ref:null,data:null};
}
async function loadChild(uid){
  if(!childId){ location.replace('child.html'); return; }
  const {ref,data} = await resolveChildRef(uid,childId);
  if(!ref){ toast('الطفل غير موجود لهذا الحساب','error'); return; }
  childRef=ref; childData=data||{};
  childNameEl && (childNameEl.textContent=childData.displayName||childData.name||'الطفل');
  childMetaEl && (childMetaEl.textContent=`تاريخ الميلاد: ${childData?.birthDate||'—'} • نوع الإنسولين: ${childData?.basalType||'—'}`);
  applyUnitChip(); renderTherapyChips(); applyTargets();
  mealsCol = collection(childRef,'meals');
  measurementsCol = collection(childRef,'measurements');
  presetsCol = collection(childRef,'presetMeals');
  // activate child settings link
  childSettingsBtn?.addEventListener('click', (e)=>{ e.preventDefault(); location.href = `child.html?child=${encodeURIComponent(childId)}`; });
}

/* ============ Admin Food catalog (read-only) ============ */
function normalizeMeasures(d){
  if(Array.isArray(d?.measures)) return d.measures.filter(m=>m&&Number(m.grams)>0).map(m=>({name:m.name,grams:Number(m.grams)}));
  if(d?.measureQty && typeof d.measureQty==='object') return Object.entries(d.measureQty).filter(([n,g])=>n&&Number(g)>0).map(([n,g])=>({name:n,grams:Number(g)}));
  if(Array.isArray(d?.householdUnits)) return d.householdUnits.filter(m=>m&&Number(m.grams)>0).map(m=>({name:m.name,grams:Number(m.grams)}));
  if(Array.isArray(d?.units)) return d.units.filter(u=>u&&u.label&&Number(u.grams)>0).map(u=>({name:u.label,grams:Number(u.grams)}));
  return [];
}
function pickNumber(...candidates){ for(const v of candidates){ if(v!=null && !Number.isNaN(Number(v))) return Number(v); } return 0; }
function mapFood(s){
  const d={id:s.id,...s.data()}, nutr=d.nutrPer100g||d.per100||{};
  const per100={ cal:pickNumber(nutr.cal,nutr.cal_kcal,nutr.kcal), carbs:pickNumber(nutr.carbs,nutr.carbs_g),
                 fat:pickNumber(nutr.fat,nutr.fat_g), fiber:pickNumber(nutr.fiber,nutr.fiber_g),
                 prot:pickNumber(nutr.prot,nutr.protein,nutr.protein_g), gi:nutr.gi ?? null };
  return { id:d.id, name:d.name||d.arName||d.enName||'صنف', brand:d.brand||null, category:d.category||'أخرى',
           imageUrl:(d.imageUrl||d.image||d.photo||d.cover||(Array.isArray(d.images)?d.images[0]:null)||d.thumbUrl||''), per100, measures: normalizeMeasures(d),
           allergens:Array.isArray(d.allergens)?d.allergens:[], dietTags:Array.isArray(d.dietTags)?d.dietTags:[], tags:Array.isArray(d.tags)?d.tags:[] };
}
function ADMIN_FOOD_COLLECTION(){ return collection(db,'admin','global','foodItems'); }
async function ensureFoodCache(){
  if(window._unsubAdmin || window._unsubTop) return;
  try{
    const storage = getStorage();
    let snap1=null, snap2=null;

    const apply = async () => {
      const list = [];
      if(snap1){ snap1.forEach(s => list.push(mapFood(s))); }
      if(snap2){ snap2.forEach(s => list.push(mapFood(s))); }
      // de-dup by id
      const byId = new Map();
      for(const f of list){ if(f&&f.id&&!byId.has(f.id)) byId.set(f.id,f); }
      let arr = Array.from(byId.values());
      // sort
      arr.sort((a,b)=> (a.name||'').localeCompare(b.name||'','ar',{numeric:true}));
      // resolve storage paths
      await Promise.all(arr.map(async f=>{
        if(f.imageUrl && !/^https?:\/\//.test(f.imageUrl)){
          try{ f.imageUrl = await getDownloadURL(sRef(storage, f.imageUrl)); }catch(e){}
        }
      }));
      foodCache = arr;
      // refresh picker if open
      if(typeof renderPicker==='function' && typeof pickerModal!=='undefined' && pickerModal && !pickerModal.classList.contains('hidden')){
        renderPicker();
      }
    };

    window._unsubAdmin = onSnapshot(ADMIN_FOOD_COLLECTION(), s=>{ snap1=s; apply(); });
    window._unsubTop   = onSnapshot(collection(db,'fooditems'), s=>{ snap2=s; apply(); });
  }catch(e){ console.error(e); toast('تعذّر الاشتراك في مكتبة الأصناف','error'); }
}

/* ============ Picker ============ */
function openPicker(){ pickerModal?.classList.remove('hidden'); document.body.style.overflow='hidden'; renderPicker(); }
function closePickerModal(){ pickerModal?.classList.add('hidden'); document.body.style.overflow=''; }

function childHasAllergy(f){
  const ca=Array.isArray(childData?.allergies)?childData.allergies:[];
  return (Array.isArray(f.allergens)?f.allergens:[]).some(a=>ca.includes(a));
}
function violatesDiet(f){
  const rules=Array.isArray(childData?.specialDiet)?childData.specialDiet:[];
  if(!rules.length) return false;
  const tags=Array.isArray(f.dietTags)?f.dietTags:[];
  return rules.some(r=>!tags.includes(r)); // strict
}
function getPref(itemId){ return (childData?.preferences||{})[itemId]; }

function renderPicker(){
  if(!pickerGrid) return;
  const qtxt=(pickSearchEl?.value||'').trim();
  const cat=(pickCategoryEl?.value||'الكل').trim();
  const hideA=!!hideAllergyEl?.checked, hideD=!!hideDietEl?.checked;

  const list=foodCache.filter(f=>{
    const matchQ=!qtxt || f.name.includes(qtxt) || f.brand?.includes(qtxt) || f.category?.includes(qtxt) || (qtxt.startsWith('#') && f.tags?.includes(qtxt.slice(1)));
    const matchC=(cat==='الكل')||(f.category===cat);
    const allergy=childHasAllergy(f), diet=violatesDiet(f);
    const passA = hideA ? !allergy : true;
    const passD = hideD ? !diet : true;
    return matchQ && matchC && passA && passD;
  });

  pickerEmpty?.classList.toggle('hidden',list.length>0);
  pickerGrid.innerHTML=list.map(f=>{
    const allergy=childHasAllergy(f), diet=violatesDiet(f), pref=getPref(f.id);
    const badges=[
      allergy?'<span class="badge danger">🚫 حساسية</span>':'',
      (!allergy && diet)?'<span class="badge warn">⚠️ يخالف الحمية</span>':'',
      pref==='like'?'<span class="badge like">❤️ يحب</span>':'',
      pref==='dislike'?'<span class="badge dislike">💔 يكره</span>':''
    ].join(' ');
    const meas=(f.measures?.length||0)?f.measures.map(m=>`<span class="chip">${esc(m.name)} (${m.grams}جم)</span>`).join(' '):'<span class="muted tiny">لا تقديرات بيتية</span>';
    return `
      <button class="pick" data-id="${esc(f.id)}" ${allergy?'data-warn="allergy"':''} ${diet?'data-warn="diet"':''}>
        ${f.imageUrl?`<img src="${esc(f.imageUrl)}" alt="">`:''}
        <div class="t">
          <div class="n">${esc(f.name)}</div>
          ${f.brand?`<div class="muted tiny">${esc(f.brand)}</div>`:''}
          <div class="m">${meas}</div>
          <div class="flags">${badges}</div>
        </div>
      </button>`;
  }).join('');

  pickerGrid.querySelectorAll('.pick').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const it=foodCache.find(x=>x.id===btn.dataset.id);
      if(!it) return;
      if(btn.dataset.warn==='allergy'){
        if(!confirm('⚠️ الصنف يحتوي مكوّن حساسية حسب إعدادات الطفل. المتابعة؟')) return;
      }else if(btn.dataset.warn==='diet'){
        if(!confirm('⚠️ الصنف قد يخالف الحمية المحددة. المتابعة؟')) return;
      }
      addRowFromFood(it); closePickerModal();
    });
  });
}

/* ============ Items table ============ */
function addRowFromFood(f){
  const r={
    id:crypto.randomUUID(), itemId:f.id, name:f.name, brand:f.brand||null,
    unit:'grams', qty:1, measure:null, grams:0,
    per100:{...f.per100}, measures:Array.isArray(f.measures)?f.measures:[],
    calc:{carbs:0,fiber:0,cal:0,prot:0,fat:0,gl:0}
  };
  items.push(r); renderItems(); recalcAll();
}
function renderItems(){
  if(!itemsBodyEl) return;
  itemsBodyEl.innerHTML='';
  items.forEach((r)=>{
    const row=document.createElement('div'); row.className='row';
    row.innerHTML=`
      <div class="cell">${esc(r.name)} ${r.brand?`<span class="muted tiny">(${esc(r.brand)})</span>`:''}</div>
      <div class="cell">
        <select class="unit">
          <option value="grams" ${r.unit==='grams'?'selected':''}>جرام</option>
          <option value="household" ${r.unit==='household'?'selected':''}>تقدير بيتي</option>
        </select>
      </div>
      <div class="cell"><input type="number" class="qty" min="0" step="any" value="${r.qty}"></div>
      <div class="cell">
        <select class="measure">
          ${(r.measures||[]).map(m=>`<option value="${esc(m.name)}" data-g="${m.grams}" ${r.measure===m.name?'selected':''}>${esc(m.name)} (${m.grams}جم)</option>`).join('')}
        </select>
      </div>
      <div class="cell"><span class="grams">${round1(r.grams)}</span></div>
      <div class="cell"><span class="carbs">${round1(r.calc.carbs)}</span></div>
      <div class="cell"><span class="fiber">${round1(r.calc.fiber)}</span></div>
      <div class="cell"><span class="cal">${round1(r.calc.cal)}</span></div>
      <div class="cell"><span class="prot">${round1(r.calc.prot)}</span></div>
      <div class="cell"><span class="fat">${round1(r.calc.fat)}</span></div>
      <div class="cell"><button class="btn btn--ghost danger del">🗑️</button></div>
    `;
    itemsBodyEl.appendChild(row);

    const unitSel=row.querySelector('.unit');
    const qtyInp=row.querySelector('.qty');
    const measSel=row.querySelector('.measure');
    const gramsEl=row.querySelector('.grams');

    function recomputeRow(){
      if(unitSel.value==='grams'){
        const grams=Math.max(0,toNum(qtyInp.value));
        r.unit='grams'; r.qty=grams; r.measure=null; r.grams=grams;
      }else{
        const opt=measSel.options[measSel.selectedIndex]; const g=toNum(opt?.dataset?.g)||0;
        r.unit='household'; r.measure=measSel.value; r.qty=Math.max(0,toNum(qtyInp.value));
        r.grams=Math.max(0, r.qty * g);
      }
      const c100=r.per100.carbs||0, f100=r.per100.fiber||0, cal100=r.per100.cal||0, p100=r.per100.prot||0, fat100=r.per100.fat||0, gi=r.per100.gi;
      r.calc.carbs=(r.grams*c100)/100; r.calc.fiber=(r.grams*f100)/100; r.calc.cal=(r.grams*cal100)/100;
      r.calc.prot=(r.grams*p100)/100; r.calc.fat=(r.grams*fat100)/100;
      r.calc.gl= (gi!=null && gi>=0) ? (gi/100) * r.calc.carbs : 0;

      gramsEl.textContent=round1(r.grams);
      row.querySelector('.carbs').textContent=round1(r.calc.carbs);
      row.querySelector('.fiber').textContent=round1(r.calc.fiber);
      row.querySelector('.cal').textContent=round1(r.calc.cal);
      row.querySelector('.prot').textContent=round1(r.calc.prot);
      row.querySelector('.fat').textContent=round1(r.calc.fat);
      recalcAll();
    }
    unitSel.addEventListener('change',recomputeRow);
    qtyInp.addEventListener('input',recomputeRow);
    measSel.addEventListener('change',recomputeRow);
    row.querySelector('.del').addEventListener('click',()=>{ items=items.filter(x=>x!==r); renderItems(); recalcAll(); });
    recomputeRow();
  });
}

/* ============ Measurements (by meal + date, displayed in child's unit) ============ */
function convertToChildUnit(value, unit){
  const childUnit=(childData?.glucoseUnit || 'mg/dL').toLowerCase();
  const u=(unit||childUnit).toLowerCase();
  if(!Number.isFinite(Number(value))) return null;
  const v=Number(value);
  if(childUnit.includes('mmol') && u.includes('mg')) return mgdl2mmol(v);
  if(childUnit.includes('mg') && u.includes('mmol')) return mmol2mgdl(v);
  return v;
}
async function loadMeasurementsOptions(){
  if(!measurementsCol) return;
  const dateStr = mealDateEl?.value || todayISO();
  const type = mealTypeEl?.value || 'فطار';

  // clear
  function clear(sel){ if(sel){ sel.innerHTML = `<option value="">—</option>`; } }
  clear(preReadingEl); clear(postReadingEl);

  const snap=await getDocs(query(measurementsCol, orderBy('ts','desc'), limit(200)));
  const items=[];
  snap.forEach(d=>{
    const v=d.data();
    if(!v?.ts?.toDate) return;
    const ts=v.ts.toDate();
    const unit=v.unit || v.glucoseUnit || 'mg/dL';
    const val = convertToChildUnit(v.value ?? v.reading, unit);
    if(val==null) return;
    items.push({
      val: val,
      rawUnit: unit,
      when: ts,
      ctx: v.context || {},
      labelTime: ts.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})
    });
  });

  const targetDate = new Date(dateStr+'T00:00:00');
  const [hStart,hEnd] = timeWindowForMeal(type);
  const start = new Date(targetDate); start.setHours(hStart%24,0,0,0);
  const end = new Date(targetDate); end.setHours(hEnd%24,0,0,0);
  const postEnd = new Date(end.getTime() + 3*60*60*1000); // +3h window for post

  const preList = [];
  const postList = [];

  for(const m of items){
    if(!sameDay(m.when, targetDate)) continue;

    // explicit context wins
    const mt = m.ctx.mealType || m.ctx.forMeal;
    const tmg = m.ctx.timing;
    const mealMatch = !mt || mt===type;

    if(mealMatch && (tmg==='قبل' || tmg==='pre')){
      preList.push(m);
      continue;
    }
    if(mealMatch && (tmg==='بعد' || tmg==='post')){
      postList.push(m);
      continue;
    }

    // implicit window based classification
    if(m.when>=start && m.when<end){
      preList.push(m);
    }else if(m.when>=end && m.when<=postEnd){
      postList.push(m);
    }
  }

  function fillSelect(sel, list){
    if(!sel) return;
    list.sort((a,b)=>b.when-a.when);
    for(const m of list){
      const opt=document.createElement('option');
      opt.value = String(round1(m.val));
      opt.textContent = `${round1(m.val)} ${childData?.glucoseUnit||'mg/dL'} (${m.labelTime})`;
      sel.appendChild(opt);
    }
  }
  fillSelect(preReadingEl, preList);
  fillSelect(postReadingEl, postList);
}

/* ============ Totals & Doses ============ */
function usedCarbs(){
  const totalC=items.reduce((a,r)=>a+r.calc.carbs,0);
  const totalF=items.reduce((a,r)=>a+r.calc.fiber,0);
  const net=Math.max(0,totalC-totalF);
  return useNetCarbsEl?.checked ? net : totalC;
}
function recalcAll(){
  const totalG=items.reduce((a,r)=>a+r.grams,0);
  const totalC=items.reduce((a,r)=>a+r.calc.carbs,0);
  const totalF=items.reduce((a,r)=>a+r.calc.fiber,0);
  const totalCal=items.reduce((a,r)=>a+r.calc.cal,0);
  const totalP=items.reduce((a,r)=>a+r.calc.prot,0);
  const totalFat=items.reduce((a,r)=>a+r.calc.fat,0);
  const totalGL=items.reduce((a,r)=>a+(r.calc.gl||0),0);
  const net=Math.max(0,totalC-totalF);

  tGramsEl && (tGramsEl.textContent=round1(totalG));
  tCarbsEl && (tCarbsEl.textContent=round1(totalC));
  tFiberEl && (tFiberEl.textContent=round1(totalF));
  tNetCarbsEl && (tNetCarbsEl.textContent=round1(net));
  tCalEl && (tCalEl.textContent=round1(totalCal));
  tProtEl && (tProtEl.textContent=round1(totalP));
  tFatEl && (tFatEl.textContent=round1(totalFat));
  tGLEl && (tGLEl.textContent=round1(totalGL));

  const {min,max}=getTargetRangeForType(mealTypeEl?.value||'فطار');
  const used=usedCarbs();
  let pct=0; if(max>0) pct=Math.min(100,Math.max(0,(used/max)*100));
  carbProgress && (carbProgress.style.width=`${pct}%`);
  carbStateEl && (carbStateEl.textContent=(!min&&!max)?'—':(used<min?'أقل من الهدف':(used>max?'أعلى من الهدف':'داخل النطاق')));

  // Suggested (informational)
  const ratio=Number(childData?.carbRatio)||0;
  if(ratio>0){
    const dose=used/ratio;
    suggestedDoseEl && (suggestedDoseEl.textContent=round1(dose));
    doseExplainEl && (doseExplainEl.textContent=`${round1(used)}g ÷ ${ratio}`);
    doseRangeEl && (doseRangeEl.textContent=`${round1(Math.max(0,dose-0.5))}–${round1(dose+0.5)} U`);
  }else{
    suggestedDoseEl && (suggestedDoseEl.textContent='0');
    doseExplainEl && (doseExplainEl.textContent='');
    doseRangeEl && (doseRangeEl.textContent='—');
  }

  computeAutoDoses(); // updates doses
}

/* Auto doses with manual override — correction in CHILD'S UNIT vs upper target */
function computeAutoDoses(){
  const ratio=Number(childData?.carbRatio)||0;
  const cf=Number(childData?.correctionFactor)||0;
  const unit = childData?.glucoseUnit || 'mg/dL'; // stay in child's unit

  const used=usedCarbs();
  const carbDose = ratio>0 ? used/ratio : 0;

  // Pre reading: manual first, then select
  const preManual=(preReadingManualEl && preReadingManualEl.value!=='') ? Number(preReadingManualEl.value) : null;
  const pre = (preManual!=null) ? preManual : (preReadingEl?.value ? Number(preReadingEl.value) : NaN);

  const targetUpper = getTargetUpper();

  let corrDose = 0;
  if(cf>0 && Number.isFinite(pre) && pre > targetUpper){
    corrDose = (pre - targetUpper) / cf;  // child's unit math (mmol/L or mg/dL)
  }

  const total = (carbDose + corrDose);

  if(!manualCarb && carbDoseEl)  carbDoseEl.value  = round1(carbDose);
  if(!manualCorr && corrDoseEl)  corrDoseEl.value  = round1(corrDose);
  if(!manualTotal && totalDoseEl) totalDoseEl.value = round1(total);

  if(appliedDoseEl && !appliedDoseEl.dataset.touched){
    appliedDoseEl.value = round1(total);
  }
}

/* ============ Save ============ */
async function saveMeal(){
  if(!mealsCol){ toast('لم يتم تحميل الطفل','error'); return; }
  const preManual=(preReadingManualEl && preReadingManualEl.value!=='') ? Number(preReadingManualEl.value) : null;
  const preVal = preManual!=null ? preManual : (preReadingEl?.value?Number(preReadingEl.value):null);
  const payload={
    date: mealDateEl?.value || todayISO(),
    type: mealTypeEl?.value || 'فطار',
    templateName: (templateNameEl?.value || null),
    items,
    preReading: preVal,
    postReading: postReadingEl?.value?Number(postReadingEl.value):null,
    netCarbsMode: !!useNetCarbsEl?.checked,
    autoCarbDose: Number(carbDoseEl?.value)||0,
    autoCorrDose: Number(corrDoseEl?.value)||0,
    autoTotalDose: Number(totalDoseEl?.value)||0,
    suggestedDose: Number(suggestedDoseEl?.textContent)||0,
    appliedDose: appliedDoseEl?.value!=='' ? Number(appliedDoseEl.value) : null,
    notes: (mealNotesEl?.value||'').trim() || null,
    doseRationale: {
      usedCarbs: usedCarbs(),
      ratio: Number(childData?.carbRatio)||null,
      correctionFactor: Number(childData?.correctionFactor)||null,
      cfUnit: childData?.glucoseUnit || 'mg/dL',
      targetUpper: getTargetUpper(),
      preReading: preVal,
      unit: childData?.glucoseUnit || 'mg/dL'
    },
    createdAt: serverTimestamp()
  };
  await addDoc(mealsCol,payload);
  toast('تم حفظ الوجبة ✔️','success');
}

/* ============ Presets (parent-owned) ============ */
function cleanItemForPreset(it){
  return {
    itemId: it.itemId || null, name: it.name, brand: it.brand||null,
    unit: it.unit, qty: toNum(it.qty), measure: it.measure||null, grams: toNum(it.grams),
    per100: {...it.per100}, measures: Array.isArray(it.measures)?it.measures:[]
  };
}
async function saveCurrentAsPreset(){
  try{
    if(!presetsCol){ toast('لم يتم تهيئة مسار القوالب','error'); return; }
    const type = mealTypeEl?.value || 'فطار';
    if(!items.length){ toast('لا توجد عناصر لحفظها كقالب','info'); return; }
    const title = prompt('اسم الوجبة الجاهزة؟', `${type} - ${new Date().toLocaleDateString('ar-EG')}`);
    if(!title) return;

    const presetDoc = { type, title, items: items.map(cleanItemForPreset), createdAt: serverTimestamp() };
    await addDoc(presetsCol, presetDoc);
    toast('تم حفظ الوجبة كوجبة جاهزة ✅','success');
    await loadPresets(type);
  }catch(e){ console.error(e); toast('تعذّر حفظ القالب','error'); }
}
async function loadPresets(type){
  try{
    if(!presetsCol) return;
    const snap=await getDocs(query(presetsCol, orderBy('createdAt','desc'), limit(100)));
    const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
    presetsCache = arr;
    const list = arr.filter(p=> (p.type||'') === type);
    renderPresetList(list);
  }catch(e){ console.error(e); toast('تعذّر تحميل القوالب','error'); }
}
function renderPresetList(list){
  const empty=$('presetEmpty');
  if(!presetGrid) return;
  if(!list.length){ presetGrid.innerHTML=''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');
  presetGrid.innerHTML = list.map(p=>`
    <div class="pick" data-id="${esc(p.id)}">
      <div class="t">
        <div class="n">${esc(p.title||'قالب')}</div>
        <div class="m">${(p.items?.slice(0,3)||[]).map(i=>`<span class="chip">${esc(i.name)}</span>`).join(' ')}${(p.items?.length>3)?' + المزيد':''}</div>
        <div class="flags"><span class="badge">${esc(p.type||'—')}</span></div>
      </div>
      <div><button class="btn btn--ghost use">استخدام</button></div>
    </div>
  `).join('');

  presetGrid.querySelectorAll('.pick .use').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id = btn.closest('.pick')?.dataset?.id;
      const p = presetsCache.find(x=>x.id===id);
      if(!p) return;
      items = (p.items||[]).map(it=>({
        id:crypto.randomUUID(),
        itemId:it.itemId||null, name:it.name, brand:it.brand||null,
        unit:it.unit||'grams', qty:toNum(it.qty)||1, measure:it.measure||null, grams:toNum(it.grams)||0,
        per100:{...it.per100}, measures:Array.isArray(it.measures)?it.measures:[],
        calc:{carbs:0,fiber:0,cal:0,prot:0,fat:0,gl:0}
      }));
      // fill templateName
      if(templateNameEl) templateNameEl.value = p.title || '';
      renderItems(); recalcAll();
      presetModal?.classList.add('hidden'); document.body.style.overflow='';
      toast('تم استيراد القالب','success');
    });
  });
}
async function repeatLastMealByType(){
  try{
    const type = mealTypeEl?.value || 'فطار';
    const snap = await getDocs(query(mealsCol, orderBy('date','desc'), limit(20)));
    let last=null; snap.forEach(d=>{ const x=d.data(); if(!last && x?.type===type) last=x; });
    if(!last || !Array.isArray(last.items) || !last.items.length){ toast('لا توجد وجبة سابقة لهذا النوع','info'); return; }
    items = last.items.map(it=>({
      id:crypto.randomUUID(),
      itemId:it.itemId, name:it.name, brand:it.brand||null,
      unit:it.unit||'grams', qty:toNum(it.qty)||1, measure:it.measure||null, grams:toNum(it.grams)||0,
      per100:{...it.per100}, measures:Array.isArray(it.measures)?it.measures:[],
      calc:{carbs:0,fiber:0,cal:0,prot:0,fat:0,gl:0}
    }));
    renderItems(); recalcAll(); toast('تم تكرار آخر وجبة من نفس النوع','success');
  }catch(e){ console.error(e); toast('تعذّر تكرار الوجبة','error'); }
}

/* ============ AI dictionary (simple) ============ */
const AI_DICT = [
  { kw: ['أرز','رز','rice'],        tag: '#حبوب',   q: 'أرز' },
  { kw: ['توست','خبز','bread'],     tag: '#حبوب',   q: 'توست' },
  { kw: ['تفاح','apple'],           tag: '#فاكهة',  q: 'تفاح' },
  { kw: ['زبادي','yogurt','رايب'], tag: '#ألبان',  q: 'زبادي' },
  { kw: ['بيض','egg'],              tag: '#ألبان',  q: 'بيض' },
  { kw: ['شوفان','oat'],            tag: '#حبوب',   q: 'شوفان' },
];
function aiSuggestFromText(text){
  text = (text||'').toLowerCase();
  const picks=[];
  for(const e of AI_DICT){
    if(e.kw.some(k=>text.includes(k.toLowerCase()))){
      const found = foodCache.find(f=> f.name.includes(e.q) || f.tags?.includes(e.tag?.slice(1)));
      if(found) picks.push(found);
    }
  }
  return [...new Set(picks)];
}

/* ============ Auto-Tuner (Adjust to range) ============ */
function carbDensityOfRow(r){ return (r.per100?.carbs||0) / 100; }
function gramsStep(r){
  if(Array.isArray(r.measures) && r.measures.length){
    const min = r.measures.reduce((m,x)=> Math.min(m, Number(x.grams)||Infinity), Infinity);
    return Number.isFinite(min) ? min : 5;
  }
  return 5;
}
function proposeAdjustments(severity='balanced'){
  plannedChanges.length=0;
  const {min,max}=getTargetRangeForType(mealTypeEl?.value||'فطار');
  if(!max && !min){ toast('لا يوجد هدف محدد لهذه الوجبة','info'); return []; }

  const used = usedCarbs();
  const deltaAbove = used - (max||used);
  const deltaBelow = (min||used) - used;

  const prefs = childData?.preferences || {};

  const sim = items.map(r=>({ ...r, grams:r.grams, unit:r.unit, qty:r.qty, measure:r.measure }));

  function applyChange(row, gramsDelta){
    const step = gramsStep(row);
    let g = row.grams + gramsDelta;
    g = Math.max(0, Math.round(g/step)*step);
    const change = g - row.grams;
    if(change===0) return 0;
    plannedChanges.push({ id:row.id, name:row.name, changeGrams:change, reason: gramsDelta<0?'📉 تقليل':'➕ زيادة' });
    row.grams = g;
    if(row.unit==='grams'){ row.qty = g; }
    else{
      const meas = (row.measures||[]).find(m=>m.name===row.measure) || (row.measures||[])[0];
      const per = meas? Number(meas.grams)||gramsStep(row) : gramsStep(row);
      row.qty = per? round1(g/per) : row.qty;
      if(!row.measure && meas) row.measure=meas.name;
    }
    return change;
  }

  if(deltaAbove > 0){
    const ordered = sim.slice().sort((a,b)=>{
      const d = carbDensityOfRow(b) - carbDensityOfRow(a);
      if(d!==0) return d;
      return ((prefs[b.itemId]==='dislike'?1:0) - (prefs[a.itemId]==='dislike'?1:0));
    });
    let remaining = deltaAbove;
    const factor = severity==='light'? 0.5 : (severity==='balanced'? 1.0 : 1.5);
    while(remaining>0.1){
      let progressed=false;
      for(const r of ordered){
        const dens = carbDensityOfRow(r); if(dens<=0) continue;
        const stepG = gramsStep(r);
        const carbStep = stepG * dens;
        if(carbStep<=0.01) continue;
        const targetCarbDelta = Math.min(remaining, carbStep * factor);
        const gDelta = - Math.max(stepG, Math.round((targetCarbDelta/dens)/stepG)*stepG);
        const done = applyChange(r, gDelta);
        if(done!==0){ remaining -= Math.abs(done)*dens; progressed=true; if(remaining<=0.1) break; }
      }
      if(!progressed) break;
    }
  }else if(deltaBelow > 0){
    const ordered = sim.slice().sort((a,b)=>{
      const d = carbDensityOfRow(a) - carbDensityOfRow(b); if(d!==0) return d;
      return ((prefs[a.itemId]==='like'?-1:0) - (prefs[b.itemId]==='like'?-1:0));
    });
    let remaining = deltaBelow;
    const factor = severity==='light'? 0.5 : (severity==='balanced'? 1.0 : 1.5);
    while(remaining>0.1){
      let progressed=false;
      for(const r of ordered){
        const dens = carbDensityOfRow(r); if(dens<=0) continue;
        const stepG = gramsStep(r);
        const carbStep = stepG * dens;
        const targetCarbDelta = Math.min(remaining, carbStep * factor);
        const gDelta = + Math.max(stepG, Math.round((targetCarbDelta/dens)/stepG)*stepG);
        const done = applyChange(r, gDelta);
        if(done!==0){ remaining -= Math.abs(done)*dens; progressed=true; if(remaining<=0.1) break; }
      }
      if(!progressed) break;
    }
  }

  tunerList.innerHTML = plannedChanges.length
    ? plannedChanges.map(ch=>`<div>• <b>${esc(ch.name)}</b> ${ch.reason} <b>${round1(ch.changeGrams)} جم</b></div>`).join('')
    : `<div class="muted">لا تغييرات مقترحة—قد تكون داخل النطاق بالفعل.</div>`;

  return sim;
}
function openTuner(){
  proposeAdjustments(tunerSeveritySel?.value||'balanced');
  tunerModal?.classList.remove('hidden'); document.body.style.overflow='hidden';
  tunerApplyBtn.onclick = ()=>{
    if(!plannedChanges.length){ tunerModal.classList.add('hidden'); document.body.style.overflow=''; return; }
    const byId = Object.fromEntries(items.map(r=>[r.id,r]));
    for(const ch of plannedChanges){
      const r = byId[ch.id]; if(!r) continue;
      const step = gramsStep(r);
      let g = r.grams + ch.changeGrams;
      g = Math.max(0, Math.round(g/step)*step);
      r.grams = g;
      if(r.unit==='grams'){ r.qty=g; }
      else{
        const meas = (r.measures||[]).find(m=>m.name===r.measure) || (r.measures||[])[0];
        const per = meas? Number(meas.grams)||gramsStep(r) : gramsStep(r);
        r.qty = per? round1(g/per) : r.qty;
        if(!r.measure && meas) r.measure=meas.name;
      }
    }
    plannedChanges.length=0;
    tunerModal.classList.add('hidden'); document.body.style.overflow='';
    renderItems(); recalcAll();
  };
  tunerCancelBtn.onclick = ()=>{ tunerModal.classList.add('hidden'); document.body.style.overflow=''; };
}

/* ============ What-If preview (no apply) ============ */
function updateWhatIf(){
  const pct = Number(whatIfSlider?.value||0);
  if(whatIfValue) whatIfValue.textContent = `${pct>0?'+':''}${pct}%`;
  const used = usedCarbs();
  const target = used * (1 + pct/100);
  toast(`What-If: من ${round1(used)}g إلى ${round1(target)}g (معاينة فقط)`);
}

/* ============ Export CSV ============ */
function exportCSV(){
  const rows = [
    ['Name','Unit','Qty','Measure','Grams','Carbs','Fiber','Net Carbs','Calories','Protein','Fat','GL'].join(','),
    ...items.map(r=>{
      const carbs=round1(r.calc.carbs), fiber=round1(r.calc.fiber);
      const net = round1(Math.max(0,carbs - fiber));
      return [
        `"${(r.name||'').replace(/"/g,'""')}"`,
        r.unit, r.qty, `"${(r.measure||'').replace(/"/g,'""')}"`,
        round1(r.grams), carbs, fiber, net,
        round1(r.calc.cal), round1(r.calc.prot), round1(r.calc.fat), round1(r.calc.gl||0)
      ].join(',');
    })
  ];
  const blob = new Blob([rows.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`meal-${mealTypeEl?.value||'نوع'}-${mealDateEl?.value||todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ============ Export Excel (.xlsx) ============ */
async function ensureXLSX(){
  if(window.XLSX) return window.XLSX;
  await new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=resolve; s.onerror=()=>reject(new Error('فشل تحميل XLSX'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}
async function exportXLSX(){
  try{
    const XLSX = await ensureXLSX();
    const type = mealTypeEl?.value || 'نوع';
    const date = mealDateEl?.value || todayISO();
    const unit = (childData?.glucoseUnit || 'mg/dL');

    // Sheet 1: Meal Items
    const header = ['Name','Unit','Qty','Measure','Grams','Carbs (g)','Fiber (g)','Net Carbs (g)','Calories (kcal)','Protein (g)','Fat (g)','GL'];
    const rows = items.map(r=>{
      const carbs=round1(r.calc.carbs), fiber=round1(r.calc.fiber);
      const net = round1(Math.max(0,carbs - fiber));
      return [r.name||'', r.unit, toNum(r.qty), r.measure||'', round1(r.grams), carbs, fiber, net, round1(r.calc.cal), round1(r.calc.prot), round1(r.calc.fat), round1(r.calc.gl||0)];
    });
    const aoa1 = [header, ...rows];
    const ws1 = XLSX.utils.aoa_to_sheet(aoa1);
    ws1['!cols'] = [{wch:22},{wch:10},{wch:8},{wch:16},{wch:10},{wch:12},{wch:12},{wch:14},{wch:14},{wch:12},{wch:10},{wch:8}];

    // Sheet 2: Summary
    const {min,max}=getTargetRangeForType(type);
    const grossCarbs = items.reduce((a,r)=>a+r.calc.carbs,0);
    const fiber = items.reduce((a,r)=>a+r.calc.fiber,0);
    const netCarbs = Math.max(0,grossCarbs - fiber);
    const used = useNetCarbsEl?.checked ? netCarbs : grossCarbs;

    const totalG=items.reduce((a,r)=>a+r.grams,0);
    const totalCal=items.reduce((a,r)=>a+r.calc.cal,0);
    const totalP=items.reduce((a,r)=>a+r.calc.prot,0);
    const totalFat=items.reduce((a,r)=>a+r.calc.fat,0);
    const totalGL=items.reduce((a,r)=>a+(r.calc.gl||0),0);

    const targetUpper = getTargetUpper();
    const cfUnit = unit;

    const preManual=(preReadingManualEl && preReadingManualEl.value!=='') ? Number(preReadingManualEl.value) : null;
    const pre = (preManual!=null) ? preManual : (preReadingEl?.value?Number(preReadingEl.value):null);

    const carbDose = toNum(carbDoseEl?.value)||0;
    const corrDose = toNum(corrDoseEl?.value)||0;
    const totalDose = toNum(totalDoseEl?.value)||0;
    const applied = appliedDoseEl?.value!=='' ? Number(appliedDoseEl.value) : null;

    const aoa2 = [
      ['Child', childData?.displayName || childData?.name || '—'],
      ['Date', date],
      ['Meal Type', type],
      ['Template Name', (templateNameEl?.value||'') || '—'],
      ['Goal (g)', (min||0)+' - '+(max||0)],
      ['Used Carbs (g)', round1(used) + (useNetCarbsEl?.checked ? ' (net)' : ' (gross)')],
      ['Total Grams', round1(totalG)],
      ['Total Carbs (g)', round1(grossCarbs)],
      ['Total Fiber (g)', round1(fiber)],
      ['Net Carbs (g)', round1(netCarbs)],
      ['Calories (kcal)', round1(totalCal)],
      ['Protein (g)', round1(totalP)],
      ['Fat (g)', round1(totalFat)],
      ['GL', round1(totalGL)],
      [],
      ['Dosing'],
      ['CR (g/U)', Number(childData?.carbRatio)||'—'],
      [`CF (${cfUnit}/U)`, Number(childData?.correctionFactor)||'—'],
      [`Target Upper (${cfUnit})`, round1(targetUpper)],
      ['Pre-Reading', pre!=null ? `${round1(pre)} ${cfUnit}` : '—'],
      ['Carb Dose (U)', round1(carbDose)],
      ['Correction Dose (U)', round1(corrDose)],
      ['Total Dose (U)', round1(totalDose)],
      ['Applied Dose (U)', applied!=null ? round1(applied) : '—'],
      [],
      ['Notes', (mealNotesEl?.value||'').trim()]
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2['!cols'] = [{wch:32},{wch:40}];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Meal Items');
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    XLSX.writeFile(wb, `meal-${type}-${date}.xlsx`);
  }catch(e){
    console.error(e);
    toast('تعذّر تصدير Excel','error');
  }
}

/* ============ Events ============ */
function wireEvents(){
  addItemBtn?.addEventListener('click',async()=>{ await ensureFoodCache(); pickSearchEl&&(pickSearchEl.value=''); pickCategoryEl&&(pickCategoryEl.value='الكل'); openPicker(); });
  closePicker?.addEventListener('click',closePickerModal);
  pickSearchEl?.addEventListener('input',renderPicker);
  pickCategoryEl?.addEventListener('change',renderPicker);
  hideAllergyEl?.addEventListener('change',renderPicker);
  hideDietEl?.addEventListener('change',renderPicker);

  repeatLastBtn?.addEventListener('click',repeatLastMealByType);

  saveMealBtn?.addEventListener('click',saveMeal);
  resetMealBtn?.addEventListener('click',()=>{ items=[]; renderItems(); recalcAll(); manualCarb=manualCorr=manualTotal=false; if(carbDoseEl) carbDoseEl.value=''; if(corrDoseEl) corrDoseEl.value=''; if(totalDoseEl) totalDoseEl.value=''; if(appliedDoseEl) {appliedDoseEl.value=''; appliedDoseEl.dataset.touched='';} if(mealNotesEl) mealNotesEl.value=''; });
  printDayBtn?.addEventListener('click',()=>window.print());
  exportCsvBtn?.addEventListener('click',exportCSV);
  exportXlsxBtn?.addEventListener('click',exportXLSX);

  mealTypeEl?.addEventListener('change',()=>{ applyTargets(); loadMeasurementsOptions().then(computeAutoDoses); });
  mealDateEl?.addEventListener('change',()=>{ loadMeasurementsOptions().then(computeAutoDoses); });
  useNetCarbsEl?.addEventListener('change',recalcAll);
  preReadingEl?.addEventListener('change',computeAutoDoses);
  preReadingManualEl?.addEventListener('input',computeAutoDoses);
  postReadingEl?.addEventListener('change',()=>{}); // reserved

  aiBtn?.addEventListener('click',()=>{ aiModal?.classList.remove('hidden'); document.body.style.overflow='hidden'; aiResults.innerHTML=''; aiApply.disabled=true; });
  aiClose?.addEventListener('click',()=>{ aiModal?.classList.add('hidden'); document.body.style.overflow=''; });
  aiAnalyze?.addEventListener('click',async ()=>{
    await ensureFoodCache();
    const text = aiText.value;
    const sugg = aiSuggestFromText(text);
    if(!sugg.length){ aiResults.innerHTML='<div class="muted">لم أجد عناصر مطابقة—جرّب كلمات أوضح.</div>'; aiApply.disabled=true; return; }
    aiResults.innerHTML = sugg.map(s=>`<div class="chip">${esc(s.name)}</div>`).join(' ');
    aiApply.disabled=false;
    aiApply.onclick = ()=>{ sugg.forEach(addRowFromFood); aiModal.classList.add('hidden'); document.body.style.overflow=''; };
  });

  presetBtn?.addEventListener('click', ()=>{
    presetModal?.classList.remove('hidden'); document.body.style.overflow='hidden';
    const t=mealTypeEl?.value||'فطار';
    presetTabs.forEach(x=>x.classList.toggle('active', x.dataset.type===t));
    loadPresets(t);
  });
  presetClose?.addEventListener('click', ()=>{ presetModal?.classList.add('hidden'); document.body.style.overflow=''; });
  qa('.preset-tabs .tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      qa('.preset-tabs .tab').forEach(x=>x.classList.remove('active'));
      tab.classList.add('active'); loadPresets(tab.dataset.type);
    });
  });
  $('presetSaveBtn')?.addEventListener('click', saveCurrentAsPreset);

  if(!$('tunerOpenBtn')){
    const b=document.createElement('button'); b.id='tunerOpenBtn'; b.className='btn btn--ghost'; b.textContent='🔧 تعديل للنطاق';
    (q('.goals__top')||q('.container')).appendChild(b);
    b.addEventListener('click', openTuner);
  }else{
    $('tunerOpenBtn').addEventListener('click', openTuner);
  }

  tunerSeveritySel?.addEventListener('change', ()=> proposeAdjustments(tunerSeveritySel.value));
  whatIfSlider?.addEventListener('input', updateWhatIf);
  whatIfResetBtn?.addEventListener('click', ()=>{ whatIfSlider.value=0; updateWhatIf(); });

  carbDoseEl?.addEventListener('input',()=>{ manualCarb = true; const t = round1(toNum(carbDoseEl?.value)+toNum(corrDoseEl?.value)); if(!manualTotal && totalDoseEl) totalDoseEl.value = Number.isFinite(t)? t : 0; });
  corrDoseEl?.addEventListener('input',()=>{ manualCorr = true; const t = round1(toNum(carbDoseEl?.value)+toNum(corrDoseEl?.value)); if(!manualTotal && totalDoseEl) totalDoseEl.value = Number.isFinite(t)? t : 0; });
  totalDoseEl?.addEventListener('input',()=>{ manualTotal = true; });
  appliedDoseEl?.addEventListener('input',()=>{ appliedDoseEl.dataset.touched = '1'; });

  // Save shortcut
  window.addEventListener('keydown', (e)=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveMeal(); }
  });
}

/* ============ Boot ============ */
async function boot(user){
  ensureBasicSkeleton();
  currentUser=user;
  await loadChild(user.uid);
  if(mealDateEl && !mealDateEl.value) mealDateEl.value=todayISO();
  await ensureFoodCache();
  await loadMeasurementsOptions();
  wireEvents();
  renderItems(); recalcAll();
}

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  try{ await boot(user); }catch(e){ console.error(e); toast('حدث خطأ غير متوقع','error'); }
});

function stopFoodSubscriptions(){
  try{ if(window._unsubAdmin){ window._unsubAdmin(); window._unsubAdmin=null; } }catch(_){}
  try{ if(window._unsubTop){ window._unsubTop(); window._unsubTop=null; } }catch(_){}
}
window.addEventListener('beforeunload', stopFoodSubscriptions);
