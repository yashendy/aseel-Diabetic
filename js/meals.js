// js/meals.js (Module, Firebase v12)
import { app, auth, db, storage } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, addDoc,
  collection, query, where, orderBy, limit, getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* ====== Helpers ====== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pad = n => n.toString().padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};
const roundTo = (v, step=0.5) => Math.round(v/step)*step;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const byId = id => document.getElementById(id);

const SLOT_KEYS = { breakfast:"BREAKFAST", lunch:"LUNCH", dinner:"DINNER", snack:"SNACK" };
const PRE_SLOT = k => `PRE_${SLOT_KEYS[k]}`;
const SHORT_TO_SLOT = { b:"breakfast", l:"lunch", d:"dinner", s:"snack" };

const els = {
  loader: byId("appLoader"),
  chipCF: byId("chipCF"), chipCR: byId("chipCR"), chipTargets: byId("chipTargets"),
  childName: byId("childName"),
  slot: byId("slotSelect"), date: byId("dateInput"), time: byId("mealTime"),
  preBg: byId("preBg"), btnFetchPre: byId("btnFetchPre"),
  netRule: byId("netCarbRule"),
  doseCorr: byId("doseCorrection"), doseCarb: byId("doseCarbs"), doseFinal: byId("doseFinal"),
  dayCarbs: byId("dayCarbs"), bar: byId("progressBar"),
  table: byId("mealTable").querySelector("tbody"),
  sumGL: byId("sumGL"), sumGI: byId("sumGI"), sumCalories: byId("sumCalories"),
  sumCarbsNet: byId("sumCarbsNet"), sumFiber: byId("sumFiber"), sumCarbsRaw: byId("sumCarbsRaw"),
  btnScale: byId("btnScaleToTarget"), btnClear: byId("btnClearMeal"),
  btnSave: byId("btnSaveMeal"), btnSaveTemplate: byId("btnSaveTemplate"),
  btnLoadTemplates: byId("btnLoadTemplates"), btnCSV: byId("btnExportCSV"), btnPrint: byId("btnPrint"),
  // library
  lib: byId("libModal"), libOverlay: byId("libOverlay"), libClose: byId("libClose"),
  search: byId("searchBox"), grid: byId("itemsGrid"), libCount: byId("libCount"),
  btnOpen: byId("btnOpenLibrary"),
};

const state = {
  parentId: null, childId: null, child: null,
  slot: "lunch",
  targets: { min: 0, max: 0 },
  cf: null, cr: null, crByMeal: {},
  netRule: "none",
  items: [] // {id,name,unit:"g",qty,carbs,fiber,calories,gi,imageUrl}
};

function showLoader(v){ els.loader.classList.toggle("hide", !v); }

/* ====== URL Params ====== */
function readParams(){
  const u = new URL(location.href);
  const p = Object.fromEntries(u.searchParams.entries());
  state.childId = p.child || null;
  state.parentId = p.parentId || null;
  let slot = p.slot || "l";
  slot = slot.toLowerCase();
  state.slot = SHORT_TO_SLOT[slot] || slot || "lunch";
  els.slot.value = state.slot;
  els.date.value = p.date || todayStr();
  els.time.value = p.time || "13:00";
}

/* ====== Library (Food Items) ====== */
async function loadFoodItems(){
  els.grid.innerHTML = `<div class="badge">تحميل...</div>`;
  const qs = query(collection(db, "admin", "global", "foodItems"), orderBy("createdAt","desc"));
  const snap = await getDocs(qs);
  const items = [];
  snap.forEach(d => items.push({ id:d.id, ...d.data() }));
  renderLibrary(items);
}

function filterLibrary(list, q){
  q = (q||"").trim().toLowerCase();
  if(!q) return list;
  return list.filter(it => (it.name||"").toLowerCase().includes(q)
    || (it.category||"").toLowerCase().includes(q));
}

