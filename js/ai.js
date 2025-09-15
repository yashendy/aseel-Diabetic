// js/ai.js — ذكاء بدائل + ضبط المقادير (متوافق مع meals.js)
// ملاحظة: يدعم Gemini لو وفّرت window.GEMINI_KEY، وإلا يعمل Fallback محلي.

/* =================== إعدادات =================== */
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

/* =================== اقتراح بدائل ===================
ctx = {
  itemsLibrary: [{name, brand?, carbs_g, tags?[]} ...]  // مكتبة مبسّطة
  currentItems: [{name, qty, unit, carbs_g} ...]        // العناصر الحالية
  prefs: {
    diet: { halal, veg, lowcarb, lowfat, lowsod },
    allergies: string[], likes: string[], dislikes: string[]
  }
}
ترجع: { type: "gemini"|"local", text: string }
==================================================== */
async function suggestAlternatives(ctx) {
  const key = (typeof window !== "undefined" && window.GEMINI_KEY) ? window.GEMINI_KEY : "";

  if (key) {
    try {
      const prompt = buildPrompt(ctx);
      const res = await fetch(`${GEMINI_ENDPOINT}?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }]}],
          generationConfig: { temperature: 0.5, maxOutputTokens: 512 }
        })
      });
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (text.trim()) return { type: "gemini", text };
    } catch (e) {
      console.warn("Gemini failed → using local fallback", e);
    }
  }

  // ======= Fallback محلي =======
  const filtered = (ctx.itemsLibrary || []).filter(f => {
    const hay = [f.name, f.brand, ...(f.tags || [])].join(" ").toLowerCase();
    const hasWord = (arr) =>
      Array.isArray(arr) && arr.some(x => hay.includes(String(x).toLowerCase()));

    // حساسيات و غير مفضلات
    if (hasWord(ctx.prefs?.allergies)) return false;
    if (hasWord(ctx.prefs?.dislikes))  return false;

    // حلال
    if (ctx.prefs?.diet?.halal && f.tags?.includes("not-halal")) return false;

    // نباتي
    if (ctx.prefs?.diet?.veg && !(f.tags?.includes("veg") || f.tags?.includes("vegan"))) return false;

    // أنظمة أخرى بسيطة
    if (ctx.prefs?.diet?.lowcarb && (f.carbs_g ?? 0) > 15) return false;
    if (ctx.prefs?.diet?.lowfat  && f.tags?.includes("high-fat")) return false;
    if (ctx.prefs?.diet?.lowsod  && f.tags?.includes("high-sodium")) return false;

    return true;
  }).sort((a, b) => {
    // المفضلات أولاً ثم الأقل كارب
    const liked = (x) =>
      Array.isArray(ctx.prefs?.likes) &&
      ctx.prefs.likes.some(w => (x.name || "").toLowerCase().includes(String(w).toLowerCase()));
    const la = liked(a) ? -1 : 0;
    const lb = liked(b) ? -1 : 0;
    if (la !== lb) return la - lb;
    return (a.carbs_g ?? 0) - (b.carbs_g ?? 0);
  }).slice(0, 12);

  const lines = filtered.map(
    (f) => `• ${f.name}${f.brand ? " (" + f.brand + ")" : ""} — ${f.carbs_g ?? "?"}g كارب/وحدة`
  );

  return { type: "local", text: lines.join("\n") };
}

/* يبني برومبت Gemini بالعربية */
function buildPrompt(ctx) {
  return [
    "اقترح بدائل عربية مناسبة لهذه الوجبة لطفل سكري:",
    "",
    "العناصر الحالية:",
    ...(ctx.currentItems || []).map(
      (i) => `- ${i.name} × ${i.qty} (${i.unit || "وحدة"}), كارب/وحدة=${i.carbs_g ?? "?"}`
    ),
    "",
    "تفضيلات وأنظمة:",
    `حلال=${!!ctx.prefs?.diet?.halal}, نباتي=${!!ctx.prefs?.diet?.veg}, قليل الكارب=${!!ctx.prefs?.diet?.lowcarb}, قليل الدهون=${!!ctx.prefs?.diet?.lowfat}, قليل الصوديوم=${!!ctx.prefs?.diet?.lowsod}`,
    `حساسيات: ${Array.isArray(ctx.prefs?.allergies) ? ctx.prefs.allergies.join(", ") : "-"}`,
    `مفضلات: ${Array.isArray(ctx.prefs?.likes) ? ctx.prefs.likes.join(", ") : "-"}`,
    `غير مفضلات: ${Array.isArray(ctx.prefs?.dislikes) ? ctx.prefs.dislikes.join(", ") : "-"}`,
    "",
    "أعد النتائج كل سطر بديل واحد بعبارة قصيرة ومناسبة للأطفال (بدون شرح طويل)، وبحد أقصى 8 بدائل."
  ].join("\n");
}

/* ============== ضبط المقادير داخل النطاق ==============
items: [{ qty, carbsPerUnit }]    // يتجاهل العناصر بلا كارب
min/max: حدود الكارب للوجبة
تعديل بخطوة 0.25 للوصول لنقطة قريبة من منتصف النطاق
======================================================= */
function adjustToRange({ items, totalCarbs, min, max }) {
  if (!Array.isArray(items) || (!min && !max)) return items || [];
  const step = 0.25;
  const clamp = (v) => Math.max(0, Math.round(v / step) * step);

  // لو الإجمالي غير متاح نحاول الحفاظ على الكميات
  const current = Number(totalCarbs ?? 0);
  const target =
    typeof min === "number" && typeof max === "number"
      ? (min + max) / 2
      : (min ?? max ?? current);

  let diff = target - current; // موجب: نزوّد – سالب: نقلّل
  const adjustable = items
    .map((x, i) => ({ i, c: Number(x.carbsPerUnit ?? 0) }))
    .filter((o) => o.c > 0);

  if (!adjustable.length) return items;

  for (let r = 0; r < 200 && Math.abs(diff) > 0.01; r++) {
    for (const a of adjustable) {
      const one = a.c * step;
      if (diff > 0.01) {
        items[a.i].qty = clamp((items[a.i].qty || 0) + step);
        diff -= one;
      } else if (diff < -0.01 && (items[a.i].qty || 0) - step >= 0) {
        items[a.i].qty = clamp(items[a.i].qty - step);
        diff += one;
      }
      if (Math.abs(diff) <= 0.01) break;
    }
  }
  return items;
}

/* =================== التصدير =================== */
export const MealAI = { suggestAlternatives, adjustToRange };
