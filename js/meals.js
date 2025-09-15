// AI helper بدون export/module
(function(){
  const MealAI = {};

  // محاولة استدعاء Gemini إن وُفر مفتاح بيئة في window.GEMINI_KEY (اختياري)
  async function callGemini(prompt){
    try{
      const key = window.GEMINI_KEY; // ضعيه إن أردتِ
      if(!key) throw new Error("no-key");
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key="+key,
        {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            contents:[{parts:[{text: prompt}]}],
            generationConfig:{ temperature:0.2 }
          })
        }
      );
      if(!res.ok) throw new Error("bad-res");
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return text;
    }catch(e){
      console.warn("AI call fallback:", e.message);
      return null;
    }
  }

  // اقتراح بدائل بسيطة محلية عند فشل الذكاء
  function localAlternatives(items, lib, prefs){
    // فلترة بناءً على حساسيات/أنظمة/غير مفضلات
    const notAllowed = new Set((prefs?.allergies||[])
      .concat(prefs?.dislikes||[]).map(s=>String(s).trim().toLowerCase()));

    const good = lib.filter(x=>{
      const n = (x.name||"").toLowerCase();
      if([...notAllowed].some(a => n.includes(a))) return false;
      // احترام قليل الكارب: نفضّل عناصر كاربها أقل من المتوسط
      if(prefs?.diet?.lowcarb && x.nutrPer100?.carbs_g > 15) return false;
      return true;
    });

    // اختر بديل/بديلين لكل عنصر خارج النطاق (بسيط)
    return items.map(it=>{
      const pick = good.find(g => g.id !== it.itemId) || null;
      return { for: it.name, suggestion: pick?.name || "خيار فاكهة/خضار" };
    });
  }

  // تعديل المقادير للوصول للنطاق بخطوة 0.25
  function adjustToRange(items, targetMin, targetMax, step){
    step = step || 0.25;
    // نجمع الكارب الحالي
    const sumCarbs = items.reduce((s,it)=> s + (it.carbs || 0), 0);
    if(sumCarbs >= targetMin && sumCarbs <= targetMax) return items;

    const delta = (sumCarbs < targetMin) ? (targetMin - sumCarbs) : (sumCarbs - targetMax);
    // وزّع التعديل على العناصر القابلة للتعديل
    const adjustable = items.filter(it=> it.gramsPerUnit>0);
    if(adjustable.length===0) return items;

    let remain = delta;
    for(let i=0; i<adjustable.length && remain>1e-6; i++){
      const it = adjustable[i];
      // كارب لكل وحدة: gramsPerUnit * carbsPer100 / 100
      const carbPerUnit = (it.gramsPerUnit || 0) * (it.carbsPer100 || 0) / 100;
      if(carbPerUnit<=0) continue;

      const unitsNeeded = Math.round((remain / carbPerUnit) / step) * step;
      const sign = (sumCarbs < targetMin) ? +1 : -1;
      it.qty = Math.max(0, (it.qty || 0) + sign * unitsNeeded);
      // recompute
      it.grams = (it.qty || 0) * (it.gramsPerUnit || 0);
      it.carbs = (it.grams || 0) * (it.carbsPer100 || 0) / 100;

      // حدث المتبقي تقريبيًا
      const used = Math.abs(unitsNeeded * carbPerUnit);
      remain = Math.max(0, remain - used);
    }
    return items;
  }

  // اقتراح بدائل عبر Gemini إن أمكن وإلا محلي
  MealAI.suggestAlternatives = async function({items, lib, prefs}){
    const prompt = `لدينا قائمة طعام عربية للأطفال: ${items.map(i=>i.name).join(", ")}.
    اقترح بدائل صحية وخالية من الحساسيات: ${(prefs?.allergies||[]).join(", ")}.
    راعِ الأنظمة: ${JSON.stringify(prefs?.diet||{})}. أعد قائمة مختصرة (بالعربية) مع سبب موجز.`;

    const text = await callGemini(prompt);
    if(text) return text;
    const local = localAlternatives(items, lib, prefs);
    return "بدائل مقترحة:\n" + local.map(x=>`• ${x.for} → ${x.suggestion}`).join("\n");
  };

  MealAI.adjustToRange = adjustToRange;

  window.MealAI = MealAI;
})();
