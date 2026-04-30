// js/add-child.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

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

// 💡 ميزة التحويل الذكي لأرقام النطاقات الافتراضية
function initUnitSmartSwitch() {
  const unitSel = $('f_unit');
  const target = $('gl_target');
  const cLow = $('gl_crit_low');
  const low = $('gl_low');
  const high = $('gl_high');
  const cHigh = $('gl_crit_high');
  const cf = $('f_cf');

  const defaultValues = {
    'mg/dL': { target: 100, cLow: 54, low: 70, high: 180, cHigh: 250, cf: 50 },
    'mmol/L': { target: 5.5, cLow: 3.0, low: 3.9, high: 10.0, cHigh: 13.9, cf: 3 }
  };

  unitSel.addEventListener('change', (e) => {
    const u = e.target.value;
    target.value = defaultValues[u].target;
    target.placeholder = `مثال: ${defaultValues[u].target}`;
    
    cLow.value = defaultValues[u].cLow;
    low.value = defaultValues[u].low;
    high.value = defaultValues[u].high;
    cHigh.value = defaultValues[u].cHigh;
    
    if(!cf.value) cf.placeholder = `مثال: ${defaultValues[u].cf}`;
  });

  // تشغيلها مرة عند التحميل لوضع القيم الافتراضية
  unitSel.dispatchEvent(new Event('change'));
}

// 🚀 حفظ وإنشاء ملف الطفل
$('childForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loader').classList.remove('hidden');

  // حساب مؤشر كتلة الجسم (BMI) مبدئياً
  const weight = parseFloat($('f_weight').value);
  const heightCm = parseFloat($('f_height').value);
  let bmi = null;
  if (weight && heightCm > 0) {
    const heightM = heightCm / 100;
    bmi = parseFloat((weight / (heightM * heightM)).toFixed(1));
  }

  // الهيكل الموحد الدقيق للمنصة (Standardized Schema)
  const childPayload = {
    name: $('f_name').value.trim(), // للاستخدام السريع في الواجهات
    gender: $('f_gender').value,
    birthDate: $('f_dob').value,
    glucoseUnit: $('f_unit').value,

    // 1. الهوية التفصيلية
    identity: {
      name: $('f_name').value.trim(),
      gender: $('f_gender').value,
      dob: $('f_dob').value
    },

    // 2. التاريخ المرضي
    medical_history: {
      diagnosisDate: $('f_diagnosis').value || null,
      comorbidities: []
    },

    // 3. النمو
    vitals: {
      weight: weight || null,
      height: heightCm || null,
      bmi: bmi,
      measurementDate: new Date().toISOString().slice(0, 10)
    },

    // 4. الأنسولين
    insulin: {
      basal: $('f_basal').value.trim() || null,
      bolus: $('f_bolus').value.trim() || null
    },

    // 5. المعاملات
    cf: parseFloat($('f_cf').value) || null,
    cr: {
      breakfast: parseFloat($('cr_b').value) || null,
      lunch: parseFloat($('cr_l').value) || null,
      dinner: parseFloat($('cr_d').value) || null,
      snack: parseFloat($('cr_s').value) || null
    },

    // 6. النطاقات الخمسة
    glucose_limits: {
      target: parseFloat($('gl_target').value) || null,
      critical_low: parseFloat($('gl_crit_low').value) || null,
      low: parseFloat($('gl_low').value) || null,
      high: parseFloat($('gl_high').value) || null,
      critical_high: parseFloat($('gl_crit_high').value) || null
    },

    // 7. تهيئة خريطة الحقن بأمان كقيمة ابتدائية
    injection_map: {
      abd_bottom_left: "normal", abd_bottom_right: "normal", abd_top_left: "normal", abd_top_right: "normal",
      arm_left: "normal", arm_right: "normal", thigh_left: "normal", thigh_right: "normal"
    },

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    const childrenRef = collection(db, `parents/${currentUser.uid}/children`);
    await addDoc(childrenRef, childPayload);
    
    // نجاح
    window.location.href = "parent.html";
  } catch (error) {
    console.error(error);
    alert("❌ حدث خطأ أثناء الحفظ:\n" + error.message);
    $('loader').classList.add('hidden');
  }
});
