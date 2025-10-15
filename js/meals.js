// /js/meals.js  — Meals + Modal Library (Firebase 12.1.0)

import { app, auth, db, storage as st } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs,
  query, where, limit, Timestamp, collectionGroup
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------------- Helpers ---------------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt     = (n, d = 1) => (n ?? 0).toFixed(d);
const clamp   = (v, a, b) => Math.max(a, Math.min(b, v));
const roundTo = (v, step = 0.5) => Math.round(v / step) * step;
const todayUTC3 = () => {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (3 * 3600 * 1000)); // UTC+3
};
const ymd = (d) => d.toISOString().slice(0, 10);
const parseQuery = () => Object.fromEntries(new URLSearchParams(location.search).entries());
const normalizeAr = (t) => (t || "").toString()
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ة/g, "ه").trim();

const slotMap = {
  b: { ar: "فطار",  defaultTime: "08:00", key: "breakfast" },
  l: { ar: "غداء",  defaultTime: "13:00", key: "lunch"     },
  d: { ar: "عشاء",  defaultTime: "19:00", key: "dinner"    },
  s: { ar: "سناك",  defaultTime: "16:30", key: "snack"     }
};

/* ---------------- State ---------------- */
let user, parentId, childId, slotKey, dateKey, mealTimeStr;
let childDoc, cf, targets, carbRanges, netRuleDefault;
let favorites = [], disliked = [];
let libraryAll = [], library = [], mealItems = [];

/* Modal State */
let modalEl = null, modalState = {
  term: "",
  category: "all",
  tagsSelected: new Set(),
  favOnly: false,
  hideBanned: true,
  pageSize: 60,
  page: 1,
  lazyObs: null,
  allTags: [],
  allCats: []
};

/* ---------------- UI refs ---------------- */
const els = {
  childName: $("#childName"),
  chipCF: $("#chipCF"),
  chipCR: $("#chipCR"),
  chipTargets: $("#chipTargets"),
  dateInput: $("#dateInput"),
  slotSelect: $("#slotSelect"),
  mealTime: $("#mealTime"),
  preBg: $("#preBg"),
  btnFetchPre: $("#btnFetchPre"),
  doseCorrection: $("#doseCorrection"),
  netCarbRule: $("#netCarbRule"),
  doseCarbs: $("#doseCarbs"),
  doseTotal: $("#doseTotal"),
  dayCarbs: $("#dayCarbs"),
  itemsGrid: $("#itemsGrid"),
  itemsCount: $("#itemsCount"),
  mealBody: $("#mealBody"),
  progressBar: $("#progressBar"),
  progressLabel: $("#progressLabel"),
  btnScaleToTarget: $("#btnScaleToTarget"),
  btnClearMeal: $("#btnClearMeal"),
  btnSaveMeal: $("#btnSaveMeal"),
  btnSaveTemplate: $("#btnSaveTemplate"),
  btnLoadTemplates: $("#btnLoadTemplates"),
  btnExportCSV: $("#btnExportCSV"),
  btnPrint: $("#btnPrint"),
  btnSaveFavorites: $("#btnSaveFavorites"),
  backToChild: $("#backToChild"),
};

/* ---------------- Init ---------------- */
onAuthStateChanged(auth, async (u) => {
  const q = parseQuery();
  childId  = q.childId || q.child;
  slotKey  = (q.slot || "l").toLowerCase();
  dateKey  = q.date || ymd(todayUTC3());
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";

  if (!childId) { alert("يلزم تمرير child (معرّف الطفل) في الرابط."); return; }

  els.dateInput && (els.dateInput.value = dateKey);
  els.slotSelect && (els.slotSelect.value = slotKey);
  els.mealTime && (els.mealTime.value = mealTimeStr);
  if (els.backToChild) els.backToChild.href = `child.html?child=${childId}`;

  try {
    user = u;
    parentId = q.parentId || null;

    if (!parentId) parentId = await resolveParentId();

    await loadChild();
    await loadLibrary();
    await loadDayTotals();
    await tryLoadExistingMeal();
    autoCompute();
    ensureFloatingButton(); // زر مكتبة الأصناف العائم
    injectModalStyles();    // CSS للنافذة

    // events
    els.slotSelect?.addEventListener("change", onSlotChange);
    els.dateInput?.addEventListener("change", onDateChange);
    els.mealTime?.addEventListener("change", () => (mealTimeStr = els.mealTime.value));
    els.btnFetchPre?.addEventListener("click", fetchPreReading);
    els.doseCorrection?.addEventListener("input", autoCompute);
    els.netCarbRule?.addEventListener("change", autoCompute);
    els.doseCarbs?.addEventListener("input", updateDoseTotal);
    els.preBg?.addEventListener("input", autoCompute); // حساب التصحيحي بمجرد الكتابة
    els.btnScaleToTarget?.addEventListener("click", scaleToTarget);
    els.btnClearMeal?.addEventListener("click", () => { mealItems = []; renderMeal(); });
    els.btnSaveMeal?.addEventListener("click", saveMeal);
    els.btnSaveTemplate?.addEventListener("click", saveTemplate);
    els.btnLoadTemplates?.addEventListener("click", importFromTemplates);
    els.btnExportCSV?.addEventListener("click", exportCSV);
    els.btnPrint?.addEventListener("click", () => window.print());
    els.btnSaveFavorites?.addEventListener("click", saveFavs);

  } catch (e) {
    console.error(e);
    alert(e.message || "تعذّر تهيئة الصفحة.");
  }
});

