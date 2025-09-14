import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, collection, addDoc, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { suggestAlternatives } from "./ai.js";

const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0");
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function round05(x){ return Math.round(x/0.05)*0.05; }

const qs=new URLSearchParams(location.search);
let childId = qs.get("child") || localStorage.getItem("lastChildId") || null;

const hdrChildName=$("#hdrChildName");
const s_name=$("#s_name"), s_unit=$("#s_unit"), s_cr=$("#s_cr"), s_cf=$("#s_cf"), s_normal=$("#s_normal"), s_targetPref=$("#s_targetPref");
const goalChips=$("#goalChips");
const mealType=$("#mealType");
const glucoseNow=$("#glucoseNow"), unitHint=$("#unitHint");
const gramsPerPortion=$("#gramsPerPortion"), portions=$("#portions"), carbs=$("#carbs");
const crUsed=$("#crUsed"), cfUsed=$("#cfUsed"), crSource=$("#crSource"), cfSource=$("#cfSource"), targetValue=$("#targetValue");
const doseMeal=$("#doseMeal"), doseCorr=$("#doseCorr"), doseTotal=$("#doseTotal");
const rangeText=$("#rangeText"), rangeHint=$("#rangeHint");
const btnSave=$("#btnSave"), statusEl=$("#status");
const backChild=$("#backChild");

const btnOpenLibrary = $("#btnOpenLibrary");
const libModal = $("#libModal"), libClose = $("#libClose");
const libSearch = $("#libSearch"), libList = $("#libList");
const libFilterDiet = $("#libFilterDiet"), libFilterAllergy = $("#libFilterAllergy");

const aiModal = $("#aiModal"), aiClose = $("#aiClose"), aiList = $("#aiList");
const btnSuggestAI = $("#btnSuggestAI");

const basketBody = $("#basketBody");
const basketTotalEl = $("#basketTotal");

let user=null, child=null, parentId=null;
let basket = []; // [{id,name,gramsPerPortion,portions,carbs,_c100,flags,allergens}, …]

function setStatus(msg){ if(statusEl) statusEl.textContent = msg || "—"; }

function computeNormal(unit, custom){
  if (custom && custom.min!=null && custom.max!=null) return { min:+custom.min, max:+custom.max, src:"custom" };
  if (unit==="mmol/L") return { min:3.5, max:7, src:"default" };
  if (unit==="mg/dL") return { min:63, max:126, src:"default" };
  return { min:null, max:null, src:"unknown" };
}
function targetFromPref(nrm, pref){ if (!nrm || nrm.min==null || nrm.max==null) return null; return (pref==="mid") ? (+nrm.min + +nrm.max)/2 : +nrm.max; }

function goalsFor(meal, ct){
  const m = { breakfast:"breakfast", lunch:"lunch", dinner:"dinner", snack:"snack" }[meal] || "breakfast";
  const g = (ct && ct[m]) || null;
  if (!g) return {min:null,max:null};
  return { min: (g.min!=null? +g.min : null), max: (g.max!=null? +g.max : null) };
}
function paintRange(meal){
  const {min,max} = goalsFor(meal, child?.carbTargets || child?.carbGoals); // يدعم القديم
  const v = +carbs.value || 0;
  let cls="range-ok", hint="";
  if (min==null && max==null){ rangeText.textContent="—"; rangeHint.textContent="لا يوجد هدف محدد."; rangeText.className=""; return; }
  rangeText.textContent = `${min ?? "—"}–${max ?? "—"} جم`;
  if ((min!=null && v<min) || (max!=null && v>max)){ cls = (max!=null && v>max) ? "range-bad" : "range-warn"; hint = "خارج النطاق"; }
  else { hint="داخل النطاق"; }
  rangeText.className = cls; rangeHint.textContent = hint;
}

