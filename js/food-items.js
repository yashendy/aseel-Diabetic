// ============ Firebase SDK via CDN ============
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy,
  limit, startAfter, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.1/firebase-storage.js";

// --------- Firebase Config ---------
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
const state = { page:1,lastDoc:null,q:"",category:"",dietSystem:"",sort:"createdAt_desc",cache:new Map(),currentDocs:[],view:"cards" };

// ============ Utils ============
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function resolveImageUrl(path){
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const isGH = location.hostname.endsWith("github.io");
  const base = isGH ? location.origin + "/" + location.pathname.split("/")[1] + "/" : location.origin + "/";
  return base + (path[0]==="/" ? path.slice(1) : path);
}

// ============ Renderers ============
// (الكروت والجدول – نفس منطقك)
function cardTpl(id, data){
  const img = resolveImageUrl(data.imageUrl || "");
  const activeBadge = data.isActive!==false ? `<span class="badge green">نشط</span>` : `<span class="badge gray">غير نشط</span>`;
  return `
    <div class="card" data-id="${id}">
      <div class="head">
        <div class="title">${data.name||"-"}</div>
        ${activeBadge}
      </div>
      <img class="thumb" src="${img}" alt="" onerror="this.src='';this.style.background='#f1f5f9'"/>
      <div class="muted">${data.category||"—"}</div>
      <div class="muted">GI: ${data.gi??"—"} | كارب/100g: ${data.carbs_g??"—"}</div>
      <div class="actions">
        <button class="btn light" data-edit="${id}">تعديل</button>
      </div>
    </div>`;
}

function renderCards(docs){
  const el = $("#list");
  el.className = "cards";
  el.innerHTML = docs.map(d => cardTpl(d.id, d.data())).join("") || `<div class="muted">لا توجد نتائج</div>`;
  $$("#list [data-edit]").forEach(b=>b.onclick=()=>openEditDialog(b.dataset.edit));
}

function renderTable(docs){
  const el = $("#list");
  el.className = "table-wrap";
  const rows = docs.map(d => {
    const data = d.data();
    const img = resolveImageUrl(data.imageUrl || "");
    return `<tr>
      <td><img class="thumb" src="${img}" alt="" onerror="this.src='';this.style.background='#f1f5f9'"/></td>
      <td>${data.name||"-"}</td>
      <td>${data.category||"-"}</td>
      <td>${data.gi??"—"}</td>
      <td>${data.carbs_g??"—"}</td>
      <td>${data.isActive!==false?"نشط":"غير نشط"}</td>
      <td><button class="btn light" data-edit="${d.id}">تعديل</button></td>
    </tr>`;
  }).join("");
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>صورة</th><th>الاسم</th><th>الفئة</th><th>GI</th><th>كارب/100g</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="muted">لا توجد نتائج</td></tr>`}</tbody>
      </table>
    </div>`;
  $$("#list [data-edit]").forEach(b=>b.onclick=()=>openEditDialog(b.dataset.edit));
}

// ============ Query builder ============
function buildQuery(){
  const base = collection(db, ...COLL_PATH);
  const filters = [];
  if (state.onlyActive === true)  filters.push(where("isActive","==",true));
  if (state.onlyActive === false) filters.push(where("isActive","==",false));
  if (state.category) filters.push(where("category","==",state.category));
  if (state.dietSystem) filters.push(where("dietSystems","array-contains",state.dietSystem));

  let qy;
  if ((state.sortBy||state.sort)==="name_asc") {
   qy = query(base, ...filters, orderBy("name","asc"), limit(PAGE_SIZE));
  } else {
   qy = query(base, ...filters, orderBy("createdAt","desc"), limit(PAGE_SIZE));
  }
  if (state.lastDoc) qy = query(qy, startAfter(state.lastDoc));
  return qy;
}

// ============ Fetch ============
async function fetchAndRender(reset=true){
  if (reset){ state.page=1; state.lastDoc=null; }
  const qy = buildQuery();
  const snap = await getDocs(qy);
  state.currentDocs = snap.docs;
  state.lastDoc = snap.docs[snap.docs.length-1] || null;

  const mode = state.view || "cards";
  if (mode === "table") renderTable(snap.docs);
  else renderCards(snap.docs);

  $("#page-info") && ( $("#page-info").textContent = `صفحة ${state.page}` );
}

