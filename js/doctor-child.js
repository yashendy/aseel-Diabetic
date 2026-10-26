// js/doctor-child.js - Clinical Workstation & Advanced AI Pattern Engine
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const mgdl2mmol = v => v / 18.0182;
const mmol2mgdl = v => v * 18.0182;

const params = new URLSearchParams(location.search);
const childId = params.get('child');
const parentId = params.get('parentId');

let currentUser = null;
let currentDoctorName = 'الطبيب المعالج';
let childData = {};
let sysUnit = 'mg/dL';
let sysLimits = { critLow: 54, low: 70, target: 100, high: 180, critHigh: 250 };
let measurementsData = [];

function showLoader(show) {
  const el = $('loader');
  if (el) el.classList.toggle('hidden', !show);
}

// دالة حماية النصوص ضد ثغرات XSS
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// دالة التاريخ المحلي بصيغة YYYY-MM-DD
function localDateStr(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// دالة التاريخ والوقت المحلي بصيغة YYYY-MM-DD HH:mm:ss
function localDateTimeStr(dateObj = new Date()) {
  const datePart = localDateStr(dateObj);
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const mm = String(dateObj.getMinutes()).padStart(2, '0');
  const ss = String(dateObj.getSeconds()).padStart(2, '0');
  return `${datePart} ${hh}:${mm}:${ss}`;
}

onAuthStateChanged(auth, async (user) => {
  if (!user || !childId || !parentId) {
    location.href = "doctor-dashboard.html";
    return;
  }
  currentUser = user;

  showLoader(true);
  try {
    // 1. جلب بيانات الطبيب وملف الطفل بالتوازي
    const [docUserSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid)).catch(() => null),
      loadChildProfile()
    ]);

    if (docUserSnap && docUserSnap.exists()) {
      const uData = docUserSnap.data();
      currentDoctorName = uData.name || uData.displayName || user.displayName || childData.assignedDoctorInfo?.name || 'الطبيب المعالج';
    } else {
      currentDoctorName = user.displayName || childData.assignedDoctorInfo?.name || 'الطبيب المعالج';
    }

    // 2. جلب القياسات وسجل التعديلات التاريخي بالتوازي لتسريع فتح المحطة
    const daysPreset = parseInt($('preset')?.value || 14);
    await Promise.all([
      fetchAndRenderData(daysPreset),
      loadRegimenHistory()
    ]);

    setupEvents();
  } catch (e) {
    console.error("Error loading workstation data:", e);
    alert("حدث خطأ أثناء تحميل بيانات محطة المريض: " + (e.message || e));
  } finally {
    showLoader(false);
  }
});

