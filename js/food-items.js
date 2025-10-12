/* js/food-items.js */
import { auth, db, storage } from "./firebase-config.js";
import {
  collection, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  ref as sRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* ========== Helpers ========== */
const $ = (id)=> document.getElementById(id);
const els = {
  adminName: $("admin-name"), adminRole: $("admin-role"),
  btnAuth: $("btn-auth"), btnLogout: $("btn-logout"),
  btnExport: $("btn-export"), btnImport: $("btn-import"), inputImport: $("import-file"),

  search: $("search"), filterCategory: $("filter-category"), filterActive: $("filter-active"),
  btnClear: $("btn-clear"), btnCards: $("btn-cards"), btnTable: $("btn-table"), btnAdd: $("btn-add"),

  cards: $("cards"), tableWrap: $("table-wrap"), tableBody: $("table-body"),
  prev: $("prev"), next: $("next"), pageLabel: $("page-label"),

  dlg: $("edit-dialog"), dlgClose: $("dlg-close"), dlgTitle: $("dlg-title"),
  form: $("edit-form"),
  id: $("item-id"), name: $("name"), category: $("category"),
  cal_kcal: $("cal_kcal"), carbs_g: $("carbs_g"), protein_g: $("protein_g"), fat_g: $("fat_g"),
  isActive: $("isActive"), searchTags: $("searchTags"),
  imageUrl: $("imageUrl"), imageFile: $("imageFile"), imagePreview: $("imagePreview"),
};

function norm(s){ return (s||"").toString().trim(); }
function mapCategoryArabic(raw){
  const c = norm(raw);
  const is = (arr)=>arr.includes(c);
  if(is(['النشويات','حبوب','خبز','معكرونة','مأكولات'])) return 'النشويات';
  if(is(['منتجات الألبان','ألبان','حليب','جبن','أجبان'])) return 'منتجات الألبان';
  if(is(['الفاكهة','فاكهة'])) return 'الفاكهة';
  if(is(['الخضروات','خضروات','خضار'])) return 'الخضروات';
  if(is(['منتجات اللحوم','لحوم','دواجن','أسماك','مأكولات بحرية'])) return 'منتجات اللحوم';
  if(is(['الدهون','دهون','زيوت'])) return 'الدهون';
  if(is(['الحلويات','حلويات','مسليات'])) return 'الحلويات';
  return 'أخرى';
}

let allItems = [];     // كامل المكتبة (بعد الدمج وإزالة التكرار)
let viewItems = [];    // النتائج بعد الفلترة/الباجينج
let page = 1, pageSize = 24;

/* ========== قراءة البيانات ========== */
function mapFood(snap){
  const d = snap.data() || {};
  return {
    id: snap.id,
    name: d.name || "صنف",
    category: mapCategoryArabic(d.category || "أخرى"),
    cal_kcal: Number(d.cal_kcal ?? d.kcal ?? 0),
    carbs_g: Number(d.carbs_g ?? d.carbs ?? 0),
    protein_g: Number(d.protein_g ?? d.protein ?? 0),
    fat_g: Number(d.fat_g ?? d.fat ?? 0),
    isActive: d.isActive !== false,
    imageUrl: d.imageUrl || "",
    searchText: (d.searchText || `${d.name||""} ${d.category||""}`).toLowerCase()
  };
}

async function loadLibrary(){
  const rows = [];
  try{
    const g1 = await getDocs(collection(db, "admin", "global", "foodItems"));
    g1.forEach(s=> rows.push(mapFood(s)));
  }catch(e){ console.warn("global read failed:", e?.message||e); }
  try{
    const g2 = await getDocs(collection(db, "fooditems"));
    g2.forEach(s=> rows.push(mapFood(s)));
  }catch(e){ console.warn("fooditems read failed:", e?.message||e); }

  // إزالة التكرار (بالاسم lower) – الأحدث يغلب بشكل تقريبي
  const seen = new Map();
  for(const f of rows){
    const key = `${f.name}`.toLowerCase();
    seen.set(key, f);
  }
  allItems = [...seen.values()]
    .sort((a,b)=> a.name.localeCompare(b.name, 'ar', {numeric:true}));
}

/* ========== رسم الواجهة ========== */
function applyFilters(){
  const q = norm(els.search?.value).toLowerCase();
  const cat = norm(els.filterCategory?.value);
  const onlyActive = !!els.filterActive?.checked;

  let list = allItems.slice();
  if(q) list = list.filter(x => (x.name + " " + x.category + " " + x.searchText).toLowerCase().includes(q));
  if(cat) list = list.filter(x => x.category === cat);
  if(onlyActive) list = list.filter(x => x.isActive);

  // باجينج
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if(page > pages) page = pages;

  const start = (page - 1) * pageSize, end = start + pageSize;
  viewItems = list.slice(start, end);

  if(els.pageLabel) els.pageLabel.textContent = `صفحة ${page} / ${pages}`;
}

function render(){
  applyFilters();

  if(els.cards){
    els.cards.innerHTML = viewItems.map(f => `
      <div class="card-item">
        <div class="name">${f.name}</div>
        <div class="meta">${f.category} • ${f.cal_kcal} kcal</div>
        ${f.imageUrl ? `<img src="${f.imageUrl}" alt="" loading="lazy" style="width:100%;border-radius:12px;border:1px solid #e8eef5;margin-top:8px">` : ""}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn" data-edit="${f.id}">تعديل</button>
        </div>
      </div>`).join("");
  }

  if(els.tableBody){
    els.tableBody.innerHTML = viewItems.map(f => `
      <tr>
        <td>${f.name}</td>
        <td>${f.category}</td>
        <td>${f.cal_kcal}</td>
        <td>${f.carbs_g}</td>
        <td>${f.protein_g}</td>
        <td>${f.fat_g}</td>
        <td>${f.isActive ? "✓" : "✗"}</td>
        <td><button class="btn" data-edit="${f.id}">تعديل</button></td>
      </tr>`).join("");
  }

  // ربط أزرار التعديل
  document.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openEdit(btn.getAttribute('data-edit')));
  });
}

