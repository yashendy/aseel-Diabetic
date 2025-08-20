// js/food-items.js
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, doc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = id => document.getElementById(id);
let USER = null, UNITS = [];

onAuthStateChanged(auth, user => {
  if (!user) location.href = 'index.html';
  else USER = user;
  loadItems();
});

async function loadItems() {
  const ref = collection(db, `parents/${USER.uid}/foodItems`);
  const snap = await getDocs(query(ref, orderBy('name')));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderGrid(items);
}

function renderGrid(items) {
  const grid = $("grid");
  grid.innerHTML = items.map(it => `
    <div class="card">
      <div>${it.name}</div>
      <div>كارب: ${it.carbs_100g}g | بروتين: ${it.protein_100g || 0}g | دهون: ${it.fat_100g || 0}g | سعرات: ${it.calories_100g}</div>
    </div>
  `).join('') || '<div class="meta">لا توجد أصناف</div>';
}

$("btnAdd").onclick = () => {
  $("formTitle").textContent = "إضافة صنف";
  $("itemForm").reset();
  UNITS = [];
  renderUnits();
  openDrawer();
};

$("btnClose").onclick = closeDrawer;
$("btnCancel").onclick = closeDrawer;

function openDrawer() {
  $("drawer").classList.add('open');
}
function closeDrawer() {
  $("drawer").classList.remove('open');
}

$("btnAddUnit").onclick = () => {
  const name = $("uName").value.trim();
  const g = parseFloat($("uGrams").value);
  if (!name || !g) return alert("أكمل اسم المقدار والجرام");
  UNITS.push({ name, grams: g });
  renderUnits();
  $("uName").value = ""; $("uGrams").value = "";
};

function renderUnits() {
  const list = $("unitsList");
  list.innerHTML = UNITS.map((u,i) => `<span class="unit">${u.name} = ${u.grams}g <span class="x" data-i="${i}">✖</span></span>`).join('') || '<div class="meta">لا توجد مقادير</div>';
  list.querySelectorAll(".x").forEach(el => {
    el.onclick = () => {
      UNITS.splice(el.dataset.i,1);
      renderUnits();
    };
  });
}

$("itemForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("name").value.trim();
  const category = $("category").value;
  const carbs = parseFloat($("carb100").value);
  let prot = parseFloat($("prot100").value) || 0;
  let fat = parseFloat($("fat100").value) || 0;
  let kcal = parseInt($("kcal100").value);
  const tags = $("tags").value.split(',').map(t => t.trim()).filter(Boolean).map(t => t.startsWith('#') ? t : '#'+t);

  if (!kcal) kcal = Math.round(carbs*4 + prot*4 + fat*9);
  tags.push(
    carbs >= 60 ? '#كارب_عالي' : '',
    prot >= 20 ? '#بروتين_عالي' : '',
    fat >= 20 ? '#دهون_عالية' : ''
  );
  const uniqueTags = [...new Set(tags)].filter(t => t);

  const payload = {
    name, category, carbs_100g: carbs, protein_100g: prot,
    fat_100g: fat, calories_100g: kcal, householdUnits: UNITS,
    tags: uniqueTags, createdAt: serverTimestamp()
  };

  await addDoc(collection(db, `parents/${USER.uid}/foodItems`), payload);
  closeDrawer();
  loadItems();
};
