// js/meals.js — نسخة محسّنة
console.log("✅ [meals] module loaded v6 (Fixed CR keys + CF per meal + Header)");

import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, addDoc, serverTimestamp,
  collection, collectionGroup, getDocs,
  query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $   = (s) => document.querySelector(s);
const fmt = (n, d=1) => Number.isFinite(n) ? (+n).toFixed(d) : "—";
const todayStr = () => new Date().toISOString().slice(0, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mgdl2mmol = mg   => +(mg / 18).toFixed(1);
const mmol2mgdl = mmol => +(mmol * 18).toFixed(0);
const round1 = n => Math.round((Number(n) || 0) * 10) / 10;

const FIXED_MMOL_UPPER = 7.1;

/* ============================================================
   ✅ تصحيح: مفاتيح Firestore هي b/l/d/s وليس breakfast/lunch...
   ============================================================ */
const SLOT_MAP     = { b:"BREAKFAST", l:"LUNCH", d:"DINNER", s:"SNACK" };
const SLOT_LABEL   = { b:"الفطور", l:"الغداء", d:"العشاء", s:"السناك" };
// مفاتيح correctionFactorByMeal في Firestore
const CF_MEAL_KEYS = { b:"b", l:"l", d:"d", s:"s" };

const els = {
  loader:          $("#appLoader"),
  btnBack:         $("#btnBack"),
  chipCF:          $("#chipCF"),
  chipCR:          $("#chipCR"),
  chipTargets:     $("#chipTargets"),
  slotSelect:      $("#slotSelect"),
  dateInput:       $("#dateInput"),
  preBg:           $("#preBg"),
  preBgUnit:       $("#preBgUnit"),
  btnFetchPre:     $("#btnFetchPre"),
  preStatus:       $("#preStatus"),       // جديد — رسالة حالة القراءة
  netCarbRule:     $("#netCarbRule"),
  doseCorrection:  $("#doseCorrection"),
  doseCarbs:       $("#doseCarbs"),
  progressBar:     $("#progressBar"),
  iobValue:        $("#iobValue"),
  smartAlerts:     $("#smartAlerts"),
  btnScaleToTarget:$("#btnScaleToTarget"),
  btnClearMeal:    $("#btnClearMeal"),
  btnOpenLibrary:  $("#btnOpenLibrary"),
  mealBody:        $("#mealBody"),
  doseFinal:       $("#doseFinal"),
  sumGL:           $("#sumGL"),
  sumGI:           $("#sumGI"),
  sumFiber:        $("#sumFiber"),
  sumProtein:      $("#sumProtein"),
  sumFat:          $("#sumFat"),
  sumCarbsNet:     $("#sumCarbsNet"),
  sumCarbsRaw:     $("#sumCarbsRaw"),
  sumCalories:     $("#sumCalories"),
  libModal:        $("#libModal"),
  libClose:        $("#libClose"),
  searchBox:       $("#searchBox"),
  itemsGrid:       $("#itemsGrid"),
  tplModal:        $("#tplModal"),
  tplList:         $("#tplList"),
  btnSaveMeal:     $("#btnSaveMeal"),
  btnSaveTemplate: $("#btnSaveTemplate"),
  btnLoadTemplates:$("#btnLoadTemplates"),
};

const state = {
  childId: null, parentId: null, child: null,
  slot: "b", date: todayStr(), rule: "fullFiber",
  // ✅ CF لكل وجبة
  CFs: { b: null, l: null, d: null, s: null },
  CF: null,  // للتوافق مع الكود القديم
  // ✅ CR لكل وجبة — المفاتيح b/l/d/s مطابقة لـ Firestore
  CRs: { b: null, l: null, d: null, s: null },
  targets: {
    b: {min:0,max:0}, l: {min:0,max:0},
    d: {min:0,max:0}, s: {min:0,max:0}
  },
  itemsLib: [], items: [], templates: [],
  IOB: 0, finalDoseVal: 0,
  corrDirty: false, carbDirty: false,
  preFetched: false,  // هل تم جلب القراءة من Firestore
};

/* ---- Loader ---- */
function showLoader(v) {
  if (els.loader) els.loader.style.display = v ? "flex" : "none";
}

/* ---- رجوع ---- */
function setBackHref() {
  if (els.btnBack)
    els.btnBack.href = `child.html?child=${state.childId}`;
}

/* ---- ✅ Chips محسّنة: CR وCF حسب الوجبة الحالية ---- */
function setChips() {
  const slot = state.slot;
  const CR = state.CRs[slot] ?? state.child?.carbRatio ?? "—";
  const CF = state.CFs[slot] ?? state.CF ?? "—";
  const t  = state.targets[slot] || { min:"—", max:"—" };
  const unit = state.child?.glucoseUnit || "mmol/L";
  const lbl  = SLOT_LABEL[slot];

  if (els.chipCF) els.chipCF.textContent =
    `CF (${lbl}): ${Number.isFinite(CF) ? CF : CF} ${unit}/U`;
  if (els.chipCR) els.chipCR.textContent =
    `CR (${lbl}): ${CR} g/U`;
  if (els.chipTargets) els.chipTargets.textContent =
    `الكارب المستهدف (${lbl}): ${t.min}–${t.max} g`;
}

const auth = getAuth();
function ensureAuth() {
  return new Promise(res => onAuthStateChanged(auth, u => res(u), () => res(null)));
}

async function resolveParentIdIfNeeded(user) {
  if (state.parentId && state.parentId === user.uid) return;
  const d1   = doc(db, "parents", user.uid, "children", state.childId);
  const s1   = await getDoc(d1);
  if (s1.exists()) { state.parentId = user.uid; return; }
  const cg   = query(collectionGroup(db, "children"), where("parentId","==", user.uid), limit(1));
  const snap = await getDocs(cg);
  if (snap.empty) throw new Error("لا أملك صلاحية لهذا الطفل");
  state.parentId = snap.docs[0].ref.parent.parent.id;
}

async function loadChild() {
  const dref = doc(db, "parents", state.parentId, "children", state.childId);
  const snap = await getDoc(dref);
  if (!snap.exists()) throw new Error("لم يتم العثور على بيانات الطفل.");
  state.child = { id: snap.id, ...snap.data() };

  /* ✅ إصلاح: المفاتيح في Firestore هي b/l/d/s مباشرة */
  const byMeal = state.child.carbRatioByMeal || {};
  state.CRs.b = byMeal.b ?? byMeal.breakfast ?? state.child.carbRatio ?? null;
  state.CRs.l = byMeal.l ?? byMeal.lunch     ?? state.child.carbRatio ?? null;
  state.CRs.d = byMeal.d ?? byMeal.dinner    ?? state.child.carbRatio ?? null;
  state.CRs.s = byMeal.s ?? byMeal.snack     ?? state.child.carbRatio ?? null;

  /* ✅ CF لكل وجبة */
  const cfByMeal = state.child.correctionFactorByMeal || {};
  const globalCF = state.child.correctionFactor ?? null;
  state.CFs.b = cfByMeal.b ?? cfByMeal.breakfast ?? globalCF;
  state.CFs.l = cfByMeal.l ?? cfByMeal.lunch     ?? globalCF;
  state.CFs.d = cfByMeal.d ?? cfByMeal.dinner    ?? globalCF;
  state.CFs.s = cfByMeal.s ?? cfByMeal.snack     ?? globalCF;
  state.CF = globalCF;  // للتوافق مع saveMeal

  const tg = state.child.carbTargets || {};
  state.targets.b = tg.breakfast || {min:0,max:0};
  state.targets.l = tg.lunch     || {min:0,max:0};
  state.targets.d = tg.dinner    || {min:0,max:0};
  state.targets.s = tg.snack     || {min:0,max:0};

  state.rule = state.child.netCarbRule || state.rule;
  if (els.netCarbRule) els.netCarbRule.value = state.rule;
  if (els.preBgUnit)   els.preBgUnit.value   = state.child.glucoseUnit || "mmol/L";

  setChips();
}

/* ============================================================
   ✅ جلب القراءة السابقة — محسّن مع رسالة حالة واضحة
   ============================================================ */
function setPreStatus(msg, type = "info") {
  // type: info | found | notfound | saving
  if (!els.preStatus) return;
  const colors = {
    info:     { bg:"#f1f5f9", color:"#475569" },
    found:    { bg:"#d1fae5", color:"#065f46" },
    notfound: { bg:"#fff7ed", color:"#92400e" },
    saving:   { bg:"#eff6ff", color:"#1e40af" },
    saved:    { bg:"#d1fae5", color:"#065f46" },
  };
  const c = colors[type] || colors.info;
  els.preStatus.style.cssText = `
    display:inline-block; padding:4px 10px; border-radius:8px;
    font-size:12px; font-weight:500; margin-top:4px;
    background:${c.bg}; color:${c.color};
  `;
  els.preStatus.textContent = msg;
}

async function fetchPreMeasurement() {
  try {
    if (els.preBg) els.preBg.value = "";
    state.corrDirty  = false;
    state.preFetched = false;
    setPreStatus(`جارِ البحث عن قراءة ${SLOT_LABEL[state.slot]}…`, "info");

    const preKey = `PRE_${SLOT_MAP[state.slot]}`;
    const coll   = collection(db, "parents", state.parentId, "children", state.childId, "measurements");
    const qy     = query(coll, where("date","==", state.date), where("slotKey","==", preKey));
    const snap   = await getDocs(qy);

    if (!snap.empty) {
      const docs = snap.docs.map(d => d.data())
        .sort((a, b) => (b.when?.seconds||0) - (a.when?.seconds||0));
      const m = docs[0];
      const unit = m.unit || state.child?.glucoseUnit || "mmol/L";
      const val  = unit === "mg/dL"
        ? (m.value_mgdl ?? m.value)
        : (m.value_mmol ?? m.value);

      if (els.preBgUnit) els.preBgUnit.value = unit;
      if (els.preBg)     els.preBg.value     = val;
      state.preFetched = true;
      setPreStatus(`✓ تم جلب قراءة ${SLOT_LABEL[state.slot]}: ${val} ${unit}`, "found");
    } else {
      setPreStatus(
        `لا توجد قراءة ${SLOT_LABEL[state.slot]} — أدخلها وستُحفظ تلقائياً عند حفظ الوجبة`,
        "notfound"
      );
    }
    updateTotals();
  } catch (e) {
    console.error("fetchPre error:", e);
    setPreStatus("تعذّر جلب القراءة", "info");
  }
}

/* ============================================================
   IOB
   ============================================================ */
async function calculateIOB() {
  state.IOB = 0;
  const now = new Date();
  try {
    const measColl  = collection(db, "parents", state.parentId, "children", state.childId, "measurements");
    const measSnap  = await getDocs(query(measColl, where("date","==", todayStr())));
    measSnap.forEach(d => {
      const data = d.data();
      const time = data.when?.toDate() || data.createdAt?.toDate();
      if (time) {
        const hrs = (now - time) / 3600000;
        if (hrs >= 0 && hrs < 4)
          state.IOB += (Number(data.correctionDose)||0) * (1 - (hrs / 4));
      }
    });

    const mealsColl = collection(db, "parents", state.parentId, "children", state.childId, "meals");
    const mealsSnap = await getDocs(query(mealsColl, where("date","==", todayStr())));
    mealsSnap.forEach(d => {
      const data = d.data();
      const time = data.createdAt?.toDate();
      if (time) {
        const hrs = (now - time) / 3600000;
        if (hrs >= 0 && hrs < 4)
          state.IOB += (Number(data.doses?.final)||0) * (1 - (hrs / 4));
      }
    });
  } catch (e) { console.error("IOB error", e); }
  if (els.iobValue) els.iobValue.textContent = fmt(state.IOB, 1) + " U";
  updateTotals();
}

/* ============================================================
   مكتبة الأصناف
   ============================================================ */
async function loadFoodLibrary() {
  try {
    // أصناف الأدمن
    const adminSnap  = await getDocs(collection(db, "admin", "global", "foodItems"));
    // أصناف الأهل الخاصة
    const parentSnap = await getDocs(
      collection(db, "parents", state.parentId, "foodItems")
    ).catch(() => ({ docs: [] }));

    const mapItem = d => {
      const x = { id: d.id, ...d.data() };
      x.per100 = {
        carbs_g:   +x.carbs_g   || +x.nutrPer100g?.carbs_g   || 0,
        fiber_g:   +x.fiber_g   || +x.nutrPer100g?.fiber_g   || 0,
        fat_g:     +x.fat_g     || +x.nutrPer100g?.fat_g     || 0,
        protein_g: +x.protein_g || +x.nutrPer100g?.protein_g || 0,
        cal_kcal:  +x.cal_kcal  || +x.nutrPer100g?.cal_kcal  || 0,
        gi: Number.isFinite(+x.gi) ? +x.gi : null,
      };
      x.units = Array.isArray(x.units) ? x.units
              : Array.isArray(x.measures) ? x.measures : [];
      return x;
    };

    state.itemsLib = [
      ...adminSnap.docs.map(mapItem),
      ...parentSnap.docs.map(mapItem),
    ];
    renderLibrary();
  } catch (e) { console.error("lib load error", e); }
}

function renderLibrary() {
  if (!els.itemsGrid) return;
  const term = els.searchBox?.value?.trim().toLowerCase() || "";
  const list = term
    ? state.itemsLib.filter(x => (x.name||"").toLowerCase().includes(term)
        || (x.name_ar||"").includes(term))
    : state.itemsLib;

  els.itemsGrid.innerHTML = "";
  const CR = state.CRs[state.slot] ?? state.child?.carbRatio;

  for (const it of list) {
    const card = document.createElement("div");
    card.className = "card-item";
    const body = document.createElement("div");
    body.className = "card-body";

    // عرض الجرعة المقترحة لـ 100g حسب CR الطفل
    const doseHint = Number.isFinite(CR) && it.per100.carbs_g
      ? `≈ ${fmt(it.per100.carbs_g / CR, 1)} U لكل 100g`
      : "";

    body.innerHTML = `
      <div style="font-weight:600">${it.name_ar || it.name || "صنف"}</div>
      <div class="badges">
        <span class="badge">🍞 ${fmt(it.per100.carbs_g,1)}g كارب</span>
        <span class="badge">🔥 ${fmt(it.per100.cal_kcal,0)} kcal</span>
        ${it.per100.gi ? `<span class="badge">GI ${it.per100.gi}</span>` : ""}
        ${doseHint ? `<span class="badge" style="background:#dbeafe;color:#1e40af">${doseHint}</span>` : ""}
      </div>`;

    const rowMini = document.createElement("div");
    rowMini.className = "row-mini";
    const selUnit = document.createElement("select");
    selUnit.innerHTML = `<option value="__g__">جرام</option>`
      + (it.units||[]).map(m =>
          `<option value="${m.label||m.key}">${m.label||m.key} (${m.grams} جم)</option>`
        ).join("");
    const inpQty = document.createElement("input");
    inpQty.type="number"; inpQty.step="0.1"; inpQty.value=1;
    const btnAdd = document.createElement("button");
    btnAdd.className="btn primary"; btnAdd.textContent="إضافة";
    btnAdd.onclick = () => {
      const unitLabel = selUnit.value === "__g__" ? "جرام" : selUnit.value;
      addItemToMealFromLib(it, unitLabel, +inpQty.value || 0);
    };
    rowMini.append(selUnit, inpQty, btnAdd);
    body.appendChild(rowMini);
    card.appendChild(body);
    els.itemsGrid.appendChild(card);
  }
}

function findMeasureGrams(it, unitLabel) {
  if (unitLabel === "جرام") return 1;
  const m = (it.units||[]).find(x => (x.label||x.key) === unitLabel);
  return m ? m.grams : null;
}
function computeGrams(unitLabel, qty, it) {
  if (unitLabel === "جرام") return +qty || 0;
  const g = findMeasureGrams(it, unitLabel);
  return g ? (+qty||0) * g : 0;
}
function computeRow(it) {
  const grams    = +it.grams || 0;
  const ratio    = grams / 100;
  const carbsRaw = (it.per100.carbs_g  || 0) * ratio;
  const fiber    = (it.per100.fiber_g  || 0) * ratio;
  const fat      = (it.per100.fat_g    || 0) * ratio;
  const protein  = (it.per100.protein_g|| 0) * ratio;
  const f = state.rule === "fullFiber" ? 1 : state.rule === "halfFiber" ? 0.5 : 0;
  const net = Math.max(0, carbsRaw - fiber * f);
  const cal = (it.per100.cal_kcal || 0) * ratio;
  const GI  = Number.isFinite(it.per100.gi) ? it.per100.gi : null;
  const GL  = GI ? (GI * net / 100) : 0;
  return { carbsRaw, fiber, fat, protein, net, cal, GI, GL };
}

function addItemToMealFromLib(fi, unitLabel, qty) {
  const it = {
    id: fi.id, name: fi.name_ar || fi.name || "صنف",
    units: fi.units || [], per100: fi.per100,
    unitLabel: unitLabel || "جرام", qty: +qty || 0, grams: 0
  };
  it.grams = computeGrams(it.unitLabel, it.qty, it);
  state.items.push(it);
  state.carbDirty = false;
  renderMeal();
  if (els.libModal) els.libModal.classList.remove("open");
}

function renderMeal() {
  if (!els.mealBody) return;
  els.mealBody.innerHTML = "";
  if (!state.items.length) {
    els.mealBody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:#999;padding:16px">لا توجد أصناف مضافة.</td></tr>`;
  } else {
    for (const it of state.items) {
      const c  = computeRow(it);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><button class="btn sm gray" data-del>×</button></td>
        <td>${fmt(c.GL,1)}</td><td>${Number.isFinite(c.GI)?c.GI:"—"}</td>
        <td>${fmt(c.fiber,1)}</td><td>${fmt(c.protein,1)}</td><td>${fmt(c.fat,1)}</td>
        <td style="font-weight:bold;color:#7c3aed">${fmt(c.net,1)}</td>
        <td>${fmt(c.carbsRaw,1)}</td><td>${fmt(c.cal,0)}</td>
        <td><input type="number" step="0.1" value="${it.qty||0}" data-qty style="width:60px"/></td>
        <td><select data-unit>${["جرام",...(it.units||[]).map(m=>m.label||m.key)]
          .map(l=>`<option value="${l}" ${l===it.unitLabel?"selected":""}>${l}</option>`).join("")}
        </select></td>
        <td>${it.name}</td>`;
      tr.querySelector("[data-qty]").addEventListener("input", e => {
        it.qty = +e.target.value || 0;
        it.grams = computeGrams(it.unitLabel, it.qty, it);
        state.carbDirty = false; renderMeal();
      });
      tr.querySelector("[data-unit]").addEventListener("change", e => {
        it.unitLabel = e.target.value;
        it.grams = computeGrams(it.unitLabel, it.qty, it);
        state.carbDirty = false; renderMeal();
      });
      tr.querySelector("[data-del]").addEventListener("click", () => {
        state.items = state.items.filter(x => x !== it);
        state.carbDirty = false; renderMeal();
      });
      els.mealBody.appendChild(tr);
    }
  }
  updateTotals();
}

function updateTotals() {
  let sumRaw=0, sumNet=0, sumFiber=0, sumFat=0, sumPro=0, sumCal=0, sumGL=0, giVals=[];
  for (const it of state.items) {
    const c = computeRow(it);
    sumRaw+=c.carbsRaw; sumNet+=c.net; sumFiber+=c.fiber;
    sumFat+=c.fat; sumPro+=c.protein; sumCal+=c.cal; sumGL+=c.GL;
    if (Number.isFinite(c.GI)) giVals.push(c.GI);
  }
  if (els.sumCarbsRaw) els.sumCarbsRaw.textContent = `${fmt(sumRaw,1)} g`;
  if (els.sumCarbsNet) els.sumCarbsNet.textContent = `${fmt(sumNet,1)} g`;
  if (els.sumFiber)    els.sumFiber.textContent    = `${fmt(sumFiber,1)} g`;
  if (els.sumProtein)  els.sumProtein.textContent  = `${fmt(sumPro,1)} g`;
  if (els.sumFat)      els.sumFat.textContent      = `${fmt(sumFat,1)} g`;
  if (els.sumCalories) els.sumCalories.textContent = `${fmt(sumCal,0)} kcal`;
  if (els.sumGL)       els.sumGL.textContent       = fmt(sumGL,1);
  if (els.sumGI)       els.sumGI.textContent       = giVals.length
    ? Math.round(giVals.reduce((a,b)=>a+b,0)/giVals.length) : "—";

  // ✅ CR وCF من الوجبة الحالية
  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const CF = state.CFs[state.slot] ?? state.CF ?? null;

  let doseCarb = Number.isFinite(CR) ? sumNet / CR : 0;

  const bgInput   = els.preBg ? parseFloat(els.preBg.value) : NaN;
  const inputUnit = els.preBgUnit ? els.preBgUnit.value : "mmol/L";
  const childUnit = state.child?.glucoseUnit || "mmol/L";
  const bgInChildUnit = Number.isFinite(bgInput)
    ? (childUnit === inputUnit ? bgInput
      : childUnit.includes("mmol") ? mgdl2mmol(bgInput) : mmol2mgdl(bgInput))
    : NaN;

  const upperLimit = childUnit.includes("mmol")
    ? FIXED_MMOL_UPPER : mmol2mgdl(FIXED_MMOL_UPPER);

  let rawCorr = 0;
  if (Number.isFinite(bgInChildUnit) && Number.isFinite(CF) && bgInChildUnit > upperLimit)
    rawCorr = (bgInChildUnit - upperLimit) / CF;

  const step = 0.5;
  if (els.doseCorrection && !state.corrDirty)
    els.doseCorrection.value = fmt(Math.round(rawCorr / step) * step, 1);
  if (els.doseCarbs && !state.carbDirty)
    els.doseCarbs.value = fmt(Math.round(doseCarb / step) * step, 1);

  const finalCorr = parseFloat(els.doseCorrection?.value) || 0;
  const finalCarb = parseFloat(els.doseCarbs?.value)      || 0;
  const finalDose = Math.max(0, finalCorr + finalCarb - state.IOB);
  state.finalDoseVal = Math.round(finalDose / step) * step;
  if (els.doseFinal) els.doseFinal.textContent = fmt(state.finalDoseVal, 1);

  // التنبيهات الذكية
  if (els.smartAlerts) {
    let alertsHtml = "";
    els.smartAlerts.classList.remove("danger");
    if (state.IOB > 0)
      alertsHtml += `<strong>⏳ أنسولين نشط: ${fmt(state.IOB,1)} U</strong> — تم خصمه لتجنب الهبوط.<br>`;
    if (sumFat > 30 || sumPro > 40) {
      els.smartAlerts.classList.add("danger");
      alertsHtml += `<strong>🍕 وجبة دسمة:</strong> دهون/بروتين عالي. السكر سيرتفع متأخراً — يُنصح بتقسيم الجرعة.`;
    }
    // تنبيه لو الكارب أعلى من الهدف
    const t = state.targets[state.slot];
    if (t?.max && sumNet > t.max)
      alertsHtml += `<br><strong>⚠️ الكارب (${fmt(sumNet,1)}g) أعلى من الهدف (${t.max}g)</strong>`;

    els.smartAlerts.innerHTML  = alertsHtml;
    els.smartAlerts.style.display = alertsHtml ? "block" : "none";
  }

  // Progress bar
  const t   = state.targets[state.slot] || {min:0,max:0};
  const max = t.max || 0;
  const pct = max ? clamp((sumNet / max) * 100, 0, 130) : 0;
  if (els.progressBar) {
    els.progressBar.style.width = `${Math.min(pct,100)}%`;
    els.progressBar.style.background =
      pct <= 100 && sumNet >= t.min ? "var(--ok)"
      : pct <= 120 ? "var(--warn)" : "var(--danger)";
  }
}

/* ============================================================
   حفظ الوجبة + القياس تلقائياً
   ============================================================ */
async function saveMeal() {
  if (!state.child) return;

  const id   = `${state.date}_${state.slot}`;
  const mref = doc(db, "parents", state.parentId, "children", state.childId, "meals", id);

  let sumRaw=0, sumNet=0, sumFib=0, sumFat=0, sumPro=0, sumCal=0;
  const items = state.items.map(it => {
    const c = computeRow(it);
    sumRaw+=c.carbsRaw; sumNet+=c.net; sumFib+=c.fiber;
    sumFat+=c.fat; sumPro+=c.protein; sumCal+=c.cal;
    return {
      itemId: it.id, name: it.name,
      unitLabel: it.unitLabel, qty: it.qty,
      gramsComputed: +it.grams.toFixed(0), per100: it.per100
    };
  });

  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const CF = state.CFs[state.slot] ?? state.CF ?? null;

  const payload = {
    createdAt: serverTimestamp(), date: state.date,
    slot: state.slot, slotKey: SLOT_MAP[state.slot], rule: state.rule,
    items,
    totals: {
      carbsRaw: +sumRaw.toFixed(1), carbsNet: +sumNet.toFixed(1),
      fiber: +sumFib.toFixed(1), fat: +sumFat.toFixed(1),
      protein: +sumPro.toFixed(1), calories: Math.round(sumCal)
    },
    doses: {
      final: state.finalDoseVal, IOB: state.IOB, CF, CR,
      correctionDose: parseFloat(els.doseCorrection?.value) || 0,
      carbDose: parseFloat(els.doseCarbs?.value) || 0,
    }
  };

  try {
    await setDoc(mref, payload);

    // ✅ حفظ القياس تلقائياً لو المستخدم أدخل قراءة ولم تكن موجودة
    const bgInput = els.preBg ? parseFloat(els.preBg.value) : NaN;
    if (Number.isFinite(bgInput) && !state.preFetched) {
      setPreStatus("جارِ حفظ القراءة…", "saving");
      const inputUnit   = els.preBgUnit?.value || "mmol/L";
      const value_mmol  = inputUnit === "mmol/L" ? bgInput : mgdl2mmol(bgInput);
      const value_mgdl  = inputUnit === "mg/dL"  ? bgInput : mmol2mgdl(bgInput);
      const childUnit   = state.child.glucoseUnit || "mmol/L";
      const valInChild  = childUnit === inputUnit ? bgInput
        : childUnit.includes("mmol") ? value_mmol : value_mgdl;

      // تحديد حالة السكر
      let stateLabel = "داخل النطاق";
      const nr = state.child.normalRange || {};
      const critHigh = nr.criticalHigh ?? state.child.criticalHigh ?? (childUnit.includes("mmol") ? 14.1 : 254);
      const sevHigh  = nr.severeHigh   ?? (childUnit.includes("mmol") ? 10.9 : 196);
      const upper    = childUnit.includes("mmol") ? FIXED_MMOL_UPPER : mmol2mgdl(FIXED_MMOL_UPPER);
      const lowLim   = nr.min ?? state.child.hypo ?? (childUnit.includes("mmol") ? 3.9 : 70);
      if      (valInChild >= critHigh) stateLabel = "ارتفاع حرج";
      else if (valInChild >= sevHigh)  stateLabel = "ارتفاع شديد";
      else if (valInChild > upper)     stateLabel = "ارتفاع";
      else if (valInChild < lowLim)    stateLabel = "هبوط";

      const preKey  = `PRE_${SLOT_MAP[state.slot]}`;
      const measRef = collection(db, "parents", state.parentId, "children", state.childId, "measurements");
      const [y,m,d] = state.date.split("-");
      const when    = new Date(+y, +m-1, +d, new Date().getHours(), new Date().getMinutes());

      await addDoc(measRef, {
        value: bgInput, unit: inputUnit,
        value_mmol: round1(value_mmol),
        value_mgdl: round1(value_mgdl),
        when, date: state.date,
        slotKey: preKey, slotOrder: 20,
        state: stateLabel,
        correctionDose: parseFloat(els.doseCorrection?.value) || 0,
        notes: `تم التسجيل تلقائياً مع وجبة ${SLOT_LABEL[state.slot]} 🍽️`,
        createdAt: serverTimestamp()
      });
      state.preFetched = true;
      setPreStatus(`✓ تم حفظ القراءة: ${bgInput} ${inputUnit}`, "saved");
    }

    alert("تم حفظ الوجبة بنجاح ✅");
  } catch (e) {
    console.error(e);
    alert("حدث خطأ أثناء الحفظ: " + e.message);
  }
}

/* ============================================================
   القوالب
   ============================================================ */
async function loadTemplates() {
  try {
    const ref  = collection(db, "parents", state.parentId, "presets");
    const snap = await getDocs(ref);
    state.templates = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderTemplates();
    if (els.tplModal) els.tplModal.classList.add("open");
  } catch (e) { console.error("templates load:", e); }
}

function renderTemplates() {
  if (!els.tplList) return;
  els.tplList.innerHTML = "";
  if (!state.templates.length) {
    els.tplList.innerHTML = `<p style="color:#94a3b8;padding:12px">لا توجد قوالب محفوظة.</p>`;
    return;
  }
  for (const tpl of state.templates) {
    const div = document.createElement("div");
    div.className = "tpl-card";
    div.innerHTML = `
      <div class="tpl-title">${tpl.name || "قالب"}</div>
      <div style="font-size:12px;color:#666">${(tpl.items||[]).length} صنف •
        كارب: ${tpl.totals?.carbsNet ?? "—"}g</div>
      <div class="tpl-actions">
        <button class="btn primary btn-load-tpl">تحميل</button>
      </div>`;
    div.querySelector(".btn-load-tpl").onclick = () => {
      state.items = (tpl.items || []).map(it => ({
        ...it, grams: it.gramsComputed || 0
      }));
      state.carbDirty = false;
      renderMeal();
      if (els.tplModal) els.tplModal.classList.remove("open");
    };
    els.tplList.appendChild(div);
  }
}

async function saveTemplate() {
  const name = prompt("اسم القالب:");
  if (!name) return;
  let sumRaw=0, sumNet=0, sumFib=0, sumCal=0;
  const items = state.items.map(it => {
    const c = computeRow(it);
    sumRaw+=c.carbsRaw; sumNet+=c.net; sumFib+=c.fiber; sumCal+=c.cal;
    return { itemId:it.id, name:it.name, unitLabel:it.unitLabel, qty:it.qty, gramsComputed:+it.grams.toFixed(0), per100:it.per100 };
  });
  try {
    await addDoc(collection(db,"parents",state.parentId,"presets"), {
      name, items,
      totals: { carbsRaw:+sumRaw.toFixed(1), carbsNet:+sumNet.toFixed(1), fiber:+sumFib.toFixed(1), calories:Math.round(sumCal) },
      createdAt: serverTimestamp()
    });
    alert("تم حفظ القالب ✅");
  } catch(e) { console.error(e); alert("خطأ في حفظ القالب"); }
}

/* ============================================================
   التهيئة
   ============================================================ */
async function init() {
  try {
    showLoader(true);
    const qp      = new URLSearchParams(location.search);
    state.childId = qp.get("child")    || localStorage.getItem("lastChildId") || null;
    state.parentId= qp.get("parentId") || localStorage.getItem("selectedParentId") || null;
    state.slot    = qp.get("slot")     || "b";
    state.date    = qp.get("date")     || todayStr();

    // لو فيه قراءة PRE ممررة من صفحة القياسات
    const preFromUrl = qp.get("pre");
    const preUnit    = qp.get("preUnit");
    if (preFromUrl && els.preBg) {
      els.preBg.value = preFromUrl;
      if (preUnit && els.preBgUnit) els.preBgUnit.value = preUnit;
      setPreStatus(`✓ قراءة مُمررة من صفحة القياسات: ${preFromUrl} ${preUnit||""}`, "found");
      state.preFetched = true;
    }

    if (els.slotSelect) els.slotSelect.value = state.slot;
    if (els.dateInput)  els.dateInput.value  = state.date;

    if (!state.childId) { alert("لا يوجد طفل في الرابط."); return; }

    const user = await ensureAuth();
    if (!user) { location.href = "index.html"; return; }

    await resolveParentIdIfNeeded(user);
    localStorage.setItem("lastChildId",       state.childId);
    localStorage.setItem("selectedParentId",  state.parentId);

    setBackHref();
    await loadChild();
    await Promise.all([loadFoodLibrary(), calculateIOB()]);

    // جلب القراءة فقط لو مش ممررة من URL
    if (!preFromUrl) await fetchPreMeasurement();

    /* ---- الأحداث ---- */
    if (els.slotSelect) els.slotSelect.addEventListener("change", () => {
      state.slot = els.slotSelect.value;
      setChips();
      fetchPreMeasurement();
    });
    if (els.dateInput) els.dateInput.addEventListener("change", () => {
      state.date = els.dateInput.value;
      state.preFetched = false;
      fetchPreMeasurement();
      calculateIOB();
    });
    if (els.btnFetchPre) els.btnFetchPre.addEventListener("click", () => {
      state.preFetched = false;
      fetchPreMeasurement();
    });
    if (els.preBg) els.preBg.addEventListener("input", () => {
      state.corrDirty  = false;
      state.preFetched = false;
      updateTotals();
    });
    if (els.preBgUnit)    els.preBgUnit.addEventListener("change",    () => { state.corrDirty=false; updateTotals(); });
    if (els.doseCorrection) els.doseCorrection.addEventListener("input", () => { state.corrDirty=true;  updateTotals(); });
    if (els.doseCarbs)    els.doseCarbs.addEventListener("input",    () => { state.carbDirty=true;  updateTotals(); });
    if (els.netCarbRule)  els.netCarbRule.addEventListener("change",  () => { state.rule=els.netCarbRule.value; renderMeal(); });
    if (els.btnClearMeal) els.btnClearMeal.addEventListener("click",  () => { state.items=[]; state.carbDirty=false; renderMeal(); });
    if (els.btnSaveMeal)  els.btnSaveMeal.addEventListener("click",   saveMeal);
    if (els.btnSaveTemplate) els.btnSaveTemplate.addEventListener("click", saveTemplate);
    if (els.btnLoadTemplates) els.btnLoadTemplates.addEventListener("click", loadTemplates);
    if (els.btnOpenLibrary) els.btnOpenLibrary.addEventListener("click", () => {
      if (els.libModal) els.libModal.classList.add("open");
    });
    if (els.libClose) els.libClose.addEventListener("click", () => {
      if (els.libModal) els.libModal.classList.remove("open");
    });
    if (els.searchBox) els.searchBox.addEventListener("input", renderLibrary);

    document.querySelectorAll("[data-close]").forEach(el =>
      el.addEventListener("click", () => {
        if (els.libModal) els.libModal.classList.remove("open");
        if (els.tplModal) els.tplModal.classList.remove("open");
      })
    );

    renderMeal();
  } catch (e) {
    console.error("Init error:", e);
    alert("حدث خطأ في التهيئة: " + e.message);
  } finally {
    showLoader(false);
  }
}

init();
