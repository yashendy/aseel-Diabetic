// js/meals.js (تعديل لجلب الأصناف من مكتبة عامة)
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc, getDoc,
  query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* --- DOM --- */
const tbody = document.getElementById('tbody');
const form = document.getElementById('mealForm');
const childNameEl = document.getElementById('childName');
const dayEl = document.getElementById('day');
const slotEl = document.getElementById('slot');
const foodEl = document.getElementById('food');
const gramsEl = document.getElementById('grams');
const notesEl = document.getElementById('notes');
const btnSave = document.getElementById('btnSave');
const loaderEl = document.getElementById('loader');

/* --- State --- */
let USER = null;
let CHILD_ID = null;
let FOOD_CACHE = [];
let EDIT_ID = null;

/* --- Utils --- */
function pad(n){return String(n).padStart(2,'0')}
function todayStr(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}

function loader(show){ loaderEl?.classList.toggle('hidden', !show); }

/* --- Auth --- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER = user;

  const params = new URLSearchParams(location.search);
  CHILD_ID = params.get('child');
  if(!CHILD_ID){ alert('لا يوجد طفل'); history.back(); return; }

  childNameEl.textContent = "وجبات الطفل";
  dayEl.value = todayStr();

  await ensureFoodCache();
  await loadMeals();
});

/* --- Load Food Items (from admin global list) --- */
async function ensureFoodCache(){
  const ref = collection(db, `foodItems`);
  const snap = await getDocs(query(ref, orderBy('name')));
  FOOD_CACHE = snap.docs.map(d=>({id:d.id,...d.data()}));
  foodEl.innerHTML = `<option value="">— اختَر —</option>` + FOOD_CACHE.map(
    it=>`<option value="${it.id}">${it.name}</option>`
  ).join('');
}

/* --- Load Meals --- */
async function loadMeals(){
  loader(true);
  tbody.innerHTML = '';
  const ref = collection(db, `parents/${USER.uid}/children/${CHILD_ID}/meals`);
  const snap = await getDocs(query(ref, where('date','==',dayEl.value), orderBy('slot')));
  if(snap.empty){ tbody.innerHTML=`<tr><td colspan="6" class="meta">لا توجد وجبات</td></tr>`; }
  else{
    snap.forEach(docSnap=>{
      const row = {id:docSnap.id, ...docSnap.data()};
      const food = FOOD_CACHE.find(f=>f.id===row.itemId);
      const tr=document.createElement('tr');
      tr.innerHTML=`
        <td>${row.slot||'—'}</td>
        <td>${food?food.name:'—'}</td>
        <td>${row.grams||'—'}</td>
        <td>${row.notes||''}</td>
        <td>
          <button class="btn small" onclick="editMeal('${row.id}')">✏ تعديل</button>
          <button class="btn small danger" onclick="deleteMeal('${row.id}')">🗑 حذف</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
  loader(false);
}

/* --- Save Meal --- */
form.addEventListener('submit', async e=>{
  e.preventDefault();
  if(!foodEl.value){ alert('اختر صنف'); return; }
  const payload = {
    date: dayEl.value,
    slot: slotEl.value,
    itemId: foodEl.value,
    grams: Number(gramsEl.value)||0,
    notes: notesEl.value.trim()||null,
    updatedAt: serverTimestamp()
  };

  try{
    if(EDIT_ID){
      await updateDoc(doc(db, `parents/${USER.uid}/children/${CHILD_ID}/meals/${EDIT_ID}`), payload);
    }else{
      await addDoc(collection(db, `parents/${USER.uid}/children/${CHILD_ID}/meals`), {...payload, createdAt: serverTimestamp()});
    }
    form.reset(); EDIT_ID=null; await loadMeals();
  }catch(err){ console.error(err); alert('خطأ أثناء الحفظ'); }
});

/* --- Edit Meal --- */
window.editMeal = async function(id){
  const snap = await getDoc(doc(db, `parents/${USER.uid}/children/${CHILD_ID}/meals/${id}`));
  if(!snap.exists()) return;
  const row = snap.data();
  EDIT_ID=id;
  dayEl.value=row.date;
  slotEl.value=row.slot;
  gramsEl.value=row.grams;
  notesEl.value=row.notes||'';

  // تحميل اسم الصنف من المكتبة العامة
  const d = await getDoc(doc(db, `foodItems/${row.itemId}`));
  if(d.exists()) foodEl.value=d.id;
  btnSave.textContent='💾 تحديث';
}

/* --- Delete Meal --- */
window.deleteMeal = async function(id){
  if(!confirm('هل تريد الحذف؟')) return;
  await deleteDoc(doc(db, `parents/${USER.uid}/children/${CHILD_ID}/meals/${id}`));
  await loadMeals();
}
