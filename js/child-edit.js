// js/child-edit.js
import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const getParam = name => new URLSearchParams(location.search).get(name) || "";

let currentUser = null;
const childId = getParam("id") || localStorage.getItem('selectedChildId');

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  initChipInputs(); // تشغيل حقول الإدخال الذكية
  await loadChildData();
  
  $('#btnSave').addEventListener('click', saveChildData);
});

// إعداد حقول الـ Tags (الحساسيات، وأماكن الحقن)
function initChipInputs() {
  $$('.chip-input-wrap').forEach(wrap => {
    const input = wrap.querySelector('input');
    const list = wrap.querySelector('.chip-list');
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/,/g, '');
        if (val) {
          addChip(list, val);
          input.value = '';
        }
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

    $('#f_name').value = d.name || '';
    $('#f_birthDate').value = d.birthDate || '';
    $('#f_gender').value = d.gender || '';
    $('#f_unit').value = d.glucoseUnit || 'mg/dL';
    $('#f_weightKg').value = d.weight || '';
    
    // الأنسولين والمعاملات
    $('#f_carbRatio').value = d.carbRatio || '';
    $('#f_correctionFactor').value = d.correctionFactor || '';
    $('#f_basalType').value = d.basalType || '';
    $('#f_bolusType').value = d.bolusType || '';
    
    // الحدود
    $('#f_hypo').value = d.hypoLevel || '';
    $('#f_hyper').value = d.hyperLevel || '';

    // إعداد الـ Tags
    setChips('allergiesWrap', d.allergies);
    setChips('injectionWrap', d.injectionSites);
    
    // الأنظمة الغذائية
    const diet = d.dietaryFlags || [];
    $$('.diet-flag').forEach(cb => cb.checked = diet.includes(cb.value));

  } catch (e) { console.error(e); }
  finally { $('#loader').classList.add('hidden'); }
}

// حفظ البيانات
async function saveChildData() {
  $('#loader').classList.remove('hidden');
  try {
    const payload = {
      name: $('#f_name').value,
      birthDate: $('#f_birthDate').value,
      gender: $('#f_gender').value,
      glucoseUnit: $('#f_unit').value,
      weight: Number($('#f_weightKg').value) || null,
      carbRatio: Number($('#f_carbRatio').value) || null,
      correctionFactor: Number($('#f_correctionFactor').value) || null,
      basalType: $('#f_basalType').value,
      bolusType: $('#f_bolusType').value,
      hypoLevel: Number($('#f_hypo').value) || null,
      hyperLevel: Number($('#f_hyper').value) || null,
      allergies: getChips('allergiesWrap'),
      injectionSites: getChips('injectionWrap'),
      dietaryFlags: $$('.diet-flag').filter(c => c.checked).map(c => c.value),
      updatedAt: serverTimestamp()
    };

    // إزالة الحقول الفارغة
    Object.keys(payload).forEach(k => payload[k] == null && delete payload[k]);

    const ref = doc(db, "parents", currentUser.uid, "children", childId);
    await setDoc(ref, payload, { merge: true });
    
    alert('تم حفظ إعدادات الطفل بنجاح! ✅');
    window.location.href = `child.html?child=${childId}`;
  } catch (e) {
    alert('حدث خطأ أثناء الحفظ.');
    console.error(e);
  } finally {
    $('#loader').classList.add('hidden');
  }
}
