// js/meals.js
console.log("✅ [meals] module loaded v2026.03.01");

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, addDoc, serverTimestamp, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $  = (s)=>document.querySelector(s);
const fmt = (n,d=1)=>Number.isFinite(n)?(+n).toFixed(d):"—";
const todayStr = ()=> new Date().toISOString().slice(0,10);
const mgdl2mmol = mg => mg/18.0182;
const mmol2mgdl = mmol => mmol*18.0182;

const SAFE_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20style%3D%22background%3A%23f1f5f9%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-size%3D%2220%22%3E%F0%9F%8D%BD%EF%B8%8F%3C%2Ftext%3E%3C%2Fsvg%3E';

const els = {
  loader: $("#appLoader"), chipCF: $("#chipCF"), chipCR: $("#chipCR"), chipTarget: $("#chipTarget"),
  slotSelect: $("#slotSelect"), dateInput: $("#dateInput"), preBg: $("#preBg"), preBgUnit: $("#preBgUnit"),
  btnFetchPre: $("#btnFetchPre"), netCarbRule: $("#netCarbRule"), doseCorrection: $("#doseCorrection"),
  doseCarbs: $("#doseCarbs"), manualCarbs: $("#manualCarbs"), iobValue: $("#iobValue"), smartAlerts: $("#smartAlerts"), 
  injectionAlert: $("#injectionAlert"), injectionAlertMsg: $("#injectionAlertMsg"),
  btnClearMeal: $("#btnClearMeal"), btnOpenLibrary: $("#btnOpenLibrary"), mealBody: $("#mealBody"), 
  doseFinal: $("#doseFinal"), sumFiber: $("#sumFiber"), sumProtein: $("#sumProtein"), sumFat: $("#sumFat"), 
  sumCarbsNet: $("#sumCarbsNet"), sumCalories: $("#sumCalories"), avgGI: $("#avgGI"),
  libModal: $("#libModal"), libOverlay: $("#libOverlay"), libClose: $("#libClose"),
  searchBox: $("#searchBox"), itemsGrid: $("#itemsGrid"), btnSaveMeal: $("#btnSaveMeal"), 
  dailyMealsBody: $("#dailyMealsBody"), todayDateLabel: $("#todayDateLabel")
};

const state = {
  childId:null, parentId:null, child:null,
  slot:"PRE_BREAKFAST", date:todayStr(), rule:"fullFiber",
  CF: 50, Target: 100, CRs:{ breakfast: 10, lunch: 10, dinner: 10, snack: 15 },
  injectionMap: {}, globalFoods:[], mealItems:[], IOB: 0, finalDoseVal: 0,
  corrDirty: false, carbDirty: false, manualCarbDirty: false 
};

function showLoader(v){ if(els.loader) els.loader.style.display = v?"flex":"none"; }
const auth = getAuth();
function ensureAuth(){ return new Promise(res=>onAuthStateChanged(auth,u=>res(u),()=>res(null))); }

async function loadChild(){
  const dref = doc(db,"parents",state.parentId,"children",state.childId);
  const snap = await getDoc(dref);
  if (!snap.exists()) throw new Error("لم يتم العثور على بيانات الطفل.");
  const c = snap.data();
  state.child = { id:snap.id, ...c };
  
  state.CF = Number(c.cf || c.correctionFactor) || 50;
  if(c.cr) state.CRs = c.cr;
  if(c.glucose_limits) state.Target = Number(c.glucose_limits.target) || (c.glucoseUnit==='mmol/L'? 5.5 : 100);
  if(c.injection_map) state.injectionMap = c.injection_map;
  
  state.rule = c.netCarbRule || "fullFiber";
  if(els.netCarbRule) els.netCarbRule.value = state.rule;
  if(els.preBgUnit) els.preBgUnit.value = c.glucoseUnit || 'mg/dL';
  
  updateChipsAndAlerts();
}

