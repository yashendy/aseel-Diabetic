/* js/food-items.js */
import { auth, db, storage } from "./firebase-config.js";
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, setDoc, addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  ref as sRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* -------------- Helpers -------------- */
const $ = (id)=> document.getElementById(id);
const els = {
  adminName:$("admin-name"), adminRole:$("admin-role"),
  btnAuth:$("btn-auth"), btnLogout:$("btn-logout"),
  btnImport:$("btn-import"), inputImport:$("import-file"), btnExport:$("btn-export"),

  search:$("search"), filterCategory:$("filter-category"), filterActive:$("filter-active"),
  btnClear:$("btn-clear"), btnCards:$("btn-cards"), btnTable:$("btn-table"), btnAdd:$("btn-add"),

  cards:$("cards"), tableWrap:$("table-wrap"), tableBody:$("table-body"),
  prev:$("prev"), next:$("next"), pageLabel:$("page-label"),

  dlg:$("edit-dialog"), dlgTitle:$("dlg-title"), dlgClose:$("dlg-close"),
  form:$("edit-form"),
  id:$("item-id"), name:$("name"), category:$("category"),
  cal_kcal:$("cal_kcal"), carbs_g:$("carbs_g"), protein_g:$("protein_g"), fat_g:$("fat_g"),
  fiber_g:$("fiber_g"), sodium_mg:$("sodium_mg"), gi:$("gi"),
  isActive:$("isActive"),
  unitsList:$("units-list"), btnAddUnit:$("btn-add-unit"),
  dietManual:$("diet-manual"), btnDietAuto:$("btn-diet-auto"), dietAutoView:$("diet-auto-view"),
  hashTagsManual:$("hashTagsManual"),

  imageUrl:$("imageUrl"), imageFile:$("imageFile"), btnPick:$("btn-pick"),
  fileName:$("file-name"), imagePreview:$("imagePreview"),
  uploadBar:$("upload-bar"), uploadBarFill:$("upload-bar-fill"),

  btnCancel:$("btn-cancel"), btnSave:$("btn-save"), btnDelete:$("btn-delete"),
};

const CATEGORIES = ["النشويات","منتجات الألبان","الفاكهة","الخضروات","منتجات اللحوم","الدهون","الحلويات","أخرى"];
let allItems = [];
let viewItems = [];
let page = 1, pageSize = 24;

// للاحتفاظ بملف الصورة المختار (معاينة قبل الرفع)
let selectedFile = null;

/* -------------- Mapping & Loading -------------- */
function mapCategory(c){
  c = (c||"").trim();
  if(!CATEGORIES.includes(c)){
    if(["حبوب","خبز","مكرونة","معكرونة","مأكولات"].includes(c)) return "النشويات";
    if(["ألبان","حليب","جبن","أجبان"].includes(c)) return "منتجات الألبان";
    if(["فاكهة"].includes(c)) return "الفاكهة";
    if(["خضار"].includes(c)) return "الخضروات";
    if(["لحوم","دواجن","أسماك","مأكولات بحرية"].includes(c)) return "منتجات اللحوم";
    if(["دهون","زيوت"].includes(c)) return "الدهون";
    if(["حلويات","مسليات"].includes(c)) return "الحلويات";
    return "أخرى";
  }
  return c;
}

function mapFood(snap){
  const d = snap.data() || {};
  const per100 = d.per100 || {
    cal_kcal: Number(d.cal_kcal ?? 0),
    carbs_g: Number(d.carbs_g ?? 0),
    protein_g: Number(d.protein_g ?? 0),
    fat_g: Number(d.fat_g ?? 0),
    fiber_g: Number(d.fiber_g ?? 0),
    sodium_mg: Number(d.sodium_mg ?? 0),
    gi: Number(d.gi ?? 0),
  };
  const units = Array.isArray(d.units) && d.units.length
    ? d.units
    : [{ key:"g100", label:"100 جم", grams:100, default:true }];

  return {
    id: snap.id,
    name: d.name || "صنف",
    category: mapCategory(d.category || "أخرى"),
    per100,
    units,
    dietTagsManual: d.dietTagsManual || [],
    dietTagsAuto: d.dietTagsAuto || [],
    hashTagsManual: d.hashTagsManual || [],
    hashTagsAuto: d.hashTagsAuto || [],
    imageUrl: d.imageUrl || "",
    imagePath: d.imagePath || "",
    isActive: d.isActive !== false,
    searchText: (d.searchText || `${d.name||""} ${d.category||""}`).toLowerCase(),
    createdAt: d.createdAt || null, updatedAt: d.updatedAt || null
  };
}

