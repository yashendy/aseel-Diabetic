// js/child-edit.js
import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const getParam = name => new URLSearchParams(location.search).get(name) || "";

let currentUser = null;
const childId = getParam("id") || localStorage.getItem('selectedChildId');

// حالات خريطة الحقن
const STATES = ['normal', 'rest', 'lump'];
let injectionMapData = {}; 

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  
  initChipInputs();
  initInjectionMap();
  initBMICalculator();
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
  chip.innerHTML = `${text} <button type="button">&times;</button>`;
  chip.querySelector('button').onclick = () => chip.remove();
  listEl.appendChild(chip);
}

function getChips(wrapId) { return $$(`#${wrapId} .ui-chip`).map(c => c.textContent.replace('×','').trim()); }
function setChips(wrapId, valuesArray) {
  const list = $(`#${wrapId} .chip-list`);
  list.innerHTML = '';
  (valuesArray || []).forEach(v => addChip(list, v));
}

// === 4. تحميل البيانات ===
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
    $('#f_basal').value = d.insulin?.basal || d.basalType || '';
    $('#f_bolus').value = d.insulin?.bolus || d.bolusType || '';
    $('#f_cf').value = d.cf || d.correctionFactor || '';
    
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

// === 5. الحفظ بالهيكل الجديد المُحسّن ===
async function saveChildData() {
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
      insulin: { basal: $('#f_basal').value, bolus: $('#f_bolus').value },
      cf: Number($('#f_cf').value) || null,
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
