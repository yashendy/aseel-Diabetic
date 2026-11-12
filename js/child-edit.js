// js/child-edit.js
import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc, collection, addDoc, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { MGDL_PER_MMOL, getProtocol, buildProtocolPatch, toMergeData } from "./child-protocol.js";

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const getParam = name => new URLSearchParams(location.search).get(name) || "";

let currentUser = null;
let loadedChildData = {}; // نحتفظ بالبيانات الحالية للمقارنة وبناء التحديث الموحد
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
  initUnitSmartSwitch();
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
  
  const glucoseFields = ['gl_target', 'gl_low', 'gl_high', 'gl_crit_low', 'gl_crit_high', 'f_cf'];
  
  const placeholders = {
    'mg/dL': { gl_target: '100', gl_low: '70', gl_high: '180', gl_crit_low: '54', gl_crit_high: '250', f_cf: '50' },
    'mmol/L': { gl_target: '5.5', gl_low: '3.9', gl_high: '10.0', gl_crit_low: '3.0', gl_crit_high: '13.9', f_cf: '3' }
  };

  let previousUnit = unitSelect.value || 'mg/dL';

  unitSelect.addEventListener('change', (e) => {
    const newUnit = e.target.value;
    
    // 1. تحديث الأمثلة الباهتة (Placeholders)
    glucoseFields.forEach(id => {
      const input = $(`#${id}`);
      if (input) input.placeholder = `مثال: ${placeholders[newUnit]?.[id] || ''}`;
    });

    // 2. التحويل التلقائي للأرقام المكتوبة بالفعل
    if (previousUnit !== newUnit) {
      glucoseFields.forEach(id => {
        const input = $(`#${id}`);
        if (input && input.value) {
          let val = parseFloat(input.value);
          if (!isNaN(val)) {
            if (newUnit === 'mmol/L' && previousUnit === 'mg/dL') {
              input.value = (val / MGDL_PER_MMOL).toFixed(1);
            } else if (newUnit === 'mg/dL' && previousUnit === 'mmol/L') {
              input.value = Math.round(val * MGDL_PER_MMOL);
            }
          }
        }
      });
      previousUnit = newUnit;
    }
  });

  unitSelect.dispatchEvent(new Event('change'));
}

