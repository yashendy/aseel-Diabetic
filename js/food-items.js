/* eslint-disable no-alert */
/* ===== التهيئة الموحدة (v12.1.0) ===== */
import { auth, db, storage } from "./firebase-config.js";

/* ===== Firebase v12.1.0 ===== */
import {
  collection, query, where, orderBy, limit, startAfter, getDocs,
  addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  ref as sRef, uploadBytesResumable, getDownloadURL, uploadBytes
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* ========= DOM helpers ========= */
const $ = (id)=> document.getElementById(id);
const on = (el, ev, cb, name)=>{ if(el) el.addEventListener(ev, cb); else console.warn(`[UI] عنصر مفقود: ${name}`); };
const num = (x)=> (x===null||x===undefined||x==="") ? null : Number(x);

/* عناصر الصفحة */
const els = {
  search: $("search"),
  fCategory: $("filter-category"),
  fDiet: $("filter-diet"),
  fActive: $("filter-active"),
  btnClear: $("btn-clear"),
  cards: $("cards"),
  tableWrap: $("table-wrap"),
  tableBody: $("table-body"),
  btnAdd: $("btn-add"),
  btnCards: $("btn-cards"),
  btnTable: $("btn-table"),
  prev: $("prev"),
  next: $("next"),
  pageLabel: $("page-label"),

  dlg: $("edit-dialog"),
  dlgClose: $("dlg-close"),
  dlgTitle: $("dlg-title"),
  form: $("edit-form"),
  id: $("item-id"),
  name: $("name"),
  category: $("category"),
  isActive: $("isActive"),

  // وسوم
  searchTags: $("searchTags"),
  dietChips: $("diet-chips"),
  autoTags: $("auto-tags"), // (غير مستخدم الآن)

  // مقادير
  measuresList: $("measures-list"),
  addMeasure: $("add-measure"),

  // تغذية
  cal_kcal: $("cal_kcal"),
  carbs_g: $("carbs_g"),
  protein_g: $("protein_g"),
  fat_g: $("fat_g"),
  fiber_g: $("fiber_g"),
  sodium_mg: $("sodium_mg"),

  // صورة
  imageUrl: $("image-url"),
  imageFile: $("image-file"),
  uploadBtn: $("btn-upload"),
  progress: $("upload-progress"),
  preview: $("preview"),
  btnDelete: $("delete"),

  // Auth UI
  adminName: $("admin-name"),
  adminRole: $("admin-role"),
  btnAuth: $("btn-auth"),

  btnAi: $("btn-ai-tags"),
};

/* ========= State ========= */
let user = null;
let isAdmin = false;
let paging = { page: 1, pageSize: 20, lastDoc: null };
let currentQuerySnapshot = null;

/* ========= Gate Overlay ========= */
const gate = (()=> {
  let el = document.getElementById("admin-gate");
  if (!el) {
    el = document.createElement("div");
    el.id = "admin-gate";
    el.style.cssText = "position:fixed;inset:0;display:none;z-index:9999;align-items:center;justify-content:center;background:rgba(24,31,55,.35);backdrop-filter:blur(2px)";
    el.innerHTML = `
      <div style="background:#fff;border:1px solid #e6ecf5;border-radius:16px;box-shadow:0 20px 60px rgba(27,35,48,.18);padding:20px;max-width:520px;width:92%;">
        <h3 style="margin:0 0 8px;font-weight:800;color:#1b2330">صلاحيات الوصول</h3>
        <p id="gate-msg" style="margin:0 0 12px;color:#4b5875">هذه الصفحة مخصصة للمشرفين (Admins) فقط.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="gate-close" class="btn light" style="padding:8px 12px">إغلاق</button>
          <button id="gate-auth" class="btn primary" style="padding:8px 12px">تسجيل الدخول</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    on(el.querySelector("#gate-close"), "click", ()=> el.style.display = "none", "gate-close");
    on(el.querySelector("#gate-auth"), "click", async ()=> { await signIn(); }, "gate-auth");
  }
  return {
    show(msg){ const p = document.getElementById("gate-msg"); if(p) p.textContent = msg || "هذه الصفحة للمشرفين فقط."; el.style.display = "flex"; },
    hide(){ el.style.display = "none"; }
  };
})();

/* ========= Utils ========= */
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

/* تطبيع أنظمة غذائية من العربي -> أكواد */
const DIET_MAP = {
  "منخفض gi": "lowGi",
  "منخفض_gi": "lowGi",
  "قليل الجلايسيميا": "lowGi",
  "صديق لمرضى السكري": "lowGi",
  "بدون جلوتين": "glutenFree",
  "بدون ألبان": "dairyFree",
  "نباتي": "vegan",
  "كيتو": "keto"
};
function normalizeDiet(value){
  if(!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map(v=> String(v).trim().toLowerCase())
           .map(v=> DIET_MAP[v] || v)
           .filter(Boolean);
}

/* Diet chips UI */
const DIET_LABELS = [
  {code:"lowGi",      label:"#منخفض_GI"},
  {code:"glutenFree", label:"#بدون_جلوتين"},
  {code:"dairyFree",  label:"#بدون_ألبان"},
  {code:"vegan",      label:"#نباتي"},
  {code:"keto",       label:"#كيتو"}
];
function renderDietChips(selected=[]){
  if(!els.dietChips) return;
  els.dietChips.innerHTML="";
  const set = new Set(selected);
  DIET_LABELS.forEach(d=>{
    const chip = document.createElement("span");
    chip.className = "chip" + (set.has(d.code) ? " active" : "");
    chip.textContent = d.label;
    chip.onclick = ()=> chip.classList.toggle("active");
    chip.dataset.code = d.code;
    els.dietChips.appendChild(chip);
  });
}
function getDietCodesFromChips(){
  return Array.from(document.querySelectorAll("#diet-chips .chip.active")).map(x=>x.dataset.code);
}

/* نص البحث */
function toSearchText(item){
  const tagsText = [
    item.searchTags || "",
    Array.isArray(item.tags) ? item.tags.join(" ") : (item.tags || ""),
    (item.dietTagsAuto || []).join(" "),
    (item.dietTagsManual || []).join(" ")
  ].filter(Boolean).join(" ");
  const diet = (item.dietSystems || []).map(s=>`#${s}`).join(" ");
  return [item.name || "", item.category || "", tagsText, diet].join(" ").toLowerCase();
}

/* ========= Auth ========= */
async function signIn(){
  try{ await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch(e){ console.warn("Sign-in canceled/failed", e.message); }
}
on(els.btnAuth, "click", async ()=>{
  if(auth.currentUser) await signOut(auth); else await signIn();
}, "btn-auth");

async function loadMyProfile(u){
  if(!u) return {role:null, data:null};
  try{
    const snap = await getDoc(doc(db, "users", u.uid));
    const data = snap.exists() ? snap.data() : null;
    const role = data?.role || null;
    return {role, data};
  }catch(e){
    console.warn("users/{uid} read failed", e.message);
    return {role:null, data:null};
  }
}
function setAdminBadge(u, profile, roleText){
  if(!$("admin-name")) return;
  const name = (profile && (profile.displayName || profile.name))
    || u?.displayName || (u?.email||"").split("@")[0] || "مستخدم";
  $("admin-name").textContent = name;
  if($("admin-role")) $("admin-role").textContent = roleText || "";
  if(els.btnAuth) els.btnAuth.textContent = u ? "تسجيل الخروج" : "تسجيل الدخول";
}

/* ========= Measures ========= */
const MEASURE_PRESETS = [
  { name: "ملعقة", grams: 5 },
  { name: "كوب",   grams: 240 },
  { name: "طبق",   grams: 150 },
  { name: "حبة",   grams: 80 },
];
function renderMeasuresEditor(data){
  if(!els.measuresList) return;
  els.measuresList.innerHTML = "";
  const current = Array.isArray(data?.measures) ? data.measures
    : (data?.measureQty && typeof data.measureQty==='object')
      ? Object.entries(data.measureQty).map(([name,grams])=>({name,grams:Number(grams)||0}))
      : [];
  function addRow(init={name:"",grams:""}){
    const row = document.createElement("div");
    row.className = "measure-row";
    row.innerHTML = `
      <div style="display:flex;gap:8px">
        <input class="m-name" placeholder="اسم المقدار" value="${init.name||""}">
        <select class="m-preset" title="اختيار سريع">
          <option value="">—</option>
          ${MEASURE_PRESETS.map(p=>`<option value="${p.name}|${p.grams}">${p.name}</option>`).join("")}
        </select>
      </div>
      <input class="m-grams" type="number" min="0" step="1" placeholder="جم" value="${init.grams??""}">
      <button type="button" class="btn light m-del">حذف</button>
    `;
    row.querySelector(".m-preset").addEventListener("change", e=>{
      const [n,g] = (e.target.value||"").split("|"); if(n) row.querySelector(".m-name").value = n; if(g) row.querySelector(".m-grams").value = g;
    });
    row.querySelector(".m-del").onclick = ()=> row.remove();
    els.measuresList.appendChild(row);
  }
  if(current.length){ current.forEach(addRow); } else { addRow({}); }
  on(els.addMeasure, "click", ()=> addRow({}), "add-measure");
}
function readMeasuresFromForm(){
  return Array.from(document.querySelectorAll("#measures-list .measure-row")).map(r=>{
    const name = r.querySelector(".m-name")?.value?.trim() || "";
    const grams = Number(r.querySelector(".m-grams")?.value);
    return { name, grams: Number.isFinite(grams)? grams : 0 };
  }).filter(m=> m.name && m.grams>0);
}

/* ========= Nutrition ========= */
function pickNutrition(raw){
  const n = raw.nutrPer100g || {};
  const v = (k)=> raw[k] ?? n[k];
  return {
    cal_kcal:  num(v("cal_kcal")),
    carbs_g:   num(v("carbs_g")),
    protein_g: num(v("protein_g")),
    fat_g:     num(v("fat_g")),
    fiber_g:   num(v("fiber_g")),
    sodium_mg: num(v("sodium_mg"))
  };
}
function readNutritionFromForm(){
  return {
    cal_kcal:  num(els.cal_kcal.value),
    carbs_g:   num(els.carbs_g.value),
    protein_g: num(els.protein_g.value),
    fat_g:     num(els.fat_g.value),
    fiber_g:   num(els.fiber_g.value),
    sodium_mg: num(els.sodium_mg.value)
  };
}
function fillNutritionForm(n){
  els.cal_kcal.value  = n.cal_kcal  ?? "";
  els.carbs_g.value   = n.carbs_g   ?? "";
  els.protein_g.value = n.protein_g ?? "";
  els.fat_g.value     = n.fat_g     ?? "";
  els.fiber_g.value   = n.fiber_g   ?? "";
  els.sodium_mg.value = n.sodium_mg ?? "";
}
function nutritionLine(n){
  const parts=[];
  if(n.cal_kcal!=null) parts.push(`${n.cal_kcal} kcal`);
  if(n.carbs_g !=null) parts.push(`كربوهيدرات ${n.carbs_g} جم`);
  if(n.protein_g!=null) parts.push(`بروتين ${n.protein_g} جم`);
  if(n.fat_g    !=null) parts.push(`دهون ${n.fat_g} جم`);
  return parts.join(" · ");
}

/* ========= AI Tags (قواعد بسيطة) ========= */
function aiSuggestTags(n){
  const search = new Set();
  const diets  = new Set();

  if (n.carbs_g != null) {
    if (n.carbs_g <= 15) diets.add("lowGi");
    if (n.carbs_g >= 40) search.add("نشويات_عالية");
  }
  if (n.fiber_g != null) {
    if (n.fiber_g >= 4) search.add("غني_بالألياف");
  }
  if (n.fat_g != null) {
    if (n.fat_g <= 3) search.add("قليل_الدهون");
    if (n.fat_g >= 17) search.add("دهون_مرتفعة");
  }
  if (n.protein_g != null && n.protein_g >= 10) {
    search.add("غني_بالبروتين");
  }
  if (n.sodium_mg != null && n.sodium_mg >= 400) {
    search.add("صوديوم_مرتفع");
  }
  return {
    searchTags: Array.from(search).join(" "),
    dietSystemsAuto: Array.from(diets)
  };
}
on(els.btnAi, "click", ()=>{
  const s = aiSuggestTags(readNutritionFromForm());
  const cur = (els.searchTags.value||"").trim();
  els.searchTags.value = [cur, s.searchTags].filter(Boolean).join(" ").trim();
  renderDietChips([...new Set([...getDietCodesFromChips(), ...s.dietSystemsAuto])]);
});

/* ========= مصادر البيانات ========= */
const colNew    = collection(db, "fooditems");
const colLegacy = collection(db, "admin", "global", "foodItems");

/* توحيد عنصر */
function normalizeItem(raw, id){
  const diet = [
    ...normalizeDiet(raw.dietSystems),
    ...normalizeDiet(raw.dietSystemsAuto),
    ...normalizeDiet(raw.dietSystemsManual),
  ];
  const tags = Array.isArray(raw.tags) ? raw.tags
               : (raw.tags ? String(raw.tags).split(" ") : []);
  const nutr = pickNutrition(raw);
  const measures = Array.isArray(raw.measures) ? raw.measures
    : (raw.measureQty && typeof raw.measureQty === "object")
      ? Object.entries(raw.measureQty).map(([name,grams])=>({name, grams:Number(grams)||0}))
      : [];

  const item = {
    id,
    name: raw.name || raw.title || raw.name_ar || "",
    category: raw.category || "أخرى",
    isActive: (raw.isActive !== undefined) ? !!raw.isActive : true,
    imageUrl: raw.imageUrl || raw.photoUrl || "",

    // وسوم
    tags,
    searchTags: raw.searchText || raw.searchTags || "",
    dietTagsAuto: raw.dietTagsAuto || [],
    dietTagsManual: raw.dietTagsManual || [],
    dietSystems: Array.from(new Set(diet)),

    // تغذية
    ...nutr,

    // مقادير
    measures,
    measureQty: Object.fromEntries(measures.map(m=>[m.name, m.grams])),
  };
  item.searchText = toSearchText(item);
  return item;
}

/* ========= CRUD ========= */
async function createOrUpdate(e){
  e.preventDefault();
  if(!isAdmin){ gate.show("هذه العملية متاحة للأدمن فقط."); return; }

  const nutr = readNutritionFromForm();
  const payload = {
    name: (els.name.value||"").trim(),
    category: els.category.value,
    isActive: !!els.isActive.checked,
    imageUrl: (els.imageUrl.value||"").trim(),

    // وسوم
    searchTags: (els.searchTags.value||"").trim(),
    dietSystems: getDietCodesFromChips(),

    // مقادير
    measures: readMeasuresFromForm(),
    measureQty: {},

    // تغذية (مسطحة + nested للتوافق)
    cal_kcal: nutr.cal_kcal,
    carbs_g: nutr.carbs_g,
    protein_g: nutr.protein_g,
    fat_g: nutr.fat_g,
    fiber_g: nutr.fiber_g,
    sodium_mg: nutr.sodium_mg,
    nutrPer100g: { ...nutr },

    updatedAt: serverTimestamp(),
  };
  payload.measureQty = Object.fromEntries(payload.measures.map(m=>[m.name, m.grams]));
  payload.searchText = toSearchText(payload);

  const id = els.id.value;
  if(id) await updateDoc(doc(db, "fooditems", id), payload);
  else   await addDoc(colNew, { ...payload, createdAt: serverTimestamp() });

  closeDialog(); await fetchAndRender(true);
}
async function removeItem(){
  if(!isAdmin){ gate.show("هذه العملية متاحة للأدمن فقط."); return; }
  const id = els.id.value; if(!id) return;
  if(!confirm("تأكيد حذف الصنف؟")) return;
  await deleteDoc(doc(db, "fooditems", id));
  closeDialog(); await fetchAndRender(true);
}

/* ========= بناء الاستعلام (للجديدة فقط) ========= */
function buildQueryNew(){
  const filters=[];
  if(els.fActive?.checked) filters.push(where("isActive","==",true));
  if(els.fCategory?.value) filters.push(where("category","==",els.fCategory.value));
  if(els.fDiet?.value)     filters.push(where("dietSystems","array-contains",els.fDiet.value));
  return query(colNew, ...filters, orderBy("name"), limit(paging.pageSize));
}

/* ========= جلب ودمج ========= */
async function fetchAndRender(reset=false){
  if(!els.cards || !els.tableBody) return;
  els.cards.innerHTML=""; els.tableBody.innerHTML="";

  if(reset){ paging.page=1; paging.lastDoc=null; currentQuerySnapshot=null; }
  // 1) الجديدة بفلاتر Firestore
  let q = buildQueryNew(); if(paging.lastDoc) q = query(q, startAfter(paging.lastDoc));
  const snapNew = await getDocs(q);
  currentQuerySnapshot = snapNew;
  paging.lastDoc = snapNew.docs[snapNew.docs.length-1] || null;

  // 2) القديمة (بدون فلاتر، نفلتر client-side)
  const snapOld = await getDocs(colLegacy);

  let items = [
    ...snapOld.docs.map(d=> normalizeItem(d.data(), d.id)),
    ...snapNew.docs.map(d=> normalizeItem(d.data(), d.id))
  ];

  // فلترة client-side
  const qText = (els.search?.value||"").trim().toLowerCase();
  const onlyActive = !!els.fActive?.checked;
  const cat = els.fCategory?.value || "";
  const dietSel = els.fDiet?.value || "";

  if(onlyActive) items = items.filter(i=> i.isActive !== false);
  if(cat)        items = items.filter(i=> (i.category||"") === cat);
  if(dietSel)    items = items.filter(i=> (i.dietSystems||[]).includes(dietSel));
  if(qText)      items = items.filter(i=> (i.searchText||toSearchText(i)).includes(qText));

  // ترتيب
  items.sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"));

  if(els.pageLabel) els.pageLabel.textContent = `صفحة ${paging.page}`;
  if(els.prev) els.prev.disabled = paging.page<=1;
  if(els.next) els.next.disabled = snapNew.size < paging.pageSize;

  renderCards(items);
  renderTable(items);

  if(!items.length){
    const empty=document.createElement("div");
    empty.className="card";
    empty.style.cssText="padding:16px;text-align:center";
    empty.textContent="لا توجد نتائج مطابقة.";
    els.cards.appendChild(empty);
  }
}

/* ========= العرض ========= */
function renderCards(items){
  if(!els.cards) return;
  const frag=document.createDocumentFragment();
  items.forEach(item=>{
    const card=document.createElement("div"); card.className="card card-item";
    const thumb=document.createElement("div"); thumb.className="thumb";
    const img=document.createElement("img"); img.src=item.imageUrl||""; img.alt=item.name||""; thumb.appendChild(img);
    const name=document.createElement("h3"); name.className="name"; name.textContent=item.name;
    const meta=document.createElement("div"); meta.className="meta";
    meta.innerHTML=`<span>${item.category||"-"}</span><span>${item.isActive===false?"موقوف ⛔":"نشط ✅"}</span>`;
    const nutrEl = document.createElement("div"); nutrEl.className="muted"; nutrEl.style.marginTop="6px"; nutrEl.textContent = nutritionLine(item);
    const chips=document.createElement("div"); chips.className="chips";
    (item.measures||[]).slice(0,3).forEach(m=>{ const c=document.createElement("span"); c.className="chip"; c.textContent=`${m.name}: ${m.grams}جم`; chips.appendChild(c); });

    const actions=document.createElement("div"); actions.style.display="flex"; actions.style.gap="8px";
    const editBtn=document.createElement("button"); editBtn.className="btn light"; editBtn.textContent="تعديل"; editBtn.onclick=()=>openDialog(item);
    actions.appendChild(editBtn);

    card.append(thumb, name, meta, nutrEl, chips, actions);
    frag.appendChild(card);
  });
  els.cards.appendChild(frag);
}
function renderTable(items){
  if(!els.tableBody) return;
  const frag=document.createDocumentFragment();
  items.forEach(item=>{
    const tr=document.createElement("tr");
    const tdImg=document.createElement("td"); tdImg.innerHTML=`<img src="${item.imageUrl||""}" alt="" style="width:60px;height:40px;object-fit:cover;border-radius:8px;border:1px solid #e6ecf5">`;
    const tdName=document.createElement("td"); tdName.textContent=item.name;
    const tdCat=document.createElement("td"); tdCat.textContent=item.category||"-";
    const tdAct=document.createElement("td"); tdAct.textContent=item.isActive===false?"—":"✓";
    const tdNut=document.createElement("td"); tdNut.textContent = nutritionLine(item);
    const tdMeas=document.createElement("td"); tdMeas.textContent=(item.measures||[]).map(m=>`${m.name}:${m.grams}جم`).join("، ");
    const tdOps=document.createElement("td"); const eb=document.createElement("button"); eb.className="btn light"; eb.textContent="تعديل"; eb.onclick=()=>openDialog(item); tdOps.appendChild(eb);
    tr.append(tdImg, tdName, tdCat, tdAct, tdNut, tdMeas, tdOps);
    frag.appendChild(tr);
  });
  els.tableBody.appendChild(frag);
}

/* ========= Dialog ========= */
function openDialog(data){
  if(!isAdmin){ gate.show("هذه الصفحة للمديرين فقط."); return; }
  els.dlgTitle.textContent = data?.id ? "تعديل صنف" : "إضافة صنف";
  els.id.value = data?.id || "";
  els.name.value = data?.name || "";
  els.category.value = data?.category || "";
  els.isActive.checked = data?.isActive !== false;

  // وسوم
  els.searchTags.value = data?.searchTags || (Array.isArray(data?.tags) ? data.tags.join(" ") : (data?.tags||""));
  renderDietChips(data?.dietSystems || []);

  // مقادير
  renderMeasuresEditor(data || {});

  // تغذية
  fillNutritionForm({
    cal_kcal:  data?.cal_kcal,
    carbs_g:   data?.carbs_g,
    protein_g: data?.protein_g,
    fat_g:     data?.fat_g,
    fiber_g:   data?.fiber_g,
    sodium_mg: data?.sodium_mg
  });

  // صورة
  els.imageUrl.value = data?.imageUrl || "";
  els.preview.src = els.imageUrl.value || "";

  ensureUpload();
  if(els.btnDelete) els.btnDelete.hidden = !data?.id;
  els.dlg?.showModal();
}
function closeDialog(){ els.dlg?.close(); }

/* ========= UI Listeners ========= */
[["search","input"], ["filter-category","input"], ["filter-diet","input"]].forEach(([id,ev])=>{
  on($(id), ev, ()=> fetchAndRender(true), id);
});
on($("filter-active"), "change", ()=> fetchAndRender(true), "filter-active");
on($("btn-clear"), "click", ()=>{
  if(els.search) els.search.value = "";
  if(els.fCategory) els.fCategory.value = "";
  if(els.fDiet) els.fDiet.value = "";
  if(els.fActive) els.fActive.checked = true;
  fetchAndRender(true);
}, "btn-clear");
on($("btn-add"), "click", ()=> openDialog(null), "btn-add");
on($("dlg-close"), "click", closeDialog, "dlg-close");
on($("edit-form"), "submit", createOrUpdate, "edit-form");
on($("delete"), "click", removeItem, "delete");
on($("btn-cards"), "click", ()=>{
  $("btn-cards")?.classList.add("active"); $("btn-table")?.classList.remove("active");
  if(els.cards) els.cards.hidden = false; if(els.tableWrap) els.tableWrap.hidden = true;
}, "btn-cards");
on($("btn-table"), "click", ()=>{
  $("btn-table")?.classList.add("active"); $("btn-cards")?.classList.remove("active");
  if(els.cards) els.cards.hidden = true; if(els.tableWrap) els.tableWrap.hidden = false;
}, "btn-table");
on($("prev"), "click", async ()=>{ if(paging.page<=1) return; paging.page-=1; await fetchAndRender(true); }, "prev");
on($("next"), "click", async ()=>{ if(!currentQuerySnapshot || currentQuerySnapshot.size<paging.pageSize) return; paging.page+=1; await fetchAndRender(false); }, "next");

/* ========= Upload (مع إعادة تلقائية) ========= */
function humanizeStorageError(err){
  const msg = err?.message || "";
  if (msg.includes("storage/retry-limit-exceeded")) return "تعذّر رفع الصورة: فشل الاتصال (انقطاع أو حظر متصفح). جرّبي مجددًا أو افتحي الصفحة بمتصفح آخر.";
  if (msg.includes("app-check")) return "App Check يمنع الوصول. عطّلي Enforce مؤقتًا أو فعّلي Web Recaptcha.";
  if (msg.includes("storage/unauthorized")) return "لا تملكين صلاحية الرفع لهذا المسار.";
  if (msg.includes("storage/canceled")) return "تم إلغاء الرفع.";
  return "تعذّر رفع الصورة: " + msg;
}
function ensureUpload(){
  if(!els.uploadBtn) return;
  els.uploadBtn.onclick = async ()=>{
    if(!user){ gate.show("سجّلي الدخول أولًا لرفع الصور."); return; }
    if(!isAdmin){ gate.show("الرفع متاح للأدمن فقط."); return; }
    const file = els.imageFile?.files?.[0];
    if(!file){ alert("اختاري ملف صورة أولًا"); return; }

    const safe = file.name.replace(/[^\w.\-]+/g,"_");
    const path = `food-items/${user.uid}/${Date.now()}-${safe}`;
    const ref = sRef(storage, path);

    // نحاول resumable، ولو فشل بسبب CORS/شبكة نجرب uploadBytes كبديل سريع
    try {
      if(els.progress) els.progress.value = 0;
      await new Promise((resolve, reject)=>{
        const task = uploadBytesResumable(ref, file, { contentType: file.type });
        task.on("state_changed", (snap)=>{
          if(els.progress) els.progress.value = Math.round((snap.bytesTransferred/snap.totalBytes)*100);
        }, reject, ()=> resolve());
      });
      const url = await getDownloadURL(ref);
      els.imageUrl.value = url; els.preview.src = url;
      if(els.progress) els.progress.value = 100;
    } catch (e1) {
      console.warn("Resumable upload failed, fallback to uploadBytes", e1);
      try {
        await uploadBytes(ref, file, { contentType: file.type });
        const url = await getDownloadURL(ref);
        els.imageUrl.value = url; els.preview.src = url;
        if(els.progress) els.progress.value = 100;
      } catch (e2) {
        alert(humanizeStorageError(e2));
      }
    }
  };
  if(els.imageUrl && els.preview){
    els.imageUrl.addEventListener("input", ()=> els.preview.src = els.imageUrl.value.trim() || "");
  }
}

/* ========= Boot ========= */
onAuthStateChanged(auth, async (u)=>{
  user = u || null;
  const {role, data} = await loadMyProfile(user);
  isAdmin = role === "admin";
  setAdminBadge(user, data, isAdmin ? "admin" : (role||""));

  if(!user){ gate.show("سجّلي الدخول لمتابعة العمل على صفحة الأصناف."); return; }
  if(!isAdmin){ gate.show("صلاحيات غير كافية. هذه الصفحة للمشرفين فقط."); return; }

  gate.hide();
  ensureUpload();
  await fetchAndRender(true);
});
