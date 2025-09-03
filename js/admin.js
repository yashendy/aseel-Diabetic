// js/admin.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, updateDoc, getDoc, limit, writeBatch
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function esc(s){
  return (s ?? '').toString().replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
  }[m]));
}

const toast = (t) => {
  const el = $('#toast');
  if (!el) { console.log('[toast]', t); return; }
  el.textContent = t;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 1500);
};

/* ---------- Auth Gate ---------- */
onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  try {
    const us = await getDoc(doc(db, 'users', u.uid));
    if (!us.exists() || us.data().role !== 'admin') {
      alert('صلاحية الأدمن مطلوبة');
      location.href = 'index.html';
      return;
    }
    boot();
  } catch (e) {
    console.error(e);
    alert('تعذر التحقق من الصلاحيات');
    location.href = 'index.html';
  }
});

/* ---------- Boot ---------- */
function boot(){
  // تبويبات عامة (لو موجودة في الصفحة)
  if ($$('.tab-btn').length) {
    $$('.tab-btn').forEach(b=>{
      b.onclick=()=>{
        $$('.tab-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        const t=b.dataset.tab;
        $$('.tab').forEach(s=>s.classList.toggle('active', s.id===`tab-${t}`));
      };
    });
  }

  // زر التحديث/البحث (لو موجودين على صفحة إدارة الطلبات/الأكواد)
  const r = $('#refresh');   if (r)  r.onclick  = loadPendingDoctors;
  const cf= $('#codeFind');  if (cf) cf.onclick = findCode;

  // تحميل الطلبات المعلقة فقط لو عناصرها موجودة (لتجنب التضارب مع صفحة الأصناف)
  if ($('#grid') && $('#empty') && $('#stats')) {
    // ملاحظة: هذه العناصر تخص صفحة إدارة الطلبات القديمة.
    // في صفحات أخرى مثل "الأصناف" عندك grid مختلف وستايل مختلف؛ لن يتم النداء هنا.
    loadPendingDoctors();
  }
}

/* ---------- Pending Doctors ---------- */
async function loadPendingDoctors(){
  // هذه العناصر تخص صفحة إدارة الطلبات فقط
  const grid  = $('#grid');
  const empty = $('#empty');
  const stats = $('#stats');
  if (!grid || !empty || !stats) return;

  grid.innerHTML = '';
  empty.style.display = 'block';
  stats.textContent = '';

  try {
    const qy = query(collection(db, 'doctors'), where('status','==','pending'));
    const snap = await getDocs(qy);
    let n = 0;

    snap.forEach(d=>{
      n++;
      const v = d.data();
      const card = document.createElement('div');
      card.className = 'card-item';
      card.dataset.id = d.id;
      card.innerHTML = `
        <div class="row">
          <div>
            <div class="name">${esc(v.name||'-')}</div>
            <div class="meta">${esc(v.email||'')}</div>
          </div>
          <div class="kit">
            <button class="btn primary approve">اعتماد</button>
            <button class="btn danger reject">رفض</button>
          </div>
        </div>
        <div class="meta">تخصص: ${esc(v.specialty||'-')} • جهة: ${esc(v.clinic||'-')}</div>
      `;
      const approveBtn = card.querySelector('.approve');
      const rejectBtn  = card.querySelector('.reject');
      if (approveBtn) approveBtn.onclick = () => approveDoctor(d.id);
      if (rejectBtn)  rejectBtn.onclick  = () => rejectDoctor(d.id);
      grid.appendChild(card);
    });

    empty.style.display = n ? 'none' : 'block';
    stats.textContent = `الطلبات المعلّقة: ${n}`;
  } catch (e) {
    console.error(e);
    toast('حدث خطأ أثناء التحميل');
  }
}

async function approveDoctor(uid){
  try {
    const batch = writeBatch(db);
    batch.update(doc(db,'doctors',uid), { status:'approved' });
    batch.update(doc(db,'users',uid),   { role:'doctor' });
    await batch.commit();
    toast('تم الاعتماد');
    await loadPendingDoctors();
  } catch (e) {
    console.error(e);
    toast('تعذّر اعتماد الطلب');
  }
}

async function rejectDoctor(uid){
  try {
    const batch = writeBatch(db);
    batch.update(doc(db,'doctors',uid), { status:'rejected' });
    batch.update(doc(db,'users',uid),   { role:'doctor-rejected' });
    await batch.commit();
    toast('تم الرفض');
    await loadPendingDoctors();
  } catch (e) {
    console.error(e);
    toast('تعذّر رفض الطلب');
  }
}

/* ---------- Link Codes Search ---------- */
async function findCode(){
  const list  = $('#codeList');
  const empty = $('#codeEmpty');
  const input = $('#codeQ');
  if (!list || !empty || !input) return;

  const v = (input.value||'').trim().toUpperCase();
  if(!v){ list.innerHTML=''; empty.style.display='block'; return; }

  try {
    const qy = query(
      collection(db,'linkCodes'),
      where('__name__','>=',v),
      where('__name__','<=',v+'\uf8ff'),
      limit(10)
    );
    const snap = await getDocs(qy);

    let c=0; list.innerHTML='';
    snap.forEach(s=>{
      c++;
      const d=s.data();
      const el=document.createElement('div');
      el.className='card-item';
      el.dataset.id = s.id;
      el.innerHTML=`
        <div class="row">
          <div>
            <div class="name">الكود: <b>${esc(s.id)}</b></div>
            <div class="meta">دكتور: ${esc(d.doctorId||'-')} • مستخدم: ${d.used?'نعم':'لا'} • وليّ: ${esc(d.parentId||'-')}</div>
          </div>
        </div>
      `;
      list.appendChild(el);
    });
    empty.style.display = c? 'none':'block';
  } catch (e) {
    console.error(e);
    toast('تعذّر البحث عن الأكواد');
  }
}
