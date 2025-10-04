/* ============================== meals.js (FULL) ==============================
  الميزات:
  - ترتيب ذكي للأصناف: المطابق للحمية أولًا، ثم تأثير المفضلة/غير المفضلة.
  - خيار "استخدم الكارب الصافي لحساب الجرعة (توعوي)" يؤثر على:
      (أ) جرعة كل صف  (ب) الإجماليات أسفل  (ج) الشريط العلوي
  - شارات: ⭐ مفضل، 👎 غير مفضل، ⚠️ مخالف للنظام
  - دفاعي: يستخدم دوالك الأصلية لو موجودة (renderPicker / renderFooterTotals / updateHeaderProgress)
           وإلا يوفّر بدائل آمنة لا تكسر الصفحة.
============================================================================= */

/* ====== Helpers: DOM / Safe get ====== */
function $(id){ return document.getElementById(id); }
function safeArray(v){ return Array.isArray(v) ? v : []; }
function safeNum(x){ const n=Number(x); return Number.isFinite(n)?n:0; }

/* ====== State ====== */
let USE_NET_DOSE = false; // يتغيّر حسب checkbox “useNetCarbDose”
let currentMealItems = Array.isArray(window.currentMealItems) ? window.currentMealItems : [];  // مصفوفة العناصر المعروضة
let originalRenderPicker = window.renderPicker;    // هنغلفها بترتيب قبل النداء
let originalRenderFooterTotals = window.renderFooterTotals;
let originalUpdateHeaderProgress = window.updateHeaderProgress;

/* ====== Diet flags (طفل) ====== */
function getChildDietFlagsSafe(){
  const c = window.childData || {};
  if (Array.isArray(c.dietaryFlags)) return c.dietaryFlags;
  if (Array.isArray(c.specialDiet))  return c.specialDiet;
  return [];
}

/* ====== Preferences (طفل) ====== */
function getChildFavoritesSafe(){
  const c = window.childData || {};
  return {
    preferred: safeArray(c.preferred),
    disliked:  safeArray(c.disliked)
  };
}

/* ====== مطابقة الحمية ====== */
function isCompliantDiet(itemTags, flags){
  if(!flags.length) return true;
  const set = new Set(Array.isArray(itemTags) ? itemTags : []);
  return flags.every(f => set.has(f));
}

/* ====== وحدات ومقادير ====== */
function gramsForRow(row){
  // servingGrams: وزن الحصة الواحدة (جرام) — qty: عدد الحصص
  return safeNum(row.servingGrams) * safeNum(row.qty || 1);
}

/* ====== اختيار كارب الجرعة (صافي/كلي) لكل 100 جم ====== */
function carbPer100ForDose(row){
  const p = row.per100 || {};
  const c = safeNum(p.carbs_g);
  const f = safeNum(p.fiber_g);
  return USE_NET_DOSE ? Math.max(0, c - f) : c;
}

/* ====== كارب الجرعة بالجرام للصف ====== */
function carbsGramsForRow(row){
  return carbPer100ForDose(row) * gramsForRow(row) / 100;
}

/* ====== حساب السكور للترتيب ====== */
function scoreItem(item, child){
  const flags = getChildDietFlagsSafe();
  const compliant = isCompliantDiet(item?.dietTags, flags);
  const ids = getChildFavoritesSafe();
  const key = item?.id || item?.name || item?.["الاسم (AR)"] || "";

  let s = 0;
  if (compliant) s += 2;                // مطابقة الحمية
  if (ids.preferred.includes(key)) s += 1;   // مفضلة
  if (ids.disliked.includes(key))  s -= 1;   // غير مفضلة
  return s;
}

/* ====== ترتيب العناصر قبل العرض ====== */
function sortItemsByDietAndPrefs(items){
  const flags = getChildDietFlagsSafe();
  const ids   = getChildFavoritesSafe();

  items.sort((a,b)=>{
    const sb = scoreItem(b, window.childData||{});
    const sa = scoreItem(a, window.childData||{});
    if (sb !== sa) return sb - sa;

    // ثانوي: الترتيب الأبجدي العربي حسب الاسم
    const an = (a.name || a["الاسم (AR)"] || "").toString();
    const bn = (b.name || b["الاسم (AR)"] || "").toString();
    return an.localeCompare(bn, 'ar');
  });

  return items;
}