// ============ Normalizers / Helpers ============
function normalizeLegacyFields(d){
  // تطبيع حقول قديمة لو موجودة
  if (typeof d.createdAt === "string") d.createdAt = new Date(d.createdAt);
  return d;
}

// ============ Filters ============
// Helper: safe bind that ignores missing elements
const bind = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

// search
bind($("#q"), "input", debounce(e => {
  state.q = e.target.value.trim();
  fetchAndRender(true);
}, 300));

// category: support #category or #category-filter
const elCategory = $("#category") || $("#category-filter");
bind(elCategory, "input", e => {
  state.category = (e.target.value || "").trim();
  fetchAndRender(true);
});

// active only: checkbox(#onlyActive) or select(#active-filter)
const elOnlyActiveChk = $("#onlyActive");
const elActiveSelect = $("#active-filter");
if (elOnlyActiveChk) {
  bind(elOnlyActiveChk, "change", e => {
    state.onlyActive = e.target.checked;
    fetchAndRender(true);
  });
} else if (elActiveSelect) {
  bind(elActiveSelect, "change", e => {
    const v = e.target.value;
    state.onlyActive = v === "active-only" ? true : v === "inactive-only" ? false : undefined;
    fetchAndRender(true);
  });
}

// sort: #sortBy or #sort
const elSort = $("#sortBy") || $("#sort");
bind(elSort, "change", e => {
  state.sortBy = e.target.value;
  fetchAndRender(true);
});

// diet system: #dietSystem or #diet-filter
const elDiet = $("#dietSystem") || $("#diet-filter");
bind(elDiet, "change", e => {
  state.dietSystem = e.target.value;
  fetchAndRender(true);
});

// paging
$("#next-page")?.addEventListener("click", async () => {
  if (!state.lastDoc) return;
  state.page++;
  await fetchAndRender(false);
});
$("#prev-page")?.addEventListener("click", async () => {
  if (state.page === 1) return;
  state.page--;
  state.lastDoc = null;
  for (let i = 1; i < state.page; i++) await getDocs(buildQuery());
  await fetchAndRender(false);
});

// view tabs (keep original if present)
$("#tab-cards")?.addEventListener("click", () => {
  state.view = "cards";
  $("#tab-cards").classList.add("active");
  $("#tab-table").classList.remove("active");
  $("#cards-view").classList.remove("hidden");
  $("#table-view").classList.add("hidden");
});
$("#tab-table")?.addEventListener("click", () => {
  state.view = "table";
  $("#tab-table").classList.add("active");
  $("#tab-cards").classList.remove("active");
  $("#table-view").classList.remove("hidden");
  $("#cards-view").classList.add("hidden");
});

// ============ Add / Edit ============
$("#btn-add").onclick=()=>openEditDialog(null);

async function openEditDialog(id){
  const dlg=$("#edit-dialog"), form=$("#edit-form");
  $("#btn-delete").classList.toggle("hidden",!id);
  $("#edit-title").textContent=id?"تعديل صنف":"إضافة صنف";
  form.reset(); form.dataset.id=id||"";
  let data={}; if(id){ data=state.cache.get(id) || (await getDoc(doc(db,...COLL_PATH,id))).data() || {}; }
  data=normalizeLegacyFields(data);

  form.elements["name"].value=data.name||"";
  form.elements["category"].value=data.category||"اخرى";
  form.elements["imageUrl"].value=data.imageUrl||"";
  form.elements["isActive"].checked=(data.isActive!==false);
  form.elements["cal_kcal"].value=(data.cal_kcal??"");
  form.elements["carbs_g"].value=(data.carbs_g??"");
  form.elements["protein_g"].value=(data.protein_g??"");
  form.elements["fat_g"].value=(data.fat_g??"");
  form.elements["fiber_g"].value=(data.fiber_g??"");
  form.elements["gi"].value=(data.gi??"");
  form.elements["sodium_mg"].value=(data.sodium_mg??"");
  form.elements["dietTagsManual"].value=(data.dietTagsManual||[]).join(", ");
  form.elements["dietSystemsManual"].value=(data.dietSystemsManual||[]).join(", ");
  form.elements["hashTagsManual"].value=(data.hashTagsManual||[]).join(", ");

  const prev=$("#image-preview"); if(prev) prev.src=resolveImageUrl(data.imageUrl||"");
  if (form.elements["imageUrl"]) {
    form.elements["imageUrl"].addEventListener("input",e=>{
      const img=$("#image-preview"); if(img) img.src=resolveImageUrl(e.target.value.trim()||"");
    }, { once:true });
  }

  dlg.showModal();
  ensureImageControls(); // ← يضمن وجود زر الرفع حتى لو HTML قديم
}

