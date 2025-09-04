// js/food-items.js
// يستورد تهيئة Firebase (db, auth)
import { db, auth } from "./firebase-config.js";
import {
  collection, getDocs, query, orderBy, addDoc,
  doc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// عناصر الواجهة
const searchInput = document.getElementById("searchInput");
const categorySel = document.getElementById("categoryFilter");
const tbody       = document.getElementById("itemsTbody");
const btnRefresh  = document.getElementById("btnRefresh");
const btnAdd      = document.getElementById("btnAdd");

// نافذة الإضافة/التعديل — ديناميكية
const dialog = document.createElement("dialog");
dialog.id = "itemDialog";
dialog.innerHTML = `
  <div class="modal-head">
    <strong id="dlgTitle">إضافة صنف</strong>
    <button id="btnCloseDlg" class="btn ghost" type="button">إغلاق</button>
  </div>
  <form id="itemForm" class="modal-body">
    <input type="hidden" id="docId" />
    <div class="grid-2">
      <div class="field"><input id="fName" required placeholder="اسم الصنف (إلزامي)" /></div>
      <div class="field"><input id="fBrand" placeholder="البراند (اختياري)" /></div>
    </div>
    <div class="grid-2">
      <div class="field"><input id="fCategory" placeholder="الفئة (مثل: مشروبات، ألبان…)" /></div>
      <div class="field"><input id="fImage" placeholder="رابط صورة مصغّرة (اختياري)" /></div>
    </div>
    <div class="grid-2">
      <div class="field"><input id="fMeasureName" placeholder="اسم القياس (مثال: كوب، قطعة…)" /></div>
      <div class="field"><input id="fMeasureQty" type="number" step="any" placeholder="الكمية (مثال: 160)" /></div>
    </div>
    <p class="note">
      الحفظ في <code>admin/global/foodItems</code>. حسب القواعد، الكتابة للأدمن فقط.
    </p>
    <div class="modal-actions">
      <button class="btn" type="submit">حفظ</button>
      <button class="btn ghost" type="reset">تفريغ الحقول</button>
    </div>
  </form>
`;
document.body.appendChild(dialog);

const btnCloseDlg  = dialog.querySelector("#btnCloseDlg");
const itemForm     = dialog.querySelector("#itemForm");
const dlgTitle     = dialog.querySelector("#dlgTitle");
const docIdEl      = dialog.querySelector("#docId");
const fName        = dialog.querySelector("#fName");
const fBrand       = dialog.querySelector("#fBrand");
const fCategory    = dialog.querySelector("#fCategory");
const fImage       = dialog.querySelector("#fImage");
const fMeasureName = dialog.querySelector("#fMeasureName");
const fMeasureQty  = dialog.querySelector("#fMeasureQty");

// حالة الصفحة
let allItems = [];
let currentFilter = { q: "", cat: "__ALL__" };
let isAdmin = false; // تُضبط بعد التحقق من users/{uid}

const FOOD_PATH = "admin/global/foodItems";

// --- أدوات مساعدة ---
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}
function asMeasurePreview(it){
  let measureText = "—";
  if (Array.isArray(it.measures) && it.measures.length > 0) {
    const m0 = it.measures[0];
    const name = m0?.name ?? "";
    const qty  = m0?.grams ?? m0?.gi ?? m0?.measureQty ?? "";
    measureText = [name, qty].filter(Boolean).join(" / ");
  }
  return measureText;
}

// --- تحميل البيانات (مع fallback) ---
async function fetchAllFood() {
  try {
    const q1 = query(collection(db, FOOD_PATH), orderBy("name"));
    const snap = await getDocs(q1);
    return snap.docs.map(s => ({ id: s.id, ...s.data() }));
  } catch {
    const snap = await getDocs(collection(db, FOOD_PATH));
    return snap.docs.map(s => ({ id: s.id, ...s.data() }));
  }
}