// --- 1. تحميل بروفايل المريض وإعداد الروابط ---
async function loadChildProfile() {
  const childRef = doc(db, "parents", parentId, "children", childId);
  const snap = await getDoc(childRef);
  if (!snap.exists()) throw new Error("لم يتم العثور على ملف المريض أو أن الأسرة أوقفت مشاركة البيانات.");

  childData = snap.data();
  sysUnit = childData.glucoseUnit || 'mg/dL';

  if (childData.glucose_limits) {
    sysLimits = {
      critLow: Number(childData.glucose_limits.critical_low) || (sysUnit === 'mmol/L' ? 3.0 : 54),
      low: Number(childData.glucose_limits.low) || (sysUnit === 'mmol/L' ? 3.9 : 70),
      target: Number(childData.glucose_limits.target) || (sysUnit === 'mmol/L' ? 5.5 : 100),
      high: Number(childData.glucose_limits.high) || (sysUnit === 'mmol/L' ? 10.0 : 180),
      critHigh: Number(childData.glucose_limits.critical_high) || (sysUnit === 'mmol/L' ? 13.9 : 250)
    };
  } else if (sysUnit === 'mmol/L') {
    sysLimits = { critLow: 3.0, low: 3.9, target: 5.5, high: 10.0, critHigh: 13.9 };
  }

  // رأس الصفحة والهوية البصرية
  const patientName = childData.name || 'المريض';
  if ($('patientName')) $('patientName').textContent = patientName;
  if ($('breadPatientName')) $('breadPatientName').textContent = patientName;
  if ($('patientAvatar')) $('patientAvatar').textContent = patientName.charAt(0);

  // حساب العمر الدقيق
  let ageStr = '—';
  if (childData.birthDate) {
    const b = new Date(childData.birthDate);
    const t = new Date();
    let age = t.getFullYear() - b.getFullYear();
    const m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
    ageStr = `${Math.max(0, age)} سنة`;
  }
  const genderStr = childData.gender === 'female' ? 'أنثى' : 'ذكر';
  if ($('patientMeta')) $('patientMeta').textContent = `${genderStr} • ${ageStr} • الوحدة: ${sysUnit}`;

  const regimenType = childData.insulin?.basal ? 'حقن MDI' : (childData.regimen || 'بروتوكول علاجي');
  if ($('patientRegimen')) $('patientRegimen').textContent = regimenType;
  if ($('lblUnit')) $('lblUnit').textContent = sysUnit;

// روابط التنقل لمحطة الطبيب (إخفاء زر الوجبات الخاص بصفحة الطفل)
  const safeChild = encodeURIComponent(childId);
  const safeParent = encodeURIComponent(parentId);
  if ($('navDocReports')) $('navDocReports').href = `reports.html?child=${safeChild}&parentId=${safeParent}`;
  if ($('navDocLabs')) $('navDocLabs').href = `labs.html?child=${safeChild}&parentId=${safeParent}`;
  if ($('navDocVisits')) $('navDocVisits').href = `visits.html?child=${safeChild}&parentId=${safeParent}`;
  if ($('navDocMeals')) $('navDocMeals').href = `meals.html?child=${safeChild}&parentId=${safeParent}`;

  // تعبئة حقول البروتوكول الطبي
  if ($('f_target')) $('f_target').value = sysLimits.target;
  if ($('f_critLow')) $('f_critLow').value = sysLimits.critLow;
  if ($('f_low')) $('f_low').value = sysLimits.low;
  if ($('f_high')) $('f_high').value = sysLimits.high;
  if ($('f_critHigh')) $('f_critHigh').value = sysLimits.critHigh;

  const cr = childData.cr || {};
  if ($('f_cf')) $('f_cf').value = childData.cf || childData.correctionFactor || '';
  if ($('f_cr_b')) $('f_cr_b').value = cr.breakfast || '';
  if ($('f_cr_l')) $('f_cr_l').value = cr.lunch || '';
  if ($('f_cr_d')) $('f_cr_d').value = cr.dinner || '';
  if ($('f_cr_s')) $('f_cr_s').value = cr.snack || '';

  if ($('f_basal')) $('f_basal').value = childData.insulin?.basal || childData.basalType || '';
  if ($('f_basal_dose')) $('f_basal_dose').value = childData.insulin?.basalDose || childData.basalDose || '';
  if ($('f_bolus')) $('f_bolus').value = childData.insulin?.bolus || childData.bolusType || '';
  if ($('f_child_weight')) $('f_child_weight').value = childData.vitals?.weight || childData.weight || '';

  // خريطة الحقن (مع توحيد القيمة الافتراضية normal ودعم ok السابقة)
  const imap = childData.injection_map || {};
  const mapIds = ['abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'arm_right', 'arm_left', 'thigh_right', 'thigh_left'];
  mapIds.forEach(id => {
    const el = $(`inj_${id}`);
    if (el) {
      const savedVal = imap[id];
      el.value = (savedVal === 'ok' ? 'normal' : savedVal) || 'normal';
    }
  });

  // تعليمات الطبيب الحالية
  if ($('doctorPrescription')) {
    $('doctorPrescription').value = childData.doctor_note || '';
  }
}

// --- 2. جلب القياسات ومعالجتها ---
async function fetchAndRenderData(daysBack) {
  showLoader(true);
  try {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - daysBack);

    const toStr = localDateStr(toDate);
    const fromStr = localDateStr(fromDate);

    const col = collection(db, "parents", parentId, "children", childId, "measurements");
    const qy = query(col, where("date", ">=", fromStr), where("date", "<=", toStr));
    const snap = await getDocs(qy);

    measurementsData = [];
    snap.forEach(d => {
      const x = d.data();
      let v = sysUnit.includes('mmol')
        ? (x.value_mmol ?? (x.unit === 'mg/dL' ? mgdl2mmol(x.value) : x.value))
        : (x.value_mgdl ?? (x.unit === 'mmol/L' ? mmol2mgdl(x.value) : x.value));

      let mWhen = null;
      if (x.when?.toDate) {
        mWhen = x.when.toDate();
      } else if (x.timestamp?.toDate) {
        mWhen = x.timestamp.toDate();
      } else if (x.date) {
        mWhen = new Date(x.date + (x.time ? 'T' + x.time : 'T00:00:00'));
      } else {
        mWhen = new Date();
      }

      measurementsData.push({
        id: d.id,
        dateStr: x.date || '',
        timeStr: x.time || '',
        when: mWhen,
        slotKey: x.slotKey || x.slot || 'OTHER',
        val: Number.isFinite(+v) ? Math.round((+v) * 10) / 10 : null,
        carbs: Number(x.carbs) || 0,
        ins: Number(x.totalInsulin || x.totalDose || x.correctionDose || x.dose) || 0,
        notes: x.notes || ''
      });
    });

    // ترتيب تنازلي (الأحدث أولاً)
    measurementsData.sort((a, b) => b.when - a.when);

    renderClinicalMetrics();
    evaluateClinicalPatterns();
    renderTable();
  } finally {
    showLoader(false);
  }
}

