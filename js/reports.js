// js/reports.js  v3
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

// أدوات مساعدة
const pad = n => String(n).padStart(2,'0');
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

// childId من URL أو من localStorage
const params  = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

console.log('[reports] childId =', childId);

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = 'index.html'; return; }
  if (!childId) {
    alert('لا يوجد معرف طفل'); location.href = 'parent.html?pickChild=1'; return;
  }

  // خزّنه كآخر طفل
  localStorage.setItem('lastChildId', childId);

  try {
    const ref  = doc(db, `parents/${user.uid}/children/${childId}`);
    console.log('[reports] fetching:', ref.path);
    const snap = await getDoc(ref);
    console.log('[reports] snap.exists:', snap.exists());

    if (!snap.exists()) {
      // محاولة أخيرة لإظهار الاسم من التخزين إن كان محفوظ
      const cachedName = localStorage.getItem('lastChildName');
      if (cachedName && childNameEl) childNameEl.textContent = cachedName;
      alert('لم يتم العثور على الطفل'); 
      return;
    }

    const c = snap.data();
    console.log('[reports] child data:', c);

    // عرّضي الاسم والبيانات
    if (childNameEl) {
      childNameEl.textContent = c.name || 'طفل';
      // خزن الاسم احتياطيًا لاستخدامه لو فشل التحميل لاحقًا
      localStorage.setItem('lastChildName', c.name || 'طفل');
    }
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
    console.error('[reports] child load error:', e);
    alert('تعذر تحميل بيانات الطفل');
  }

  // زر "تحليل القياسات"
  if (openAnalyticsBtn) {
    if (openAnalyticsBtn.tagName === 'A') {
      openAnalyticsBtn.href =
        `analytics.html?child=${encodeURIComponent(childId)}&range=14d`;
    } else {
      openAnalyticsBtn.addEventListener('click', () => {
        location.href =
          `analytics.html?child=${encodeURIComponent(childId)}&range=14d`;
      });
    }
  }
});
