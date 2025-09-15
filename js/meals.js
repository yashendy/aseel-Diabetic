// js/meals.js — صفحة الوجبات (Light + Firebase + AI)
// — إصلاحات مهمة —
// 1) مسارات صحيحة + Imports موحّدة
// 2) انتظار الـ Auth بشكل آمن قبل استخدام Firestore
// 3) استخدام addDoc بدلاً من doc(collection(...)) لتفادي خطأ collection()
// 4) Logs واضحة في حال نقص child/parent أو db

import { auth, db } from "./firebase-config.js";
import { MealAI } from "./ai.js";

import {
  doc, getDoc, collection, getDocs, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =================== عناصر DOM =================== */
const qs  = (s)=>document.querySelector(s);
const qsa = (s)=>Array.from(document.querySelectorAll(s));

const backBtn = qs("#backBtn");

const kidNameEl = qs("#kidName") || qs("#childName"); // دعم اسمين قديمين
const pillCR    = qs("#pillCR") || qs("#crPill");
const pillCF    = qs("#pillCF") || qs("#cfPill");
const pillTarget= qs("#pillTarget") || qs("#targetPill");

const glucoseUnitPill = qs("#glucoseUnitPill") || qs("#unitBadge");
const unitBadge       = qs("#unitBadge") || qs("#glucoseUnitPill");

const glucoseNow   = qs("#glucoseNow");
const mealType     = qs("#mealType");
const crInput      = qs("#crInput");
const cfInput      = qs("#cfInput");
const targetGlucose= qs("#targetGlucose");

const carbMin = qs("#carbMin");
const carbMax = qs("#carbMax");
const carbProgress = qs("#carbProgress");
const rangeState   = qs("#rangeState");
const fitToRangeBtn= qs("#fitToRangeBtn");

const dietHalal   = qs("#dietHalal");
const dietVeg     = qs("#dietVeg");
const dietLowCarb = qs("#dietLowCarb");
const dietLowFat  = qs("#dietLowFat");
const dietLowSod  = qs("#dietLowSod");

const allergiesInput = qs("#allergiesInput");
const likesInput     = qs("#likesInput");
const dislikesInput  = qs("#dislikesInput");
const allergiesChips = qs("#allergiesChips");
const likesChips     = qs("#likesChips");
const dislikesChips  = qs("#dislikesChips");

const openLibraryBtn = qs("#openLibraryBtn");
const aiSuggestBtn   = qs("#aiSuggestBtn");
const openPresetsBtn = qs("#openPresetsBtn");
const saveMealBtn    = qs("#saveMealBtn");
const mealName       = qs("#mealName");

const libraryModal = qs("#libraryModal");
const libraryGrid  = qs("#libraryGrid");
const presetsModal = qs("#presetsModal");
const presetsList  = qs("#presetsList");

const itemsBody       = qs("#itemsBody");
const totalCarbsCell  = qs("#totalCarbsCell");
const totalCarbsEl    = qs("#totalCarbs");
const mealDoseEl      = qs("#mealDose");
const corrDoseEl      = qs("#corrDose");
const totalDoseEl     = qs("#totalDose");

/* =================== حالة الصفحة =================== */
let parentId=null, childId=null, childDoc=null;
let items=[];      // [{name, unit, gramsPerUnit, carbsPer100, carbsPerUnit, qty, grams, carbs}]
let library=[];    // من admin/global/foodItems
let presets=[];

const state = {
  unit: "mg/dL",
  prefs: {
    diet: { halal:false, veg:false, lowcarb:false, lowfat:false, lowsod:false },
    allergies: [], likes: [], dislikes: []
  },
  ratios: { cr: { default:10, byMeal:{} }, cf: { default:50, byMeal:{} } },
  carbTargets: { breakfast:{}, lunch:{}, dinner:{}, snack:{} }
};

/* =================== Utils =================== */
const ensureNum = v => (typeof v==="number" && !Number.isNaN(v)) ? v : 0;
const sum = arr => arr.reduce((a,b)=>a+ensureNum(b),0);
const round2 = n => Math.round(n*100)/100;
const fmtDose= n => (Math.round(n*20)/20).toFixed(2); // 0.05U

function chipify(inputEl, listEl, onChange){
  const addChip = (txt)=>{
    const t=(txt||"").trim(); if(!t) return;
    const chip=document.createElement("span"); chip.className="chip"; chip.textContent=t;
    const x=document.createElement("span"); x.className="x"; x.textContent="×";
    x.onclick=()=>{ listEl.removeChild(chip); onChange(getValues()); };
    chip.appendChild(x); listEl.appendChild(chip);
  };
  const getValues = ()=> Array.from(listEl.querySelectorAll(".chip"))
    .map(c=>c.childNodes[0].nodeValue.trim()).filter(Boolean);
  if(inputEl){
    inputEl.addEventListener("keydown",e=>{
      if(e.key==="Enter"){ e.preventDefault(); addChip(inputEl.value); inputEl.value=""; onChange(getValues()); }
    });
  }
  return { addChip, getValues };
}
const allergiesCh = chipify(allergiesInput, allergiesChips, v => state.prefs.allergies=v);
const likesCh     = chipify(likesInput,     likesChips,   v => state.prefs.likes=v);
const dislikesCh  = chipify(dislikesInput,  dislikesChips,v => state.prefs.dislikes=v);

/* =================== Boot =================== */
init().catch(err=>{
  console.error("Init error", err);
  alert("تعذّر تشغيل الصفحة. راجع الـ Console.");
});

async function waitForUser(){
  return new Promise(resolve=>{
    const unsub = auth.onAuthStateChanged(u=>{ unsub(); resolve(u||null); });
  });
}

async function init(){
  // تأكيد db
  if(!db){ console.error("Firestore db غير مُهيأ"); alert("لم يتم تهيئة Firestore."); return; }

  // params
  const url = new URL(location.href);
  childId  = url.searchParams.get("child");
  parentId = url.searchParams.get("parent") || null;

  // user
  const user = await waitForUser();
  if(!user){ alert("يرجى تسجيل الدخول"); return; }
  if(!parentId) parentId = user.uid;

  if(!childId){ alert("المعطيات ناقصة: child"); return; }

  if(backBtn) backBtn.onclick = ()=> history.length>1 ? history.back() : (location.href = "child.html");

  // تحميل الداتا
  await loadChild();
  await loadLibrary();
  await loadPresets();

  // ربط الأحداث
  wireEvents();

  // بداية
  renderItems();
  recalcAll();
}

/* =================== تحميل بيانات الطفل =================== */
async function loadChild(){
  const cRef = doc(db, "parents", parentId, "children", childId);
  const snap = await getDoc(cRef);
  if(!snap.exists()){ alert("لم يتم العثور على بيانات الطفل"); return; }
  childDoc = snap.data();

  // هيدر
  if(kidNameEl) kidNameEl.textContent = childDoc.name || "طفل";
  state.unit = childDoc.glucoseUnit || "mg/dL";
  if(glucoseUnitPill) glucoseUnitPill.textContent = state.unit;
  if(unitBadge) unitBadge.textContent = state.unit;

  // نسب
  state.ratios.cr.default = ensureNum(childDoc.carbRatio ?? childDoc.ratios?.cr?.default);
  state.ratios.cf.default = ensureNum(childDoc.correctionFactor ?? childDoc.ratios?.cf?.default);
  state.ratios.cr.byMeal  = childDoc.ratios?.cr?.byMeal || {};
  state.ratios.cf.byMeal  = childDoc.ratios?.cf?.byMeal || {};

  // نطاقات
  state.carbTargets = childDoc.carbTargets || state.carbTargets;

  // تفضيلات
  state.prefs.diet = Object.assign(state.prefs.diet, childDoc.diet || {});
  (childDoc.allergies || []).forEach(allergiesCh.addChip);
  (childDoc.likes     || []).forEach(likesCh.addChip);
  (childDoc.dislikes  || []).forEach(dislikesCh.addChip);

  if(dietHalal)   dietHalal.checked   = !!state.prefs.diet.halal;
  if(dietVeg)     dietVeg.checked     = !!state.prefs.diet.veg;
  if(dietLowCarb) dietLowCarb.checked = !!state.prefs.diet.lowcarb;
  if(dietLowFat)  dietLowFat.checked  = !!state.prefs.diet.lowfat;
  if(dietLowSod)  dietLowSod.checked  = !!state.prefs.diet.lowsod;

  applyRatiosForMeal();
  applyRangeForMeal();
}

/* =================== مكتبة الأطعمة =================== */
async function loadLibrary(){
  try{
    const col = collection(db, "admin", "global", "foodItems");
    const snap = await getDocs(col);
    library = snap.docs.map(d => adaptFoodItem({ id:d.id, ...d.data() }));
  }catch(e){
    console.error("loadLibrary error:", e, {db});
    alert("تعذّر تحميل مكتبة الأصناف.");
  }
}

function adaptFoodItem(f){
  const out = {
    id: f.id, name: f.name || f.arName || "صنف",
    brand: f.brand || null,
    imageUrl: f.imageUrl || f.image || "",
    unit: f.unit || (Array.isArray(f.measures)&&f.measures[0]?.name) || (f.measureQty?.name) || "وحدة",
    gramsPerUnit: ensureNum((Array.isArray(f.measures)&&f.measures[0]?.grams) || f.measureQty?.grams || 0),
    carbsPerUnit: (typeof f.carbsPerUnit==="number" ? f.carbsPerUnit : (typeof f.carbs_g==="number"? f.carbs_g : null)),
    carbsPer100: (typeof f.nutrPer100g?.carbs==="number" ? f.nutrPer100g.carbs : (typeof f.carbsPer100==="number" ? f.carbsPer100 : null)),
    tags: Array.isArray(f.tags) ? f.tags : []
  };
  return out;
}

/* =================== Presets (تحميل بسيط) =================== */
async function loadPresets(){
  try{
    const col = collection(db, "parents", parentId, "children", childId, "presetMeals");
    const snap = await getDocs(col);
    presets = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  }catch(e){
    console.warn("loadPresets error:", e);
  }
}

/* =================== أحداث =================== */
function wireEvents(){
  if(mealType) mealType.onchange = ()=>{ applyRatiosForMeal(); applyRangeForMeal(); recalcAll(); };
  [glucoseNow, crInput, cfInput, targetGlucose].forEach(el => el && el.addEventListener("input", recalcAll));
  [carbMin, carbMax].forEach(el => el && el.addEventListener("input", recalcProgress));

  if(fitToRangeBtn) fitToRangeBtn.onclick = onFitToRange;

  if(dietHalal)   dietHalal.onchange   = ()=> state.prefs.diet.halal   = dietHalal.checked;
  if(dietVeg)     dietVeg.onchange     = ()=> state.prefs.diet.veg     = dietVeg.checked;
  if(dietLowCarb) dietLowCarb.onchange = ()=> state.prefs.diet.lowcarb = dietLowCarb.checked;
  if(dietLowFat)  dietLowFat.onchange  = ()=> state.prefs.diet.lowfat  = dietLowFat.checked;
  if(dietLowSod)  dietLowSod.onchange  = ()=> state.prefs.diet.lowsod  = dietLowSod.checked;

  if(openLibraryBtn) openLibraryBtn.onclick = showLibrary;
  if(openPresetsBtn) openPresetsBtn.onclick = showPresets;
  if(aiSuggestBtn)   aiSuggestBtn.onclick   = onAISuggest;
  if(saveMealBtn)    saveMealBtn.onclick    = onSaveMeal;

  qsa("[data-close]").forEach(btn=> btn.addEventListener("click", e=> e.target.closest("dialog")?.close()));
  window.addEventListener("keydown", e=>{
    if(e.key==="Escape"){ libraryModal?.close(); presetsModal?.close(); }
  });
}

/* =================== نسب/نطاق =================== */
function applyRatiosForMeal(){
  const t = mealType?.value || "breakfast";
  const cr = state.ratios.cr.byMeal?.[t] ?? state.ratios.cr.default ?? 10;
  const cf = state.ratios.cf.byMeal?.[t] ?? state.ratios.cf.default ?? 50;

  if(crInput) crInput.value = String(cr);
  if(cfInput) cfInput.value = String(cf);

  const target = childDoc?.normalRange?.min ?? 110;
  if(targetGlucose && !targetGlucose.value) targetGlucose.value = String(target);

  if(pillCR) pillCR.textContent = cr;
  if(pillCF) pillCF.textContent = cf;
  if(pillTarget) pillTarget.textContent = targetGlucose?.value || target;
}

function applyRangeForMeal(){
  const t = mealType?.value || "breakfast";
  const rng = state.carbTargets?.[t] || {};
  if(carbMin) carbMin.value = rng.min ?? "";
  if(carbMax) carbMax.value = rng.max ?? "";
  recalcProgress();
}

/* =================== عناصر الوجبة =================== */
function renderItems(){
  if(!itemsBody) return;
  itemsBody.innerHTML = "";
  items.forEach((r, i)=>{
    const tr=document.createElement("tr");

    // حذف
    const tdDel=document.createElement("td");
    const delBtn=document.createElement("button");
    delBtn.className="btn ghost"; delBtn.textContent="🗑";
    delBtn.onclick=()=>{ items.splice(i,1); renderItems(); recalcAll(); };
    tdDel.appendChild(delBtn);

    // الاسم
    const tdName=document.createElement("td");
    tdName.textContent = r.name || "-";

    // الكمية
    const tdQty=document.createElement("td");
    const qty=document.createElement("input");
    qty.type="number"; qty.step="0.25"; qty.value=r.qty ?? 0; qty.inputMode="decimal";
    const unit=document.createElement("span"); unit.textContent=" "+(r.unit||"وحدة");
    qty.oninput=()=>{
      r.qty = Number(qty.value||0);
      r.grams = round2(r.qty * (r.gramsPerUnit||0));
      r.carbs = calcCarbs(r);
      updateTotals();
    };
    tdQty.append(qty, unit);

    // الجرام
    const tdGr=document.createElement("td");
    const grams=document.createElement("input");
    grams.type="number"; grams.step="1"; grams.value=r.grams ?? 0; grams.inputMode="decimal";
    grams.oninput=()=>{
      r.grams = Number(grams.value||0);
      r.qty = (r.gramsPerUnit ? round2(r.grams/(r.gramsPerUnit||1)) : r.qty);
      r.carbs = calcCarbs(r);
      updateTotals();
    };
    tdGr.appendChild(grams);

    // الكارب
    const tdCarb=document.createElement("td");
    tdCarb.textContent = String(r.carbs ?? 0);

    tr.append(tdDel, tdName, tdQty, tdGr, tdCarb);
    itemsBody.appendChild(tr);
  });
  updateTotals();
}

function updateTotals(){
  const t = totalCarbs();
  if(totalCarbsCell) totalCarbsCell.textContent = t.toFixed(1);
  if(totalCarbsEl)   totalCarbsEl.textContent   = t.toFixed(1);
  // تحديث عمود الكارب لكل صف
  Array.from(itemsBody?.rows || []).forEach((tr, i)=>{
    const td = tr.cells[4]; if(td) td.textContent = (items[i].carbs ?? 0).toFixed(1);
  });
  recalcAll();
}

function calcCarbs(row){
  if (row.carbsPerUnit != null) return round2((row.qty ?? 0) * row.carbsPerUnit);
  return round2((row.grams ?? 0) * (row.carbsPer100 ?? 0) / 100);
}
function totalCarbs(){ return sum(items.map(r=>ensureNum(r.carbs))); }

/* =================== التقدّم/النطاق =================== */
function recalcProgress(){
  if(!carbProgress || !rangeState) return;
  const t = totalCarbs();
  const min = Number(carbMin?.value || 0);
  const max = Number(carbMax?.value || 0);

  let pct = 0;
  if (max > min) pct = Math.min(100, Math.max(0, (t - min) / (max - min) * 100));
  carbProgress.style.width = pct + "%";

  let cls="out", text="خارج النطاق";
  if (t>=min && t<=max){ cls="ok"; text="داخل النطاق"; }
  else if (Math.abs(t-min)<=5 || Math.abs(t-max)<=5){ cls="near"; text="قريب من النطاق"; }

  rangeState.className = "state " + cls;
  rangeState.textContent = text;
}

/* =================== الحسابات =================== */
function recalcAll(){
  const tCarb = totalCarbs();
  const CR = Number(crInput?.value || 10);
  const CF = Number(cfInput?.value || 50);
  const target = Number(targetGlucose?.value || 110);
  const gNow = Number(glucoseNow?.value || 0);

  const mealDose = tCarb / CR;
  const corrDose = Math.max(0, (gNow - target) / CF);
  const total = mealDose + corrDose;

  if(mealDoseEl) mealDoseEl.textContent = fmtDose(mealDose);
  if(corrDoseEl) corrDoseEl.textContent = fmtDose(corrDose);
  if(totalDoseEl) totalDoseEl.textContent = fmtDose(total);

  recalcProgress();
}

/* =================== مودال المكتبة =================== */
function showLibrary(){
  if(!libraryModal || !libraryGrid){ alert("المكتبة غير مهيأة في الصفحة"); return; }
  libraryGrid.innerHTML = "";

  // فلترة حسب التفضيلات
  const prefs = state.prefs;
  const filtered = library.filter(f=>{
    const hay = [f.name, f.brand, ...(f.tags||[])].join(" ").toLowerCase();
    const bad = [...prefs.allergies, ...prefs.dislikes].some(x=> hay.includes(String(x).toLowerCase()));
    if (bad) return false;
    if (prefs.diet.halal && f.tags?.includes("not-halal")) return false;
    if (prefs.diet.veg   && !(f.tags?.includes("veg") || f.tags?.includes("vegan"))) return false;
    if (prefs.diet.lowcarb && (f.carbsPerUnit ?? f.carbsPer100 ?? 0) > 15) return false;
    if (prefs.diet.lowfat  && f.tags?.includes("high-fat")) return false;
    if (prefs.diet.lowsod  && f.tags?.includes("high-sodium")) return false;
    return true;
  });

  filtered.forEach(f=>{
    const card=document.createElement("div"); card.className="food-card";
    const img=document.createElement("img"); img.src=f.imageUrl || "./images/food-placeholder.png"; img.alt=f.name||"صنف";
    const meta=document.createElement("div"); meta.className="meta";
    const carbText = f.carbsPerUnit!=null ? `${f.carbsPerUnit}g كارب/وحدة` :
                      (f.carbsPer100!=null ? `${f.carbsPer100}g لكل 100جم` : "?");
    meta.innerHTML = `
      <div><b>${f.name || "-"}</b> ${f.brand ? `<span class="pill">${f.brand}</span>` : ""}</div>
      <div class="muted">${(f.unit || "وحدة")} • ${f.gramsPerUnit ?? 0} جم/وحدة • ${carbText}</div>
    `;
    card.onclick=()=>{
      const row = {
        itemId:f.id, name:f.name, brand:f.brand,
        unit:f.unit||"وحدة", gramsPerUnit:ensureNum(f.gramsPerUnit||0),
        carbsPer100: f.carbsPer100!=null ? ensureNum(f.carbsPer100) : null,
        carbsPerUnit: f.carbsPerUnit!=null ? ensureNum(f.carbsPerUnit) : null,
        qty:1
      };
      row.grams = round2(row.qty * (row.gramsPerUnit||0));
      row.carbs = calcCarbs(row);
      items.push(row);
      renderItems();
    };
    card.append(img, meta);
    libraryGrid.appendChild(card);
  });

  libraryModal.showModal();
}

/* =================== Presets (عرض مبسّط) =================== */
function showPresets(){
  if(!presetsModal || !presetsList){ return; }
  presetsList.innerHTML = "";
  if (!presets.length){
    presetsList.innerHTML = `<div class="muted" style="padding:8px">لا توجد وجبات محفوظة بعد</div>`;
  }
  presets.forEach(p=>{
    const el=document.createElement("div"); el.className="preset-item";
    el.innerHTML = `
      <div>
        <div><b>${p.name || "بدون اسم"}</b></div>
        <small>${p.mealType || "-"} • نطاق ${p.targetRange?.min ?? "-"}–${p.targetRange?.max ?? "-"}</small>
      </div>
      <div>
        <button class="btn" data-load>تحميل</button>
      </div>
    `;
    el.querySelector("[data-load]").onclick=()=>{
      items=(p.items||[]).map(x=>({...x}));
      renderItems();
      if (p.mealType && mealType){ mealType.value=p.mealType; applyRatiosForMeal(); }
      if (p.targetRange){ if(carbMin) carbMin.value=p.targetRange.min ?? ""; if(carbMax) carbMax.value=p.targetRange.max ?? ""; }
      presetsModal.close();
    };
    presetsList.appendChild(el);
  });
  presetsModal.showModal();
}

/* =================== AI =================== */
async function onAISuggest(){
  const prefs = state.prefs;
  const currentItems = items.map(it=>({
    name:it.name, brand:it.brand, qty:it.qty, unit:it.unit, carbs_g:it.carbsPerUnit
  }));
  const res = await MealAI.suggestAlternatives({
    itemsLibrary: library.map(f=>({
      name:f.name, brand:f.brand, carbs_g: f.carbsPerUnit ?? f.carbsPer100, tags:f.tags||[]
    })),
    currentItems, prefs
  });
  alert((res.type==="gemini" ? "اقتراحات Gemini:\n\n" : "اقتراحات مناسبة:\n\n") + res.text);
}

function onFitToRange(){
  const min = Number(carbMin?.value || 0);
  const max = Number(carbMax?.value || 0);
  const t = totalCarbs();
  items = MealAI.adjustToRange({
    items: items.map(r=>({...r})), totalCarbs: t, min, max
  }).map(r=>{
    r.grams = round2((r.qty ?? 0) * (r.gramsPerUnit ?? 0));
    r.carbs = calcCarbs(r);
    return r;
  });
  renderItems();
}

/* =================== حفظ الوجبة =================== */
async function onSaveMeal(){
  if(!parentId || !childId){ alert("لا يوجد معرّف للطفل/الوالد"); return; }
  try{
    const mealsCol = collection(db, "parents", parentId, "children", childId, "meals");
    const data = {
      createdAt: serverTimestamp(),
      date: new Date().toISOString().slice(0,10),
      items: items.map(i=>({
        name:i.name, brand:i.brand, unit:i.unit,
        gramsPerUnit:i.gramsPerUnit, carbsPer100:i.carbsPer100, carbsPerUnit:i.carbsPerUnit,
        qty:i.qty, grams:i.grams, carbs:i.carbs
      })),
      totals:{ carbs: totalCarbs() },
      ratios:{ CR: Number(crInput?.value||0), CF: Number(cfInput?.value||0) },
      glucose:{ now:Number(glucoseNow?.value||0), target:Number(targetGlucose?.value||0), unit: state.unit },
      dose:{
        meal:Number(mealDoseEl?.textContent||0),
        correction:Number(corrDoseEl?.textContent||0),
        total:Number(totalDoseEl?.textContent||0)
      },
      mealType: mealType?.value || "breakfast",
      targetRange:{
        min: carbMin?.value ? Number(carbMin.value) : null,
        max: carbMax?.value ? Number(carbMax.value) : null
      },
      dietSnapshot:{
        diet: state.prefs.diet,
        allergies: allergiesCh.getValues(),
        likes: likesCh.getValues(),
        dislikes: dislikesCh.getValues()
      },
      name: mealName?.value || null
    };
    await addDoc(mealsCol, data); // ✅ آمن وبسيط
    alert("تم حفظ الوجبة ✅");
  }catch(e){
    console.error("save error:", e);
    alert("تعذّر الحفظ. راجع Console.");
  }
}

/* =================== ربط أزرار =================== */
if(aiSuggestBtn)   aiSuggestBtn.addEventListener("click", onAISuggest);
if(fitToRangeBtn)  fitToRangeBtn.addEventListener("click", onFitToRange);
if(saveMealBtn)    saveMealBtn.addEventListener("click", onSaveMeal);
