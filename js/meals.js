/* ============================= js/meals.js (FULL, v12) =============================
   - Uses firebase-config.js (v12) for initialized db
   - Net-carb toggle affects rows + totals + top progress bar
   - Smart sorting: diet compliance first, then preferred/disliked score
   - Badges: ⭐, 👎, ⚠️
=================================================================================== */
import { db } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Safe helpers ---------- */
const $ = (id)=>document.getElementById(id);
const safeArr = (a)=>Array.isArray(a)?a:[];
const num = (x)=>{const n=Number(x);return Number.isFinite(n)?n:0;};

/* ---------- State ---------- */
let USE_NET_DOSE = !!($('useNetCarbDose')?.checked || $('useNetCarb')?.checked);
let currentMealItems = Array.isArray(window.currentMealItems)?window.currentMealItems:[];

const renderFooterTotals = window.renderFooterTotals || function(t){
  const el = $('totalsArea');
  if (!el) return;
  el.innerHTML = `
    <div>الكارب (جرعة): ${t.totalCarbDose.toFixed(1)} g</div>
    <div>البروتين: ${t.totalProtein.toFixed(1)} g</div>
    <div>الدهون: ${t.totalFat.toFixed(1)} g</div>
    <div>الألياف: ${t.totalFiber.toFixed(1)} g</div>
    <div>السعرات: ${t.totalKcal.toFixed(0)} kcal</div>
    <div>GL (توعوي): ${t.totalGL.toFixed(1)}</div>
  `;
};
const updateHeaderProgress = window.updateHeaderProgress || function(totalCarbDose){
  const el = $('headerProgressValue');
  if (el) el.textContent = `${totalCarbDose.toFixed(1)} g`;
};

/* ---------- Diet flags & preferences ---------- */
function getChildDietFlagsSafe(){
  const c = window.childData || {};
  if (Array.isArray(c.dietaryFlags)) return c.dietaryFlags;
  if (Array.isArray(c.specialDiet))  return c.specialDiet;
  return [];
}
function getChildFavoritesSafe(){
  const c = window.childData || {};
  return {
    preferred: safeArr(c.preferred),
    disliked:  safeArr(c.disliked)
  };
}

/* ---------- Compliance ---------- */
function isCompliantDiet(itemTags, flags){
  if(!flags.length) return true;
  const set = new Set(Array.isArray(itemTags)?itemTags:[]);
  return flags.every(f => set.has(f));
}

/* ---------- Per-row calculations ---------- */
function gramsForRow(row){ return num(row.servingGrams) * num(row.qty || 1); }
function carbPer100ForDose(row){
  const p = row.per100 || {};
  const c = num(p.carbs_g);
  const f = num(p.fiber_g);
  return USE_NET_DOSE ? Math.max(0, c - f) : c;
}
function carbsGramsForRow(row){ return carbPer100ForDose(row) * gramsForRow(row) / 100; }

/* ---------- Sorting ---------- */
function scoreItem(item){
  const flags = getChildDietFlagsSafe();
  const favs  = getChildFavoritesSafe();
  const key   = item?.id || item?.name || item?.["الاسم (AR)"] || "";
  let s = 0;
  if (isCompliantDiet(item?.dietTags, flags)) s += 2;
  if (favs.preferred.includes(key)) s += 1;
  if (favs.disliked.includes(key))  s -= 1;
  return s;
}
function sortItemsByDietAndPrefs(items){
  items.sort((a,b)=>{
    const sb = scoreItem(b), sa = scoreItem(a);
    if (sb !== sa) return sb - sa;
    const an = (a.name || a["الاسم (AR)"] || "").toString();
    const bn = (b.name || b["الاسم (AR)"] || "").toString();
    return an.localeCompare(bn, 'ar');
  });
}

