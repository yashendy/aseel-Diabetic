// /js/food-items.js — FULL REPLACEMENT
// ✅ يحفظ على Schema v2
// ✅ يرفع الصور إلى food-items/items/{itemId}/main.jpg
// ✅ يقرأ السكيمات القديمة ويحّولها قبل الحفظ
// ✅ يبني searchText، ويدمج الوسوم، ولا يمسّ الألوان/الستايل

import { app, db, auth, storage } from './firebase-config.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
  ref as sRef, uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

// ---------- عناصر الواجهة (تأكدي أن الـ IDs دي موجودة في HTML)
const els = {
  search:       document.getElementById('search'),
  filterCat:    document.getElementById('filter-category'),
  filterActive: document.getElementById('filter-active'),
  btnClear:     document.getElementById('btn-clear'),
  btnAdd:       document.getElementById('btn-add'),
  grid:         document.getElementById('cards'),
  tableWrap:    document.getElementById('table-wrap'),
  tableBody:    document.getElementById('table-body'),
  btnCards:     document.getElementById('btn-cards'),
  btnTable:     document.getElementById('btn-table'),

  // dialog
  dlg:          document.getElementById('edit-dialog'),
  dlgTitle:     document.getElementById('dlg-title'),
  dlgClose:     document.getElementById('dlg-close'),
  form:         document.getElementById('edit-form'),
  id:           document.getElementById('item-id'),
  name:         document.getElementById('name'),
  category:     document.getElementById('category'),
  cal:          document.getElementById('cal_kcal'),
  carbs:        document.getElementById('carbs_g'),
  protein:      document.getElementById('protein_g'),
  fat:          document.getElementById('fat_g'),
  fiber:        document.getElementById('fiber_g'),
  sodium:       document.getElementById('sodium_mg'),
  gi:           document.getElementById('gi'),
  isActive:     document.getElementById('isActive'),
  unitsList:    document.getElementById('units-list'),
  btnAddUnit:   document.getElementById('btn-add-unit'),
  chipsUnits:   document.querySelectorAll('.chips [data-unit]'),
  hashTagsManual: document.getElementById('hashTagsManual'),
  dietManual:   document.getElementById('diet-manual'),
  dietAutoView: document.getElementById('diet-auto-view'),
  btnDietAuto:  document.getElementById('btn-diet-auto'),
  // image
  imageUrl:     document.getElementById('imageUrl'),
  imageFile:    document.getElementById('imageFile'),
  btnPick:      document.getElementById('btn-pick'),
  fileName:     document.getElementById('file-name'),
  uploadBar:    document.getElementById('upload-bar'),
  uploadFill:   document.getElementById('upload-bar-fill'),
  imagePreview: document.getElementById('imagePreview'),
  // actions
  btnDelete:    document.getElementById('btn-delete'),
  btnCancel:    document.getElementById('btn-cancel'),
  btnSave:      document.getElementById('btn-save'),
  // auth
  adminName:    document.getElementById('admin-name'),
  adminRole:    document.getElementById('admin-role'),
  btnAuth:      document.getElementById('btn-auth'),
  btnLogout:    document.getElementById('btn-logout'),
};

const FOODS = collection(db, 'admin', 'global', 'foodItems');
let unsubscribe = null;
let cache = [];
let currentImagePath = '';
let lastPickedFile = null;

// ---------- Utils
const num = v => (v === '' || v == null) ? null : Number(v);
const tidy = s => (s || '').toString().trim();
const toArabicSearch = s =>
  (s || '').toString().toLowerCase()
    .replace(/[أإآا]/g,'ا')
    .replace(/[ى]/g,'ي')
    .replace(/[ؤئ]/g,'ء')
    .replace(/\s+/g,' ')
    .trim();

function unitRow(u = { label:'', grams:null, default:false }) {
  const row = document.createElement('div');
  row.className = 'unit-row';
  row.innerHTML = `
    <label class="radio"><input type="radio" name="unit-default" ${u.default?'checked':''} /></label>
    <input class="unit-label" type="text" placeholder="الاسم الظاهر (مثال: كوب)" value="${u.label||''}">
    <input class="unit-grams" type="number" step="0.1" placeholder="جرامات" value="${u.grams??''}">
    <button class="icon danger btn-del-unit" type="button" title="حذف">🗑</button>
  `;
  row.querySelector('.btn-del-unit').onclick = () => row.remove();
  row.querySelector('input[type=radio]').onchange = () => {
    document.querySelectorAll('.unit-row input[type=radio]').forEach(r=> r.checked=false);
    row.querySelector('input[type=radio]').checked = true;
  };
  return row;
}

