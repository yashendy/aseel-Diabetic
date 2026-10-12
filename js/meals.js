// js/meals.js
// ========================================================
// 1. المكتبات
// ========================================================
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteField, getDocs, query, where, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  esc, round, localDateStr, localTimeStr, whenFromParts, toDateObj, convert, mealOfSlot, SLOT_ORDER,
  getTherapy, calcBolus, calcIOB, extractDoseEntries, isMealDoc, glucoseFields
} from './dose-engine.js';
 
// ========================================================
// 2. أدوات وحالة الصفحة
// ========================================================
const $ = id => document.getElementById(id);
const fmt = (n, d = 1) => Number.isFinite(n) ? (+n).toFixed(d) : "—";
const SAFE_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20style%3D%22background%3A%23f1f5f9%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-size%3D%2220%22%3E%F0%9F%8D%BD%EF%B8%8F%3C%2Ftext%3E%3C%2Fsvg%3E';
 
let state = {
  childId: null, parentId: null, child: null, therapy: null,
  date: localDateStr(), time: localTimeStr(), slot: "PRE_BREAKFAST",
  rule: "fullFiber", globalFoods: [], mealItems: [],
  finalDoseVal: 0, lastCalc: null, mealStats: { fat: 0, pro: 0, avgGI: 0, fiber: 0 },
  iobDirty: false, iobAuto: 0, iobCount: 0,
  manualCarbDirty: false, manualDoseDirty: false, isRescueMode: false,
  eatenToday: 0, caloriesEatenToday: 0, currentMealCarbs: 0, currentMealCalories: 0, currentBgUnit: "mg/dL"
};
 
const els = {
  loader: $("loader"), chipCF: $("lblCF"), chipCR: $("lblCR"), chipTarget: $("lblTarget"),
  dateInput: $("dateInput"), timeInput: $("timeInput"), slotSelect: $("slotSelect"),
  preBg: $("preBg"), preBgUnit: $("preBgUnit"), btnFetchPre: $("btnFetchPre"),
  measureSource: $("measureSource"), trendContainer: $("trendContainer"), trendArrow: $("trendArrow"),
  netCarbRule: $("netCarbRule"), doseCorrection: $("doseCorrection"), doseCarbs: $("doseCarbs"),
  manualCarbs: $("manualCarbs"), iobValue: $("iobValue"),
  smartAlerts: $("smartAlerts"), doseFinalInput: $("doseFinalInput"), doseDetailsStr: $("doseDetailsStr"),
  hypoRescueArea: $("hypoRescueArea"), hypoRescueText: $("hypoRescueText"), hypoTreatment: $("hypoTreatment"), btnRescueLib: $("btnRescueLib"), mealNotes: $("mealNotes"),
  btnClearMeal: $("btnClearMeal"), btnSaveMeal: $("btnSaveMeal"), btnOpenLibrary: $("btnOpenLibrary"),
  mealBody: $("mealBody"), sumFiber: $("sumFiber"), sumProtein: $("sumProtein"), sumFat: $("sumFat"),
  sumCarbsNet: $("sumCarbsNet"), sumCalories: $("sumCalories"), avgGI: $("avgGI"),
  libModal: $("libModal"), libOverlay: $("libOverlay"), libClose: $("libClose"),
  searchBox: $("searchBox"), itemsGrid: $("itemsGrid"), loadingLibrary: $("loadingLibrary"),
  dailyCarbTarget: $("dailyCarbTarget"), carbProgressBar: $("carbProgressBar"), carbProgressText: $("carbProgressText"),
  dailyCalorieTarget: $("dailyCalorieTarget"), calProgressBar: $("calProgressBar"), calProgressText: $("calProgressText"),
  todayDateLabel: $("todayDateLabel"), dailyMealsBody: $("dailyMealsBody")
};
 
// عناصر إضافية تُنشأ برمجياً (بدون الحاجة لتعديل HTML)
const iobNote = document.createElement('div');
iobNote.className = 'muted tiny'; iobNote.style.marginTop = '4px';
els.iobValue?.parentElement?.appendChild(iobNote);
 
const therapyWarn = document.createElement('div');
therapyWarn.style.cssText = 'display:none; background:#fef2f2; border:1px solid #fca5a5; color:#991b1b; padding:10px; border-radius:8px; margin-bottom:10px; font-size:13px;';
(document.querySelector('.calc-row')?.parentElement || document.body).prepend(therapyWarn);
 
