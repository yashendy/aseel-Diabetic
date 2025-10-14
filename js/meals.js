/* js/meals.js  — Module */

// 1) Firebase app objects (من ملف التهيئة الخاص بك كموديول)
import { auth, db, storage } from './firebase-config.js';

// 2) Firebase SDK (modular)
import {
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

import {
  doc, getDoc, collection, query, where, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

import {
  ref as storageRef, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

/* ------------------------------------------
    Helpers
------------------------------------------ */

// قراءة باراميتر child من الـ URL
function getChildIdFromURL() {
  const p = new URLSearchParams(window.location.search);
  return p.get('child') || '';
}

// أداة جلب عنصر بأمان
const $ = (sel) => document.querySelector(sel);

// تقريب لأقرب 0.25
function round025(x) {
  return Math.round(x / 0.25) * 0.25;
}

// وضع قيمة في input لو موجود
function setValIfExists(sel, val) {
  const el = $(sel);
  if (el) el.value = (val ?? '').toString();
}

// وضع نص داخل عنصر لو موجود
function setTextIfExists(sel, txt) {
  const el = $(sel);
  if (el) el.textContent = (txt ?? '').toString();
}

// قراءة رقم من input
function getNum(sel) {
  const el = $(sel);
  if (!el) return NaN;
  const v = (el.value || '').toString().replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* ------------------------------------------
    تحميل بيانات الطفل + الحسابات
------------------------------------------ */

// محاولة استخراج CR/CF للوجبة من حقول متعددة مع بدائل
function pickCR(child, mealType) {
  // حقول محتملة: cr_breakfast / cr_lunch / cr_dinner / cr_snack
  const key = ({
    breakfast: 'cr_breakfast',
    lunch:     'cr_lunch',
    dinner:    'cr_dinner',
    snack:     'cr_snack'
  })[mealType];

  if (key && child[key]) return Number(child[key]);

  // بدائل شائعة في ملفات قديمة
  if (child.carbRatio) return Number(child.carbRatio);
  if (child.cr)        return Number(child.cr);

  return NaN;
}

function pickCF(child, mealType) {
  const key = ({
    breakfast: 'cf_breakfast',
    lunch:     'cf_lunch',
    dinner:    'cf_dinner',
    snack:     'cf_snack'
  })[mealType];

  if (key && child[key]) return Number(child[key]);

  // بدائل شائعة
  if (child.correctionFactor) return Number(child.correctionFactor);
  if (child.cf)               return Number(child.cf);

  return NaN;
}

function pickHyper(child) {
  // ارتفاع طبيعي (بداية التصحيح)
  // حقول محتملة: hyper / hyperLevel
  if (child.hyper != null)      return Number(child.hyper);
  if (child.hyperLevel != null) return Number(child.hyperLevel);
  // fallback
  return 7; // افتراضي
}

function pickCriticalHigh(child) {
  // بداية “ارتفاع شديد” لبدء التصحيح
  // حقول محتملة: criticalHigh / criticalHighLevel
  if (child.criticalHigh != null)      return Number(child.criticalHigh);
  if (child.criticalHighLevel != null) return Number(child.criticalHighLevel);
  // fallback
  return 10.9;
}

// حساب جرعة التصحيح: ((القياس - hyper) / CF) إن كان القياس > criticalHigh
function computeCorrectionDose(before, hyper, criticalHigh, CF) {
  if (!Number.isFinite(before) || !Number.isFinite(hyper) || !Number.isFinite(CF)) return 0;
  if (before <= criticalHigh) return 0;
  const raw = (before - hyper) / CF;
  return Math.max(0, round025(raw));
}

// حساب جرعة الكارب: totalCarbs / CR
function computeCarbDose(totalCarbs, CR) {
  if (!Number.isFinite(totalCarbs) || !Number.isFinite(CR) || CR <= 0) return 0;
  return round025(totalCarbs / CR);
}

/* ------------------------------------------
    قراءة واجهة الصفحة (IDs مرنة)
------------------------------------------ */

function currentMealType() {
  // توقّع وجود select#mealType بقيم: breakfast|lunch|dinner|snack
  const el = $('#mealType');
  const v = el ? el.value : 'breakfast';
  return (['breakfast', 'lunch', 'dinner', 'snack'].includes(v) ? v : 'breakfast');
}

// تجميع الكارب الكلي من جدول العناصر (مرن: يدور على أي صفوف عندها data-carbs أو حقول .js-item-carbs)
function readTotalCarbsFromTable() {
  // لو عندك حقل مجموع ثابت #totalCarbsField استعمله
  const sumField = $('#totalCarbsField');
  if (sumField) {
    const n = Number((sumField.value || sumField.textContent || '0').toString().replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }

  // وإلا اجمع من الصفوف
  let sum = 0;
  document.querySelectorAll('[data-carbs], .js-item-carbs').forEach((el) => {
    const n = Number((el.dataset?.carbs || el.value || el.textContent || '0').toString().replace(',', '.'));
    if (Number.isFinite(n)) sum += n;
  });
  return sum;
}

/* ------------------------------------------
    التهيئة الرئيسية
------------------------------------------ */

async function initPage(user) {
  const parentId = user.uid;
  const childId  = getChildIdFromURL();

  if (!childId) {
    console.warn('No child param in URL.');
    return;
  }

  // جلب بيانات الطفل
  const childRef = doc(db, `parents/${parentId}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()) {
    console.warn('Child doc not found.');
    return;
  }

  const child = snap.data() || {};

  // عرض بيانات أعلى الصفحة إن وُجدت عناصر
  setTextIfExists('#childName', child.name || '');
  setTextIfExists('#badgeCR',   pickCR(child, currentMealType()) || child.carbRatio || child.cr || '');
  setTextIfExists('#badgeCF',   pickCF(child, currentMealType()) || child.correctionFactor || child.cf || '');
  setTextIfExists('#badgeHyper', pickHyper(child));
  setTextIfExists('#badgeCrit',  pickCriticalHigh(child));

  // حدث إعادة الحساب
  const recompute = () => {
    const mealType = currentMealType();

    const before  = getNum('#readingBefore');
    const totalC  = readTotalCarbsFromTable();

    const CR   = pickCR(child, mealType);
    const CF   = pickCF(child, mealType);
    const hyper= pickHyper(child);
    const crit = pickCriticalHigh(child);

    const doseCorr = computeCorrectionDose(before, hyper, crit, CF);
    const doseCarb = computeCarbDose(totalC, CR);
    const doseAll  = round025(doseCorr + doseCarb);

    setValIfExists('#doseCorrection', doseCorr);
    setValIfExists('#doseCarb',       doseCarb);
    setValIfExists('#doseTotal',      doseAll);

    // نص توضيحي صغير (اختياري)
    setTextIfExists('#calcNote',
      `CR=${CR || '-'} • CF=${CF || '-'} • hyper=${hyper} • crit=${crit} • carbs=${totalC}`
    );
  };

  // اربطي الأحداث الشائعة
  ['#readingBefore', '#readingAfter', '#mealType'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('input', recompute);
    if (el) el.addEventListener('change', recompute);
  });

  // لو عندك أزرار/حقول تضيف عناصر وتغير الكارب، اعملي مراقبة عامة:
  const table = $('#itemsTable') || document;
  table.addEventListener('input',  recompute, { capture: true });
  table.addEventListener('change', recompute, { capture: true });

  // أول حساب
  recompute();
}

/* ------------------------------------------
    تشغيل التهيئة بعد تسجيل الدخول
------------------------------------------ */

onAuthStateChanged(auth, (user) => {
  if (!user) {
    console.warn('User not signed in — redirect to login if needed.');
    // window.location.href = 'login.html';
    return;
  }
  initPage(user).catch(console.error);
});

// توفُّر كائنات للتصحيح من الكونسول
window._dbg = { auth, db, storage };
