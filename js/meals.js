// ai.js - مساعد الذكاء: اقتراح بدائل + ضبط المقادير داخل نطاق الكارب
export const MealAI = {
  /**
   * يقترح بدائل بناءً على العناصر الحالية والمكتبة والتفضيلات
   * prefs = { diet:{halal,veg,lowcarb,lowfat,lowsod}, allergies[], likes[], dislikes[] }
   * items = [{name, brand, carbs_g, gramsPerUnit, unit, tags[]}, ...]
   */
  async suggestAlternatives({ itemsLibrary, currentItems, prefs }) {
    // 1) لو فيه مفتاح Gemini في النافذة، جرّب API (نص مقترح بالعربية)
    const key = window?.GEMINI_KEY || null;
    if (key) {
      try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=" + key, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: buildPrompt(currentItems, prefs)
              }]
            }],
            generationConfig: { temperature: 0.5, maxOutputTokens: 512 }
          })
        });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return { type: "gemini", text };
      } catch (e) {
        console.warn("Gemini failed, fallback local", e);
      }
    }

    // 2) Fallback محلي ذكي بسيط
    const filtered = itemsLibrary.filter(f => {
      // حساسية / disliked
      if (matchAny(f, prefs.allergies)) return false;
      if (matchAny(f, prefs.dislikes)) return false;

      // حلال
      if (prefs.diet?.halal && f.tags?.includes("not-halal")) return false;

      // نباتي
      if (prefs.diet?.veg && !(f.tags?.includes("veg") || f.tags?.includes("vegan"))) return false;

      // أنظمة غذائية
      if (prefs.diet?.lowcarb && (f.carbs_g ?? 0) > 15) return false; // بسيط: 15g كارب حد أقصى للوحدة
      if (prefs.diet?.lowfat && f.tags?.includes("high-fat")) return false;
      if (prefs.diet?.lowsod && f.tags?.includes("high-sodium")) return false;

      return true;
    });

    // رتّب حسب المفضلات ثم الأقل كارب
    const likedFirst = filtered.sort((a,b) => {
      const la = includesAny(a, prefs.likes) ? -1 : 0;
      const lb = includesAny(b, prefs.likes) ? -1 : 0;
      if (la !== lb) return la - lb;
      return (a.carbs_g ?? 0) - (b.carbs_g ?? 0);
    }).slice(0, 12);

    const lines = likedFirst.map(f => `• ${f.name}${f.brand ? " ("+f.brand+")" : ""} — ${f.carbs_g ?? "?"}g كارب/وحدة`);
    return { type: "local", text: lines.join("\n") };

    // helpers
    function buildPrompt(currentItems, prefs){
      return [
        "اقترح بدائل عربية مناسبة لهذه الوجبة لطفل سكري:",
        "",
        "العناصر الحالية:",
        ...currentItems.map(i=>`- ${i.name} × ${i.qty} (${i.unit || "unit"}), كارب/وحدة=${i.carbs_g ?? "?"}`),
        "",
        "تفضيلات وأنظمة:",
        `حلال=${!!prefs.diet?.halal}, نباتي=${!!prefs.diet?.veg}, قليل الكارب=${!!prefs.diet?.lowcarb}, قليل الدهون=${!!prefs.diet?.lowfat}, قليل الصوديوم=${!!prefs.diet?.lowsod}`,
        `حساسيات: ${prefs.allergies?.join(", ") || "-"}`,
        `مفضلات: ${prefs.likes?.join(", ") || "-"}`,
        `غير مفضلات: ${prefs.dislikes?.join(", ") || "-"}`,
        "",
        "اقترح 8 بدائل كحد أقصى مع تفسير قصير جدًا لكل بديل."
      ].join("\n");
    }
    function norm(s){return (s||"").toString().trim().toLowerCase()}
    function matchAny(f, arr){
      if (!arr?.length) return false;
      const hay = [f.name, f.brand, ...(f.tags||[])].map(norm).join(" ");
      return arr.some(x => hay.includes(norm(x)));
    }
    function includesAny(f, arr){
      if (!arr?.length) return false;
      const hay = [f.name, f.brand, ...(f.tags||[])].map(norm).join(" ");
      return arr.some(x => hay.includes(norm(x)));
    }
  },

  /**
   * يضبط كميات العناصر بخطوة 0.25 لتقريب إجمالي الكارب داخل النطاق
   * items = [{qty, carbsPerUnit}] -> يُعيد مصفوفة جديدة
   */
  adjustToRange({ items, totalCarbs, min, max }) {
    if (!items?.length || (!min && !max)) return items;
    const step = 0.25;
    const clamp = v => Math.max(0, Math.round(v/step)*step);

    // استهدف المنتصف داخل النطاق
    const target = typeof min === "number" && typeof max === "number"
      ? (min + max) / 2
      : (min ?? max ?? totalCarbs);

    // لو الإجمالي صفر نحاول رفع عنصر مفضل
    if (totalCarbs === 0) {
      const idx = items.findIndex(x => (x.carbsPerUnit ?? 0) > 0);
      if (idx >= 0) { items[idx].qty = clamp(items[idx].qty + step); }
      return items;
    }

    let diff = target - totalCarbs; // موجب: نزوّد، سالب: نقلل
    // وزّع الزيادة/النقص على العناصر القابلة للتعديل بالتساوي النسبي
    const adjustable = items
      .map((x, i) => ({i, c: x.carbsPerUnit ?? 0}))
      .filter(o => o.c > 0);

    if (!adjustable.length) return items;

    const rounds = 200; // أمان
    for (let r=0; r<rounds && Math.abs(diff) > 0.01; r++) {
      for (const a of adjustable) {
        const oneStepCarb = a.c * step;
        if (diff > 0.01) {
          items[a.i].qty = clamp(items[a.i].qty + step);
          diff -= oneStepCarb;
        } else if (diff < -0.01 && items[a.i].qty - step >= 0) {
          items[a.i].qty = clamp(items[a.i].qty - step);
          diff += oneStepCarb;
        }
        if (Math.abs(diff) <= 0.01) break;
      }
    }
    return items;
  }
};
