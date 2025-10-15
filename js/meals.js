/* =========================================================
   meals.js  — صفحة الوجبات (وجبة اليوم + مكتبة الأصناف)
   - Overlay تحميل
   - قراءة بيانات الطفل (CF/CR/الحدود/أهداف الكارب)
   - جدول الوجبة وحساب الجرعات
   - نافذة مكتبة الأصناف (بحث/فلاتر/مفضلة/غير مفضلة)
   - "ضبط الوصول للهدف" (Scaling to carb target) — Fixed
   ========================================================= */
import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs,
  query, where, limit, Timestamp, collectionGroup, documentId
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";


/* --------- Utils --------- */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = (n,d=1)=> (n ?? 0).toFixed(d);
const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));
const roundStep = (v, step=0.5)=> Math.round(v/step)*step;
const todayUTC3 = ()=> {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset()*60000);
  return new Date(utc + 3*3600*1000);
};
const ymd = d => d.toISOString().slice(0,10);
const parseQuery = ()=> Object.fromEntries(new URLSearchParams(location.search).entries());

/* --------- Slots meta --------- */
const slotMap = {
  b: { ar: "فطار", defaultTime: "08:00", name: "breakfast" },
  l: { ar: "غداء", defaultTime: "13:00", name: "lunch" },
  d: { ar: "عشاء", defaultTime: "19:00", name: "dinner" },
  s: { ar: "سناك", defaultTime: "16:30", name: "snack" },
};

/* --------- State --------- */
let parentId, childId, slotKey, dateKey, mealTimeStr;
let childDoc = null, cf = 0, crMap = {}, targets = {}, carbRanges = {}, netRuleDefault = "fullFiber";
let favorites = [], disliked = [];
let libraryAll = [];     // جميع الأصناف
let libraryLoaded = false;
let mealItems = [];      // عناصر الوجبة الحالية

/* --------- UI Refs (تأكد IDs في HTML) --------- */
const els = {
  // شارة معلومات سريعة
  chipCF: $("#chipCF"),
  chipCR: $("#chipCR"),
  chipTargets: $("#chipTargets"),

  // حقول عامة
  dateInput: $("#dateInput"),
  slotSelect: $("#slotSelect"),
  mealTime: $("#mealTime"),
  preBg: $("#preBg"),
  doseCorrection: $("#doseCorrection"),
  netCarbRule: $("#netCarbRule"),
  doseCarbs: $("#doseCarbs"),
  doseTotal: $("#doseTotal"),
  dayCarbs: $("#dayCarbs"),

  // Progress
  progressBar: $("#progressBar"),
  progressLabel: $("#progressLabel"),
  btnScaleToTarget: $("#btnScaleToTarget"),

  // جدول الوجبة
  mealBody: $("#mealBody"),

  // المجاميع
  sumCarbsRaw: $("#sumCarbsRaw"),
  sumFiber: $("#sumFiber"),
  sumCarbsNet: $("#sumCarbsNet"),
  sumCal: $("#sumCal"),
  sumGI: $("#sumGI"),
  sumGL: $("#sumGL"),

  // أزرار
  btnClearMeal: $("#btnClearMeal"),
  btnSaveMeal: $("#btnSaveMeal"),
  btnSaveTemplate: $("#btnSaveTemplate"),
  btnLoadTemplates: $("#btnLoadTemplates"),
  btnExportCSV: $("#btnExportCSV"),
  btnPrint: $("#btnPrint"),
  btnOpenLibrary: $("#btnOpenLibrary"), // زر فتح المكتبة

  // Loader / Toast (يُحقن إن لم يكن موجود)
  loader: null,
  toast: null,
};

/* --------- Boot --------- */
init().catch(console.error);

/* =========================================================
   Init
   ========================================================= */
