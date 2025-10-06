// ====== 0) Firebase Init ======
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, setDoc, doc, deleteDoc,
  updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, GithubAuthProvider,
  signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// === ضع بيانات مشروعك الصحيح هنا (من Project settings → Web app) ===
<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
    authDomain: "sugar-kids-tracker.firebaseapp.com",
    projectId: "sugar-kids-tracker",
    storageBucket: "sugar-kids-tracker.firebasestorage.app",
    messagingSenderId: "251830888114",
    appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
    measurementId: "G-L7YGX3PHLB"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>

function showBanner(msg){ console.warn(msg); alert(msg); }

let app, db, auth;
try{
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}catch(e){
  showBanner("فشل تهيئة فايربيس: " + e.message);
}

// ====== 1) Elements ======
const cards = document.getElementById("cards");
const onlyActive = document.getElementById("onlyActive");
const catSelect = document.getElementById("catSelect");
const searchBox = document.getElementById("searchBox");
const adminNameEl = document.getElementById("adminName");
const logoutBtn = document.getElementById("logoutBtn");
const addBtn = document.getElementById("addBtn");
const refreshBtn = document.getElementById("refreshBtn");
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");

// dialog fields
const dlg = document.getElementById("itemDialog");
const closeDlg = document.getElementById("closeDlg");
const itemForm = document.getElementById("itemForm");
const nameAr = document.getElementById("nameAr");
const descAr = document.getElementById("descAr");
const imageUrl = document.getElementById("imageUrl");
const category = document.getElementById("category");
const gi = document.getElementById("gi");
const isActive = document.getElementById("isActive");
const cal = document.getElementById("cal");
const carb = document.getElementById("carb");
const prot = document.getElementById("prot");
const fat = document.getElementById("fat");
const fiber = document.getElementById("fiber");
const sodium = document.getElementById("sodium");
const measureName = document.getElementById("measureName");
const measureGrams = document.getElementById("measureGrams");
const tagsInput = document.getElementById("tagsInput");
const dietChips = document.getElementById("dietChips");
const autoChips = document.getElementById("autoChips");
const deleteBtn = document.getElementById("deleteBtn");
const saveBtn = document.getElementById("saveBtn");

// ====== 2) Helpers ======
const COLL = () => db ? collection(db, "admin", "global", "foodItems") : null;
let currentId = null;
let itemsCache = [];

const parseTags = (str) => {
  if(!str) return [];
  return [...new Set(
    str.split(/[\s,،]+/).map(t => t.trim()).filter(Boolean)
  )];
};
const joinTags = (arr) => (arr||[]).join(" ");

function suggestDiet(n){ // thresholds قابلة للتعديل
  const out = [];
  const carb = +n.carb || 0;
  const fat = +n.fat || 0;
  const prot = +n.prot || 0;
  const sod = +n.sodium || 0;

  if(carb <= 5) out.push("كيتو","لو_كارب");
  if(carb <= 20) out.push("لو_كارب");
  if(fat >= 15 && carb <= 10) out.push("كيتو_صحي");
  if(prot >= 20) out.push("هاي_بروتين");
  if(sod <= 140) out.push("قليل_الملح");
  return [...new Set(out)];
}

function chip(label, active=false){
  const el = document.createElement("button");
  el.type = "button";
  el.className = "chip" + (active ? " active":"");
  el.textContent = label;
  el.onclick = ()=> el.classList.toggle("active");
  return el;
}

function buildDietChips(current=[]) {
  dietChips.innerHTML = "";
  ["كيتو","لو_كارب","هاي_بروتين","قليل_الملح"].forEach(d=>{
    dietChips.appendChild(chip(d, current.includes(d)));
  });
}

function buildAutoChips(nutr) {
  autoChips.innerHTML = "";
  suggestDiet(nutr).forEach(d=>{
    autoChips.appendChild(chip(d, true));
  });
}

function collectSelectedChips(container){
  return [...container.querySelectorAll(".chip.active")].map(c => c.textContent.trim());
}

