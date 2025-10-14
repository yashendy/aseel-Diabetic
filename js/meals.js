// /js/meals.js
import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, collection, query, where, orderBy, limit, getDocs,
  onSnapshot, addDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

// عناصر الواجهة
const els = {
  // هيدر
  childMeta: document.getElementById('child-meta'),
  todayLabel: document.getElementById('today-label'),

  // تحكم
  dateInput: document.getElementById('dateInput'),
  mealType: document.getElementById('mealType'),

  // القياسات والجرعات
  pre: document.getElementById('preMealInput'),
  post: document.getElementById('postMealInput'),
  corrDose: document.getElementById('corrDoseInput'),
  carbDose: document.getElementById('carbDoseInput'),
  totalDose: document.getElementById('totalDoseInput'),
  doseHints: document.getElementById('dose-hints'),
  notes: document.getElementById('notes'),

  // أصناف
  body: document.getElementById('items-body'),
  tCarbs: document.getElementById('t-carbs'),
  tProt: document.getElementById('t-protein'),
  tFat: document.getElementById('t-fat'),
  tCal: document.getElementById('t-cal'),

  // مكتبة
  dlgPicker: document.getElementById('dlg-picker'),
  pickerSearch: document.getElementById('picker-search'),
  pickerGrid: document.getElementById('picker-grid'),
  pickerEmpty: document.getElementById('picker-empty'),
  openPicker: document.getElementById('btn-open-picker'),
  closePicker: document.getElementById('close-picker'),

  // قوالب
  openTemplates: document.getElementById('btn-open-templates'),
  dlgTemplates: document.getElementById('dlg-templates'),
  closeTemplates: document.getElementById('close-templates'),
  tplList: document.getElementById('tpl-list'),
  tplEmpty: document.getElementById('tpl-empty'),
  tplSearch: document.getElementById('tpl-search'),
  saveDlg: document.getElementById('dlg-save'),
  saveForm: document.getElementById('save-form'),
  tplName: document.getElementById('tpl-name'),
  tplType: document.getElementById('tpl-type'),
  cancelSave: document.getElementById('cancel-save'),
  closeSave: document.getElementById('close-save'),
  saveTemplateBtn: document.getElementById('btn-save-template'),

  // AI
  aiPanel: document.getElementById('ai-panel'),
  aiTips: document.getElementById('ai-tips'),
  aiRefresh: document.getElementById('btn-refresh-ai'),
};

// الحالة
const state = {
  uid: null,
  childId: new URLSearchParams(location.search).get('child') || 'demo',
  child: null, // {unit, CF, CR, high, doseStep...}
  items: [],
  templates: [],
  // dirty flags لعدم الكتابة فوق التعديل اليدوي
  dirty: { corr:false, carb:false, total:false },
  measurementsCache: [], // قياسات اليوم
};

// مسارات
const PARENT_CHILD = () => doc(db, 'parents', state.uid || 'x', 'children', state.childId);
const MEASUREMENTS = () => collection(db, 'parents', state.uid || 'x', 'children', state.childId, 'measurements');
const CHILD_DOC = () => doc(db, 'children', state.childId); // احتياطي لو المخزن هنا
const TEMPLATES = () => collection(db, 'children', state.childId, 'mealTemplates');

// أدوات
const num = (v)=>Number.isFinite(Number(v))?Number(v):0;
const roundTo = (v, step)=> Math.round(num(v)/step)*step;
const fmt = (n)=> (Math.round(n*10)/10).toString();
const toISODate = (d)=> new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);

// وحدات سكر
const toMmol = (val, unit)=> unit?.toLowerCase().includes('mg') ? (num(val)/18) : num(val);
const toMgdl = (val, unit)=> unit?.toLowerCase().includes('mg') ? num(val) : (num(val)*18);

// خريطة نوع الوجبة -> Slots
const MEAL_SLOTS = {
  breakfast: { pre:'PRE_BREAKFAST', post:'POST_BREAKFAST' },
  lunch:     { pre:'PRE_LUNCH',     post:'POST_LUNCH'     },
  dinner:    { pre:'PRE_DINNER',    post:'POST_DINNER'    },
  snack:     { pre:'SNACK',         post:null             },
};

