// js/food-items.js
import { db, auth } from "./firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ======== حراسة: لا يعمل إلا على صفحة الأصناف ======== */
const root = document.getElementById("foodItemsPage");
if (!root) {
  console.warn("[food-items] skipped: not on food items page.");
} else {
  initFoodItemsPage();
}

function initFoodItemsPage() {
  /* === عناصر الواجهة === */
  const searchInput   = document.getElementById("searchInput");
  const categorySel   = document.getElementById("categoryFilter");
  const tbody         = document.getElementById("itemsTbody");
  const btnRefresh    = document.getElementById("btnRefresh");
  const btnAdd        = document.getElementById("btnAdd");
  const btnLangAr     = document.getElementById("btnLangAr");
  const btnLangEn     = document.getElementById("btnLangEn");

  if (!searchInput || !categorySel || !tbody || !btnRefresh || !btnLangAr || !btnLangEn) {
    console.warn("[food-items] missing DOM nodes.");
    return;
  }

  /* === حالة الصفحة === */
  const FOOD_PATH = "admin/global/foodItems";
  let allItems = [];
  let ui = {
    lang: "ar",                 // "ar" | "en"
    filterText: "",
    filterCat: "__ALL__",
    isAdmin: false,
  };

  /* === إنشاء نافذة الإضافة/التعديل === */
  const dialog = document.createElement("dialog");
  dialog.id = "itemDialog";
  dialog.innerHTML = `
    <div class="modal-head">
      <strong id="dlgTitle">إضافة صنف</strong>
      <button id="btnCloseDlg" class="btn ghost" type="button" aria-label="إغلاق">إغلاق</button>
    </div>

    <form id="itemForm" class="modal-body">
      <input type="hidden" id="docId" />

      <div class="tabs">
        <button type="button" class="tab active" data-pane="pane-ar">العربية</button>
        <button type="button" class="tab" data-pane="pane-en">English</button>
      </div>

      <!-- Arabic pane -->
      <div id="pane-ar" class="pane active">
        <div class="grid-2">
          <div class="field"><label>الاسم (AR)</label><input id="name_ar" placeholder="مثال: رز مسلوق" /></div>
          <div class="field"><label>البراند (AR)</label><input id="brand_ar" placeholder="مثال: —" /></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>الفئة (AR)</label><input id="category_ar" placeholder="مثال: نشويات" /></div>
          <div class="field"><label>وصف (AR)</label><input id="desc_ar" placeholder="اختياري" /></div>
        </div>
      </div>

      <!-- English pane -->
      <div id="pane-en" class="pane">
        <div class="grid-2">
          <div class="field"><label>Name (EN)</label><input id="name_en" placeholder="e.g., Boiled Rice" /></div>
          <div class="field"><label>Brand (EN)</label><input id="brand_en" placeholder="Optional" /></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Category (EN)</label><input id="category_en" placeholder="e.g., Carbs" /></div>
          <div class="field"><label>Description (EN)</label><input id="desc_en" placeholder="Optional" /></div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="grid-2">
        <div class="field"><label>رابط صورة</label><input id="imageUrl" placeholder="https://..." /></div>
        <div class="field"><label>مؤشر الجلايسيميك GI</label><input id="gi" type="number" step="any" placeholder="مثال: 73" /></div>
      </div>

      <fieldset class="nutr">
        <legend>القيم الغذائية لكل 100g (بدون تغيير أسماء المفاتيح)</legend>
        <div class="grid-4">
          <div class="field small"><label>السعرات الحرارية (kcal)</label><input id="n_cal" type="number" step="any" /></div>
          <div class="field small"><label>الكارب (g)</label><input id="n_carbs" type="number" step="any" /></div>
          <div class="field small"><label>الألياف (g)</label><input id="n_fiber" type="number" step="any" /></div>
          <div class="field small"><label>البروتين (g)</label><input id="n_protein" type="number" step="any" /></div>
          <div class="field small"><label>الدهون (g)</label><input id="n_fat" type="number" step="any" /></div>
          <div class="field small"><label>السكر (g)</label><input id="n_sugar" type="number" step="any" /></div>
          <div class="field small"><label>الدهون المشبعة (g)</label><input id="n_satFat" type="number" step="any" /></div>
          <div class="field small"><label>الصوديوم (mg)</label><input id="n_sodium" type="number" step="any" /></div>
        </div>
      </fieldset>

      <div class="divider"></div>

      <div class="measures">
        <div class="measures-head">
          <strong>المقادير البيتية</strong>
          <button id="btnAddMeasure" class="btn small" type="button">+ إضافة مقدار</button>
        </div>
        <div id="measuresWrap" class="measure-list">
          <!-- صفوف المقادير -->
        </div>
        <p class="note">كل صف: اسم AR (إلزامي)، اسم EN (اختياري)، والوزن بالجرام.</p>
      </div>

      <div class="divider"></div>

      <label class="switch">
        <input id="isActive" type="checkbox" checked />
        <span>نشط (يظهر في البحث والقائمة)</span>
      </label>

      <div class="modal-actions">
        <button class="btn" type="submit">حفظ</button>
        <button class="btn ghost" type="button" id="btnCancel">إلغاء</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  /* نقاط إلى عناصر داخل الـ dialog */
  const dlgTitle      = dialog.querySelector("#dlgTitle");
  const btnCloseDlg   = dialog.querySelector("#btnCloseDlg");
  const itemForm      = dialog.querySelector("#itemForm");
  const btnCancel     = dialog.querySelector("#btnCancel");
  const docIdEl       = dialog.querySelector("#docId");
  const name_ar       = dialog.querySelector("#name_ar");
  const brand_ar      = dialog.querySelector("#brand_ar");
  const category_ar   = dialog.querySelector("#category_ar");
  const desc_ar       = dialog.querySelector("#desc_ar");
  const name_en       = dialog.querySelector("#name_en");
  const brand_en      = dialog.querySelector("#brand_en");
  const category_en   = dialog.querySelector("#category_en");
  const desc_en       = dialog.querySelector("#desc_en");
  const imageUrlEl    = dialog.querySelector("#imageUrl");
  const giEl          = dialog.querySelector("#gi");
  const n_cal         = dialog.querySelector("#n_cal");
  const n_carbs       = dialog.querySelector("#n_carbs");
  const n_fiber       = dialog.querySelector("#n_fiber");
  const n_protein     = dialog.querySelector("#n_protein");
  const n_fat         = dialog.querySelector("#n_fat");
  const n_sugar       = dialog.querySelector("#n_sugar");
  const n_satFat      = dialog.querySelector("#n_satFat");
  const n_sodium      = dialog.querySelector("#n_sodium");
  const isActiveEl    = dialog.querySelector("#isActive");
  const measuresWrap  = dialog.querySelector("#measuresWrap");
  const btnAddMeasure = dialog.querySelector("#btnAddMeasure");

  /* === أدوات === */
  const escapeHtml = (s)=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
  const displayText = (ar,en)=> ui.lang==="en" ? (en||ar||"") : (ar||en||"");
  const num = (v)=> { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const nowISO = ()=> new Date().toISOString();

  /* === قراءة البيانات === */
  async function fetchAllFood() {
    const snap = await getDocs(collection(db, FOOD_PATH));
    return snap.docs.map(s => ({ id: s.id, ...s.data() }));
  }

  /* === رسم الجدول === */
  function previewMeasure(it){
    if (Array.isArray(it.measures) && it.measures.length) {
      const m0 = it.measures[0];
      const n  = displayText(m0?.name, m0?.name_en);
      const g  = m0?.grams;
      return [n, (g!=null? `${g}g` : "")].filter(Boolean).join(" / ");
    }
    return "—";
  }

  function render() {
    const q  = (ui.filterText||"").trim().toLowerCase();
    const cat= ui.filterCat;

    const list = allItems.filter(it=>{
      // الفئة مع الترجمة
      const catAr = (it.category||"");
      const catEn = (it.category_en||"");
      const inCat = cat==="__ALL__" || cat===catAr || cat===catEn;

      // البحث AR/EN
      const txt = [
        it.name, it.name_en,
        it.brand, it.brand_en,
        it.category, it.category_en
      ].filter(Boolean).join(" ").toLowerCase();

      const inTxt = !q || txt.includes(q);
      // إخفاء غير النشطين من العرض الأساسي (لكن ما يمنع قراءتهم)
      const visible = it.isActive !== false;

      return inCat && inTxt && visible;
    });

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td class="empty" colspan="7">لا توجد أصناف مطابقة.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(it=>{
      const img = it.imageUrl || "";
      const nm  = displayText(it.name, it.name_en) || "بدون اسم";
      const br  = displayText(it.brand, it.brand_en) || "—";
      const ct  = displayText(it.category, it.category_en) || "—";
      const meas = previewMeasure(it);
      const actions = ui.isAdmin
        ? `<td class="actions-cell">
             <button class="btn small secondary act-edit" data-id="${it.id}">تعديل</button>
             <button class="btn small danger act-del" data-id="${it.id}">حذف</button>
           </td>`
        : `<td class="actions-cell"></td>`;

      return `
        <tr data-id="${it.id}">
          <td><img class="thumb" src="${img}" alt="" loading="lazy"/></td>
          <td><div class="meta"><strong>${escapeHtml(nm)}</strong></div></td>
          <td class="muted">${escapeHtml(br)}</td>
          <td><span class="chip">${escapeHtml(ct)}</span></td>
          <td class="muted">${escapeHtml(meas)}</td>
          <td class="muted mono">${it.id}</td>
          ${actions}
        </tr>
      `;
    }).join("");
  }

  function populateCategories(){
    const set = new Set();
    allItems.forEach(it=>{
      if (ui.lang==="en") { if (it.category_en) set.add(it.category_en); else if (it.category) set.add(it.category); }
      else { if (it.category) set.add(it.category); else if (it.category_en) set.add(it.category_en); }
    });

    const prev = categorySel.value || "__ALL__";
    categorySel.innerHTML = `<option value="__ALL__">كل الفئات</option>` +
      Array.from(set).sort((a,b)=>a.localeCompare(b,"ar")).map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    categorySel.value = set.has(prev) ? prev : "__ALL__";
  }

  /* === قياس (Repeater) === */
  function measureRowTemplate(m={name:"", name_en:"", grams:""}) {
    const id = Math.random().toString(36).slice(2,9);
    return `
      <div class="measure-row" data-k="${id}">
        <input class="m-name"    placeholder="اسم AR (مثال: كوب)" value="${escapeHtml(m.name||"")}"/>
        <input class="m-name-en" placeholder="Name EN (optional)" value="${escapeHtml(m.name_en||"")}"/>
        <input class="m-grams"   type="number" step="any" placeholder="جرام" value="${m.grams ?? ""}"/>
        <button type="button" class="btn small danger m-del" title="حذف">🗑</button>
      </div>
    `;
  }
  function setMeasuresRows(measures=[]) {
    measuresWrap.innerHTML = measures.map(measureRowTemplate).join("") || measureRowTemplate();
  }
  function readMeasures(){
    const rows = [...measuresWrap.querySelectorAll(".measure-row")];
    return rows.map(r=>{
      const n  = r.querySelector(".m-name")?.value?.trim();
      const ne = r.querySelector(".m-name-en")?.value?.trim();
      const g  = r.querySelector(".m-grams")?.value?.trim();
      const obj = {};
      if (n) obj.name = n;
      if (ne) obj.name_en = ne;
      if (g!=="") obj.grams = Number(g);
      return obj;
    }).filter(o=>o.name || o.name_en || o.grams!=null);
  }

  /* === تشغيل أولي === */
  async function boot(){
    tbody.innerHTML = `<tr><td class="empty" colspan="7">جارِ التحميل…</td></tr>`;
    allItems = await fetchAllFood();
    populateCategories();
    render();
  }

  /* === أحداث === */
  btnLangAr.addEventListener("click", ()=>{
    ui.lang="ar";
    btnLangAr.classList.add("active");
    btnLangEn.classList.remove("active");
    populateCategories(); render();
  });
  btnLangEn.addEventListener("click", ()=>{
    ui.lang="en";
    btnLangEn.classList.add("active");
    btnLangAr.classList.remove("active");
    populateCategories(); render();
  });

  searchInput.addEventListener("input", e => {
    ui.filterText = e.currentTarget.value || "";
    render();
  });
  categorySel.addEventListener("change", e => {
    ui.filterCat = e.currentTarget.value || "__ALL__";
    render();
  });
  btnRefresh.addEventListener("click", async ()=>{
    tbody.innerHTML = `<tr><td class="empty" colspan="7">جارِ التحديث…</td></tr>`;
    allItems = await fetchAllFood();
    populateCategories();
    render();
  });

  btnAdd.addEventListener("click", ()=>{
    dlgTitle.textContent = "إضافة صنف";
    docIdEl.value = "";
    // تفريغ
    name_ar.value = brand_ar.value = category_ar.value = desc_ar.value = "";
    name_en.value = brand_en.value = category_en.value = desc_en.value = "";
    imageUrlEl.value = giEl.value = "";
    n_cal.value = n_carbs.value = n_fiber.value = n_protein.value = n_fat.value = n_sugar.value = n_satFat.value = n_sodium.value = "";
    isActiveEl.checked = true;
    setMeasuresRows([]);
    dialog.showModal();
  });

  btnCloseDlg.addEventListener("click", ()=> dialog.close());
  btnCancel.addEventListener("click", ()=> dialog.close());

  btnAddMeasure.addEventListener("click", ()=>{
    measuresWrap.insertAdjacentHTML("beforeend", measureRowTemplate());
  });
  measuresWrap.addEventListener("click", (e)=>{
    const t = e.target;
    if (t.classList.contains("m-del")) {
      const row = t.closest(".measure-row");
      row?.remove();
      if (!measuresWrap.querySelector(".measure-row")) {
        setMeasuresRows([]);
      }
    }
  });

  // حفظ (إضافة/تعديل)
  itemForm.addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    const id = (docIdEl.value||"").trim();

    // الاسم: لازم واحد على الأقل
    if (!name_ar.value.trim() && !name_en.value.trim()) {
      alert("الاسم مطلوب (AR أو EN)."); return;
    }

    const nutr = {
      cal_kcal:  num(n_cal.value),
      carbs_g:   num(n_carbs.value),
      fiber_g:   num(n_fiber.value),
      protein_g: num(n_protein.value),
      fat_g:     num(n_fat.value),
    };
    // إضافي (اختياري)
    if (n_sugar.value !== "")  nutr.sugar_g   = num(n_sugar.value);
    if (n_satFat.value !== "") nutr.satFat_g  = num(n_satFat.value);
    if (n_sodium.value !== "") nutr.sodium_mg = num(n_sodium.value);

    const payload = {
      // لا نغيّر مفاتيح التغذية المستخدمة في صفحة الوجبات
      nutrPer100g: nutr,

      // نُبقي الحقول القديمة كما هي لعدم كسر أي صفحات
      name:      name_ar.value.trim() || (name_en.value.trim() || null),
      brand:     brand_ar.value.trim() || null,
      category:  category_ar.value.trim() || null,

      // ترجمة إضافية (اختيارية)
      name_en:     name_en.value.trim()     || null,
      brand_en:    brand_en.value.trim()    || null,
      category_en: category_en.value.trim() || null,
      description: desc_ar.value.trim()     || null,
      description_en: desc_en.value.trim()  || null,

      imageUrl: (imageUrlEl.value||"").trim() || null,
      gi: giEl.value==="" ? null : num(giEl.value),

      isActive: !!isActiveEl.checked,
      measures: readMeasures(),

      updatedAt: nowISO()
    };

    // تنظيف: nulls في المقادير
    payload.measures = payload.measures.map(m=>{
      const r = {};
      if (m.name) r.name = m.name;
      if (m.name_en) r.name_en = m.name_en;
      if (m.grams != null && Number.isFinite(m.grams)) r.grams = m.grams;
      return r;
    });

    try {
      if (id) {
        await updateDoc(doc(db, FOOD_PATH, id), payload);
      } else {
        payload.createdAt = payload.updatedAt;
        await addDoc(collection(db, FOOD_PATH), payload);
      }
      dialog.close();
      allItems = await fetchAllFood();
      populateCategories(); render();
      alert("تم الحفظ بنجاح ✅");
    } catch (err) {
      console.error(err);
      alert("تعذّر الحفظ. تأكدي من صلاحيات الأدمن.");
    }
  });

  // تعديل/حذف من الجدول
  tbody.addEventListener("click", async (e)=>{
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // تعديل
    if (t.classList.contains("act-edit")) {
      const id = t.dataset.id;
      const it = allItems.find(x=>x.id===id);
      if (!it) return;

      dlgTitle.textContent = "تعديل صنف";
      docIdEl.value = id;

      name_ar.value = it.name || "";
      brand_ar.value = it.brand || "";
      category_ar.value = it.category || "";
      desc_ar.value = it.description || "";

      name_en.value = it.name_en || "";
      brand_en.value = it.brand_en || "";
      category_en.value = it.category_en || "";
      desc_en.value = it.description_en || "";

      imageUrlEl.value = it.imageUrl || "";
      giEl.value = it.gi ?? "";

      const n = it.nutrPer100g || {};
      n_cal.value    = n.cal_kcal ?? "";
      n_carbs.value  = n.carbs_g ?? "";
      n_fiber.value  = n.fiber_g ?? "";
      n_protein.value= n.protein_g ?? "";
      n_fat.value    = n.fat_g ?? "";
      n_sugar.value  = n.sugar_g ?? "";
      n_satFat.value = n.satFat_g ?? "";
      n_sodium.value = n.sodium_mg ?? "";

      isActiveEl.checked = it.isActive !== false;

      setMeasuresRows(Array.isArray(it.measures) ? it.measures : []);
      dialog.showModal();
    }

    // حذف
    if (t.classList.contains("act-del")) {
      const id = t.dataset.id;
      const it = allItems.find(x=>x.id===id);
      if (!it) return;
      if (!confirm(`حذف الصنف: ${displayText(it.name, it.name_en) || id} ؟`)) return;
      try {
        await deleteDoc(doc(db, FOOD_PATH, id));
        allItems = await fetchAllFood();
        populateCategories(); render();
        alert("تم الحذف 🗑️");
      } catch (err) {
        console.error(err);
        alert("تعذّر الحذف. تأكدي من صلاحيات الأدمن.");
      }
    }
  });

  // صلاحيات الأدمن
  onAuthStateChanged(auth, async (user)=>{
    let admin = false;
    if (user) {
      try {
        const us = await getDoc(doc(db,"users",user.uid));
        admin = us.exists() && us.data()?.role === "admin";
      } catch {}
    }
    ui.isAdmin = admin;
    btnAdd.style.display = admin ? "inline-flex":"none";
    document.body.classList.toggle("no-admin", !admin);
    render();
  });

  // انطلاق
  boot();
}
