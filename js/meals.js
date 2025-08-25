// js/meals.js v7 — إضافة مساعد الوجبة (Gemini)
// يعتمد على إصدارك السابق (v6) مع الحفاظ على كل السلوك القديم

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// ========== عناصر عامة ==========
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const toastEl       = document.getElementById('toast');
const toastMsgEl    = toastEl.querySelector('.msg');
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

// إجماليات
const tGramsEl = document.getElementById('tGrams');
const tCarbsEl = document.getElementById('tCarbs');
const tFiberEl = document.getElementById('tFiber');
const tNetEl   = document.getElementById('tNetCarbs');
const tCalEl   = document.getElementById('tCal');
const tProtEl  = document.getElementById('tProt');
const tFatEl   = document.getElementById('tFat');
const tGLEl    = document.getElementById('tGL');
const tGLBadge = document.getElementById('tGLBadge');

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

// مودال الأصناف (موجود سابقًا v6)
const pickerModal     = document.getElementById('pickerModal');
const closePicker     = document.getElementById('closePicker');
const pickSearchEl    = document.getElementById('pickSearch');
const pickCategoryEl  = document.getElementById('pickCategory');
const pickerGrid      = document.getElementById('pickerGrid');
const pickerEmpty     = document.getElementById('pickerEmpty');

// ========== عناصر المساعد (جديدة) ==========
const aiHelperBtn   = document.getElementById('aiHelperBtn');
const aiModal       = document.getElementById('aiModal');
const closeAi       = document.getElementById('closeAi');
const aiKeyEl       = document.getElementById('aiKey');
const aiGoalEl      = document.getElementById('aiGoal');
const aiNoteEl      = document.getElementById('aiNote');
const aiRunBtn      = document.getElementById('aiRun');
const aiClearBtn    = document.getElementById('aiClear');
const aiOutEl       = document.getElementById('aiOut');

// ========== حالة ==========
let currentUser, childData;
let editingMealId = null;
let currentItems = [];
let cachedFood = [];
let cachedMeasurements = [];

// ========== أدوات ==========
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function setMaxToday(inp){ inp && inp.setAttribute('max', todayStr()); }
setMaxToday(mealDateEl);

function esc(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function toNumber(x){ const n = Number(String(x ?? '').replace(',','.')); return isNaN(n)?0:n; }
function round1(x){ return Math.round((x||0)*10)/10; }
function roundHalf(x){ return Math.round((x||0)*2)/2; }
function showToast(msg){ toastMsgEl.textContent = msg; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 2000); }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

const SLOT_MAP = {
  'فطور': { pre:'ق.الفطار', post:'ب.الفطار', window:[{s:'04:30',e:'09:30'}] },
  'غداء': { pre:'ق.الغدا',  post:'ب.الغدا',  window:[{s:'11:00',e:'15:30'}] },
  'عشاء': { pre:'ق.العشا',  post:'ب.العشا',  window:[{s:'17:00',e:'21:30'}] },
  'سناك': { pre:'سناك',     post:'سناك',     window:[{s:'00:00',e:'23:59'}] }
};
const SLOTS_ORDER = ["الاستيقاظ","ق.الفطار","ب.الفطار","ق.الغدا","ب.الغدا","ق.العشا","ب.العشا","سناك","ق.النوم","أثناء النوم","ق.الرياضة","ب.الرياضة"];

function glLevel(gl){
  if (gl < 10) return {cls:'low',    text:'منخفض'};
  if (gl < 20) return {cls:'medium', text:'متوسط'};
  return {cls:'high',  text:'مرتفع'};
}
function updateGLBadge(totalGL){
  const {cls,text} = glLevel(totalGL||0);
  tGLBadge.className = `gl-badge ${cls}`;
  tGLBadge.textContent = text;
}

// ========== تهيئة ==========
(function init(){
  mealDateEl.value = todayStr();
  tableDateEl.textContent = mealDateEl.value;
  backBtn.addEventListener('click', ()=> history.back());
})();

// ========== جلسة + طفل ==========
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  childData = snap.data();

  if (childData.useNetCarbs === undefined) childData.useNetCarbs = true;
  if (!childData.netCarbRule) childData.netCarbRule = 'fullFiber';

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `${childData.gender || '-'} • العمر: ${calcAge(childData.birthDate)} سنة`;

  await loadMeasurements();
  await loadMealsOfDay();
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

