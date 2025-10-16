// /js/meals.js
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs,
  query, where, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ====== Firebase guards ====== */
const db = window._db;
const st = window._st;
if (!db || !st) {
  alert("Firebase not initialized. تأكدي من سكربت التهيئة قبل meals.js");
  throw new Error("Firebase not initialized");
}

/* ====== Helpers ====== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmt = (n, d = 1) => (isFinite(n) ? Number(n).toFixed(d) : "0");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const roundTo = (v, step = 0.5) => Math.round((v / step)) * step;
const ymd = (d) => d.toISOString().slice(0, 10);
const parseQuery = () => Object.fromEntries(new URLSearchParams(location.search).entries());
const slotMap = { b:{ar:"فطار"}, l:{ar:"غداء"}, d:{ar:"عشاء"}, s:{ar:"سناك"} };
const slotName = (k) => k==="b"?"breakfast":k==="l"?"lunch":k==="d"?"dinner":"snack";

/* ====== State ====== */
let parentId, childId, slotKey, dateKey, mealTimeStr="13:00";
let childDoc;
let cf=0, crMap={}, targets={}, carbTargets={}, netRuleDefault="fullFiber";
let favorites=[], disliked=[];
let libraryAll=[], mealItems=[];

/* ====== Elements ====== */
const els = {
  // header chips
  childName: $("#childName"), chipCF: $("#chipCF"), chipCR: $("#chipCR"), chipTargets: $("#chipTargets"),
  backToChild: $("#backToChild"),

  // day controls
  dateInput: $("#dateInput"), slotSelect: $("#slotSelect"), mealTime: $("#mealTime"),
  preBg: $("#preBg"), btnFetchPre: $("#btnFetchPre"),
  netCarbRule: $("#netCarbRule"), doseCorrection: $("#doseCorrection"),
  doseCarbs: $("#doseCarbs"), doseTotal: $("#doseTotal"), dayCarbs: $("#dayCarbs"),

  progressBar: $("#progressBar"), progressLabel: $("#progressLabel"),
  btnScaleToTarget: $("#btnScaleToTarget"), btnClearMeal: $("#btnClearMeal"),
  btnSaveMeal: $("#btnSaveMeal"), btnSaveTemplate: $("#btnSaveTemplate"),
  btnLoadTemplates: $("#btnLoadTemplates"), btnExportCSV: $("#btnExportCSV"),
  btnPrint: $("#btnPrint"), btnSaveFavorites: $("#btnSaveFavorites"),

  // meal table
  mealBody: $("#mealBody"),
  sumCarbsRaw: $("#sumCarbsRaw"), sumFiber: $("#sumFiber"), sumCarbsNet: $("#sumCarbsNet"),
  sumCal: $("#sumCal"), sumGI: $("#sumGI"), sumGL: $("#sumGL"),

  // modal library
  btnOpenLibrary: $("#btnOpenLibrary"),
  libModal: $("#libModal"),
  itemsGrid: $("#itemsGrid"), itemsCount: $("#itemsCount"), searchBox: $("#searchBox"),

  // loader
  loader: $("#appLoader")
};

/* ====== Boot ====== */
init().catch(console.error);

async function init(){
  showLoader(true);

  const q = parseQuery();
  childId  = q.childId || q.child;
  parentId = q.parentId || q.parent;
  slotKey  = (q.slot || "l").toLowerCase();
  dateKey  = q.date || ymd(new Date());

  if (!childId) { alert("يلزم childId في الرابط"); return; }
  els.backToChild.href = `child.html?child=${childId}`;
  els.slotSelect.value = slotKey; els.dateInput.value = dateKey; els.mealTime.value = mealTimeStr;

  await loadChild();
  await loadLibrary();
  await loadDayTotals();
  await tryLoadExistingMeal();
  updateCRChip(); updateTargetUI(); computeAndRenderTotals();

  // events
  els.slotSelect.addEventListener("change", onSlotChange);
  els.dateInput.addEventListener("change", onDateChange);
  els.mealTime.addEventListener("change", () => mealTimeStr = els.mealTime.value);

  els.btnFetchPre.addEventListener("click", fetchPreReading);
  els.netCarbRule.addEventListener("change", computeAndRenderTotals);
  els.doseCarbs.addEventListener("input", updateDoseTotal);
  els.doseCorrection.addEventListener("input", updateDoseTotal);
  els.btnScaleToTarget.addEventListener("click", scaleToTarget);
  els.btnClearMeal.addEventListener("click", () => { mealItems = []; renderMeal(); });

  els.btnSaveMeal.addEventListener("click", saveMeal);
  els.btnSaveTemplate.addEventListener("click", saveTemplate);
  els.btnLoadTemplates.addEventListener("click", importFromTemplates);
  els.btnExportCSV.addEventListener("click", exportCSV);
  els.btnPrint.addEventListener("click", () => window.print());
  els.btnSaveFavorites.addEventListener("click", saveFavs);

  // modal open/close
  els.btnOpenLibrary.addEventListener("click", openLibrary);
  $$("#libModal [data-close-modal]").forEach(el => el.addEventListener("click", closeLibrary));
  els.searchBox.addEventListener("input", renderLibrary);

  showLoader(false);
}

