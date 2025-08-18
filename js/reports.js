// js/reports.js  (إصدار v2)  — يملّي رأس التقرير + يفعّل زر التحليل

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// عناصر واجهة
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');
const openAnalyticsBtn = document.getElementById('openAnalytics');

// أدوات
const pad = n => String(n).padStart(2,'0');
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

// childId من الـ URL أو من localStorage
const params  = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

onAuthStateChanged(auth, async (user) => {
  if (!user) return location.href = 'index.html';

  if (!childId) {
    alert('لا يوجد معرف طفل');
    // رجّعي المستخدم لاختيار طفل
    location.href = 'parent.html?pickChild=1';
    return;
  }
  // خزِّنيه كآخر طفل
  localStorage.setItem('lastChildId', childId);

  // حمّلي بيانات الطفل علشان تظهري اسمه والحدود
  try {
    const ref  = doc(db, `parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      alert('لم يتم العثور على الطفل');
      return;
    }
    const c = snap.data();

    // تعبئة الرأس
    if (childNameEl) childNameEl.textContent = c.name || 'طفل';
    if (childMetaEl) childMetaEl.textContent =
      `${c.gender || '—'} • العمر: ${calcAge(c.birthDate)} سنة`;

    const min = Number(c.normalRange?.min ?? 4);
    const max = Number(c.normalRange?.max ?? 7);
    const cr  = c.carbRatio != null ? Number(c.carbRatio) : null;
    const cf  = c.correctionFactor != null ? Number(c.correctionFactor) : null;

    if (chipRangeEl) chipRangeEl.textContent = `النطاق: ${min}–${max} mmol/L`;
    if (chipCREl)    chipCREl.textContent    = `CR: ${cr ?? '—'} g/U`;
    if (chipCFEl)    chipCFEl.textContent    = `CF: ${cf ?? '—'} mmol/L/U`;

  } catch (e) {
    console.error(e);
    alert('تعذر تحميل بيانات الطفل');
  }

  // فعِّل زر "تحليل القياسات" — يفتح analytics.html لنفس الطفل
  if (openAnalyticsBtn) {
    // لو هو <a> هنحط href، لو <button> هنستخدم click
    if (openAnalyticsBtn.tagName === 'A') {
      openAnalyticsBtn.href = `analytics.html?child=${encodeURIComponent(childId)}&range=14d`;
    } else {
      openAnalyticsBtn.addEventListener('click', () => {
        location.href = `analytics.html?child=${encodeURIComponent(childId)}&range=14d`;
      });
    }
  }
});
