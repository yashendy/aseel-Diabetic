/* ======= إعداد Firebase =======
   لو عندك firebase-config.js بيصدر app, auth, db بدعم compat،
   احذفي الكتلة البديلة هنا. */
window._ensureFirebaseReady = (function(){
  if (!window.firebase?.apps?.length) {
    console.warn('تأكدي من تحميل firebase-config.js قبل هذا الملف.');
  }
})();

/* ======= ثوابت ======= */
const PATHS = {
  childCollection: (uid) => `parents/${uid}/children`,
  mealsCollectionForDate: (uid, childId, ymd) =>
    `parents/${uid}/children/${childId}/meals/${ymd}/items`,
  measurementsCollection: (uid, childId) =>
    `parents/${uid}/children/${childId}/measurements`,
};

const SLOT_LABELS = {
  PRE_BREAKFAST: "ق.الفطار",
  PRE_LUNCH: "ق.الغدا",
  PRE_DINNER: "ق.العشا",
  POST_BREAKFAST: "ب.الفطار",
  POST_LUNCH: "ب.الغدا",
  POST_DINNER: "ب.العشا",
  SNACK: "السناك",
};

const SLOT_GROUP = {
  PRE: ["PRE_BREAKFAST","PRE_LUNCH","PRE_DINNER","SNACK"],
  POST: ["POST_BREAKFAST","POST_LUNCH","POST_DINNER"],
};

const round1 = (n) => Math.round((+n || 0) * 10) / 10;
const clampNonNeg = (n) => Math.max(0, +n || 0);
const fmt = (n) => (isFinite(n) ? (Math.round(n*10)/10).toFixed(1) : "0.0");

/* ======= عناصر DOM ======= */
const childSel = document.getElementById("childSelect");
const dateInput = document.getElementById("dateInput");
const slotSel = document.getElementById("mealSlot");
const rowsEl = document.getElementById("rows");
const addRowBtn = document.getElementById("addRow");
const saveBtn = document.getElementById("saveMeal");
const saveStatus = document.getElementById("saveStatus");
const preReading = document.getElementById("preReading");
const postReading = document.getElementById("postReading");
const reloadMeasures = document.getElementById("reloadMeasures");
const sumCarbsEl = document.getElementById("sumCarbs");
const sumGLEl = document.getElementById("sumGL");
const avgGIEl = document.getElementById("avgGI");

/* ======= تهيئة أولية ======= */
document.addEventListener("DOMContentLoaded", async () => {
  // افتراضي: اليوم
  dateInput.valueAsDate = new Date();

  // تحميل الأطفال المتاحين للمستخدم
  await populateChildren();

  // صف مبدئي
  addRow();

  // مستمعات
  addRowBtn.addEventListener("click", addRow);
  saveBtn.addEventListener("click", saveMeal);
  dateInput.addEventListener("change", tryPrefillMeasuresForDay);
  slotSel.addEventListener("change", tryPrefillMeasuresForDay);
  reloadMeasures.addEventListener("click", tryPrefillMeasuresForDay);

  // أول تحميل
  tryPrefillMeasuresForDay();
});

/* ======= إدارة الأطفال ======= */
async function populateChildren(){
  // توقّع أن المستخدم مسجل دخول
  const user = firebase.auth().currentUser || await new Promise(resolve=>{
    const unsub = firebase.auth().onAuthStateChanged(u=>{unsub();resolve(u)});
  });
  if(!user){ alert("يجب تسجيل الدخول أولًا"); return; }

  const db = firebase.firestore();
  const colRef = db.collection(PATHS.childCollection(user.uid));
  const snap = await colRef.get();
  childSel.innerHTML = "";
  snap.forEach(doc=>{
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().name || `طفل (${doc.id.slice(0,4)})`;
    childSel.appendChild(opt);
  });
}

