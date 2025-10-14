// /js/meals.js
import { auth, db, storage } from './firebase-config.js';
import {
  doc, getDoc, collection, query, where, orderBy, limit, getDocs,
  onSnapshot, addDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
  ref as sRef, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

/* -----------------------------------------------------------
   0)  Helpers + DOM refs
----------------------------------------------------------- */
const $ = sel => document.getElementById(sel);
const els = {
  brandTitle: $('brand-title'),
  childMeta:  $('child-meta'),
  todayLabel: $('today-label'),

  dateInput: $('dateInput'),
  mealType:  $('mealType'),

  pre: $('preMealInput'),
  post:$('postMealInput'),
  corrDose: $('corrDoseInput'),
  carbDose: $('carbDoseInput'),
  totalDose:$('totalDoseInput'),
  doseHints:$('dose-hints'),
  notes: $('notes'),

  body: $('items-body'),
  tCarbs: $('t-carbs'), tProt: $('t-protein'), tFat: $('t-fat'), tCal: $('t-cal'),

  dlgPicker: $('dlg-picker'), pickerSearch:$('picker-search'), pickerGrid:$('picker-grid'), pickerEmpty:$('picker-empty'),
  openPicker: $('btn-open-picker'), closePicker:$('close-picker'),

  openTemplates:$('btn-open-templates'), dlgTemplates:$('dlg-templates'), closeTemplates:$('close-templates'),
  tplList:$('tpl-list'), tplEmpty:$('tpl-empty'), tplSearch:$('tpl-search'),
  saveDlg:$('dlg-save'), saveForm:$('save-form'), tplName:$('tpl-name'), tplType:$('tpl-type'),
  cancelSave:$('cancel-save'), closeSave:$('close-save'), saveTemplateBtn:$('btn-save-template'),

  aiPanel:$('ai-panel'), aiTips:$('ai-tips'), aiRefresh:$('btn-refresh-ai'),
};

const state = {
  uid:null,
  childId: new URLSearchParams(location.search).get('child') || 'demo',
  child:null,
  items:[],
  templates:[],
  dirty:{ corr:false, carb:false, total:false },
  measurementsCache:[],
};

/* -----------------------------------------------------------
   1)  مزود مكتبة الأصناف (مدمج هنا لمنع 404)
       المصدر: admin/global/foodItems  (اقرأ فقط)
----------------------------------------------------------- */
const FOODS_COLL = collection(db, 'admin', 'global', 'foodItems');
const FOODS_STATE = { list:[], ready:false };
const toAr = s => (s||'').toString().toLowerCase()
  .replace(/[أإآا]/g,'ا').replace(/[ى]/g,'ي').replace(/[ؤئ]/g,'ء').replace(/\s+/g,' ').trim();
const n = (v,fb=0)=>Number.isFinite(Number(v))?Number(v):fb;

function normalizeMeasures(d){
  if (Array.isArray(d.units)) return d.units.filter(u=>u&&(u.label||u.name)&&Number(u.grams)>0)
    .map(u=>({name:u.label||u.name, grams:Number(u.grams), default:!!u.default}));
  if (Array.isArray(d.measures)) return d.measures.filter(m=>m&&m.name&&Number(m.grams)>0)
    .map(m=>({name:m.name, grams:Number(m.grams), default:!!m.default}));
  if (d.per100 || d.nutrPer100g) return [{name:'100 جم', grams:100, default:true}];
  return [];
}
function normalizeDoc(snap){
  const r = { id:snap.id, ...snap.data() };
  const p = r.per100 || r.nutrPer100g || {};
  const per100 = { cal_kcal:n(p.cal_kcal), carbs_g:n(p.carbs_g), protein_g:n(p.protein_g), fat_g:n(p.fat_g), fiber_g:n(p.fiber_g), sodium_mg:n(p.sodium_mg), gi:n(p.gi) };
  const measures = normalizeMeasures(r);
  const imageUrl = r.image?.url || r.imageUrl || '';
  const imagePath = r.image?.path || r.imagePath || '';
  return { id:r.id, name:r.name||'', category:r.category||'', per100, measures, imageUrl, imagePath, isActive: r.isActive !== false, searchText:r.searchText||'' };
}
async function resolveImages(items){
  await Promise.all(items.map(async f=>{
    if (!f.imageUrl && f.imagePath && !/^https?:\/\//.test(f.imagePath)){
      try{ f.imageUrl = await getDownloadURL(sRef(storage, f.imagePath)); }catch(_){}
    }
  }));
}
function publishFoods(){
  window.FOOD_LIBRARY = FOODS_STATE.list;
  window.searchFoods = function(q=''){
    const t = toAr(q); let list=[...FOODS_STATE.list];
    if (t) list = list.filter(x=>{
      const m = (x.measures||[]).map(v=>v.name).join(' ');
      return toAr(`${x.name} ${x.category} ${x.searchText} ${m}`).includes(t);
    });
    return list;
  };
  window.getFoodById = id => FOODS_STATE.list.find(x=>x.id===id) || null;
  window.dispatchEvent(new CustomEvent('foods:update',{detail:{list:FOODS_STATE.list}}));
  FOODS_STATE.ready=true;
}
onSnapshot(FOODS_COLL, async snap=>{
  const arr=[]; snap.forEach(s=>arr.push(normalizeDoc(s)));
  const uniq = new Map(arr.map(x=>[x.id,x])); const list=[...uniq.values()]
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar',{numeric:true}));
  await resolveImages(list); FOODS_STATE.list=list; publishFoods();
});

/* -----------------------------------------------------------
   2)  مسارات + أدوات
----------------------------------------------------------- */
const PARENT_CHILD = () => doc(db, 'parents', state.uid || 'x', 'children', state.childId);
const MEASUREMENTS = () => collection(db, 'parents', state.uid || 'x', 'children', state.childId, 'measurements');
const TEMPLATES = () => collection(db, 'children', state.childId, 'mealTemplates');

const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const roundTo = (v,step)=> Math.round(num(v)/step)*step;
const fmt = v => (Math.round(num(v)*10)/10).toString();
const toISO = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);