/* ====== Child ====== */
async function loadChild(){
  if (!parentId) {
    // محاولة لتحديد parentId (اختياري)
    const parentsSnap = await getDocs(collection(db, "parents"));
    for (const p of parentsSnap.docs) {
      const cRef = doc(db, `parents/${p.id}/children/${childId}`);
      const s = await getDoc(cRef);
      if (s.exists()) { parentId = p.id; childDoc = s.data(); break; }
    }
  } else {
    const cRef = doc(db, `parents/${parentId}/children/${childId}`);
    const s = await getDoc(cRef);
    if (!s.exists()) { alert("Child غير موجود"); return; }
    childDoc = s.data();
  }

  els.childName.textContent = childDoc.name || "—";
  cf = Number(childDoc.correctionFactor ?? childDoc.cf ?? 0);
  crMap = childDoc.carbRatioByMeal || {};
  targets = childDoc.normalRange || { max: 7, severeHigh: 10.9, severeLow: 3.9 };
  carbTargets = childDoc.carbTargets || {};
  netRuleDefault = childDoc.netCarbRule || "fullFiber";
  favorites = Array.isArray(childDoc.favorites) ? childDoc.favorites : [];
  disliked  = Array.isArray(childDoc.disliked)  ? childDoc.disliked  : [];

  els.netCarbRule.value = netRuleDefault;
  els.chipCF.textContent = `CF ${cf || "—"} mmol/L per U`;
  updateCRChip();
  els.chipTargets.textContent = `هدف ${targets.max ?? 7} ( ${targets.severeLow ?? 3.9} – ${targets.severeHigh ?? 10.9} )`;
}
function crForSlot(k){ const fb = Number(childDoc.carbRatio ?? 0) || undefined; const v = Number((childDoc.carbRatioByMeal||{})[k] ?? fb); return isFinite(v)?v:0; }
function updateCRChip(){ const ar = slotMap[slotKey]?.ar || ""; const cr = crForSlot(slotKey); els.chipCR.textContent = `CR(${ar}) ${cr || "—"} g/U`; }
function updateTargetUI(){ const r = carbTargets[slotName(slotKey)] || {}; const min=Number(r.min??0), max=Number(r.max??0); els.progressLabel.textContent=`0 / ${max||"—"} g`; els.progressBar.className="bar"; els.progressBar.style.width="0%"; }

/* ====== Day totals ====== */
async function loadDayTotals(){
  const mRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const qy = query(mRef, where("date","==",dateKey));
  const snaps = await getDocs(qy);
  let total = 0;
  snaps.forEach(s => total += Number(s.data()?.totals?.carbs_net || 0));
  els.dayCarbs.textContent = fmt(total,0);
}

/* ====== Existing meal ====== */
async function tryLoadExistingMeal(){
  const mRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const snaps = await getDocs(query(mRef, where("date","==",dateKey), where("slotKey","==",slotKey), limit(1)));
  if (snaps.empty) { await fetchPreReading(); return; }
  const m = snaps.docs[0].data();
  mealItems = (m.items||[]).map(x => ({
    id:x.itemId,name:x.name,unitKey:x.unitKey,unitLabel:x.unitLabel,
    gramsPerUnit:Number(x.gramsPerUnit||1),qty:Number(x.qty||0),grams:Number(x.grams||0),
    carbs_raw:Number(x.carbs_raw||x.carbs_g||0),fiber_g:Number(x.fiber_g||0),
    cal_kcal:Number(x.cal_kcal||0),gi:Number(x.gi||0),gl:Number(x.gl||0),
    imageUrl:x.imageUrl||""
  }));
  els.preBg.value = m.preBg_mmol ?? "";
  els.doseCorrection.value = m.doseCorrection ?? "";
  els.doseCarbs.value = m.doseCarbs ?? "";
  els.netCarbRule.value = m.netCarbRuleUsed || netRuleDefault;
  renderMeal();
}

