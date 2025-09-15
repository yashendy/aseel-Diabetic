// window.ai — بدون export/module
(function(){
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function roundStep(v, s){ return Math.round(v/s)*s; }

  // تعديل المقادير بخطوة 0.25 للوصول للنطاق
  function adjustToTarget(items, total, min, max, step){
    step = step || 0.25;
    if (!Array.isArray(items) || !items.length) return items||[];
    if (min==null || max==null) return items;
    if (total >= min && total <= max) return items;

    const impact = it => (Number(it.gramsPerUnit||0) * Number(it.carbsPer100||0) / 100) || 0;
    let next = items.map(x=>({...x}));
    let guard = 240; // حدود أمان
    let direction = total < min ? +1 : -1;

    while(guard--){
      // رتّب حسب التأثير (أعلى ثم أقل)
      next.sort((a,b)=> impact(b) - impact(a));
      let changed = false;

      for (const it of next){
        const curQty = Number(it.qtyUnits||0);
        const newQty = clamp(roundStep(curQty + direction*step, step), 0, 999);
        if (newQty !== curQty){
          it.qtyUnits = newQty;
          it.gramsTotal = Number((newQty * Number(it.gramsPerUnit||0)).toFixed(2));
          it.carbs = Number(((Number(it.carbsPer100||0)/100) * it.gramsTotal).toFixed(2));
          changed = true;
          break;
        }
      }

      const now = next.reduce((s,x)=> s + (Number(x.carbs)||0), 0);
      if (now >= min && now <= max) return next;
      if (!changed) return next;
      direction = now < min ? +1 : -1;
    }
    return next;
  }

  // بدائل بسيطة Placeholder (يمكن ربطها بمكتبتك لاحقًا)
  function suggestAlternatives(items, ctx){
    // حاليًا يرجّع نفس العناصر برسالة لطيفة
    return { ok: true, items, message: "لا توجد بدائل مناسبة الآن — سنحسّن لاحقًا." };
  }

  window.ai = { adjustToTarget, suggestAlternatives };
})();