async function loadLibrary(){
  const rows = [];
  try{
    const g1 = await getDocs(collection(db, "admin","global","foodItems"));
    g1.forEach(s => rows.push(mapFood(s)));
  }catch(e){ console.warn("global read:", e?.message||e); }

  try{
    const g2 = await getDocs(collection(db, "fooditems"));
    g2.forEach(s => rows.push(mapFood(s)));
  }catch(e){ console.warn("fooditems read:", e?.message||e); }

  // إزالة التكرار حسب الاسم (lowercase)
  const seen = new Map();
  rows.forEach(f => seen.set(String(f.name).toLowerCase(), f));
  allItems = [...seen.values()]
    .sort((a,b)=> a.name.localeCompare(b.name, 'ar', {numeric:true}));
}

/* -------------- Filtering & Rendering -------------- */
function applyFilters(){
  const q = (els.search?.value || "").toLowerCase().trim();
  const cat = (els.filterCategory?.value || "").trim();
  const onlyActive = !!els.filterActive?.checked;

  let list = allItems.slice();
  if(q) list = list.filter(x => (x.name + " " + x.category + " " + x.searchText + " " + (x.hashTagsManual||[]).join(" ")).toLowerCase().includes(q));
  if(cat) list = list.filter(x => x.category === cat);
  if(onlyActive) list = list.filter(x => x.isActive);

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if(page > pages) page = pages;

  const start = (page-1)*pageSize, end = start + pageSize;
  viewItems = list.slice(start, end);

  if(els.pageLabel) els.pageLabel.textContent = `صفحة ${page} / ${pages}`;
}

function render(){
  applyFilters();

  if(els.cards){
    els.cards.innerHTML = viewItems.map(f => `
      <div class="card-item">
        <div class="name">${escapeHtml(f.name)}</div>
        <div class="meta">${f.category} • ${f.per100.cal_kcal || 0} kcal</div>
        ${f.imageUrl ? `<img src="${f.imageUrl}" alt="" loading="lazy" style="width:100%;border-radius:12px;border:1px solid #e8eef5;margin-bottom:10px">` : ""}
        <div class="tags">
          ${[...new Set([...(f.dietTagsManual||[]), ...(f.dietTagsAuto||[])])].map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("")}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn" data-edit="${f.id}">تعديل</button>
        </div>
      </div>
    `).join("");
  }

  if(els.tableBody){
    els.tableBody.innerHTML = viewItems.map(f => `
      <tr>
        <td>${escapeHtml(f.name)}</td>
        <td>${f.category}</td>
        <td>${f.per100.cal_kcal||0}</td>
        <td>${f.per100.carbs_g||0}</td>
        <td>${f.per100.protein_g||0}</td>
        <td>${f.per100.fat_g||0}</td>
        <td>${f.isActive ? "✓" : "✗"}</td>
        <td><button class="btn" data-edit="${f.id}">تعديل</button></td>
      </tr>
    `).join("");
  }

  document.querySelectorAll('[data-edit]').forEach(b=>{
    b.addEventListener('click', ()=> openEdit(b.getAttribute('data-edit')));
  });
}

function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }

/* -------------- Dialog (Edit/Add) -------------- */
function openEdit(id){
  const f = allItems.find(x=>x.id===id);
  els.dlgTitle.textContent = f ? "تعديل صنف" : "إضافة صنف";
  els.id.value = f?.id || "";
  els.name.value = f?.name || "";
  els.category.value = f?.category || "أخرى";
  const p = f?.per100 || {};
  els.cal_kcal.value = p.cal_kcal ?? "";
  els.carbs_g.value = p.carbs_g ?? "";
  els.protein_g.value = p.protein_g ?? "";
  els.fat_g.value = p.fat_g ?? "";
  els.fiber_g.value = p.fiber_g ?? "";
  els.sodium_mg.value = p.sodium_mg ?? "";
  els.gi.value = p.gi ?? "";
  els.isActive.value = (f?.isActive ? "true" : "false");

  // units
  selectedFile = null;
  renderUnits(f?.units || [{ key:"g100", label:"100 جم", grams:100, default:true }]);

  // manual tags
  const manual = new Set(f?.dietTagsManual || []);
  els.dietManual.querySelectorAll('.chip').forEach(ch=>{
    const tag = ch.dataset.tag;
    if(manual.has(tag)) ch.classList.add('active'); else ch.classList.remove('active');
  });

  // hashTags
  els.hashTagsManual.value = (f?.hashTagsManual||[]).join(" ");

  // auto tags view
  els.dietAutoView.innerHTML = [...new Set(f?.dietTagsAuto||[])].map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("");

  // image
  els.imageUrl.value = f?.imageUrl || "";
  els.fileName.textContent = "لم يتم اختيار ملف";
  els.uploadBar.style.display = "none";
  els.uploadBarFill.style.width = "0%";
  els.imagePreview.src = f?.imageUrl || "";
  els.imagePreview.style.display = f?.imageUrl ? "block" : "none";

  els.dlg.showModal();
}