function readUnits() {
  const list = [...els.unitsList.querySelectorAll('.unit-row')].map(r => {
    const label = tidy(r.querySelector('.unit-label').value);
    const grams = num(r.querySelector('.unit-grams').value);
    const def   = r.querySelector('input[type=radio]').checked;
    if (!label || !(grams>0)) return null;
    return { key: label, label, grams, default: def };
  }).filter(Boolean);
  if (list.length && !list.some(x=>x.default)) list[0].default = true;
  if (!list.length && (num(els.cal.value)!=null || num(els.carbs.value)!=null || num(els.protein.value)!=null || num(els.fat.value)!=null)) {
    list.push({ key:'g100', label:'100 جم', grams:100, default:true });
  }
  return list;
}

function fillUnits(units=[]) {
  els.unitsList.innerHTML = '';
  units.forEach(u => els.unitsList.appendChild(unitRow(u)));
}

function parseUnitChip(str) {
  // "cup_cooked|كوب (مطبوخ)|160"
  const [key,label,grams] = (str||'').split('|');
  return { key, label, grams: Number(grams), default:false };
}

function buildSearchText(data) {
  const ulabels = (data.units||[]).map(u=>u.label).join(' ');
  const allTags = [...(data.dietTags||[]), ...(data.hashTags||[])].join(' ');
  return toArabicSearch(`${data.name} ${data.category} ${allTags} ${ulabels}`);
}

function mergeTags(manualStr, autoArr) {
  const manual = (manualStr||'').split('#').map(x=>'#'+x.trim()).filter(x=>x!=='#');
  const set = new Set([...(autoArr||[]), ...manual]);
  return [...set];
}

function mapDocToForm(d){
  // يقرأ سكيمة قديمة/جديدة ويملأ النموذج
  els.id.value       = d.id || '';
  els.name.value     = d.name || '';
  els.category.value = d.category || 'أخرى';

  const per100 = d.per100 || d.nutrPer100g || {
    cal_kcal: d.cal_kcal, carbs_g: d.carbs_g, protein_g: d.protein_g, fat_g: d.fat_g,
    fiber_g: d.fiber_g, sodium_mg: d.sodium_mg, gi: d.gi
  } || {};
  els.cal.value    = per100.cal_kcal ?? '';
  els.carbs.value  = per100.carbs_g ?? '';
  els.protein.value= per100.protein_g ?? '';
  els.fat.value    = per100.fat_g ?? '';
  els.fiber.value  = per100.fiber_g ?? '';
  els.sodium.value = per100.sodium_mg ?? '';
  els.gi.value     = per100.gi ?? '';

  const units = d.units
    || (Array.isArray(d.measures) ? d.measures.map(m=>({label:m.name||m.label, grams:Number(m.grams), default: m.default||false})) : null)
    || (d.measureQty && typeof d.measureQty==='object' ? Object.entries(d.measureQty).map(([k,v])=>({label:k, grams:Number(v), default:false})) : null)
    || (Array.isArray(d.householdUnits) ? d.householdUnits.map(m=>({label:m.name, grams:Number(m.grams), default:false})) : null)
    || [];
  fillUnits(units);

  // صورة
  const image = d.image || {};
  currentImagePath = image.path || d.imagePath || ''; // legacy
  els.imageUrl.value = image.url || d.imageUrl || '';
  els.imagePreview.src = els.imageUrl.value || '';

  // وسوم
  const dietTags = d.dietTags || [...(d.dietTagsAuto||[]), ...(d.dietTagsManual||[])];
  const hashTags = d.hashTags || [...(d.hashTagsAuto||[]), ...(d.hashTagsManual||[])];
  els.hashTagsManual.value = (hashTags||[]).join(' ');
  els.dietAutoView.innerHTML = (dietTags||[]).map(t=>`<span class="tag">${t}</span>`).join('');
  els.isActive.value = String(d.isActive !== false);
}

function mapFormToPayload() {
  const per100 = {
    cal_kcal: num(els.cal.value) ?? 0,
    carbs_g:  num(els.carbs.value) ?? 0,
    protein_g:num(els.protein.value) ?? 0,
    fat_g:    num(els.fat.value) ?? 0,
    fiber_g:  num(els.fiber.value) ?? 0,
    sodium_mg:num(els.sodium.value) ?? 0,
    gi:       num(els.gi.value) ?? 0,
  };
  const units = readUnits();
  const dietTagsAuto = []; // ممكن توليد تلقائي لاحقًا
  const dietTags = mergeTags('', dietTagsAuto);
  const hashTags = mergeTags(els.hashTagsManual.value, []);
  const image = {
    url: tidy(els.imageUrl.value),
    path: currentImagePath || ''
  };
  const payload = {
    name: tidy(els.name.value),
    category: tidy(els.category.value),
    isActive: (els.isActive.value === 'true'),
    per100,
    units,
    image,
    dietTags, hashTags,
    searchText: buildSearchText({ name: els.name.value, category: els.category.value, units, dietTags, hashTags }),
    schemaVersion: 2,
    updatedAt: serverTimestamp()
  };
  if (!els.id.value) payload.createdAt = serverTimestamp();
  return payload;
}