// --- 3. حساب المؤشرات السريرية المعيارية (ADA / ISPAD) ---
function renderClinicalMetrics() {
  const valid = measurementsData.filter(x => x.val !== null);
  const total = valid.length;

  if (total === 0) {
    if ($('mTIR')) $('mTIR').textContent = '—';
    if ($('mTBR')) $('mTBR').textContent = '—';
    if ($('mTAR')) $('mTAR').textContent = '—';
    if ($('mGMI')) $('mGMI').textContent = '—';
    if ($('mCV'))  $('mCV').textContent = '—';
    return;
  }

  const tbrCount = valid.filter(x => x.val < sysLimits.low).length;
  const tirCount = valid.filter(x => x.val >= sysLimits.low && x.val <= sysLimits.high).length;
  const tarCount = valid.filter(x => x.val > sysLimits.high).length;

  const pctTIR = Math.round((tirCount / total) * 100);
  const pctTBR = Math.round((tbrCount / total) * 100);
  const pctTAR = Math.round((tarCount / total) * 100);

  // حساب المتوسط والانحراف المعياري لـ GMI و CV%
  const vals = valid.map(x => x.val);
  const mean = vals.reduce((a, b) => a + b, 0) / total;
  const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / total;
  const sd = Math.sqrt(variance);
  const cv = Math.round((sd / mean) * 100);

  // GMI (Bergenstal 2018): 3.31 + 0.02392 * [mean glucose in mg/dL]
  const meanMgdl = sysUnit === 'mmol/L' ? mmol2mgdl(mean) : mean;
  const gmi = (3.31 + (0.02392 * meanMgdl)).toFixed(1);

  if ($('mTIR')) $('mTIR').textContent = `${pctTIR}%`;
  if ($('mTBR')) $('mTBR').textContent = `${pctTBR}%`;
  if ($('mTAR')) $('mTAR').textContent = `${pctTAR}%`;
  if ($('mGMI')) $('mGMI').textContent = `${gmi}%`;
  if ($('mCV'))  $('mCV').textContent = `${cv}%`;
}

