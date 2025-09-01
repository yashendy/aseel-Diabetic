/* admin.js — تحكم التابات + فتح تبويب "الأصناف" افتراضيًا
   يدعم روابط:  .../admin.html#foods  أو  .../admin.html?tab=foods
   لا يغيّر أي منطق داخلي عندك؛ فقط يُظهر/يخفي الأقسام ويضبط الحالة النشطة.
*/

(function () {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const btns = $$('.tab-btn');
  const tabs = {
    requests: $('#tab-requests'),
    links:    $('#tab-links'),
    foods:    $('#tab-foods')
  };

  // تفعيل تبويب معيّن
  function activate(tabName, pushHash = true) {
    if (!tabs[tabName]) tabName = 'foods'; // ضمان وجود تبويب صحيح

    // تبديل الأزرار
    btns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));

    // إظهار/إخفاء الأقسام
    Object.entries(tabs).forEach(([k, el]) => el.classList.toggle('active', k === tabName));

    // تحديت الرابط (اختياري)
    if (pushHash) {
      // نخلي الهاش مُحدّثًا؛ ده بيسمح بدخول مباشر لاحقًا
      history.replaceState(null, '', `#${tabName}`);
    }

    // ⚠️ نقطة وصل: لو عندك منطق تحميل لكل تبويب، استدعيه هنا بأسمائه الحالية
    // مثال:
    // if (tabName === 'foods' && window.foods && typeof window.foods.load === 'function') {
    //   window.foods.load(); // لن نغيّر أي شيء في الأساس، مجرد مكان نداء إن وجد
    // }
  }

  // قراءة الحالة من الرابط
  function getInitialTab() {
    // 1) ?tab=... أولويته أعلى
    const q = new URLSearchParams(location.search);
    const t1 = (q.get('tab') || '').toLowerCase();
    if (t1 && tabs[t1]) return t1;

    // 2) #hash
    const t2 = (location.hash.replace('#', '') || '').toLowerCase();
    if (t2 && tabs[t2]) return t2;

    // 3) الافتراضي: الأصناف
    return 'foods';
  }

  // إعداد الأحداث
  btns.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.tab));
  });

  // عند أول فتح للصفحة: فعّل التبويب المطلوب
  document.addEventListener('DOMContentLoaded', () => {
    const initial = getInitialTab();
    activate(initial, /* pushHash */ false);
  });

  // لو المستخدم غيّر الهاش يدويًا (رجوع/تقدم)، حدّث العرض
  window.addEventListener('hashchange', () => {
    const h = (location.hash.replace('#', '') || '').toLowerCase();
    if (h && tabs[h]) activate(h, /* pushHash */ false);
  });
})();
