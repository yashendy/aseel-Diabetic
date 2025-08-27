/* ======================================================
   meals.js — نسخة كاملة (Firebase v12 Modular)
   - Fix 1: Fallback mapping للقيم الغذائية
   - Fix 2: حفظ الوجبة بهيكل meals/{yyyy-mm-dd}/items
   ====================================================== */

// Firebase SDK (modular v12)
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, writeBatch,
  query, where, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { app } from "./firebase-config.js"; // يفترض عندك تهيئة ترجع app

/* ===== Helpers ===== */
const db = getFirestore(app);
const auth = getAuth(app);

const round1 = (n) => Math.round((+n || 0) * 10) / 10;
const clampNonNeg = (n) => Math.max(0, +n || 0);
const fmt = (n) => (isFinite(n) ? (Math.round(n*10)/10).toFixed(1) : "0.0");
const pad2 = (n)=>String(n).padStart(2,"0");
const getYMD = (d)=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

const PATHS = {
  childrenCol: (uid)=> `parents/${uid}/children`,
  childDoc: (uid, childId)=> `parents/${uid}/children/${childId}`,
  mealTemplates: (uid, childId)=> `parents/${uid}/children/${childId}/mealTemplates`,
  mealsDayDoc: (uid, childId, ymd)=> `parents/${uid}/children/${childId}/meals/${ymd}`,
  mealsItemsCol: (uid, childId, ymd)=> `parents/${uid}/children/${childId}/meals/${ymd}/items`,
  measurements: (uid, childId)=> `parents/${uid}/children/${childId}/measurements`,
  foodItems: (uid)=> `parents/${uid}/foodItems`,
};

const TYPE_LABELS = ["فطار","غدا","عشا","سناك"];

/* ===== DOM (اسماء العناصر عندك قد تكون مختلفة — حافظنا على الشائع) ===== */
const childSelect = document.getElementById("childSelect"); // لو موجود
const dateInput = document.getElementById("dateInput");
const slotSel  = document.getElementById("mealSlot");
const rowsEl   = document.getElementById("rows");
const addRowBtn= document.getElementById("addRow");
const saveBtn  = document.getElementById("saveMeal");
const preReading = document.getElementById("preReading");
const postReading= document.getElementById("postReading");
const reloadMeasures = document.getElementById("reloadMeasures");
const sumCarbsEl = document.getElementById("sumCarbs");
const sumGLEl    = document.getElementById("sumGL");
const avgGIEl    = document.getElementById("avgGI");

// القوالب (لو موجودة بصفحتك)
const openTplBtn = document.getElementById("openTpl");
const saveAsTplBtn = document.getElementById("saveAsTpl");
const tplModal  = document.getElementById("tplModal");
const closeTplBtn = document.getElementById("closeTpl");
const tplTabs   = [...document.querySelectorAll(".tab")];
const tplList   = document.getElementById("tplList");
const saveTplModal = document.getElementById("saveTplModal");
const tplNameInput = document.getElementById("tplName");
const tplTypeInput = document.getElementById("tplType");
const confirmSaveTpl = document.getElementById("confirmSaveTpl");
const cancelSaveTpl  = document.getElementById("cancelSaveTpl");
const saveStatus = document.getElementById("saveStatus");
const tplMsg = document.getElementById("tplMsg");

/* ===== Auth + Child resolver ===== */
function waitForUser(){
  return new Promise(resolve=>{
    const off = onAuthStateChanged(auth, (u)=>{ off(); resolve(u); });
  });
}
function getUrlParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

/** 
 * نجيب childId بالترتيب:
 * 1) من ?child=ID في الرابط (أسلوب ملفك الأصلي)
 * 2) لو select#childSelect موجودة وتم تعبئتها
 * 3) إن لم يوجد، نقرأ أول طفل من قاعدة البيانات ونستخدمه
 */
async function resolveChildId(uid){
  const fromUrl = getUrlParam("child");
  if (fromUrl) return fromUrl;

  if (childSelect && childSelect.value) return childSelect.value;

  // fallback: أول طفل
  const snap = await getDocs(collection(db, PATHS.childrenCol(uid)));
  if (!snap.empty) return snap.docs[0].id;

  return null;
}

