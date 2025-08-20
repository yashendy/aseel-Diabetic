// js/meals.js (compat)

// ===== عناصر عامة =====
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

// مودال
const pickerModal     = document.getElementById('pickerModal');
const closePicker     = document.getElementById('closePicker');
const pickSearchEl    = document.getElementById('pickSearch');
const pickCategoryEl  = document.getElementById('pickCategory');
const pickerGrid      = document.getElementById('pickerGrid');
const pickerEmpty     = document.getElementById('pickerEmpty');

// ===== حالة =====
let currentUser, childData;
let editingMealId = null;
let currentItems = []; // [{ itemId,name,brand,unit,qty,measure,grams,per100:{carbs,cal,prot,fat}, calc:{...}, measures:[{name,grams}] }]
let cachedFood = [];
let cachedMeasurements = [];
let lastUsedMap = {};  // (اختياري) اقتراح كميات بناءً على آخر استخدام لكل itemId

// ===== ثوابت/أدوات =====
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); }
setMaxToday(mealDateEl);

function esc(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;'); }
function toNumber(x){ const n = Number(String(x ?? '').replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round((x||0)*10)/10; }
function roundHalf(x){ return Math.round((x||0)*2)/2; }
function showToast(msg, type='info'){ toastEl.innerHTML = `<div class="msg">${esc(msg)}</div>`; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 2000); }

const SLOT_MAP = {
  'فطور': { pre:'ق.الفطار', post:'ب.الفطار', window:[{s:'04:30',e:'09:30'}] },
  'غداء': { pre:'ق.الغدا',  post:'ب.الغدا',  window:[{s:'11:00',e:'15:30'}] },
  'عشاء': { pre:'ق.العشا',  post:'ب.العشا',  window:[{s:'17:00',e:'21:30'}] },
  'سناك': { pre:'سناك',     post:'سناك',     window:[{s:'00:00',e:'23:59'}] }
};
const SLOTS_ORDER = [
  "الاستيقاظ","ق.الفطار","ب.الفطار","ق.الغدا","ب.الغدا","ق.العشا","ب.العشا","سناك","ق.النوم","أثناء النوم","ق.الرياضة","ب.الرياضة"
];

function inWindow(dateObj, win){
  if(!dateObj || !win) return true;
  const [h,m] = [dateObj.getHours(), dateObj.getMinutes()];
  const cur = h*60+m;
  const [sh,sm] = win.s.split(':').map(Number);
  const [eh,em] = win.e.split(':').map(Number);
  const start = sh*60+sm, end = eh*60+em;
  return cur>=start && cur<=end;
}

// Draft key per child+date+type
function draftKey(){ return `draft:meal:${currentUser?.uid||'u'}:${childId||'c'}:${mealDateEl.value||todayStr()}:${mealTypeEl.value||'فطور'}`; }
function saveDraft(){
  const payload = {
    items: currentItems,
    applied: appliedDoseEl.value || '',
    notes: mealNotesEl.value || '',
    preId: preReadingEl.value || '',
    postId: postReadingEl.value || ''
  };
  localStorage.setItem(draftKey(), JSON.stringify(payload));
}
function loadDraft(){
  const raw = localStorage.getItem(draftKey());
  if(!raw) return;
  try{
    const d = JSON.parse(raw);
    currentItems = Array.isArray(d.items)? d.items : [];
    appliedDoseEl.value = d.applied || '';
    mealNotesEl.value   = d.notes || '';
    renderItems(); recalcAll();
    // defer selects until measurements loaded
    setTimeout(()=>{ preReadingEl.value=d.preId||''; postReadingEl.value=d.postId||''; },100);
    showToast('تم استرجاع المسوّدة');
  }catch(_){}
}
function clearDraft(){ localStorage.removeItem(draftKey()); }

// ===== تهيئة أولية =====
(function init(){
  mealDateEl.value = todayStr();
  tableDateEl.textContent = mealDateEl.value;
})();

// ===== تحميل الجلسة والطفل =====
firebase.auth().onAuthStateChanged(async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  const childRef = firebase.firestore().doc(`parents/${user.uid}/children/${childId}`);
  const snap = await childRef.get();
  if(!snap.exists){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `${childData.gender || '-'} • العمر: ${calcAge(childData.birthDate)} سنة`;

  // آخر كميات مستخدمة
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

// ===== قياسات اليوم =====
async function loadMeasurements(){
  const d = mealDateEl.value;
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = ref.where('date','==', d).orderBy('when','asc');
  const snap= await qy.get();
  cachedMeasurements = [];
  snap.forEach(s=>{
    const m = s.data();
    const when = m.when?.toDate? m.when.toDate() : (m.when ? new Date(m.when) : null);
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

  // ترتيب القياسات
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
    // المفضلة داخل نافذة الوقت أولاً
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (prefSlot && m.slot===prefSlot && inWindow(m.when, win)){
        opts.push(`<option value="${m.id}">${esc(label)} (مفضّل)</option>`);
      }
    });
    // باقي القياسات داخل النافذة
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (inWindow(m.when, win) && (!prefSlot || m.slot!==prefSlot)){
        opts.push(`<option value="${m.id}">${esc(label)}</option>`);
      }
    });
    // خارج النافذة
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L${m.when?` • ${pad(m.when.getHours())}:${pad(m.when.getMinutes())}`:''}`;
      if (!inWindow(m.when, win)){
        opts.push(`<option value="${m.id}">${esc(label)} (خارج النطاق)</option>`);
      }
    });
    return opts.join('');
  };

  preReadingEl.innerHTML  = build(pref);
  postReadingEl.innerHTML = build(postf);
}

// ===== وجبات اليوم =====
async function loadMealsOfDay(){
  const d = mealDateEl.value;
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/meals`);
  let qy = ref.where('date','==', d).orderBy('createdAt','asc');
  const snap = await qy.get();

  const rows = [];
  snap.forEach(s=> rows.push({ id:s.id, ...s.data() }));
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

// ===== إدارة العناصر =====
function addItemRow(itemDoc){
  // اقتراح كمية من آخر استخدام
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
      fat:   toNumber(itemDoc?.nutrPer100g?.fat_g)
    },
    calc:{carbs:0,cal:0,prot:0,fat:0},
    measures: Array.isArray(itemDoc.measures) ? itemDoc.measures.filter(m=>m.name && m.grams>0) : []
  };
  currentItems.push(row);
  renderItems();
  recalcAll();
  saveDraft();
}

