// js/meals.js  — final clean build
// نصيحة: اتركي هذا الملف "module" الوحيد في الصفحة (لا window._db ولا window._st)

// ===== Firebase imports (v12.1.0) =====
import {
  doc, getDoc, setDoc, updateDoc,
  collection, getDocs, query, where, limit,
  Timestamp, collectionGroup, documentId
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref as sRef, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { db, storage as st } from "./firebase-config.js";

// ===== Helpers =====
const $  = (sel, r=document) => r.querySelector(sel);
const $$ = (sel, r=document) => Array.from(r.querySelectorAll(sel));
const fmt     = (n, d=1) => (Number(n ?? 0)).toFixed(d);
const clamp   = (v,a,b)=>Math.max(a,Math.min(b,v));
const roundTo = (v,step=0.5)=>Math.round((Number(v)||0)/step)*step;
const ymd = (d)=> new Date(d).toISOString().slice(0,10);
const todayUTC3 = ()=>{
  const d=new Date();
  const utc=d.getTime()+d.getTimezoneOffset()*60000;
  return new Date(utc + 3*3600*1000);
};
const parseQuery=()=>Object.fromEntries(new URLSearchParams(location.search).entries());
const slotMap = {
  b:{ar:"فطار",  defaultTime:"08:00"},
  l:{ar:"غداء",  defaultTime:"13:00"},
  d:{ar:"عشاء",  defaultTime:"19:00"},
  s:{ar:"سناك",  defaultTime:"16:30"}
};
const slotKeyToName = (k)=> k==="b"?"breakfast":k==="l"?"lunch":k==="d"?"dinner":"snack";

// ===== Page elements (تأكدي IDs موجودة في HTML) =====
const els = {
  backToChild:   $("#backToChild"),
  chipCF:        $("#chipCF"),
  chipCR:        $("#chipCR"),
  chipTargets:   $("#chipTargets"),
  dateInput:     $("#dateInput"),
  slotSelect:    $("#slotSelect"),
  mealTime:      $("#mealTime"),
  preBg:         $("#preBg"),
  btnFetchPre:   $("#btnFetchPre"),
  netCarbRule:   $("#netCarbRule"),
  doseCarbs:     $("#doseCarbs"),
  doseCorrection:$("#doseCorrection"),
  doseTotal:     $("#doseTotal"),
  dayCarbs:      $("#dayCarbs"),

  // progress
  progressBar:   $("#progressBar"),
  progressLabel: $("#progressLabel"),

  // actions
  btnScaleToTarget: $("#btnScaleToTarget"),
  btnClearMeal:     $("#btnClearMeal"),
  btnSaveMeal:      $("#btnSaveMeal"),
  btnSaveTemplate:  $("#btnSaveTemplate"),
  btnLoadTemplates: $("#btnLoadTemplates"),
  btnExportCSV:     $("#btnExportCSV"),
  btnPrint:         $("#btnPrint"),
  btnSaveFavorites: $("#btnSaveFavorites"),

  // library
  btnOpenLibrary: $("#btnOpenLibrary"),
  libModal:       $("#libModal"),
  libOverlay:     $("#libOverlay"),
  libClose:       $("#libClose"),
  searchBox:      $("#searchBox"),
  itemsGrid:      $("#itemsGrid"),
  itemsCount:     $("#itemsCount"),

  // meal table
  mealBody:       $("#mealBody"),

  // sums
  sumCarbsRaw: $("#sumCarbsRaw"),
  sumFiber:    $("#sumFiber"),
  sumCarbsNet: $("#sumCarbsNet"),
  sumCal:      $("#sumCal"),
  sumGI:       $("#sumGI"),
  sumGL:       $("#sumGL"),
};

// ===== State =====
let parentId, childId, childDoc=null;
let slotKey, dateKey, mealTimeStr;
let cf=0;                 // correctionFactor (الأساسي)
let crMap={};             // carbRatioByMeal
let targets={};           // normalRange (min/max/severeHigh…)
let carbRanges={};        // carbTargets {breakfast|lunch|dinner|snack:{min,max}}
let netRuleDefault="fullFiber";
let favorites=[], disliked=[];
let mealItems=[];         // الوجبة الحالية
let libraryAll=[];        // مكتبة الأصناف (كاملة)
let library=[];           // بعد الفرز/الفلاتر

// ===== Init =====
init().catch(e=>{
  console.error(e);
  alert("Firebase not initialized. تأكدي إن firebase-config.js يصدّر db و storage قبل meals.js");
});

async function init(){
  // 1) Params
  const q = parseQuery();
  childId   = q.child || q.childId;
  parentId  = q.parentId || null;
  slotKey   = (q.slot || "l").toLowerCase();
  dateKey   = q.date || ymd(todayUTC3());
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";
  if(!childId){ alert("يلزم تمرير child في الرابط"); return; }

  // 2) Load child (معالجة parentId لو ناقص)
  await loadChild();

  // 3) UI defaults
  if(els.backToChild) els.backToChild.href = `child.html?child=${childId}`;
  if(els.dateInput)   els.dateInput.value = dateKey;
  if(els.slotSelect)  els.slotSelect.value = slotKey;
  if(els.mealTime)    els.mealTime.value = mealTimeStr;

  updateCRChip(); updateTargetUI();

  // 4) Load aux
  await loadLibrary();
  await loadDayTotals();
  await tryLoadExistingMeal();     // حمّل وجبة اليوم/السلوط إن وجدت
  computeAndRenderTotals();

  // 5) Events
  els.slotSelect?.addEventListener("change", onSlotChange);
  els.dateInput?.addEventListener("change", onDateChange);
  els.mealTime?.addEventListener("change", ()=> mealTimeStr = els.mealTime.value);

  els.btnFetchPre?.addEventListener("click", fetchPreReading);
  els.netCarbRule?.addEventListener("change", computeAndRenderTotals);
  els.doseCarbs?.addEventListener("input", updateDoseTotal);
  els.doseCorrection?.addEventListener("input", updateDoseTotal);

  els.btnScaleToTarget?.addEventListener("click", scaleToTarget);
  els.btnClearMeal?.addEventListener("click", ()=>{ mealItems=[]; renderMeal(); });

  els.btnSaveMeal?.addEventListener("click", saveMeal);
  els.btnSaveTemplate?.addEventListener("click", saveTemplate);
  els.btnLoadTemplates?.addEventListener("click", importFromTemplates);
  els.btnExportCSV?.addEventListener("click", exportCSV);
  els.btnPrint?.addEventListener("click", ()=> window.print());
  els.btnSaveFavorites?.addEventListener("click", saveFavs);

  // modal
  els.btnOpenLibrary?.addEventListener("click", openLibModal);
  els.libClose?.addEventListener("click", closeLibModal);
  els.libOverlay?.addEventListener("click", closeLibModal);

  // live search
  els.searchBox?.addEventListener("input", renderLibrary);
}

/* ===== Child load ===== */
async function loadChild(){
  // لو parentId مش موجود: ابحث عنه عبر collectionGroup(children)
  if(!parentId){
    const cg = await getDocs(
      query(collectionGroup(db,"children"), where(documentId(),"==", childId), limit(1))
    );
    if(cg.empty){ throw new Error("Child not found or not permitted"); }
    parentId = cg.docs[0].ref.parent.parent.id;
    childDoc = cg.docs[0].data();
  } else {
    const snap = await getDoc(doc(db, `parents/${parentId}/children/${childId}`));
    if(!snap.exists()){ throw new Error("Child not found"); }
    childDoc = snap.data();
  }

  cf            = Number(childDoc.correctionFactor ?? 0);
  crMap         = childDoc.carbRatioByMeal || {};
  targets       = childDoc.normalRange || { max:7, severeHigh:10.9 };
  carbRanges    = childDoc.carbTargets   || {};
  netRuleDefault= childDoc.netCarbRule   || "fullFiber";
  favorites     = Array.isArray(childDoc.favorites)? childDoc.favorites : [];
  disliked      = Array.isArray(childDoc.disliked) ? childDoc.disliked  : [];

  els.netCarbRule && (els.netCarbRule.value = netRuleDefault);
  els.chipCF && (els.chipCF.textContent = `CF ${cf||"—"} mmol/L per U`);
}

function updateCRChip(){
  const ar = slotMap[slotKey]?.ar || "";
  const cr = crForSlot(slotKey);
  els.chipCR && (els.chipCR.textContent = `CR(${ar}) ${cr ?? "—"} g/U`);
}
function crForSlot(k){
  const fallback = Number(childDoc.carbRatio ?? 0) || undefined;
  return Number((childDoc.carbRatioByMeal||{})[k]) || fallback;
}

function updateTargetUI(){
  const slotName = slotKeyToName(slotKey);
  const r = carbRanges?.[slotName] || {};
  els.chipTargets && (els.chipTargets.textContent = `هدف الكارب: ${r.min ?? "—"}–${r.max ?? "—"} g`);
}

/* ===== Day totals & existing meal ===== */
async function loadDayTotals(){
  const snaps = await getDocs( query(
    collection(db, `parents/${parentId}/children/${childId}/meals`),
    where("date","==", dateKey)
  ));
  let day=0;
  snaps.forEach(s=> day += Number(s.data()?.totals?.carbs_net || 0));
  els.dayCarbs && (els.dayCarbs.textContent = fmt(day,0));
}
async function tryLoadExistingMeal(){
  const qy = query(
    collection(db, `parents/${parentId}/children/${childId}/meals`),
    where("date","==", dateKey),
    where("slotKey","==", slotKey),
    limit(1)
  );
  const snaps = await getDocs(qy);
  if(!snaps.empty){
    const m = snaps.docs[0].data();
    mealItems = (m.items||[]).map(x=>({
      id:x.itemId, name:x.name,
      unitKey:x.unitKey, unitLabel:x.unitLabel,
      gramsPerUnit:Number(x.gramsPerUnit||1),
      qty:Number(x.qty||0), grams:Number(x.grams||0),
      carbs_raw:Number(x.carbs_raw ?? x.carbs_g ?? 0),
      fiber_g:Number(x.fiber_g||0),
      cal_kcal:Number(x.cal_kcal||0),
      gi:Number(x.gi ?? 0), gl:Number(x.gl ?? 0),
      imageUrl:x.imageUrl||""
    }));
    if(els.preBg) els.preBg.value = m.preBg_mmol ?? "";
    if(els.doseCorrection) els.doseCorrection.value = m.doseCorrection ?? "";
    if(els.doseCarbs) els.doseCarbs.value = m.doseCarbs ?? "";
    if(els.netCarbRule) els.netCarbRule.value = m.netCarbRuleUsed || netRuleDefault;
  } else {
    await fetchPreReading(); // جِيب أقرب قراءة
  }
  renderMeal();
}

/* ===== Library ===== */
async function loadLibrary(){
  libraryAll = [];
  const snaps = await getDocs(collection(db, "admin/global/foodItems"));
  for(const s of snaps.docs){
    const d = s.data(); const id = s.id;
    const per100 = d.per100 || {};
    const carbs100 = Number(d.carbs_g ?? per100.carbs ?? 0);
    const fiber100 = Number(d.fiber_g ?? per100.fiber ?? 0);
    const cal100   = Number(d.cal_kcal ?? per100.cal ?? 0);
    const gi       = Number(d.gi ?? per100.gi ?? 0);
    const measures = (d.measures || per100.measures || []).map(m=>({ name:m.name, grams:Number(m.grams) }));
    if(!measures.length) measures.push({name:"جم", grams:1});

    // image fallback
    let imageUrl="";
    for(const path of [
      `food-items/items/${id}/main.jpg`,
      `food-items/items/${id}/main.png`,
      `food-items/items/${id}/1.jpg`,
      `food-items/items/${id}/1.png`
    ]){
      try { imageUrl = await getDownloadURL(sRef(st, path)); break; } catch {}
    }

    libraryAll.push({ id, name: d.name || d.title || "بدون اسم", carbs100, fiber100, cal100, gi, measures, imageUrl });
  }
  renderLibrary();
}

function renderLibrary(){
  const term = (els.searchBox?.value || "").trim();
  const favSet = new Set(favorites);
  const disSet = new Set(disliked);

  library = libraryAll
    .filter(it => !term || it.name.includes(term))
    .sort((a,b)=>{
      const ra = favSet.has(a.id)?0 : (disSet.has(a.id)?2:1);
      const rb = favSet.has(b.id)?0 : (disSet.has(b.id)?2:1);
      if(ra!==rb) return ra-rb;
      return a.name.localeCompare(b.name,"ar");
    });

  if(els.itemsGrid){
    els.itemsGrid.innerHTML = library.map(it=> cardHTML(it, favSet.has(it.id), disSet.has(it.id))).join("");
    els.itemsCount && (els.itemsCount.textContent = `${library.length} صنف`);
    $$("#itemsGrid .card-item").forEach(card=>{
      const id = card.dataset.id;
      card.querySelector(".add")?.addEventListener("click", ()=> addItemFromLib(id));
      card.querySelector(".fav")?.addEventListener("click", ()=> toggleFav(id));
      card.querySelector(".ban")?.addEventListener("click", ()=> toggleBan(id));
    });
  }
}
function cardHTML(it, isFav, isBan){
  return `
  <div class="card-item" data-id="${it.id}">
    <div class="thumb-wrap">
      <img src="${it.imageUrl || "images/placeholder.png"}" alt="${it.name}">
      <div class="small-gi">${it.gi?`GI ${it.gi}`:"—"}</div>
    </div>
    <div class="meta">
      <div class="name">${it.name}</div>
      <div class="sub">لكل 100جم: كارب ${fmt(it.carbs100,0)}g • ألياف ${fmt(it.fiber100,0)}g • ${fmt(it.cal100,0)} kcal</div>
    </div>
    <div class="actions">
      <button class="ic fav ${isFav?"on":""}" title="مفضّل">⭐</button>
      <button class="ic ban ${isBan?"on":""}" title="غير مفضّل">🚫</button>
      <button class="btn add">إضافة</button>
    </div>
  </div>`;
}
function toggleFav(id){ const s=new Set(favorites); s.has(id)?s.delete(id):s.add(id); favorites=[...s]; renderLibrary(); }
function toggleBan(id){ const s=new Set(disliked);  s.has(id)?s.delete(id):s.add(id); disliked=[...s]; renderLibrary(); }
function addItemFromLib(id){
  const it = libraryAll.find(x=>x.id===id); if(!it) return;
  const m  = it.measures.find(x=>x.grams!==1) || it.measures[0];
  const gramsPerUnit = Number(m.grams||1), qty=1, grams=gramsPerUnit*qty;
  const carbs_raw = (it.carbs100/100)*grams, fiber_g=(it.fiber100/100)*grams, cal_kcal=(it.cal100/100)*grams;
  const gi=it.gi||0, gl= gi? gi*(carbs_raw/100):0;

  mealItems.push({
    id:it.id, name:it.name, unitKey:m.name, unitLabel:m.name, gramsPerUnit,
    qty, grams, carbs_raw, fiber_g, cal_kcal, gi, gl, imageUrl:it.imageUrl
  });
  renderMeal();
}

/* ===== Meal table ===== */
function renderMeal(){
  if(!els.mealBody) return;
  els.mealBody.innerHTML = mealItems.map((x,i)=> rowHTML(x,i)).join("");
  mealItems.forEach((x,i)=>{
    $("#u_"+i)?.addEventListener("change", e => onUnitChange(i, Number(e.target.value||1)));
    $("#q_"+i)?.addEventListener("input", e => onQtyChange(i, Number(e.target.value||0)));
    $("#rm_"+i)?.addEventListener("click", ()=>{ mealItems.splice(i,1); renderMeal(); });
  });
  computeAndRenderTotals();
}
function rowHTML(x,i){
  const lib = libraryAll.find(t=>t.id===x.id);
  const opts = (lib?.measures || [{name:"جم", grams:1}])
    .map(m=>`<option value="${m.grams}" ${Number(x.gramsPerUnit)===Number(m.grams)?"selected":""}>${m.name}</option>`).join("");
  return `
  <tr>
    <td><img class="thumb" src="${x.imageUrl||"images/placeholder.png"}"/></td>
    <td class="td-name">${x.name}</td>
    <td><select id="u_${i}">${opts}</select></td>
    <td><input id="q_${i}" type="number" step="0.1" value="${x.qty}"></td>
    <td>${fmt(x.grams,0)}</td>
    <td>${fmt(x.carbs_raw,1)}</td>
    <td>${fmt(x.fiber_g,1)}</td>
    <td>${x.gi||"—"}</td>
    <td>${fmt(x.gl,1)}</td>
    <td><button id="rm_${i}" class="ic danger">✖</button></td>
  </tr>`;
}
function onUnitChange(i, gramsPerUnit){ const x=mealItems[i]; x.gramsPerUnit=gramsPerUnit; recalcRow(x); renderMeal(); }
function onQtyChange(i,qty){ const x=mealItems[i]; x.qty=qty; recalcRow(x); renderMeal(); }
function recalcRow(x){
  x.grams = x.qty * x.gramsPerUnit;
  const lib = libraryAll.find(t=>t.id===x.id)||{};
  const carbs100=lib.carbs100||0, fiber100=lib.fiber100||0, cal100=lib.cal100||0, gi=lib.gi||0;
  x.carbs_raw=(carbs100/100)*x.grams; x.fiber_g=(fiber100/100)*x.grams; x.cal_kcal=(cal100/100)*x.grams;
  x.gi=gi; x.gl= gi? gi*(x.carbs_raw/100):0;
}

/* ===== Computations ===== */
function computeAndRenderTotals(){
  const carbsRaw = mealItems.reduce((a,x)=>a+x.carbs_raw,0);
  const fiber    = mealItems.reduce((a,x)=>a+x.fiber_g,0);
  const cal      = mealItems.reduce((a,x)=>a+x.cal_kcal,0);
  const glTotal  = mealItems.reduce((a,x)=>a+x.gl,0);

  const rule = els.netCarbRule?.value || "fullFiber";
  const factor = rule==="none"?0: rule==="halfFiber"?0.5:1;
  const carbsNet = Math.max(0, carbsRaw - factor*fiber);

  const sumGICarb = mealItems.reduce((a,x)=>a+(x.gi||0)*(x.carbs_raw||0),0);
  const giAvg = carbsRaw>0 ? (sumGICarb / carbsRaw) : 0;

  const cr = crForSlot(slotKey)||0;
  const doseCarbs = cr ? (carbsNet / cr) : 0;

  // correction dose per rule: (BG>10.9) => (BG-7)/CF , 0.5 step
  const bg = Number(els.preBg?.value || 0);
  let doseCorr = Number(els.doseCorrection?.value || 0);
  if(bg && bg > Number(targets.severeHigh ?? 10.9) && cf){
    doseCorr = (bg - Number(targets.max ?? 7)) / cf;
  }
  doseCorr = roundTo(Math.max(0,doseCorr), 0.5);
  if(els.doseCorrection) els.doseCorrection.value = doseCorr? doseCorr.toFixed(1):"";

  const totalDose = roundTo(doseCarbs + doseCorr, 0.5);

  // progress
  const slotName = slotKeyToName(slotKey);
  const r = carbRanges?.[slotName] || {};
  const min=Number(r.min ?? 0), max=Number(r.max ?? 0);
  let pct=0; if(max>0) pct = clamp((carbsNet/max)*100, 0, 100);
  if(els.progressBar){
    els.progressBar.style.width = `${pct}%`;
    els.progressBar.className = "bar " + (carbsNet<min ? "warn" : carbsNet>max ? "danger" : "ok");
  }
  els.progressLabel && (els.progressLabel.textContent = `${fmt(carbsNet,0)} / ${max||"—"} g`);

  // sums
  els.sumCarbsRaw && (els.sumCarbsRaw.textContent = fmt(carbsRaw,1));
  els.sumFiber    && (els.sumFiber.textContent    = fmt(fiber,1));
  els.sumCarbsNet && (els.sumCarbsNet.textContent = fmt(carbsNet,1));
  els.sumCal      && (els.sumCal.textContent      = fmt(cal,0));
  els.sumGL       && (els.sumGL.textContent       = fmt(glTotal,1));
  els.sumGI       && (els.sumGI.textContent       = giAvg?fmt(giAvg,0):"—");

  els.doseCarbs && (els.doseCarbs.value = doseCarbs?doseCarbs.toFixed(1):"");
  els.doseTotal && (els.doseTotal.textContent = totalDose? totalDose.toFixed(1) : "—");
}
function updateDoseTotal(){
  const doseC   = Number(els.doseCarbs?.value||0);
  const doseCorr= Number(els.doseCorrection?.value||0);
  els.doseTotal && (els.doseTotal.textContent = roundTo(doseC+doseCorr,0.5).toFixed(1));
}

/* ===== Scaling to target ===== */
function scaleToTarget(){
  const slotName = slotKeyToName(slotKey);
  const r = carbRanges?.[slotName] || {};
  const tgt = ((Number(r.min||0)+Number(r.max||0))/2) || 0;
  const curr= Number(els.sumCarbsNet?.textContent||0);
  if(!tgt || !curr) return;
  const factor = tgt / curr;
  mealItems.forEach(x=>{ x.qty = Number((x.qty*factor).toFixed(2)); recalcRow(x); });
  renderMeal();
}

/* ===== Fetch pre reading ===== */
async function fetchPreReading(){
  if(!els.preBg) return;
  const coll = collection(db, `parents/${parentId}/children/${childId}/measurements`);
  const preKey = `PRE_${slotKeyToName(slotKey).toUpperCase()}`; // PRE_LUNCH...
  // 1) نفس اليوم والسلوط
  const snaps = await getDocs(query(coll, where("slotKey","==", preKey)));
  let candidates = snaps.docs.map(d=>({id:d.id, ...d.data()}))
    .filter(x => x.when && ymd(x.when.toDate ? x.when.toDate() : new Date(x.when)) === dateKey);
  // 2) بديل: آخر 90 دقيقة قبل وقت الوجبة
  if(!candidates.length){
    const mealDate = new Date(`${dateKey}T${mealTimeStr||"13:00"}:00`);
    const start = new Date(mealDate.getTime()-90*60000);
    const end   = mealDate;
    const all   = await getDocs(coll);
    candidates = all.docs.map(d=>({id:d.id, ...d.data()}))
      .filter(x=>{
        const t=x.when?.toDate?x.when.toDate(): (x.when?new Date(x.when):null);
        return t && t>=start && t<=end;
      });
  }
  if(candidates.length){
    candidates.sort((a,b)=> (a.when?.seconds||0)-(b.when?.seconds||0));
    const last = candidates[candidates.length-1];
    const bg = Number(last.value_mmol ?? last.value ?? 0);
    els.preBg.value = bg ? bg.toFixed(1) : "";
  }
  computeAndRenderTotals();
}

/* ===== Slot/Date changes ===== */
function onSlotChange(){
  slotKey = els.slotSelect.value;
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";
  els.mealTime && (els.mealTime.value = mealTimeStr);
  updateCRChip(); updateTargetUI(); computeAndRenderTotals();
  tryLoadExistingMeal(); // مهم جداً
}
async function onDateChange(){
  dateKey = els.dateInput.value;
  await loadDayTotals();
  await tryLoadExistingMeal();
}

/* ===== Save/Load templates & meal ===== */
async function saveMeal(){
  const docData = {
    date:dateKey, slotKey,
    type: slotMap[slotKey]?.ar || "",
    preBg_mmol: Number(els.preBg?.value||0)||null,
    netCarbRuleUsed: els.netCarbRule?.value || "fullFiber",
    doseCarbs: Number(els.doseCarbs?.value||0)||0,
    doseCorrection: Number(els.doseCorrection?.value||0)||0,
    doseTotal: Number(els.doseTotal?.textContent||0)||0,
    totals:{
      carbs_raw:  Number(els.sumCarbsRaw?.textContent||0),
      fiber_g:    Number(els.sumFiber?.textContent||0),
      carbs_net:  Number(els.sumCarbsNet?.textContent||0),
      cal_kcal:   Number(els.sumCal?.textContent||0),
      gi_avg:     (els.sumGI?.textContent==="—")?null:Number(els.sumGI?.textContent||0),
      gl_total:   Number(els.sumGL?.textContent||0)
    },
    items: mealItems.map(x=>({
      itemId:x.id, name:x.name,
      unitKey:x.unitKey, unitLabel:x.unitLabel, gramsPerUnit:x.gramsPerUnit,
      qty:x.qty, grams:x.grams, carbs_raw:x.carbs_raw, fiber_g:x.fiber_g,
      carbs_g:x.carbs_raw, cal_kcal:x.cal_kcal, gi:x.gi||null, gl:x.gl||null,
      imageUrl:x.imageUrl||null
    })),
    updatedAt: Timestamp.now()
  };
  const id=`${dateKey}_${slotKey}`;
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/meals/${id}`), docData, {merge:true});
  alert("تم حفظ الوجبة ✅");
  await loadDayTotals();
}
async function saveTemplate(){
  const out = {
    createdAt: new Date().toISOString(),
    items: mealItems.map(x=>({
      itemId:x.id, grams:x.grams, measure:x.unitLabel,
      calc:{carbs:x.carbs_raw, fiber:x.fiber_g, gi:x.gi||0, gl:x.gl||0, cal:x.cal_kcal}
    }))
  };
  const id=`tmpl_${Date.now()}`;
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/presetMeals/${id}`), out);
  alert("تم حفظ القالب ✅");
}
async function importFromTemplates(){
  const coll = collection(db, `parents/${parentId}/children/${childId}/presetMeals`);
  const snaps = await getDocs(coll);
  if(snaps.empty){ alert("لا توجد قوالب محفوظة."); return; }
  // استخدم الأحدث
  let latest=snaps.docs[0];
  snaps.forEach(d=>{ if((d.data().createdAt||"")>(latest.data().createdAt||"")) latest=d; });
  const t = latest.data();
  (t.items||[]).forEach(it=>{
    const lib = libraryAll.find(x=>x.id === (it.itemId||it.id)); if(!lib) return;
    const grams = Number(it.grams||0);
    const first = lib.measures[0] || {name:"جم", grams:1};
    const qty = grams && first.grams ? (grams/(first.grams)) : 1;
    const carbs_raw=(lib.carbs100/100)*grams, fiber_g=(lib.fiber100/100)*grams, cal_kcal=(lib.cal100/100)*grams;
    const gi=lib.gi||0, gl= gi? gi*(carbs_raw/100):0;

    mealItems.push({
      id:lib.id, name:lib.name, unitKey:first.name, unitLabel:first.name,
      gramsPerUnit:first.grams, qty, grams, carbs_raw, fiber_g, cal_kcal, gi, gl, imageUrl:lib.imageUrl
    });
  });
  renderMeal();
}

