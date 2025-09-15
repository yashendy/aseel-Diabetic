// js/meals.js — نسخة بدمج: إدخال يدوي لقياس قبل الوجبة + فلاتر/شارات الحساسية/الحمية/التفضيل + تجميع جرعات يدوي
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc,
  query, where, orderBy, limit, serverTimestamp
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
const mealDateEl=$('mealDate'); const mealTypeEl=$('mealType');
const preReadingEl=$('preReading'); const postReadingEl=$('postReading');
const preReadingManualEl=$('preReadingManual'); // جديد

const unitChipEl=$('unitChip'); const carbProgress=$('carbProgress'); const carbStateEl=$('carbState');

const addItemBtn=$('addItemBtn'); const repeatLastBtn=$('repeatLastBtn');
const aiBtn=$('aiBtn'); const presetBtn=$('presetBtn'); const presetSaveBtn=null;

const itemsBodyEl=$('itemsBody');
const tGramsEl=$('tGrams'); const tCarbsEl=$('tCarbs'); const tFiberEl=$('tFiber');
const tNetCarbsEl=$('tNetCarbs'); const tCalEl=$('tCal'); const tProtEl=$('tProt'); const tFatEl=$('tFat'); const tGLEl=$('tGL');
const useNetCarbsEl=$('useNetCarbs');

const reachTargetBtn=$('reachTargetBtn'); const suggestedDoseEl=$('suggestedDose');
const doseExplainEl=$('doseExplain'); const doseRangeEl=$('doseRange'); const appliedDoseEl=$('appliedDose');
const carbDoseEl=$('carbDose'); const corrDoseEl=$('corrDose'); const totalDoseEl=$('totalDose'); // جديد
const mealNotesEl=$('mealNotes');

const saveMealBtn=$('saveMealBtn'); const resetMealBtn=$('resetMealBtn'); const printDayBtn=$('printDayBtn');

const tableDateEl=$('tableDate'); const filterTypeEl=$('filterType');
const mealsListEl=$('mealsList'); const noMealsEl=$('noMeals');

const pickerModal=$('pickerModal'); const pickSearchEl=$('pickSearch'); const pickCategoryEl=$('pickCategory');
const hideAllergyEl=$('hideAllergy'); const hideDietEl=$('hideDiet'); // جديد
const pickerGrid=$('pickerGrid'); const pickerEmpty=$('pickerEmpty'); const closePicker=$('closePicker');

const aiModal=$('aiModal'); const aiClose=$('aiClose'); const aiText=$('aiText');
const aiAnalyze=$('aiAnalyze'); const aiApply=$('aiApply'); const aiResults=$('aiResults');

const presetModal=$('presetModal'); const presetClose=$('presetClose');
const presetGrid=$('presetGrid'); const presetTabs=presetModal?.querySelectorAll('.tab');