/* ===== الصفحة ready ===== */
document.addEventListener("DOMContentLoaded", async ()=>{
  if (dateInput) dateInput.valueAsDate = new Date();

  const user = await waitForUser();
  if(!user){ alert("يجب تسجيل الدخول."); return; }

  // لو فيه قائمة أطفال، نعبّيها
  if (childSelect){
    const snap = await getDocs(collection(db, PATHS.childrenCol(user.uid)));
    childSelect.innerHTML = "";
    if (snap.empty){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "لا يوجد أطفال";
      childSelect.appendChild(opt);
    } else {
      snap.forEach(d=>{
        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = d.data().name || `طفل (${d.id.slice(0,4)})`;
        childSelect.appendChild(opt);
      });
    }
  }

  addRow(); // صف أولي
  bindEvents();

  // لو الصفحة بتشتغل بالـ URL param للطفل، نضبط select (لو موجود)
  const cid = await resolveChildId(user.uid);
  if (!cid){ alert("لم يتم العثور على طفل. أضيفي طفلًا أولًا."); return; }
  if (childSelect && childSelect.value !== cid) childSelect.value = cid;

  tryPrefillMeasuresForDay();
});

/* ===== Events ===== */
function bindEvents(){
  addRowBtn?.addEventListener("click", addRow);
  saveBtn?.addEventListener("click", saveMeal);
  dateInput?.addEventListener("change", tryPrefillMeasuresForDay);
  slotSel?.addEventListener("change", tryPrefillMeasuresForDay);
  reloadMeasures?.addEventListener("click", tryPrefillMeasuresForDay);

  childSelect?.addEventListener("change", tryPrefillMeasuresForDay);

  // القوالب (لو موجودة)
  openTplBtn?.addEventListener("click", ()=> openTemplatesDialog("فطار"));
  closeTplBtn?.addEventListener("click", ()=> tplModal?.close());
  tplTabs.forEach(tab=>{
    tab.addEventListener("click", ()=>{
      tplTabs.forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      loadTemplates(tab.dataset.type);
    });
  });
  saveAsTplBtn?.addEventListener("click", ()=>{
    if(tplNameInput) tplNameInput.value = "";
    if(tplTypeInput) tplTypeInput.value = "فطار";
    saveTplModal?.showModal?.();
  });
  cancelSaveTpl?.addEventListener("click", ()=> saveTplModal?.close?.());
  confirmSaveTpl?.addEventListener("click", async (e)=>{
    e.preventDefault();
    await saveCurrentAsTemplate();
  });
}

/* ====== التطبيع الغذائي Fallback mapping ======
   يقبل الصيغ الشائعة ويحوّلها لشكل قياسي nutrPer100g {carbs_g, fiber_g, cal_kcal, protein_g, fat_g}
*/
function normalizeNutr(itemDoc){
  // 1) إن كان موجودًا في nutrPer100g
  const np = itemDoc?.nutrPer100g || {};

  // 2) مصادر بديلة (أسماء قديمة/مختلفة)
  const carbCandidates  = [np.carbs_g, itemDoc?.carb100, itemDoc?.carbs_per_100g, itemDoc?.carbs100, itemDoc?.carbs_g];
  const fiberCandidates = [np.fiber_g, itemDoc?.fiber100, itemDoc?.fiber_per_100g, itemDoc?.fiber_g];
  const calCandidates   = [np.cal_kcal, itemDoc?.cal_kcal, itemDoc?.calories, itemDoc?.kcal];
  const protCandidates  = [np.protein_g, itemDoc?.prot100, itemDoc?.protein_per_100g, itemDoc?.protein_g];
  const fatCandidates   = [np.fat_g, itemDoc?.fat100, itemDoc?.fat_per_100g, itemDoc?.fat_g];

  function firstNum(arr){ for(const v of arr){ const n=+v; if(isFinite(n) && n>=0) return n; } return 0; }

  return {
    carbs_g:   firstNum(carbCandidates),
    fiber_g:   firstNum(fiberCandidates),
    cal_kcal:  firstNum(calCandidates),
    protein_g: firstNum(protCandidates),
    fat_g:     firstNum(fatCandidates),
  };
}