/* ========== حوار الإضافة/التعديل ========== */
function openEdit(id){
  const f = allItems.find(x=>x.id===id);
  if(els.dlgTitle) els.dlgTitle.textContent = f ? "تعديل صنف" : "إضافة صنف";
  if(els.id) els.id.value = f?.id || "";
  if(els.name) els.name.value = f?.name || "";
  if(els.category) els.category.value = f?.category || "";
  if(els.cal_kcal) els.cal_kcal.value = f?.cal_kcal ?? "";
  if(els.carbs_g) els.carbs_g.value = f?.carbs_g ?? "";
  if(els.protein_g) els.protein_g.value = f?.protein_g ?? "";
  if(els.fat_g) els.fat_g.value = f?.fat_g ?? "";
  if(els.isActive) els.isActive.value = f?.isActive ? "true" : "false";
  if(els.imageUrl) els.imageUrl.value = f?.imageUrl || "";
  if(els.imagePreview) els.imagePreview.src = f?.imageUrl || "";
  els.dlg?.showModal();
}

async function saveItem(){
  const id = norm(els.id?.value);
  const payload = {
    name: norm(els.name?.value),
    category: mapCategoryArabic(els.category?.value),
    cal_kcal: Number(els.cal_kcal?.value || 0),
    carbs_g: Number(els.carbs_g?.value || 0),
    protein_g: Number(els.protein_g?.value || 0),
    fat_g: Number(els.fat_g?.value || 0),
    isActive: (els.isActive?.value === "true"),
    imageUrl: norm(els.imageUrl?.value),
    searchText: (norm(els.name?.value) + " " + mapCategoryArabic(els.category?.value)).toLowerCase(),
    updatedAt: serverTimestamp(),
  };
  if(!payload.name) return alert("الاسم مطلوب");

  try{
    if(id){
      await setDoc(doc(db, "fooditems", id), payload, { merge:true });
    }else{
      await addDoc(collection(db, "fooditems"), { ...payload, createdAt: serverTimestamp() });
    }
    await loadLibrary(); render(); els.dlg?.close();
  }catch(e){
    alert("تعذر الحفظ: " + (e?.message || e));
  }
}

/* ========== رفع الصورة للمخزن ========== */
function bindUpload(){
  if(!els.imageFile) return;
  els.imageFile.addEventListener('change', async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const path = `food-items/${Date.now()}_${file.name}`;
      const ref = sRef(storage, path);
      const task = uploadBytesResumable(ref, file);
      task.on('state_changed', ()=>{}, (err)=>{
        alert("رفع الصورة فشل: " + (err?.message||err));
      }, async ()=>{
        const url = await getDownloadURL(task.snapshot.ref);
        if(els.imageUrl) els.imageUrl.value = url;
        if(els.imagePreview) els.imagePreview.src = url;
      });
    }catch(e){
      alert("فشل الرفع: " + (e?.message || e));
    }
  });
}

