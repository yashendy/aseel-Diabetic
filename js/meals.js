// js/meals.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentUser, childId, parentId;
let childData = {};
let foodLibrary = [];
let currentMealItems = [];
let dailyCarbGoal = 150; // افتراضي الدايت

// عناصر الواجهة
const bgInput = $('bgInput');
const carbsInput = $('carbsInput');
const iobInput = $('iobInput');
const measureSource = $('measureSource');
const trendArrow = $('trendArrow');
const mealSlot = $('mealSlot');

function loader(show) { $('loader').classList.toggle('hidden', !show); }

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  currentUser = u;
  childId = new URLSearchParams(location.search).get('child') || localStorage.getItem('selectedChildId');
  parentId = localStorage.getItem('selectedParentId') || u.uid;
  if (!childId) { location.href = 'parent.html'; return; }

  try {
    await loadChildData();
    await loadFoodLibrary();
    await calcDailyCarbs();
    setupEvents();
    autoSelectMealSlot();
  } catch (e) { console.error(e); alert('حدث خطأ في تحميل البيانات.'); }
  finally { loader(false); }
});

async function loadChildData() {
  const snap = await getDoc(doc(db, `parents/${parentId}/children/${childId}`));
  if (!snap.exists()) throw new Error('Child not found');
  childData = snap.data();

  // تحديث الهيدر
  const name = childData.name || 'الطفل';
  $('topAvatar').textContent = name.charAt(0);
  $('topChildName').textContent = name;
  $('topChildMeta').textContent = `${childData.gender === 'female' ? 'أنثى' : 'ذكر'} • ${childData.glucoseUnit || 'mg/dL'}`;
  $('breadChildName').textContent = name;
  $('breadChildName').href = `child.html?child=${childId}`;
  $('navHome').href = `child.html?child=${childId}`;
  $('navMeas').href = `measurements.html?child=${childId}`;
  $('navReports').href = `reports.html?child=${childId}`;

  $('unitLbl').textContent = childData.glucoseUnit || 'mg/dL';
  
  // المعاملات
  const L = childData.glucose_limits || {};
  const target = L.target || (childData.glucoseUnit === 'mmol/L' ? 5.5 : 100);
  const cf = childData.cf || childData.correctionFactor || 0;
  
  $('lblTarget').textContent = target;
  $('lblCF').textContent = cf || 'غير محدد';
  
  // نظام الدايت
  if(childData.diet_goal) dailyCarbGoal = childData.diet_goal;
}

// التحديد التلقائي لوقت الوجبة بناءً على الساعة
function autoSelectMealSlot() {
  const h = new Date().getHours();
  if(h >= 5 && h < 11) mealSlot.value = 'BREAKFAST';
  else if(h >= 11 && h < 16) mealSlot.value = 'LUNCH';
  else if(h >= 16 && h < 22) mealSlot.value = 'DINNER';
  else mealSlot.value = 'SNACK';
  updateFactorsDisplay();
}

// تحديث عرض معامل الكارب حسب الوجبة المختارة
function updateFactorsDisplay() {
  const slot = mealSlot.value;
  let cr = 0;
  if (childData.cr && typeof childData.cr === 'object') {
    cr = childData.cr[slot.toLowerCase()] || childData.cr.breakfast || 0;
  } else {
    cr = childData.carbRatio || 0;
  }
  $('lblCR').textContent = cr || 'غير محدد';
  calculateBolus(); // إعادة الحساب عند تغيير المعامل
}

// --- مكتبة الطعام وبناء الوجبة ---
async function loadFoodLibrary() {
  // جلب الأكل العالمي من الأدمن
  const gSnap = await getDocs(collection(db, 'admin/global/foodItems'));
  gSnap.forEach(d => foodLibrary.push({ id: d.id, ...d.data() }));
  
  // جلب أكل الأسرة الخاص
  const pSnap = await getDocs(collection(db, `parents/${parentId}/foodItems`));
  pSnap.forEach(d => foodLibrary.push({ id: d.id, ...d.data() }));
}