async function init() {
  injectLoaderToastAndModal(); // نضمن العناصر

  showLoader(true, "يتم التحميل…");

  // Resolve params
  const q = parseQuery();
  parentId = q.parentId || null;
  childId = q.childId || q.child;
  slotKey = (q.slot || "l").toLowerCase();
  dateKey = q.date || ymd(todayUTC3());
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";

  if (!childId) {
    showToast("يلزم تمرير child في الرابط");
    showLoader(false);
    return;
  }

  // نستخرج parentId لو ناقص
  if (!parentId) {
    const cg = await getDocs(
      query(collectionGroup(db, "children"), where(documentId(), "==", childId), limit(1))
    );
    if (cg.empty) {
      showToast("لم يتم العثور على الطفل");
      showLoader(false);
      return;
    }
    const docSnap = cg.docs[0];
    parentId = docSnap.ref.parent.parent.id;
    childDoc = docSnap.data();
  }

  // initial UI
  if (els.dateInput) els.dateInput.value = dateKey;
  if (els.slotSelect) els.slotSelect.value = slotKey;
  if (els.mealTime) els.mealTime.value = mealTimeStr;
  if (els.netCarbRule) els.netCarbRule.value = netRuleDefault;

  await loadChild();
  await loadDayTotals();
  await tryLoadExistingMeal();

  wireEvents();

  autoCompute();
  showLoader(false);
}

/* =========================================================
   Load Child
   ========================================================= */
async function loadChild() {
  if (!childDoc) {
    const ref = doc(db, `parents/${parentId}/children/${childId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Child not found");
    childDoc = snap.data();
  }

  cf = Number(childDoc.correctionFactor ?? childDoc.cf ?? 0);
  crMap = childDoc.carbRatioByMeal || {};
  targets = childDoc.normalRange || { max: 7, severeHigh: 10.9, severeLow: 3.9 };
  carbRanges = childDoc.carbTargets || {};
  netRuleDefault = childDoc.netCarbRule || "fullFiber";
  favorites = Array.isArray(childDoc.favorites) ? childDoc.favorites : [];
  disliked = Array.isArray(childDoc.disliked) ? childDoc.disliked : [];

  if (els.netCarbRule) els.netCarbRule.value = netRuleDefault;
  if (els.chipCF) els.chipCF.textContent = `CF ${cf || "—"} mmol/L per U`;
  if (els.chipTargets) els.chipTargets.textContent = `الهدف ${targets.max ?? 7} | تصحيح من ${targets.severeHigh ?? 10.9}`;
  updateCRChip();
}

/* =========================================================
   Day totals
   ========================================================= */
async function loadDayTotals() {
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const qy = query(mealsRef, where("date", "==", dateKey));
  const snaps = await getDocs(qy);
  let dayCarbs = 0;
  snaps.forEach(s => {
    const m = s.data();
    dayCarbs += Number(m?.totals?.carbs_net || 0);
  });
  if (els.dayCarbs) els.dayCarbs.textContent = fmt(dayCarbs, 0);
}

/* =========================================================
   Existing meal
   ========================================================= */
async function tryLoadExistingMeal() {
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const qy = query(mealsRef, where("date", "==", dateKey), where("slotKey", "==", slotKey), limit(1));
  const snaps = await getDocs(qy);
  if (!snaps.empty) {
    const m = snaps.docs[0].data();
    mealItems = (m.items || []).map(x => ({
      id: x.itemId, name: x.name,
      unitKey: x.unitKey, unitLabel: x.unitLabel,
      gramsPerUnit: Number(x.gramsPerUnit || 1),
      qty: Number(x.qty || 0),
      grams: Number(x.grams || 0),
      carbs_raw: Number(x.carbs_raw || x.carbs_g || 0),
      fiber_g: Number(x.fiber_g || 0),
      cal_kcal: Number(x.cal_kcal || 0),
      gi: Number(x.gi ?? 0),
      gl: Number(x.gl ?? 0),
      imageUrl: x.imageUrl || ""
    }));
    if (els.preBg) els.preBg.value = m.preBg_mmol ?? "";
    if (els.doseCorrection) els.doseCorrection.value = m.doseCorrection ?? "";
    if (els.doseCarbs) els.doseCarbs.value = m.doseCarbs ?? "";
    if (els.netCarbRule) els.netCarbRule.value = m.netCarbRuleUsed || netRuleDefault;
  } else {
    await fetchPreReading();
  }
  renderMeal();
}

/* =========================================================
   Render Meal Table
   ========================================================= */
function renderMeal() {
  if (!els.mealBody) return;
  els.mealBody.innerHTML = mealItems.map((x, i) => rowHTML(x, i)).join("");
  // wire per-row
  mealItems.forEach((x, i) => {
    const u = $(`#u_${i}`);
    const q = $(`#q_${i}`);
    const rm = $(`#rm_${i}`);
    u?.addEventListener("change", e => onUnitChange(i, Number(e.target.value)));
    q?.addEventListener("input", e => onQtyChange(i, Number(e.target.value || 0)));
    rm?.addEventListener("click", () => { mealItems.splice(i, 1); renderMeal(); });
  });
  autoCompute();
}