// =============== تحميل بيانات الطفل ===============
async function loadChild(){
  // نحاول children/{childId} أولا
  const snap = await getDoc(CHILD_DOC());
  if (snap.exists()){
    state.child = snap.data();
  } else {
    // احتياطي: parents/{uid}/children/{childId}
    if (state.uid){
      const snap2 = await getDoc(PARENT_CHILD());
      state.child = snap2.exists()? snap2.data() : {};
    } else {
      state.child = {};
    }
  }

  const unit = state.child?.glucoseUnit || 'mmol/L';
  const CF   = num(state.child?.CF || state.child?.cf || 0);
  const CR   = num(state.child?.CR || state.child?.cr || 0);
  const high = num(state.child?.high || state.child?.high_glucose || 10.9);
  const step = num(state.child?.doseStep || 0.5);

  state.child = { ...state.child, glucoseUnit:unit, CF, CR, high, doseStep: step };

  els.childMeta.textContent = `الطفل: ${state.child?.name || '—'} • وحدة القياس: ${unit} • CF: ${CF} • CR: ${CR} • ارتفاع: ${high}`;
}

// =============== جسر القياسات ===============
function sameDay(ts, d){
  const x = new Date(ts);
  return x.getFullYear()===d.getFullYear()
      && x.getMonth()===d.getMonth()
      && x.getDate()===d.getDate();
}

async function loadDayMeasurements(){
  if (!state.uid) return;
  const day = els.dateInput.value ? new Date(els.dateInput.value) : new Date();

  // نجيب آخر 60 قياس ونفلتر اليوم (أسلم لو ماعندناش فهرسة بالتاريخ)
  const qy = query(MEASUREMENTS(), orderBy('createdAt','desc'), limit(60));
  const snap = await getDocs(qy);
  const arr = [];
  snap.forEach(s=>{
    const d = s.data();
    if (d?.createdAt?.toDate && sameDay(d.createdAt.toDate(), day)) arr.push({id:s.id, ...d});
    else if (d?.when && sameDay(new Date(d.when), day))          arr.push({id:s.id, ...d});
    else if (d?.date && d.date===toISODate(day))                  arr.push({id:s.id, ...d});
  });
  state.measurementsCache = arr;
  applyMealReadings();
}

function lastBySlot(slot){
  const list = state.measurementsCache
    .filter(x=> (x.slot===slot))
    .sort((a,b)=>{
      const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.when ? new Date(a.when).getTime() : 0);
      const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.when ? new Date(b.when).getTime() : 0);
      return tb - ta;
    });
  return list[0] || null;
}

function applyMealReadings(){
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const slots = MEAL_SLOTS[els.mealType.value] || MEAL_SLOTS.breakfast;
  const pre  = slots.pre ? lastBySlot(slots.pre)  : null;
  const post = slots.post? lastBySlot(slots.post) : null;

  if (pre){
    const val = num(pre.value ?? pre.reading ?? 0);
    const preUnit = pre.unit || unit;
    els.pre.value = preUnit===unit ? val : (unit.toLowerCase().includes('mg') ? toMgdl(val, preUnit) : toMmol(val, preUnit));
  }
  if (post){
    const val = num(post.value ?? post.reading ?? 0);
    const postUnit = post.unit || unit;
    els.post.value = postUnit===unit ? val : (unit.toLowerCase().includes('mg') ? toMgdl(val, postUnit) : toMmol(val, postUnit));
  }

  autoRecalcCorrection(); // يحسب التصحيح
}

// =============== حسابات الجرعات ===============
function autoRecalcCorrection(){
  if (state.dirty.corr) return; // المستخدم عدّل يدويًا
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const CF   = num(state.child?.CF);
  const high = num(state.child?.high);

  const step = num(state.child?.doseStep || 0.5);
  const reading = num(els.pre.value);

  if (!reading || !CF || !high){ els.corrDose.value = ''; return; }

  // نحسب على mmol/L
  const readingMmol = toMmol(reading, unit);
  const highMmol    = toMmol(high,   unit); // لو high مخزّن بوحدة mg/dL بيتحوّل

  const diff = Math.max(0, readingMmol - highMmol);
  const corrRaw = diff / CF;
  const corr = roundTo(corrRaw, step);
  els.corrDose.value = fmt(corr);

  autoRecalcTotals();
}

function autoRecalcCarb(){
  if (state.dirty.carb) return;
  const CR = num(state.child?.CR);
  const step = num(state.child?.doseStep || 0.5);
  const totalCarbs = calcTotals().carbs;
  if (!CR){ els.carbDose.value=''; return; }
  const dose = roundTo(totalCarbs / CR, step);
  els.carbDose.value = fmt(dose);
  autoRecalcTotals();
}

function autoRecalcTotals(){
  if (state.dirty.total) return;
  const c1 = num(els.corrDose.value);
  const c2 = num(els.carbDose.value);
  els.totalDose.value = fmt(c1 + c2);
  updateDoseHints();
}