const toMmol = (val, unit)=> unit?.toLowerCase().includes('mg') ? (num(val)/18) : num(val);
const toMgdl= (val, unit)=> unit?.toLowerCase().includes('mg') ? num(val) : (num(val)*18);

const MEAL_SLOTS = {
  breakfast:{pre:'PRE_BREAKFAST', post:'POST_BREAKFAST'},
  lunch:{pre:'PRE_LUNCH', post:'POST_LUNCH'},
  dinner:{pre:'PRE_DINNER', post:'POST_DINNER'},
  snack:{pre:'SNACK', post:null}
};

/* -----------------------------------------------------------
   3)  تحميل بيانات الطفل (من parents/{uid}/children/{child})
----------------------------------------------------------- */
async function loadChild(){
  try{
    const snap = await getDoc(PARENT_CHILD());
    state.child = snap.exists()? snap.data() : {};
  }catch(e){
    console.warn('loadChild error', e);
    state.child = {};
  }
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const CF   = num(state.child?.CF || state.child?.cf || 0);
  const CR   = num(state.child?.CR || state.child?.cr || 0);
  const high = num(state.child?.high || state.child?.normalRange?.criticalHigh || 10.9);
  const step = num(state.child?.doseStep || 0.5);
  const name = state.child?.name || 'الطفل';

  state.child = { ...state.child, glucoseUnit:unit, CF, CR, high, doseStep:step, name };

  // UI
  els.brandTitle.textContent = `🍽️ وجبة ${name}`;
  document.title = `وجبة: ${name}`;
  els.childMeta.textContent  = `وحدة القياس: ${unit} • CF: ${CF} • CR: ${CR} • ارتفاع: ${high}`;
}

