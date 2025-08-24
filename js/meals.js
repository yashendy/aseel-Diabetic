// js/meals.js (modular, v5) — GL badge لكل صنف + مساعد AI نصّي محلي

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ========= عناصر عامة ========= */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const toastEl       = document.getElementById('toast');
const childNameEl   = document.getElementById('childName');
const childMetaEl   = document.getElementById('childMeta');

const mealDateEl    = document.getElementById('mealDate');
const mealTypeEl    = document.getElementById('mealType');
const preReadingEl  = document.getElementById('preReading');
const postReadingEl = document.getElementById('postReading');

const itemsBodyEl   = document.getElementById('itemsBody');
const addItemBtn    = document.getElementById('addItemBtn');
const repeatLastBtn = document.getElementById('repeatLastBtn');
const backBtn       = document.getElementById('backBtn');

const tGramsEl = document.getElementById('tGrams');
const tCarbsEl = document.getElementById('tCarbs');
const tCalEl   = document.getElementById('tCal');
const tProtEl  = document.getElementById('tProt');
const tFatEl   = document.getElementById('tFat');
const tGLEl    = document.getElementById('tGL');

const suggestedDoseEl = document.getElementById('suggestedDose');
const doseExplainEl   = document.getElementById('doseExplain');
const doseRangeEl     = document.getElementById('doseRange');
const appliedDoseEl   = document.getElementById('appliedDose');
const mealNotesEl     = document.getElementById('mealNotes');

const saveMealBtn     = document.getElementById('saveMealBtn');
const resetMealBtn    = document.getElementById('resetMealBtn');
const printDayBtn     = document.getElementById('printDayBtn');

const tableDateEl     = document.getElementById('tableDate');
const filterTypeEl    = document.getElementById('filterType');
const mealsListEl     = document.getElementById('mealsList');
const noMealsEl       = document.getElementById('noMeals');

/* مودال الأصناف */
const pickerModal     = document.getElementById('pickerModal');
const closePicker     = document.getElementById('closePicker');
const pickSearchEl    = document.getElementById('pickSearch');
const pickCategoryEl  = document.getElementById('pickCategory');
const pickerGrid      = document.getElementById('pickerGrid');
const pickerEmpty     = document.getElementById('pickerEmpty');

/* مودال AI نصّي */
const aiBtn     = document.getElementById('aiBtn');
const aiModal   = document.getElementById('aiModal');
const aiClose   = document.getElementById('aiClose');
const aiText    = document.getElementById('aiText');
const aiAnalyze = document.getElementById('aiAnalyze');
const aiApply   = document.getElementById('aiApply');
const aiResultsEl = document.getElementById('aiResults');

/* ========= حالة ========= */
let currentUser, childData;
let editingMealId = null;
let currentItems = [];
let cachedFood = [];
let cachedMeasurements = [];
let lastUsedMap = {};
let aiSuggestions = [];

/* ========= أدوات ========= */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); }
setMaxToday(mealDateEl);

function esc(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function toNumber(x){ const n = Number(String(x ?? '').replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round((x||0)*10)/10; }
function roundHalf(x){ return Math.round((x||0)*2)/2; }
function showToast(msg){ toastEl.innerHTML = `<div class="msg">${esc(msg)}</div>`; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 2000); }

const SLOT_MAP = {
  'فطور': { pre:'ق.الفطار', post:'ب.الفطار', window:[{s:'04:30',e:'09:30'}] },
  'غداء': { pre:'ق.الغدا',  post:'ب.الغدا',  window:[{s:'11:00',e:'15:30'}] },
  'عشاء': { pre:'ق.العشا',  post:'ب.العشا',  window:[{s:'17:00',e:'21:30'}] },
  'سناك': { pre:'سناك',     post:'سناك',     window:[{s:'00:00',e:'23:59'}] }
};
const SLOTS_ORDER = ["الاستيقاظ","ق.الفطار","ب.الفطار","ق.الغدا","ب.الغدا","ق.العشا","ب.العشا","سناك","ق.النوم","أثناء النوم","ق.الرياضة","ب.الرياضة"];

/* GL levels */
function glLevel(gl){
  if (gl < 10) return {cls:'low',    text:'منخفض'};
  if (gl < 20) return {cls:'medium', text:'متوسط'};
  return {cls:'high',  text:'مرتفع'};
}
function ensureGLBadge(){
  if (!tGLEl) return null;
  let badge = document.getElementById('tGLBadge');
  if (!badge){
    badge = document.createElement('span');
    badge.id = 'tGLBadge';
    badge.className = 'gl-badge';
    (tGLEl.parentElement||tGLEl).appendChild(badge);
  }
  return badge;
}
function updateGLBadge(totalGL){
  const b = ensureGLBadge(); if(!b) return;
  const {cls,text} = glLevel(totalGL||0);
  b.className = `gl-badge ${cls}`;
  b.textContent = text;
}

/* ========= تهيئة ========= */
(function init(){
  mealDateEl.value = todayStr();
  tableDateEl.textContent = mealDateEl.value;
  backBtn.addEventListener('click', ()=> history.back());
})();

/* ========= جلسة + طفل ========= */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `${childData.gender || '-'} • العمر: ${calcAge(childData.birthDate)} سنة`;

  lastUsedMap = loadLastUsed();
  await loadMeasurements();
  await loadMealsOfDay();
  loadDraft();
  recalcAll();
});