// ========== القياسات ==========
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

// ========== وجبات اليوم ==========
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
      <div>كارب: <strong>${round1(r.totals?.carbs_g||0)}</strong> g • صافي: <strong>${round1(r.totals?.netCarbs_g||0)}</strong> g</div>
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

// ========== عناصر الوجبة ==========
addItemBtn.addEventListener('click', openPicker);
repeatLastBtn.addEventListener('click', repeatLastMealTemplate);

// (نفس addItemRow / renderItems / recomputeRow / recalcAll … كما في v6)
// ———— كبُرت الشيفرة؛ حفاظًا على التركيز، أُبقي نفس الشيفرات من إصدارك v6 التي أرسلتها لك سابقًا دون تغيير ————
// (… ضعي هنا نفس دوال v6 من addItemRow, renderItems, recomputeRow, recalcAll, saveMeal, editMeal, deleteMeal, إلخ …)
//  ✅ ملاحظة: لا يوجد أي تعديل على منطق الحسابات. كل الإضافة خاصة بالمساعد فقط.

// ------------- اختصار: سنعيد استخدام الدوال نفسها من إصدار v6 -------------
/*  ضعي هنا نسخة دوال v6 كما أرسلتها لك سابقًا (لم أحذف شيئًا).  */

// ========== مودال الأصناف ==========
closePicker.addEventListener('click', ()=> pickerModal.classList.add('hidden'));
pickSearchEl.addEventListener('input', debounce(applyPickerFilters, 250));
pickCategoryEl.addEventListener('change', applyPickerFilters);

// (نفس loadFoodItems/applyPickerFilters/renderPickerGrid/catIcon/saveLastMealTemplate/repeatLastMealTemplate … من v6)

// ===================== مساعد الوجبة (Gemini) =====================
aiHelperBtn?.addEventListener('click', ()=>{
  aiModal.classList.remove('hidden');
  // تحميل المفتاح من localStorage
  const k = localStorage.getItem('gemini_api_key') || '';
  aiKeyEl.value = k;
});
closeAi?.addEventListener('click', ()=> aiModal.classList.add('hidden'));
aiClearBtn?.addEventListener('click', ()=> { aiOutEl.innerHTML = '— تم المسح —'; });

aiRunBtn?.addEventListener('click', runAiHelper);

async function runAiHelper(){
  try{
    const key = (aiKeyEl.value||'').trim();
    if (!key){ alert('ضعي مفتاح Gemini أولًا.'); return; }
    localStorage.setItem('gemini_api_key', key);

    const payload = buildMealSummary();
    const goal = aiGoalEl.value || '';
    const note = (aiNoteEl.value||'').trim();

    aiOutEl.innerHTML = '⏳ جارٍ توليد الاقتراحات…';

    // استدعاء Gemini (SDK تم تحميله في الصفحة كـ ES Module)
    // @ts-ignore
    const { GoogleGenerativeAI } = await import('https://cdn.jsdelivr.net/npm/@google/generative-ai/dist/index.min.mjs');
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const sys = `
أنت مساعد تغذية للسكري من النوع الأول للأطفال. لديك وجبة بقيم تفصيلية (لكل صنف: الجرامات، الكارب، الألياف، الصافي، GI/GL). 
ارجع اقتراحات مختصرة قابلة للتنفيذ لتحسين الوجبة وفق الهدف.
القواعد: 
- إذا كان GL الإجمالي مرتفعًا → اقترح تقليل كمية أعلى صنف GL أو استبداله ببديل منخفض.
- إذا كانت الألياف منخفضة (<4g) → اقترح إضافة صنف غني بالألياف (خضار، شوفان…).
- إذا كانت نسبة البروتين إلى الكارب الصافي منخفضة (<0.25) → اقترح مصدر بروتين بسيط.
- شكل الإخراج JSON فقط بدون أي نص زائد، بالشكل التالي:
{
 "explain": "جملة قصيرة تشرح المنطق العام",
 "suggestions": [
   { "type":"adjustQuantity", "itemName":"اسم صنف موجود", "newGrams": رقم, "reason":"..." },
   { "type":"replace", "itemName":"اسم صنف موجود", "withTags":["حبوب_كاملة" أو "خضار" ...], "reason":"..." },
   { "type":"addItem", "name":"اسم صنف مقترح", "tags":["خضار","ألياف"], "grams": رقم, "reason":"..." }
 ]
}
التزم بـ JSON صالح.
    `.trim();

    const prompt = `
الهدف: ${goal || 'عام'}
تعليمات إضافية: ${note || 'لا'}
بيانات الوجبة (JSON):
${JSON.stringify(payload, null, 2)}
    `.trim();

    const res = await model.generateContent([{role:"user", parts:[{text: sys + "\n\n" + prompt}]}]);
    const text = res?.response?.text() || '';

    let data;
    try{
      // استخراج JSON من أي نص
      const m = text.match(/\{[\s\S]*\}$/);
      data = JSON.parse(m ? m[0] : text);
    }catch(e){
      aiOutEl.innerHTML = 'لم أستطع فهم استجابة الذكاء الاصطناعي. جرّبي مرة أخرى.';
      console.error('AI parse error:', text);
      return;
    }

    renderAiSuggestions(data);

  }catch(err){
    console.error(err);
    aiOutEl.innerHTML = 'حدث خطأ أثناء طلب الذكاء الاصطناعي.';
  }
}

