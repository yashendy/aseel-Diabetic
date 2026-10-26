// js/meals.js
// ========================================================
// 1. المكتبات
// ========================================================
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteField, getDocs, query, where, orderBy, limit, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  esc, round, localDateStr, localTimeStr, whenFromParts, toDateObj, convert, mealOfSlot, SLOT_ORDER,
  getTherapy, calcBolus, calcIOB, extractDoseEntries, isMealDoc, glucoseFields, roundToStep
} from './dose-engine.js';
import { normAr } from './food-utils.js';
// ========================================================
// 2. أدوات وحالة الصفحة
// ========================================================
const $ = id => document.getElementById(id);
const fmt = (n, d = 1) => Number.isFinite(n) ? (+n).toFixed(d) : "—";
const SAFE_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20style%3D%22background%3A%23f1f5f9%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-size%3D%2220%22%3E%F0%9F%8D%BD%EF%B8%8F%3C%2Ftext%3E%3C%2Fsvg%3E';
export function addHoursToTimeStr(timeStr, hours = 2) {
  if (!timeStr) return '';
  const [h, m] = String(timeStr).split(':').map(Number);
  const totalMins = (h * 60 + (m || 0) + hours * 60) % (24 * 60);
  const nh = Math.floor(totalMins / 60);
  const nm = totalMins % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}
