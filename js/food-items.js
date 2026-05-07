// js/food-items.js
import { db, storage, auth } from './firebase-config.js';
import { collection, doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { ref as sRef, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

const $ = id => document.getElementById(id);
const FOODS = collection(db, 'admin', 'global', 'foodItems');
let cache = [];
let lastPickedFile = null;
let currentImagePath = '';

// --- 1. التحقق من دخول الأدمن ---
onAuthStateChanged(auth, (user) => {
  if (!user) { location.href = 'index.html'; return; }
  if($('admin-name')) $('admin-name').textContent = user.displayName || user.email;
  startLive();
});
if($('btn-logout')) $('btn-logout').onclick = () => signOut(auth).then(()=> location.href = 'index.html');

// --- 2. إدارة المقاييس (Portions) ---
function createUnitRow(u = { label:'', grams:null }) {
  const row = document.createElement('div'); row.className = 'unit-row';
  row.style.marginBottom = '8px';
  row.innerHTML = `
    <input type="text" class="u-lbl" placeholder="الاسم (مثال: كوب)" value="${u.label||''}" required style="flex:1;">
    <input type="number" class="u-gr" placeholder="جرام" value="${u.grams||''}" required style="width: 80px;">
    <button type="button" class="btn danger sm u-del">✕</button>
  `;
  row.querySelector('.u-del').onclick = () => row.remove();
  return row;
}

if($('btn-add-unit')) $('btn-add-unit').onclick = () => $('units-list').appendChild(createUnitRow());
document.querySelectorAll('.chip-sm').forEach(btn => {
  btn.onclick = () => {
    const [_, lbl, gr] = btn.dataset.unit.split('|');
    $('units-list').appendChild(createUnitRow({ label: lbl, grams: gr }));
  };
});

function getUnits() {
  const arr = [];
  document.querySelectorAll('.unit-row').forEach(r => {
    const lbl = r.querySelector('.u-lbl').value.trim();
    const gr = Number(r.querySelector('.u-gr').value);
    if(lbl && gr > 0) arr.push({ label: lbl, grams: gr });
  });
  if(arr.length === 0) arr.push({ label: '100 جرام', grams: 100 });
  return arr;
}

// --- 3. إدارة الوسوم الطبية (Smart Tags) ---
document.querySelectorAll('.tag-btn').forEach(btn => {
  btn.onclick = () => btn.classList.toggle('active');
});

function getActiveTags() {
  const tags = [];
  document.querySelectorAll('.tag-btn.active').forEach(b => tags.push(b.dataset.tag));
  const manual = $('hashTagsManual').value ? $('hashTagsManual').value.split(' ').map(t => t.trim()).filter(t => t.startsWith('#')) : [];
  return [...new Set([...tags, ...manual])];
}

function setActiveTags(tagsArr) {
  document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
  if($('hashTagsManual')) $('hashTagsManual').value = '';
  const manual = [];
  (tagsArr || []).forEach(t => {
    const btn = document.querySelector(`.tag-btn[data-tag="${t}"]`);
    if(btn) btn.classList.add('active'); else manual.push(t);
  });
  if($('hashTagsManual')) $('hashTagsManual').value = manual.join(' ');
}

// --- 4. معالجة الصور (رفع أو رابط خارجي) ---
if($('btn-pick')) $('btn-pick').onclick = () => $('imageFile').click();
if($('imageFile')) {
  $('imageFile').onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    lastPickedFile = file;
    $('imagePreview').src = URL.createObjectURL(file);
    $('imagePreview').style.display = 'block';
    if($('imageUrl')) $('imageUrl').value = ''; // تفريغ الرابط لو اختار ملف
  };
}
if($('imageUrl')) {
  $('imageUrl').oninput = () => {
    if($('imageUrl').value) {
      $('imagePreview').src = $('imageUrl').value;
      $('imagePreview').style.display = 'block';
      lastPickedFile = null; // تفريغ الملف لو وضع رابط
    } else {
      $('imagePreview').style.display = 'none';
    }
  };
}

async function handleImageUpload(itemId) {
  if(!lastPickedFile) return null;
  const ext = lastPickedFile.name.split('.').pop();
  const path = `food-items/${itemId}/main.${ext}`; 
  
  $('upload-bar').classList.remove('hidden');
  const storageRef = sRef(storage, path);
  
  try {
    await new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef, lastPickedFile);
      task.on('state_changed', 
        snap => { $('upload-bar-fill').style.width = Math.round((snap.bytesTransferred/snap.totalBytes)*100) + '%'; },
        reject, resolve
      );
    });
    const url = await getDownloadURL(storageRef);
    $('upload-bar').classList.add('hidden');
    return { path, url };
  } catch(err) {
    console.warn("Storage upload failed:", err);
    $('upload-bar').classList.add('hidden');
    return null; // فشل الرفع (غالباً بسبب الصلاحيات أو الخطة المجانية)
  }
}

// --- 5. فتح وإغلاق المحرر (CRUD) ---
const dialog = $('edit-dialog');
if($('btn-add')) $('btn-add').onclick = () => openEditor(null);
if($('dlg-close')) $('dlg-close').onclick = () => dialog.close();
if($('btn-cancel')) $('btn-cancel').onclick = () => dialog.close();

