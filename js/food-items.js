/******************************************************
 * food-items.js  — Admin “مكتبة الأصناف”
 * Firebase Modular (CDN) — كلّه في ملف واحد
 * آخر تحديث: 2025-10-06
 ******************************************************/

/* =========[ 1) SELECTORS: لو IDs مختلفة عندك عدّلي هنا ]========= */
const SEL = {
  adminName: "#adminName",
  addBtn: "#addBtn",
  importBtn: "#importBtn",
  exportBtn: "#exportBtn",
  refreshBtn: "#refreshBtn",
  logoutBtn: "#logoutBtn",
  activeOnly: "#activeOnly",
  categoryFilter: "#categoryFilter",
  searchInput: "#searchInput",
  itemsGrid: "#itemsGrid",
};

/* =========[ 2) Firebase Config (منك) ]========= */
// ملاحظة: صححت storageBucket -> appspot.com (بدل firebasestorage.app)
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};

/* =========[ 3) Firebase (CDN) Imports ]========= */
import {
  initializeApp, getApps, getApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, onSnapshot, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* =========[ 4) App Init ]========= */
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========[ 5) Collection Path ]========= */
const FOOD_COLL = collection(db, "admin", "global", "foodItems");

/* =========[ 6) Utilities ]========= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

const uniq = arr => Array.from(new Set(arr.filter(Boolean).map(s => (s+"").trim())));

/* =========[ 7) Auto diet tags + hashtags ]========= */
function generateDietTags(item) {
  // توقعنا التركيب:
  // item.nutrPer100g = { cal_kcal, carbs_g, fat_g, protein_g, sodium_mg, fiber_g }
  const n = item.nutrPer100g || {};
  const carbs = Number(n.carbs_g ?? 0);
  const protein = Number(n.protein_g ?? 0);
  const sodium = Number(n.sodium_mg ?? 0);
  const fat = Number(n.fat_g ?? 0);

  const tags = new Set(item.dietTags || []);

  // معايير بسيطة (عدّليها براحتك)
  if (carbs <= 5) { tags.add("لو_كارب"); tags.add("كيتو"); }
  if (sodium > 0 && sodium < 140) tags.add("قليل_الملح");
  if (protein >= 10) tags.add("بروتين");
  if (fat <= 3 && carbs <= 12) tags.add("دايت");
  // مثال إضافي
  if (carbs >= 30) tags.add("كرب_عالي");

  return Array.from(tags);
}

function generateHashtags(item) {
  // ندمج التصنيف + dietTags + كلمات من الاسم/الوصف
  const words = [];
  const cat = (item.category || "").trim();
  const nameAR = (item.name_ar || item.name || "").trim();
  const desc = (item.desc_ar || item.desc || "").trim();
  const dietTags = item.dietTags || [];

  if (cat) words.push(cat);
  dietTags.forEach(t => words.push(t));

  // كلمات بسيطة من الاسم والوصف (بدون أرقام ورموز)
  const tokenize = (txt) =>
    (txt || "")
      .replace(/[^\p{Letter}\p{Number}\s_]+/gu, " ")
      .split(/\s+/)
      .filter(w => w && w.length > 1)
      .slice(0, 6); // بلاش هاشتاج كتير

  tokenize(nameAR).forEach(w => words.push(w));
  tokenize(desc).forEach(w => words.push(w));

  // نحولها هاشتاج عربي/انجليزي مسموح
  const toHash = w => "#" + w.replace(/\s+/g, "_");
  const hashtags = uniq(words.map(toHash));

  return hashtags;
}

