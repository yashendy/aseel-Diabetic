// js/child-edit.js v3 — يحمّل بيانات الطفل ويحدّثها لتتوافق مع صفحة الوجبات
// - يحفظ carbTargets (breakfast/lunch/dinner/snack)
// - يحفظ glucoseUnit (mgdl|mmol)
// - يحافظ على باقي الحقول الموجودة سلفًا

import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const form = document.getElementById('form');
const childLabel = document.getElementById('childLabel');
const loader = document.getElementById('loader');
const toastEl = document.getElementById('toast');

const nameEl = document.getElementById('name');
const genderEl = document.getElementById('gender');
const birthDateEl = document.getElementById('birthDate');
const weightKgEl = document.getElementById('weightKg');
const heightCmEl = document.getElementById('heightCm');

const rangeMinEl = document.getElementById('rangeMin');
const rangeMaxEl = document.getElementById('rangeMax');
const carbRatioEl = document.getElementById('carbRatio');
const correctionFactorEl = document.getElementById('correctionFactor');
const severeLowEl = document.getElementById('severeLow');
const severeHighEl = document.getElementById('severeHigh');

const deviceNameEl = document.getElementById('deviceName');
const basalTypeEl = document.getElementById('basalType');
const bolusTypeEl = document.getElementById('bolusType');

const brMinEl = document.getElementById('brMin'); const brMaxEl = document.getElementById('brMax');
const luMinEl = document.getElementById('luMin'); const luMaxEl = document.getElementById('luMax');
const diMinEl = document.getElementById('diMin'); const diMaxEl = document.getElementById('diMax');
const snMinEl = document.getElementById('snMin'); const snMaxEl = document.getElementById('snMax');

const unitRadios = document.querySelectorAll('input[name="unit"]');

const useNetCarbsEl = document.getElementById('useNetCarbs');
const netCarbRuleEl = document.getElementById('netCarbRule');

const deleteBtn = document.getElementById('deleteBtn');

/* حالة */
let currentUser, childRef, childData;

function showToast(msg){
  toastEl.innerHTML = `<div class="msg">${escapeHTML(msg)}</div>`;
  toastEl.classList.remove('hidden');
  setTimeout(()=> toastEl.classList.add('hidden'), 2200);
}
function escapeHTML(s){ return (s||'').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'","&#039;"); }
function busy(b){ loader.classList.toggle('hidden', !b); }

/* جلسة */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }
  currentUser = user;
  childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  busy(true);
  try{
    const snap = await getDoc(childRef);
    if (!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
    childData = snap.data();
    fillForm(childData);
  }catch(e){
    console.error(e); alert('تعذر تحميل البيانات');
  }finally{
    busy(false);
  }
});

/* تعبئة النموذج */
function fillForm(d){
  childLabel.textContent = d?.name ? `(${d.name})` : '—';

  nameEl.value = d?.name || '';
  genderEl.value = d?.gender || '';
  birthDateEl.value = d?.birthDate || '';
  weightKgEl.value = valOrEmpty(d?.weightKg);
  heightCmEl.value = valOrEmpty(d?.heightCm);

  rangeMinEl.value = valOrEmpty(d?.normalRange?.min);
  rangeMaxEl.value = valOrEmpty(d?.normalRange?.max);
  carbRatioEl.value = valOrEmpty(d?.carbRatio);
  correctionFactorEl.value = valOrEmpty(d?.correctionFactor);
  severeLowEl.value = valOrEmpty(d?.severeLow);
  severeHighEl.value = valOrEmpty(d?.severeHigh);

  deviceNameEl.value = d?.deviceName || '';
  basalTypeEl.value = d?.basalType || '';
  bolusTypeEl.value = d?.bolusType || '';

  const t = d?.carbTargets || {};
  brMinEl.value = valOrEmpty(t.breakfast?.min); brMaxEl.value = valOrEmpty(t.breakfast?.max);
  luMinEl.value = valOrEmpty(t.lunch?.min);     luMaxEl.value = valOrEmpty(t.lunch?.max);
  diMinEl.value = valOrEmpty(t.dinner?.min);    diMaxEl.value = valOrEmpty(t.dinner?.max);
  snMinEl.value = valOrEmpty(t.snack?.min);     snMaxEl.value = valOrEmpty(t.snack?.max);

  const unit = d?.glucoseUnit || 'mgdl';
  unitRadios.forEach(r=> r.checked = (r.value===unit));

  useNetCarbsEl.checked = !!d?.useNetCarbs;
  netCarbRuleEl.value = d?.netCarbRule || 'fullFiber';
}

