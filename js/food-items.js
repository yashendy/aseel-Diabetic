// js/food-items.js
import { auth, db, storage } from './firebase-config.js';
import {
  collection, addDoc, getDocs, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = id => document.getElementById(id);
let USER = null, UNITS = [];

onAuthStateChanged(auth, async user => {
  if (!user) return location.href='index.html';
  USER = user;
  await loadItems();
});

async function loadItems() {
  const snap = await getDocs(query(collection(db, `parents/${USER.uid}/foodItems`), orderBy('name')));
  renderGrid(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

function renderGrid(items) {
  const grid = $("grid");
  if (!items.length) {
    grid.innerHTML = `<div class="meta">لا توجد أصناف</div>`;
  } else {
    grid.innerHTML = items.map(it =>
      `<div class="card">
         <img src="${it.imageUrl||''}" alt="" class="thumb"/>
         <div><strong>${it.name}</strong></div>
         <div>كارب: ${it.carbs_100g}g • بروتين: ${it.protein_100g||0}g • دهون: ${it.fat_100g||0}g • سعرات: ${it.calories_100g}</div>
       </div>`
    ).join('');
  }
}

// UI handlers
$("btnAdd").onclick = () => { UNITS=[]; renderUnits(); $("itemForm").reset(); openDrawer(); };
$("btnClose").onclick = closeDrawer;
$("btnCancel").onclick = closeDrawer;
$("btnAddUnit").onclick = () => {
  const name = $("uName").value.trim(), g = parseFloat($("uGrams").value);
  if (!name || !g) return alert('أكمل البيانات');
  UNITS.push({ name, grams: g }); renderUnits();
  $("uName").value = ''; $("uGrams").value = '';
};
function renderUnits(){
  const html = UNITS.map((u,i) => `<span class="unit">${u.name} = ${u.grams}g <span class="x" data-i="${i}">✖</span></span>`).join('');
  $("unitsList").innerHTML = html || '<div class="meta">لا توجد مقادير</div>';
  $("unitsList").querySelectorAll(".x").forEach(el => el.onclick = () => { UNITS.splice(el.dataset.i,1); renderUnits(); });
}

$("itemForm").onsubmit = async e => {
  e.preventDefault();
  const name = $("name").value.trim(), category = $("category").value;
  let carbs = parseFloat($("carb100").value), prot = parseFloat($("prot100").value)||0, fat = parseFloat($("fat100").value)||0;
  let kcal = parseInt($("kcal100").value);
  const tags = $("tags").value.split(',').map(t=>t.trim()).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t);
  if (!kcal) kcal = Math.round(4*carbs + 4*prot + 9*fat);
  if (carbs>=60) tags.push('#كارب_عالي');
  const uniqueTags = [...new Set(tags)];
  const payload = { name, category, carbs_100g: carbs, protein_100g: prot, fat_100g: fat, calories_100g: kcal, householdUnits: UNITS, tags: uniqueTags, createdAt: serverTimestamp() };

  // Upload image if file selected
  const file = $("imageFile").files[0];
  if (file) {
    const storageRef = ref(storage, `images/${USER.uid}/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    payload.imageUrl = await getDownloadURL(storageRef);
  } else if ($("imageUrl").value) {
    payload.imageUrl = $("imageUrl").value.trim();
  }

  // Barcode import handler
  const code = $("offBarcode").value.trim();
  if (code) {
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
      const j = await r.json();
      if (j.product?.nutriments) {
        payload.carbs_100g ||= j.product.nutriments.carbohydrates_100g || payload.carbs_100g;
        payload.protein_100g ||= j.product.nutriments.proteins_100g || payload.protein_100g;
        payload.fat_100g ||= j.product.nutriments.fat_100g || payload.fat_100g;
        payload.imageUrl ||= j.product.image_url;
        payload.name ||= j.product.product_name;
      }
    } catch {}
  }

  await addDoc(collection(db, `parents/${USER.uid}/foodItems`), payload);
  closeDrawer();
  loadItems();
};

function openDrawer(){ $("drawer").classList.add('open'); }
function closeDrawer(){ $("drawer").classList.remove('open'); }
