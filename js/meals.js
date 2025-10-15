// meals.js — Full feature: modal library + search/filters + favorites/disliked + dosing rules
// يعتمد على firebase-config.js (يُصدّر: app, auth, db, storage)

import { app, auth, db, storage as st } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs,
  query, where, limit, Timestamp, collectionGroup
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ================= Helpers ================= */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt     = (n, d = 1) => (n ?? 0).toFixed(d);
const clamp   = (v, a, b) => Math.max(a, Math.min(b, v));
const roundTo = (v, step = 0.5) => Math.round(v / step) * step;
const todayUTC3 = () => { const d = new Date(); const utc = d.getTime() + (d.getTimezoneOffset() * 60000); return new Date(utc + (3 * 3600 * 1000)); };
const ymd = (d) => d.toISOString().slice(0, 10);
const parseQuery = () => Object.fromEntries(new URLSearchParams(location.search).entries());
const normalizeAr = (t) => (t || "").toString()
  .replace(/[ًٌٍَُِّْـ]/g,"")       // تشكيل + تطويل
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ة/g, "ه")
  .replace(/[۰-۹]/g, d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))) // أرقام فارسية
  .replace(/[٠-٩]/g, d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))) // أرقام عربية
  .trim();

const slotMap = {
  b: { ar: "فطار",  defaultTime: "08:00", key: "breakfast" },
  l: { ar: "غداء",  defaultTime: "13:00", key: "lunch"     },
  d: { ar: "عشاء",  defaultTime: "19:00", key: "dinner"    },
  s: { ar: "سناك",  defaultTime: "16:30", key: "snack"     }
};

// Diet labels (مفاتيح ثابتة -> أسماء عرض عربية)
const DIET_LABELS = {
  diabetic_friendly: "صديق لمرضى السكري",
  low_carb: "قليل الكربوهيدرات",
  keto: "كيتو",
  low_gi: "منخفض GI",
  high_fiber: "عالي الألياف",
  gluten_free: "خالي جلوتين",
  vegetarian: "نباتي",
  vegan: "نباتي صارم",
  dairy_free: "خالي الألبان",
  high_protein: "عالي البروتين",
};

/* ================= State ================= */
let user, parentId, childId, slotKey, dateKey, mealTimeStr;
let childDoc, cf, targets, carbRanges, netRuleDefault;
let favorites = [], disliked = [];
let libraryAll = [], library = [], mealItems = [];

/* Modal state */
let modalEl = null;
let modalState = {
  view: "all", // all | fav | ban
  term: "",
  category: "all",
  hideBanned: true,
  favOnly: false,
  dietSelected: new Set(), // selected diet keys
  sortBy: "best", // best | netNear | lowGi | carbHigh | alpha
  pageSize: 60,
  page: 1,
  lazyObs: null,
  allTags: [],
  allCats: [],
  allDiets: Object.keys(DIET_LABELS)
};

/* Image cache (Storage URLs) */
const imgUrlCache = new Map();
const LS_KEY_IMG = "foods_img_cache_v1";

/* ================= UI refs ================= */
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

/* ================= Init ================= */
try { // load cached img urls
  const raw = localStorage.getItem(LS_KEY_IMG);
  if (raw) { const obj = JSON.parse(raw); for (const [k,v] of Object.entries(obj)) imgUrlCache.set(k, v); }
} catch {}

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
    ensureFloatingButton(); // الزر العائم لفتح المكتبة

    // events
    els.slotSelect?.addEventListener("change", onSlotChange);
    els.dateInput?.addEventListener("change", onDateChange);
    els.mealTime?.addEventListener("change", () => (mealTimeStr = els.mealTime.value));
    els.btnFetchPre?.addEventListener("click", fetchPreReading);
    els.preBg?.addEventListener("input", autoCompute);       // حساب التصحيحي عند الكتابة
    els.doseCorrection?.addEventListener("input", autoCompute);
    els.netCarbRule?.addEventListener("change", autoCompute);
    els.doseCarbs?.addEventListener("input", updateDoseTotal);
    els.btnScaleToTarget?.addEventListener("click", scaleToTarget);
    els.btnClearMeal?.addEventListener("click", () => { mealItems = []; renderMeal(); showToast("تم مسح الأصناف"); });
    els.btnSaveMeal?.addEventListener("click", saveMeal);
    els.btnSaveTemplate?.addEventListener("click", saveTemplate);
    els.btnLoadTemplates?.addEventListener("click", importFromTemplates);
    els.btnExportCSV?.addEventListener("click", exportCSV);
    els.btnPrint?.addEventListener("click", () => window.print());
    els.btnSaveFavorites?.addEventListener("click", saveFavs); // (اختياري) زر خارجي

  } catch (e) {
    console.error(e);
    alert(e.message || "تعذّر تهيئة الصفحة.");
  }
});