function rowHTML(x, i) {
  // measures from libraryAll item if available
  const lib = libraryAll.find(t => t.id === x.id);
  const measures = (lib?.measures?.length ? lib.measures : [{name:"جم", grams:1}]);
  const opts = measures.map(m =>
    `<option value="${m.grams}" ${Number(x.gramsPerUnit)===Number(m.grams)?"selected":""}>${m.name}</option>`
  ).join("");

  return `
  <tr>
    <td><img class="table-thumb" src="${x.imageUrl || "images/placeholder.png"}" alt=""></td>
    <td class="td-name">${x.name}</td>
    <td><select id="u_${i}">${opts}</select></td>
    <td><input id="q_${i}" type="number" step="0.1" value="${x.qty}"></td>
    <td>${fmt(x.grams,0)}</td>
    <td>${fmt(x.carbs_raw,1)}</td>
    <td>${fmt(x.fiber_g,1)}</td>
    <td>${x.gi || "—"}</td>
    <td>${fmt(x.gl,1)}</td>
    <td><button id="rm_${i}" class="btn danger" title="إزالة">✖</button></td>
  </tr>`;
}

function onUnitChange(i, gramsPerUnit) {
  const x = mealItems[i];
  x.gramsPerUnit = Number(gramsPerUnit);
  recalcRow(x); renderMeal();
}
function onQtyChange(i, qty) {
  const x = mealItems[i];
  x.qty = qty;
  recalcRow(x); renderMeal();
}
function recalcRow(x) {
  x.grams = x.qty * x.gramsPerUnit;
  const lib = libraryAll.find(t => t.id === x.id);
  const carbs100 = lib?.carbs100 || 0;
  const fiber100 = lib?.fiber100 || 0;
  const cal100   = lib?.cal100 || 0;
  const gi       = lib?.gi || 0;

  x.carbs_raw = (carbs100/100) * x.grams;
  x.fiber_g   = (fiber100/100) * x.grams;
  x.cal_kcal  = (cal100  /100) * x.grams;
  x.gi        = gi;
  x.gl        = gi ? (gi * (x.carbs_raw / 100)) : 0;
}

/* =========================================================
   Auto compute (sums + doses + progress)
   ========================================================= */
function crForSlot(k) {
  const fallback = Number(childDoc.carbRatio ?? 0) || undefined;
  return Number((childDoc.carbRatioByMeal || {})?.[k]) || fallback;
}

function updateCRChip() {
  if (!els.chipCR) return;
  const ar = slotMap[slotKey]?.ar || "";
  const cr = crForSlot(slotKey);
  els.chipCR.textContent = `CR(${ar}) ${cr ?? "—"} g/U`;
}

function slotKeyToName(k) {
  return slotMap[k]?.name || "lunch";
}