function updateDoseHints(){
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const CF   = num(state.child?.CF);
  const CR   = num(state.child?.CR);
  const high = num(state.child?.high);
  const pre  = num(els.pre.value);
  const tcarb= calcTotals().carbs;

  const tips = [];
  if (!CF) tips.push('⚠️ رجاء ضبط CF (معامل التصحيح) في بيانات الطفل.');
  if (!CR) tips.push('⚠️ رجاء ضبط CR (معامل الكارب) في بيانات الطفل.');
  if (pre){
    const preMmol = toMmol(pre, unit);
    const highMmol= toMmol(high, unit);
    if (preMmol > highMmol) tips.push(`📈 قياس قبل الوجبة أعلى من الحد (${fmt(highMmol)} mmol/L). تم حساب تصحيح تلقائيًا.`);
    else tips.push('✅ قياس قبل الوجبة ضمن النطاق.');
  }
  tips.push(`🍚 كارب الوجبة الحالي ≈ ${fmt(tcarb)}g.`);

  els.doseHints.textContent = tips.join('  •  ');
}

// =============== إدارة أصناف الوجبة ===============
function defaultMeasure(food){
  const m = (food.measures||[]).find(x=>x.default) || (food.measures||[])[0];
  return m || { name:'100 جم', grams:100, default:true };
}
function gramsOf(it){ return num(it.qty) * num(it.measureGrams); }
function macrosOf(it){
  const g = gramsOf(it);
  const p = it.per100 || {};
  return {
    carbs:   g * num(p.carbs_g)   / 100,
    protein: g * num(p.protein_g) / 100,
    fat:     g * num(p.fat_g)     / 100,
    cal:     g * num(p.cal_kcal)  / 100,
  };
}
function calcTotals(){
  return state.items.reduce((acc,it)=>{
    const m = macrosOf(it);
    acc.carbs+=m.carbs; acc.protein+=m.protein; acc.fat+=m.fat; acc.cal+=m.cal; return acc;
  },{carbs:0,protein:0,fat:0,cal:0});
}

function renderItems(){
  els.body.innerHTML = state.items.map((it,idx)=>{
    const m = macrosOf(it);
    return `
      <tr>
        <td>
          <div style="display:flex; gap:8px; align-items:center">
            ${it.imageUrl ? `<img src="${it.imageUrl}" style="width:38px;height:38px;border-radius:8px;object-fit:cover">` : ''}
            <div>
              <div style="font-weight:800">${it.name}</div>
              <div class="muted sm">ID: ${it.foodId}</div>
            </div>
          </div>
        </td>
        <td>
          <input class="row-measure" data-idx="${idx}" type="text" value="${it.measureName}" list="common-measures">
          <datalist id="common-measures">
            <option value="100 جم"></option>
            <option value="ملعقة صغيرة"></option>
            <option value="ملعقة كبيرة"></option>
            <option value="كوب"></option>
            <option value="½ كوب"></option>
            <option value="حبة"></option>
          </datalist>
          <div class="muted sm">جرام/وحدة</div>
          <input class="row-grams-per-unit" data-idx="${idx}" type="number" step="0.1" value="${it.measureGrams}">
        </td>
        <td><input class="row-qty" data-idx="${idx}" type="number" step="0.5" min="0" value="${it.qty}"></td>
        <td class="muted">${fmt(gramsOf(it))}</td>
        <td>${fmt(m.carbs)}</td>
        <td>${fmt(m.protein)}</td>
        <td>${fmt(m.fat)}</td>
        <td>${fmt(m.cal)}</td>
        <td><button class="btn ghost" data-del="${idx}">حذف</button></td>
      </tr>
    `;
  }).join('');

  // أحداث
  els.body.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=>{ state.items.splice(Number(b.dataset.del),1); renderItems(); updateNutritionAndDoses(); });
  els.body.querySelectorAll('.row-measure').forEach(inp=> inp.oninput = ()=>{ state.items[inp.dataset.idx].measureName = inp.value; updateNutritionAndDoses(); });
  els.body.querySelectorAll('.row-grams-per-unit').forEach(inp=> inp.oninput = ()=>{ state.items[inp.dataset.idx].measureGrams = num(inp.value)||0; updateNutritionAndDoses(); });
  els.body.querySelectorAll('.row-qty').forEach(inp=> inp.oninput = ()=>{ state.items[inp.dataset.idx].qty = num(inp.value)||0; updateNutritionAndDoses(); });

  updateNutritionAndDoses();
}