function renderItems(){
  itemsBodyEl.innerHTML = '';
  currentItems.forEach((r, idx)=>{
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `
      <div class="name"><div><strong>${esc(r.name)}</strong>${r.brand?` <span class="sub">(${esc(r.brand)})</span>`:''}</div></div>
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

  if (div){
    div.querySelector('.grams').textContent = round1(r.grams);
    div.querySelector('.carbs').textContent = round1(r.calc.carbs);
    div.querySelector('.cal').textContent   = Math.round(r.calc.cal);
    div.querySelector('.prot').textContent  = round1(r.calc.prot);
    div.querySelector('.fat').textContent   = round1(r.calc.fat);
    const measSel = div.querySelector('.measure');
    if (measSel) measSel.disabled = (r.unit!=='household');
  }
}

// ===== تجميع الإجماليات + الجرعة المقترحة + نطاق =====
function recalcAll(){
  const totals = currentItems.reduce((a,r)=>{
    a.grams += r.grams||0;
    a.carbs += r.calc.carbs||0;
    a.cal   += r.calc.cal||0;
    a.prot  += r.calc.prot||0;
    a.fat   += r.calc.fat||0;
    return a;
  }, {grams:0,carbs:0,cal:0,prot:0,fat:0});

  tGramsEl.textContent = round1(totals.grams);
  tCarbsEl.textContent = round1(totals.carbs);
  tCalEl.textContent   = Math.round(totals.cal);
  tProtEl.textContent  = round1(totals.prot);
  tFatEl.textContent   = round1(totals.fat);

  // جرعة كارب
  const carbRatio = Number(childData?.carbRatio || 12); // جرام/وحدة
  const mealDose = totals.carbs>0 ? (totals.carbs / carbRatio) : 0;

  // تصحيح بناءً على قياس قبل
  let corr = 0, explain = `carbs ${round1(totals.carbs)} / CR ${carbRatio}`;
  const preId = preReadingEl.value;
  if (preId){
    const pre = cachedMeasurements.find(m=> m.id===preId);
    const mmol = pre?.value_mmol || 0;
    const nMax = Number(childData?.normalRange?.max ?? 7.8);
    const CF   = Number(childData?.correctionFactor || 0); // mmol/L لكل 1U
    if (CF>0 && mmol>nMax){
      corr = (mmol - nMax)/CF;
      explain += ` + ((pre ${mmol.toFixed(1)} - ${nMax}) / CF ${CF})`;
    }
  }
  const totalDose = roundHalf(mealDose + corr);
  suggestedDoseEl.textContent = Number.isFinite(totalDose) ? (totalDose.toFixed(1).replace('.0','')) : '0';
  doseExplainEl.textContent = `= ${mealDose.toFixed(2)} + ${corr.toFixed(2)} ⇒ تقريب ${totalDose.toFixed(1)}`;

  // نطاق الجرعة (ذكاء خفيف: ±10% كارب + ±0.5U كقيمة أمان بسيطة)
  const range = computeDoseRange(totals.carbs, carbRatio, preId);
  doseRangeEl.textContent = range ? `${range.min}–${range.max} U` : '—';
}

function computeDoseRange(carbs, CR, preId){
  if(!(carbs>0) || !(CR>0)) return null;
  const base = carbs/CR;

  let corr=0;
  if (preId){
    const pre = cachedMeasurements.find(m=> m.id===preId);
    const mmol = pre?.value_mmol || 0;
    const target = Number(childData?.normalRange?.max ?? 7.8);
    const CF = Number(childData?.correctionFactor || 0);
    if(CF>0 && mmol>target) corr = (mmol-target)/CF;
  }

  // ±10% كارب + تحجيم لخطوة النصف
  const low  = roundHalf( (carbs*0.9)/CR + corr );
  const high = roundHalf( (carbs*1.1)/CR + corr );
  const min = Math.max(0, Math.min(low, high));
  const max = Math.max(low, high);
  return { min: Number(min.toFixed(1)), max: Number(max.toFixed(1)) };
}

// ===== حفظ/تعديل/حذف =====
saveMealBtn.addEventListener('click', saveMeal);
resetMealBtn.addEventListener('click', resetForm);
printDayBtn.addEventListener('click', ()=> window.print());
filterTypeEl.addEventListener('change', async ()=>{ await loadMealsOfDay(); });

mealTypeEl.addEventListener('change', ()=>{ populateReadingSelects(); recalcAll(); saveDraft(); });
mealDateEl.addEventListener('change', async ()=>{
  if (mealDateEl.value > todayStr()){ mealDateEl.value = todayStr(); }
  tableDateEl.textContent = mealDateEl.value;
  await loadMeasurements();
  await loadMealsOfDay();
  // reset draft scope for new date
  loadDraft();
  recalcAll();
});
preReadingEl.addEventListener('change', ()=>{ recalcAll(); saveDraft(); });
postReadingEl.addEventListener('change', ()=>{ saveDraft(); });

async function saveMeal(){
  if (!currentItems.length){ alert('أضف عنصرًا واحدًا على الأقل'); return; }
  const date = mealDateEl.value;
  if (!date || date>todayStr()){ alert('اختر تاريخًا صحيحًا (ليس مستقبلًا)'); return; }

  // تأمين واجهة
  setBusy(saveMealBtn, true);

  // العناصر
  const items = currentItems.map(r=> ({
    itemId: r.itemId, name: r.name, brand: r.brand || null,
    unit: r.unit, qty: Number(r.qty)||0, measure: r.measure || null,
    grams: round1(r.grams || 0),
    carbs_g: round1(r.calc.carbs || 0),
    cal_kcal: Math.round(r.calc.cal || 0),
    protein_g: round1(r.calc.prot || 0),
    fat_g: round1(r.calc.fat || 0)
  }));

  const totals = {
    grams: round1(items.reduce((a,i)=>a+i.grams,0)),
    carbs_g: round1(items.reduce((a,i)=>a+i.carbs_g,0)),
    cal_kcal: Math.round(items.reduce((a,i)=>a+i.cal_kcal,0)),
    protein_g: round1(items.reduce((a,i)=>a+i.protein_g,0)),
    fat_g: round1(items.reduce((a,i)=>a+i.fat_g,0))
  };

  // حفظ آخر استخدام للكميات (local)
  items.forEach(i=> { lastUsedMap[i.itemId]={ qty:i.qty }; });
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
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try{
    const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/meals`);
    if (editingMealId){
      await ref.doc(editingMealId).update(payload);
      showToast('✅ تم تحديث الوجبة');
    } else {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await ref.add(payload);
      showToast('✅ تم حفظ الوجبة');
      // تخزين نسخة أخيرة لهذا النوع للتكرار السريع
      saveLastMealTemplate(mealTypeEl.value, payload);
    }
    await loadMealsOfDay();
    resetForm(false); // لا تعيد النوع/التاريخ
    clearDraft();
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ');
  }finally{
    setBusy(saveMealBtn, false);
  }
}