function renderUnits(units){
  els.unitsList.innerHTML = "";
  (units||[]).forEach((u,idx)=>{
    addUnitRow(u.key || `u${idx}`, u.label || "", Number(u.grams||0), !!u.default);
  });
}
function addUnitRow(key="", label="", grams=0, def=false){
  const row = document.createElement('div');
  row.className = "unit-row";
  row.innerHTML = `
    <input type="text" class="u-label" placeholder="الاسم الظاهر (مثال: كوب مطبوخ)" value="${escapeHtml(label)}">
    <input type="number" class="u-grams" step="0.1" value="${grams}">
    <div class="radio"><input type="radio" name="u-default" class="u-default" ${def?'checked':''}></div>
    <button type="button" class="icon u-del" title="حذف">🗑️</button>
  `;
  row.querySelector('.u-del').addEventListener('click', ()=> row.remove());
  els.unitsList.appendChild(row);
}
function readUnits(){
  const rows = Array.from(els.unitsList.querySelectorAll('.unit-row'));
  let foundDefault = false;
  const units = rows.map((r,i)=>{
    const label = r.querySelector('.u-label').value.trim();
    const grams = Number(r.querySelector('.u-grams').value || 0);
    const def = r.querySelector('.u-default').checked;
    if(def) foundDefault = true;
    return { key:`u${i}`, label, grams, default:def };
  }).filter(u=>u.label && u.grams>0);
  if(!foundDefault && units.length){
    units[0].default = true;
  }
  return units.length ? units : [{key:"g100",label:"100 جم",grams:100,default:true}];
}

/* توليد تلقائي للأنظمة */
function genDietAuto(per100){
  const tags = new Set();

  const carbs = Number(per100.carbs_g||0);
  const fat   = Number(per100.fat_g||0);
  const prot  = Number(per100.protein_g||0);
  const fiber = Number(per100.fiber_g||0);
  const gi    = Number(per100.gi||0);
  const sodium= Number(per100.sodium_mg||0);

  const netCarbs = Math.max(0, carbs - fiber);

  if(carbs <= 5 && fat >= 15) tags.add("#كيتو");
  if(carbs <= 10) tags.add("#منخفض_الكربوهيدرات");
  if(gi > 0 && gi < 55 || netCarbs <= 15) tags.add("#مناسب_لمرضى_السكري");
  if(prot >= 15) tags.add("#عالي_البروتين");
  if(sodium > 0 && sodium < 120) tags.add("#قليل_الصوديوم");

  return [...tags];
}

