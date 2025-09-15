// js/meals.js — صفحة الوجبات (Light + Modules + Firestore + AI)

// Firebase config (مُهيّأ مسبقًا داخل js/firebase-config.js)
import { auth, db } from "./firebase-config.js";

// نحتاج دوال Firestore
import {
  doc, getDoc, collection, getDocs, addDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// ذكاء اصطناعي (لو عندك ملف ai.js في نفس المجلد)
import { MealAI } from "./ai.js";

// =============== عناصر DOM ===============
const qs = (s)=>document.querySelector(s);
const qsa = (s)=>Array.from(document.querySelectorAll(s));

const backBtn = qs("#backBtn");

const kidNameEl = qs("#kidName");
const kidMetaEl = qs("#kidMeta");
const pillCR = qs("#pillCR");
const pillCF = qs("#pillCF");
const pillTarget = qs("#pillTarget");
const glucoseUnitPill = qs("#glucoseUnitPill");
const unitBadge = qs("#unitBadge");

const glucoseNow = qs("#glucoseNow");
const mealType = qs("#mealType");
const crInput = qs("#crInput");
const cfInput = qs("#cfInput");
const targetGlucose = qs("#targetGlucose");

const carbMin = qs("#carbMin");
const carbMax = qs("#carbMax");
const carbProgress = qs("#carbProgress");
const rangeState = qs("#rangeState");
const fitToRangeBtn = qs("#fitToRangeBtn");

const dietHalal = qs("#dietHalal");
const dietVeg = qs("#dietVeg");
const dietLowCarb = qs("#dietLowCarb");
const dietLowFat = qs("#dietLowFat");
const dietLowSod = qs("#dietLowSod");

const allergiesInput = qs("#allergiesInput");
const likesInput = qs("#likesInput");
const dislikesInput = qs("#dislikesInput");
const allergiesChips = qs("#allergiesChips");
const likesChips = qs("#likesChips");
const dislikesChips = qs("#dislikesChips");

const openLibraryBtn = qs("#openLibraryBtn");
const aiSuggestBtn = qs("#aiSuggestBtn");
const openPresetsBtn = qs("#openPresetsBtn");
const saveMealBtn = qs("#saveMealBtn");
const mealName = qs("#mealName");

const libraryModal = qs("#libraryModal");
const libraryGrid = qs("#libraryGrid");
const presetsModal = qs("#presetsModal");
const presetsList = qs("#presetsList");

const itemsBody = qs("#itemsBody");
const totalCarbsCell = qs("#totalCarbsCell");
const totalCarbsEl = qs("#totalCarbs");
const mealDoseEl = qs("#mealDose");
const corrDoseEl = qs("#corrDose");
const totalDoseEl = qs("#totalDose");

// =============== حالة الصفحة ===============
let parentId=null, childId=null, childDoc=null;
let items=[];      // [{name, brand, unit, gramsPerUnit, carbsPer100, carbsPerUnit, qty, grams, carbs}]
let library=[];    // admin/global/foodItems
let presets=[];

const state = {
  unit: "mg/dL",
  prefs: {
    diet: { halal:false, veg:false, lowcarb:false, lowfat:false, lowsod:false },
    allergies: [],
    likes: [],
    dislikes: []
  },
  ratios: { cr:{ default:10, byMeal:{} }, cf:{ default:50, byMeal:{} } },
  carbTargets: { breakfast:{}, lunch:{}, dinner:{}, snack:{} }
};

// =============== Utils ===============
const ensureNum = v => (typeof v==="number" && !Number.isNaN(v)) ? v : 0;
const sum = arr => arr.reduce((a,b)=>a+ensureNum(b),0);
const round2 = n => Math.round(n*100)/100;
const fmtDose = n => (Math.round(n*20)/20).toFixed(2); // 0.05U

// chips helper
function chipify(inputEl, listEl, onChange){
  const addChip = (text)=>{
    const t=(text||"").trim(); if(!t) return;
    const chip=document.createElement("span"); chip.className="chip"; chip.textContent=t;
    const x=document.createElement("span"); x.className="x"; x.textContent="×";
    x.onclick=()=>{ listEl.removeChild(chip); onChange(getValues()); };
    chip.appendChild(x); listEl.appendChild(chip);
  };
  const getValues = ()=> Array.from(listEl.querySelectorAll(".chip"))
    .map(c=>c.childNodes[0].nodeValue.trim()).filter(Boolean);

  inputEl.addEventListener("keydown",e=>{
    if(e.key==="Enter"){ e.preventDefault(); addChip(inputEl.value); inputEl.value=""; onChange(getValues()); }
  });
  return { addChip, getValues };
}
const allergiesCh = chipify(allergiesInput, allergiesChips, v => state.prefs.allergies=v);
const likesCh     = chipify(likesInput, likesChips, v => state.prefs.likes=v);
const dislikesCh  = chipify(dislikesInput, dislikesChips, v => state.prefs.dislikes=v);

// =============== Boot ===============
init().catch(console.error);

async function init(){
  // ids من عنوان الصفحة
  const url = new URL(location.href);
  childId  = url.searchParams.get("child");
  parentId = url.searchParams.get("parent"); // اختياري

  backBtn.onclick = ()=> history.length>1 ? history.back() : (location.href = "child.html");

  // لو parentId غير مُمرر، حاول استخدام المستخدم الحالي
  if(!parentId){
    // لو لم يجهز auth بعد، انتظر حدث التغيّر مرة واحدة
    await new Promise(resolve=>{
      const unsub = auth.onAuthStateChanged(u=>{ if(u){parentId=u.uid;} unsub(); resolve(); });
    });
  }
  if(!parentId || !childId){ alert("المعطيات ناقصة: child/parent"); return; }

  // تحميل الطفل
  await loadChild();

  // تحميل المكتبة والجاهز
  await Promise.all([loadLibrary(), loadPresets()]);

  // ربط أحداث
  wireEvents();

  // بدء بحالة فارغة
  renderItems();
  recalcAll();
}

async function loadChild(){
  const cRef = doc(db, "parents", parentId, "children", childId);
  const snap = await getDoc(cRef);
  if(!snap.exists()){ alert("لم يتم العثور على بيانات الطفل"); return; }
  childDoc = snap.data();

  // هيدر
  kidNameEl.textContent = childDoc.name || "طفل";
  kidMetaEl.textContent = `${childDoc.gender||""} • ${childDoc.birthDate||""}`;
  state.unit = childDoc.glucoseUnit || "mg/dL";
  glucoseUnitPill.textContent = state.unit;
  unitBadge.textContent = state.unit;

  // نسب CR/CF
  state.ratios.cr.default = ensureNum(childDoc.carbRatio ?? childDoc.ratios?.cr?.default);
  state.ratios.cf.default = ensureNum(childDoc.correctionFactor ?? childDoc.ratios?.cf?.default);
  state.ratios.cr.byMeal = childDoc.ratios?.cr?.byMeal || {};
  state.ratios.cf.byMeal = childDoc.ratios?.cf?.byMeal || {};

  // نطاقات الكارب
  state.carbTargets = childDoc.carbTargets || state.carbTargets;

  // تفضيلات
  state.prefs.diet = Object.assign(state.prefs.diet, childDoc.diet || {});
  (childDoc.allergies || []).forEach(allergiesCh.addChip);
  (childDoc.likes || []).forEach(likesCh.addChip);
  (childDoc.dislikes || []).forEach(dislikesCh.addChip);
  dietHalal.checked = !!state.prefs.diet.halal;
  dietVeg.checked   = !!state.prefs.diet.veg;
  dietLowCarb.checked = !!state.prefs.diet.lowcarb;
  dietLowFat.checked  = !!state.prefs.diet.lowfat;
  dietLowSod.checked  = !!state.prefs.diet.lowsod;

  // إعدادات أولية حسب نوع الوجبة
  applyRatiosForMeal();
  applyRangeForMeal();
}

// =============== مكتبة و Presets ===============
async function loadLibrary(){
  const col = collection(db, "admin", "global", "foodItems");
  const snap = await getDocs(col);
  library = snap.docs.map(d => adaptFoodItem({ id:d.id, ...d.data() }));
}

async function loadPresets(){
  const col = collection(db, "parents", parentId, "children", childId, "presetMeals");
  const snap = await getDocs(col);
  presets = snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

// يدعم أشكال مختلفة من مستندات الأصناف
function adaptFoodItem(f){
  const out = {
    id: f.id, name: f.name || f.arName || "صنف",
    brand: f.brand || null,
    imageUrl: f.imageUrl || f.image || "",
    unit: f.unit || "وحدة",
    gramsPerUnit: 0,
    carbsPerUnit: null,
    carbsPer100: null,
    tags: Array.isArray(f.tags) ? f.tags : []
  };

  // measures[]
  if (Array.isArray(f.measures) && f.measures.length){
    const m = f.measures[0];
    out.unit = m.name || out.unit;
    out.gramsPerUnit = ensureNum(m.grams);
  }
  // measureQty
  if (f.measureQty && typeof f.measureQty === "object"){
    out.gramsPerUnit = ensureNum(f.measureQty.grams ?? out.gramsPerUnit);
    out.unit = f.measureQty.name || out.unit;
  }

  // الكارب
  if (typeof f.carbsPerUnit === "number") out.carbsPerUnit = f.carbsPerUnit;
  if (typeof f.carbs_g === "number")     out.carbsPerUnit = f.carbs_g;
  if (f.nutrPer100g && typeof f.nutrPer100g.carbs === "number") out.carbsPer100 = f.nutrPer100g.carbs;
  if (typeof f.carbsPer100 === "number") out.carbsPer100 = f.carbsPer100;

  return out;
}

// =============== أحداث وواجهة ===============
function wireEvents(){
  mealType.onchange = ()=>{ applyRatiosForMeal(); applyRangeForMeal(); recalcAll(); };
  [glucoseNow, crInput, cfInput, targetGlucose].forEach(el => el.addEventListener("input", recalcAll));
  [carbMin, carbMax].forEach(el => el.addEventListener("input", recalcProgress));

  fitToRangeBtn.onclick = onFitToRange;

  // فلاتر
  dietHalal.onchange = ()=> state.prefs.diet.halal = dietHalal.checked;
  dietVeg.onchange   = ()=> state.prefs.diet.veg   = dietVeg.checked;
  dietLowCarb.onchange = ()=> state.prefs.diet.lowcarb = dietLowCarb.checked;
  dietLowFat.onchange  = ()=> state.prefs.diet.lowfat  = dietLowFat.checked;
  dietLowSod.onchange  = ()=> state.prefs.diet.lowsod  = dietLowSod.checked;

  openLibraryBtn.onclick = showLibrary;
  openPresetsBtn.onclick = showPresets;
  aiSuggestBtn.onclick = onAISuggest;
  saveMealBtn.onclick = onSaveMeal;

  qsa("[data-close]").forEach(btn=>btn.addEventListener("click",e=> e.target.closest("dialog")?.close()));
  window.addEventListener("keydown", e=>{
    if(e.key==="Escape"){ libraryModal.close(); presetsModal.close(); }
  });
}

function applyRatiosForMeal(){
  const t = mealType.value;
  const cr = state.ratios.cr.byMeal?.[t] ?? state.ratios.cr.default ?? 10;
  const cf = state.ratios.cf.byMeal?.[t] ?? state.ratios.cf.default ?? 50;

  crInput.value = String(cr);
  cfInput.value = String(cf);

  const target = childDoc?.normalRange?.min ?? 110;
  if (!targetGlucose.value) targetGlucose.value = String(target);

  pillCR.textContent = cr;
  pillCF.textContent = cf;
  pillTarget.textContent = targetGlucose.value;
}

function applyRangeForMeal(){
  const t = mealType.value;
  const rng = state.carbTargets?.[t] || {};
  carbMin.value = rng.min ?? "";
  carbMax.value = rng.max ?? "";
  recalcProgress();
}

// =============== عناصر الوجبة ===============
function renderItems(){
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

    // الكمية (وحدة)
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

function calcCarbs(row){
  if (row.carbsPerUnit != null) return round2((row.qty ?? 0) * row.carbsPerUnit);
  return round2((row.grams ?? 0) * (row.carbsPer100 ?? 0) / 100);
}

function totalCarbs(){ return sum(items.map(r=>ensureNum(r.carbs))); }

function updateTotals(){
  const t = totalCarbs();
  totalCarbsCell.textContent = t.toFixed(1);
  totalCarbsEl.textContent   = t.toFixed(1);
  // حدث آخر عمود (الكارب) لكل صف
  Array.from(itemsBody.rows).forEach((tr, i)=>{
    const td = tr.cells[4]; if(td) td.textContent = (items[i].carbs ?? 0).toFixed(1);
  });
  recalcAll();
}

// =============== النطاق والتقدّم ===============
function recalcProgress(){
  const t = totalCarbs();
  const min = Number(carbMin.value || 0);
  const max = Number(carbMax.value || 0);

  let pct = 0;
  if (max > min) pct = Math.min(100, Math.max(0, (t - min) / (max - min) * 100));
  carbProgress.style.width = pct + "%";

  let cls="out", text="خارج النطاق";
  if (t>=min && t<=max){ cls="ok"; text="داخل النطاق"; }
  else if (Math.abs(t-min)<=5 || Math.abs(t-max)<=5){ cls="near"; text="قريب من النطاق"; }

  rangeState.className = "state " + cls;
  rangeState.textContent = text;
}

// =============== الحسابات ===============
function recalcAll(){
  const tCarb = totalCarbs();
  const CR = Number(crInput.value || 10);
  const CF = Number(cfInput.value || 50);
  const target = Number(targetGlucose.value || 110);
  const gNow = Number(glucoseNow.value || 0);

  const mealDose = tCarb / CR;
  const corrDose = Math.max(0, (gNow - target) / CF);
  const total = mealDose + corrDose;

  mealDoseEl.textContent = fmtDose(mealDose);
  corrDoseEl.textContent = fmtDose(corrDose);
  totalDoseEl.textContent = fmtDose(total);

  recalcProgress();
}

// =============== المودالات ===============
function showLibrary(){
  libraryGrid.innerHTML = "";
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

function showPresets(){
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
        <button class="btn ghost" data-del>حذف</button>
      </div>
    `;
    el.querySelector("[data-load]").onclick=()=>{
      items=(p.items||[]).map(x=>({...x}));
      renderItems();
      if (p.mealType){ mealType.value=p.mealType; applyRatiosForMeal(); }
      if (p.targetRange){ carbMin.value=p.targetRange.min ?? ""; carbMax.value=p.targetRange.max ?? ""; }
      presetsModal.close();
    };
    el.querySelector("[data-del]").onclick=async ()=>{
      await setDoc(doc(db,"parents",parentId,"children",childId,"presetMeals",p.id),{deleted:true},{merge:true});
      await loadPresets(); showPresets();
    };
    presetsList.appendChild(el);
  });
  presetsModal.showModal();
}

// =============== AI ===============
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
  const min = Number(carbMin.value || 0);
  const max = Number(carbMax.value || 0);
  const t = totalCarbs();
  items = MealAI.adjustToRange({
    items: items.map(r=>({...r})),
    totalCarbs: t, min, max
  });
  // احسب الجرام/الكارب بعد الضبط
  items = items.map(r=>{
    r.grams = round2((r.qty ?? 0) * (r.gramsPerUnit ?? 0));
    r.carbs = calcCarbs(r); return r;
  });
  renderItems();
}

// =============== حفظ الوجبة ===============
async function onSaveMeal(){
  const mealsCol = collection(db,"parents",parentId,"children",childId,"meals");
  const data = {
    createdAt: serverTimestamp(),
    date: new Date().toISOString().slice(0,10),
    items: items.map(i=>({
      name:i.name, brand:i.brand, unit:i.unit,
      gramsPerUnit:i.gramsPerUnit, carbsPer100:i.carbsPer100, carbsPerUnit:i.carbsPerUnit,
      qty:i.qty, grams:i.grams, carbs:i.carbs
    })),
    totals:{ carbs: totalCarbs() },
    ratios:{ CR: Number(crInput.value||0), CF: Number(cfInput.value||0) },
    glucose:{ now:Number(glucoseNow.value||0), target:Number(targetGlucose.value||0), unit: state.unit },
    dose:{
      meal:Number(mealDoseEl.textContent||0),
      correction:Number(corrDoseEl.textContent||0),
      total:Number(totalDoseEl.textContent||0)
    },
    mealType: mealType.value,
    targetRange:{
      min: carbMin.value ? Number(carbMin.value) : null,
      max: carbMax.value ? Number(carbMax.value) : null
    },
    dietSnapshot:{
      diet: state.prefs.diet,