/* --------- resolve parentId ---------- */
async function resolveParentId() {
  if (!user) throw new Error("يجب تسجيل الدخول للوصول إلى بيانات الطفل.");

  // Parent
  try {
    const ref = doc(db, `parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(ref);
    if (snap.exists()) return user.uid;
  } catch {}

  // Doctor
  try {
    const qy = query(collectionGroup(db, "children"), where("assignedDoctor", "==", user.uid));
    const snaps = await getDocs(qy);
    for (const s of snaps.docs) {
      if (s.id === childId) return s.ref.parent.parent.id;
    }
  } catch {}

  throw new Error("تعذّر تحديد وليّ الأمر تلقائيًا. مرّر ?parentId= في الرابط.");
}

/* ---------------- Child + chips ---------------- */
async function loadChild() {
  const ref = doc(db, `parents/${parentId}/children/${childId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Child not found.");
  childDoc = snap.data();

  els.childName && (els.childName.textContent = childDoc?.name || "—");

  cf = Number(childDoc?.correctionFactor ?? 0);
  const targetsRaw = childDoc?.normalRange || {};
  targets = {
    max: targetsRaw.max ?? 7,
    severeHigh: targetsRaw.severeHigh ?? 10.9,
    severeLow: targetsRaw.severeLow ?? 3.9
  };
  carbRanges = childDoc?.carbTargets || {};
  netRuleDefault = childDoc?.netCarbRule || "fullFiber";
  favorites = Array.isArray(childDoc?.favorites) ? childDoc.favorites : [];
  disliked  = Array.isArray(childDoc?.disliked)  ? childDoc.disliked  : [];

  if (els.netCarbRule) els.netCarbRule.value = netRuleDefault;
  if (els.chipCF) els.chipCF.textContent = `CF ${cf || "—"} mmol/L per U`;
  if (els.chipTargets) els.chipTargets.textContent = `الهدف ${targets.max} | تصحيح من ${targets.severeHigh}`;
  updateCRChip();
  refreshCarbTargetUI();
}
function updateCRChip() {
  const ar = slotMap[slotKey]?.ar || "";
  const cr = crForSlot(slotKey);
  if (els.chipCR) els.chipCR.textContent = `CR(${ar}) ${cr ?? "—"} g/U`;
}
function crForSlot(s) {
  const fallback = Number(childDoc?.carbRatio ?? 0) || undefined;
  return Number((childDoc?.carbRatioByMeal || {})?.[s]) || fallback; // b/l/d/s
}
function refreshCarbTargetUI() {
  const slot = slotMap[slotKey]?.key || "lunch";
  const r = carbRanges?.[slot] || {};
  const min = Number(r.min ?? 0), max = Number(r.max ?? 0);
  if (els.progressLabel) {
    const curr = Number(els.sumCarbsNet?.textContent || 0);
    els.progressLabel.textContent = `Net ${fmt(curr, 0)} g — الهدف: ${min || "—"}–${max || "—"} g`;
  }
}

/* ---------------- Day totals ---------------- */
async function loadDayTotals() {
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const snaps = await getDocs(query(mealsRef, where("date", "==", dateKey)));
  let dayCarbs = 0;
  snaps.forEach(s => dayCarbs += Number(s.data()?.totals?.carbs_net || 0));
  if (els.dayCarbs) els.dayCarbs.textContent = fmt(dayCarbs, 0);
}

/* ---------------- Existing meal ---------------- */
async function tryLoadExistingMeal() {
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const snaps = await getDocs(query(mealsRef, where("date", "==", dateKey), where("slotKey", "==", slotKey), limit(1)));
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
    els.preBg && (els.preBg.value = m.preBg_mmol ?? "");
    els.doseCorrection && (els.doseCorrection.value = m.doseCorrection ?? "");
    els.doseCarbs && (els.doseCarbs.value = m.doseCarbs ?? "");
    els.netCarbRule && (els.netCarbRule.value = m.netCarbRuleUsed || netRuleDefault);
  } else {
    await fetchPreReading();
  }
  renderMeal();
}

/* ---------------- Library (data) ---------------- */
async function loadLibrary() {
  libraryAll = [];
  const coll = collection(db, "admin/global/foodItems");
  const snaps = await getDocs(coll);

  for (const s of snaps.docs) {
    const d  = s.data(); const id = s.id;

    const per100   = d.per100 || {};
    const carbs100 = Number(d.carbs_g ?? per100.carbs ?? 0);
    const fiber100 = Number(d.fiber_g ?? per100.fiber ?? 0);
    const cal100   = Number(d.cal_kcal ?? per100.cal ?? 0);
    const gi       = Number(d.gi ?? per100.gi ?? 0);

    const unitsRaw = d.units || d.measures || [];
    const measures = unitsRaw.map(u => ({ name: u.label || u.name, grams: Number(u.grams) }))
                             .filter(u => u.name && u.grams);
    if (!measures.find(m => m.grams === 1)) measures.unshift({ name: "جم", grams: 1 });

    // صور Lazy: لا نطلب إلا لو فيه path
    let imageUrl = "";
    const imgPath = d.image?.path;
    if (imgPath) {
      try { imageUrl = await getDownloadURL(sRef(st, imgPath)); } catch {}
    }

    // وسوم/فئات (مرنة مع الحقول الموجودة)
    const tags = new Set();
    const tagFields = [d.hashTags, d.dietTags, d.dietTagsAuto, d.dietSystems, d.dietSystemsAuto, d.dietTagsManual];
    tagFields.filter(Boolean).forEach(arr => (Array.isArray(arr) ? arr : Object.values(arr || {}))
      .forEach(t => tags.add(normalizeAr(t))));
    const category = normalizeAr(d.category || d.group || "");

    libraryAll.push({
      id, name: d.name || d.title || "بدون اسم",
      carbs100, fiber100, cal100, gi,
      measures, imageUrl,
      category, tags: Array.from(tags)
    });
  }

  // جهزي فلاتر المودال
  modalState.allCats = Array.from(new Set(libraryAll.map(x => x.category).filter(Boolean))).sort();
  modalState.allTags = Array.from(new Set(libraryAll.flatMap(x => x.tags).filter(Boolean))).sort();

  // لو عندك Grid ثابتة في الصفحة سيظل يعمل، لكن الأساس الآن المودال
  renderLibraryGridFallback();
}

/* ---------------- Fallback grid (اختياري) ---------------- */
function renderLibraryGridFallback() {
  if (!els.itemsGrid) return; // ما فيش Grid في HTML؛ معتمدين على المودال
  const favSet = new Set(favorites), disSet = new Set(disliked);
  library = libraryAll.slice().sort((a, b) => {
    const ra = favSet.has(a.id) ? 0 : (disSet.has(a.id) ? 2 : 1);
    const rb = favSet.has(b.id) ? 0 : (disSet.has(b.id) ? 2 : 1);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, "ar");
  });
  els.itemsGrid.innerHTML = library.map(it => `
    <div class="card-item" data-id="${it.id}">
      <img src="${it.imageUrl || "images/placeholder.png"}" alt="">
      <div class="meta">
        <div class="name">${it.name}</div>
        <div class="sub">GI: ${it.gi || "—"} • ${fmt(it.carbs100,0)}g كارب/100جم</div>
      </div>
      <div class="actions">
        <button class="btn add">إضافة</button>
      </div>
    </div>`).join("");
  $$("#itemsGrid .card-item .add").forEach((btn, i) => {
    const id = btn.closest(".card-item").dataset.id;
    btn.addEventListener("click", () => addItemQuick(id));
  });
}
function addItemQuick(id) {
  const it = libraryAll.find(x => x.id === id); if (!it) return;
  const m = it.measures.find(x => x.grams !== 1) || it.measures[0];
  const gramsPerUnit = Number(m.grams), qty = 1, grams = qty * gramsPerUnit;
  const carbs_raw = (it.carbs100/100) * grams, fiber_g = (it.fiber100/100) * grams, cal_kcal = (it.cal100/100) * grams;
  const gi = it.gi || 0, gl = gi ? (gi * (carbs_raw / 100)) : 0;
  mealItems.push({ id: it.id, name: it.name, unitKey: m.name, unitLabel: m.name, gramsPerUnit, qty, grams, carbs_raw, fiber_g, cal_kcal, gi, gl, imageUrl: it.imageUrl });
  renderMeal();
}

/* ---------------- Floating open button ---------------- */
function ensureFloatingButton() {
  if (document.getElementById("openLibFloating")) return;
  const btn = document.createElement("button");
  btn.id = "openLibFloating";
  btn.textContent = "📚 مكتبة الأصناف";
  Object.assign(btn.style, {
    position: "fixed", insetInlineStart: "16px", insetBlockEnd: "16px",
    zIndex: 9999, padding: "10px 14px", borderRadius: "12px",
    border: "0", background: "#5b6cff", color: "#fff",
    boxShadow: "0 6px 16px rgba(0,0,0,.15)", cursor: "pointer"
  });
  btn.addEventListener("click", openLibraryModal);
  document.body.appendChild(btn);
}

/* ---------------- Modal (UI) ---------------- */
function injectModalStyles() {
  if (document.getElementById("meals-modal-style")) return;
  const css = `
  .m-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9998}
  .m-box{width:min(1000px,92vw);max-height:85vh;background:#fff;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 36px rgba(0,0,0,.2)}
  .m-head{padding:12px 16px;border-bottom:1px solid #eee;display:grid;grid-template-columns:1fr 160px 1fr auto;gap:8px;align-items:center}
  .m-head input[type="search"]{padding:10px 12px;border:1px solid #ddd;border-radius:10px}
  .m-head select{padding:10px;border:1px solid #ddd;border-radius:10px;background:#fff}
  .m-head .m-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
  .m-chip{padding:4px 10px;border:1px solid #ddd;border-radius:999px;cursor:pointer;user-select:none}
  .m-chip.on{background:#eef0ff;border-color:#5b6cff;color:#1f2dff}
  .m-tags{display:flex;flex-wrap:wrap;gap:8px;padding:10px;border-bottom:1px solid #eee}
  .m-body{padding:12px;overflow:auto}
  .m-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media (max-width:900px){.m-grid{grid-template-columns:repeat(2,1fr)}}
  @media (max-width:600px){.m-grid{grid-template-columns:1fr}}
  .m-card{border:1px solid #eee;border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
  .m-card .img{aspect-ratio:4/3;background:#fafafa;display:block;width:100%;object-fit:cover}
  .m-card .ct{padding:8px 10px;display:flex;flex-direction:column;gap:6px}
  .m-card .row{display:flex;gap:8px;align-items:center}
  .m-card .row .grow{flex:1}
  .m-card select,.m-card input{padding:8px;border:1px solid #ddd;border-radius:8px;background:#fff;width:100%}
  .m-card button{padding:8px 10px;border:0;border-radius:8px;background:#5b6cff;color:#fff;cursor:pointer}
  .m-foot{padding:10px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
  .m-link{color:#5b6cff;cursor:pointer}
  .m-close{background:#eee;color:#333}
  `;
  const style = document.createElement("style");
  style.id = "meals-modal-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function buildLibraryModal() {
  if (modalEl) modalEl.remove();
  modalEl = document.createElement("div");
  modalEl.className = "m-overlay";
  modalEl.innerHTML = `
    <div class="m-box" role="dialog" aria-label="مكتبة الأصناف">
      <div class="m-head">
        <input id="m-search" type="search" placeholder="ابحث بالاسم/الوسم/الفئة..." />
        <select id="m-cat">
          <option value="all">كل الفئات</option>
          ${modalState.allCats.map(c => `<option value="${c}">${c}</option>`).join("")}
        </select>
        <div class="m-actions">
          <span id="m-fav" class="m-chip">المفضلة فقط</span>
          <span id="m-ban" class="m-chip on">إخفاء غير المفضلة</span>
        </div>
        <button id="m-close" class="m-close">إغلاق</button>
      </div>
      <div class="m-tags">
        ${modalState.allTags.map(t => `<span class="m-chip" data-tag="${t}">#${t}</span>`).join("")}
      </div>
      <div class="m-body">
        <div id="m-grid" class="m-grid"></div>
      </div>
      <div class="m-foot">
        <span id="m-count">0 صنف</span>
        <span id="m-more" class="m-link">تحميل المزيد</span>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  $("#m-close").addEventListener("click", closeLibraryModal);
  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeLibraryModal(); });

  // Events
  $("#m-search").value = modalState.term;
  $("#m-search").addEventListener("input", (e) => { modalState.term = e.target.value; modalState.page = 1; renderModalGrid(); });

  $("#m-cat").value = modalState.category;
  $("#m-cat").addEventListener("change", (e) => { modalState.category = e.target.value; modalState.page = 1; renderModalGrid(); });

  $("#m-fav").classList.toggle("on", modalState.favOnly);
  $("#m-fav").addEventListener("click", (e) => {
    modalState.favOnly = !modalState.favOnly;
    e.currentTarget.classList.toggle("on", modalState.favOnly);
    modalState.page = 1; renderModalGrid();
  });

  $("#m-ban").classList.toggle("on", modalState.hideBanned);
  $("#m-ban").addEventListener("click", (e) => {
    modalState.hideBanned = !modalState.hideBanned;
    e.currentTarget.classList.toggle("on", modalState.hideBanned);
    modalState.page = 1; renderModalGrid();
  });

  $$(".m-tags .m-chip").forEach(chip => {
    const tag = chip.dataset.tag;
    chip.classList.toggle("on", modalState.tagsSelected.has(tag));
    chip.addEventListener("click", () => {
      if (modalState.tagsSelected.has(tag)) modalState.tagsSelected.delete(tag);
      else modalState.tagsSelected.add(tag);
      chip.classList.toggle("on");
      modalState.page = 1; renderModalGrid();
    });
  });

  // Lazy images
  modalState.lazyObs?.disconnect();
  modalState.lazyObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const img = e.target;
        const src = img.dataset.src;
        if (src) { img.src = src; img.removeAttribute("data-src"); }
        modalState.lazyObs.unobserve(img);
      }
    });
  }, { root: $(".m-body") });

  renderModalGrid();
}
function openLibraryModal() { buildLibraryModal(); }
function closeLibraryModal() { modalEl?.remove(); modalEl = null; modalState.page = 1; }

