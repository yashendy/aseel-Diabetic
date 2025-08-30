import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ============ ثوابت مسار مكتبة الأدمن العامة ============ */
/** هنحفظ الأصناف في: admin/global/foodItems */
const ADMIN_DOC_ID = 'global';
const adminItemsRef = collection(db, `admin/${ADMIN_DOC_ID}/foodItems`);

/* ============ DOM ============ */
let grid, recent, snack, snackText, snackUndo;

let itemId, nameEl, brandEl, categoryEl, tagsEl;
let carb100El, prot100El, fat100El, kcal100El, giEl, sourceEl;
let unitsList, uNameEl, uGramsEl, btnAddUnit;
let imageUrlEl;
let btnSave, btnReset, btnDelete, btnReload;
let qEl, fCatEl, btnClear;

let UNITS = [];
let ITEMS = [];
let lastDeleted = null;

/* ============ Utils ============ */
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, m => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
}[m]));
const fmt = n => (n==null||isNaN(+n)?'—':(+n).toFixed(1));
const calcCalories = (c,p,f)=> Math.round(4*(+c||0) + 4*(+p||0) + 9*(+f||0));
const normalTags = str => !str ? [] :
  str.split(',').map(t=>t.trim())
    .filter(Boolean)
    .map(t=>t.startsWith('#')?t:'#'+t)
    .map(t=>t.toLowerCase());

