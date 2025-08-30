// js/meals.js — وجبات ذكية + مكتبة الأدمن + حساب الجرعات
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, orderBy, doc, getDoc, addDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- DOM ---------- */
const $ = (id)=>document.getElementById(id);
const loaderEl = $('loader');

const chipChild = $('chipChild'), chipRange = $('chipRange'), chipCR = $('chipCR'), chipCF = $('chipCF');
const aiHints   = $('aiHints');

const dayEl   = $('day');
const slotEl  = $('slot');
const preEl   = $('preMeal');
const useNet  = $('useNet');
const roundingEl = $('rounding');

const qEl = $('q');
const fCat = $('fCat');
const grid = $('grid');

const tbody = $('tbody');
const sumNet = $('sumNet');
const sumBolus = $('sumBolus');

/* ---------- Helpers ---------- */
function pad(n){return String(n).padStart(2,'0')}
function todayStr(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function loader(show){ loaderEl?.classList.toggle('hidden', !show); }
const esc = s => (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt = n => (n==null||isNaN(+n)?'—':(+n).toFixed(1));
const calcCalories = (c,p,f)=> Math.round(4*(+c||0)+4*(+p||0)+9*(+f||0));

/* ---------- Slots ---------- */
const SLOT_OPTIONS = [
  ['wake',        'الاستيقاظ'],
  ['preBreakfast','ق.الفطار'],
  ['postBreakfast','ب.الفطار'],
  ['preLunch',    'ق.الغدا'],
  ['postLunch',   'ب.الغدا'],
  ['preDinner',   'ق.العشا'],
  ['postDinner',  'ب.العشا'],
  ['snack',       'سناك'],
  ['preSleep',    'ق.النوم'],
  ['duringSleep', 'أثناء النوم'],
  ['preExercise', 'ق.الرياضة'],
  ['postExercise','ب.الرياضة'],
];
function slotLabel(key){ const f=SLOT_OPTIONS.find(x=>x[0]===key); return f?f[1]:key; }

/* ---------- State ---------- */
const params = new URLSearchParams(location.search);
const childId = params.get('child');
let USER=null, CHILD=null, CR=null, CF=null, NORMAL_MIN=null, NORMAL_MAX=null;
let MEAL_TARGETS=null;    // { wake: 20, preBreakfast:30, ... } (اختياري)
let ROUNDING_STEP=0.5;

/* ---------- Calc ---------- */
function netCarbOf(item, grams, useNetMode){
  const c=item.carbs_100g||0, f=item.fiber_100g||0;
  const base = useNetMode ? (c - f) : c;
  const n = grams/100 * (base>0?base:0);
  return Math.max(0, n);
}
function mealBolus(netG, cr){ if(!cr || cr<=0) return 0; return netG / cr; }
function correctionDose(pre, max, cf){ if(pre==null||isNaN(pre)||!cf||cf<=0||max==null) return 0; const delta=pre - max; return delta>0 ? (delta/cf) : 0; }
function roundDose(v, step){ if(!step) return v; return Math.round(v/step)*step; }

/* ---------- UI: AI hints ---------- */
function renderAIHints(){
  const pre = Number(preEl.value);
  aiHints.innerHTML = '';
  if(isNaN(pre)) return;

  if(NORMAL_MIN!=null && pre < NORMAL_MIN){
    aiHints.innerHTML = `
      <span class="chip bad">هبوط: ${pre.toFixed(1)} mmol/L — عالجي الهبوط أولًا (15g سريع) ثم أعيدي القياس</span>
    `;
  }else if(NORMAL_MAX!=null && pre > NORMAL_MAX){
    const corr = correctionDose(pre, NORMAL_MAX, CF);
    const corrR = roundDose(corr, ROUNDING_STEP||0.5);
    aiHints.innerHTML = `
      <span class="chip warn">قراءة مرتفعة: ${pre.toFixed(1)} — جرعة تصحيح مُقترَحة ≈ <strong>${fmt(corrR)}</strong> U</span>
    `;
  }else{
    aiHints.innerHTML = `<span class="chip ok">ضمن النطاق ✅</span>`;
  }
}

/* ---------- Load child & catalog ---------- */
async function loadChild(user){
  const ref = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if(!snap.exists()) throw new Error('الطفل غير موجود');
  CHILD = snap.data();

  chipChild.textContent = CHILD.name || 'طفل';
  CR  = Number(CHILD.carbRatio ?? CHILD.cr ?? 12);
  CF  = CHILD.correctionFactor!=null? Number(CHILD.correctionFactor): null;
  const min = Number(CHILD.normalRange?.min ?? 4.4);
  const max = Number(CHILD.normalRange?.max ?? 7.8);
  NORMAL_MIN=min; NORMAL_MAX=max;

  chipRange.textContent = `النطاق: ${min}–${max} mmol/L`;
  chipCR.textContent    = `CR: ${CR} g/U`;
  chipCF.textContent    = `CF: ${CF ?? '—'} mmol/L/U`;

  ROUNDING_STEP = Number(CHILD.bolusRounding ?? 0.5);
  roundingEl.value = String(ROUNDING_STEP);
  useNet.checked = (CHILD.useNetCarbs ?? true) ? true : false;

  MEAL_TARGETS = CHILD.mealTargets || null;
}
async function loadCatalog(){
  grid.textContent='جارِ التحميل…';
  const ref = collection(db, 'admin','global','foodItems');
  const snap = await getDocs(query(ref, orderBy('name')));
  ITEMS = snap.docs.map(d=>({id:d.id, ...d.data()}));
  renderGrid();
}
async function loadDayMeals(dateStr){
  tbody.innerHTML = '<tr><td colspan="8">جارِ التحميل…</td></tr>';
  const ref = collection(db, `parents/${USER.uid}/children/${childId}/meals`);
  // هنجيب كل اليوم، ولو حبيت نفلتر بـ slot فيما بعد
  const qSnap = await getDocs(query(ref, orderBy('createdAt')));
  const rows = [];
  let totalNet = 0, totalBolus = 0;

  qSnap.forEach(d=>{
    const x = d.data();
    if(x.date !== dateStr) return; // نعرض اليوم المختار فقط
    x.__id = d.id;
    rows.push(x);
  });

  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="8">لا توجد وجبات اليوم.</td></tr>'; sumNet.textContent='صافي الكارب: — g'; sumBolus.textContent='مجموع الجرعات المقترَحة: — U'; return; }

  tbody.innerHTML = '';
  rows.forEach(r=>{
    totalNet += Number(r.netCarb||0);
    totalBolus += Number(r.bolusFinal ?? r.bolusSuggested ?? 0);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(slotLabel(r.mealSlot||'-'))}</td>
      <td>${esc(r.itemName||'—')}</td>
      <td><input class="row-grams input" type="number" step="1" min="0" value="${r.grams||0}" data-id="${r.__id}"></td>
      <td>${fmt(r.netCarb)} g</td>
      <td>${fmt(r.mealBolusSuggested)} U</td>
      <td>${fmt(r.correctionSuggested)} U</td>
      <td><input class="row-bolus input" type="number" step="${roundingEl.value}" min="0" value="${r.bolusFinal ?? r.bolusSuggested ?? 0}" data-id="${r.__id}"></td>
      <td><button class="btn ghost btn-save-row" data-id="${r.__id}">حفظ</button></td>
    `;
    tbody.appendChild(tr);
  });

  sumNet.textContent = `صافي الكارب: ${fmt(totalNet)} g`;
  sumBolus.textContent = `مجموع الجرعات المقترَحة: ${fmt(totalBolus)} U`;

  // حفظ تعديلات سريعة
  tbody.querySelectorAll('.btn-save-row').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.id;
      const grams = Number(tbody.querySelector(`.row-grams[data-id="${id}"]`)?.value || 0);
      const bolusFinal = Number(tbody.querySelector(`.row-bolus[data-id="${id}"]`)?.value || 0);
      try{
        loader(true);
        const ref = doc(db, `parents/${USER.uid}/children/${childId}/meals/${id}`);
        await updateDoc(ref, { grams, bolusFinal });
        await loadDayMeals(dayEl.value);
      }catch(e){
        console.error(e); alert('تعذر الحفظ');
      }finally{ loader(false); }
    });
  });
}

/* ---------- Render grid ---------- */
let ITEMS=[];
[qEl, fCat].forEach(el=> el?.addEventListener('input', renderGrid));

function renderGrid(){
  if(!ITEMS.length){ grid.innerHTML='<div class="meta">لا توجد أصناف.</div>'; return; }

  const q = (qEl?.value||'').trim().toLowerCase();
  const cat = fCat?.value||'';

  let arr = ITEMS.slice();
  if(q){
    arr = arr.filter(it=>{
      const inName = (it.name||'').toLowerCase().includes(q);
      const inTags = (it.tags||[]).some(t=> (t||'').toLowerCase().includes(q));
      return inName || inTags || (q.startsWith('#') && (it.tags||[]).includes(q));
    });
  }
  if(cat) arr = arr.filter(it=> it.category===cat);

  if(!arr.length){ grid.innerHTML='<div class="meta">لا نتائج مطابقة.</div>'; return; }

  grid.innerHTML='';
  arr.forEach(it=>{
    const img = it.imageUrl || autoImg(it.name||'صنف');
    const kcal = it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g);
    const card = document.createElement('div');
    card.className='item-card';
    card.innerHTML = `
      <div class="head">
        <img class="thumb" src="${esc(img)}" alt="">
        <div>
          <div class="title">${esc(it.name||'—')}</div>
          <div class="meta">${esc(it.brand||'—')} • ${esc(it.category||'—')}</div>
        </div>
      </div>
      <div class="chips" style="margin-top:6px">
        <span class="chip">كارب/100g: <strong>${fmt(it.carbs_100g)}</strong></span>
        <span class="chip">ألياف/100g: ${fmt(it.fiber_100g)}</span>
        <span class="chip">سعرات/100g: ${isNaN(kcal)?'—':kcal}</span>
      </div>
      <div class="row two" style="margin-top:8px">
        <input class="input grams" type="number" step="1" min="0" placeholder="جرامات">
        <select class="input unitSel">
          <option value="">أو مقدار منزلي</option>
          ${(it.householdUnits||[]).map(u=>`<option value="${u.grams}">${esc(u.name)} (${u.grams}g)</option>`).join('')}
        </select>
      </div>
      <div class="row two">
        <button class="btn ghost qSuggest">اقتراح كمية</button>
        <button class="btn primary qAdd">إضافة للوجبة</button>
      </div>
      <div class="meta qOut">—</div>
    `;

    const gramsEl = card.querySelector('.grams');
    const unitSel = card.querySelector('.unitSel');
    const outEl   = card.querySelector('.qOut');

    // اقتراح كمية للوصول لهدف الوجبة (لو موجود)
    card.querySelector('.qSuggest').addEventListener('click', ()=>{
      const slotKey = slotEl.value;
      const target = MEAL_TARGETS?.[slotKey] ?? null; // بالجرام كارب
      if(!target){ outEl.textContent='لا يوجد هدف كارب محدد لهذا الوقت (يمكن ضبطه من بيانات الطفل)'; return; }
      const basePer100 = (useNet.checked ? (it.carbs_100g||0)-(it.fiber_100g||0) : (it.carbs_100g||0));
      if(!basePer100 || basePer100<=0){ outEl.textContent='الصنف لا يحتوي كارب كافٍ للاقتراح.'; return; }
      const grams = target / basePer100 * 100;
      gramsEl.value = Math.max(0, Math.round(grams));
      outEl.textContent = `اقتراح: ${Math.round(grams)} g للوصول إلى ${target}g كارب`;
    });

    // إضافة للوجبة (يحسب Net + جرعات)
    card.querySelector('.qAdd').addEventListener('click', async ()=>{
      const slotKey = slotEl.value;
      if(!slotKey){ alert('اختاري وقت الوجبة'); return; }

      const grams = Number(unitSel.value || gramsEl.value);
      if(!grams){ alert('أدخلي وزنًا أو اختاري مقدار منزلي'); return; }

      const netG = netCarbOf(it, grams, useNet.checked);
      const bolusMeal = mealBolus(netG, CR);
      const corr = correctionDose(Number(preEl.value), NORMAL_MAX, CF);
      const corrR = roundDose(corr, Number(roundingEl.value)||ROUNDING_STEP||0.5);
      const total = roundDose(bolusMeal + corrR, Number(roundingEl.value)||ROUNDING_STEP||0.5);

      outEl.textContent = `صافي كارب: ${netG.toFixed(1)}g • جرعة الوجبة: ${bolusMeal.toFixed(2)}U • التصحيح: ${corrR.toFixed(2)}U • النهائية: ${total.toFixed(2)}U`;

      try{
        loader(true);
        const ref = collection(db, `parents/${USER.uid}/children/${childId}/meals`);
        await addDoc(ref, {
          date: dayEl.value,
          createdAt: serverTimestamp(),
          mealSlot: slotKey,
          preMeal: preEl.value===''? null : Number(preEl.value),

          itemId: it.id,
          itemName: it.name||null,
          grams,

          carbs_100g:  it.carbs_100g ?? null,
          fiber_100g:  it.fiber_100g ?? 0,
          calories_100g: it.calories_100g ?? null,

          useNetCarbs: !!useNet.checked,
          netCarb: Number(netG.toFixed(2)),

          crUsed: CR, cfUsed: CF,
          rangeMin: NORMAL_MIN, rangeMax: NORMAL_MAX,
          mealBolusSuggested: Number(bolusMeal.toFixed(2)),
          correctionSuggested: Number(corrR.toFixed(2)),
          bolusFinal: Number(total.toFixed(2)),
          roundingStep: Number(roundingEl.value)||ROUNDING_STEP||0.5,
          source: 'admin-catalog'
        });
        // بعد الحفظ نفضّي المدخلات ونحدّث الجدول
        gramsEl.value=''; unitSel.value=''; outEl.textContent='—';
        await loadDayMeals(dayEl.value);
      }catch(e){
        console.error(e);
        alert('تعذر الإضافة للوجبة');
      }finally{ loader(false); }
    });

    grid.appendChild(card);
  });
}

/* ---------- Small utils ---------- */
function autoImg(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
      <rect width="100%" height="100%" fill="hsl(${hue} 80% 90%)"/>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
        font-family="Segoe UI" font-size="64" fill="hsl(${hue} 60% 35%)">${esc((name||'ص')[0])}</text>
    </svg>`
  );
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  // اليوم الافتراضي: اليوم
  dayEl.value = todayStr();
  // خيارات الوقت
  slotEl.innerHTML = SLOT_OPTIONS.map(([k,txt])=>`<option value="${k}">${txt}</option>`).join('');
  // أحداث
  [preEl, roundingEl, useNet].forEach(el=> el.addEventListener('input', renderAIHints));
  dayEl.addEventListener('change', ()=> loadDayMeals(dayEl.value));
});

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد طفل محدد'); history.back(); return; }
  USER=user;
  try{
    loader(true);
    await loadChild(user);
    renderAIHints();
    await loadCatalog();
    await loadDayMeals(dayEl.value);
  }catch(e){
    console.error(e);
    alert('تعذر تحميل بيانات الوجبات/الطفل');
  }finally{
    loader(false);
  }
});