// --- رسم الجدول ---
function render() {
  const q = (currentFilter.q || "").trim().toLowerCase();
  const cat = currentFilter.cat;

  const filtered = allItems.filter(it => {
    const inCat = cat === "__ALL__" || (it.category || "").toLowerCase() === cat.toLowerCase();
    const inTxt = !q ||
      (it.name && it.name.toLowerCase().includes(q)) ||
      (it.brand && it.brand.toLowerCase().includes(q));
    return inCat && inTxt;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td class="empty" colspan="7">لا توجد أصناف مطابقة.</td></tr>`;
    return;
  }

  const rows = filtered.map(it => {
    const img = it.imageUrl ? it.imageUrl : "";
    const brand = it.brand || "—";
    const catText = it.category || "—";
    const measureText = asMeasurePreview(it);

    const actions = isAdmin
      ? `<td class="actions-cell">
           <button class="btn small secondary act-edit" data-id="${it.id}">تعديل</button>
           <button class="btn small danger act-del" data-id="${it.id}">حذف</button>
         </td>`
      : `<td class="actions-cell"></td>`;

    return `
      <tr data-id="${it.id}">
        <td><img class="thumb" src="${img}" alt="" loading="lazy" /></td>
        <td>
          <div class="meta">
            <strong>${escapeHtml(it.name || "بدون اسم")}</strong>
            ${it.nutPer100g ? `<span class="muted">س.غذائي/100g متوفر</span>` : ``}
          </div>
        </td>
        <td class="muted">${escapeHtml(brand)}</td>
        <td><span class="chip">${escapeHtml(catText)}</span></td>
        <td class="muted">${escapeHtml(String(measureText))}</td>
        <td class="muted">${it.id}</td>
        ${actions}
      </tr>
    `;
  }).join("");

  tbody.innerHTML = rows;
}

// --- تعبئة فئات الفلتر ---
function populateCategories() {
  const set = new Set();
  allItems.forEach(it => { if (it.category) set.add(it.category); });

  const current = categorySel.value || "__ALL__";
  categorySel.innerHTML = `<option value="__ALL__">كل الفئات</option>` +
    Array.from(set).sort((a,b)=>a.localeCompare(b,"ar")).map(c =>
      `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  if ([...set].some(c => c === current)) categorySel.value = current;
  else categorySel.value = "__ALL__";
}

// --- تشغيل أولي ---
async function boot() {
  tbody.innerHTML = `<tr><td class="empty" colspan="7">جارِ التحميل…</td></tr>`;
  allItems = await fetchAllFood();
  populateCategories();
  render();
}

// --- أحداث الواجهة ---
searchInput.addEventListener("input", (e) => {
  currentFilter.q = e.currentTarget.value || "";
  render();
});

categorySel.addEventListener("change", (e) => {
  currentFilter.cat = e.currentTarget.value || "__ALL__";
  render();
});

btnRefresh.addEventListener("click", async () => {
  tbody.innerHTML = `<tr><td class="empty" colspan="7">جارِ التحديث…</td></tr>`;
  allItems = await fetchAllFood();
  populateCategories();
  render();
});

btnAdd.addEventListener("click", () => {
  dlgTitle.textContent = "إضافة صنف";
  docIdEl.value = "";
  itemForm.reset();
  dialog.showModal();
});

btnCloseDlg.addEventListener("click", () => dialog.close());

// حفظ (إنشاء أو تعديل) — قواعدك ستسمح للأدمن فقط
itemForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();

  const id = (docIdEl.value || "").trim();
  const data = {
    name: (fName.value || "").trim(),
    brand: (fBrand.value || "").trim() || null,
    category: (fCategory.value || "").trim() || null,
    imageUrl: (fImage.value || "").trim() || null,
    measures: [],
  };

  const mName = (fMeasureName.value || "").trim();
  const mQty  = (fMeasureQty.value || "").trim();
  if (mName || mQty) {
    const qtyNum = Number(mQty);
    const m = { name: mName || "قياس", grams: isFinite(qtyNum) && qtyNum>0 ? qtyNum : undefined };
    data.measures.push(m);
  }

  if (!data.name) { alert("الاسم إلزامي"); return; }

  try {
    if (id) {
      // تعديل
      await updateDoc(doc(db, FOOD_PATH, id), data);
    } else {
      // إضافة
      data.createdAt = new Date().toISOString();
      await addDoc(collection(db, FOOD_PATH), data);
    }
    dialog.close();
    await refreshAndRender();
    alert("تم الحفظ بنجاح ✅");
  } catch (err) {
    console.error(err);
    alert("تعذّر الحفظ (غالبًا ليست لديك صلاحية الأدمن).");
  }
});

// تفويض أحداث للجدول (تعديل/حذف)
tbody.addEventListener("click", async (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // تعديل
  if (target.classList.contains("act-edit")) {
    const id = target.dataset.id;
    const item = allItems.find(x => x.id === id);
    if (!item) return;

    dlgTitle.textContent = "تعديل صنف";
    docIdEl.value = item.id;
    fName.value = item.name || "";
    fBrand.value = item.brand || "";
    fCategory.value = item.category || "";
    fImage.value = item.imageUrl || "";
    const m0 = Array.isArray(item.measures) && item.measures[0] ? item.measures[0] : {};
    fMeasureName.value = m0.name || "";
    fMeasureQty.value  = m0.grams ?? m0.gi ?? m0.measureQty ?? "";
    dialog.showModal();
  }

  // حذف
  if (target.classList.contains("act-del")) {
    const id = target.dataset.id;
    const item = allItems.find(x => x.id === id);
    if (!item) return;

    if (!confirm(`هل تريدين حذف الصنف:\n${item.name || id}?`)) return;

    try {
      await deleteDoc(doc(db, FOOD_PATH, id));
      await refreshAndRender();
      alert("تم حذف الصنف 🗑️");
    } catch (err) {
      console.error(err);
      alert("تعذّر الحذف (غالبًا ليست لديك صلاحية الأدمن).");
    }
  }
});

async function refreshAndRender(){
  allItems = await fetchAllFood();
  populateCategories();
  render();
}

// --- كشف دور المستخدم لإظهار الأزرار حسب القواعد ---
// users/{uid}.role === "admin" => عرض الأزرار + عمود الإجراءات
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    isAdmin = false;
    btnAdd.style.display = "none";
    document.body.classList.add("no-admin");
    render();
    return;
  }
  try {
    const uref = doc(db, "users", user.uid);
    const usnap = await getDoc(uref); // قواعدك تسمح للمالك بقراءة وثيقته
    isAdmin = usnap.exists() && usnap.data()?.role === "admin";
  } catch {
    isAdmin = false;
  }
  btnAdd.style.display = isAdmin ? "inline-flex" : "none";
  document.body.classList.toggle("no-admin", !isAdmin);
  render(); // لإظهار/إخفاء عمود الإجراءات فورًا
});

// انطلاق
boot();
