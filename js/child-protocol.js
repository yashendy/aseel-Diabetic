// js/child-protocol.js
// ========================================================================
// المصدر الوحيد لإعدادات العلاج (البروتوكول) لكل طفل: القراءة والتحقق والكتابة.
// وحدة نقية (بدون أي اعتماد على Firebase) فيمكن اختبارها وتستخدمها كل الصفحات.
//
// القرارات المعتمدة:
//  • معامل التصحيح (CF): رقم واحد للطفل، يعدّله الطبيب وولي الأمر.
//  • نطاق السكر: القيم العالمية (ISPAD/ADA) افتراضياً، مع إمكانية التخصيص يدوياً.
//  • الحد الأقصى للجرعة وبارامترات الأمان: يعدّلها الطبيب وولي الأمر.
//  • لا قيم افتراضية صامتة للمعاملات التي تُحسب بها الجرعة (CR وCF والهدف):
//    إن كانت ناقصة نُبلّغ بدل أن نخمّن.
//  • الوزن والجرعة القاعدية تُكتب دائماً في الحقلين معاً (نسخة مرآة) حتى لا يختلفا.
// ملاحظة: هذه حسابات مساعدة وليست بديلاً عن تعليمات الطبيب المعالج.
// ========================================================================

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABELS = { breakfast: 'الفطار', lunch: 'الغداء', dinner: 'العشاء', snack: 'السناك' };
export const MGDL_PER_MMOL = 18.0182;

// الحدود القياسية للأطفال والمراهقين (النوع الأول): ISPAD 2022 / ADA
//  - النطاق المستهدف 3.9–10.0 مليمول/لتر (70–180 مجم/ديسيلتر)
//  - هبوط مستوى 2 (حرج) أقل من 3.0 (54)، وارتفاع شديد أكبر من 13.9 (250)
export const STANDARD_LIMITS = {
  'mmol/L': { critical_low: 3.0, low: 3.9, high: 10.0, critical_high: 13.9 },
  'mg/dL': { critical_low: 54, low: 70, high: 180, critical_high: 250 }
};
const RANGE_KEYS = ['critical_low', 'low', 'high', 'critical_high'];

// قيم افتراضية مقبولة لبارامترات غير حرجة (نُعلِم المستخدم أنها افتراضية)
export const SAFETY_DEFAULTS = { insulinStep: 0.5, diaHours: 4, hypoCarbs: 15, netCarbRule: 'fullFiber' };

// حقول قديمة/يتيمة لا يقرأها أي كود، ويمكن حذفها فوراً بعد نسخ احتياطي
export const LEGACY_REMOVE_NOW = [
  'carbRatioByMeal', 'correctionFactorByMeal',
  'cf_breakfast', 'cf_lunch', 'cf_dinner', 'cf_snack',
  'carbGoals', 'carbTargets', 'longActingDose', 'weightKg',
  'severeHigh', 'severeHighLevel', 'severeLow', 'severeLowLevel',
  'mealsDoses', 'unitType'
];
// حقول قديمة ما زال بعض الكود يقرؤها كاحتياط؛ تُحذف بعد تحديث القُرّاء (final: true)
export const LEGACY_REMOVE_FINAL = ['carbRatio', 'correctionFactor', 'normalRange', 'unit'];

const RANGES = {
  cr: [1, 150],
  cf: { 'mmol/L': [0.3, 22], 'mg/dL': [5, 400] },
  basalDose: [0, 100], maxDose: [0.5, 100], diaHours: [2, 8], hypoCarbs: [5, 40],
  weight: [2, 200], height: [30, 220],
  limit: { 'mmol/L': [1, 40], 'mg/dL': [20, 720] }
};
const STEPS = [0.05, 0.1, 0.25, 0.5, 1];

const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const isBlank = v => v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
const r1 = n => Math.round(n * 10) / 10;
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

// ---------------------------------------------------------------- الوحدة
export function normalizeUnit(u) {
  const s = String(u || '').trim().toLowerCase().replace(/\s+/g, '');
  if (s === 'mmol/l' || s === 'mmol') return 'mmol/L';
  if (s === 'mg/dl' || s === 'mgdl' || s === 'mg') return 'mg/dL';
  return null;
}
// نقرأ glucoseUnit ثم الحقول القديمة (unit/unitType). إن لم توجد وحدة نُرجع null (لا نخمّن).
export function getUnit(child) {
  return normalizeUnit(child?.glucoseUnit) || normalizeUnit(child?.unit) || normalizeUnit(child?.unitType) || null;
}

