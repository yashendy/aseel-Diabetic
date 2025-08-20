// js/food-items.js
import { auth, db } from './firebase-config.js';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
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
    return;
  }
  grid.innerHTML = items.map(it =>
    `<div class="card">
       <img src="${it.imageUrl || ''}" alt="" class="thumb" />
       <div><strong>${it.name}</strong></div>
       <div>كارب: ${it.carbs_100g}g • سعرات: ${it.calories_100g}</div>
     </div>`
  ).join('');
}

// UI Bindings...
$("btnAdd").onclick = () => { UNITS=[]; renderUnits(); $("itemForm").reset(); openDrawer(); };
$("btnClose").onclick = closeDrawer;
$("btnCancel").onclick = closeDrawer;
$("btnAddUnit").onclick = () => {
  const n = $("uName").value.trim(), g = +$("uGrams").value;
  if (!n || !g) return alert('أكمل البيانات'); UNITS.push({ name:n, grams:g }); renderUnits(); $("uName").value=''; $("uGrams").value='';
};
function renderUnits() {
  $("unitsList").innerHTML = UNITS.map((u,i)=>`<span class="unit">${u.name} = ${u.grams}g <span class="x" data-i="${i}">✖</span></span>`).join('') ||
    '<div class="meta">لا توجد مقادير</div>';
  $("unitsList").querySelectorAll('.x').forEach(el=>el.onclick=()=>{UNITS.splice(el.dataset.i,1); renderUnits();});
}

$("btnAutoImage").onclick = () => {
  const name = $("name").value.trim();
  if (!name) return alert('اكتب اسم الصنف أولاً');
  const hue = Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
  const bg = `hsl(${hue} 80% 90%)`, fg = `hsl(${hue} 60% 40%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="140" fill="${fg}">${name[0]||''}</text></svg>`;
  $("imageUrl").value = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
};

$("itemForm").onsubmit = async e => {
  e.preventDefault();
  const name = $("name").value.trim(), category = $("category").value;
  const carbs = +$("carb100").value, kcal = +$("kcal100").value || Math.round(4*carbs);
  const tags = $("tags").value.split(',').map(t=>t.trim()).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t);
  if (carbs >= 60) tags.push('#كارب_عالي');
  const payload = { name, category, carbs_100g:carbs, calories_100g:kcal, householdUnits:UNITS, tags, imageUrl: $("imageUrl").value.trim()||null, createdAt: serverTimestamp() };
  await addDoc(collection(db, `parents/${USER.uid}/foodItems`), payload);
  closeDrawer();
  loadItems();
};

function openDrawer(){ $("drawer").classList.add('open'); }
function closeDrawer(){ $("drawer").classList.remove('open'); }