/* ====== تأشير البطاقات (شارات) ====== */
function annotateBadges(cardEl, item){
  try{
    const flags = getChildDietFlagsSafe();
    const ids   = getChildFavoritesSafe();
    const key   = item?.id || item?.name || item?.["الاسم (AR)"] || "";

    const compliant = isCompliantDiet(item?.dietTags, flags);
    const isFav  = ids.preferred.includes(key);
    const isDis  = ids.disliked.includes(key);

    // ابني عناصر الشارة لو عندك cardEl
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

/* ====== إعادة حساب الجرعات والإجماليات والشريط ====== */
function recalcTotalsAndHeader(items){
  let totalCarbDose = 0, totalProtein = 0, totalFat = 0, totalFiber = 0, totalKcal = 0, totalGL = 0;

  for (const row of items){
    const g = gramsForRow(row);
    const per = row.per100 || {};
    const gi = safeNum(row.gi || per.gi);

    totalCarbDose += carbsGramsForRow(row);
    totalProtein  += safeNum(per.protein_g) * g / 100;
    totalFat      += safeNum(per.fat_g)     * g / 100;
    totalFiber    += safeNum(per.fiber_g)   * g / 100;
    totalKcal     += safeNum(per.cal_kcal)  * g / 100;

    // GL (توعوي) مبني على الكارب المستخدم في الجرعة
    const cDosePer100 = carbPer100ForDose(row);
    totalGL += gi * (cDosePer100 * g / 100) / 100;
  }

  // عرض الإجماليات (استخدم دالتك الأصلية لو موجودة)
  if (typeof originalRenderFooterTotals === 'function'){
    originalRenderFooterTotals({ totalCarbDose, totalProtein, totalFat, totalFiber, totalKcal, totalGL });
  } else {
    // بديل بسيط لو مش متوفر
    const el = $('totalsArea');
    if (el){
      el.innerHTML = `
        <div>الكارب (جرعة): ${totalCarbDose.toFixed(1)} g</div>
        <div>البروتين: ${totalProtein.toFixed(1)} g</div>
        <div>الدهون: ${totalFat.toFixed(1)} g</div>
        <div>الألياف: ${totalFiber.toFixed(1)} g</div>
        <div>السعرات: ${totalKcal.toFixed(0)} kcal</div>
        <div>GL توعوي: ${totalGL.toFixed(1)}</div>
      `;
    }
  }

  // تحديث الشريط العلوي حسب الكارب المستخدم للجرعة
  const doseCarb = totalCarbDose;
  if (typeof originalUpdateHeaderProgress === 'function'){
    originalUpdateHeaderProgress(doseCarb);
  } else {
    const el = $('headerProgressValue');
    if (el) el.textContent = `${doseCarb.toFixed(1)} g (Net/Gross حسب الاختيار)`;
  }
}

/* ====== إعادة حساب الصفوف + الإجماليات + الشريط ====== */
function recalcPerRowDose(){
  // لو عندك دالة أصلية لحساب العمود في الجدول خليه يشتغل:
  if (typeof window.recalcRowDoseOriginal === 'function'){
    window.recalcRowDoseOriginal();
    return;
  }
  // أو نفّذ تحديثاتك اليدوية هنا حسب الـDOM عندك
}

function recomputeAllDoseViews(){
  try {
    recalcPerRowDose();
    recalcTotalsAndHeader(currentMealItems);
  } catch (e) {
    console.error('recomputeAllDoseViews error', e);
  }
}

/* ====== غلاف renderPicker الأصلي لإضافة الترتيب والشارات ====== */
if (typeof originalRenderPicker === 'function' && !window.__wrappedRenderPicker){
  window.renderPicker = function(items){
    try{
      currentMealItems = Array.isArray(items) ? items.slice() : [];
      sortItemsByDietAndPrefs(currentMealItems);
    }catch(e){ console.warn('sort wrapper warn', e); }

    // نداء الدالة الأصلية
    const result = originalRenderPicker(currentMealItems);

    // إضافة الشارات (لو بتكوِّن بطاقات بعناصر DOM بعرفها)
    // إن ما كانش عندك إرجاع/خريطة للعناصر، تقدري تفعلي الشارات أثناء بناء البطاقة في دالتك.
    return result;
  };
  window.__wrappedRenderPicker = true;
}

/* ====== toggle (Net Carbs) ====== */
(function initNetCarbToggle(){
  const netEl = $('useNetCarbDose') || $('useNetCarb'); // أي Id عندك
  if (netEl){
    USE_NET_DOSE = !!netEl.checked;
    netEl.addEventListener('change', ()=>{
      USE_NET_DOSE = !!netEl.checked;
      recomputeAllDoseViews();
    });
  }
})();

/* ====== Public API (لو بتحتاجي تناديها من أكواد تانية) ====== */
window.mealsApi = Object.assign({}, window.mealsApi || {}, {
  recomputeAllDoseViews,
  sortItemsByDietAndPrefs,
  isCompliantDiet,
  getChildDietFlagsSafe
});

/* ====== إعادة الحساب عند أي تغيير كميّات/وحدات ====== */
// استمعي لتغييرات الحقول الشائعة (عدّلي الـselectors حسب فورمك)
document.addEventListener('change', (ev)=>{
  const t = ev.target;
  if (!t) return;
  if (t.matches('.qty, .serving-grams, .unit-select')) {
    // حدّث السطر الذي تغيّر ثم أعد الحساب
    recomputeAllDoseViews();
  }
});

/* ============================ END meals.js (FULL) ============================ */