const measColl = () => collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`);
function showLoader(v) { els.loader.classList.toggle('hidden', !v); }
function getSlotLabel(key) { const l = { PRE_BREAKFAST: 'الفطار', PRE_LUNCH: 'الغداء', PRE_DINNER: 'العشاء', SNACK: 'سناك' }; return l[key] || esc(key); }
const fiberFactor = () => state.rule === "fullFiber" ? 1 : state.rule === "halfFiber" ? 0.5 : 0;
 
// ========================================================
// 3. التحقق من الدخول وتهيئة الصفحة
// ========================================================
onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
 
  const qp = new URLSearchParams(location.search);
  state.childId = qp.get('child') || localStorage.getItem('selectedChildId');
  state.parentId = localStorage.getItem('selectedParentId') || u.uid;
  if (!state.childId) { location.href = 'parent.html'; return; }
 
  state.date = qp.get("date") || state.date;
  state.time = qp.get("time") || state.time;
  state.slot = qp.get("slot") || state.slot;
  els.dateInput.value = state.date; els.timeInput.value = state.time; els.slotSelect.value = state.slot;
 
  const passedBg = qp.get("bg");
  if (passedBg) { els.preBg.value = passedBg; if (qp.get("unit")) els.preBgUnit.value = qp.get("unit"); }
 
  try {
    await loadChildData();
    setupEvents();
    if (!qp.get("slot")) autoSelectMealSlot();
    fetchFoodLibrary();
    await loadTodayMeals();
    await loadIOB();
    if (passedBg) calculateBolus();
  } catch (e) { console.error(e); alert("تعذر تحميل بيانات الطفل. تأكدي من الاتصال وحاولي مرة أخرى."); }
  finally { showLoader(false); }
});
 
// ========================================================
// 4. تحميل بيانات الطفل
// ========================================================
async function loadChildData() {
  const snap = await getDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`));
  if (!snap.exists()) throw new Error('Child not found');
  const c = snap.data(); state.child = { id: snap.id, ...c };
  state.therapy = getTherapy(c);
 
  const name = c.name || 'الطفل';
  $('topAvatar').textContent = name.charAt(0); $('topChildName').textContent = name;
  $('topChildMeta').textContent = `${c.gender === 'female' ? 'أنثى' : 'ذكر'} • ${state.therapy.unit}`;
  $('breadChildName').textContent = name; $('breadChildName').href = `child.html?child=${state.childId}`;
  $('navHome').href = `child.html?child=${state.childId}`; $('navMeas').href = `measurements.html?child=${state.childId}`;
  $('navReports').href = `reports.html?child=${state.childId}`;
 
  state.rule = state.therapy.netCarbRule;
  els.netCarbRule.value = state.rule;
  if (!els.preBg.value) els.preBgUnit.value = state.therapy.unit;
  state.currentBgUnit = els.preBgUnit.value;
  els.todayDateLabel.textContent = state.date;
 
  if (c.dietGoal) els.dailyCarbTarget.value = c.dietGoal;
  if (c.calorieGoal) els.dailyCalorieTarget.value = c.calorieGoal;
 
  if (els.hypoRescueText) els.hypoRescueText.textContent = `الطفل في حالة هبوط! الجرعة صُفرت. عالجي بـ ${state.therapy.hypoCarbs} جرام كارب سريع (اكتبي العلاج يدوياً أو دعِي المنصة تحسب الكمية من المكتبة) ثم أعيدي القياس بعد 15 دقيقة.`;
 
  const miss = [...state.therapy.missing];
  ['breakfast', 'lunch', 'dinner', 'snack'].forEach(k => { if (!state.therapy.CR[k]) miss.push('CR ' + ({ breakfast: 'الفطار', lunch: 'الغداء', dinner: 'العشاء', snack: 'السناك' })[k]); });
  if (miss.length) {
    therapyWarn.style.display = 'block';
    therapyWarn.innerHTML = `⚠️ <b>إعدادات الجرعة ناقصة:</b> ${esc(miss.join('، '))}. الحاسبة لن تقترح جرعة للبيانات الناقصة حتى تكتمل من <a href="child-edit.html?id=${encodeURIComponent(state.childId)}">إعدادات الطفل</a>.`;
  }
  updateFactorsDisplay();
}
 
function autoSelectMealSlot() {
  const h = parseInt(state.time.split(':')[0]);
  if (h >= 5 && h < 11) state.slot = 'PRE_BREAKFAST';
  else if (h >= 11 && h < 16) state.slot = 'PRE_LUNCH';
  else if (h >= 16 && h < 22) state.slot = 'PRE_DINNER';
  else state.slot = 'SNACK';
  els.slotSelect.value = state.slot; updateFactorsDisplay();
}
 
function updateFactorsDisplay() {
  const t = state.therapy; if (!t) return;
  const cr = t.CR[mealOfSlot(state.slot)];
  els.chipCF.textContent = t.CF ?? '—'; els.chipCR.textContent = cr ?? '—'; els.chipTarget.textContent = t.target ?? '—';
  calculateBolus();
}
 