/* ---------- Badges (optional, call in your card builder) ---------- */
function annotateBadges(cardEl, item){
  try{
    const flags = getChildDietFlagsSafe();
    const favs  = getChildFavoritesSafe();
    const key   = item?.id || item?.name || item?.["الاسم (AR)"] || "";

    const compliant = isCompliantDiet(item?.dietTags, flags);
    const isFav = favs.preferred.includes(key);
    const isDis = favs.disliked.includes(key);

    if (!cardEl) return;
    if (!compliant && flags.length){
      const w = document.createElement('div');
      w.className = 'diet-warning';
      w.textContent = '⚠️ مخالف للنظام المختار';
      cardEl.appendChild(w);
    }
    if (isFav){
      const b = document.createElement('div');
      b.className = 'badge-fav';
      b.textContent = '⭐ مفضل';
      cardEl.appendChild(b);
    }
    if (isDis){
      const b = document.createElement('div');
      b.className = 'badge-disliked';
      b.textContent = '👎 غير مفضل';
      cardEl.appendChild(b);
    }
  }catch(e){ console.warn('annotateBadges warn', e); }
}

/* ---------- Totals + header ---------- */
function recalcTotalsAndHeader(items){
  let totalCarbDose=0,totalProtein=0,totalFat=0,totalFiber=0,totalKcal=0,totalGL=0;
  for (const row of items){
    const g = gramsForRow(row);
    const per = row.per100 || {};
    const gi = num(row.gi || per.gi);

    totalCarbDose += carbsGramsForRow(row);
    totalProtein  += num(per.protein_g) * g / 100;
    totalFat      += num(per.fat_g)     * g / 100;
    totalFiber    += num(per.fiber_g)   * g / 100;
    totalKcal     += num(per.cal_kcal)  * g / 100;

    const cDosePer100 = carbPer100ForDose(row);
    totalGL += gi * (cDosePer100 * g / 100) / 100;
  }
  renderFooterTotals({ totalCarbDose, totalProtein, totalFat, totalFiber, totalKcal, totalGL });
  updateHeaderProgress(totalCarbDose);
}

/* ---------- Recompute pipeline ---------- */
function recalcPerRowDose(){
  // لو عندك دالة أصلية لحساب أعمدة الجرعة، سيبيها تشتغل:
  if (typeof window.recalcRowDoseOriginal === 'function'){
    window.recalcRowDoseOriginal(); return;
  }
  // وإلا اكتفي بإعادة حساب الإجماليات فقط
}
function recomputeAllDoseViews(){
  try {
    recalcPerRowDose();
    recalcTotalsAndHeader(currentMealItems);
  } catch (e) { console.error('recomputeAllDoseViews error', e); }
}

/* ---------- Wrap renderPicker to enforce sorting ---------- */
if (typeof window.renderPicker === 'function' && !window.__wrappedRenderPicker){
  const original = window.renderPicker;
  window.renderPicker = function(items){
    currentMealItems = Array.isArray(items)?items.slice():[];
    sortItemsByDietAndPrefs(currentMealItems);
    return original(currentMealItems);
  };
  window.__wrappedRenderPicker = true;
}

/* ---------- Toggle (Net Carbs) ---------- */
(function initNetToggle(){
  const el = $('useNetCarbDose') || $('useNetCarb');
  if (!el) return;
  USE_NET_DOSE = !!el.checked;
  el.addEventListener('change', ()=>{
    USE_NET_DOSE = !!el.checked;
    recomputeAllDoseViews();
  });
})();

/* ---------- Recalc on quantity/unit changes ---------- */
document.addEventListener('change', (ev)=>{
  const t = ev.target;
  if (!t) return;
  if (t.matches('.qty, .serving-grams, .unit-select')) {
    recomputeAllDoseViews();
  }
});

/* ---------- Public API ---------- */
window.mealsApi = Object.assign({}, window.mealsApi || {}, {
  recomputeAllDoseViews,
  isCompliantDiet,
  getChildDietFlagsSafe
});
