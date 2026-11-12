// اختبارات وحدة البروتوكول العلاجي (child-protocol.js)
// التشغيل:  node tests/protocol.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// نستورد الوحدة عبر data: URL لتعمل على أي إصدار Node دون إعداد package.json
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'child-protocol.js'), 'utf8');
const P = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('✗', name, '\n ', e.message); process.exitCode = 1; } };

// شكل وثيقة الطفل الحقيقية كما ظهرت في Firestore (حقول حيّة + حقول يتيمة متضاربة)
const realChild = () => ({
  name: 'أسيل', glucoseUnit: 'mmol/L', unit: 'mmol/L', unitType: 'mmol/L',
  cr: { breakfast: 11, lunch: 10, dinner: 12, snack: 12 }, carbRatio: 10,
  carbRatioByMeal: { b: 11, d: 12, l: 10, s: 12 },
  cf: 3, correctionFactor: 3, correctionFactorByMeal: { b: 3, d: 3, l: 3, s: 3 },
  cf_breakfast: 3, cf_dinner: 3, cf_lunch: 3, cf_snack: 3,
  basalDose: 18, insulin: { basal: 'تريسيبا', bolus: 'نوفو', basalDose: 18 },
  longActingDose: { insulin: 'تريسيبا', time: null, units: 15 },
  maxDose: 20, insulinStep: 1, hypoCarbs: 15, hypoLevel: 3.9,
  glucose_limits: { critical_low: 3, low: 3.9, high: 10.1, critical_high: 14.1, target: 5.5 },
  normalRange: { criticalHigh: 14.1, criticalLow: 3.9, max: 7, min: 3.9, severeHigh: 10.9, severeLow: 3.9 },
  severeHigh: 14.1, severeHighLevel: 10.9, severeLow: 3.9, severeLowLevel: 3.9,
  weight: 43.25, weightKg: 37.6, vitals: { bmi: 21.2, height: 143, measurementDate: '2026-04-01', weight: 43.25 },
  carbGoals: { b: [48, 60], d: [48, 60], l: [95, 120], s: [24, 48] },
  carbTargets: { breakfast: { min: 48, max: 60 }, lunch: { min: 95, max: 120 } },
  mealsDoses: { name: null, netCarbRule: null }, netCarbRule: 'none', useNetCarbs: false
});

// ───────────── القراءة ─────────────
t('الوحدة: تطبيع الصيغ المختلفة وعدم التخمين', () => {
  assert.equal(P.normalizeUnit('MMOL/L'), 'mmol/L'); assert.equal(P.normalizeUnit(' mg/dl '), 'mg/dL');
  assert.equal(P.normalizeUnit('x'), null); assert.equal(P.getUnit({}), null);
  assert.equal(P.getUnit({ unit: 'mmol/L' }), 'mmol/L');           // حقل قديم كاحتياط
  assert.equal(P.getUnit({ glucoseUnit: 'mg/dL', unit: 'mmol/L' }), 'mg/dL');   // glucoseUnit أولاً
});

t('الوثيقة الحقيقية: بروتوكول سليم ونطاق مخصّص (10.1)', () => {
  const p = P.getProtocol(realChild());
  assert.equal(p.unit, 'mmol/L'); assert.equal(p.unitMissing, false);
  assert.equal(p.CF, 3); assert.deepEqual(p.CR, { breakfast: 11, lunch: 10, dinner: 12, snack: 12 });
  assert.equal(p.limitsCustom, true); assert.equal(p.limits.high, 10.1); assert.equal(p.limits.low, 3.9);
  assert.equal(p.target, 5.5); assert.equal(p.safety.maxDose, 20); assert.equal(p.safety.step, 1);
  assert.deepEqual(p.missing, []); assert.deepEqual(p.assumed, ['diaHours']);
  assert.equal(p.weightKg, 43.25); assert.equal(p.insulin.basalDose, 18);
});