/* ===== Table rows (نفس أسلوبك العام) ===== */
function addRow(pref={}){
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `
    <input class="name" placeholder="اسم الصنف" value="${pref.name||""}">
    <select class="measure">
      <option value="g"${pref.measure==="g"?" selected":""}>جرام</option>
      <option value="unit"${pref.measure==="unit"?" selected":""}>منزلية</option>
    </select>
    <input type="number" class="gPerUnit" step="0.1" min="0" value="${fmt(pref.gPerUnit??0)}" title="جم/الوحدة">
    <input type="number" class="qty" step="0.1" min="0" value="${fmt(pref.qty??0)}">
    <input type="number" class="grams" step="0.1" min="0" value="${fmt(pref.grams??0)}">
    <input type="number" class="carb100" step="0.1" min="0" value="${fmt(pref.carb100??0)}" title="كارب/100جم">
    <input type="number" class="carbs" step="0.1" min="0" value="${fmt(pref.carbs_g??pref.carbs??0)}">
    <input type="number" class="gi" step="1" min="0" max="110" value="${(pref.gi??"")}">
    <input type="text" class="gl" disabled value="${fmt(pref.gl??0)}">
    <input type="number" class="kcals" step="0.1" min="0" value="${fmt(pref.kcals??pref.cal_kcal??0)}">
    <input type="number" class="prot" step="0.1" min="0" value="${fmt(pref.protein_g??0)}">
    <input type="number" class="fat" step="0.1" min="0" value="${fmt(pref.fat_g??0)}">
    <button class="del">حذف</button>
  `;

  const measure = row.querySelector(".measure");
  const gPerUnit = row.querySelector(".gPerUnit");
  const qty = row.querySelector(".qty");
  const grams = row.querySelector(".grams");
  const carb100 = row.querySelector(".carb100");
  const carbs = row.querySelector(".carbs");
  const gi = row.querySelector(".gi");
  const gl = row.querySelector(".gl");
  const del = row.querySelector(".del");

  measure.addEventListener("change", ()=>{
    if(measure.value==="g"){
      qty.value = fmt(grams.value);
    }else{
      grams.value = fmt(round1((+qty.value||0) * (+gPerUnit.value||0)));
    }
    recalcRow(row); recalcSummary();
  });

  gPerUnit.addEventListener("input", ()=>{
    if(measure.value==="unit"){
      grams.value = fmt(round1((+qty.value||0) * (+gPerUnit.value||0)));
      recalcRow(row); recalcSummary();
    }
  });

  qty.addEventListener("input", ()=>{
    qty.value = fmt(round1(clampNonNeg(qty.value)));
    if(measure.value==="g"){
      grams.value = fmt(qty.value);
    }else{
      grams.value = fmt(round1((+qty.value||0) * (+gPerUnit.value||0)));
    }
    recalcRow(row); recalcSummary();
  });

  grams.addEventListener("input", ()=>{
    grams.value = fmt(round1(clampNonNeg(grams.value)));
    if(measure.value==="g"){
      qty.value = fmt(grams.value);
    }else{
      const gpu = +gPerUnit.value || 0;
      qty.value = gpu ? fmt(round1((+grams.value||0) / gpu)) : fmt(0);
    }
    recalcRow(row); recalcSummary();
  });

  carb100.addEventListener("input", ()=>{ recalcRow(row); recalcSummary(); });
  gi.addEventListener("input", ()=>{ recalcRow(row); recalcSummary(); });
  carbs.addEventListener("input", ()=>{
    carbs.value = fmt(round1(clampNonNeg(carbs.value)));
    const giVal = +gi.value || 0;
    gl.value = fmt(round1((giVal * (+carbs.value||0))/100));
    recalcSummary();
  });
  del.addEventListener("click", ()=>{ row.remove(); recalcSummary(); });

  recalcRow(row);
  rowsEl.appendChild(row);
  recalcSummary();
}