async function imageFor(itemId){
  const trials = [
    `food-items/items/${itemId}/main.webp`,
    `food-items/items/${itemId}/main.jpg`,
    `food-items/items/${itemId}/main.png`,
    `food-items/items/${itemId}/1.webp`,
    `food-items/items/${itemId}/1.jpg`,
    `food-items/items/${itemId}/1.png`,
  ];
  for(const p of trials){
    try { return await getDownloadURL(ref(storage, p)); } catch(e){ /* try next */ }
  }
  return null;
}

function cardTemplate(it, imgUrl){
  const gi = (typeof it.gi === "number") ? it.gi : null;
  const carbs = Number(it.carbs_g||0), cal = Number(it.cal_kcal||0), fiber = Number(it.fiber_g||0);
  return `
    <div class="card-item" data-id="${it.id}">
      <div class="thumb-wrap">${imgUrl?`<img src="${imgUrl}" alt="">`:`<div class="badge">لا صورة</div>`}</div>
      <div class="card-body">
        <h4 class="card-title">${it.name||"صنف"}</h4>
        <div class="meta">
          <span class="badge">${it.category||"—"}</span>
          <span class="badge">Carbs: ${carbs}g</span>
          <span class="badge">Fiber: ${fiber}g</span>
          <span class="badge">Cal: ${cal}</span>
          <span class="badge ${gi==null?"":"badge--warn"}">GI: ${gi==null?"—":gi}</span>
        </div>
        <div class="actions">
          <button class="btn btn--primary" data-add>إضافة</button>
        </div>
      </div>
    </div>`;
}

async function renderLibrary(all){
  const filtered = filterLibrary(all, els.search.value);
  els.libCount.textContent = filtered.length;
  const chunks = await Promise.all(filtered.map(async it => {
    const url = await imageFor(it.id);
    return cardTemplate(it, url);
  }));
  els.grid.innerHTML = chunks.join("") || `<div class="badge badge--warn">لا نتائج</div>`;

  // add handlers
  els.grid.querySelectorAll("[data-add]").forEach(btn=>{
    btn.addEventListener("click", e=>{
      const card = e.target.closest(".card-item"); const id = card.dataset.id;
      const it = filtered.find(x=>x.id===id);
      addItemToMeal(it);
    });
  });
}

/* ====== Meal Table ====== */
function addItemToMeal(it){
  const row = document.createElement("tr");
  const qty = 100; // افتراضي 100جم
  const item = {
    id: it.id, name: it.name||"صنف",
    unit: "g", qty,
    carbs: Number(it.carbs_g||0),
    fiber: Number(it.fiber_g||0),
    calories: Number(it.cal_kcal||0),
    gi: (typeof it.gi === "number") ? it.gi : null
  };
  row.dataset.id = item.id;
  row.innerHTML = `
    <td><button class="btn" data-del>حذف</button></td>
    <td data-gl>0</td>
    <td data-gi>${item.gi==null?"—":item.gi}</td>
    <td data-fiber>0 g</td>
    <td data-net>0 g</td>
    <td data-cal>0 kcal</td>
    <td data-raw>0 g</td>
    <td><input data-qty type="number" step="1" value="${qty}" style="width:80px"></td>
    <td>${item.unit}</td>
    <td>${item.name}</td>
    <td>—</td>
  `;
  els.table.appendChild(row);
  row.querySelector("[data-del]").addEventListener("click", ()=>{ row.remove(); recalcAll(); });
  row.querySelector("[data-qty]").addEventListener("input", ()=>{ recalcRow(row, item); recalcAll(); });
  recalcRow(row, item);
  recalcAll();
}

function netFrom(raw, fiber, rule){
  if(rule==="fullFiber") return Math.max(0, raw - fiber);
  if(rule==="halfFiber")  return Math.max(0, raw - fiber*0.5);
  return raw; // none
}