function autoCompute() {
  const carbsRaw = mealItems.reduce((a,x)=>a+x.carbs_raw,0);
  const fiber    = mealItems.reduce((a,x)=>a+x.fiber_g,0);
  const cal      = mealItems.reduce((a,x)=>a+x.cal_kcal,0);
  const glTotal  = mealItems.reduce((a,x)=>a+x.gl,0);

  const rule = els.netCarbRule?.value || "fullFiber";
  const factor = rule==="none"?0 : (rule==="halfFiber"?0.5:1);
  const carbsNet = Math.max(0, carbsRaw - (factor*fiber));

  const sumGICarb = mealItems.reduce((a,x)=>a + (x.gi||0)*(x.carbs_raw||0), 0);
  const giAvg = carbsRaw > 0 ? (sumGICarb / carbsRaw) : 0;

  const cr = crForSlot(slotKey) || 0;
  const doseCarbs = cr ? (carbsNet / cr) : 0;

  // correction dose rule
  const bg = Number(els.preBg?.value || 0);
  let doseCorr = Number(els.doseCorrection?.value || 0);
  if (bg && bg > Number(targets.severeHigh ?? 10.9) && cf) {
    doseCorr = (bg - Number(targets.max ?? 7)) / cf; // حسب الاتفاق
  }
  doseCorr = roundStep(Math.max(0, doseCorr), 0.5);
  if (els.doseCorrection) els.doseCorrection.value = doseCorr ? doseCorr.toFixed(1) : "";

  const totalDose = roundStep(doseCarbs + doseCorr, 0.5);

  // progress vs carb target
  const r = carbRanges?.[slotKeyToName(slotKey)] || {};
  const min = Number(r.min ?? 0), max = Number(r.max ?? 0);
  let pct = 0;
  if (max > 0) pct = clamp((carbsNet / max) * 100, 0, 100);
  if (els.progressBar) {
    els.progressBar.style.width = `${pct}%`;
    const state = carbsNet < min ? "warn" : carbsNet > max ? "danger" : "ok";
    els.progressBar.className = "bar " + state;
  }
  if (els.progressLabel) els.progressLabel.textContent = `${fmt(carbsNet,0)} / ${max || "—"} g`;

  // write sums
  if (els.sumCarbsRaw) els.sumCarbsRaw.textContent = fmt(carbsRaw,1);
  if (els.sumFiber) els.sumFiber.textContent    = fmt(fiber,1);
  if (els.sumCarbsNet) els.sumCarbsNet.textContent = fmt(carbsNet,1);
  if (els.sumCal) els.sumCal.textContent      = fmt(cal,0);
  if (els.sumGL) els.sumGL.textContent       = fmt(glTotal,1);
  if (els.sumGI) els.sumGI.textContent       = giAvg ? fmt(giAvg,0) : "—";

  if (els.doseCarbs) els.doseCarbs.value = doseCarbs ? doseCarbs.toFixed(1) : "";
  if (els.doseTotal) els.doseTotal.textContent = totalDose ? totalDose.toFixed(1) : "—";
}

/* =========================================================
   Fetch pre reading
   ========================================================= */
async function fetchPreReading() {
  const coll = collection(db, `parents/${parentId}/children/${childId}/measurements`);
  const preKey = `PRE_${slotKeyToName(slotKey).toUpperCase()}`;

  // 1) بنفس اليوم وبنفس slotKey
  const snaps = await getDocs(query(coll, where("slotKey", "==", preKey)));
  let candidates = snaps.docs.map(d => ({ id:d.id, ...d.data() }))
    .filter(x => x.when && ymd(x.when.toDate ? x.when.toDate() : new Date(x.when)) === dateKey);

  // 2) داخل 90 دقيقة قبل وقت الوجبة
  if (!candidates.length) {
    const mealDate = new Date(`${dateKey}T${mealTimeStr || "13:00"}:00`);
    const start = new Date(mealDate.getTime() - 90*60000);
    const end = mealDate;
    const all = await getDocs(coll);
    candidates = all.docs.map(d => ({ id:d.id, ...d.data() }))
      .filter(x => {
        const t = x.when?.toDate ? x.when.toDate() : (x.when ? new Date(x.when) : null);
        return t && t >= start && t <= end;
      });
  }

  if (candidates.length) {
    candidates.sort((a,b)=> (a.when?.seconds||0) - (b.when?.seconds||0));
    const last = candidates[candidates.length-1];
    const bg = Number(last.value_mmol ?? last.value ?? 0);
    if (els.preBg) els.preBg.value = bg ? bg.toFixed(1) : "";
  }
}

/* =========================================================
   Scale to target  — FIXED
   ========================================================= */
