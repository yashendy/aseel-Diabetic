// js/meals.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, query, where, orderBy, doc, getDoc, updateDoc, deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ========= عناصر ========= */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');

const mealDateEl = document.getElementById('mealDate');
const mealTypeEl = document.getElementById('mealType');
const preReadingEl = document.getElementById('preReading');
const postReadingEl = document.getElementById('postReading');

const itemsBodyEl = document.getElementById('itemsBody');
const addItemBtn = document.getElementById('addItemBtn');

const tGramsEl = document.getElementById('tGrams');
const tCarbsEl = document.getElementById('tCarbs');
const tCalEl   = document.getElementById('tCal');
const tProtEl  = document.getElementById('tProt');
const tFatEl   = document.getElementById('tFat');

const suggestedDoseEl = document.getElementById('suggestedDose');
const doseExplainEl   = document.getElementById('doseExplain');
const appliedDoseEl   = document.getElementById('appliedDose');
const mealNotesEl     = document.getElementById('mealNotes');
const saveMealBtn     = document.getElementById('saveMealBtn');
const resetMealBtn    = document.getElementById('resetMealBtn');

const tableDateEl     = document.getElementById('tableDate');
const mealsListEl     = document.getElementById('mealsList');
const noMealsEl       = document.getElementById('noMeals');

/* مودال اختيار الصنف */
const pickerModal   = document.getElementById('pickerModal');
const closePicker   = document.getElementById('closePicker');
const pickSearchEl  = document.getElementById('pickSearch');
const pickCategoryEl= document.getElementById('pickCategory');
const pickerGrid    = document.getElementById('pickerGrid');
const pickerEmpty   = document.getElementById('pickerEmpty');

/* ========= حالة ========= */
let currentUser, childData;
let editingMealId = null;
let currentItems = []; // [{itemId,name,brand,unit:'grams'|'household',qty,measure?,grams, per100: {...}, calc:{carbs,cal,prot,fat}, measures:[{name,grams}]}]
let cachedFood = [];   // كاش أصناف لواجهة الاختيار
let cachedMeasurements = []; // قياسات اليوم

/* ========= أدوات ========= */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); }
setMaxToday(mealDateEl);

