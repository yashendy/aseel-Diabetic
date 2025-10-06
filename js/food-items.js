// js/food-items.js  (ESM)

// ======================== Firebase Init (CDN) ========================
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy,
  limit, startAfter, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";

// ← الصقي/راجعي storageBucket من إعدادات المشروع (appspot.com عادةً)
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

// ======================== Constants / State ==========================
const COLL_PATH = ["admin","global","foodItems"];
const PAGE_SIZE = 20;

const state = {
  page: 1,
  lastDoc: null,
  q: "", category: "", onlyActive: true, sortBy: "createdAt_desc",
  cache: new Map(),     // id -> data
  currentDocs: [],      // آخر نتيجة معروضة
  view: "cards"         // "cards" | "table"
};

// ======================== Utils ==========================
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

function debounce(fn, ms=300){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
const toNum = v => (v==="" || v==null) ? null : Number(v);

function buildQuery() {
  const base = collection(db, ...COLL_PATH);
  let qy = [];
  if (state.onlyActive) qy.push(where("isActive","==", true));
  if (state.category) qy.push(where("category","==", state.category));

  if (state.sortBy === "name_asc") qy.push(orderBy("name"));
  else qy.push(orderBy("createdAt","desc"));

  let q = query(base, ...qy, limit(PAGE_SIZE));
  if (state.lastDoc) q = query(base, ...qy, startAfter(state.lastDoc), limit(PAGE_SIZE));
  return q;
}

// وسوم ذكية تلقائية (Rule-based)
function autoDietTags({ gi, carbs_g, protein_g, fat_g, fiber_g, cal_kcal }) {
  const tags = new Set();
  const n = (x)=> typeof x==='number' && !isNaN(x);

  if (n(gi)) {
    if (gi < 55) tags.add("منخفض GI");
    else if (gi >= 70) tags.add("مرتفع GI");
  }
  if (n(carbs_g) && carbs_g < 5) tags.add("منخفض الكربوهيدرات");
  if (n(protein_g) && protein_g >= 15) tags.add("عالي البروتين");
  if (n(fat_g) && fat_g < 3) tags.add("منخفض الدهون");
  if (n(fiber_g) && fiber_g >= 5) tags.add("غني بالألياف");
  if (n(cal_kcal) && cal_kcal < 80) tags.add("منخفض السعرات");
  if ((n(carbs_g) && carbs_g < 15) || (n(gi) && gi < 55)) tags.add("صديق لمرضى السكري");

  return [...tags];
}

function renderAutoTagsPreview() {
  const form = $("#edit-form");
  const payload = getFormData(form);
  const tags = autoDietTags(payload);
  const host = $("#auto-tags");
  host.innerHTML = "";
  tags.forEach(t=>{
    const span = document.createElement("span");
    span.className = "chip green";
    span.textContent = t;
    host.appendChild(span);
  });
}

// تحويل form إلى كائن
function getFormData(form){
  const fd = new FormData(form);
  const obj = Object.fromEntries(fd.entries());
  obj.isActive = form.elements["isActive"].checked;
  obj.cal_kcal = toNum(obj.cal_kcal);
  obj.carbs_g = toNum(obj.carbs_g);
  obj.protein_g = toNum(obj.protein_g);
  obj.fat_g = toNum(obj.fat_g);
  obj.fiber_g = toNum(obj.fiber_g);
  obj.gi = toNum(obj.gi);
  obj.dietTagsManual = (obj.dietTagsManual || "")
    .split(",")
    .map(s=>s.trim()).filter(Boolean);
  return obj;
}

function toSearchText(item){
  return [item.name, item.category, ...(item.dietTagsManual||[]), ...(item.dietTagsAuto||[])]
    .filter(Boolean).join(" ").toLowerCase();
}

function filterByKeyword(list, kw){
  if (!kw) return list;
  kw = kw.toLowerCase();
  return list.filter(x => (x.searchText || "").includes(kw) || (x.name||"").toLowerCase().includes(kw));
}

function setPageInfo(totalInPage){
  $("#page-info").textContent = `صفحة ${state.page} — ${totalInPage} عنصر`;
}

// ======================== Rendering ==========================
function renderCards(items){
  const host = $("#cards-view");
  host.innerHTML = "";
  items.forEach(item=>{
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <img class="thumb" src="${item.imageUrl||""}" alt="" onerror="this.src=''; this.style.background='#eef2f7';">
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
        ${(item.dietTagsManual||[]).map(t=>`<span class="chip">${t}</span>`).join("")}
      </div>
      <div class="actions">
        <button class="btn light" data-edit="${item.id}">تعديل</button>
      </div>
    `;
    host.appendChild(card);
  });
}

function renderTable(items){
  const tb = $("#table-body");
  tb.innerHTML = "";
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
      </td>
    `;
    tb.appendChild(tr);
  });
}

// ======================== Fetch & Events ======================
async function fetchAndRender(reset=false){
  if (reset){ state.page = 1; state.lastDoc = null; }

  const qRef = buildQuery();
  const snap = await getDocs(qRef);

  const docs = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  state.currentDocs = docs;

  // cache + searchText
  docs.forEach(d=>{
    d.searchText = (d.searchText) || toSearchText(d);
    state.cache.set(d.id, d);
  });

  // keyword filtering on client (بعد تضييق الاستعلام على السيرفر)
  const filtered = filterByKeyword(docs, state.q);

  // render
  if (state.view === "table") renderTable(filtered);
  else renderCards(filtered);

  // pagination
  state.lastDoc = snap.docs[snap.docs.length-1] || null;
  setPageInfo(filtered.length);

  // bind edit buttons
  $$("[data-edit]").forEach(btn=>{
    btn.onclick = ()=> openEditDialog(btn.getAttribute("data-edit"));
  });
}

$("#q").addEventListener("input", debounce(e=>{ state.q = e.target.value.trim(); fetchAndRender(true); }, 300));
$("#category").addEventListener("change", e=>{ state.category = e.target.value; fetchAndRender(true); });
$("#onlyActive").addEventListener("change", e=>{ state.onlyActive = e.target.checked; fetchAndRender(true); });
$("#sortBy").addEventListener("change", e=>{ state.sortBy = e.target.value; fetchAndRender(true); });

$("#next-page").onclick = async ()=>{ if (!state.lastDoc) return; state.page++; await fetchAndRender(false); };
$("#prev-page").onclick = async ()=>{ state.page = Math.max(1, state.page-1); state.lastDoc = null; for(let i=1;i<state.page;i++) await fetchAndRender(false); await fetchAndRender(false); };

// Tabs
$("#tab-cards").onclick = ()=>{ state.view="cards"; $("#tab-cards").classList.add("active"); $("#tab-table").classList.remove("active"); $("#cards-view").classList.remove("hidden"); $("#table-view").classList.add("hidden"); };
$("#tab-table").onclick = ()=>{ state.view="table"; $("#tab-table").classList.add("active"); $("#tab-cards").classList.remove("active"); $("#table-view").classList.remove("hidden"); $("#cards-view").classList.add("hidden"); };

// ======================== Add / Edit Dialog ===================
$("#btn-add").onclick = ()=> openEditDialog(null);

async function openEditDialog(id){
  const dlg = $("#edit-dialog");
  const form = $("#edit-form");
  $("#btn-delete").classList.toggle("hidden", !id);
  $("#edit-title").textContent = id ? "تعديل صنف" : "إضافة صنف";

  form.reset();
  form.dataset.id = id || "";

  let data = {};
  if (id){
    // حاول استخدم الكاش، ولو مش موجود هات المستند مباشرة
    data = state.cache.get(id) || (await getDoc(doc(db, ...COLL_PATH, id))).data() || {};
  }

  // عبّي الفورم
  form.elements["name"].value = data.name || "";
  form.elements["category"].value = data.category || "أخرى";
  form.elements["imageUrl"].value = data.imageUrl || "";
  form.elements["isActive"].checked = (data.isActive !== false);
  form.elements["cal_kcal"].value = data.cal_kcal ?? "";
  form.elements["carbs_g"].value = data.carbs_g ?? "";
  form.elements["protein_g"].value = data.protein_g ?? "";
  form.elements["fat_g"].value = data.fat_g ?? "";
  form.elements["fiber_g"].value = data.fiber_g ?? "";
  form.elements["gi"].value = data.gi ?? "";
  form.elements["dietTagsManual"].value = (data.dietTagsManual||[]).join(", ");

  renderAutoTagsPreview();
  dlg.showModal();
}

// تحديث معاينة الوسوم الذكية عند أي تغيير في الحقول الغذائية
["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi"].forEach(n=>{
  $("#edit-form").elements[n].addEventListener("input", renderAutoTagsPreview);
});

// حفظ
$("#edit-form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const id = e.currentTarget.dataset.id || null;
  const payload = getFormData(e.currentTarget);
  payload.dietTagsAuto = autoDietTags(payload);
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

// حذف
$("#btn-delete").onclick = async ()=>{
  const id = $("#edit-form").dataset.id;
  if (!id) return;
  // حذف ناعم: isActive=false
  const batch = writeBatch(db);
  batch.set(doc(db, ...COLL_PATH, id), { isActive:false, updatedAt:serverTimestamp() }, { merge:true });
  await batch.commit();
  $("#edit-dialog").close();
  await fetchAndRender(true);
};

// إغلاق الحوارات
$$("dialog [data-close]").forEach(b=>b.onclick = ()=> b.closest("dialog").close());

// ======================== Export =============================
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
    dietTagsManual: (x.dietTagsManual||[]).join(", "),
    dietTagsAuto: (x.dietTagsAuto||[]).join(", ")
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "foodItems");
  XLSX.writeFile(wb, filename);
}