/* ---------------- Modal filtering & rendering ---------------- */
function filterLibraryForModal() {
  const favSet = new Set(favorites);
  const banSet = new Set(disliked);
  const term = normalizeAr(modalState.term);
  const c = modalState.category;

  let res = libraryAll.filter(it => {
    if (modalState.favOnly && !favSet.has(it.id)) return false;
    if (modalState.hideBanned && banSet.has(it.id)) return false;
    if (c !== "all" && it.category !== c) return false;
    if (modalState.tagsSelected.size) {
      const hasAll = [...modalState.tagsSelected].every(t => it.tags.includes(t));
      if (!hasAll) return false;
    }
    if (term) {
      const nameOk = normalizeAr(it.name).includes(term);
      const catOk  = it.category && normalizeAr(it.category).includes(term);
      const tagOk  = it.tags && it.tags.some(t => normalizeAr(t).includes(term));
      if (!(nameOk || catOk || tagOk)) return false;
    }
    return true;
  });

  // فرز: المفضلة أولاً، ثم غير المفضلة العادية، ثم المحظورة (لو ظاهرين)
  res.sort((a, b) => {
    const fa = favSet.has(a.id) ? 0 : (banSet.has(a.id) ? 2 : 1);
    const fb = favSet.has(b.id) ? 0 : (banSet.has(b.id) ? 2 : 1);
    if (fa !== fb) return fa - fb;
    return a.name.localeCompare(b.name, "ar");
  });

  return res;
}

