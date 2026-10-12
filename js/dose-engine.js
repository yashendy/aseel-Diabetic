// js/dose-engine.js
// ========================================================
// المحرك المشترك لحسابات الجرعات والسكر — تستخدمه meals / measurements / child-edit
// ملاحظة: هذه حسابات مساعدة وليست بديلاً عن تعليمات الطبيب المعالج.
// ========================================================
 
export const MGDL_PER_MMOL = 18.0182;
 
// ---------- أدوات عامة ----------
const pad = n => String(n).padStart(2, '0');
export const round = (n, d = 1) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };
 
// تاريخ ووقت محليين (بدل toISOString الذي يرجع UTC ويُخطئ في اليوم بعد منتصف الليل)
export const localDateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTimeStr = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function whenFromParts(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}
export function toDateObj(w) {
  if (!w) return null;
  if (w instanceof Date) return w;
  if (typeof w.toDate === 'function') return w.toDate();
  if (typeof w.seconds === 'number') return new Date(w.seconds * 1000);
  const d = new Date(w); return isNaN(d) ? null : d;
}
 
// منع حقن HTML (XSS) عند عرض نصوص مخزنة
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 
// ---------- تحويل الوحدات ----------
export const toMgdl = (v, unit) => unit === 'mmol/L' ? v * MGDL_PER_MMOL : v;
export const convert = (v, from, to) => {
  if (!from || !to || from === to) return v;
  return to === 'mmol/L' ? v / MGDL_PER_MMOL : v * MGDL_PER_MMOL;
};
 
// ---------- الوجبات والـ Slots ----------
export const SLOT_ORDER = { FASTING: 10, PRE_BREAKFAST: 20, POST_BREAKFAST: 25, PRE_LUNCH: 30, POST_LUNCH: 35, PRE_DINNER: 40, POST_DINNER: 45, SNACK: 50, EXERCISE: 60, BEDTIME: 90, OTHER: 200 };
export function mealOfSlot(slotKey = '') {
  if (slotKey.includes('BREAKFAST')) return 'breakfast';
  if (slotKey.includes('LUNCH')) return 'lunch';
  if (slotKey.includes('DINNER')) return 'dinner';
  if (slotKey === 'SNACK') return 'snack';
  return null;
}
 
// ---------- إعدادات العلاج للطفل (بدون قيم افتراضية صامتة للجرعات) ----------
export function getTherapy(c = {}) {
  const unit = c.glucoseUnit || 'mg/dL';
  const mm = unit === 'mmol/L';
  const gl = c.glucose_limits || {};
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const crObj = (c.cr && typeof c.cr === 'object') ? c.cr : {};
  const legacyCR = num(c.carbRatio);
  const t = {
    unit,
    CF: num(c.cf ?? c.correctionFactor),
    CR: {
      breakfast: num(crObj.breakfast) ?? legacyCR,
      lunch: num(crObj.lunch) ?? legacyCR,
      dinner: num(crObj.dinner) ?? legacyCR,
      snack: num(crObj.snack) ?? legacyCR
    },
    target: num(gl.target),
    limits: {
      critLow: num(gl.critical_low) ?? (mm ? 3.0 : 54),
      low: num(gl.low) ?? (mm ? 3.9 : 70),
      high: num(gl.high) ?? (mm ? 10.0 : 180),
      critHigh: num(gl.critical_high) ?? (mm ? 13.9 : 250)
    },
    step: num(c.insulinStep) ?? 0.5,        // أصغر تدرج في قلم/مضخة الأنسولين
    maxDose: num(c.maxDose),                // حد أقصى لجرعة واحدة (يحدده الطبيب)
    diaHours: num(c.diaHours) ?? 4,         // مدة مفعول الأنسولين (لحساب IOB)
    hypoCarbs: num(c.hypoCarbs) ?? 15,      // جرامات الكارب لعلاج الهبوط
    netCarbRule: c.netCarbRule || 'fullFiber'
  };
  t.missing = [];
  if (!t.CF) t.missing.push('معامل التصحيح CF');
  if (!t.target) t.missing.push('هدف السكر');
  return t;
}
 
export function roundToStep(x, step = 0.5) {
  if (!(x > 0)) return 0;
  return Math.round((Math.round(x / step) * step) * 100) / 100;
}
 
// ---------- حالة القراءة ----------
export function glucoseState(val, limits) {
  if (val <= limits.critLow) return { key: 'critLow', dot: 'danger', bg: 'bg-danger', text: 'هبوط حرج' };
  if (val < limits.low) return { key: 'low', dot: 'warn', bg: 'bg-warn', text: 'هبوط' };
  if (val >= limits.critHigh) return { key: 'critHigh', dot: 'danger', bg: 'bg-danger', text: 'ارتفاع حرج' };
  if (val > limits.high) return { key: 'high', dot: 'warn', bg: 'bg-warn', text: 'ارتفاع' };
  return { key: 'ok', dot: 'ok', bg: 'bg-ok', text: 'في النطاق' };
}
 
// حقول القراءة الموحدة (نفس الشكل من كل الصفحات + حقول يقرؤها analytics)
export function glucoseFields(value, unit, therapy) {
  const v = Number(value);
  const mg = toMgdl(v, unit);
  const norm = convert(v, unit, therapy.unit);
  return {
    value: v, unit,
    normalizedValue: round(norm, 2),
    value_mgdl: round(mg, 1),
    value_mmol: round(mg / MGDL_PER_MMOL, 2),
    state: glucoseState(norm, therapy.limits).text
  };
}
 