const toastEl=$('toast');
function toast(msg,type='info'){
  if(!toastEl) return;
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
function mapMealKey(type){ // تبسيط التبديل على اسم الهدف
  const t=type||'فطار';
  return t;
}

function applyUnitChip(){
  const u=(childData?.insulinUnit||'U');
  unitChipEl && (unitChipEl.textContent=`وحدة: ${u}`);
}

function applyTargets(){
  const type=mealTypeEl?.value||'فطار';
  $('goalType').textContent=type;
  $('goalMin').textContent=childData?.targets?.[type]?.min??'—';
  $('goalMax').textContent=childData?.targets?.[type]?.max??'—';
}

/* ===== تحميل الطفل ===== */
async function resolveChildRef(uid,cid){
  const r=doc(db,'users',uid,'children',cid);
  const s=await getDoc(r);
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

  const settingsLink=$('settingsLink');
  settingsLink && (settingsLink.href=`child-edit.html?child=${encodeURIComponent(childId)}`);
  const backBtn=$('backBtn');
  backBtn && backBtn.addEventListener('click',()=>location.href=`child.html?child=${encodeURIComponent(childId)}`);
}

/* ===== كتالوج الطعام ===== */
function normalizeMeasures(d){
  if(Array.isArray(d?.measures)) return d.measures.filter(m=>m&&Number(m.grams)>0).map(m=>({name:m.name,grams:Number(m.grams)}));
  if(d?.measureQty && typeof d.measureQty==='object') return Object.entries(d.measureQty).filter(([n,g])=>n&&Number(g)>0).map(([n,g])=>({name:n,grams:Number(g)}));
  if(Array.isArray(d?.householdUnits)) return d.householdUnits.filter(m=>m&&Number(m.grams)>0).map(m=>({name:m.name,grams:Number(m.grams)}));
  return [];
}
function mapFood(s){
  const d={id:s.id,...s.data()};
  const nutr=d.nutrPer100g||{carbs:0,fiber:0,cal:0,prot:0,fat:0,gi:null};
  return {
    id:d.id, name:d.name, brand:d.brand||null, category:d.category||'أخرى', imageUrl:d.imageUrl||'',
    per100:{carbs:Number(nutr.carbs)||0,fiber:Number(nutr.fiber)||0,cal:Number(nutr.cal)||0,prot:Number(nutr.prot)||0,fat:Number(nutr.fat)||0,gi:nutr.gi??null},
    measures: normalizeMeasures(d),
    allergens: Array.isArray(d.allergens)?d.allergens:[],
    dietTags: Array.isArray(d.dietTags)?d.dietTags:[],
    tags: Array.isArray(d.tags)?d.tags:[]
  };
}
async function ensureFoodCache(){
  if(foodCache.length) return;
  const snap=await getDocs(query(PUBLIC_FOOD(),orderBy('name')));
  const arr=[]; snap.forEach(s=>arr.push(mapFood(s)));
  foodCache=arr;
}

/* ===== اختيار صنف ===== */
function openPicker(){
  if(!pickerModal) return;
  pickerModal.classList.remove('hidden'); document.body.style.overflow='hidden';
  renderPicker();
}
function closePickerModal(){
  pickerModal?.classList.add('hidden'); document.body.style.overflow='';
}

function childHasAllergy(f){
  const ca=Array.isArray(childData?.allergies)?childData.allergies:[];
  return (Array.isArray(f.allergens)?f.allergens:[]).some(a=>ca.includes(a));
}
function violatesDiet(f){
  const rules=Array.isArray(childData?.specialDiet)?childData.specialDiet:[];
  if(!rules.length) return false;
  const tags=Array.isArray(f.dietTags)?f.dietTags:[];
  return rules.some(r=>!tags.includes(r));
}
function getPref(itemId){
  const p=childData?.preferences||{};
  return p[itemId]; // "like" | "dislike" | undefined
}

function renderPicker(){
  if(!pickerGrid) return;
  const q=(pickSearchEl?.value||'').trim();
  const cat=(pickCategoryEl?.value||'الكل').trim();
  const hideAllergy=!!hideAllergyEl?.checked;
  const hideDiet=!!hideDietEl?.checked;

  const list=foodCache.filter(f=>{
    const matchQ=!q || f.name.includes(q) || f.brand?.includes(q) || f.category?.includes(q) ||
                 (q.startsWith('#') && f.tags?.includes(q.slice(1)));
    const matchC=(cat==='الكل')||(f.category===cat);
    const allergy=childHasAllergy(f);
    const diet=violatesDiet(f);
    const passAllergy = hideAllergy ? !allergy : true;
    const passDiet = hideDiet ? !diet : true;
    return matchQ && matchC && passAllergy && passDiet;
  });

  pickerEmpty?.classList.toggle('hidden',list.length>0);
  pickerGrid.innerHTML=list.map(f=>{
    const allergy=childHasAllergy(f);
    const diet=violatesDiet(f);
    const pref=getPref(f.id);
    const badges=[
      allergy?'<span class="badge danger">🚫 حساسية</span>':'',
      (!allergy && diet)?'<span class="badge warn">⚠️ يخالف الحمية</span>':'',
      pref==='like'?'<span class="badge like">❤️ يحب</span>':'',
      pref==='dislike'?'<span class="badge dislike">💔 يكره</span>':''
    ].join(' ');
    return `
    <button class="card pick" data-id="${esc(f.id)}" ${allergy?'data-warn="allergy"':''} ${diet?'data-warn="diet"':''}>
      ${f.imageUrl?`<img src="${esc(f.imageUrl)}" alt="">`:''}
      <div class="t">
        <div class="n">${esc(f.name)}</div>
        ${f.brand?`<div class="b muted">${esc(f.brand)}</div>`:''}
        <div class="m">${(f.measures?.length||0)?f.measures.map(m=>`<span class="chip">${esc(m.name)} (${m.grams}جم)</span>`).join(' '):'<span class="muted">لا تقديرات بيتية</span>'}</div>
        <div class="flags">${badges}</div>
      </div>
    </button>`;
  }).join('');

  pickerGrid.querySelectorAll('.pick').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const it=foodCache.find(x=>x.id===btn.dataset.id);
      if(it){
        // تحذير سريع لو حساسية
        if(btn.dataset.warn==='allergy'){
          const ok=confirm('⚠️ الصنف يحتوي مكوّن حساسية حسب إعدادات الطفل. هل تريد المتابعة؟');
          if(!ok) return;
        }else if(btn.dataset.warn==='diet'){
          const go=confirm('⚠️ الصنف قد يخالف الحمية المحددة. هل تريد المتابعة؟');
          if(!go) return;
        }
        addRowFromFood(it); closePickerModal();
      }
    });
  });
}

