// js/meals.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, getDocs, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const fmt = (n,d=1)=>Number.isFinite(n)?(+n).toFixed(d):"—";
const todayStr = ()=> new Date().toISOString().slice(0,10);
const currentTimeStr = ()=> new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const mgdl2mmol = mg => mg/18.0182;
const mmol2mgdl = mmol => mmol*18.0182;
const SAFE_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20style%3D%22background%3A%23f1f5f9%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-size%3D%2220%22%3E%F0%9F%8D%BD%EF%B8%8F%3C%2Ftext%3E%3C%2Fsvg%3E';

let state = {
  childId: null, parentId: null, child: null, 
  date: todayStr(), time: currentTimeStr(), slot: "PRE_BREAKFAST",
  CF: 50, Target: 100, CRs: { breakfast: 10, lunch: 10, dinner: 10, snack: 15 },
  rule: "fullFiber", globalFoods: [], mealItems: [], IOB: 0, finalDoseVal: 0,
  manualCarbDirty: false, eatenToday: 0, caloriesEatenToday: 0,
  currentMealCarbs: 0, currentMealCalories: 0,
  currentBgUnit: "mg/dL" // لتتبع وحدة القياس الحالية وتحويلها
};

const els = {
  loader: $("loader"), chipCF: $("lblCF"), chipCR: $("lblCR"), chipTarget: $("lblTarget"),
  dateInput: $("dateInput"), timeInput: $("timeInput"), slotSelect: $("slotSelect"), 
  preBg: $("preBg"), preBgUnit: $("preBgUnit"), btnFetchPre: $("btnFetchPre"), 
  measureSource: $("measureSource"), trendContainer: $("trendContainer"), trendArrow: $("trendArrow"),
  netCarbRule: $("netCarbRule"), manualCarbs: $("manualCarbs"), iobValue: $("iobValue"), 
  smartAlerts: $("smartAlerts"), doseFinal: $("doseFinal"), doseDetailsStr: $("doseDetailsStr"), resultBox: $("resultBox"),
  btnClearMeal: $("btnClearMeal"), btnSaveMeal: $("btnSaveMeal"), btnOpenLibrary: $("btnOpenLibrary"),
  mealBody: $("mealBody"), sumFiber: $("sumFiber"), sumProtein: $("sumProtein"), sumFat: $("sumFat"),
  sumCarbsNet: $("sumCarbsNet"), sumCalories: $("sumCalories"), avgGI: $("avgGI"),
  libModal: $("libModal"), libOverlay: $("libOverlay"), libClose: $("libClose"),
  searchBox: $("searchBox"), itemsGrid: $("itemsGrid"), loadingLibrary: $("loadingLibrary"),
  dailyCarbTarget: $("dailyCarbTarget"), carbProgressBar: $("carbProgressBar"), carbProgressText: $("carbProgressText"),
  dailyCalorieTarget: $("dailyCalorieTarget"), calProgressBar: $("calProgressBar"), calProgressText: $("calProgressText"),
  todayDateLabel: $("todayDateLabel"), dailyMealsBody: $("dailyMealsBody")
};

function showLoader(v) { els.loader.classList.toggle('hidden', !v); }

function getSlotLabel(key) {
  const labels = { PRE_BREAKFAST: 'الفطار', PRE_LUNCH: 'الغداء', PRE_DINNER: 'العشاء', SNACK: 'سناك' };
  return labels[key] || key;
}

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  
  const qp = new URLSearchParams(location.search);
  state.childId = qp.get('child') || localStorage.getItem('selectedChildId');
  state.parentId = localStorage.getItem('selectedParentId') || u.uid;
  if (!state.childId) { location.href = 'parent.html'; return; }

  state.date = qp.get("date") || state.date;
  state.time = qp.get("time") || state.time;
  state.slot = qp.get("slot") || state.slot;
  
  els.dateInput.value = state.date;
  els.timeInput.value = state.time;
  els.slotSelect.value = state.slot;

  const passedBg = qp.get("bg");
  if (passedBg) {
    els.preBg.value = passedBg;
    if (qp.get("unit")) els.preBgUnit.value = qp.get("unit");
  }

  try {
    await loadChildData();
    setupEvents();
    if(!qp.get("slot")) autoSelectMealSlot(); 
    fetchFoodLibrary();
    await loadTodayMeals();
    if (passedBg) calculateBolus();
  } catch (e) { console.error(e); }
  finally { showLoader(false); }
});

