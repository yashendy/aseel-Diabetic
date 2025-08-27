// js/meals.js (v5)
// إضافة: AI Chat + Auto Adjust للهدف، وتحسين مودال الأصناف (متناسق ومتمركز)

//////////////// عناصر عامة //////////////////
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const toastWrap     = document.getElementById('toast');
const toastMsg      = toastWrap?.querySelector('.msg') || toastWrap;
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

// مودال الأصناف
const pickerModal     = document.getElementById('pickerModal');
const closePicker     = document.getElementById('closePicker');
const pickSearchEl    = document.getElementById('pickSearch');
const pickCategoryEl  = document.getElementById('pickCategory');
const pickerGrid      = document.getElementById('pickerGrid');
const pickerEmpty     = document.getElementById('pickerEmpty');

// الضبط التلقائي
const autoAdjustBtn   = document.getElementById('autoAdjustBtn');
const adjustModal     = document.getElementById('adjustModal');
const closeAdjust     = document.getElementById('closeAdjust');
const cancelAdjustBtn = document.getElementById('cancelAdjustBtn');
const applyAdjustBtn  = document.getElementById('applyAdjustBtn');
const adjustDiffEl    = document.getElementById('adjustDiff');

// AI Chat
const aiChatBtn   = document.getElementById('aiChatBtn');
const aiWidget    = document.getElementById('aiWidget');
const aiClose     = document.getElementById('aiClose');
const aiMessages  = document.getElementById('aiMessages');
const aiInput     = document.getElementById('aiInput');
const aiSend      = document.getElementById('aiSend');
const aiContext   = document.getElementById('aiContext');
const quickBtns   = document.querySelectorAll('.ai-quick-btn');

//////////////// حالة //////////////////
let currentUser, childData;
let editingMealId = null;
let currentItems = [];
let cachedFood = [];
let cachedMeasurements = [];
let lastUsedMap = {};
let cachedTemplates = [];
let pendingAdjust = null; // diff preview

//////////////// أدوات //////////////////
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); }
setMaxToday(mealDateEl);

function esc(s){
  return (s||'').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}
function toNumber(x){ const n = Number(String(x ?? '').replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round((x||0)*10)/10; }
function roundHalf(x){ return Math.round((x||0)*2)/2; }
function showToast(msg){ if(!toastWrap) return; toastMsg.textContent = msg; toastWrap.classList.remove('hidden'); setTimeout(()=>toastWrap.classList.add('hidden'), 2000); }
function slotToMealType(ar){
  if(!ar) return 'سناك';
  if(ar.includes('فطار')) return 'فطور';
  if(ar.includes('غدا'))  return 'غداء';
  if(ar.includes('عشا'))  return 'عشاء';
  if(ar.includes('سناك')) return 'سناك';
  return 'سناك';
}
function typeIcon(type){
  switch(type){
    case 'فطور': return '🍳';
    case 'غداء': return '🍛';
    case 'عشاء': return '🍲';
    case 'سناك': return '🍎';
    default:     return '🍱';
  }
}
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

//////////////// جلسة المستخدم //////////////////
firebase.auth().onAuthStateChanged(async (user)=>{
  if(!user){ location.href='index.html'; return; }
  currentUser = user;
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }

  mealDateEl.value = todayStr();
  tableDateEl.textContent = mealDateEl.value;

  backBtn.addEventListener('click', ()=>{
    location.href = `child.html?child=${encodeURIComponent(childId)}`;
  });

  addItemBtn.addEventListener('click', openPicker);
  closePicker.addEventListener('click', ()=> pickerModal.classList.add('hidden'));
  repeatLastBtn.addEventListener('click', repeatLastMealTemplate);

  mealDateEl.addEventListener('change', ()=>{
    tableDateEl.textContent = mealDateEl.value;
    loadMealsOfDay();
  });
  filterTypeEl.addEventListener('change', loadMealsOfDay);

  // AI
  aiChatBtn?.addEventListener('click', openAIWidget);
  aiClose?.addEventListener('click', closeAIWidget);
  aiSend?.addEventListener('click', sendAI);
  aiInput?.addEventListener('keydown', e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAI();}});
  quickBtns.forEach(b=>b.addEventListener('click',()=>{ aiInput.value=b.dataset.q||''; aiInput.focus(); }));

  // ضبط تلقائي
  autoAdjustBtn?.addEventListener('click', autoAdjustFlow);
  closeAdjust?.addEventListener('click', ()=>adjustModal.classList.add('hidden'));
  cancelAdjustBtn?.addEventListener('click', ()=>adjustModal.classList.add('hidden'));
  applyAdjustBtn?.addEventListener('click', applyAdjustDiff);

  await loadChild();
  await loadMeasurementsWindow();
  await loadFoodLibrary();
  await loadTemplates();
  await loadMealsOfDay();
});

