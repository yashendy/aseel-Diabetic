// js/child-edit.js
import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
 
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const getParam = name => new URLSearchParams(location.search).get(name) || "";
 
let currentUser = null;
const childId = getParam("id") || getParam("child") || localStorage.getItem('selectedChildId');
 
// حالات خريطة الحقن
const STATES = ['normal', 'rest', 'lump'];
let injectionMapData = {}; 
 
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace('index.html'); return; }
  if (!childId) { location.href = 'parent.html'; return; }
  currentUser = user;
  
  initChipInputs();
  initInjectionMap();
  initBMICalculator();
  initUnitSmartSwitch(); // <-- تم إضافة ذكاء الوحدات هنا
  await loadChildData();
  
  $('#btnSave').addEventListener('click', saveChildData);
});
 
// === 1. حساب الـ BMI التلقائي ===
function initBMICalculator() {
  const wInput = $('#f_weight');
  const hInput = $('#f_height');
  const updateBMI = () => {
    const w = parseFloat(wInput.value);
    const h_cm = parseFloat(hInput.value);
    if (w && h_cm && h_cm > 0) {
      const h_m = h_cm / 100;
      const bmi = (w / (h_m * h_m)).toFixed(1);
      $('#calc_bmi').textContent = bmi;
    } else {
      $('#calc_bmi').textContent = '—';
    }
  };
  wInput.addEventListener('input', updateBMI);
  hInput.addEventListener('input', updateBMI);
}
 
// === 2. إعداد خريطة الحقن ===
function initInjectionMap() {
  $$('.zone').forEach(zone => {
    zone.setAttribute('data-state', 'normal');
    zone.addEventListener('click', () => {
      const zoneId = zone.getAttribute('data-zone');
      let currentState = zone.getAttribute('data-state');
      let nextState = STATES[(STATES.indexOf(currentState) + 1) % STATES.length];
      zone.setAttribute('data-state', nextState);
      injectionMapData[zoneId] = nextState;
    });
  });
}
 
// === 3. إعداد الـ Tags ===
function initChipInputs() {
  $$('.chip-input-wrap').forEach(wrap => {
    const input = wrap.querySelector('.chip-input-field');
    const list = wrap.querySelector('.chip-list');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/,/g, '');
        if (val) { addChip(list, val); input.value = ''; }
      }
    });
  });
}
 
function addChip(listEl, text) {
  const chip = document.createElement('span');
  chip.className = 'ui-chip';
  chip.dataset.val = text;
  chip.appendChild(document.createTextNode(text + ' '));
  const btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = '×';
  btn.onclick = () => chip.remove();
  chip.appendChild(btn);
  listEl.appendChild(chip);
}
 
function getChips(wrapId) { return $$(`#${wrapId} .ui-chip`).map(c => c.dataset.val).filter(Boolean); }
function setChips(wrapId, valuesArray) {
  const list = $(`#${wrapId} .chip-list`);
  list.innerHTML = '';
  (valuesArray || []).forEach(v => addChip(list, v));
}
 
// === 4. ذكاء وحدات القياس (تغيير الأمثلة والتحويل التلقائي) ===
function initUnitSmartSwitch() {
  const unitSelect = $('#f_unit');
  if (!unitSelect) return;
  
  // الحقول التي تتأثر بتغيير الوحدة
  const glucoseFields = ['gl_target', 'gl_low', 'gl_high', 'gl_crit_low', 'gl_crit_high', 'f_cf'];
  
  // الأمثلة الافتراضية لكل وحدة
  const placeholders = {
    'mg/dL': { gl_target: '100', gl_low: '70', gl_high: '180', gl_crit_low: '54', gl_crit_high: '250', f_cf: '50' },
    'mmol/L': { gl_target: '5.5', gl_low: '3.9', gl_high: '10.0', gl_crit_low: '3.0', gl_crit_high: '13.9', f_cf: '3' }
  };
 
  // الاحتفاظ بالوحدة السابقة لمعرفة هل نضرب أم نقسم
  let previousUnit = unitSelect.value || 'mg/dL';
 
  unitSelect.addEventListener('change', (e) => {
    const newUnit = e.target.value;
    
    // 1. تحديث الأمثلة الباهتة (Placeholders)
    glucoseFields.forEach(id => {
      const input = $(`#${id}`);
      if(input) input.placeholder = `مثال: ${placeholders[newUnit]?.[id] || ''}`;
    });
 
    // 2. التحويل التلقائي للأرقام المكتوبة بالفعل
    if (previousUnit !== newUnit) {
      glucoseFields.forEach(id => {
        const input = $(`#${id}`);
        if (input && input.value) {
          let val = parseFloat(input.value);
          if (!isNaN(val)) {
            if (newUnit === 'mmol/L' && previousUnit === 'mg/dL') {
              input.value = (val / 18.0182).toFixed(1); // من mg إلى mmol
            } else if (newUnit === 'mg/dL' && previousUnit === 'mmol/L') {
              input.value = Math.round(val * 18.0182); // من mmol إلى mg
            }
          }
        }
      });
      previousUnit = newUnit;
    }
  });
 
  // تشغيل الدالة مرة واحدة عند الفتح لضبط الأمثلة الأولية
  unitSelect.dispatchEvent(new Event('change'));
}
 
