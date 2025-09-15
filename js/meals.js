// js/meals.js — يعمل مع meals.html كما هو (كامل) + reachTargetSmart() الجديدة
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc,
  query, where, orderBy, limit, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ===== أدوات عامة ===== */
const $ = (id)=>document.getElementById(id);
const esc=(s)=> (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const toNum=(v)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const round1=(n)=>Math.round((Number(n)||0)*10)/10;
const todayISO=()=>new Date().toISOString().slice(0,10);

/* ===== عناصر من الصفحة ===== */
const childNameEl=$('childName'); const childMetaEl=$('childMeta');
const settingsLink=$('settingsLink'); const backBtn=$('backBtn');

const mealDateEl=$('mealDate'); const mealTypeEl=$('mealType');
const preReadingEl=$('preReading'); const postReadingEl=$('postReading');

const goalTypeEl=$('goalType'); const goalMinEl=$('goalMin'); const goalMaxEl=$('goalMax');
const unitChipEl=$('unitChip'); const carbProgress=$('carbProgress'); const carbStateEl=$('carbState');

const addItemBtn=$('addItemBtn'); const repeatLastBtn=$('repeatLastBtn');
const aiBtn=$('aiBtn'); const presetBtn=$('presetBtn'); const presetSaveBtn=$('presetSaveBtn');

const itemsBodyEl=$('itemsBody');
const tGramsEl=$('tGrams'); const tCarbsEl=$('tCarbs'); const tFiberEl=$('tFiber');
const tNetCarbsEl=$('tNetCarbs'); const tCalEl=$('tCal'); const tProtEl=$('tProt'); const tFatEl=$('tFat'); const tGLEl=$('tGL');
const useNetCarbsEl=$('useNetCarbs');

const reachTargetBtn=$('reachTargetBtn'); const suggestedDoseEl=$('suggestedDose');
const doseExplainEl=$('doseExplain'); const doseRangeEl=$('doseRange'); const appliedDoseEl=$('appliedDose');
const mealNotesEl=$('mealNotes');

const saveMealBtn=$('saveMealBtn'); const resetMealBtn=$('resetMealBtn'); const printDayBtn=$('printDayBtn');

const tableDateEl=$('tableDate'); const filterTypeEl=$('filterType');
const mealsListEl=$('mealsList'); const noMealsEl=$('noMeals');

const pickerModal=$('pickerModal'); const pickSearchEl=$('pickSearch'); const pickCategoryEl=$('pickCategory');
const pickerGrid=$('pickerGrid'); const pickerEmpty=$('pickerEmpty'); const closePicker=$('closePicker');

const aiModal=$('aiModal'); const aiClose=$('aiClose'); const aiText=$('aiText');
const aiAnalyze=$('aiAnalyze'); const aiApply=$('aiApply'); const aiResults=$('aiResults');

const presetModal=$('presetModal'); const presetClose=$('presetClose');
const presetGrid=$('presetGrid'); const presetTabs=presetModal?.querySelectorAll('.tab');

const toastEl=$('toast');
function toast(msg,type='info'){ if(!toastEl) return;
  toastEl.textContent=msg; toastEl.className=`toast ${type}`;
  toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'),2500);
}

/* ===== حالة عامة ===== */
const params=new URLSearchParams(location.search);
const childId=(params.get('child')||'').trim();

let currentUser=null, childRef=null, childData=null;
let mealsCol=null, measurementsCol=null, presetsCol=null;
let foodCache=[]; let items=[];

/* ===== مسارات عامة ===== */
const PUBLIC_FOOD=()=>collection(db,'admin','global','foodItems');

/* ===== Utils للطفل والأهداف ===== */
function mapMealKey(ar){ return ({'فطار':'breakfast','غدا':'lunch','عشا':'dinner','سناك':'snack'})[ar]||'breakfast'; }
function applyUnitChip(){ const unit=childData?.bolusType||childData?.unit||'—'; unitChipEl&&(unitChipEl.textContent=`وحدة: ${unit}`); }
function applyTargets(){
  const typeTxt=mealTypeEl?.value||'فطار';
  goalTypeEl && (goalTypeEl.textContent=typeTxt);
  const k=mapMealKey(typeTxt); const t=childData?.carbTargets?.[k];
  if(t && typeof t.min==='number' && typeof t.max==='number'){
    goalMinEl.textContent=t.min; goalMaxEl.textContent=t.max;
  }else{ goalMinEl.textContent='—'; goalMaxEl.textContent='—'; }
  recalcAll();
}

/* ===== تحميل الطفل ===== */
async function resolveChildRef(uid,cid){
  let r=doc(db,'parents',uid,'children',cid), s=await getDoc(r);
  if(s.exists()) return {ref:r,data:s.data()};
  r=doc(db,'users',uid,'children',cid); s=await getDoc(r);
  if(s.exists()) return {ref:r,data:s.data()};
  return {ref:null,data:null};
}
async function loadChild(uid){
  if(!childId){ location.replace('child.html'); return; }
  const {ref,data}=await resolveChildRef(uid,childId);
  if(!ref){ toast('الطفل غير موجود لهذا الحساب','error'); return; }
  childRef=ref; childData=data||{};
  mealsCol=collection(childRef,'meals');
  measurementsCol=collection(childRef,'measurements');
  presetsCol=collection(childRef,'presetMeals');

  childNameEl && (childNameEl.textContent=childData.displayName||childData.name||'الطفل');
  childMetaEl && (childMetaEl.textContent=`تاريخ الميلاد: ${childData?.birthDate||'—'} • نوع الإنسولين: ${childData?.basalType||'—'}`);
  applyUnitChip(); applyTargets();

  settingsLink && (settingsLink.href=`child-edit.html?child=${encodeURIComponent(childId)}`);
  backBtn && backBtn.addEventListener('click',()=>location.href=`child.html?child=${encodeURIComponent(childId)}`);
}

/* ===== كتالوج الطعام ===== */
function normalizeMeasures(d){
  if(Array.isArray(d?.measures)) return d.measures.filter(m=>m?.name && Number(m.grams)>0).map(m=>({name:m.name,grams:Number(m.grams)}));
  if(d?.measureQty && typeof d.measureQty==='object') return Object.entries(d.measureQty).filter(([n,g])=>n&&Number(g)>0).map(([n,g])=>({name:n,grams:Number(g)}));
  if(Array.isArray(d?.householdUnits)) return d.householdUnits.filter(m=>m?.name && Number(m.grams)>0).map(m=>({name:m.name,grams:Number(m.grams)}));
  return [];
}
function mapFood(s){ const d={id:s.id,...s.data()};
  const nutr=d.nutrPer100g||{
    carbs_g:Number(d.carbs_100g??0), fiber_g:Number(d.fiber_100g??0),
    protein_g:Number(d.protein_100g??0), fat_g:Number(d.fat_100g??0),
    cal_kcal:Number(d.calories_100g??0)
  };
  return { id:d.id, name:d.name||'صنف', brand:d.brand||null, category:d.category||null,
    imageUrl:d.imageUrl||null, tags:d.tags||[], gi:d.gi??null, nutrPer100g:nutr, measures:normalizeMeasures(d) };
}
async function ensureFoodCache(){
  if(foodCache.length) return;
  let snap; try{ snap=await getDocs(query(PUBLIC_FOOD(),orderBy('name'))); }
  catch{ snap=await getDocs(PUBLIC_FOOD()); }
  foodCache=[]; snap.forEach(s=>foodCache.push(mapFood(s)));
}

/* ===== المكتبة (مودال) ===== */
function openPicker(){ pickerModal?.classList.remove('hidden'); document.body.style.overflow='hidden'; renderPicker(); }
function closePickerModal(){ pickerModal?.classList.add('hidden'); document.body.style.overflow=''; }
function renderPicker(){
  if(!pickerGrid) return;
  const q=(pickSearchEl?.value||'').trim(); const cat=(pickCategoryEl?.value||'الكل').trim();
  const list=foodCache.filter(f=>{
    const matchQ=!q || f.name.includes(q)||f.brand?.includes(q)||f.tags?.some(t=>t.includes(q))||(q.startsWith('#') && f.tags?.includes(q.slice(1)));
    const matchC=(cat==='الكل')||(f.category===cat); return matchQ&&matchC;
  });
  pickerEmpty?.classList.toggle('hidden',list.length>0);
  pickerGrid.innerHTML=list.map(f=>`
    <button class="card pick" data-id="${esc(f.id)}">
      <img src="${esc(f.imageUrl||'')}" alt="">
      <div class="t">
        <div class="n">${esc(f.name)}</div>
        ${f.brand?`<div class="b muted">${esc(f.brand)}</div>`:''}
        ${(f.measures?.length||0)?`<div class="m">${f.measures.map(m=>`<span class="chip">${esc(m.name)} (${m.grams}جم)</span>`).join(' ')}</div>`:'<div class="m muted">لا تقديرات بيتية</div>'}
      </div>
    </button>`).join('');

  pickerGrid.querySelectorAll('.pick').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const it=foodCache.find(x=>x.id===btn.dataset.id);
      if(it){ addRowFromFood(it); closePickerModal(); }
    });
  });
}

