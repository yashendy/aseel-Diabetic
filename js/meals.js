// js/meals.js — صفحة الوجبات
import { auth, db } from "./firebase-config.js";
import { MealAI } from "./ai.js";
import {
  doc, getDoc, getDocs, collection, query
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

/* =================== عناصر DOM =================== */
const childNameEl = document.getElementById("childName");
const crEl = document.getElementById("crInput");
const cfEl = document.getElementById("cfInput");
const targetEl = document.getElementById("targetGlucose");
const glucoseEl = document.getElementById("glucoseNow");
const carbMinEl = document.getElementById("carbMin");
const carbMaxEl = document.getElementById("carbMax");
const itemsBody = document.getElementById("itemsBody");
const totalCarbsCell = document.getElementById("totalCarbsCell");
const foodLibraryContainer = document.getElementById("foodLibrary");

/* =================== بيانات حالة =================== */
let currentChildId = null;
let parentId = null;
let childData = {};
let items = [];
let foodLibrary = [];

/* =================== تحميل بيانات الطفل =================== */
async function loadChild() {
  const params = new URLSearchParams(window.location.search);
  currentChildId = params.get("child");
  parentId = auth.currentUser?.uid;
  if (!currentChildId || !parentId) return;

  const childRef = doc(db, "parents", parentId, "children", currentChildId);
  const snap = await getDoc(childRef);
  if (!snap.exists()) return;

  childData = snap.data();
  renderChildHeader();
}

/* =================== عرض بيانات الطفل =================== */
function renderChildHeader() {
  childNameEl.textContent = childData.name || "بدون اسم";

  // ratios
  const mealType = document.getElementById("mealType").value;
  const cr = childData.ratios?.cr?.byMeal?.[mealType] || childData.ratios?.cr?.default || "";
  const cf = childData.ratios?.cf?.byMeal?.[mealType] || childData.ratios?.cf?.default || "";
  const target = childData.normalRange?.min || "";

  crEl.value = cr;
  cfEl.value = cf;
  targetEl.value = target;

  const carbTarget = childData.carbTargets?.[mealType];
  carbMinEl.value = carbTarget?.min || "";
  carbMaxEl.value = carbTarget?.max || "";
}

/* =================== تحميل مكتبة الأصناف =================== */
async function loadFoodLibrary() {
  const q = query(collection(db, "admin", "global", "foodItems"));
  const snap = await getDocs(q);
  foodLibrary = snap.docs.map((d) => adaptFoodItem(d.data(), d.id));
  renderFoodLibrary(foodLibrary);
}

/* Adapter لتوحيد الحقول */
function adaptFoodItem(raw, id) {
  const item = {
    id,
    name: raw.name || "صنف",
    brand: raw.brand || "",
    imageUrl: raw.imageUrl || "",
    unit: raw.unit || (raw.measures?.[0]?.name || "وحدة"),
    gramsPerUnit: raw.measures?.[0]?.grams || raw.measureQty?.grams || 0,
    carbsPerUnit: raw.carbsPerUnit || null,
    carbsPer100: raw.nutrPer100g?.carbs || null,
    tags: raw.tags || []
  };
  return item;
}

/* =================== عرض المكتبة =================== */
function renderFoodLibrary(list) {
  foodLibraryContainer.innerHTML = "";
  list.forEach((f) => {
    const card = document.createElement("div");
    card.className = "food-card";
    card.innerHTML = `
      <img src="${f.imageUrl || "https://via.placeholder.com/80"}" alt="">
      <h4>${f.name}</h4>
      <p>${f.unit}</p>
      <button data-id="${f.id}">➕ إضافة</button>
    `;
    card.querySelector("button").addEventListener("click", () => addItem(f));
    foodLibraryContainer.appendChild(card);
  });
}

/* =================== إضافة صنف للوجبة =================== */
function addItem(food) {
  const qty = 1;
  const grams = qty * (food.gramsPerUnit || 0);
  const carbs = food.carbsPerUnit ??
    (food.carbsPer100 && grams ? (grams * food.carbsPer100) / 100 : 0);

  const item = {
    id: food.id,
    name: food.name,
    unit: food.unit,
    qty,
    grams,
    carbsPerUnit: food.carbsPerUnit || (food.carbsPer100 ? (food.gramsPerUnit * food.carbsPer100) / 100 : 0),
    carbs_g: carbs
  };
  items.push(item);
  renderItems();
}

/* =================== عرض الجدول =================== */
function renderItems() {
  itemsBody.innerHTML = "";
  let total = 0;
  items.forEach((it, idx) => {
    total += it.carbs_g || 0;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><button data-idx="${idx}">❌</button></td>
      <td>${it.name}</td>
      <td><input type="number" value="${it.qty}" step="0.25" data-idx="${idx}" class="qtyInput"></td>
      <td>${it.grams.toFixed(1)}</td>
      <td>${it.carbs_g.toFixed(1)}</td>
    `;
    // حذف
    row.querySelector("button").addEventListener("click", () => {
      items.splice(idx, 1);
      renderItems();
    });
    // تغيير كمية
    row.querySelector(".qtyInput").addEventListener("input", (e) => {
      const val = parseFloat(e.target.value) || 0;
      items[idx].qty = val;
      items[idx].grams = val * (items[idx].gramsPerUnit || 0);
      items[idx].carbs_g = val * (items[idx].carbsPerUnit || 0);
      renderItems();
    });
    itemsBody.appendChild(row);
  });
  totalCarbsCell.textContent = total.toFixed(1);
  updateDoses(total);
}

/* =================== حساب الجرعات =================== */
function updateDoses(totalCarbs) {
  const cr = parseFloat(crEl.value) || 1;
  const cf = parseFloat(cfEl.value) || 1;
  const target = parseFloat(targetEl.value) || 0;
  const glucose = parseFloat(glucoseEl.value) || 0;

  const mealDose = totalCarbs / cr;
  const corrDose = Math.max(0, (glucose - target) / cf);
  const totalDose = Math.round((mealDose + corrDose) * 20) / 20;

  document.getElementById("mealDose").textContent = mealDose.toFixed(2);
  document.getElementById("corrDose").textContent = corrDose.toFixed(2);
  document.getElementById("totalDose").textContent = totalDose.toFixed(2);
}

/* =================== الذكاء الاصطناعي =================== */
async function suggestAI() {
  const prefs = childData || {};
  const ctx = { itemsLibrary: foodLibrary, currentItems: items, prefs };
  const result = await MealAI.suggestAlternatives(ctx);
  alert("اقتراحات:\n\n" + result.text);
}

function fitToRange() {
  const min = parseFloat(carbMinEl.value) || null;
  const max = parseFloat(carbMaxEl.value) || null;
  const total = parseFloat(totalCarbsCell.textContent) || 0;
  items = MealAI.adjustToRange({ items, totalCarbs: total, min, max });
  renderItems();
}

/* =================== الأحداث =================== */
document.getElementById("aiSuggestBtn").addEventListener("click", suggestAI);
document.getElementById("fitToRangeBtn").addEventListener("click", fitToRange);

/* الحفظ */
document.getElementById("saveMealBtn").addEventListener("click", async () => {
  if (!currentChildId || !parentId) return;
  const mealName = document.getElementById("mealName").value || "وجبة بدون اسم";
  const mealRef = doc(collection(db, "parents", parentId, "children", currentChildId, "meals"));
  const snap = {
    name: mealName,
    items,
    createdAt: new Date().toISOString()
  };
  await setDoc(mealRef, snap);
  alert("تم حفظ الوجبة ✅");
});

/* =================== تهيئة =================== */
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    alert("الرجاء تسجيل الدخول");
    return;
  }
  await loadChild();
  await loadFoodLibrary();
});
