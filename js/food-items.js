/* ====================== Firebase Bootstrap (safe) ====================== */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, deleteDoc,
  writeBatch, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.firebasestorage.app",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

// ثابت المجموعة
const FOOD_COL = collection(db, 'admin', 'global', 'foodItems');

// التصنيفات
const CATEGORIES = ['النشويات','منتجات الحليب','الفاكهة','الخضروات','منتجات اللحوم','الدهون','الحلويات','أخرى'];

// Placeholder محلي (Data URI) — لا يحتاج إنترنت
const PLACEHOLDER = "data:image/svg+xml;base64," +
  btoa(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='240'>
    <rect width='100%' height='100%' fill='#181f2a'/>
    <text x='50%' y='52%' dominant-baseline='middle' text-anchor='middle'
      font-family='Segoe UI,Roboto' font-size='16' fill='#8590a3'>لا توجد صورة</text>
  </svg>`);

/* ========================== State & Elements ========================== */
const els = {
  adminName: document.getElementById('adminName'),
  btnLogout: document.getElementById('btnLogout'),
  btnAdd: document.getElementById('btnAdd'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnImportExcel: document.getElementById('btnImportExcel'),
  excelInput: document.getElementById('excelImportInput'),
  btnExportExcel: document.getElementById('btnExportExcel'),
  itemsGrid: document.getElementById('itemsGrid'),
  txtSearch: document.getElementById('txtSearch'),
  selCategory: document.getElementById('selCategory'),
  chkActiveOnly: document.getElementById('chkActiveOnly'),

  // form modal
  formModal: document.getElementById('formModal'),
  formTitle: document.getElementById('formTitle'),
  f_nameAR: document.getElementById('f_nameAR'),
  f_category: document.getElementById('f_category'),
  f_imageUrl: document.getElementById('f_imageUrl'),
  f_gi: document.getElementById('f_gi'),
  n_cal: document.getElementById('n_cal'),
  n_carb: document.getElementById('n_carb'),
  n_fat: document.getElementById('n_fat'),
  n_protein: document.getElementById('n_protein'),
  n_sodium: document.getElementById('n_sodium'),
  n_fiber: document.getElementById('n_fiber'),
  f_active: document.getElementById('f_active'),
  btnPreview: document.getElementById('btnPreview'),
  btnCancelForm: document.getElementById('btnCancelForm'),

  // preview modal
  previewModal: document.getElementById('previewModal'),
  previewBody: document.getElementById('previewBody'),
  btnConfirmSave: document.getElementById('btnConfirmSave'),
  btnCancelPreview: document.getElementById('btnCancelPreview'),

  // confirm delete
  confirmModal: document.getElementById('confirmModal'),
  btnDoDelete: document.getElementById('btnDoDelete'),
  btnCancelDelete: document.getElementById('btnCancelDelete'),
};

let ALL_ITEMS = [];
let editingId = null;
let pendingDeleteId = null;

/* ============================== Helpers ============================== */
function num(v){ const n = Number(String(v).trim()); return isFinite(n) ? n : 0; }
function openModal(m){ m.classList.remove('hidden'); }
function closeModal(m){ m.classList.add('hidden'); }

function makeCard(item, id){
  const div = document.createElement('div');
  div.className = 'card';

  const img = document.createElement('img');
  img.src = item.imageUrl || PLACEHOLDER;
  img.onerror = () => { img.src = PLACEHOLDER; };
  div.appendChild(img);

  const head = document.createElement('div');
  head.className = 'row-between';
  head.innerHTML = `<strong>${item.nameAR || '-'}</strong>
                    <span class="badge">${item.category || '-'}</span>`;
  div.appendChild(head);

  const tgs = document.createElement('div');
  tgs.className = 'tags';
  (item.tags || []).forEach(t=>{
    const s = document.createElement('span');
    s.className = 'tag'; s.textContent = '#'+t;
    tgs.appendChild(s);
  });
  div.appendChild(tgs);

  const row = document.createElement('div');
  row.className = 'row gap-6';
  const btnEdit = document.createElement('button');
  btnEdit.className = 'btn';
  btnEdit.textContent = 'تعديل';
  btnEdit.onclick = ()=> openEdit(id, item);

  const btnDel = document.createElement('button');
  btnDel.className = 'btn danger';
  btnDel.textContent = 'حذف';
  btnDel.onclick = ()=> { pendingDeleteId = id; openModal(els.confirmModal); };

  row.appendChild(btnEdit); row.appendChild(btnDel);
  div.appendChild(row);

  return div;
}

function filterAndRender(){
  const q = els.txtSearch.value.trim();
  const cat = els.selCategory.value.trim();
  const activeOnly = els.chkActiveOnly.checked;

  let list = [...ALL_ITEMS];

  if (activeOnly) list = list.filter(x => x.data.isActive !== false);
  if (cat) list = list.filter(x => x.data.category === cat);

  if (q){
    const qq = q.toLowerCase();
    list = list.filter(x => {
      const d = x.data;
      const pool = [
        d.nameAR||'', d.descAR||'',
        ...(d.tags||[]), ...(d.dietTags||[])
      ].join(' ').toLowerCase();
      return pool.includes(qq);
    });
  }

  els.itemsGrid.innerHTML = '';
  list.forEach(x=>{
    els.itemsGrid.appendChild(makeCard(x.data, x.id));
  });
}

function autoSuggest(payload){
  const nutr = payload.nutrPer100g || {};
  const tags = new Set(payload.tags || []);
  const diets = new Set(payload.dietTags || []);

  if (num(nutr.carbs_g) <= 5){ diets.add('كيتو'); diets.add('لو-كارب'); tags.add('كارب-منخفض'); }
  if (num(nutr.fat_g) >= 15){ tags.add('دهون-مرتفعة'); }
  if (num(nutr.protein_g) >= 15){ diets.add('هاي-بروتين'); tags.add('بروتين'); }
  if (num(nutr.sodium_mg) <= 120){ diets.add('قليل-الملح'); tags.add('قليل-الصوديوم'); }

  payload.tags = Array.from(tags);
  payload.dietTags = Array.from(diets);
  return payload;
}

/* ============================== Data IO ============================== */
async function loadItems(){
  const snap = await getDocs(FOOD_COL);
  ALL_ITEMS = snap.docs.map(d=>({ id:d.id, data:d.data() }));
  filterAndRender();
}

function collectPayloadFromForm(){
  const p = {
    nameAR: els.f_nameAR.value.trim(),
    category: els.f_category.value.trim(),
    imageUrl: els.f_imageUrl.value.trim(),
    gi: num(els.f_gi.value),
    isActive: !!els.f_active.checked,
    nutrPer100g:{
      cal_kcal: num(els.n_cal.value),
      carbs_g:  num(els.n_carb.value),
      fat_g:    num(els.n_fat.value),
      protein_g:num(els.n_protein.value),
      sodium_mg:num(els.n_sodium.value),
      fiber_g:  num(els.n_fiber.value),
    },
    updatedAt: serverTimestamp(),
  };
  return autoSuggest(p);
}

function fillForm(item){
  els.f_nameAR.value = item?.nameAR || '';
  els.f_category.value = item?.category || CATEGORIES[0];
  els.f_imageUrl.value = item?.imageUrl || '';
  els.f_gi.value = item?.gi ?? '';
  els.f_active.checked = item?.isActive !== false;

  const n = item?.nutrPer100g || {};
  els.n_cal.value    = n.cal_kcal ?? '';
  els.n_carb.value   = n.carbs_g ?? '';
  els.n_fat.value    = n.fat_g ?? '';
  els.n_protein.value= n.protein_g ?? '';
  els.n_sodium.value = n.sodium_mg ?? '';
  els.n_fiber.value  = n.fiber_g ?? '';
}

function openAdd(){
  editingId = null;
  els.formTitle.textContent = 'إضافة صنف';
  fillForm(null);
  openModal(els.formModal);
}

function openEdit(id, data){
  editingId = id;
  els.formTitle.textContent = 'تعديل صنف';
  fillForm(data);
  openModal(els.formModal);
}

function showPreview(payload){
  const b = els.previewBody;
  b.innerHTML = `
    <div><b>الاسم:</b> ${payload.nameAR||'-'}</div>
    <div><b>الفئة:</b> ${payload.category||'-'}</div>
    <div><b>GI:</b> ${payload.gi||'-'}</div>
    <div><b>نشط:</b> ${payload.isActive?'نعم':'لا'}</div>
    <div><b>سعرات/100g:</b> ${payload.nutrPer100g.cal_kcal}</div>
    <div><b>كارب/100g:</b> ${payload.nutrPer100g.carbs_g}</div>
    <div><b>دهون/100g:</b> ${payload.nutrPer100g.fat_g}</div>
    <div><b>بروتين/100g:</b> ${payload.nutrPer100g.protein_g}</div>
    <div><b>صوديوم(mg):</b> ${payload.nutrPer100g.sodium_mg}</div>
    <div><b>ألياف(g):</b> ${payload.nutrPer100g.fiber_g}</div>
    <div><b>وسوم:</b> ${(payload.tags||[]).map(t=>'#'+t).join(' ')||'-'}</div>
    <div><b>أنظمة:</b> ${(payload.dietTags||[]).join(', ')||'-'}</div>
  `;
  openModal(els.previewModal);
}

async function confirmSave(payload){
  const ref = editingId ? doc(FOOD_COL, editingId) : doc(FOOD_COL);
  await setDoc(ref, { ...payload, createdAt: editingId?undefined:serverTimestamp() }, { merge: true });
  closeModal(els.previewModal);
  closeModal(els.formModal);
  await loadItems();
}

async function doDelete(){
  if (!pendingDeleteId) return;
  await deleteDoc(doc(FOOD_COL, pendingDeleteId));
  pendingDeleteId = null;
  closeModal(els.confirmModal);
  await loadItems();
}

/* ============================= Excel IO ============================== */
async function importFromExcel(file){
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const batch = writeBatch(db);
  rows.forEach(r=>{
    const p = autoSuggest({
      nameAR:   r['الاسم']||r['nameAR']||'',
      category: r['الفئة']||r['category']||CATEGORIES[0],
      imageUrl: r['صورة']||r['imageUrl']||'',
      gi:       num(r['GI']),
      isActive: String(r['نشط']||'1')==='1',
      nutrPer100g:{
        cal_kcal:num(r['السعرات']||r['cal_kcal']),
        carbs_g: num(r['الكارب(g)']||r['carbs_g']),
        fat_g:   num(r['الدهون(g)']||r['fat_g']),
        protein_g:num(r['البروتين(g)']||r['protein_g']),
        sodium_mg:num(r['الصوديوم(mg)']||r['sodium_mg']),
        fiber_g: num(r['الألياف(g)']||r['fiber_g']),
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const ref = doc(FOOD_COL);
    batch.set(ref, p);
  });

  await batch.commit();
  await loadItems();
}

async function exportToExcel(){
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
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'foodItems');
  XLSX.writeFile(wb, 'foodItems.xlsx');
}

/* ============================ Admin header =========================== */
function initAdminHeader(){
  onAuthStateChanged(auth, async (user)=>{
    if (!user){ els.adminName.textContent = 'غير مسجّل'; return; }
    try{
      const s = await getDoc(doc(db, 'users', user.uid));
      els.adminName.textContent = s.exists() && (s.data().displayName || s.data().name)
        ? (s.data().displayName || s.data().name)
        : (user.email || 'مستخدم');
    }catch{
      els.adminName.textContent = user.email || 'مستخدم';
    }
  });

  els.btnLogout.onclick = ()=> signOut(auth).catch(()=>{});
}

/* ============================== Wiring UI ============================ */
function wire(){
  // Filters
  els.txtSearch.addEventListener('input', filterAndRender);
  els.selCategory.addEventListener('change', filterAndRender);
  els.chkActiveOnly.addEventListener('change', filterAndRender);

  // CRUD
  els.btnAdd.onclick = openAdd;
  els.btnRefresh.onclick = loadItems;

  els.btnPreview.onclick = ()=>{
    const p = collectPayloadFromForm();
    showPreview(p);
    els.btnConfirmSave.onclick = ()=> confirmSave(p);
  };
  els.btnCancelForm.onclick = ()=> closeModal(els.formModal);
  els.btnCancelPreview.onclick = ()=> closeModal(els.previewModal);

  // Delete
  els.btnDoDelete.onclick = doDelete;
  els.btnCancelDelete.onclick = ()=> closeModal(els.confirmModal);

  // Excel
  els.btnImportExcel.onclick = ()=> els.excelInput.click();
  els.excelInput.onchange = (e)=>{
    const f = e.target.files?.[0]; if (f) importFromExcel(f);
    e.target.value = '';
  };
  els.btnExportExcel.onclick = exportToExcel;
}

/* ================================ Start ============================== */
initAdminHeader();
wire();
loadItems().catch(err=>{
  console.error('Load error', err);
});
