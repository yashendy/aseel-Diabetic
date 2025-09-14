// ai.js — وحدة بدائل ذكية باستدعاء Gemini
// ⚠️ في الإنتاج: لا تضع مفتاحك داخل المتصفح. استخدم خادم وسيط أو Cloud Function.
// هنا للبيئة المحلية فقط يمكن تمرير المفتاح عبر window.GEMINI_KEY.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

/**
 * @param {Object} ctx
 * ctx.child: { dietaryFlags[], allergies[], preferred[], disliked[], carbTargets{} }
 * ctx.mealType: "breakfast"|"lunch"|"dinner"|"snack"
 * ctx.basket: [{name, portions, gramsPerPortion, carbs}]
 * @returns Promise<Array<{name:string, why:string, swapFor?:string}>>
 */
export async function suggestAlternatives(ctx){
  try{
    const apiKey = window.GEMINI_KEY || (import.meta.env?.VITE_GEMINI_KEY) || "<PUT_YOUR_GEMINI_KEY>";
    const prompt = {
      task: "Return Arabic JSON array only; no prose.",
      constraints: [
        "احترم الأنظمة الغذائية والحساسيات",
        "اقترح بدائل منطقية وبسيطة متوفرة عادةً",
        "فسّر السبب why بجملة قصيرة",
        "swapFor اسم صنف من السلة إن كان مناسبًا"
      ],
      context: ctx
    };

    const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents:[{ role:"user", parts:[{ text: "أعد JSON فقط بدون شرح:\n"+JSON.stringify(prompt)}] }],
        generationConfig:{ temperature:0.4, maxOutputTokens:600 }
      })
    }).then(r=>r.json());

    const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.slice(0, 8);
    } catch {}
    return [];
  }catch(e){
    console.error("AI suggestAlternatives error:", e);
    return [];
  }
}