/* ====== Library (Modal) ====== */
async function loadLibrary(){
  libraryAll = [];
  const coll = collection(db, "admin/global/foodItems");
  const snaps = await getDocs(coll);
  for (const s of snaps.docs) {
    const d = s.data(); const id = s.id;
    const per100 = d.per100 || {};
    const carbs100 = Number(d.carbs_g ?? per100.carbs ?? 0);
    const fiber100 = Number(d.fiber_g ?? per100.fiber ?? 0);
    const cal100   = Number(d.cal_kcal ?? per100.cal ?? 0);
    const gi       = Number(d.gi ?? per100.gi ?? 0);
    const measures = (d.measures || per100.measures || []).map(m=>({name:m.name,grams:Number(m.grams)}));
    if (!measures.length) measures.push({name:"جم",grams:1});

    let imageUrl = "";
    try { imageUrl = await getDownloadURL(sRef(st, `food-items/items/${id}/main.jpg`)); } catch {}
    libraryAll.push({ id, name:d.name||d.title||"بدون اسم", carbs100, fiber100, cal100, gi, measures, imageUrl });
  }
  renderLibrary();
}
function renderLibrary(){
  const term = (els.searchBox.value||"").trim();
  const favSet = new Set(favorites), banSet = new Set(disliked);
  const list = libraryAll
    .filter(it => !term || it.name.includes(term))
    .sort((a,b)=>{
      const ra = favSet.has(a.id)?0:(banSet.has(a.id)?2:1);
      const rb = favSet.has(b.id)?0:(banSet.has(b.id)?2:1);
      if (ra!==rb) return ra-rb;
      return a.name.localeCompare(b.name,"ar");
    });

  els.itemsGrid.innerHTML = list.map(it => cardHTML(it, favSet.has(it.id), banSet.has(it.id))).join("");
  els.itemsCount.textContent = `${list.length} صنف`;
  $$("#itemsGrid .card-item").forEach(card=>{
    const id = card.dataset.id;
    card.querySelector(".btn-add").addEventListener("click", ()=> addItemFromLib(id));
    card.querySelector(".fav").addEventListener("click", ()=> toggleFav(id));
    card.querySelector(".ban").addEventListener("click", ()=> toggleBan(id));
  });
}
function cardHTML(it, isFav, isBan){
  return `
  <div class="card-item" data-id="${it.id}">
    <div class="thumb"><img src="${it.imageUrl || "images/placeholder.png"}" alt=""></div>
    <div class="meta">
      <div class="name">${it.name}</div>
      <div class="sub">GI: ${it.gi||"—"} • لكل 100جم: كارب ${fmt(it.carbs100,0)}g | ألياف ${fmt(it.fiber100,0)}g | ${fmt(it.cal100,0)} kcal</div>
    </div>
    <div class="actions">
      <div>
        <button class="ic fav ${isFav?"on":""}" title="مفضّل">⭐</button>
        <button class="ic ban ${isBan?"on":""}" title="غير مفضّل">🚫</button>
      </div>
      <button class="btn-add">+ إضافة</button>
    </div>
  </div>`;
}
function toggleFav(id){ const s=new Set(favorites); s.has(id)?s.delete(id):s.add(id); favorites=[...s]; renderLibrary(); }
function toggleBan(id){ const s=new Set(disliked ); s.has(id)?s.delete(id):s.add(id); disliked =[...s]; renderLibrary(); }
function openLibrary(){ els.libModal.classList.remove("hidden"); els.libModal.setAttribute("aria-hidden","false"); }
function closeLibrary(){ els.libModal.classList.add("hidden"); els.libModal.setAttribute("aria-hidden","true"); }
function addItemFromLib(id){
  const it = libraryAll.find(t=>t.id===id); if (!it) return;
  const m = it.measures.find(x=>x.grams!==1) || it.measures[0];
  const unitLabel = m.name, gramsPerUnit = Number(m.grams||1);
  const qty=1, grams=qty*gramsPerUnit;
  const carbs_raw=(it.carbs100/100)*grams, fiber_g=(it.fiber100/100)*grams, cal_kcal=(it.cal100/100)*grams;
  const gi=it.gi||0, gl=gi?gi*(carbs_raw/100):0;
  mealItems.push({ id:it.id,name:it.name,unitKey:unitLabel,unitLabel,gramsPerUnit,qty,grams,carbs_raw,fiber_g,cal_kcal,gi,gl,imageUrl:it.imageUrl });
  renderMeal();
}