// ====== 3) Auth (عرض اسم الأدمن) ======
if(auth){
  onAuthStateChanged(auth, async (user)=>{
    if(user){
      adminNameEl.textContent = user.displayName || user.email || "admin";
    }else{
      adminNameEl.textContent = "غير مسجل";
      // مسموح نقرأ عموميًا لو القواعد تسمح
    }
  });
}
logoutBtn.onclick = ()=> auth ? signOut(auth) : null;

// ====== 4) Load & Render ======
async function loadItems(){
  const c = COLL();
  if(!c){ showBanner("لم يتم الاتصال بفايربيس. تأكد من firebaseConfig."); return; }

  const q = query(c, orderBy("createdAt","desc"));
  const snap = await getDocs(q);
  itemsCache = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  render();
}

function render(){
  const s = (searchBox.value||"").trim().toLowerCase();
  const cat = (catSelect.value||"").trim();
  const only = onlyActive.checked;

  const list = itemsCache.filter(it=>{
    if(only && it.isActive===false) return false;
    if(cat && it.category !== cat) return false;

    if(s){
      const hay = `${it.nameAr||""} ${it.descAr||""} ${(it.tags||[]).join(" ")} ${(it.dietTags||[]).join(" ")}`.toLowerCase();
      if(!hay.includes(s)) return false;
    }
    return true;
  });

  cards.innerHTML = "";
  for(const it of list){
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `
      <img class="thumb" src="${it.imageUrl||""}" onerror="this.src='https://via.placeholder.com/160x120?text=%20'"/>
      <div class="grow">
        <div class="title">${it.nameAr||"—"}</div>
        <div class="cat">${it.category||""}</div>
        <div class="tags">
          ${(it.tags||[]).map(t=>`<span class="tag">${t}</span>`).join("")}
          ${(it.dietTags||[]).map(t=>`<span class="tag">#${t}</span>`).join("")}
        </div>
      </div>
      <div class="row gap-8">
        <button class="btn danger sm" data-del>حذف</button>
        <button class="btn sm" data-edit>تعديل</button>
      </div>
    `;
    el.querySelector("[data-edit]").onclick = ()=> openEdit(it);
    el.querySelector("[data-del]").onclick = ()=> removeItem(it.id);
    cards.appendChild(el);
  }
}

// ====== 5) Add/Edit ======
function resetForm(){
  currentId = null;
  itemForm.reset();
  isActive.checked = true;
  deleteBtn.hidden = true;
  dietChips.innerHTML = "";
  autoChips.innerHTML = "";
}

function openAdd(){
  resetForm();
  buildDietChips([]);
  buildAutoChips({carb:0,fat:0,prot:0,sodium:0});
  dlg.showModal();
}

function openEdit(it){
  resetForm();
  currentId = it.id;
  nameAr.value = it.nameAr||"";
  descAr.value = it.descAr||"";
  imageUrl.value = it.imageUrl||"";
  category.value = it.category||"";
  gi.value = it.gi||"";
  isActive.checked = it.isActive!==false;

  const n = it.nutrPer100g||{};
  cal.value = n.cal||"";
  carb.value = n.carb||"";
  prot.value = n.prot||"";
  fat.value = n.fat||"";
  fiber.value = n.fiber||"";
  sodium.value = n.sodium||"";

  const m = (it.measures||[])[0]||{};
  measureName.value = m.name||"";
  measureGrams.value = m.grams||"";

  tagsInput.value = joinTags(it.tags||[]);

  buildDietChips(it.dietTags||[]);
  buildAutoChips({carb:carb.value, fat:fat.value, prot:prot.value, sodium:sodium.value});

  deleteBtn.hidden = false;
  dlg.showModal();
}

function gatherPayload(){
  const nutr = {
    cal:+(cal.value||0),
    carb:+(carb.value||0),
    prot:+(prot.value||0),
    fat:+(fat.value||0),
    fiber:+(fiber.value||0),
    sodium:+(sodium.value||0),
  };
  const base = {
    nameAr: nameAr.value.trim(),
    descAr: descAr.value.trim()||null,
    imageUrl: imageUrl.value.trim()||null,
    category: category.value.trim()||null,
    gi: gi.value? +gi.value : null,
    isActive: !!isActive.checked,
    nutrPer100g: nutr,
    measures: measureName.value ? [{ name: measureName.value.trim(), grams: +(measureGrams.value||0) }] : [],
    tags: parseTags(tagsInput.value),
  };
  const manualDiet = collectSelectedChips(dietChips);
  const autoDiet = collectSelectedChips(autoChips);
  base.dietTags = [...new Set([...(base.dietTags||[]), ...manualDiet, ...autoDiet])];
  return base;
}

async function saveItem(){
  const data = gatherPayload();
  if(!data.nameAr){ alert("الاسم العربي مطلوب"); return; }

  const c = COLL(); if(!c){ showBanner("لا يوجد اتصال بفايربيس"); return; }

  if(currentId){
    await updateDoc(doc(c, currentId), {...data, updatedAt: serverTimestamp()});
  }else{
    await addDoc(c, {...data, createdAt: serverTimestamp()});
  }
  dlg.close();
  loadItems();
}

async function removeItem(id){
  if(!confirm("حذف الصنف؟")) return;
  const c = COLL(); if(!c){ showBanner("لا يوجد اتصال بفايربيس"); return; }
  await deleteDoc(doc(c, id));
  loadItems();
}

// ====== 6) Excel Export/Import ======
// Export
exportBtn.onclick = async ()=>{
  const rows = itemsCache.map(it=>({
    id: it.id,
    nameAr: it.nameAr||"",
    descAr: it.descAr||"",
    category: it.category||"",
    imageUrl: it.imageUrl||"",
    gi: it.gi||"",
    isActive: it.isActive!==false ? 1 : 0,
    cal: it.nutrPer100g?.cal||"",
    carb: it.nutrPer100g?.carb||"",
    prot: it.nutrPer100g?.prot||"",
    fat: it.nutrPer100g?.fat||"",
    fiber: it.nutrPer100g?.fiber||"",
    sodium: it.nutrPer100g?.sodium||"",
    measureName: it.measures?.[0]?.name||"",
    measureGrams: it.measures?.[0]?.grams||"",
    tags: (it.tags||[]).join(" "),
    dietTags: (it.dietTags||[]).join(" "),
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "foodItems");
  XLSX.writeFile(wb, "foodItems.xlsx");
};

// Import
importFile.onchange = async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  const c = COLL(); if(!c){ showBanner("لا يوجد اتصال بفايربيس"); return; }

  for(const r of rows){
    const payload = {
      nameAr: r.nameAr||"",
      descAr: r.descAr||"",
      category: r.category||"",
      imageUrl: r.imageUrl||"",
      gi: r.gi? +r.gi : null,
      isActive: r.isActive? !!r.isActive : true,
      nutrPer100g: {
        cal: +r.cal||0, carb:+r.carb||0, prot:+r.prot||0, fat:+r.fat||0, fiber:+r.fiber||0, sodium:+r.sodium||0
      },
      measures: r.measureName ? [{name:r.measureName, grams:+(r.measureGrams||0)}] : [],
      tags: parseTags(r.tags||""),
      dietTags: parseTags(r.dietTags||""),
      createdAt: serverTimestamp()
    };
    if(r.id){ // update-or-set
      await setDoc(doc(c, r.id), payload, { merge:true });
    }else{
      await addDoc(c, payload);
    }
  }
  alert("تم الاستيراد.");
  loadItems();
};

// ====== 7) Events ======
addBtn.onclick = openAdd;
closeDlg.onclick = ()=> dlg.close();
saveBtn.onclick = (e)=>{ e.preventDefault(); saveItem(); };
deleteBtn.onclick = async ()=> { if(currentId) await removeItem(currentId); };

[onlyActive, catSelect, searchBox].forEach(el => el.addEventListener("input", render));
[carb, fat, prot, sodium].forEach(el => el.addEventListener("input", ()=>{
  buildAutoChips({carb:carb.value, fat:fat.value, prot:prot.value, sodium:sodium.value});
}));

refreshBtn.onclick = loadItems;

// ====== 8) Start ======
loadItems();