function chooseCarbTarget(carbsNet) {
  const r = carbRanges?.[slotKeyToName(slotKey)] || {};
  const min = Number(r.min ?? 0), max = Number(r.max ?? 0);

  if (!min && !max) return 0;
  if (min && carbsNet < min) return min;
  if (max && carbsNet > max) return max;
  // داخل النطاق: ما نغيرش — ممكن وسط النطاق
  return 0; // نعتبره لا يحتاج ضبط
}

function scaleToTarget() {
  const current = Number(els.sumCarbsNet?.textContent || 0);
  const target = chooseCarbTarget(current);

  if (!current || !target) {
    showToast(current ? "صافي الكارب داخل النطاق بالفعل 👍" : "لا توجد عناصر يمكن ضبطها");
    return;
  }
  const factor = target / current;
  mealItems.forEach(x => {
    const q = Number((x.qty * factor).toFixed(2));
    x.qty = q <= 0 ? 0.1 : q;
    recalcRow(x);
  });
  renderMeal();
  showToast(`تم ضبط الكميات للوصول إلى ${target}g`);
}

/* =========================================================
   Save / Templates / CSV
   ========================================================= */
async function saveMeal() {
  const docData = {
    date: dateKey,
    slotKey,
    type: slotMap[slotKey]?.ar || "",
    preBg_mmol: Number(els.preBg?.value || 0) || null,
    netCarbRuleUsed: els.netCarbRule?.value || "fullFiber",
    doseCarbs: Number(els.doseCarbs?.value || 0) || 0,
    doseCorrection: Number(els.doseCorrection?.value || 0) || 0,
    doseTotal: Number(els.doseTotal?.textContent || 0) || 0,
    totals: {
      carbs_raw: Number(els.sumCarbsRaw?.textContent || 0),
      fiber_g: Number(els.sumFiber?.textContent || 0),
      carbs_net: Number(els.sumCarbsNet?.textContent || 0),
      cal_kcal: Number(els.sumCal?.textContent || 0),
      gi_avg: (els.sumGI?.textContent === "—") ? null : Number(els.sumGI?.textContent),
      gl_total: Number(els.sumGL?.textContent || 0)
    },
    items: mealItems.map(x => ({
      itemId: x.id, name: x.name,
      unitKey: x.unitKey, unitLabel: x.unitLabel,
      gramsPerUnit: x.gramsPerUnit, qty: x.qty, grams: x.grams,
      carbs_raw: x.carbs_raw, fiber_g: x.fiber_g, carbs_g: x.carbs_raw,
      cal_kcal: x.cal_kcal, gi: x.gi || null, gl: x.gl || null,
      imageUrl: x.imageUrl || null
    })),
    updatedAt: Timestamp.now()
  };

  const id = `${dateKey}_${slotKey}`;
  const ref = doc(db, `parents/${parentId}/children/${childId}/meals/${id}`);
  await setDoc(ref, docData, { merge: true });
  showToast("تم حفظ الوجبة ✅");
  await loadDayTotals();
}

