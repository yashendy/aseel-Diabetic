import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const form = $('form');
const loader = $('loader');
const childLabel = $('childLabel');

const nameEl = $('name');
const genderEl = $('gender');
const birthDateEl = $('birthDate');
const weightKgEl = $('weightKg');
const heightCmEl = $('heightCm');

const rangeMinEl = $('rangeMin');
const rangeMaxEl = $('rangeMax');
const carbRatioEl = $('carbRatio');
const correctionFactorEl = $('correctionFactor');
const severeLowEl = $('severeLow');
const severeHighEl = $('severeHigh');

const deviceNameEl = $('deviceName');
const basalTypeEl = $('basalType');
const bolusTypeEl = $('bolusType');

// الحقول الجديدة
const useNetCarbsEl = $('useNetCarbs');
const netCarbRuleEl = $('netCarbRule');

const params = new URLSearchParams(location.search);
const childId = params.get('child');

function showLoader(b){ loader.classList.toggle('show', !!b); }

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); history.back(); return; }

  try{
    showLoader(true);
    const ref = doc(db, `parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(ref);
    if(!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
    const c = snap.data();

    // ملء البيانات
    childLabel.textContent = c.name || '—';
    nameEl.value = c.name || '';
    genderEl.value = c.gender || '';
    birthDateEl.value = c.birthDate || '';
    weightKgEl.value = c.weightKg ?? '';
    heightCmEl.value = c.heightCm ?? '';

    rangeMinEl.value = c.normalRange?.min ?? '';
    rangeMaxEl.value = c.normalRange?.max ?? '';
    carbRatioEl.value = c.carbRatio ?? '';
    correctionFactorEl.value = c.correctionFactor ?? '';
    severeLowEl.value  = c.severeLow  ?? '';
    severeHighEl.value = c.severeHigh ?? '';

    deviceNameEl.value = c.deviceName || c.device?.name || '';
    basalTypeEl.value = c.insulin?.basalType || c.insulinBasalType || '';
    bolusTypeEl.value = c.insulin?.bolusType || c.insulinBolusType || '';

    // الإعدادات الجديدة
    useNetCarbsEl.checked = (c.useNetCarbs !== false);
    netCarbRuleEl.value = c.netCarbRule || 'fullFiber';

    // حفظ
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      try{
        showLoader(true);

        const payload = {
          name: nameEl.value.trim(),
          gender: genderEl.value || null,
          birthDate: birthDateEl.value || null,
          weightKg: weightKgEl.value ? Number(weightKgEl.value) : null,
          heightCm: heightCmEl.value ? Number(heightCmEl.value) : null,
          normalRange: {
            min: rangeMinEl.value ? Number(rangeMinEl.value) : null,
            max: rangeMaxEl.value ? Number(rangeMaxEl.value) : null,
          },
          carbRatio: carbRatioEl.value ? Number(carbRatioEl.value) : null,
          correctionFactor: correctionFactorEl.value ? Number(correctionFactorEl.value) : null,
          severeLow:  severeLowEl.value  ? Number(severeLowEl.value)  : null,
          severeHigh: severeHighEl.value ? Number(severeHighEl.value) : null,
          deviceName: deviceNameEl.value.trim() || null,
          insulin: {
            basalType: basalTypeEl.value.trim() || null,
            bolusType: bolusTypeEl.value.trim() || null,
          },
          // الحقول الجديدة
          useNetCarbs: useNetCarbsEl.checked,
          netCarbRule: netCarbRuleEl.value || 'fullFiber',
          updatedAt: new Date().toISOString()
        };

        await updateDoc(ref, payload);
        alert('✅ تم حفظ التعديلات بنجاح');
        history.back();
      }catch(err){
        console.error(err);
        alert('تعذر الحفظ. تأكدي من الاتصال بالإنترنت.');
      }finally{
        showLoader(false);
      }
    });

    // حذف الطفل
    $('deleteBtn').addEventListener('click', async ()=>{
      if(!confirm('هل أنتِ متأكدة من حذف الطفل؟')) return;
      try{
        showLoader(true);
        await deleteDoc(ref);
        alert('تم حذف الطفل.');
        location.href = 'parent.html';
      }catch(err){
        console.error(err);
        alert('تعذر الحذف.');
      }finally{
        showLoader(false);
      }
    });

  }catch(err){
    console.error(err);
    alert('تعذر تحميل البيانات.');
  }finally{
    showLoader(false);
  }
});
