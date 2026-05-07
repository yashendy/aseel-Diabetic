// js/meals.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, getDoc, setDoc, addDoc, getDocs, query, where, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const fmt = (n,d=1)=>Number.isFinite(n)?(+n).toFixed(d):"0.0";
const todayStr = ()=> new Date().toISOString().slice(0,10);
const currentTimeStr = ()=> new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const mgdl2mmol = mg => mg/18.0182;
const mmol2mgdl = mmol => mmol*18.0182;
const SAFE_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%20style%3D%22background%3A%23f1f5f9%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%2394a3b8%22%20font-size%3D%2220%22%3E%F0%9F%8D%BD%EF%B8%8F%3C%2Ftext%3E%3C%2Fsvg%3E';

let state = {
  childId: null, parentId: null, child: null, 
  date: todayStr(), time: currentTimeStr(), slot: "PRE_BREAKFAST",
  CF: 50, Target: 100, CRs: { breakfast: 10, lunch: 10, dinner: 10, snack: 15 },
  rule: "fullFiber", globalFoods: [], mealItems: [], IOB: 0, 
  manualCarbDirty: false, manualDoseDirty: false, 
  eatenToday: 0, caloriesEatenToday: 0, currentMealCarbs: 0, currentMealCalories: 0, currentBgUnit: "mg/dL"
};

const els = {
  loader: $("loader"), chipCF: $("lblCF"), chipCR: $("lblCR"), chipTarget: $("lblTarget"),
  dateInput: $("dateInput"), timeInput: $("timeInput"), slotSelect: $("slotSelect"), 
  preBg: $("preBg"), preBgUnit: $("preBgUnit"), btnFetchPre: $("btnFetchPre"), 
  measureSource: $("measureSource"), trendArrow: $("trendArrow"),
  doseCorrection: $("doseCorrection"), doseCarbs: $("doseCarbs"), manualCarbs: $("manualCarbs"), iobValue: $("iobValue"), 
  doseFinalInput: $("doseFinalInput"), hypoRescueArea: $("hypoRescueArea"), hypoTreatment: $("hypoTreatment"),
  mealNotes: $("mealNotes"), smartAlerts: $("smartAlerts"), resultBox: $("resultBox"),
  mealBody: $("mealBody"), sumCarbsNet: $("sumCarbsNet"), sumCalories: $("sumCalories"),
  libModal: $("libModal"), searchBox: $("searchBox"), itemsGrid: $("itemsGrid"),
  dailyCarbTarget: $("dailyCarbTarget"), carbProgressBar: $("carbProgressBar"), carbProgressText: $("carbProgressText"),
  dailyCalorieTarget: $("dailyCalorieTarget"), calProgressBar: $("calProgressBar"), calProgressText: $("calProgressText"),
  dailyMealsBody: $("dailyMealsBody")
};

function showLoader(v) { els.loader.classList.toggle('hidden', !v); }
function getSlotLabel(key) { const l = { PRE_BREAKFAST: 'الفطار', PRE_LUNCH: 'الغداء', PRE_DINNER: 'العشاء', SNACK: 'سناك' }; return l[key] || key; }

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  const qp = new URLSearchParams(location.search);
  state.childId = qp.get('child') || localStorage.getItem('selectedChildId');
  state.parentId = u.uid;
  if (!state.childId) { location.href = 'parent.html'; return; }
  
  els.dateInput.value = state.date; els.timeInput.value = state.time;
  try {
    await loadChildData(); setupEvents(); fetchFoodLibrary(); await loadTodayMeals();
  } catch (e) { console.error(e); } finally { showLoader(false); }
});

async function loadChildData() {
  const snap = await getDoc(doc(db, `parents/${state.parentId}/children/${state.childId}`));
  if (!snap.exists()) return;
  const c = snap.data(); state.child = c;
  state.CF = Number(c.cf) || 50; if(c.cr) state.CRs = c.cr;
  state.Target = Number(c.glucose_limits?.target) || (c.glucoseUnit==='mmol/L'?5.5:100);
  state.currentBgUnit = c.glucoseUnit || 'mg/dL'; els.preBgUnit.value = state.currentBgUnit;
  if(c.dietGoal) els.dailyCarbTarget.value = c.dietGoal;
  if(c.calorieGoal) els.dailyCalorieTarget.value = c.calorieGoal;
  updateFactorsDisplay();
}