async function loadChildData() {
  const snap = await getDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`));
  if (!snap.exists()) throw new Error('Child not found');
  const c = snap.data();
  state.child = { id: snap.id, ...c };

  const name = c.name || 'الطفل';
  $('topAvatar').textContent = name.charAt(0);
  $('topChildName').textContent = name;
  $('topChildMeta').textContent = `${c.gender === 'female' ? 'أنثى' : 'ذكر'} • ${c.glucoseUnit || 'mg/dL'}`;
  $('breadChildName').textContent = name;
  $('breadChildName').href = `child.html?child=${state.childId}`;
  $('navHome').href = `child.html?child=${state.childId}`;
  $('navMeas').href = `measurements.html?child=${state.childId}`;
  $('navReports').href = `reports.html?child=${state.childId}`;

  state.CF = Number(c.cf || c.correctionFactor) || 50;
  if(c.cr) state.CRs = c.cr;
  if(c.glucose_limits) state.Target = Number(c.glucose_limits.target) || (c.glucoseUnit === 'mmol/L' ? 5.5 : 100);
  state.rule = c.netCarbRule || "fullFiber";
  
  els.netCarbRule.value = state.rule;
  
  // ضبط الوحدة المبدئية وحفظها في الـ State للتحويل الذكي لاحقاً
  if(!els.preBg.value) els.preBgUnit.value = c.glucoseUnit || 'mg/dL';
  state.currentBgUnit = els.preBgUnit.value;

  els.todayDateLabel.textContent = state.date;
  
  if(c.dietGoal) { els.dailyCarbTarget.value = c.dietGoal; }
  if(c.calorieGoal) { els.dailyCalorieTarget.value = c.calorieGoal; }
  
  updateFactorsDisplay();
}

function autoSelectMealSlot() {
  const h = parseInt(state.time.split(':')[0]);
  if(h >= 5 && h < 11) state.slot = 'PRE_BREAKFAST';
  else if(h >= 11 && h < 16) state.slot = 'PRE_LUNCH';
  else if(h >= 16 && h < 22) state.slot = 'PRE_DINNER';
  else state.slot = 'SNACK';
  els.slotSelect.value = state.slot;
  updateFactorsDisplay();
}

function updateFactorsDisplay() {
  let currentCR = state.CRs.snack || 15;
  if(state.slot.includes('BREAKFAST')) currentCR = state.CRs.breakfast || 10;
  if(state.slot.includes('LUNCH')) currentCR = state.CRs.lunch || 10;
  if(state.slot.includes('DINNER')) currentCR = state.CRs.dinner || 10;

  els.chipCF.textContent = state.CF;
  els.chipCR.textContent = currentCR;
  els.chipTarget.textContent = state.Target;
  calculateBolus();
}

function updateDietProgress(mealCarbs = 0, mealCals = 0) {
  const targetCarb = Number(els.dailyCarbTarget.value);
  const totalCarb = state.eatenToday + mealCarbs;
  if(targetCarb > 0) {
    els.carbProgressText.textContent = `${Math.round(totalCarb)} / ${targetCarb} جرام`;
    const pct = Math.min(100, (totalCarb / targetCarb) * 100);
    els.carbProgressBar.style.width = pct + '%';
    els.carbProgressBar.className = `progress-fill carb-fill ${pct > 100 ? 'danger' : pct > 85 ? 'warn' : ''}`;
  } else {
    els.carbProgressText.textContent = `إجمالي المستهلك اليوم: ${Math.round(totalCarb)} جرام`;
    els.carbProgressBar.style.width = '0%';
  }

  const targetCal = Number(els.dailyCalorieTarget.value);
  const totalCal = state.caloriesEatenToday + mealCals;
  if(targetCal > 0) {
    els.calProgressText.textContent = `${Math.round(totalCal)} / ${targetCal} kcal`;
    const pct = Math.min(100, (totalCal / targetCal) * 100);
    els.calProgressBar.style.width = pct + '%';
    els.calProgressBar.className = `progress-fill cal-fill ${pct > 100 ? 'danger' : pct > 85 ? 'warn' : ''}`;
  } else {
    els.calProgressText.textContent = `إجمالي المستهلك اليوم: ${Math.round(totalCal)} kcal`;
    els.calProgressBar.style.width = '0%';
  }
}

async function fetchFoodLibrary() {
  try {
    const snap = await getDocs(collection(db, "admin/global/foodItems"));
    state.globalFoods = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.isActive !== false);
    renderLibrary();
    els.loadingLibrary.style.display = 'none';
  } catch (err) { els.loadingLibrary.textContent = "⚠️ خطأ في تحميل المكتبة."; }
}

function renderLibrary() {
  const q = els.searchBox.value.toLowerCase();
  const list = state.globalFoods.filter(f => !q || (f.searchText || f.name).toLowerCase().includes(q));
  if(!list.length) { els.itemsGrid.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">لا توجد نتائج مطابقة لبحثك.</div>`; return; }

  els.itemsGrid.innerHTML = list.map(f => {
    const giStr = f.per100?.gi ? `<span class="gi-badge ${f.per100.gi > 70 ? 'high' : ''}">GI: ${f.per100.gi}</span>` : '';
    return `
      <div class="food-lib-item" data-id="${f.id}">
        <div class="food-img-col">
          <img src="${f.image?.url || SAFE_PLACEHOLDER}" onerror="this.src='${SAFE_PLACEHOLDER}';">
          ${giStr}
        </div>
        <div class="details">
          <div class="food-title">${f.name}</div>
          <div class="macros-grid">
            <div class="m-box"><span class="m-val">${f.per100?.carbs_g||0}g</span><span class="m-lbl">كارب</span></div>
            <div class="m-box"><span class="m-val">${f.per100?.protein_g||0}g</span><span class="m-lbl">بروتين</span></div>
            <div class="m-box"><span class="m-val">${f.per100?.fat_g||0}g</span><span class="m-lbl">دهون</span></div>
            <div class="m-box"><span class="m-val" style="color:#f59e0b">${f.per100?.cal_kcal||0}</span><span class="m-lbl">kcal</span></div>
          </div>
        </div>
        <button class="btn primary sm add-btn">إضافة</button>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.food-lib-item').forEach(item => {
    item.querySelector('.add-btn').onclick = () => { addItemToMeal(item.dataset.id); els.libModal.classList.remove('open'); };
  });
}

function addItemToMeal(id) {
  const food = state.globalFoods.find(f => f.id === id);
  if(!food) return;
  state.mealItems.push({ uid: Date.now().toString(), ...food, mealQty: 1, selectedUnitIndex: 0, availableUnits: food.units?.length ? food.units : [{label: '100 جرام', grams: 100}] });
  state.manualCarbDirty = false;
  els.searchBox.value = ''; renderLibrary(); renderMealTable(); updateMealTotals();
}

function renderMealTable() {
  if (!state.mealItems.length) {
    els.mealBody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center; padding:20px;">لم يتم إضافة أصناف للوجبة بعد.</td></tr>`;
    return;
  }
  els.mealBody.innerHTML = state.mealItems.map((item, idx) => {
    const opts = item.availableUnits.map((u, i) => `<option value="${i}" ${item.selectedUnitIndex == i ? 'selected' : ''}>${u.label}</option>`).join('');
    const ratio = (item.mealQty * (item.availableUnits[item.selectedUnitIndex]?.grams || 100)) / 100;
    const fRule = state.rule === "fullFiber" ? 1 : state.rule === "halfFiber" ? 0.5 : 0;
    const netCarb = Math.max(0, (item.per100?.carbs_g||0)*ratio - (item.per100?.fiber_g||0)*ratio*fRule);

    return `
      <tr data-idx="${idx}">
        <td style="font-weight:bold;">${item.name} ${item.per100?.gi > 70 ? '<span style="font-size:10px; background:#fee2e2; color:#ef4444; padding:2px 4px; border-radius:4px;">عالي GI</span>' : ''}</td>
        <td><input type="number" step="0.5" class="qty-input input" value="${item.mealQty}" style="width:60px; padding:4px;"></td>
        <td><select class="unit-select input" style="width:100px; padding:4px;">${opts}</select></td>
        <td style="color:#7c3aed; font-weight:bold;">${fmt(netCarb)}</td>
        <td class="muted">${fmt((item.per100?.fiber_g||0)*ratio)}</td>
        <td class="muted">${fmt((item.per100?.protein_g||0)*ratio)}</td>
        <td class="muted">${fmt((item.per100?.fat_g||0)*ratio)}</td>
        <td class="muted">${fmt((item.per100?.cal_kcal||0)*ratio)}</td>
        <td class="muted">${item.per100?.gi || '—'}</td>
        <td><button class="del-btn">✕</button></td>
      </tr>
    `;
  }).join('');

  document.querySelectorAll('.qty-input').forEach(i => i.oninput = e => { state.mealItems[e.target.closest('tr').dataset.idx].mealQty = Number(e.target.value)||0; state.manualCarbDirty=false; renderMealTable(); updateMealTotals(); });
  document.querySelectorAll('.unit-select').forEach(s => s.onchange = e => { state.mealItems[e.target.closest('tr').dataset.idx].selectedUnitIndex = Number(e.target.value); state.manualCarbDirty=false; renderMealTable(); updateMealTotals(); });
  document.querySelectorAll('.del-btn').forEach(b => b.onclick = e => { state.mealItems.splice(e.target.closest('tr').dataset.idx, 1); state.manualCarbDirty=false; renderMealTable(); updateMealTotals(); });
}