function calcAge(bd){
  if(!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

/* ========= القياسات ========= */
async function loadMeasurements(){
  const d = mealDateEl.value;
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, where('date','==', d), orderBy('when','asc'));
  const snap= await getDocs(qy);
  cachedMeasurements = [];
  snap.forEach(s=>{
    const m = s.data();
    const when = m.when?.toDate ? m.when.toDate() : (m.when ? new Date(m.when) : null);
    const mmol = m.value_mmol ?? ((m.value_mgdl||0)/18);
    cachedMeasurements.push({
      id: s.id, slot: m.slot || '-', when,
      value_mmol: Number(mmol || 0), value_mgdl: m.value_mgdl ?? Math.round((mmol||0)*18)
    });
  });
  populateReadingSelects();
}

function populateReadingSelects(){
  const type = mealTypeEl.value;
  const pref  = SLOT_MAP[type]?.pre || null;
  const postf = SLOT_MAP[type]?.post || null;
  const win   = SLOT_MAP[type]?.window?.[0];

  const sorted = [...cachedMeasurements].sort((a,b)=>{
    const ia = SLOTS_ORDER.indexOf(a.slot);
    const ib = SLOTS_ORDER.indexOf(b.slot);
    if (ia!==ib) return ia-ib;
    const ta = a.when ? a.when.getTime() : 0;
    const tb = b.when ? b.when.getTime() : 0;
    return ta - tb;
  });

  const build = (prefSlot)=>{
    const opts = ['<option value="">— لا يوجد —</option>'];
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (prefSlot && m.slot===prefSlot && inWindow(m.when, win)){ opts.push(`<option value="${m.id}">${esc(label)} (مفضّل)</option>`); }
    });
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (inWindow(m.when, win) && (!prefSlot || m.slot!==prefSlot)){ opts.push(`<option value="${m.id}">${esc(label)}</option>`); }
    });
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (!inWindow(m.when, win)){ opts.push(`<option value="${m.id}">${esc(label)} (خارج النطاق)</option>`); }
    });
    return opts.join('');
  };

  preReadingEl.innerHTML  = build(pref);
  postReadingEl.innerHTML = build(postf);
}

function inWindow(dateObj, win){
  if(!dateObj || !win) return true;
  const [h,m] = [dateObj.getHours(), dateObj.getMinutes()];
  const cur = h*60+m;
  const [sh,sm] = win.s.split(':').map(Number);
  const [eh,em] = win.e.split(':').map(Number);
  const start = sh*60+sm, end = eh*60+em;
  return cur>=start && cur<=end;
}

/* ========= وجبات اليوم ========= */
async function loadMealsOfDay(){
  const d = mealDateEl.value;
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
  const snap = await getDocs(query(ref, where('date','==', d), orderBy('createdAt','asc')));
  const rows = []; snap.forEach(s=> rows.push({ id:s.id, ...s.data() }));
  renderMealsList(rows);
}