/* ===== Favorites save ===== */
async function saveFavs(){
  await updateDoc(doc(db, `parents/${parentId}/children/${childId}`), { favorites, disliked });
  alert("تم حفظ المفضلة/غير المفضلة ✅");
}

/* ===== Export CSV ===== */
function exportCSV(){
  const rows = [
    ["التاريخ", dateKey, "الوجبة", slotMap[slotKey]?.ar || slotKey], [],
    ["الصنف","الوحدة","الكمية","جرام","كارب(raw)","ألياف","Net Rule","GI","GL","سعرات"]
  ];
  const rule=els.netCarbRule?.value;
  mealItems.forEach(x=>{
    rows.push([x.name,x.unitLabel,x.qty,x.grams,x.carbs_raw,x.fiber_g,rule,x.gi||"",x.gl||"",x.cal_kcal]);
  });
  rows.push([]);
  rows.push(["Carbs(raw)",els.sumCarbsRaw?.textContent,"Fiber",els.sumFiber?.textContent,"Net",els.sumCarbsNet?.textContent,"Calories",els.sumCal?.textContent,"GI(avg)",els.sumGI?.textContent,"GL",els.sumGL?.textContent]);
  rows.push(["DoseCarbs",els.doseCarbs?.value,"DoseCorrection",els.doseCorrection?.value,"DoseTotal",els.doseTotal?.textContent]);

  const csv = rows.map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`meal_${dateKey}_${slotKey}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ===== Modal helpers ===== */
function openLibModal(){ els.libModal?.classList.add("open"); }
function closeLibModal(){ els.libModal?.classList.remove("open"); }