export const PRE_TO_POST_SLOT = {
  PRE_BREAKFAST: 'POST_BREAKFAST',
  PRE_LUNCH: 'POST_LUNCH',
  PRE_DINNER: 'POST_DINNER',
  FASTING: 'POST_BREAKFAST',
  SNACK: 'SNACK'
};
let state = {
  childId: null, parentId: null, child: null, therapy: null,
  date: localDateStr(), time: localTimeStr(), slot: "PRE_BREAKFAST",
  rule: "fullFiber", globalFoods: [], mealItems: [],
  favorites: new Set(), mostUsedIds: [], presetMeals: [], libTab: "all",
  finalDoseVal: 0, lastCalc: null, mealStats: { fat: 0, pro: 0, avgGI: 0, fiber: 0 },
  splitBolus: { enabled: false, ratio: 60, now: 0, later: 0, delayHours: 2 },
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
  todayDateLabel: $("todayDateLabel"), dailyMealsBody: $("dailyMealsBody"),
  postMealReminderBanner: $("postMealReminderBanner"), pmTime: $("pmTime"),
  pmActionBtn: $("pmActionBtn"), pmDismissBtn: $("pmDismissBtn"), pmSplitAlert: $("pmSplitAlert"),
  splitBolusBox: $("splitBolusBox"), enableSplitBolus: $("enableSplitBolus"),
  splitDetailsArea: $("splitDetailsArea"), splitNowVal: $("splitNowVal"),
  splitLaterVal: $("splitLaterVal"), splitDelayHours: $("splitDelayHours"),
  btnOpenTareModal: $("btnOpenTareModal"), tareDialog: $("tareDialog"),
  tareGrossInput: $("tareGrossInput"), tareDishInput: $("tareDishInput"),
  tareNetResult: $("tareNetResult"), copyTareBtn: $("copyTareBtn"), closeTareBtn: $("closeTareBtn"),
  btnSavePresetMeal: $("btnSavePresetMeal"), savePresetDialog: $("savePresetDialog"),
  savePresetForm: $("savePresetForm"), presetMealNameInput: $("presetMealNameInput"),
  presetItemsSummary: $("presetItemsSummary"), closeSavePresetBtn: $("closeSavePresetBtn"),
  cancelSavePresetBtn: $("cancelSavePresetBtn"), presetsCount: $("presetsCount")
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
  const parentIdParam = qp.get('parentId');
  state.parentId = parentIdParam || localStorage.getItem('selectedParentId') || u.uid;
  if (parentIdParam) localStorage.setItem('selectedParentId', parentIdParam);
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
    initMealAiChef();
  } catch (e) { console.error(e); alert("تعذر تحميل بيانات الطفل. تأكدي من الاتصال وحاولي مرة أخرى."); }
  finally { showLoader(false); }
});
// ========================================================
// 4. تحميل بيانات الطفل
// ========================================================
async function loadChildData() {
  let snap = await getDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`));
  if (!snap.exists() && state.parentId !== auth.currentUser?.uid) {
    const fallbackSnap = await getDoc(doc(db, `parents/${auth.currentUser.uid}/children/${state.childId}`));
    if (fallbackSnap.exists()) {
      state.parentId = auth.currentUser.uid;
      snap = fallbackSnap;
      localStorage.setItem('selectedParentId', state.parentId);
    }
  }
  if (!snap.exists()) throw new Error('Child not found');
  const c = snap.data(); state.child = { id: snap.id, ...c };
  state.therapy = getTherapy(c);
  const name = c.name || 'الطفل';
  $('topAvatar').textContent = name.charAt(0); $('topChildName').textContent = name;
  $('topChildMeta').textContent = `${c.gender === 'female' ? 'أنثى' : 'ذكر'} • ${state.therapy.unit}`;
  const isDoctor = state.parentId !== auth.currentUser?.uid;
  const safeChild = encodeURIComponent(state.childId);
  const safeParent = encodeURIComponent(state.parentId);
  const qDoc = `?child=${safeChild}&parentId=${safeParent}`;
  const qChild = `?child=${safeChild}`;
    const qDocParams = isDoctor ? qDoc : qChild;
    const qParams = qDocParams;
  const workstationUrl = `doctor-child.html${qDoc}`;

  const parentNav = $('parentNav');
  const doctorNav = $('doctorNav');
  const backBtn = $('backBtn');
  const breadRoot = $('breadRootLink');

  $('breadChildName').textContent = name;

  if (isDoctor) {
    if (parentNav) { parentNav.classList.add('hidden'); parentNav.style.display = 'none'; }
    if (doctorNav) { doctorNav.classList.remove('hidden'); doctorNav.style.display = 'flex'; }

    $('navDocStation')?.setAttribute('href', workstationUrl);
    $('navDocReports')?.setAttribute('href', `reports.html${qDoc}`);
    $('navDocLabs')?.setAttribute('href', `labs.html${qDoc}`);
    $('navDocVisits')?.setAttribute('href', `visits.html${qDoc}`);
    $('navDocDoses')?.setAttribute('href', `${workstationUrl}#protocolSection`);

    if (backBtn) {
      backBtn.textContent = '🏠 رجوع للوحة العيادة';
      backBtn.onclick = () => location.href = 'doctor-dashboard.html';
    }
    if (breadRoot) {
      breadRoot.textContent = 'عيادتي (قائمة المرضى) 👨‍⚕️';
      breadRoot.href = 'doctor-dashboard.html';
    }
    if ($('breadChildName')) $('breadChildName').href = workstationUrl;
  } else {
    if (doctorNav) { doctorNav.classList.add('hidden'); doctorNav.style.display = 'none'; }
    if (parentNav) { parentNav.classList.remove('hidden'); parentNav.style.display = 'flex'; }

    $('navHome')?.setAttribute('href', `child.html${qChild}`);
    $('navMeas')?.setAttribute('href', `measurements.html${qChild}`);
    $('navMeals')?.setAttribute('href', `meals.html${qChild}`);
    $('navReports')?.setAttribute('href', `reports.html${qChild}`);
    $('navLabs')?.setAttribute('href', `labs.html${qChild}`);
    $('navVisits')?.setAttribute('href', `visits.html${qChild}`);

    if (backBtn) {
      backBtn.textContent = '🏠 رجوع للوحة الطفل';
      backBtn.onclick = () => location.href = `child.html${qChild}`;
    }
    if (breadRoot) {
      breadRoot.textContent = 'أطفالي 👨‍👩‍👧‍👦';
      breadRoot.href = 'parent.html';
    }
    if ($('breadChildName')) $('breadChildName').href = `child.html${qChild}`;
  }
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
  // تحميل المفضلة للأطعمة
  const savedFavs = c.favoriteFoodIds || JSON.parse(localStorage.getItem(`fav_foods_${state.childId}`) || '[]');
  state.favorites = new Set(savedFavs);
  if ($('favCount')) $('favCount').textContent = state.favorites.size;
  loadMostUsedFoods();
  loadPresetMeals();
}
const presetColl = () => collection(db, 'parents', state.parentId, 'children', state.childId, 'presetMeals');
async function loadPresetMeals() {
  try {
    const snap = await getDocs(presetColl());
    state.presetMeals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem(`preset_meals_${state.childId}`, JSON.stringify(state.presetMeals));
  } catch (err) {
    console.warn("تعذر جلب الوجبات الجاهزة من السيرفر، استخدام الذاكرة المحلية:", err);
    state.presetMeals = JSON.parse(localStorage.getItem(`preset_meals_${state.childId}`) || '[]');
  }
  if (els.presetsCount) els.presetsCount.textContent = state.presetMeals.length;
}
async function saveCurrentAsPreset(name) {
  if (!state.mealItems.length) {
    alert("يرجى إضافة أصناف للوجبة أولاً قبل حفظها كوصفة!");
    return;
  }
  const cleanItems = state.mealItems.map(it => {
    const m = itemMacros(it);
    return {
      id: it.id || null,
      name: it.name,
      mealQty: it.mealQty,
      selectedUnitIndex: it.selectedUnitIndex || 0,
      availableUnits: it.availableUnits || [{ label: '100 جرام', grams: 100 }],
      per100: it.per100 || {},
      macros: { net: m.net, kcal: m.kcal, protein: m.protein, fat: m.fat, fiber: m.fiber, gi: m.gi }
    };
  });
  const payload = {
    name: name.trim(),
    items: cleanItems,
    totalCarbs: round(state.currentMealCarbs, 1),
    totalCalories: round(state.currentMealCalories, 0),
    createdAt: serverTimestamp()
  };
  try {
    const docRef = await addDoc(presetColl(), payload);
    state.presetMeals.unshift({ id: docRef.id, ...payload });
    localStorage.setItem(`preset_meals_${state.childId}`, JSON.stringify(state.presetMeals));
    if (els.presetsCount) els.presetsCount.textContent = state.presetMeals.length;
    alert(`تم حفظ الوجبة "${name}" بنجاح في وجباتك الجاهزة! ⭐`);
  } catch (err) {
    console.error(err);
    alert("تعذر حفظ الوجبة الجاهزة: " + err.message);
  }
}
function applyPresetMeal(presetId) {
  const preset = state.presetMeals.find(p => p.id === presetId);
  if (!preset) return;
  state.mealItems = preset.items.map(it => ({
    uid: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 4),
    id: it.id,
    name: it.name,
    mealQty: it.mealQty,
    selectedUnitIndex: it.selectedUnitIndex || 0,
    availableUnits: it.availableUnits || [{ label: '100 جرام', grams: 100 }],
    per100: it.per100 || {}
  }));
  state.manualCarbDirty = false;
  state.manualDoseDirty = false;
  renderMealTable();
  updateMealTotals();
  if (els.libModal) els.libModal.classList.remove('open');
  alert(`تم تطبيق مكونات وجبة "${preset.name}" بنجاح في الحاسبة! 🍱`);
}
async function deletePresetMeal(presetId) {
  if (!confirm("هل أنت متأكد من حذف هذه الوجبة الجاهزة؟")) return;
  try {
    await deleteDoc(doc(presetColl(), presetId));
    state.presetMeals = state.presetMeals.filter(p => p.id !== presetId);
    localStorage.setItem(`preset_meals_${state.childId}`, JSON.stringify(state.presetMeals));
    if (els.presetsCount) els.presetsCount.textContent = state.presetMeals.length;
    renderLibrary();
  } catch (err) {
    console.error(err);
    alert("تعذر حذف الوجبة: " + err.message);
  }
}
async function loadMostUsedFoods() {
  try {
    const snap = await getDocs(query(measColl(), orderBy('when', 'desc'), limit(40)));
    const counts = {};
    snap.docs.forEach(d => {
      const items = d.data().mealItemsRef || [];
      items.forEach(it => {
        if (it.foodId) {
          counts[it.foodId] = (counts[it.foodId] || 0) + 1;
        }
      });
    });
    state.mostUsedIds = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  } catch (err) {
    console.warn("تعذر جلب الأصناف الأكثر استخداماً:", err);
  }
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
  const rawQ = els.searchBox ? els.searchBox.value : '';
  const words = normAr(rawQ).split(' ').filter(Boolean);
  let list = state.globalFoods.filter(f => {
    if (!f._norm) {
      f._norm = normAr(`${f.name || ''} ${f.category || ''} ${(f.tags || []).join(' ')} ${(f.units || []).map(u => u.label).join(' ')}`);
    }
    return !words.length || words.every(w => f._norm.includes(w));
  });
  if (state.isRescueMode) {
    list = list.filter(f => f.tags && f.tags.includes('#علاج_هبوط'));
  } else if (state.libTab === 'presets') {
    if (!state.presetMeals.length) {
      els.itemsGrid.innerHTML = `<div style="text-align:center; padding:30px 20px; color:#94a3b8; font-size:14px;">لا توجد وجبات محفوظة بعد.<br><br>ركبي أي وجبة في الجدول واضغطي على زر "⭐ حفظ كوصفة / وجبة جاهزة" لتظهر هنا!</div>`;
      return;
    }
    const q = words.join(' ');
    let pList = state.presetMeals;
    if (q) pList = pList.filter(p => normAr(p.name).includes(q));
    if (!pList.length) {
      els.itemsGrid.innerHTML = `<div style="text-align:center; padding:30px 20px; color:#94a3b8; font-size:14px;">لا توجد وجبة جاهزة مطابقة لبحثك.</div>`;
      return;
    }
    els.itemsGrid.innerHTML = pList.map(p => {
      const summary = p.items.map(i => `${esc(i.name)} (${i.mealQty} ${i.availableUnits?.[i.selectedUnitIndex]?.label || 'حصة'})`).join(' • ');
      return `
        <div class="preset-card" data-id="${esc(p.id)}">
          <div class="preset-head">
            <span class="preset-title">🍱 ${esc(p.name)}</span>
            <div class="preset-macros">
              <span style="color:#7c3aed;">كارب: ${fmt(p.totalCarbs)}g</span>
              <span style="color:#f59e0b;">سعرات: ${fmt(p.totalCalories, 0)} kcal</span>
            </div>
          </div>
          <div class="preset-summary">${summary}</div>
          <div class="preset-actions">
            <button class="btn danger sm" type="button" data-act="del-preset" data-id="${esc(p.id)}">🗑️ حذف</button>
            <button class="btn primary sm" type="button" data-act="apply-preset" data-id="${esc(p.id)}">➕ تطبيق هذه الوجبة</button>
          </div>
        </div>`;
    }).join('');
    return;
  } else if (state.libTab === 'favorites') {
    list = list.filter(f => state.favorites.has(f.id));
  } else if (state.libTab === 'most-used') {
    const mostUsedSet = new Set(state.mostUsedIds);
    list = list.filter(f => mostUsedSet.has(f.id));
    list.sort((a, b) => state.mostUsedIds.indexOf(a.id) - state.mostUsedIds.indexOf(b.id));
  }
  if (!list.length) {
    let emptyMsg = 'لا توجد نتائج مطابقة لبحثك.';
    if (state.isRescueMode) emptyMsg = 'لا توجد أصناف مخصصة لعلاج الهبوط في المكتبة.';
    else if (state.libTab === 'favorites') emptyMsg = 'لا توجد أصناف في المفضلة بعد. اضغطي على النجمة ⭐ بجانب أي صنف لإضافته للمفضلة!';
    else if (state.libTab === 'most-used') emptyMsg = 'لم يتم تسجيل وجبات سابقة بعد لاستنتاج الأصناف الأكثر استخداماً.';
    els.itemsGrid.innerHTML = `<div style="text-align:center; padding:30px 20px; color:#94a3b8; font-size:14px;">${emptyMsg}</div>`;
    return;
  }
  els.itemsGrid.innerHTML = list.map(f => {
    const giStr = f.per100?.gi ? `<span class="gi-badge ${f.per100.gi > 70 ? 'high' : ''}">GI: ${esc(f.per100.gi)}</span>` : '';
    const isFav = state.favorites.has(f.id);
    const imgUrl = f.image?.thumb || f.image?.url || f.imageUrl || SAFE_PLACEHOLDER;
    return `
      <div class="food-lib-item" data-id="${esc(f.id)}">
        <button class="fav-btn ${isFav ? 'is-fav' : ''}" type="button" data-act="toggle-fav" title="${isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}">${isFav ? '★' : '☆'}</button>
        <div class="food-img-col"><img src="${esc(imgUrl)}" onerror="this.src='${SAFE_PLACEHOLDER}';" alt="${esc(f.name)}" loading="lazy">${giStr}</div>
        <div class="details">
          <div class="food-title">${esc(f.name)}</div>
          <div class="macros-grid">
            <div class="m-box"><span class="m-val">${esc(f.per100?.carbs_g || 0)}g</span><span class="m-lbl">كارب</span></div>
            <div class="m-box"><span class="m-val">${esc(f.per100?.protein_g || 0)}g</span><span class="m-lbl">بروتين</span></div>
            <div class="m-box"><span class="m-val">${esc(f.per100?.fat_g || 0)}g</span><span class="m-lbl">دهون</span></div>
            <div class="m-box"><span class="m-val" style="color:#f59e0b">${esc(f.per100?.cal_kcal || 0)}</span><span class="m-lbl">kcal</span></div>
          </div>
        </div>
        <button class="btn primary sm add-btn" data-act="add">${state.isRescueMode ? 'اختيار للرفع' : 'إضافة'}</button>
      </div>`;
  }).join('');
}
async function toggleFavorite(foodId) {
  if (state.favorites.has(foodId)) {
    state.favorites.delete(foodId);
  } else {
    state.favorites.add(foodId);
  }
  const arr = [...state.favorites];
  localStorage.setItem(`fav_foods_${state.childId}`, JSON.stringify(arr));
  if ($('favCount')) $('favCount').textContent = arr.length;
  renderLibrary();
  try {
    if (state.childId && state.parentId) {
      await setDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`), { favoriteFoodIds: arr }, { merge: true });
    }
  } catch (err) {
    console.warn('Sync favorite failed:', err);
  }
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
    // حساب مكافئ الدهون والبروتين (FPU) والتأثير المتأخر
    const fat = state.mealStats.fat || 0;
    const pro = state.mealStats.pro || 0;
    const fpu = ((fat * 9) + (pro * 4)) / 100;
    if (fpu >= 1.5 || fat >= 20 || pro >= 30) {
      html += `<div style="margin-top:6px; padding:6px 10px; background:#fef3c7; border:1px solid #fde68a; border-radius:6px; color:#92400e; font-size:12px;">🧀🥩 <b>تنبيه وجبة غنية بالدهون والبروتين (${round(fat, 1)}g دهون، ${round(pro, 1)}g بروتين ≈ ${round(fpu, 1)} FPU):</b> الدهون والبروتين تؤخر إفراغ المعدة وقد تؤدي لارتفاع متأخر في السكر بعد 3 إلى 5 ساعات. انتبهي لقياس السكر بعد ساعتين وبعد 4 ساعات واستشيري الطبيب بشأن جرعة ممتدة.</div>`;
    }
    if (state.mealStats.avgGI >= 70) {
      html += `<div style="margin-top:4px; padding:4px 8px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; color:#1e40af; font-size:12px;">⚡ <b>مؤشر جلايسيمي مرتفع (GI = ${state.mealStats.avgGI}):</b> الكربوهيدرات سريعة الامتصاص، يُفضل حقن الأنسولين قبل تناول الوجبة بـ 15-20 دقيقة للحد من قفزة السكر الحادة.</div>`;
    } else if (state.mealStats.avgGI > 0 && state.mealStats.avgGI <= 55) {
      html += `<div style="margin-top:4px; padding:4px 8px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; color:#166534; font-size:12px;">🥗 <b>مؤشر جلايسيمي منخفض (GI = ${state.mealStats.avgGI}):</b> الوجبة غنية بالألياف وسيكون ارتفاع السكر تدريجياً ومستقراً.</div>`;
    }
    els.smartAlerts.style.display = html ? 'block' : 'none';
    els.smartAlerts.innerHTML = html;
    // تفعيل أو إظهار خيار تجزئة الجرعة للوجبات الدسمة (Dual-Wave)
    const isHighFatPro = (fpu >= 1.5 || fat >= 20 || pro >= 30) && state.finalDoseVal > 0 && !r.blocked && !r.isHypo;
    if (els.splitBolusBox) {
      if (isHighFatPro || state.splitBolus.enabled) {
        els.splitBolusBox.classList.remove('hidden');
        updateSplitBolusCalculations();
      } else {
        els.splitBolusBox.classList.add('hidden');
      }
    }
  }
}
function updateSplitBolusCalculations() {
  const total = Number(state.finalDoseVal) || 0;
  if (!state.splitBolus.enabled || total <= 0) {
    if (els.splitDetailsArea) els.splitDetailsArea.classList.add('hidden');
    return;
  }
  if (els.splitDetailsArea) els.splitDetailsArea.classList.remove('hidden');
  const ratio = state.splitBolus.ratio || 60;
  const nowRaw = total * (ratio / 100);
  const now = roundToStep(nowRaw, state.therapy?.step || 0.5);
  const later = roundToStep(Math.max(0, total - now), state.therapy?.step || 0.5);
  state.splitBolus.now = now;
  state.splitBolus.later = later;
  if (els.splitNowVal) els.splitNowVal.textContent = fmt(now);
  if (els.splitLaterVal) els.splitLaterVal.textContent = fmt(later);
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
  const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const validDocs = allDocs.filter(m => m.carbs > 0 || m.totalDose > 0);
  state.allDocs = allDocs;
  state.validDocs = validDocs;
  if (validDocs.length === 0) {
    els.dailyMealsBody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center;">لا توجد وجبات أو قياسات مسجلة في هذا اليوم</td></tr>`;
  } else {
    validDocs.sort((a, b) => (toDateObj(a.when) || 0) - (toDateObj(b.when) || 0));
    els.dailyMealsBody.innerHTML = validDocs.map(m => {
      state.eatenToday += Number(m.carbs || 0); state.caloriesEatenToday += Number(m.calories || 0);
      // البحث عن قياس ما بعد الوجبة المتطابق
      const postSlotKey = PRE_TO_POST_SLOT[m.slotKey] || 'OTHER';
      const expectedTime = addHoursToTimeStr(m.time || '12:00', 2);
      const mDateObj = toDateObj(m.when);
      // نبحث أولاً عن وثيقة بنفس slotKey ما بعد الوجبة
      let postDoc = allDocs.find(d => d.id !== m.id && d.slotKey === postSlotKey);
      if (!postDoc && mDateObj) {
        // أو نبحث عن وثيقة تم قياسها بين 75 دقيقة و 210 دقيقة بعد الوجبة
        const mEpoch = mDateObj.getTime();
        postDoc = allDocs.find(d => {
          if (d.id === m.id) return false;
          const dEpoch = (toDateObj(d.when) || 0).getTime();
          const diffMins = (dEpoch - mEpoch) / 60000;
          return diffMins >= 75 && diffMins <= 210;
        });
      }
      let outcomeHTML = '';
      if (postDoc && postDoc.value !== undefined && postDoc.value !== null && postDoc.value !== '') {
        const postVal = Number(postDoc.value);
        const postUnit = postDoc.unit || state.therapy.unit;
        const postNorm = postDoc.normalizedValue ?? convert(postVal, postUnit, state.therapy.unit);
        const preVal = (m.value !== undefined && m.value !== null && m.value !== '') ? Number(m.value) : null;
        const preNorm = preVal !== null ? (m.normalizedValue ?? convert(preVal, m.unit || state.therapy.unit, state.therapy.unit)) : null;
        let diffStr = '';
        let diffVal = null;
        if (preNorm !== null) {
          diffVal = round(postNorm - preNorm, 1);
          diffStr = diffVal > 0 ? `+${diffVal}` : `${diffVal}`;
        }
        const L = state.therapy.limits;
        if (postNorm < L.low) {
          outcomeHTML = `
            <div class="badge-outcome danger">
              <span>🚨 هبوط: ${postVal} ${postUnit}</span>
              <small>${diffStr ? `فارق (${diffStr} ${state.therapy.unit}) • ` : ''}جرعة زائدة أو نشاط كبير</small>
            </div>`;
        } else if (postNorm > L.high || (diffVal !== null && diffVal > (state.therapy.unit === 'mmol/L' ? 4 : 70))) {
          outcomeHTML = `
            <div class="badge-outcome warn">
              <span>⚠️ ارتفاع: ${postVal} ${postUnit}</span>
              <small>${diffStr ? `فارق (${diffStr} ${state.therapy.unit}) • ` : ''}راجع معامل الكارب CR</small>
            </div>`;
        } else {
          outcomeHTML = `
            <div class="badge-outcome success">
              <span>🎯 في الهدف: ${postVal} ${postUnit}</span>
              <small>${diffStr ? `فارق (${diffStr} ${state.therapy.unit}) • ` : ''}جرعة ووجبة ممتازة</small>
            </div>`;
        }
      } else {
        // لا يوجد قياس بعد الوجبة مسجل حتى الآن
        const now = new Date();
        const isToday = state.date === localDateStr(now);
        let isDue = false;
        if (isToday && m.time) {
          const [mh, mm] = m.time.split(':').map(Number);
          const mealT = new Date(); mealT.setHours(mh, mm, 0, 0);
          const elapsedMins = (now - mealT) / 60000;
          if (elapsedMins >= 110) isDue = true;
        }
        const measUrl = `measurements.html?child=${encodeURIComponent(state.childId)}&slot=${encodeURIComponent(postSlotKey)}&date=${encodeURIComponent(state.date)}&time=${encodeURIComponent(expectedTime)}`;
        if (isDue) {
          outcomeHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
              <span style="font-size:11px; color:#dc2626; font-weight:bold;">⏰ حان موعد القياس!</span>
              <a href="${measUrl}" class="btn-measure-pill alert-pulse">🩸 سجلي القياس الآن</a>
            </div>`;
        } else if (isToday) {
          outcomeHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
              <span style="font-size:11px; color:#64748b;">⏳ موعد القياس: ${expectedTime}</span>
              <a href="${measUrl}" class="btn-measure-pill">📊 تسجيل القياس</a>
            </div>`;
        } else {
          outcomeHTML = `<span class="muted tiny">— لم يُسجل</span>`;
        }
      }
      return `
        <tr>
          <td><b>${getSlotLabel(m.slotKey)}</b><br><span class="muted tiny">🕒 ${esc(m.time || '—')}</span></td>
          <td>${esc(m.carbs || 0)}g</td>
          <td>${Number(m.calories || 0).toFixed(0)} kcal</td>
          <td>${esc(m.carbDose || 0)}U</td>
          <td>${esc(m.correctionDose || 0)}U</td>
          <td><strong style="color:var(--primary); font-size:15px;">${esc(m.totalDose || m.totalInsulin || 0)}U</strong></td>
          <td>${outcomeHTML}</td>
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
    if (state.splitBolus?.enabled && state.splitBolus.later > 0) {
      payload.splitBolus = {
        enabled: true,
        ratio: state.splitBolus.ratio,
        now: state.splitBolus.now,
        later: state.splitBolus.later,
        delayHours: state.splitBolus.delayHours || 2
      };
    }
    if (target) await setDoc(doc(measColl(), target.id), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
    else await addDoc(measColl(), { ...payload, createdAt: serverTimestamp() });
    showPostMealReminder(state.time, state.slot, state.date, payload.splitBolus);
    await loadTodayMeals(); loadIOB();
  } catch (e) {
    console.error(e);
    alert("خطأ في الحفظ: " + e.message);
  } finally { els.btnSaveMeal.disabled = false; els.btnSaveMeal.textContent = "💾 اعتماد الجرعة وحفظ الوجبة"; }
};
function showPostMealReminder(timeStr, slotKey, dateStr, splitInfo = null) {
  if (!els.postMealReminderBanner) return;
  const postTime = addHoursToTimeStr(timeStr, 2);
  const postSlot = PRE_TO_POST_SLOT[slotKey] || 'OTHER';
  if (els.pmTime) els.pmTime.textContent = postTime;
  if (els.pmActionBtn) {
    els.pmActionBtn.href = `measurements.html?child=${encodeURIComponent(state.childId)}&slot=${encodeURIComponent(postSlot)}&date=${encodeURIComponent(dateStr)}&time=${encodeURIComponent(postTime)}`;
  }
  if (els.pmSplitAlert) {
    if (splitInfo && splitInfo.enabled && splitInfo.later > 0) {
      els.pmSplitAlert.style.display = 'block';
      els.pmSplitAlert.innerHTML = `🍕 <b>تذكير جرعة مؤجلة (Dual-Wave):</b> الجرعة الثانية المطلوبة هي <b>${splitInfo.later} U</b> تؤخذ بعد ساعتين مع فحص السكر للتأكد.`;
    } else {
      els.pmSplitAlert.style.display = 'none';
    }
  }
  els.postMealReminderBanner.classList.remove('hidden');
  els.postMealReminderBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// ========================================================
// 10. الأحداث
// ========================================================
function setupEvents() {
  $('logoutBtn').onclick = () => signOut(auth);
  if (els.pmDismissBtn) {
    els.pmDismissBtn.onclick = () => {
      if (els.postMealReminderBanner) els.postMealReminderBanner.classList.add('hidden');
    };
  }
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
  // تبويبات مكتبة الطعام (الكل / المفضلة / الأكثر استخداماً)
  const libTabs = $('libTabs');
  if (libTabs) {
    libTabs.onclick = e => {
      const tabBtn = e.target.closest('.lib-tab[data-tab]');
      if (!tabBtn) return;
      libTabs.querySelectorAll('.lib-tab[data-tab]').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      state.libTab = tabBtn.dataset.tab;
      renderLibrary();
    };
  }
  // أحداث بطاقات الأطعمة والوجبات الجاهزة
  if (els.itemsGrid) {
    els.itemsGrid.onclick = async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const card = btn.closest('.food-lib-item') || btn.closest('.preset-card');
      if (!card) return;
      const id = card.dataset.id;
      if (btn.dataset.act === 'add') {
        addItemToMeal(id);
      } else if (btn.dataset.act === 'toggle-fav') {
        await toggleFavorite(id);
      } else if (btn.dataset.act === 'apply-preset') {
        applyPresetMeal(id);
      } else if (btn.dataset.act === 'del-preset') {
        await deletePresetMeal(id);
      }
    };
  }
  // أحداث تجزئة الجرعة للوجبات الدسمة (Dual-Wave)
  if (els.enableSplitBolus) {
    els.enableSplitBolus.onchange = () => {
      state.splitBolus.enabled = els.enableSplitBolus.checked;
      updateSplitBolusCalculations();
    };
  }
  document.querySelectorAll('.sb-ratio-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.sb-ratio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.splitBolus.ratio = Number(btn.dataset.ratio) || 60;
      updateSplitBolusCalculations();
    };
  });
  // أحداث حاسبة تصفير الميزان وطرح وزن الطبق (Tare)
  if (els.btnOpenTareModal && els.tareDialog) {
    els.btnOpenTareModal.onclick = () => {
      if (els.tareGrossInput) els.tareGrossInput.value = '';
      if (els.tareDishInput) els.tareDishInput.value = '';
      if (els.tareNetResult) els.tareNetResult.textContent = '0';
      els.tareDialog.showModal();
    };
    if (els.closeTareBtn) els.closeTareBtn.onclick = () => els.tareDialog.close();
    const calcNetTare = () => {
      const gross = parseFloat(els.tareGrossInput?.value) || 0;
      const dish = parseFloat(els.tareDishInput?.value) || 0;
      const net = Math.max(0, gross - dish);
      if (els.tareNetResult) els.tareNetResult.textContent = round(net, 1);
    };
    if (els.tareGrossInput) els.tareGrossInput.oninput = calcNetTare;
    if (els.tareDishInput) els.tareDishInput.oninput = calcNetTare;
    if (els.copyTareBtn) {
      els.copyTareBtn.onclick = () => {
        const netVal = parseFloat(els.tareNetResult?.textContent) || 0;
        if (netVal <= 0) {
          alert('الوزن الصافي صفر!');
          return;
        }
        if (state.mealItems.length > 0) {
          const lastIdx = state.mealItems.length - 1;
          state.mealItems[lastIdx].mealQty = round(netVal / 100, 2);
          renderMealTable();
          updateMealTotals();
          alert(`تم تعيين الوزن الصافي (${netVal} جم) للصنف الأخير بالجدول! ✔️`);
        } else {
          navigator.clipboard?.writeText(String(netVal));
          alert(`تم نسخ الوزن الصافي (${netVal} جم) للحافظة! ✔️`);
        }
        els.tareDialog.close();
      };
    }
  }
  // أحداث حفظ الوجبة الحالية كوصفة مجهزة مسبقاً (Presets)
  if (els.btnSavePresetMeal && els.savePresetDialog) {
    els.btnSavePresetMeal.onclick = () => {
      if (!state.mealItems.length) {
        alert("يرجى إضافة أصناف للوجبة أولاً قبل حفظها كوصفة!");
        return;
      }
      if (els.presetMealNameInput) els.presetMealNameInput.value = '';
      const summaryText = state.mealItems.map(i => `${i.name} (${i.mealQty} ${i.availableUnits?.[i.selectedUnitIndex]?.label || 'حصة'})`).join(' • ');
      if (els.presetItemsSummary) {
        els.presetItemsSummary.innerHTML = `<b>الأصناف:</b> ${esc(summaryText)}<br><div style="margin-top:4px; color:#475569;"><b>الكارب:</b> ${fmt(state.currentMealCarbs)}g • <b>السعرات:</b> ${fmt(state.currentMealCalories, 0)} kcal</div>`;
      }
      els.savePresetDialog.showModal();
    };
    if (els.closeSavePresetBtn) els.closeSavePresetBtn.onclick = () => els.savePresetDialog.close();
    if (els.cancelSavePresetBtn) els.cancelSavePresetBtn.onclick = () => els.savePresetDialog.close();
    if (els.savePresetForm) {
      els.savePresetForm.onsubmit = async e => {
        e.preventDefault();
        const name = els.presetMealNameInput?.value.trim();
        if (!name) return;
        await saveCurrentAsPreset(name);
        els.savePresetDialog.close();
      };
    }
  }
  // نافذة طلب إضافة صنف جديد من الأسرة للأدمن
  const btnOpenReq = $('btnOpenRequestModal');
  const reqDlg = $('foodRequestDialog');
  const reqForm = $('foodRequestForm');
  if (btnOpenReq && reqDlg) {
    btnOpenReq.onclick = async () => {
      reqForm.reset();
      try {
        const snap = await getDoc(doc(db, 'admin', 'global', 'settings', 'categories'));
        let cats = ['النشويات', 'الفاكهة', 'الخضروات', 'منتجات الحليب', 'منتجات اللحوم', 'البقوليات', 'المشروبات', 'الحلويات', 'الدهون والزيوت', 'وجبات جاهزة', 'أخرى'];
        if (snap.exists() && Array.isArray(snap.data()?.custom)) {
          cats = Array.from(new Set([...cats, ...snap.data().custom.filter(Boolean)]));
        }
        if ($('reqFoodCategory')) {
          $('reqFoodCategory').innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
        }
      } catch (err) {
        console.warn('Could not populate reqFoodCategory dynamically:', err);
      }
      reqDlg.showModal();
    };
    if ($('closeReqDialog')) $('closeReqDialog').onclick = () => reqDlg.close();
    if ($('cancelReqBtn')) $('cancelReqBtn').onclick = () => reqDlg.close();
    reqForm.onsubmit = async e => {
      e.preventDefault();
      const submitBtn = $('submitReqBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'جاري الإرسال...';
      try {
        const payload = {
          name: $('reqFoodName').value.trim(),
          category: $('reqFoodCategory').value,
          notes: $('reqFoodNotes').value.trim(),
          per100: {
            carbs_g: $('reqFoodCarbs').value ? Number($('reqFoodCarbs').value) : null
          },
          status: 'pending',
          requestedByUid: auth.currentUser?.uid || 'parent',
          requestedByName: auth.currentUser?.displayName || auth.currentUser?.email || state.child?.name || 'ولي أمر',
          childId: state.childId || null,
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'admin', 'global', 'foodRequests'), payload);
        alert('تم إرسال طلب الصنف للأدمن بنجاح! ✅\nسيقوم فريق الإدارة بمراجعته وإضافته للمكتبة.');
        reqDlg.close();
      } catch (err) {
        console.error(err);
        alert('تعذر إرسال الطلب: ' + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'إرسال الطلب للأدمن';
      }
    };
  }
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
  const btnExportDaily = $('btnExportDailyMeals');
  if (btnExportDaily) btnExportDaily.onclick = exportDailyMealsCSV;
  const btnPrintDaily = $('btnPrintDailyMeals');
  if (btnPrintDaily) btnPrintDaily.onclick = () => window.print();
}
function exportDailyMealsCSV() {
  if (!state.validDocs || !state.validDocs.length) {
    alert("لا توجد وجبات مسجلة في هذا اليوم لتصديرها.");
    return;
  }
  const headers = [
    "تاريخ",
    "وقت الوجبة",
    "الوجبة",
    "الكارب (جم)",
    "السعرات (kcal)",
    "جرعة الكارب (وحدة)",
    "جرعة التصحيح (وحدة)",
    "إجمالي الأنسولين (وحدة)",
    "السكر قبل الوجبة",
    "السكر بعد الوجبة (+2h)",
    "تقييم الاستجابة",
    "مكونات الوجبة وملاحظاتها"
  ];
  const cell = str => `"${String(str || '').replace(/"/g, '""')}"`;
  const rows = state.validDocs.map(m => {
    const postSlotKey = PRE_TO_POST_SLOT[m.slotKey] || 'OTHER';
    const mDateObj = toDateObj(m.when);
    let postDoc = (state.allDocs || []).find(d => d.id !== m.id && d.slotKey === postSlotKey);
    if (!postDoc && mDateObj) {
      const mEpoch = mDateObj.getTime();
      postDoc = (state.allDocs || []).find(d => {
        if (d.id === m.id) return false;
        const dEpoch = (toDateObj(d.when) || 0).getTime();
        const diffMins = (dEpoch - mEpoch) / 60000;
        return diffMins >= 75 && diffMins <= 210;
      });
    }
    let preBgStr = (m.value !== undefined && m.value !== null && m.value !== '') ? `${m.value} ${m.unit || state.therapy.unit}` : '—';
    let postBgStr = (postDoc && postDoc.value !== undefined && postDoc.value !== null && postDoc.value !== '') ? `${postDoc.value} ${postDoc.unit || state.therapy.unit}` : '—';
    let evaluation = 'لم يُسجل بعد';
    if (postDoc && postDoc.value !== undefined && postDoc.value !== null && postDoc.value !== '') {
      const postVal = Number(postDoc.value);
      const postNorm = postDoc.normalizedValue ?? convert(postVal, postDoc.unit || state.therapy.unit, state.therapy.unit);
      const L = state.therapy.limits;
      if (postNorm < L.low) evaluation = 'هبوط (جرعة زائدة)';
      else if (postNorm > L.high) evaluation = 'ارتفاع (مراجعة معامل الكارب)';
      else evaluation = 'في الهدف (ممتاز)';
    }
    let itemsStr = '';
    if (Array.isArray(m.items) && m.items.length) {
      itemsStr = m.items.map(it => `${it.name} (${it.mealQty || 1} ${it.availableUnits?.[it.selectedUnitIndex]?.label || it.unitLabel || 'حصة'})`).join(' + ');
    } else if (m.notes) {
      itemsStr = m.notes;
    }
    return [
      cell(state.date),
      cell(m.time || '—'),
      cell(getSlotLabel(m.slotKey)),
      cell(m.carbs || 0),
      cell(Number(m.calories || 0).toFixed(0)),
      cell(m.carbDose || 0),
      cell(m.correctionDose || 0),
      cell(m.totalDose || m.totalInsulin || 0),
      cell(preBgStr),
      cell(postBgStr),
      cell(evaluation),
      cell(itemsStr)
    ].join(',');
  });
  const csvContent = '\uFEFF' + [headers.map(h => `"${h}"`).join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const childName = (state.child?.name || 'child').replace(/[\s\/\\?%*:|"<>]/g, '_');
  a.href = url;
  a.download = `وجبات_${childName}_${state.date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// ========================================================
// 15. المساعد الذكي التفاعلي لبناء الوجبات والمقادير (AI Meal Chef)
// ========================================================
let _mealAiApiKey = localStorage.getItem('aseel_gemini_key') || '';
let _mealAiWorkingModel = sessionStorage.getItem('aseel_gemini_working_model') || '';
let _mealAiHistory = [];
let _mealAiInitialized = false;

async function loadMealGeminiKey() {
  try {
    const snap = await getDoc(doc(db, 'admin/global/settings/ai'));
    if (snap.exists()) {
      const data = snap.data() || {};
      const key = (data.geminiApiKey || data.apiKey || data.key || '').trim();
      if (key) {
        _mealAiApiKey = key;
        localStorage.setItem('aseel_gemini_key', key);
      }
    }
  } catch (e) {
    console.warn('Could not fetch global AI key:', e);
  }
}

async function resolveWorkingGeminiModel() {
  if (_mealAiWorkingModel) return _mealAiWorkingModel;
  if (!_mealAiApiKey) return 'gemini-flash-latest';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(_mealAiApiKey)}`);
    if (res.ok) {
      const data = await res.json();
      const available = (data.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));

      const preferred = [
        'gemini-2.5-flash',
        'gemini-flash-latest',
        'gemini-2.0-flash',
        'gemini-flash-lite-latest',
        'gemini-1.5-flash',
        'gemini-pro-latest'
      ];
      for (const p of preferred) {
        if (available.includes(p)) {
          _mealAiWorkingModel = p;
          sessionStorage.setItem('aseel_gemini_working_model', p);
          return p;
        }
      }
      if (available.length > 0) {
        _mealAiWorkingModel = available[0];
        sessionStorage.setItem('aseel_gemini_working_model', available[0]);
        return available[0];
      }
    }
  } catch (e) {
    console.warn('Model discovery fallback:', e);
  }
  return 'gemini-flash-latest';
}

function getActiveMealSlotContext() {
  const slot = els.slotSelect?.value || state.slot || 'PRE_BREAKFAST';
  const slotLabel = getSlotLabel(slot);
  const slotKeyMap = {
    PRE_BREAKFAST: 'breakfast',
    FASTING: 'breakfast',
    PRE_LUNCH: 'lunch',
    PRE_DINNER: 'dinner',
    SNACK: 'snack'
  };
  const crKey = slotKeyMap[slot] || 'breakfast';
  const activeCR = Number(state.therapy?.CR?.[crKey]) || Number(state.therapy?.CR?.breakfast) || 10;
  const cf = Number(state.therapy?.CF) || 30;
  const target = Number(state.therapy?.target) || (state.therapy?.unit === 'mmol/L' ? 6.0 : 110);
  const unit = state.therapy?.unit || 'mg/dL';
  const preBg = parseFloat(els.preBg?.value) || null;
  const iob = parseFloat(els.iobValue?.value) || 0;
  return { slot, slotLabel, activeCR, cf, target, unit, preBg, iob };
}

function findBestLibraryFood(itemName) {
  if (!itemName || !state.globalFoods?.length) return null;
  const qNorm = normAr(itemName);
  if (!qNorm) return null;

  let match = state.globalFoods.find(f => normAr(f.name) === qNorm);
  if (match) return match;

  match = state.globalFoods.find(f => {
    const fn = normAr(f.name);
    return fn.includes(qNorm) || qNorm.includes(fn);
  });
  if (match) return match;

  const qWords = qNorm.split(/\s+/).filter(w => w.length >= 2);
  if (!qWords.length) return null;

  let bestScore = 0;
  let bestFood = null;
  for (const f of state.globalFoods) {
    const fn = normAr(f.name);
    let score = 0;
    for (const w of qWords) {
      if (fn.includes(w)) score += 2;
    }
    if (state.favorites.has(f.id)) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestFood = f;
    }
  }
  return bestScore >= 2 ? bestFood : null;
}

// تنظيف وتوحيد الكمية والوحدة لمنع تكرار "100 100 جرام" أو "0.5 نصف رغيف"
function normalizeAiItemSpec(rawItem) {
  let qty = Number(rawItem.qty) > 0 ? Number(rawItem.qty) : 1;
  let unitLabel = String(rawItem.unitLabel || 'حصة').trim();
  let gramsPerUnit = Number(rawItem.gramsPerUnit) > 0 ? Number(rawItem.gramsPerUnit) : 100;

  const uNorm = normAr(unitLabel);

  // لو الوحدة هي "100 جرام" والكمية مثلاً 100 أو 150 (يقصد 100 جرام أو 150 جرام)
  if ((uNorm === normAr('100 جرام') || uNorm === normAr('100 جم') || uNorm === '100g') && qty >= 20) {
    qty = round(qty / 100, 2);
    gramsPerUnit = 100;
    unitLabel = '100 جرام';
  }
  // لو الوحدة "جرام" أو "جم" فقط والكمية مثلاً 100
  else if ((uNorm === 'جرام' || uNorm === 'جم' || uNorm === 'g') && qty >= 10) {
    qty = round(qty / 100, 2);
    gramsPerUnit = 100;
    unitLabel = '100 جرام';
  }
  // لو الوحدة فيها "نصف رغيف" والكمية 0.5، نمنع ازدواج النصف
  else if ((uNorm.includes('نصف') || uNorm.includes('نص')) && qty === 0.5) {
    unitLabel = unitLabel.replace(/نصف|نص/g, '').trim() || 'رغيف';
    if (gramsPerUnit < 60) gramsPerUnit = gramsPerUnit * 2;
  }
  // لو الوحدة فيها "ربع رغيف" والكمية 0.25
  else if (uNorm.includes('ربع') && qty === 0.25) {
    unitLabel = unitLabel.replace(/ربع/g, '').trim() || 'رغيف';
    if (gramsPerUnit < 40) gramsPerUnit = gramsPerUnit * 4;
  }

  const totalGrams = Math.round(qty * gramsPerUnit);
  const carbs100 = Number(rawItem.carbsPer100g) ?? 15;
  const fiber100 = Number(rawItem.fiberPer100g) || 0;
  const netCarbs = Math.max(0, round(((carbs100 - fiber100) * totalGrams) / 100, 1));

  // صياغة عرض أنيقة للمستخدم بدون تكرار الأرقام
  let displayQtyUnit = `${qty} ${unitLabel}`;
  if (unitLabel === '100 جرام') {
    displayQtyUnit = `${totalGrams} جرام`;
  } else if (totalGrams > 0) {
    displayQtyUnit = `${qty} ${unitLabel} (${totalGrams} جم)`;
  }

  return {
    ...rawItem,
    qty,
    unitLabel,
    gramsPerUnit,
    totalGrams,
    netCarbs,
    displayQtyUnit
  };
}

function applyAiOptionToMealTable(option, replaceExisting = false) {
  if (!option || !Array.isArray(option.items) || !option.items.length) return;

  if (replaceExisting) {
    state.mealItems = [];
  }

  for (const raw of option.items) {
    const spec = normalizeAiItemSpec(raw);
    const libFood = findBestLibraryFood(spec.name);

    if (libFood) {
      const baseUnits = Array.isArray(libFood.units) && libFood.units.length
        ? libFood.units.map(u => ({ ...u }))
        : [{ label: '100 جرام', grams: 100 }];

      let unitIdx = baseUnits.findIndex(u => normAr(u.label) === normAr(spec.unitLabel));
      if (unitIdx === -1) {
        unitIdx = baseUnits.findIndex(u => normAr(u.label).includes(normAr(spec.unitLabel)) || normAr(spec.unitLabel).includes(normAr(u.label)));
      }
      if (unitIdx === -1 && spec.unitLabel) {
        baseUnits.unshift({ label: spec.unitLabel, grams: spec.gramsPerUnit });
        unitIdx = 0;
      }

      state.mealItems.push({
        uid: Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6),
        ...libFood,
        mealQty: spec.qty,
        selectedUnitIndex: Math.max(0, unitIdx),
        availableUnits: baseUnits
      });
    } else {
      const customUnits = [
        { label: spec.unitLabel || 'حصة', grams: spec.gramsPerUnit },
        { label: '100 جرام', grams: 100 }
      ];
      state.mealItems.push({
        uid: Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6),
        id: 'ai_custom_' + Date.now(),
        name: spec.name || 'صنف غذائي',
        category: 'مضاف بالذكاء الاصطناعي',
        carbs: Number(spec.carbsPer100g) ?? 15,
        fiber: Number(spec.fiberPer100g) || 0,
        protein: Number(spec.proteinPer100g) || 2,
        fat: Number(spec.fatPer100g) || 1,
        calories: Number(spec.kcalPer100g) || 80,
        gi: Number(spec.gi) || 55,
        mealQty: spec.qty,
        selectedUnitIndex: 0,
        availableUnits: customUnits
      });
    }
  }

  state.manualCarbDirty = false;
  state.manualDoseDirty = false;
  renderMealTable();
  updateMealTotals();

  const tableEl = $('mealTable');
  if (tableEl) {
    tableEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tableEl.style.transition = 'box-shadow 0.3s';
    tableEl.style.boxShadow = '0 0 0 4px rgba(22, 163, 74, 0.4)';
    setTimeout(() => { tableEl.style.boxShadow = ''; }, 1800);
  }
}

