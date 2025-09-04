// js/doctor-dashboard.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collectionGroup, query, where, getDocs,
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ================== أدوات صغيرة ================== */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => (s ?? '').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const age = bd => { if(!bd) return '—'; const b=new Date(bd),t=new Date();
  let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; };
function setText(sel, text){ const el=$(sel); if(el) el.textContent=text; }

/* ================== الإقلاع ================== */
onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  // (اختياري) تأكيد الدور من users/{uid} إن لزم
  await loadDoctorChildren();
  bindUI(); // ربط الأزرار بشكل آمن
});

/* ========== جلب الأطفال المعيّنين للدكتور مع الموافقة ==========
   يتطلب فهارس مركبة (Composite Indexes) لمجموعة children:
   1) assignedDoctor ASC + sharingConsent ASC
   2) assignedDoctor ASC + sharingConsent.doctor ASC
=============================================================== */
async function fetchLinkedChildren(doctorUid){
  const bag = new Map();

  // 1) sharingConsent.doctor == true
  try{
    const q1 = query(
      collectionGroup(db, 'children'),
      where('assignedDoctor','==', doctorUid),
      where('sharingConsent.doctor','==', true)
    );
    const s1 = await getDocs(q1);
    s1.forEach(d=> bag.set(d.ref.path, { id: d.id, ...d.data(), _path:d.ref.path }));
  }catch(err){
    console.warn('[children:consent.map] Missing index or permission.', err?.message || err);
  }

  // 2) sharingConsent == true
  try{
    const q2 = query(
      collectionGroup(db, 'children'),
      where('assignedDoctor','==', doctorUid),
      where('sharingConsent','==', true)
    );
    const s2 = await getDocs(q2);
    s2.forEach(d=> bag.set(d.ref.path, { id: d.id, ...d.data(), _path:d.ref.path }));
  }catch(err){
    console.warn('[children:consent.bool] Missing index or permission.', err?.message || err);
  }

  return [...bag.values()];
}

/* ================== تحميل وعرض ================== */
async function loadDoctorChildren(){
  try{
    setText('#childrenStatus', 'جارٍ التحميل…');
    const uid = auth.currentUser.uid;
    const children = await fetchLinkedChildren(uid);

    // لو عندك دالة قديمة للرندر، استخدميها
    if (typeof window.renderChildren === 'function'){
      window.renderChildren(children);
    } else {
      // رندر بسيط غير مخرّب
      const wrap = $('#childrenList') || $('#grid') || $('#kids') || document.querySelector('.children-list');
      if (wrap){
        wrap.innerHTML = '';
        if (!children.length){
          setText('#childrenStatus', 'لا يوجد أطفال معيّنون لك حتى الآن.');
        } else {
          children.forEach((c)=>{
            const card = document.createElement('div');
            card.className = 'cardItem' in window ? 'cardItem' : 'card';
            card.innerHTML = `
              <div class="row" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                  <div class="name">${esc(c.name||'طفل')}</div>
                  <div class="meta">العمر: ${age(c.birthDate)} • الوالد: ${esc(c.parentId||'-')}</div>
                </div>
                <div class="kit">
                  <a class="btn primary" href="child.html?child=${encodeURIComponent(c.id)}">فتح لوحة الطفل</a>
                </div>
              </div>
            `;
            wrap.appendChild(card);
          });
        }
      }
    }

    setText('#childrenStatus', children.length ? `الأطفال المعيّنون: ${children.length}` : 'لا يوجد أطفال معيّنون لك حتى الآن.');
  }catch(err){
    console.error(err);
    setText('#childrenStatus', 'تعذّر تحميل الأطفال (صلاحيات أو فهارس).');
  }
}

/* ================== ربط الأزرار بشكل آمن ================== */
function safe(fn){ return (typeof fn === 'function') ? fn : ()=>{}; }

function bindUI(){
  // أزرار الأطفال
  const r = document.querySelector('#refreshChildren');
  if (r) r.addEventListener('click', loadDoctorChildren);

  // أزرار أكواد الربط (لو موجودة في الصفحة الحالية)
  const genBtn = document.querySelector('#genCode');
  const copyBtn = document.querySelector('#copyCode');
  const refBtn  = document.querySelector('#refreshCodes');

  if (genBtn)  genBtn.addEventListener('click',  safe(window.generateLinkCode));
  if (copyBtn) copyBtn.addEventListener('click', ()=>{
    const v = (document.querySelector('#linkCode')||{}).textContent || '';
    if (v) navigator.clipboard.writeText(v);
  });
  if (refBtn)  refBtn.addEventListener('click',  safe(window.loadActiveCodes));
}

/* ================== انتهى ================== */