// --- 4. محرك الذكاء الاصطناعي السريري المتقدم (Clinical AI Pattern Engine) ---
function evaluateClinicalPatterns() {
  const grid = $('aiPatternsGrid');
  if (!grid) return;

  const valid = measurementsData.filter(x => x.val !== null);
  if (valid.length === 0) {
    grid.innerHTML = '<div class="tiny muted" style="padding:20px; text-align:center;">لا توجد قياسات كافية في هذه الفترة لإجراء التحليل السريري.</div>';
    return;
  }

  const patterns = [];
  const chrono = [...valid].reverse(); // ترتيب تصاعدي زمني للتحليل التسلسلي

  // 1. ظاهرة الفجر (Dawn Phenomenon)
  const fastingHighThreshold = sysUnit === 'mmol/L' ? 7.2 : 130;
  const nocturnalLowThreshold = sysUnit === 'mmol/L' ? 4.0 : 72;
  const morningWakeSlots = ['FASTING', 'WAKE', 'PRE_BREAKFAST'];

  const morningReadings = chrono.filter(x => morningWakeSlots.includes(x.slotKey));
  const nightReadings = chrono.filter(x => x.slotKey === 'DURING_SLEEP' || x.slotKey === 'BEDTIME');

  if (morningReadings.length >= 3) {
    const highMornings = morningReadings.filter(x => x.val > fastingHighThreshold);
    const morningHighPct = highMornings.length / morningReadings.length;
    const hasNightHypos = nightReadings.some(x => x.val < nocturnalLowThreshold);

    if (morningHighPct >= 0.45 && !hasNightHypos) {
      patterns.push({
        title: 'ظاهرة الفجر السريرية (Dawn Phenomenon)',
        badge: 'ارتفاع فجر',
        cls: 'warn',
        desc: `تم رصد ارتفاع متكرر لسكر الصباح الباكر (${highMornings.length} مرات من أصل ${morningReadings.length}) مع خلو فترة الليل من أي هبوطات مسجلة.`,
        rec: '💡 التوصية السريرية: يُنصح بضبط توقيت جرعة الإنسولين القاعدي (تأخيرها أو تقديمها)، أو مراجعة جرعة القاعدي لتغطية إفراز الكورتيزول وهرمون النمو فجراً.'
      });
    }
  }

  // 2. تأثير سوموجي (Somogyi Rebound)
  let somogyiEvents = 0;
  for (let i = 0; i < chrono.length - 1; i++) {
    const curr = chrono[i];
    const next = chrono[i + 1];
    const diffHours = (next.when - curr.when) / (1000 * 60 * 60);

    const isNight = curr.slotKey === 'DURING_SLEEP' || (curr.when.getHours() >= 0 && curr.when.getHours() <= 5);
    const isMorning = morningWakeSlots.includes(next.slotKey) || (next.when.getHours() >= 6 && next.when.getHours() <= 10);

    if (isNight && curr.val < sysLimits.low && isMorning && next.val > sysLimits.high && diffHours <= 9) {
      somogyiEvents++;
    }
  }

  if (somogyiEvents >= 1) {
    patterns.push({
      title: 'تأثير سوموجي والارتداد السكري (Somogyi Rebound)',
      badge: 'هبوط ارتدادي حرج',
      cls: 'crit',
      desc: `رُصد ارتداد عكسي (${somogyiEvents} مرات) لهبوط غير معالج أثناء النوم تبعه قفزة سكر حادة في قراءة الصباح.`,
      rec: '⚠️ التوصية السريرية: تجنب رفع الجرعة القاعدية صباحاً، بل يجب تقليل جرعة الإنسولين المسائي أو توفير سناك بروتيني خفيف قبل النوم لمنع الهبوط الليلي.'
    });
  }

  // 3. خلل معاملات الكارب حسب الوجبات (Meal-by-Meal CR Mismatch)
  const mealPairs = [
    { name: 'الإفطار', pre: 'PRE_BREAKFAST', post: 'POST_BREAKFAST', crKey: 'breakfast' },
    { name: 'الغداء', pre: 'PRE_LUNCH', post: 'POST_LUNCH', crKey: 'lunch' },
    { name: 'العشاء', pre: 'PRE_DINNER', post: 'POST_DINNER', crKey: 'dinner' }
  ];

  mealPairs.forEach(meal => {
    const postVals = chrono.filter(x => x.slotKey === meal.post);
    if (postVals.length >= 3) {
      const highPosts = postVals.filter(x => x.val > sysLimits.high);
      const lowPosts = postVals.filter(x => x.val < sysLimits.low);

      if (highPosts.length / postVals.length >= 0.45) {
        patterns.push({
          title: `خلل معامل كارب وجبة ${meal.name} (CR Inadequacy)`,
          badge: 'ارتفاع بعد الأكل',
          cls: 'warn',
          desc: `السكر بعد ${meal.name} يرتفع فوق الهدف في ${Math.round((highPosts.length / postVals.length) * 100)}% من القراءات.`,
          rec: `💡 التوصية السريرية: معامل كارب ${meal.name} الحالي ضعيف. يُنصح بخفض رقم الـ CR (مثلاً من 15 إلى 12 غرام/وحدة) أو التأكد من إعطاء الجرعة قبل الأكل بـ 15 دقيقة.`
        });
      } else if (lowPosts.length / postVals.length >= 0.25) {
        patterns.push({
          title: `فرط جرعة وجبة ${meal.name} (Aggressive CR)`,
          badge: 'هبوط بعد الأكل',
          cls: 'crit',
          desc: `يتعرض الطفل لهبوط متكرر بعد وجبة ${meal.name} في ${Math.round((lowPosts.length / postVals.length) * 100)}% من الحالات.`,
          rec: `⚠️ التوصية السريرية: رفع رقم معامل الكارب (مثلاً من 12 إلى 15 غرام/وحدة) لتخفيف وحدات الإنسولين السريع للوجبة.`
        });
      }
    }
  });

  // 4. كفاءة معامل التصحيح (CF Effectiveness)
  let failedCorrections = 0;
  let totalCorrections = 0;
  for (let i = 0; i < chrono.length - 1; i++) {
    const curr = chrono[i];
    const next = chrono[i + 1];
    const diffHours = (next.when - curr.when) / (1000 * 60 * 60);

    if (curr.val > sysLimits.high && curr.ins > 0 && diffHours >= 2 && diffHours <= 4.5) {
      totalCorrections++;
      if (next.val > sysLimits.high) {
        failedCorrections++;
      }
    }
  }

  if (totalCorrections >= 2 && (failedCorrections / totalCorrections) >= 0.5) {
    patterns.push({
      title: 'ضعف فاعلية معامل التصحيح (CF Under-correction)',
      badge: 'تصحيح غير فعال',
      cls: 'warn',
      desc: `في ${Math.round((failedCorrections / totalCorrections) * 100)}% من جرعات التصحيح، استمر السكر مرتفعاً بعد ساعتين إلى 4 ساعات من الجرعة.`,
      rec: '💡 التوصية السريرية: معامل التصحيح (CF) الحالي مرتفع وضعيف. يُنصح بخفض قيمته (مثلاً من 50 إلى 40 mg/dL لكل وحدة) لزيادة قوة جرعة التصحيح.'
    });
  }

  // 5. معامل التذبذب الجلايسيمي المرتفع (CV% Instability)
  const vals = valid.map(x => x.val);
  const mean = vals.reduce((a, b) => a + b, 0) / valid.length;
  const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length;
  const cvVal = Math.round((Math.sqrt(variance) / mean) * 100);

  if (cvVal > 36) {
    patterns.push({
      title: `تذبذب جلايسيمي مرتفع (Glycemic Variability CV: ${cvVal}%)`,
      badge: 'تذبذب غير آمن',
      cls: 'crit',
      desc: `تجاوز معامل التباين حاجز الـ 36% المعياري، مما يشير إلى أرجحة خطيرة بين الارتفاع والانخفاض.`,
      rec: '⚠️ التوصية السريرية: تجنب التغيير العنيف في الجرعات. ركز أولاً على تثبيت مواعيد الوجبات وحساب الكارب قبل خفض المتوسط العام لتفادي نوبات الهبوط.'
    });
  }

  // 6. تكتلات دهنية في خريطة الحقن (Lipohypertrophy Conflict)
  const imap = childData.injection_map || {};
  const lumpZones = [];
  const ZONE_NAMES = {
    abd_top_right: 'البطن يمين علوي',
    abd_top_left: 'البطن يسار علوي',
    abd_bottom_right: 'البطن يمين سفلي',
    abd_bottom_left: 'البطن يسار سفلي',
    arm_right: 'الذراع الأيمن',
    arm_left: 'الذراع الأيسر',
    thigh_right: 'الفخذ الأيمن',
    thigh_left: 'الفخذ الأيسر'
  };

  for (const k in imap) {
    if (imap[k] === 'lump') {
      lumpZones.push(ZONE_NAMES[k] || k);
    }
  }

  if (lumpZones.length > 0) {
    patterns.push({
      title: 'تكتلات دهنية نشطة في مناطق الحقن (Lipohypertrophy)',
      badge: 'تكتل موضعي 🚨',
      cls: 'warn',
      desc: `تم توثيق وجود تكتلات دهنية في: (${lumpZones.join('، ')}). الحقن في هذه المناطق يؤدي إلى امتصاص بطيء أو عشوائي للإنسولين وارتفاعات غير مبررة.`,
      rec: '💡 التوصية السريرية: التأكيد على الأسرة بإراحة هذه المناطق تماماً لمدة 2-3 أشهر واستخدام المناطق السليمة حصراً.'
    });
  }

  // في حال كانت جميع المؤشرات ممتازة
  if (patterns.length === 0) {
    patterns.push({
      title: 'استقرار المؤشرات والأنماط السريرية ✅',
      badge: 'ممتاز ومستقر',
      cls: 'good',
      desc: 'لم يتم رصد أي أنماط لهبوط متكرر، ظاهرة الفجر، أو خلل في معاملات الوجبات خلال الفترة المحددة.',
      rec: '🎉 الخطة العلاجية الحالية تحقق نتائج متوازنة ومنضبطة وفق المعايير السريرية.'
    });
  }

  // رندر الكروت
  grid.innerHTML = patterns.map(p => `
    <div class="ai-pattern-card ${p.cls}">
      <div class="ai-pat-header">
        <span class="ai-pat-name">${p.title}</span>
        <span class="ai-pat-badge ${p.cls}">${p.badge}</span>
      </div>
      <div class="ai-pat-desc">${p.desc}</div>
      <div class="ai-pat-rec">${p.rec}</div>
    </div>
  `).join('');
}