function updateFactorsDisplay() {
  let cr = state.CRs.snack || 15;
  if(state.slot.includes('BREAKFAST')) cr = state.CRs.breakfast || 10;
  if(state.slot.includes('LUNCH')) cr = state.CRs.lunch || 10;
  if(state.slot.includes('DINNER')) cr = state.CRs.dinner || 10;
  els.chipCF.textContent = state.CF; els.chipCR.textContent = cr; els.chipTarget.textContent = state.Target;
  calculateBolus();
}

function calculateBolus() {
  if (state.manualDoseDirty) return; // لو الأم بتكتب بإيدها ملمسش الخانة

  const bg = parseFloat(els.preBg.value);
  const carbs = parseFloat(els.manualCarbs.value) || 0;
  const iob = parseFloat(els.iobValue.value) || 0;
  const unit = els.preBgUnit.value;
  const childUnit = state.child?.glucoseUnit || 'mg/dL';
  
  let cr = state.CRs.snack || 15;
  if(state.slot.includes('BREAKFAST')) cr = state.CRs.breakfast || 10;
  if(state.slot.includes('LUNCH')) cr = state.CRs.lunch || 10;
  if(state.slot.includes('DINNER')) cr = state.CRs.dinner || 10;

  let bgNorm = bg;
  if (bg > 0 && unit !== childUnit) bgNorm = (childUnit === 'mmol/L') ? mgdl2mmol(bg) : mmol2mgdl(bg);
  if (bg && els.measureSource.value === 'cgm') bgNorm += (childUnit==='mmol/L' ? Number(els.trendArrow.value)/18 : Number(els.trendArrow.value));

  let corr = 0, carbDose = (carbs / cr), netDose = 0;
  const lowLimit = childUnit === 'mmol/L' ? 3.9 : 70;

  // منطق الهبوط
  if (bgNorm > 0 && bgNorm < lowLimit) {
    els.hypoRescueArea.style.display = 'block';
    els.resultBox.className = 'result-box';
    els.doseCorrection.value = "0.0"; els.doseCarbs.value = "0.0"; els.doseFinalInput.value = "0.0";
    return;
  } else {
    els.hypoRescueArea.style.display = 'none';
  }

  if (bgNorm > 0) corr = (bgNorm - state.Target) / state.CF;
  netDose = Math.max(0, (corr + carbDose) - iob);
  
  els.doseCorrection.value = fmt(corr);
  els.doseCarbs.value = fmt(carbDose);
  els.doseFinalInput.value = fmt(Math.round(netDose*2)/2);
  els.resultBox.className = (netDose > 0) ? 'result-box safe' : 'result-box';
}

// --- الاسترداد الذكي المطور ---
els.btnFetchPre.onclick = async () => {
  els.btnFetchPre.textContent = "⏳...";
  try {
    const qy = query(collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`), where('date', '==', state.date));
    const snap = await getDocs(qy);
    let found = null;
    snap.forEach(doc => { if(doc.data().slotKey === state.slot) found = {id: doc.id, ...doc.data()}; });
    
    if(found) {
      els.preBg.value = found.value || ""; els.preBgUnit.value = found.unit || "mg/dL";
      els.doseCorrection.value = fmt(found.correctionDose);
      els.doseCarbs.value = fmt(found.carbDose);
      els.manualCarbs.value = found.carbs || 0;
      els.doseFinalInput.value = fmt(found.totalDose);
      els.hypoTreatment.value = found.hypoTreatment || "";
      els.mealNotes.value = found.notes || "";
      state.manualDoseDirty = true; // نمنع الحساب التلقائي عشان نعرض اللي اتسجل بالظبط
      calculateBolus();
      alert("✅ تم استرداد كافة بيانات الوجبة.");
    } else { alert("❌ لا يوجد سجل لهذه الوجبة في هذا التاريخ."); }
  } catch(e) { console.error(e); } finally { els.btnFetchPre.textContent = "🔄 جلب"; }
};

els.btnSaveMeal.onclick = async () => {
  showLoader(true);
  try {
    const timeObj = new Date(els.dateInput.value + "T" + els.timeInput.value);
    const payload = {
      date: els.dateInput.value, time: els.timeInput.value, when: timeObj, slotKey: els.slotSelect.value,
      value: parseFloat(els.preBg.value), unit: els.preBgUnit.value,
      carbs: parseFloat(els.manualCarbs.value) || 0,
      carbDose: parseFloat(els.doseCarbs.value) || 0,
      correctionDose: parseFloat(els.doseCorrection.value) || 0,
      totalDose: parseFloat(els.doseFinalInput.value) || 0,
      hypoTreatment: els.hypoTreatment.value,
      notes: els.mealNotes.value,
      createdAt: serverTimestamp()
    };
    
    // منع التكرار
    const coll = collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`);
    const snap = await getDocs(query(coll, where("date", "==", payload.date)));
    let tid = null; snap.forEach(d => { if(d.data().slotKey === payload.slotKey) tid = d.id; });

    if(tid) await setDoc(doc(coll, tid), payload, {merge:true});
    else await addDoc(coll, payload);

    alert("✅ تم الحفظ بنجاح!"); await loadTodayMeals();
  } catch(e) { alert("خطأ في الحفظ"); } finally { showLoader(false); }
};