// === 5. تحميل البيانات عبر البروتوكول الموحد ===
async function loadChildData() {
  $('#loader').classList.remove('hidden');
  try {
    const ref = doc(db, "parents", currentUser.uid, "children", childId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data();
    loadedChildData = d;
    const p = getProtocol(d);

    // الهوية والنمو
    $('#f_name').value = d.identity?.name || d.name || '';
    $('#f_civil').value = d.identity?.civilId || d.nationalId || '';

    // بيانات ولي الأمر للطوارئ
    const ec = d.emergencyContact || {};
    $('#f_em_name').value = ec.name || d.parentName || currentUser.displayName || '';
    $('#f_em_rel').value = ec.relation || '';
    let ph = ec.phone || d.parentPhone || '';
    if (!ph) {
      try {
        const us = await getDoc(doc(db, 'users', currentUser.uid));
        ph = us.exists() ? (us.data().phone || '') : '';
      } catch (err) { /* نتجاهل */ }
    }
    $('#f_em_phone').value = ph;
    $('#f_dob').value = d.identity?.dob || d.birthDate || '';
    $('#f_gender').value = d.identity?.gender || d.gender || 'female';
    $('#f_diagnosis_date').value = d.medical_history?.diagnosisDate || '';
    
    $('#f_weight').value = p.weightKg ?? '';
    $('#f_height').value = p.heightCm ?? '';
    $('#f_measure_date').value = d.vitals?.measurementDate || '';
    $('#f_weight').dispatchEvent(new Event('input'));

    // الأمراض المصاحبة
    const comorb = d.medical_history?.comorbidities || [];
    $$('.comorb-flag').forEach(cb => cb.checked = comorb.includes(cb.value));

    // الأنسولين والمعاملات (من البروتوكول الموحد)
    $('#f_unit').value = p.unit;
    $('#f_unit').dispatchEvent(new Event('change')); // يضبط previousUnit والأمثلة قبل تعبئة الأرقام
    
    $('#f_basal').value = p.insulin.basal || '';
    if ($('#f_basal_dose')) $('#f_basal_dose').value = p.insulin.basalDose ?? '';
    $('#f_bolus').value = p.insulin.bolus || '';
    $('#f_cf').value = p.CF ?? '';
    if ($('#f_step')) $('#f_step').value = String(p.safety.step || 0.5);
    if ($('#f_maxdose')) $('#f_maxdose').value = p.safety.maxDose ?? '';
    if ($('#f_dia')) $('#f_dia').value = d.diaHours ?? '';
    if ($('#f_hypocarbs')) $('#f_hypocarbs').value = d.hypoCarbs ?? '';
    if ($('#f_netrule')) $('#f_netrule').value = p.safety.netCarbRule || 'fullFiber';
    
    $('#cr_b').value = p.CR.breakfast ?? '';
    $('#cr_l').value = p.CR.lunch ?? '';
    $('#cr_d').value = p.CR.dinner ?? '';
    $('#cr_s').value = p.CR.snack ?? '';

    // الحدود الهرمية
    const rawLim = d.glucose_limits || {};
    $('#gl_crit_low').value = rawLim.critical_low ?? '';
    $('#gl_low').value = rawLim.low ?? '';
    $('#gl_target').value = p.target ?? '';
    $('#gl_high').value = rawLim.high ?? '';
    $('#gl_crit_high').value = rawLim.critical_high ?? '';

    // الحساسيات والأنظمة
    setChips('allergiesWrap', d.diet?.allergies || d.allergies);
    const dietFlags = d.diet?.flags || d.dietaryFlags || [];
    $$('.diet-flag').forEach(cb => cb.checked = dietFlags.includes(cb.value));

    // خريطة الحقن
    if (d.injection_map) {
      injectionMapData = d.injection_map;
      $$('.zone').forEach(zone => {
        const zoneId = zone.getAttribute('data-zone');
        if (injectionMapData[zoneId]) zone.setAttribute('data-state', injectionMapData[zoneId]);
      });
    }

  } catch (e) { console.error(e); }
  finally { $('#loader').classList.add('hidden'); }
}

// === 6. التحقق والحفظ بالبروتوكول الموحد ===
function normalizePhone(v) {
  return String(v || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s\-().]/g, '').replace(/^00/, '+');
}

function normalizeCivil(v) {
  return String(v || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s\-]/g, '');
}