/* -------------- Save / Delete -------------- */
async function saveItem(e){
  e?.preventDefault?.();

  const id = (els.id.value||"").trim();
  const name = els.name.value.trim();
  if(!name) return alert("الاسم مطلوب");

  const per100 = {
    cal_kcal: Number(els.cal_kcal.value || 0),
    carbs_g: Number(els.carbs_g.value || 0),
    protein_g: Number(els.protein_g.value || 0),
    fat_g: Number(els.fat_g.value || 0),
    fiber_g: Number(els.fiber_g.value || 0),
    sodium_mg: Number(els.sodium_mg.value || 0),
    gi: Number(els.gi.value || 0),
  };
  const units = readUnits();

  // manual tags
  const manual = [];
  els.dietManual.querySelectorAll('.chip.active').forEach(ch=> manual.push(ch.dataset.tag));
  const dietTagsAuto = genDietAuto(per100);

  // hashtags
  const hashTagsManual = (els.hashTagsManual.value||"")
    .split(/\s+/).map(x=>x.trim()).filter(Boolean);

  // الصورة: لو اخترنا ملف → نرفعه وقت الحفظ
  let imageUrl = (els.imageUrl.value||"").trim();
  let imagePath = "";

  try{
    if(selectedFile){
      const user = auth.currentUser;
      if(!user) throw new Error("يلزم تسجيل الدخول");
      const safeName = selectedFile.name.replace(/[^\w.\-]+/g,'_');
      const path = `food-items/${user.uid}/${Date.now()}_${safeName}`;
      const ref = sRef(storage, path);
      const task = uploadBytesResumable(ref, selectedFile);
      els.uploadBar.style.display = "block";
      task.on('state_changed', (snap)=>{
        const p = (snap.bytesTransferred/snap.totalBytes)*100;
        els.uploadBarFill.style.width = `${p}%`;
      });
      await new Promise((res,rej)=> task.on('state_changed', ()=>{}, rej, res));
      imageUrl = await getDownloadURL(task.snapshot.ref);
      imagePath = path;
    }
  }catch(err){
    return alert("رفع الصورة فشل: " + (err?.message||err));
  }

  const payload = {
    name,
    category: mapCategory(els.category.value),
    per100,
    units,
    dietTagsManual: manual,
    dietTagsAuto,
    hashTagsManual,
    // hashTagsAuto ممكن لاحقًا
    imageUrl,
    ...(imagePath ? { imagePath } : {}),
    isActive: (els.isActive.value === "true"),
    searchText: (name + " " + mapCategory(els.category.value) + " " + hashTagsManual.join(" ")).toLowerCase(),
    updatedAt: serverTimestamp(),
  };

  try{
    if(id){
      await setDoc(doc(db,"fooditems",id), payload, { merge:true });
    }else{
      await addDoc(collection(db,"fooditems"), { ...payload, createdAt: serverTimestamp() });
    }
    await loadLibrary(); render();
    els.dlg.close();
  }catch(err){
    alert("تعذر الحفظ: " + (err?.message||err));
  }
}

async function deleteItem(){
  const id = (els.id.value||"").trim();
  if(!id) return;

  if(!confirm("هل تريد حذف هذا الصنف نهائيًا؟")) return;

  try{
    // حاول جلب الوثيقة للحصول على imagePath
    const snap = await getDoc(doc(db,"fooditems",id));
    if(snap.exists()){
      const d = snap.data() || {};
      if(d.imagePath){
        try{
          await deleteObject(sRef(storage, d.imagePath));
        }catch(e){ console.warn("فشل حذف الصورة:", e?.message||e); }
      }
    }
    await deleteDoc(doc(db,"fooditems",id));
    await loadLibrary(); render();
    els.dlg.close();
    alert("تم حذف الصنف.");
  }catch(err){
    alert("فشل الحذف: " + (err?.message||err));
  }
}