function renderModalGrid() {
  const grid = $("#m-grid"); const countEl = $("#m-count"); const moreEl = $("#m-more");
  const list = filterLibraryForModal();
  const total = list.length;
  const end = modalState.page * modalState.pageSize;
  const shown = list.slice(0, end);

  countEl.textContent = `${total} صنف`;
  moreEl.style.visibility = (end < total) ? "visible" : "hidden";
  moreEl.onclick = () => { modalState.page++; renderModalGrid(); };

  grid.innerHTML = shown.map(cardTemplate).join("");

  // bind buttons & lazy images
  shown.forEach(it => {
    const root = grid.querySelector(`[data-id="${it.id}"]`);
    root.querySelector(".fav")?.addEventListener("click", () => { toggleFav(it.id); renderModalGrid(); });
    root.querySelector(".ban")?.addEventListener("click", () => { toggleBan(it.id); renderModalGrid(); });
    root.querySelector(".add")?.addEventListener("click", () => {
      const select = root.querySelector("select");
      const qtyEl  = root.querySelector("input[type='number']");
      const unitG  = Number(select.value || 1);
      const qty    = Math.max(0, Number(qtyEl.value || 1));
      addFromModal(it, unitG, qty);
    });
    // lazy
    const img = root.querySelector("img[data-src]");
    if (img) modalState.lazyObs.observe(img);
  });
}