// ---------------------------------------------------------------- الوزن والطول
export const getWeightKg = child => num(child?.vitals?.weight) ?? num(child?.weight);
export const getHeightCm = child => num(child?.vitals?.height) ?? num(child?.height);

// ---------------------------------------------------------------- حدود السكر
export function getLimits(child, unit) {
  const std = STANDARD_LIMITS[unit] || STANDARD_LIMITS['mg/dL'];
  const raw = child?.glucose_limits || {};
  const out = {};
  const custom = {};
  RANGE_KEYS.forEach(k => {
    const v = num(raw[k]);
    out[k] = v ?? std[k];
    custom[k] = v !== null && v !== std[k];
  });
  let invalid = false;
  if (!(out.critical_low < out.low && out.low < out.high && out.high < out.critical_high)) {
    invalid = true;                       // ترتيب غير منطقي: نرجع للقياسي
    RANGE_KEYS.forEach(k => { out[k] = std[k]; custom[k] = false; });
  }
  out.target = num(raw.target);           // هدف التصحيح: بارامتر علاجي، لا نخمّنه
  return { ...out, isCustom: RANGE_KEYS.some(k => custom[k]), custom, invalid };
}

// ---------------------------------------------------------------- القراءة الموحدة
export function getProtocol(child = {}) {
  const unitFound = getUnit(child);
  const unit = unitFound || 'mg/dL';                        // للعرض فقط؛ unitMissing تمنع الحسابات
  const limits = getLimits(child, unit);

  const crObj = (child.cr && typeof child.cr === 'object') ? child.cr : {};
  const legacyCR = num(child.carbRatio);
  let crLegacy = false;
  const CR = {};
  MEALS.forEach(m => {
    const v = num(crObj[m]);
    CR[m] = v ?? (legacyCR ?? null);
    if (v === null && legacyCR !== null) crLegacy = true;
  });
  const CF = num(child.cf) ?? num(child.correctionFactor);

  const safety = {
    step: num(child.insulinStep) ?? SAFETY_DEFAULTS.insulinStep,
    maxDose: num(child.maxDose),
    diaHours: num(child.diaHours) ?? SAFETY_DEFAULTS.diaHours,
    hypoCarbs: num(child.hypoCarbs) ?? SAFETY_DEFAULTS.hypoCarbs,
    netCarbRule: child.netCarbRule || SAFETY_DEFAULTS.netCarbRule
  };
  const assumed = [];
  if (!num(child.insulinStep)) assumed.push('insulinStep');
  if (!num(child.diaHours)) assumed.push('diaHours');
  if (!num(child.hypoCarbs)) assumed.push('hypoCarbs');

  const missing = [];            // ينقص ويمنع الحساب
  const warnings = [];           // تنبيه فقط
  if (!unitFound) missing.push('glucoseUnit');
  if (!CF) missing.push('cf');
  if (!limits.target) missing.push('target');
  MEALS.forEach(m => { if (!CR[m]) missing.push('cr.' + m); });
  if (!safety.maxDose) warnings.push('maxDose');
  if (limits.invalid) warnings.push('limitsInvalid');
  if (crLegacy) warnings.push('crLegacy');

  const basalDose = num(child.basalDose) ?? num(child.insulin?.basalDose);
  return {
    unit, unitMissing: !unitFound,
    limits, limitsCustom: limits.isCustom,
    target: limits.target, CF, CR, crLegacy,
    insulin: { basal: child.insulin?.basal ?? child.basalType ?? null, bolus: child.insulin?.bolus ?? child.bolusType ?? null, basalDose },
    safety, assumed,
    weightKg: getWeightKg(child), heightCm: getHeightCm(child),
    missing, warnings
  };
}