function recalcRow(row, item){
  const qty = Number(row.querySelector("[data-qty]").value||0);
  const f = qty/100;
  const raw = item.carbs * f;
  const fiber = item.fiber * f;
  const net = netFrom(raw, fiber, els.netRule.value);
  const cal = item.calories * f;
  const gi = item.gi;

  // GL = (GI * netCarbs) / 100
  const gl = (gi==null) ? 0 : (gi * net) / 100;

  row.querySelector("[data-raw]").textContent   = `${raw.toFixed(1)} g`;
  row.querySelector("[data-fiber]").textContent = `${fiber.toFixed(1)} g`;
  row.querySelector("[data-net]").textContent   = `${net.toFixed(1)} g`;
  row.querySelector("[data-cal]").textContent   = `${cal.toFixed(0)} kcal`;
  row.querySelector("[data-gl]").textContent    = `${gl.toFixed(1)}`;
  row.querySelector("[data-gi]").textContent    = (gi==null?"—":gi);
}

function recalcAll(){
  let sumRaw=0, sumFiber=0, sumNet=0, sumCal=0, sumGL=0, giVals=[];
  els.table.querySelectorAll("tr").forEach(tr=>{
    const raw = Number((tr.querySelector("[data-raw]").textContent||"0").replace(/[^\d.]/g,""))||0;
    const fiber = Number((tr.querySelector("[data-fiber]").textContent||"0").replace(/[^\d.]/g,""))||0;
    const net = Number((tr.querySelector("[data-net]").textContent||"0").replace(/[^\d.]/g,""))||0;
    const cal = Number((tr.querySelector("[data-cal]").textContent||"0").replace(/[^\d.]/g,""))||0;
    const gl  = Number(tr.querySelector("[data-gl]").textContent||"0")||0;
    const giTxt = tr.querySelector("[data-gi]").textContent;
    const gi = giTxt==="—"?null:Number(giTxt);
    sumRaw+=raw; sumFiber+=fiber; sumNet+=net; sumCal+=cal; sumGL+=gl; if(gi!=null) giVals.push(gi);
  });
  els.sumCarbsRaw.textContent = `${sumRaw.toFixed(1)} g`;
  els.sumFiber.textContent    = `${sumFiber.toFixed(1)} g`;
  els.sumCarbsNet.textContent = `${sumNet.toFixed(1)} g`;
  els.sumCalories.textContent = `${sumCal.toFixed(0)} kcal`;
  els.sumGL.textContent       = sumGL.toFixed(1);
  els.sumGI.textContent       = giVals.length? (giVals.reduce((a,b)=>a+b,0)/giVals.length).toFixed(0) : "—";

  // جرعة الكارب = Net / CR
  const cr = state.cr || 1;
  const doseCarb = sumNet>0 ? (sumNet / cr) : 0;
  els.doseCarb.value = (Number.isFinite(doseCarb) ? roundTo(doseCarb, 0.5) : 0).toFixed(1);

  updateProgress(sumNet);
  updateFinalDose();
}

function updateProgress(sumNet){
  const min = Number(state.targets.min||0), max = Number(state.targets.max||0);
  if(!max){ els.bar.style.width="0%"; return; }
  const pct = clamp(sumNet / max * 100, 0, 100);
  els.bar.style.width = `${pct}%`;
}

function updateFinalDose(){
  const c = Number(els.doseCorr.value||0);
  const k = Number(els.doseCarb.value||0);
  const final = (c + k);
  els.doseFinal.textContent = (Number.isFinite(final)? final.toFixed(1) : "—");
}

/* ====== Measurements / Correction ====== */
function computeCorrection(){
  const bg = Number(els.preBg.value||0);
  if(!(bg>10.9) || !state.cf){ els.doseCorr.value = "0.0"; updateFinalDose(); return; }
  const dose = (bg - 7) / state.cf; // mmol/L
  els.doseCorr.value = roundTo(Math.max(0,dose), 0.5).toFixed(1);
  updateFinalDose();
}

async function fetchPreMeasurement(){
  const date = els.date.value;
  const slot = state.slot;
  const coll = collection(db, "