async function openEditor(id) {
  $('edit-form').reset(); $('units-list').innerHTML = ''; setActiveTags([]);
  $('imagePreview').style.display = 'none'; lastPickedFile = null; currentImagePath = '';
  $('btn-delete').style.display = id ? 'block' : 'none';
  $('dlg-title').textContent = id ? 'تعديل صنف' : 'إضافة صنف جديد';

  if (id) {
    const snap = await getDoc(doc(FOODS, id));
    const d = snap.data();
    $('item-id').value = snap.id;
    $('name').value = d.name || ''; $('category').value = d.category || 'أخرى';
    
    const p = d.per100 || {};
    $('carbs_g').value = p.carbs_g || ''; $('fiber_g').value = p.fiber_g || '';
    $('protein_g').value = p.protein_g || ''; $('fat_g').value = p.fat_g || '';
    $('cal_kcal').value = p.cal_kcal || ''; $('gi').value = p.gi || '';
    
    (d.units || []).forEach(u => $('units-list').appendChild(createUnitRow(u)));
    setActiveTags(d.tags || []);
    
    const imgData = d.image || {};
    currentImagePath = imgData.path || '';
    if($('imageUrl')) $('imageUrl').value = imgData.url || '';
    if(imgData.url) { $('imagePreview').src = imgData.url; $('imagePreview').style.display = 'block'; }
  } else {
    $('item-id').value = '';
    $('units-list').appendChild(createUnitRow({ label: '100 جرام', grams: 100 }));
  }
  dialog.showModal();
}

// --- 6. حفظ الصنف ---
if($('edit-form')) {
  $('edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const btnSave = $('btn-save'); btnSave.disabled = true; btnSave.textContent = 'جاري الحفظ...';
    
    try {
      const id = $('item-id').value || doc(FOODS).id;
      let finalUrl = $('imageUrl') ? $('imageUrl').value.trim() : '';
      let finalPath = currentImagePath;
      
      // لو المستخدم اختار ملف، حاول ترفعه للفاير بيز
      if(lastPickedFile) {
        const uploadResult = await handleImageUpload(id);
        if(uploadResult) {
          finalUrl = uploadResult.url;
          finalPath = uploadResult.path;
        } else {
          alert("⚠️ فشل رفع الصورة للسيرفر (قد تحتاج لترقية خطة الفايربيز). تم حفظ بيانات الصنف بدون الصورة. يُنصح باستخدام رابط خارجي.");
        }
      }

      const payload = {
        name: $('name').value.trim(), category: $('category').value,
        per100: {
          carbs_g: Number($('carbs_g').value), fiber_g: Number($('fiber_g').value),
          protein_g: Number($('protein_g').value), fat_g: Number($('fat_g').value),
          cal_kcal: Number($('cal_kcal').value), gi: Number($('gi').value)
        },
        units: getUnits(), tags: getActiveTags(),
        image: { path: finalPath, url: finalUrl },
        searchText: `${$('name').value} ${$('category').value} ${getActiveTags().join(' ')}`.toLowerCase(),
        updatedAt: serverTimestamp()
      };

      if(!$('item-id').value) payload.createdAt = serverTimestamp();
      await setDoc(doc(FOODS, id), payload, { merge: true });
      
      dialog.close();
    } catch(err) { alert('خطأ في الحفظ: ' + err.message); }
    finally { btnSave.disabled = false; btnSave.textContent = '💾 حفظ الصنف في المكتبة'; }
  };
}

if($('btn-delete')) {
  $('btn-delete').onclick = async () => {
    if(confirm('هل أنت متأكد من حذف هذا الصنف نهائياً؟')) {
      await deleteDoc(doc(FOODS, $('item-id').value)); dialog.close();
    }
  };
}

// --- 7. العرض الحي (Live Feed) وإصلاح شكل الكارت ---
function startLive() {
  onSnapshot(FOODS, snap => {
    cache = []; snap.forEach(s => cache.push({ id: s.id, ...s.data() }));
    render();
  });
}

function render() {
  if(!$('cards')) return;
  const q = $('search') ? $('search').value.toLowerCase() : '';
  const cat = $('filter-category') ? $('filter-category').value : '';
  
  const list = cache.filter(x => {
    const matchQ = !q || (x.searchText && x.searchText.includes(q));
    const matchCat = !cat || x.category === cat;
    return matchQ && matchCat;
  });

  $('cards').innerHTML = list.map(x => {
    // تحديد شكل الصورة: لو مفيش رابط، ارسم Div رمادي متناسق وصغير
    const imgSrc = x.image?.url || x.imageUrl || '';
    const imageElement = imgSrc 
      ? `<img src="${imgSrc}" onerror="this.style.display='none'" alt="${x.name}">` 
      : `<div style="height:140px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; border-radius:8px; margin-bottom:12px; color:#94a3b8; font-size:14px; border: 1px dashed #cbd5e1;">🍽️ بدون صورة</div>`;

    return `
      <article class="food-card">
        ${x.per100?.gi > 0 ? `<div class="gi-badge">GI: ${x.per100.gi}</div>` : ''}
        ${(x.tags && x.tags.includes('#علاج_هبوط')) ? `<div class="gi-badge" style="background:#fef2f2; color:#b91c1c; border:1px solid #fca5a5; right:auto; left:8px;">🧃 صنف رفع</div>` : ''}
        ${imageElement}
        <h3>${x.name}</h3>
        <div class="cat">${x.category} | ${x.per100?.cal_kcal || 0} kcal</div>
        <div class="macros">
          <div><strong>${x.per100?.carbs_g || 0}g</strong>كارب</div>
          <div><strong>${x.per100?.protein_g || 0}g</strong>بروتين</div>
          <div><strong>${x.per100?.fat_g || 0}g</strong>دهون</div>
        </div>
        <button class="btn ghost sm mt-10" onclick="document.getElementById('edit-dialog').dispatchEvent(new CustomEvent('edit-item', {detail: '${x.id}'}))" style="width:100%">تعديل الصنف</button>
      </article>
    `;
  }).join('');
}

if($('edit-dialog')) $('edit-dialog').addEventListener('edit-item', (e) => openEditor(e.detail));
if($('search')) $('search').oninput = render;
if($('filter-category')) $('filter-category').onchange = render;