t('الحدود القياسية العالمية عند عدم التخصيص (لكل وحدة)', () => {
  const mm = P.getProtocol({ glucoseUnit: 'mmol/L' }).limits;
  assert.deepEqual([mm.critical_low, mm.low, mm.high, mm.critical_high], [3.0, 3.9, 10.0, 13.9]);
  const mg = P.getProtocol({ glucoseUnit: 'mg/dL' }).limits;
  assert.deepEqual([mg.critical_low, mg.low, mg.high, mg.critical_high], [54, 70, 180, 250]);
  assert.equal(P.getProtocol({ glucoseUnit: 'mg/dL' }).limitsCustom, false);
  // قيمة مخزّنة تساوي القياسي لا تُعدّ تخصيصاً
  assert.equal(P.getProtocol({ glucoseUnit: 'mg/dL', glucose_limits: { low: 70, high: 180 } }).limitsCustom, false);
});

t('طفل بلا إعدادات: كل ما يمنع الحساب مذكور، ولا قيم جرعات مخمّنة', () => {
  const p = P.getProtocol({});
  assert.equal(p.unitMissing, true); assert.equal(p.CF, null); assert.equal(p.target, null);
  assert.deepEqual(p.missing, ['glucoseUnit', 'cf', 'target', 'cr.breakfast', 'cr.lunch', 'cr.dinner', 'cr.snack']);
  assert.ok(p.warnings.includes('maxDose'));
});

t('نسبة الكارب القديمة (carbRatio) تُستخدم كاحتياط وتُنبّه', () => {
  const p = P.getProtocol({ glucoseUnit: 'mmol/L', carbRatio: 12, cf: 3, glucose_limits: { target: 6 } });
  assert.deepEqual(p.CR, { breakfast: 12, lunch: 12, dinner: 12, snack: 12 }); assert.equal(p.crLegacy, true);
  assert.ok(p.warnings.includes('crLegacy')); assert.deepEqual(p.missing, []);
  assert.equal(P.getProtocol({ glucoseUnit: 'mmol/L', carbRatio: 12, cr: { lunch: 9 } }).CR.lunch, 9);   // الأحدث أولاً
});

t('حدود بترتيب غير منطقي: نرجع للقياسي ونُنبّه', () => {
  const p = P.getProtocol({ glucoseUnit: 'mmol/L', glucose_limits: { low: 12, high: 10 } });
  assert.equal(p.limits.low, 3.9); assert.equal(p.limits.high, 10.0); assert.ok(p.warnings.includes('limitsInvalid'));
});

t('الوزن: vitals ثم weight', () => {
  assert.equal(P.getWeightKg({ vitals: { weight: 40 }, weight: 50 }), 40);
  assert.equal(P.getWeightKg({ weight: 50 }), 50); assert.equal(P.getWeightKg({}), null);
});

t('توافق مع dose-engine.getTherapy', () => {
  const th = P.toTherapy(P.getProtocol(realChild()));
  assert.deepEqual(th.limits, { critLow: 3, low: 3.9, high: 10.1, critHigh: 14.1 });
  assert.equal(th.CF, 3); assert.equal(th.CR.lunch, 10); assert.equal(th.step, 1); assert.equal(th.maxDose, 20);
  assert.deepEqual(th.missing, []);
  assert.deepEqual(P.toTherapy(P.getProtocol({ glucoseUnit: 'mg/dL' })).missing, ['معامل التصحيح (CF)', 'هدف السكر']);
});

// ───────────── التحقق والكتابة ─────────────
t('معامل التصحيح: منع الخلط بين الوحدات (بدون تحويل صامت)', () => {
  let r = P.buildProtocolPatch({ glucoseUnit: 'mg/dL' }, { cf: 3 });
  assert.equal(r.errors.length, 1); assert.match(r.errors[0], /يبدو أنه بوحدة mmol\/L/);
  r = P.buildProtocolPatch({ glucoseUnit: 'mmol/L' }, { cf: 54 });
  assert.match(r.errors[0], /يبدو أنه بوحدة mg\/dL/);
  assert.deepEqual(P.buildProtocolPatch({ glucoseUnit: 'mmol/L' }, { cf: 3 }).flat, { cf: 3 });
  assert.deepEqual(P.buildProtocolPatch({ glucoseUnit: 'mg/dL' }, { cf: 54 }).flat, { cf: 54 });
  assert.ok(P.buildProtocolPatch({}, { cf: 3 }).errors[0].includes('وحدة'));      // لا وحدة، لا كتابة
});