function updateDietProgress(mealCarbs = 0, mealCals = 0) {
  const targetCarb = Number(els.dailyCarbTarget.value); const totalCarb = state.eatenToday + mealCarbs;
  if (targetCarb > 0) {
    els.carbProgressText.textContent = `${Math.round(totalCarb)} / ${targetCarb} جرام`;
    const pct = (totalCarb / targetCarb) * 100;
    els.carbProgressBar.style.width = Math.min(100, pct) + '%'; els.carbProgressBar.className = `progress-fill carb-fill ${pct > 100 ? 'danger' : pct > 85 ? 'warn' : ''}`;
  } else { els.carbProgressText.textContent = `إجمالي المستهلك اليوم: ${Math.round(totalCarb)} جرام`; els.carbProgressBar.style.width = '0%'; }
 
  const targetCal = Number(els.dailyCalorieTarget.value); const totalCal = state.caloriesEatenToday + mealCals;
  if (targetCal > 0) {
    els.calProgressText.textContent = `${Math.round(totalCal)} / ${targetCal} kcal`;
    const pct = (totalCal / targetCal) * 100;
    els.calProgressBar.style.width = Math.min(100, pct) + '%'; els.calProgressBar.className = `progress-fill cal-fill ${pct > 100 ? 'danger' : pct > 85 ? 'warn' : ''}`;
  } else { els.calProgressText.textContent = `إجمالي المستهلك اليوم: ${Math.round(totalCal)} kcal`; els.calProgressBar.style.width = '0%'; }
}
 
// ========================================================
// 5. الأنسولين النشط IOB (تلقائي من الجرعات المسجلة)
// ========================================================
async function loadIOB() {
  const t = state.therapy; if (!t) return;
  const at = whenFromParts(state.date, state.time);
  const since = new Date(at.getTime() - t.diaHours * 3600e3);
  try {
    const snap = await getDocs(query(measColl(), where('when', '>=', since), where('when', '<', at)));
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
 
    // الوثيقة التي ستُستبدل عند الحفظ (وجبة محفوظة لنفس الوقت) لا تُحسب مرتين
    const same = docs.filter(d => d.date === state.date && d.slotKey === state.slot && isMealDoc(d));
    const skipIds = new Set(same.map(d => d.id));
    docs = docs.filter(d => !skipIds.has(d.id));
 
    const entries = extractDoseEntries(docs);
    state.iobAuto = calcIOB(entries, at, t.diaHours);
    state.iobCount = entries.length;
    if (!state.iobDirty) els.iobValue.value = state.iobAuto > 0 ? state.iobAuto : '';
    iobNote.textContent = entries.length
      ? `محسوب تلقائياً من ${entries.length} جرعة خلال آخر ${t.diaHours} ساعات (تقدير خطي) — يمكنك تعديله.`
      : `لا توجد جرعات مسجلة خلال آخر ${t.diaHours} ساعات.`;
  } catch (e) {
    console.error(e);
    iobNote.textContent = 'تعذر حساب IOB تلقائياً — أدخليه يدوياً.';
  }
  calculateBolus();
}
 
// ========================================================
// 6. مكتبة الأصناف
// ========================================================
async function fetchFoodLibrary() {
  try {
    const snap = await getDocs(collection(db, "admin/global/foodItems"));
    state.globalFoods = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.isActive !== false);
    renderLibrary(); els.loadingLibrary.style.display = 'none';
  } catch (err) { els.loadingLibrary.textContent = "⚠️ خطأ في تحميل المكتبة."; }
}
 