/* -------------- Import / Export -------------- */
function bindImportExport(){
  els.btnExport?.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(allItems, null, 2)], {type:'application/json;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fooditems.json';
    a.click();
  });

  els.btnImport?.addEventListener('click', ()=> els.inputImport.click());
  els.inputImport?.addEventListener('change', async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    let arr = [];
    try{
      arr = file.name.endsWith('.csv') ? csvToJson(text) : JSON.parse(text);
    }catch{ return alert("ملف غير صالح"); }
    if(!Array.isArray(arr) || !arr.length) return alert("لا توجد عناصر");

    try{
      for(const item of arr){
        const per100 = item.per100 || {
          cal_kcal:Number(item.cal_kcal||0),
          carbs_g:Number(item.carbs_g||0),
          protein_g:Number(item.protein_g||0),
          fat_g:Number(item.fat_g||0),
          fiber_g:Number(item.fiber_g||0),
          sodium_mg:Number(item.sodium_mg||0),
          gi:Number(item.gi||0),
        };
        const units = Array.isArray(item.units) && item.units.length
          ? item.units : [{key:"g100",label:"100 جم",grams:100,default:true}];

        await addDoc(collection(db,"fooditems"), {
          name: String(item.name||"صنف").trim(),
          category: mapCategory(item.category||"أخرى"),
          per100,
          units,
          dietTagsManual: item.dietTagsManual||[],
          dietTagsAuto: genDietAuto(per100),
          hashTagsManual: item.hashTagsManual || [],
          imageUrl: item.imageUrl || "",
          isActive: item.isActive !== false,
          searchText: (String(item.name||"") + " " + mapCategory(item.category||"")).toLowerCase(),
          createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      }
      await loadLibrary(); render();
      alert("تم الاستيراد.");
    }catch(err){ alert("خطأ أثناء الاستيراد: " + (err?.message||err)); }
  });
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

/* -------------- UI Bindings -------------- */
function bindUI(){
  els.dlgClose?.addEventListener('click', ()=> els.dlg.close());
  els.btnCancel?.addEventListener('click', ()=> els.dlg.close());
  els.btnAdd?.addEventListener('click', ()=> openEdit(""));

  els.btnCards?.addEventListener('click', ()=>{
    els.btnCards.classList.add('active'); els.btnTable.classList.remove('active');
    els.cards.style.display="grid"; els.tableWrap.style.display="none";
  });
  els.btnTable?.addEventListener('click', ()=>{
    els.btnTable.classList.add('active'); els.btnCards.classList.remove('active');
    els.cards.style.display="none"; els.tableWrap.style.display="block";
  });

  els.search?.addEventListener('input', ()=> render());
  els.filterCategory?.addEventListener('change', ()=> render());
  els.filterActive?.addEventListener('change', ()=> render());
  els.btnClear?.addEventListener('click', ()=>{
    els.search.value=""; els.filterCategory.value=""; els.filterActive.checked=true; render();
  });

  els.prev?.addEventListener('click', ()=>{ if(page>1){ page--; render(); } });
  els.next?.addEventListener('click', ()=>{ page++; render(); });

  els.btnAddUnit?.addEventListener('click', ()=> addUnitRow("", "", 0, false));
  document.querySelectorAll('[data-unit]').forEach(ch=>{
    ch.addEventListener('click', ()=>{
      const [key,label,grams] = ch.dataset.unit.split("|");
      addUnitRow(key,label,Number(grams||0), false);
    });
  });

  // manual diet chips
  els.dietManual.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=> ch.classList.toggle('active'));
  });

  els.btnDietAuto?.addEventListener('click', ()=>{
    const auto = genDietAuto({
      cal_kcal:Number(els.cal_kcal.value||0),
      carbs_g:Number(els.carbs_g.value||0),
      protein_g:Number(els.protein_g.value||0),
      fat_g:Number(els.fat_g.value||0),
      fiber_g:Number(els.fiber_g.value||0),
      sodium_mg:Number(els.sodium_mg.value||0),
      gi:Number(els.gi.value||0),
    });
    els.dietAutoView.innerHTML = auto.map(t=>`<span class="tag">${t}</span>`).join("");
  });

  // الصورة (معاينة قبل الرفع)
  els.btnPick?.addEventListener('click', ()=> els.imageFile.click());
  els.imageFile?.addEventListener('change', (e)=>{
    selectedFile = e.target.files?.[0] || null;
    if(selectedFile){
      els.fileName.textContent = selectedFile.name;
      els.imagePreview.src = URL.createObjectURL(selectedFile);
      els.imagePreview.style.display = "block";
      // لا نرفع الآن — نرفع عند الحفظ
    }else{
      els.fileName.textContent = "لم يتم اختيار ملف";
      els.imagePreview.src = ""; els.imagePreview.style.display = "none";
    }
  });

  els.form?.addEventListener('submit', saveItem);
  els.btnSave?.addEventListener('click', saveItem);
  els.btnDelete?.addEventListener('click', deleteItem);

  bindImportExport();
}

/* -------------- Auth -------------- */
function authInit(){
  onAuthStateChanged(auth, async (user)=>{
    if(!user){
      els.adminName.textContent=""; els.adminRole.textContent="";
      els.btnAuth.style.display="inline-block"; els.btnLogout.style.display="none";
      return;
    }
    els.btnAuth.style.display="none"; els.btnLogout.style.display="inline-block";

    try{
      const u = await getDoc(doc(db,"users",user.uid));
      const role = u.exists() ? (u.data().role || "") : "";
      const roleLabel =
        role === "admin" ? "أدمن" :
        role === "doctor" ? "طبيب" :
        role === "doctor-pending" ? "طبيب (قيد المراجعة)" :
        role === "parent" ? "ولي أمر" : (role||"");
      els.adminRole.textContent = roleLabel;

      const profileName = (u.exists() && u.data().name) ? u.data().name : (user.displayName || "");
      els.adminName.textContent = profileName || "مشرف";
    }catch{
      els.adminRole.textContent = "";
      els.adminName.textContent = user.displayName || "مشرف";
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

/* -------------- Boot -------------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    authInit();
    bindUI();
    await loadLibrary();
    render();
  }catch(e){
    console.error(e);
    alert("تعذر تشغيل الصفحة: " + (e?.message||e));
  }
});