function buildMealSummary(){
  // نبني ملخصًا بسيطًا للوجبة الحالية
  const items = currentItems.map(r=>({
    name: r.name,
    grams: r.grams,
    carbs: round1(r.calc?.carbs || 0),
    fiber: round1(r.calc?.fiber || 0),
    netCarbs: round1(r.calc?.netCarbs || 0),
    gi: r.gi ?? null,
    gl: round1(r.calc?.gl || 0)
  }));

  const totals = {
    grams: Number(tGramsEl.textContent)||0,
    carbs: Number(tCarbsEl.textContent)||0,
    fiber: Number(tFiberEl.textContent)||0,
    netCarbs: Number(tNetEl.textContent)||0,
    cal: Number(tCalEl.textContent)||0,
    prot: Number(tProtEl.textContent)||0,
    fat: Number(tFatEl.textContent)||0,
    gl: Number(tGLEl.textContent)||0
  };

  // نسبة بروتين/صافي كارب (توعوي)
  const protToNet = totals.netCarbs>0 ? round1(totals.prot / totals.netCarbs) : 0;

  return {
    type: mealTypeEl.value,
    totals, items,
    ratios: { proteinToNetCarb: protToNet }
  };
}

function renderAiSuggestions(data){
  const explain = data?.explain || '';
  const suggs = Array.isArray(data?.suggestions) ? data.suggestions : [];

  const wrap = document.createElement('div');
  wrap.innerHTML = '';
  if (explain){
    const p = document.createElement('div');
    p.className = 'badge-soft';
    p.textContent = explain;
    wrap.appendChild(p);
  }

  if (!suggs.length){
    const d = document.createElement('div');
    d.className = 'ai-card';
    d.textContent = 'لا توجد اقتراحات حالياً.';
    wrap.appendChild(d);
  } else {
    suggs.forEach((s, idx)=>{
      const card = document.createElement('div');
      card.className = 'ai-card';
      const title = document.createElement('h4');

      if (s.type==='adjustQuantity'){
        title.textContent = `تعديل كمية: ${s.itemName} → ${s.newGrams} جم`;
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'تطبيق الكمية';
        btn.onclick = ()=> applyAdjustQuantity(s.itemName, Number(s.newGrams)||0);
        card.appendChild(title);
        if (s.reason){ const r = document.createElement('div'); r.className='tiny muted'; r.textContent=s.reason; card.appendChild(r); }
        const act = document.createElement('div'); act.className='ai-actions'; act.appendChild(btn); card.appendChild(act);
      }
      else if (s.type==='replace'){
        title.textContent = `استبدال: ${s.itemName}`;
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'فتح بدائل مناسبة';
        btn.onclick = ()=> openPickerWithTags(s.withTags||[]);
        card.appendChild(title);
        if (s.reason){ const r = document.createElement('div'); r.className='tiny muted'; r.textContent=s.reason; card.appendChild(r); }
        const chips = document.createElement('div'); (s.withTags||[]).forEach(t=>{ const c=document.createElement('span'); c.className='badge-soft'; c.textContent='#'+t; chips.appendChild(c); }); card.appendChild(chips);
        const act = document.createElement('div'); act.className='ai-actions'; act.appendChild(btn); card.appendChild(act);
      }
      else if (s.type==='addItem'){
        title.textContent = `إضافة صنف: ${s.name} (${s.grams} جم)`;
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'ابحث في المكتبة';
        btn.onclick = ()=> openPickerWithSearch(s.name);
        card.appendChild(title);
        if (s.reason){ const r = document.createElement('div'); r.className='tiny muted'; r.textContent=s.reason; card.appendChild(r); }
        const chips = document.createElement('div'); (s.tags||[]).forEach(t=>{ const c=document.createElement('span'); c.className='badge-soft'; c.textContent='#'+t; chips.appendChild(c); }); card.appendChild(chips);
        const act = document.createElement('div'); act.className='ai-actions'; act.appendChild(btn); card.appendChild(act);
      }
      else{
        title.textContent = 'معلومة';
        const r = document.createElement('div'); r.className='tiny muted'; r.textContent= JSON.stringify(s);
        card.appendChild(title); card.appendChild(r);
      }

      wrap.appendChild(card);
    });
  }

  aiOutEl.innerHTML = '';
  aiOutEl.appendChild(wrap);
}