function cardTemplate(it) {
  // default unit: أول measure
  const opts = (it.measures?.length ? it.measures : [{name:"جم",grams:1}])
    .map(m => `<option value="${m.grams}">${m.name}</option>`).join("");
  const fav  = favorites.includes(it.id) ? "on" : "";
  const ban  = disliked.includes(it.id)  ? "on" : "";
  const imgAttr = it.imageUrl ? `data-src="${it.imageUrl}"` : `src="images/placeholder.png"`;
  return `
    <div class="m-card" data-id="${it.id}">
      <img class="img" ${imgAttr} alt="">
      <div class="ct">
        <div class="row"><div class="grow"><b>${it.name}</b></div>
          <button class="m-chip fav ${fav}" title="مفضّل">⭐</button>
          <button class="m-chip ban ${ban}" title="غير مفضّل">🚫</button>
        </div>
        <div class="row" style="opacity:.8;font-size:.9rem">
          <span>GI: ${it.gi || "—"}</span> •
          <span>${fmt(it.carbs100,0)}g كارب/100جم</span> •
          <span>${it.category || "بدون فئة"}</span>
        </div>
        <div class="row">
          <select>${opts}</select>
          <input type="number" step="0.5" min="0" value="1" style="width:90px"/>
          <button class="add">إضافة</button>
        </div>
      </div>
    </div>`;
}