$('foodSearch').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  const sug = $('foodSuggestions');
  sug.innerHTML = '';
  if (!q) { sug.style.display = 'none'; return; }

  const matches = foodLibrary.filter(f => f.name.toLowerCase().includes(q)).slice(0, 5);
  if (!matches.length) { sug.style.display = 'none'; return; }

  matches.forEach(f => {
    const div = document.createElement('div'); div.className = 'food-item-sug';
    div.innerHTML = `<div>${f.name} <small class="muted">(${f.portionSize})</small></div> <span>${f.carbs}g كارب</span>`;
    div.onclick = () => { addFoodToMeal(f); $('foodSearch').value = ''; sug.style.display = 'none'; };
    sug.appendChild(div);
  });
  sug.style.display = 'block';
});

function addFoodToMeal(food) {
  currentMealItems.push({ ...food, qty: 1 });
  renderMealTable();
}

function renderMealTable() {
  const tbody = $('mealItemsBody'); tbody.innerHTML = '';
  let totalCarbs = 0;

  if (!currentMealItems.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94a3b8">لم يتم إضافة أصناف.</td></tr>`;
    $('totalMealCarbs').textContent = 0;
    carbsInput.value = '';
    calculateBolus();
    return;
  }

  currentMealItems.forEach((item, idx) => {
    const itemCarb = Math.round(item.carbs * item.qty);
    totalCarbs += itemCarb;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.name}</td>
      <td><input type="number" min="0.5" step="0.5" value="${item.qty}" class="input" style="width:60px; padding:4px" onchange="updateQty(${idx}, this.value)"></td>
      <td style="font-weight:bold">${itemCarb}</td>
      <td><button class="del-btn" onclick="removeFood(${idx})">✖</button></td>
    `;
    tbody.appendChild(tr);
  });

  $('totalMealCarbs').textContent = totalCarbs;
  carbsInput.value = totalCarbs;
  calculateBolus();
}

window.updateQty = (idx, val) => { currentMealItems[idx].qty = Number(val); renderMealTable(); };
window.removeFood = (idx) => { currentMealItems.splice(idx, 1); renderMealTable(); };

// --- محرك الحساب الذكي ---
function calculateBolus() {
  const L = childData.glucose_limits || {};
  const target = Number(L.target) || (childData.glucoseUnit === 'mmol/L' ? 5.5 : 100);
  const cf = Number(childData.cf || childData.correctionFactor || 0);
  
  const slot = mealSlot.value;
  let cr = Number(childData.cr?.[slot.toLowerCase()] || childData.carbRatio || 0);

  let bg = Number(bgInput.value);
  const carbs = Number(carbsInput.value);
  const iob = Number(iobInput.value) || 0;
  
  const resultBox = $('resultBox');

  // التأكد من وجود المعاملات
  if (!cf || !cr) {
    $('finalDoseDisplay').textContent = "يرجى ضبط المعاملات (CR/CF) في الإعدادات.";
    $('doseDetailsStr').textContent = '';
    resultBox.className = 'result-box';
    return;
  }

  // تعديل السكر بناءً على سهم الحساس (إذا كان المصدر CGM)
  let effectiveBG = bg;
  if (bg && measureSource.value === 'cgm') {
    const trendAdjust = Number(trendArrow.value);
    // إذا كانت الوحدة mmol/L نحول التعديل
    const adjustVal = childData.glucoseUnit === 'mmol/L' ? (trendAdjust / 18.0) : trendAdjust;
    effectiveBG += adjustVal;
  }

  // حساب جرعة التصحيح
  let corrDose = 0;
  if (bg > 0) { corrDose = (effectiveBG - target) / cf; }

  // حساب جرعة الكارب
  let carbDose = 0;
  if (carbs > 0) { carbDose = carbs / cr; }

  // الجرعة الإجمالية مخصوم منها الأنسولين النشط
  let grossDose = corrDose + carbDose;
  let netDose = grossDose - iob;

  if (netDose < 0) netDose = 0;

  // تحديث الواجهة
  $('finalDoseDisplay').textContent = netDose.toFixed(1) + ' U';
  $('doseDetailsStr').textContent = `كارب: ${carbDose.toFixed(1)} | تصحيح: ${corrDose.toFixed(1)} | خصم نشط: -${iob.toFixed(1)}`;

  if (netDose > 0 && effectiveBG >= target) { resultBox.className = 'result-box safe'; } 
  else { resultBox.className = 'result-box'; }

  triggerAIWarning(bg, carbs);
}

// AI Warning Simulation
function triggerAIWarning(bg, carbs) {
  const pred = $('aiPrediction');
  const txt = $('aiPredText');
  pred.classList.add('hidden');

  if (bg && bg < (childData.glucose_limits?.low || 70)) {
    txt.textContent = "⚠️ الطفل يعاني من هبوط حالياً! يرجى تقديم سكريات سريعة (15 جرام) والانتظار 15 دقيقة قبل إعطاء جرعة الأنسولين.";
    pred.classList.remove('hidden');
  } else if (mealSlot.value === 'DINNER' && carbs > 60) {
    txt.textContent = "🤖 تنبؤ أسيل: وجبات العشاء الغنية بالكارب تسبب تذبذباً ليلياً. يفضل تقسيم الجرعة أو اختيار كربوهيدرات معقدة.";
    pred.classList.remove('hidden');
  }
}

// حساب دايت اليوم
async function calcDailyCarbs() {
  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  
  const qy = query(collection(db, `parents/${parentId}/children/${childId}/meals`), where('date', '==', todayStr));
  const snap = await getDocs(qy);
  
  let eaten = 0;
  snap.forEach(doc => { eaten += Number(doc.data().carbs || 0); });
  
  $('carbProgressText').textContent = `${Math.round(eaten)} / ${dailyCarbGoal} جرام`;
  const pct = Math.min(100, (eaten / dailyCarbGoal) * 100);
  const bar = $('carbProgressBar');
  bar.style.width = pct + '%';
  bar.className = `progress-fill ${pct > 100 ? 'danger' : pct > 80 ? 'warn' : ''}`;
}

// سحب آخر قراءة سكر
$('btnFetchBG').onclick = async () => {
  try {
    const qy = query(collection(db, `parents/${parentId}/children/${childId}/measurements`), orderBy('when', 'desc'), limit(1));
    const snap = await getDocs(qy);
    if (!snap.empty) {
      const m = snap.docs[0].data();
      // التحقق من أن القراءة تمت خلال آخر ساعة
      const diffMs = new Date() - m.when.toDate();
      if (diffMs < 60 * 60 * 1000) {
        bgInput.value = m.value;
        measureSource.value = m.measureMethod === 'sensor' ? 'cgm' : 'bgm';
        measureSource.dispatchEvent(new Event('change'));
        calculateBolus();
        alert('تم جلب آخر قراءة بنجاح.');
      } else { alert('آخر قراءة مر عليها أكثر من ساعة. يرجى قياس السكر الآن.'); }
    } else { alert('لا توجد قراءات سابقة اليوم.'); }
  } catch(e) { console.error(e); }
};

// حفظ الوجبة
$('btnSaveLog').onclick = async () => {
  const carbs = Number(carbsInput.value);
  const bg = Number(bgInput.value);
  const dose = parseFloat($('finalDoseDisplay').textContent);
  
  if (!carbs && !bg) { alert("يجب إدخال الكارب أو قراءة السكر على الأقل."); return; }

  loader(true);
  try {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    
    // حفظ في الوجبات
    if (carbs > 0 || currentMealItems.length > 0) {
      await addDoc(collection(db, `parents/${parentId}/children/${childId}/meals`), {
        date: todayStr, when: d, slotKey: mealSlot.value,
        carbs: carbs, totalInsulin: dose, items: currentMealItems,
        createdAt: serverTimestamp()
      });
    }

    // حفظ في القياسات لظهورها في اللوجبوك
    if (bg > 0) {
      await addDoc(collection(db, `parents/${parentId}/children/${childId}/measurements`), {
        date: todayStr, when: d, slotKey: `PRE_${mealSlot.value}`,
        value: bg, unit: childData.glucoseUnit || 'mg/dL',
        measureMethod: measureSource.value === 'cgm' ? 'sensor' : 'blood',
        carbs: carbs, totalDose: dose,
        createdAt: serverTimestamp()
      });
    }

    alert("✅ تم تسجيل الوجبة بنجاح!");
    location.href = `child.html?child=${childId}`;
  } catch (e) { console.error(e); alert("حدث خطأ أثناء الحفظ."); }
  finally { loader(false); }
};

function setupEvents() {
  $('logoutBtn').onclick = () => signOut(auth);
  bgInput.oninput = calculateBolus;
  carbsInput.oninput = calculateBolus;
  iobInput.oninput = calculateBolus;
  mealSlot.onchange = updateFactorsDisplay;
  trendArrow.onchange = calculateBolus;
  
  measureSource.onchange = () => {
    $('trendContainer').classList.toggle('hidden', measureSource.value !== 'cgm');
    calculateBolus();
  };
}