function updateChipsAndAlerts() {
  const s = state.slot;
  let currentCR = state.CRs.snack || 15;
  if(s.includes('BREAKFAST')) currentCR = state.CRs.breakfast || 10;
  if(s.includes('LUNCH')) currentCR = state.CRs.lunch || 10;
  if(s.includes('DINNER')) currentCR = state.CRs.dinner || 10;

  if(els.chipCF) els.chipCF.textContent = `CF: ${state.CF}`;
  if(els.chipCR) els.chipCR.textContent = `CR: ${currentCR}`;
  if(els.chipTarget) els.chipTarget.textContent = `الهدف: ${state.Target}`;
  if(els.todayDateLabel) els.todayDateLabel.textContent = state.date;

  let badZones = [];
  const mapTransl = { arm_right:'الذراع الأيمن', arm_left:'الذراع الأيسر', abd_top_right:'البطن أعلى يمين', abd_top_left:'البطن أعلى يسار', abd_bottom_right:'البطن أسفل يمين', abd_bottom_left:'البطن أسفل يسار', thigh_right:'الفخذ الأيمن', thigh_left:'الفخذ الأيسر' };
  
  for(let zone in state.injectionMap) {
    if(state.injectionMap[zone] === 'lump') badZones.push(`${mapTransl[zone]||zone} (تكتل دهني 🚨)`);
    if(state.injectionMap[zone] === 'rest') badZones.push(`${mapTransl[zone]||zone} (فترة إراحة ⏸)`);
  }

  if(badZones.length > 0) {
    els.injectionAlert.style.display = 'flex';
    els.injectionAlertMsg.innerHTML = badZones.join('<br>');
  } else {
    els.injectionAlert.style.display = 'none';
  }
}

// --- قسم مكتبة الطعام ---
async function fetchFoodLibrary() {
  try {
    const snap = await getDocs(collection(db, "admin", "global", "foodItems"));
    state.globalFoods = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.isActive !== false);
    renderLibrary();
    $('#loadingLibrary').style.display = 'none';
  } catch (err) {
    console.error(err);
    $('#loadingLibrary').textContent = "⚠️ خطأ في تحميل المكتبة.";
  }
}

