/* =========================
   meals.js — نسخة كاملة
   ========================= */

/* ===== Firebase compat جاهز من firebase-config.js ===== */
if (!window.firebase) console.warn("تأكدي من تحميل firebase-config.js قبل meals.js");

/* ===== Helpers ===== */
const round1 = (n) => Math.round((+n || 0) * 10) / 10;
const clampNonNeg = (n) => Math.max(0, +n || 0);
const fmt = (n) => (isFinite(n) ? (Math.round(n*10)/10).toFixed(1) : "0.0");

const PATHS = {
  children: (uid) => `parents/${uid}/children`,
  mealTemplates: (uid, childId) => `parents/${uid}/children/${childId}/mealTemplates`,
  mealsForDate: (uid, childId, ymd) => `parents/${uid}/children/${childId}/meals/${ymd}/items`,
  measurements: (uid, childId) => `parents/${uid}/children/${childId}/measurements`,
};
const TYPE_LABELS = ["فطار","غدا","عشا","سناك"];

/* ===== DOM ===== */
const childSel = document.getElementById("childSelect");
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

/* ===== UI قوالب ===== */
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

/* ===== Init ===== */
document.addEventListener("DOMContentLoaded", async ()=>{
  dateInput && (dateInput.valueAsDate = new Date());
  await populateChildren();
  addRow();
  bindEvents();
  tryPrefillMeasuresForDay();
});

/* ===== Events ===== */
function bindEvents(){
  addRowBtn?.addEventListener("click", addRow);
  saveBtn?.addEventListener("click", saveMeal);
  dateInput?.addEventListener("change", tryPrefillMeasuresForDay);
  slotSel?.addEventListener("change", tryPrefillMeasuresForDay);
  reloadMeasures?.addEventListener("click", tryPrefillMeasuresForDay);

  childSel?.addEventListener("change", ()=>{
    // تغيير الطفل يؤثر على القوالب والقياسات فقط
    tryPrefillMeasuresForDay();
  });

  // فتح مودال القوالب على تبويب "فطار" افتراضيًا
  openTplBtn?.addEventListener("click", ()=> openTemplatesDialog("فطار"));
  closeTplBtn?.addEventListener("click", ()=> tplModal?.close());

  tplTabs.forEach(tab=>{
    tab.addEventListener("click", ()=>{
      tplTabs.forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      loadTemplates(tab.dataset.type);
    });
  });

  // حفظ الحالية كقالب
  saveAsTplBtn?.addEventListener("click", ()=>{
    tplNameInput.value = "";
    tplTypeInput.value = "فطار";
    saveTplModal?.showModal();
  });
  cancelSaveTpl?.addEventListener("click", ()=> saveTplModal?.close());
  confirmSaveTpl?.addEventListener("click", async (e)=>{
    e.preventDefault();
    await saveCurrentAsTemplate();
  });
}

/* ===== Auth helper ===== */
async function getUser(){
  const cur = firebase.auth().currentUser;
  if (cur) return cur;
  return await new Promise(resolve=>{
    const u = firebase.auth().onAuthStateChanged(v=>{u(); resolve(v);});
  });
}

/* ===== Load children ===== */
async function populateChildren(){
  const user = await getUser();
  if(!user){ alert("يجب تسجيل الدخول أولًا"); return; }
  const db = firebase.firestore();
  const snap = await db.collection(PATHS.children(user.uid)).get();
  childSel.innerHTML = "";
  snap.forEach(doc=>{
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().name || `طفل (${doc.id.slice(0,4)})`;
    childSel.appendChild(opt);
  });
}

/* ===== Table rows ===== */
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
  sumCarbsEl && (sumCarbsEl.textContent = fmt(totalCarb));
  sumGLEl && (sumGLEl.textContent   = fmt(totalGL));
  avgGIEl && (avgGIEl.textContent   = totalCarb>0 ? fmt(giWeightedSum/totalCarb) : "—");
}