function renderMealsList(rows){
  const typeFilter = filterTypeEl.value || 'الكل';
  const list = typeFilter==='الكل' ? rows : rows.filter(r=> (r.type||'')===typeFilter);

  mealsListEl.innerHTML = '';
  if(!list.length){ noMealsEl.classList.remove('hidden'); return; }
  noMealsEl.classList.add('hidden');

  list.forEach(r=>{
    const card = document.createElement('div');
    card.className = 'meal-card';
    const doseWarn = r.suggestedMealDose && r.appliedMealDose!=null && Math.abs(r.appliedMealDose - r.suggestedMealDose) >= 1.5;
    card.innerHTML = `
      <div class="type">${esc(r.type||'-')}</div>
      <div>كارب: <strong>${round1(r.totals?.carbs_g||0)}</strong> g • سعرات: ${Math.round(r.totals?.cal_kcal||0)} kcal</div>
      <div>جرعة مقترحة: <span class="dose-badge ${doseWarn?'danger':''}">${r.suggestedMealDose ?? '-' } U</span> ${r.appliedMealDose!=null?`• المعطاة: <strong>${r.appliedMealDose}</strong> U`:''}</div>
      <div>${r.preReading?.id?`ق.الوجبة ✔️`:'ق.الوجبة —'} ${r.postReading?.id?` • ب.الوجبة ✔️`:''}</div>
      <div class="actions">
        <button class="editBtn">تعديل</button>
        <button class="delBtn secondary">حذف</button>
      </div>
    `;
    card.querySelector('.editBtn').addEventListener('click', ()=> editMeal(r));
    card.querySelector('.delBtn').addEventListener('click', ()=> deleteMeal(r));
    mealsListEl.appendChild(card);
  });
}

/* ========= عناصر الوجبة ========= */
function addItemRow(itemDoc){
  const lastQty = lastUsedMap[itemDoc.id]?.qty ?? 100;
  const gi = toNumber(itemDoc?.gi) || null;
  const row = {
    itemId: itemDoc.id,
    name: itemDoc.name,
    brand: itemDoc.brand || null,
    unit: 'grams',
    qty: lastQty,
    measure: null,
    grams: lastQty,
    per100: {
      carbs: toNumber(itemDoc?.nutrPer100g?.carbs_g),
      cal:   toNumber(itemDoc?.nutrPer100g?.cal_kcal),
      prot:  toNumber(itemDoc?.nutrPer100g?.protein_g),
      fat:   toNumber(itemDoc?.nutrPer100g?.fat_g)
    },
    gi,
    calc:{carbs:0,cal:0,prot:0,fat:0,gl:0},
    measures: Array.isArray(itemDoc.measures) ? itemDoc.measures.filter(m=>m.name && m.grams>0) : []
  };
  currentItems.push(row);
  renderItems(); recalcAll(); saveDraft();
}

function renderItems(){
  itemsBodyEl.innerHTML = '';
  currentItems.forEach((r, idx)=>{
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `
      <div class="name">
        <div>
          <strong>${esc(r.name)}</strong>${r.brand?` <span class="sub">(${esc(r.brand)})</span>`:''}
          ${r.gi!=null?` <span class="sub">• GI: ${r.gi}</span>`:''}
        </div>
        <div class="chips">
          <span class="gl-chip" data-chip="gl">GL: —</span>
        </div>
      </div>
      <div>
        <select class="unit">
          <option value="grams" ${r.unit==='grams'?'selected':''}>جرام</option>
          <option value="household" ${r.unit==='household'?'selected':''}>تقدير بيتي</option>
        </select>
      </div>
      <div><input type="number" step="any" class="qty" value="${r.qty}" min="0" max="10000"></div>
      <div>
        <select class="measure">
          ${r.measures.map(m=>`<option value="${esc(m.name)}" ${r.measure===m.name?'selected':''}>${esc(m.name)} (${m.grams} جم)</option>`).join('')}
        </select>
      </div>
      <div><span class="grams">${round1(r.grams)}</span></div>
      <div><span class="carbs">${round1(r.calc.carbs)}</span></div>
      <div><span class="cal">${Math.round(r.calc.cal)}</span></div>
      <div><span class="prot">${round1(r.calc.prot)}</span></div>
      <div><span class="fat">${round1(r.calc.fat)}</span></div>
      <div><button class="del">حذف</button></div>
    `;

    const unitSel = div.querySelector('.unit');
    const qtyInp  = div.querySelector('.qty');
    const measSel = div.querySelector('.measure');
    const delBtn  = div.querySelector('.del');

    measSel.disabled = (r.unit !== 'household');
    if (r.unit==='household' && !r.measure && r.measures.length) r.measure = r.measures[0].name;

    unitSel.addEventListener('change', ()=>{
      r.unit = unitSel.value;
      if (r.unit==='grams'){ r.measure = null; }
      else if (r.unit==='household' && r.measures.length && !r.measure){ r.measure = r.measures[0].name; }
      recomputeRow(r, div); renderItems(); recalcAll(); saveDraft();
    });

    qtyInp.addEventListener('input', ()=>{
      r.qty = Math.max(0, Math.min(10000, toNumber(qtyInp.value)));
      recomputeRow(r, div); recalcAll(); saveDraft();
    });

    measSel.addEventListener('change', ()=>{
      r.measure = measSel.value || null;
      recomputeRow(r, div); recalcAll(); saveDraft();
    });

    delBtn.addEventListener('click', ()=>{
      currentItems.splice(idx,1);
      renderItems(); recalcAll(); saveDraft();
    });

    recomputeRow(r, div);
    itemsBodyEl.appendChild(div);
  });
}

