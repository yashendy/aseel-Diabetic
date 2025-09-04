// js/doctor-dashboard.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collectionGroup, query, where, getDocs,
  doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* =========== أدوات بسيطة =========== */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => (s ?? '').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
const age = bd => { if(!bd) return '—'; const b=new Date(bd),t=new Date();
  let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; };
function setText(sel, text){ const el=$(sel); if(el) el.textContent=text; }
function show(sel, on){ const el=$(sel); if(el) el.style.display = on ? '' : 'none'; }

/* =========== إقلاع =========== */
onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  // لو عايزة تتأكدي من الدور، ممكن تجيبي users/{uid} وتتحققي من role === 'doctor'
  await loadDoctorChildren();        // ⬅️ أهم جزء: تحميل الأطفال المرتبطين
  bindUI();                          // ربط باقي الأزرار (لو موجودة)
});

/* =========== تحميل الأطفال المرتبطين بالدكتور =========== */
/**
 * يجلب الأطفال المعينين للدكتور مع موافقة مشاركة صالحة.
 * يعمل باستعلامين (Boolean و Map) ثم يوحّد النتائج.
 * يحتاج Composite Index:
 * 1) children: assignedDoctor ASC + sharingConsent ASC
 * 2) children: assignedDoctor ASC + sharingConsent.doctor ASC
 */
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
    s1.forEach(d=> bag.set(d.ref.path, { id: d.id, ...d.data(), _path: d.ref.path }));
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
    s2.forEach(d=> bag.set(d.ref.path, { id: d.id, ...d.data(), _path: d.ref.path }));
  }catch(err){
    console.warn('[children:consent.bool] Missing index or permission.', err?.message || err);
  }

  return [...bag.values()];
}

async function loadDoctorChildren(){
  try{
    // لافتة “تحميل…”
    setText('#childrenStatus', 'جارٍ التحميل…');
    const uid = auth.currentUser.uid;

    // اجلب الأطفال المرتبطين بالدكتور
    const children = await fetchLinkedChildren(uid);

    // عندك ريندر قديم؟ هنستدعيه لو موجود:
    if (typeof renderChildren === 'function'){
      renderChildren(children);
    } else {
      // ريندر بسيط غير مخرّب لو مفيش دالة قديمة
      const wrap = $('#childrenList') || $('#grid') || $('#kids') || $('.children-list');
      if (wrap){
        wrap.innerHTML = '';
        if (!children.length){
          setText('#childrenStatus', 'لا يوجد أطفال معيّنون لك حتى الآن.');
          return;
        }
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

    // حدّث اللِبِل
    setText('#childrenStatus', children.length ? `الأطفال المعيّنون: ${children.length}` : 'لا يوجد أطفال معيّنون لك حتى الآن.');
  }catch(err){
    console.error(err);
    setText('#childrenStatus', 'تعذّر تحميل الأطفال (صلاحيات أو فهارس).');
  }
}

/* =========== ربط باقي الأزرار كما هي (إن وُجدت) =========== */
function bindUI(){
  // أزرار موجودة قديمًا في صفحتك (نستدعيها إن كانت موجودة)
  $('#refreshChildren') && $('#refreshChildren').addEventListener('click', loadDoctorChildren);

  // لو عندك ميزة توليد أكواد ربط (هنسيبها كما هي إن كانت مربوطة بالفعل)
  // الأمثلة التالية لا تغيّر أي شيء في منطقك؛ فقط تتأكد أن الـDOM handlers متوصلة لو كانت موجودة.
  $('#genCode')     && $('#genCode').addEventListener('click', generateLinkCode);
  $('#copyCode')    && $('#copyCode').addEventListener('click', ()=>{
    const v = ($('#linkCode')||{}).textContent || '';
    if (v) navigator.clipboard.writeText(v);
  });
  $('#refreshCodes') && $('#refreshCodes').addEventListener('click', loadActiveCodes);

  // دوال موجودة أصلًا؟ ممتاز. لو مش موجودة، نعمل no-op عشان مايحصلش أخطاء.
  function noop(){/* no-op */ }
  window.generateLinkCode = window.generateLinkCode || noop;
  window.loadActiveCodes  = window.loadActiveCodes  || noop;
}

/* =========== ملاحظات مهمّة ===========
- لو مازال بيظهر تحذير Missing index:
  تأكدي من وجود Composite Index للـ collection group "children":
  1) assignedDoctor ASC + sharingConsent ASC
  2) assignedDoctor ASC + sharingConsent.doctor ASC
- لو مازال الجدول فاضي:
  تأكدي أن وثيقة الطفل فيها:
  assignedDoctor = UID الدكتور
  sharingConsent = true    (Boolean)  أو  sharingConsent.doctor = true
======================================= */