/* -----------------------------------------------------------
   4)  جسر القياسات
----------------------------------------------------------- */
function sameDay(ts, d){
  const x = new Date(ts);
  return x.getFullYear()===d.getFullYear() && x.getMonth()===d.getMonth() && x.getDate()===d.getDate();
}
async function loadDayMeasurements(){
  if (!state.uid) return;
  const day = els.dateInput.value ? new Date(els.dateInput.value) : new Date();
  const qy = query(MEASUREMENTS(), orderBy('createdAt','desc'), limit(60));
  const snap = await getDocs(qy);
  const arr=[];
  snap.forEach(s=>{
    const d = s.data();
    if (d?.createdAt?.toDate && sameDay(d.createdAt.toDate(), day)) arr.push({id:s.id, ...d});
    else if (d?.when && sameDay(new Date(d.when), day))          arr.push({id:s.id, ...d});
    else if (d?.date && d.date===toISO(day))                     arr.push({id:s.id, ...d});
  });
  state.measurementsCache = arr;
  applyMealReadings();
}
function lastBySlot(slot){
  const list = state.measurementsCache
    .filter(x=>x.slot===slot)
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
    const v = num(pre.value ?? pre.reading ?? 0);
    const u = pre.unit || unit;
    els.pre.value = u===unit ? v : (unit.toLowerCase().includes('mg') ? toMgdl(v,u) : toMmol(v,u));
  }
  if (post){
    const v = num(post.value ?? post.reading ?? 0);
    const u = post.unit || unit;
    els.post.value = u===unit ? v : (unit.toLowerCase().includes('mg') ? toMgdl(v,u) : toMmol(v,u));
  }
  autoRecalcCorrection();
}

/* -----------------------------------------------------------
   5)  الجرعات
----------------------------------------------------------- */
function autoRecalcCorrection(){
  if (state.dirty.corr) return;
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const CF   = num(state.child?.CF);
  const high = num(state.child?.high);
  const step = num(state.child?.doseStep || 0.5);
  const reading = num(els.pre.value);
  if (!reading || !CF || !high){ els.corrDose.value=''; return; }

  const readingMmol = toMmol(reading, unit);
  const highMmol    = toMmol(high,   unit);
  const diff = Math.max(0, readingMmol - highMmol);
  const corr = roundTo(diff / CF, step);
  els.corrDose.value = fmt(corr);
  autoRecalcTotals();
}
function autoRecalcCarb(){
  if (state.dirty.carb) return;
  const CR = num(state.child?.CR);
  const step = num(state.child?.doseStep || 0.5);
  const totalCarbs = calcTotals().carbs;
  if (!CR){ els.carbDose.value=''; return; }
  els.carbDose.value = fmt(roundTo(totalCarbs / CR, step));
  autoRecalcTotals();
}
function autoRecalcTotals(){
  if (state.dirty.total) return;
  els.totalDose.value = fmt(num(els.corrDose.value) + num(els.carbDose.value));
  updateDoseHints();
}
function updateDoseHints(){
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const CF   = num(state.child?.CF);
  const CR   = num(state.child?.CR);
  const high = num(state.child?.high);
  const pre  = num(els.pre.value);
  const tcarb= calcTotals().carbs;

  const tips=[];
  if (!CF) tips.push('⚠️ رجاء ضبط CF (معامل التصحيح) في بيانات الطفل.');
  if (!CR) tips.push('⚠️ رجاء ضبط CR (معامل الكارب) في بيانات الطفل.');
  if (pre){
    const preM = toMmol(pre, unit), hiM = toMmol(high, unit);
    tips.push(preM>hiM? `📈 قبل الوجبة أعلى من الحد (${fmt(hiM)} mmol/L). تم حساب تصحيح.` : '✅ قبل الوجبة ضمن النطاق.');
  }
  tips.push(`🍚 كارب الوجبة ≈ ${fmt(tcarb)}g.`);
  els.doseHints.textContent = tips.join('  •  ');
}