async function saveChildData() {
  const civil = normalizeCivil($('#f_civil')?.value);
  const emPhone = normalizePhone($('#f_em_phone')?.value);
  if (emPhone && !/^\+?\d{7,15}$/.test(emPhone)) {
    alert('⛔ رقم هاتف ولي الأمر غير صحيح. اكتب أرقاماً فقط (من 7 إلى 15 رقماً) ويمكن أن يبدأ بـ +.');
    return;
  }
  if (civil && !/^\d{6,20}$/.test(civil)) {
    alert('⛔ الرقم المدني يجب أن يكون أرقاماً فقط (من 6 إلى 20 رقماً)، أو اتركه فارغاً.');
    return;
  }

  // بناء وفحص إعدادات البروتوكول عبر child-protocol.js
  const patch = buildProtocolPatch(loadedChildData, {
    glucoseUnit: $('#f_unit')?.value,
    cf: $('#f_cf')?.value,
    cr: {
      breakfast: $('#cr_b')?.value,
      lunch: $('#cr_l')?.value,
      dinner: $('#cr_d')?.value,
      snack: $('#cr_s')?.value
    },
    limits: {
      critical_low: $('#gl_crit_low')?.value,
      low: $('#gl_low')?.value,
      target: $('#gl_target')?.value,
      high: $('#gl_high')?.value,
      critical_high: $('#gl_crit_high')?.value
    },
    insulin: {
      basal: $('#f_basal')?.value,
      bolus: $('#f_bolus')?.value
    },
    basalDose: $('#f_basal_dose')?.value,
    insulinStep: $('#f_step')?.value,
    maxDose: $('#f_maxdose')?.value,
    diaHours: $('#f_dia')?.value,
    hypoCarbs: $('#f_hypocarbs')?.value,
    netCarbRule: $('#f_netrule')?.value,
    weight: $('#f_weight')?.value,
    height: $('#f_height')?.value,
    measurementDate: $('#f_measure_date')?.value
  }, { allowUnitChange: true });

  if (patch.errors.length) {
    alert('⛔ ' + patch.errors.join('\n'));
    return;
  }

  // فحص المعاملات الناقصة لتنبيه ولي الأمر قبل الحفظ
  const n = id => { const v = parseFloat($(id)?.value); return Number.isFinite(v) && v > 0 ? v : null; };
  const missing = [];
  if (!n('#f_cf')) missing.push('معامل التصحيح CF');
  if (!n('#gl_target')) missing.push('هدف السكر');
  [['#cr_b', 'CR الفطار'], ['#cr_l', 'CR الغداء'], ['#cr_d', 'CR العشاء'], ['#cr_s', 'CR السناك']].forEach(([id, l]) => { if (!n(id)) missing.push(l); });
  if (missing.length && !confirm(`⚠️ بيانات ناقصة: ${missing.join('، ')}.\nحاسبة الجرعات لن تقترح جرعة للبيانات الناقصة حتى تكتمل.\nهل تريدين الحفظ رغم ذلك؟`)) return;

  $('#loader').classList.remove('hidden');
  try {
    const protocolPayload = toMergeData(patch, deleteField);

    const payload = {
      ...protocolPayload,
      // 1. الهوية
      identity: {
        name: $('#f_name').value,
        civilId: civil,
        dob: $('#f_dob').value,
        gender: $('#f_gender').value
      },
      name: $('#f_name').value,
      // 1-ب. بيانات ولي الأمر للتواصل في الطوارئ
      emergencyContact: {
        name: ($('#f_em_name').value || '').trim(),
        phone: emPhone,
        relation: $('#f_em_rel').value
      },
      civilId: deleteField(),
      nationalId: deleteField(),
      
      // 2. التاريخ المرضي
      medical_history: {
        diagnosisDate: $('#f_diagnosis_date').value,
        comorbidities: $$('.comorb-flag').filter(c => c.checked).map(c => c.value)
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

    // تسجيل التعديلات العلاجية في سجل التغييرات (regimen_history)
    if (patch.changes.length) {
      try {
        await addDoc(collection(ref, "regimen_history"), {
          at: serverTimestamp(),
          by: currentUser.uid,
          byRole: 'parent',
          byName: currentUser.displayName || ($('#f_em_name').value || 'ولي الأمر').trim(),
          changes: patch.changes
        });
      } catch (err) { console.warn('regimen_history log:', err); }
    }

    // نحفظ الهاتف أيضاً في حساب ولي الأمر ليُملأ تلقائياً لأي طفل جديد
    if (emPhone) {
      try { await setDoc(doc(db, 'users', currentUser.uid), { phone: emPhone, updatedAt: serverTimestamp() }, { merge: true }); }
      catch (err) { console.warn('users phone sync:', err); }
    }
    
    alert('تم حفظ الملف الطبي بنجاح! 🚀');
    window.location.href = `child.html?child=${childId}`;
  } catch (e) {
    alert('حدث خطأ أثناء الحفظ.'); console.error(e);
  } finally {
    $('#loader').classList.add('hidden');
  }
}
