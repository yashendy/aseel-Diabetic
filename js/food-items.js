/* eslint-disable no-alert */
import {
  initializeApp, getApps
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, query, where, orderBy, limit, startAfter, getDocs,
  addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getStorage, ref as sRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ========= تهيئة Firebase ========= */
const app = getApps().length
  ? getApps()[0]
  : initializeApp(window.__FIREBASE_CONFIG__ || {
      // ⚠️ ضعي إعدادات مشروعك هنا إن لم تكن مهيأة عالميًا.
      apiKey: "YOUR_API_KEY",
      authDomain: "YOUR_AUTH_DOMAIN",
      projectId: "YOUR_PROJECT_ID",
      storageBucket: "YOUR_BUCKET",
      appId: "YOUR_APP_ID"
    });

const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

/* ========= عناصر DOM ========= */
const $ = (id)=> document.getElementById(id);
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

  // dialog
  dlg: $("edit-dialog"),
  dlgClose: $("dlg-close"),
  dlgTitle: $("dlg-title"),
  form: $("edit-form"),
  id: $("item-id"),
  name: $("name"),
  category: $("category"),
  isActive: $("isActive"),
  tags: $("tags"),
  autoTags: $("auto-tags"),
  measuresList: $("measures-list"),
  addMeasure: $("add-measure"),
  imageUrl: $("image-url"),
  imageFile: $("image-file"),
  uploadBtn: $("btn-upload"),
  progress: $("upload-progress"),
  preview: $("preview"),
  btnDelete: $("delete"),

  // admin
  adminName: $("admin-name"),
  adminRole: $("admin-role"),
};

let user = null;
let paging = { page: 1, pageSize: 20, lastDoc: null };
let currentQuerySnapshot = null;

/* ========= أدوات ========= */
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function toSearchText(item){
  const tags = (item.tags || "")
    .split(" ").map(s=>s.trim()).filter(Boolean).join(" ");
  const diet = (item.dietSystems || []).map(s=>`#${s}`).join(" ");
  return [item.name || "", item.category || "", tags, diet].join(" ").toLowerCase();
}

function createChip(label, active){
  const el = document.createElement("span");
  el.className = "chip" + (active ? " active" : "");
  el.textContent = label;
  el.onclick = ()=> el.classList.toggle("active");
  return el;
}

/* ====== ربط أحداث آمن ====== */
const on = (el, ev, cb, name) => {
  if (!el) { console.warn(`[UI] عنصر مفقود: ${name}`); return; }
  el.addEventListener(ev, cb);
};

/* ===== Household Measures Editor ===== */
const MEASURE_PRESETS = [
  { name: "ملعقة", grams: 5 },
  { name: "كوب",   grams: 240 },
  { name: "طبق",   grams: 150 },
  { name: "حبة",   grams: 80 },
];

function renderMeasuresEditor(data){
  const host = els.measuresList;
  if(!host) return;
  host.innerHTML = "";

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
      const [n,g] = (e.target.value||"").split("|");
      if(n){ row.querySelector(".m-name").value = n; }
      if(g){ row.querySelector(".m-grams").value = g; }
    });
    row.querySelector(".m-del").onclick = ()=> row.remove();
    host.appendChild(row);
  }

  if(current.length){ current.forEach(addRow); } else { addRow({}); }
  if(els.addMeasure){ els.addMeasure.onclick = ()=> addRow({}); }
}

function readMeasuresFromForm(){
  const rows = document.querySelectorAll("#measures-list .measure-row");
  return Array.from(rows).map(r=>{
    const name = r.querySelector(".m-name")?.value?.trim() || "";
    const grams = Number(r.querySelector(".m-grams")?.value);
    return { name, grams: Number.isFinite(grams) ? grams : 0 };
  }).filter(m=> m.name && m.grams>0);
}

/* ===== رفع صورة إلى Storage ===== */
function ensureUpload(){
  if(!els.uploadBtn) return;

  els.uploadBtn.onclick = async ()=>{
    if(!user){
      await signIn();
      if(!user) return;
    }
    const file = els.imageFile?.files?.[0];
    if(!file){ alert("اختاري ملف صورة أولًا"); return; }

    const safeName = file.name.replace(/[^\w.\-]+/g,"_");
    const path = `food-items/${user.uid}/${Date.now()}-${safeName}`;
    const ref = sRef(storage, path);
    const task = uploadBytesResumable(ref, file, { contentType: file.type });

    if(els.progress) els.progress.value = 0;

    task.on("state_changed", (snap)=>{
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      if(els.progress) els.progress.value = pct;
    }, (err)=>{
      console.error(err);
      alert("تعذّر رفع الصورة: " + err.message);
    }, async ()=>{
      const url = await getDownloadURL(task.snapshot.ref);
      if(els.imageUrl) els.imageUrl.value = url;
      if(els.preview) els.preview.src = url;
      await sleep(300);
      if(els.progress) els.progress.value = 100;
    });
  };

  if(els.imageUrl && els.preview){
    els.imageUrl.addEventListener("input", ()=>{
      els.preview.src = els.imageUrl.value.trim() || "";
    });
  }
}