function renderLibrary() {
  if (!els.itemsGrid) return;
  const q = els.searchBox.value.toLowerCase();
  let list = state.globalFoods.filter(f => !q || String(f.searchText || f.name || '').toLowerCase().includes(q));
  if (state.isRescueMode) list = list.filter(f => f.tags && f.tags.includes('#علاج_هبوط'));
 
  if (!list.length) { els.itemsGrid.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8;">${state.isRescueMode ? 'لا توجد أصناف مخصصة لعلاج الهبوط في المكتبة.' : 'لا توجد نتائج مطابقة لبحثك.'}</div>`; return; }
 
  els.itemsGrid.innerHTML = list.map(f => {
    const giStr = f.per100?.gi ? `<span class="gi-badge ${f.per100.gi > 70 ? 'high' : ''}">GI: ${esc(f.per100.gi)}</span>` : '';
    return `
      <div class="food-lib-item" data-id="${esc(f.id)}">
        <div class="food-img-col"><img src="${esc(f.image?.url || SAFE_PLACEHOLDER)}" onerror="this.src='${SAFE_PLACEHOLDER}';">${giStr}</div>
        <div class="details">
          <div class="food-title">${esc(f.name)}</div>
          <div class="macros-grid">
            <div class="m-box"><span class="m-val">${esc(f.per100?.carbs_g || 0)}g</span><span class="m-lbl">كارب</span></div>
            <div class="m-box"><span class="m-val">${esc(f.per100?.protein_g || 0)}g</span><span class="m-lbl">بروتين</span></div>
            <div class="m-box"><span class="m-val">${esc(f.per100?.fat_g || 0)}g</span><span class="m-lbl">دهون</span></div>
            <div class="m-box"><span class="m-val" style="color:#f59e0b">${esc(f.per100?.cal_kcal || 0)}</span><span class="m-lbl">kcal</span></div>
          </div>
        </div>
        <button class="btn primary sm add-btn">${state.isRescueMode ? 'اختيار للرفع' : 'إضافة'}</button>
      </div>`;
  }).join('');
 
  document.querySelectorAll('.food-lib-item .add-btn').forEach(btn => {
    btn.onclick = () => addItemToMeal(btn.closest('.food-lib-item').dataset.id);
  });
}
 
function addItemToMeal(id) {
  const food = state.globalFoods.find(f => f.id === id);
  if (!food) return;
 
  if (state.isRescueMode) {
    const carbsPer100 = Number(food.per100?.carbs_g) || 0;
    if (carbsPer100 <= 0) { alert('هذا الصنف لا يحتوي على كارب فلا يصلح لرفع السكر. اختاري صنفاً آخر.'); return; }
    const target = state.therapy?.hypoCarbs || 15;
    const roundedGrams = Math.round((target / carbsPer100) * 100);
    if (els.hypoTreatment) els.hypoTreatment.value = `تم الرفع بـ ${roundedGrams} جرام/مل من ${food.name} (${target} جم كارب) 🧃`;
    els.libModal.classList.remove('open');
    state.isRescueMode = false;
    return;
  }
 
  state.mealItems.push({ uid: Date.now().toString(), ...food, mealQty: 1, selectedUnitIndex: 0, availableUnits: food.units?.length ? food.units : [{ label: '100 جرام', grams: 100 }] });
  state.manualCarbDirty = false;
  if (els.searchBox) els.searchBox.value = '';
  renderLibrary(); renderMealTable(); updateMealTotals();
  els.libModal.classList.remove('open');
}
 
// حساب مكونات صنف واحد (مصدر واحد للجدول والإجماليات والحفظ)
function itemMacros(item) {
  const unit = item.availableUnits[item.selectedUnitIndex];
  const grams = (Number(item.mealQty) || 0) * (unit?.grams || 100);
  const ratio = grams / 100;
  const p = item.per100 || {};
  const carbs = (p.carbs_g || 0) * ratio, fiber = (p.fiber_g || 0) * ratio;
  return {
    unitLabel: unit?.label || '100 جرام', grams, carbs, fiber,
    net: Math.max(0, carbs - fiber * fiberFactor()),
    protein: (p.protein_g || 0) * ratio, fat: (p.fat_g || 0) * ratio, kcal: (p.cal_kcal || 0) * ratio,
    gi: Number(p.gi) || 0
  };
}
 
function renderMealTable() {
  if (!state.mealItems.length) { els.mealBody.innerHTML = `<tr><td colspan="10" class="muted" style="text-align:center; padding:20px;">لم يتم إضافة أصناف للوجبة بعد.</td></tr>`; return; }
  els.mealBody.innerHTML = state.mealItems.map((item, idx) => {
    const m = itemMacros(item);
    const opts = item.availableUnits.map((u, i) => `<option value="${i}" ${item.selectedUnitIndex == i ? 'selected' : ''}>${esc(u.label)}</option>`).join('');
    return `
      <tr data-idx="${idx}">
        <td style="font-weight:bold;">${esc(item.name)} ${m.gi > 70 ? '<span style="font-size:10px; background:#fee2e2; color:#ef4444; padding:2px 4px; border-radius:4px;">عالي GI</span>' : ''}</td>
        <td><input type="number" step="0.5" class="qty-input input" value="${esc(item.mealQty)}" style="width:60px; padding:4px;"></td>
        <td><select class="unit-select input" style="width:100px; padding:4px;">${opts}</select></td>
        <td style="color:#7c3aed; font-weight:bold;">${fmt(m.net)}</td>
        <td class="muted">${fmt(m.fiber)}</td>
        <td class="muted">${fmt(m.protein)}</td>
        <td class="muted">${fmt(m.fat)}</td>
        <td class="muted">${fmt(m.kcal)}</td>
        <td class="muted">${m.gi || '—'}</td>
        <td><button class="del-btn">✕</button></td>
      </tr>`;
  }).join('');
  // تحديث الإجماليات فقط أثناء الكتابة (بدون إعادة رسم الجدول حتى لا يفقد الحقل التركيز)
  document.querySelectorAll('.qty-input').forEach(i => i.oninput = e => {
    state.mealItems[e.target.closest('tr').dataset.idx].mealQty = Number(e.target.value) || 0;
    state.manualCarbDirty = false; updateMealTotals(); refreshRowCells(e.target.closest('tr'));
  });
  document.querySelectorAll('.unit-select').forEach(s => s.onchange = e => { state.mealItems[e.target.closest('tr').dataset.idx].selectedUnitIndex = Number(e.target.value); state.manualCarbDirty = false; renderMealTable(); updateMealTotals(); });
  document.querySelectorAll('.del-btn').forEach(b => b.onclick = e => { state.mealItems.splice(e.target.closest('tr').dataset.idx, 1); state.manualCarbDirty = false; renderMealTable(); updateMealTotals(); });
}
 
function refreshRowCells(tr) {
  const m = itemMacros(state.mealItems[tr.dataset.idx]); const td = tr.querySelectorAll('td');
  td[3].textContent = fmt(m.net); td[4].textContent = fmt(m.fiber); td[5].textContent = fmt(m.protein); td[6].textContent = fmt(m.fat); td[7].textContent = fmt(m.kcal);
}
 
function updateMealTotals() {
  let sumNet = 0, sumFib = 0, sumFat = 0, sumPro = 0, sumCal = 0, weightedGI = 0, giSum = 0;
  state.mealItems.forEach(item => {
    const m = itemMacros(item);
    sumNet += m.net; sumFib += m.fiber; sumFat += m.fat; sumPro += m.protein; sumCal += m.kcal;
    if (m.gi > 0 && m.net > 0) { weightedGI += m.gi * m.net; giSum += m.net; }
  });
  const avgGI = giSum > 0 ? Math.round(weightedGI / giSum) : 0;
  els.sumCarbsNet.textContent = `${fmt(sumNet)} g`; els.sumFiber.textContent = `${fmt(sumFib)} g`;
  els.sumProtein.textContent = `${fmt(sumPro)} g`; els.sumFat.textContent = `${fmt(sumFat)} g`;
  els.sumCalories.textContent = `${fmt(sumCal, 0)} kcal`; els.avgGI.textContent = avgGI || '—';
 
  state.currentMealCarbs = sumNet; state.currentMealCalories = sumCal;
  state.mealStats = { fat: sumFat, pro: sumPro, avgGI, fiber: sumFib };
  if (!state.manualCarbDirty) els.manualCarbs.value = fmt(sumNet, 1);
  updateDietProgress(state.currentMealCarbs, state.currentMealCalories);
  calculateBolus();
}
 
// ========================================================
// 7. عرض نتيجة محرك الجرعات
// ========================================================
function calculateBolus() {
  const t = state.therapy; if (!t) return;
  if (state.manualDoseDirty) return;
 
  const bg = parseFloat(els.preBg?.value) || 0;
  const carbs = parseFloat(els.manualCarbs?.value) || 0;
  const iob = parseFloat(els.iobValue?.value) || 0;
  const trend = els.measureSource?.value === 'cgm' ? (Number(els.trendArrow?.value) || 0) : 0;
 
  const r = calcBolus({ therapy: t, slotKey: state.slot, bg, bgUnit: els.preBgUnit?.value, carbs, iob, trend, stats: state.mealStats });
  state.lastCalc = r; state.finalDoseVal = r.finalDose;
 
  if (els.doseCarbs) els.doseCarbs.value = r.blocked ? '' : fmt(r.carbDose);
  if (els.doseCorrection) {
    els.doseCorrection.value = r.blocked ? '' : fmt(Math.max(0, r.correction));
    els.doseCorrection.parentElement.style.display = (r.correction > 0) ? 'flex' : 'none';
  }
  if (els.doseFinalInput) {
    els.doseFinalInput.value = r.blocked ? '' : fmt(r.finalDose);
    const bad = r.isHypo || r.blocked || r.capped;
    els.doseFinalInput.style.borderColor = bad ? '#fca5a5' : '#86efac';
    els.doseFinalInput.style.color = bad ? 'var(--danger)' : 'var(--ok)';
  }
  if (els.hypoRescueArea) els.hypoRescueArea.style.display = r.isHypo ? 'block' : 'none';
 
  if (els.doseDetailsStr) {
    if (!r.blocked && !r.isHypo && (carbs > 0 || bg > 0)) {
      els.doseDetailsStr.style.display = 'block';
      els.doseDetailsStr.className = 'muted tiny';
      els.doseDetailsStr.textContent = `كارب ${fmt(r.carbDose)} + تصحيح ${fmt(r.correction)} − IOB ${fmt(r.iobUsed)} = ${fmt(r.rawDose)} → ${fmt(r.finalDose)}U (تقريب ${t.step}U)`;
    } else els.doseDetailsStr.style.display = 'none';
  }
 
  if (els.smartAlerts) {
    let html = '';
    if (r.blocked) html += `<strong>⛔ لا يمكن حساب الجرعة:</strong> ${esc(r.blocked)}<br>`;
    r.alerts.forEach(a => { html += a.text + '<br>'; });
    els.smartAlerts.style.display = html ? 'block' : 'none';
    els.smartAlerts.innerHTML = html;
  }
}
 
const resetManualDose = () => { state.manualDoseDirty = false; calculateBolus(); };
 
// ========================================================
// 8. استرجاع سجلات اليوم
// ========================================================
const latestByWhen = arr => arr.reduce((a, b) => (!a || (toDateObj(b.when) || 0) > (toDateObj(a.when) || 0)) ? b : a, null);
 
async function autoFetchPreMeasurement() {
  els.btnFetchPre.textContent = "⏳...";
  try {
    const snap = await getDocs(query(measColl(), where('date', '==', state.date)));
    const found = latestByWhen(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.slotKey === state.slot));
 
    if (found) {
      els.preBg.value = found.value ?? "";
      if (found.unit) { els.preBgUnit.value = found.unit; state.currentBgUnit = found.unit; }
      els.measureSource.value = found.measureMethod === 'sensor' ? 'cgm' : 'bgm';
      els.measureSource.dispatchEvent(new Event('change'));
 
      if (found.carbs) { els.manualCarbs.value = found.carbs; state.manualCarbDirty = true; } else { els.manualCarbs.value = ""; }
 
      if (isMealDoc(found) && found.totalDose !== undefined) {
        els.doseFinalInput.value = found.totalDose;
        state.finalDoseVal = found.totalDose;
        state.manualDoseDirty = true;
      }
      if (els.hypoTreatment) els.hypoTreatment.value = found.hypoTreatment || "";
      if (els.mealNotes) els.mealNotes.value = found.notes || "";
 
      calculateBolus();
      els.btnFetchPre.textContent = "✅ تم الجلب";
    } else {
      els.preBg.value = ""; els.manualCarbs.value = "";
      if (els.hypoTreatment) els.hypoTreatment.value = "";
      if (els.mealNotes) els.mealNotes.value = "";
      resetManualDose();
      els.btnFetchPre.textContent = "❌ جديد";
    }
    setTimeout(() => els.btnFetchPre.textContent = "🔄 جلب", 2000);
  } catch (e) { console.error(e); els.btnFetchPre.textContent = "🔄 جلب"; }
}
 
