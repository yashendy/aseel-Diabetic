// js/child-edit.js
import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const getParam = name => new URLSearchParams(location.search).get(name) || "";

let currentUser = null;
const childId = getParam("id") || localStorage.getItem('selectedChildId');

// خريطة حالات مناطق الحقن
const STATES = ['normal', 'rest', 'lump'];
let injectionMapData = {}; 

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  
  initChipInputs();
  initInjectionMap();
  await loadChildData();
  
  $('#btnSave').addEventListener('click', saveChildData);
});

// إعداد خريطة الحقن التفاعلية
function initInjectionMap() {
  $$('.zone').forEach(zone => {
    // تعيين الحالة الافتراضية
    zone.setAttribute('data-state', 'normal');
    
    // عند الضغط، تتبدل الحالة (سليم -> إراحة -> تكتل)
    zone.addEventListener('click', () => {
      const zoneId = zone.getAttribute('data-zone');
      let currentState = zone.getAttribute('data-state');
      let nextIndex = (STATES.indexOf(currentState) + 1) % STATES.length;
      let nextState = STATES[nextIndex];
      
      zone.setAttribute('data-state', nextState);
      injectionMapData[zoneId] = nextState;
    });
  });
}

// إعداد حقول الـ Tags
function initChipInputs() {
  $$('.chip-input-wrap').forEach(wrap => {
    const input = wrap.querySelector('input');
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

function getChips(wrapId) {
  return $$(`#${wrapId} .ui-chip`).map(c => c.textContent.replace('×','').trim());
}

function setChips(wrapId, valuesArray) {
  const list = $(`#${wrapId} .chip-list`);
  list.innerHTML = '';
  (valuesArray || []).forEach(v => addChip(list, v));
}

// تحميل البيانات
async function loadChildData() {
  $('#loader').classList.remove('hidden');
  try {
    const ref = doc(db, "parents", currentUser.uid, "children", childId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data();

    // البيانات الشخصية والأنسولين
    $('#f_name').value = d.name || '';
    $('#f_weight').value = d.weight || '';
    $('#f_unit').value = d.glucoseUnit || 'mg/dL';
    $('#f_basal').value = d.insulin?.basal || d.basalType || '';
    $('#f_bolus').value = d.insulin?.bolus || d.bolusType || '';
    
    // CF و CR الجديد
    $('#f_cf').value = d.cf || d.correctionFactor || '';
    if(d.cr) {
      $('#cr_b').value = d.cr.breakfast || '';
      $('#cr_l').value = d.cr.lunch || '';
      $('#cr_d').value = d.cr.dinner || '';
      $('#cr_s').value = d.cr.snack || '';
    }

    // حدود السكر (الـ 5 الجديدة)
    if(d.glucose_limits) {
      $('#gl_crit_low').value = d.glucose_limits.critical_low || '';
      $('#gl_low').value = d.glucose_limits.low || '';
      $('#gl_target').value = d.glucose_limits.target || '';
      $('#gl_high').value = d.glucose_limits.high || '';
      $('#gl_crit_high').value = d.glucose_limits.critical_high || '';
    }

    // إعداد الـ Tags
    setChips('allergiesWrap', d.allergies);
    
    // الأنظمة الغذائية
    const diet = d.dietaryFlags || [];
    $$('.diet-flag').forEach(cb => cb.checked = diet.includes(cb.value));

    // تعبئة خريطة الحقن (استرجاع الحالات المحفوظة)
    if (d.injection_map) {
      injectionMapData = d.injection_map;
      $$('.zone').forEach(zone => {
        const zoneId = zone.getAttribute('data-zone');
        if(injectionMapData[zoneId]) {
          zone.setAttribute('data-state', injectionMapData[zoneId]);
        }
      });
    }

  } catch (e) { console.error(e); }
  finally { $('#loader').classList.add('hidden'); }
}

// حفظ البيانات بالتنظيم الجديد (Schema Update)
async function saveChildData() {
  $('#loader').classList.remove('hidden');
  try {
    const payload = {
      name: $('#f_name').value,
      weight: Number($('#f_weight').value) || null,
      glucoseUnit: $('#f_unit').value,
      insulin: { basal: $('#f_basal').value, bolus: $('#f_bolus').value },
      
      // التعديلات الجوهرية (CF موحد و CR مفصل)
      cf: Number($('#f_cf').value) || null,
      cr: {
        breakfast: Number($('#cr_b').value) || null,
        lunch: Number($('#cr_l').value) || null,
        dinner: Number($('#cr_d').value) || null,
        snack: Number($('#cr_s').value) || null
      },
      
      // الحدود الخمسة
      glucose_limits: {
        critical_low: Number($('#gl_crit_low').value) || null,
        low: Number($('#gl_low').value) || null,
        target: Number($('#gl_target').value) || null,
        high: Number($('#gl_high').value) || null,
        critical_high: Number($('#gl_crit_high').value) || null
      },

      allergies: getChips('allergiesWrap'),
      dietaryFlags: $$('.diet-flag').filter(c => c.checked).map(c => c.value),
      
      // خريطة الحقن التفاعلية
      injection_map: injectionMapData,

      updatedAt: serverTimestamp()
    };

    const ref = doc(db, "parents", currentUser.uid, "children", childId);
    await setDoc(ref, payload, { merge: true }); // Merge للحفاظ على البيانات التاريخية
    
    alert('تم حفظ إعدادات الطفل بنجاح! قاعدة البيانات الموحدة أصبحت جاهزة ✅');
    window.location.href = `child.html?child=${childId}`;
  } catch (e) {
    alert('حدث خطأ أثناء الحفظ.'); console.error(e);
  } finally {
    $('#loader').classList.add('hidden');
  }
}