export const PARAM_LABELS = {
  glucoseUnit: 'وحدة قياس السكر', cf: 'معامل التصحيح (CF)', target: 'هدف السكر',
  'cr.breakfast': 'نسبة الكارب للفطار', 'cr.lunch': 'نسبة الكارب للغداء', 'cr.dinner': 'نسبة الكارب للعشاء', 'cr.snack': 'نسبة الكارب للسناك',
  maxDose: 'الحد الأقصى للجرعة', insulinStep: 'تدرج الجرعة', diaHours: 'مدة مفعول الأنسولين', hypoCarbs: 'كارب علاج الهبوط'
};
export const labelOf = key => PARAM_LABELS[key] || key;

// الشكل الذي يستخدمه dose-engine.getTherapy (للتوافق مع الصفحات الحالية)
export function toTherapy(p) {
  const step = p.safety.step;
  return {
    unit: p.unit, CF: p.CF, CR: { ...p.CR }, target: p.target,
    limits: { critLow: p.limits.critical_low, low: p.limits.low, high: p.limits.high, critHigh: p.limits.critical_high },
    step, maxDose: p.safety.maxDose, diaHours: p.safety.diaHours, hypoCarbs: p.safety.hypoCarbs, netCarbRule: p.safety.netCarbRule,
    missing: p.missing.filter(k => k === 'cf' || k === 'target' || k === 'glucoseUnit').map(labelOf),
    missingKeys: [...p.missing], warnings: [...p.warnings]
  };
}

// ---------------------------------------------------------------- التحقق والكتابة
const inRange = (v, [a, b]) => v >= a && v <= b;