async function loadTodayMeals() {
  const snap = await getDocs(query(measColl(), where('date', '==', state.date)));
  state.eatenToday = 0; state.caloriesEatenToday = 0;
 
  const validDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => m.carbs > 0 || m.totalDose > 0);
  if (validDocs.length === 0) {
    els.dailyMealsBody.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;">لا توجد وجبات أو قياسات مسجلة في هذا اليوم</td></tr>`;
  } else {
    validDocs.sort((a, b) => (toDateObj(a.when) || 0) - (toDateObj(b.when) || 0));
    els.dailyMealsBody.innerHTML = validDocs.map(m => {
      state.eatenToday += Number(m.carbs || 0); state.caloriesEatenToday += Number(m.calories || 0);
      return `
        <tr>
          <td>${getSlotLabel(m.slotKey)}</td>
          <td>${esc(m.carbs || 0)}g</td>
          <td>${Number(m.calories || 0).toFixed(1)} kcal</td>
          <td>${esc(m.carbDose || 0)}U</td>
          <td>${esc(m.correctionDose || 0)}U</td>
          <td><strong style="color:var(--primary)">${esc(m.totalDose || m.totalInsulin || 0)}U</strong></td>
          <td>
            <button class="btn ghost sm" data-act="edit" data-slot="${esc(m.slotKey)}" style="padding:4px; font-size:12px;">✏️ تعديل</button>
            <button class="btn danger sm" data-act="del" data-id="${esc(m.id)}" style="padding:4px; font-size:12px;">🗑️</button>
          </td>
        </tr>`;
    }).join('');
  }
  updateDietProgress();
}
 