function valOrEmpty(x){ return (x===0 || x) ? x : ''; }
function toNum(x){ const n = Number(String(x||'').replace(',','.')); return isNaN(n)? null : n; }
function clampMin0(n){ return (n==null || n<0) ? 0 : n; }

/* حفظ */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const payload = {
    name: nameEl.value?.trim() || null,
    gender: genderEl.value || null,
    birthDate: birthDateEl.value || null,
    weightKg: toNum(weightKgEl.value),
    heightCm: toNum(heightCmEl.value),

    normalRange: {
      min: toNum(rangeMinEl.value),
      max: toNum(rangeMaxEl.value)
    },
    carbRatio: toNum(carbRatioEl.value),
    correctionFactor: toNum(correctionFactorEl.value),
    severeLow: toNum(severeLowEl.value),
    severeHigh: toNum(severeHighEl.value),

    deviceName: deviceNameEl.value?.trim() || null,
    basalType: basalTypeEl.value?.trim() || null,
    bolusType: bolusTypeEl.value?.trim() || null,

    carbTargets: {
      breakfast: rangeObj(brMinEl.value, brMaxEl.value),
      lunch:     rangeObj(luMinEl.value, luMaxEl.value),
      dinner:    rangeObj(diMinEl.value, diMaxEl.value),
      snack:     rangeObj(snMinEl.value, snMaxEl.value)
    },
    glucoseUnit: (Array.from(unitRadios).find(r=>r.checked)?.value) || 'mgdl',

    useNetCarbs: !!useNetCarbsEl.checked,
    netCarbRule: netCarbRuleEl.value || 'fullFiber'
  };

  // نظّف بعض القيم: حوّل null/undefined لأصفار حيث يلزم
  if (payload.carbTargets.breakfast) { payload.carbTargets.breakfast.min = clampMin0(payload.carbTargets.breakfast.min); payload.carbTargets.breakfast.max = clampMin0(payload.carbTargets.breakfast.max); }
  if (payload.carbTargets.lunch)     { payload.carbTargets.lunch.min     = clampMin0(payload.carbTargets.lunch.min);     payload.carbTargets.lunch.max     = clampMin0(payload.carbTargets.lunch.max); }
  if (payload.carbTargets.dinner)    { payload.carbTargets.dinner.min    = clampMin0(payload.carbTargets.dinner.min);    payload.carbTargets.dinner.max    = clampMin0(payload.carbTargets.dinner.max); }
  if (payload.carbTargets.snack)     { payload.carbTargets.snack.min     = clampMin0(payload.carbTargets.snack.min);     payload.carbTargets.snack.max     = clampMin0(payload.carbTargets.snack.max); }

  busy(true);
  try{
    await updateDoc(childRef, payload);
    showToast('✅ تم حفظ التعديلات');
  }catch(e){
    console.error(e); alert('تعذر حفظ التعديلات');
  }finally{
    busy(false);
  }
});

function rangeObj(min,max){
  const a = toNum(min), b = toNum(max);
  if (a==null && b==null) return null;
  return { min: a==null? 0 : a, max: b==null? 0 : b };
}

/* حذف الطفل */
deleteBtn?.addEventListener('click', async ()=>{
  if (!confirm('هل تريدين حذف هذا الطفل؟ لا يمكن التراجع.')) return;
  busy(true);
  try{
    await deleteDoc(childRef);
    showToast('🗑️ تم حذف الطفل');
    setTimeout(()=> location.href='index.html', 1200);
  }catch(e){
    console.error(e); alert('تعذر حذف الطفل');
  }finally{
    busy(false);
  }
});