/* =========[ 8) Render Cards ]========= */
function renderItemCard(item, id) {
  const isActive = item.isActive !== false; // default true
  const img = item.imageUrl || "https://via.placeholder.com/150x120?text=Image";
  const name = item.name_ar || item.name || "—";
  const cat = item.category || "—";
  const hashtags = item.hashtags || [];
  const dietTags = item.dietTags || [];
  const measureText = (() => {
    const arr = item.measures || [];
    if (!arr.length) return "";
    const m0 = arr[0];
    const g = m0.grams ? `(${m0.grams}جم)` : "";
    return `${m0.name || "حصة"} ${g}`;
  })();

  return `
    <div class="card ${isActive ? "" : "muted"}" data-id="${id}">
      <div class="card-img"><img src="${img}" alt="" loading="lazy"/></div>
      <div class="card-body">
        <div class="card-title">${name}</div>
        <div class="card-sub">${cat}${measureText ? ` · ${measureText}` : ""}</div>

        <div class="pill-row">
          ${dietTags.map(t => `<span class="pill pill-soft">${t}</span>`).join("")}
          ${hashtags.slice(0,6).map(h => `<span class="pill pill-hash">${h}</span>`).join("")}
        </div>

        <div class="card-actions">
          <button class="btn btn-danger btn-small js-del">حذف</button>
          <button class="btn btn-light btn-small js-edit">تعديل</button>
        </div>
      </div>
    </div>
  `;
}

/* =========[ 9) State + Live Query ]========= */
let unsub = null;
let lastSnapshot = [];

function applyFiltersAndRender() {
  const grid = $(SEL.itemsGrid);
  if (!grid) return;

  const activeOnly = $(SEL.activeOnly)?.checked ?? false;
  const cat = $(SEL.categoryFilter)?.value ?? "(الكل)";
  const qtxt = ($(SEL.searchInput)?.value || "").trim().toLowerCase();

  const pass = (it) => {
    if (activeOnly && it.data.isActive === false) return false;
    if (cat && cat !== "(الكل)" && (it.data.category || "") !== cat) return false;

    if (qtxt) {
      const hay = [
        it.data.name_ar, it.data.name, it.data.desc_ar, it.data.desc,
        ...(it.data.hashtags || []), ...(it.data.dietTags || [])
      ].join(" ").toLowerCase();
      return hay.includes(qtxt);
    }
    return true;
  };

  const list = lastSnapshot.filter(pass);
  grid.innerHTML = list.map(it => renderItemCard(it.data, it.id)).join("") || `
    <div class="empty">لا توجد أصناف مطابقة.</div>
  `;

  // bind edit/delete
  $$(SEL.itemsGrid + " .card .js-edit").forEach(btn => {
    btn.addEventListener("click", onEditClick);
  });
  $$(SEL.itemsGrid + " .card .js-del").forEach(btn => {
    btn.addEventListener("click", onDeleteClick);
  });
}

function startLive() {
  if (unsub) unsub(); // أوقف السابق
  const q = query(FOOD_COLL, orderBy("createdAt", "desc"));
  unsub = onSnapshot(q, (snap) => {
    lastSnapshot = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    applyFiltersAndRender();
  }, (err) => {
    console.error("Snapshot error:", err);
  });
}

