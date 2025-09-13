// ===== nutrition-utils.js =====
// دوال مساعدة لحساب القيم الغذائية والسكورات

// حساب محتوى الصنف بناءً على جرامات محددة (من قيم 100جم)
export function calcServingFrom100g(n100, grams){
  const n = n100||{};
  const g = Number(grams)||0;
  const safe = (v)=> Number(v||0);
  return {
    grams: g,
    carbs:  safe(n.carbs_g)   * g / 100,
    fiber:  safe(n.fiber_g)   * g / 100,
    prot:   safe(n.protein_g) * g / 100,
    fat:    safe(n.fat_g)     * g / 100,
    kcal:   safe(n.cal_kcal)  * g / 100,
    sugar:  safe(n.sugar_g)   * g / 100,
    satFat: safe(n.satFat_g)  * g / 100,
    sodium: safe(n.sodium_mg) * g / 100
  };
}

// تطبيع القيم إلى 0..1
export function normalize(v, min, max, invert=false){
  const x = Math.min(max, Math.max(min, Number(v)||0));
  const n = (x - min) / (max - min || 1);
  return invert ? (1 - n) : n;
}

// سكور صحي: ألياف/بروتين ↑، سكر/دهون مشبعة/صوديوم ↓
export function scoreHealth(serv, food){
  const f = serv||{};
  const fiberN  = normalize(f.fiber, 0, 10);
  const protN   = normalize(f.prot,  0, 30);
  const sugarN  = normalize(f.sugar, 0, 20, true);
  const satN    = normalize(f.satFat,0, 10, true);
  const sodN    = normalize(f.sodium,0,600, true);

  let giBonus = 0;
  const gi = Number(food?.gi);
  if(Number.isFinite(gi)) giBonus = normalize(gi, 40, 90, true) * 0.1;

  const score = (0.30*fiberN) + (0.20*protN) + (0.25*sugarN) + (0.15*satN) + (0.10*sodN) + giBonus;
  return Math.round(score * 100); // من 0 إلى 100
}

// سكور ملاءمة اختياري (حسب الأهداف إن وجدت)
export function scoreFit(serv, targets){
  const t = targets||{};
  let penalty = 0;
  if(Number.isFinite(t.carbsTarget)){
    penalty += Math.abs((serv.carbs||0) - t.carbsTarget) * 2;
  }
  if(Number.isFinite(t.kcalTarget)){
    penalty += Math.abs((serv.kcal||0) - t.kcalTarget) * 0.5;
  }
  const s = Math.max(0, 100 - penalty);
  return Math.round(s);
}

// تنسيق سطر الماكروز
export function formatMacroLine(s){
  const r=(n)=>Math.round((n||0)*10)/10;
  return `كارب ${r(s.carbs)}g • ألياف ${r(s.fiber)}g • بروتين ${r(s.prot)}g • سعرات ${r(s.kcal)}`;
}