/* ===== Measurements (same day) ===== */
async function tryPrefillMeasuresForDay(){
  const user = await getUser(); if(!user) return;
  const childId = childSel?.value; if(!childId) return;

  const db = firebase.firestore();
  const col = db.collection(PATHS.measurements(user.uid, childId));

  const start = new Date(dateInput.value); start.setHours(0,0,0,0);
  const end = new Date(start); end.setHours(23,59,59,999);

  const qs = await col.where("ts",">=", start).where("ts","<=", end).get();
  const chosenSlot = slotSel.value;
  const isPre = ["PRE_BREAKFAST","PRE_LUNCH","PRE_DINNER","SNACK"].includes(chosenSlot);

  let exactPre=null, exactPost=null;
  qs.forEach(d=>{
    const m = d.data();
    if(m.slot === chosenSlot){
      if(isPre) exactPre=m; else exactPost=m;
    }
  });

  const measures = qs.docs.map(d=>d.data());
  if(!exactPre && isPre) exactPre = nearestByType(measures,"PRE",start);
  if(!exactPost && !isPre) exactPost = nearestByType(measures,"POST",start);

  preReading && (preReading.value  = exactPre?.value != null ? fmt(exactPre.value) : "");
  postReading && (postReading.value = exactPost?.value != null ? fmt(exactPost.value) : "");
}

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

