// /js/meals.js
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, orderBy, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// globals from meals.html
const db = window._db;
const st = window._st;

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n, d = 1) => (n ?? 0).toFixed(d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const roundTo = (v, step = 0.5) => Math.round(v / step) * step;
const todayUTC3 = () => {
  const d = new Date();
  // force UTC+3
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (3 * 3600 * 1000));
};
const ymd = (d) => d.toISOString().slice(0, 10);
const parseQuery = () =>
  Object.fromEntries(new URLSearchParams(location.search).entries());

const slotMap = {
  b: { ar: "فطار", defaultTime: "08:00" },
  l: { ar: "غداء", defaultTime: "13:00" },
  d: { ar: "عشاء", defaultTime: "19:00" },
  s: { ar: "سناك", defaultTime: "16:30" }
};

// ---------- state ----------
let parentId, childId, slotKey, dateKey, mealTimeStr;
let childDoc, cf, crMap, targets, carbRanges, netRuleDefault;
let favorites = [], disliked = [];
let library = [];  // food items library (subset after search)
let libraryAll = []; // full lib
let mealItems = []; // {id, name, unitKey, unitLabel, gramsPerUnit, qty, grams, carbs_raw, fiber_g, cal_kcal, gi, gl, imageUrl}

// ---------- UI refs ----------
const els = {
  childName: $("#childName"),
  chipCF: $("#chipCF"),
  chipCR: $("#chipCR"),
  chipTargets: $("#chipTargets"),
  dateInput: $("#dateInput"),
  slotSelect: $("#slotSelect"),
  mealTime: $("#mealTime"),
  preBg: $("#preBg"),
  btnFetchPre: $("#btnFetchPre"),
  doseCorrection: $("#doseCorrection"),
  netCarbRule: $("#netCarbRule"),
  doseCarbs: $("#doseCarbs"),
  doseTotal: $("#doseTotal"),
  dayCarbs: $("#dayCarbs"),
  itemsGrid: $("#itemsGrid"),
  itemsCount: $("#itemsCount"),
  mealBody: $("#mealBody"),
  progressBar: $("#progressBar"),
  progressLabel: $("#progressLabel"),
  btnScaleToTarget: $("#btnScaleToTarget"),
  btnClearMeal: $("#btnClearMeal"),
  btnSaveMeal: $("#btnSaveMeal"),
  btnSaveTemplate: $("#btnSaveTemplate"),
  btnLoadTemplates: $("#btnLoadTemplates"),
  btnExportCSV: $("#btnExportCSV"),
  btnPrint: $("#btnPrint"),
  btnSaveFavorites: $("#btnSaveFavorites"),
  searchBox: $("#searchBox"),
  sumCarbsRaw: $("#sumCarbsRaw"),
  sumFiber: $("#sumFiber"),
  sumCarbsNet: $("#sumCarbsNet"),
  sumCal: $("#sumCal"),
  sumGI: $("#sumGI"),
  sumGL: $("#sumGL"),
  backToChild: $("#backToChild"),
};

// ---------- init ----------
init().catch(console.error);

async function init() {
  const q = parseQuery();
  parentId = q.parentId;
  childId = q.childId;
  slotKey = (q.slot || "l").toLowerCase();
  dateKey = q.date || ymd(todayUTC3());
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";

  els.dateInput.value = dateKey;
  els.slotSelect.value = slotKey;
  els.mealTime.value = mealTimeStr;

  if (!parentId || !childId) {
    alert("يجب تمرير parentId و childId في الرابط.");
    return;
  }
  els.backToChild.href = `child.html?child=${childId}`;

  await loadChild();
  await loadLibrary();   // food items
  await loadDayTotals(); // existing meals of the same date
  await tryLoadExistingMeal(); // if there is already a meal for that date/slot
  autoCompute();

  // events
  els.slotSelect.addEventListener("change", onSlotChange);
  els.dateInput.addEventListener("change", onDateChange);
  els.mealTime.addEventListener("change", () => mealTimeStr = els.mealTime.value);
  els.searchBox.addEventListener("input", renderLibrary);
  els.btnFetchPre.addEventListener("click", fetchPreReading);
  els.doseCorrection.addEventListener("input", autoCompute);
  els.netCarbRule.addEventListener("change", autoCompute);
  els.doseCarbs.addEventListener("input", updateDoseTotal);
  els.btnScaleToTarget.addEventListener("click", scaleToTarget);
  els.btnClearMeal.addEventListener("click", () => { mealItems = []; renderMeal(); });
  els.btnSaveMeal.addEventListener("click", saveMeal);
  els.btnSaveTemplate.addEventListener("click", saveTemplate);
  els.btnLoadTemplates.addEventListener("click", importFromTemplates);
  els.btnExportCSV.addEventListener("click", exportCSV);
  els.btnPrint.addEventListener("click", () => window.print());
  els.btnSaveFavorites.addEventListener("click", saveFavs);
}