function resetForm(clearType=true){
  editingMealId = null;
  currentItems = [];
  itemsBodyEl.innerHTML = '';
  if (clearType){ mealTypeEl.value = 'فطور'; }
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
    calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g},
    measures: []
  }));

  // جلب المقاييس لكل عنصر من مكتبة الأصناف (اختياري)
  Promise.all(currentItems.map(async (row)=>{
    if (!row.itemId) return;
    const d = await firebase.firestore().doc(`parents/${currentUser.uid}/children/${childId}/foodItems/${row.itemId}`).get();
    if (d.exists){
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
  setBusyButton(r.id, true);
  try{
    await firebase.firestore().doc(`parents/${currentUser.uid}/children/${childId}/meals/${r.id}`).delete();
    showToast('🗑️ تم حذف الوجبة');
    await loadMealsOfDay();
  }catch(e){
    console.error(e);
    alert('تعذر حذف الوجبة');
  }finally{
    setBusyButton(r.id, false);
  }
}

function setBusy(btn, busy){
  btn.disabled = !!busy;
  btn.textContent = busy ? 'جارٍ الحفظ…' : 'حفظ الوجبة';
}
function setBusyButton(mealId, busy){
  // يعطل زر الحذف في البطاقة المقابلة (اختياري تبسيط)
}

// ===== مودال الأصناف =====
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
  const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/foodItems`);
  const snap = await ref.orderBy('nameLower','asc').get();
  cachedFood = [];
  snap.forEach(d=> cachedFood.push({ id:d.id, ...d.data() }));
  applyPickerFilters();
}

async function applyPickerFilters(){
  const q = (pickSearchEl.value||'').trim();
  const cat = pickCategoryEl.value;

  // هاشتاج
  if (q.startsWith('#') && q.length>1){
    const tag = q.slice(1).trim().toLowerCase();
    const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/foodItems`);
    const snap= await ref.where('tags','array-contains', tag).get();
    const arr = []; snap.forEach(d=> arr.push({ id:d.id, ...d.data() }));
    renderPicker(cat==='الكل'?arr:arr.filter(x=>x.category===cat));
    return;
  }

  // بحث بالكلمات
  if (q.length>=2){
    const token = q.toLowerCase();
    const ref = firebase.firestore().collection(`parents/${currentUser.uid}/children/${childId}/foodItems`);
    const snap= await ref.where('keywords','array-contains', token).get();
    const arr = []; snap.forEach(d=> arr.push({ id:d.id, ...d.data() }));
    renderPicker(cat==='الكل'?arr:arr.filter(x=>x.category===cat));
    return;
  }

  // بدون بحث: اعرض الكاش + الأحدث استخدامًا في الأعلى (بناءً على lastUsedMap)
  const base = (cat==='الكل')? [...cachedFood] : cachedFood.filter(x=> x.category===cat);
  base.sort((a,b)=>{
    const la = lastUsedMap[a.id]?.ts || 0;
    const lb = lastUsedMap[b.id]?.ts || 0;
    return lb - la;
  });
  renderPicker(base);
}