async function loadChild(){
  const ref = firebase.firestore().doc(`parents/${currentUser.uid}/children/${childId}`);
  const snap = await ref.get();
  if(!snap.exists){ alert('الطفل غير موجود'); history.back(); return; }
  childData = snap.data();
  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `${childData.gender||'-'} • العمر: ${calcAge(childData.birthDate)} سنة`;
}
function calcAge(bd){ if(!bd) return '-'; const b=new Date(bd),t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; }

//////////////// القياسات //////////////////
function inWindow(d, [a,b]){ if(!(d instanceof Date)) return false; const x=d.getTime(); return x>=a.getTime() && x<=b.getTime(); }
function windowForDayStr(day){ const t = new Date(day + 'T00:00:00'); const a = new Date(t); const b = new Date(t); b.setDate(b.getDate()+1); b.setMilliseconds(b.getMilliseconds()-1); return [a,b]; }

async function loadMeasurementsWindow(){
  const win = windowForDayStr(mealDateEl.value);
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/measurements`);
  const snap = await ref.get();
  cachedMeasurements = [];
  snap.forEach(s=>{
    const d = s.data();
    const when = d.when ? d.when.toDate?.() : null;
    cachedMeasurements.push({
      id:s.id, slot:d.slotKey || d.slot || d.slotKeyAr || d.slot_ar, value_mmol: d.value_mmol ?? (d.value_mgdl? (d.value_mgdl/18):null), when
    });
  });
  buildReadingsDropdowns(win);
}
function buildReadingsDropdowns(win){
  const pref = ['PRE_BREAKFAST','PRE_LUNCH','PRE_DINNER','SNACK'];
  const postf= ['POST_BREAKFAST','POST_LUNCH','POST_DINNER'];
  const sorted = [...cachedMeasurements].sort((a,b)=> (a.when?.getTime()||0) - (b.when?.getTime()||0));
  const inWin = m => inWindow(m.when, win);

  const build = (prefer)=> {
    const opts = [`<option value="">—</option>`];
    sorted.forEach(m=>{
      const label = `${m.slot||'-'} • ${ (m.value_mmol??0).toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (inWin(m) && (!prefer || prefer.includes(m.slot))) opts.push(`<option value="${m.id}">${esc(label)}</option>`);
    });
    sorted.forEach(m=>{
      const label = `${m.slot||'-'} • ${ (m.value_mmol??0).toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (!inWin(m)) opts.push(`<option value="${m.id}">${esc(label)} (خارج النطاق)</option>`);
    });
    return opts.join('');
  };
  preReadingEl.innerHTML  = build(pref);
  postReadingEl.innerHTML = build(postf);
}

//////////////// مكتبة الأصناف //////////////////
async function loadFoodLibrary(){
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/foodItems`);
  let snap;
  try{ snap = await ref.orderBy('nameLower','asc').get(); }
  catch{ snap = await ref.get(); }
  cachedFood = [];
  snap.forEach(d=> cachedFood.push(normalizeFoodDoc({ id:d.id, ...d.data() })));
  // تحضير مودال
  pickSearchEl.addEventListener('input', debounce(renderPicker,300));
  pickCategoryEl.addEventListener('change', renderPicker);
  renderPicker();
}
function normalizeFoodDoc(it){
  const carbs_g  = toNumber(it?.nutrPer100g?.carbs_g ?? it?.carbs_100g);
  const cal_kcal = toNumber(it?.nutrPer100g?.cal_kcal ?? it?.calories_100g);
  const protein_g= toNumber(it?.nutrPer100g?.protein_g ?? it?.protein_100g);
  const fat_g    = toNumber(it?.nutrPer100g?.fat_g ?? it?.fat_100g);
  const fiber_g  = toNumber(it?.nutrPer100g?.fiber_g ?? it?.fiber_100g);
  const gi       = toNumber(it?.gi ?? it?.GI); // اختياري

  let measures = [];
  if (Array.isArray(it?.measures)){
    measures = it.measures.filter(m=> m && m.name && Number(m.grams)>0)
      .map(m=> ({ name:String(m.name), grams: toNumber(m.grams) }));
  } else if (it?.householdUnits && typeof it.householdUnits==='object'){
    measures = Object.entries(it.householdUnits)
      .filter(([n,g])=> n && toNumber(g)>0)
      .map(([n,g])=> ({name:String(n), grams:toNumber(g)}));
  }
  return {
    id: it.id, name: it.name, brand: it.brand || null, category: it.category || '-',
    nutrPer100g: { carbs_g, cal_kcal, protein_g, fat_g, fiber_g }, gi,
    measures, imageUrl: it.imageUrl, autoImage: it.autoImage
  };
}
function renderPicker(){
  const q = (pickSearchEl.value||'').toLowerCase().trim();
  const cat = pickCategoryEl.value || 'الكل';
  const items = cachedFood.filter(it=>{
    const okCat = (cat==='الكل') || (it.category===cat);
    const hay = `${it.name} ${it.brand||''}`.toLowerCase();
    const okQ  = !q || hay.includes(q) || hay.includes(q.replace('#',''));
    return okCat && okQ;
  });
  pickerGrid.innerHTML = '';
  if(!items.length){ pickerEmpty.classList.remove('hidden'); return; }
  pickerEmpty.classList.add('hidden');

  items.forEach(it=>{
    const card = document.createElement('div');
    card.className = 'pick-card';
    const thumbHTML = it.imageUrl && String(it.autoImage)!=='true'
      ? `<img src="${esc(it.imageUrl)}" alt="">`
      : `<div class="pick-thumb-emoji">${categoryIcon(it.category)}</div>`;

    card.innerHTML = `
      <div class="pick-thumb">${thumbHTML}</div>
      <div class="pick-meta">
        <div><strong>${esc(it.name)}</strong> ${it.brand?`<small>(${esc(it.brand)})</small>`:''}</div>
        <div class="badges">
          <span class="badge">${esc(it.category||'-')}</span>
          <span class="badge">كارب/100g: ${it?.nutrPer100g?.carbs_g ?? '-'}</span>
          ${it.gi? `<span class="badge">GI: ${it.gi}</span>`:''}
          ${it?.nutrPer100g?.fiber_g? `<span class="badge">ألياف/100g: ${it.nutrPer100g.fiber_g}</span>`:''}
        </div>
        <div class="pick-actions">
          <button class="chooseBtn">اختيار</button>
        </div>
      </div>
    `;
    card.querySelector('.chooseBtn').addEventListener('click', ()=>{
      lastUsedMap[it.id] = { qty: lastUsedMap[it.id]?.qty ?? 100, ts: Date.now() };
      saveLastUsed(lastUsedMap);
      addItemRow(it);
      pickerModal.classList.add('hidden');
    });

    pickerGrid.appendChild(card);
  });
}
function categoryIcon(cat){
  switch(cat){
    case 'نشويات': return '🍞';
    case 'حليب':   return '🥛';
    case 'فاكهة':  return '🍎';
    case 'خضروات': return '🥕';
    case 'لحوم':   return '🍗';
    case 'دهون':   return '🥑';
    default:        return '🍽️';
  }
}
function openPicker(){ pickerModal.classList.remove('hidden'); renderPicker(); }

