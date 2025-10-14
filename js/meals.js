/* eslint-disable no-undef */
import {
  doc, getDoc, getDocs, setDoc, addDoc, collection,
  query, where, orderBy, limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const { db, auth, storage, onAuthStateChanged } = window.__FB;

// -----------------------------
// Helpers
// -----------------------------
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const fmt = n => (Math.round(n * 100) / 100);
const roundTo = (n, step) => Math.round(n / step) * step;
const ceilTo = (n, step) => Math.ceil(n / step) * step;
const floorTo = (n, step) => Math.floor(n / step) * step;

const QTY_STEP = 0.25;  // ← ¼ حصة
const DOSE_ROUND = 0.5; // تقريب الجرعات

const MEAL_SLOTS = {
  "فطار": ["PRE_BREAKFAST", "FASTING"],
  "غدا": ["PRE_LUNCH"],
  "عشا": ["PRE_DINNER"],
  "سناك": ["SNACK","PRE_SNACK"]
};

const CRIT_HIGH_MMOL = 10.9;
const BASE_MMOL = 7.0;
const BASE_MGDL = 126;

// UI refs
const childNameEl = $("#childName");
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
const toastEl = $("#toast");

const dlgLibrary = $("#dlgLibrary");
const libSearch = $("#libSearch");
const fltLiked = $("#fltLiked");
const fltHideDiet = $("#fltHideDiet");
const fltHideAllergy = $("#fltHideAllergy");
const libGrid = $("#libGrid");

const dlgPresets = $("#dlgPresets");
const presetsList = $("#presetsList");

const assistantBtn = $("#btnAssistant");
const assistantPanel = $("#assistantPanel");
const assistantClose = $("#assistantClose");
const assistantBody = $("#assistantBody");

// state
let currentUser = null;
let parentId = null;
let childId = null;

let child = null; // child document
let prefs = { allergies: [], liked: [], disliked: [], dietSystems: [] };
let carbTargets = null;

let CR = 0;
let CF = 0;
let glucoseUnit = "mmol/L";

let items = []; // [{itemId, name, imageUrl, measureKey, gramsPerPortion, qty, grams, per100:{cal_kcal, carbs_g, protein_g, fat_g}}]
let libCache = []; // raw library items

// -----------------------------
// Init
// -----------------------------
init();

function init(){
  const url = new URL(location.href);
  childId = url.searchParams.get("child");
  if(!childId){ showToast("❗ لم يتم تمرير معرف الطفل في الرابط ?child=..."); }

  const today = new Date();
  mealDateEl.valueAsDate = today;

  onAuthStateChanged(auth, async (user)=>{
    if(!user){
      showToast("الرجاء تسجيل الدخول"); return;
    }
    currentUser = user;
    parentId = user.uid;

    // تحميل بيانات الطفل + القياسات + التفضيلات + المكتبة
    await loadChild();
    await tryPickPreReading();
    await loadPrefs();
    await loadLibrary();
    await loadPresets();

    recalc(); // أول حساب
    refreshAssistant();
  });
}

// -----------------------------
// Loaders
// -----------------------------
async function loadChild(){
  const dref = doc(db, "parents", parentId, "children", childId);
  const snap = await getDoc(dref);
  if(!snap.exists()){ showToast("لم يتم العثور على ملف الطفل"); return; }
  child = snap.data();

  childNameEl.textContent = child.name || child.displayName || "—";
  CR = Number(child.carbRatio || child.CR || 0);
  CF = Number(child.correctionFactor || child.CF || 0);
  glucoseUnit = child.glucoseUnit || "mmol/L";
  carbTargets = child.carbTargets || null;

  hintCfEl.style.display = CF ? "none":"inline";
  hintCrEl.style.display = CR ? "none":"inline";

  // نوع افتراضي من كويري؟
  const url = new URL(location.href);
  const typeQ = url.searchParams.get("type");
  if(typeQ){ mealTypeEl.value = typeQ; }

  // تاريخ من كويري؟
  const dateQ = url.searchParams.get("date");
  if(dateQ) mealDateEl.value = dateQ;

  bindHeaderListeners();
  updateTargetsUI();
}

async function tryPickPreReading(){
  // آخر قياس slot مناسب لنوع الوجبة
  const slots = MEAL_SLOTS[mealTypeEl.value] || [];
  if(!slots.length) return;

  const coll = collection(db, "parents", parentId, "children", childId, "measurements");
  // هنجيب الأحدث لهذا اليوم (فيلتر بالتاريخ)
  const dateISO = mealDateEl.value || new Date().toISOString().slice(0,10);
  // هنقرأ كلها ونفلتر محليًا (مقبول على أحجام صغيرة)
  const qSnap = await getDocs(query(coll, orderBy("createdAt","desc"), limit(50)));
  let picked = null;
  qSnap.forEach(s=>{
    const m = s.data();
    const d = (m.date || (m.createdAt?.toDate?.() ?? new Date())).toString();
    const isSameDay = (new Date(d)).toISOString().slice(0,10) === dateISO;
    const slot = m.slotKey || m.slot || "";
    if(isSameDay && slots.includes(slot) && picked==null){
      picked = m;
    }
  });
  if(picked && typeof picked.value === "number"){
    preReadingEl.value = picked.value;
    hintAutoEl.style.display = "inline";
  }else{
    hintAutoEl.style.display = "none";
  }
}

async function loadPrefs(){
  const pRef = doc(db, "parents", parentId, "children", childId, "foodPrefs");
  const pSnap = await getDoc(pRef);
  if(pSnap.exists()){
    const d = pSnap.data();
    prefs.allergies = d.allergies || [];
    prefs.liked = d.liked || [];
    prefs.disliked = d.disliked || [];
    prefs.dietSystems = d.dietSystems || [];
  }
}

async function loadLibrary(){
  libCache = [];
  // نجرب مصدرين: admin/global/foodItems و fooditems
  const tryPaths = [
    collection(db, "admin", "global", "foodItems"),
    collection(db, "fooditems")
  ];

  for(const coll of tryPaths){
    try{
      const snap = await getDocs(coll);
      snap.forEach(s=>{
        const d = s.data();
        libCache.push(normalizeLibItem(s.id, d));
      });
    }catch(e){
      // تجاهل المصدر لو مش موجود
    }
  }

  // عرض المودال عند الطلب
  $("#btnAddFromLib").addEventListener("click", ()=>{
    openLibrary();
  });
}

async function loadPresets(){
  presetsList.innerHTML = "";
  const coll = collection(db, "parents", parentId, "presets");
  try{
    const snap = await getDocs(coll);
    const items = [];
    snap.forEach(s=> items.push({id:s.id, ...s.data()}));
    if(!items.length){ return; }
    items.sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
    for(const p of items){
      const el = document.createElement("div");
      el.className = "card-tile";
      el.innerHTML = `
        <div class="meta">
          <div class="name">${esc(p.name||"قالب بدون اسم")}</div>
          <div class="sub">${esc(p.type||"—")} • عناصر: ${p.items?.length||0}</div>
        </div>
        <div class="act">
          <button class="btn small" data-apply>استخدام</button>
        </div>`;
      el.querySelector("[data-apply]").addEventListener("click", ()=>{
        applyPreset(p);
        dlgPresets.close();
      });
      presetsList.appendChild(el);
    }
  }catch(e){}
}

// -----------------------------
// Normalizers / Flags
// -----------------------------
function normalizeLibItem(id, d){
  // اكتشاف المقادير
  const measures = (d.measures || d.units || []).map(u=>{
    const grams = Number(u.grams || u.gram || u.g || u.qty || 0);
    const name = u.name_ar || u.name || u.label || "حصة";
    return { key: name, grams };
  });
  // بعض الداتا عندك عندها "measureQty" منفصلة
  if(d.measureQty && measures.length===0){
    measures.push({ key: d.measureQty.name || "حصة", grams: Number(d.measureQty.grams||0) });
  }
  if(measures.length===0){
    measures.push({ key: "حصة", grams: 100 });
  }

  // التغذية لكل 100 جم
  const per100 = d.nutrPer100g || d.per100 || d.per100g || d.per100 || {};
  const cal = Number(per100.cal_kcal ?? d.cal_kcal ?? 0);
  const carbs = Number(per100.carbs_g ?? d.carbs_g ?? 0);
  const prot = Number(per100.protein_g ?? d.protein_g ?? 0);
  const fat = Number(per100.fat_g ?? d.fat_g ?? 0);

  // الصورة
  let imageUrl = d.imageUrl || d.image?.url || "";
  let imagePath = d.image?.path || (d.imagePath || "");
  return {
    id, name: d.name || d.name_ar || "صنف",
    category: d.category || "أخرى",
    measures,
    per100: { cal_kcal: cal, carbs_g: carbs, protein_g: prot, fat_g: fat },
    tags: [...(d.hashTagsAuto||[]), ...(d.hashTagsManual||[]), ...(d.dietTagsAuto||[])].map(x=>String(x||"").replace(/^#/, "")),
    dietTags: (d.dietTagsAuto||d.dietSystems||[]).map(x=>String(x)),
    imageUrl, imagePath
  };
}

function itemViolatesDiet(libItem){
  if(!prefs.dietSystems?.length) return false;
  // لو الطفل عايز "منخفض GI" والمنتج لا يحوي هذا الوسم → مخالِف
  const tags = new Set([...(libItem.dietTags||[]), ...(libItem.tags||[])]);
  for(const need of prefs.dietSystems){
    if(!tags.has(need)) return true;
  }
  return false;
}

function itemHasAllergy(libItem){
  if(!prefs.allergies?.length) return false;
  const name = (libItem.name||"").toLowerCase();
  const tags = (libItem.tags||[]).map(t=>String(t).toLowerCase());
  return prefs.allergies.some(a=>{
    const k = String(a).toLowerCase();
    return name.includes(k) || tags.some(t=>t.includes(k));
  });
}

// -----------------------------
// Library modal
// -----------------------------
function openLibrary(){
  renderLibrary();
  dlgLibrary.showModal();
}

function renderLibrary(){
  // فلترة + ترتيب: liked → neutral → disliked
  const queryText = (libSearch.value||"").trim().toLowerCase();

  const filtered = libCache.filter(it=>{
    const like = prefs.liked.includes(it.id);
    const dislike = prefs.disliked.includes(it.id);
    const allergy = itemHasAllergy(it);
    const violate = itemViolatesDiet(it);

    if(fltLiked.checked && !like) return false;
    if(fltHideAllergy.checked && allergy) return false;
    if(fltHideDiet.checked && violate) return false;

    if(queryText){
      const hay = `${it.name} ${it.category} ${(it.tags||[]).join(" ")}`
        .replace(/#/g,"").toLowerCase();
      if(!hay.includes(queryText)) return false;
    }
    return true;
  });

  filtered.sort((a,b)=>{
    const score = (x)=>{
      if(prefs.liked.includes(x.id)) return 2;
      if(prefs.disliked.includes(x.id)) return 0;
      return 1;
    };
    const sA = score(a), sB = score(b);
    if(sA!==sB) return sB - sA;
    return (a.name||"").localeCompare(b.name||"ar");
  });

  libGrid.innerHTML = "";
  for(const it of filtered){
    const img = document.createElement("img");
    if(it.imageUrl){
      img.src = it.imageUrl;
    }else if(it.imagePath){
      // محاولة جلبه من Storage
      const path = it.imagePath.startsWith("food-items/")
        ? it.imagePath
        : `food-items/items/${it.id}/main.jpg`;
      getDownloadURL(sRef(storage, path)).then(url=> img.src = url).catch(()=>{});
    }else{
      img.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><rect width='100%' height='100%' fill='%23e5e7eb'/></svg>";
    }

    const tile = document.createElement("div");
    tile.className = "card-tile";
    tile.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <div class="name">${esc(it.name)}</div>
      <div class="sub">${esc(it.category)} • ${fmt(it.per100.carbs_g)}g كارب/100g</div>
      <div class="tags"></div>
    `;
    tile.appendChild(meta);

    const tags = meta.querySelector(".tags");
    const like = prefs.liked.includes(it.id);
    const dislike = prefs.disliked.includes(it.id);
    const allergy = itemHasAllergy(it);
    const violate = itemViolatesDiet(it);

    if(like) tags.appendChild(flag("مفضل ❤️","like"));
    if(dislike) tags.appendChild(flag("غير مفضل 💔","dislike"));
    if(violate) tags.appendChild(flag("مخالف للنظام ⚠️","diet"));
    if(allergy) tags.appendChild(flag("حساسية 🚫","allergy"));

    const act = document.createElement("div");
    act.className = "act";
    act.innerHTML = `
      <select class="est">
        ${it.measures.map(m=>`<option value="${m.key}|${m.grams}">${esc(m.key)} • ${fmt(m.grams)}g</option>`).join("")}
      </select>
      <button class="btn small" data-add>إضافة</button>
      <button class="btn small ghost" data-like>${like?"إلغاء ❤️":"❤️ مفضل"}</button>
      <button class="btn small ghost" data-dislike>${dislike?"إلغاء 💔":"💔 غير مفضل"}</button>
    `;
    tile.appendChild(act);

    act.querySelector("[data-add]").addEventListener("click", ()=>{
      if(allergy){
        const ok = confirm("هذا الصنف عليه حساسية مسجّلة للطفل. هل تريدين الإضافة على مسؤوليتك؟");
        if(!ok) return;
      }
      if(itemViolatesDiet(it)){
        const ok = confirm("الصنف مخالف للنظام الغذائي المحدد للطفل. متابعة؟");
        if(!ok) return;
      }
      const estVal = act.querySelector(".est").value;
      const [key, grams] = estVal.split("|");
      addItemFromLib(it, key, Number(grams||0));
      dlgLibrary.close();
    });

    act.querySelector("[data-like]").addEventListener("click", ()=>togglePref(it.id,"like"));
    act.querySelector("[data-dislike]").addEventListener("click", ()=>togglePref(it.id,"dislike"));

    libGrid.appendChild(tile);
  }
}

function flag(txt, cls){
  const el = document.createElement("span");
  el.className = `flag ${cls}`;
  el.textContent = txt;
  return el;
}

function togglePref(id, kind){
  // تحديث document: parents/{uid}/children/{childId}/foodPrefs
  const ref = doc(db, "parents", parentId, "children", childId, "foodPrefs");
  if(kind==="like"){
    if(prefs.liked.includes(id)){
      prefs.liked = prefs.liked.filter(x=>x!==id);
    }else{
      prefs.liked = [...new Set([id, ...prefs.liked])];
      // لو كان في غير مفضل أزيلة
      prefs.disliked = prefs.disliked.filter(x=>x!==id);
    }
  }else{
    if(prefs.disliked.includes(id)){
      prefs.disliked = prefs.disliked.filter(x=>x!==id);
    }else{
      prefs.disliked = [...new Set([id, ...prefs.disliked])];
      prefs.liked = prefs.liked.filter(x=>x!==id);
    }
  }
  setDoc(ref, prefs, { merge:true }).then(()=> renderLibrary());
}

// -----------------------------
// Items table
// -----------------------------
function addItemFromLib(it, measureKey, gramsPerPortion){
  const existing = items.find(x=> x.itemId===it.id && x.measureKey===measureKey && x.gramsPerPortion===gramsPerPortion);
  if(existing){
    existing.qty = roundQty(existing.qty + QTY_STEP);
  }else{
    items.push({
      itemId: it.id,
      name: it.name,
      image: it.imageUrl || it.imagePath || "",
      measureKey,
      gramsPerPortion,
      qty: 1,
      grams: gramsPerPortion,
      per100: it.per100
    });
  }
  renderItems();
  recalc();
}

function renderItems(){
  itemsBody.innerHTML = "";
  items.forEach((r, idx)=>{
    r.grams = fmt(r.gramsPerPortion * r.qty);

    const carb = fmt((r.per100.carbs_g * r.grams) / 100);
    const prot = fmt((r.per100.protein_g * r.grams) / 100);
    const fat  = fmt((r.per100.fat_g * r.grams) / 100);
    const cal  = fmt((r.per100.cal_kcal * r.grams) / 100);

    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="cell actions">
        <button class="icon" data-del title="حذف">🗑️</button>
      </div>
      <div class="cell">
        <div class="name">${esc(r.name)}</div>
      </div>
      <div class="cell">
        <span class="est-badge"><span class="est-name">${esc(r.measureKey)}</span> <span class="est-grams">${fmt(r.gramsPerPortion)}g/حصة</span></span>
      </div>
      <div class="cell">
        <div class="qty-wrap">
          <div class="stepper">
            <button data-dec>−</button>
            <input data-qty type="number" step="${QTY_STEP}" min="0" value="${fmt(r.qty)}" />
            <button data-inc>+</button>
          </div>
        </div>
      </div>
      <div class="cell num">${fmt(r.grams)}</div>
      <div class="cell num">${carb}</div>
      <div class="cell num">${prot}</div>
      <div class="cell num">${fat}</div>
      <div class="cell num">${cal}</div>
    `;

    row.querySelector("[data-del]").addEventListener("click", ()=>{
      items.splice(idx,1); renderItems(); recalc();
    });
    row.querySelector("[data-dec]").addEventListener("click", ()=>{
      r.qty = roundQty(Math.max(0, r.qty - QTY_STEP)); renderItems(); recalc();
    });
    row.querySelector("[data-inc]").addEventListener("click", ()=>{
      r.qty = roundQty(r.qty + QTY_STEP); renderItems(); recalc();
    });
    row.querySelector("[data-qty]").addEventListener("change", (e)=>{
      const v = Number(e.target.value||0);
      r.qty = roundQty(Math.max(0, v)); renderItems(); recalc();
    });

    itemsBody.appendChild(row);
  });
}

function roundQty(v){ return Math.max(0, roundTo(v, QTY_STEP)); }

// -----------------------------
// Recalc
// -----------------------------
function recalc(){
  // مجاميع
  let sumCarb=0, sumProt=0, sumFat=0, sumCal=0;
  items.forEach(r=>{
    const grams = r.gramsPerPortion * r.qty;
    sumCarb += (r.per100.carbs_g   * grams) / 100;
    sumProt += (r.per100.protein_g * grams) / 100;
    sumFat  += (r.per100.fat_g     * grams) / 100;
    sumCal  += (r.per100.cal_kcal  * grams) / 100;
  });

  sumCarb = fmt(sumCarb); sumProt=fmt(sumProt); sumFat=fmt(sumFat); sumCal=fmt(sumCal);

  netCarbEl.textContent = sumCarb;
  totalCalEl.textContent = sumCal;
  totalProtEl.textContent = sumProt;
  totalFatEl.textContent = sumFat;

  sumCarbEl.textContent = sumCarb;
  sumProtEl.textContent = sumProt;
  sumFatEl.textContent = sumFat;
  sumCalEl.textContent  = sumCal;

  // جرعة الكارب المقترحة
  let carbDose = 0;
  if(CR>0){ carbDose = sumCarb / CR; }
  carbDose = roundTo(carbDose, DOSE_ROUND);
  doseCarbEl.value = carbDose;

  // جرعة التصحيح – شرط الارتفاع الشديد
  let corrDose = 0;
  const pre = Number(preReadingEl.value || 0);
  if(pre >= toUnit(CRIT_HIGH_MMOL)){
    const base = isMmol() ? BASE_MMOL : BASE_MGDL;
    if(CF>0){
      corrDose = (pre - base) / CF;
      corrDose = Math.max(0, corrDose);
    }
  }
  corrDose = roundTo(corrDose, DOSE_ROUND);
  doseCorrectionEl.value = corrDose;

  doseTotalEl.value = fmt(Number(doseCarbEl.value||0) + Number(doseCorrectionEl.value||0));

  // شريط الهدف
  updateTargetsUI();
  refreshAssistant();
}

function isMmol(){ return (glucoseUnit||"").toLowerCase().includes("mmol"); }
function toUnit(mmol){
  if(isMmol()) return mmol;
  // تحويل إلى mg/dL
  return Math.round(mmol * 18);
}

// -----------------------------
// Targets UI + Adjust
// -----------------------------
function updateTargetsUI(){
  const t = getTargetsForMeal();
  if(!t){ targetTextEl.textContent = "لا يوجد هدف"; progressFillEl.style.width = "0%"; return; }

  targetTextEl.textContent = `${t.min}–${t.max} g`;
  // نسبة على max
  const val = Number(netCarbEl.textContent||0);
  let pct = t.max ? (val / t.max) * 100 : 0;
  pct = Math.max(0, Math.min(100, pct));
  progressFillEl.style.width = pct + "%";
  progressFillEl.style.background = (val < t.min || val > t.max) ? "#f97316" : "#16a34a";
}

function getTargetsForMeal(){
  if(!carbTargets) return null;
  const map = { "فطار":"breakfast", "غدا":"lunch", "عشا":"dinner", "سناك":"snack" };
  const key = map[mealTypeEl.value];
  return key ? carbTargets[key] : null;
}

$("#btnAdjustToTarget").addEventListener("click", ()=>{
  const t = getTargetsForMeal();
  if(!t){ showToast("لا يوجد هدف لهذه الوجبة"); return; }
  // نعدل على الصنف الأعلى كارب/حصة
  if(!items.length){ showToast("أضيفي صنفًا أولًا"); return; }
  const top = highestCarbPerPortion();
  if(!top){ showToast("لا يمكن الحساب لعدم وجود بيانات كافية"); return; }

  const cur = Number(netCarbEl.textContent||0);
  const cpp = carbPerPortion(top);
  if(cpp<=0){ showToast("لا يوجد كارب/حصة في الصنف"); return; }

  if(cur < t.min){
    const diff = t.min - cur;
    const delta = ceilTo(diff / cpp, QTY_STEP);
    top.qty = roundQty(top.qty + delta);
    renderItems(); recalc();
    showToast(`زودنا ${top.name} +${fmt(delta)} حصة للوصول للحد الأدنى 🎯`);
  }else if(cur > t.max){
    const diff = cur - t.max;
    const delta = ceilTo(diff / cpp, QTY_STEP);
    top.qty = roundQty(Math.max(0, top.qty - delta));
    renderItems(); recalc();
    showToast(`قللنا ${top.name} −${fmt(delta)} حصة للانضباط داخل الهدف 🎯`);
  }else{
    showToast("أنتِ بالفعل داخل نطاق الهدف ✅");
  }
});

$("#btnSmartDistribute").addEventListener("click", ()=>{
  const t = getTargetsForMeal();
  if(!t){ showToast("لا يوجد هدف لهذه الوجبة"); return; }
  if(items.length===0){ showToast("أضيفي أصنافًا أولًا"); return; }
  const sorted = [...items].sort((a,b)=> carbPerPortion(b)-carbPerPortion(a));
  const topN = sorted.slice(0, Math.min(3, sorted.length)); // وزعي على أعلى 3 أصناف
  const cur = Number(netCarbEl.textContent||0);

  if(cur < t.min){
    let remaining = t.min - cur;
    while(remaining > 0.0001){
      for(const r of topN){
        const stepCarb = carbPerPortion(r) * QTY_STEP;
        r.qty = roundQty(r.qty + QTY_STEP);
        remaining -= stepCarb;
        if(remaining <= 0) break;
      }
    }
    renderItems(); recalc();
    showToast("تم توزيع الزيادة ذكيًا على أعلى الأصناف كارب 🔀");
  }else if(cur > t.max){
    let remaining = cur - t.max;
    while(remaining > 0.0001){
      for(const r of topN){
        if(r.qty <= 0) continue;
        const stepCarb = carbPerPortion(r) * QTY_STEP;
        r.qty = roundQty(Math.max(0, r.qty - QTY_STEP));
        remaining -= stepCarb;
        if(remaining <= 0) break;
      }
      // لو كله صفر توقف
      if(topN.every(x=>x.qty<=0)) break;
    }
    renderItems(); recalc();
    showToast("تم توزيع التخفيض ذكيًا على أعلى الأصناف كارب 🔀");
  }else{
    showToast("أنتِ بالفعل داخل نطاق الهدف ✅");
  }
});

function carbPerPortion(r){
  return (r.per100.carbs_g * r.gramsPerPortion) / 100;
}
function highestCarbPerPortion(){
  let best=null, bestVal=-1;
  for(const r of items){
    const v = carbPerPortion(r);
    if(v>bestVal){ best=r; bestVal=v; }
  }
  return best;
}

// -----------------------------
// Assistant
// -----------------------------
assistantBtn.addEventListener("click", ()=>{
  assistantPanel.classList.toggle("hidden");
});
assistantClose.addEventListener("click", ()=>{
  assistantPanel.classList.add("hidden");
});
assistantPanel.addEventListener("click", (e)=>{
  const ask = e.target.getAttribute?.("data-ask");
  if(ask) pushAssistant(ask);
});

function refreshAssistant(){
  const pre = Number(preReadingEl.value||0);
  const post = Number(postReadingEl.value||0);
  const net = Number(netCarbEl.textContent||0);
  const t = getTargetsForMeal();

  assistantBody.innerHTML = "";

  // تصحيح؟
  if(pre >= toUnit(CRIT_HIGH_MMOL)){
    const base = isMmol()? BASE_MMOL : BASE_MGDL;
    const need = CF>0 ? fmt((pre-base)/CF) : 0;
    pushAssistant(`القياس قبل الوجبة = ${pre} ${glucoseUnit}. هذا أعلى من حد الارتفاع الشديد ${toUnit(CRIT_HIGH_MMOL)}، لذلك يظهر تصحيح. المقترح ≈ ${roundTo(need, DOSE_ROUND)}U (CF=${CF}).`);
  }else{
    pushAssistant(`القياس قبل الوجبة = ${pre} ${glucoseUnit}. أقل من 10.9، لذا لا حاجة لتصحيح تلقائي.`);
  }

  if(t){
    if(net < t.min) pushAssistant(`صافي الكارب ${net}g أقل من الحد الأدنى ${t.min}g. استخدمي زر "ضبط للهدف" أو "توزيع ذكي" لزيادة الكميات.`); 
    else if(net > t.max) pushAssistant(`صافي الكارب ${net}g أعلى من الحد الأقصى ${t.max}g. استخدمي "ضبط للهدف" لتقليل الكميات.`); 
    else pushAssistant(`صافي الكارب ${net}g داخل الهدف (${t.min}–${t.max}g) ✅`);
  }

  // تحذيرات الحساسية/النظام
  const allergyItems = items.filter(r=>{
    const lib = libCache.find(x=>x.id===r.itemId);
    return lib && itemHasAllergy(lib);
  });
  const dietItems = items.filter(r=>{
    const lib = libCache.find(x=>x.id===r.itemId);
    return lib && itemViolatesDiet(lib);
  });
  if(allergyItems.length) pushAssistant("⚠️ لديك أصناف بها حساسية: " + allergyItems.map(x=>x.name).join("، "));
  if(dietItems.length) pushAssistant("⚠️ أصناف مخالفة للنظام: " + dietItems.map(x=>x.name).join("، "));
}

function pushAssistant(text){
  const p = document.createElement("div");
  p.textContent = text;
  assistantBody.appendChild(p);
}

// -----------------------------
// Save / Presets
// -----------------------------
$("#btnSaveMeal").addEventListener("click", saveMeal);
$("#btnReset").addEventListener("click", ()=>{ items = []; renderItems(); recalc(); });

$("#btnSaveAsPreset").addEventListener("click", saveAsPreset);
$("#btnAddFromPreset").addEventListener("click", ()=> dlgPresets.showModal());

async function saveMeal(){
  if(!currentUser){ showToast("الرجاء تسجيل الدخول"); return; }
  const type = mealTypeEl.value;
  const date = mealDateEl.value || new Date().toISOString().slice(0,10);
  if(!items.length){ showToast("أضيفي عناصر للوجبة أولًا"); return; }

  const payload = {
    type, date,
    createdAt: Timestamp.fromDate(new Date()),
    preReading: {
      value: Number(preReadingEl.value||0),
      unit: glucoseUnit,
      slotKey: (MEAL_SLOTS[type]||[])[0] || "PRE",
      autoPicked: Boolean(hintAutoEl.style.display!=="none")
    },
    postReading: Number(postReadingEl.value||0) || null,
    correctionDose: Number(doseCorrectionEl.value||0),
    carbDose: Number(doseCarbEl.value||0),
    totalDose: Number(doseTotalEl.value||0),
    netCarb: Number(netCarbEl.textContent||0),
    totals: {
      cal: Number(totalCalEl.textContent||0),
      carb: Number(netCarbEl.textContent||0),
      protein: Number(totalProtEl.textContent||0),
      fat: Number(totalFatEl.textContent||0)
    },
    CR, CF, glucoseUnit,
    items: items.map(r=>({
      itemId: r.itemId,
      name: r.name,
      image: r.image,
      measureKey: r.measureKey,
      gramsPerPortion: r.gramsPerPortion,
      qty: r.qty,
      grams: fmt(r.gramsPerPortion * r.qty),
      per100: r.per100
    })),
    notes: (notesEl.value||"").trim()
  };

  const coll = collection(db, "parents", parentId, "children", childId, "meals");
  await addDoc(coll, payload);
  showToast("تم حفظ الوجبة ✅");
}

async function saveAsPreset(){
  if(!items.length){ showToast("لا توجد عناصر للحفظ كقالب"); return; }
  const name = prompt("اسم القالب:");
  if(!name) return;
  const type = mealTypeEl.value;

  const payload = {
    name, type,
    items: items.map(r=>({
      itemId: r.itemId, name: r.name,
      measureKey: r.measureKey, gramsPerPortion: r.gramsPerPortion, qty: r.qty
    })),
    updatedAt: Timestamp.fromDate(new Date())
  };
  const coll = collection(db, "parents", parentId, "presets");
  await addDoc(coll, payload);
  showToast("تم حفظ القالب ✅");
  await loadPresets();
}

function applyPreset(p){
  items = [];
  for(const r of (p.items||[])){
    const it = libCache.find(x=>x.id===r.itemId);
    if(!it) continue;
    items.push({
      itemId: it.id, name: it.name,
      image: it.imageUrl || it.imagePath || "",
      measureKey: r.measureKey,
      gramsPerPortion: r.gramsPerPortion,
      qty: r.qty ?? 1,
      grams: r.gramsPerPortion * (r.qty ?? 1),
      per100: it.per100
    });
  }
  renderItems(); recalc();
}

// -----------------------------
// Events
// -----------------------------
function bindHeaderListeners(){
  mealTypeEl.addEventListener("change", async ()=>{
    await tryPickPreReading(); recalc();
  });
  mealDateEl.addEventListener("change", async ()=>{
    await tryPickPreReading(); recalc();
  });
  preReadingEl.addEventListener("input", recalc);
  doseCorrectionEl.addEventListener("input", ()=>{
    doseTotalEl.value = fmt(Number(doseCarbEl.value||0) + Number(doseCorrectionEl.value||0));
    refreshAssistant();
  });
  doseCarbEl.addEventListener("input", ()=>{
    doseTotalEl.value = fmt(Number(doseCarbEl.value||0) + Number(doseCorrectionEl.value||0));
  });

  // مودالات
  dlgLibrary.addEventListener("click", (e)=>{
    if(e.target.matches("[data-close]")) dlgLibrary.close();
  });
  dlgPresets.addEventListener("click", (e)=>{
    if(e.target.matches("[data-close]")) dlgPresets.close();
  });

  libSearch.addEventListener("input", renderLibrary);
  fltLiked.addEventListener("change", renderLibrary);
  fltHideDiet.addEventListener("change", renderLibrary);
  fltHideAllergy.addEventListener("change", renderLibrary);

  $("#btnBack").addEventListener("click", ()=> history.back());
}

// -----------------------------
// Utils
// -----------------------------
function esc(s){ return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  toastEl.classList.remove("hidden");
  setTimeout(()=> toastEl.classList.remove("show"), 2300);
}
