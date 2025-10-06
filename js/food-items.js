<!-- IMPORTANT: اجعلي هذا السكربت type="module" في الـ HTML أو اربطيه كملف .js عادي يحتوي نفس الكود -->
<script type="module">
// ======================= Firebase (modular) =======================
import { initializeApp, getApps, getApp } 
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getFirestore, collection, doc, getDocs, getDoc,
  addDoc, updateDoc, deleteDoc, serverTimestamp,
  query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// نفس الإعدادات اللي عطيتني إياها
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.firebasestorage.app",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};

// تهيئة آمنة
const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// مرجع الـ collection الصحيح
const FOOD_COLL = collection(db, 'admin', 'global', 'foodItems');

// ======================= DOM Helpers =======================
const $ = (sel) => document.querySelector(sel);
const itemsContainer = $('#itemsContainer') || $('#items') || document.body;
const btnAdd     = $('#btnAdd');
const btnExport  = $('#btnExport');
const btnImport  = $('#btnImport'); // (اختياري لو هتضيفيه لاحقًا)
const btnRefresh = $('#btnRefresh');
const chkActive  = $('#chkActiveOnly');

// ======================= Data I/O =======================

// تحميل الأصناف (نشط فقط أو كلهم)
async function loadItems() {
  try {
    const activeOnly = chkActive?.checked ?? true;
    const q = activeOnly
      ? query(FOOD_COLL, where('isActive','==', true), orderBy('name'))
      : query(FOOD_COLL, orderBy('name'));

    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderItems(items);
  } catch (e) {
    console.error('loadItems error:', e);
    alert('حصل خطأ أثناء تحميل البيانات');
  }
}

// إضافة صنف (نافذة سريعة — بدّليها بمودال الإدخال عندك)
async function addItemQuick() {
  const name = prompt('اسم الصنف (AR):');
  if (!name) return;
  const category = prompt('الفئة (AR):', 'نشويات') || 'نشويات';

  const item = {
    name,
    category,
    isActive: true,
    nutrPer100g: { cal_kcal: 0, carbs_g: 0, fat_g: 0, protein_g: 0 },
    measures: [{ name: 'جرام', grams: 100 }],
    dietTags: [],
    hashtags: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await addDoc(FOOD_COLL, item);
    await loadItems();
  } catch (e) {
    console.error('addItem error:', e);
    alert('تعذر إضافة الصنف (تحقق من صلاحيات الأدمن)');
  }
}

// تحديث صنف بسيط (يعدل الاسم فقط كمثال)
async function editItemName(id, currentName) {
  const name = prompt('تعديل الاسم:', currentName || '');
  if (!name || name === currentName) return;

  try {
    await updateDoc(doc(FOOD_COLL, id), { name, updatedAt: serverTimestamp() });
    await loadItems();
  } catch (e) {
    console.error('updateItem error:', e);
    alert('تعذر التعديل (تحقق من صلاحيات الأدمن)');
  }
}

// حذف صنف
async function removeItem(id) {
  if (!confirm('متأكد من الحذف؟')) return;
  try {
    await deleteDoc(doc(FOOD_COLL, id));
    await loadItems();
  } catch (e) {
    console.error('deleteItem error:', e);
    alert('تعذر الحذف (تحقق من صلاحيات الأدمن)');
  }
}

// ======================= Render =======================
function renderItems(items) {
  // بطاقة بسيطة — استبدليها بتنسيقك
  itemsContainer.innerHTML = items.map(it => `
    <div class="card" style="border:1px solid #eee; padding:12px; margin:8px; border-radius:10px; display:inline-block; min-width:220px">
      <div style="font-weight:700; font-size:16px">${escapeHtml(it.name || '-')}</div>
      <div style="color:#666; margin:4px 0">${escapeHtml(it.category || '')}</div>
      <div style="margin-top:8px">
        <button data-id="${it.id}" data-name="${escapeHtml(it.name || '')}" class="btn-edit">تعديل</button>
        <button data-id="${it.id}" class="btn-del" style="background:#111;color:#fff">حذف</button>
      </div>
    </div>
  `).join('');

  // ربط الأحداث
  itemsContainer.querySelectorAll('.btn-edit').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.currentTarget.dataset.id;
      const name = e.currentTarget.dataset.name;
      editItemName(id, name);
    });
  });
  itemsContainer.querySelectorAll('.btn-del').forEach(btn=>{
    btn.addEventListener('click', e=>{
      const id = e.currentTarget.dataset.id;
      removeItem(id);
    });
  });
}

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s]));
}

// ======================= Export (CSV) =======================
// تصدير CSV بدون مكتبات لتجنب أخطاء XLSX/utils
async function exportToCSV() {
  try {
    const snap = await getDocs(query(FOOD_COLL, orderBy('name')));
    const rows = snap.docs.map(d => ({
      id: d.id,
      name: d.data().name ?? '',
      category: d.data().category ?? '',
      isActive: d.data().isActive ?? '',
      gi: d.data().gi ?? '',
      imageUrl: d.data().imageUrl ?? '',
      dietTags: (d.data().dietTags || []).join('|'),
      hashtags: (d.data().hashtags || []).join('|'),
      cal_kcal: d.data().nutrPer100g?.cal_kcal ?? '',
      carbs_g: d.data().nutrPer100g?.carbs_g ?? '',
      fat_g: d.data().nutrPer100g?.fat_g ?? '',
      protein_g: d.data().nutrPer100g?.protein_g ?? '',
    }));

    const header = Object.keys(rows[0] || {
      id:'',name:'',category:'',isActive:'',gi:'',imageUrl:'',
      dietTags:'',hashtags:'',cal_kcal:'',carbs_g:'',fat_g:'',protein_g:''
    });

    const csv = [
      header.join(','),
      ...rows.map(r => header.map(h => csvCell(r[h])).join(','))
    ].join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'foodItems.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('exportToCSV error:', e);
    alert('حصل خطأ أثناء التصدير');
  }
}

function csvCell(v){
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

// ======================= Import (اختياري لاحقًا) =======================
// تقدرِ تعتمدي CSV نفس الفورمات وترفعيه بملف input؛ هنضيفه لو حبيتي.

// ======================= Events =======================
btnAdd     && btnAdd.addEventListener('click', addItemQuick);
btnExport  && btnExport.addEventListener('click', exportToCSV);
btnRefresh && btnRefresh.addEventListener('click', loadItems);
chkActive  && chkActive.addEventListener('change', loadItems);

// حمل البيانات أول ما الصفحة تفتح
loadItems();

</script>