["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg","category","name","dietTagsManual","dietSystemsManual"]
  .forEach(n=>{$("#edit-form").elements[n]?.addEventListener("input",renderAutoTagsPreview);});

function renderAutoTagsPreview(){
  const f=$("#edit-form"); if(!f) return;
  const h=f.elements["hashTagsManual"].value.trim();
  const d=f.elements["dietSystemsManual"].value.trim();
  $("#auto-tags").textContent = h || "—";
  $("#auto-diets").textContent = d || "—";
}

// ============ Save ============
$("#edit-form").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const id=e.currentTarget.dataset.id||null;
  const fd=new FormData(e.currentTarget);
  const payload=Object.fromEntries(fd.entries());
  payload.isActive=$("#edit-form").elements["isActive"].checked;
  if(payload.imageUrl && !/^https?:\/\//.test(payload.imageUrl)){ payload.imageUrl=''; }
  ["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg"].forEach(k=>payload[k]=payload[k]===""?null:Number(payload[k]));
  payload.dietTagsManual=(payload.dietTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  payload.dietSystemsManual=(payload.dietSystemsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  payload.hashTagsManual=(payload.hashTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);

  const batch = writeBatch(db);
  let docRef;
  if(id){
    docRef = doc(db, ...COLL_PATH, id);
    batch.update(docRef, { ...payload, updatedAt: serverTimestamp() });
  } else {
    // إضافة جديدة: ننشئ doc id أولًا حتى نقدر نرفق له صورة لاحقًا
    docRef = doc(collection(db, ...COLL_PATH));
    batch.set(docRef, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  await batch.commit();
  $("#edit-dialog").close();
  await fetchAndRender(true);
});

// ============ Delete ============
$("#btn-delete").onclick=async()=>{
  const id=$("#edit-form").dataset.id;
  if(!id) return;
  if(!confirm("هل أنتِ متأكدة من حذف هذا الصنف؟")) return;
  const b = writeBatch(db);
  b.update(doc(db, ...COLL_PATH, id), { isActive:false, updatedAt: serverTimestamp() });
  await b.commit();
  $("#edit-dialog").close();
  await fetchAndRender(true);
};

// ============ Import / Export (مختصر كما هو عندك) ============
// ... (لو عندك دوال الاستيراد/التصدير، تظل كما هي) ...

// ============ رفع الصورة + حفظ الرابط ============
function ensureImageControls() {
  const form = document.getElementById('edit-form');
  if (!form) return;

  let urlInput = form.querySelector('input[name="imageUrl"]');
  if (!urlInput) {
    const firstLabel = form.querySelector('.grid label') || form;
    const wrapper = document.createElement('label');
    wrapper.innerHTML = `
      صورة (رابط)
      <div class="img-row">
        <input name="imageUrl" placeholder="https://..." />
        <label class="file-input">
          <input id="image-file" type="file" accept="image/*" />
          <span>تحميل صورة</span>
        </label>
        <img id="image-preview" class="thumb-mini" alt="" />
        <small id="image-status" class="muted"></small>
      </div>`;
    firstLabel.parentElement.insertBefore(wrapper, firstLabel);
    urlInput = wrapper.querySelector('input[name="imageUrl"]');
    if(urlInput){ urlInput.readOnly=true; urlInput.classList.add('visually-hidden'); }
  }

  if (form.elements["imageUrl"]) {
    form.elements["imageUrl"].addEventListener("input",e=>{
      const img=$("#image-preview"); if(img) img.src=resolveImageUrl(e.target.value.trim()||"");
    }, { once:true });
  }

  let row = urlInput.closest('.img-row');
  if(urlInput){ urlInput.readOnly=true; urlInput.classList.add('visually-hidden'); }
  if (!row) {
    row = document.createElement('div');
    row.className = 'img-row';
    urlInput.parentElement.appendChild(row);
    row.appendChild(urlInput);
  }

  let fileInput = row.querySelector('#image-file');
  if (!fileInput) {
    const fileLabel = document.createElement('label');
    fileLabel.className = 'file-input';
    fileLabel.innerHTML = `<input id="image-file" type="file" accept="image/*" /><span>تحميل صورة</span>`;
    row.appendChild(fileLabel);
    fileInput = fileLabel.querySelector('#image-file');
  }

  let preview = row.querySelector('#image-preview');
  if (!preview) {
    preview = document.createElement('img');
    preview.id = 'image-preview';
    preview.className = 'thumb-mini';
    row.appendChild(preview);
  }

  let status = row.querySelector('#image-status');
  if (!status) {
    status = document.createElement('small');
    status.id = 'image-status';
    status.className = 'muted';
    row.appendChild(status);
  }

  if (!urlInput._boundPreview) {
    urlInput.addEventListener('input', e=>{
      const v=(e.target.value||'').trim();
      preview.src = v || '';
    });
    urlInput._boundPreview = true;
  }

  if (!fileInput._boundUpload) {
    fileInput.addEventListener('change', async (e)=>{
      const file = e.target.files?.[0];
      if (!file) return;
      if(!/^image\//.test(file.type)){ alert('الملف المختار ليس صورة'); return; }
      if(file.size > 5*1024*1024){ alert('حجم الصورة كبير، الحد الأقصى 5MB'); return; }

      const uid = auth.currentUser?.uid || 'anon';
      const path = `food-items/${uid}/${Date.now()}-${file.name}`;
      const ref  = sRef(storage, path);
      try{
        status.textContent = 'جارِ الرفع...';
        const task = uploadBytesResumable(ref, file);
        task.on('state_changed', (snap)=>{
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          status.textContent = `جارِ الرفع… ${pct}%`;
        });
        await task;
        const url = await getDownloadURL(ref);
        urlInput.value = url;
        preview.src    = url;
        status.textContent = '✔️ تم الرفع وحُفِظ الرابط';
        // إن كان الصنف موجودًا (تعديل)، حدّث Firestore فورًا ليظهر في الموقع مباشرة
        try{
          const itemId = form.dataset.id;
          if (itemId) {
            const b = writeBatch(db);
            const dref = doc(collection(db, ...COLL_PATH), itemId);
            b.update(dref, { imageUrl: url, updatedAt: serverTimestamp() });
            await b.commit();
            status.textContent = '✔️ تم الرفع والحفظ في قاعدة البيانات';
          } else {
            status.textContent = '✔️ تم الرفع — سيتم الحفظ عند حفظ النموذج';
          }
        }catch(err){
          console.error(err);
          status.textContent = 'تم الرفع لكن تعذّر الحفظ التلقائي، احفظي النموذج يدويًا';
          alert('تم رفع الصورة، لكن لم يُحدّث المستند تلقائيًا. احفظي النموذج.');
        }
      }catch(err){
        console.error(err);
        alert('تعذّر رفع الصورة. تحققي من الاتصال والصلاحيات.');
        status.textContent = 'فشل الرفع';
      }
    });
    fileInput._boundUpload = true;
  }
}

// ============ Auth ============
onAuthStateChanged(auth, async (user)=>{
  if(!user){
    try{ await signInWithPopup(auth,new GoogleAuthProvider()); }
    catch(e){ console.error(e); alert("يلزم تسجيل الدخول."); return; }
  }
  const name=auth.currentUser?.displayName||auth.currentUser?.email||"مسؤول";
  const el=$("#admin-name"); if(el) el.textContent=name;
  fetchAndRender(true);
});
$("#btn-signout")?.addEventListener("click",()=>signOut(auth));

// ============ Close dialogs ============
$$("dialog [data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