function updateNutritionAndDoses(){
  const t = calcTotals();
  els.tCarbs.textContent = fmt(t.carbs);
  els.tProt.textContent  = fmt(t.protein);
  els.tFat.textContent   = fmt(t.fat);
  els.tCal.textContent   = fmt(t.cal);
  // جرعة الكارب والمجموع
  autoRecalcCarb();
  autoRecalcTotals();
  refreshAI();
}

function addFoodToMeal(food){
  const dm = defaultMeasure(food);
  state.items.push({
    foodId: food.id,
    name: food.name,
    per100: food.per100,
    measureName: dm.name,
    measureGrams: Number(dm.grams)||100,
    qty: 1,
    imageUrl: food.imageUrl || ''
  });
  renderItems();
}

// =============== مودال المكتبة ===============
function renderPicker(){
  const q = (els.pickerSearch.value||'').trim();
  const list = (typeof window.searchFoods==='function') ? window.searchFoods(q) : (window.FOOD_LIBRARY || []);
  els.pickerGrid.innerHTML = list.map(x=>{
    const kcal = x.per100?.cal_kcal ?? 0;
    return `
      <article class="card-food">
        ${x.imageUrl ? `<img class="thumb" src="${x.imageUrl}" alt="">` : ''}
        <div class="title">${x.name}</div>
        <div class="meta">${x.category || ''}</div>
        <div class="meta">kcal/100g: ${kcal}</div>
        <div class="actions">
          <button class="btn" data-use="${x.id}">استخدام</button>
        </div>
      </article>
    `;
  }).join('');
  els.pickerEmpty.hidden = list.length!==0;
  els.pickerGrid.querySelectorAll('[data-use]').forEach(b=>{
    b.onclick = ()=>{
      const f = (window.FOOD_LIBRARY||[]).find(y=>y.id===b.dataset.use);
      if (f) addFoodToMeal(f);
      els.dlgPicker.close();
    };
  });
}