t('نسب الكارب والبارامترات: نطاقات معقولة', () => {
  assert.equal(P.buildProtocolPatch({}, { cr: { lunch: 0 } }).errors.length, 1);
  assert.equal(P.buildProtocolPatch({}, { cr: { lunch: 500 } }).errors.length, 1);
  assert.deepEqual(P.buildProtocolPatch({}, { cr: { lunch: '12' } }).flat, { 'cr.lunch': 12 });
  assert.equal(P.buildProtocolPatch({}, { insulinStep: 0.3 }).errors.length, 1);
  assert.equal(P.buildProtocolPatch({ insulinStep: 1 }, { maxDose: 0.5 }).errors.length, 1);   // أقل من التدرج
  assert.equal(P.buildProtocolPatch({}, { maxDose: 500 }).errors.length, 1);
  assert.deepEqual(P.buildProtocolPatch({}, { maxDose: 15, hypoCarbs: 15, diaHours: 4 }).flat, { maxDose: 15, hypoCarbs: 15, diaHours: 4 });
  assert.equal(P.buildProtocolPatch({}, { diaHours: 12 }).errors.length, 1);
});

t('حدود السكر: ترتيب منطقي وهدف داخل النطاق', () => {
  const c = { glucoseUnit: 'mmol/L' };
  assert.equal(P.buildProtocolPatch(c, { limits: { low: 12 } }).errors.length, 1);          // low > high(10 قياسي)
  assert.equal(P.buildProtocolPatch(c, { limits: { target: 12 } }).errors.length, 1);       // الهدف خارج النطاق
  assert.equal(P.buildProtocolPatch(c, { limits: { target: 3 } }).errors.length, 1);
  assert.deepEqual(P.buildProtocolPatch(c, { limits: { target: 6, high: 10.5 } }).flat, { 'glucose_limits.target': 6, 'glucose_limits.high': 10.5 });
  assert.equal(P.buildProtocolPatch({ glucoseUnit: 'mg/dL' }, { limits: { low: 3 } }).errors.length, 1);   // قيمة بوحدة خاطئة
  const r = P.buildProtocolPatch(realChild(), { limitsStandard: true });
  assert.deepEqual(r.remove.sort(), ['glucose_limits.critical_high', 'glucose_limits.critical_low', 'glucose_limits.high', 'glucose_limits.low']);
});

t('تعديل الطبيب الجزئي: مفاتيح منقوطة لا تمسح باقي الحقول', () => {
  const r = P.buildProtocolPatch(realChild(), { cf: 2.8, cr: { breakfast: 13 }, limits: { target: 6 } });
  assert.deepEqual(r.errors, []);
  const up = P.toUpdateData(r, () => 'DEL');
  assert.deepEqual(up, { cf: 2.8, 'cr.breakfast': 13, 'glucose_limits.target': 6 });
  assert.deepEqual(r.changes.map(c => [c.field, c.from, c.to]).sort(), [['cf', 3, 2.8], ['cr.breakfast', 11, 13], ['glucose_limits.target', 5.5, 6]]);
});

t('الكتابة بدمج (setDoc merge): كائن متداخل وحذف داخلي', () => {
  const r = P.buildProtocolPatch(realChild(), { cf: 2.8, cr: { lunch: 9 }, maxDose: '', limitsStandard: true });
  const m = P.toMergeData(r, () => 'DEL');
  assert.equal(m.cf, 2.8); assert.deepEqual(m.cr, { lunch: 9 }); assert.equal(m.maxDose, 'DEL');
  assert.deepEqual(m.glucose_limits, { critical_low: 'DEL', low: 'DEL', high: 'DEL', critical_high: 'DEL' });
});