/* ========= وسوم مقترحة ========= */
const SUGGESTED = ["#منخفض_GI", "#غني_بالألياف", "#بدون_جلوتين", "#نباتي", "#موسمي"];
function renderAutoTags(existing=""){
  if(!els.autoTags) return;
  els.autoTags.innerHTML = "";
  const set = new Set(existing.split(" ").filter(Boolean));
  SUGGESTED.forEach(tag=>{
    els.autoTags.appendChild(createChip(tag, set.has(tag)));
  });
}

/* ========= مصادقة ========= */
async function signIn(){
  const provider = new GoogleAuthProvider();
  try{ await signInWithPopup(auth, provider); }
  catch(e){ console.warn("Sign-in canceled/failed", e.message); }
}

/* ========= عرض اسم الأدمن ========= */
async function showAdmin(u){
  if(!u || !els.adminName) return;
  // حاول قراءة الوثيقة من users/{uid}
  try{
    const uref = doc(db, "users", u.uid);
    const snap = await getDoc(uref);
    const data = snap.exists() ? snap.data() : {};
    const name = data.displayName || data.name || u.displayName || (u.email || "").split("@")[0] || "مستخدم";
    const role = data.role || "";
    els.adminName.textContent = name;
    els.adminRole.textContent = role ? role : "";
  }catch(e){
    console.warn("Failed to load user profile", e.message);
    const fallback = u.displayName || (u.email || "").split("@")[0] || "مستخدم";
    els.adminName.textContent = fallback;
    els.adminRole.textContent = "";
  }
}

/* ========= فتح/إغلاق الحوار ========= */
function openDialog(data){
  if(!els.dlg) return;
  els.dlgTitle.textContent = data?.id ? "تعديل صنف" : "إضافة صنف";
  els.id.value = data?.id || "";
  els.name.value = data?.name || "";
  els.category.value = data?.category || "";
  els.isActive.checked = data?.isActive ?? true;
  els.tags.value = data?.tags || "";
  els.imageUrl.value = data?.imageUrl || "";
  els.preview.src = els.imageUrl.value || "";

  renderAutoTags(els.tags.value);
  renderMeasuresEditor(data || {});
  ensureUpload();

  els.btnDelete.hidden = !data?.id;
  els.dlg.showModal();
}

function closeDialog(){ els.dlg?.close(); }

/* ========= CRUD ========= */
const colFood = collection(db, "fooditems");

async function createOrUpdate(e){
  e.preventDefault();

  const payload = {
    name: els.name.value.trim(),
    category: els.category.value,
    isActive: !!els.isActive.checked,
    tags: (els.tags.value || "").trim(),
    imageUrl: (els.imageUrl.value || "").trim(),
    updatedAt: serverTimestamp(),
  };

  // وسوم من المقترحات
  const autoSelected = Array.from(els.autoTags.querySelectorAll(".chip.active")).map(c=>c.textContent);
  if(autoSelected.length){
    payload.tags = [payload.tags, ...autoSelected].filter(Boolean).join(" ");
  }

  // المقادير البيتية
  payload.measures = readMeasuresFromForm();
  payload.measureQty = Object.fromEntries(payload.measures.map(m=>[m.name, m.grams])); // توافق
  // أنظمة غذائية (مثال مبسط من الوسوم)
  const diets = [];
  if(payload.tags.includes("#منخفض_GI")) diets.push("lowGi");
  if(payload.tags.includes("#بدون_جلوتين")) diets.push("glutenFree");
  if(payload.tags.includes("#نباتي")) diets.push("vegan");
  payload.dietSystems = [...new Set(diets)];
  payload.searchText = toSearchText(payload);

  const id = els.id.value;
  if(id){
    await updateDoc(doc(db, "fooditems", id), payload);
  }else{
    await addDoc(colFood, { ...payload, createdAt: serverTimestamp() });
  }

  closeDialog();
  await fetchAndRender(true);
}

async function removeItem(){
  const id = els.id.value;
  if(!id) return;
  if(!confirm("تأكيد حذف الصنف؟")) return;
  await deleteDoc(doc(db, "fooditems", id));
  closeDialog();
  await fetchAndRender(true);
}

/* ========= الاستعلام + التصفية + التصفح ========= */
function buildQuery(){
  const filters = [];
  if(els.fActive?.checked) filters.push(where("isActive", "==", true));
  if(els.fCategory?.value) filters.push(where("category", "==", els.fCategory.value));
  if(els.fDiet?.value) filters.push(where("dietSystems", "array-contains", els.fDiet.value));
  return query(colFood, ...filters, orderBy("name"), limit(paging.pageSize));
}