// ---------- الأنسولين النشط IOB (تقدير خطي على مدة DIA) ----------
export const isMealDoc = d => !!(d && (d.mealSaved || Number(d.carbs) > 0 || Number(d.carbDose) > 0));
 
export function extractDoseEntries(docs) {
  return docs.map(d => ({
    when: toDateObj(d.when),
    units: Number(d.totalDose) || Number(d.correctionDose) || 0
  })).filter(e => e.when && e.units > 0);
}
 
export function calcIOB(entries, at, diaHours = 4) {
  const dia = diaHours * 3600e3;
  let total = 0;
  for (const e of entries) {
    const el = at.getTime() - e.when.getTime();
    if (el < 0 || el >= dia) continue;
    total += e.units * (1 - el / dia);
  }
  return round(total, 2);
}
 
// ---------- محرك حساب الجرعة ----------
export function calcBolus({ therapy: t, slotKey, bg = 0, bgUnit, carbs = 0, iob = 0, trend = 0, stats = {} }) {
  const out = {
    blocked: null, isHypo: false, effectiveBg: 0, carbDose: 0, correction: 0, iobUsed: 0,
    rawDose: 0, finalDose: 0, capped: false, negativeCorrection: false,
    cr: null, cf: t.CF, target: t.target, alerts: []
  };
  const alert = (level, text) => out.alerts.push({ level, text });
 
  const meal = mealOfSlot(slotKey);
  const cr = meal ? t.CR[meal] : null;
  out.cr = cr;
 
  const hasBg = bg > 0;
  const bgC = hasBg ? convert(bg, bgUnit || t.unit, t.unit) : 0;
  const eff = hasBg ? bgC + convert(trend, 'mg/dL', t.unit) : 0;   // سهم الحساس يُقاس بـ mg/dL
  out.effectiveBg = eff;
 
  // 1) الهبوط أولاً — يعمل حتى لو إعدادات الجرعة ناقصة
  if (hasBg && eff < t.limits.low) {
    out.isHypo = true;
    alert('danger', `<strong>🚨 هبوط:</strong> عالجي أولاً (${t.hypoCarbs} جم كارب سريع) وأعيدي القياس بعد 15 دقيقة قبل أي أنسولين.`);
    return out;
  }
 
  // 2) إعدادات ناقصة → لا نخمّن
  if (carbs > 0 && !cr) {
    out.blocked = 'لم يتم تحديد نسبة الكارب (CR) لهذه الوجبة. أكمليها من إعدادات الطفل، أو أدخلي الجرعة يدوياً بعد مراجعة الطبيب.';
    return out;
  }
  if (hasBg && (!t.CF || !t.target)) {
    out.blocked = `إعدادات ناقصة (${t.missing.join('، ')}). أكمليها من إعدادات الطفل، أو أدخلي الجرعة يدوياً بعد مراجعة الطبيب.`;
    return out;
  }
 
  // 3) الحساب
  out.carbDose = cr ? carbs / cr : 0;
  out.correction = hasBg ? (eff - t.target) / t.CF : 0;
  out.negativeCorrection = out.correction < 0;
  out.iobUsed = Math.max(0, iob || 0);
  out.rawDose = out.carbDose + out.correction - out.iobUsed;
  let final = roundToStep(Math.max(0, out.rawDose), t.step);
 
  if (t.maxDose && final > t.maxDose) {
    final = t.maxDose; out.capped = true;
    alert('danger', `<strong>⛔ تجاوز الحد الأقصى:</strong> الجرعة المحسوبة أعلى من الحد المحدد (${t.maxDose}U) فتم تحديدها به. راجعي الإعدادات أو الطبيب.`);
  }
  out.finalDose = final;
 
  // 4) تنبيهات ذكية
  if (carbs > 0 && !hasBg) alert('info', '<strong>ℹ️ لا توجد قراءة سكر:</strong> الجرعة للكارب فقط بدون تصحيح.');
  if (out.iobUsed > 0) alert('info', `<strong>⏳ أنسولين نشط:</strong> تم خصم ${round(out.iobUsed, 2)}U من الجرعة.`);
  if (out.negativeCorrection) alert('info', `<strong>💡 تصحيح عكسي:</strong> السكر أقل من الهدف، تم خصم (${Math.abs(out.correction).toFixed(1)} U) من جرعة الأكل.`);
  if (trend < 0) alert('warn', '<strong>⬇️ سهم هبوط:</strong> تم خفض الجرعة لتفادي الهبوط المتوقع.');
  if (hasBg && bgC >= t.limits.critHigh) alert('warn', '<strong>🧪 ارتفاع حرج:</strong> اتبعي تعليمات الطبيب بشأن فحص الكيتونات وطلب المساعدة.');
  if ((stats.fat || 0) > 30 || (stats.pro || 0) > 40) alert('info', '<strong>🍕 وجبة دسمة:</strong> قد تحتاجين لتقسيم الجرعة لتجنب الارتفاع المتأخر (بحسب تعليمات الطبيب).');
  if ((stats.avgGI || 0) >= 70) alert('info', '<strong>📈 مؤشر جلايسيمي مرتفع:</strong> يُفضل حقن الأنسولين قبل الأكل.');
  return out;
}
