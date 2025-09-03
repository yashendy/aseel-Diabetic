// js/food-items.js
import { db } from './firebase-config.js';
import {
  collection, getDocs, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Config ---------- */
const FOOD_COLL = 'foodItems'; // <-- غيّره لو اسم المجموعة مختلف

/* ---------- Helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = (s)=> (s ?? '').toString().replace(/[&<>"']/g, m=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
}[m]));

const toast = (t)=>{
  const el = $('#toast');
  if (!el) { console.log('[toast]', t); return; }
  el.textContent = t;
  el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'),1500);
};

/* ---------- UI Render ---------- */
async function loadItems(){
  const grid  = $('#food-grid');
  const empty = $('#food-empty');
  const stats = $('#food-stats');

  if (!grid || !empty || !stats) return; // مش صفحة الأصناف

  grid.innerHTML = '';
  empty.style.display = 'block';
  stats.textContent = '';

  try {
    const snap = await getDocs(collection(db, FOOD_COLL));
    let n = 0;
    snap.forEach(d=>{
      n++;
      const v = d.data();
      const card = document.createElement('div');
      card.className = 'cardItem';
      card.dataset.id = d.id;
      card.innerHTML = `
        <div class="row">
          <div>
            <div class="name">${esc(v.name || '-')}</div>
            <div class="meta">${esc(v.category || '')}</div>
          </div>
          <div class="kit">
            <button class="btn primary edit">تعديل</button>
            <button class="btn danger delete">حذف</button>
          </div>
        </div>
      `;
      const editBtn = card.querySelector('.edit');
      const delBtn  = card.querySelector('.delete');

      if (editBtn) editBtn.addEventListener('click', () => openEdit(d.id));
      if (delBtn)  delBtn.addEventListener('click', () => removeItem(d.id));

      grid.appendChild(card);
    });

    empty.style.display = n ? 'none' : 'block';
    stats.textContent = `عدد الأصناف: ${n}`;
  } catch (e) {
    console.error(e);
    toast('تعذّر تحميل الأصناف');
  }
}

/* ---------- Actions ---------- */
function openEdit(id){
  // افتح مودال/نموذج التعديل حسب تطبيقك
  console.log('edit item', id);
  toast('فتح التعديل');
}

export async function removeItem(id){
  if (!id) return;
  if (!confirm('هل تريد حذف الصنف نهائيًا؟')) return;

  try {
    await deleteDoc(doc(db, FOOD_COLL, id));
    // شيل الكارت من الـDOM لو موجود
    const card = $(`.cardItem[data-id="${id}"]`);
    if (card && card.parentElement) card.parentElement.removeChild(card);
    toast('تم حذف الصنف');
    // تحديث الإحصائيات البسيطة
    const grid = $('#food-grid');
    const stats = $('#food-stats');
    const empty = $('#food-empty');
    if (grid && stats && empty) {
      const count = grid.querySelectorAll('.cardItem').length;
      stats.textContent = `عدد الأصناف: ${count}`;
      empty.style.display = count ? 'none' : 'block';
    }
  } catch (e) {
    console.error(e);
    toast('تعذّر حذف الصنف');
  }
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', loadItems);