function updateMealTotals() {
  let sumNet=0, sumFib=0, sumFat=0, sumPro=0, sumCal=0, weightedGI=0, giSum=0;
  state.mealItems.forEach(item => {
    const ratio = (item.mealQty * (item.availableUnits[item.selectedUnitIndex]?.grams || 100)) / 100;
    const fRule = state.rule === "fullFiber" ? 1 : state.rule === "halfFiber" ? 0.5 : 0;
    const netCarb = Math.max(0, (item.per100?.carbs_g||0)*ratio - (item.per100?.fiber_g||0)*ratio*fRule);
    const gi = Number(item.per100?.gi)||0;

    sumNet += netCarb; sumFib += (item.per100?.fiber_g||0)*ratio;
    sumFat += (item.per100?.fat_g||0)*ratio; sumPro += (item.per100?.protein_g||0)*ratio;
    sumCal += (item.per100?.cal_kcal||0)*ratio;
    if(gi>0 && netCarb>0){ weightedGI += gi*netCarb; giSum += netCarb; }
  });

  els.sumCarbsNet.textContent = `${fmt(sumNet)} g`; els.sumFiber.textContent = `${fmt(sumFib)} g`;
  els.sumProtein.textContent = `${fmt(sumPro)} g`; els.sumFat.textContent = `${fmt(sumFat)} g`;
  els.sumCalories.textContent = `${fmt(sumCal,0)} kcal`; els.avgGI.textContent = giSum>0 ? Math.round(weightedGI/giSum) : '—';

  state.currentMealCarbs = sumNet;
  state.currentMealCalories = sumCal;

  if(!state.manualCarbDirty) els.manualCarbs.value = fmt(sumNet, 1);
  updateDietProgress(state.currentMealCarbs, state.currentMealCalories);
  calculateBolus(sumFat, sumPro, giSum>0 ? Math.round(weightedGI/giSum) : 0, sumFib);
}

