// js/meals.js
// ===== Imports =====
import { db, storage } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, getDocs, addDoc, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// ====== Helpers ======
const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => [...p.querySelectorAll(s)];
const fmt = (n, d=1) => Number.isFinite(n) ? (+n).toFixed(d) : "—";
const todayStr = () => new Date().toISOString().slice(0,10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const els = {
  loader: $("#appLoader"),
  btnBack: $("#btnBack"),
  chipCF: $("#chipCF"),
  chipCR: $("#chipCR"),
  chipTargets: $("#chipTargets"),
  slotSelect: $("#slotSelect"),
  dateInput: $("#dateInput"),
  mealTime: $("#mealTime"),
  preBg: $("#preBg"),
  btnFetchPre: $("#btnFetchPre"),
  netCarbRule: $("#netCarbRule"),
  doseCorrection: $("#doseCorrection"),
  doseCarbs: $("#doseCarbs"),
  dayCarbs: $("#dayCarbs"),
  progressBar: $("#progressBar"),
  btnScaleToTarget: $("#btnScaleToTarget"),
  btnClearMeal: $("#btnClearMeal"),
  btnOpenLibrary: $("#btnOpenLibrary"),
  // table
  mealBody: $("#mealBody"),
  sumGL: $("#sumGL"),
  sumGI: $("#sumGI"),
  sumFiber: $("#sumFiber"),
  sumCarbsNet: $("#sumCarbsNet"),
  sumCarbsRaw: $("#sumCarbsRaw"),
  sumCalories: $("#sumCalories"),
  doseFinal: $("#doseFinal"),
  // library
  libModal: $("#libModal"),
  libOverlay: $("#libOverlay"),
  libClose: $("#libClose"),
  searchBox: $("#searchBox"),
  itemsGrid: $("#itemsGrid"),
};

const state = {
  childId: null,
  parentId: null,
  slot: "b",            // b|l|d|s
  date: todayStr(),
  child: null,
  itemsLib: [],         // all food items (subset)
  items: [],            // items in the meal
  rule: "none",         // none|halfFiber|fullFiber
  CF: null,
  CRs: { b:null,l:null,d:null,s:null },
  targets: {
    b:{min:0,max:0}, l:{min:0,max:0}, d:{min:0,max:0}, s:{min:0,max:0}
  }
};

const SLOT_MAP = { b:"BREAKFAST", l:"LUNCH", d:"DINNER", s:"SNACK" };

// ====== UI ======
function showLoader(v){ els.loader.style.display = v ? "flex" : "none"; }

function setChips(){
  const slotKey = state.slot;
  const CR = state.CRs[slotKey] ?? state.child?.carbRatio ?? "—";
  const t = state.targets[slotKey] || {min:"—",max:"—"};
  els.chipCF.textContent = `CF: ${state.CF ?? "—"}`;
  els.chipCR.textContent = `CR: ${CR}`;
  els.chipTargets.textContent = `الهدف: ${t.min}–${t.max} g`;
}

function setBackHref(){
  const qp = new URLSearchParams({ child: state.childId, parentId: state.parentId });
  els.btnBack.href = `child.html?${qp.toString()}`;
}

// ====== Data ======
async function ensureAuth(){
  const auth = getAuth();
  return new Promise((resolve)=>{
    onAuthStateChanged(auth, (u)=> resolve(u), ()=> resolve(null));
  });
}

async function loadChild(){
  const dref = doc(db, "parents", state.parentId, "children", state.childId);
  const snap = await getDoc(dref);
  if (!snap.exists()){
    throw new Error("لم يتم العثور على بيانات الطفل أو ليس لديك صلاحية.");
  }
  state.child = { id: snap.id, ...snap.data() };

  // CF
  state.CF = state.child.correctionFactor ?? null;

  // CR by meal (افتراض: carbRatioByMeal.{breakfast|lunch|dinner|snack})
  const byMeal = state.child.carbRatioByMeal || {};
  state.CRs.b = byMeal.breakfast ?? state.child.carbRatio ?? null;
  state.CRs.l = byMeal.lunch ?? state.child.carbRatio ?? null;
  state.CRs.d = byMeal.dinner ?? state.child.carbRatio ?? null;
  state.CRs.s = byMeal.snack ?? state.child.carbRatio ?? null;

  // targets
  const tg = state.child.carbTargets || {};
  state.targets.b = tg.breakfast || {min:0,max:0};
  state.targets.l = tg.lunch || {min:0,max:0};
  state.targets.d = tg.dinner || {min:0,max:0};
  state.targets.s = tg.snack || {min:0,max:0};

  // net carb rule default
  state.rule = state.child.netCarbRule || "none";

  // day carbs default (قراءة من اليوم + الوجبة لو موجود)
  const tForSlot = state.targets[state.slot];
  els.dayCarbs.value = Number.isFinite(tForSlot?.max) ? tForSlot.max : 0;

  // chips
  setChips();
}

async function fetchPreMeasurement(){
  // PRE_{SLOT}
  const preKey = `PRE_${SLOT_MAP[state.slot]}`;
  const coll = collection(db, "parents", state.parentId, "children", state.childId, "measurements");
  const q = query(
    coll,
    where("date","==", state.date),
    where("slotKey","==", preKey),
    orderBy("when","desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty){
    const m = snap.docs[0].data();
    els.preBg.value = m.value_mmol ?? m.value ?? "";
  } else {
    alert("لا يوجد قياس PRE لليوم/الوجبة المحددة.");
  }
}

// ====== Library ======
async function loadFoodLibrary(){
  const coll = collection(db, "admin", "global", "foodItems");
  const snap = await getDocs(coll);
  state.itemsLib = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderLibrary();
}

function renderLibrary(){
  const term = els.searchBox.value?.trim().toLowerCase() || "";
  const list = term
    ? state.itemsLib.filter(x => (x.name||"").toLowerCase().includes(term) || (x.category||"").toLowerCase().includes(term))
    : state.itemsLib;

  els.itemsGrid.innerHTML = "";
  for (const it of list){
    const card = document.createElement("div");
    card.className = "card-item";

    const t = document.createElement("div");
    t.className = "thumb-wrap";
    const img = document.createElement("img");
    img.alt = it.name || "item";
    // حاول webp ثم jpg/png
    const tryPaths = [
      `food-items/items/${it.id}/main.webp`,
      `food-items/items/${it.id}/main.jpg`,
      `food-items/items/${it.id}/main.png`,
      `food-items/items/${it.id}/1.webp`,
      `food-items/items/${it.id}/1.jpg`,
      `food-items/items/${it.id}/1.png`,
    ];
    (async()=>{
      for (const p of tryPaths){
        try{
          img.src = await getDownloadURL(ref(storage, p));
          break;
        }catch(e){}
      }
    })();
    t.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("div");
    title.textContent = it.name || "صنف";
    title.style.fontWeight = "600";

    const badges = document.createElement("div");
    badges.className = "badges";
    badges.innerHTML = `
      <span class="badge">Carbs: ${fmt(it.carbs_g,1)} g</span>
      <span class="badge">Fiber: ${fmt(it.fiber_g||0,1)} g</span>
      <span class="badge">GI: ${Number.isFinite(it.gi)?it.gi:"—"}</span>
      <span class="badge">kcal: ${fmt(it.cal_kcal||0,0)}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";
    const btnFav = document.createElement("button"); btnFav.className="btn"; btnFav.textContent="⭐ مفضّل";
    const btnUnfav = document.createElement("button"); btnUnfav.className="btn"; btnUnfav.textContent="غير مفضّل";
    const btnAdd = document.createElement("button"); btnAdd.className="btn primary"; btnAdd.textContent="إضافة";
    btnAdd.onclick = ()=> { addItemToMeal(it); };
    actions.append(btnFav, btnUnfav, btnAdd);

    body.append(title, badges, actions);
    card.append(t, body);
    els.itemsGrid.appendChild(card);
  }
}

// ====== Meal items & calculations ======
function computeNet(carbsRaw, fiber, rule){
  const f = rule==="fullFiber"?1 : rule==="halfFiber"?0.5 : 0;
  return Math.max(0, (carbsRaw||0) - (fiber||0)*f);
}

function calcRow(it){
  // assume nutrition per 100g
  const grams = +it.grams || 0;
  const per = Math.max(1, +it.perGram || 100); // info per 100g (fallback)
  const ratio = grams / per;

  const carbsRaw = (it.carbs_g||0) * ratio;
  const fiber = (it.fiber_g||0) * ratio;
  const net = computeNet(carbsRaw, fiber, state.rule);
  const cal = (it.cal_kcal||0) * ratio;

  const GI = Number.isFinite(it.gi) ? it.gi : null;
  const GL = GI ? (GI * net / 100) : 0;

  return { carbsRaw, fiber, net, cal, GI, GL };
}

function renderMeal(){
  els.mealBody.innerHTML = "";
  if (!state.items.length){
    const tr = document.createElement("tr"); tr.className="empty";
    const td = document.createElement("td"); td.colSpan=11; td.style.textAlign="center"; td.style.color="#999"; td.textContent="لا توجد أصناف مضافة.";
    tr.appendChild(td); els.mealBody.appendChild(tr);
  } else {
    for (const it of state.items){
      const c = calcRow(it);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><button class="btn sm gray" data-del>حذف</button></td>
        <td>${fmt(c.GL,1)}</td>
        <td>${Number.isFinite(c.GI)?c.GI:"—"}</td>
        <td>${fmt(c.fiber,1)} g</td>
        <td>${fmt(c.net,1)} g</td>
        <td>${fmt(c.carbsRaw,1)} g</td>
        <td>${fmt(c.cal,0)} kcal</td>
        <td><input type="number" step="1" min="0" value="${it.grams||0}" data-g /></td>
        <td>${it.unitName || "جم"}</td>
        <td>${it.name || "صنف"}</td>
        <td>${it.thumb ? `<img src="${it.thumb}" style="width:46px;height:32px;object-fit:cover;border-radius:6px" />` : "—"}</td>
      `;
      tr.querySelector("[data-g]").addEventListener("input", (e)=>{ it.grams = +e.target.value||0; updateTotals(); });
      tr.querySelector("[data-del]").addEventListener("click", ()=>{ state.items = state.items.filter(x => x!==it); renderMeal(); updateTotals(); });
      els.mealBody.appendChild(tr);
    }
  }
  updateTotals();
}

function updateTotals(){
  let sumRaw=0,sumNet=0,sumFiber=0,sumCal=0,sumGL=0, giVals=[];
  for (const it of state.items){
    const c = calcRow(it);
    sumRaw += c.carbsRaw;
    sumNet += c.net;
    sumFiber += c.fiber;
    sumCal += c.cal;
    sumGL += c.GL;
    if (Number.isFinite(c.GI)) giVals.push(c.GI);
  }
  const avgGI = giVals.length ? Math.round(giVals.reduce((a,b)=>a+b,0)/giVals.length) : "—";
  els.sumCarbsRaw.textContent = `${fmt(sumRaw,1)} g`;
  els.sumCarbsNet.textContent = `${fmt(sumNet,1)} g`;
  els.sumFiber.textContent = `${fmt(sumFiber,1)} g`;
  els.sumCalories.textContent = `${fmt(sumCal,0)} kcal`;
  els.sumGL.textContent = fmt(sumGL,1);
  els.sumGI.textContent = avgGI;

  // doses
  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const bg = parseFloat(els.preBg.value);
  let doseCorr = 0;
  if (Number.isFinite(bg) && Number.isFinite(state.CF) && bg > 10.9){
    doseCorr = Math.max(0, (bg - 7) / state.CF);
  }
  const doseCarb = Number.isFinite(CR) ? (sumNet / CR) : 0;

  // rounding to nearest 0.5U
  const roundStep = 0.5;
  const dc = Math.round(doseCorr / roundStep) * roundStep;
  const dk = Math.round(doseCarb / roundStep) * roundStep;

  els.doseCorrection.value = fmt(dc,1);
  els.doseCarbs.value = fmt(dk,1);
  els.doseFinal.textContent = fmt(dc + dk,1);

  // progress bar vs target
  const t = state.targets[state.slot] || {min:0,max:0};
  const max = t.max || 0;
  const pct = max ? clamp((sumNet / max) * 100, 0, 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.style.background =
    pct <= 100 && sumNet>=t.min ? "var(--ok)" :
    pct <= 120 ? "var(--warn)" : "var(--danger)";
}

function addItemToMeal(fi){
  const it = {
    id: fi.id,
    name: fi.name || "صنف",
    unitName: fi.unitName || "جم",
    perGram: fi.perGram || 100,
    carbs_g: fi.carbs_g || 0,
    fiber_g: fi.fiber_g || 0,
    cal_kcal: fi.cal_kcal || 0,
    gi: Number.isFinite(fi.gi) ? fi.gi : null,
    grams: fi.defaultGrams || 100,
    thumb: null
  };
  // حاول جلب صورة webp مرة واحدة (غير حرج)
  (async()=>{
    const p = `food-items/items/${it.id}/main.webp`;
    try{ it.thumb = await getDownloadURL(ref(storage, p)); renderMeal(); }catch(e){}
  })();

  state.items.push(it);
  renderMeal();
}

// ====== Save / Load ======
async function saveMeal(){
  if (!state.child) return;
  const id = `${state.date}_${state.slot}`;
  const mref = doc(db, "parents", state.parentId, "children", state.childId, "meals", id);

  // build payload
  let sumRaw=0,sumNet=0,sumFiber=0,sumCal=0,sumGL=0, giVals=[];
  const items = state.items.map(it=>{
    const c = calcRow(it);
    sumRaw+=c.carbsRaw; sumNet+=c.net; sumFiber+=c.fiber; sumCal+=c.cal; sumGL+=c.GL;
    if (Number.isFinite(c.GI)) giVals.push(c.GI);
    return {
      itemId: it.id, name: it.name, grams: it.grams||0, unit: it.unitName||"جم",
      per: it.perGram||100, carbs_g: it.carbs_g||0, fiber_g: it.fiber_g||0,
      cal_kcal: it.cal_kcal||0, gi: it.gi ?? null
    };
  });
  const avgGI = giVals.length ? Math.round(giVals.reduce((a,b)=>a+b,0)/giVals.length) : null;

  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const bg = parseFloat(els.preBg.value);
  let doseCorr = 0;
  if (Number.isFinite(bg) && Number.isFinite(state.CF) && bg > 10.9){
    doseCorr = Math.max(0, (bg - 7) / state.CF);
  }
  const doseCarb = Number.isFinite(CR) ? (sumNet / CR) : 0;
  const roundStep = 0.5;
  const dc = Math.round(doseCorr / roundStep) * roundStep;
  const dk = Math.round(doseCarb / roundStep) * roundStep;

  const payload = {
    createdAt: serverTimestamp(),
    date: state.date,
    slot: state.slot,
    slotKey: SLOT_MAP[state.slot],
    rule: state.rule,
    items,
    totals: {
      carbsRaw:+sumRaw.toFixed(1),
      carbsNet:+sumNet.toFixed(1),
      fiber:+sumFiber.toFixed(1),
      calories:Math.round(sumCal),
      GL:+sumGL.toFixed(1),
      GIavg: avgGI
    },
    doses: {
      correction: +dc.toFixed(1),
      carbs: +dk.toFixed(1),
      final: +(dc+dk).toFixed(1),
      CF: state.CF,
      CR: CR
    }
  };

  await setDoc(mref, payload);
  alert("تم حفظ الوجبة بنجاح ✅");
}

// ====== Scale to target ======
function scaleToTarget(){
  const t = state.targets[state.slot] || {min:0,max:0};
  if (!t.max || !state.items.length) return;

  // نضبط لمتوسط النطاق
  const target = (t.min + t.max) / 2;
  // مجموع Net الحالي
  let sumNet = 0;
  for (const it of state.items){ sumNet += calcRow(it).net; }
  if (!sumNet) return;

  const factor = target / sumNet;
  for (const it of state.items){
    it.grams = Math.max(0, Math.round((it.grams||0) * factor));
  }
  renderMeal();
}

// ====== Init & Events ======
async function init(){
  showLoader(true);

  // query params
  const qp = new URLSearchParams(location.search);
  state.childId = qp.get("child") || null;
  state.parentId = qp.get("parentId") || null;
  state.slot = qp.get("slot") || "b";
  state.date = qp.get("date") || todayStr();

  els.slotSelect.value = state.slot;
  els.dateInput.value = state.date;
  els.mealTime.value = (qp.get("time") || "13:00");
  els.netCarbRule.value = state.rule;

  if (!state.childId){
    alert("لا يوجد child في الرابط.");
    showLoader(false);
    return;
  }
  if (!state.parentId){
    alert("يجب تمرير parentId في الرابط طبقًا لقواعد Firestore الحالية.");
    showLoader(false);
    return;
  }

  setBackHref();

  const user = await ensureAuth();
  if (!user){
    alert("يجب تسجيل الدخول للوصول إلى بيانات الطفل.");
    showLoader(false);
    return;
  }
  if (user.uid !== state.parentId){
    // مسموح لو مستخدم دكتور لديه صلاحية — سنترك القراءة للقواعد لتقرر.
    // فقط تنبيه ودي.
    console.warn("تنبيه: uid المسجّل لا يطابق parentId في الرابط. ستُطبّق قواعد الأمان.");
  }

  await loadChild();
  setChips();

  // default rule from child
  els.netCarbRule.value = state.rule;

  // load library (can work without auth)
  await loadFoodLibrary();

  // Events
  els.slotSelect.addEventListener("change", ()=>{
    state.slot = els.slotSelect.value; setChips(); updateTotals();
  });
  els.dateInput.addEventListener("change", ()=>{ state.date = els.dateInput.value; });
  els.mealTime.addEventListener("change", ()=>{ /* reserved for link-to-measurement */ });
  els.btnFetchPre.addEventListener("click", fetchPreMeasurement);
  els.netCarbRule.addEventListener("change", ()=>{ state.rule = els.netCarbRule.value; renderMeal(); });
  els.doseCarbs.addEventListener("input", ()=>{/* manual override allowed */});
  els.doseCorrection.addEventListener("input", ()=>{/* manual override allowed */});
  els.btnClearMeal.addEventListener("click", ()=>{ state.items = []; renderMeal(); });
  els.btnScaleToTarget.addEventListener("click", scaleToTarget);

  $("#btnSaveMeal").addEventListener("click", saveMeal);
  $("#btnSaveTemplate").addEventListener("click", ()=> alert("قريبًا: حفظ كقالب"));
  $("#btnLoadTemplates").addEventListener("click", ()=> alert("قريبًا: استيراد قوالب"));
  $("#btnExportCSV").addEventListener("click", ()=> alert("قريبًا: تصدير CSV"));
  $("#btnPrint").addEventListener("click", ()=> window.print());
  $("#btnSaveFavorites").addEventListener("click", ()=> alert("قريبًا: المفضلة"));

  // library modal
  els.btnOpenLibrary.addEventListener("click", ()=> els.libModal.classList.add("open"));
  els.libOverlay.addEventListener("click", ()=> els.libModal.classList.remove("open"));
  els.libClose.addEventListener("click", ()=> els.libModal.classList.remove("open"));
  els.searchBox.addEventListener("input", renderLibrary);

  renderMeal();
  showLoader(false);
}

init().catch(err=>{
  console.error(err);
  alert(`خطأ في التهيئة: ${err.message}`);
  showLoader(false);
});