// --- 5. جدول القياسات والوجبات التفصيلي ---
function renderTable() {
  const tbody = $('combinedRows');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (!measurementsData.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">لا توجد قراءات مسجلة في هذه الفترة المحددة.</td></tr>';
    return;
  }

  const SLOT_LABELS = {
    FASTING: 'صائم',
    WAKE: 'الاستيقاظ',
    PRE_BREAKFAST: 'قبل الفطار',
    POST_BREAKFAST: 'بعد الفطار',
    PRE_LUNCH: 'قبل الغداء',
    POST_LUNCH: 'بعد الغداء',
    PRE_DINNER: 'قبل العشاء',
    POST_DINNER: 'بعد العشاء',
    SNACK: 'سناك خفيف',
    BEDTIME: 'قبل النوم',
    DURING_SLEEP: 'أثناء النوم'
  };

  measurementsData.forEach(m => {
    let statusHtml = '';
    if (m.val !== null) {
      if (m.val <= sysLimits.critLow) {
        statusHtml = `<span style="color:#b91c1c; font-weight:700;">🚨 هبوط حرج</span>`;
      } else if (m.val < sysLimits.low) {
        statusHtml = `<span style="color:#b45309; font-weight:700;">⬇️ هبوط</span>`;
      } else if (m.val >= sysLimits.critHigh) {
        statusHtml = `<span style="color:#b91c1c; font-weight:700;">🚨 ارتفاع حرج</span>`;
      } else if (m.val > sysLimits.high) {
        statusHtml = `<span style="color:#b45309; font-weight:700;">⬆️ ارتفاع</span>`;
      } else {
        statusHtml = `<span style="color:#16a34a; font-weight:700;">🎯 في النطاق</span>`;
      }
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-size:12px; color:#475569;">
        ${escapeHtml(m.dateStr)}<br><b style="color:#0f172a;">${escapeHtml(m.timeStr || '—')}</b>
      </td>
      <td><b>${escapeHtml(SLOT_LABELS[m.slotKey] || m.slotKey)}</b></td>
      <td style="font-weight:800; font-size:16px;">${m.val !== null ? m.val : '—'}</td>
      <td>${statusHtml}</td>
      <td style="color:#7c3aed; font-weight:700;">${m.carbs > 0 ? m.carbs + 'g' : '—'}</td>
      <td style="color:#dc2626; font-weight:700;">${m.ins > 0 ? m.ins + 'U' : '—'}</td>
      <td style="font-size:12px; color:#64748b; max-width:220px;">${escapeHtml(m.notes || '—')}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- 6. طلب التحاليل الطبية المباشر من الطبيب ---
async function sendLabOrder() {
  const checkboxes = document.querySelectorAll('.lab-order-item:checked');
  const selectedTests = Array.from(checkboxes).map(cb => cb.value);

  if (selectedTests.length === 0) {
    alert("يرجى تحديد تحليل واحد على الأقل لإرسال الطلب للأسرة.");
    return;
  }

  const note = $('labOrderNote')?.value?.trim() || '';

  showLoader(true);
  try {
    const orderData = {
      tests: selectedTests,
      notes: note || null,
      orderedByDoctorId: currentUser.uid,
      orderedByDoctorName: currentDoctorName,
      status: 'pending',
      dateStr: localDateStr(),
      createdAt: serverTimestamp()
    };

    // حفظ في سجل طلبات الفحوصات للمريض وتحديث ملف الطفل بالتوازي
    const labOrdersCol = collection(db, "parents", parentId, "children", childId, "lab_orders");
    const childRef = doc(db, "parents", parentId, "children", childId);

    await Promise.all([
      addDoc(labOrdersCol, orderData),
      updateDoc(childRef, {
        pending_lab_order: {
          tests: selectedTests,
          notes: note || null,
          orderedAt: serverTimestamp(),
          dateStr: localDateStr(),
          doctorName: currentDoctorName
        }
      })
    ]);

    alert(`تم إرسال طلب الفحوصات (${selectedTests.length} فحص) بنجاح إلى ملف الطفل والأسرة! 🔬📨`);

    // تفريغ الحقول
    checkboxes.forEach(cb => cb.checked = false);
    if ($('labOrderNote')) $('labOrderNote').value = '';
  } catch (e) {
    console.error("Error sending lab order:", e);
    alert("حدث خطأ أثناء إرسال طلب الفحوصات: " + (e.message || e));
  } finally {
    showLoader(false);
  }
}

// --- 7. حفظ واعتماد البروتوكول العلاجي وسجل التعديلات (Audit Trail) ---
async function saveMedicalProtocol() {
  showLoader(true);

  const crData = {
    breakfast: parseFloat($('f_cr_b')?.value) || null,
    lunch: parseFloat($('f_cr_l')?.value) || null,
    dinner: parseFloat($('f_cr_d')?.value) || null,
    snack: parseFloat($('f_cr_s')?.value) || null
  };

  const limitsData = {
    target: parseFloat($('f_target')?.value) || null,
    critical_low: parseFloat($('f_critLow')?.value) || null,
    low: parseFloat($('f_low')?.value) || null,
    high: parseFloat($('f_high')?.value) || null,
    critical_high: parseFloat($('f_critHigh')?.value) || null
  };

  const mapIds = ['abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'arm_right', 'arm_left', 'thigh_right', 'thigh_left'];
  const injectionMapData = {};
  mapIds.forEach(id => {
    const el = $(`inj_${id}`);
    if (el) injectionMapData[id] = el.value || 'normal';
  });

  const payload = {
    cf: parseFloat($('f_cf')?.value) || null,
    cr: crData,
    glucose_limits: limitsData,
    insulin: {
      basal: $('f_basal')?.value?.trim() || null,
      basalDose: parseFloat($('f_basal_dose')?.value) || null,
      bolus: $('f_bolus')?.value?.trim() || null
    },
    basalDose: parseFloat($('f_basal_dose')?.value) || null,
    weight: parseFloat($('f_child_weight')?.value) || null,
    injection_map: injectionMapData,
    doctor_note: $('doctorPrescription')?.value?.trim() || null,
    lastMedicalUpdate: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    const childRef = doc(db, "parents", parentId, "children", childId);
    const historyCol = collection(db, "parents", parentId, "children", childId, "regimen_history");

    await Promise.all([
      updateDoc(childRef, payload),
      addDoc(historyCol, {
        timestamp: serverTimestamp(),
        dateStr: localDateTimeStr(),
        doctorId: currentUser.uid,
        doctorName: currentDoctorName,
        doctorNote: payload.doctor_note,
        target: limitsData.target,
        targetBg: limitsData.target,
        cf: payload.cf,
        cr: payload.cr,
        insulin: payload.insulin
      })
    ]);

    alert("تم حفظ واعتماد البروتوكول العلاجي وتوثيق التعديل في السجل السريري بنجاح! 💾✅");

    await Promise.all([
      loadChildProfile(),
      loadRegimenHistory()
    ]);
  } catch (e) {
    console.error("Error saving medical protocol:", e);
    alert("حدث خطأ أثناء حفظ البروتوكول: " + (e.message || e));
  } finally {
    showLoader(false);
  }
}

// --- 8. جلب سجل التعديلات التاريخية (Audit Trail) ---
async function loadRegimenHistory() {
  const listEl = $('regimenHistoryList');
  if (!listEl) return;

  try {
    const historyCol = collection(db, "parents", parentId, "children", childId, "regimen_history");
    const qy = query(historyCol, orderBy("timestamp", "desc"), limit(10));
    const snap = await getDocs(qy);

    if (snap.empty) {
      listEl.innerHTML = '<div class="tiny muted" style="padding:10px 0;">لا توجد تعديلات مسجلة سابقاً في السجل السريري.</div>';
      return;
    }

    let html = '';
    snap.forEach(d => {
      const h = d.data();
      const dt = h.dateStr || (h.timestamp?.toDate ? h.timestamp.toDate().toLocaleString('ar-EG') : '—');
      const docName = (h.doctorName || 'الطبيب المعالج').replace(/^د\.\s*/, '');
      const note = h.doctorNote ? `<div style="color:#1d4ed8; font-weight:600; margin-top:3px;">📝 ${escapeHtml(h.doctorNote)}</div>` : '';

      const cr = h.cr || {};
      const crParts = [];
      if (cr.breakfast) crParts.push(`فطار: ${escapeHtml(cr.breakfast)}`);
      if (cr.lunch) crParts.push(`غداء: ${escapeHtml(cr.lunch)}`);
      if (cr.dinner) crParts.push(`عشاء: ${escapeHtml(cr.dinner)}`);

      const targetVal = h.target ?? h.targetBg ?? '—';

      html += `
        <div class="history-item">
          <div class="history-meta">
            <b>👨‍⚕️ د. ${escapeHtml(docName)}</b>
            <span>🕒 ${escapeHtml(dt)}</span>
          </div>
          <div class="history-changes">
            <span>🎯 الهدف: <b>${escapeHtml(targetVal)}</b> | CF: <b>${escapeHtml(h.cf || '—')}</b> | CR: [${crParts.join('، ') || '—'}]</span>
            ${note}
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
  } catch (e) {
    console.warn("Could not load regimen history:", e);
    listEl.innerHTML = '<div class="tiny muted">تعذر تحميل سجل التعديلات التاريخية.</div>';
  }
}

// --- 9. تصدير CSV ---
function exportCsv() {
  const BOM = "\uFEFF";
  const header = ["التاريخ", "الوقت", "الفترة", "السكر", "الكاربوهيدرات", "الإنسولين", "ملاحظات"];
  const rows = [header];

  measurementsData.forEach(m => {
    rows.push([
      m.dateStr,
      m.timeStr,
      m.slotKey,
      m.val !== null ? m.val : "",
      m.carbs || "",
      m.ins || "",
      `"${(m.notes || '').replace(/"/g, '""')}"`
    ]);
  });

  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Patient_${childData.name || 'Child'}_Measurements.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --- 10. إعداد الأحداث ---
function setupEvents() {
  const presetEl = $('preset');
  if (presetEl) {
    presetEl.onchange = () => fetchAndRenderData(parseInt(presetEl.value) || 14);
  }

  const btnReanalyzeAI = $('btnReanalyzeAI');
  if (btnReanalyzeAI) {
    btnReanalyzeAI.onclick = () => {
      evaluateClinicalPatterns();
      alert("تمت إعادة تحليل الأنماط السريرية بنجاح! 🧠✨");
    };
  }

  const btnSendLabOrder = $('btnSendLabOrder');
  if (btnSendLabOrder) {
    btnSendLabOrder.onclick = sendLabOrder;
  }

  const btnSaveMedical = $('btnSaveMedical');
  if (btnSaveMedical) {
    btnSaveMedical.onclick = saveMedicalProtocol;
  }

  const exportBtn = $('exportCsv');
  if (exportBtn) {
    exportBtn.onclick = exportCsv;
  }
}