// --- Smart Bolus Engine ---
function calculateBolus(fat = 0, pro = 0, avgGI = 0, fiber = 0) {
  const bg = parseFloat(els.preBg.value);
  const carbs = parseFloat(els.manualCarbs.value) || 0;
  const iob = parseFloat(els.iobValue.value) || 0;
  const unit = els.preBgUnit.value;
  
  let currentCR = state.CRs.snack || 15;
  if(state.slot.includes('BREAKFAST')) currentCR = state.CRs.breakfast || 10;
  if(state.slot.includes('LUNCH')) currentCR = state.CRs.lunch || 10;
  if(state.slot.includes('DINNER')) currentCR = state.CRs.dinner || 10;

  const childUnit = state.child?.glucoseUnit || 'mg/dL';
  let bgInChildUnit = bg;
  if (bg > 0 && unit !== childUnit) {
    bgInChildUnit = (childUnit === 'mmol/L') ? mgdl2mmol(bg) : mmol2mgdl(bg);
  }

  let effectiveBg = bgInChildUnit;
  if(bg && els.measureSource.value === 'cgm') {
    const trend = Number(els.trendArrow.value);
    effectiveBg += (childUnit === 'mmol/L' ? trend/18.0 : trend);
  }

  let corr = 0;
  if(effectiveBg > state.Target && state.CF > 0) corr = (effectiveBg - state.Target) / state.CF;
  let carbDose = currentCR > 0 ? (carbs / currentCR) : 0;
  
  let netDose = Math.max(0, (corr + carbDose) - iob);
  state.finalDoseVal = Math.round(netDose*2)/2; 
  
  els.doseFinal.textContent = state.finalDoseVal.toFixed(1) + " U";
  els.doseDetailsStr.textContent = `كارب: ${carbDose.toFixed(1)} | تصحيح: ${corr.toFixed(1)} | خصم نشط: -${iob.toFixed(1)}`;
  els.resultBox.className = (state.finalDoseVal > 0 && effectiveBg >= state.Target) ? 'result-box safe' : 'result-box';

  els.smartAlerts.style.display = 'none';
  let alerts = "";
  if (els.measureSource.value === 'cgm' && Number(els.trendArrow.value) < 0) alerts += `<strong>⬇️ سهم هبوط:</strong> الذكاء الاصطناعي خفض الجرعة لمنع الهبوط المتوقع.<br>`;
  if (fat > 30 || pro > 40) alerts += `<strong>🍕 تأثير البيتزا (وجبة دسمة):</strong> قد تحتاج لتقسيم الجرعة لتجنب الارتفاع المتأخر.<br>`;
  if (avgGI >= 70) alerts += `<strong>📈 مؤشر جلايسيمي مرتفع:</strong> يُفضل حقن الأنسولين قبل الأكل بـ 15 دقيقة.<br>`;
  if (fiber >= 10 && avgGI < 70) alerts += `<strong>🌾 وجبة ممتازة:</strong> الألياف ستساعد في استقرار السكر.<br>`;
  
  if(alerts) { els.smartAlerts.innerHTML = alerts; els.smartAlerts.style.display = 'block'; }
}