function buildMealChefSystemPrompt(userText) {
  const ctx = getActiveMealSlotContext();
  const childName = state.child?.name || 'الطفل';

  const currentTrayList = state.mealItems.map(it => {
    const u = it.availableUnits?.[it.selectedUnitIndex || 0] || { label: '100 جرام', grams: 100 };
    return `${it.name} (الكمية: ${it.mealQty} ${u.label})`;
  }).join('، ') || 'الجدول فارغ حالياً';

  const favNames = state.globalFoods.filter(f => state.favorites.has(f.id)).slice(0, 20).map(f => f.name);
  const mostUsedNames = state.mostUsedIds.map(id => state.globalFoods.find(f => f.id === id)?.name).filter(Boolean).slice(0, 15);
  const presetList = state.presetMeals.slice(0, 8).map(p => `${p.name} (${p.totalCarbs || 0}g كارب)`);

  const qWords = normAr(userText).split(/\s+/).filter(w => w.length >= 2);
  const matchedFoods = [];
  for (const f of state.globalFoods) {
    const fn = normAr(`${f.name} ${f.category || ''}`);
    const isMatch = qWords.some(w => fn.includes(w)) || state.favorites.has(f.id) || state.mostUsedIds.includes(f.id);
    if (isMatch && matchedFoods.length < 45) {
      const unitsStr = (f.units || []).slice(0, 3).map(u => `${u.label}=${u.grams}g`).join(', ');
      matchedFoods.push(`- ${f.name} [كارب/100جم: ${f.carbs}g, ألياف: ${f.fiber || 0}g, الوحدات: ${unitsStr || '100 جرام=100g'}]`);
    }
  }
  if (matchedFoods.length < 30) {
    for (const f of state.globalFoods.slice(0, 35)) {
      if (matchedFoods.length >= 45) break;
      const unitsStr = (f.units || []).slice(0, 2).map(u => `${u.label}=${u.grams}g`).join(', ');
      const line = `- ${f.name} [كارب/100جم: ${f.carbs}g, الوحدات: ${unitsStr || '100 جرام=100g'}]`;
      if (!matchedFoods.includes(line)) matchedFoods.push(line);
    }
  }

  return `أنت "مساعد مطبخ أسيل التفاعلي" داخل صفحة الوجبات للطفل "${childName}".
أنت شات ذكي محاور وتفاعلي جداً (مثل شات جي بي تي)، تتحدث مع الأم بودّ واختصار لتصميم الوجبة خطوة بخطوة.

بيانات الوجبة الحالية للطفل:
- الوجبة المختارة الآن: ${ctx.slotLabel}
- معامل الكارب المعتمد لهذه الوجبة (CR): 1 وحدة أنسولين لكل ${ctx.activeCR} جرام كارب.
- معامل التصحيح (CF): ${ctx.cf} ${ctx.unit}، والهدف: ${ctx.target} ${ctx.unit}.
- قراءة السكر قبل الوجبة: ${ctx.preBg ? ctx.preBg + ' ' + ctx.unit : 'غير مدخلة بعد'}.
- الأنسولين النشط (IOB): ${ctx.iob} وحدة.
- الأصناف الموجودة حالياً في جدول الوجبة: ${currentTrayList}.
- الأصناف المفضلة للطفل: ${favNames.join('، ') || 'خبز مصري، فول، بيض، أرز، مكرونة، دجاج، بطاطس، تفاح، زبادي'}.
- الأصناف الأكثر استخداماً: ${mostUsedNames.join('، ') || 'غير محدد'}.
- الوجبات الجاهزة المحفوظة: ${presetList.join('، ') || 'لا يوجد'}.

عينة من مكتبة الأصناف المتاحة ووحداتها:
${matchedFoods.join('\n')}

طريقة عملك التفاعلية (مهم جداً):
1. **عندما تطلب الأم تحضير أو اقتراح وجبة بشكل عام (مثل "عايزة فطار" أو "اقترح غداء" أو "تحضير عشاء"):**
   - لا تفرض عليها وجبة واحدة جامدة فوراً، بل اسألها بتفاعل ولطف عن تفضيلات ${childName} اليوم والمتاح لديها في البيت! (مثلاً: هل تفضل النشويات تكون عيش بلدي أم توست أم أرز أم مكرونة؟ وما البروتين المتاح أو المفضل اليوم؟).
   - ضع لها دائماً في الـ JSON قائمة "replies" تحتوي على 3 إلى 4 اختيارات سريعة تفاعلية تضغط عليها الأم بسهولة!
2. **عندما تختار الأم التفضيل أو تذكر أصنافاً معينة (مثل "فول وعيش وبيض" أو "رز وبامية وفراخ" أو "تفاحة وزبادي"):**
   - اقترح المقادير الدقيقة المتوازنة من المكتبة واحسب إجمالي الكارب الصافي والجرعة باختصار، واسألها: "هل هذه المقادير مناسبة لشهية ${childName} اليوم لنضيفها للجدول أم تحبين تعديل كمية أي صنف؟".
   - أرفق الوجبة في مصفوفة "options" داخل الـ JSON حتى يظهر لها كارت الوجبة وزر (➕ إضافة الأصناف والمقادير للجدول) واختيارات تعديل سريعة في "replies" (مثل: "زود الكمية شوية"، "قلل الكارب شوية"، "بدّل صنف").
3. **قواعد كتابة الكميات في الـ JSON لمنع الأخطاء:**
   - إذا كانت الوحدة "رغيف" (100 جم) وتريد نصف رغيف: اجعل "qty": 0.5 و "unitLabel": "رغيف" و "gramsPerUnit": 100.
   - إذا كانت الوحدة "ملعقة طعام" (15 جم) وتريد 5 ملاعق: اجعل "qty": 5 و "unitLabel": "ملعقة طعام" و "gramsPerUnit": 15.
   - إذا كنت تقيس بالجرام (مثلاً 100 جرام فول): اجعل "qty": 1 و "unitLabel": "100 جرام" و "gramsPerUnit": 100 (لا تكتب qty:100 مع unitLabel:100 جرام أبداً).
4. **هيكل كود الـ JSON الإلزامي في نهاية كل رد:**
\`\`\`json
{
  "autoApply": false,
  "replaceExisting": true,
  "replies": [
    "🥙 فول وعيش بلدي وبيض",
    "🧀 توست أسمر وجبنة وخضار",
    "⭐ اقترح من مفضلات أسيل",
    "🔄 عندي أصناف تانية في البيت"
  ],
  "options": [
    {
      "title": "اسم الوجبة (إجمالي الكارب g ⬅️ الجرعة U)",
      "items": [
        {
          "name": "اسم الصنف",
          "qty": 0.5,
          "unitLabel": "رغيف",
          "gramsPerUnit": 100,
          "carbsPer100g": 50,
          "fiberPer100g": 4,
          "proteinPer100g": 9,
          "fatPer100g": 1.5,
          "kcalPer100g": 250
        }
      ]
    }
  ]
}
\`\`\`
ملاحظة: اجعل "autoApply": false دائماً حتى يكون القرار النهائي للأم بالضغط على زر الإضافة، إلا إذا قالت صراحةً "اعتمد وضيفهم للجدول حالاً".`;
}