function autoImageFor(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  const bg=`hsl(${hue} 80% 92%)`, fg=`hsl(${hue} 50% 35%)`, ch=esc(name[0]||'ص');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>
      <rect width='100%' height='100%' fill='${bg}'/>
      <text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle'
        font-family='Segoe UI' font-size='140' fill='${fg}'>${ch}</text>
    </svg>`
  );
}
function showSnack(text, withUndo=false){
  snackText.textContent = text;
  snack.hidden = false;
  snackUndo.hidden = !withUndo;
  setTimeout(()=> snack.hidden = true, 4000);
}

/* ============ Units render/add/remove ============ */
function renderUnits(){
  unitsList.innerHTML = UNITS.length ? '' : '<span class="meta">لا توجد مقادير مضافة.</span>';
  UNITS.forEach((u, i)=>{
    const span = document.createElement('span');
    span.className = 'unit';
    span.innerHTML = `<strong>${esc(u.name)}</strong> = <span>${esc(u.grams)} g</span> <span class="x" data-i="${i}">✖</span>`;
    unitsList.appendChild(span);
  });
}
function addUnit(){
  const n = uNameEl.value.trim();
  const g = Number(uGramsEl.value);
  if(!n || !g || g <= 0){
    alert('أدخل اسم المقدار والجرام (>0)');
    return;
  }
  UNITS.push({name:n, grams:g});
  uNameEl.value=''; uGramsEl.value='';
  renderUnits();
}

/* ============ Grid render ============ */
function showLoading(){
  grid.innerHTML = `<div class="meta">جارِ التحميل…</div>`;
}

function renderGrid(){
  const q = qEl.value.trim().toLowerCase();
  const cat = fCatEl.value;

  let arr = ITEMS.slice();
  if(cat) arr = arr.filter(it => it.category === cat);
  if(q){
    arr = arr.filter(it=>{
      const inName = (it.name||'').toLowerCase().includes(q);
      const inTags = (it.tags||[]).some(t => t.toLowerCase().includes(q));
      return inName || inTags || (q.startsWith('#') && (it.tags||[]).includes(q));
    });
  }

  if(!arr.length){
    grid.innerHTML = `<div class="meta">لا توجد أصناف مطابقة.</div>`;
    return;
  }

  let html = `
    <table class="table">
      <thead>
        <tr>
          <th>الاسم</th>
          <th>التصنيف</th>
          <th>ك/100g</th>
          <th>ب/100g</th>
          <th>د/100g</th>
          <th>سعرات</th>
          <th>وحدات منزلية</th>
          <th>تعديل</th>
        </tr>
      </thead>
      <tbody>
  `;

  for(const it of arr){
    const kcal = it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g);
    const units = (it.householdUnits||[]).map(u=>`${esc(u.name)}(${u.grams}g)`).join('، ') || '—';

    html += `
      <tr data-id="${esc(it.id)}">
        <td>${esc(it.name||'—')}</td>
        <td>${esc(it.category||'—')}</td>
        <td>${fmt(it.carbs_100g)}</td>
        <td>${fmt(it.protein_100g)}</td>
        <td>${fmt(it.fat_100g)}</td>
        <td>${isNaN(kcal)?'—':kcal}</td>
        <td>${units}</td>
        <td><button class="btn ghost btn-edit" data-id="${esc(it.id)}">تعديل</button></td>
      </tr>
    `;
  }
  html += `</tbody></table>`;

  grid.innerHTML = html;

  // ربط أزرار تعديل
  grid.querySelectorAll('.btn-edit').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.id;
      const it = ITEMS.find(x=>x.id===id);
      if(it) fillForm(it);
      window.scrollTo({top:0, behavior:'smooth'});
    });
  });
}

function renderRecent(){
  const arr = ITEMS
    .slice()
    .sort((a,b)=>(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0))
    .slice(0,10);

  if(!arr.length){ recent.textContent='—'; return; }

  recent.innerHTML = arr.map(it=>{
    const t = it.updatedAt?.toDate ? it.updatedAt.toDate().toLocaleString('ar-EG') : '—';
    return `<span class="badge">${esc(it.name)} • ${esc(it.category||'—')} • ${t}</span>`;
  }).join(' ');
}

/* ============ Form helpers ============ */
function resetForm(){
  itemId.value='';
  nameEl.value=''; brandEl.value=''; categoryEl.value='';
  tagsEl.value=''; carb100El.value=''; prot100El.value='';
  fat100El.value=''; kcal100El.value=''; giEl.value=''; sourceEl.value='';
  imageUrlEl.value='';
  UNITS = [];
  renderUnits();
  btnDelete.disabled = true;
}
function fillForm(it){
  itemId.value = it.id||'';
  nameEl.value = it.name||'';
  brandEl.value = it.brand||'';
  categoryEl.value = it.category||'';
  tagsEl.value = (it.tags||[]).join(', ');
  carb100El.value = it.carbs_100g ?? '';
  prot100El.value = it.protein_100g ?? '';
  fat100El.value = it.fat_100g ?? '';
  kcal100El.value = it.calories_100g ?? '';
  giEl.value = it.gi ?? '';
  sourceEl.value = it.source || '';
  imageUrlEl.value = it.imageUrl || '';

  UNITS = (it.householdUnits||[]).map(u=>({name:u.name, grams:u.grams}));
  renderUnits();

  btnDelete.disabled = !it.id;
}

/* ============ Load / Save / Delete ============ */
async function loadItems(){
  showLoading();
  const snap = await getDocs(query(adminItemsRef, orderBy('name')));
  ITEMS = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  renderGrid();
  renderRecent();
}

async function saveItem(e){
  e.preventDefault();
  const name = nameEl.value.trim();
  const category = categoryEl.value;
  const carbs = Number(carb100El.value);
  if(!name || !category || isNaN(carbs)){ alert('الاسم + التصنيف + كارب/100g مطلوبة'); return; }
  if(carbs<0 || (Number(prot100El.value)<0) || (Number(fat100El.value)<0)){ alert('القيم ≥ 0'); return; }

  let kcal = kcal100El.value==='' ? calcCalories(carb100El.value, prot100El.value, fat100El.value) : Number(kcal100El.value);
  if(isNaN(kcal)) kcal=0;

  const payload = {
    name, brand:brandEl.value.trim()||null, category,
    carbs_100g:+carb100El.value||0, protein_100g:+prot100El.value||0, fat_100g:+fat100El.value||0,
    calories_100g:+kcal||0, gi: giEl.value===''? null : (+giEl.value),
    householdUnits: UNITS.slice(),
    imageUrl: imageUrlEl.value.trim() || autoImageFor(name),
    tags: normalTags(tagsEl.value),
    source: sourceEl.value.trim()||null,
    updatedAt: serverTimestamp()
  };

  try{
    if(itemId.value){
      await updateDoc(doc(adminItemsRef, itemId.value), payload);
      showSnack('تم تحديث الصنف بنجاح');
    }else{
      await addDoc(adminItemsRef, { ...payload, createdAt: serverTimestamp() });
      showSnack('تمت إضافة الصنف بنجاح');
    }
    resetForm();
    await loadItems();
  }catch(err){
    console.error(err);
    alert('حدث خطأ أثناء الحفظ');
  }
}

async function deleteItem(){
  if(!itemId.value) return;
  const it = ITEMS.find(x=>x.id===itemId.value);
  if(!it) return;
  if(!confirm(`حذف الصنف «${it.name}»؟`)) return;

  try{
    await deleteDoc(doc(adminItemsRef, it.id));
    lastDeleted = it;
    showSnack(`تم حذف «${it.name}»`, true);
    resetForm();
    await loadItems();
  }catch(err){
    console.error(err);
    alert('تعذر حذف الصنف');
  }
}

async function undoDelete(){
  if(!lastDeleted) return;
  const data = { ...lastDeleted };
  const id = data.id;
  delete data.id;

  try{
    await setDoc(doc(adminItemsRef, id), { ...data, updatedAt: serverTimestamp() });
    showSnack('تم التراجع عن الحذف');
    lastDeleted = null;
    await loadItems();
  }catch(err){
    console.error(err);
    alert('تعذر التراجع');
  }
}

/* ============ Auth + Role check ============ */
async function ensureAdmin(uid){
  // نتحقق من users/{uid}.role == 'admin'
  const uRef = doc(db, `users/${uid}`);
  const uSnap = await getDoc(uRef);
  if(!uSnap.exists() || uSnap.data().role !== 'admin'){
    alert('هذه الصفحة مخصصة للأدمن فقط');
    location.href = 'index.html';
    return false;
  }
  return true;
}

/* ============ Boot ============ */
document.addEventListener('DOMContentLoaded', ()=>{
  // DOM refs
  grid = document.getElementById('grid');
  recent = document.getElementById('recent');
  snack = document.getElementById('snack');
  snackText = document.getElementById('snackText');
  snackUndo = document.getElementById('snackUndo');

  itemId = document.getElementById('itemId');
  nameEl = document.getElementById('name');
  brandEl = document.getElementById('brand');
  categoryEl = document.getElementById('category');
  tagsEl = document.getElementById('tags');

  carb100El = document.getElementById('carb100');
  prot100El = document.getElementById('prot100');
  fat100El = document.getElementById('fat100');
  kcal100El = document.getElementById('kcal100');
  giEl = document.getElementById('gi');
  sourceEl = document.getElementById('source');

  unitsList = document.getElementById('unitsList');
  uNameEl = document.getElementById('uName');
  uGramsEl = document.getElementById('uGrams');
  btnAddUnit = document.getElementById('btnAddUnit');

  imageUrlEl = document.getElementById('imageUrl');

  btnSave = document.getElementById('btnSave');
  btnReset = document.getElementById('btnReset');
  btnDelete = document.getElementById('btnDelete');
  btnReload = document.getElementById('btnReload');

  qEl = document.getElementById('q');
  fCatEl = document.getElementById('fCat');
  btnClear = document.getElementById('btnClear');

  // Events
  btnAddUnit.addEventListener('click', addUnit);
  unitsList.addEventListener('click', (e)=>{
    const t=e.target;
    if(t.classList.contains('x')){
      const i = Number(t.dataset.i);
      UNITS.splice(i,1);
      renderUnits();
    }
  });

  btnSave.addEventListener('click', saveItem);
  btnReset.addEventListener('click', resetForm);
  btnDelete.addEventListener('click', deleteItem);
  btnReload.addEventListener('click', loadItems);
  snackUndo.addEventListener('click', undoDelete);

  [qEl, fCatEl].forEach(el=> el.addEventListener('input', renderGrid));
  btnClear.addEventListener('click', ()=>{
    qEl.value=''; fCatEl.value=''; renderGrid();
  });

  // Auth
  onAuthStateChanged(auth, async (user)=>{
    if(!user){ location.href='index.html'; return; }
    const ok = await ensureAdmin(user.uid);
    if(!ok) return;
    loadItems();
  });
});