/* ====== Meal table & totals ====== */
function renderMeal(){
  els.mealBody.innerHTML = mealItems.map((x,i)=>rowHTML(x,i)).join("");
  mealItems.forEach((x,i)=>{
    $("#u_"+i).addEventListener("change", e => onUnitChange(i, Number(e.target.value)));
    $("#q_"+i).addEventListener("input",  e => onQtyChange(i, Number(e.target.value||0)));
    $("#rm_"+i).addEventListener("click", ()=>{ mealItems.splice(i,1); renderMeal(); });
  });
  computeAndRenderTotals();
}
function rowHTML(x,i){
  const lib = libraryAll.find(t=>t.id===x.id);
  const opts = (lib?.measures || [{name:"جم",grams:1}])
    .map(m=>`<option value="${m.grams}" ${Number(x.gramsPerUnit)===Number(m.grams)?"selected":""}>${m.name}</option>`).join("");
  return `
  <tr>
    <td><img class="thumb" src="${x.imageUrl||"images/placeholder.png"}" /></td>
    <td class="td-name">${x.name}</td>
    <td><select id="u_${i}">${opts}</select></td>
    <td><input id="q_${i}" type="number" step="0.1" value="${x.qty}"/></td>
    <td>${fmt(x.grams,0)}</td>
    <td>${fmt(x.carbs_raw,1)}</td>
    <td>${fmt(x.fiber_g,1)}</td>
    <td>${x.gi||"—"}</td>
    <td>${fmt(x.gl,1)}</td>
    <td><button id="rm_${i}" class="btn danger">✖</button></td>
  </tr>`;
}
function onUnitChange(i, gramsPerUnit){ const x=mealItems[i]; x.gramsPerUnit=Number(gramsPerUnit); recalcRow(x); renderMeal(); }
function onQtyChange(i, qty){ const x=mealItems[i]; x.qty=Number(qty||0); recalcRow(x); renderMeal(); }
function recalcRow(x){
  x.grams = x.qty * x.gramsPerUnit;
  const lib = libraryAll.find(t=>t.id===x.id);
  const c100=lib?.carbs100||0, f100=lib?.fiber100||0, cal100=lib?.cal100||0, gi=lib?.gi||0;
  x.carbs_raw=(c100/100)*x.grams; x.fiber_g=(f100/100)*x.grams; x.cal_kcal=(cal100/100)*x.grams; x.gi=gi; x.gl=gi?gi*(x.carbs_raw/100):0;
}
function computeTotals(){
  const carbsRaw = mealItems.reduce((a,x)=>a+x.carbs_raw,0);
  const fiber    = mealItems.reduce((a,x)=>a+x.fiber_g,0);
  const cal      = mealItems.reduce((a,x)=>a+x.cal_kcal,0);
  const glTotal  = mealItems.reduce((a,x)=>a+x.gl,0);
  const rule = els.netCarbRule.value || "fullFiber";
  const factor = rule==="none" ? 0 : (rule==="halfFiber" ? 0.5 : 1);
  const carbsNet = Math.max(0, carbsRaw - factor*fiber);
  const sumGICarb = mealItems.reduce((a,x)=>a+(x.gi||0)*(x.carbs_raw||0),0);
  const giAvg = carbsRaw>0 ? (sumGICarb/carbsRaw) : 0;
  return { carbsRaw, fiber, cal, glTotal, carbsNet, giAvg };
}
function computeAndRenderTotals(){
  const {carbsRaw,fiber,cal,glTotal,carbsNet,giAvg} = computeTotals();
  const cr = crForSlot(slotKey) || 0;
  const doseCarbs = cr ? (carbsNet/cr) : 0;

  const bg = Number(els.preBg.value || 0);
  let doseCorr = Number(els.doseCorrection.value || 0);
  if (bg && bg > Number(targets.severeHigh ?? 10.9) && cf) {
    doseCorr = (bg - Number(targets.max ?? 7)) / cf;
  }
  doseCorr = roundTo(Math.max(0,doseCorr), 0.5);
  els.doseCorrection.value = doseCorr ? doseCorr.toFixed(1) : "";

  const totalDose = roundTo(doseCarbs + doseCorr, 0.5);

  // target progress
  const r = carbTargets[slotName(slotKey)] || {};
  const min=Number(r.min??0), max=Number(r.max??0);
  let pct=0, cls="ok"; if (max>0) pct = clamp((carbsNet/max)*100, 0, 100);
  if (carbsNet < min) cls="warn"; else if (carbsNet>max && max>0) cls="danger";
  els.progressBar.className="bar "+cls;
  els.progressBar.style.width=`${pct}%`;
  els.progressLabel.textContent=`${fmt(carbsNet,0)} / ${max||"—"} g`;

  // totals ui
  els.sumCarbsRaw.textContent = fmt(carbsRaw,1);
  els.sumFiber.textContent    = fmt(fiber,1);
  els.sumCarbsNet.textContent = fmt(carbsNet,1);
  els.sumCal.textContent      = fmt(cal,0);
  els.sumGL.textContent       = fmt(glTotal,1);
  els.sumGI.textContent       = giAvg ? fmt(giAvg,0) : "—";

  els.doseCarbs.value = doseCarbs ? doseCarbs.toFixed(1) : "";
  els.doseTotal.textContent = totalDose ? totalDose.toFixed(1) : "—";
}
function updateDoseTotal(){ const doseC=Number(els.doseCarbs.value||0); const doseCorr=Number(els.doseCorrection.value||0); els.doseTotal.textContent = roundTo(doseC+doseCorr,0.5).toFixed(1); }