/* -----------------------------------------------------------
   6)  إدارة أصناف الوجبة
----------------------------------------------------------- */
function defaultMeasure(food){
  const m = (food.measures||[]).find(x=>x.default) || (food.measures||[])[0];
  return m || { name:'100 جم', grams:100, default:true };
}
function gramsOf(it){ return num(it.qty) * num(it.measureGrams); }
function macrosOf(it){
  const g = gramsOf(it), p = it.per100 || {};
  return { carbs:g*n(p.carbs_g)/100, protein:g*n(p.protein_g)/100, fat:g*n(p.fat_g)/100, cal:g*n(p.cal_kcal)/100 };
}
function calcTotals(){
  return state.items.reduce((a,it)=>{ const m=macrosOf(it); a.carbs+=m.carbs; a.protein+=m.protein; a.fat+=m.fat; a.cal+=m.cal; return a; },
    {carbs:0,protein:0,fat:0,cal:0});
}
function renderItems(){
  els.body.innerHTML = state.items.map((it,idx)=>{
    const m=macrosOf(it);
    return `
      <tr>
        <td>
          <div style="display:flex; gap:8px; align-items:center">
            ${it.imageUrl ? `<img src="${it.imageUrl}" style="width:38px;height:38px;border-radius:8px;object-fit:cover">` : ''}
            <div><div style="font-weight:800">${it.name}</div><div class="muted sm">ID: ${it.foodId}</div></div>
          </div>
        </td>
        <td>
          <input class="row-measure" data-idx="${idx}" type="text" value="${it.measureName}" list="common-measures">
          <datalist id="common-measures">
            <option value="100 جم"></option><option value="ملعقة صغيرة"></option><option value="ملعقة كبيرة"></option>
            <option value="كوب"></option><option value="½ كوب"></option><option value="حبة"></option>
          </datalist>
          <div class="muted sm">جرام/وحدة</div>
          <input class="row-grams-per-unit" data-idx="${idx}" type="number" step="0.1" value="${it.measureGrams}">
        </td>
        <td><input class="row-qty" data-idx="${idx}" type="number" step="0.5" min="0" value="${it.qty}"></td>
        <td class="muted">${fmt(gramsOf(it))}</td>
        <td>${fmt(m.carbs)}</td><td>${fmt(m.protein)}</td><td>${fmt(m.fat)}</td><td>${fmt(m.cal)}</td>
        <td><button class="btn ghost" data-del="${idx}">حذف</button></td>
      </tr>`;
  }).join('');
  els.body.querySelectorAll('[data-del]').forEach(b=> b.onclick=()=>{ state.items.splice(Number(b.dataset.del),1); renderItems(); updateNutritionAndDoses(); });
  els.body.querySelectorAll('.row-measure').forEach(i=> i.oninput=()=>{ state.items[i.dataset.idx].measureName=i.value; updateNutritionAndDoses(); });
  els.body.querySelectorAll('.row-grams-per-unit').forEach(i=> i.oninput=()=>{ state.items[i.dataset.idx].measureGrams=num(i.value)||0; updateNutritionAndDoses(); });
  els.body.querySelectorAll('.row-qty').forEach(i=> i.oninput=()=>{ state.items[i.dataset.idx].qty=num(i.value)||0; updateNutritionAndDoses(); });
  updateNutritionAndDoses();
}
function updateNutritionAndDoses(){
  const t = calcTotals(); els.tCarbs.textContent=fmt(t.carbs); els.tProt.textContent=fmt(t.protein); els.tFat.textContent=fmt(t.fat); els.tCal.textContent=fmt(t.cal);
  autoRecalcCarb(); autoRecalcTotals(); refreshAI();
}
function addFoodToMeal(food){
  const dm = defaultMeasure(food);
  state.items.push({
    foodId:food.id, name:food.name, per100:food.per100,
    measureName:dm.name, measureGrams:Number(dm.grams)||100, qty:1,
    imageUrl: food.imageUrl||''
  });
  renderItems();
}