// =============== القوالب ===============
let unsubTpl=null;
function startTemplatesLive(){
  if (unsubTpl) return;
  unsubTpl = onSnapshot(TEMPLATES(), snap=>{
    const arr=[]; snap.forEach(s=>arr.push({id:s.id,...s.data()}));
    state.templates = arr.sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar',{numeric:true}));
    filterTemplates();
  });
}
function renderTemplates(list){
  els.tplList.innerHTML = list.map(t=>`
    <article class="tpl-card">
      <div class="title">${t.name}</div>
      <div class="meta">${t.type || ''} • ${t.items?.length||0} صنف</div>
      <div class="actions">
        <button class="btn" data-apply="${t.id}">استخدام</button>
        <button class="btn ghost" data-del="${t.id}">حذف</button>
      </div>
    </article>
  `).join('');
  els.tplEmpty.hidden = list.length!==0;
  els.tplList.querySelectorAll('[data-apply]').forEach(b=> b.onclick = ()=> applyTemplate(b.dataset.apply));
  els.tplList.querySelectorAll('[data-del]').forEach(b=> b.onclick = async ()=>{ if(confirm('حذف القالب؟')) await deleteDoc(doc(TEMPLATES(), b.dataset.del)); });
}
function filterTemplates(){
  const q = (els.tplSearch.value||'').trim().toLowerCase();
  const list = q ? state.templates.filter(t=>(t.name||'').toLowerCase().includes(q)) : state.templates;
  renderTemplates(list);
}
async function applyTemplate(id){
  const t = state.templates.find(x=>x.id===id); if (!t) return;
  (t.items||[]).forEach(it=>{
    const fromLib = (window.FOOD_LIBRARY||[]).find(f=>f.id===it.foodId);
    const per100 = fromLib?.per100 || it.per100 || {carbs_g:0,protein_g:0,fat_g:0,cal_kcal:0};
    state.items.push({
      foodId: it.foodId,
      name: fromLib?.name || it.name || 'صنف',
      per100,
      measureName: it.measureName || '100 جم',
      measureGrams: num(it.measureGrams)||100,
      qty: num(it.qty)||1,
      imageUrl: fromLib?.imageUrl || it.imageUrl || ''
    });
  });
  els.dlgTemplates.close();
  renderItems();
}
function mapStateToTemplatePayload(){
  return {
    name: els.tplName.value.trim(),
    type: els.tplType.value,
    items: state.items.map(it=>({
      foodId: it.foodId, name: it.name, per100: it.per100,
      measureName: it.measureName, measureGrams: num(it.measureGrams), qty: num(it.qty), imageUrl: it.imageUrl||''
    })),
    notes: (els.notes.value||'').trim(),
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
}

// =============== المساعد الذكي (Rule-based) ===============
function smartAdvice(){
  const adv = [];
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const high = num(state.child?.high);
  const pre  = num(els.pre.value);
  const post = num(els.post.value);
  const tcarb= calcTotals().carbs;
  const corr = num(els.corrDose.value);
  const cr   = num(state.child?.CR);

  // قبل الوجبة
  if (pre){
    if (toMmol(pre,unit) > toMmol(high,unit)) adv.push({t:`القراءة قبل الوجبة أعلى من الحد. تم اقتراح تصحيح ${fmt(corr)}U.`, k:'warn'});
    else adv.push({t:`القراءة قبل الوجبة ضمن النطاق.`, k:'good'});
  }

  // بعد الوجبة
  if (post){
    const postM = toMmol(post,unit);
    const highM = toMmol(high,unit);
    if (postM > highM+2) adv.push({t:`قراءة بعد الوجبة مرتفعة بشكل ملحوظ. راجعي توزيع الكارب أو توقيت الجرعة.`, k:'danger'});
  }

  // الكارب
  if (cr){
    const dose = roundTo(tcarb/cr, state.child?.doseStep||0.5);
    adv.push({t:`جرعة الكارب المقترحة ≈ ${fmt(dose)}U لكارب ${fmt(tcarb)}g مع CR=${cr}.`, k:'good'});
  }

  if (!adv.length) adv.push({t:'أضف أصنافًا أو قياسات لاقتراحات أدق.', k:'warn'});
  return adv;
}

function renderAI(){
  const tips = smartAdvice();
  els.aiTips.innerHTML = tips.map(x=> `<div class="tip ${x.k}">${x.t}</div>`).join('');
}
function refreshAI(){ renderAI(); }

// =============== ربط واجهات وتهيئة ===============
function bindUI(){
  // التاريخ الافتراضي اليوم
  els.dateInput.value = toISODate(new Date());
  els.todayLabel.textContent = new Date().toLocaleDateString('ar-EG',{weekday:'long', day:'2-digit', month:'2-digit', year:'numeric'});

  // تغييرات: التاريخ/نوع الوجبة
  els.dateInput.onchange = ()=> loadDayMeasurements();
  els.mealType.onchange  = ()=> applyMealReadings();

  // Dirty flags للجرعات
  els.corrDose.oninput  = ()=>{ state.dirty.corr = true;  autoRecalcTotals(); refreshAI(); };
  els.carbDose.oninput  = ()=>{ state.dirty.carb = true;  autoRecalcTotals(); refreshAI(); };
  els.totalDose.oninput = ()=>{ state.dirty.total= true;  refreshAI(); };

  // مودال المكتبة
  els.openPicker.onclick = ()=>{ renderPicker(); els.dlgPicker.showModal(); };
  els.closePicker.onclick= ()=> els.dlgPicker.close();
  els.pickerSearch.oninput = ()=> renderPicker();
  window.addEventListener('foods:update', renderPicker);

  // القوالب
  els.openTemplates.onclick = ()=>{ startTemplatesLive(); filterTemplates(); els.dlgTemplates.showModal(); };
  els.closeTemplates.onclick = ()=> els.dlgTemplates.close();
  els.tplSearch.oninput = ()=> filterTemplates();
  els.saveTemplateBtn.onclick = ()=>{
    if (!state.items.length) return alert('أضف أصنافًا أولًا.');
    els.tplName.value=''; els.tplType.value='lunch'; els.saveDlg.showModal();
  };
  els.cancelSave.onclick = ()=> els.saveDlg.close();
  els.closeSave.onclick  = ()=> els.saveDlg.close();
  els.saveForm.onsubmit  = async (e)=>{
    e.preventDefault();
    await addDoc(TEMPLATES(), mapStateToTemplatePayload());
    els.saveDlg.close();
    alert('تم حفظ الوجبة الجاهزة ✨');
  };

  // AI
  els.aiRefresh.onclick = refreshAI;
}

// دخول المستخدم ثم تحميل الطفل والقياسات
onAuthStateChanged(auth, async user=>{
  state.uid = user?.uid || null;
  await loadChild();
  bindUI();
  renderItems();
  await loadDayMeasurements();
});

// عند إضافة/تغيير أصناف الوجبة نعيد الحساب
window.addEventListener('foods:update', ()=>{}); // موجود للمستقبل
