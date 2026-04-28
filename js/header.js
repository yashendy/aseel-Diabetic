// js/header.js — الهيدر الموحد لمنصة أسيل
// الاستخدام: أضف في أي صفحة:
//   <link rel="stylesheet" href="css/header.css">
//   <script type="module" src="js/header.js"></script>

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc, collection, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ============================================================
   أدوات مساعدة
   ============================================================ */
function getChildId() {
  return new URLSearchParams(location.search).get('child')
      || localStorage.getItem('lastChildId')
      || null;
}

function getParentId(user) {
  return new URLSearchParams(location.search).get('parentId') || user?.uid || null;
}

function avatarColor(name = '') {
  const colors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899'];
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function glucoseClass(value, child) {
  if (value == null) return 'empty';
  const nr = child?.normalRange || {};
  const critLow  = nr.criticalLow  ?? child?.criticalLow  ?? 3.0;
  const critHigh = nr.criticalHigh ?? child?.criticalHigh ?? 14.0;
  const low  = nr.min ?? child?.hypo  ?? 3.9;
  const high = nr.max ?? child?.hyper ?? 10.0;
  if (value <= critLow || value >= critHigh) return 'crit';
  if (value < low)  return 'low';
  if (value > high) return 'high';
  return 'ok';
}

function glucoseLabel(value, cls, unit = 'mmol/L') {
  const icons = { ok: '✓', low: '↓', high: '↑', crit: '⚠', empty: '—' };
  const texts = { ok: 'طبيعي', low: 'منخفض', high: 'مرتفع', crit: 'حرج', empty: 'لا قراءة' };
  if (value == null) return `<span class="header-glucose empty">${icons.empty} ${texts.empty}</span>`;
  return `<span class="header-glucose ${cls}" title="آخر قراءة جلوكوز">${icons[cls]} ${value} ${unit}</span>`;
}

/* الصفحة الحالية — لتحديد الرابط النشط */
function currentPage() {
  const p = location.pathname.split('/').pop().replace('.html','');
  return p || 'index';
}

/* ============================================================
   بناء الهيدر
   ============================================================ */
function buildHeader({ user, child, childId, lastGlucose, unit }) {
  const name    = child?.name || 'الطفل';
  const initial = name.charAt(0);
  const color   = avatarColor(name);
  const page    = currentPage();

  const gClass = glucoseClass(lastGlucose, child);
  const gBadge = glucoseLabel(lastGlucose, gClass, unit);

  // روابط التنقل
  const cid = childId ? `?child=${encodeURIComponent(childId)}` : '';
  const pid = user?.uid ? `&parentId=${encodeURIComponent(user.uid)}` : '';

  const navLinks = [
    { key: 'child',        icon: '🏠', label: 'الرئيسية',   href: `child.html${cid}` },
    { key: 'measurements', icon: '📊', label: 'القياسات',    href: `measurements.html${cid}` },
    { key: 'meals',        icon: '🍽️', label: 'الوجبات',     href: `meals.html${cid}` },
    { key: 'visits',       icon: '🩺', label: 'الزيارات',    href: `visits.html${cid}` },
    { key: 'labs',         icon: '🔬', label: 'التحاليل',    href: `labs.html${cid}` },
    { key: 'reports',      icon: '📄', label: 'التقارير',    href: `reports.html${cid}` },
    { key: 'food-items',   icon: '📚', label: 'مكتبة الطعام',href: `food-items.html${cid}` },
    { key: 'child-edit',   icon: '⚙️', label: 'الإعدادات',   href: `child-edit.html${cid}${pid}` },
  ];

  const navHTML = navLinks.map(l => `
    <a class="nav-link ${page === l.key ? 'active' : ''}" href="${l.href}">
      <span class="nav-icon">${l.icon}</span>
      <span class="nav-label">${l.label}</span>
    </a>
  `).join('');

  const header = document.createElement('div');
  header.id = 'app-header';
  header.innerHTML = `
    <div class="header-inner">
      <a class="header-logo" href="parent.html">
        <div class="header-logo-icon">أ</div>
        <span class="header-logo-text">متابعة</span>
      </a>

      <div class="header-sep"></div>

      <div class="header-child">
        <div class="header-child-avatar" style="background:${color}">${initial}</div>
        <div>
          <div class="header-child-name">${name}</div>
          <div class="header-child-meta">${child?.gender || ''} • ${calcAge(child?.birthDate)} سنة</div>
        </div>
      </div>

      ${gBadge}

      <div class="header-sep"></div>

      <nav class="header-nav">${navHTML}</nav>

      <div class="header-actions">
        <a class="header-btn" href="parent.html">
          <span>👨‍👩‍👧</span>
          <span class="btn-label">أطفالي</span>
        </a>
        <button class="header-btn danger" id="hdr-logout">
          <span>↩</span>
          <span class="btn-label">خروج</span>
        </button>
      </div>
    </div>
  `;

  // Breadcrumb
  const bc = document.createElement('div');
  bc.id = 'app-breadcrumb';
  const crumb = navLinks.find(l => l.key === page);
  bc.innerHTML = `
    <div class="breadcrumb-inner">
      <a href="parent.html">أطفالي</a>
      <span class="breadcrumb-sep">›</span>
      <a href="child.html${cid}">${name}</a>
      ${crumb ? `<span class="breadcrumb-sep">›</span><span>${crumb.icon} ${crumb.label}</span>` : ''}
    </div>
  `;

  return { header, bc };
}

function calcAge(bd) {
  if (!bd) return '—';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

/* ============================================================
   جلب آخر قراءة جلوكوز
   ============================================================ */
async function fetchLastGlucose(uid, childId) {
  try {
    const ref  = collection(db, `parents/${uid}/children/${childId}/measurements`);
    const snap = await getDocs(query(ref, orderBy('recordedAt','desc'), limit(1)));
    if (snap.empty) return { value: null, unit: 'mmol/L' };
    const d = snap.docs[0].data();
    return {
      value: d.glucose ?? d.value ?? d.reading ?? null,
      unit:  d.unit ?? 'mmol/L'
    };
  } catch { return { value: null, unit: 'mmol/L' }; }
}

/* ============================================================
   التهيئة الرئيسية
   ============================================================ */
async function initHeader(user) {
  const childId = getChildId();
  let child = null, lastGlucose = null, unit = 'mmol/L';

  if (childId && user) {
    try {
      const snap = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
      if (snap.exists()) {
        child = snap.data();
        // حفظ للاستخدام من صفحات أخرى
        localStorage.setItem('lastChildId', childId);
        localStorage.setItem('selectedParentId', user.uid);
      }
    } catch {}

    const g = await fetchLastGlucose(user.uid, childId);
    lastGlucose = g.value;
    unit = child?.glucoseUnit ?? g.unit ?? 'mmol/L';
  }

  const { header, bc } = buildHeader({ user, child, childId, lastGlucose, unit });

  // إضافة الهيدر أول الـ body
  document.body.insertBefore(bc, document.body.firstChild);
  document.body.insertBefore(header, bc);

  // زر الخروج
  document.getElementById('hdr-logout')?.addEventListener('click', async () => {
    await signOut(auth);
    localStorage.clear();
    location.href = 'index.html';
  });

  // تنبيه قراءة حرجة
  const cls = glucoseClass(lastGlucose, child);
  if (cls === 'crit' && lastGlucose != null) {
    showCriticalBanner(child?.name || 'الطفل', lastGlucose, unit);
  }

  return { child, childId, lastGlucose };
}

/* ============================================================
   بانر التنبيه الحرج
   ============================================================ */
function showCriticalBanner(name, value, unit) {
  const key = `crit_${value}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  const banner = document.createElement('div');
  banner.style.cssText = `
    position:fixed; top:60px; left:50%; transform:translateX(-50%);
    background:#dc2626; color:#fff; padding:10px 18px;
    border-radius:10px; font-size:14px; font-weight:700;
    z-index:200; direction:rtl; box-shadow:0 8px 24px rgba(220,38,38,.4);
    cursor:pointer; max-width:90vw; text-align:center;
  `;
  banner.textContent = `🚨 ${name}: قراءة حرجة ${value} ${unit} — يحتاج تدخلاً فورياً`;
  banner.onclick = () => banner.remove();
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 10000);
}

/* ============================================================
   تشغيل
   ============================================================ */
// إضافة CSS تلقائياً لو مش موجود
if (!document.querySelector('link[href*="header.css"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/header.css';
  document.head.appendChild(link);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // لو مش مسجل، لا نعمل هيدر — الصفحة هتتعامل مع ده بنفسها
    if (!location.pathname.includes('index') && !location.pathname.includes('register')) {
      location.href = 'index.html';
    }
    return;
  }
  await initHeader(user);
});

// تصدير للاستخدام من صفحات تانية لو احتاجوا
export { initHeader, fetchLastGlucose };