async function autoFetchPreMeasurement() {
  els.btnFetchPre.textContent = "⏳...";
  try {
    const qy = query(collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`), where('date', '==', state.date));
    const snap = await getDocs(qy);
    let found = null;
    snap.forEach(doc => {
      const d = doc.data();
      if(d.slotKey === state.slot) {
        if(!found || d.when.seconds > found.when.seconds) found = d;
      }
    });
    
    if(found) {
      els.preBg.value = found.value; 
      if(found.unit) {
        els.preBgUnit.value = found.unit;
        state.currentBgUnit = found.unit;
      }
      els.measureSource.value = found.measureMethod === 'sensor' ? 'cgm' : 'bgm';
      els.measureSource.dispatchEvent(new Event('change'));
      calculateBolus(); 
      els.btnFetchPre.textContent = "✅ تم الجلب";
      setTimeout(() => els.btnFetchPre.textContent = "🔄 جلب", 2000);
    } else {
      els.preBg.value = "";
      els.btnFetchPre.textContent = "❌ لا يوجد قياس";
      setTimeout(() => els.btnFetchPre.textContent = "🔄 جلب", 2000);
      calculateBolus();
    }
  } catch(e) { console.error(e); els.btnFetchPre.textContent = "🔄 جلب"; }
}

els.btnFetchPre.onclick = autoFetchPreMeasurement;

async function loadTodayMeals() {
  const qy = query(collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`), where('date', '==', state.date));
  const snap = await getDocs(qy);
  state.eatenToday = 0; state.caloriesEatenToday = 0;
  
  const validDocs = snap.docs.map(d=>d.data()).filter(m => m.carbs > 0 || m.totalDose > 0);

  if(validDocs.length === 0) { 
    els.dailyMealsBody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;">لا توجد وجبات أو قياسات مسجلة في هذا اليوم</td></tr>`; 
  } else {
    validDocs.sort((a,b) => a.when.seconds - b.when.seconds);
    let html = '';
    validDocs.forEach(m => {
      state.eatenToday += Number(m.carbs||0); 
      state.caloriesEatenToday += Number(m.calories||0);
      html += `<tr><td>${getSlotLabel(m.slotKey)}</td><td>${m.carbs||0}g</td><td>${m.calories||0} kcal</td><td>${m.carbDose||0}U</td><td>${m.correctionDose||0}U</td><td><strong style="color:var(--primary)">${m.totalDose||m.totalInsulin||0}U</strong></td></tr>`;
    });
    els.dailyMealsBody.innerHTML = html;
  }
  updateDietProgress();
}