/* ======= نموذج الصف ======= */
function addRow(pref={}){
  const row = document.createElement("div");
  row.className = "row";

  row.innerHTML = `
    <input class="name" placeholder="اسم الصنف" value="${pref.name||""}">
    <select class="measure">
      <option value="g">جرام</option>
      <option value="unit"${pref.measure==="unit"?" selected":""}>منزلية</option>
    </select>
    <input type="number" class="gPerUnit" step="0.1" min="0" value="${fmt(pref.gPerUnit??0)}" title="عدد الجرامات في الوحدة المنزلية">
    <input type="number" class="qty" step="0.1" min="0" value="${fmt(pref.qty??0)}">
    <input type="number" class="grams" step="0.1" min="0" value="${fmt(pref.grams??0)}">
    <input type="number" class="carb100" step="0.1" min="0" value="${fmt(pref.carb100??0)}" title="كارب لكل 100جرام">
    <input type="number" class="carbs" step="0.1" min="0" value="${fmt(pref.carbs??0)}">
    <input type="number" class="gi" step="1" min="0" max="110" value="${(pref.gi??"")}">
    <input type="text" class="gl" disabled value="${fmt(pref.gl??0)}">
    <input type="number" class="kcals" step="0.1" min="0" value="${fmt(pref.kcals??0)}">
    <input type="number" class="prot" step="0.1" min="0" value="${fmt(pref.prot??0)}">
    <input type="number" class="fat" step="0.1" min="0" value="${fmt(pref.fat??0)}">
    <button class="del">حذف</button>
  `;

  // عناصر
  const measure = row.querySelector(".measure");
  const gPerUnit = row.querySelector(".gPerUnit");
  const qty = row.querySelector(".qty");
  const grams = row.querySelector(".grams");
  const carb100 = row.querySelector(".carb100");
  const carbs = row.querySelector(".carbs");
  const gi = row.querySelector(".gi");
  const gl = row.querySelector(".gl");
  const del = row.querySelector(".del");

  // ربط أحداث التزامن
  measure.addEventListener("change", ()=>{
    if(measure.value==="g"){
      // في وضع الجرام: اجعل qty = grams (للتيسير) ولا نستخدم gPerUnit
      qty.value = fmt(grams.value);
    }else{
      // في وضع الوحدة المنزلية: حدّث grams اعتمادًا على gPerUnit
      grams.value = fmt(round1(qty.value * ( +gPerUnit.value || 0 )));
    }
    recalcRow(row); recalcSummary();
  });

  gPerUnit.addEventListener("input", ()=>{
    if(measure.value==="unit"){
      grams.value = fmt(round1(qty.value * ( +gPerUnit.value || 0 )));
      recalcRow(row); recalcSummary();
    }
  });

  qty.addEventListener("input", ()=>{
    qty.value = fmt(round1(clampNonNeg(qty.value)));
    if(measure.value==="g"){
      grams.value = fmt(qty.value);
    }else{
      grams.value = fmt(round1(qty.value * ( +gPerUnit.value || 0 )));
    }
    recalcRow(row); recalcSummary();
  });

  grams.addEventListener("input", ()=>{
    grams.value = fmt(round1(clampNonNeg(grams.value)));
    if(measure.value==="g"){
      qty.value = fmt(grams.value);
    }else{
      const gpu = +gPerUnit.value || 0;
      qty.value = gpu ? fmt(round1(grams.value / gpu)) : fmt(0);
    }
    recalcRow(row); recalcSummary();
  });

  // الكارب المحسوب من ك/100جم ↔ قابل للتعديل يدويًا
  carb100.addEventListener("input", ()=>{ recalcRow(row); recalcSummary(); });
  gi.addEventListener("input", ()=>{ recalcRow(row); recalcSummary(); });
  carbs.addEventListener("input", ()=>{
    // لو المستخدم عدّل الكارب يدويًّا، نعيد حساب GL مباشرة من الكارب
    carbs.value = fmt(round1(clampNonNeg(carbs.value)));
    const giVal = +gi.value || 0;
    gl.value = fmt(round1((giVal * (+carbs.value||0))/100));
    recalcSummary();
  });

  del.addEventListener("click", ()=>{ row.remove(); recalcSummary(); });

  // حساب أولي
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

  // احسب كارب السطر من ك/100جم
  const carbs = round1((carb100 * grams) / 100);
  if(document.activeElement !== carbsEl){ carbsEl.value = fmt(carbs); }

  // GL
  const gl = round1((gi * (+carbsEl.value || 0)) / 100);
  glEl.value = fmt(gl);
}

function recalcSummary(){
  let totalCarb = 0, totalGL = 0, giWeightedSum = 0;

  rowsEl.querySelectorAll(".row").forEach(row=>{
    const carb = +row.querySelector(".carbs").value || 0;
    const gi = +row.querySelector(".gi").value || 0;
    const gl = +row.querySelector(".gl").value || 0;
    totalCarb += carb;
    totalGL += gl;
    giWeightedSum += gi * carb;
  });

  sumCarbsEl.textContent = fmt(totalCarb);
  sumGLEl.textContent = fmt(totalGL);
  avgGIEl.textContent = totalCarb > 0 ? fmt(giWeightedSum/totalCarb) : "—";
}