/* ---------- resolve parentId ---------- */
async function resolveParentId() {
  if (!user) throw new Error("يجب تسجيل الدخول للوصول إلى بيانات الطفل.");

  // Parent
  try { const ref = doc(db, `parents/${user.uid}/children/${childId}`); const snap = await getDoc(ref); if (snap.exists()) return user.uid; } catch {}

  // Doctor with access
  try {
    const qy = query(collectionGroup(db, "children"), where("assignedDoctor", "==", user.uid));
    const snaps = await getDocs(qy);
    for (const s of snaps.docs) if (s.id === childId) return s.ref.parent.parent.id;
  } catch {}

  throw new Error("تعذّر تحديد وليّ الأمر تلقائيًا. مرّر ?parentId= في الرابط.");
}

/* ================= Child & Chips ================= */
async function loadChild() {
  const ref = doc(db, `parents/${parentId}/children/${childId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Child not found.");
  childDoc = snap.data();

  els.childName && (els.childName.textContent = childDoc?.name || "—");

  cf = Number(childDoc?.correctionFactor ?? 0);
  const targetsRaw = childDoc?.normalRange || {};
  targets = { max: targetsRaw.max ?? 7, severeHigh: targetsRaw.severeHigh ?? 10.9, severeLow: targetsRaw.severeLow ?? 3.9 };
  carbRanges = childDoc?.carbTargets || {};
  netRuleDefault = childDoc?.netCarbRule || "fullFiber";
  favorites = Array.isArray(childDoc?.favorites) ? childDoc.favorites : [];
  disliked  = Array.isArray(childDoc?.disliked)  ? childDoc.disliked  : [];

  els.netCarbRule && (els.netCarbRule.value = netRuleDefault);
  els.chipCF && (els.chipCF.textContent = `CF ${cf || "—"} mmol/L per U`);
  els.chipTargets && (els.chipTargets.textContent = `الهدف ${targets.max} | تصحيح من ${targets.severeHigh}`);
  updateCRChip();
  refreshCarbTargetUI();
}
function updateCRChip(){ const ar = slotMap[slotKey]?.ar || ""; const cr = crForSlot(slotKey); els.chipCR && (els.chipCR.textContent = `CR(${ar}) ${cr ?? "—"} g/U`); }
function crForSlot(s){ const fallback = Number(childDoc?.carbRatio ?? 0) || undefined; return Number((childDoc?.carbRatioByMeal || {})?.[s]) || fallback; }
function refreshCarbTargetUI(){
  const slot = slotMap[slotKey]?.key || "lunch";
  const r = carbRanges?.[slot] || {}; const min = Number(r.min ?? 0), max = Number(r.max ?? 0);
  if (els.progressLabel) { const curr = Number(els.sumCarbsNet?.textContent || 0); els.progressLabel.textContent = `Net ${fmt(curr,0)} g — الهدف: ${min || "—"}–${max || "—"} g`; }
}

/* ================= Day totals ================= */
async function loadDayTotals() {
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const snaps = await getDocs(query(mealsRef, where("date", "==", dateKey)));
  let dayCarbs = 0; snaps.forEach(s => dayCarbs += Number(s.data()?.totals?.carbs_net || 0));
  els.dayCarbs && (els.dayCarbs.textContent = fmt(dayCarbs, 0));
}

/* ================= Existing meal ================= */
async function tryLoadExistingMeal() {
  const mealsRef = collection(db, `parents/${parentId}/children/${childId}/meals`);
  const snaps = await getDocs(query(mealsRef, where("date", "==", dateKey), where("slotKey", "==", slotKey), limit(1)));
  if (!snaps.empty) {
    const m = snaps.docs[0].data();
    mealItems = (m.items || []).map(x => ({
      id: x.itemId, name: x.name,
      unitKey: x.unitKey, unitLabel: x.unitLabel,
      gramsPerUnit: Number(x.gramsPerUnit || 1),
      qty: Number(x.qty || 0), grams: Number(x.grams || 0),
      carbs_raw: Number(x.carbs_raw || x.carbs_g || 0),
      fiber_g: Number(x.fiber_g || 0), cal_kcal: Number(x.cal_kcal || 0),
      gi: Number(x.gi ?? 0), gl: Number(x.gl ?? 0), imageUrl: x.imageUrl || ""
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

/* ================= Library data load ================= */
async function loadLibrary() {
  libraryAll = [];
  const coll = collection(db, "admin/global/foodItems");
  const snaps = await getDocs(coll);

  for (const s of snaps.docs) {
    const d = s.data(); const id = s.id;

    // values per 100g (support legacy fields)
    const per100 = d.per100 || {};
    const carbs100 = Number(d.carbs_g ?? per100.carbs ?? 0);
    const fiber100 = Number(d.fiber_g ?? per100.fiber ?? 0);
    const cal100   = Number(d.cal_kcal ?? per100.cal ?? 0);
    const gi       = Number(d.gi ?? per100.gi ?? 0);

    const unitsRaw = d.measures || d.units || [];
    const measures = unitsRaw.map(u => ({ name: u.name || u.label, grams: Number(u.grams) }))
                             .filter(u => u.name && u.grams);
    if (!measures.find(m => m.grams === 1)) measures.unshift({ name:"جم", grams:1 });

    // category + tags
    const category = normalizeAr(d.category || d.group || "");
    const tags = new Set();
    const tagFields = [d.hashtags, d.hashTags, d.dietTags, d.tags, d.altNames];
    tagFields.filter(Boolean).forEach(arr => (Array.isArray(arr) ? arr : Object.values(arr || {}))
      .forEach(t => tags.add(normalizeAr(t))));

    // diet systems
    const dietManual = Array.isArray(d.dietSystemsManual) ? d.dietSystemsManual : [];
    const dietAuto   = Array.isArray(d.dietSystemsAuto)   ? d.dietSystemsAuto   : [];
    const diets = Array.from(new Set([...dietManual, ...dietAuto].filter(k => DIET_LABELS[k])));

    // image (use cache or fetch path if exists)
    let imageUrl = "";
    const cacheKey = `item:${id}`;
    if (imgUrlCache.has(cacheKey)) imageUrl = imgUrlCache.get(cacheKey);
    else if (d.image?.path) {
      try { imageUrl = await getDownloadURL(sRef(st, d.image.path)); imgUrlCache.set(cacheKey, imageUrl); persistImgCache(); } catch {}
    }
    // if no imageUrl -> placeholder used in UI

    libraryAll.push({
      id, name: d.name || d.title || "بدون اسم",
      carbs100, fiber100, cal100, gi,
      measures, imageUrl, category,
      tags: Array.from(tags),
      diets
    });
  }

  modalState.allCats = Array.from(new Set(libraryAll.map(x => x.category).filter(Boolean))).sort();
  modalState.allTags = Array.from(new Set(libraryAll.flatMap(x => x.tags).filter(Boolean))).sort();

  // (اختياري) render fallback grid if exists
  renderLibraryGridFallback();
}
function persistImgCache(){
  try {
    const obj = {}; for (const [k,v] of imgUrlCache.entries()) obj[k]=v;
    localStorage.setItem(LS_KEY_IMG, JSON.stringify(obj));
  } catch {}
}

/* ================= Fallback grid (optional) ================= */
function renderLibraryGridFallback(){
  if (!els.itemsGrid) return;
  const favSet = new Set(favorites), banSet = new Set(disliked);
  library = libraryAll.slice().sort((a,b)=>{
    const ra = favSet.has(a.id)?0:(banSet.has(a.id)?2:1);
    const rb = favSet.has(b.id)?0:(banSet.has(b.id)?2:1);
    if (ra!==rb) return ra-rb; return a.name.localeCompare(b.name,"ar");
  });
  els.itemsGrid.innerHTML = library.map(it => `
    <div class="m-card" data-id="${it.id}">
      <img class="img" src="${it.imageUrl || "images/placeholder.png"}" alt="">
      <div class="ct">
        <div class="row"><div class="grow"><b>${it.name}</b></div></div>
        <div class="row muted">GI: ${it.gi || "—"} • ${fmt(it.carbs100,0)}g كارب/100جم</div>
        <div class="row">
          <button class="btn-add">إضافة +</button>
        </div>
      </div>
    </div>`).join("");
  $$("#itemsGrid .m-card .btn-add").forEach(btn=>{
    const id = btn.closest(".m-card").dataset.id;
    btn.addEventListener("click", ()=> addItemQuick(id));
  });
}
function addItemQuick(id){
  const it = libraryAll.find(x=>x.id===id); if(!it) return;
  const m = it.measures.find(x=>x.grams!==1) || it.measures[0];
  addFromModal(it, Number(m.grams), 1);
}

/* ================= Floating button + Modal ================= */
function ensureFloatingButton(){
  if (document.getElementById("openLibFloating")) return;
  const btn = document.createElement("button");
  btn.id = "openLibFloating"; btn.textContent = "📚 مكتبة الأصناف";
  btn.addEventListener("click", openLibraryModal);
  document.body.appendChild(btn);
}
function openLibraryModal(){ buildLibraryModal(); }
function closeLibraryModal(){ modalEl?.remove(); modalEl = null; modalState.page = 1; }

/* ---------- Modal UI ---------- */
function buildLibraryModal(){
  if (modalEl) modalEl.remove();
  modalEl = document.createElement("div"); modalEl.className = "m-overlay";
  modalEl.innerHTML = `
    <div class="m-box" role="dialog" aria-label="مكتبة الأصناف">
      <div class="m-head">
        <input id="m-search" type="search" placeholder="ابحث بالاسم/الفئة/الوسوم أو #هاشتاج..." />
        <select id="m-cat">
          <option value="all">كل الفئات</option>
          ${modalState.allCats.map(c=>`<option value="${c}">${c}</option>`).join("")}
        </select>
        <select id="m-sort">
          <option value="best">أفضل تطابق</option>
          <option value="netNear">الأقرب للمستهدف Net</option>
          <option value="lowGi">أقل GI</option>
          <option value="carbHigh">أكثر كارب/100g</option>
          <option value="alpha">أبجدي</option>
        </select>
        <div class="m-actions">
          <span id="m-hideban" class="m-chip ${modalState.hideBanned?"on":""}">${modalState.hideBanned?"إخفاء غير المفضلة":"عرض غير المفضلة"}</span>
          <span id="m-favonly" class="m-chip ${modalState.favOnly?"on":""}">المفضلة فقط</span>
        </div>
        <button id="m-close" class="m-close">إغلاق</button>
      </div>

      <div class="m-tabs">
        <span class="m-tab ${modalState.view==="all"?"on":""}" data-v="all">الكل</span>
        <span class="m-tab ${modalState.view==="fav"?"on":""}" data-v="fav">المفضلة</span>
        <span class="m-tab ${modalState.view==="ban"?"on":""}" data-v="ban">غير المفضلة</span>
      </div>

      <div class="m-tags">
        ${modalState.allDiets.map(k => `<span class="m-chip ${modalState.dietSelected.has(k)?"on":""}" data-diet="${k}">${DIET_LABELS[k]}</span>`).join("")}
        ${modalState.allTags.slice(0,40).map(t => `<span class="m-chip" data-tag="${t}">#${t}</span>`).join("")}
      </div>

      <div class="m-body"><div id="m-grid" class="m-grid"></div></div>
      <div class="m-foot">
        <span id="m-count">0 صنف</span>
        <span id="m-more" class="m-link">تحميل المزيد</span>
      </div>
    </div>`;
  document.body.appendChild(modalEl);

  $("#m-close").addEventListener("click", closeLibraryModal);
  modalEl.addEventListener("click", (e)=>{ if(e.target===modalEl) closeLibraryModal(); });

  $("#m-search").value = modalState.term;
  $("#m-search").addEventListener("input", (e)=>{ modalState.term=e.target.value; modalState.page=1; renderModalGrid(); });

  $("#m-cat").value = modalState.category;
  $("#m-cat").addEventListener("change", (e)=>{ modalState.category=e.target.value; modalState.page=1; renderModalGrid(); });

  $("#m-sort").value = modalState.sortBy;
  $("#m-sort").addEventListener("change",(e)=>{ modalState.sortBy=e.target.value; modalState.page=1; renderModalGrid(); });

  $("#m-hideban").addEventListener("click",(e)=>{
    modalState.hideBanned = !modalState.hideBanned;
    e.currentTarget.classList.toggle("on", modalState.hideBanned);
    e.currentTarget.textContent = modalState.hideBanned ? "إخفاء غير المفضلة" : "عرض غير المفضلة";
    renderModalGrid();
  });
  $("#m-favonly").addEventListener("click",(e)=>{
    modalState.favOnly = !modalState.favOnly;
    e.currentTarget.classList.toggle("on", modalState.favOnly);
    modalState.view = "all"; renderModalGrid();
  });

  $$(".m-tab").forEach(t=> t.addEventListener("click", (e)=>{
    modalState.view = e.currentTarget.dataset.v; $$(".m-tab").forEach(x=>x.classList.remove("on")); e.currentTarget.classList.add("on");
    renderModalGrid();
  }));

  $$(".m-tags .m-chip[data-diet]").forEach(chip=>{
    const k = chip.dataset.diet;
    chip.addEventListener("click", ()=>{
      if (modalState.dietSelected.has(k)) modalState.dietSelected.delete(k); else modalState.dietSelected.add(k);
      chip.classList.toggle("on");
      modalState.page = 1; renderModalGrid();
    });
  });
  $$(".m-tags .m-chip[data-tag]").forEach(chip=>{
    const tg = chip.dataset.tag;
    chip.addEventListener("click", ()=>{
      const term = normalizeAr(modalState.term);
      modalState.term = term ? `${term} #${tg}` : `#${tg}`;
      $("#m-search").value = modalState.term;
      modalState.page = 1; renderModalGrid();
    });
  });

  // lazy images per modal body
  modalState.lazyObs?.disconnect();
  modalState.lazyObs = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        const img = e.target; const src = img.dataset.src;
        if (src){ img.src = src; img.removeAttribute("data-src"); }
        modalState.lazyObs.unobserve(img);
      }
    });
  }, { root: $(".m-body") });

  renderModalGrid();
}