export function buildProtocolPatch(child = {}, input = {}, opts = {}) {
  const errors = [];
  const flat = {};              // مسارات منقوطة => قيمة (للحقول الأساسية)
  const mirror = {};            // نسخ مرآة (weight / basalDose ...)
  const remove = [];
  const today = opts.today || new Date().toISOString().slice(0, 10);

  const unitIn = input.glucoseUnit;
  const unit = (unitIn !== undefined && !isBlank(unitIn)) ? normalizeUnit(unitIn) : getUnit(child);
  if (unitIn !== undefined && !isBlank(unitIn) && !unit) errors.push('وحدة قياس السكر غير صالحة (mmol/L أو mg/dL).');
  if (unitIn !== undefined && unit && unit !== getUnit(child) && getUnit(child) && opts.allowUnitChange !== true) {
    errors.push('تغيير وحدة السكر يتطلب تحويل معامل التصحيح وحدود السكر (استخدم convertProtocolUnit).');
  }
  if (unit && unitIn !== undefined && !isBlank(unitIn)) flat.glucoseUnit = unit;

  const needUnit = input.cf !== undefined || input.limits !== undefined || input.limitsStandard;
  if (needUnit && !unit) errors.push('حدد وحدة قياس السكر أولاً.');

  // نسب الكارب
  if (input.cr && typeof input.cr === 'object') {
    MEALS.forEach(m => {
      if (input.cr[m] === undefined) return;
      if (isBlank(input.cr[m])) { remove.push('cr.' + m); return; }
      const v = Number(input.cr[m]);
      if (!Number.isFinite(v) || !inRange(v, RANGES.cr)) { errors.push(`نسبة الكارب لـ${MEAL_LABELS[m]} يجب أن تكون بين ${RANGES.cr[0]} و${RANGES.cr[1]} جرام لكل وحدة.`); return; }
      flat['cr.' + m] = v;
    });
  }

  // معامل التصحيح: رقم واحد للطفل. لا نحوّل بين الوحدات تلقائياً (نمنع الخلط بدلاً من التخمين)
  if (input.cf !== undefined) {
    if (isBlank(input.cf)) remove.push('cf');
    else {
      const v = Number(input.cf);
      const rg = unit ? RANGES.cf[unit] : null;
      if (!Number.isFinite(v) || v <= 0) errors.push('معامل التصحيح يجب أن يكون رقماً أكبر من صفر.');
      else if (rg && !inRange(v, rg)) {
        const hint = unit === 'mg/dL' && v < rg[0] ? ' (يبدو أنه بوحدة mmol/L بينما وحدة الطفل mg/dL)'
          : unit === 'mmol/L' && v > rg[1] ? ' (يبدو أنه بوحدة mg/dL بينما وحدة الطفل mmol/L)' : '';
        errors.push(`معامل التصحيح ${v} خارج المدى المعقول لوحدة ${unit} (${rg[0]}–${rg[1]})${hint}.`);
      } else flat.cf = v;
    }
  }

  // حدود السكر
  if (input.limitsStandard) RANGE_KEYS.forEach(k => remove.push('glucose_limits.' + k));
  if (input.limits && typeof input.limits === 'object' && unit) {
    const lr = RANGES.limit[unit];
    [...RANGE_KEYS, 'target'].forEach(k => {
      if (input.limits[k] === undefined) return;
      if (isBlank(input.limits[k])) { remove.push('glucose_limits.' + k); return; }
      const v = Number(input.limits[k]);
      if (!Number.isFinite(v) || !inRange(v, lr)) { errors.push(`قيمة ${k} خارج المدى المعقول لوحدة ${unit} (${lr[0]}–${lr[1]}).`); return; }
      flat['glucose_limits.' + k] = v;
    });
  }
  // نتحقق من ترتيب الحدود النهائية بعد الدمج
  if (unit && (input.limits || input.limitsStandard) && !errors.length) {
    const merged = { ...(child.glucose_limits || {}) };
    remove.filter(p => p.startsWith('glucose_limits.')).forEach(p => delete merged[p.split('.')[1]]);
    Object.keys(flat).filter(p => p.startsWith('glucose_limits.')).forEach(p => { merged[p.split('.')[1]] = flat[p]; });
    const std = STANDARD_LIMITS[unit];
    const f = {}; RANGE_KEYS.forEach(k => { f[k] = num(merged[k]) ?? std[k]; });
    if (!(f.critical_low < f.low && f.low < f.high && f.high < f.critical_high)) {
      errors.push('ترتيب حدود السكر غير منطقي: يجب أن يكون الهبوط الحرج < الهبوط < الارتفاع < الارتفاع الحرج.');
    }
    const t = num(merged.target);
    if (t && !(t > f.low && t < f.high)) errors.push('هدف السكر يجب أن يقع بين حد الهبوط وحد الارتفاع.');
  }

  // بارامترات الأمان
  if (input.insulinStep !== undefined) {
    if (isBlank(input.insulinStep)) remove.push('insulinStep');
    else if (!STEPS.includes(Number(input.insulinStep))) errors.push(`تدرج الجرعة يجب أن يكون من: ${STEPS.join(' / ')}.`);
    else flat.insulinStep = Number(input.insulinStep);
  }
  const step = flat.insulinStep ?? num(child.insulinStep) ?? SAFETY_DEFAULTS.insulinStep;
  if (input.maxDose !== undefined) {
    if (isBlank(input.maxDose)) remove.push('maxDose');
    else {
      const v = Number(input.maxDose);
      if (!Number.isFinite(v) || !inRange(v, RANGES.maxDose)) errors.push(`الحد الأقصى للجرعة يجب أن يكون بين ${RANGES.maxDose[0]} و${RANGES.maxDose[1]} وحدة.`);
      else if (v < step) errors.push('الحد الأقصى للجرعة يجب ألا يقل عن تدرج الجرعة.');
      else flat.maxDose = v;
    }
  }
  [['diaHours', 'مدة مفعول الأنسولين'], ['hypoCarbs', 'كارب علاج الهبوط']].forEach(([k, label]) => {
    if (input[k] === undefined) return;
    if (isBlank(input[k])) { remove.push(k); return; }
    const v = Number(input[k]);
    if (!Number.isFinite(v) || !inRange(v, RANGES[k])) errors.push(`${label} يجب أن يكون بين ${RANGES[k][0]} و${RANGES[k][1]}.`);
    else flat[k] = v;
  });
  if (input.netCarbRule !== undefined) {
    if (isBlank(input.netCarbRule)) remove.push('netCarbRule'); else flat.netCarbRule = String(input.netCarbRule);
  }

  // الأنسولين (النوع) والجرعة القاعدية (تُكتب في الحقلين)
  if (input.insulin && typeof input.insulin === 'object') {
    ['basal', 'bolus'].forEach(k => { if (input.insulin[k] !== undefined) flat['insulin.' + k] = isBlank(input.insulin[k]) ? null : String(input.insulin[k]); });
  }
  if (input.basalDose !== undefined) {
    if (isBlank(input.basalDose)) { remove.push('basalDose'); remove.push('insulin.basalDose'); }
    else {
      const v = Number(input.basalDose);
      if (!Number.isFinite(v) || !inRange(v, RANGES.basalDose)) errors.push(`الجرعة القاعدية يجب أن تكون بين ${RANGES.basalDose[0]} و${RANGES.basalDose[1]} وحدة.`);
      else { flat.basalDose = v; mirror['insulin.basalDose'] = v; }
    }
  }

  // الوزن والطول (الحقلان معاً + مؤشر الكتلة + تاريخ القياس)
  let w = null, h = null;
  if (input.weight !== undefined && !isBlank(input.weight)) {
    w = Number(input.weight);
    if (!Number.isFinite(w) || !inRange(w, RANGES.weight)) { errors.push(`الوزن يجب أن يكون بين ${RANGES.weight[0]} و${RANGES.weight[1]} كجم.`); w = null; }
    else { flat.weight = w; mirror['vitals.weight'] = w; }
  }
  if (input.height !== undefined && !isBlank(input.height)) {
    h = Number(input.height);
    if (!Number.isFinite(h) || !inRange(h, RANGES.height)) { errors.push(`الطول يجب أن يكون بين ${RANGES.height[0]} و${RANGES.height[1]} سم.`); h = null; }
    else { mirror['vitals.height'] = h; if (child.height !== undefined) mirror.height = h; }
  }
  if (w !== null || h !== null) {
    const bw = w ?? getWeightKg(child);
    const bh = h ?? getHeightCm(child);
    if (bw && bh) mirror['vitals.bmi'] = r1(bw / ((bh / 100) ** 2));
    mirror['vitals.measurementDate'] = input.measurementDate || today;
  }

  if (errors.length) return { errors, flat: {}, mirror: {}, remove: [], changes: [] };

  // سجل التغييرات (للحقول الأساسية فقط، بدون النسخ المرآة)
  const changes = [];
  Object.keys(flat).forEach(k => {
    const from = getPath(child, k);
    if (from !== flat[k]) changes.push({ field: k, from: from === undefined ? null : from, to: flat[k] });
  });
  remove.forEach(k => { const from = getPath(child, k); if (from !== undefined) changes.push({ field: k, from, to: null }); });

  return { errors: [], flat, mirror, remove: [...new Set(remove)], changes };
}