async function callMealGeminiCloud(userText) {
  if (!_mealAiApiKey) await loadMealGeminiKey();
  if (!_mealAiApiKey) return null;

  const sysInstruction = buildMealChefSystemPrompt(userText);
  const contents = [];
  for (const h of _mealAiHistory.slice(-8)) {
    contents.push({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    });
  }
  contents.push({ role: 'user', parts: [{ text: userText }] });

  const primaryModel = await resolveWorkingGeminiModel();
  const models = [primaryModel, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'].filter((v, i, a) => v && a.indexOf(v) === i);

  for (const modelName of models) {
    try {
      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 10000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(_mealAiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sysInstruction }] },
          contents,
          generationConfig: { temperature: 0.55, maxOutputTokens: 1400 }
        }),
        signal: controller.signal
      });
      clearTimeout(tId);
      if (!res.ok) continue;
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply && reply.trim()) {
        _mealAiWorkingModel = modelName;
        sessionStorage.setItem('aseel_gemini_working_model', modelName);
        return reply.trim();
      }
    } catch (e) {
      console.warn('Meal AI model fallback:', modelName, e);
    }
  }
  return null;
}

function buildLocalMealChefFallback(userText) {
  const ctx = getActiveMealSlotContext();
  const childName = state.child?.name || 'الطفل';
  const qNorm = normAr(userText);

  // 1. Check if user is asking to start interactive preparation
  if (qNorm.includes('اسالني') || qNorm.includes('تفاعلي')) {
    if (qNorm.includes('فطار') || qNorm.includes('فطور')) {
      return {
        cleanText: `أهلاً بكِ! ☀️ عشان نحضر فطار يفتح نفس **${childName}** ومظبوط على معامل الكارب (1:${ctx.activeCR}):\n\nتحبي الفطار النهاردة يكون إيه؟ اختاري من التفضيلات بالأسفل أو اكتبي لي المتاح عندك في البيت:`,
        actionData: {
          autoApply: false,
          replies: [
            '🥙 فول مدمس + نصف رغيف بلدي + بيضة',
            '🧀 توست أسمر + جبنة قريش + خيار وطماطم',
            '🥞 فطيرة بطاطس أو طعمية بيتي + خبز',
            '🥣 شوفان بالحليب أو زبادي بالفواكه'
          ],
          options: []
        }
      };
    }
    if (qNorm.includes('غدا') || qNorm.includes('غداء')) {
      return {
        cleanText: `يلا نجهز غداء صحي ومشبع لـ **${childName}**! 🍲 (معامل الكارب للغداء 1:${ctx.activeCR})\n\nإيه الصنف الأساسي المتاح عندكم النهاردة أو اللي ${childName} بتفضله؟`,
        actionData: {
          autoApply: false,
          replies: [
            '🍚 أرز مصري + خضار مطبوخ (بامية/بسلة) + دجاج/لحم',
            '🍝 مكرونة بالصلصة + كفتة مشوية + سلطة',
            '🥖 عيش بلدي + سمك مشوي أو كبدة + سلطة',
            '🥔 صينية بطاطس بالفراخ + أرز'
          ],
          options: []
        }
      };
    }
    if (qNorm.includes('عشا') || qNorm.includes('عشاء')) {
      return {
        cleanText: `لوجبة العشاء 🌙 نفضل دائماً دمج بروتين وألياف لمنع هبوط السكر أثناء النوم (معامل الكارب 1:${ctx.activeCR}).\n\nتحبي عشاء **${childName}** يكون بأي شكل الليلة؟`,
        actionData: {
          autoApply: false,
          replies: [
            '🥛 زبادي + نصف رغيف صغير + جبنة وبيضة',
            '🥪 ساندويتش توست أسمر بالجبنة الرومي/الشيدر والخس',
            '🍳 شكشوكة بالبيض والخضار + ربع رغيف بلدي'
          ],
          options: []
        }
      };
    }
    if (qNorm.includes('سناك')) {
      return {
        cleanText: `بالنسبة للسناك 🍎، تحبي يكون سناك فاكهة طازجة، ولا سناك مقرمش مالح، ولا حاجة حلوة خفيفة؟`,
        actionData: {
          autoApply: false,
          replies: [
            '🍎 تفاحة متوسطة مع ملعقة زبدة فول سوداني',
            '🍿 2 كوب فشار منزلي بزيت خفيف + مكسرات',
            '🍓 علبة زبادي صغيرة مع فراولة'
          ],
          options: []
        }
      };
    }
  }

  // 2. Check if user selected or typed specific foods
  const foundFoods = [];
  for (const f of state.globalFoods) {
    const fn = normAr(f.name);
    if (fn && fn.length >= 3 && qNorm.includes(fn)) {
      foundFoods.push(f);
    }
  }

  if (foundFoods.length > 0) {
    const numMatch = userText.match(/(\d+(\.\d+)?)/);
    const qty = numMatch ? Number(numMatch[1]) : 1;
    const items = foundFoods.slice(0, 4).map(f => {
      const u = f.units?.[0] || { label: '100 جرام', grams: 100 };
      return {
        name: f.name,
        qty,
        unitLabel: u.label,
        gramsPerUnit: u.grams || 100,
        carbsPer100g: f.carbs || 0,
        fiberPer100g: f.fiber || 0,
        proteinPer100g: f.protein || 0,
        fatPer100g: f.fat || 0,
        kcalPer100g: f.calories || 0
      };
    });
    const totalCarbs = items.reduce((s, it) => s + ((it.carbsPer100g - it.fiberPer100g) * (it.gramsPerUnit * it.qty) / 100), 0);
    const dose = round(totalCarbs / ctx.activeCR, 1);

    return {
      cleanText: `جهزت لك الأصناف المختارة بالمقادير المناسبة لـ **${childName}**:\nإجمالي الكارب الصافي: **${round(totalCarbs, 1)} جم** ⬅️ الجرعة المقدرة: **${dose} وحدة**.\n\nهل المقادير دي مناسبة نضيفها للجدول ولا تحبي نعدل كمية أي صنف؟`,
      actionData: {
        autoApply: false,
        replaceExisting: true,
        replies: [
          '➕ زود الكمية شوية',
          '➖ قلل الكارب شوية',
          '🥗 ضيف سلطة خضراء معاهم'
        ],
        options: [{ title: `الوجبة المقترحة (${round(totalCarbs, 1)}g كارب ⬅️ ${dose}U)`, items }]
      }
    };
  }

  // Default interactive meal card with follow-ups
  const items = [
    { name: 'خبز بلدي مصري', qty: 0.5, unitLabel: 'رغيف', gramsPerUnit: 100, carbsPer100g: 50, fiberPer100g: 4, proteinPer100g: 9, fatPer100g: 1.5, kcalPer100g: 250 },
    { name: 'فول مدمس مطبوخ', qty: 4, unitLabel: 'ملعقة طعام', gramsPerUnit: 15, carbsPer100g: 15, fiberPer100g: 4, proteinPer100g: 7, fatPer100g: 1, kcalPer100g: 110 },
    { name: 'بيض مسلوق', qty: 1, unitLabel: 'بيضة', gramsPerUnit: 50, carbsPer100g: 1, fiberPer100g: 0, proteinPer100g: 13, fatPer100g: 11, kcalPer100g: 155 }
  ];
  const dose = round(30 / ctx.activeCR, 1);
  return {
    cleanText: `إليك اقتراح متوازن لـ **${childName}** (${ctx.slotLabel}). قولي لي لو حابة نبدل أي صنف أو اضغطي على الزر بالأسفل لإضافتها للجدول:`,
    actionData: {
      autoApply: false,
      replaceExisting: true,
      replies: ['🍳 تحضير فطار تفاعلي', '🍲 تحضير غداء تفاعلي', '🥪 تحضير عشاء تفاعلي'],
      options: [{ title: `وجبة متوازنة (30g كارب ⬅️ ${dose}U)`, items }]
    }
  };
}

