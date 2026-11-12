// js/add-child.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { STANDARD_LIMITS, buildProtocolPatch, toMergeData } from './child-protocol.js';

const $ = id => document.getElementById(id);
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    initUnitSmartSwitch(); // تشغيل ميزة تحويل النطاقات التلقائي
  } else {
    window.location.href = "index.html"; 
  }
});

$('btnBack').addEventListener('click', () => {
  window.location.href = "parent.html";
});

// 💡 ميزة التحويل الذكي لأرقام النطاقات القياسية (ISPAD / ADA)
function initUnitSmartSwitch() {
  const unitSel = $('f_unit');
  const target = $('gl_target');
  const cLow = $('gl_crit_low');
  const low = $('gl_low');
  const high = $('gl_high');
  const cHigh = $('gl_crit_high');
  const cf = $('f_cf');

  const examples = {
    'mg/dL': { target: 100, cf: 50 },
    'mmol/L': { target: 5.5, cf: 3 }
  };

  unitSel.addEventListener('change', (e) => {
    const u = e.target.value || 'mg/dL';
    const std = STANDARD_LIMITS[u] || STANDARD_LIMITS['mg/dL'];

    // هدف السكر ومعامل التصحيح بارامترات علاجية: نضعها كأمثلة توضيحية (Placeholders) ولا نملؤها بصمت
    if (target) target.placeholder = `مثال: ${examples[u].target}`;
    if (cf) cf.placeholder = `مثال: ${examples[u].cf}`;

    // الحدود القياسية الأربعة تُملأ بالقيم العالمية المعتمدة افتراضياً مع إمكانية التخصيص
    if (cLow) cLow.value = std.critical_low;
    if (low) low.value = std.low;
    if (high) high.value = std.high;
    if (cHigh) cHigh.value = std.critical_high;
  });

  // تشغيلها مرة عند التحميل لوضع الحدود القياسية
  unitSel.dispatchEvent(new Event('change'));
}

// 🚀 حفظ وإنشاء ملف الطفل عبر البروتوكول الموحد
$('childForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  // 1. بناء والتحقق من بيانات البروتوكول عبر child-protocol.js
  const patch = buildProtocolPatch({}, {
    glucoseUnit: $('f_unit')?.value,
    cf: $('f_cf')?.value,
    cr: {
      breakfast: $('cr_b')?.value,
      lunch: $('cr_l')?.value,
      dinner: $('cr_d')?.value,
      snack: $('cr_s')?.value
    },
    limits: {
      target: $('gl_target')?.value,
      critical_low: $('gl_crit_low')?.value,
      low: $('gl_low')?.value,
      high: $('gl_high')?.value,
      critical_high: $('gl_crit_high')?.value
    },
    insulin: {
      basal: $('f_basal')?.value?.trim(),
      bolus: $('f_bolus')?.value?.trim()
    },
    basalDose: $('f_basal_dose')?.value,
    weight: $('f_weight')?.value,
    height: $('f_height')?.value
  }, { allowUnitChange: true });

  if (patch.errors.length > 0) {
    alert('⛔ ' + patch.errors.join('\n'));
    return;
  }

  $('loader').classList.remove('hidden');

  const protocolData = toMergeData(patch, () => null);
  const childName = $('f_name').value.trim();
  const genderVal = $('f_gender').value;
  const dobVal = $('f_dob').value;

  // 2. الهيكل الموحد الدقيق للمنصة (Standardized Schema v2)
  const childPayload = {
    ...protocolData,
    protocolVersion: 2,
    name: childName,
    gender: genderVal,
    birthDate: dobVal,

    // الهوية التفصيلية
    identity: {
      name: childName,
      gender: genderVal,
      dob: dobVal
    },

    // التاريخ المرضي
    medical_history: {
      diagnosisDate: $('f_diagnosis')?.value || null,
      comorbidities: []
    },

    // تهيئة خريطة الحقن بأمان كقيمة ابتدائية
    injection_map: {
      abd_bottom_left: "normal", abd_bottom_right: "normal", abd_top_left: "normal", abd_top_right: "normal",
      arm_left: "normal", arm_right: "normal", thigh_left: "normal", thigh_right: "normal"
    },

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    const childrenRef = collection(db, `parents/${currentUser.uid}/children`);
    const docRef = await addDoc(childrenRef, childPayload);

    // توثيق الإنشاء الأولي في سجل البروتوكول (regimen_history)
    if (patch.changes.length) {
      try {
        await addDoc(collection(docRef, 'regimen_history'), {
          at: serverTimestamp(),
          by: currentUser.uid,
          byRole: 'parent',
          byName: currentUser.displayName || 'ولي الأمر (إنشاء ملف الطفل)',
          changes: patch.changes
        });
      } catch (err) { console.warn('regimen_history init:', err); }
    }
    
    window.location.href = "parent.html";
  } catch (error) {
    console.error(error);
    alert("❌ حدث خطأ أثناء الحفظ:\n" + error.message);
    $('loader').classList.add('hidden');
  }
});