$("#btn-export-current").onclick = ()=> exportToXlsx(state.currentDocs, "foodItems-current.xlsx");
$("#btn-export-all").onclick = async ()=>{
  // جلب كل العناصر (ممكن حسب فلاتر بسيطة)
  const snap = await getDocs(query(collection(db, ...COLL_PATH), orderBy("createdAt","desc")));
  const all = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  exportToXlsx(all, "foodItems-all.xlsx");
};

// ======================== Import (Preview + Save Valid) ======
const importState = { rows:[], valid:[], invalid:[] };

$("#file-import").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  await readAndPreview(file);
});

async function readAndPreview(file){
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type:"array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  let rows = XLSX.utils.sheet_to_json(ws, { defval:"" }); // يدعم CSV كذلك

  // تطبيع الأعمدة
  rows = rows.map(r=>{
    const norm = (k)=> (r[k] ?? r[k?.toLowerCase?.()] ?? r[k?.replace(/\s+/g,"")]) ?? "";
    const item = {
      id: r.id || "",
      name: r.name || r["الاسم"] || "",
      category: r.category || r["الفئة"] || "أخرى",
      imageUrl: r.imageUrl || "",
      isActive: (typeof r.isActive==="boolean" ? r.isActive : (String(r.isActive||"").trim()!=="false")),
      cal_kcal: Number(r.cal_kcal ?? r.cal ?? r.kcal ?? "") || null,
      carbs_g: Number(r.carbs_g ?? r.carbs ?? r.carb ?? r["carb_g"] ?? "") || null,
      protein_g: Number(r.protein_g ?? r.protein ?? r["protein_g"] ?? "") || null,
      fat_g: Number(r.fat_g ?? r.fat ?? r["fat_g"] ?? "") || null,
      fiber_g: Number(r.fiber_g ?? r.fiber ?? r["fiber_g"] ?? "") || null,
      gi: Number(r.gi ?? r["GI"] ?? "") || null,
      dietTagsManual: (r.dietTagsManual || r.tags || "").toString()
    };
    // Auto tags + search
    item.dietTagsAuto = autoDietTags(item);
    item.searchText = toSearchText({ ...item, dietTagsManual: item.dietTagsManual.split(",").map(s=>s.trim()).filter(Boolean) });
    return item;
  });

  // تحقق صلاحية الصفوف
  const valid=[], invalid=[];
  rows.forEach((row, idx)=>{
    const errs=[];
    if (!row.name) errs.push("name");
    if (!row.category) errs.push("category");
    if (row.cal_kcal!=null && isNaN(row.cal_kcal)) errs.push("cal_kcal");
    if (row.carbs_g!=null && isNaN(row.carbs_g)) errs.push("carbs_g");
    if (row.protein_g!=null && isNaN(row.protein_g)) errs.push("protein_g");
    if (row.fat_g!=null && isNaN(row.fat_g)) errs.push("fat_g");
    if (row.fiber_g!=null && isNaN(row.fiber_g)) errs.push("fiber_g");
    if (row.gi!=null && isNaN(row.gi)) errs.push("gi");

    if (errs.length) invalid.push({...row, __errors:errs});
    else valid.push(row);
  });

  importState.rows = rows; importState.valid = valid; importState.invalid = invalid;

  // عرض المعاينة
  const dlg = $("#import-dialog");
  $("#import-stats").innerHTML = `✅ صالحة: <b>${valid.length}</b> — ❌ بها أخطاء: <b>${invalid.length}</b> — إجمالي: <b>${rows.length}</b>`;
  // رأس الجدول
  const cols = ["id","name","category","imageUrl","isActive","cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","dietTagsManual"];
  $("#import-thead").innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
  // جسم الجدول
  $("#import-tbody").innerHTML = rows.map(r=>{
    const isErr = importState.invalid.includes(r);
    const cls = (r.__errors?.length) ? ' style="background:#fff1f2;"' : "";
    return `<tr${cls}>${cols.map(c=>`<td>${(c==="dietTagsManual"? r[c] : (r[c]??""))}</td>`).join("")}</tr>`;
  }).join("");

  dlg.showModal();
}

