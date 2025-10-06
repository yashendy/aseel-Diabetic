import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ================= Helpers =================
const $ = (id)=>document.getElementById(id);
const cards = $("cards");
let editId = null; // current editing id
let allItems = []; // cache for export/filter

function n(v){ if(v===''||v==null) return null; const x=+v; return Number.isFinite(x)?x:null; }
function splitCSV(s){ return !s?[]:s.split(",").map(x=>x.trim()).filter(Boolean); }
function uniq(a){ return Array.from(new Set(a)); }
function mergeList(a,b){ return uniq([...(a||[]), ...(b||[])]); }

// ============== Auto tags/dietTags rules ==============
function computeDietTagsFromForm(){
  const carbs   = n($("carbs_g").value);
  const protein = n($("protein_g").value);
  const sodium  = n($("sodium_mg").value);
  const gi      = n($("gi").value);
  const cat     = ($("category_in").value || "").trim();

  const tags = [];
  if (carbs!=null){ if (carbs < 10) tags.push("low-carb"); if (carbs < 5) tags.push("keto"); if (carbs<=15) tags.push("diabetic-friendly"); }
  if (gi!=null && gi < 55) tags.push("low-gi");
  if (protein!=null && protein>=15) tags.push("high-protein");
  if (sodium!=null && sodium<=120) tags.push("low-sodium");

  if (cat && cat!=="منتجات اللحوم"){
    if (["الخضروات","الفاكهة"].includes(cat)) tags.push("vegan","vegetarian");
    else if (["الدهون","النشويات"].includes(cat)) tags.push("vegetarian");
    else if (cat==="منتجات الحليب") tags.push("vegetarian");
  }
  return uniq(tags);
}

function computeArabicHashtags(){
  const cat   = ($("category_in").value || "").trim();
  const kcal  = n($("cal_kcal").value);
  const carbs = n($("carbs_g").value);
  const gi    = n($("gi").value);

  const out = [];
  const m = { "النشويات":"نشويات","منتجات الحليب":"حليب","الفاكهة":"فاكهة","الخضروات":"خضار","منتجات اللحوم":"لحوم","الدهون":"دهون","الحلويات":"حلويات","اخرى":"متنوع" };
  if (m[cat]) out.push(m[cat]);
  if (gi!=null && gi<55) out.push("منخفض_المؤشر_الجلاسيمي");
  if (carbs!=null){ if (carbs<5) out.push("كيتو"); if (carbs<10) out.push("منخفض_الكارب"); }
  if (kcal!=null){ if (kcal<=150) out.push("سناك"); else if (kcal>=300) out.push("مشبع"); }
  out.push("صديق_السكري");
  return uniq(out);
}

function applyAutoToForm(){
  const dietOld = splitCSV($("dietTags").value);
  const tagsOld = splitCSV($("tags").value);
  const dietNew = computeDietTagsFromForm();
  const tagsNew = computeArabicHashtags();
  $("dietTags").value = mergeList(dietOld,dietNew).join(", ");
  $("tags").value     = mergeList(tagsOld,tagsNew).join(", ");
}

$("btnAutoSuggest")?.addEventListener("click", applyAutoToForm);
["gi","cal_kcal","carbs_g","protein_g","fat_g","sodium_mg","category_in"].forEach(id=>{
  const el = $(id); if (!el) return;
  const h=()=>{ if ($("autoOnChange").checked) applyAutoToForm(); };
  el.addEventListener("input",h);
  if (el.tagName==="SELECT") el.addEventListener("change",h);
});

// ============== UI Rendering ==============
const cats = ["النشويات","منتجات الحليب","الفاكهة","الخضروات","منتجات اللحوم","الدهون","الحلويات","اخرى"];