/* ===== Save meal ===== */
async function saveMeal(){
  try{
    saveStatus && (saveStatus.textContent = "جارٍ الحفظ...");
    const user = await getUser(); if(!user){ alert("سجّلي الدخول أولًا."); return; }
    const childId = childSel?.value; if(!childId){ alert("اختاري الطفل."); return; }
    const ymd = getYMD();

    const db = firebase.firestore();
    const col = db.collection(PATHS.mealsForDate(user.uid, childId, ymd));

    const items = [];
    rowsEl.querySelectorAll(".row").forEach(row=>{
      const doc = {
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
        slot: slotSel.value,
        date: firebase.firestore.Timestamp.fromDate(new Date(dateInput.value))
      };
      if(doc.name){ items.push(doc); }
    });

    const batch = firebase.firestore().batch();
    items.forEach(i=> batch.set(col.doc(), i));

    const summaryRef = db.doc(`parents/${user.uid}/children/${childId}/meals/${ymd}`);
    const totalCarb = items.reduce((s,i)=>s+(i.carbs_g||0),0);
    const totalGL = items.reduce((s,i)=>s+(i.gl||0),0);
    const giWeighted = totalCarb>0 ? items.reduce((s,i)=>s+((i.gi||0)*(i.carbs_g||0)),0)/totalCarb : null;

    batch.set(summaryRef,{
      _meta:true,
      date: firebase.firestore.Timestamp.fromDate(new Date(dateInput.value)),
      slot: slotSel.value,
      preReading: preReading.value ? +preReading.value : null,
      postReading: postReading.value ? +postReading.value : null,
      totalCarb, totalGL, avgGI: giWeighted
    },{merge:true});

    await batch.commit();
    saveStatus && (saveStatus.textContent = "تم الحفظ ✅");
    setTimeout(()=> saveStatus && (saveStatus.textContent = ""), 2500);
  }catch(err){
    console.error(err);
    saveStatus && (saveStatus.textContent = "خطأ أثناء الحفظ");
  }
}
function getYMD(){
  const d = new Date(dateInput.value);
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0"); const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

/* ================= قوالب الوجبات — تحت الطفل ================= */

/** فتح مودال القوالب على تبويب معين */
async function openTemplatesDialog(type="فطار"){
  tplTabs.forEach(t=> t.classList.toggle("active", t.dataset.type===type));
  await loadTemplates(type);
  tplModal?.showModal();
}

/** تحميل القوالب من مسار الطفل مع فلتر النوع */
async function loadTemplates(type){
  const user = await getUser(); if(!user) return;
  const childId = childSel?.value; if(!childId){ alert("اختاري الطفل أولًا"); return; }

  const db = firebase.firestore();
  const col = db.collection(PATHS.mealTemplates(user.uid, childId));
  // لو createdAt مش موجود في بعض المستندات القديمة، هنقرأ بدون ترتيب
  let qs;
  try {
    qs = await col.where("type","==", type).orderBy("createdAt","desc").get();
  } catch(e){
    qs = await col.where("type","==", type).get();
  }

  tplList.innerHTML = "";
  if(qs.empty){
    tplList.innerHTML = `<div class="muted">لا توجد قوالب «${type}» بعد.</div>`;
    return;
  }
  qs.forEach(doc=>{
    const d = doc.data();
    const totalCarb = (d.items||[]).reduce((s,i)=> s + (+i.carbs_g||0), 0);
    const totalGL   = (d.items||[]).reduce((s,i)=> s + (+i.gl||0), 0);
    const card = document.createElement("div");
    card.className = "tpl-card";
    card.innerHTML = `
      <div class="title">${d.name || "قالب بدون اسم"}</div>
      <div class="meta">نوع: ${d.type} • أصناف: ${(d.items||[]).length}</div>
      <div class="meta">كارب إجمالي: ${fmt(totalCarb)} • GL: ${fmt(totalGL)}</div>
      <div class="row-btns">
        <button class="success">إضافة</button>
        <button class="ghost danger">حذف</button>
      </div>
    `;
    // إضافة القالب للجدول
    card.querySelector(".success").addEventListener("click", ()=>{
      applyTemplateItems(d.items||[]);
      tplModal?.close();
    });
    // حذف القالب
    card.querySelector(".danger").addEventListener("click", async ()=>{
      if(confirm("حذف هذا القالب؟")){
        await col.doc(doc.id).delete();
        await loadTemplates(type);
      }
    });
    tplList.appendChild(card);
  });
}

/** إسقاط عناصر القالب للجدول */
function applyTemplateItems(items){
  rowsEl.innerHTML = "";
  (items||[]).forEach(it=>{
    addRow({
      name: it.name || "",
      // دعم صيغ قديمة: unit/measure/gPerUnit
      measure: it.measure || (it.unit==="household" ? "unit":"g"),
      gPerUnit: it.gPerUnit || it.grams_per_unit || 0,
      qty: it.qty || 0,
      grams: it.grams || 0,
      carb100: it.carb100 || it.carbs_per_100g || 0,
      carbs_g: it.carbs_g || 0,
      gi: it.gi ?? "",
      gl: it.gl || 0,
      kcals: it.kcals || it.cal_kcal || 0,
      protein_g: it.protein_g || 0,
      fat_g: it.fat_g || 0,
    });
  });
  recalcSummary();
}

/** حفظ محتوى الجدول كقالب — تحت الطفل */
async function saveCurrentAsTemplate(){
  try{
    const user = await getUser(); if(!user){ alert("سجّلي الدخول أولًا."); return; }
    const childId = childSel?.value; if(!childId){ alert("اختاري الطفل."); return; }

    const name = (tplNameInput.value||"").trim();
    const type = tplTypeInput.value;
    if(!name || !TYPE_LABELS.includes(type)){
      alert("ادخلي اسمًا صحيحًا وحددي النوع: فطار/غدا/عشا/سناك"); return;
    }

    const items = [];
    rowsEl.querySelectorAll(".row").forEach(row=>{
      const item = {
        name: row.querySelector(".name").value.trim(),
        measure: row.querySelector(".measure").value,   // "g" | "unit"
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

    const db = firebase.firestore();
    await db.collection(PATHS.mealTemplates(user.uid, childId)).add({
      name, type, items,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    saveTplModal?.close();
    if(tplMsg){ tplMsg.textContent = `تم حفظ القالب «${name}» (${type}) ✅`; setTimeout(()=> tplMsg.textContent="", 3000); }
  }catch(err){
    console.error(err);
    if(tplMsg) tplMsg.textContent = "تعذر حفظ القالب";
  }
}