function recomputeRow(r, div){
  let grams = 0;
  if (r.unit==='grams'){ grams = r.qty; }
  else {
    const m = r.measures.find(x=> x.name===r.measure);
    grams = m ? (r.qty * m.grams) : 0;
  }
  r.grams = grams;
  r.calc.carbs = (r.per100.carbs * grams)/100;
  r.calc.cal   = (r.per100.cal   * grams)/100;
  r.calc.prot  = (r.per100.prot  * grams)/100;
  r.calc.fat   = (r.per100.fat   * grams)/100;
  r.calc.gl    = r.gi ? (r.gi * (r.calc.carbs/100)) : 0;

  if (div){
    div.querySelector('.grams').textContent = round1(r.grams);
    div.querySelector('.carbs').textContent = round1(r.calc.carbs);
    div.querySelector('.cal').textContent   = Math.round(r.calc.cal);
    div.querySelector('.prot').textContent  = round1(r.calc.prot);
    div.querySelector('.fat').textContent   = round1(r.calc.fat);

    // تحديث GL chip
    const chip = div.querySelector('[data-chip="gl"]');
    if (chip){
      const {cls,text} = glLevel(r.calc.gl||0);
      chip.className = `gl-chip ${cls}`;
      chip.textContent = `GL: ${round1(r.calc.gl)} — ${text}`;
    }

    const measSel = div.querySelector('.measure');
    if (measSel) measSel.disabled = (r.unit!=='household');
  }
}

/* ========= الجرعة + GL الإجمالي ========= */
function recalcAll(){
  const totals = currentItems.reduce((a,r)=>{
    a.grams += r.grams||0;
    a.carbs += r.calc.carbs||0;
    a.cal   += r.calc.cal||0;
    a.prot  += r.calc.prot||0;
    a.fat   += r.calc.fat||0;
    a.gl    += r.calc.gl||0;
    return a;
  }, {grams:0,carbs:0,cal:0,prot:0,fat:0,gl:0});

  tGramsEl.textContent = round1(totals.grams);
  tCarbsEl.textContent = round1(totals.carbs);
  tCalEl.textContent   = Math.round(totals.cal);
  tProtEl.textContent  = round1(totals.prot);
  tFatEl.textContent   = round1(totals.fat);
  if (tGLEl){ tGLEl.textContent = round1(totals.gl); updateGLBadge(totals.gl); }

  const carbRatio = Number(childData?.carbRatio || 12);
  const mealDose = totals.carbs>0 ? (totals.carbs / carbRatio) : 0;

  let corr = 0, explain = `carbs ${round1(totals.carbs)} / CR ${carbRatio}`;
  const preId = preReadingEl.value;
  if (preId){
    const pre = cachedMeasurements.find(m=> m.id===preId);
    const mmol = pre?.value_mmol || 0;
    const nMax = Number(childData?.normalRange?.max ?? 7.8);
    const CF   = Number(childData?.correctionFactor || 0);
    if (CF>0 && mmol>nMax){
      corr = (mmol - nMax)/CF;
      explain += ` + ((pre ${mmol.toFixed(1)} - ${nMax}) / CF ${CF})`;
    }
  }
  const totalDose = roundHalf(mealDose + corr);
  suggestedDoseEl.textContent = Number.isFinite(totalDose) ? (totalDose.toFixed(1).replace('.0','')) : '0';
  doseExplainEl.textContent = `= ${mealDose.toFixed(2)} + ${corr.toFixed(2)} ⇒ تقريب ${totalDose.toFixed(1)}`;

  const range = computeDoseRange(totals.carbs, carbRatio, preId);
  doseRangeEl.textContent = range ? `${range.min}–${range.max} U` : '—';
}