/* ===== عناصر الوجبة ===== */
let itemsObs=null;
function addRowFromFood(f){
  const r={ id:crypto.randomUUID(), itemId:f.id, name:f.name, brand:f.brand||null,
    unit:'grams', qty:0, measure:null, grams:0,
    per100:{ carbs:toNum(f?.nutrPer100g?.carbs_g), fiber:toNum(f?.nutrPer100g?.fiber_g),
             cal:toNum(f?.nutrPer100g?.cal_kcal), prot:toNum(f?.nutrPer100g?.protein_g),
             fat:toNum(f?.nutrPer100g?.fat_g) },
    gi:f.gi??null, measures:Array.isArray(f?.measures)?f.measures:[],
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
          ${(r.measures||[]).map(m=>`<option value="${esc(m.name)}" ${r.measure===m.name?'selected':''}>${esc(m.name)} (${m.grams}جم)</option>`).join('')}
        </select>
      </div>
      <div class="cell"><span class="grams">${round1(r.grams)}</span></div>
      <div class="cell"><span class="carbs">${round1(r.calc.carbs)}</span></div>
      <div class="cell"><span class="fiber">${round1(r.calc.fiber)}</span></div>
      <div class="cell"><span class="cal">${round1(r.calc.cal)}</span></div>
      <div class="cell"><span class="prot">${round1(r.calc.prot)}</span></div>
      <div class="cell"><span class="fat">${round1(r.calc.fat)}</span></div>
      <div class="cell"><button class="secondary del">حذف</button></div>`;
    itemsBodyEl.appendChild(row);

    const unitSel=row.querySelector('.unit'); const qtyInp=row.querySelector('.qty');
    const measSel=row.querySelector('.measure'); const gramsEl=row.querySelector('.grams');
    const carbsEl=row.querySelector('.carbs'); const fiberEl=row.querySelector('.fiber');
    const calEl=row.querySelector('.cal'); const protEl=row.querySelector('.prot'); const fatEl=row.querySelector('.fat');

    function recalc(){
      if(r.unit==='grams'){ r.grams=toNum(qtyInp.value); }
      else{ const m=r.measures.find(x=>x.name===measSel.value); r.measure=m?.name||null; r.grams=toNum(qtyInp.value)*(m?.grams||0); }
      r.calc.carbs=r.per100.carbs*(r.grams/100); r.calc.fiber=r.per100.fiber*(r.grams/100);
      r.calc.cal=r.per100.cal*(r.grams/100); r.calc.prot=r.per100.prot*(r.grams/100); r.calc.fat=r.per100.fat*(r.grams/100);
      gramsEl.textContent=round1(r.grams); carbsEl.textContent=round1(r.calc.carbs);
      fiberEl.textContent=round1(r.calc.fiber); calEl.textContent=round1(r.calc.cal);
      protEl.textContent=round1(r.calc.prot); fatEl.textContent=round1(r.calc.fat);
      recalcAll();
    }
    unitSel.addEventListener('change',()=>{ r.unit=unitSel.value; recalc(); });
    qtyInp.addEventListener('input',recalc); measSel.addEventListener('change',recalc);
    row.querySelector('.del').addEventListener('click',()=>{ items=items.filter(x=>x!==r); renderItems(); recalcAll(); });
  });
}

/* ===== حساب الإجماليات + شريط الهدف + جرعة توعوية ===== */
function recalcAll(){
  const totalG=items.reduce((a,r)=>a+r.grams,0);
  const totalC=items.reduce((a,r)=>a+r.calc.carbs,0);
  const totalF=items.reduce((a,r)=>a+r.calc.fiber,0);
  const totalCal=items.reduce((a,r)=>a+r.calc.cal,0);
  const totalP=items.reduce((a,r)=>a+r.calc.prot,0);
  const totalFat=items.reduce((a,r)=>a+r.calc.fat,0);
  const net=Math.max(0,totalC-totalF);

  tGramsEl.textContent=round1(totalG); tCarbsEl.textContent=round1(totalC); tFiberEl.textContent=round1(totalF);
  tNetCarbsEl.textContent=round1(net); tCalEl.textContent=round1(totalCal); tProtEl.textContent=round1(totalP); tFatEl.textContent=round1(totalFat);

  const min=Number(goalMinEl.textContent)||0, max=Number(goalMaxEl.textContent)||0;
  const val=useNetCarbsEl?.checked?net:totalC; let pct=0;
  if(max>0) pct=Math.min(100,Math.max(0,(val/max)*100));
  carbProgress && (carbProgress.style.width=`${pct}%`);
  if(carbStateEl){
    if(!min&&!max) carbStateEl.textContent='—';
    else if(val<min) carbStateEl.textContent='أقل من الهدف';
    else if(val>max) carbStateEl.textContent='أعلى من الهدف';
    else carbStateEl.textContent='داخل النطاق';
  }

  const ratio=Number(childData?.carbRatio)||0;
  if(ratio>0){
    const used=val; const dose=used/ratio;
    suggestedDoseEl.textContent=round1(dose);
    doseExplainEl.textContent=`${used}g ÷ ${ratio}`;
    doseRangeEl.textContent=`${round1(Math.max(0,dose-0.5))}–${round1(dose+0.5)} U`;
  }else{ suggestedDoseEl.textContent='0'; doseExplainEl.textContent=''; doseRangeEl.textContent='—'; }
}

/* ===== تكرار آخر وجبة ===== */
async function repeatLast(){
  if(!mealsCol) return;
  const type=mealTypeEl?.value||'فطار';
  const qy=query(mealsCol, where('type','==',type), orderBy('createdAt','desc'), limit(1));
  const snap=await getDocs(qy);
  if(snap.empty){ toast('لا توجد وجبة سابقة لهذا النوع','info'); return; }
  const d=snap.docs[0].data();
  items=Array.isArray(d.items)?d.items.map(x=>({...x})):[];
  renderItems(); recalcAll(); toast('تم جلب آخر وجبة ✅','success');
}

/* ===== مساعد الوصول للهدف — النسخة الذكية ===== */

/** جرام كارب لكل 1 جم طعام */
function carbPerGram(row){
  const c=row?.per100?.carbs||0; return c>0 ? c/100 : 0;
}
/** أقرب قيمة لخطوة معينة (افتراضي 0.25) */
function roundToStep(v, step=0.25){
  return Math.round(v/step)*step;
}
/** يطبّق تعديل الجرامات على صف مع مراعاة نوع الوحدة والسقوف. يرجّع كمية الكارب التي تغيّرت فعليًا */
function applyGramsDelta(row, gramsDelta, opts){
  const {
    maxItemGrams=100,           // سقف العنصر النهائي بالجرام
    maxPressGrams=25,           // سقف التغيير لكل ضغطة (جرام)
    hhStep=0.25,                // خطوة التقدير البيتي
    maxPressHH=0.5              // أقصى تغيير بالوحدة البيتي في الضغطة
  } = opts || {};

  const cpg=carbPerGram(row);
  if(cpg<=0) return 0;

  // حد الضغطة
  const limitedDelta = Math.max(-maxPressGrams, Math.min(maxPressGrams, gramsDelta));

  if(row.unit==='grams'){ // تغيير مباشر بالجرام
    const newGrams = Math.max(0, Math.min(maxItemGrams, row.grams + limitedDelta));
    const realDeltaGrams = newGrams - row.grams;
    row.grams = newGrams;
    row.qty = row.grams; // في وضع الجرام، qty = grams
    // تحديث القيم الغذائية
    row.calc.carbs = row.per100.carbs*(row.grams/100);
    row.calc.fiber = row.per100.fiber*(row.grams/100);
    row.calc.cal   = row.per100.cal  *(row.grams/100);
    row.calc.prot  = row.per100.prot *(row.grams/100);
    row.calc.fat   = row.per100.fat  *(row.grams/100);
    return realDeltaGrams * cpg;
  }else{ // household
    const m = row.measures.find(x=>x.name===row.measure) || row.measures[0];
    if(!m || !m.grams) return 0;
    const gramsPerUnit = m.grams;
    // حوّل الجرامات المطلوبة إلى وحدات بيتي
    let deltaUnits = limitedDelta / gramsPerUnit;
    // سقف الضغطة بالوحدة البيتي
    deltaUnits = Math.max(-maxPressHH, Math.min(maxPressHH, deltaUnits));
    // تقريــب للخطوة المسموحة (0.25 كما طلبتي)
    deltaUnits = roundToStep(deltaUnits, hhStep);

    // الكمية الجديدة بالوحدة
    const newQty = Math.max(0, row.qty + deltaUnits);
    const newGrams = Math.min(maxItemGrams, newQty * gramsPerUnit);
    // لو بسبب السقف رجّعنا أقل، أعيدي حساب الدلتا الفعلية
    const realUnits = newGrams/gramsPerUnit - row.qty;

    row.qty = roundToStep(newGrams/gramsPerUnit, hhStep);
    row.grams = row.qty * gramsPerUnit;

    row.calc.carbs = row.per100.carbs*(row.grams/100);
    row.calc.fiber = row.per100.fiber*(row.grams/100);
    row.calc.cal   = row.per100.cal  *(row.grams/100);
    row.calc.prot  = row.per100.prot *(row.grams/100);
    row.calc.fat   = row.per100.fat  *(row.grams/100);

    return (realUnits*gramsPerUnit) * cpg;
  }
}

/** حساب إجمالي الكارب (أو الصافي) للحالة الحالية */
function computeCurrentCarbs(){
  const totalC=items.reduce((a,r)=>a+r.calc.carbs,0);
  const totalF=items.reduce((a,r)=>a+r.calc.fiber,0);
  return useNetCarbsEl?.checked ? Math.max(0,totalC-totalF) : totalC;
}

/** ضبط للوصول للهدف — ذكي وتدريجي */
function reachTargetSmart(){
  const min=Number(goalMinEl.textContent)||0, max=Number(goalMaxEl.textContent)||0;
  const hasRange = !!(min||max);
  const target = max || min;
  if(!hasRange || !target){ toast('لا يوجد هدف محدد للكارب','info'); return; }
  if(items.length===0){ toast('أضف عناصر أولاً','info'); return; }

  let current = computeCurrentCarbs();
  let deficit = target - current;
  const tolerance = 3; // لو الفرق ≤ 3 جم نعتبر وصلنا
  if(Math.abs(deficit) <= tolerance){ toast('داخل النطاق بالفعل ✅','success'); return; }

  // قائمة العناصر مرتبة حسب الكثافة (زيادة) أو حسب مساهمة الكارب (نقص)
  const withCpg = items.map((r)=>({r, cpg:carbPerGram(r), contrib:r.calc.carbs}))
                       .filter(x=>x.cpg>0);
  if(!withCpg.length){ toast('لا توجد عناصر ذات كارب لإعادة الضبط','info'); return; }

  const MAX_LOOPS = 6;           // محاولات داخل الضغطة الواحدة
  const CHUNK_CARB = 8;          // نقترب على جولات 8 جم كارب تقريبًا
  const opts = { maxItemGrams:100, maxPressGrams:25, hhStep:0.25, maxPressHH:0.5 };

  let loops = 0;
  while(Math.abs(deficit) > tolerance && loops < MAX_LOOPS){
    loops++;

    if(deficit > 0){
      // نحتاج زيادة — وزع على العناصر الأعلى كثافة أولاً
      withCpg.sort((a,b)=>b.cpg - a.cpg);
      for(const it of withCpg){
        if(deficit <= tolerance) break;
        const wantCarb = Math.min(deficit, CHUNK_CARB);
        const gramsDelta = wantCarb / it.cpg;
        const gotCarb = applyGramsDelta(it.r, gramsDelta, opts);
        deficit -= gotCarb;
      }
    }else{
      // نحتاج تقليل — قلل من الأعلى مساهمة أولاً
      withCpg.sort((a,b)=>b.contrib - a.contrib);
      for(const it of withCpg){
        if(Math.abs(deficit) <= tolerance) break;
        const wantCarb = Math.min(Math.abs(deficit), CHUNK_CARB);
        const gramsDelta = -(wantCarb / it.cpg);
        const gotCarb = applyGramsDelta(it.r, gramsDelta, opts);
        deficit += Math.abs(gotCarb);
      }
    }
    // أعِد الحساب لِلّفّة القادمة
    current = computeCurrentCarbs();
    deficit = target - current;
  }

  renderItems(); // نعيد رسم الصفوف بالقيم الجديدة
  recalcAll();

  const left = Math.round(deficit);
  if(Math.abs(left) <= tolerance) toast('اقتربنا جدًا من الهدف 🎯','success');
  else toast(`ما زال الفرق حوالي ${left} جم`, 'info');
}

/* ===== حفظ/إعادة/طباعة ===== */
async function saveMeal(){
  if(!mealsCol){ toast('لم يتم تحميل الطفل','error'); return; }
  const payload={
    date:mealDateEl?.value||todayISO(),
    type:mealTypeEl?.value||'فطار',
    items,
    preReading:preReadingEl?.value||null,
    postReading:postReadingEl?.value||null,
    netCarbsMode:!!useNetCarbsEl?.checked,
    suggestedDose:Number(suggestedDoseEl?.textContent)||0,
    appliedDose:Number(appliedDoseEl?.value)||null,
    notes:(mealNotesEl?.value||'').trim()||null,
    createdAt:serverTimestamp()
  };
  await addDoc(mealsCol,payload);
  toast('تم حفظ الوجبة ✔️','success'); loadMealsOfDay();
}
function resetMeal(){ items=[]; renderItems(); recalcAll(); appliedDoseEl&&(appliedDoseEl.value=''); mealNotesEl&&(mealNotesEl.value=''); }
function printDay(){ window.print(); }

/* ===== جدول اليوم ===== */
async function loadMealsOfDay(){
  if(!mealsCol) return;
  const d=mealDateEl?.value||todayISO();
  tableDateEl && (tableDateEl.textContent=d);
  const qy=query(mealsCol, where('date','==',d), orderBy('createdAt','desc'));
  const snap=await getDocs(qy); const list=[]; snap.forEach(s=>list.push({id:s.id,...s.data()}));
  renderMealsList(list);
}
function renderMealsList(list){
  const filter=filterTypeEl?.value||'الكل';
  const data=list.filter(m=>filter==='الكل'||m.type===filter);
  noMealsEl?.classList.toggle('hidden',data.length>0);
  mealsListEl.innerHTML=data.map(m=>`
    <div class="meal-row card">
      <div class="mr-head"><strong>${esc(m.type)}</strong><span class="muted tiny">${esc(m.date||'')}</span></div>
      <div class="mr-body">${(Array.isArray(m.items)?m.items:[]).map(it=>`<span class="chip">${esc(it.name)} — ${round1(it.grams)}جم</span>`).join(' ')}</div>
      <div class="mr-actions"><button class="secondary" data-id="${esc(m.id)}">تحميل للمنشئ</button></div>
    </div>`).join('');
  mealsListEl.querySelectorAll('.mr-actions button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id=btn.dataset.id; const m=list.find(x=>x.id===id); if(!m) return;
      items=Array.isArray(m.items)?m.items.map(x=>({...x})):[]; renderItems(); recalcAll(); toast('تم تحميل الوجبة إلى المنشئ ✅','success');
    });
  });
}

/* ===== قياسات السكر للقوائم ===== */
async function loadMeasurementsOptions(){
  if(!measurementsCol) return;
  const qy=query(measurementsCol, orderBy('ts','desc'), limit(50));
  const snap=await getDocs(qy);
  function fill(sel){
    if(!sel) return; sel.innerHTML=`<option value="">—</option>`;
    snap.forEach(d=>{
      const v=d.data(); const val=v?.value??v?.reading??''; const ts=v?.ts?.toDate?.()||null;
      const when=ts?ts.toLocaleString('ar-EG'):''; sel.insertAdjacentHTML('beforeend',`<option value="${esc(val)}">${esc(val)} — ${esc(when)}</option>`);
    });
  }
  fill(preReadingEl); fill(postReadingEl);
}

/* ===== الوجبات الجاهزة ===== */
async function loadPresetsUI(type='فطار'){
  if(!presetGrid||!presetsCol) return;
  const qy=query(presetsCol, where('type','==',type));
  const snap=await getDocs(qy); const arr=[]; snap.forEach(d=>arr.push({id:d.id,...d.data()}));
  presetGrid.innerHTML=arr.map(p=>`
    <button class="card preset" data-id="${esc(p.id)}">
      <div class="n">${esc(p.name||'وجبة جاهزة')}</div>
      <div class="m">${(p.items||[]).map(x=>`<span class="chip">${esc(x.name)}</span>`).join(' ')}</div>
    </button>`).join('')||'<div class="empty">لا توجد وجبات جاهزة لهذا النوع.</div>';
  presetGrid.querySelectorAll('.preset').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const p=arr.find(x=>x.id===btn.dataset.id); if(!p) return;
      items=(p.items||[]).map(x=>({...x})); renderItems(); recalcAll();
      presetModal.classList.add('hidden'); document.body.style.overflow=''; toast('تم إضافة الوجبة الجاهزة ✅','success');
    });
  });
}
async function saveAsPreset(){
  if(!presetsCol){ toast('لم يتم تحميل الطفل','error'); return; }
  const name=prompt('اسم الوجبة الجاهزة؟','وجبتي'); if(!name) return;
  const type=mealTypeEl?.value||'فطار';
  await addDoc(presetsCol,{name,type,items,createdAt:serverTimestamp()});
  toast('تم الحفظ كوجبة جاهزة 💾','success');
}

/* ===== ربط الأحداث ===== */
function wireEvents(){
  // المكتبة
  addItemBtn?.addEventListener('click',async()=>{ await ensureFoodCache(); pickSearchEl&&(pickSearchEl.value=''); pickCategoryEl&&(pickCategoryEl.value='الكل'); openPicker(); });
  closePicker?.addEventListener('click',closePickerModal);
  pickSearchEl?.addEventListener('input',renderPicker);
  pickCategoryEl?.addEventListener('change',renderPicker);

  // AI
  aiBtn?.addEventListener('click',()=>{ aiModal?.classList.remove('hidden'); document.body.style.overflow='hidden'; aiResults.innerHTML=''; aiApply.disabled=true; });
  aiClose?.addEventListener('click',()=>{ aiModal?.classList.add('hidden'); document.body.style.overflow=''; });
  aiAnalyze?.addEventListener('click',()=>{
    const text=(aiText?.value||'').trim(); aiResults.innerHTML='';
    if(!text){ aiApply.disabled=true; return; }
    const parts=text.split('+').map(s=>s.trim()).filter(Boolean);
    aiResults.innerHTML=parts.map(s=>`<div class="chip">${esc(s)}</div>`).join('');
    aiApply.disabled=parts.length===0;
  });
  aiApply?.addEventListener('click',()=>{
    const chips=[...aiResults.querySelectorAll('.chip')].map(c=>c.textContent.trim());
    chips.forEach(name=>items.push({ id:crypto.randomUUID(), itemId:null, name, brand:null, unit:'grams', qty:0, measure:null, grams:0,
      per100:{carbs:0,fiber:0,cal:0,prot:0,fat:0}, gi:null, measures:[], calc:{carbs:0,fiber:0,cal:0,prot:0,fat:0,gl:0} }));
    renderItems(); recalcAll(); aiModal.classList.add('hidden'); document.body.style.overflow='';
  });

  // Presets
  presetBtn?.addEventListener('click',async()=>{ presetModal?.classList.remove('hidden'); document.body.style.overflow='hidden'; await loadPresetsUI(mealTypeEl?.value||'فطار'); });
  presetClose?.addEventListener('click',()=>{ presetModal?.classList.add('hidden'); document.body.style.overflow=''; });
  presetTabs?.forEach(tab=>{
    tab.addEventListener('click',async()=>{ presetTabs.forEach(t=>t.classList.remove('active')); tab.classList.add('active'); await loadPresetsUI(tab.dataset.type); });
  });
  presetSaveBtn?.addEventListener('click',saveAsPreset);

  // أساسية
  repeatLastBtn?.addEventListener('click',repeatLast);
  reachTargetBtn?.addEventListener('click',reachTargetSmart); // ← هنا ربطنا الزر بالدالة الجديدة
  saveMealBtn?.addEventListener('click',saveMeal);
  resetMealBtn?.addEventListener('click',resetMeal);
  printDayBtn?.addEventListener('click',printDay);

  filterTypeEl?.addEventListener('change',loadMealsOfDay);
  mealTypeEl?.addEventListener('change',applyTargets);
  mealDateEl?.addEventListener('change',loadMealsOfDay);
  useNetCarbsEl?.addEventListener('change',recalcAll);

  // إغلاق المودالات بالضغط خارجها
  [pickerModal,aiModal,presetModal].forEach(mod=>{
    if(!mod) return;
    mod.addEventListener('click',(e)=>{ if(e.target===mod){ mod.classList.add('hidden'); document.body.style.overflow=''; } });
  });
}

/* ===== Boot ===== */
async function boot(user){
  currentUser=user;
  await loadChild(user.uid);
  if(mealDateEl && !mealDateEl.value) mealDateEl.value=todayISO();
  await ensureFoodCache();
  await loadMeasurementsOptions();
  await loadMealsOfDay();
  wireEvents();
  renderItems(); recalcAll();
}

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  try{ await boot(user); } catch(e){ console.error(e); toast('حدث خطأ غير متوقع','error'); }
});