function addFromModal(it, unitGrams, qty) {
  const grams = unitGrams * qty;
  const carbs_raw = (it.carbs100/100) * grams;
  const fiber_g   = (it.fiber100/100) * grams;
  const cal_kcal  = (it.cal100/100)  * grams;
  const gi = it.gi || 0, gl = gi ? (gi * (carbs_raw/100)) : 0;
  // نحاول إيجاد اسم الوحدة من القياسات
  const unit = (it.measures || []).find(m => Number(m.grams) === Number(unitGrams))?.name || "جم";
  mealItems.push({
    id: it.id, name: it.name,
    unitKey: unit, unitLabel: unit,
    gramsPerUnit: unitGrams, qty, grams,
    carbs_raw, fiber_g, cal_kcal, gi, gl, imageUrl: it.imageUrl || ""
  });
  renderMeal();
}

/* ---------------- Meal table ---------------- */
function renderMeal() {
  if (!els.mealBody) return;
  els.mealBody.innerHTML = mealItems.map((x, i) => rowHTML(x, i)).join("");
  mealItems.forEach((x, i) => {
    $("#u_"+i)?.addEventListener("change", e => onUnitChange(i, e.target.value));
    $("#q_"+i)?.addEventListener("input",  e => onQtyChange(i, Number(e.target.value||0)));
    $("#rm_"+i)?.addEventListener("click", () => { mealItems.splice(i,1); renderMeal(); });
  });
  autoCompute();
}
function rowHTML(x, i) {
  const lib = libraryAll.find(t => t.id === x.id);
  const opts = (lib?.measures || [{name:"جم", grams:1}])
    .map(m => `<option value="${m.grams}" ${Number(x.gramsPerUnit)===Number(m.grams)?"selected":""}>${m.name}</option>`).join("");
  return `
  <tr>
    <td><img class="thumb" src="${x.imageUrl || "images/placeholder.png"}" /></td>
    <td class="td-name">${x.name}</td>
    <td><select id="u_${i}">${opts}</select></td>
    <td><input id="q_${i}" type="number" step="0.1" value="${x.qty}"/></td>
    <td>${fmt(x.grams,0)}</td>
    <td>${fmt(x.carbs_raw,1)}</td>
    <td>${fmt(x.fiber_g,1)}</td>
    <td>${x.gi || "—"}</td>
    <td>${fmt(x.gl,1)}</td>
    <td><button id="rm_${i}" class="ic danger">✖</button></td>
  </tr>`;
}
function onUnitChange(i, gramsPerUnit) { const x = mealItems[i]; x.gramsPerUnit = Number(gramsPerUnit); recalcRow(x); renderMeal(); }
function onQtyChange(i, qty)        { const x = mealItems[i]; x.qty = qty; recalcRow(x); renderMeal(); }
function recalcRow(x) {
  x.grams = x.qty * x.gramsPerUnit;
  const lib = libraryAll.find(t => t.id === x.id) || {};
  const carbs100 = lib.carbs100 || 0, fiber100 = lib.fiber100 || 0, cal100 = lib.cal100 || 0, gi = lib.gi || 0;
  x.carbs_raw = (carbs100/100) * x.grams;
  x.fiber_g   = (fiber100/100) * x.grams;
  x.cal_kcal  = (cal100  /100) * x.grams;
  x.gi        = gi;
  x.gl        = gi ? (gi * (x.carbs_raw / 100)) : 0;
}