/* =========[ 10) CRUD Dialog (Minimal) ]========= */
function promptItemData(existing = {}) {
  // نافذة بسيطة: عدّلي بحرية لاحقًا
  const name_ar = prompt("اسم الصنف (AR):", existing.name_ar || "")?.trim();
  if (name_ar == null || !name_ar) throw new Error("الاسم العربي مطلوب.");

  const category = prompt("التصنيف:", existing.category || "")?.trim() || "";
  const imageUrl = prompt("رابط الصورة:", existing.imageUrl || "")?.trim() || "";

  const carbs = Number(prompt("كارب (لكل 100g):", existing?.nutrPer100g?.carbs_g ?? 0) || 0);
  const protein = Number(prompt("بروتين (لكل 100g):", existing?.nutrPer100g?.protein_g ?? 0) || 0);
  const fat = Number(prompt("دهون (لكل 100g):", existing?.nutrPer100g?.fat_g ?? 0) || 0);
  const kcal = Number(prompt("سعرات (لكل 100g):", existing?.nutrPer100g?.cal_kcal ?? 0) || 0);
  const sodium = Number(prompt("صوديوم mg (اختياري):", existing?.nutrPer100g?.sodium_mg ?? 0) || 0);
  const fiber = Number(prompt("ألياف g (اختياري):", existing?.nutrPer100g?.fiber_g ?? 0) || 0);

  const isActive = confirm("نشِط؟ (موافق=نعم / إلغاء=لا)") ? true : false;

  const item = {
    name_ar,
    category,
    imageUrl,
    isActive,
    nutrPer100g: { cal_kcal: kcal, carbs_g: carbs, fat_g: fat, protein_g: protein, sodium_mg: sodium, fiber_g: fiber },
    measures: existing.measures || [{ name: "حصة", grams: 100 }],
    createdAt: existing.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // auto diet & hashtags
  item.dietTags = generateDietTags(item);
  item.hashtags = generateHashtags(item);

  return item;
}

async function onAddClick() {
  try {
    const item = promptItemData(); // throws if cancel
    await addDoc(FOOD_COLL, item);
    alert("تمت الإضافة بنجاح.");
  } catch (e) {
    if (e && e.message) alert(e.message);
    console.warn(e);
  }
}

async function onEditClick(e) {
  const card = e.currentTarget.closest(".card");
  const id = card?.dataset?.id;
  if (!id) return;
  const ref = doc(FOOD_COLL, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return alert("لم يتم العثور على الصنف.");

  try {
    const item = promptItemData(snap.data());
    await updateDoc(ref, item);
    alert("تم الحفظ.");
  } catch (err) {
    if (err && err.message) alert(err.message);
    console.warn(err);
  }
}

async function onDeleteClick(e) {
  const card = e.currentTarget.closest(".card");
  const id = card?.dataset?.id;
  if (!id) return;
  if (!confirm("حذف الصنف نهائياً؟")) return;
  await deleteDoc(doc(FOOD_COLL, id));
}

/* =========[ 11) Import / Export Excel (SheetJS) ]========= */
async function ensureXLSX() {
  if (window.XLSX) return;
  await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
}

async function onExportClick() {
  try {
    await ensureXLSX();
    const snap = await getDocs(FOOD_COLL);
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // نبسّط الحقول المسطحة للتصدير
    const flat = rows.map(r => ({
      id: r.id,
      name_ar: r.name_ar || "",
      category: r.category || "",
      imageUrl: r.imageUrl || "",
      isActive: r.isActive !== false,
      kcal_100g: r?.nutrPer100g?.cal_kcal ?? "",
      carbs_100g: r?.nutrPer100g?.carbs_g ?? "",
      fat_100g: r?.nutrPer100g?.fat_g ?? "",
      protein_100g: r?.nutrPer100g?.protein_g ?? "",
      sodium_mg_100g: r?.nutrPer100g?.sodium_mg ?? "",
      fiber_100g: r?.nutrPer100g?.fiber_g ?? "",
      measures_json: JSON.stringify(r.measures || []),
      dietTags: (r.dietTags || []).join(","),
      hashtags: (r.hashtags || []).join(","),
    }));

    const ws = XLSX.utils.json_to_sheet(flat);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "foodItems");
    XLSX.writeFile(wb, "foodItems_export.xlsx");
  } catch (err) {
    console.error(err);
    alert("تعذَّر التصدير.");
  }
}

async function onImportClick() {
  try {
    await ensureXLSX();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const wsName = wb.SheetNames[0];
      const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wsName]);

      // نتوقع الحقول اللي صدّرناها (أو على الأقل name_ar + category)
      const batch = [];
      for (const row of sheet) {
        const docData = {
          name_ar: (row.name_ar || "").toString().trim(),
          category: (row.category || "").toString().trim(),
          imageUrl: (row.imageUrl || "").toString().trim(),
          isActive: String(row.isActive).toLowerCase() !== "false",
          nutrPer100g: {
            cal_kcal: Number(row.kcal_100g ?? 0),
            carbs_g: Number(row.carbs_100g ?? 0),
            fat_g: Number(row.fat_100g ?? 0),
            protein_g: Number(row.protein_100g ?? 0),
            sodium_mg: Number(row.sodium_mg_100g ?? 0),
            fiber_g: Number(row.fiber_100g ?? 0),
          },
          measures: [],
          updatedAt: serverTimestamp(),
        };

        // measures_json إن وُجد
        if (row.measures_json) {
          try { docData.measures = JSON.parse(row.measures_json); } catch {}
        } else {
          docData.measures = [{ name: "حصة", grams: 100 }];
        }

        // توليد تلقائي
        docData.dietTags = generateDietTags(docData);
        docData.hashtags = generateHashtags(docData);

        // لو فيه id نحدث، غير كده نضيف جديد
        const id = row.id && String(row.id).trim();
        if (id) {
          batch.push(setDoc(doc(FOOD_COLL, id), {
            createdAt: serverTimestamp(), // لو جديد
            ...docData
          }, { merge: true }));
        } else {
          batch.push(addDoc(FOOD_COLL, {
            createdAt: serverTimestamp(),
            ...docData
          }));
        }
      }

      await Promise.all(batch);
      alert("تم الاستيراد/التحديث.");
    };
    input.click();
  } catch (e) {
    console.error(e);
    alert("تعذَّر الاستيراد.");
  }
}

