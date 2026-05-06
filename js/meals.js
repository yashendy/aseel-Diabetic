// js/meals.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, getDocs, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const fmt = (n,d=1)=>Number.isFinite(n)?(+n).toFixed(d):"—";
const todayStr = ()=> new Date().toISOString().slice(0,10);
const mgdl2mmol = mg => mg/18.0182;
const mmol2mgdl = mmol => mmol*18.0182;
const SAFE_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20style%3D%22background%3A%23f1f5f9%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-size%3D%2220%22%3E%F0%9F%8D%BD%EF%B8%8F%3C%2Ftext%3E%3C%2Fsvg%3E';

let state = {
  childId: null, parentId: null, child: null, date: todayStr(), slot: "PRE_BREAKFAST",
  CF: 50, Target: 100, CRs: { breakfast: 10, lunch: 10, dinner: 10, snack: 15 },
  rule: "fullFiber", globalFoods: [], mealItems: [], IOB: 0, finalDoseVal: 0,
  manualCarbDirty: false, eatenToday: 0
};

const els = {
  loader: $("loader"), chipCF: $("lblCF"), chipCR: $("lblCR"), chipTarget: $("lblTarget"),
  slotSelect: $("slotSelect"), preBg: $("preBg"), preBgUnit: $("preBgUnit"),
  btnFetchPre: $("btnFetchPre"), measureSource: $("measureSource"), trendContainer: $("trendContainer"), trendArrow: $("trendArrow"),
  netCarbRule: $("netCarbRule"), doseCorrection: $("doseCorrection"), doseCarbs: $("doseCarbs"), 
  manualCarbs: $("manualCarbs"), iobValue: $("iobValue"), smartAlerts: $("smartAlerts"),
  doseFinal: $("doseFinal"), doseDetailsStr: $("doseDetailsStr"), resultBox: $("resultBox"),
  btnClearMeal: $("btnClearMeal"), btnSaveMeal: $("btnSaveMeal"), btnOpenLibrary: $("btnOpenLibrary"),
  mealBody: $("mealBody"), sumFiber: $("sumFiber"), sumProtein: $("sumProtein"), sumFat: $("sumFat"),
  sumCarbsNet: $("sumCarbsNet"), sumCalories: $("sumCalories"), avgGI: $("avgGI"),
  libModal: $("libModal"), libOverlay: $("libOverlay"), libClose: $("libClose"),
  searchBox: $("searchBox"), itemsGrid: $("itemsGrid"), loadingLibrary: $("loadingLibrary"),
  dailyCarbTarget: $("dailyCarbTarget"), carbProgressBar: $("carbProgressBar"), carbProgressText: $("carbProgressText"),
  todayDateLabel: $("todayDateLabel"), dailyMealsBody: $("dailyMealsBody")
};

function showLoader(v) { els.loader.classList.toggle('hidden', !v); }

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  state.childId = new URLSearchParams(location.search).get('child') || localStorage.getItem('selectedChildId');
  state.parentId = localStorage.getItem('selectedParentId') || u.uid;
  if (!state.childId) { location.href = 'parent.html'; return; }

  try {
    await loadChildData();
    setupEvents();
    autoSelectMealSlot();
    fetchFoodLibrary();
    await loadTodayMeals();
  } catch (e) { console.error(e); }
  finally { showLoader(false); }
});