async function loadChild() {
  const ref = doc(db, `parents/${parentId}/children/${childId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Child not found");
  childDoc = snap.data();

  els.childName.textContent = childDoc.name || "—";

  cf = Number(childDoc.correctionFactor ?? 0);
  crMap = childDoc.carbRatioByMeal || {};
  targets = childDoc.normalRange || { max: 7, severeHigh: 10.9, severeLow: 3.9 };
  carbRanges = childDoc.carbTargets || {};
  netRuleDefault = childDoc.netCarbRule || "fullFiber";
  favorites = Array.isArray(childDoc.favorites) ? childDoc.favorites : [];
  disliked = Array.isArray(childDoc.disliked) ? childDoc.disliked : [];

  els.netCarbRule.value = netRuleDefault;

  els.chipCF.textContent = `CF ${cf || "—"} mmol/L per U`;
  els.chipTargets.textContent = `الهدف ${targets.max ?? 7} | تصحيح من ${targets.severeHigh ?? 10.9}`;

  updateCRChip();
}

function updateCRChip() {
  const ar = slotMap[slotKey]?.ar || "";
  const cr = crForSlot(slotKey);
  els.chipCR.textContent = `CR(${ar}) ${cr ?? "—"} g/U`;
}

function crForSlot(s) {
  const fallback = Number(childDoc.carbRatio ?? 0) || undefined;
  const mapKey = s; // b,l,d,s
  return Number(crMap?.[mapKey]) || fallback;
}

async function loadDayTotals() {
  // Optionally aggregate day carbs from meals of the same day:
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const q = query(mealsRef, where("date", "==", dateKey));
  const snaps = await getDocs(q);
  let dayCarbs = 0;
  snaps.forEach(s => {
    const m = s.data();
    dayCarbs += Number(m?.totals?.carbs_net || 0);
  });
  els.dayCarbs.textContent = fmt(dayCarbs, 0);
}

async function tryLoadExistingMeal() {
  // Look for existing doc with same date & slotKey
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const qy = query(mealsRef, where("date", "==", dateKey), where("slotKey", "==", slotKey), limit(1));
  const snaps = await getDocs(qy);
  if (!snaps.empty) {
    const snap = snaps.docs[0];
    const m = snap.data();
    mealItems = (m.items || []).map(x => ({
      id: x.itemId, name: x.name,
      unitKey: x.unitKey, unitLabel: x.unitLabel,
      gramsPerUnit: Number(x.gramsPerUnit || 1),
      qty: Number(x.qty || 0),
      grams: Number(x.grams || 0),
      carbs_raw: Number(x.carbs_raw || x.carbs_g || 0),
      fiber_g: Number(x.fiber_g || 0),
      cal_kcal: Number(x.cal_kcal || 0),
      gi: Number(x.gi ?? 0),
      gl: Number(x.gl ?? 0),
      imageUrl: x.imageUrl || ""
    }));
    // pre BG & doses
    els.preBg.value = m.preBg_mmol ?? "";
    els.doseCorrection.value = m.doseCorrection ?? "";
    els.doseCarbs.value = m.doseCarbs ?? "";
    els.netCarbRule.value = m.netCarbRuleUsed || netRuleDefault;
  } else {
    // no meal – try pre-reading auto
    await fetchPreReading();
  }
  renderMeal();
}

async function loadLibrary() {
  libraryAll = [];
  const coll = collection(db, "admin/global/foodItems");
  const snaps = await getDocs(coll);
  for (const s of snaps.docs) {
    const d = s.data();
    const id = s.id;
    // Per-100 fields may come under per100 or flat. Normalize:
    const per100 = d.per100 || {};
    const carbs100 = Number(d.carbs_g ?? per100.carbs ?? 0);
    const fiber100 = Number(d.fiber_g ?? per100.fiber ?? 0);
    const cal100   = Number(d.cal_kcal ?? per100.cal ?? 0);
    const gi       = Number(d.gi ?? per100.gi ?? 0);

    const measures = (d.measures || per100.measures || []).map(m => ({
      name: m.name, grams: Number(m.grams)
    }));
    // default gram unit:
    measures.unshift({ name: "جم", grams: 1 });

    let imageUrl = "";
    try {
      imageUrl = await getDownloadURL(sRef(st, `food-items/items/${id}/main.jpg`));
    } catch { /* ignore */ }

    libraryAll.push({
      id, name: d.name || d.title || "بدون اسم",
      carbs100, fiber100, cal100, gi,
      measures, imageUrl
    });
  }
  renderLibrary();
}

function renderLibrary() {
  const term = (els.searchBox.value || "").trim();
  // order: favorites first, then normal, then disliked
  const favSet = new Set(favorites);
  const disSet = new Set(disliked);

  library = libraryAll
    .filter(it => !term || it.name.includes(term))
    .sort((a, b) => {
      const ra = favSet.has(a.id) ? 0 : (disSet.has(a.id) ? 2 : 1);
      const rb = favSet.has(b.id) ? 0 : (disSet.has(b.id) ? 2 : 1);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "ar");
    });

  els.itemsGrid.innerHTML = library.map(it => cardHTML(it, favSet.has(it.id), disSet.has(it.id))).join("");
  els.itemsCount.textContent = `${library.length} صنف`;
  // bind card buttons
  $$("#itemsGrid .card-item").forEach(card => {
    const id = card.dataset.id;
    card.querySelector(".add").addEventListener("click", () => addItemFromLib(id));
    card.querySelector(".fav").addEventListener("click", () => toggleFav(id));
    card.querySelector(".ban").addEventListener("click", () => toggleBan(id));
  });
}

function cardHTML(it, isFav, isBan) {
  const favCls = isFav ? "on" : "";
  const banCls = isBan ? "on" : "";
  return `
  <div class="card-item" data-id="${it.id}">
    <img src="${it.imageUrl || "images/placeholder.png"}" alt="">
    <div class="meta">
      <div class="name">${it.name}</div>
      <div class="sub">GI: ${it.gi || "—"} • لكل 100جم: كارب ${fmt(it.carbs100,0)}g | ألياف ${fmt(it.fiber100,0)}g | ${fmt(it.cal100,0)} kcal</div>
    </div>
    <div class="actions">
      <button class="ic fav ${favCls}" title="مفضّل">⭐</button>
      <button class="ic ban ${banCls}" title="غير مفضّل">🚫</button>
      <button class="btn add">إضافة</button>
    </div>
  </div>`;
}

function toggleFav(id) {
  const s = new Set(favorites);
  s.has(id) ? s.delete(id) : s.add(id);
  favorites = Array.from(s);
  renderLibrary();
}
function toggleBan(id) {
  const s = new Set(disliked);
  s.has(id) ? s.delete(id) : s.add(id);
  disliked = Array.from(s);
  renderLibrary();
}

function addItemFromLib(id) {
  const it = libraryAll.find(x => x.id === id);
  if (!it) return;
  // default measure = first grams (not 1g if there is household)
  const m = it.measures.find(x => x.grams !== 1) || it.measures[0];
  const unitKey = m.name;
  const gramsPerUnit = Number(m.grams);
  const qty = 1;

  const grams = qty * gramsPerUnit;
  const carbs_raw = (it.carbs100 / 100) * grams;
  const fiber_g   = (it.fiber100 / 100) * grams;
  const cal_kcal  = (it.cal100   / 100) * grams;
  const gi = it.gi || 0;
  const gl = gi ? (gi * (carbs_raw / 100)) : 0;

  mealItems.push({
    id: it.id, name: it.name,
    unitKey, unitLabel: unitKey,
    gramsPerUnit, qty, grams,
    carbs_raw, fiber_g, cal_kcal, gi, gl,
    imageUrl: it.imageUrl
  });
  renderMeal();
}

function renderMeal() {
  els.mealBody.innerHTML = mealItems.map((x, i) => rowHTML(x, i)).join("");
  // bind row events
  mealItems.forEach((x, i) => {
    $("#u_"+i).addEventListener("change", (e) => onUnitChange(i, e.target.value));
    $("#q_"+i).addEventListener("input", (e) => onQtyChange(i, Number(e.target.value||0)));
    $("#rm_"+i).addEventListener("click", () => { mealItems.splice(i,1); renderMeal(); });
  });
  autoCompute();
}

function rowHTML(x, i) {
  // build options: we don't know original item's measures here; try to reuse gramsPerUnit + common set
  const lib = libraryAll.find(t => t.id === x.id);
  const opts = (lib?.measures || [{name:"جم", grams:1}])
    .map(m => `<option value="${m.grams}" ${Number(x.gramsPerUnit)===Number(m.grams)?"selected":""}>${m.name}</option>`).join("");

  return `
  <tr>
    <td><img class="thumb" src="${x.imageUrl || "images/placeholder.png"}" /></td>
    <td class="td-name">${x.name}</td>
    <td><select id="u_${i}">${opts}</select></td>
    <td><input id="q_${i}" type="number" step="0.1" value="${x.qty}"/></td>
    <td>${fmt(x.grams,0)}</td>
    <td>${fmt(x.carbs_raw,1)}</td>
    <td>${fmt(x.fiber_g,1)}</td>
    <td>${x.gi || "—"}</td>
    <td>${fmt(x.gl,1)}</td>
    <td><button id="rm_${i}" class="ic danger">✖</button></td>
  </tr>`;
}

function onUnitChange(i, gramsPerUnit) {
  const x = mealItems[i];
  x.gramsPerUnit = Number(gramsPerUnit);
  recalcRow(x);
  renderMeal();
}
function onQtyChange(i, qty) {
  const x = mealItems[i];
  x.qty = qty;
  recalcRow(x);
  renderMeal();
}
function recalcRow(x) {
  x.grams = x.qty * x.gramsPerUnit;
  // pull per100 from library
  const lib = libraryAll.find(t => t.id === x.id);
  const carbs100 = lib?.carbs100 || 0;
  const fiber100 = lib?.fiber100 || 0;
  const cal100   = lib?.cal100 || 0;
  const gi       = lib?.gi || 0;

  x.carbs_raw = (carbs100/100) * x.grams;
  x.fiber_g   = (fiber100/100) * x.grams;
  x.cal_kcal  = (cal100  /100) * x.grams;
  x.gi        = gi;
  x.gl        = gi ? (gi * (x.carbs_raw / 100)) : 0;
}

function autoCompute() {
  // totals
  const carbsRaw = mealItems.reduce((a,x)=>a+x.carbs_raw,0);
  const fiber    = mealItems.reduce((a,x)=>a+x.fiber_g,0);
  const cal      = mealItems.reduce((a,x)=>a+x.cal_kcal,0);
  const glTotal  = mealItems.reduce((a,x)=>a+x.gl,0);

  // net rule
  const rule = els.netCarbRule.value || "fullFiber";
  const factor = rule==="none"?0 : (rule==="halfFiber"?0.5:1);
  const carbsNet = Math.max(0, carbsRaw - (factor*fiber));

  // avg GI weighted by carbs of item (raw carbs)
  const sumGICarb = mealItems.reduce((a,x)=>a + (x.gi||0)*(x.carbs_raw||0), 0);
  const giAvg = carbsRaw > 0 ? (sumGICarb / carbsRaw) : 0;

  // CR and dose
  const cr = crForSlot(slotKey) || 0;
  const doseCarbs = cr ? (carbsNet / cr) : 0;

  // correction
  const bg = Number(els.preBg.value || 0);
  let doseCorr = Number(els.doseCorrection.value || 0);
  if (bg && bg > Number(targets.severeHigh ?? 10.9) && cf) {
    doseCorr = (bg - Number(targets.max ?? 7)) / cf;
  }
  doseCorr = roundTo(Math.max(0, doseCorr), 0.5);
  els.doseCorrection.value = doseCorr ? doseCorr.toFixed(1) : "";

  // total dose
  const totalDose = roundTo(doseCarbs + doseCorr, 0.5);

  // progress vs target for slot
  const slotName = slotKeyToName(slotKey);
  const r = carbRanges?.[slotName] || {};
  const min = Number(r.min ?? 0), max = Number(r.max ?? 0);
  let pct = 0;
  if (max > 0) pct = clamp((carbsNet / max) * 100, 0, 100);
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.className = "bar " + (carbsNet < min ? "warn" : carbsNet > max ? "danger" : "ok");
  els.progressLabel.textContent = `${fmt(carbsNet,0)} / ${max || "—"} g`;

  // render totals
  els.sumCarbsRaw.textContent = fmt(carbsRaw,1);
  els.sumFiber.textContent    = fmt(fiber,1);
  els.sumCarbsNet.textContent = fmt(carbsNet,1);
  els.sumCal.textContent      = fmt(cal,0);
  els.sumGL.textContent       = fmt(glTotal,1);
  els.sumGI.textContent       = giAvg ? fmt(giAvg,0) : "—";

  // doses
  els.doseCarbs.value = doseCarbs ? doseCarbs.toFixed(1) : "";
  els.doseTotal.textContent = totalDose ? totalDose.toFixed(1) : "—";
}

function updateDoseTotal() {
  // when user edits doseCarbs manually
  const doseC = Number(els.doseCarbs.value || 0);
  const doseCorr = Number(els.doseCorrection.value || 0);
  els.doseTotal.textContent = roundTo(doseC + doseCorr, 0.5).toFixed(1);
}

function slotKeyToName(k) {
  return k==="b"?"breakfast":k==="l"?"lunch":k==="d"?"dinner":"snack";
}

function scaleToTarget() {
  const slotName = slotKeyToName(slotKey);
  const r = carbRanges?.[slotName] || {};
  const tgt = (Number(r.min ?? 0) + Number(r.max ?? 0)) / 2 || 0;
  const curr = Number(els.sumCarbsNet.textContent || 0);
  if (!tgt || !curr) return;
  const factor = tgt / curr;
  mealItems.forEach(x => {
    x.qty = Number((x.qty * factor).toFixed(2));
    recalcRow(x);
  });
  renderMeal();
}

async function fetchPreReading() {
  // Strategy: look for PRE_SLOT in same date; else, window -90min before meal time
  const coll = collection(db, `parents/${parentId}/children/${childId}/measurements`);
  const preKey = `PRE_${slotKeyToName(slotKey).toUpperCase()}`; // e.g., PRE_LUNCH

  // 1) by slotKey on same day
  const snaps = await getDocs(query(coll, where("slotKey", "==", preKey)));
  let candidates = snaps.docs.map(d => ({ id:d.id, ...d.data() }))
    .filter(x => x.when && ymd(x.when.toDate ? x.when.toDate() : new Date(x.when)) === dateKey);

  // 2) fallback: within 90 minutes before meal time
  if (!candidates.length) {
    const [H, M] = (mealTimeStr || "13:00").split(":").map(Number);
    const mealDate = new Date(dateKey + "T" + mealTimeStr + ":00");
    const start = new Date(mealDate.getTime() - 90*60000);
    const end = mealDate;
    const snaps2 = await getDocs(coll);
    candidates = snaps2.docs.map(d => ({ id:d.id, ...d.data() }))
      .filter(x => {
        const t = x.when?.toDate ? x.when.toDate() : (x.when ? new Date(x.when) : null);
        return t && t >= start && t <= end;
      });
  }

  if (candidates.length) {
    // choose latest
    candidates.sort((a,b)=> (a.when?.seconds||0) - (b.when?.seconds||0));
    const last = candidates[candidates.length-1];
    const bg = Number(last.value_mmol ?? last.value ?? 0);
    els.preBg.value = bg ? bg.toFixed(1) : "";
  }
  autoCompute();
}

function onSlotChange() {
  slotKey = els.slotSelect.value;
  updateCRChip();
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";
  els.mealTime.value = mealTimeStr;
  autoCompute();
}

async function onDateChange() {
  dateKey = els.dateInput.value;
  await loadDayTotals();
  await tryLoadExistingMeal();
}

async function saveMeal() {
  const slotName = slotKeyToName(slotKey);
  const docData = {
    date: dateKey,
    slotKey: slotKey,
    type: slotMap[slotKey]?.ar || "",
    preBg_mmol: Number(els.preBg.value || 0) || null,
    netCarbRuleUsed: els.netCarbRule.value,
    doseCarbs: Number(els.doseCarbs.value || 0) || 0,
    doseCorrection: Number(els.doseCorrection.value || 0) || 0,
    doseTotal: Number(els.doseTotal.textContent || 0) || 0,
    totals: {
      carbs_raw: Number(els.sumCarbsRaw.textContent || 0),
      fiber_g: Number(els.sumFiber.textContent || 0),
      carbs_net: Number(els.sumCarbsNet.textContent || 0),
      cal_kcal: Number(els.sumCal.textContent || 0),
      gi_avg: (els.sumGI.textContent === "—") ? null : Number(els.sumGI.textContent),
      gl_total: Number(els.sumGL.textContent || 0)
    },
    items: mealItems.map(x => ({
      itemId: x.id, name: x.name,
      unitKey: x.unitKey, unitLabel: x.unitLabel,
      gramsPerUnit: x.gramsPerUnit, qty: x.qty, grams: x.grams,
      carbs_raw: x.carbs_raw, fiber_g: x.fiber_g, carbs_g: x.carbs_raw, // compat
      cal_kcal: x.cal_kcal, gi: x.gi || null, gl: x.gl || null,
      imageUrl: x.imageUrl || null
    })),
    updatedAt: Timestamp.now()
  };

  // Write (upsert): use composite key so we don't need a compound index
  const id = `${dateKey}_${slotKey}`;
  const ref = doc(db, `parents/${parentId}/children/${childId}/meals/${id}`);
  await setDoc(ref, docData, { merge: true });
  alert("تم حفظ الوجبة ✅");
  await loadDayTotals();
}

async function saveTemplate() {
  const out = {
    createdAt: new Date().toISOString(),
    items: mealItems.map(x => ({
      itemId: x.id,
      grams: x.grams,
      measure: x.unitLabel,
      calc: {
        carbs: x.carbs_raw, fiber: x.fiber_g, gi: x.gi || 0, gl: x.gl || 0, cal: x.cal_kcal
      }
    }))
  };
  const id = `tmpl_${Date.now()}`;
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/presetMeals/${id}`), out);
  alert("تم حفظ القالب ✅");
}