// ---------- رفع الصورة
els.btnPick?.addEventListener('click', ()=> els.imageFile.click());
els.imageFile?.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  lastPickedFile = file;
  els.fileName.textContent = file.name;
  els.imagePreview.src = URL.createObjectURL(file);
});

// رفع الملف عند الحفظ (لو تم اختياره)
async function uploadImageIfNeeded(itemId){
  if(!lastPickedFile) return; // لا يوجد اختيار جديد
  const path = `food-items/items/${itemId}/main.${(lastPickedFile.name.split('.').pop()||'jpg').toLowerCase()}`;
  const r = sRef(storage, path);
  if (els.uploadBar) els.uploadBar.style.display = 'block';
  if (els.uploadFill) els.uploadFill.style.width = '0%';
  await new Promise((resolve, reject)=>{
    const task = uploadBytesResumable(r, lastPickedFile);
    task.on('state_changed', snap=>{
      if (els.uploadFill) {
        const pct = Math.round((snap.bytesTransferred/snap.totalBytes)*100);
        els.uploadFill.style.width = `${pct}%`;
      }
    }, reject, ()=> resolve());
  });
  if (els.uploadBar) els.uploadBar.style.display = 'none';
  currentImagePath = path; // حدّث المسار للصورة
}

// ---------- CRUD
async function openEditor(id=null){
  els.form.reset();
  els.unitsList.innerHTML = '';
  currentImagePath = '';
  lastPickedFile = null;
  els.imagePreview.src = '';
  els.hashTagsManual.value = '';
  els.dietAutoView.innerHTML = '';

  if(id){
    els.dlgTitle.textContent = 'تعديل صنف';
    const snap = await getDoc(doc(FOODS, id));
    if(snap.exists()){
      mapDocToForm({ id: snap.id, ...snap.data() });
    }
  } else {
    els.dlgTitle.textContent = 'إضافة صنف';
    // قيمة أولية 100 جم
    fillUnits([{ key:'g100', label:'100 جم', grams:100, default:true }]);
  }
  els.dlg.showModal();
}

async function saveItem(){
  const id  = tidy(els.id.value);
  // ارفع الصورة لو تم اختيارها
  const newId = id || doc(FOODS).id; // لو إضافة جديدة
  await uploadImageIfNeeded(newId);
  const payload = mapFormToPayload();
  // أضف مسار الصورة بعد الرفع
  if(currentImagePath) payload.image.path = currentImagePath;

  if(id){
    await setDoc(doc(FOODS, id), payload, { merge:true });
  } else {
    await setDoc(doc(FOODS, newId), { ...payload, createdAt: serverTimestamp() }, { merge:true });
    els.id.value = newId;
  }
  els.dlg.close();
}

async function removeItem(){
  const id = tidy(els.id.value);
  if(!id) return els.dlg.close();
  if(!confirm('هل تريد حذف هذا الصنف؟')) return;
  await deleteDoc(doc(FOODS, id));
  els.dlg.close();
}

