// ===== meals.js كامل =====

import { getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { PUBLIC_FOOD } from "./firebase.js";
import { calcServingFrom100g, scoreHealth, scoreFit, formatMacroLine } from "./nutrition-utils.js";
import { isAllowedForProfile, dietBoostForProfile } from "./diet-rules.js";

let foodCache = [];
let childDietProfile = { dietaryFlags:[], allergies:[], preferred:[], disliked:[] };

const $ = (sel, root=document)=> root.querySelector(sel);

function esc(str){return String(str||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}

// مثال: تحميل بيانات الطفل من localStorage أو Firestore
async function loadChildProfile(){
  const data = JSON.parse(localStorage.getItem("childProfile")||"{}");
  childDietProfile = {
    dietaryFlags: data.dietaryFlags||[],
    allergies: data.allergies||[],
    preferred: data.preferred||[],
    disliked: data.disliked||[]
  };
}
await loadChildProfile();

// ===== جلب الأصناف =====
async function ensureFoodCache(){
  if(foodCache.length) return;
  let snap;
  try { snap = await getDocs(query(PUBLIC_FOOD(), orderBy("name"))); }
  catch { snap = await getDocs(PUBLIC_FOOD()); }
  const raw=[]; snap.forEach(s=> raw.push(mapFood(s)));

  // فلترة
  const filtered = raw.filter(f=> isAllowedForProfile(f, childDietProfile));

  // ترتيب
  filtered.sort((a,b)=>{
    const ba = dietBoostForProfile(a, childDietProfile);
    const bb = dietBoostForProfile(b, childDietProfile);
    return bb - ba;
  });

  foodCache = filtered;
}

// تحويل snapshot -> object
function mapFood(snap){
  const d = snap.data();
  return {
    id: snap.id,
    name: d.name,
    brand: d.brand,
    tags: d.tags||[],
    category: d.category||"",
    nutrPer100g: d.nutrPer100g||{},
    measures: d.measures||[],
    imageUrl: d.imageUrl||""
  };
}

// ===== بناء الجدول =====
async function renderItems(){
  await ensureFoodCache();
  const tbody = $("#mealsBody");
  tbody.innerHTML = "";
  for(const r of foodCache.slice(0,10)){ // مؤقت: أول 10 أصناف
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        ${esc(r.name)} ${r.brand?`<span class="muted tiny">(${esc(r.brand)})</span>`:""}
        <button class="tiny-alt" data-id="${esc(r.id)}">بدائل</button>
      </td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td><button>إزالة</button></td>
    `;
    tbody.appendChild(tr);

    tr.querySelector(".tiny-alt")?.addEventListener("click", ()=> openAlternatives(r));
  }
}
renderItems();

// ===== المودال =====
const altModal = $("#altModal");
const altList  = $("#altList");
const altEmpty = $("#altEmpty");
const altClose = $("#altClose");

altClose?.addEventListener("click", ()=> closeAlt());
altModal?.addEventListener("click", (e)=>{ if(e.target===altModal) closeAlt(); });

function closeAlt(){ altModal.classList.add("hidden"); document.body.style.overflow=""; }

function openAlternatives(base){
  const sameCat = foodCache.filter(f=> f.id!==base.id && f.category && f.category===base.category);
  const pool = (sameCat.length? sameCat : foodCache).slice(0);

  const candidates = pool.map(f=>{
    const grams = (f.measures[0]?.grams)||100;
    const serv  = calcServingFrom100g(f.nutrPer100g, grams);
    const h = scoreHealth(serv, f);
    const fit = scoreFit(serv, {});
    const boost = dietBoostForProfile(f, childDietProfile);
    const final = 0.7*h + 0.3*fit + boost;
    return { f, grams, serv, final };
  });

  candidates.sort((a,b)=> b.final - a.final);
  const top = candidates.slice(0,6);

  altList.innerHTML = top.map(c=>{
    return `
      <button class="pick">
        <img src="${esc(c.f.imageUrl)}" alt="">
        <div class="t">
          <div class="n">${esc(c.f.name)}</div>
          <div class="meta">${formatMacroLine(c.serv)}</div>
        </div>
      </button>
    `;
  }).join("");
  altEmpty.classList.toggle("hidden", top.length>0);

  altModal.classList.remove("hidden");
  document.body.style.overflow="hidden";
}