function pickCR(meal){
  const map = {breakfast:"b", lunch:"l", dinner:"d", snack:"s"};
  const k = map[meal];
  const by = child?.carbRatioByMeal?.[k];
  if (by!=null && !Number.isNaN(+by)) return { val:+by, src:"حسب الوجبة" };
  if (child?.carbRatio!=null) return { val:+child.carbRatio, src:"عام" };
  return { val:null, src:"غير متاح" };
}
function pickCF(meal){
  const map = {breakfast:"b", lunch:"l", dinner:"d", snack:"s"};
  const k = map[meal];
  const by = child?.correctionFactorByMeal?.[k];
  if (by!=null && !Number.isNaN(+by)) return { val:+by, src:"حسب الوجبة" };
  if (child?.correctionFactor!=null) return { val:+child.correctionFactor, src:"عام" };
  return { val:null, src:"غير متاح" };
}

function updateCarbsFromPortions(){
  const gpp = +gramsPerPortion.value;
  const p   = +portions.value;
  if (!Number.isNaN(gpp) && !Number.isNaN(p)){
    carbs.value = +(gpp * p).toFixed(1);
  }
}

function recalc(){
  const meal = mealType.value;
  const CR = pickCR(meal); crUsed.textContent = CR.val??"—"; crSource.textContent = CR.src;
  const CF = pickCF(meal); cfUsed.textContent = CF.val??"—"; cfSource.textContent = CF.src;

  const unit = child?.unit || child?.glucoseUnit || "";
  const nrm = computeNormal(unit, child?.glucoseTargets?.normal || child?.normalRange);
  const target = targetFromPref(nrm, child?.glucoseTargets?.targetPref || "max");
  targetValue.textContent = (target!=null? `${target} ${unit}` : "—");

  const c = +carbs.value;
  const gNow = +glucoseNow.value;

  let dm = null, dc = null, total = null;

  if (CR.val!=null && !Number.isNaN(c)){
    dm = c / CR.val;
  }
  if (CF.val!=null && !Number.isNaN(gNow) && target!=null){
    const diff = gNow - target;
    dc = diff / CF.val;
  }

  if (dm!=null || dc!=null){
    total = round05((dm||0) + Math.max(0, dc||0)); // لا نقلّل تحت الهدف (سياسة أمان بسيطة)
  }

  doseMeal.textContent  = (dm==null? "—" : round05(dm).toFixed(2));
  doseCorr.textContent  = (dc==null? "—" : round05(Math.max(0,dc)).toFixed(2));
  doseTotal.textContent = (total==null? "—" : total.toFixed(2));

  paintRange(meal);
}

function chip(text){ const s=document.createElement("span"); s.className="chip"; s.textContent=text; return s; }
function renderGoalChips(){
  goalChips.innerHTML="";
  const ct = child?.carbTargets || child?.carbGoals || {};
  const pairs = [
    ["فطار", ct.breakfast || ct.b],
    ["غدا",   ct.lunch     || ct.l],
    ["عشا",   ct.dinner    || ct.d],
    ["سناك",  ct.snack     || ct.s],
  ];
  for (const [name,g] of pairs){
    let min=null,max=null;
    if (Array.isArray(g)){ min=g?.[0]; max=g?.[1]; }
    else if (g){ min=g.min; max=g.max; }
    const text = (min==null && max==null) ? `${name}: —` : `${name}: ${min ?? "—"}–${max ?? "—"} جم`;
    goalChips.appendChild(chip(text));
  }
}

