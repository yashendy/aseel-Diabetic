/* ========================= child-edit.js (FULL) =========================
   - Loads child doc, fills the form
   - Saves child doc with dietaryFlags + specialDiet mirror
   - Saves preferred / disliked if widgets are present
   - Defensive against missing elements / RTL glyphs / trailing commas
   - Firebase v9 modular style
========================================================================= */

/* ===== Imports (assumes you already initialize firebase app elsewhere) ===== */
// If your project uses global firebase, comment these imports and use window.firebase
import {
  getFirestore, doc, getDoc, setDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

/* ===== Config (you can change these selectors/IDs to your actual DOM) ===== */
const db = getFirestore();

/** Helpers to get DOM values safely */
function $(id) { return document.getElementById(id); }
function valNum(id) {
  const v = $(id)?.value?.toString().trim();
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function valStr(id) {
  const v = $(id)?.value;
  return (v == null ? '' : String(v)).trim();
}

/** Chips widgets (optional): expected to expose .get() that returns string[] */
function getWidgetValues(widgetRef) {
  try {
    if (widgetRef && typeof widgetRef.get === 'function') return widgetRef.get();
  } catch {}
  return [];
}

/* ===== Diet flags collection from checkboxes (customize if needed) ===== */
function collectDietFlags() {
  // Expect checkboxes with name="diet-flag" and value codes e.g. halal, vegetarian, ...
  const boxes = document.querySelectorAll('input[name="diet-flag"]');
  const out = [];
  boxes.forEach(b => { if (b.checked && b.value) out.push(b.value); });
  return out;
}

/* ===== Build payload safely (single source of truth) ===== */
function buildChildPayloadSafe() {
  const flags = collectDietFlags();

  const payload = {
    /* Basic identity */
    name:         valStr('childName'),
    gender:       valStr('childGender'),
    birthDate:    valStr('childBirthDate'),
    glucoseUnit:  valStr('childGlucoseUnit'),
    nationalId:   valStr('childNationalId'),

    /* Body measurements */
    height:       valNum('childHeight'),
    weight:       valNum('childWeight'),

    /* Preferences (widgets are optional) */
    preferred:    getWidgetValues(window.preferred),
    disliked:     getWidgetValues(window.disliked),

    /* Diet flags: source + mirror for backward compatibility */
    dietaryFlags: flags,
    specialDiet:  flags,

    /* Timestamp */
    updatedAt:    new Date().toISOString()
  };

  // Remove explicit nulls that Firestore may not need
  Object.keys(payload).forEach(k => {
    if (payload[k] === undefined) delete payload[k];
  });

  return payload;
}

/* ===== Fill form from doc data (defensive) ===== */
function setVal(id, v) { if ($(id)) $(id).value = (v ?? ''); }
function checkDietFlags(flags=[]) {
  const set = new Set(Array.isArray(flags) ? flags : []);
  document.querySelectorAll('input[name="diet-flag"]').forEach(b => {
    b.checked = set.has(b.value);
  });
}

async function fillFormFromDoc(parentId, childId) {
  try {
    const ref = doc(db, 'parents', parentId, 'children', childId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.warn('Child doc not found');
      return;
    }
    const d = snap.data() || {};

    setVal('childName',        d.name);
    setVal('childGender',      d.gender);
    setVal('childBirthDate',   d.birthDate);
    setVal('childGlucoseUnit', d.glucoseUnit);
    setVal('childNationalId',  d.nationalId);

    if ($( 'childHeight')) $( 'childHeight').value = d.height ?? '';
    if ($( 'childWeight')) $( 'childWeight').value = d.weight ?? '';

    const flags = Array.isArray(d.dietaryFlags) ? d.dietaryFlags :
                  (Array.isArray(d.specialDiet) ? d.specialDiet : []);
    checkDietFlags(flags);

    // If your preferred/disliked widgets support .set(array)
    try { if (window.preferred && typeof preferred.set === 'function') preferred.set(d.preferred || []); } catch {}
    try { if (window.disliked  && typeof disliked.set  === 'function') disliked.set (d.disliked  || []); } catch {}

  } catch (e) {
    console.error('fillFormFromDoc error', e);
  }
}

/* ===== Save handlers ===== */
async function saveChild(parentId, childId) {
  const ref = doc(db, 'parents', parentId, 'children', childId);
  const payload = buildChildPayloadSafe();
  // merge = true to avoid overwriting other sub-objects unintentionally
  await setDoc(ref, payload, { merge: true });
  toastOk('تم حفظ بيانات الطفل');
  return payload;
}

function toastOk(msg) {
  try {
    if (window.Toastify) {
      window.Toastify({ text: msg, gravity: 'top', position: 'center', className: 'toast-ok' }).showToast();
    } else {
      console.log('✓', msg);
    }
  } catch { console.log('✓', msg); }
}

/* ===== Wire up events ===== */
function initChildEditPage() {
  // Read parentId & childId from URL or a data-* attribute
  const parentId = document.body.dataset.parentId || window.PARENT_ID || '';
  const childId  = document.body.dataset.childId  || window.CHILD_ID  || '';
  if (!parentId || !childId) {
    console.warn('Missing parentId/childId');
  } else {
    fillFormFromDoc(parentId, childId);
  }

  // Save button
  const saveBtn = $('saveChildBtn') || document.querySelector('[data-action="save-child"]');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        await saveChild(parentId, childId);
      } catch (e) {
        console.error('Save error', e);
        alert('حدث خطأ أثناء الحفظ، حاول مرة أخرى');
      }
    });
  }

  // When any diet-flag changes, we could auto-save or just mark dirty
  document.querySelectorAll('input[name="diet-flag"]').forEach(b => {
    b.addEventListener('change', () => {
      // markDirtyUI(); // optional
    });
  });
}

/* ===== Kick-off on DOM ready ===== */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChildEditPage);
} else {
  initChildEditPage();
}

/* ======================= END child-edit.js (FULL) ======================= */