function applyAdjustQuantity(itemName, newGrams){
  if (!(newGrams>0)) return;
  // نبحث عن صف بالاسم، ثم نعدّل الكمية بالجرامات مباشرة
  const row = currentItems.find(r=> (r.name||'').trim() === (itemName||'').trim());
  if (!row){ showToast('لم يتم العثور على الصنف المقترح'); return; }

  // لو الوحدة household نحسب الكمية الأقرب لتحقيق الجرامات المطلوبة
  if (row.unit==='household' && row.measures?.length){
    const m = row.measures.find(mm=> mm.name===row.measure) || row.measures[0];
    row.qty = m ? round1(newGrams / m.grams) : row.qty;
  }else{
    row.unit = 'grams';
    row.qty  = newGrams; // الكمية = جرامات
  }
  renderItems(); recalcAll();
  showToast('تم تطبيق الكمية المقترحة');
}

function openPickerWithTags(tags){
  pickerModal.classList.remove('hidden');
  pickCategoryEl.value='الكل';
  pickSearchEl.value = tags && tags.length ? '#'+tags[0] : '';
  applyPickerFilters();
}
function openPickerWithSearch(q){
  pickerModal.classList.remove('hidden');
  pickCategoryEl.value='الكل';
  pickSearchEl.value = q || '';
  applyPickerFilters();
}

// ====== ربط الأحداث الباقية كما في v6 ======
saveMealBtn.addEventListener('click', saveMeal);
resetMealBtn.addEventListener('click', ()=> resetForm(false));
printDayBtn.addEventListener('click', ()=> window.print());
filterTypeEl.addEventListener('change', async ()=>{ await loadMealsOfDay(); });
mealTypeEl.addEventListener('change', ()=>{ populateReadingSelects(); recalcAll(); });
mealDateEl.addEventListener('change', async ()=>{
  if (mealDateEl.value > todayStr()){ mealDateEl.value = todayStr(); }
  tableDateEl.textContent = mealDateEl.value;
  await loadMeasurements();
  await loadMealsOfDay();
  recalcAll();
});
preReadingEl.addEventListener('change', ()=>{ recalcAll(); });
postReadingEl.addEventListener('change', ()=>{ /* للحفظ فقط */ });

// --------- ملاحظة مهمة ---------
// حافظي على بقية دوال v6 كما هي (addItemRow, renderItems, recomputeRow, recalcAll, saveMeal, editMeal,
// deleteMeal, openPicker, loadFoodItems, applyPickerFilters, renderPickerGrid, catIcon,
// saveLastMealTemplate, repeatLastMealTemplate). لم تتغير.