/* ====== Target scaler ====== */
function scaleToTarget(){
  const { carbsNet } = computeTotals();
  const r = carbTargets[slotName(slotKey)] || {};
  const min = Number(r.min ?? 0), max = Number(r.max ?? 0);
  if (!max || carbsNet<=0) { alert("لا يوجد هدف صالح أو لا توجد أصناف"); return; }
  const target = (min && max) ? (min+max)/2 : max;
  const factor = target / carbsNet;
  if (!isFinite(factor) || factor<=0) return;
  mealItems.forEach(x=>{ x.qty = Number((x.qty*factor).toFixed(2)); recalcRow(x); });
  renderMeal();
}

/* ====== Fetch pre reading ====== */
async function fetchPreReading(){
  try {
    const coll = collection(db, `parents/${parentId}/children/${childId}/measurements`);
    const key = `PRE_${slotName(slotKey).toUpperCase()}`;
    const snaps = await getDocs(query(coll, where("slotKey","==",key)));
    const sameDate = snaps.docs.map(d=>({id:d.id,...d.data()}))
      .filter(x => x.when && ymd(x.when.toDate?x.when.toDate():new Date(x.when)) === dateKey);

    let candidates = sameDate;
    if (!candidates.length) {
      const mealDate = new Date(`${dateKey}T${mealTimeStr}:00`);
      const start = new Date(mealDate.getTime() - 90*60000);
      const end = mealDate;
      const all = await getDocs(coll);
      candidates = all.docs.map(d=>({id:d.id,...d.data()}))
        .filter(x=>{
          const t = x.when?.toDate ? x.when.toDate() : (x.when?new Date(x.when):null);
          return t && t>=start && t<=end;
        });
    }
    if (candidates.length) {
      candidates.sort((a,b)=>(a.when?.seconds||0)-(b.when?.seconds||0));
      const last = candidates[candidates.length-1];
      const bg = Number(last.value_mmol ?? last.value ?? 0);
      els.preBg.value = bg ? bg.toFixed(1) : "";
      computeAndRenderTotals();
    }
  } catch (e) { console.warn(e); }
}

/* ====== Slot/date changes ====== */
function onSlotChange(){
  slotKey = els.slotSelect.value;
  mealTimeStr = slotKey==="b"?"08:00":slotKey==="l"?"13:00":slotKey==="d"?"19:00":"16:30";
  els.mealTime.value = mealTimeStr;
  updateCRChip(); updateTargetUI(); computeAndRenderTotals();
}
async function onDateChange(){ dateKey = els.dateInput.value; await loadDayTotals(); await tryLoadExistingMeal(); }