function renderPicker(items){
  pickerGrid.innerHTML = '';
  if(!items.length){ pickerEmpty.classList.remove('hidden'); return; }
  pickerEmpty.classList.add('hidden');

  items.forEach(it=>{
    const card = document.createElement('div');
    card.className = 'pick-card';
    const thumbHTML = it.imageUrl && String(it.autoImage)!=='true'
      ? `<img src="${esc(it.imageUrl)}" alt="">`
      : `<span>${categoryIcon(it.category)}</span>`;

    card.innerHTML = `
      <div class="pick-thumb">${thumbHTML}</div>
      <div class="pick-meta">
        <div><strong>${esc(it.name)}</strong> ${it.brand?`<small>(${esc(it.brand)})</small>`:''}</div>
        <div class="badges">
          <span class="badge">${esc(it.category||'-')}</span>
          <span class="badge">كارب/100g: ${it?.nutrPer100g?.carbs_g ?? '-'}</span>
          <span class="badge">سعرات/100g: ${it?.nutrPer100g?.cal_kcal ?? '-'}</span>
        </div>
        <div class="pick-actions">
          <button class="chooseBtn">اختيار</button>
        </div>
      </div>
    `;
    card.querySelector('.chooseBtn').addEventListener('click', ()=>{
      // ختم آخر استخدام
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
    case 'حليب': return '🥛';
    case 'فاكهة': return '🍎';
    case 'خضروات': return '🥕';
    case 'لحوم': return '🍗';
    case 'دهون': return '🥑';
    default: return '🍽️';
  }
}

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

// ===== تكرار آخر وجبة من نفس النوع =====
function repeatLastMealTemplate(){
  const tpl = loadLastMealTemplate(mealTypeEl.value);
  if(!tpl){ showToast('لا توجد وجبة محفوظة لهذا النوع بعد'); return; }
  // لا نغيّر التاريخ/القياسات، فقط العناصر والجرعات
  currentItems = (tpl.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: {
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0
    },
    calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g},
    measures: []
  }));
  renderItems(); recalcAll(); saveDraft();
}

// ===== Helpers: تخزين محلي للقوالب/آخر استخدام =====
function saveLastMealTemplate(type, payload){
  try{
    const k = `tpl:lastMeal:${currentUser.uid}:${childId}:${type}`;
    localStorage.setItem(k, JSON.stringify({ items: payload.items }));
  }catch(_){}
}
function loadLastMealTemplate(type){
  try{
    const k = `tpl:lastMeal:${currentUser?.uid||'u'}:${childId||'c'}:${type}`;
    const raw = localStorage.getItem(k);
    return raw? JSON.parse(raw) : null;
  }catch(_){ return null; }
}
function saveLastUsed(map){
  try{
    const k = `lastUsed:${currentUser.uid}:${childId}`;
    localStorage.setItem(k, JSON.stringify(map));
  }catch(_){}
}
function loadLastUsed(){
  try{
    const k = `lastUsed:${currentUser?.uid||'u'}:${childId||'c'}`;
    const raw = localStorage.getItem(k);
    return raw? JSON.parse(raw) : {};
  }catch(_){ return {}; }
}