async function loadChildData() {
  const snap = await getDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`));
  if (!snap.exists()) throw new Error('Child not found');
  const c = snap.data();
  state.child = { id: snap.id, ...c };

  // Topbar
  const name = c.name || 'الطفل';
  $('topAvatar').textContent = name.charAt(0);
  $('topChildName').textContent = name;
  $('topChildMeta').textContent = `${c.gender === 'female' ? 'أنثى' : 'ذكر'} • ${c.glucoseUnit || 'mg/dL'}`;
  $('breadChildName').textContent = name;
  $('breadChildName').href = `child.html?child=${state.childId}`;
  $('navHome').href = `child.html?child=${state.childId}`;
  $('navMeas').href = `measurements.html?child=${state.childId}`;
  $('navReports').href = `reports.html?child=${state.childId}`;

  // Factors
  state.CF = Number(c.cf || c.correctionFactor) || 50;
  if(c.cr) state.CRs = c.cr;
  if(c.glucose_limits) state.Target = Number(c.glucose_limits.target) || (c.glucoseUnit === 'mmol/L' ? 5.5 : 100);
  state.rule = c.netCarbRule || "fullFiber";
  
  els.netCarbRule.value = state.rule;
  els.preBgUnit.value = c.glucoseUnit || 'mg/dL';
  els.todayDateLabel.textContent = state.date;
  
  // استعادة هدف الدايت لو كان محفوظاً
  if(c.dietGoal) { els.dailyCarbTarget.value = c.dietGoal; }
  
  updateFactorsDisplay();
}

function autoSelectMealSlot() {
  const h = new Date().getHours();
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

// --- Diet Progress Tracker ---
function updateDietProgress() {
  const target = Number(els.dailyCarbTarget.value);
  if(target > 0) {
    els.carbProgressText.textContent = `${Math.round(state.eatenToday)} / ${target} جرام`;
    const pct = Math.min(100, (state.eatenToday / target) * 100);
    els.carbProgressBar.style.width = pct + '%';
    els.carbProgressBar.className = `progress-fill ${pct > 100 ? 'danger' : pct > 85 ? 'warn' : ''}`;
  } else {
    els.carbProgressText.textContent = `إجمالي المستهلك اليوم: ${Math.round(state.eatenToday)} جرام`;
    els.carbProgressBar.style.width = '0%';
  }
}

// --- Food Library ---
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
  if(!list.length) { els.itemsGrid.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">لا توجد نتائج.</div>`; return; }

  els.itemsGrid.innerHTML = list.map(f => `
    <div class="food-lib-item" data-id="${f.id}">
      <img src="${f.image?.url || SAFE_PLACEHOLDER}" onerror="this.src='${SAFE_PLACEHOLDER}';">
      <div class="details">
        <h4>${f.name}</h4>
        <div class="macros"><span>كارب: ${f.per100?.carbs_g||0}g</span> <span>ألياف: ${f.per100?.fiber_g||0}g</span></div>
      </div>
      <button class="btn primary sm">إضافة</button>
    </div>
  `).join('');

  document.querySelectorAll('.food-lib-item').forEach(item => {
    item.onclick = () => { addItemToMeal(item.dataset.id); els.libModal.classList.remove('open'); };
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

  if(!state.manualCarbDirty) els.manualCarbs.value = fmt(sumNet, 1);
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

  // Trend Adjustment
  let effectiveBg = bg;
  if(bg && els.measureSource.value === 'cgm') {
    const trend = Number(els.trendArrow.value);
    effectiveBg += (unit === 'mmol/L' ? trend/18.0 : trend);
  }

  // Dose Math
  let corr = 0;
  if(effectiveBg > state.Target && state.CF > 0) corr = (effectiveBg - state.Target) / state.CF;
  let carbDose = currentCR > 0 ? (carbs / currentCR) : 0;
  
  let netDose = Math.max(0, (corr + carbDose) - iob);
  state.finalDoseVal = Math.round(netDose*2)/2; // Step 0.5
  
  els.doseFinal.textContent = state.finalDoseVal.toFixed(1) + " U";
  els.doseDetailsStr.textContent = `كارب: ${carbDose.toFixed(1)} | تصحيح: ${corr.toFixed(1)} | خصم نشط: -${iob.toFixed(1)}`;
  els.resultBox.className = (state.finalDoseVal > 0 && effectiveBg >= state.Target) ? 'result-box safe' : 'result-box';

  // AI Alerts
  els.smartAlerts.style.display = 'none';
  let alerts = "";
  if (els.measureSource.value === 'cgm' && Number(els.trendArrow.value) < 0) alerts += `<strong>⬇️ سهم هبوط:</strong> الذكاء الاصطناعي خفض الجرعة لمنع الهبوط المتوقع.<br>`;
  if (fat > 30 || pro > 40) alerts += `<strong>🍕 تأثير البيتزا (وجبة دسمة):</strong> قد تحتاج لتقسيم الجرعة (Split Bolus) لتجنب الارتفاع المتأخر.<br>`;
  if (avgGI >= 70) alerts += `<strong>📈 مؤشر جلايسيمي مرتفع:</strong> يُفضل حقن الأنسولين قبل الأكل بـ 15 دقيقة.<br>`;
  if (fiber >= 10 && avgGI < 70) alerts += `<strong>🌾 وجبة ممتازة:</strong> الألياف ستساعد في استقرار السكر.<br>`;
  
  if(alerts) { els.smartAlerts.innerHTML = alerts; els.smartAlerts.style.display = 'block'; }
}

// --- Fetch & Save ---
els.btnFetchPre.onclick = async () => {
  const qy = query(collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`), orderBy('when', 'desc'), limit(1));
  const snap = await getDocs(qy);
  if(!snap.empty && (new Date() - snap.docs[0].data().when.toDate() < 3600000)) {
    const d = snap.docs[0].data();
    els.preBg.value = d.value; els.preBgUnit.value = d.unit || 'mg/dL';
    els.measureSource.value = d.measureMethod === 'sensor' ? 'cgm' : 'bgm';
    els.measureSource.dispatchEvent(new Event('change'));
    calculateBolus(); alert('تم سحب آخر قراءة بنجاح.');
  } else { alert('لا توجد قراءات حديثة. يرجى القياس الآن.'); }
};

async function loadTodayMeals() {
  const qy = query(collection(db, `parents/${state.parentId}/children/${state.childId}/meals`), where('date', '==', state.date));
  const snap = await getDocs(qy);
  state.eatenToday = 0;
  
  if(snap.empty) { els.dailyMealsBody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;">لا توجد وجبات مسجلة اليوم</td></tr>`; } 
  else {
    let html = '';
    snap.forEach(d => {
      const m = d.data(); state.eatenToday += Number(m.carbs||0);
      html += `<tr><td>${m.slotKey}</td><td>${m.carbs}g</td><td>${m.carbDose||0}U</td><td>${m.correctionDose||0}U</td><td><strong style="color:var(--primary)">${m.totalInsulin||0}U</strong></td></tr>`;
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
    const timeObj = new Date();
    
    // حفظ دايت هدف الأم
    const target = Number(els.dailyCarbTarget.value);
    if(target > 0 && target !== state.child.dietGoal) {
      await setDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`), { dietGoal: target }, { merge: true });
    }

    if (carbs > 0) {
      await addDoc(collection(db, `parents/${state.parentId}/children/${state.childId}/meals`), {
        date: state.date, when: timeObj, slotKey: state.slot, carbs: carbs, totalInsulin: state.finalDoseVal,
        items: state.mealItems.map(m=>({name:m.name, qty:m.mealQty, netCarb:m.carbs_g})), createdAt: serverTimestamp()
      });
    }
    if (!isNaN(bg)) {
      await addDoc(collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`), {
        date: state.date, when: timeObj, slotKey: state.slot, value: bg, unit: els.preBgUnit.value,
        measureMethod: els.measureSource.value === 'cgm' ? 'sensor' : 'blood', carbs: carbs, totalDose: state.finalDoseVal, createdAt: serverTimestamp()
      });
    }
    alert("تم اعتماد الجرعة وحفظ السجل بنجاح! ✅"); location.href = `child.html?child=${state.childId}`;
  } catch(e) { console.error(e); alert("خطأ في الحفظ"); } finally { els.btnSaveMeal.disabled = false; els.btnSaveMeal.textContent = "💾 اعتماد الجرعة وحفظ الوجبة"; }
};

function setupEvents() {
  $('logoutBtn').onclick = () => signOut(auth);
  els.slotSelect.onchange = () => { state.slot = els.slotSelect.value; updateFactorsDisplay(); };
  els.dateInput.onchange = () => { state.date = els.dateInput.value; els.todayDateLabel.textContent = state.date; loadTodayMeals(); };
  els.netCarbRule.onchange = () => { state.rule = els.netCarbRule.value; renderMealTable(); updateMealTotals(); };
  els.preBg.oninput = calculateBolus; els.iobValue.oninput = calculateBolus;
  els.trendArrow.onchange = calculateBolus;
  els.manualCarbs.oninput = () => { state.manualCarbDirty = true; calculateBolus(); };
  els.measureSource.onchange = () => { els.trendContainer.classList.toggle('hidden', els.measureSource.value !== 'cgm'); calculateBolus(); };
  els.dailyCarbTarget.oninput = updateDietProgress;
  
  els.btnOpenLibrary.onclick = () => els.libModal.classList.add('open');
  els.libClose.onclick = () => els.libModal.classList.remove('open');
  els.libOverlay.onclick = () => els.libModal.classList.remove('open');
  els.searchBox.oninput = renderLibrary;
  els.btnClearMeal.onclick = () => { state.mealItems=[]; state.manualCarbDirty=false; renderMealTable(); updateMealTotals(); els.manualCarbs.value=''; calculateBolus(); };
}
