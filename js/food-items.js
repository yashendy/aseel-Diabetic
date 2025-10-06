// ===================== Firebase (CDN modular) =====================
import {
  initializeApp, getApps, getApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// TODO: firebaseConfig
const firebaseConfig = {
  // ضع مفاتيح مشروعك هنا
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// المجموعة: admin/global/foodItems
const FOOD_COL = collection(db, 'admin', 'global', 'foodItems');

// ===================== Utilities =====================
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const num = v => (v==='' || v==null || isNaN(+v)) ? 0 : +v;

function el(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className=cls; if(text) e.textContent=text; return e; }

// ===================== Elements =====================
const els = {
  adminName: $('#adminName'),
  btnLogout: $('#btnLogout'),
  btnAdd: $('#btnAdd'),
  btnRefresh: $('#btnRefresh'),
  btnExport: $('#btnExport'),
  fileExcel: $('#fileExcel'),

  search: $('#txtSearch'),
  cat: $('#ddlCategory'),
  active: $('#chkActive'),
  cards: $('#cards'),

  dlg: $('#dlg'),
  dlgTitle: $('#dlgTitle'),
  dlgClose: $('#dlgClose'),
  btnSave: $('#btnSave'),
  btnCancel: $('#btnCancel'),

  // form fields
  f_nameAR: $('#f_nameAR'),
  f_category: $('#f_category'),
  f_imageUrl: $('#f_imageUrl'),
  f_gi: $('#f_gi'),
  f_active: $('#f_active'),

  n_cal: $('#n_cal'),
  n_carb: $('#n_carb'),
  n_fat: $('#n_fat'),
  n_protein: $('#n_protein'),
  n_sodium: $('#n_sodium'),
  n_fiber: $('#n_fiber'),

  // chips
  chipsTags: $('#chipsTags'),
  chipsTagsSug: $('#chipsTagsSug'),
  chipsDiets: $('#chipsDiets'),
  chipsDietsSug: $('#chipsDietsSug'),
  btnAutoSuggest: $('#btnAutoSuggest'),
};

let CURRENT_ID = null;     // للتعديل
let ALL_ITEMS = [];        // الكاش المحلي

// chips state
let chipsTags = new Set();
let chipsDiets = new Set();
let sugTags = new Set();
let sugDiets = new Set();

// ===================== Auth (admin name) =====================
onAuthStateChanged(auth, async (user)=>{
  if(!user){
    els.adminName.textContent = '—';
  }else{
    // حاول تقرأ displayName أو وثيقة users/{uid}.name
    let name = user.displayName || '';
    try{
      const usersCol = collection(db,'users');
      const qs = await getDocs(query(usersCol, where('__name__','==', user.uid)));
      if(!name && !qs.empty){
        const d = qs.docs[0].data();
        name = d.name || d.displayName || '';
      }
    }catch(e){}
    els.adminName.textContent = name || (user.email ?? '—');
  }
});

els.btnLogout.addEventListener('click', ()=> signOut(auth));

// ===================== Listing / Rendering =====================
async function fetchItems(){
  const conds = [];
  // (نقرأ كل العناصر ونفلتر محليا لسرعة التطوير)
  const snap = await getDocs( query(FOOD_COL, orderBy('nameAR')) );
  ALL_ITEMS = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderCards();
}

function renderCards(){
  const q = els.search.value.trim().toLowerCase();
  const cat = els.cat.value.trim();
  const onlyActive = els.active.checked;

  const filtered = ALL_ITEMS.filter(x=>{
    if(onlyActive && !x.isActive) return false;
    if(cat && x.category !== cat) return false;

    if(!q) return true;
    const hay = [
      x.nameAR, x.category, ...(x.tags||[]), ...(x.dietTags||[])
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  els.cards.innerHTML = '';
  filtered.forEach(x=>{
    const card = el('div','card');

    const img = el('img','thumb');
    img.src = x.imageUrl || 'https://via.placeholder.com/200x140?text=Image';
    card.appendChild(img);

    const mid = el('div','grow');

    const title = el('div','title', x.nameAR || '—');
    const cat = el('div','cat', x.category || '—');
    mid.append(title, cat);

    if(x.tags?.length){
      const tags = el('div','tags');
      x.tags.forEach(t=> tags.appendChild(el('span','tag',t)));
      mid.appendChild(tags);
    }

    card.appendChild(mid);

    const side = el('div','col');
    const btnDel = el('button','btn danger sm','حذف');
    btnDel.onclick = ()=> onDelete(x.id);

    const btnEdit = el('button','btn sm','تعديل');
    btnEdit.style.marginTop = '6px';
    btnEdit.onclick = ()=> openEdit(x);

    side.append(btnDel, btnEdit);
    card.appendChild(side);

    els.cards.appendChild(card);
  });
}

// ===================== Add / Edit / Delete =====================
function resetForm(){
  CURRENT_ID = null;
  els.f_nameAR.value = '';
  els.f_category.value = '';
  els.f_imageUrl.value = '';
  els.f_gi.value = '';
  els.f_active.checked = true;

  els.n_cal.value = '';
  els.n_carb.value = '';
  els.n_fat.value = '';
  els.n_protein.value = '';
  els.n_sodium.value = '';
  els.n_fiber.value = '';

  chipsTags = new Set();
  chipsDiets = new Set();
  sugTags = new Set();
  sugDiets = new Set();
  renderAllChips();
  recomputeSmart();
}

function fillForm(item){
  CURRENT_ID = item?.id ?? null;
  els.f_nameAR.value = item?.nameAR ?? '';
  els.f_category.value = item?.category ?? '';
  els.f_imageUrl.value = item?.imageUrl ?? '';
  els.f_gi.value = item?.gi ?? '';
  els.f_active.checked = item?.isActive ?? true;

  const n = item?.nutrPer100g || {};
  els.n_cal.value = n.cal_kcal ?? '';
  els.n_carb.value = n.carbs_g ?? '';
  els.n_fat.value = n.fat_g ?? '';
  els.n_protein.value = n.protein_g ?? '';
  els.n_sodium.value = n.sodium_mg ?? '';
  els.n_fiber.value = n.fiber_g ?? '';

  chipsTags = new Set(item?.tags || []);
  chipsDiets = new Set(item?.dietTags || []);
  recomputeSmart(); // يحسب الاقتراحات ويرسم
}

function openAdd(){
  resetForm();
  els.dlgTitle.textContent = 'إضافة صنف';
  els.dlg.showModal();
}
function openEdit(item){
  fillForm(item);
  els.dlgTitle.textContent = 'تعديل صنف';
  els.dlg.showModal();
}
els.btnAdd.addEventListener('click', openAdd);
els.dlgClose.addEventListener('click', ()=> els.dlg.close());
els.btnCancel.addEventListener('click', ()=> els.dlg.close());

async function onDelete(id){
  if(!confirm('حذف الصنف نهائيًا؟')) return;
  await deleteDoc( doc(FOOD_COL, id) );
  await fetchItems();
}

// ===================== Smart suggestions (Tags/Diets) =====================
function buildSuggestions(nutr){
  const sTags = new Set();
  const sDiets = new Set();

  if (num(nutr.carbs_g) <= 5)  { sDiets.add('كيتو'); sDiets.add('لو-كارب'); sTags.add('كارب_منخفض'); }
  if (num(nutr.fat_g) >= 15)   { sTags.add('دهون_مرتفعة'); }
  if (num(nutr.protein_g) >=15){ sDiets.add('هاي-بروتين'); sTags.add('بروتين'); }
  if (num(nutr.sodium_mg) <=120){ sDiets.add('قليل-الملح'); sTags.add('قليل_الصوديوم'); }
  if (num(nutr.fiber_g) >=5)   { sTags.add('ألياف'); }

  return { sTags, sDiets };
}

function renderChipContainer(container, set){
  container.innerHTML = '';
  Array.from(set).forEach(v=>{
    const c = el('span','chip'+(set.has(v)?' active':''), v);
    c.onclick = ()=>{
      if(set.has(v)) set.delete(v); else set.add(v);
      renderAllChips();
    };
    container.appendChild(c);
  });
}
function renderAllChips(){
  renderChipContainer(els.chipsTags, chipsTags);
  renderChipContainer(els.chipsDiets, chipsDiets);
  // الاقتراحات
  els.chipsTagsSug.innerHTML=''; els.chipsDietsSug.innerHTML='';
  Array.from(sugTags).forEach(v=>{
    const c = el('span','chip', v);
    c.onclick = ()=>{ chipsTags.add(v); renderAllChips(); };
    els.chipsTagsSug.appendChild(c);
  });
  Array.from(sugDiets).forEach(v=>{
    const c = el('span','chip', v);
    c.onclick = ()=>{ chipsDiets.add(v); renderAllChips(); };
    els.chipsDietsSug.appendChild(c);
  });
}

function recomputeSmart(){
  const nutr = {
    cal_kcal: num(els.n_cal.value),
    carbs_g : num(els.n_carb.value),
    fat_g   : num(els.n_fat.value),
    protein_g: num(els.n_protein.value),
    sodium_mg: num(els.n_sodium.value),
    fiber_g : num(els.n_fiber.value),
  };
  const { sTags, sDiets } = buildSuggestions(nutr);
  sugTags = sTags; sugDiets = sDiets;
  renderAllChips();
}
['n_cal','n_carb','n_fat','n_protein','n_sodium','n_fiber'].forEach(id=>{
  els[id].addEventListener('input', recomputeSmart);
});
els.btnAutoSuggest.addEventListener('click', ()=>{
  sugTags.forEach(t => chipsTags.add(t));
  sugDiets.forEach(d => chipsDiets.add(d));
  renderAllChips();
});

// تجميع بيانات الحفظ
function collectPayload(){
  const payload = {
    nameAR: els.f_nameAR.value.trim(),
    category: els.f_category.value.trim(),
    imageUrl: els.f_imageUrl.value.trim(),
    gi: num(els.f_gi.value),
    isActive: !!els.f_active.checked,
    nutrPer100g:{
      cal_kcal: num(els.n_cal.value),
      carbs_g : num(els.n_carb.value),
      fat_g   : num(els.n_fat.value),
      protein_g: num(els.n_protein.value),
      sodium_mg: num(els.n_sodium.value),
      fiber_g : num(els.n_fiber.value),
    },
    tags: Array.from(chipsTags),
    dietTags: Array.from(chipsDiets),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  // (هنا نقدر ندمج الاقتراح تلقائيًا لو حابة، حالياً المستخدم يتحكم بالchips)
  return payload;
}

els.btnSave.addEventListener('click', async ()=>{
  const p = collectPayload();
  if(!p.nameAR){ alert('الاسم العربي مطلوب'); return; }
  if(CURRENT_ID){
    await updateDoc(doc(FOOD_COL, CURRENT_ID), p);
  }else{
    await addDoc(FOOD_COL, p);
  }
  els.dlg.close();
  await fetchItems();
});

// ===================== Export =====================
async function exportToExcel(){
  let XLSXmod = window.XLSX;
  if(!XLSXmod){
    const m = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    XLSXmod = m.XLSX || m;
  }

  const snap = await getDocs(FOOD_COL);
  const rows = [];
  snap.forEach(d=>{
    const x = d.data();
    rows.push({
      'الاسم': x.nameAR||'',
      'الفئة': x.category||'',
      'GI': x.gi||0,
      'السعرات': x.nutrPer100g?.cal_kcal || 0,
      'الكارب(g)': x.nutrPer100g?.carbs_g || 0,
      'الدهون(g)': x.nutrPer100g?.fat_g || 0,
      'البروتين(g)': x.nutrPer100g?.protein_g || 0,
      'الصوديوم(mg)': x.nutrPer100g?.sodium_mg || 0,
      'الألياف(g)': x.nutrPer100g?.fiber_g || 0,
      'نشط': x.isActive ? 1 : 0,
      'tags': (x.tags||[]).join(','),
      'diets': (x.dietTags||[]).join(','),
    });
  });

  const ws = XLSXmod.utils.json_to_sheet(rows);
  const wb = XLSXmod.utils.book_new();
  XLSXmod.utils.book_append_sheet(wb, ws, 'foodItems');
  XLSXmod.writeFile(wb, 'foodItems.xlsx');
}
els.btnExport.addEventListener('click', exportToExcel);

// ===================== Import =====================
els.fileExcel.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;

  const m = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const XLSXmod = m.XLSX || m;
  const data = await file.arrayBuffer();
  const wb = XLSXmod.read(data, {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSXmod.utils.sheet_to_json(ws); // يفترض عناوين عربية كما في التصدير

  // تحويل الصفوف إلى payloads
  const normalized = rows.map(r=>{
    const payload = {
      nameAR: (r['الاسم']||'').toString().trim(),
      category: (r['الفئة']||'').toString().trim(),
      imageUrl: '', // اختياري
      gi: num(r['GI']),
      isActive: !!num(r['نشط']),
      nutrPer100g:{
        cal_kcal: num(r['السعرات']),
        carbs_g : num(r['الكارب(g)']),
        fat_g   : num(r['الدهون(g)']),
        protein_g: num(r['البروتين(g)']),
        sodium_mg: num(r['الصوديوم(mg)']),
        fiber_g : num(r['الألياف(g)']),
      },
      tags: (r['tags']? r['tags'].toString().split(',').map(x=>x.trim()).filter(Boolean):[]),
      dietTags: (r['diets']? r['diets'].toString().split(',').map(x=>x.trim()).filter(Boolean):[]),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    return payload;
  });

  if(!confirm(`سيتم إضافة/تحديث ${normalized.length} صف. متابعة؟`)) return;

  // إضافة فقط (لتسريع التنفيذ — لو عايزة نعمل upsert حسب الاسم نقدر نطورها)
  for(const p of normalized){
    if(!p.nameAR) continue;
    await addDoc(FOOD_COL, p);
  }

  alert('تم الاستيراد.');
  await fetchItems();
  e.target.value = '';
});

// ===================== Filters & actions =====================
[els.search, els.cat, els.active].forEach(x=> x.addEventListener('input', renderCards));
els.btnRefresh.addEventListener('click', fetchItems);

// أول تشغيل
fetchItems();