function recalcRow(row){
  const grams = +row.querySelector(".grams").value || 0;
  const carb100 = +row.querySelector(".carb100").value || 0;
  const gi = +row.querySelector(".gi").value || 0;
  const carbsEl = row.querySelector(".carbs");
  const glEl = row.querySelector(".gl");

  const carbs = round1((carb100 * grams) / 100);
  if(document.activeElement !== carbsEl){ carbsEl.value = fmt(carbs); }

  const gl = round1((gi * (+carbsEl.value||0)) / 100);
  glEl.value = fmt(gl);
}

function recalcSummary(){
  let totalCarb = 0, totalGL = 0, giWeightedSum = 0;
  rowsEl.querySelectorAll(".row").forEach(row=>{
    const carb = +row.querySelector(".carbs").value || 0;
    const gi = +row.querySelector(".gi").value || 0;
    const gl = +row.querySelector(".gl").value || 0;
    totalCarb += carb; totalGL += gl; giWeightedSum += gi * carb;
  });
  if(sumCarbsEl) sumCarbsEl.textContent = fmt(totalCarb);
  if(sumGLEl) sumGLEl.textContent = fmt(totalGL);
  if(avgGIEl) avgGIEl.textContent = totalCarb>0 ? fmt(giWeightedSum/totalCarb) : "—";
}
/* ===== Measurements (same day) ===== */
async function tryPrefillMeasuresForDay(){
  const user = auth.currentUser || await waitForUser();
  if(!user) return;

  const childId = await resolveChildId(user.uid);
  if(!childId) return;

  const start = new Date(dateInput?.value || new Date());
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setHours(23,59,59,999);

  const colRef = collection(db, PATHS.measurements(user.uid, childId));
  // لو عندك field 'ts' Timestamp — ممكن تعدلي حسب حقولك
  const qs = await getDocs(query(colRef));
  const chosenSlot = (slotSel?.value) || "PRE_BREAKFAST";
  const isPre = ["PRE_BREAKFAST","PRE_LUNCH","PRE_DINNER","SNACK"].includes(chosenSlot);

  let exactPre=null, exactPost=null;
  const all = [];
  qs.forEach(d=>{
    const m = d.data();
    const ts = m?.ts?.toDate?.() || m?.date?.toDate?.() || null;
    if (!ts) return;
    if (ts >= start && ts <= end) all.push(m);
    if (m.slot === chosenSlot){
      if(isPre) exactPre=m; else exactPost=m;
    }
  });

  function nearestByType(measures, typePrefix, dayStart){
    const wanted = measures.filter(m=>{
      const pre = (m.slot||"").startsWith("PRE") || m.slot==="SNACK";
      return typePrefix==="PRE" ? pre : !pre;
    });
    if(!wanted.length) return null;
    const mid = new Date(dayStart); mid.setHours(12,0,0,0);
    wanted.sort((a,b)=>Math.abs(a.ts?.toDate?.() - mid) - Math.abs(b.ts?.toDate?.() - mid));
    return wanted[0] || null;
  }

  if(!exactPre && isPre) exactPre = nearestByType(all,"PRE",start);
  if(!exactPost && !isPre) exactPost = nearestByType(all,"POST",start);

  if(preReading)  preReading.value  = exactPre?.value != null ? fmt(exactPre.value) : "";
  if(postReading) postReading.value = exactPost?.value != null ? fmt(exactPost.value) : "";
}