async function importFromTemplates() {
  const coll = collection(db, `parents/${parentId}/children/${childId}/presetMeals`);
  const snaps = await getDocs(coll);
  if (snaps.empty) { alert("لا توجد قوالب محفوظة."); return; }

  // Pick the latest for simplicity (يمكن لاحقا نضيف dialog للاختيار)
  let latestDoc = snaps.docs[0];
  snaps.forEach(d => { if ((d.data().createdAt||"") > (latestDoc.data().createdAt||"")) latestDoc = d; });
  const t = latestDoc.data();

  (t.items || []).forEach(it => {
    const lib = libraryAll.find(x => x.id === (it.itemId || it.id));
    if (!lib) return;
    const grams = Number(it.grams || 0);
    const qty = grams && lib.measures[0] ? (grams / (lib.measures[0].grams || 1)) : 1;
    const carbs_raw = (lib.carbs100/100) * grams;
    const fiber_g   = (lib.fiber100/100) * grams;
    const cal_kcal  = (lib.cal100  /100) * grams;
    const gi        = lib.gi || 0;
    const gl        = gi ? gi * (carbs_raw/100) : 0;

    mealItems.push({
      id: lib.id, name: lib.name,
      unitKey: lib.measures[0].name, unitLabel: lib.measures[0].name,
      gramsPerUnit: lib.measures[0].grams, qty, grams,
      carbs_raw, fiber_g, cal_kcal, gi, gl,
      imageUrl: lib.imageUrl
    });
  });
  renderMeal();
}