function calcAge(bd){
  if(!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}
function esc(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;'); }
function toNumber(x){ const n = Number(String(x).replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round(x*10)/10; }
function roundHalf(x){ return Math.round(x*2)/2; }

const SLOT_MAP = {
  'فطور': { pre:'ق.الفطار', post:'ب.الفطار' },
  'غداء': { pre:'ق.الغدا', post:'ب.الغدا' },
  'عشاء': { pre:'ق.العشا', post:'ب.العشا' },
  'سناك': { pre:'سناك',    post:'سناك' }
};
const SLOTS_ORDER = [
  "الاستيقاظ","ق.الفطار","ب.الفطار","ق.الغدا","ب.الغدا","ق.العشا","ب.العشا","سناك","ق.النوم","أثناء النوم","ق.الرياضة","ب.الرياضة"
];

/* ========= تهيئة ========= */
(function init(){
  mealDateEl.value = todayStr();
  tableDateEl.textContent = mealDateEl.value;
})();

/* ========= تحميل الجلسة والطفل ========= */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href = 'index.html';
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `${childData.gender || '-'} • العمر: ${calcAge(childData.birthDate)} سنة`;

  await loadMeasurements();
  await loadMealsOfDay();
  recalcAll();
});

/* ========= تحميل قياسات اليوم ========= */
async function loadMeasurements(){
  const d = mealDateEl.value;
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  // where date == d ثم orderBy when
  const qy = query(ref, where('date','==', d), orderBy('when','asc'));
  const snap = await getDocs(qy);
  cachedMeasurements = [];
  snap.forEach(s=>{
    const m = s.data();
    const mmol = m.value_mmol ?? ((m.value_mgdl||0)/18);
    cachedMeasurements.push({
      id: s.id, slot: m.slot || '-', when: m.when?.toDate ? m.when.toDate() : new Date(m.when),
      value_mmol: Number(mmol || 0), value_mgdl: m.value_mgdl ?? Math.round((mmol||0)*18)
    });
  });
  populateReadingSelects();
}

function populateReadingSelects(){
  const type = mealTypeEl.value;
  const pref = SLOT_MAP[type]?.pre || null;
  const postf = SLOT_MAP[type]?.post || null;

  // إعداد القوائم: نرتّب حسب slots order
  const sorted = [...cachedMeasurements].sort((a,b)=>{
    const ia = SLOTS_ORDER.indexOf(a.slot);
    const ib = SLOTS_ORDER.indexOf(b.slot);
    if (ia!==ib) return ia-ib;
    return (a.when||0) - (b.when||0);
  });

  const buildOptions = (prefSlot)=>{
    const opts = ['<option value="">— لا يوجد —</option>'];
    // أولًا المفضّل
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L`;
      if (prefSlot && m.slot===prefSlot){
        opts.push(`<option value="${m.id}">${esc(label)} (مفضّل)</option>`);
      }
    });
    // ثم باقي القياسات
    sorted.forEach(m=>{
      const label = `${m.slot} • ${m.value_mmol.toFixed(1)} mmol/L`;
      if (!prefSlot || m.slot!==prefSlot){
        opts.push(`<option value="${m.id}">${esc(label)}</option>`);
      }
    });
    return opts.join('');
  };

  preReadingEl.innerHTML  = buildOptions(pref);
  postReadingEl.innerHTML = buildOptions(postf);
}

/* ========= تحميل وجبات اليوم ========= */
async function loadMealsOfDay(){
  const d = mealDateEl.value;
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
  const qy = query(ref, where('date','==', d), orderBy('createdAt','asc'));
  const snap = await getDocs(qy);

  mealsListEl.innerHTML = '';
  const rows = [];
  snap.forEach(s=> rows.push({ id:s.id, ...s.data() }));

  if(!rows.length){ noMealsEl.classList.remove('hidden'); return; }
  noMealsEl.classList.add('hidden');

  rows.forEach(r=>{
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

/* ========= إدارة العناصر (صف الجدول) ========= */
function addItemRow(itemDoc){
  // itemDoc: {id, name, brand, nutrPer100g:{}, measures:[]}
  const row = {
    itemId: itemDoc.id,
    name: itemDoc.name,
    brand: itemDoc.brand || null,
    unit: 'grams',         // default
    qty: 100,              // default
    measure: null,
    grams: 100,
    per100: {
      carbs: toNumber(itemDoc?.nutrPer100g?.carbs_g),
      cal: toNumber(itemDoc?.nutrPer100g?.cal_kcal),
      prot: toNumber(itemDoc?.nutrPer100g?.protein_g),
      fat: toNumber(itemDoc?.nutrPer100g?.fat_g)
    },
    calc:{carbs:0,cal:0,prot:0,fat:0},
    measures: Array.isArray(itemDoc.measures)? itemDoc.measures.filter(m=>m.name && m.grams>0) : []
  };
  currentItems.push(row);
  renderItems();
  recalcAll();
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
      <div><input type="number" step="any" class="qty" value="${r.qty}"></div>
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

    // إظهار/إخفاء قائمة المقياس حسب الوحدة
    measSel.disabled = (r.unit !== 'household');
    if (r.unit==='household' && !r.measure && r.measures.length) {
      r.measure = r.measures[0].name;
    }

    unitSel.addEventListener('change', ()=>{
      r.unit = unitSel.value;
      if (r.unit==='grams'){
        r.measure = null;
      } else if (r.unit==='household' && r.measures.length && !r.measure){
        r.measure = r.measures[0].name;
      }
      recomputeRow(r, div);
      renderItems(); // لإعادة تمكين/تعطيل المقياس
      recalcAll();
    });

    qtyInp.addEventListener('input', ()=>{
      r.qty = toNumber(qtyInp.value);
      recomputeRow(r, div);
      recalcAll();
    });

    measSel.addEventListener('change', ()=>{
      r.measure = measSel.value || null;
      recomputeRow(r, div);
      recalcAll();
    });

    delBtn.addEventListener('click', ()=>{
      currentItems.splice(idx,1);
      renderItems(); recalcAll();
    });

    // حساب أولي
    recomputeRow(r, div);
    itemsBodyEl.appendChild(div);
  });
}

function recomputeRow(r, div){
  let grams = 0;
  if (r.unit==='grams'){
    grams = r.qty;
  } else {
    const m = r.measures.find(x=> x.name===r.measure);
    grams = m ? (r.qty * m.grams) : 0;
  }
  r.grams = grams;
  r.calc.carbs = (r.per100.carbs * grams)/100;
  r.calc.cal   = (r.per100.cal   * grams)/100;
  r.calc.prot  = (r.per100.prot  * grams)/100;
  r.calc.fat   = (r.per100.fat   * grams)/100;

  // تحديث العرض
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

/* ========= تجميع الإجماليات + الجرعة المقترحة ========= */
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

  // جرعة الوجبة
  const carbRatio = Number(childData?.carbRatio || 12); // جرام كارب لكل وحدة
  const mealDose = totals.carbs>0 ? (totals.carbs / carbRatio) : 0;

  // تصحيح حسب CF إن وجد وقياس pre
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
  suggestedDoseEl.textContent = totalDose.toFixed(1).replace('.0','');
  doseExplainEl.textContent = `= ${mealDose.toFixed(2)} + ${corr.toFixed(2)} ⇒ تقريب ${totalDose.toFixed(1)}`;
}

/* ========= حفظ/تحديث وجبة ========= */
saveMealBtn.addEventListener('click', saveMeal);
resetMealBtn.addEventListener('click', resetForm);
mealTypeEl.addEventListener('change', ()=>{ populateReadingSelects(); recalcAll(); });
mealDateEl.addEventListener('change', async ()=>{
  if (mealDateEl.value > todayStr()){ mealDateEl.value = todayStr(); }
  tableDateEl.textContent = mealDateEl.value;
  await loadMeasurements();
  await loadMealsOfDay();
  recalcAll();
});
preReadingEl.addEventListener('change', recalcAll);

async function saveMeal(){
  if (!currentItems.length){ alert('أضف عنصرًا واحدًا على الأقل'); return; }
  const date = mealDateEl.value;
  if (!date || date>todayStr()){ alert('اختر تاريخًا صحيحًا (ليس مستقبلًا)'); return; }

  // بناء العناصر النهائية
  const items = currentItems.map(r=> ({
    itemId: r.itemId,
    name: r.name,
    brand: r.brand || null,
    unit: r.unit,
    qty: Number(r.qty) || 0,
    measure: r.measure || null,
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
      alert('✅ تم تحديث الوجبة');
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(ref, payload);
      alert('✅ تم حفظ الوجبة');
    }
    await loadMealsOfDay();
    resetForm();
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ');
  }
}

function resetForm(){
  editingMealId = null;
  currentItems = [];
  itemsBodyEl.innerHTML = '';
  appliedDoseEl.value = '';
  mealNotesEl.value = '';
  recalcAll();
}

/* ========= تعديل/حذف ========= */
function editMeal(r){
  // تعبئة النموذج بهذه الوجبة
  editingMealId = r.id;
  mealDateEl.value = r.date || todayStr();
  mealTypeEl.value = r.type || 'فطور';
  tableDateEl.textContent = mealDateEl.value;

  // تحميل القياسات لليوم المفروض ثم ضبط الاختيارات
  loadMeasurements().then(()=>{
    preReadingEl.value  = r.preReading?.id || '';
    postReadingEl.value = r.postReading?.id || '';
  });

  // العناصر
  currentItems = (r.items||[]).map(i=>({
    itemId: i.itemId, name: i.name, brand: i.brand || null,
    unit: i.unit || 'grams', qty: Number(i.qty)||0, measure: i.measure || null,
    grams: Number(i.grams)||0,
    per100: { // per100 غير مخزنة… لكننا لا نحتاجها للحفظ، نحتاجها للحساب عند التعديل!
      carbs: i.grams>0 ? (i.carbs_g*100/i.grams) : 0,
      cal:   i.grams>0 ? (i.cal_kcal*100/i.grams) : 0,
      prot:  i.grams>0 ? (i.protein_g*100/i.grams) : 0,
      fat:   i.grams>0 ? (i.fat_g*100/i.grams) : 0
    },
    calc:{carbs: i.carbs_g, cal: i.cal_kcal, prot: i.protein_g, fat: i.fat_g},
    measures: [] // سنملأها من مكتبة الأصناف لكل عنصر للحصول على المقادير البيتية
  }));

  // جلب المقاييس لكل عنصر (اختياري لتحسين تجربة التعديل)
  Promise.all(currentItems.map(async (row)=>{
    if (!row.itemId) return;
    const d = await getDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/foodItems/${row.itemId}`));
    if (d.exists()){
      const item = d.data();
      row.measures = Array.isArray(item.measures)? item.measures.filter(m=>m.name && m.grams>0) : [];
    }
  })).then(()=>{
    renderItems();
    recalcAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function deleteMeal(r){
  if(!confirm('هل تريد حذف هذه الوجبة؟')) return;
  try{
    await deleteDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/meals/${r.id}`));
    alert('🗑️ تم حذف الوجبة');
    await loadMealsOfDay();
  }catch(e){
    console.error(e);
    alert('تعذر حذف الوجبة');
  }
}

/* ========= مودال اختيار الأصناف ========= */
addItemBtn.addEventListener('click', openPicker);
closePicker.addEventListener('click', ()=> pickerModal.classList.add('hidden'));
pickSearchEl.addEventListener('input', debounce(applyPickerFilters, 250));
pickCategoryEl.addEventListener('change', applyPickerFilters);

function openPicker(){
  pickerModal.classList.remove('hidden');
  pickSearchEl.value=''; pickCategoryEl.value='الكل';
  loadFoodItems();
}

async function loadFoodItems(){
  // قراءة مرتبة بالاسم
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/foodItems`);
  const qy = query(ref, orderBy('nameLower','asc'));
  const snap = await getDocs(qy);
  cachedFood = [];
  snap.forEach(d=> cachedFood.push({ id:d.id, ...d.data() }));
  applyPickerFilters();
}

async function applyPickerFilters(){
  const q = pickSearchEl.value.trim();
  const cat = pickCategoryEl.value;

  // بحث مباشر لو #هاشتاج أو keywords
  if (q.startsWith('#') && q.length>1){
    const tag = q.slice(1).trim().toLowerCase();
    const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/foodItems`);
    const qy  = query(ref, where('tags','array-contains', tag));
    const snap= await getDocs(qy);
    const arr = []; snap.forEach(d=> arr.push({ id:d.id, ...d.data() }));
    renderPicker(cat==='الكل'?arr:arr.filter(x=>x.category===cat));
    return;
  }
  if (q.length >= 2){
    const token = q.toLowerCase();
    const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/foodItems`);
    const qy  = query(ref, where('keywords','array-contains', token));
    const snap= await getDocs(qy);
    const arr = []; snap.forEach(d=> arr.push({ id:d.id, ...d.data() }));
    renderPicker(cat==='الكل'?arr:arr.filter(x=>x.category===cat));
    return;
  }

  // بدون بحث: استخدم الكاش + فلتر تصنيف
  const base = (cat==='الكل')? cachedFood : cachedFood.filter(x=> x.category===cat);
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
      ? `<img src="${it.imageUrl}" alt="">`
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

/* ========= debounce ========= */
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