// يحوّل النتيجة إلى بيانات لـ updateDoc (مفاتيح منقوطة) أو setDoc مع merge (كائن متداخل)
export function toUpdateData(result, deleteField) {
  const out = {};
  Object.entries({ ...result.flat, ...result.mirror }).forEach(([k, v]) => { out[k] = v; });
  result.remove.forEach(k => { out[k] = deleteField(); });
  return out;
}
export function toMergeData(result, deleteField) {
  const out = {};
  const put = (path, v) => {
    const keys = path.split('.');
    let o = out;
    keys.slice(0, -1).forEach(k => { o[k] = (o[k] && typeof o[k] === 'object' && !o[k].constructor?.name?.startsWith('Delete')) ? o[k] : {}; o = o[k]; });
    o[keys[keys.length - 1]] = v;
  };
  Object.entries({ ...result.flat, ...result.mirror }).forEach(([k, v]) => put(k, v));
  result.remove.forEach(k => put(k, deleteField()));
  return out;
}

// تحويل وحدة السكر: يحوّل معامل التصحيح والحدود المخزّنة المخصصة، ويرجع مدخلاً لـ buildProtocolPatch
export function convertProtocolUnit(child, toUnit) {
  const from = getUnit(child);
  const to = normalizeUnit(toUnit);
  if (!to) return { errors: ['وحدة غير صالحة.'] };
  if (!from || from === to) return { input: { glucoseUnit: to }, opts: { allowUnitChange: true } };
  const conv = v => (to === 'mg/dL' ? Math.round(v * MGDL_PER_MMOL) : r1(v / MGDL_PER_MMOL));
  const input = { glucoseUnit: to, limits: {} };
  const cf = num(child.cf) ?? num(child.correctionFactor);
  if (cf) input.cf = to === 'mg/dL' ? Math.round(cf * MGDL_PER_MMOL) : r1(cf / MGDL_PER_MMOL);
  const gl = child.glucose_limits || {};
  RANGE_KEYS.forEach(k => { if (num(gl[k])) input.limits[k] = conv(gl[k]); });
  if (num(gl.target)) input.limits.target = conv(gl.target);
  // القيم القياسية تتبع الوحدة الجديدة تلقائياً، فنحذف أي حد كان مساوياً للقياسي القديم
  RANGE_KEYS.forEach(k => { if (num(gl[k]) === STANDARD_LIMITS[from][k]) { delete input.limits[k]; } });
  return { input, opts: { allowUnitChange: true } };
}