function parseMealAiResponse(rawReply) {
  if (!rawReply) return { cleanText: '', actionData: null };
  let actionData = null;
  let cleanText = rawReply;

  const jsonMatch = rawReply.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
  if (jsonMatch && jsonMatch[1]) {
    try {
      actionData = JSON.parse(jsonMatch[1].trim());
      cleanText = rawReply.replace(jsonMatch[0], '').trim();
    } catch (e) {
      console.warn('Could not parse AI JSON action block:', e);
    }
  }
  return { cleanText, actionData };
}

function appendMealAiMessage(role, text, actionData = null) {
  const box = $('mealAiMessages');
  if (!box) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `m-ai-msg ${role === 'user' ? 'user' : 'bot'}`;

  const formattedHtml = esc(text || '')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');

  msgDiv.innerHTML = `<div>${formattedHtml}</div>`;

  // 1. Render Meal Option Cards (with normalized quantities & units)
  if (role === 'bot' && actionData && Array.isArray(actionData.options) && actionData.options.length) {
    actionData.options.forEach((opt) => {
      if (!opt.items || !opt.items.length) return;
      const card = document.createElement('div');
      card.className = 'ai-meal-option-card';

      const normalizedItems = opt.items.map(normalizeAiItemSpec);
      const totalNetCarbs = round(normalizedItems.reduce((s, it) => s + it.netCarbs, 0), 1);
      const ctx = getActiveMealSlotContext();
      const estDose = round(totalNetCarbs / ctx.activeCR, 1);

      const itemsListHtml = normalizedItems.map(it =>
        `<li><b>${esc(it.name)}</b>: ${esc(it.displayQtyUnit)} <span style="color:#6d28d9;font-size:11.5px;">(${it.netCarbs}g كارب)</span></li>`
      ).join('');

      card.innerHTML = `
        <div class="ai-meal-option-title">
          <span>🍽️ ${esc(opt.title || `وجبة مقترحة (${totalNetCarbs}g كارب ⬅️ ${estDose}U)`)}</span>
        </div>
        <ul class="ai-meal-option-list">${itemsListHtml}</ul>
        <div class="ai-meal-option-actions">
          <button type="button" class="btn-apply-ai-meal">✅ اعتماد وإضافة كوجبة جديدة في الجدول</button>
          <button type="button" class="btn-append-ai-meal">➕ إضافة على الأصناف الحالية</button>
        </div>
      `;

      const applyBtn = card.querySelector('.btn-apply-ai-meal');
      const appendBtn = card.querySelector('.btn-append-ai-meal');

      applyBtn.onclick = () => {
        applyAiOptionToMealTable(opt, true);
        applyBtn.textContent = '✔️ تم إدراج الوجبة وحساب الجرعة!';
        setTimeout(() => { applyBtn.textContent = '✅ اعتماد وإضافة كوجبة جديدة في الجدول'; }, 2200);
      };

      appendBtn.onclick = () => {
        applyAiOptionToMealTable(opt, false);
        appendBtn.textContent = '✔️ تمت الإضافة للجدول!';
        setTimeout(() => { appendBtn.textContent = '➕ إضافة على الأصناف الحالية'; }, 2200);
      };

      msgDiv.appendChild(card);
    });

    if (actionData.autoApply === true && actionData.options[0]) {
      applyAiOptionToMealTable(actionData.options[0], Boolean(actionData.replaceExisting));
      const autoNote = document.createElement('div');
      autoNote.style.cssText = 'margin-top:8px; font-size:12px; font-weight:bold; color:#15803d; background:#dcfce7; padding:6px 10px; border-radius:8px;';
      autoNote.textContent = '✅ تم إدراج الأصناف والمقادير في جدول الوجبة وحساب الجرعة!';
      msgDiv.appendChild(autoNote);
    }
  }

  // 2. Render Interactive Quick-Reply Pills (for conversational preference selection)
  if (role === 'bot' && actionData && Array.isArray(actionData.replies) && actionData.replies.length) {
    const repliesWrap = document.createElement('div');
    repliesWrap.className = 'ai-interactive-replies';

    actionData.replies.forEach(replyText => {
      if (!replyText) return;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'ai-reply-pill';
      pill.textContent = replyText;
      pill.onclick = () => {
        handleMealAiUserPrompt(replyText);
      };
      repliesWrap.appendChild(pill);
    });

    msgDiv.appendChild(repliesWrap);
  }

  box.appendChild(msgDiv);
  box.scrollTop = box.scrollHeight;
}