/* ====== المكتبة ====== */
async function fetchLibraryItems() {
  // قراءة من admin/global/foodItems (قواعدك تسمح read: true)
  const col = collection(db, "admin", "global", "foodItems");
  try{
    const snap = await getDocs(col);
    return snap.docs.map(d=>({ id:d.id, ...d.data() }));
  }catch{ return []; }
}
function isAllowedForChild(item, useDiet, useAllergy){
  if (!child) return true;
  const flags = new Set(child.dietaryFlags || []);
  const allergies = new Set((child.allergies || []).map(a=>String(a).toLowerCase()));

  if (useDiet){
    if (flags.has("low_carb") && item.high_carb === true) return false;
    if (flags.has("low_sodium") && item.high_sodium === true) return false;
    if (flags.has("low_fat") && item.high_fat === true) return false;
    if (flags.has("lactose_free") && (item.contains_lactose || item.lactose === true)) return false;
    if (flags.has("gluten_free") && (item.contains_gluten || item.gluten === true)) return false;
    if (flags.has("vegan") && item.is_vegan === false) return false;
    if (flags.has("vegetarian") && item.is_vegetarian === false) return false;
    if (flags.has("halal") && item.halal === false) return false;
  }
  if (useAllergy){
    const itemAll = (item.allergens || []).map(a=>String(a).toLowerCase());
    for (const a of itemAll){ if (allergies.has(a)) return false; }
  }
  return true;
}
async function loadLib(){
  libList.innerHTML = "جارٍ التحميل…";
  const raw = await fetchLibraryItems();
  const q = (libSearch.value||"").trim().toLowerCase();
  const items = raw
    .filter(it=> isAllowedForChild(it, libFilterDiet?.checked, libFilterAllergy?.checked))
    .filter(it=>{
      if (!q) return true;
      const name = String(it.nameAr || it.name || "").toLowerCase();
      return name.includes(q);
    })
    .slice(0, 80);

  libList.innerHTML = "";
  for (const it of items){
    const div = document.createElement("div");
    div.className = "lib-item";
    const tags = [];
    if (it.is_vegan) tags.push("نباتي صارم");
    if (it.is_vegetarian) tags.push("نباتي");
    if (it.gluten === false) tags.push("خالٍ من الجلوتين");
    if (it.lactose === false) tags.push("خالٍ من اللاكتوز");
    if (it.halal) tags.push("حلال");

    div.innerHTML = `
      <div class="name">${it.nameAr || it.name || "صنف"}</div>
      <div class="meta">
        كارب/100جم: <b>${it.carbsPer100g ?? "—"}</b>
        ${it.servingSize ? ` • الحصة: ${it.servingSize}جم` : ""}
      </div>
      <div class="tags">${tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
      <div class="row">
        <input type="number" step="0.25" min="0" placeholder="الكمية (حصة)" class="qty" />
        <input type="number" step="0.1" min="0" placeholder="جرام/حصة" class="gpp" value="${it.gramsPerPortion ?? it.servingSize ?? ""}" />
        <button class="btn add">إضافة</button>
      </div>
    `;
    const qty = div.querySelector(".qty");
    const gpp = div.querySelector(".gpp");
    div.querySelector(".add").addEventListener("click", ()=>{
      const portions = +qty.value || 0;
      const gramsPerPortion = +gpp.value || 0;
      const carbsPer100g = +it.carbsPer100g || 0;
      const carbsVal = gramsPerPortion && portions && carbsPer100g
        ? +( (gramsPerPortion * portions) * carbsPer100g / 100 ).toFixed(1)
        : null;

      basket.push({
        id: it.id, name: it.nameAr || it.name || "صنف",
        gramsPerPortion, portions, carbs: carbsVal,
        _c100: carbsPer100g,
        flags: it.flags || [], allergens: it.allergens || []
      });
      renderBasket(); closeLib();
    });
    libList.appendChild(div);
  }
}
function openLib(){ libModal.classList.remove("hidden"); libSearch.value=""; loadLib(); }
function closeLib(){ libModal.classList.add("hidden"); }