function cardTemplate(d){
  const img = d.imageUrl || "images/placeholder-food.jpg";
  const name = d.name_ar || "—";
  const cat = d.category || "—";
  const tags = Array.isArray(d.tags)? d.tags : splitCSV(d.tags);
  return `
  <div class="card">
    <img src="${img}" alt="">
    <div class="flex1">
      <div class="title">${name}</div>
      <div class="cat">${cat}</div>
      <div class="chips">
        ${(tags||[]).slice(0,6).map(t=>`<span class="chip">#${t}</span>`).join("")}
      </div>
      <div class="rowbtns">
        <button class="btn btn--ghost" data-edit="${d.id}">تعديل</button>
        <button class="btn" data-del="${d.id}">حذف</button>
      </div>
    </div>
  </div>`;
}

function render(items){
  cards.innerHTML = items.map(cardTemplate).join("");
  // bind buttons
  cards.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openEdit(b.dataset.edit));
  cards.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>delItem(b.dataset.del));
}

// ============== Firestore ==============
const coll = collection(window.db, "admin","global","foodItems");

function liveLoad(){
  const q = query(coll, orderBy("createdAt","desc"));
  onSnapshot(q, (snap)=>{
    allItems = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    applyFilters();
  }, (err)=>console.error(err));
}
liveLoad();

function applyFilters(){
  const active = $("activeOnly").checked;
  const cat = $("categoryFilter").value;
  const s = ($("searchBox").value||"").trim().toLowerCase();
  let items = allItems.slice();

  if (active) items = items.filter(x=>x.isActive!==false);
  if (cat) items = items.filter(x=>x.category===cat);
  if (s){
    items = items.filter(x=>{
      const hay = `${x.name_ar||""} ${x.desc_ar||""} ${(x.tags||[]).join(" ")}`.toLowerCase();
      return hay.includes(s);
    });
  }
  render(items);
}
$("activeOnly").onchange = applyFilters;
$("categoryFilter").onchange = applyFilters;
$("searchBox").oninput = applyFilters;

// ============== CRUD ==============
function fillForm(d={}){
  $("dlgTitle").textContent = d.id ? "تعديل صنف" : "إضافة صنف";
  $("name_ar").value = d.name_ar||"";
  $("category_in").value = d.category||"النشويات";
  $("desc_ar").value = d.desc_ar||"";
  $("imageUrl").value = d.imageUrl||"";
  $("gi").value = d.gi ?? "";
  $("cal_kcal").value = d.nutrPer100g?.cal_kcal ?? "";
  $("carbs_g").value = d.nutrPer100g?.carbs_g ?? "";
  $("protein_g").value = d.nutrPer100g?.protein_g ?? "";
  $("fat_g").value = d.nutrPer100g?.fat_g ?? "";
  $("sodium_mg").value = d.nutrPer100g?.sodium_mg ?? "";
  $("measureName").value = d.measures?.[0]?.name || "";
  $("measureGrams").value = d.measures?.[0]?.grams ?? "";
  $("dietTags").value = Array.isArray(d.dietTags) ? d.dietTags.join(", ") : (d.dietTags||"");
  $("tags").value = Array.isArray(d.tags) ? d.tags.join(", ") : (d.tags||"");
  $("isActive").checked = d.isActive!==false;
}

function captureForm(){
  return {
    name_ar: $("name_ar").value.trim(),
    category: $("category_in").value.trim(),
    desc_ar: $("desc_ar").value.trim(),
    imageUrl: $("imageUrl").value.trim(),
    gi: n($("gi").value),
    nutrPer100g: {
      cal_kcal: n($("cal_kcal").value),
      carbs_g:  n($("carbs_g").value),
      protein_g:n($("protein_g").value),
      fat_g:    n($("fat_g").value),
      sodium_mg:n($("sodium_mg").value)
    },
    measures: ($("measureName").value || $("measureGrams").value) ? [{
      name: $("measureName").value.trim(),
      grams: n($("measureGrams").value)
    }] : [],
    dietTags: splitCSV($("dietTags").value),
    tags: splitCSV($("tags").value),
    isActive: $("isActive").checked
  };
}

async function saveItem(){
  const payload = captureForm();
  if (!payload.name_ar) return alert("الاسم العربي مطلوب");
  if (editId){
    await updateDoc(doc(window.db, "admin","global","foodItems", editId), {
      ...payload, updatedAt: serverTimestamp()
    });
  } else {
    await addDoc(coll, { ...payload, createdAt: serverTimestamp() });
  }
  $("dlg").close();
}

async function delItem(id){
  if (!confirm("حذف هذا الصنف؟")) return;
  await deleteDoc(doc(window.db,"admin","global","foodItems",id));
}

function openAdd(){ editId=null; fillForm({}); $("dlg").showModal(); }
async function openEdit(id){
  editId = id;
  const d = allItems.find(x=>x.id===id);
  fillForm(d||{});
  $("dlg").showModal();
}

$("btnAdd").onclick = openAdd;
$("btnClose").onclick = ()=>$("dlg").close();
$("btnSave").onclick = (e)=>{ e.preventDefault(); saveItem(); };

// ============== Import from Excel ==============
// زر اختيار ملف
$("btnImport").onclick = ()=> $("excelFile").click();

$("excelFile").addEventListener("change", async (ev)=>{
  const file = ev.target.files?.[0];
  if (!file) return;
  try{
    const buf = await file.arrayBuffer();
    // XLSX موجود من الـCDN (مهم)
    const wb = XLSX.read(buf, { type:"array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });

    // توقع أسماء أعمدة شائعة — عدّلي حسب ملفك لو مختلفة
    // name_ar, category, desc_ar, imageUrl, gi, cal_kcal, carbs_g, protein_g, fat_g, sodium_mg, measureName, measureGrams, tags, dietTags, isActive
    let imported = 0;
    for (const r of rows){
      const docData = {
        name_ar: r.name_ar || r["الاسم"] || "",
        category: r.category || r["الفئة"] || "اخرى",
        desc_ar: r.desc_ar || r["الوصف"] || "",
        imageUrl: r.imageUrl || r["رابط_صورة"] || "",
        gi: n(r.gi),
        nutrPer100g: {
          cal_kcal: n(r.cal_kcal),
          carbs_g:  n(r.carbs_g),
          protein_g:n(r.protein_g),
          fat_g:    n(r.fat_g),
          sodium_mg:n(r.sodium_mg)
        },
        measures: (r.measureName||r.measureGrams) ? [{
          name: (r.measureName||"").toString(), grams: n(r.measureGrams)
        }] : [],
        dietTags: splitCSV(r.dietTags || r["dietTags"]),
        tags: splitCSV(r.tags || r["tags"] || r["وسوم"]),
        isActive: (String(r.isActive||"").toLowerCase()!=="false")
      };
      // توليد تلقائي بناءً على القيم (تقديري) — يندمج مع اللي في الشيت
      const autoDiet = computeDietTagsFromValues(docData);
      docData.dietTags = mergeList(docData.dietTags, autoDiet);
      const autoAr = computeArabicHashtagsFromValues(docData);
      docData.tags = mergeList(docData.tags, autoAr);

      await addDoc(coll, { ...docData, createdAt: serverTimestamp() });
      imported++;
    }
    alert(`تم استيراد ${imported} صنف.`);
  }catch(err){
    console.error(err);
    alert("فشل الاستيراد: تأكدي من أن ملف Excel صحيح وأن مكتبة XLSX محمّلة.");
  }finally{
    ev.target.value = "";
  }
});

// نفس قواعد التوليد لكن “حسب قيمة doc” (للاستيراد)
function computeDietTagsFromValues(d){
  const c = d.nutrPer100g||{};
  const tags=[];
  if (c.carbs_g!=null){ if (c.carbs_g<10) tags.push("low-carb"); if (c.carbs_g<5) tags.push("keto"); if (c.carbs_g<=15) tags.push("diabetic-friendly"); }
  if (d.gi!=null && d.gi<55) tags.push("low-gi");
  if (c.protein_g!=null && c.protein_g>=15) tags.push("high-protein");
  if (c.sodium_mg!=null && c.sodium_mg<=120) tags.push("low-sodium");
  if (d.category && d.category!=="منتجات اللحوم"){
    if (["الخضروات","الفاكهة"].includes(d.category)) tags.push("vegan","vegetarian");
    else if (["الدهون","النشويات"].includes(d.category)) tags.push("vegetarian");
    else if (d.category==="منتجات الحليب") tags.push("vegetarian");
  }
  return uniq(tags);
}
function computeArabicHashtagsFromValues(d){
  const c = d.nutrPer100g||{};
  const out=[];
  const m={ "النشويات":"نشويات","منتجات الحليب":"حليب","الفاكهة":"فاكهة","الخضروات":"خضار","منتجات اللحوم":"لحوم","الدهون":"دهون","الحلويات":"حلويات","اخرى":"متنوع" };
  if (m[d.category]) out.push(m[d.category]);
  if (d.gi!=null && d.gi<55) out.push("منخفض_المؤشر_الجلاسيمي");
  if (c.carbs_g!=null){ if (c.carbs_g<5) out.push("كيتو"); if (c.carbs_g<10) out.push("منخفض_الكارب"); }
  if (c.cal_kcal!=null){ if (c.cal_kcal<=150) out.push("سناك"); else if (c.cal_kcal>=300) out.push("مشبع"); }
  out.push("صديق_السكري");
  return uniq(out);
}

// ============== Export to Excel ==============
$("btnExport").onclick = ()=>{
  // استخدمي الفلتر الحالي — نصدر المعروض
  const active = $("activeOnly").checked;
  const cat = $("categoryFilter").value;
  const s = ($("searchBox").value||"").trim().toLowerCase();
  let rows = allItems.slice();
  if (active) rows = rows.filter(x=>x.isActive!==false);
  if (cat) rows = rows.filter(x=>x.category===cat);
  if (s){
    rows = rows.filter(x=>{
      const hay = `${x.name_ar||""} ${x.desc_ar||""} ${(x.tags||[]).join(" ")}`.toLowerCase();
      return hay.includes(s);
    });
  }

  const data = rows.map(d=>({
    id: d.id,
    name_ar: d.name_ar||"",
    category: d.category||"",
    desc_ar: d.desc_ar||"",
    imageUrl: d.imageUrl||"",
    gi: d.gi??"",
    cal_kcal: d.nutrPer100g?.cal_kcal??"",
    carbs_g:  d.nutrPer100g?.carbs_g??"",
    protein_g:d.nutrPer100g?.protein_g??"",
    fat_g:    d.nutrPer100g?.fat_g??"",
    sodium_mg:d.nutrPer100g?.sodium_mg??"",
    measureName: d.measures?.[0]?.name||"",
    measureGrams: d.measures?.[0]?.grams??"",
    dietTags: (Array.isArray(d.dietTags)? d.dietTags.join(", "): (d.dietTags||"")),
    tags: (Array.isArray(d.tags)? d.tags.join(", "): (d.tags||"")),
    isActive: d.isActive!==false
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "foodItems");
  XLSX.writeFile(wb, "foodItems-export.xlsx");
};

// ============== (اختياري) اظهار البريد لو حابه ==========
try{
  // لو عندك Firebase Auth؛ هنا مجرد عرض ثابت
  $("userEmail").textContent = ""; 
}catch{ /* ignore */ }