// --- المطبخ والمكتبة (مختصرة للسرعة) ---
async function fetchFoodLibrary() {
  const snap = await getDocs(collection(db, "admin/global/foodItems"));
  state.globalFoods = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderLibrary(); $("loadingLibrary").style.display='none';
}
function renderLibrary() {
  const q = els.searchBox.value.toLowerCase();
  const list = state.globalFoods.filter(f => f.name.toLowerCase().includes(q));
  els.itemsGrid.innerHTML = list.map(f => `<div class="food-lib-item" onclick="addItemToMeal('${f.id}')"><b>${f.name}</b> <span>${f.per100.carbs_g}g كارب</span></div>`).join('');
}
window.addItemToMeal = (id) => {
  const f = state.globalFoods.find(x=>x.id===id);
  state.mealItems.push({...f, qty:1}); renderMealTable(); updateMealTotals(); els.libModal.classList.remove('open');
};
function renderMealTable() {
  els.mealBody.innerHTML = state.mealItems.map((item, i) => `<tr><td>${item.name}</td><td><input type="number" value="${item.qty}" oninput="updateQty(${i},this.value)"></td><td>${fmt(item.per100.carbs_g*item.qty)}</td><td><button onclick="removeItem(${i})">✕</button></td></tr>`).join('');
}
window.updateQty = (i,v)=>{ state.mealItems[i].qty=parseFloat(v); updateMealTotals(); };
window.removeItem = (i)=>{ state.mealItems.splice(i,1); updateMealTotals(); };
function updateMealTotals() {
  let c=0; state.mealItems.forEach(i=>c+=i.per100.carbs_g*i.qty);
  els.sumCarbsNet.textContent = fmt(c)+"g"; els.manualCarbs.value = fmt(c); calculateBolus();
}

async function loadTodayMeals() {
  const snap = await getDocs(query(collection(db, `parents/${state.parentId}/children/${state.childId}/measurements`), where('date', '==', els.dateInput.value)));
  let h = ''; snap.forEach(d => {
    const m = d.data(); h += `<tr><td>${getSlotLabel(m.slotKey)}</td><td>${m.carbs}g</td><td>${m.calories||0}</td><td>${m.carbDose}U</td><td>${m.correctionDose}U</td><td><b>${m.totalDose}U</b></td><td><button onclick="editMeal('${m.slotKey}')">✏️</button></td></tr>`;
  });
  els.dailyMealsBody.innerHTML = h || '<tr><td colspan="7">لا وجبات</td></tr>';
}

function setupEvents() {
  els.slotSelect.onchange = () => { state.slot = els.slotSelect.value; updateFactorsDisplay(); };
  els.preBg.oninput = () => { state.manualDoseDirty = false; calculateBolus(); };
  els.manualCarbs.oninput = () => { state.manualCarbDirty = true; state.manualDoseDirty = false; calculateBolus(); };
  els.doseFinalInput.oninput = () => { state.manualDoseDirty = true; };
  els.btnOpenLibrary.onclick = () => els.libModal.classList.add('open');
  els.libClose.onclick = () => els.libModal.classList.remove('open');
  els.searchBox.oninput = renderLibrary;
  els.btnClearMeal.onclick = () => { state.mealItems=[]; state.manualDoseDirty=false; renderMealTable(); updateMealTotals(); };
}