// حذف الوجبة والجرعة فقط، ويُبقي قراءة السكر لو كانت مسجلة في نفس الوثيقة
async function deleteMeal(docId) {
  try {
    showLoader(true);
    const ref = doc(measColl(), docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data();
    const hasBg = d.value !== undefined && d.value !== null && d.value !== '';
    const earlier = Number(d.earlierCorrectionDose) || 0;
 
    if (!confirm(hasBg ? "سيتم حذف الوجبة والجرعة فقط، وتبقى قراءة السكر في السجل. متابعة؟" : "هل أنت متأكد من حذف هذه الوجبة نهائياً؟")) return;
 
    if (hasBg || earlier > 0) {
      await updateDoc(ref, {
        carbs: deleteField(), calories: deleteField(), protein: deleteField(), fat: deleteField(), fiber: deleteField(), avgGI: deleteField(),
        carbDose: deleteField(), totalDose: deleteField(), suggestedDose: deleteField(), doseOverridden: deleteField(),
        iobUsed: deleteField(), cfUsed: deleteField(), crUsed: deleteField(), targetUsed: deleteField(), netCarbRule: deleteField(),
        mealItemsRef: deleteField(), earlierCorrectionDose: deleteField(), mealSaved: deleteField(),
        correctionDose: earlier > 0 ? earlier : deleteField()
      });
    } else {
      await deleteDoc(ref);
    }
    alert("تم الحذف 🗑️");
    await loadTodayMeals(); await loadIOB(); autoFetchPreMeasurement();
  } catch (error) { console.error(error); alert("حدث خطأ أثناء الحذف."); }
  finally { showLoader(false); }
}
 
// ========================================================
// 9. الحفظ
// ========================================================
els.btnSaveMeal.onclick = async () => {
  const t = state.therapy; if (!t) return;
  const carbs = parseFloat(els.manualCarbs.value) || 0;
  const bg = parseFloat(els.preBg.value);
  if (!carbs && isNaN(bg)) { alert("أدخل الكارب أو قراءة السكر للحفظ."); return; }
 
  const totalDose = parseFloat(els.doseFinalInput.value) || 0;
  const calc = state.lastCalc;
  const suggested = calc && !calc.blocked ? calc.finalDose : null;
 
  // ---- حواجز الأمان قبل الحفظ ----
  if (t.maxDose && totalDose > t.maxDose) {
    alert(`⛔ الجرعة (${totalDose}U) أعلى من الحد الأقصى المحدد للطفل (${t.maxDose}U). عدّلي الجرعة أو راجعي الطبيب لتعديل الحد.`);
    return;
  }
  if (calc?.isHypo && totalDose > 0 && !confirm("⚠️ السكر منخفض الآن! هل أنت متأكدة من إعطاء أنسولين؟")) return;
  if (suggested === null && totalDose > 0 && !confirm("الجرعة مُدخلة يدوياً بدون حساب من الحاسبة (إعدادات ناقصة). هل راجعتِها مع الطبيب؟")) return;
  if (suggested !== null && Math.abs(totalDose - suggested) > Math.max(t.step, suggested * 0.2) &&
      !confirm(`الجرعة المدخلة (${totalDose}U) تختلف عن المحسوبة (${suggested}U). تأكيد الحفظ؟`)) return;
 
  els.btnSaveMeal.disabled = true; els.btnSaveMeal.textContent = "جاري الحفظ...";
  try {
    const timeObj = whenFromParts(state.date, state.time);
 
    // أهداف الدايت
    const updates = {};
    const tCarb = Number(els.dailyCarbTarget.value); const tCal = Number(els.dailyCalorieTarget.value);
    if (tCarb > 0 && tCarb !== state.child.dietGoal) updates.dietGoal = tCarb;
    if (tCal > 0 && tCal !== state.child.calorieGoal) updates.calorieGoal = tCal;
    if (Object.keys(updates).length > 0) { await setDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`), updates, { merge: true }); Object.assign(state.child, updates); }
 
    // أحدث وثيقة لنفس اليوم والوجبة
    const snap = await getDocs(query(measColl(), where("date", "==", state.date)));
    const target = latestByWhen(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.slotKey === state.slot));
 
    // تصحيح أُعطي مسبقاً من صفحة القياس (لم يكن وجبة) → يُحفظ ويُحسب ضمن إجمالي الجرعات
    const earlier = (target && !isMealDoc(target)) ? (Number(target.correctionDose) || 0) : 0;
 
    const items = state.mealItems.map(it => {
      const m = itemMacros(it);
      return { name: it.name, foodId: it.id || null, qty: it.mealQty, unit: m.unitLabel, grams: round(m.grams, 1), carbs_g: round(m.carbs, 1), netCarb_g: round(m.net, 1), fiber_g: round(m.fiber, 1), protein_g: round(m.protein, 1), fat_g: round(m.fat, 1), kcal: round(m.kcal, 0), gi: m.gi || null };
    });
 
    const payload = {
      date: state.date, time: state.time, when: timeObj, slotKey: state.slot, slotOrder: SLOT_ORDER[state.slot] || 200,
      mealSaved: true,
      carbs, calories: round(state.currentMealCalories, 1),
      protein: round(state.mealStats.pro, 1), fat: round(state.mealStats.fat, 1), fiber: round(state.mealStats.fiber, 1), avgGI: state.mealStats.avgGI || null,
      carbDose: calc && !calc.blocked ? round(calc.carbDose, 2) : null,
      correctionDose: calc && !calc.blocked ? round(Math.max(0, calc.correction), 2) : (parseFloat(els.doseCorrection?.value) || 0),
      totalDose: round(totalDose + earlier, 2),
      earlierCorrectionDose: earlier > 0 ? earlier : null,
      suggestedDose: suggested,
      doseOverridden: suggested !== null ? Math.abs(totalDose - suggested) > 1e-9 : true,
      iobUsed: calc ? round(calc.iobUsed, 2) : null,
      cfUsed: t.CF, crUsed: calc?.cr ?? t.CR[mealOfSlot(state.slot)] ?? null, targetUsed: t.target,
      netCarbRule: state.rule,
      hypoTreatment: els.hypoTreatment?.value || "",
      notes: els.mealNotes?.value || ""
    };
    if (items.length > 0) payload.mealItemsRef = items;
 
    if (!isNaN(bg)) {
      Object.assign(payload, glucoseFields(bg, els.preBgUnit.value, t));
      payload.measureMethod = els.measureSource.value === 'cgm' ? 'sensor' : 'blood';
    }
 
    if (target) await setDoc(doc(measColl(), target.id), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
    else await addDoc(measColl(), { ...payload, createdAt: serverTimestamp() });
 
    alert("تم حفظ واعتماد الجرعة بنجاح! ✅");
    await loadTodayMeals(); loadIOB();
  } catch (e) {
    console.error(e);
    alert("خطأ في الحفظ: " + e.message);
  } finally { els.btnSaveMeal.disabled = false; els.btnSaveMeal.textContent = "💾 اعتماد الجرعة وحفظ الوجبة"; }
};
 
// ========================================================
// 10. الأحداث
// ========================================================
function setupEvents() {
  $('logoutBtn').onclick = () => signOut(auth);
 
  const refreshContext = () => { state.iobDirty = false; loadIOB(); };
 
  els.dateInput.onchange = () => { state.date = els.dateInput.value; els.todayDateLabel.textContent = state.date; loadTodayMeals(); autoFetchPreMeasurement(); refreshContext(); };
  els.timeInput.onchange = () => { state.time = els.timeInput.value; refreshContext(); };
  els.slotSelect.onchange = () => { state.slot = els.slotSelect.value; state.manualDoseDirty = false; updateFactorsDisplay(); autoFetchPreMeasurement(); refreshContext(); };
 
  els.preBgUnit.onchange = () => {
    const newUnit = els.preBgUnit.value; const bgVal = parseFloat(els.preBg.value);
    if (!isNaN(bgVal) && state.currentBgUnit !== newUnit) {
      const v = convert(bgVal, state.currentBgUnit, newUnit);
      els.preBg.value = newUnit === 'mmol/L' ? v.toFixed(1) : Math.round(v);
    }
    state.currentBgUnit = newUnit; calculateBolus();
  };
 
  els.netCarbRule.onchange = () => { state.rule = els.netCarbRule.value; renderMealTable(); updateMealTotals(); };
 
  els.preBg.oninput = resetManualDose;
  els.iobValue.oninput = () => { state.iobDirty = true; resetManualDose(); };
  els.trendArrow.onchange = resetManualDose;
  els.manualCarbs.oninput = () => { state.manualCarbDirty = true; resetManualDose(); };
  els.measureSource.onchange = () => { els.trendContainer.classList.toggle('hidden', els.measureSource.value !== 'cgm'); resetManualDose(); };
 
  els.doseFinalInput.oninput = () => { state.manualDoseDirty = true; state.finalDoseVal = parseFloat(els.doseFinalInput.value) || 0; };
 
  els.dailyCarbTarget.oninput = () => updateDietProgress(state.currentMealCarbs, state.currentMealCalories);
  els.dailyCalorieTarget.oninput = () => updateDietProgress(state.currentMealCarbs, state.currentMealCalories);
 
  els.btnOpenLibrary.onclick = () => { state.isRescueMode = false; renderLibrary(); els.libModal.classList.add('open'); };
  els.btnRescueLib.onclick = () => { state.isRescueMode = true; renderLibrary(); els.libModal.classList.add('open'); };
  els.libClose.onclick = () => { state.isRescueMode = false; els.libModal.classList.remove('open'); };
  els.libOverlay.onclick = () => { state.isRescueMode = false; els.libModal.classList.remove('open'); };
  els.searchBox.oninput = renderLibrary;
 
  els.btnClearMeal.onclick = () => {
    state.mealItems = []; state.manualCarbDirty = false; state.manualDoseDirty = false;
    state.currentMealCarbs = 0; state.currentMealCalories = 0;
    renderMealTable(); updateMealTotals(); els.manualCarbs.value = '';
    resetManualDose();
  };
 
  // أزرار جدول وجبات اليوم (تعديل/حذف) بدون onclick مضمّن
  els.dailyMealsBody.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    if (btn.dataset.act === 'del') deleteMeal(btn.dataset.id);
    if (btn.dataset.act === 'edit') {
      els.slotSelect.value = btn.dataset.slot; els.slotSelect.dispatchEvent(new Event('change'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}