/* ---------- Modal filtering & ranking ---------- */
function filterLibraryForModal(){
  const favSet = new Set(favorites), banSet = new Set(disliked);
  const term = normalizeAr(modalState.term);
  const cat = modalState.category;
  const dietsSel = modalState.dietSelected;

  let list = libraryAll.filter(it=>{
    if (modalState.view === "fav" && !favSet.has(it.id)) return false;
    if (modalState.view === "ban" && !banSet.has(it.id)) return false;

    if (modalState.view === "all"){
      if (modalState.favOnly && !favSet.has(it.id)) return false;
      if (modalState.hideBanned && banSet.has(it.id)) return false;
    }

    if (cat!=="all" && it.category !== cat) return false;

    if (dietsSel.size){
      const ok = [...dietsSel].every(k => it.diets?.includes(k));
      if (!ok) return false;
    }

    if (term){
      // support #hashtag search
      const hashtags = term.match(/#[^\s#]+/g) || [];
      const base = term.replace(/#[^\s#]+/g,"").trim();

      const hayName = normalizeAr(it.name);
      const hayCat  = normalizeAr(it.category);
      const hayTags = (it.tags || []).map(normalizeAr);

      let okBase = true;
      if (base){
        okBase = hayName.includes(base) || (hayCat && hayCat.includes(base)) || hayTags.some(t => t.includes(base));
      }

      let okHash = true;
      if (hashtags.length){
        okHash = hashtags.every(h => {
          const tag = normalizeAr(h.replace("#",""));
          return hayTags.includes(tag);
        });
      }

      if (!(okBase && okHash)) return false;
    }

    return true;
  });

  // ranking / sorting
  const slot = slotMap[slotKey]?.key || "lunch";
  const r = carbRanges?.[slot] || {}; const tgtMid = ((Number(r.min||0)+Number(r.max||0))/2)||0;

  const score = (it)=>{
    let s = 0;
    // favorites first
    if (favSet.has(it.id)) s += 50;
    if (banSet.has(it.id)) s -= 50;

    // diet match boost
    if (modalState.dietSelected.size){
      const matches = [...modalState.dietSelected].filter(k => it.diets?.includes(k)).length;
      s += matches * 5;
    }

    // text match weighting
    if (modalState.term){
      const nt = normalizeAr(modalState.term.replace(/#[^\s#]+/g,"").trim());
      const name = normalizeAr(it.name);
      if (nt){
        if (name.startsWith(nt)) s += 15;
        else if (name.includes(nt)) s += 8;
      }
    }

    // closeness to target (rough using carbs/100g)
    if (tgtMid>0){
      const netPer100 = Math.max(0, it.carbs100 - it.fiber100); // Full fiber off for scoring
      const diff = Math.abs(netPer100 - tgtMid);
      s += Math.max(0, 20 - Math.min(diff, 20)); // closer → higher
    }
    return s;
  };

  switch (modalState.sortBy){
    case "best": list.sort((a,b)=> score(b)-score(a)); break;
    case "netNear": list.sort((a,b)=>{
      const net = x=> Math.max(0, x.carbs100 - x.fiber100);
      return Math.abs(net(a)-tgtMid) - Math.abs(net(b)-tgtMid);
    }); break;
    case "lowGi": list.sort((a,b)=>(a.gi||999)-(b.gi||999)); break;
    case "carbHigh": list.sort((a,b)=> (b.carbs100||0)-(a.carbs100||0)); break;
    case "alpha": default: list.sort((a,b)=> a.name.localeCompare(b.name,"ar")); break;
  }

  // bucket order in ALL view (fav -> normal -> banned-at-end)
  if (modalState.view==="all" && !modalState.favOnly && !modalState.hideBanned){
    const favSet = new Set(favorites), banSet = new Set(disliked);
    list.sort((a,b)=>{
      const ra = favSet.has(a.id)?0:(banSet.has(a.id)?2:1);
      const rb = favSet.has(b.id)?0:(banSet.has(b.id)?2:1);
      if (ra!==rb) return ra-rb; return 0;
    });
  }

  return list;
}

/* ---------- Modal render ---------- */
function renderModalGrid(){
  const grid = $("#m-grid"); const countEl = $("#m-count"); const moreEl = $("#m-more");
  const list = filterLibraryForModal(); const total = list.length;
  const end = modalState.page * modalState.pageSize; const shown = list.slice(0, end);

  countEl.textContent = `${total} صنف`;
  moreEl.style.visibility = (end < total) ? "visible" : "hidden";
  moreEl.onclick = ()=> { modalState.page++; renderModalGrid(); };

  grid.innerHTML = shown.map(cardTemplate).join("");

  // bind buttons & lazy images
  shown.forEach(it=>{
    const root = grid.querySelector(`[data-id="${it.id}"]`);
    root.querySelector(".btn-add")?.addEventListener("click", ()=>{
      const select = root.querySelector("select");
      const qtyEl  = root.querySelector("input[type='number']");
      const unitG  = Number(select.value || 1);
      const qty    = Math.max(0, Number(qtyEl.value || 1));
      addFromModal(it, unitG, qty);
    });
    root.querySelector(".fav")?.addEventListener("click", ()=> toggleFav(it.id, root));
    root.querySelector(".ban")?.addEventListener("click", ()=> toggleBan(it.id, root));

    const img = root.querySelector("img[data-src]");
    if (img) modalState.lazyObs.observe(img);
  });
}

function cardTemplate(it){
  const opts = (it.measures?.length ? it.measures : [{name:"جم",grams:1}])
    .map(m => `<option value="${m.grams}">${m.name}</option>`).join("");
  const fav  = favorites.includes(it.id) ? "on" : "";
  const ban  = disliked.includes(it.id)  ? "on" : "";
  const imgAttr = it.imageUrl ? `data-src="${it.imageUrl}"` : `src="images/placeholder.png"`;
  return `
    <div class="m-card" data-id="${it.id}">
      <img class="img" ${imgAttr} alt="">
      <div class="ct">
        <div class="row">
          <div class="grow"><b>${it.name}</b></div>
          <button class="fav ${fav}" title="مفضّل">⭐</button>
          <button class="ban ${ban}" title="غير مفضّل">🚫</button>
        </div>
        <div class="row muted">
          <span>GI: ${it.gi || "—"}</span> •
          <span>${fmt(it.carbs100,0)}g كارب/100جم</span> •
          <span>${it.category || "بدون فئة"}</span>
        </div>
        <div class="row muted">
          ${(it.diets||[]).map(k=>`<span class="m-chip on" style="pointer-events:none">${DIET_LABELS[k]}</span>`).join(" ")}
        </div>
        <div class="row">
          <select>${opts}</select>
          <input type="number" step="0.5" min="0" value="1" style="width:90px"/>
          <button class="btn-add">إضافة +</button>
        </div>
      </div>
    </div>`;
}

/* ================= Items -> table ================= */
function addFromModal(it, unitGrams, qty){
  const grams = unitGrams * qty;
  const carbs_raw = (it.carbs100/100) * grams;
  const fiber_g   = (it.fiber100/100) * grams;
  const cal_kcal  = (it.cal100/100)  * grams;
  const gi = it.gi || 0, gl = gi ? (gi * (carbs_raw/100)) : 0;
  const unit = (it.measures || []).find(m => Number(m.grams)===Number(unitGrams))?.name || "جم";

  mealItems.push({ id: it.id, name: it.name,
    unitKey: unit, unitLabel: unit, gramsPerUnit: unitGrams, qty, grams,
    carbs_raw, fiber_g, cal_kcal, gi, gl, imageUrl: it.imageUrl || ""
  });
  renderMeal(true);
  showToast("تمت الإضافة ✓");
}

function renderMeal(flashLast=false){
  if (!els.mealBody) return;
  els.mealBody.innerHTML = mealItems.map((x,i)=> rowHTML(x,i)).join("");
  mealItems.forEach((x,i)=>{
    $("#u_"+i)?.addEventListener("change", e=> onUnitChange(i, e.target.value));
    $("#q_"+i)?.addEventListener("input",  e=> onQtyChange(i, Number(e.target.value||0)));
    $("#rm_"+i)?.addEventListener("click", ()=> { mealItems.splice(i,1); renderMeal(); showToast("تم الحذف"); });
  });
  if (flashLast && mealItems.length){
    const tr = els.mealBody.lastElementChild; tr?.classList.add("tr-added");
    setTimeout(()=> tr?.classList.remove("tr-added"), 1000);
  }
  autoCompute();
}
function rowHTML(x,i){
  const lib = libraryAll.find(t=>t.id===x.id);
  const opts = (lib?.measures || [{name:"جم",grams:1}])
    .map(m=> `<option value="${m.grams}" ${Number(x.gramsPerUnit)===Number(m.grams)?"selected":""}>${m.name}</option>`).join("");
  return `
    <tr>
      <td><img class="thumb" src="${x.imageUrl || "images/placeholder.png"}" /></td>
      <td class="td-name">${x.name}</td>
      <td><select id="u_${i}">${opts}</select></td>
      <td><input id="q_${i}" type="number" step="0.1" min="0" value="${x.qty}"/></td>
      <td>${fmt(x.grams,0)}</td>
      <td>${fmt(x.carbs_raw,1)}</td>
      <td>${fmt(x.fiber_g,1)}</td>
      <td>${x.gi || "—"}</td>
      <td>${fmt(x.gl,1)}</td>
      <td><button id="rm_${i}" class="ic danger">✖</button></td>
    </tr>`;
}
function onUnitChange(i, gramsPerUnit){ const x = mealItems[i]; x.gramsPerUnit = Number(gramsPerUnit); recalcRow(x); renderMeal(); }
function onQtyChange(i, qty){ const x = mealItems[i]; x.qty = qty; recalcRow(x); renderMeal(); }
function recalcRow(x){
  x.grams = x.qty * x.gramsPerUnit;
  const lib = libraryAll.find(t=>t.id===x.id) || {};
  const carbs100 = lib.carbs100 || 0, fiber100 = lib.fiber100 || 0, cal100 = lib.cal100 || 0, gi = lib.gi || 0;
  x.carbs_raw = (carbs100/100) * x.grams;
  x.fiber_g   = (fiber100/100) * x.grams;
  x.cal_kcal  = (cal100  /100) * x.grams;
  x.gi        = gi;
  x.gl        = gi ? (gi * (x.carbs_raw/100)) : 0;
}

/* ================= Calculations / Dosing ================= */
function autoCompute(){
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
    // هدف التصحيح 7 mmol/L (أو targets.max لو حبيتي تغيّري لاحقًا)
    doseCorr = (bg - Number(targets.max ?? 7)) / cf;
  }
  doseCorr = roundTo(Math.max(0, doseCorr), 0.5);
  els.doseCorrection && (els.doseCorrection.value = doseCorr ? doseCorr.toFixed(1) : "");

  const totalDose = roundTo(doseCarbs + doseCorr, 0.5);

  const slotName = slotMap[slotKey]?.key || "lunch";
  const r = carbRanges?.[slotName] || {}; const min = Number(r.min ?? 0), max = Number(r.max ?? 0);
  const pct = (max>0) ? clamp((carbsNet / max) * 100, 0, 100) : 0;
  if (els.progressBar){ els.progressBar.style.width = `${pct}%`; els.progressBar.className = "bar " + (carbsNet < min ? "warn" : carbsNet > max ? "danger" : "ok"); }
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
function updateDoseTotal(){
  const doseC = Number(els.doseCarbs?.value || 0);
  const doseCorr = Number(els.doseCorrection?.value || 0);
  els.doseTotal && (els.doseTotal.textContent = roundTo(doseC + doseCorr, 0.5).toFixed(1));
}
function slotKeyToName(k){ return k==="b"?"breakfast":k==="l"?"lunch":k==="d"?"dinner":"snack"; }
function scaleToTarget(){
  const slotName = slotMap[slotKey]?.key || "lunch";
  const r = carbRanges?.[slotName] || {}; const tgt = (Number(r.min ?? 0) + Number(r.max ?? 0)) / 2 || 0;
  const curr = Number(els.sumCarbsNet?.textContent || 0); if (!tgt || !curr) return;
  const factor = tgt / curr; mealItems.forEach(x=>{ x.qty = Number((x.qty * factor).toFixed(2)); recalcRow(x); }); renderMeal();
}

/* ================= Measurements ================= */
async function fetchPreReading(){
  const coll = collection(db, `parents/${parentId}/children/${childId}/measurements`);
  const preKey = `PRE_${slotKeyToName(slotKey).toUpperCase()}`;
  const snaps = await getDocs(query(coll, where("slotKey", "==", preKey)));
  let candidates = snaps.docs.map(d => ({ id:d.id, ...d.data() }))
    .filter(x => x.when && ymd(x.when.toDate ? x.when.toDate() : new Date(x.when)) === dateKey);

  if (!candidates.length){
    const mealDate = new Date(dateKey + "T" + (mealTimeStr || "13:00") + ":00");
    const start = new Date(mealDate.getTime() - 90*60000); const end = mealDate;
    const all = await getDocs(coll);
    candidates = all.docs.map(d => ({ id:d.id, ...d.data() }))
      .filter(x => { const t = x.when?.toDate ? x.when.toDate() : (x.when ? new Date(x.when) : null); return t && t >= start && t <= end; });
  }
  if (candidates.length){
    candidates.sort((a,b)=> (a.when?.seconds||0)-(b.when?.seconds||0));
    const last = candidates[candidates.length-1];
    const bg = Number(last.value_mmol ?? last.value ?? 0);
    els.preBg && (els.preBg.value = bg ? bg.toFixed(1) : "");
  }
  autoCompute();
}

/* ================= Date/slot changes ================= */
function onSlotChange(){
  slotKey = els.slotSelect.value; updateCRChip();
  mealTimeStr = slotMap[slotKey]?.defaultTime || "13:00"; els.mealTime && (els.mealTime.value = mealTimeStr);
  refreshCarbTargetUI(); autoCompute();
}
async function onDateChange(){ dateKey = els.dateInput.value; await loadDayTotals(); await tryLoadExistingMeal(); }

/* ================= Save / Templates / Export ================= */
async function saveMeal(){
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
      itemId: x.id, name: x.name, unitKey: x.unitKey, unitLabel: x.unitLabel,
      gramsPerUnit: x.gramsPerUnit, qty: x.qty, grams: x.grams,
      carbs_raw: x.carbs_raw, fiber_g: x.fiber_g, carbs_g: x.carbs_raw, // compat
      cal_kcal: x.cal_kcal, gi: x.gi || null, gl: x.gl || null, imageUrl: x.imageUrl || null
    })),
    updatedAt: Timestamp.now()
  };
  const id = `${dateKey}_${slotKey}`;
  await setDoc(doc(db, `parents/${parentId}/children/${childId}/meals/${id}`), docData, { merge: true });
  showToast("تم حفظ الوجبة ✅");
  await loadDayTotals();
}
async function saveTemplate(){
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
async function importFromTemplates(){
  const coll = collection(db, `parents/${parentId}/children/${childId}/presetMeals`);
  const snaps = await getDocs(coll);
  if (snaps.empty) { alert("لا توجد قوالب محفوظة."); return; }
  let latestDoc = snaps.docs[0];
  snaps.forEach(d => { if ((d.data().createdAt||"") > (latestDoc.data().createdAt||"")) latestDoc = d; });
  const t = latestDoc.data();
  (t.items || []).forEach(it=>{
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
  renderMeal(true);
  showToast("تم الاستيراد من القوالب");
}
function exportCSV(){
  const rows = [
    ["التاريخ", dateKey, "الوجبة", slotMap[slotKey]?.ar || slotKey],
    [],
    ["الصنف","الوحدة","الكمية","جرام","كارب(raw)","ألياف","Net Rule","GI","GL","سعرات"]
  ];
  const rule = els.netCarbRule?.value || "fullFiber";
  mealItems.forEach(x => rows.push([x.name, x.unitLabel, x.qty, x.grams, x.carbs_raw, x.fiber_g, rule, x.gi||"", x.gl||"", x.cal_kcal]));
  rows.push([]); rows.push(["Carbs(raw)", els.sumCarbsRaw?.textContent, "Fiber", els.sumFiber?.textContent, "Net", els.sumCarbsNet?.textContent, "Calories", els.sumCal?.textContent, "GI(avg)", els.sumGI?.textContent, "GL", els.sumGL?.textContent]);
  rows.push(["DoseCarbs", els.doseCarbs?.value, "DoseCorrection", els.doseCorrection?.value, "DoseTotal", els.doseTotal?.textContent]);
  const csv = rows.map(r => r.map(x => `"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"}); const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `meal_${dateKey}_${slotKey}.csv`; a.click(); URL.revokeObjectURL(url);
}

/* ================= Favorites / Disliked ================= */
async function saveFavs(){ await updateDoc(doc(db, `parents/${parentId}/children/${childId}`), { favorites, disliked }); showToast("تم حفظ المفضلة/غير المفضلة ✅"); }
async function toggleFav(id, rootEl){
  const sFav = new Set(favorites); const sBan = new Set(disliked);
  if (sFav.has(id)) sFav.delete(id); else { sFav.add(id); sBan.delete(id); }
  favorites = [...sFav]; disliked = [...sBan];
  await saveFavs();
  if (rootEl){ rootEl.querySelector(".fav")?.classList.toggle("on", sFav.has(id)); rootEl.querySelector(".ban")?.classList.toggle("on", sBan.has(id)); }
  renderModalGrid();
}
async function toggleBan(id, rootEl){
  const sFav = new Set(favorites); const sBan = new Set(disliked);
  if (sBan.has(id)) sBan.delete(id); else { sBan.add(id); sFav.delete(id); }
  favorites = [...sFav]; disliked = [...sBan];
  await saveFavs();
  if (rootEl){ rootEl.querySelector(".fav")?.classList.toggle("on", sFav.has(id)); rootEl.querySelector(".ban")?.classList.toggle("on", sBan.has(id)); }
  renderModalGrid();
}

/* ================= Toast helper ================= */
let toastTimer=null;
function showToast(msg){
  let t = document.querySelector(".toast");
  if (!t){ t = document.createElement("div"); t.className="toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> t.classList.remove("show"), 1800);
}