//////////////// وجبات اليوم //////////////////
async function loadMealsOfDay(){
  const d = mealDateEl.value;
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/meals`);
  const snap = await ref.where('date','==', d).orderBy('createdAt','asc').get();
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

//////////////// عناصر الوجبة //////////////////
function addItemRow(itemDoc){
  const lastQty = lastUsedMap[itemDoc.id]?.qty ?? 100;
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
      fat:   toNumber(itemDoc?.nutrPer100g?.fat_g),
      fiber: toNumber(itemDoc?.nutrPer100g?.fiber_g)
    },
    gi: toNumber(itemDoc?.gi) || null,
    calc:{carbs:0,cal:0,prot:0,fat:0, fiber:0, gl:0},
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
        <div><strong>${esc(r.name)}</strong>${r.brand?` <span class="sub">(${esc(r.brand)})</span>`:''}</div>
      </div>
      <div>
        <select class="unit">
          <option value="grams" ${r.unit==='grams'?'selected':''}>جرام</option>
          <option value="household" ${r.unit==='household'?'selected':''}>منزلي</option>
        </select>
      </div>
      <div><input type="number" class="qty" step="1" value="${r.qty}"></div>
      <div>
        <select class="measure">${ (r.measures||[]).map(m=>`<option value="${m.name}" ${r.measure===m.name?'selected':''}>${esc(m.name)} (${m.grams}g)</option>`).join('') }</select>
      </div>
      <div><input type="number" class="grams" step="0.1" value="${r.grams}"></div>
      <div class="carbs">${round1(r.calc.carbs)}</div>
      <div class="cal">${Math.round(r.calc.cal)}</div>
      <div class="prot">${round1(r.calc.prot)}</div>
      <div class="fat">${round1(r.calc.fat)}</div>
      <div><button class="del">حذف</button></div>
    `;

    const unitSel = div.querySelector('.unit');
    const qtyInp  = div.querySelector('.qty');
    const msSel   = div.querySelector('.measure');
    const grInp   = div.querySelector('.grams');

    unitSel.addEventListener('change', ()=>{
      r.unit = unitSel.value;
      if(r.unit==='grams'){ r.grams = Number(qtyInp.value)||0; }
      else { // household
        const m = (r.measures||[]).find(x=>x.name===msSel.value);
        r.grams = m? Number(qtyInp.value||0)*Number(m.grams||0) : 0;
      }
      grInp.value = r.grams;
      recalcRow(r, div);
    });
    qtyInp.addEventListener('input', ()=>{
      r.qty = Number(qtyInp.value)||0;
      if(r.unit==='grams'){ r.grams = r.qty; }
      else {
        const m = (r.measures||[]).find(x=>x.name===msSel.value);
        r.grams = m? r.qty*Number(m.grams||0) : 0;
      }
      grInp.value = r.grams; recalcRow(r, div);
    });
    msSel.addEventListener('change', ()=>{
      r.measure = msSel.value || null;
      if(r.unit==='household'){
        const m = (r.measures||[]).find(x=>x.name===r.measure);
        r.grams = m? r.qty*Number(m.grams||0) : 0;
        grInp.value = r.grams;
      }
      recalcRow(r, div);
    });
    grInp.addEventListener('input', ()=>{
      const g = Number(grInp.value)||0;
      r.grams = g;
      if(r.unit==='grams'){ r.qty = g; qtyInp.value = r.qty; }
      recalcRow(r, div);
    });
    div.querySelector('.del').addEventListener('click', ()=>{
      currentItems.splice(idx,1); renderItems(); recalcAll(); saveDraft();
    });

    itemsBodyEl.appendChild(div);
  });
}

