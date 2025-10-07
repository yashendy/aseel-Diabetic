// js/food-items.js  — كل منطق الصفحة + تهيئة Firebase داخل الملف

// ============ Firebase SDK via CDN ============
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy,
  limit, startAfter, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.1/firebase-storage.js";

// --------- Firebase Config (استخدمي قيم مشروعك) ---------
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ============ Constants / State ============
const COLL_PATH = ["admin","global","foodItems"];
const PAGE_SIZE = 20;

const state = {
  page: 1,
  lastDoc: null,
  q: "",
  category: "",
  dietSystem: "",
  onlyActive: true,
  sortBy: "createdAt_desc",
  cache: new Map(),
  currentDocs: [],
  view: "cards"
};

// ============ Utils ============
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const toNum = v => (v==="" || v==null) ? null : Number(v);
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// وسوم غذائية تلقائية
function autoDietTags({ gi, carbs_g, protein_g, fat_g, fiber_g, cal_kcal }) {
  const tags = new Set(); const n=x=>typeof x==='number'&&!isNaN(x);
  if (n(gi)) { if (gi < 55) tags.add("منخفض GI"); else if (gi >= 70) tags.add("مرتفع GI"); }
  if (n(carbs_g) && carbs_g < 15) tags.add("منخفض الكربوهيدرات");
  if (n(protein_g) && protein_g >= 15) tags.add("عالي البروتين");
  if (n(fat_g) && fat_g < 3) tags.add("منخفض الدهون");
  if (n(fiber_g) && fiber_g >= 5) tags.add("غني بالألياف");
  if (n(cal_kcal) && cal_kcal < 80) tags.add("منخفض السعرات");
  if ((n(carbs_g) && carbs_g < 15) || (n(gi) && gi < 55)) tags.add("صديق لمرضى السكري");
  return [...tags];
}
// أنظمة غذائية تلقائية
function autoDietSystems({ carbs_g, fat_g, gi, protein_g, sodium_mg }){
  const tags = new Set(); const n=x=>typeof x==='number'&&!isNaN(x);
  if (n(carbs_g) && carbs_g <= 10 && n(fat_g) && fat_g >= 10) tags.add("كيتو");
  if (n(carbs_g) && carbs_g < 15) tags.add("قليل الكربوهيدرات");
  if (n(sodium_mg) && sodium_mg <= 120) tags.add("قليل الملح");
  if (n(protein_g) && protein_g >= 20 && n(carbs_g) && carbs_g >= 10 && carbs_g <= 30) tags.add("بعد التمرين");
  if ((n(gi) && gi < 55) || (n(carbs_g) && carbs_g < 15)) tags.add("صديق لمرضى السكري");
  return [...tags];
}
// هاشتاجات تلقائية
function autoHashTags(item){
  const base = [
    item.category, item.name,
    ...(item.dietTagsManual||[]), ...(item.dietTagsAuto||[]),
    ...(item.dietSystemsManual||[]), ...(item.dietSystemsAuto||[])
  ].filter(Boolean).join(" ").toLowerCase();
  const words = base.replace(/[^\p{L}\p{N}\s]/gu," ").split(/\s+/).filter(w=>w.length>=3);
  return [...new Set(words)].slice(0,12).map(w=>"#"+w.replace(/^#+/,""));
}
function toSearchText(item){
  return [
    item.name, item.category,
    ...(item.dietTagsManual||[]), ...(item.dietTagsAuto||[]),
    ...(item.dietSystemsManual||[]), ...(item.dietSystemsAuto||[]),
    ...(item.hashTags||[])
  ].filter(Boolean).join(" ").toLowerCase();
}
function filterByKeyword(list, kw){
  if (!kw) return list;
  kw = kw.toLowerCase();
  return list.filter(x => (x.searchText || "").includes(kw) || (x.name||"").toLowerCase().includes(kw));
}
function setPageInfo(totalInPage){ $("#page-info").textContent = `صفحة ${state.page} — ${totalInPage} عنصر`; }

// تحويل أسماء قديمة
function normalizeLegacyFields(d){
  const map = {...d};
  map.cal_kcal  = (d.cal_kcal ?? d.calories ?? d.kcal ?? null);
  map.carbs_g   = (d.carbs_g ?? d.carb ?? d.carbs ?? null);
  map.protein_g = (d.protein_g ?? d.protein ?? null);
  map.fat_g     = (d.fat_g ?? d.fat ?? null);
  map.fiber_g   = (d.fiber_g ?? d.fiber ?? null);
  map.gi        = (d.gi ?? d.GI ?? null);
  map.category  = (d.category || "اخرى");
  map.sodium_mg = (d.sodium_mg ?? d.sodium ?? null);
  map.dietTagsManual = Array.isArray(d.dietTagsManual) ? d.dietTagsManual : (d.dietTagsManual||"").toString().split(",").map(s=>s.trim()).filter(Boolean);
  map.dietSystemsManual = Array.isArray(d.dietSystemsManual) ? d.dietSystemsManual : (d.dietSystemsManual||"").toString().split(",").map(s=>s.trim()).filter(Boolean);
  map.hashTagsManual = Array.isArray(d.hashTagsManual) ? d.hashTagsManual : (d.hashTagsManual||"").toString().split(",").map(s=>s.trim()).filter(Boolean);
  map.dietTagsAuto = d.dietTagsAuto || autoDietTags(map);
  map.dietSystemsAuto = d.dietSystemsAuto || autoDietSystems(map);
  return map;
}

// ============ Query builder ============
function buildQuery(){
  const base = collection(db, ...COLL_PATH);
  let qy = [];
  if (state.onlyActive) qy.push(where("isActive","==", true));
  if (state.category)   qy.push(where("category","==", state.category));
  if (state.dietSystem) qy.push(where("dietSystems","array-contains", state.dietSystem));

  if (state.sortBy === "name_asc") qy.push(orderBy("name"));
  else qy.push(orderBy("createdAt","desc"));

  let q = query(base, ...qy, limit(PAGE_SIZE));
  if (state.lastDoc) q = query(base, ...qy, startAfter(state.lastDoc), limit(PAGE_SIZE));
  return q;
}

// ============ Rendering ============
function renderCards(items){
  const host = $("#cards-view"); host.innerHTML = "";
  items.forEach(item=>{
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <img class="thumb" src="${item.imageUrl||""}" alt="" onerror="this.src='';this.style.background='#eef2f7'">
      <div class="name">${item.name||"—"}</div>
      <div class="meta">
        <span>${item.category||"غير مصنّف"}</span>
        <span>سعرات: ${item.cal_kcal ?? "—"}</span>
        <span>كارب: ${item.carbs_g ?? "—"}</span>
        <span>GI: ${item.gi ?? "—"}</span>
        <span>${item.isActive? "نشط" : "غير نشط"}</span>
      </div>
      <div class="chips">
        ${(item.dietTagsAuto||[]).map(t=>`<span class="chip green">${t}</span>`).join("")}
        ${(item.dietSystems||item.dietSystemsAuto||[]).map(t=>`<span class="chip yellow">${t}</span>`).join("")}
        ${(item.dietTagsManual||[]).map(t=>`<span class="chip">${t}</span>`).join("")}
      </div>
      <div class="actions">
        <button class="btn light" data-edit="${item.id}">تعديل</button>
        <button class="btn ${item.isActive? 'danger' : 'primary'}" data-toggle="${item.id}">
          ${item.isActive? 'تعطيل' : 'تفعيل'}
        </button>
      </div>
    `;
    host.appendChild(card);
  });
  afterRender();
}
function renderTable(items){
  const tb = $("#table-body"); tb.innerHTML = "";
  items.forEach(item=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><img class="thumb" src="${item.imageUrl||""}" onerror="this.src='';this.style.background='#eef2f7'"/></td>
      <td>${item.name||"—"}</td>
      <td>${item.category||"—"}</td>
      <td>${item.cal_kcal ?? "—"}</td>
      <td>${item.carbs_g ?? "—"}</td>
      <td>${item.protein_g ?? "—"}</td>
      <td>${item.fat_g ?? "—"}</td>
      <td>${item.fiber_g ?? "—"}</td>
      <td>${item.gi ?? "—"}</td>
      <td>${item.isActive? "✅" : "❌"}</td>
      <td>
        <button class="btn light" data-edit="${item.id}">تعديل</button>
        <button class="btn ${item.isActive? 'danger' : 'primary'}" data-toggle="${item.id}">
          ${item.isActive? 'تعطيل' : 'تفعيل'}
        </button>
      </td>
    `;
    tb.appendChild(tr);
  });
  afterRender();
}
function bindRowActions(){
  $$("[data-edit]").forEach(btn=> btn.onclick = ()=> openEditDialog(btn.getAttribute("data-edit")));
  $$("[data-toggle]").forEach(btn=> btn.onclick = ()=> quickToggle(btn.getAttribute("data-toggle")));
}
function afterRender(){
  setPageInfo(state.currentDocs.length);
  bindRowActions();
}

// ============ Fetch ============
async function fetchAndRender(reset=false){
  if (reset){ state.page = 1; state.lastDoc = null; }
  const qRef = buildQuery();
  try {
    const snap = await getDocs(qRef);
    const docs = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    state.currentDocs = docs;

    docs.forEach(d=>{
      d.searchText = d.searchText || toSearchText(d);
      state.cache.set(d.id, d);
    });

    const filtered = filterByKeyword(docs, state.q);
    state.view === "table" ? renderTable(filtered) : renderCards(filtered);

    state.lastDoc = snap.docs[snap.docs.length-1] || null;
  } catch(e){
    if (e?.code === "failed-precondition" && e?.message?.includes("index")){
      console.warn(e.message);
      alert("الاستعلام محتاج فهرس (اندكست). افتحي الرابط في الكونسول لإنشائه ثم أعيدي التحميل.");
    } else { console.error(e); alert("تعذّر جلب البيانات."); }
  }
}

// ============ Filters / Events ============
$("#q").addEventListener("input", debounce(e=>{ state.q = e.target.value.trim(); fetchAndRender(true); }, 300));
$("#category").addEventListener("input", e=>{ state.category = (e.target.value||"").trim(); fetchAndRender(true); });
$("#onlyActive").addEventListener("change", e=>{ state.onlyActive = e.target.checked; fetchAndRender(true); });
$("#sortBy").addEventListener("change", e=>{ state.sortBy = e.target.value; fetchAndRender(true); });
$("#dietSystem").addEventListener("change", e=>{ state.dietSystem = e.target.value; fetchAndRender(true); });

$("#next-page").onclick = async ()=>{ if (!state.lastDoc) return; state.page++; await fetchAndRender(false); };
$("#prev-page").onclick = async ()=>{
  if (state.page===1) return;
  state.page--; state.lastDoc = null;
  for(let i=1;i<state.page;i++) await getDocs(buildQuery()); // advance cursor سريع
  await fetchAndRender(false);
};

$("#tab-cards").onclick = ()=>{ state.view="cards"; $("#tab-cards").classList.add("active"); $("#tab-table").classList.remove("active"); $("#cards-view").classList.remove("hidden"); $("#table-view").classList.add("hidden"); };
$("#tab-table").onclick = ()=>{ state.view="table"; $("#tab-table").classList.add("active"); $("#tab-cards").classList.remove("active"); $("#table-view").classList.remove("hidden"); $("#cards-view").classList.add("hidden"); };

// ============ Add / Edit ============
$("#btn-add").onclick = ()=> openEditDialog(null);

async function openEditDialog(id){
  const dlg = $("#edit-dialog");
  const form = $("#edit-form");
  $("#btn-delete").classList.toggle("hidden", !id);
  $("#edit-title").textContent = id ? "تعديل صنف" : "إضافة صنف";
  form.reset(); form.dataset.id = id || "";

  let data = {};
  if (id){
    data = state.cache.get(id) || (await getDoc(doc(db, ...COLL_PATH, id))).data() || {};
  }
  data = normalizeLegacyFields(data);

  // تعبئة الحقول
  form.elements["name"].value = data.name || "";
  form.elements["category"].value = data.category || "اخرى";
  form.elements["imageUrl"].value = data.imageUrl || "";
  form.elements["isActive"].checked = (data.isActive !== false);
  form.elements["cal_kcal"].value = data.cal_kcal ?? "";
  form.elements["carbs_g"].value = data.carbs_g ?? "";
  form.elements["protein_g"].value = data.protein_g ?? "";
  form.elements["fat_g"].value = data.fat_g ?? "";
  form.elements["fiber_g"].value = data.fiber_g ?? "";
  form.elements["gi"].value = data.gi ?? "";
  form.elements["sodium_mg"].value = data.sodium_mg ?? "";
  form.elements["dietTagsManual"].value = (data.dietTagsManual||[]).join(", ");
  form.elements["dietSystemsManual"].value = (data.dietSystemsManual||[]).join(", ");
  form.elements["hashTagsManual"].value = (data.hashTagsManual||[]).join(", ");

  // معاينة صورة
  const prev = $("#image-preview");
  prev.src = data.imageUrl || "";

  renderAutoTagsPreview();
  dlg.showModal();
}

// تحديث معاينة الوسوم/الأنظمة عند أي تغيير
["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg","category","name","dietTagsManual","dietSystemsManual"]
  .forEach(n=>{ $("#edit-form").elements[n]?.addEventListener("input", renderAutoTagsPreview); });

function toggleManualChip(form, inputName, value){
  const inp = form.elements[inputName];
  const list = (inp.value||"").split(",").map(s=>s.trim()).filter(Boolean);
  const i = list.indexOf(value);
  if (i>=0) list.splice(i,1); else list.push(value);
  inp.value = list.join(", ");
}
function renderAutoTagsPreview() {
  const form = $("#edit-form");
  const payload = getFormData(form);
  const dietTags = autoDietTags(payload);
  const dietSystems = autoDietSystems(payload);

  // وسوم التغذية
  const auto = $("#auto-tags"); auto.innerHTML = "";
  dietTags.forEach(t=>{
    const s=document.createElement("span");
    s.className="chip green auto";
    s.textContent=t;
    s.onclick = ()=>{ toggleManualChip(form, "dietTagsManual", t); renderAutoTagsPreview(); };
    auto.appendChild(s);
  });

  // أنظمة غذائية
  const diets = $("#auto-diets"); diets.innerHTML = "";
  dietSystems.forEach(t=>{
    const s=document.createElement("span");
    s.className="chip yellow auto";
    s.textContent=t;
    s.onclick = ()=>{ toggleManualChip(form, "dietSystemsManual", t); renderAutoTagsPreview(); };
    diets.appendChild(s);
  });
}

function getFormData(form){
  const fd = new FormData(form);
  const obj = Object.fromEntries(fd.entries());
  obj.isActive = form.elements["isActive"].checked;
  ["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg"].forEach(k=>{
    obj[k] = (obj[k]==="" ? null : Number(obj[k]));
  });
  obj.dietTagsManual = (obj.dietTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  obj.dietSystemsManual = (obj.dietSystemsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  obj.hashTagsManual = (obj.hashTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  obj.category = (obj.category||"اخرى").trim() || "اخرى";
  return obj;
}

// حفظ
$("#edit-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const id = e.currentTarget.dataset.id || null;
  const payload = getFormData(e.currentTarget);

  payload.dietTagsAuto    = autoDietTags(payload);
  payload.dietSystemsAuto = autoDietSystems(payload);
  payload.dietSystems     = [...new Set([...(payload.dietSystemsManual||[]), ...(payload.dietSystemsAuto||[])])];

  const hashAuto   = autoHashTags(payload);
  const hashManual = payload.hashTagsManual || [];
  const hashTags   = [...new Set([...hashManual, ...hashAuto])];
  payload.hashTagsAuto = hashAuto;
  payload.hashTags     = hashTags;

  payload.searchText = toSearchText(payload);

  const now = serverTimestamp();
  const ref = id ? doc(db, ...COLL_PATH, id) : doc(collection(db, ...COLL_PATH));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...payload,
    createdAt: id ? (state.cache.get(id)?.createdAt || now) : now,
    updatedAt: now
  }, { merge:true });
  await batch.commit();

  $("#edit-dialog").close();
  await fetchAndRender(true);
});

// حذف (ناعم)
$("#btn-delete").onclick = async ()=>{
  const id = $("#edit-form").dataset.id;
  if (!id) return;
  const batch = writeBatch(db);
  batch.set(doc(db, ...COLL_PATH, id), { isActive:false, updatedAt:serverTimestamp() }, { merge:true });
  await batch.commit();
  $("#edit-dialog").close();
  await fetchAndRender(true);
};

// ============ Quick Toggle ============
async function quickToggle(id){
  const item = state.cache.get(id) || (await getDoc(doc(db, ...COLL_PATH, id))).data();
  const next = !(item?.isActive!==false);
  const batch = writeBatch(db);
  batch.set(doc(db, ...COLL_PATH, id), { isActive: next, updatedAt: serverTimestamp() }, { merge:true });
  await batch.commit();
  fetchAndRender(true);
}

// ============ Export ============
async function exportToXlsx(items, filename){
  const rows = items.map(x=>({
    id: x.id || "",
    name: x.name||"",
    category: x.category||"",
    imageUrl: x.imageUrl||"",
    isActive: x.isActive!==false,
    cal_kcal: x.cal_kcal??"",
    carbs_g: x.carbs_g??"",
    protein_g: x.protein_g??"",
    fat_g: x.fat_g??"",
    fiber_g: x.fiber_g??"",
    gi: x.gi??"",
    sodium_mg: x.sodium_mg??"",
    dietTagsManual: (x.dietTagsManual||[]).join(", "),
    dietSystemsManual: (x.dietSystemsManual||[]).join(", "),
    dietTagsAuto: (x.dietTagsAuto||[]).join(", "),
    dietSystemsAuto: (x.dietSystemsAuto||[]).join(", "),
    hashTags: (x.hashTags||[]).join(" ")
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "foodItems");
  XLSX.writeFile(wb, filename);
}
$("#btn-export-current").onclick = ()=> exportToXlsx(state.currentDocs, "foodItems-current.xlsx");
$("#btn-export-all").onclick = async ()=>{
  const snap = await getDocs(query(collection(db, ...COLL_PATH), orderBy("createdAt","desc")));
  const all = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  exportToXlsx(all, "foodItems-all.xlsx");
};

// ============ Import (Preview + Save Valid) ============
const importState = { rows:[], valid:[], invalid:[] };

$("#file-import").addEventListener("change", async (e)=>{
  const file = e.target.files[0]; if (!file) return;
  await readAndPreview(file);
});

async function readAndPreview(file){
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type:"array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  let rows = XLSX.utils.sheet_to_json(ws, { defval:"" });

  rows = rows.map(r=>{
    const item = {
      id: r.id || "",
      name: r.name || r["الاسم"] || "",
      category: r.category || r["الفئة"] || "اخرى",
      imageUrl: r.imageUrl || "",
      isActive: (typeof r.isActive==="boolean" ? r.isActive : (String(r.isActive||"").trim()!=="false")),
      cal_kcal: Number(r.cal_kcal ?? r.cal ?? r.kcal ?? "") || null,
      carbs_g: Number(r.carbs_g ?? r.carbs ?? r.carb ?? "") || null,
      protein_g: Number(r.protein_g ?? r.protein ?? "") || null,
      fat_g: Number(r.fat_g ?? r.fat ?? "") || null,
      fiber_g: Number(r.fiber_g ?? r.fiber ?? "") || null,
      gi: Number(r.gi ?? r["GI"] ?? "") || null,
      sodium_mg: Number(r.sodium_mg ?? r.sodium ?? "") || null,
      dietTagsManual: (r.dietTagsManual || r.tags || "").toString(),
      dietSystemsManual: (r.dietSystemsManual || r.systems || "").toString(),
      hashTagsManual: (r.hashTagsManual || r.hashtags || "").toString(),
    };
    item.dietTagsAuto = autoDietTags(item);
    item.dietSystemsAuto = autoDietSystems(item);
    item.dietSystems = [...new Set([
      ...item.dietTagsManual.split(",").map(s=>s.trim()).filter(Boolean), // لو كانت قديمة بداخل tags
      ...item.dietSystemsManual.split(",").map(s=>s.trim()).filter(Boolean),
      ...item.dietSystemsAuto
    ])];
    item.hashTagsAuto = autoHashTags(item);
    item.hashTags = [...new Set([...(item.hashTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean), ...item.hashTagsAuto])];
    item.searchText = toSearchText({
      ...item,
      dietTagsManual: item.dietTagsManual.split(",").map(s=>s.trim()).filter(Boolean),
      dietSystemsManual: item.dietSystemsManual.split(",").map(s=>s.trim()).filter(Boolean)
    });
    return item;
  });

  const valid=[], invalid=[];
  rows.forEach(row=>{
    const errs=[];
    if (!row.name) errs.push("name");
    if (!row.category) errs.push("category");
    ["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg"].forEach(k=>{
      if (row[k]!=null && isNaN(row[k])) errs.push(k);
    });
    (errs.length? invalid:valid).push({...row, __errors:errs});
  });

  importState.rows = rows; importState.valid = valid; importState.invalid = invalid;

  const dlg = $("#import-dialog");
  $("#import-stats").innerHTML = `✅ صالحة: <b>${valid.length}</b> — ❌ بها أخطاء: <b>${invalid.length}</b> — إجمالي: <b>${rows.length}</b>`;
  const cols = ["id","name","category","imageUrl","isActive","cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg","dietTagsManual","dietSystemsManual","hashTagsManual"];
  $("#import-thead").innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
  $("#import-tbody").innerHTML = rows.map(r=>{
    const cls = (r.__errors?.length) ? ' style="background:#fff1f2;"' : "";
    return `<tr${cls}>${cols.map(c=>`<td>${(c==="dietTagsManual"||c==="dietSystemsManual"||c==="hashTagsManual")? r[c] : (r[c]??"")}</td>`).join("")}</tr>`;
  }).join("");

  dlg.showModal();
}
$("#btn-export-errors").onclick = ()=>{
  const ws = XLSX.utils.json_to_sheet(importState.invalid.map(r=>({ ...r, errors: (r.__errors||[]).join("|") })));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "errors"); XLSX.writeFile(wb, "foodItems-import-errors.xlsx");
};
$("#btn-save-valid").onclick = async ()=>{
  const dlg = $("#import-dialog");
  const bar = $("#import-progress"); const barInner = bar.firstElementChild;
  bar.classList.remove("hidden");

  const rows = importState.valid; let done = 0;
  for (let i=0; i<rows.length; i+=400){
    const chunk = rows.slice(i, i+400);
    const batch = writeBatch(db);
    chunk.forEach(row=>{
      const id = (row.id||"").trim();
      const ref = id ? doc(db, ...COLL_PATH, id) : doc(collection(db, ...COLL_PATH));
      const payload = {
        name: row.name, category: row.category||"اخرى", imageUrl: row.imageUrl||"",
        isActive: row.isActive!==false,
        cal_kcal: row.cal_kcal ?? null, carbs_g: row.carbs_g ?? null, protein_g: row.protein_g ?? null,
        fat_g: row.fat_g ?? null, fiber_g: row.fiber_g ?? null, gi: row.gi ?? null, sodium_mg: row.sodium_mg ?? null,
        dietTagsManual: (row.dietTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean),
        dietSystemsManual: (row.dietSystemsManual||"").split(",").map(s=>s.trim()).filter(Boolean),
        dietTagsAuto: autoDietTags(row),
        dietSystemsAuto: autoDietSystems(row),
        dietSystems: [...new Set([...(row.dietSystemsManual||"").split(",").map(s=>s.trim()).filter(Boolean), ...autoDietSystems(row)])],
        hashTagsManual: (row.hashTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean),
        hashTagsAuto: autoHashTags(row),
        hashTags: [...new Set([...(row.hashTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean), ...autoHashTags(row)])],
        searchText: toSearchText(row),
        updatedAt: serverTimestamp(),
      };
      if (!id) payload.createdAt = serverTimestamp();
      batch.set(ref, payload, { merge:true });
    });
    await batch.commit();
    done += chunk.length; barInner.style.width = `${Math.round((done/rows.length)*100)}%`;
  }
  bar.classList.add("hidden"); dlg.close(); await fetchAndRender(true);
};

// ============ Image Upload (Storage) ============
const imgInput = $("#image-file");
if (imgInput) imgInput.addEventListener("change", async (e)=>{
  const file = e.target.files?.[0]; if (!file) return;
  const form = $("#edit-form");
  const uid  = auth.currentUser?.uid || "anon";
  const path = `food-items/${uid}/${Date.now()}-${file.name}`;
  const ref  = sRef(storage, path);
  try {
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);
    form.elements["imageUrl"].value = url;
    const img = $("#image-preview"); if (img) img.src = url;
  } catch(err){ console.error(err); alert("تعذّر رفع الصورة. تأكدي من قواعد Storage وتسجيل الدخول."); }
});

// ============ Auth ============
onAuthStateChanged(auth, async (user)=>{
  if (!user){
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch(e){ console.error(e); alert("يلزم تسجيل الدخول."); return; }
  } else {
    const name = user.displayName || user.email || "مسؤول";
    const el = $("#admin-name"); if (el) el.textContent = name;
    fetchAndRender(true);
  }
});
$("#btn-signout")?.addEventListener("click", ()=> signOut(auth));

// ============ Close dialogs ============
$$("dialog [data-close]").forEach(b=>b.onclick = ()=> b.closest("dialog").close());