/* ======= القياسات (نفس اليوم + نفس الوقت) ======= */
async function tryPrefillMeasuresForDay(){
  const user = firebase.auth().currentUser || await new Promise(resolve=>{
    const unsub = firebase.auth().onAuthStateChanged(u=>{unsub();resolve(u)});
  });
  if(!user) return;

  const childId = childSel.value;
  if(!childId) return;

  const ymd = getYMD();
  const db = firebase.firestore();
  const col = db.collection(PATHS.measurementsCollection(user.uid, childId));

  // بداية ونهاية اليوم المحدد
  const start = new Date(dateInput.value);
  start.setHours(0,0,0,0);
  const end = new Date(start); end.setHours(23,59,59,999);

  // نفترض هيكل القياس: { value:Number, ts:Timestamp, slot:String }
  const qs = await col
    .where("ts",">=", start)
    .where("ts","<=", end)
    .get();

  const chosenSlot = slotSel.value;
  // اختيارات ذكية: قبل/بعد حسب المجموعة
  const isPre = SLOT_GROUP.PRE.includes(chosenSlot);

  // نبحث أولاً عن قياس بنفس الـ slot تمامًا
  let exactPre = null, exactPost = null;

  qs.forEach(d=>{
    const m = d.data();
    if(!m) return;
    if(m.slot === chosenSlot){
      if(isPre) exactPre = m;
      else exactPost = m;
    }
  });

  // لو مفيش مطابق، نختار أقرب قياس من نفس النوع (ق أو ب)
  if(!exactPre && isPre){
    exactPre = nearestByType(qs.docs.map(d=>d.data()), "PRE", start);
  }
  if(!exactPost && !isPre){
    exactPost = nearestByType(qs.docs.map(d=>d.data()), "POST", start);
  }

  // تعبئة الحقول
  preReading.value = exactPre?.value != null ? fmt(exactPre.value) : "";
  postReading.value = exactPost?.value != null ? fmt(exactPost.value) : "";
}

function nearestByType(measures, typePrefix, dayStart){
  const wanted = measures.filter(m=>{
    const isPre = (m.slot||"").startsWith("PRE") || m.slot==="SNACK";
    return typePrefix==="PRE" ? isPre : !isPre;
  });
  if(!wanted.length) return null;
  // أقرب زمنًا لمنتصف اليوم
  const mid = new Date(dayStart); mid.setHours(12,0,0,0);
  wanted.sort((a,b)=>Math.abs(a.ts?.toDate?.() - mid) - Math.abs(b.ts?.toDate?.() - mid));
  return wanted[0] || null;
}

/* ======= حفظ الوجبة ======= */
async function saveMeal(){
  try{
    saveStatus.textContent = "جارٍ الحفظ...";
    const user = firebase.auth().currentUser || await new Promise(resolve=>{
      const unsub = firebase.auth().onAuthStateChanged(u=>{unsub();resolve(u)});
    });
    if(!user){ alert("سجّلي الدخول أولًا."); return; }

    const childId = childSel.value;
    if(!childId){ alert("اختاري الطفل."); return; }

    const ymd = getYMD();
    const db = firebase.firestore();
    const col = db.collection(PATHS.mealsCollectionForDate(user.uid, childId, ymd));

    // بيانات العناصر
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

    // ملخّص
    const totalCarb = items.reduce((s,i)=>s+(i.carbs_g||0),0);
    const totalGL = items.reduce((s,i)=>s+(i.gl||0),0);
    const giWeighted = totalCarb>0 ? items.reduce((s,i)=>s+((i.gi||0)*(i.carbs_g||0)),0)/totalCarb : null;

    // إضافة كل عنصر كمستند مستقل تحت تاريخ اليوم
    const batch = db.batch();
    items.forEach(i=>{
      const ref = col.doc(); batch.set(ref,i);
    });

    // مستند ملخص لليوم (اختياري مفيد)
    const summaryRef = db.doc(`parents/${user.uid}/children/${childId}/meals/${ymd}`);
    batch.set(summaryRef,{
      _meta:true,
      date: firebase.firestore.Timestamp.fromDate(new Date(dateInput.value)),
      slot: slotSel.value,
      preReading: preReading.value ? +preReading.value : null,
      postReading: postReading.value ? +postReading.value : null,
      totalCarb, totalGL, avgGI: giWeighted
    },{merge:true});

    await batch.commit();

    saveStatus.textContent = "تم الحفظ ✅";
    setTimeout(()=> saveStatus.textContent = "", 2500);
  }catch(err){
    console.error(err);
    saveStatus.textContent = "خطأ أثناء الحفظ";
  }
}

/* ======= أدوات ======= */
function getYMD(){
  const d = new Date(dateInput.value);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