function recalcRow(r, div){
  const carbs = r.per100.carbs * r.grams / 100;
  const cal   = r.per100.cal   * r.grams / 100;
  const prot  = r.per100.prot  * r.grams / 100;
  const fat   = r.per100.fat   * r.grams / 100;
  const fiber = r.per100.fiber * r.grams / 100;
  const carbPerGram = (r.per100.carbs||0)/100;
  const gl = r.gi ? (r.gi * carbs / 100) : 0;

  r.calc = {carbs, cal, prot, fat, fiber, gl};
  div.querySelector('.carbs').textContent = round1(carbs);
  div.querySelector('.cal').textContent   = Math.round(cal);
  div.querySelector('.prot').textContent  = round1(prot);
  div.querySelector('.fat').textContent   = round1(fat);
  recalcAll(); saveDraft();
}

function recalcAll(){
  const sum = currentItems.reduce((a,r)=>({
    grams:(a.grams||0)+(r.grams||0),
    carbs:(a.carbs||0)+(r.calc.carbs||0),
    cal:  (a.cal||0)  +(r.calc.cal||0),
    prot: (a.prot||0) +(r.calc.prot||0),
    fat:  (a.fat||0)  +(r.calc.fat||0),
    fiber:(a.fiber||0)+(r.calc.fiber||0),
    gl:   (a.gl||0)   +(r.calc.gl||0),
  }),{});
  tGramsEl.textContent = round1(sum.grams||0);
  tCarbsEl.textContent = round1(sum.carbs||0);
  tCalEl.textContent   = Math.round(sum.cal||0);
  tProtEl.textContent  = round1(sum.prot||0);
  tFatEl.textContent   = round1(sum.fat||0);

  const CR = Number(childData?.carbRatio||0) || null;
  const dose = CR ? roundHalf((sum.carbs||0)/CR) : 0;
  suggestedDoseEl.textContent = dose || 0;
  doseExplainEl.textContent = CR ? `(CR: ${CR})` : '';
  doseRangeEl.textContent = dose ? `${Math.max(0,dose-0.5)} – ${dose+0.5} U` : '—';
}

//////////////// حفظ/تحميل الوجبة //////////////////
function asMealType(){ return slotToMealType(mealTypeEl.value); }