function renderLibrary() {
  const q = els.searchBox.value.toLowerCase();
  const list = state.globalFoods.filter(f => !q || (f.searchText || f.name).toLowerCase().includes(q));
  
  if(list.length === 0) {
    els.itemsGrid.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">لا توجد نتائج مطابقة لبحثك.</div>`;
    return;
  }

  els.itemsGrid.innerHTML = list.map(f => {
    const imgSrc = f.image?.url || SAFE_PLACEHOLDER;
    return `
      <div class="food-lib-item" data-id="${f.id}">
        <img src="${imgSrc}" onerror="this.src='${SAFE_PLACEHOLDER}';" alt="${f.name}">
        <div class="details">
          <h4>${f.name}</h4>
          <p>${f.category} | ${f.per100?.cal_kcal || 0} kcal/100g</p>
          <div class="macros">
            <span>كارب: ${f.per100?.carbs_g||0}g</span>
            <span>بروتين: ${f.per100?.protein_g||0}g</span>
            <span>دهون: ${f.per100?.fat_g||0}g</span>
          </div>
        </div>
        <button class="btn primary sm">إضافة</button>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.food-lib-item').forEach(item => {
    item.onclick = () => addItemToMeal(item.dataset.id);
  });
}

function addItemToMeal(foodId) {
  const food = state.globalFoods.find(f => f.id === foodId);
  if(!food) return;

  const defaultUnits = [{ label: '100 جرام', grams: 100 }];
  const availableUnits = (food.units && food.units.length > 0) ? food.units : defaultUnits;
  
  // إضافة نسخة فريدة للوجبة
  state.mealItems.push({
    uid: Date.now().toString() + Math.random().toString(36).substr(2,5),
    ...food,
    mealQty: 1,
    selectedUnitIndex: 0,
    availableUnits: availableUnits
  });

  els.libModal.classList.remove('open');
  els.searchBox.value = '';
  renderLibrary();
  state.manualCarbDirty = false; // تصفير التعديل اليدوي لاعتماد الجدول
  renderMealTable();
  updateTotals();
}

// --- قسم جدول الوجبة ---
function renderMealTable() {
  if (state.mealItems.length === 0) {
    els.mealBody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center; padding:20px;">لم يتم إضافة أي أصناف للوجبة بعد. اضغط على الزر أعلاه لإضافة طعام.</td></tr>`;
    return;
  }

  els.mealBody.innerHTML = state.mealItems.map((item, index) => {
    const unitOpts = item.availableUnits.map((u, i) => `<option value="${i}" ${item.selectedUnitIndex == i ? 'selected' : ''}>${u.label} (${u.grams}g)</option>`).join('');
    
    // الحساب المبدئي للجرامات المضافة
    const unitGrams = item.availableUnits[item.selectedUnitIndex]?.grams || 100;
    const totalGrams = item.mealQty * unitGrams;
    const ratio = totalGrams / 100;
    const fRule = state.rule === "fullFiber" ? 1 : state.rule === "halfFiber" ? 0.5 : 0;
    
    const carbsRaw = (item.per100?.carbs_g || 0) * ratio;
    const fiber = (item.per100?.fiber_g || 0) * ratio;
    const carbsNet = Math.max(0, carbsRaw - (fiber * fRule));

    return `
      <tr data-index="${index}">
        <td style="font-weight:bold;">
          ${item.name}
          ${item.per100?.gi > 70 ? '<span title="مؤشر جلايسيمي مرتفع" style="font-size:10px; background:#fee2e2; color:#ef4444; padding:2px 4px; border-radius:4px; margin-right:4px;">عالي GI</span>' : ''}
        </td>
        <td><input type="number" step="0.5" class="qty-input" value="${item.mealQty}" style="width:60px;"></td>
        <td><select class="unit-select" style="width:120px;">${unitOpts}</select></td>
        <td style="color:#7c3aed; font-weight:bold;">${fmt(carbsNet)} g</td>
        <td class="muted">${fmt(fiber)} g</td>
        <td class="muted">${fmt((item.per100?.protein_g||0)*ratio)} g</td>
        <td class="muted">${fmt((item.per100?.fat_g||0)*ratio)} g</td>
        <td class="muted">${fmt((item.per100?.cal_kcal||0)*ratio)} kcal</td>
        <td class="muted">${item.per100?.gi || '—'}</td>
        <td><button class="btn danger sm del-row">✕</button></td>
      </tr>
    `;
  }).join('');

  // إضافة أحداث التغيير
  document.querySelectorAll('.qty-input').forEach(input => {
    input.oninput = (e) => {
      const idx = e.target.closest('tr').dataset.index;
      state.mealItems[idx].mealQty = Number(e.target.value) || 0;
      state.manualCarbDirty = false;
      renderMealTable(); updateTotals();
    };
  });

  document.querySelectorAll('.unit-select').forEach(sel => {
    sel.onchange = (e) => {
      const idx = e.target.closest('tr').dataset.index;
      state.mealItems[idx].selectedUnitIndex = Number(e.target.value);
      state.manualCarbDirty = false;
      renderMealTable(); updateTotals();
    };
  });

  document.querySelectorAll('.del-row').forEach(btn => {
    btn.onclick = (e) => {
      const idx = e.target.closest('tr').dataset.index;
      state.mealItems.splice(idx, 1);
      state.manualCarbDirty = false;
      renderMealTable(); updateTotals();
    };
  });
}

// --- الحسابات والذكاء الاصطناعي ---
function updateTotals() {
  let sumNet=0, sumFiber=0, sumFat=0, sumPro=0, sumCal=0;
  let weightedGI = 0, giCarbSum = 0;

  state.mealItems.forEach(item => {
    const unitGrams = item.availableUnits[item.selectedUnitIndex]?.grams || 100;
    const totalGrams = item.mealQty * unitGrams;
    const ratio = totalGrams / 100;
    const fRule = state.rule === "fullFiber" ? 1 : state.rule === "halfFiber" ? 0.5 : 0;
    
    const carbsRaw = (item.per100?.carbs_g || 0) * ratio;
    const fiber = (item.per100?.fiber_g || 0) * ratio;
    const carbsNet = Math.max(0, carbsRaw - (fiber * fRule));
    const gi = Number(item.per100?.gi) || 0;

    sumNet += carbsNet; sumFiber += fiber; sumFat += (item.per100?.fat_g || 0) * ratio;
    sumPro += (item.per100?.protein_g || 0) * ratio; sumCal += (item.per100?.cal_kcal || 0) * ratio;

    if(gi > 0 && carbsNet > 0) { weightedGI += (gi * carbsNet); giCarbSum += carbsNet; }
  });
  
  const avgGI = giCarbSum > 0 ? Math.round(weightedGI / giCarbSum) : 0;

  if(els.sumCarbsNet) els.sumCarbsNet.textContent=`${fmt(sumNet)} g`;
  if(els.sumFiber) els.sumFiber.textContent=`${fmt(sumFiber)} g`; if(els.sumProtein) els.sumProtein.textContent=`${fmt(sumPro)} g`; 
  if(els.sumFat) els.sumFat.textContent=`${fmt(sumFat)} g`; if(els.sumCalories) els.sumCalories.textContent=`${fmt(sumCal,0)} kcal`; 
  if(els.avgGI) els.avgGI.textContent = avgGI > 0 ? avgGI : '—';

  // تزامن الكارب اليدوي
  if(!state.manualCarbDirty && els.manualCarbs) {
    els.manualCarbs.value = fmt(sumNet, 1);
  }

  // --- حسابات الأنسولين ---
  const s = state.slot;
  let currentCR = state.CRs.snack || 15;
  if(s.includes('BREAKFAST')) currentCR = state.CRs.breakfast || 10;
  if(s.includes('LUNCH')) currentCR = state.CRs.lunch || 10;
  if(s.includes('DINNER')) currentCR = state.CRs.dinner || 10;

  const bgInput = parseFloat(els.preBg.value);
  const inputUnit = els.preBgUnit.value;
  const childUnit = state.child?.glucoseUnit || "mg/dL";
  const bgInChildUnit = Number.isFinite(bgInput) ? (childUnit === inputUnit ? bgInput : (childUnit.includes('mmol') ? mgdl2mmol(bgInput) : mmol2mgdl(bgInput))) : NaN;

  let rawCorr = 0; 
  if (Number.isFinite(bgInChildUnit) && state.CF > 0 && bgInChildUnit > state.Target) { 
    rawCorr = (bgInChildUnit - state.Target) / state.CF; 
  }
  
  const finalCarbs = parseFloat(els.manualCarbs?.value) || 0;
  let doseCarb = currentCR > 0 ? (finalCarbs/currentCR) : 0;
  
  const step = 0.5;
  if(els.doseCorrection && !state.corrDirty) els.doseCorrection.value = fmt(Math.round(rawCorr/step)*step, 1);
  if(els.doseCarbs && !state.carbDirty) els.doseCarbs.value = fmt(Math.round(doseCarb/step)*step, 1);
  
  const finalCorr = parseFloat(els.doseCorrection.value) || 0; const finalCarb = parseFloat(els.doseCarbs.value) || 0;
  let finalDose = Math.max(0, (finalCorr + finalCarb) - state.IOB);
  
  state.finalDoseVal = Math.round(finalDose/step)*step;
  if(els.doseFinal) els.doseFinal.textContent = fmt(state.finalDoseVal, 1) + " U";

  // --- الذكاء الاصطناعي للوجبات (Smart Meal AI) ---
  if(els.smartAlerts) {
    els.smartAlerts.style.display = 'none'; els.smartAlerts.innerHTML = ''; els.smartAlerts.className = 'smart-alert';
    let alertsHtml = '';
    
    if (state.IOB > 0) alertsHtml += `<strong>⏳ يوجد أنسولين نشط (${fmt(state.IOB,1)} U):</strong> تم خصمه من الجرعة لتجنب الهبوط.<br>`;
    
    // تأثير البيتزا (دهون/بروتين عالي)
    if (sumFat > 30 || sumPro > 40) { 
      els.smartAlerts.classList.add('danger'); 
      alertsHtml += `<strong>🍕 وجبة دسمة جداً (تأثير البيتزا):</strong> الدهون والبروتين سيسببان ارتفاعاً متأخراً للسكر (بعد 3-5 ساعات). <br><span style="font-size:12px">💡 توصية طبية: اسأل طبيبك عن تقسيم الجرعة (Split Bolus).</span><br>`; 
    } 
    
    // مؤشر جلايسيمي عالي
    if (avgGI >= 70) {
      els.smartAlerts.classList.add('danger'); 
      alertsHtml += `<strong>📈 مؤشر جلايسيمي مرتفع (GI: ${avgGI}):</strong> السكر سيرتفع بسرعة شديدة! <br><span style="font-size:12px">💡 توصية طبية: يُفضل أخذ الأنسولين قبل الأكل بـ 15-20 دقيقة (Pre-bolus).</span><br>`; 
    }

    // ألياف ممتازة
    if (sumFiber >= 10 && avgGI < 70) {
      els.smartAlerts.classList.add('info'); 
      alertsHtml += `<strong>🌾 وجبة صحية وممتازة:</strong> نسبة الألياف العالية ستساعد في استقرار السكر وامتصاصه ببطء. استمر هكذا! 👏<br>`; 
    }

    if (alertsHtml) { els.smartAlerts.innerHTML = alertsHtml; els.smartAlerts.style.display = 'block'; }
  }
}

// --- جلب قياسات اليوم للمقارنة ---
async function fetchPreMeasurement(){
  try{
    if(els.preBg) els.preBg.value = "";
    if(els.doseCorrection) els.doseCorrection.value = "";
    if(els.doseCarbs) els.doseCarbs.value = "";
    state.corrDirty = false; state.carbDirty = false;
    
    const coll = collection(db,"parents",state.parentId,"children",state.childId,"measurements");
    const snap = await getDocs(query(coll, where("date", "==", state.date)));
    
    let latestMeas = null;
    snap.forEach(doc => {
      const d = doc.data();
      if(d.slotKey && d.slotKey.startsWith(state.slot)) {
        if(!latestMeas || (d.when?.seconds > latestMeas.when?.seconds)) { latestMeas = { id: doc.id, ...d }; }
      }
    });
    
    if (latestMeas) {
      if (els.preBg && latestMeas.value) {
        els.preBgUnit.value = latestMeas.unit || "mg/dL"; els.preBg.value = latestMeas.value;
      }
      if (latestMeas.correctionDose && els.doseCorrection) { els.doseCorrection.value = latestMeas.correctionDose; state.corrDirty = true; }
      if (latestMeas.carbDose && els.doseCarbs) { els.doseCarbs.value = latestMeas.carbDose; state.carbDirty = true; }
    }
    updateTotals();
  }catch(e){ console.error(e); }
}

async function saveMeal(){
  const bgInput = parseFloat(els.preBg.value);
  const netCarbs = parseFloat(els.manualCarbs.value) || 0;
  const carbDose = parseFloat(els.doseCarbs.value) || 0;
  const corrDose = parseFloat(els.doseCorrection.value) || 0;
  const totalDose = state.finalDoseVal;

  if (isNaN(bgInput) && netCarbs === 0) { alert("أدخل قراءة السكر أو مكونات الوجبة للحفظ."); return; }
  const btnSave = els.btnSaveMeal; btnSave.disabled = true; btnSave.textContent = "جاري الحفظ...";

  try {
    const measColl = collection(db,"parents",state.parentId,"children",state.childId,"measurements");
    const snap = await getDocs(query(measColl, where("date","==", state.date)));
    
    let targetDocId = null;
    let targetPayload = null;
    snap.forEach(doc => {
      const d = doc.data();
      if(d.slotKey && d.slotKey.startsWith(state.slot)) {
        if(!targetPayload || (d.when?.seconds > targetPayload.when?.seconds)) { targetDocId = doc.id; targetPayload = { ...d }; }
      }
    });

    const timeObj = new Date();
    const updateData = {
      carbs: netCarbs, carbDose: carbDose, correctionDose: corrDose, totalDose: totalDose,
      mealItemsRef: state.mealItems.map(m => ({ id: m.id, name: m.name, qty: m.mealQty, unit: m.availableUnits[m.selectedUnitIndex]?.label || '' })), // تسجيل ملخص الوجبة
      updatedAt: serverTimestamp()
    };

    if (targetDocId) {
      if(!isNaN(bgInput) && targetPayload.value !== bgInput) {
        updateData.value = bgInput; updateData.unit = els.preBgUnit.value;
      }
      await setDoc(doc(measColl, targetDocId), updateData, { merge: true });
    } else {
      updateData.date = state.date; updateData.time = `${String(timeObj.getHours()).padStart(2,'0')}:${String(timeObj.getMinutes()).padStart(2,'0')}`;
      updateData.when = timeObj; updateData.slotKey = state.slot; updateData.createdAt = serverTimestamp();
      updateData.notes = "🍽️ حسبت آلياً من حاسبة الوجبات";
      if(!isNaN(bgInput)) { updateData.value = bgInput; updateData.unit = els.preBgUnit.value; }
      await addDoc(measColl, updateData);
    }

    alert("تم حفظ الوجبة بنجاح! ✅");
    location.href = `measurements.html?child=${state.childId}`; 
  } catch(e) { console.error(e); alert("حدث خطأ في الحفظ"); }
  finally { btnSave.disabled = false; btnSave.textContent = "💾 حفظ الوجبة والجرعة"; }
}

async function init(){
  try {
    const qp = newSearchParams(location.search);
    state.childId=qp.get("child"); state.parentId=qp.get("parentId")||localStorage.getItem('selectedParentId');
    state.slot = qp.get("slot") || "PRE_BREAKFAST"; state.date = qp.get("date") || todayStr();
    
    if(els.slotSelect) els.slotSelect.value = state.slot;
    if(els.dateInput) els.dateInput.value = state.date;

    const user = await ensureAuth();
    if(!user || !state.childId) return;

    await loadChild();
    fetchFoodLibrary(); // تشغيل المكتبة في الخلفية
    
    const passedBg = qp.get("bg"); const passedUnit = qp.get("unit");
    if(passedBg) { els.preBg.value = passedBg; if(passedUnit) els.preBgUnit.value = passedUnit; } 
    else { await fetchPreMeasurement(); }

    // Events
    if(els.slotSelect) els.slotSelect.addEventListener("change", ()=>{ state.slot=els.slotSelect.value; updateChipsAndAlerts(); fetchPreMeasurement(); updateTotals(); });
    if(els.dateInput) els.dateInput.addEventListener("change", ()=>{ state.date=els.dateInput.value; fetchPreMeasurement(); updateTotals(); });
    if(els.manualCarbs) els.manualCarbs.addEventListener("input", ()=>{ state.manualCarbDirty=true; state.carbDirty=false; updateTotals(); });
    if(els.preBg) els.preBg.addEventListener("input", ()=>{ state.corrDirty=false; updateTotals(); });
    if(els.preBgUnit) els.preBgUnit.addEventListener("change", ()=>{ state.corrDirty=false; updateTotals(); });
    if(els.doseCorrection) els.doseCorrection.addEventListener("input", ()=>{ state.corrDirty=true; updateTotals(); });
    if(els.doseCarbs) els.doseCarbs.addEventListener("input", ()=>{ state.carbDirty=true; updateTotals(); });
    if(els.btnSaveMeal) els.btnSaveMeal.addEventListener("click", saveMeal);
    if(els.btnClearMeal) els.btnClearMeal.addEventListener("click", () => { state.mealItems = []; state.manualCarbDirty = false; renderMealTable(); updateTotals(); });

    // تفاعلات نافذة المكتبة
    if(els.btnOpenLibrary) els.btnOpenLibrary.addEventListener("click", () => els.libModal.classList.add('open'));
    if(els.libClose) els.libClose.addEventListener("click", () => els.libModal.classList.remove('open'));
    if(els.libOverlay) els.libOverlay.addEventListener("click", () => els.libModal.classList.remove('open'));
    if(els.searchBox) els.searchBox.addEventListener("input", renderLibrary);
    if(els.netCarbRule) els.netCarbRule.addEventListener("change", () => { state.rule = els.netCarbRule.value; renderMealTable(); updateTotals(); });

    showLoader(false);
  } catch(e) { console.error(e); }
}

// تصحيح خطأ URLSearchParams
function newSearchParams(str) { return new URLSearchParams(str); }
init();