/* ===== عناصر الوجبة ===== */
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
    // حساب الجرامات حسب الوحدة
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
      <div class="cell"><button class="danger del">🗑️</button></div>
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
        const opt=measSel.options[measSel.selectedIndex]; const g=toNum(opt?.dataset?.g);
        r.unit='household'; r.measure=measSel.value; r.qty=Math.max(0,toNum(qtyInp.value));
        r.grams=Math.max(0, r.qty * g);
      }
      // الغذائيات:
      const cPer100=r.per100.carbs||0, fPer100=r.per100.fiber||0, calPer100=r.per100.cal||0, pPer100=r.per100.prot||0, fat100=r.per100.fat||0;
      r.calc.carbs = (r.grams * cPer100)/100;
      r.calc.fiber = (r.grams * fPer100)/100;
      r.calc.cal   = (r.grams * calPer100)/100;
      r.calc.prot  = (r.grams * pPer100)/100;
      r.calc.fat   = (r.grams * fat100)/100;
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
    row.querySelector('.del').addEventListener('click',()=>{
      items=items.filter(x=>x!==r); renderItems(); recalcAll();
    });

    recomputeRow();
  });
}

/* ===== مساعد الوصول للهدف (الموجود مسبقًا) + تحديث الجرعات المقترحة ===== */
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

  const min=Number($('goalMin').textContent)||0, max=Number($('goalMax').textContent)||0;
  const used=useNetCarbsEl?.checked?net:totalC;
  let pct=0; if(max>0) pct=Math.min(100,Math.max(0,(used/max)*100));
  carbProgress && (carbProgress.style.width=`${pct}%`);
  carbStateEl && (carbStateEl.textContent=(!min&&!max)?'—':(used<min?'أقل من الهدف':(used>max?'أعلى من الهدف':'داخل النطاق')));

  // الجرعة المقترحة حسب معادل الكارب للطفل
  const ratio=Number(childData?.carbRatio)||0;
  if(ratio>0){
    const dose=used/ratio;
    suggestedDoseEl.textContent=round1(dose);
    doseExplainEl.textContent=`${round1(used)}g ÷ ${ratio}`;
    doseRangeEl.textContent=`${round1(Math.max(0,dose-0.5))}–${round1(dose+0.5)} U`;
  }else{
    suggestedDoseEl.textContent='0'; doseExplainEl.textContent=''; doseRangeEl.textContent='—';
  }
}

/* ===== تكرار آخر وجبة (موجود) ===== */
async function loadMealsOfDay(){ /* … الموجودة عندك … */ }

/* ===== قياسات السكر للقوائم ===== */
async function loadMeasurementsOptions(){
  if(!measurementsCol) return;
  const snap=await getDocs(query(measurementsCol, orderBy('ts','desc'), limit(50)));
  function fill(sel){
    if(!sel) return; sel.innerHTML=`<option value="">—</option>`;
    snap.forEach(d=>{
      const v=d.data(); const val=v?.value??v?.reading??''; const ts=v?.ts?.toDate?.()||null;
      const when=ts?ts.toLocaleString('ar-EG'):'';
      sel.insertAdjacentHTML('beforeend',`<option value="${esc(val)}">${esc(val)} ${when?`(${esc(when)})`:''}</option>`);
    });
  }
  fill(preReadingEl); fill(postReadingEl);
}