saveMealBtn?.addEventListener('click', async ()=>{
  const d = mealDateEl.value;
  const type = asMealType();
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/meals`);

  const payload = {
    date: d, type,
    items: currentItems.map(packItemForSave),
    totals: {
      grams_g: toNumber(tGramsEl.textContent),
      carbs_g: toNumber(tCarbsEl.textContent),
      cal_kcal: toNumber(tCalEl.textContent),
      protein_g: toNumber(tProtEl.textContent),
      fat_g: toNumber(tFatEl.textContent),
    },
    suggestedMealDose: toNumber(suggestedDoseEl.textContent) || null,
    appliedMealDose: appliedDoseEl.value? toNumber(appliedDoseEl.value) : null,
    notes: (mealNotesEl.value||'').trim() || null,
    preReading: preReadingEl.value? { id: preReadingEl.value } : null,
    postReading: postReadingEl.value? { id: postReadingEl.value } : null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if(editingMealId){
    await ref.doc(editingMealId).update(payload);
    editingMealId = null;
    showToast('تم تحديث الوجبة ✅');
  }else{
    await ref.add(payload);
    showToast('تم حفظ الوجبة ✅');
  }
  clearDraft();
  await loadMealsOfDay();
});

resetMealBtn?.addEventListener('click', ()=>{
  currentItems=[]; renderItems(); recalcAll(); clearDraft();
});

printDayBtn?.addEventListener('click', ()=> window.print());

function packItemForSave(r){
  return {
    itemId:r.itemId, name:r.name, brand:r.brand||null, unit:r.unit||'grams',
    qty:r.qty||0, measure:r.measure||null, grams:r.grams||0,
    carbs_g: round1(r.calc.carbs||0), cal_kcal: Math.round(r.calc.cal||0),
    protein_g: round1(r.calc.prot||0), fat_g: round1(r.calc.fat||0)
  };
}

//////////////// قائمة اليوم: تعديل/حذف //////////////////
function editMeal(row){
  editingMealId = row.id;
  currentItems = (row.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: {
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0,
      fiber: 0
    },
    gi: null,
    calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, fiber:0, gl:0},
    measures: []
  }));
  renderItems(); recalcAll(); saveDraft();
  window.scrollTo({ top:0, behavior:'smooth' });
}
async function deleteMeal(row){
  if(!confirm('حذف الوجبة؟')) return;
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/meals`);
  await ref.doc(row.id).delete();
  showToast('تم الحذف ✅');
  await loadMealsOfDay();
}

