/* eslint-disable no-undef */
import {
  doc, getDoc, getDocs, setDoc, addDoc, collection,
  query, orderBy, limit, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
  ref as sRef, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const fb = window.__FB || {};
const db = fb.db;
const auth = fb.auth;
const storage = fb.storage;
const onAuthStateChanged = fb.onAuthStateChanged;

if(!db || !auth || !onAuthStateChanged){
  console.error("Firebase لم يُهيّأ: وفّري __FB أو firebaseConfig أو compat.");
}

/* ---------------- UI refs ---------------- */
const $ = s => document.querySelector(s);
const childNameEl = $("#childName");
const chipUnit = $("#chipUnit");
const chipCR = $("#chipCR");
const chipCF = $("#chipCF");

const mealTypeEl = $("#mealType");
const mealDateEl = $("#mealDate");
const preReadingEl = $("#preReading");
const postReadingEl = $("#postReading");
const doseCorrectionEl = $("#doseCorrection");
const doseCarbEl = $("#doseCarb");
const doseTotalEl = $("#doseTotal");
const notesEl = $("#notes");

const hintCfEl = $("#hintCf");
const hintCrEl = $("#hintCr");
const hintAutoEl = $("#hintAuto");

const netCarbEl = $("#netCarb");
const totalCalEl = $("#totalCal");
const totalProtEl = $("#totalProt");
const totalFatEl = $("#totalFat");
const sumCarbEl = $("#sumCarb");
const sumProtEl = $("#sumProt");
const sumFatEl = $("#sumFat");
const sumCalEl = $("#sumCal");
const targetTextEl = $("#targetText");
const progressFillEl = $("#progressFill");

const itemsBody = $("#itemsBody");
const dlgLibrary = $("#dlgLibrary");
const libGrid = $("#libGrid");
const libSearch = $("#libSearch");
const fltLiked = $("#fltLiked");
const fltHideDiet = $("#fltHideDiet");
const fltHideAllergy = $("#fltHideAllergy");
const dlgPresets = $("#dlgPresets");
const presetsList = $("#presetsList");
const toastEl = $("#toast");

/* --------------- consts/state ------------- */
const fmt = n => (Math.round(n*100)/100);
const roundTo = (n,s)=> Math.round(n/s)*s;
const ceilTo = (n,s)=> Math.ceil(n/s)*s;
const QTY_STEP = 0.25;
const DOSE_ROUND = 0.5;

const CRIT_HIGH_MMOL = 10.9;
const BASE_MMOL = 7.0;
const BASE_MGDL = 126;

const MEAL_SLOTS = {
  "فطار": ["PRE_BREAKFAST","FASTING"],
  "غدا": ["PRE_LUNCH"],
  "عشا": ["PRE_DINNER"],
  "سناك": ["SNACK","PRE_SNACK"]
};

let currentUser=null, parentId=null, childId=null;
let child=null, prefs={allergies:[], liked:[], disliked:[], dietSystems:[]}, carbTargets=null;
let CR=0, CF=0, glucoseUnit="mmol/L";
let items=[], libCache=[];

/* ---------------- init ---------------- */
(async function init(){
  const u = new URL(location.href);
  childId = u.searchParams.get("child");
  if(!childId) console.warn("لم يُمرر child=? في الرابط");

  mealDateEl.valueAsDate = new Date();

  onAuthStateChanged && onAuthStateChanged(auth, async (user)=>{
    if(!user){ showToast("سجلي الدخول من فضلك"); return; }
    currentUser=user; parentId=user.uid;

    await loadChild();
    await tryPickPreReading();
    await loadPrefs();
    await loadLibrary();
    await loadPresets();

    recalc();
    bindHeaderListeners();
  });
})();

/* ---------------- loaders ---------------- */
async function loadChild(){
  const dref = doc(db, "parents", parentId, "children", childId);
  const s = await getDoc(dref);
  if(!s.exists()){ showToast("لم يتم العثور على ملف الطفل"); return; }
  child = s.data();

  childNameEl.textContent = child.name || child.displayName || "—";
  CR = Number(child.carbRatio || child.CR || 0);
  CF = Number(child.correctionFactor || child.CF || 0);
  glucoseUnit = child.glucoseUnit || "mmol/L";
  carbTargets = child.carbTargets || null;

  chipUnit.textContent = `وحدة: ${glucoseUnit}`;
  chipCR.textContent = `CR: ${CR||"—"}`;
  chipCF.textContent = `CF: ${CF||"—"}`;

  hintCfEl.style.display = CF ? "none":"inline";
  hintCrEl.style.display = CR ? "none":"inline";
  updateTargetsUI();
}

async function tryPickPreReading(){
  const slots = MEAL_SLOTS[mealTypeEl.value] || [];
  if(!slots.length) return;

  const coll = collection(db,"parents",parentId,"children",childId,"measurements");
  const qs = await getDocs(query(coll, orderBy("createdAt","desc"), limit(50)));
  const dateISO = mealDateEl.value || new Date().toISOString().slice(0,10);
  let picked=null;
  qs.forEach(s=>{
    const m=s.data();
    const d = (m.date || (m.createdAt?.toDate?.() ?? new Date())).toString();
    const same = (new Date(d)).toISOString().slice(0,10) === dateISO;
    const slot=m.slotKey||m.slot||"";
    if(same && slots.includes(slot) && !picked) picked=m;
  });
  if(picked && typeof picked.value==="number"){
    preReadingEl.value = picked.value;
    hintAutoEl.style.display="inline";
  }else{
    hintAutoEl.style.display="none";
  }
}

async function loadPrefs(){
  const r = doc(db,"parents",parentId,"children",childId,"foodPrefs");
  const s = await getDoc(r);
  if(s.exists()){
    const d=s.data();
    prefs.allergies=d.allergies||[];
    prefs.liked=d.liked||[];
    prefs.disliked=d.disliked||[];
    prefs.dietSystems=d.dietSystems||[];
  }
}

async function loadLibrary(){
  libCache=[];
  const paths = [
    collection(db,"admin","global","foodItems"),
    collection(db,"fooditems"),
  ];
  for(const coll of paths){
    try{
      const snap = await getDocs(coll);
      snap.forEach(ss=> libCache.push(normalizeLibItem(ss.id, ss.data())));
    }catch(e){ /* تجاهلي المصدر غير المتاح */ }
  }
  $("#btnAddFromLib").addEventListener("click", ()=>{ renderLibrary(); dlgLibrary.showModal(); });
}

async function loadPresets(){
  presetsList.innerHTML="";
  const coll = collection(db,"parents",parentId,"presets");
  try{
    const snap = await getDocs(coll);
    const arr=[];
    snap.forEach(s=> arr.push({id:s.id,...s.data()}));
    arr.sort((a,b)=> (b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0));
    for(const p of arr){
      const el=document.createElement("div");
      el.className="card-tile";
      el.innerHTML=`
        <div class="meta">
          <div class="name">${esc(p.name||"قالب بدون اسم")}</div>
          <div class="sub">${esc(p.type||"—")} • عناصر: ${p.items?.length||0}</div>
        </div>
        <div class="act"><button class="btn small" data-apply>استخدام</button></div>`;
      el.querySelector("[data-apply]").addEventListener("click", ()=>{ applyPreset(p); dlgPresets.close(); });
      presetsList.appendChild(el);
    }
  }catch(e){}
}

/* -------------- normalize --------------- */
function normalizeLibItem(id,d){
  const measures=(d.measures||d.units||[]).map(u=>{
    const grams=Number(u.grams||u.gram||u.g||u.qty||0);
    const name=u.name_ar||u.name||u.label||"حصة";
    return {key:name, grams};
  });
  if(d.measureQty && measures.length===0){
    measures.push({key:d.measureQty.name||"حصة", grams:Number(d.measureQty.grams||0)});
  }
  if(measures.length===0) measures.push({key:"حصة", grams:100});

  const p100=d.nutrPer100g||d.per100||{};
  const cal=Number(p100.cal_kcal ?? d.cal_kcal ?? 0);
  const carbs=Number(p100.carbs_g ?? d.carbs_g ?? 0);
  const prot=Number(p100.protein_g ?? d.protein_g ?? 0);
  const fat =Number(p100.fat_g ?? d.fat_g ?? 0);

  let imageUrl=d.imageUrl||d.image?.url||"";
  let imagePath=d.image?.path||d.imagePath||"";

  return {
    id,
    name:d.name||d.name_ar||"صنف",
    category:d.category||"أخرى",
    measures,
    per100:{cal_kcal:cal, carbs_g:carbs, protein_g:prot, fat_g:fat},
    tags:[...(d.hashTagsAuto||[]),...(d.hashTagsManual||[]),...(d.dietTagsAuto||[])].map(x=>String(x||"").replace(/^#/,"")),
    dietTags:(d.dietTagsAuto||d.dietSystems||[]).map(x=>String(x)),
    imageUrl, imagePath
  };
}

function itemViolatesDiet(it){
  if(!prefs.dietSystems?.length) return false;
  const tags=new Set([...(it.dietTags||[]), ...(it.tags||[])]);
  for(const need of prefs.dietSystems){ if(!tags.has(need)) return true; }
  return false;
}
function itemHasAllergy(it){
  if(!prefs.allergies?.length) return false;
  const n=(it.name||"").toLowerCase();
  const tags=(it.tags||[]).map(t=>String(t).toLowerCase());
  return prefs.allergies.some(a=>{
    const k=String(a).toLowerCase();
    return n.includes(k) || tags.some(t=>t.includes(k));
  });
}

/* -------------- library UI --------------- */
function renderLibrary(){
  const q=(libSearch.value||"").trim().toLowerCase();
  const filtered=libCache.filter(it=>{
    const like=prefs.liked.includes(it.id);
    const allergy=itemHasAllergy(it);
    const violate=itemViolatesDiet(it);
    if($("#fltLiked").checked && !like) return false;
    if($("#fltHideAllergy").checked && allergy) return false;
    if($("#fltHideDiet").checked && violate) return false;
    if(q){
      const hay = `${it.name} ${it.category} ${(it.tags||[]).join(" ")}`.replace(/#/g,"").toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a,b)=>{
    const score=x=> prefs.liked.includes(x.id)?2 : (prefs.disliked.includes(x.id)?0:1);
    const sA=score(a), sB=score(b);
    if(sA!==sB) return sB-sA;
    return (a.name||"").localeCompare(b.name||"ar");
  });

  libGrid.innerHTML="";
  for(const it of filtered){
    const img=document.createElement("img");
    if(it.imageUrl) img.src=it.imageUrl;
    else if(it.imagePath){
      const path = it.imagePath.startsWith("food-items/") ? it.imagePath : `food-items/items/${it.id}/main.jpg`;
      getDownloadURL(sRef(storage,path)).then(url=> img.src=url).catch(()=>{});
    }else{
      img.src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><rect width='100%' height='100%' fill='%23e5e7eb'/></svg>";
    }

    const tile=document.createElement("div");
    tile.className="card-tile";
    tile.appendChild(img);

    const meta=document.createElement("div");
    meta.className="meta";
    meta.innerHTML=`
      <div class="name">${esc(it.name)}</div>
      <div class="sub">${esc(it.category)} • ${fmt(it.per100.carbs_g)}g كارب/100g</div>
      <div class="tags"></div>`;
    tile.appendChild(meta);

    const tags=meta.querySelector(".tags");
    const like=prefs.liked.includes(it.id);
    const dislike=prefs.disliked.includes(it.id);
    const allergy=itemHasAllergy(it);
    const violate=itemViolatesDiet(it);
    if(like) tags.appendChild(flag("مفضل ❤️","like"));
    if(dislike) tags.appendChild(flag("غير مفضل 💔","dislike"));
    if(violate) tags.appendChild(flag("مخالف للنظام ⚠️","diet"));
    if(allergy) tags.appendChild(flag("حساسية 🚫","allergy"));

    const act=document.createElement("div");
    act.className="act";
    act.innerHTML=`
      <select class="est">
        ${it.measures.map(m=>`<option value="${m.key}|${m.grams}">${esc(m.key)} • ${fmt(m.grams)}g</option>`).join("")}
      </select>
      <button class="btn small" data-add>إضافة</button>
      <button class="btn small ghost" data-like>${like?"إلغاء ❤️":"❤️ مفضل"}</button>
      <button class="btn small ghost" data-dislike>${dislike?"إلغاء 💔":"💔 غير مفضل"}</button>`;
    tile.appendChild(act);

    act.querySelector("[data-add]").addEventListener("click", ()=>{
      if(allergy && !confirm("الصنف عليه حساسية مسجّلة. متأكدة من الإضافة؟")) return;
      if(violate && !confirm("الصنف مخالف للنظام الغذائي. متابعة؟")) return;
      const [key, grams] = act.querySelector(".est").value.split("|");
      addItemFromLib(it, key, Number(grams||0)); dlgLibrary.close();
    });
    act.querySelector("[data-like]").addEventListener("click", ()=>togglePref(it.id,"like"));
    act.querySelector("[data-dislike]").addEventListener("click", ()=>togglePref(it.id,"dislike"));

    libGrid.appendChild(tile);
  }

  $("#libSearch").addEventListener("input", renderLibrary, {once:true});
  $("#fltLiked").addEventListener("change", renderLibrary, {once:true});
  $("#fltHideDiet").addEventListener("change", renderLibrary, {once:true});
  $("#fltHideAllergy").addEventListener("change", renderLibrary, {once:true});
}

function flag(txt,cls){ const el=document.createElement("span"); el.className=`flag ${cls}`; el.textContent=txt; return el; }
function togglePref(id,kind){
  const ref=doc(db,"parents",parentId,"children",childId,"foodPrefs");
  if(kind==="like"){
    if(prefs.liked.includes(id)) prefs.liked=prefs.liked.filter(x=>x!==id);
    else{ prefs.liked=[...new Set([id,...prefs.liked])]; prefs.disliked=prefs.disliked.filter(x=>x!==id); }
  }else{
    if(prefs.disliked.includes(id)) prefs.disliked=prefs.disliked.filter(x=>x!==id);
    else{ prefs.disliked=[...new Set([id,...prefs.disliked])]; prefs.liked=prefs.liked.filter(x=>x!==id); }
  }
  setDoc(ref, prefs, {merge:true}).then(()=> renderLibrary());
}

/* -------------- items table -------------- */
function addItemFromLib(it, measureKey, gramsPerPortion){
  const existing = items.find(x=> x.itemId===it.id && x.measureKey===measureKey && x.gramsPerPortion===gramsPerPortion);
  if(existing){ existing.qty = roundQty(existing.qty + QTY_STEP); }
  else{
    items.push({
      itemId: it.id, name: it.name,
      image: it.imageUrl || it.imagePath || "",
      measureKey, gramsPerPortion,
      qty: 1, grams: gramsPerPortion,
      per100: it.per100
    });
  }
  renderItems(); recalc();
}
function roundQty(v){ return Math.max(0, roundTo(v, QTY_STEP)); }

function renderItems(){
  itemsBody.innerHTML="";
  items.forEach((r, idx)=>{
    r.grams = fmt(r.gramsPerPortion * r.qty);
    const carb = fmt((r.per100.carbs_g   * r.grams)/100);
    const prot = fmt((r.per100.protein_g * r.grams)/100);
    const fat  = fmt((r.per100.fat_g     * r.grams)/100);
    const cal  = fmt((r.per100.cal_kcal  * r.grams)/100);

    const row=document.createElement("div");
    row.className="row";
    row.innerHTML=`
      <div class="cell actions"><button class="icon" data-del title="حذف">🗑️</button></div>
      <div class="cell"><div class="name">${esc(r.name)}</div></div>
      <div class="cell"><span class="est-badge"><span class="est-name">${esc(r.measureKey)}</span> <span class="est-grams">${fmt(r.gramsPerPortion)}g/حصة</span></span></div>
      <div class="cell"><div class="qty-wrap"><div class="stepper">
        <button data-dec>−</button>
        <input data-qty type="number" step="${QTY_STEP}" min="0" value="${fmt(r.qty)}" />
        <button data-inc>+</button>
      </div></div></div>
      <div class="cell num">${fmt(r.grams)}</div>
      <div class="cell num">${carb}</div>
      <div class="cell num">${prot}</div>
      <div class="cell num">${fat}</div>
      <div class="cell num">${cal}</div>`;

    row.querySelector("[data-del]").addEventListener("click", ()=>{ items.splice(idx,1); renderItems(); recalc(); });
    row.querySelector("[data-dec]").addEventListener("click", ()=>{ r.qty=roundQty(Math.max(0,r.qty-QTY_STEP)); renderItems(); recalc(); });
    row.querySelector("[data-inc]").addEventListener("click", ()=>{ r.qty=roundQty(r.qty+QTY_STEP); renderItems(); recalc(); });
    row.querySelector("[data-qty]").addEventListener("change", e=>{ r.qty=roundQty(Math.max(0, Number(e.target.value||0))); renderItems(); recalc(); });

    itemsBody.appendChild(row);
  });
}

/* ---------------- recalc ---------------- */
function recalc(){
  let sumCarb=0,sumProt=0,sumFat=0,sumCal=0;
  items.forEach(r=>{
    const g=r.gramsPerPortion*r.qty;
    sumCarb += (r.per100.carbs_g   * g)/100;
    sumProt += (r.per100.protein_g * g)/100;
    sumFat  += (r.per100.fat_g     * g)/100;
    sumCal  += (r.per100.cal_kcal  * g)/100;
  });
  sumCarb=fmt(sumCarb); sumProt=fmt(sumProt); sumFat=fmt(sumFat); sumCal=fmt(sumCal);

  netCarbEl.textContent=sumCarb; totalCalEl.textContent=sumCal;
  totalProtEl.textContent=sumProt; totalFatEl.textContent=sumFat;
  sumCarbEl.textContent=sumCarb; sumProtEl.textContent=sumProt; sumFatEl.textContent=sumFat; sumCalEl.textContent=sumCal;

  // جرعة كارب
  let carbDose = (CR>0) ? sumCarb/CR : 0;
  carbDose = roundTo(carbDose, DOSE_ROUND);
  doseCarbEl.value = carbDose;

  // جرعة التصحيح (فقط لو ≥ 10.9 mmol/L)
  let corrDose=0;
  const pre=Number(preReadingEl.value||0);
  if(pre >= toUnit(CRIT_HIGH_MMOL) && CF>0){
    const base=isMmol()? BASE_MMOL: BASE_MGDL;
    corrDose = Math.max(0,(pre-base)/CF);
  }
  corrDose=roundTo(corrDose, DOSE_ROUND);
  doseCorrectionEl.value=corrDose;

  doseTotalEl.value = fmt(Number(doseCarbEl.value||0) + Number(doseCorrectionEl.value||0));
  updateTargetsUI();
}

function isMmol(){ return (glucoseUnit||"").toLowerCase().includes("mmol"); }
function toUnit(mmol){ return isMmol()? mmol : Math.round(mmol*18); }

/* -------------- targets UI --------------- */
function getTargetsForMeal(){
  if(!carbTargets) return null;
  const map={ "فطار":"breakfast", "غدا":"lunch", "عشا":"dinner", "سناك":"snack" };
  return carbTargets[ map[mealTypeEl.value] ];
}
function updateTargetsUI(){
  const t=getTargetsForMeal();
  if(!t){ targetTextEl.textContent="—"; progressFillEl.style.width="0%"; return; }
  targetTextEl.textContent=`${t.min}–${t.max} g`;
  const v=Number(netCarbEl.textContent||0);
  let pct=t.max? (v/t.max)*100 : 0;
  pct=Math.max(0, Math.min(100,pct));
  progressFillEl.style.width=pct+"%";
  progressFillEl.style.background=(v<t.min||v>t.max)?"#f97316":"#16a34a";
}

/* -------------- presets/save ------------- */
$("#btnSaveMeal").addEventListener("click", saveMeal);
$("#btnReset").addEventListener("click", ()=>{ items=[]; renderItems(); recalc(); });
$("#btnAddFromPreset").addEventListener("click", ()=> dlgPresets.showModal());
$("#btnSaveAsPreset").addEventListener("click", saveAsPreset);

async function saveMeal(){
  const type=mealTypeEl.value;
  const date=mealDateEl.value || new Date().toISOString().slice(0,10);
  if(!items.length){ showToast("أضيفي عناصر للوجبة أولًا"); return; }

  const payload={
    type,date,
    createdAt: Timestamp.fromDate(new Date()),
    preReading: { value:Number(preReadingEl.value||0), unit:glucoseUnit, slotKey:(MEAL_SLOTS[type]||[])[0]||"PRE" },
    postReading: Number(postReadingEl.value||0) || null,
    correctionDose: Number(doseCorrectionEl.value||0),
    carbDose: Number(doseCarbEl.value||0),
    totalDose: Number(doseTotalEl.value||0),
    netCarb: Number(netCarbEl.textContent||0),
    totals:{ cal:Number(totalCalEl.textContent||0), carb:Number(netCarbEl.textContent||0), protein:Number(totalProtEl.textContent||0), fat:Number(totalFatEl.textContent||0) },
    CR, CF, glucoseUnit,
    items: items.map(r=>({ itemId:r.itemId, name:r.name, image:r.image, measureKey:r.measureKey, gramsPerPortion:r.gramsPerPortion, qty:r.qty, grams:fmt(r.gramsPerPortion*r.qty), per100:r.per100 })),
    notes:(notesEl.value||"").trim()
  };

  const coll=collection(db,"parents",parentId,"children",childId,"meals");
  await addDoc(coll,payload);
  showToast("تم حفظ الوجبة ✅");
}

async function saveAsPreset(){
  if(!items.length){ showToast("لا توجد عناصر للحفظ كقالب"); return; }
  const name=prompt("اسم القالب:"); if(!name) return;
  const payload={ name, type:mealTypeEl.value, items:items.map(r=>({itemId:r.itemId,name:r.name,measureKey:r.measureKey,gramsPerPortion:r.gramsPerPortion,qty:r.qty})), updatedAt: Timestamp.fromDate(new Date()) };
  const coll=collection(db,"parents",parentId,"presets");
  await addDoc(coll,payload);
  showToast("تم حفظ القالب ✅"); await loadPresets();
}
function applyPreset(p){
  items=[]; for(const r of (p.items||[])){
    const it=libCache.find(x=>x.id===r.itemId); if(!it) continue;
    items.push({ itemId:it.id, name:it.name, image:it.imageUrl||it.imagePath||"", measureKey:r.measureKey, gramsPerPortion:r.gramsPerPortion, qty:r.qty??1, grams:r.gramsPerPortion*(r.qty??1), per100:it.per100 });
  }
  renderItems(); recalc();
}

/* ---------------- events ---------------- */
function bindHeaderListeners(){
  $("#btnBack").addEventListener("click", ()=> history.back());
  mealTypeEl.addEventListener("change", async ()=>{ await tryPickPreReading(); recalc(); });
  mealDateEl.addEventListener("change", async ()=>{ await tryPickPreReading(); recalc(); });
  preReadingEl.addEventListener("input", recalc);
  doseCorrectionEl.addEventListener("input", ()=> doseTotalEl.value = fmt(Number(doseCarbEl.value||0)+Number(doseCorrectionEl.value||0)));
  doseCarbEl.addEventListener("input", ()=> doseTotalEl.value = fmt(Number(doseCarbEl.value||0)+Number(doseCorrectionEl.value||0)));

  dlgLibrary.addEventListener("click", e=>{ if(e.target.matches("[data-close]")) dlgLibrary.close(); });
  dlgPresets.addEventListener("click", e=>{ if(e.target.matches("[data-close]")) dlgPresets.close(); });
}

/* ---------------- utils ---------------- */
function esc(s){ return String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
function showToast(msg){ toastEl.textContent=msg; toastEl.classList.add("show"); toastEl.classList.remove("hidden"); setTimeout(()=>toastEl.classList.remove("show"),2200); }