async function saveFavs() {
  const ref = doc(db, `parents/${parentId}/children/${childId}`);
  await updateDoc(ref, { favorites, disliked });
  alert("تم حفظ المفضلة/غير المفضلة ✅");
}

function exportCSV() {
  const rows = [
    ["التاريخ", dateKey, "الوجبة", slotMap[slotKey]?.ar || slotKey],
    [],
    ["الصنف","الوحدة","الكمية","جرام","كارب(raw)","ألياف","Net Rule","GI","GL","سعرات"]
  ];
  const rule = els.netCarbRule.value;

  mealItems.forEach(x => {
    rows.push([x.name, x.unitLabel, x.qty, x.grams, x.carbs_raw, x.fiber_g, rule, x.gi||"", x.gl||"", x.cal_kcal]);
  });
  rows.push([]);
  rows.push(["Carbs(raw)", els.sumCarbsRaw.textContent, "Fiber", els.sumFiber.textContent, "Net", els.sumCarbsNet.textContent, "Calories", els.sumCal.textContent, "GI(avg)", els.sumGI.textContent, "GL", els.sumGL.textContent]);
  rows.push(["DoseCarbs", els.doseCarbs.value, "DoseCorrection", els.doseCorrection.value, "DoseTotal", els.doseTotal.textContent]);

  const csv = rows.map(r => r.map(x => `"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `meal_${dateKey}_${slotKey}.csv`; a.click();
  URL.revokeObjectURL(url);
}