//////////////// قوالب الوجبات //////////////////
async function loadTemplates(){
  const type = tplTypeEl.value || 'فطور';
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/mealTemplates`);
  let snap;
  try{
    snap = await ref.where('type','==', type).orderBy('createdAt','desc').get();
  }catch(_){
    snap = await ref.where('type','==', type).get();
  }
  cachedTemplates = [];
  snap.forEach(d=> cachedTemplates.push({ id:d.id, ...d.data() }));
  renderTplGrid();
}
function renderTplGrid(){
  const tplGridEl = document.getElementById('tplGrid');
  const tplEmptyEl = document.getElementById('tplEmpty');
  tplGridEl.innerHTML = '';
  if(!cachedTemplates.length){ tplEmptyEl.classList.remove('hidden'); return; }
  tplEmptyEl.classList.add('hidden');

  cachedTemplates.forEach(t=>{
    const carbs = round1((t?.summary?.carbs_g)||0);
    const kcal  = Math.round((t?.summary?.cal_kcal)||0);
    const card  = document.createElement('div');
    card.className = 'tpl-card';
    const thumb = t.coverUrl ? `<img src="${esc(t.coverUrl)}" alt="">` : `<span>${typeIcon(t.type)}</span>`;
    card.innerHTML = `
      <div class="tpl-head">
        <div class="tpl-thumb">${thumb}</div>
        <div>
          <div><strong>${esc(t.name || t.type)}</strong></div>
          <div class="tpl-meta">
            <span class="badge">${esc(t.type)}</span>
            <span class="badge">كارب: ${carbs} g</span>
            <span class="badge">سعرات: ${kcal} kcal</span>
          </div>
        </div>
      </div>
      <div class="tpl-actions">
        <button class="applyBtn">تطبيق</button>
        <button class="delBtn secondary">حذف</button>
      </div>
    `;
    card.querySelector('.applyBtn').addEventListener('click', ()=> applyTemplate(t));
    card.querySelector('.delBtn').addEventListener('click', ()=> deleteTemplate(t));
    tplGridEl.appendChild(card);
  });
}
function applyTemplate(t){
  currentItems = (t.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: {
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0,
      fiber: 0
    },
    gi: null,
    calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, fiber:0, gl:0},
    measures: []
  }));
  renderItems(); recalcAll(); saveDraft();
  window.scrollTo({ top:0, behavior:'smooth' });
}
async function deleteTemplate(t){
  if(!confirm('حذف هذا القالب؟')) return;
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/mealTemplates`);
  await ref.doc(t.id).delete();
  showToast('تم الحذف ✅');
  await loadTemplates();
}
async function saveCurrentAsTemplate(){
  if(!currentItems.length){ showToast('أضيفي مكونات أولًا'); return; }
  const name = prompt('اسم القالب؟ (اختياري)', '');
  const type = asMealType();
  const sum = currentItems.reduce((a,r)=>({ carbs:(a.carbs||0)+(r.calc.carbs||0), cal:(a.cal||0)+(r.calc.cal||0) }),{});
  const payload = {
    name: (name||'').trim() || null,
    type,
    items: currentItems.map(packItemForSave),
    summary: { carbs_g: round1(sum.carbs||0), cal_kcal: Math.round(sum.cal||0) },
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/mealTemplates`);
  await ref.add(payload);
  showToast('تم حفظ القالب ✅');
  await loadTemplates();
}
document.getElementById('saveAsTplBtn')?.addEventListener('click', saveCurrentAsTemplate);
document.getElementById('refreshTplBtn')?.addEventListener('click', loadTemplates);

//////////////// LocalStorage //////////////////
function saveDraft(){ try{ const k=`draftMeal:${currentUser.uid}:${childId}`; localStorage.setItem(k, JSON.stringify({ items: currentItems })); }catch(_){ } }
function loadDraft(){ try{ const k=`draftMeal:${currentUser?.uid||'u'}:${childId||'c'}`; const raw = localStorage.getItem(k); if(!raw) return null; const d=JSON.parse(raw); return d?.items||null; }catch(_){ return null; } }
function clearDraft(){ try{ const k=`draftMeal:${currentUser?.uid||'u'}:${childId||'c'}`; localStorage.removeItem(k); }catch(_){} }
function saveLastMealTemplate(type, payload){ try{ const k = `tpl:lastMeal:${currentUser.uid}:${childId}:${type}`; localStorage.setItem(k, JSON.stringify({ items: payload.items })); }catch(_){ } }
function loadLastMealTemplate(type){ try{ const k = `tpl:lastMeal:${currentUser?.uid||'u'}:${childId||'c'}:${type}`; const raw = localStorage.getItem(k); return raw? JSON.parse(raw) : null; }catch(_){ return null; } }
function saveLastUsed(map){ try{ const k = `lastUsed:${currentUser.uid}:${childId}`; localStorage.setItem(k, JSON.stringify(map)); }catch(_){ } }
function loadLastUsed(){ try{ const k = `lastUsed:${currentUser?.uid||'u'}:${childId||'c'}`; const raw = localStorage.getItem(k); return raw? JSON.parse(raw) : {}; }catch(_){ return {}; } }
lastUsedMap = loadLastUsed();

//////////////// ضبط تلقائي لهدف الكارب //////////////////
function getMealCarbTarget(type){
  // يدعم مفاتيح عربية/إنجليزية
  const t = (childData?.carbTargets)||{};
  const map = {
    'فطور': t.breakfast || t.futoor || t['فطور'] || t['فطار'],
    'غداء': t.lunch     || t['غداء'],
    'عشاء': t.dinner    || t['عشاء'],
    'سناك': t.snack     || t['سناك']
  };
  const v = map[type] || null;
  if (Array.isArray(v) && v.length>=2) return { min: toNumber(v[0]), max: toNumber(v[1]) };
  if (v && typeof v==='object') return { min: toNumber(v.min), max: toNumber(v.max) };
  return { min: 0, max: Infinity };
}
function carbsPerGram(row){ return (row?.per100?.carbs||0)/100; }
function glPerGram(row){
  const cpg = carbsPerGram(row);
  return row.gi ? (row.gi * cpg) / 100 : cpg * 0.5; // تقدير بسيط لو مفيش GI
}
function autoAdjustFlow(){
  if(!currentItems.length){ showToast('أضيفي مكونات أولًا'); return; }
  const type = asMealType();
  const {min, max} = getMealCarbTarget(type);
  const totalCarb = currentItems.reduce((a,r)=>a+(r.calc.carbs||0),0);

  if (max===Infinity && min===0){
    showToast('لا يوجد هدف كارب مُحدد لهذه الوجبة'); return;
  }

  // نبني نسخة عمل
  const before = currentItems.map(r=>({...r}));
  let after = currentItems.map(r=>({...r, grams: r.grams }));

  const step = 5; // 5g لكل خطوة تعديل
  if (totalCarb > max){
    // قلل من العناصر ذات GL/جرام الأعلى
    const sorted = [...after].sort((a,b)=> glPerGram(b) - glPerGram(a));
    let carbsNow = totalCarb;
    for (const r of sorted){
      if (carbsNow <= max) break;
      const cpg = carbsPerGram(r);
      if (cpg <= 0) continue;
      while (r.grams > 10 && carbsNow > max){ // لا ننزل أقل من 10g للعنصر
        r.grams = Math.max(10, r.grams - step);
        carbsNow -= cpg * step;
      }
    }
    after = recomputeRows(after);
  } else if (totalCarb < min){
    // زود عناصر ذات GL/جرام منخفض
    const sorted = [...after]
      .filter(r=> carbsPerGram(r) > 0.01)
      .sort((a,b)=> glPerGram(a) - glPerGram(b));
    let carbsNow = totalCarb;
    for (const r of sorted){
      if (carbsNow >= min) break;
      const cpg = carbsPerGram(r);
      for (let i=0;i<50 && carbsNow < min;i++){
        r.grams += step;
        carbsNow += cpg * step;
      }
    }
    after = recomputeRows(after);
  } else {
    showToast('الوجبة بالفعل ضمن الهدف ✅'); return;
  }

  // كوّني diff للمعاينة
  const diffs = [];
  for (let i=0;i<before.length;i++){
    const a = before[i], b = after[i];
    if (!a || !b) continue;
    if (Math.abs((b.grams||0)-(a.grams||0)) >= 1){
      diffs.push({
        name: a.name,
        before: round1(a.grams||0),
        after:  round1(b.grams||0),
        delta:  round1((b.grams||0)-(a.grams||0))
      });
    }
  }
  pendingAdjust = { after, diffs, type, target: {min,max},
    sums: {
      before: sumCarbs(before),
      after : sumCarbs(after)
    }
  };
  renderAdjustPreview();
}

function sumCarbs(rows){
  const carbs = rows.reduce((a,r)=>a+(((r.per100?.carbs||0)/100)* (r.grams||0)),0);
  const gl    = rows.reduce((a,r)=>a+( (r.gi? (r.gi*((r.per100?.carbs||0)/100)*(r.grams||0))/100 : 0) ),0);
  return { carbs: round1(carbs), gl: round1(gl) };
}
function recomputeRows(rows){
  return rows.map(r=>{
    const carbs = (r.per100.carbs||0) * (r.grams||0) / 100;
    const cal   = (r.per100.cal  ||0) * (r.grams||0) / 100;
    const prot  = (r.per100.prot ||0) * (r.grams||0) / 100;
    const fat   = (r.per100.fat  ||0) * (r.grams||0) / 100;
    const fiber = (r.per100.fiber||0) * (r.grams||0) / 100;
    const gl    = r.gi ? (r.gi * carbs / 100) : 0;
    return {...r, calc:{carbs,cal,prot,fat,fiber,gl}};
  });
}
function renderAdjustPreview(){
  if(!pendingAdjust){ showToast('لا يوجد تعديلات'); return; }
  const { diffs, sums, target } = pendingAdjust;
  adjustDiffEl.innerHTML = '';

  const head = document.createElement('div');
  head.className='diff-row';
  head.innerHTML = `
    <div><strong>الهدف:</strong> ${target.min}–${target.max} g كارب</div>
    <div class="fromto">قبل: ${sums.before.carbs} g • GL≈${sums.before.gl} → بعد: ${sums.after.carbs} g • GL≈${sums.after.gl}</div>
  `;
  adjustDiffEl.appendChild(head);

  if (!diffs.length){
    const no = document.createElement('div');
    no.className='diff-row';
    no.textContent = 'لا تغييرات مطلوبة — ضمن الهدف بالفعل.';
    adjustDiffEl.appendChild(no);
  }else{
    diffs.forEach(d=>{
      const row = document.createElement('div');
      row.className='diff-row';
      row.innerHTML = `
        <div>${esc(d.name)}</div>
        <div class="fromto">${d.before} g → <strong>${d.after} g</strong> (${d.delta>0?'+':''}${d.delta} g)</div>
      `;
      adjustDiffEl.appendChild(row);
    });
  }
  adjustModal.classList.remove('hidden');
}
function applyAdjustDiff(){
  if(!pendingAdjust) return;
  // طبّقي الجرامات الجديدة
  currentItems.forEach((r,i)=>{
    const newR = pendingAdjust.after[i];
    if (newR) r.grams = newR.grams;
  });
  renderItems(); recalcAll(); saveDraft();
  adjustModal.classList.add('hidden');
  showToast('تم تطبيق الضبط ✅');
}

//////////////// AI Chat //////////////////
function openAIWidget(){
  aiMessages.innerHTML = '';
  aiContext.textContent = buildAIContextLabel();
  aiWidget.classList.remove('hidden');
}
function closeAIWidget(){ aiWidget.classList.add('hidden'); aiMessages.innerHTML=''; }
function appendMsg(role,text){const d=document.createElement('div');d.className=role==='assistant'?'msg assistant':'msg user';d.textContent=text;aiMessages.appendChild(d);aiMessages.scrollTop=aiMessages.scrollHeight;}

function buildAIContextLabel(){
  const type = asMealType();
  const carbs = tCarbsEl.textContent;
  return `سياق: ${childData?.name||'طفل'} • ${type} • كارب حالي ≈ ${carbs}g`;
}
function buildAIPrompt(userText=''){
  const type = asMealType();
  const {min,max} = getMealCarbTarget(type);
  const items = currentItems.map(r=>{
    const gi = r.gi? `, GI=${r.gi}`:``;
    const fiber = r.per100?.fiber? `, fiber/100g=${r.per100.fiber}`:``;
    return `${r.name}: ${round1(r.grams)}g, carbs=${round1(r.calc.carbs)}g${gi}${fiber}`;
  }).join('\n');

  return `
أنت مساعد تغذوي للأطفال السكّريين. اقترح تعديلات آمنة تعليمية (ليست نصيحة طبية).

الطفل:
- الاسم: ${childData?.name||'—'}
- CR: ${childData?.carbRatio ?? '—'}, CF: ${childData?.correctionFactor ?? '—'}
- وحدة القياس: ${childData?.glucoseUnit || 'mg/dL'}

هدف الكارب لهذه الوجبة (${type}): ${min}–${max} g (إن كان غير محدد تجاهله).
الوجبة الحالية (اسم، جرامات، كارب، GI/ألياف إن وجدت):
${items}

المطلوب:
- لو الكارب خارج النطاق، اقترح زيادات/تخفيضات بالجرام أو بالوحدة المنزلية (خطوات صغيرة).
- فضّل خفض العناصر عالية GL/جرام، وزيادة عناصر منخفضة GI/عالية ألياف حيث أمكن.
- أظهر الفرق على شكل نقاط: "الأرز −30g، التفاح −20g، خيار +50g".
- أعطِ بدائل اختيارية منخفضة GI.
- اختم بتحذير: "اقتراحات تعليمية لا تغني عن خطة الطبيب".

سؤال المستخدم: ${userText||'اضبط الوجبة لتكون ضمن الهدف مع GL منخفض'}
`.trim();
}

async function sendAI(){
  const text=aiInput.value.trim(); if(!text) return;
  aiInput.value=''; appendMsg('user',text);
  const wait='… جارٍ التحليل';
  appendMsg('assistant',wait);

  try{
    if(!window.GEMINI_API_KEY || !window.GoogleGenerativeAI){
      showToast('مفتاح Gemini غير مُعدّ'); return;
    }
    const genAI = new window.GoogleGenerativeAI(window.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model:'gemini-1.5-flash' });
    const prompt = buildAIPrompt(text);
    const res = await model.generateContent(prompt);
    const reply = res.response?.text?.() || 'لم يتم استلام رد.';
    // استبدلي رسالة الانتظار
    const last = aiMessages.querySelector('.msg.assistant:last-child');
    if (last && last.textContent===wait) last.remove();
    appendMsg('assistant', reply);
  }catch(e){
    console.error(e);
    showToast('تعذّر الاتصال بالذكاء');
  }
}

//////////////// مساعدة //////////////////
function repeatLastMealTemplate(){
  const tpl = loadLastMealTemplate(mealTypeEl.value);
  if(!tpl){ showToast('لا توجد وجبة محفوظة لهذا النوع بعد'); return; }
  currentItems = (tpl.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: {
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0,
      fiber: 0
    },
    gi: null,
    calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g, fiber:0, gl:0},
    measures: []
  }));
  renderItems(); recalcAll(); saveDraft();
}