/* -----------------------------------------------------------
   7)  مودال المكتبة
----------------------------------------------------------- */
function renderPicker(){
  const q = (els.pickerSearch.value||'').trim();
  const list = (typeof window.searchFoods==='function') ? window.searchFoods(q) : (window.FOOD_LIBRARY||[]);
  els.pickerGrid.innerHTML = list.map(x=>`
    <article class="card-food">
      ${x.imageUrl?`<img class="thumb" src="${x.imageUrl}" alt="">`:''}
      <div class="title">${x.name}</div>
      <div class="meta">${x.category||''}</div>
      <div class="meta">kcal/100g: ${x.per100?.cal_kcal ?? 0}</div>
      <div class="actions"><button class="btn" data-use="${x.id}">استخدام</button></div>
    </article>`).join('');
  els.pickerEmpty.hidden = list.length!==0;
  els.pickerGrid.querySelectorAll('[data-use]').forEach(b=>{
    b.onclick=()=>{ const f=(window.FOOD_LIBRARY||[]).find(y=>y.id===b.dataset.use); if(f) addFoodToMeal(f); els.dlgPicker.close(); };
  });
}

/* -----------------------------------------------------------
   8)  القوالب
----------------------------------------------------------- */
let unsubTpl=null;
function startTemplatesLive(){
  if (unsubTpl) return;
  unsubTpl = onSnapshot(TEMPLATES(), snap=>{
    const arr=[]; snap.forEach(s=>arr.push({id:s.id, ...s.data()}));
    state.templates = arr.sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar',{numeric:true}));
    filterTemplates();
  });
}
function renderTemplates(list){
  els.tplList.innerHTML = list.map(t=>`
    <article class="tpl-card">
      <div class="title">${t.name}</div>
      <div class="meta">${t.type||''} • ${t.items?.length||0} صنف</div>
      <div class="actions">
        <button class="btn" data-apply="${t.id}">استخدام</button>
        <button class="btn ghost" data-del="${t.id}">حذف</button>
      </div>
    </article>`).join('');
  els.tplEmpty.hidden = list.length!==0;
  els.tplList.querySelectorAll('[data-apply]').forEach(b=> b.onclick=()=> applyTemplate(b.dataset.apply));
  els.tplList.querySelectorAll('[data-del]').forEach(b=> b.onclick=async()=>{ if(confirm('حذف القالب؟')) await deleteDoc(doc(TEMPLATES(), b.dataset.del)); });
}
function filterTemplates(){
  const q=(els.tplSearch.value||'').trim().toLowerCase();
  const list = q ? state.templates.filter(t=>(t.name||'').toLowerCase().includes(q)) : state.templates;
  renderTemplates(list);
}
async function applyTemplate(id){
  const t = state.templates.find(x=>x.id===id); if(!t) return;
  (t.items||[]).forEach(it=>{
    const fromLib=(window.FOOD_LIBRARY||[]).find(f=>f.id===it.foodId);
    const per100= fromLib?.per100 || it.per100 || {carbs_g:0,protein_g:0,fat_g:0,cal_kcal:0};
    state.items.push({
      foodId:it.foodId, name:fromLib?.name || it.name || 'صنف',
      per100, measureName:it.measureName||'100 جم', measureGrams:num(it.measureGrams)||100,
      qty:num(it.qty)||1, imageUrl:fromLib?.imageUrl || it.imageUrl || ''
    });
  });
  els.dlgTemplates.close(); renderItems();
}
function mapStateToTemplatePayload(){
  return {
    name: els.tplName.value.trim(),
    type: els.tplType.value,
    items: state.items.map(it=>({
      foodId:it.foodId, name:it.name, per100:it.per100,
      measureName:it.measureName, measureGrams:num(it.measureGrams), qty:num(it.qty), imageUrl:it.imageUrl||''
    })),
    notes:(els.notes.value||'').trim(),
    createdAt:serverTimestamp(), updatedAt:serverTimestamp()
  };
}