/* ========== استيراد/تصدير ========== */
function bindImportExport(){
  if(els.btnExport){
    els.btnExport.addEventListener('click', ()=>{
      const blob = new Blob([JSON.stringify(allItems, null, 2)], {type:'application/json;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fooditems.json';
      a.click();
    });
  }
  if(els.btnImport && els.inputImport){
    els.btnImport.addEventListener('click', ()=> els.inputImport.click());
    els.inputImport.addEventListener('change', async (e)=>{
      const file = e.target.files?.[0];
      if(!file) return;
      const txt = await file.text();
      let arr = [];
      try{
        arr = file.name.endsWith('.csv') ? csvToJson(txt) : JSON.parse(txt);
      }catch(err){ return alert("ملف غير صالح"); }
      if(!Array.isArray(arr) || !arr.length) return alert("لا توجد عناصر للاستيراد");
      try{
        for(const item of arr){
          const payload = {
            name: norm(item.name),
            category: mapCategoryArabic(item.category),
            cal_kcal: Number(item.cal_kcal ?? item.per100?.cal_kcal ?? 0),
            carbs_g: Number(item.carbs_g ?? item.per100?.carbs_g ?? 0),
            protein_g: Number(item.protein_g ?? item.per100?.protein_g ?? 0),
            fat_g: Number(item.fat_g ?? item.per100?.fat_g ?? 0),
            isActive: item.isActive !== false,
            imageUrl: norm(item.imageUrl),
            searchText: (norm(item.name) + " " + mapCategoryArabic(item.category)).toLowerCase(),
            createdAt: serverTimestamp(),
          };
          await addDoc(collection(db, "fooditems"), payload);
        }
        await loadLibrary(); render();
        alert("تم الاستيراد");
      }catch(e){ alert("خطأ أثناء الاستيراد: " + (e?.message||e)); }
    });
  }
}

function csvToJson(csv){
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift().split(',').map(h=>h.trim());
  return lines.map(l=>{
    const cells = l.split(','); const obj={};
    header.forEach((h,i)=> obj[h]=cells[i]);
    return obj;
  });
}

/* ========== تحكم الواجهة ========== */
function bindUI(){
  els.dlgClose?.addEventListener('click', ()=> els.dlg?.close());
  els.btnAdd?.addEventListener('click', ()=> openEdit(""));
  $("btn-save")?.addEventListener('click', (e)=>{ e.preventDefault(); saveItem(); });
  $("btn-delete")?.addEventListener('click', (e)=>{ e.preventDefault(); alert("الحذف ممكن إضافته لاحقًا."); });

  els.btnCards?.addEventListener('click', ()=>{
    els.btnCards.classList.add('active'); els.btnTable?.classList.remove('active');
    if(els.cards) els.cards.style.display="grid";
    if(els.tableWrap) els.tableWrap.style.display="none";
  });
  els.btnTable?.addEventListener('click', ()=>{
    els.btnTable.classList.add('active'); els.btnCards?.classList.remove('active');
    if(els.cards) els.cards.style.display="none";
    if(els.tableWrap) els.tableWrap.style.display="block";
  });

  els.search?.addEventListener('input', ()=> render());
  els.filterCategory?.addEventListener('change', ()=> render());
  els.filterActive?.addEventListener('change', ()=> render());
  els.btnClear?.addEventListener('click', ()=>{
    if(els.search) els.search.value="";
    if(els.filterCategory) els.filterCategory.value="";
    if(els.filterActive) els.filterActive.checked=true;
    render();
  });

  els.prev?.addEventListener('click', ()=>{ if(page>1){ page--; render(); } });
  els.next?.addEventListener('click', ()=>{ page++; render(); });
}

/* ========== المصادقة ========== */
function authInit(){
  onAuthStateChanged(auth, async (user)=>{
    if(!user){
      if(els.adminName) els.adminName.textContent="";
      if(els.adminRole) els.adminRole.textContent="";
      if(els.btnAuth) els.btnAuth.style.display="inline-block";
      if(els.btnLogout) els.btnLogout.style.display="none";
      return;
    }
    if(els.btnAuth) els.btnAuth.style.display="none";
    if(els.btnLogout) els.btnLogout.style.display="inline-block";

    try {
      const u = await getDoc(doc(db, "users", user.uid));

      // الدور (نعرضه بعربي فقط في الواجهة، من غير ما نغيّر الداتا/القواعد)
      const role = u.exists() ? (u.data().role || "") : "";
      const roleLabel =
        role === "admin" ? "أدمن" :
        role === "doctor" ? "طبيب" :
        role === "doctor-pending" ? "طبيب (قيد المراجعة)" :
        role === "parent" ? "ولي أمر" :
        (role || "");
      if (els.adminRole) els.adminRole.textContent = roleLabel;

      // الاسم: users/{uid}.name ثم displayName (بدون ما نعرض الإيميل)
      const profileName = (u.exists() && u.data().name)
        ? u.data().name
        : (user.displayName || "");
      if (els.adminName) els.adminName.textContent = profileName || "مشرف";
    } catch {
      // fallback بسيط
      if (els.adminRole) els.adminRole.textContent = "";
      if (els.adminName) els.adminName.textContent = user.displayName || "مشرف";
    }
  });

  els.btnAuth?.addEventListener('click', async ()=>{
    try{ await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch(e){ alert("فشل تسجيل الدخول: " + (e?.message||e)); }
  });
  els.btnLogout?.addEventListener('click', async ()=>{
    try{ await signOut(auth); }
    catch(e){ alert("فشل تسجيل الخروج: " + (e?.message||e)); }
  });
}

/* ========== إقلاع ========== */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    authInit();
    bindUI();
    bindUpload();
    bindImportExport();
    await loadLibrary();
    render();
  }catch(e){
    console.error(e);
    alert("تعذر تشغيل الصفحة: " + (e?.message||e));
  }
});