// تصدير الأخطاء
$("#btn-export-errors").onclick = ()=>{
  const ws = XLSX.utils.json_to_sheet(importState.invalid.map(r=>({ ...r, errors: (r.__errors||[]).join("|") })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "errors");
  XLSX.writeFile(wb, "foodItems-import-errors.xlsx");
};

// حفظ الصالح فقط (Upsert + Batch 400)
$("#btn-save-valid").onclick = async ()=>{
  const dlg = $("#import-dialog");
  const bar = $("#import-progress");
  const barInner = bar.firstElementChild;
  bar.classList.remove("hidden");

  const rows = importState.valid;
  let done = 0;
  for (let i=0; i<rows.length; i+=400){
    const chunk = rows.slice(i, i+400);
    const batch = writeBatch(db);
    chunk.forEach(row=>{
      const id = row.id ? row.id.trim() : "";
      const ref = id ? doc(db, ...COLL_PATH, id) : doc(collection(db, ...COLL_PATH));
      const payload = {
        name: row.name,
        category: row.category || "أخرى",
        imageUrl: row.imageUrl || "",
        isActive: row.isActive !== false,
        cal_kcal: row.cal_kcal ?? null,
        carbs_g: row.carbs_g ?? null,
        protein_g: row.protein_g ?? null,
        fat_g: row.fat_g ?? null,
        fiber_g: row.fiber_g ?? null,
        gi: row.gi ?? null,
        dietTagsManual: (row.dietTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean),
        dietTagsAuto: autoDietTags(row),
        searchText: toSearchText({
          ...row,
          dietTagsManual:(row.dietTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean)
        }),
        updatedAt: serverTimestamp(),
      };
      if (!id) payload.createdAt = serverTimestamp();
      batch.set(ref, payload, { merge:true });
    });
    await batch.commit();
    done += chunk.length;
    barInner.style.width = `${Math.round((done/rows.length)*100)}%`;
  }

  bar.classList.add("hidden");
  dlg.close();
  await fetchAndRender(true);
};

// ======================== Auth (بسيط مؤقتًا) =================
onAuthStateChanged(auth, async (user)=>{
  if (!user){
    // دخول سريع بحساب جوجل (يمكن تعطيله لاحقًا)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch(e){
      console.error(e);
      alert("يلزم تسجيل الدخول لمتابعة.");
    }
  } else {
    // TODO: تحقق صلاحية الأدمن (admins/{uid})
    fetchAndRender(true);
  }
});

// ======================== View Switch ========================
$("#tab-cards").click(); // افتراضي بطاقات
