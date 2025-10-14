/* js/meals.js — ES Module */

// 1) Firebase app objects (من ملف التهيئة الخاص بك كموديول)
import { auth, db, storage } from './firebase-config.js';

// 2) Firebase SDK (modular)
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  doc, getDoc, collection, query, where, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { ref as storageRef, getDownloadURL } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

/* ------------------------------------------
    Helpers
------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

function getChildIdFromURL() {
  const p = new URLSearchParams(location.search);
  return p.get('child') || '';
}

function round025(x) {
  return Math.round(x / 0.25) * 0.25;
}

function setValIfExists(sel, val) {
  const el = $(sel);
  if (el) el.value = (val ?? '').toString();
}

function setTextIfExists(sel, txt) {
  const el = $(sel);
  if (el) el.textContent = (txt ?? '').toString();
}

function getNum(sel) {
  const el = $(sel);
  if (!el) return NaN;
  const v = (el.value || '').toString().replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/* ------------------------------------------
    Pickers من وثيقة الطفل (مرنة مع الحقول القديمة)
------------------------------------------ */

function pickCR(child, mealType) {
  const key = ({ breakfast:'cr_breakfast', lunch:'cr_lunch', dinner:'cr_dinner', snack:'cr_snack' })[mealType];
  if (key && child[key]) return Number(child[key]);

  if (child.carbRatio) return Number(child.carbRatio);
  if (child.cr)        return Number(child.cr);
  return NaN;
}

function pickCF(child, mealType) {
  const key = ({ breakfast:'cf_breakfast', lunch:'cf_lunch', dinner:'cf_dinner', snack:'cf_snack' })[mealType];
  if (key && child[key]) return Number(child[key]);

  if (child.correctionFactor) return Number(child.correctionFactor);
  if (child.cf)               return Number(child.cf);
  return NaN;
}

// بداية “الارتفاع” المستخدم في المعادلة (الغالب 7)
function pickHyper(child) {
  if (child.hyper != null)      return Number(child.hyper);
  if (child.hyperLevel != null) return Number(child.hyperLevel);
  return 7;
}

// حد بدء التصحيح (ارتفاع شديد) — عنده نبدأ نحسب
function pickCriticalHigh(child) {
  if (child.criticalHigh != null)      return Number(child.criticalHigh);
  if (child.criticalHighLevel != null) return Number(child.criticalHighLevel);
  return 10.9;
}

// هدف الكارب (min/max) لو موجود
function pickCarbGoal(child, mealType) {
  // احتمالات شائعة: child.carbGoals[mealType] أو child.carbTargets[mealType] وفيها {min,max}
  const paths = [
    child?.carbGoals?.[mealType],
    child?.carbTargets?.[mealType],
  ];
  const obj = paths.find(Boolean) || {};
  let min = Number(obj.min);
  let max = Number(obj.max);
  if (!Number.isFinite(min)) min = NaN;
  if (!Number.isFinite(max)) max = NaN;
  return { min, max };
}

/* ------------------------------------------
    الحسابات
------------------------------------------ */

function computeCorrectionDose(before, hyper, crit, CF) {
  if (!Number.isFinite(before) || !Number.isFinite(hyper) || !Number.isFinite(CF)) return 0;
  if (before < crit) return 0; // يبدأ التصحيح من 10.9 فأعلى
  const raw = (before - hyper) / CF;
  return Math.max(0, round025(raw));
}

function computeCarbDose(totalCarbs, CR) {
  if (!Number.isFinite(totalCarbs) || !Number.isFinite(CR) || CR <= 0) return 0;
  return round025(totalCarbs / CR);
}

function currentMealType() {
  const el = $('#mealType');
  const v = el ? el.value : 'breakfast';
  return (['breakfast','lunch','dinner','snack'].includes(v) ? v : 'breakfast');
}