async function handleMealAiUserPrompt(userText) {
  const q = (userText || '').trim();
  if (!q) return;

  const input = $('mealAiInput');
  const sendBtn = $('mealAiSendBtn');
  if (input) input.value = '';
  if (sendBtn) sendBtn.disabled = true;

  appendMealAiMessage('user', q);
  _mealAiHistory.push({ role: 'user', text: q });

  const box = $('mealAiMessages');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'm-ai-msg bot';
  loadingDiv.innerHTML = '⏳ <i>جاري التفكير وتنسيق الأصناف والمقادير...</i>';
  box?.appendChild(loadingDiv);
  if (box) box.scrollTop = box.scrollHeight;

  try {
    const rawCloudReply = await callMealGeminiCloud(q);
    loadingDiv.remove();

    if (rawCloudReply) {
      const { cleanText, actionData } = parseMealAiResponse(rawCloudReply);
      _mealAiHistory.push({ role: 'model', text: cleanText });
      appendMealAiMessage('bot', cleanText || 'إليك التفاصيل:', actionData);
    } else {
      const fallback = buildLocalMealChefFallback(q);
      _mealAiHistory.push({ role: 'model', text: fallback.cleanText });
      appendMealAiMessage('bot', fallback.cleanText, fallback.actionData);
    }
  } catch (err) {
    console.error('Meal AI error:', err);
    loadingDiv.remove();
    const fallback = buildLocalMealChefFallback(q);
    appendMealAiMessage('bot', fallback.cleanText, fallback.actionData);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
}

function initMealAiChef() {
  if (_mealAiInitialized) return;
  _mealAiInitialized = true;

  loadMealGeminiKey().then(() => resolveWorkingGeminiModel());

  const drawer = $('mealAiDrawer');
  const fab = $('mealAiFab');
  const topBtn = $('btnOpenAiChef');
  const closeBtn = $('mealAiCloseBtn');
  const form = $('mealAiForm');
  const chipsBox = $('mealAiQuickChips');

  const openDrawer = () => {
    drawer?.classList.remove('hidden');
    const box = $('mealAiMessages');
    if (box && !box.children.length) {
      const ctx = getActiveMealSlotContext();
      const childName = state.child?.name || 'الطفل';
      appendMealAiMessage(
        'bot',
        `أهلاً بكِ في شات مطبخ **${childName}** التفاعلي! 👩‍🍳🍽️\nالوجبة الحالية: **${ctx.slotLabel}** (معامل الكارب 1:${ctx.activeCR}).\n\nتحبي نحضر وجبة إيه مع بعض دلوقتي؟ اختاري من الأزرار التفاعلية أو اكتبي لي الأصناف اللي عندك أو اللي ${childName} نفسها فيها:`,
        {
          autoApply: false,
          replies: [
            '🍳 عايزة نحضر فطار مع بعض',
            '🍲 عايزة نحضر غداء على ذوقها',
            '🥪 عايزة نحضر عشاء خفيف وآمن',
            '🍎 عايزة سناك محسوب الكارب'
          ],
          options: []
        }
      );
    }
    setTimeout(() => $('mealAiInput')?.focus(), 100);
  };

  fab?.addEventListener('click', () => {
    if (drawer?.classList.contains('hidden')) openDrawer();
    else drawer?.classList.add('hidden');
  });

  topBtn?.addEventListener('click', openDrawer);
  closeBtn?.addEventListener('click', () => drawer?.classList.add('hidden'));

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleMealAiUserPrompt($('mealAiInput')?.value);
  });

  chipsBox?.querySelectorAll('.meal-ai-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      if (prompt) handleMealAiUserPrompt(prompt);
    });
  });
}