// ---------------------------------------------------------------- ترحيل البيانات القديمة
// يحسب ما يلزم لتوحيد وثيقة طفل قديمة: ما يُكتب، وما يُحذف، وملاحظات للمراجعة البشرية.
export function canonicalizeChild(child = {}, opts = {}) {
  const set = {};
  const remove = [];
  const notes = [];

  // الوحدة
  const unit = getUnit(child);
  if (unit && normalizeUnit(child.glucoseUnit) !== unit) set.glucoseUnit = unit;
  if (!unit) notes.push('⚠️ لا توجد وحدة لقياس السكر (glucoseUnit)؛ يجب تحديدها يدوياً.');

  // نسب الكارب: نكمل الناقص من carbRatio القديم
  const legacyCR = num(child.carbRatio);
  const crObj = (child.cr && typeof child.cr === 'object') ? child.cr : {};
  if (legacyCR) MEALS.forEach(m => { if (!num(crObj[m])) set['cr.' + m] = legacyCR; });

  // معامل التصحيح
  if (!num(child.cf) && num(child.correctionFactor)) set.cf = num(child.correctionFactor);

  // الجرعة القاعدية: نُبقي القيمة العليا ونكتب نسخة مرآة
  const top = num(child.basalDose), nested = num(child.insulin?.basalDose);
  if (top && nested && top !== nested) notes.push(`⚠️ الجرعة القاعدية مختلفة: basalDose=${top} مقابل insulin.basalDose=${nested}. اعتمدنا ${top}.`);
  const bd = top ?? nested;
  if (bd) { if (top !== bd) set.basalDose = bd; if (nested !== bd) set['insulin.basalDose'] = bd; }
  const lad = num(child.longActingDose?.units);
  if (lad && bd && lad !== bd) notes.push(`ℹ️ longActingDose.units=${lad} (حقل قديم غير مستخدم) يخالف الجرعة المعتمدة ${bd}.`);

  // الوزن
  const wTop = num(child.weight), wV = num(child.vitals?.weight);
  if (wTop && wV && wTop !== wV) notes.push(`⚠️ الوزن مختلف: weight=${wTop} مقابل vitals.weight=${wV}. اعتمدنا vitals.weight=${wV}.`);
  const w = wV ?? wTop;
  if (w) { if (wTop !== w) set.weight = w; if (wV !== w) set['vitals.weight'] = w; }
  const wk = num(child.weightKg);
  if (wk && w && wk !== w) notes.push(`ℹ️ weightKg=${wk} (حقل قديم غير مستخدم) يخالف الوزن المعتمد ${w}.`);

  // حدود السكر: لا نحوّل normalRange تلقائياً (القرار: القيم العالمية مع تخصيص يدوي)
  if (child.normalRange && typeof child.normalRange === 'object') {
    notes.push(`ℹ️ normalRange القديم (${JSON.stringify(child.normalRange)}) لن يُستخدم؛ الحدود الآن من glucose_limits أو القياسية العالمية.`);
  }
  if (!child.glucose_limits?.target) notes.push('⚠️ هدف السكر (glucose_limits.target) غير محدد: لن تُحسب جرعات التصحيح حتى يحدده الطبيب أو ولي الأمر.');
  if (!num(child.cf) && !num(child.correctionFactor)) notes.push('⚠️ معامل التصحيح (cf) غير محدد.');
  if (!MEALS.every(m => num(crObj[m]) || legacyCR)) notes.push('⚠️ نسبة الكارب (cr) ناقصة لبعض الوجبات.');

  // الحقول اليتيمة
  LEGACY_REMOVE_NOW.forEach(k => { if (child[k] !== undefined) remove.push(k); });
  if (opts.final) LEGACY_REMOVE_FINAL.forEach(k => { if (child[k] !== undefined) remove.push(k); });

  return { set, remove: [...new Set(remove)], notes, needed: Object.keys(set).length + remove.length > 0 };
}