// إجمالي الكارب الحالي — مرن
function readTotalCarbs() {
  // لو الفوتر يحسب الإجمالي (كما في صف tCarbs)
  const t = $('#tCarbs');
  if (t) {
    const n = Number((t.textContent || '0').toString().replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  // وإلا نحاول من عناصر عليها data-carbs أو خلايا
  let sum = 0;
  document.querySelectorAll('[data-carbs], .js-item-carbs').forEach((el) => {
    const num = Number((el.dataset?.carbs || el.value || el.textContent || '0').toString().replace(',', '.'));
    if (Number.isFinite(num)) sum += num;
  });
  return sum;
}

/* ------------------------------------------
   initPage
------------------------------------------ */

async function initPage(user) {
  const parentId = user.uid;
  const childId = getChildIdFromURL();
  if (!childId) {
    console.warn('No child param in URL.');
    return;
  }

  // جلب بيانات الطفل
  const childRef = doc(db, `parents/${parentId}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()) {
    console.warn('Child doc not found');
    return;
  }
  const child = snap.data() || {};

  // عرض أعلى الصفحة
  setTextIfExists('#childName', child.name || '');
  setTextIfExists('#headCR',      pickCR(child, currentMealType()) || child.carbRatio || child.cr || '—');
  setTextIfExists('#headCF',      pickCF(child, currentMealType()) || child.correctionFactor || child.cf || '—');
  setTextIfExists('#headHyper',   pickHyper(child));
  setTextIfExists('#headCritHigh',pickCriticalHigh(child));
  setTextIfExists('#hyperMini',   pickHyper(child));
  setTextIfExists('#critHighMini',pickCriticalHigh(child));

  // هدف الكارب (لو موجود)
  const goal = pickCarbGoal(child, currentMealType());
  if (Number.isFinite(goal.min)) setTextIfExists('#carbMin', goal.min);
  if (Number.isFinite(goal.max)) setTextIfExists('#carbMax', goal.max);

  // إعادة الحساب
  const recompute = () => {
    const mealType = currentMealType();

    const before  = getNum('#glucoseBefore');
    const totalC  = readTotalCarbs();

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

    setTextIfExists('#carbNow', totalC);

    // شريط الكارب
    const min = Number($('#carbMin')?.textContent || NaN);
    const max = Number($('#carbMax')?.textContent || NaN);
    const bar = $('#carbBar');
    if (bar && Number.isFinite(min) && Number.isFinite(max) && max > min) {
      const pct = Math.max(0, Math.min(100, ((totalC - min) / (max - min)) * 100));
      bar.style.width = `${pct}%`;
    }

    setTextIfExists('#calcNote', `CR=${CR || '-'} • CF=${CF || '-'} • hyper=${hyper} • crit=${crit} • carbs=${totalC}`);
  };

  // ربط الأحداث
  ['#glucoseBefore', '#glucoseAfter', '#mealType'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('input',  recompute);
    if (el) el.addEventListener('change', recompute);
  });

  // أي تغيّر في الجدول يعيد الحساب
  const table = $('#itemsTable') || document;
  table.addEventListener('input',  recompute, { capture:true });
  table.addEventListener('change', recompute, { capture:true });

  // بداية
  recompute();

  // أزرار بسيطة
  $('#btnBack')?.addEventListener('click', () => history.back());
  $('#btnReset')?.addEventListener('click', () => {
    ['#glucoseBefore','#glucoseAfter','#doseCorrection','#doseCarb','#doseTotal','#notes'].forEach(s => setValIfExists(s,''));
    recompute();
  });
}

/* ------------------------------------------
   تشغيل بعد تسجيل الدخول
------------------------------------------ */

onAuthStateChanged(auth, (user) => {
  if (!user) {
    console.warn('User not signed in');
    // window.location.href = 'login.html';
    return;
  }
  initPage(user).catch(console.error);
});

// لتصحيح يدوي من الكونسول
window._dbg = { auth, db, storage };