els.btnSaveMeal.onclick = async () => {
  const carbs = parseFloat(els.manualCarbs.value) || 0;
  const bg = parseFloat(els.preBg.value);
  if(!carbs && isNaN(bg)) { alert("أدخل الكارب أو قراءة السكر للحفظ."); return; }
  
  els.btnSaveMeal.disabled = true; els.btnSaveMeal.textContent = "جاري الحفظ...";
  try {
    const [yyyy, mm, dd] = state.date.split('-');
    const [hh, min] = state.time.split(':');
    const timeObj = new Date(yyyy, mm - 1, dd, hh, min);
    
    let updates = {};
    const tCarb = Number(els.dailyCarbTarget.value); const tCal = Number(els.dailyCalorieTarget.value);
    if(tCarb > 0 && tCarb !== state.child.dietGoal) updates.dietGoal = tCarb;
    if(tCal > 0 && tCal !== state.child.calorieGoal) updates.calorieGoal = tCal;
    if(Object.keys(updates).length > 0) await setDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`), updates, { merge: true });

    let payload = {
      date: state.date, time: `${hh}:${min}`, when: timeObj, slotKey: state.slot, 
      carbs: carbs, calories: state.currentMealCalories, 
      carbDose: parseFloat(els.doseCarbs?.value) || (state.CRs[state.slot]? carbs/state.CRs[state.slot] : 0),
      correctionDose: parseFloat(els.doseCorrection?.value) || 0,
      totalDose: state.finalDoseVal, createdAt: serverTimestamp()
    };

    if(state.mealItems.length > 0) {
      payload.mealItemsRef = state.mealItems.map(m=>({name:m.name, qty:m.mealQty, netCarb:m.carbs_g}));
    }

    if (!isNaN(bg)) {
      payload.value = bg; payload.unit = els.preBgUnit.value;
      payload.measureMethod = els.measureSource.value === 'cgm' ? 'sensor' : 'blood';
    }

    await addDoc(collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`), payload);

    alert("تم اعتماد الجرعة وحفظ السجل بنجاح! ✅"); location.href = `measurements.html?child=${state.childId}`;
  } catch(e) { console.error(e); alert("خطأ في الحفظ"); } finally { els.btnSaveMeal.disabled = false; els.btnSaveMeal.textContent = "💾 اعتماد الجرعة وحفظ الوجبة"; }
};

function setupEvents() {
  $('logoutBtn').onclick = () => signOut(auth);
  
  els.dateInput.onchange = () => { 
    state.date = els.dateInput.value; els.todayDateLabel.textContent = state.date; 
    loadTodayMeals(); autoFetchPreMeasurement(); 
  };
  els.timeInput.onchange = () => { state.time = els.timeInput.value; };
  
  els.slotSelect.onchange = () => { 
    state.slot = els.slotSelect.value; updateFactorsDisplay(); autoFetchPreMeasurement(); 
  };
  
  // تحويل الوحدة بذكاء عند تغيير القائمة المنسدلة
  els.preBgUnit.onchange = () => {
    const newUnit = els.preBgUnit.value;
    const bgVal = parseFloat(els.preBg.value);

    if (!isNaN(bgVal) && state.currentBgUnit !== newUnit) {
      if (newUnit === 'mmol/L' && state.currentBgUnit === 'mg/dL') {
        els.preBg.value = (bgVal / 18.0182).toFixed(1);
      } else if (newUnit === 'mg/dL' && state.currentBgUnit === 'mmol/L') {
        els.preBg.value = Math.round(bgVal * 18.0182);
      }
    }
    state.currentBgUnit = newUnit;
    calculateBolus();
  };

  els.netCarbRule.onchange = () => { state.rule = els.netCarbRule.value; renderMealTable(); updateMealTotals(); };
  els.preBg.oninput = calculateBolus; els.iobValue.oninput = calculateBolus;
  els.trendArrow.onchange = calculateBolus;
  els.manualCarbs.oninput = () => { state.manualCarbDirty = true; calculateBolus(); };
  els.measureSource.onchange = () => { els.trendContainer.classList.toggle('hidden', els.measureSource.value !== 'cgm'); calculateBolus(); };
  els.dailyCarbTarget.oninput = () => updateDietProgress(state.currentMealCarbs, state.currentMealCalories);
  els.dailyCalorieTarget.oninput = () => updateDietProgress(state.currentMealCarbs, state.currentMealCalories);
  
  els.btnOpenLibrary.onclick = () => els.libModal.classList.add('open');
  els.libClose.onclick = () => els.libModal.classList.remove('open');
  els.libOverlay.onclick = () => els.libModal.classList.remove('open');
  els.searchBox.oninput = renderLibrary;
  els.btnClearMeal.onclick = () => { state.mealItems=[]; state.manualCarbDirty=false; state.currentMealCarbs=0; state.currentMealCalories=0; renderMealTable(); updateMealTotals(); els.manualCarbs.value=''; calculateBolus(); };
}