function computeDoseRange(carbs, CR, preId){
  if(!(carbs>0) || !(CR>0)) return null;
  let corr=0;
  if (preId){
    const pre = cachedMeasurements.find(m=> m.id===preId);
    const mmol = pre?.value_mmol || 0;
    const target = Number(childData?.normalRange?.max ?? 7.8);
    const CF = Number(childData?.correctionFactor || 0);
    if(CF>0 && mmol>target) corr = (mmol-target)/CF;
  }
  const low  = roundHalf( (carbs*0.9)/CR + corr );
  const high = roundHalf( (carbs*1.1)/CR + corr );
  const min = Math.max(0, Math.min(low, high));
  const max = Math.max(low, high);
  return { min: Number(min.toFixed(1)), max: Number(max.toFixed(1)) };
}

/* ========= حفظ/تعديل/حذف ========= */
saveMealBtn.addEventListener('click', saveMeal);
resetMealBtn.addEventListener('click', ()=> resetForm(false));
printDayBtn.addEventListener('click', ()=> window.print());
filterTypeEl.addEventListener('change', async ()=>{ await loadMealsOfDay(); });

mealTypeEl.addEventListener('change', ()=>{ populateReadingSelects(); recalcAll(); saveDraft(); });
mealDateEl.addEventListener('change', async ()=>{
  if (mealDateEl.value > todayStr()){ mealDateEl.value = todayStr(); }
  tableDateEl.textContent = mealDateEl.value;
  await loadMeasurements();
  await loadMealsOfDay();
  loadDraft();
  recalcAll();
});
preReadingEl.addEventListener('change', ()=>{ recalcAll(); saveDraft(); });
postReadingEl.addEventListener('change', ()=>{ saveDraft(); });

async function saveMeal(){
  if (!currentItems.length){ alert('أضف عنصرًا واحدًا على الأقل'); return; }
  const date = mealDateEl.value;
  if (!date || date>todayStr()){ alert('اختر تاريخًا صحيحًا (ليس مستقبلًا)'); return; }

  setBusy(saveMealBtn, true);

  const items = currentItems.map(r=> ({
    itemId: r.itemId, name: r.name, brand: r.brand || null,
    unit: r.unit, qty: Number(r.qty)||0, measure: r.measure || null,
    grams: round1(r.grams || 0),
    carbs_g: round1(r.calc.carbs || 0),
    cal_kcal: Math.round(r.calc.cal || 0),
    protein_g: round1(r.calc.prot || 0),
    fat_g: round1(r.calc.fat || 0),
    gi: r.gi || null,
    gl: round1(r.calc.gl || 0)
  }));

  const totals = {
    grams: round1(items.reduce((a,i)=>a+i.grams,0)),
    carbs_g: round1(items.reduce((a,i)=>a+i.carbs_g,0)),
    cal_kcal: Math.round(items.reduce((a,i)=>a+i.cal_kcal,0)),
    protein_g: round1(items.reduce((a,i)=>a+i.protein_g,0)),
    fat_g: round1(items.reduce((a,i)=>a+i.fat_g,0)),
    gl: round1(items.reduce((a,i)=>a+i.gl,0))
  };

  items.forEach(i=> { lastUsedMap[i.itemId]={ qty:i.qty, ts:Date.now() }; });
  saveLastUsed(lastUsedMap);

  const payload = {
    date,
    type: mealTypeEl.value,
    items,
    totals,
    preReading: preReadingEl.value ? { id: preReadingEl.value } : null,
    postReading: postReadingEl.value ? { id: postReadingEl.value } : null,
    suggestedMealDose: Number(suggestedDoseEl.textContent) || 0,
    appliedMealDose: appliedDoseEl.value ? Number(appliedDoseEl.value) : null,
    notes: mealNotesEl.value?.trim() || null,
    updatedAt: serverTimestamp()
  };

  try{
    const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
    if (editingMealId){
      await updateDoc(doc(ref, editingMealId), payload);
      showToast('✅ تم تحديث الوجبة');
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(ref, payload);
      showToast('✅ تم حفظ الوجبة');
      saveLastMealTemplate(mealTypeEl.value, payload);
    }
    await loadMealsOfDay();
    resetForm(false);
    clearDraft();
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ');
  }finally{
    setBusy(saveMealBtn, false);
  }
}