// === 5. تحميل البيانات ===
async function loadChildData() {
  $('#loader').classList.remove('hidden');
  try {
    const ref = doc(db, "parents", currentUser.uid, "children", childId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data();
 
    // الهوية والنمو
    $('#f_name').value = d.identity?.name || d.name || '';
    $('#f_civil').value = d.identity?.civilId || d.nationalId || '';
    $('#f_dob').value = d.identity?.dob || d.birthDate || '';
    $('#f_gender').value = d.identity?.gender || d.gender || 'female';
    $('#f_diagnosis_date').value = d.medical_history?.diagnosisDate || '';
    
    $('#f_weight').value = d.vitals?.weight || d.weight || '';
    $('#f_height').value = d.vitals?.height || d.height || '';
    $('#f_measure_date').value = d.vitals?.measurementDate || '';
    $('#f_weight').dispatchEvent(new Event('input')); // لتشغيل حساب BMI
 
    // الأمراض المصاحبة
    const comorb = d.medical_history?.comorbidities || [];
    $$('.comorb-flag').forEach(cb => cb.checked = comorb.includes(cb.value));
 
    // الأنسولين والمعاملات
    $('#f_unit').value = d.glucoseUnit || 'mg/dL';
    $('#f_unit').dispatchEvent(new Event('change')); // لتحديث الأمثلة بناءً على الوحدة المحفوظة
    
    $('#f_basal').value = d.insulin?.basal || d.basalType || '';
    if ($('#f_basal_dose')) $('#f_basal_dose').value = d.insulin?.basalDose || d.basalDose || '';
    $('#f_bolus').value = d.insulin?.bolus || d.bolusType || '';
    $('#f_cf').value = d.cf || d.correctionFactor || '';
    if ($('#f_step')) $('#f_step').value = String(d.insulinStep || 0.5);
    if ($('#f_maxdose')) $('#f_maxdose').value = d.maxDose || '';
    if ($('#f_dia')) $('#f_dia').value = d.diaHours || '';
    if ($('#f_hypocarbs')) $('#f_hypocarbs').value = d.hypoCarbs || '';
    if ($('#f_netrule')) $('#f_netrule').value = d.netCarbRule || 'fullFiber';
    
    if(d.cr) {
      $('#cr_b').value = d.cr.breakfast || '';
      $('#cr_l').value = d.cr.lunch || '';
      $('#cr_d').value = d.cr.dinner || '';
      $('#cr_s').value = d.cr.snack || '';
    }
 
    // الحدود الهرمية
    if(d.glucose_limits) {
      $('#gl_crit_low').value = d.glucose_limits.critical_low || '';
      $('#gl_low').value = d.glucose_limits.low || '';
      $('#gl_target').value = d.glucose_limits.target || '';
      $('#gl_high').value = d.glucose_limits.high || '';
      $('#gl_crit_high').value = d.glucose_limits.critical_high || '';
    }
 
    // الحساسيات والأنظمة
    setChips('allergiesWrap', d.diet?.allergies || d.allergies);
    const dietFlags = d.diet?.flags || d.dietaryFlags || [];
    $$('.diet-flag').forEach(cb => cb.checked = dietFlags.includes(cb.value));
 
    // خريطة الحقن
    if (d.injection_map) {
      injectionMapData = d.injection_map;
      $$('.zone').forEach(zone => {
        const zoneId = zone.getAttribute('data-zone');
        if(injectionMapData[zoneId]) zone.setAttribute('data-state', injectionMapData[zoneId]);
      });
    }
 
  } catch (e) { console.error(e); }
  finally { $('#loader').classList.add('hidden'); }
}
 
// === 6. الحفظ بالهيكل الجديد المُحسّن ===
// التحقق من منطقية الإعدادات قبل الحفظ
function validateBeforeSave() {
  const n = id => { const v = parseFloat($(id)?.value); return Number.isFinite(v) && v > 0 ? v : null; };
  const lim = [['حرج منخفض', n('#gl_crit_low')], ['منخفض', n('#gl_low')], ['الهدف', n('#gl_target')], ['مرتفع', n('#gl_high')], ['حرج مرتفع', n('#gl_crit_high')]].filter(x => x[1] !== null);
  for (let i = 1; i < lim.length; i++) {
    if (lim[i][1] <= lim[i - 1][1]) return { error: `ترتيب مستويات السكر غير منطقي: "${lim[i][0]}" (${lim[i][1]}) يجب أن يكون أكبر من "${lim[i - 1][0]}" (${lim[i - 1][1]}).` };
  }
  if ($('#f_maxdose')?.value && !n('#f_maxdose')) return { error: 'الحد الأقصى للجرعة يجب أن يكون رقماً أكبر من صفر.' };
  if ($('#f_dia')?.value && (n('#f_dia') < 2 || n('#f_dia') > 8)) return { error: 'مدة مفعول الأنسولين (DIA) عادةً بين 2 و 8 ساعات. راجعي القيمة.' };
 
  const missing = [];
  if (!n('#f_cf')) missing.push('معامل التصحيح CF');
  if (!n('#gl_target')) missing.push('هدف السكر');
  [['#cr_b', 'CR الفطار'], ['#cr_l', 'CR الغداء'], ['#cr_d', 'CR العشاء'], ['#cr_s', 'CR السناك']].forEach(([id, l]) => { if (!n(id)) missing.push(l); });
  return { missing };
}
 
async function saveChildData() {
  const v = validateBeforeSave();
  if (v.error) { alert('⛔ ' + v.error); return; }
  if (v.missing.length && !confirm(`⚠️ بيانات ناقصة: ${v.missing.join('، ')}.\nحاسبة الجرعات لن تقترح جرعة للبيانات الناقصة حتى تكتمل.\nهل تريدين الحفظ رغم ذلك؟`)) return;
 
  $('#loader').classList.remove('hidden');
  try {
    const payload = {
      // 1. الهوية
      identity: {
        name: $('#f_name').value,
        civilId: $('#f_civil').value,
        dob: $('#f_dob').value,
        gender: $('#f_gender').value
      },
      name: $('#f_name').value, // لسهولة العرض في الكروت السريعة
      
      // 2. التاريخ المرضي
      medical_history: {
        diagnosisDate: $('#f_diagnosis_date').value,
        comorbidities: $$('.comorb-flag').filter(c => c.checked).map(c => c.value)
      },
 
      // 3. النمو
      vitals: {
        weight: Number($('#f_weight').value) || null,
        height: Number($('#f_height').value) || null,
        measurementDate: $('#f_measure_date').value,
        bmi: Number($('#calc_bmi').textContent) || null
      },
      glucoseUnit: $('#f_unit').value,
 
      // 4. الأنسولين والمعاملات
      insulin: {
        basal: $('#f_basal').value,
        basalDose: Number($('#f_basal_dose')?.value) || null,
        bolus: $('#f_bolus').value
      },
      basalDose: Number($('#f_basal_dose')?.value) || null,
      cf: Number($('#f_cf').value) || null,
      insulinStep: Number($('#f_step')?.value) || 0.5,
      maxDose: Number($('#f_maxdose')?.value) || null,
      diaHours: Number($('#f_dia')?.value) || null,
      hypoCarbs: Number($('#f_hypocarbs')?.value) || null,
      netCarbRule: $('#f_netrule')?.value || 'fullFiber',
      cr: {
        breakfast: Number($('#cr_b').value) || null,
        lunch: Number($('#cr_l').value) || null,
        dinner: Number($('#cr_d').value) || null,
        snack: Number($('#cr_s').value) || null
      },
      
      // 5. الحدود
      glucose_limits: {
        critical_low: Number($('#gl_crit_low').value) || null,
        low: Number($('#gl_low').value) || null,
        target: Number($('#gl_target').value) || null,
        high: Number($('#gl_high').value) || null,
        critical_high: Number($('#gl_crit_high').value) || null
      },
 
      // 6. الغذاء
      diet: {
        allergies: getChips('allergiesWrap'),
        flags: $$('.diet-flag').filter(c => c.checked).map(c => c.value)
      },
      
      // 7. خريطة الحقن
      injection_map: injectionMapData,
 
      updatedAt: serverTimestamp()
    };
 
    const ref = doc(db, "parents", currentUser.uid, "children", childId);
    await setDoc(ref, payload, { merge: true }); 
    
    alert('تم حفظ الملف الطبي بنجاح! 🚀');
    window.location.href = `child.html?child=${childId}`;
  } catch (e) {
    alert('حدث خطأ أثناء الحفظ.'); console.error(e);
  } finally {
    $('#loader').classList.add('hidden');
  }
}