/* ====== Save / templates / favorites ====== */
async function saveMeal(){
  if (!parentId) { alert("لا يمكن الحفظ بدون parentId."); return; }
  const docData = {
    date: dateKey, slotKey, type: slotMap[slotKey]?.ar || "",
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
      gi_avg: (els.sumGI.textContent==="—")?null:Number(els.sumGI.textContent),
      gl_total: Number(els.sumGL.textContent || 0)
    },
    items: mealItems.map(x=>({
      itemId:x.id,name:x.name,unitKey:x.unitKey,unitLabel:x.unitLabel,gramsPerUnit:x.gramsPerUnit,
      qty:x.qty,grams:x.grams,carbs_raw:x.carbs_raw,fiber_g:x.fiber_g,carbs_g:x.carbs_raw,
      cal_kcal:x.cal_kcal,gi:x.gi||null,gl:x.gl||null,imageUrl:x.imageUrl||null
    })),
    updatedAt: Timestamp.now()
  };
  const id = `${dateKey}_${slotKey}`;
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/meals/${id}`), docData, {merge:true});
  alert("تم حفظ الوجبة ✅");
  await loadDayTotals();
}
async function saveTemplate(){
  const out = {
    createdAt: new Date().toISOString(),
    items: mealItems.map(x=>({ itemId:x.id, grams:x.grams, measure:x.unitLabel,
      calc:{carbs:x.carbs_raw,fiber:x.fiber_g,gi:x.gi||0,gl:x.gl||0,cal:x.cal_kcal} }))
  };
  const id = `tmpl_${Date.now()}`;
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/presetMeals/${id}`), out);
  alert("تم حفظ القالب ✅");
}
async function importFromTemplates(){
  const coll = collection(db, `parents/${parentId}/children/${childId}/presetMeals`);
  const snaps = await getDocs(coll);
  if (snaps.empty) { alert("لا توجد قوالب محفوظة"); return; }
  let latest = snaps.docs[0];
  snaps.forEach(d=>{ if ((d.data().createdAt||"")>(latest.data().createdAt||"")) latest=d; });
  const t = latest.data();
  (t.items||[]).forEach(it=>{
    const lib = libraryAll.find(x=>x.id === (it.itemId||it.id));
    if (!lib) return;
    const grams = Number(it.grams||0);
    const qty = grams && lib.measures[0] ? (grams/(lib.measures[0].grams||1)) : 1;
    const carbs_raw=(lib.carbs100/100)*grams, fiber_g=(lib.fiber100/100)*grams, cal_kcal=(lib.cal100/100)*grams;
    const gi=lib.gi||0, gl=gi?gi*(carbs_raw/100):0;
    mealItems.push({
      id:lib.id,name:lib.name,unitKey:lib.measures[0].name,unitLabel:lib.measures[0].name,
      gramsPerUnit:lib.measures[0].grams,qty,grams,carbs_raw,fiber_g,cal_kcal,gi,gl,imageUrl:lib.imageUrl
    });
  });
  renderMeal();
}
async function saveFavs(){
  if (!parentId) { alert("لا يمكن الحفظ بدون parentId."); return; }
  await updateDoc(doc(db, `parents/${parentId}/children/${childId}`), { favorites, disliked });
  alert("تم حفظ المفضلة/غير المفضلة ✅");
}

/* ====== Export CSV ====== */
function exportCSV(){
  const rows = [
    ["التاريخ", dateKey, "الوجبة", slotMap[slotKey]?.ar || slotKey], [],
    ["الصنف","الوحدة","الكمية","جرام","كارب(raw)","ألياف","Net Rule","GI","GL","سعرات"]
  ];
  const rule = els.netCarbRule.value;
  mealItems.forEach(x=> rows.push([x.name,x.unitLabel,x.qty,x.grams,x.carbs_raw,x.fiber_g,rule,x.gi||"",x.gl||"",x.cal_kcal]) );
  rows.push([]);
  rows.push(["Carbs(raw)",els.sumCarbsRaw.textContent,"Fiber",els.sumFiber.textContent,"Net",els.sumCarbsNet.textContent,"Calories",els.sumCal.textContent,"GI(avg)",els.sumGI.textContent,"GL",els.sumGL.textContent]);
  rows.push(["DoseCarbs",els.doseCarbs.value,"DoseCorrection",els.doseCorrection.value,"DoseTotal",els.doseTotal.textContent]);

  const csv = rows.map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=`meal_${dateKey}_${slotKey}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ====== Loader ====== */
function showLoader(on){ els.loader?.classList[on?"add":"remove"]("show"); }