t('الوزن والجرعة القاعدية: نسخة مرآة في الحقلين + BMI وتاريخ القياس', () => {
  const r = P.buildProtocolPatch(realChild(), { weight: 45, basalDose: 19 }, { today: '2026-11-12' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.flat.weight, 45); assert.equal(r.mirror['vitals.weight'], 45);
  assert.equal(r.flat.basalDose, 19); assert.equal(r.mirror['insulin.basalDose'], 19);
  assert.equal(r.mirror['vitals.bmi'], 22.0); assert.equal(r.mirror['vitals.measurementDate'], '2026-11-12');
  const up = P.toUpdateData(r, () => 'DEL');
  assert.equal(up['vitals.weight'], 45); assert.equal(up.weight, 45); assert.equal(up['insulin.basalDose'], 19);
  assert.ok(P.buildProtocolPatch({}, { weight: 500 }).errors.length === 1);
});

t('مسح قيمة اختيارية (مثل الحد الأقصى) يُنتج حذفاً', () => {
  const r = P.buildProtocolPatch(realChild(), { maxDose: null });
  assert.deepEqual(r.remove, ['maxDose']); assert.equal(P.toUpdateData(r, () => 'DEL').maxDose, 'DEL');
});

t('تغيير الوحدة مباشرة ممنوع، ويتم عبر convertProtocolUnit', () => {
  assert.match(P.buildProtocolPatch(realChild(), { glucoseUnit: 'mg/dL' }).errors[0], /convertProtocolUnit/);
  const { input, opts } = P.convertProtocolUnit(realChild(), 'mg/dL');
  assert.equal(input.glucoseUnit, 'mg/dL'); assert.equal(input.cf, 54);                    // 3 × 18.018
  assert.equal(input.limits.high, 182); assert.equal(input.limits.target, 99);             // 10.1، 5.5
  assert.equal(input.limits.low, undefined);                                               // 3.9 كان القياسي القديم: يتبع القياسي الجديد
  const r = P.buildProtocolPatch(realChild(), input, opts);
  assert.deepEqual(r.errors, []);
  assert.equal(r.flat.glucoseUnit, 'mg/dL');
});

// ───────────── ترحيل البيانات القديمة ─────────────
t('الترحيل: الوثيقة الحقيقية تُنظَّف ويُبلَّغ عن التضارب', () => {
  const plan = P.canonicalizeChild(realChild());
  assert.deepEqual(plan.set, {});                                    // الحقول الحيّة متطابقة
  assert.deepEqual(plan.remove.sort(), ['carbGoals', 'carbRatioByMeal', 'carbTargets', 'cf_breakfast', 'cf_dinner', 'cf_lunch', 'cf_snack',
    'correctionFactorByMeal', 'longActingDose', 'mealsDoses', 'severeHigh', 'severeHighLevel', 'severeLow', 'severeLowLevel', 'unitType', 'weightKg'].sort());
  assert.ok(plan.notes.some(n => n.includes('longActingDose.units=15') && n.includes('18')));
  assert.ok(plan.notes.some(n => n.includes('weightKg=37.6') && n.includes('43.25')));
  assert.ok(plan.notes.some(n => n.includes('normalRange')));
  assert.equal(plan.needed, true);
});

t('الترحيل النهائي يحذف الاحتياطيات القديمة أيضاً', () => {
  const plan = P.canonicalizeChild(realChild(), { final: true });
  ['carbRatio', 'correctionFactor', 'normalRange', 'unit'].forEach(k => assert.ok(plan.remove.includes(k), k));
});

t('الترحيل: تعبئة الناقص من الحقول القديمة وتوحيد المتضارب', () => {
  const plan = P.canonicalizeChild({ unit: 'mg/dL', carbRatio: 15, cr: { lunch: 12 }, correctionFactor: 50, basalDose: 20, insulin: { basalDose: 18 }, weight: 30, vitals: { weight: 32 } });
  assert.equal(plan.set.glucoseUnit, 'mg/dL');
  assert.deepEqual([plan.set['cr.breakfast'], plan.set['cr.dinner'], plan.set['cr.snack'], plan.set['cr.lunch']], [15, 15, 15, undefined]);
  assert.equal(plan.set.cf, 50);
  assert.equal(plan.set['insulin.basalDose'], 20);              // نعتمد basalDose العلوي
  assert.equal(plan.set.weight, 32);                            // نعتمد vitals.weight
  assert.ok(plan.notes.some(n => n.includes('الجرعة القاعدية مختلفة')) && plan.notes.some(n => n.includes('الوزن مختلف')));
  assert.ok(plan.notes.some(n => n.includes('هدف السكر')));
});

t('وثيقة بلا وحدة: تنبيه صريح', () => {
  assert.ok(P.canonicalizeChild({}).notes[0].includes('glucoseUnit'));
});

console.log(process.exitCode ? '\nفشلت بعض الاختبارات ✗' : `\nكل اختبارات البروتوكول نجحت ✅ (${passed})`);