// ---------- عرض القائمة
function render(){
  const q = toArabicSearch(els.search?.value);
  const cat = tidy(els.filterCat?.value);
  const activeOnly = !!els.filterActive?.checked;

  let list = [...cache];

  if (q) {
    list = list.filter(x=>{
      const unitsTxt = (x.units||[]).map(u=>u.label).join(' ');
      const hay = toArabicSearch(`${x.name} ${x.category} ${x.searchText||''} ${(x.hashTags||[]).join(' ')} ${unitsTxt}`);
      return hay.includes(q);
    });
  }
  if (cat) list = list.filter(x => x.category === cat);
  if (activeOnly) list = list.filter(x => x.isActive !== false);

  // البطاقات
  if (els.grid) {
    els.grid.innerHTML = list.map(x=>`
      <article class="card">
        <div class="card-body">
          <div class="title">${x.name||'—'}</div>
          <div class="muted">${x.category||''}</div>
          <div class="muted sm">kcal/100g: ${x.per100?.cal_kcal ?? x.nutrPer100g?.cal_kcal ?? '—'}</div>
        </div>
        <div class="card-actions">
          <button class="btn ghost" data-edit="${x.id}">تعديل</button>
        </div>
      </article>
    `).join('');
    els.grid.querySelectorAll('[data-edit]').forEach(b=>{
      b.onclick = ()=> openEditor(b.dataset.edit);
    });
  }

  // الجدول (مختصر)
  if (els.tableBody){
    els.tableBody.innerHTML = list.map(x=>`
      <tr>
        <td>${x.name||''}</td>
        <td>${x.category||''}</td>
        <td>${x.per100?.cal_kcal ?? x.nutrPer100g?.cal_kcal ?? ''}</td>
        <td>${x.per100?.carbs_g ?? x.nutrPer100g?.carbs_g ?? ''}</td>
        <td>${x.per100?.protein_g ?? x.nutrPer100g?.protein_g ?? ''}</td>
        <td>${x.per100?.fat_g ?? x.nutrPer100g?.fat_g ?? ''}</td>
        <td>${x.isActive!==false ? '✓' : '✗'}</td>
        <td><button class="btn ghost" data-edit="${x.id}">تعديل</button></td>
      </tr>
    `).join('');
    els.tableBody.querySelectorAll('[data-edit]').forEach(b=>{
      b.onclick = ()=> openEditor(b.dataset.edit);
    });
  }
}

// ---------- اشتراك لحظي
function startLive(){
  if (unsubscribe) return;
  unsubscribe = onSnapshot(FOODS, snap=>{
    cache = [];
    snap.forEach(s=>{
      const d = { id:s.id, ...s.data() };
      // تطبيع بسيط لضمان وجود per100/units
      d.per100 = d.per100 || d.nutrPer100g || {};
      d.units  = d.units || d.measures || d.householdUnits || [];
      cache.push(d);
    });
    render();
  });
}

// ---------- أحداث الواجهة
els.btnAdd?.addEventListener('click', ()=> openEditor(null));
els.dlgClose?.addEventListener('click', ()=> els.dlg.close());
els.btnCancel?.addEventListener('click', ()=> els.dlg.close());
els.form?.addEventListener('submit', (e)=>{ e.preventDefault(); saveItem().catch(err=>alert(err.message)); });
els.btnDelete?.addEventListener('click', ()=> removeItem().catch(err=>alert(err.message)));
els.search?.addEventListener('input', render);
els.filterCat?.addEventListener('change', render);
els.filterActive?.addEventListener('change', render);
els.btnClear?.addEventListener('click', ()=>{
  if(els.search) els.search.value='';
  if(els.filterCat) els.filterCat.value='';
  if(els.filterActive) els.filterActive.checked=true;
  render();
});
els.btnAddUnit?.addEventListener('click', ()=> els.unitsList.appendChild(unitRow()));
els.chipsUnits.forEach(ch=> ch.addEventListener('click', ()=>{
  els.unitsList.appendChild(unitRow(parseUnitChip(ch.dataset.unit)));
}));

// عرض/إخفاء الشبكة/الجدول
els.btnCards?.addEventListener('click', ()=>{
  if(!els.btnCards||!els.btnTable) return;
  els.btnCards.classList.add('active'); els.btnTable.classList.remove('active');
  els.grid.style.display='grid'; els.tableWrap.style.display='none';
});
els.btnTable?.addEventListener('click', ()=>{
  if(!els.btnCards||!els.btnTable) return;
  els.btnTable.classList.add('active'); els.btnCards.classList.remove('active');
  els.grid.style.display='none'; els.tableWrap.style.display='block';
});

// ---------- مصادقة بسيطة (اختياري)
const provider = new GoogleAuthProvider();
els.btnAuth?.addEventListener('click', ()=> signInWithPopup(auth, provider));
els.btnLogout?.addEventListener('click', ()=> signOut(auth));
onAuthStateChanged(auth, (u)=>{
  if(u){
    if (els.adminName) els.adminName.textContent = u.displayName || u.email || 'Admin';
    if (els.adminRole) els.adminRole.textContent = 'admin';
    if (els.btnAuth) els.btnAuth.style.display='none';
    if (els.btnLogout) els.btnLogout.style.display='inline-flex';
    startLive();
  } else {
    if (els.adminName) els.adminName.textContent = '';
    if (els.adminRole) els.adminRole.textContent = '';
    if (els.btnAuth) els.btnAuth.style.display='inline-flex';
    if (els.btnLogout) els.btnLogout.style.display='none';
    if(unsubscribe){ unsubscribe(); unsubscribe=null; }
    cache = []; render();
  }
});