/* ---------------- Calculations ---------------- */
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

  const bg = Number(els.preBg?.value || 0);
  let doseCorr = Number(els.doseCorrection?.value || 0);
  if (bg && bg > Number(targets.severeHigh ?? 10.9) && cf) {
    doseCorr = (bg - Number(targets.max ?? 7)) / cf; // هدف 7
  }
  doseCorr = roundTo(Math.max(0, doseCorr), 0.5);
  if (els.doseCorrection) els.doseCorrection.value = doseCorr ? doseCorr.toFixed(1) : "";

  const totalDose = roundTo(doseCarbs + doseCorr, 0.5);

  const slotName = slotMap[slotKey]?.key || "lunch";
  const r = carbRanges?.[slotName] || {};
  const min = Number(r.min ?? 0), max = Number(r.max ?? 0);
  let pct = 0; if (max > 0) pct = clamp((carbsNet / max) * 100, 0, 100);
  if (els.progressBar) {
    els.progressBar.style.width = `${pct}%`;
    els.progressBar.className = "bar " + (carbsNet < min ? "warn" : carbsNet > max ? "danger" : "ok");
  }
  if (els.progressLabel) els.progressLabel.textContent = `Net ${fmt(carbsNet,0)} g — الهدف: ${min || "—"}–${max || "—"} g`;

  els.sumCarbsRaw && (els.sumCarbsRaw.textContent = fmt(carbsRaw,1));
  els.sumFiber    && (els.sumFiber.textContent    = fmt(fiber,1));
  els.sumCarbsNet && (els.sumCarbsNet.textContent = fmt(carbsNet,1));
  els.sumCal      && (els.sumCal.textContent      = fmt(cal,0));
  els.sumGL       && (els.sumGL.textContent       = fmt(glTotal,1));
  els.sumGI       && (els.sumGI.textContent       = giAvg ? fmt(giAvg,0) : "—");

  els.doseCarbs && (els.doseCarbs.value = doseCarbs ? doseCarbs.toFixed(1) : "");
  els.doseTotal && (els.doseTotal.textContent = totalDose ? totalDose.toFixed(1) : "—");
}

function updateDoseTotal() {
  const doseC = Number(els.doseCarbs?.value || 0);
  const doseCorr = Number(els.doseCorrection?.value || 0);
  els.doseTotal && (els.doseTotal.textContent = roundTo(doseC + doseCorr, 0.5).toFixed(1));
}
function slotKeyToName(k) { return k==="b"?"breakfast":k==="l"?"lunch":k==="d"?"dinner":"snack"; }

function scaleToTarget() {
  const slotName = slotMap[slotKey]?.key || "lunch";
  const r = carbRanges?.[slotName] || {};
  const tgt = (Number(r.min ?? 0) + Number(r.max ?? 0)) / 2 || 0;
  const curr = Number(els.sumCarbsNet?.textContent || 0);
  if (!tgt || !curr) return;
  const factor = tgt / curr;
  mealItems.forEach(x => { x.qty = Number((x.qty * factor).toFixed(2)); recalcRow(x); });
  renderMeal();
}