/* =========[ 12) Filters Bind ]========= */
function bindFilters() {
  $(SEL.activeOnly)?.addEventListener("change", applyFiltersAndRender);
  $(SEL.categoryFilter)?.addEventListener("change", applyFiltersAndRender);
  $(SEL.searchInput)?.addEventListener("input", () => {
    // تهدئة بسيطة
    clearTimeout(window.__searchDebounce);
    window.__searchDebounce = setTimeout(applyFiltersAndRender, 150);
  });
}

/* =========[ 13) Admin Name + Auth ]========= */
async function showAdminName(user) {
  try {
    // users/{uid} -> displayName
    const uref = doc(db, "users", user.uid);
    const usnap = await getDoc(uref);
    const name = usnap.exists() ? (usnap.data().displayName || usnap.data().name || user.email || "admin") : (user.email || "admin");
    const el = $(SEL.adminName);
    if (el) el.textContent = name;
  } catch {
    const el = $(SEL.adminName);
    if (el) el.textContent = "admin";
  }
}

function bindTopButtons() {
  $(SEL.addBtn)?.addEventListener("click", onAddClick);
  $(SEL.importBtn)?.addEventListener("click", onImportClick);
  $(SEL.exportBtn)?.addEventListener("click", onExportClick);
  $(SEL.refreshBtn)?.addEventListener("click", () => applyFiltersAndRender());
  $(SEL.logoutBtn)?.addEventListener("click", async () => {
    await signOut(auth);
    location.reload();
  });
}

/* =========[ 14) Boot ]========= */
async function boot() {
  bindTopButtons();
  bindFilters();

  // Auth: إن لم يوجد جلسة -> نسجّل مجهول
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      await signInAnonymously(auth);
      return;
    }
    await showAdminName(user);
    startLive();
  });
}

// ابدأ
boot();

/* =========[ 15) Light Styling Helper (اختياري: تجاهلي لو عندك CSS) ]========= */
/* ده مجرد fallback بسيط، يفضل استخدام ملف CSS عندك للثيم الفاتح */
const style = document.createElement("style");
style.innerHTML = `
  .card {display:flex; background:#fff; border:1px solid #eee; border-radius:14px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.06); margin:12px;}
  .card.muted {opacity:.6}
  .card-img {width:160px; min-width:160px; background:#fafafa; display:flex; align-items:center; justify-content:center;}
  .card-img img {width:100%; height:100%; object-fit:cover}
  .card-body {padding:12px 14px; flex:1}
  .card-title {font-weight:700; margin-bottom:4px; font-size:18px}
  .card-sub {color:#666; margin-bottom:8px}
  .pill-row {display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px}
  .pill {padding:4px 8px; border-radius:999px; font-size:12px; background:#f1f3f5; color:#333}
  .pill-soft {background:#e7f5ff; color:#0b7285}
  .pill-hash {background:#f8f9fa; color:#495057; border:1px dashed #dee2e6}
  .card-actions {display:flex; gap:8px}
  .btn {padding:8px 12px; border-radius:10px; border:1px solid #ddd; background:#fff; cursor:pointer}
  .btn:hover {background:#f8f9fa}
  .btn-small {padding:6px 10px; font-size:12px}
  .btn-danger {background:#212529; color:#fff; border-color:#212529}
  .btn-light {background:#fff}
  .empty {padding:24px; text-align:center; color:#666}
`;
document.head.appendChild(style);