function textMatch(item){
  const q = (els.search?.value || "").trim().toLowerCase();
  if(!q) return true;
  return (item.searchText || toSearchText(item)).includes(q);
}

async function fetchAndRender(reset=false){
  if(!els.cards || !els.tableBody) return;

  els.cards.innerHTML = "";
  els.tableBody.innerHTML = "";

  if(reset){
    paging.page = 1;
    paging.lastDoc = null;
    currentQuerySnapshot = null;
  }

  let q = buildQuery();
  if(paging.lastDoc) q = query(q, startAfter(paging.lastDoc));

  const snap = await getDocs(q);
  currentQuerySnapshot = snap;
  paging.lastDoc = snap.docs[snap.docs.length - 1] || null;
  if(els.pageLabel) els.pageLabel.textContent = `صفحة ${paging.page}`;

  if(els.prev) els.prev.disabled = paging.page <= 1;
  if(els.next) els.next.disabled = snap.size < paging.pageSize;

  const items = snap.docs.map(d=>({ id: d.id, ...d.data() })).filter(textMatch);
  renderCards(items);
  renderTable(items);
}

function renderCards(items){
  if(!els.cards) return;
  if(!items.length){
    els.cards.innerHTML = `<div class="card" style="padding:16px;text-align:center">لا توجد نتائج مطابقة.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach(item=>{
    const card = document.createElement("div");
    card.className = "card card-item";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = item.imageUrl || "";
    img.alt = item.name || "";
    thumb.appendChild(img);

    const name = document.createElement("h3");
    name.className = "name";
    name.textContent = item.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span>${item.category || "-"}</span>
      <span>${item.isActive ? "نشط ✅" : "موقوف ⛔"}</span>
    `;

    const chips = document.createElement("div");
    chips.className = "chips";
    (item.measures || []).slice(0,3).forEach(m=>{
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = `${m.name}: ${m.grams}جم`;
      chips.appendChild(c);
    });

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    const editBtn = document.createElement("button");
    editBtn.className = "btn light";
    editBtn.textContent = "تعديل";
    editBtn.onclick = ()=> openDialog(item);
    actions.appendChild(editBtn);

    card.append(thumb, name, meta, chips, actions);
    frag.appendChild(card);
  });
  els.cards.appendChild(frag);
}

function renderTable(items){
  if(!els.tableBody) return;
  const frag = document.createDocumentFragment();
  items.forEach(item=>{
    const tr = document.createElement("tr");

    const tdImg = document.createElement("td");
    tdImg.innerHTML = `<img src="${item.imageUrl || ""}" alt="" style="width:60px;height:40px;object-fit:cover;border-radius:8px;border:1px solid #e6ecf5">`;

    const tdName = document.createElement("td"); tdName.textContent = item.name;
    const tdCat  = document.createElement("td"); tdCat.textContent = item.category || "-";
    const tdAct  = document.createElement("td"); tdAct.textContent = item.isActive ? "✓" : "—";

    const tdMeas = document.createElement("td");
    tdMeas.textContent = (item.measures||[]).map(m=>`${m.name}:${m.grams}جم`).join("، ");

    const tdOps = document.createElement("td");
    const eb = document.createElement("button"); eb.className="btn light"; eb.textContent="تعديل";
    eb.onclick = ()=> openDialog(item);
    tdOps.appendChild(eb);

    tr.append(tdImg, tdName, tdCat, tdAct, tdMeas, tdOps);
    frag.appendChild(tr);
  });
  els.tableBody.appendChild(frag);
}

/* ========= مستمعو UI (آمن) ========= */
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
  $("btn-cards")?.classList.add("active");
  $("btn-table")?.classList.remove("active");
  if(els.cards) els.cards.hidden = false;
  if(els.tableWrap) els.tableWrap.hidden = true;
}, "btn-cards");

on($("btn-table"), "click", ()=>{
  $("btn-table")?.classList.add("active");
  $("btn-cards")?.classList.remove("active");
  if(els.cards) els.cards.hidden = true;
  if(els.tableWrap) els.tableWrap.hidden = false;
}, "btn-table");

on($("prev"), "click", async ()=>{
  if(paging.page <= 1) return;
  paging.page -= 1;
  await fetchAndRender(true);
}, "prev");

on($("next"), "click", async ()=>{
  if(!currentQuerySnapshot || currentQuerySnapshot.size < paging.pageSize) return;
  paging.page += 1;
  await fetchAndRender(false);
}, "next");

/* ========= تشغيل ========= */
onAuthStateChanged(auth, async (u)=>{
  user = u || null;
  await showAdmin(u);     // عرض اسم الأدمن في الهيدر
  await fetchAndRender(true);
});

// معاينة فورية للرابط + تفعيل الرفع
if(els.imageUrl && els.preview){ els.imageUrl.addEventListener("input", ()=> els.preview.src = els.imageUrl.value || ""); }
ensureUpload();