/* ===== حفظ الوجبة ===== */
async function saveMeal(){
  if(!mealsCol){ toast('لم يتم تحميل الطفل','error'); return; }
  // أولوية القياس اليدوي إن كان موجودًا
  const preManual=(preReadingManualEl && preReadingManualEl.value!=='') ? Number(preReadingManualEl.value) : null;
  const preVal = preManual!=null ? preManual : (preReadingEl?.value?Number(preReadingEl.value):null);

  const payload={
    date:mealDateEl?.value||todayISO(),
    type:mealTypeEl?.value||'فطار',
    items,
    preReading: preVal,
    postReading: postReadingEl?.value?Number(postReadingEl.value):null,
    netCarbsMode:!!useNetCarbsEl?.checked,
    suggestedDose:Number(suggestedDoseEl?.textContent)||0,
    // الجرعات اليدوية (جديد)
    manualCarbDose: carbDoseEl?.value!=='' ? Number(carbDoseEl.value) : null,
    manualCorrDose: corrDoseEl?.value!=='' ? Number(corrDoseEl.value) : null,
    manualTotalDose: totalDoseEl?.value!=='' ? Number(totalDoseEl.value) : null,
    // نحفظ أيضًا الجرعة المعطاة فعليًا (قد تكون مساوية للمجموع)
    appliedDose: appliedDoseEl?.value!=='' ? Number(appliedDoseEl.value) : null,
    notes:(mealNotesEl?.value||'').trim()||null,
    createdAt:serverTimestamp()
  };
  await addDoc(mealsCol,payload);
  toast('تم حفظ الوجبة ✔️','success');
  loadMealsOfDay();
}

/* ===== مزامنة الجرعات اليدوية ===== */
function recomputeManualTotal(){
  const total = round1(toNum(carbDoseEl?.value) + toNum(corrDoseEl?.value));
  if(totalDoseEl) totalDoseEl.value = (Number.isFinite(total)? total : 0);
  // مزامنة مع "الجرعة المعطاة فعليًا"
  if(appliedDoseEl) appliedDoseEl.value = totalDoseEl.value || '';
}

/* ===== أحداث عامة ===== */
function wireEvents(){
  addItemBtn?.addEventListener('click',async()=>{ await ensureFoodCache(); pickSearchEl&&(pickSearchEl.value=''); pickCategoryEl&&(pickCategoryEl.value='الكل'); openPicker(); });
  closePicker?.addEventListener('click',closePickerModal);
  pickSearchEl?.addEventListener('input',renderPicker);
  pickCategoryEl?.addEventListener('change',renderPicker);
  hideAllergyEl?.addEventListener('change',renderPicker);
  hideDietEl?.addEventListener('change',renderPicker);

  aiBtn?.addEventListener('click',()=>{ aiModal?.classList.remove('hidden'); document.body.style.overflow='hidden'; aiResults.innerHTML=''; aiApply.disabled=true; });
  aiClose?.addEventListener('click',()=>{ aiModal?.classList.add('hidden'); document.body.style.overflow=''; });

  saveMealBtn?.addEventListener('click',saveMeal);
  resetMealBtn?.addEventListener('click',()=>{ items=[]; renderItems(); recalcAll(); appliedDoseEl&&(appliedDoseEl.value=''); mealNotesEl&&(mealNotesEl.value=''); carbDoseEl&&(carbDoseEl.value=''); corrDoseEl&&(corrDoseEl.value=''); totalDoseEl&&(totalDoseEl.value=''); });

  // مزامنة الجرعات اليدوية
  carbDoseEl?.addEventListener('input',recomputeManualTotal);
  corrDoseEl?.addEventListener('input',recomputeManualTotal);

  // تغيّر نوع الوجبة يعيد تطبيق النطاق
  mealTypeEl?.addEventListener('change',applyTargets);
  useNetCarbsEl?.addEventListener('change',recalcAll);

  // طباعة اليوم
  printDayBtn?.addEventListener('click',()=>window.print());
}

/* ===== Boot ===== */
async function boot(user){
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
  try{ await boot(user); } catch(e){ console.error(e); toast('حدث خطأ غير متوقع','error'); }
});