/* ---------------- Measurements ---------------- */
async function fetchPreReading() {
  const coll = collection(db, `parents/${parentId}/children/${childId}/measurements`);
  const preKey = `PRE_${slotKeyToName(slotKey).toUpperCase()}`;
  const snaps = await getDocs(query(coll, where("slotKey", "==", preKey)));
  let candidates = snaps.docs.map(d => ({ id:d.id, ...d.data() }))
    .filter(x => x.when && ymd(x.when.toDate ? x.when.toDate() : new Date(x.when)) === dateKey);

  if (!candidates.length) {
    const mealDate = new Date(dateKey + "T" + (mealTimeStr || "13:00") + ":00");
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
    els.preBg && (els.preBg.value = bg ? bg.toFixed(1) : "");
  }
  autoCompute();
}

/* ---------------- Date/slot changes ---------------- */
function onSlotChange() {
  slotKey = els.slotSelect.value;
  updateCRChip();
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00";
  els.mealTime && (els.mealTime.value = mealTimeStr);
  refreshCarbTargetUI();
  autoCompute();
}
async function onDateChange() {
  dateKey = els.dateInput.value;
  await loadDayTotals();
  await tryLoadExistingMeal();
}

/* ---------------- Save/Export ---------------- */
async function saveMeal() {
  const docData = {
    date: dateKey, slotKey, type: slotMap[slotKey]?.ar || "",
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
      gi_avg: (els.sumGI?.textContent === "—") ? null : Number(els.sumGI?.textContent || 0),
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
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/meals/${id}`), docData, { merge: true });
  alert("تم حفظ الوجبة ✅");
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
  alert("تم حفظ القالب ✅");
}
async function importFromTemplates() {
  const coll = collection(db, `parents/${parentId}/children/${childId}/presetMeals`);
  const snaps = await getDocs(coll);
  if (snaps.empty) { alert("لا توجد قوالب محفوظة."); return; }
  let latestDoc = snaps.docs[0];
  snaps.forEach(d => { if ((d.data().createdAt||"") > (latestDoc.data().createdAt||"")) latestDoc = d; });
  const t = latestDoc.data();
  (t.items || []).forEach(it => {
    const lib = libraryAll.find(x => x.id === (it.itemId || it.id)); if (!lib) return;
    const grams = Number(it.grams || 0);
    const qty = grams && lib.measures[0] ? (grams / (lib.measures[0].grams || 1)) : 1;
    const carbs_raw = (lib.carbs100/100) * grams, fiber_g = (lib.fiber100/100) * grams, cal_kcal = (lib.cal100/100) * grams;
    const gi = lib.gi || 0, gl = gi ? gi * (carbs_raw/100) : 0;
    mealItems.push({
      id: lib.id, name: lib.name, unitKey: lib.measures[0].name, unitLabel: lib.measures[0].name,
      gramsPerUnit: lib.measures[0].grams, qty, grams, carbs_raw, fiber_g, cal_kcal, gi, gl, imageUrl: lib.imageUrl
    });
  });
  renderMeal();
}
async function saveFavs() {
  await updateDoc(doc(db, `parents/${parentId}/children/${childId}`), { favorites, disliked });
  alert("تم حفظ المفضلة/غير المفضلة ✅");
}
function exportCSV() {
  const rows = [
    ["التاريخ", dateKey, "الوجبة", slotMap[slotKey]?.ar || slotKey],
    [],
    ["الصنف","الوحدة","الكمية","جرام","كارب(raw)","ألياف","Net Rule","GI","GL","سعرات"]
  ];
  const rule = els.netCarbRule?.value || "fullFiber";
  mealItems.forEach(x => rows.push([x.name, x.unitLabel, x.qty, x.grams, x.carbs_raw, x.fiber_g, rule, x.gi||"", x.gl||"", x.cal_kcal]));
  rows.push([]);
  rows.push(["Carbs(raw)", els.sumCarbsRaw?.textContent, "Fiber", els.sumFiber?.textContent, "Net", els.sumCarbsNet?.textContent, "Calories", els.sumCal?.textContent, "GI(avg)", els.sumGI?.textContent, "GL", els.sumGL?.textContent]);
  rows.push(["DoseCarbs", els.doseCarbs?.value, "DoseCorrection", els.doseCorrection?.value, "DoseTotal", els.doseTotal?.textContent]);
  const csv = rows.map(r => r.map(x => `"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `meal_${dateKey}_${slotKey}.csv`; a.click(); URL.revokeObjectURL(url);
}

/* ---------------- Fav/Ban helpers ---------------- */
function toggleFav(id)  { const s = new Set(favorites); s.has(id) ? s.delete(id) : s.add(id); favorites = [...s]; }
function toggleBan(id)  { const s = new Set(disliked);  s.has(id) ? s.delete(id) : s.add(id); disliked  = [...s]; }