function renderBasket(){
  basketBody.innerHTML = "";
  if (!basket.length){
    basketBody.innerHTML = `<tr class="empty"><td colspan="5">لا توجد أصناف بعد</td></tr>`;
    basketTotalEl.textContent = "0";
    carbs.value = ""; // يُفرّغ إن لم يوجد أصناف
    recalc();
    return;
  }
  let total = 0;
  for (const [i,row] of basket.entries()){
    total += (+row.carbs || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.name}</td>
      <td><input type="number" step="0.25" min="0" class="bPortions" value="${row.portions ?? ""}"></td>
      <td><input type="number" step="0.1"  min="0" class="bGpp" value="${row.gramsPerPortion ?? ""}"></td>
      <td class="bCarbs">${row.carbs ?? "—"}</td>
      <td><button class="btn" data-i="${i}">حذف</button></td>
    `;
    const inpP = tr.querySelector(".bPortions");
    const inpG = tr.querySelector(".bGpp");
    const cellC = tr.querySelector(".bCarbs");

    function updateRow(){
      const portionsVal = +inpP.value || 0;
      const gppVal = +inpG.value || 0;
      row.portions = portionsVal; row.gramsPerPortion = gppVal;

      if (row._c100){
        row.carbs = gppVal && portionsVal ? +((gppVal * portionsVal) * row._c100 / 100).toFixed(1) : null;
      } else {
        // fallback نسبة تقديرية إن ما في _c100
        const perGram = row.carbs && row.gramsPerPortion && row.portions ? (row.carbs / (row.gramsPerPortion * row.portions)) : null;
        row.carbs = (perGram && gppVal && portionsVal) ? +((gppVal * portionsVal) * perGram).toFixed(1) : null;
      }
      cellC.textContent = (row.carbs ?? "—");
      renderBasket(); // لإعادة جمع الإجمالي وتحديث الحساب
    }

    inpP.addEventListener("input", updateRow);
    inpG.addEventListener("input", updateRow);
    tr.querySelector("button[data-i]").addEventListener("click", ()=>{
      basket.splice(i,1); renderBasket();
    });
    basketBody.appendChild(tr);
  }
  basketTotalEl.textContent = total.toFixed(1);

  // استخدم الإجمالي كقيمة الكارب للوجبة
  carbs.value = total.toFixed(1);
  recalc();
}

/* ====== الذكاء الاصطناعي ====== */
async function openAISuggestions(){
  aiModal.classList.remove("hidden");
  aiList.textContent = "جارٍ التحليل…";
  try{
    const suggestions = await suggestAlternatives({
      child: {
        dietaryFlags: child?.dietaryFlags || [],
        allergies: child?.allergies || [],
        preferred: child?.preferred || [],
        disliked: child?.disliked || [],
        carbTargets: child?.carbTargets || child?.carbGoals || {}
      },
      mealType: mealType.value,
      basket: basket.map(b=>({ name:b.name, portions:b.portions, gramsPerPortion:b.gramsPerPortion, carbs:b.carbs }))
    });

    aiList.innerHTML = "";
    if (!suggestions?.length){ aiList.textContent = "لا توجد بدائل مناسبة الآن."; return; }
    for (const it of suggestions.slice(0,6)){
      const card = document.createElement("div");
      card.className = "lib-item";
      card.innerHTML = `
        <div class="name">${it.name || "بديل"}</div>
        <div class="meta">${it.why || ""}</div>
        <div class="row">
          <button class="btn apply">استبدال</button>
        </div>
      `;
      card.querySelector(".apply").addEventListener("click", ()=>{
        const targetName = it.swapFor || (basket[0]?.name);
        const i = basket.findIndex(b=> b.name === targetName);
        if (i >= 0){
          basket[i].name = it.name;
          basket[i].carbs = null; // حدد الكمية لاحقاً
        } else {
          basket.push({ id:"ai-"+Date.now(), name:it.name, gramsPerPortion:null, portions:null, carbs:null });
        }
        renderBasket();
        aiModal.classList.add("hidden");
      });
      aiList.appendChild(card);
    }
  }catch(e){
    console.error(e);
    aiList.textContent = "تعذّر الحصول على بدائل الآن.";
  }
}

/* ====== تهيئة وتحميل بيانات الطفل ====== */
auth.onAuthStateChanged(async (u)=>{
  if(!u){ location.href="index.html"; return; }
  user=u; parentId=u.uid;

  if(!childId){
    childId = localStorage.getItem("lastChildId");
    if(!childId){ location.replace("parent.html?pickChild=1"); return; }
  }
  $("#backChild").href = `child.html?child=${encodeURIComponent(childId)}`;

  try{
    setStatus("جارٍ التحميل…");
    const childRef = doc(db, `parents/${parentId}/children/${childId}`);
    const snap = await getDoc(childRef);
    if(!snap.exists()){ setStatus("❌ لا توجد بيانات للطفل"); return; }
    child = snap.data();

    s_name.textContent = child.name || "—";
    hdrChildName.textContent = child.name || "—";
    const unit = child.unit || child.glucoseUnit || "";
    s_unit.textContent = unit || "—";
    unitHint.textContent = unit ? `الوحدة: ${unit}` : "—";

    s_cr.textContent = (child.carbRatio!=null? `${child.carbRatio} g/U` : "—");
    s_cf.textContent = (child.correctionFactor!=null? `${child.correctionFactor} ${unit}/U` : "—");

    const nrm = computeNormal(unit, child?.glucoseTargets?.normal || child?.normalRange);
    s_normal.textContent = (nrm.min==null||nrm.max==null) ? "—" : `${nrm.min}–${nrm.max} ${unit}`;
    s_targetPref.textContent = (child?.glucoseTargets?.targetPref==="mid") ? "منتصف المدى" : "الحد الأعلى";

    // نطاقات كارب
    renderGoalChips();
    recalc();

    setStatus("✅ جاهز");
  }catch(e){
    console.error(e);
    setStatus("❌ خطأ في التحميل");
  }
});

/* ====== تفاعلات ====== */
[mealType, glucoseNow, gramsPerPortion, portions, carbs].forEach(el=> el?.addEventListener("input", ()=>{
  if (el===portions || el===gramsPerPortion) {
    const gpp = +gramsPerPortion.value, p=+portions.value;
    if(!Number.isNaN(gpp) && !Number.isNaN(p)) carbs.value = +(gpp*p).toFixed(1);
  }
  recalc();
}));

btnOpenLibrary?.addEventListener("click", openLib);
libClose?.addEventListener("click", ()=> libModal.classList.add("hidden"));
libSearch?.addEventListener("input", loadLib);
libFilterDiet?.addEventListener("change", loadLib);
libFilterAllergy?.addEventListener("change", loadLib);

btnSuggestAI?.addEventListener("click", openAISuggestions);
aiClose?.addEventListener("click", ()=> aiModal.classList.add("hidden"));

/* ====== حفظ الوجبة ====== */
btnSave?.addEventListener("click", async ()=>{
  try{
    setStatus("جارٍ الحفظ…");
    const meal = mealType.value;
    const unit = child?.unit || child?.glucoseUnit || "";

    const CR = (pickCR(meal).val ?? null);
    const CF = (pickCF(meal).val ?? null);
    const nrm = computeNormal(unit, child?.glucoseTargets?.normal || child?.normalRange);
    const target = targetFromPref(nrm, child?.glucoseTargets?.targetPref || "max");

    const payload = {
      date: todayStr(),
      createdAt: Date.now(),
      mealType: meal,
      gramsPerPortion: (+gramsPerPortion.value)||null,
      portions: (+portions.value)||null,
      carbs: (+carbs.value)||null,
      glucoseNow: (+glucoseNow.value)||null,
      unit,
      usedCR: CR,
      usedCF: CF,
      target,
      doses: {
        meal: doseMeal.textContent==="—" ? null : +doseMeal.textContent,
        corr: doseCorr.textContent==="—" ? null : +doseCorr.textContent,
        total: doseTotal.textContent==="—" ? null : +doseTotal.textContent,
      },
      items: basket.map(b=>({
        name: b.name,
        portions: b.portions ?? null,
        gramsPerPortion: b.gramsPerPortion ?? null,
        carbs: b.carbs ?? null
      }))
    };

    const ref = collection(db, `parents/${parentId}/children/${childId}/meals`);
    await addDoc(ref, payload);
    setStatus("✅ تم حفظ الوجبة");
  }catch(e){
    console.error(e);
    setStatus("❌ تعذّر حفظ الوجبة");
  }
});