function resetForm(restoreType=true){
  editingMealId = null;
  currentItems = [];
  itemsBodyEl.innerHTML = '';
  if (restoreType){ mealTypeEl.value = 'فطور'; }
  appliedDoseEl.value = '';
  mealNotesEl.value = '';
  preReadingEl.value = '';
  postReadingEl.value = '';
  recalcAll();
  clearDraft();
}

function editMeal(r){
  editingMealId = r.id;
  mealDateEl.value = r.date || todayStr();
  mealTypeEl.value = r.type || 'فطور';
  tableDateEl.textContent = mealDateEl.value;

  loadMeasurements().then(()=>{
    preReadingEl.value  = r.preReading?.id || '';
    postReadingEl.value = r.postReading?.id || '';
  });

  currentItems = (r.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: {
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0
    },
    gi: i.gi ?? null,
    calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, gl: i.gl||0},
    measures: []
  }));

  Promise.all(currentItems.map(async (row)=>{
    if (!row.itemId) return;
    const d = await getDoc(doc(db, `parents/${currentUser.uid}/foodItems/${row.itemId}`));
    if (d.exists()){
      const item = d.data();
      row.measures = Array.isArray(item.measures)? item.measures.filter(m=>m.name && m.grams>0) : [];
    }
  })).then(()=>{
    renderItems(); recalcAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function deleteMeal(r){
  if(!confirm('هل تريد حذف هذه الوجبة؟')) return;
  try{
    await deleteDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/meals/${r.id}`));
    showToast('🗑️ تم حذف الوجبة');
    await loadMealsOfDay();
  }catch(e){
    console.error(e);
    alert('تعذر حذف الوجبة');
  }
}

function setBusy(btn, busy){
  btn.disabled = !!busy;
  btn.textContent = busy ? 'جارٍ الحفظ…' : 'حفظ الوجبة';
}

/* ========= مودال الأصناف ========= */
addItemBtn.addEventListener('click', openPicker);
closePicker.addEventListener('click', ()=> pickerModal.classList.add('hidden'));
pickSearchEl.addEventListener('input', debounce(applyPickerFilters, 250));
pickCategoryEl.addEventListener('change', applyPickerFilters);
repeatLastBtn.addEventListener('click', repeatLastMealTemplate);

function openPicker(){
  pickerModal.classList.remove('hidden');
  pickSearchEl.value=''; pickCategoryEl.value='الكل';
  loadFoodItems();
}

async function loadFoodItems(){
  const ref = collection(db, `parents/${currentUser.uid}/foodItems`);
  const snap = await getDocs(query(ref, orderBy('nameLower','asc')));
  cachedFood = [];
  snap.forEach(d=> cachedFood.push({ id:d.id, ...d.data() }));
  applyPickerFilters();
}

function applyPickerFilters(){
  const q = (pickSearchEl.value||'').trim();
  const cat = pickCategoryEl.value;

  let list = [...cachedFood];
  if (cat!=='الكل'){ list = list.filter(x=> (x.category||'')===cat); }

  if (q.startsWith('#') && q.length>1){
    const tag = q.slice(1).toLowerCase();
    list = list.filter(x=> Array.isArray(x.tags) && x.tags.some(t=> String(t).toLowerCase()===tag));
  } else if (q){
    const token = q.toLowerCase();
    list = list.filter(x=>{
      return (x.name||'').toLowerCase().includes(token)
          || (x.brand||'').toLowerCase().includes(token)
          || (x.category||'').toLowerCase().includes(token)
          || (Array.isArray(x.tags)&&x.tags.some(t=> String(t).toLowerCase().includes(token)))
          || (Array.isArray(x.keywords)&&x.keywords.includes(token));
    });
  }

  renderPicker(list);
}

function renderPicker(list){
  pickerGrid.innerHTML = '';
  if(!list.length){ pickerEmpty.classList.remove('hidden'); return; }
  pickerEmpty.classList.add('hidden');

  list.forEach(x=>{
    const div = document.createElement('div');
    div.className = 'pick-card';
    const thumb = x.imageUrl ? `<img src="${esc(x.imageUrl)}" alt="">` : `<span class="pick-thumb">🍽️</span>`;
    const giTag = (x.gi!=null) ? `<span class="badge">GI: ${x.gi}</span>` : '';
    div.innerHTML = `
      <div class="pick-thumb">${thumb}</div>
      <div class="pick-meta">
        <div><strong>${esc(x.name)}</strong> ${x.brand?`<small>(${esc(x.brand)})</small>`:''}</div>
        <div class="badges">
          <span class="badge">${esc(x.category||'-')}</span>
          <span class="badge">ك/100g: ${x?.nutrPer100g?.carbs_g||0}</span>
          ${giTag}
          ${(x.tags||[]).slice(0,3).map(t=>`<span class="badge">#${esc(t)}</span>`).join('')}
        </div>
        <div class="pick-actions">
          <button class="secondary addBtn">إضافة</button>
        </div>
      </div>
    `;
    div.querySelector('.addBtn').addEventListener('click', ()=>{
      addItemRow({
        id:x.id,
        name:x.name, brand:x.brand||null,
        nutrPer100g: x.nutrPer100g||{carbs_g:0,cal_kcal:0,protein_g:0,fat_g:0},
        measures: Array.isArray(x.measures)? x.measures : [],
        gi: x.gi ?? null
      });
      pickerModal.classList.add('hidden');
    });
    pickerGrid.appendChild(div);
  });
}

/* ========= تكرار آخر وجبة ========= */
function saveLastMealTemplate(type, payload){
  const key = `lastMealTemplate:${currentUser?.uid||'u'}:${childId||'c'}:${type}`;
  localStorage.setItem(key, JSON.stringify({ items: payload.items || [], type }));
}
function repeatLastMealTemplate(){
  const key = `lastMealTemplate:${currentUser?.uid||'u'}:${childId||'c'}:${mealTypeEl.value||'فطور'}`;
  const raw = localStorage.getItem(key);
  if(!raw){ showToast('لا توجد وجبة محفوظة لهذا النوع'); return; }
  try{
    const d = JSON.parse(raw);
    currentItems = (d.items||[]).map(i=>({
      itemId: i.itemId, name: i.name, brand: i.brand || null,
      unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
      grams: Number(i.grams)||0,
      per100: {
        carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
        cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
        prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
        fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0
      },
      gi: i.gi ?? null,
      calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, gl: i.gl||0},
      measures: []
    }));
    renderItems(); recalcAll(); saveDraft();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }catch(_){ showToast('تعذر استرجاع القالب'); }
}

/* ========= كاش آخر كميات ========= */
function loadLastUsed(){
  const key = `lastUsedQty:${currentUser?.uid||'u'}:${childId||'c'}`;
  try{ return JSON.parse(localStorage.getItem(key)||'{}'); }catch(_){ return {}; }
}
function saveLastUsed(map){
  const key = `lastUsedQty:${currentUser?.uid||'u'}:${childId||'c'}`;
  localStorage.setItem(key, JSON.stringify(map||{}));
}

/* ========= مساعد AI النصّي (محلي) ========= */

// فتح/إغلاق
aiBtn?.addEventListener('click', async ()=>{
  aiModal.classList.remove('hidden');
  aiText.focus();
  if (!cachedFood.length) await loadFoodItems(); // للتطابق
});
aiClose?.addEventListener('click', ()=> aiModal.classList.add('hidden'));

// تحليل النص
aiAnalyze?.addEventListener('click', ()=>{
  const text = aiText.value.trim();
  aiSuggestions = parseMealText(text);
  renderAISuggestions();
  aiApply.disabled = aiSuggestions.length===0;
});

// تطبيق المقترحات
aiApply?.addEventListener('click', ()=>{
  aiSuggestions.forEach(s=>{
    addItemRow({
      id: s.item.id,
      name: s.item.name,
      brand: s.item.brand||null,
      nutrPer100g: s.item.nutrPer100g||{carbs_g:0,cal_kcal:0,protein_g:0,fat_g:0},
      measures: Array.isArray(s.item.measures)? s.item.measures : [],
      gi: s.item.gi ?? null
    });
    // عدّل الكمية/الوحدة بعد الإضافة
    const row = currentItems[currentItems.length-1];
    row.unit = s.unit;
    row.qty = s.qty;
    row.measure = s.measure;
  });
  renderItems(); recalcAll(); saveDraft();
  aiModal.classList.add('hidden');
});

// ---- دوال التحليل البسيطة (بدون إنترنت) ----
function normalizeArabic(s){
  return (s||'').toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g,'') // إزالة الحركات
    .replace(/[اأإآ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه')
    .replace(/[٠-٩]/g, d=> '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}
const FRACTIONS = { 'نصف':0.5, 'نص':0.5, 'ربع':0.25, 'ثلث':1/3 };
const COMMON_UNITS = ['جرام','جم','غ','g','مل','ml','ملي','ملليلتر','كوب','نصف كوب','ربع كوب','ملعقه','ملعقة','م.ك','ملعقه كبيره','ملعقه صغيره','شريحه','شريحتين','حبه','حبة'];

function parseMealText(text){
  if(!text) return [];
  const parts = text.split(/[,+؛]| و /).map(p=>p.trim()).filter(Boolean);
  const suggestions = [];

  const food = cachedFood.map(x=> ({
    ...x, _nameN: normalizeArabic(x.name||''),
    _tagsN: (x.tags||[]).map(t=> normalizeArabic(t||'')),
    _brandN: normalizeArabic(x.brand||'')
  }));

  parts.forEach(p=>{
    const pN = normalizeArabic(p);
    // رقم
    let qty = toNumber((p.match(/(\d+([.,]\d+)?)/)||[])[0]);
    // كسور لفظية
    Object.entries(FRACTIONS).forEach(([k,v])=>{
      if (pN.includes(k)) qty = qty? qty+v : v;
    });
    if (!qty) qty = 1;

    // وحدة
    let unit = 'grams';
    let measureName = null;
    if (/(جرام|جم|غ|g)\b/.test(pN)) unit='grams';
    if (/((كوب|نصف كوب|ربع كوب)|ملعقه كبيره|ملعقه صغيره|ملعقه|ملعقة|شريحه|حبه)/.test(pN)) unit='household';

    // اسم تقريبي
    const nameGuess = pN.replace(/(\d+([.,]\d+)?)/g,'')
      .replace(/(جرام|جم|غ|g|مل|ml|ملي|ملليلتر|كوب|نصف كوب|ربع كوب|ملعقه كبيره|ملعقه صغيره|ملعقه|ملعقة|شريحه|حبه)/g,'')
      .replace(/\b(من|ارز|الابيض|الابيضه|صغيره|كبيره)\b/g,' ').trim();

    // أفضل تطابق من المكتبة
    let best = null, bestScore = 0;
    food.forEach(it=>{
      let s=0;
      if (it._nameN.includes(nameGuess)) s+=3;
      if (nameGuess.includes(it._nameN)) s+=3;
      if (it._brandN && nameGuess.includes(it._brandN)) s+=1;
      if (Array.isArray(it._tagsN) && it._tagsN.some(t=> nameGuess.includes(t))) s+=1;
      if (s>bestScore){ bestScore=s; best=it; }
    });
    if (!best || bestScore===0) return;

    // اختيار مقياس منزلي لو ذكر في النص
    if (unit==='household' && Array.isArray(best.measures)){
      const m = best.measures.find(m=> normalizeArabic(m.name) && pN.includes(normalizeArabic(m.name)));
      measureName = m ? m.name : (best.measures[0]?.name || null);
    }

    suggestions.push({
      part:p, qty, unit,
      measure: unit==='household'? measureName : null,
      item: best,
      note: bestScore>=3 ? 'ok' : 'weak'
    });
  });

  return suggestions;
}

function renderAISuggestions(){
  aiResultsEl.innerHTML = '';
  if (!aiSuggestions.length){
    aiResultsEl.innerHTML = `<div class="empty">لم أجد أصنافًا مطابقة. جرّبي أسماء أوضح أو اضيفي الأصناف للمكتبة أولًا.</div>`;
    return;
  }
  aiSuggestions.forEach(s=>{
    const div = document.createElement('div');
    div.className = 'ai-card';
    div.innerHTML = `
      <div class="title">${esc(s.item.name)} ${s.item.brand?`<small>(${esc(s.item.brand)})</small>`:''}</div>
      <div class="meta">من النص: <em>${esc(s.part)}</em></div>
      <div class="meta">الوحدة: <strong>${s.unit==='grams'?'جرام':'تقدير بيتي'}</strong> • الكمية: <strong>${s.qty}</strong> ${s.unit==='household'&&s.measure?`• المقياس: <strong>${esc(s.measure)}</strong>`:''}</div>
      <div class="${s.note==='ok'?'ok':'warn'}">${s.note==='ok'?'تطابق جيد':'تطابق تقريبي'}</div>
    `;
    aiResultsEl.appendChild(div);
  });
}

/* ========= أدوات عامة ========= */
function debounce(fn, ms=250){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