/* ===== Save meal (هيكل اليوم + items) ===== */
async function saveMeal(){
  try{
    if(saveStatus) saveStatus.textContent = "جارٍ الحفظ...";
    const user = auth.currentUser || await waitForUser();
    if(!user){ alert("سجّلي الدخول."); return; }

    const childId = await resolveChildId(user.uid);
    if(!childId){ alert("حددي الطفل."); return; }

    const d = new Date(dateInput?.value || new Date());
    const ymd = getYMD(d);

    // جمع عناصر الجدول
    const items = [];
    rowsEl.querySelectorAll(".row").forEach(row=>{
      const obj = {
        name: row.querySelector(".name").value.trim(),
        measure: row.querySelector(".measure").value,    // "g" | "unit"
        gPerUnit: +row.querySelector(".gPerUnit").value || 0,
        qty: +row.querySelector(".qty").value || 0,
        grams: +row.querySelector(".grams").value || 0,
        carb100: +row.querySelector(".carb100").value || 0,
        carbs_g: +row.querySelector(".carbs").value || 0,
        gi: +row.querySelector(".gi").value || null,
        gl: +row.querySelector(".gl").value || 0,
        kcals: +row.querySelector(".kcals").value || 0,
        protein_g: +row.querySelector(".prot").value || 0,
        fat_g: +row.querySelector(".fat").value || 0,
        slot: (slotSel?.value)||"PRE_BREAKFAST",
        date: Timestamp.fromDate(d)
      };
      if(obj.name) items.push(obj);
    });

    // كتابة عناصر اليوم في subcollection: meals/{ymd}/items
    const itemsCol = collection(db, PATHS.mealsItemsCol(user.uid, childId, ymd));
    const batch = writeBatch(db);
    items.forEach(i=>{
      const newRef = doc(itemsCol); // auto id
      batch.set(newRef, i);
    });

    // مستند ملخّص اليوم: meals/{ymd}
    const totalCarb = items.reduce((s,i)=>s+(i.carbs_g||0),0);
    const totalGL = items.reduce((s,i)=>s+(i.gl||0),0);
    const giWeighted = totalCarb>0 ? items.reduce((s,i)=>s+((i.gi||0)*(i.carbs_g||0)),0)/totalCarb : null;

    const dayDocRef = doc(db, PATHS.mealsDayDoc(user.uid, childId, ymd));
    batch.set(dayDocRef,{
      _meta:true,
      date: Timestamp.fromDate(d),
      slot: (slotSel?.value)||"PRE_BREAKFAST",
      preReading: (preReading?.value ? +preReading.value : null),
      postReading:(postReading?.value ? +postReading.value: null),
      totalCarb, totalGL, avgGI: giWeighted,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge:true });

    await batch.commit();

    if(saveStatus) saveStatus.textContent = "تم الحفظ ✅";
    setTimeout(()=> saveStatus && (saveStatus.textContent=""), 2000);
  }catch(err){
    console.error(err);
    if(saveStatus) saveStatus.textContent = "خطأ أثناء الحفظ";
  }
}

/* =============== قوالب الوجبات تحت الطفل ================= */

async function openTemplatesDialog(type="فطار"){
  tplTabs.forEach(t=> t.classList.toggle("active", t.dataset.type===type));
  await loadTemplates(type);
  tplModal?.showModal?.();
}