/* -----------------------------------------------------------
   9)  المساعد الذكي
----------------------------------------------------------- */
function smartAdvice(){
  const unit = state.child?.glucoseUnit || 'mmol/L';
  const high = num(state.child?.high);
  const pre  = num(els.pre.value);  const post = num(els.post.value);
  const tcarb= calcTotals().carbs;  const cr = num(state.child?.CR);
  const corr = num(els.corrDose.value);

  const out=[];
  if (pre){
    const preM=toMmol(pre,unit), hiM=toMmol(high,unit);
    out.push(preM>hiM ? {t:`القراءة قبل الوجبة أعلى من الحد (${fmt(hiM)} mmol/L). تم اقتراح تصحيح ${fmt(corr)}U.`, k:'warn'}
                      : {t:'القراءة قبل الوجبة ضمن النطاق.', k:'good'});
  }
  if (post){
    const postM=toMmol(post,unit), hiM=toMmol(high,unit);
    if (postM>hiM+2) out.push({t:'قراءة بعد الوجبة مرتفعة نسبيًا. راجعي توقيت الجرعة أو توزيع الكارب.', k:'danger'});
  }
  if (cr){ out.push({t:`جرعة الكارب المقترحة ≈ ${fmt(roundTo(tcarb/cr, state.child?.doseStep||0.5))}U لكارب ${fmt(tcarb)}g.`, k:'good'}); }
  if (!out.length) out.push({t:'أضِف قياسات أو أصنافًا لاقتراحات أدق.', k:'warn'});
  return out;
}
function renderAI(){
  const tips = smartAdvice();
  els.aiTips.innerHTML = tips.map(x=>`<div class="tip ${x.k}">${x.t}</div>`).join('');
}
function refreshAI(){ renderAI(); }

/* -----------------------------------------------------------
   10)  ربط الواجهة + تهيئة
----------------------------------------------------------- */
function bindUI(){
  els.dateInput.value = toISO(new Date());
  els.todayLabel.textContent = new Date().toLocaleDateString('ar-EG',{weekday:'long', day:'2-digit', month:'2-digit', year:'numeric'});

  els.dateInput.onchange = ()=> loadDayMeasurements();
  els.mealType.onchange  = ()=> applyMealReadings();

  els.corrDose.oninput  = ()=>{ state.dirty.corr=true;  autoRecalcTotals(); refreshAI(); };
  els.carbDose.oninput  = ()=>{ state.dirty.carb=true;  autoRecalcTotals(); refreshAI(); };
  els.totalDose.oninput = ()=>{ state.dirty.total=true; refreshAI(); };

  els.openPicker.onclick = ()=>{ renderPicker(); els.dlgPicker.showModal(); };
  els.closePicker.onclick= ()=> els.dlgPicker.close();
  els.pickerSearch.oninput = ()=> renderPicker();
  window.addEventListener('foods:update', renderPicker);

  els.openTemplates.onclick = ()=>{ startTemplatesLive(); filterTemplates(); els.dlgTemplates.showModal(); };
  els.closeTemplates.onclick = ()=> els.dlgTemplates.close();
  els.tplSearch.oninput = ()=> filterTemplates();

  els.saveTemplateBtn.onclick = ()=>{
    if (!state.items.length) return alert('أضف أصنافًا أولًا.');
    els.tplName.value=''; els.tplType.value='lunch'; els.saveDlg.showModal();
  };
  els.cancelSave.onclick = ()=> els.saveDlg.close();
  els.closeSave.onclick  = ()=> els.saveDlg.close();
  els.saveForm.onsubmit  = async e=>{
    e.preventDefault();
    await addDoc(TEMPLATES(), mapStateToTemplatePayload());
    els.saveDlg.close();
    alert('تم حفظ الوجبة الجاهزة ✨');
  };

  els.aiRefresh.onclick = refreshAI;
}
// Auth → تحميل الطفل → القياسات
onAuthStateChanged(auth, async user=>{
  state.uid = user?.uid || null;
  await loadChild();
  bindUI();
  renderItems();
  await loadDayMeasurements();
});