async function saveTemplate() {
  const out = {
    createdAt: new Date().toISOString(),
    items: mealItems.map(x => ({
      itemId: x.id, grams: x.grams, measure: x.unitLabel,
      calc: { carbs: x.carbs_raw, fiber: x.fiber_g, gi: x.gi || 0, gl: x.gl || 0, cal: x.cal_kcal }
    }))
  };
  const id = `tmpl_${Date.now()}`;
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/presetMeals/${id}`), out);
  showToast("تم حفظ القالب ✅");
}

async function importFromTemplates() {
  const coll = collection(db, `parents/${parentId}/children/${childId}/presetMeals`);
  const snaps = await getDocs(coll);
  if (snaps.empty) { showToast("لا توجد قوالب محفوظة"); return; }
  let latestDoc = snaps.docs[0];
  snaps.forEach(d => { if ((d.data().createdAt||"") > (latestDoc.data().createdAt||"")) latestDoc = d; });
  const t = latestDoc.data();

  (t.items || []).forEach(it => {
    const lib = libraryAll.find(x => x.id === (it.itemId || it.id));
    if (!lib) return;
    const grams = Number(it.grams || 0);
    const qty = grams && lib.measures[0] ? (grams / (lib.measures[0].grams || 1)) : 1;
    const carbs_raw = (lib.carbs100/100) * grams;
    const fiber_g   = (lib.fiber100/100) * grams;
    const cal_kcal  = (lib.cal100  /100) * grams;
    const gi        = lib.gi || 0;
    const gl        = gi ? gi * (carbs_raw/100) : 0;

    mealItems.push({
      id: lib.id, name: lib.name,
      unitKey: lib.measures[0].name, unitLabel: lib.measures[0].name,
      gramsPerUnit: lib.measures[0].grams, qty, grams,
      carbs_raw, fiber_g, cal_kcal, gi, gl,
      imageUrl: lib.imageUrl
    });
  });
  renderMeal();
}

/* =========================================================
   CSV
   ========================================================= */
function exportCSV() {
  const rows = [
    ["التاريخ", dateKey, "الوجبة", slotMap[slotKey]?.ar || slotKey],
    [],
    ["الصنف","الوحدة","الكمية","جرام","كارب(raw)","ألياف","Net Rule","GI","GL","سعرات"]
  ];
  const rule = els.netCarbRule?.value || "fullFiber";
  mealItems.forEach(x => {
    rows.push([x.name, x.unitLabel, x.qty, x.grams, x.carbs_raw, x.fiber_g, rule, x.gi||"", x.gl||"", x.cal_kcal]);
  });
  rows.push([]);
  rows.push(["Carbs(raw)", els.sumCarbsRaw?.textContent, "Fiber", els.sumFiber?.textContent, "Net", els.sumCarbsNet?.textContent, "Calories", els.sumCal?.textContent, "GI(avg)", els.sumGI?.textContent, "GL", els.sumGL?.textContent]);
  rows.push(["DoseCarbs", els.doseCarbs?.value, "DoseCorrection", els.doseCorrection?.value, "DoseTotal", els.doseTotal?.textContent]);

  const csv = rows.map(r => r.map(x => `"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `meal_${dateKey}_${slotKey}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   Library Modal (Lazy)
   ========================================================= */
function injectLoaderToastAndModal() {
  // Loader
  let l = document.createElement("div");
  l.className = "app-loader";
  l.innerHTML = `<div class="box"><div class="spinner"></div><div>يتم التحميل…</div></div>`;
  document.body.appendChild(l);
  els.loader = l;

  // Toast
  let t = document.createElement("div");
  t.className = "toast";
  document.body.appendChild(t);
  els.toast = t;

  // Modal structure
  if (!$("#libraryModal")) {
    const modal = document.createElement("div");
    modal.id = "libraryModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="مكتبة الأصناف">
        <div class="modal-header">
          <div class="row">
            <div class="modal-search">
              <span>🔎</span>
              <input id="libSearch" type="search" placeholder="ابحث بالإسم أو الوسم…" />
            </div>
            <label class="chip"><input id="libFavOnly" type="checkbox"> المفضلة فقط</label>
            <label class="chip"><input id="libHideDisliked" type="checkbox"> إخفاء غير المفضلة</label>
            <button id="libClose" class="btn secondary">إغلاق</button>
          </div>
        </div>
        <div class="modal-body">
          <div class="chips" id="libChips"></div>
          <div class="grid" id="libGrid"></div>
          <div class="note" id="libNote" style="margin-top:10px"></div>
        </div>
        <div class="modal-footer">
          <div class="note">يمكنك الضغط على ⭐ لإضافة إلى المفضلة، و🚫 لغير المفضلة</div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
}

function openLibraryModal() {
  const modal = $("#libraryModal");
  modal?.classList.add("open");
  // أول مرة فقط حمّل المكتبة
  if (!libraryLoaded) loadLibrary();
}
function closeLibraryModal() {
  $("#libraryModal")?.classList.remove("open");
}

/* Load library once */
async function loadLibrary() {
  showLoader(true, "تحميل مكتبة الأصناف…");
  libraryAll = [];
  const snaps = await getDocs(collection(db, "admin/global/foodItems"));
  for (const s of snaps.docs) {
    const d = s.data(); const id = s.id;
    const per100 = d.per100 || {};
    const carbs100 = Number(d.carbs_g ?? per100.carbs ?? 0);
    const fiber100 = Number(d.fiber_g ?? per100.fiber ?? 0);
    const cal100   = Number(d.cal_kcal ?? per100.cal ?? 0);
    const gi       = Number(d.gi ?? per100.gi ?? 0);
    const measures = (d.measures || per100.measures || []).map(m => ({ name: m.name, grams: Number(m.grams) }));
    if (!measures.length) measures.push({ name:"جم", grams:1 });

    let imageUrl = "";
    try {
      imageUrl = await getDownloadURL(sRef(st, `food-items/items/${id}/main.jpg`));
    } catch (_) {
      imageUrl = "images/placeholder.png";
    }

    libraryAll.push({
      id, name: d.name || d.title || "بدون اسم",
      carbs100, fiber100, cal100, gi, measures, imageUrl,
      dietSystems: d.dietSystems || d.dietSystemsAuto || [],
      dietTags: d.dietTags || d.dietTagsAuto || []
    });
  }
  libraryLoaded = true;
  showLoader(false);
  renderLibraryModal();
}

function renderLibraryModal() {
  const term = ($("#libSearch")?.value || "").trim();
  const favOnly = $("#libFavOnly")?.checked;
  const hideDisliked = $("#libHideDisliked")?.checked;

  const favSet = new Set(favorites);
  const disSet = new Set(disliked);

  let items = libraryAll.filter(it => {
    if (favOnly && !favSet.has(it.id)) return false;
    if (hideDisliked && disSet.has(it.id)) return false;
    if (term) {
      const t = term.toLowerCase();
      const inName = (it.name||"").toLowerCase().includes(t);
      const inTags = [...(it.dietSystems||[]), ...(it.dietTags||[])].join(" ").includes(term);
      if (!inName && !inTags) return false;
    }
    return true;
  });

  // ترتيب: مفضلة → عادية → غير مفضلة
  items.sort((a,b)=>{
    const ra = favSet.has(a.id)?0:(disSet.has(a.id)?2:1);
    const rb = favSet.has(b.id)?0:(disSet.has(b.id)?2:1);
    if (ra!==rb) return ra-rb;
    return a.name.localeCompare(b.name, "ar");
  });

  const grid = $("#libGrid");
  grid.innerHTML = items.map(it => cardHTML(it, favSet.has(it.id), disSet.has(it.id))).join("");

  // wire
  $$("#libGrid .card-item").forEach(card => {
    const id = card.dataset.id;
    card.querySelector(".btn-add")?.addEventListener("click", ()=> addItemFromLibrary(id));
    card.querySelector(".fav")?.addEventListener("click", ()=> toggleFav(id));
    card.querySelector(".ban")?.addEventListener("click", ()=> toggleBan(id));
  });

  const note = $("#libNote");
  note.textContent = `المعروض: ${items.length} / الإجمالي: ${libraryAll.length}`;
}

function cardHTML(it, isFav, isBan) {
  const favCls = isFav ? "on" : "";
  const banCls = isBan ? "on" : "";
  return `
  <div class="card-item" data-id="${it.id}">
    <div class="thumb"><img src="${it.imageUrl}" loading="lazy" alt=""></div>
    <div class="meta">
      <div class="name">${it.name}</div>
      <div class="sub">GI: ${it.gi || "—"} • لكل 100جم: كارب ${fmt(it.carbs100,0)}g | ألياف ${fmt(it.fiber100,0)}g | ${fmt(it.cal100,0)} kcal</div>
    </div>
    <div class="actions">
      <div style="display:flex; gap:6px">
        <button class="ic fav ${favCls}" title="مفضّل">⭐</button>
        <button class="ic ban ${banCls}" title="غير مفضّل">🚫</button>
      </div>
      <button class="btn-add" title="إضافة">+ إضافة</button>
    </div>
  </div>`;
}

async function toggleFav(id) {
  const s = new Set(favorites);
  s.has(id) ? s.delete(id) : s.add(id);
  favorites = Array.from(s);
  try {
    await updateDoc(doc(db, `parents/${parentId}/children/${childId}`), { favorites });
  } catch {}
  renderLibraryModal();
}
async function toggleBan(id) {
  const s = new Set(disliked);
  s.has(id) ? s.delete(id) : s.add(id);
  disliked = Array.from(s);
  try {
    await updateDoc(doc(db, `parents/${parentId}/children/${childId}`), { disliked });
  } catch {}
  renderLibraryModal();
}

function addItemFromLibrary(id) {
  const it = libraryAll.find(x => x.id === id);
  if (!it) return;
  const m = it.measures.find(x => x.grams !== 1) || it.measures[0];
  const unitKey = m.name;
  const gramsPerUnit = Number(m.grams);
  const qty = 1;
  const grams = qty * gramsPerUnit;

  const carbs_raw = (it.carbs100 / 100) * grams;
  const fiber_g   = (it.fiber100 / 100) * grams;
  const cal_kcal  = (it.cal100   / 100) * grams;
  const gi = it.gi || 0;
  const gl = gi ? (gi * (carbs_raw / 100)) : 0;

  mealItems.push({
    id: it.id, name: it.name, unitKey, unitLabel: unitKey,
    gramsPerUnit, qty, grams, carbs_raw, fiber_g, cal_kcal, gi, gl,
    imageUrl: it.imageUrl
  });
  renderMeal();
  showToast(`تمت إضافة "${it.name}"`);
}

/* =========================================================
   Events
   ========================================================= */
function wireEvents() {
  els.slotSelect?.addEventListener("change", ()=>{
    slotKey = els.slotSelect.value;
    updateCRChip();
    mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";
    els.mealTime && (els.mealTime.value = mealTimeStr);
    autoCompute();
  });
  els.dateInput?.addEventListener("change", async ()=>{
    dateKey = els.dateInput.value;
    await loadDayTotals();
    await tryLoadExistingMeal();
  });
  els.mealTime?.addEventListener("change", ()=> mealTimeStr = els.mealTime.value);
  els.netCarbRule?.addEventListener("change", autoCompute);
  els.doseCorrection?.addEventListener("input", updateDoseTotal);
  els.doseCarbs?.addEventListener("input", updateDoseTotal);

  els.btnScaleToTarget?.addEventListener("click", scaleToTarget);
  els.btnClearMeal?.addEventListener("click", ()=>{ mealItems = []; renderMeal(); });
  els.btnSaveMeal?.addEventListener("click", saveMeal);
  els.btnSaveTemplate?.addEventListener("click", saveTemplate);
  els.btnLoadTemplates?.addEventListener("click", importFromTemplates);
  els.btnExportCSV?.addEventListener("click", exportCSV);
  els.btnPrint?.addEventListener("click", ()=> window.print());

  // library modal
  els.btnOpenLibrary?.addEventListener("click", openLibraryModal);
  $("#libClose")?.addEventListener("click", closeLibraryModal);
  $("#libraryModal")?.addEventListener("click", (e)=>{
    if (e.target.dataset.close !== undefined) closeLibraryModal();
  });
  $("#libSearch")?.addEventListener("input", debounce(renderLibraryModal, 250));
  $("#libFavOnly")?.addEventListener("change", renderLibraryModal);
  $("#libHideDisliked")?.addEventListener("change", renderLibraryModal);
}

function updateDoseTotal() {
  const doseC = Number(els.doseCarbs?.value || 0);
  const doseCorr = Number(els.doseCorrection?.value || 0);
  if (els.doseTotal) els.doseTotal.textContent = roundStep(doseC + doseCorr, 0.5).toFixed(1);
}

/* =========================================================
   Helpers: Loader / Toast / Debounce
   ========================================================= */
function showLoader(on, text) {
  if (!els.loader) return;
  els.loader.classList.toggle("show", !!on);
  if (text) els.loader.querySelector(".box div:last-child").textContent = text;
}
let toastTimer;
function showToast(msg) {
  if (!els.toast) return alert(msg);
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> els.toast.classList.remove("show"), 1800);
}
function debounce(fn, ms=200) {
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