async function loadTemplates(type){
  const user = auth.currentUser || await waitForUser();
  if(!user) return;
  const childId = await resolveChildId(user.uid);
  if(!childId){ alert("اختاري الطفل أولًا"); return; }

  const colRef = collection(db, PATHS.mealTemplates(user.uid, childId));
  // ممكن تبقى createdAt غير موجودة في القديم
  let docsSnap = await getDocs(colRef);
  const all = [];
  docsSnap.forEach(d=>{
    const data = d.data();
    if (!type || data?.type===type) all.push({ id:d.id, ...data });
  });

  if (tplList) tplList.innerHTML = "";
  if (!all.length){
    if (tplList) tplList.innerHTML = `<div class="muted">لا توجد قوالب «${type}» بعد.</div>`;
    return;
  }
  all.sort((a,b)=>(b?.createdAt?.toMillis?.()||0)-(a?.createdAt?.toMillis?.()||0));

  all.forEach(d=>{
    const totalCarb = (d.items||[]).reduce((s,i)=> s + (+i.carbs_g||0), 0);
    const totalGL   = (d.items||[]).reduce((s,i)=> s + (+i.gl||0), 0);
    const card = document.createElement("div");
    card.className = "tpl-card";
    card.innerHTML = `
      <div class="title">${d.name || "قالب بدون اسم"}</div>
      <div class="meta">نوع: ${d.type||"-"} • أصناف: ${(d.items||[]).length}</div>
      <div class="meta">كارب إجمالي: ${fmt(totalCarb)} • GL: ${fmt(totalGL)}</div>
      <div class="row-btns">
        <button class="success">إضافة</button>
        <button class="ghost danger">حذف</button>
      </div>
    `;
    card.querySelector(".success").addEventListener("click", ()=>{
      applyTemplateItems(d.items||[]);
      tplModal?.close?.();
    });
    card.querySelector(".danger").addEventListener("click", async ()=>{
      if(confirm("حذف هذا القالب؟")){
        await setDoc(doc(colRef, d.id), {}, { merge:false }); // لضمان وجود قبل الحذف
        await (await import("https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js"))
        ; // no-op
        // حذف
        await updateDoc(doc(colRef, d.id), { __deleted: true }).catch(()=>{});
      }
      await loadTemplates(type);
    });
    tplList?.appendChild(card);
  });
}

function applyTemplateItems(items){
  rowsEl.innerHTML = "";
  (items||[]).forEach(it=>{
    addRow({
      name: it.name || "",
      measure: it.measure || (it.unit==="household" ? "unit":"g"),
      gPerUnit: it.gPerUnit || it.grams_per_unit || 0,
      qty: it.qty || 0,
      grams: it.grams || 0,
      carb100: it.carb100 || it.carbs_per_100g || (it.carb100_g) || 0,
      carbs_g: it.carbs_g || it.carbs || 0,
      gi: it.gi ?? "",
      gl: it.gl || 0,
      kcals: it.kcals || it.cal_kcal || it.calories || 0,
      protein_g: it.protein_g || it.protein || 0,
      fat_g: it.fat_g || it.fat || 0,
    });
  });
  recalcSummary();
}

async function saveCurrentAsTemplate(){
  try{
    const user = auth.currentUser || await waitForUser();
    if(!user){ alert("سجّلي الدخول."); return; }
    const childId = await resolveChildId(user.uid);
    if(!childId){ alert("اختاري الطفل."); return; }

    const name = (tplNameInput?.value||"").trim();
    const type = tplTypeInput?.value || "فطار";
    if(!name || !TYPE_LABELS.includes(type)){
      alert("ادخلي اسمًا صحيحًا وحددي النوع: فطار/غدا/عشا/سناك"); return;
    }

    const items = [];
    rowsEl.querySelectorAll(".row").forEach(row=>{
      const item = {
        name: row.querySelector(".name").value.trim(),
        measure: row.querySelector(".measure").value,
        gPerUnit: +row.querySelector(".gPerUnit").value || 0,
        qty: +row.querySelector(".qty").value || 0,
        grams: +row.querySelector(".grams").value || 0,
        carb100: +row.querySelector(".carb100").value || 0,
        carbs_g: +row.querySelector(".carbs").value || 0,
        gi: +row.querySelector(".gi").value || null,
        gl: +row.querySelector(".gl").value || 0,
        kcals: +row.querySelector(".kcals").value || 0,
        protein_g: +row.querySelector(".prot").value || 0,
        fat_g: +row.querySelector(".fat").value || 0,
      };
      if(item.name) items.push(item);
    });

    if(items.length===0){ alert("لا توجد أصناف لحفظها كقالب."); return; }

    const colRef = collection(db, PATHS.mealTemplates(user.uid, childId));
    await addDoc(colRef, {
      name, type, items,
      createdAt: serverTimestamp()
    });

    saveTplModal?.close?.();
    if(tplMsg){ tplMsg.textContent = `تم حفظ القالب «${name}» (${type}) ✅`; setTimeout(()=> tplMsg.textContent="", 3000); }
  }catch(err){
    console.error(err);
    if(tplMsg) tplMsg.textContent = "تعذر حفظ القالب";
  }
}
