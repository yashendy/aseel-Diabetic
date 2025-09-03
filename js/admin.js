// js/admin.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, updateDoc, getDoc, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (s)=>document.querySelector(s);
const $$= (s)=>document.querySelectorAll(s);
const esc=(s)=>(s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const toastEl = $('#toast');
function toast(t, type='info'){
  if(!toastEl) return;
  toastEl.textContent=t;
  toastEl.className=`toast ${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(()=>toastEl.classList.add('hidden'),1600);
}

/* تبويبات */
function wireTabs(){
  $$('.tab-btn').forEach(b=>{
    b.addEventListener('click', ()=>{
      $$('.tab-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const t=b.dataset.tab;
      $$('.tab').forEach(s=>s.classList.toggle('active', s.id===`tab-${t}`));
    });
  });
}

/* طلبات الأطباء pending */
async function loadPendingDoctors(){
  const grid = $('#grid'), empty = $('#empty'), stats = $('#stats');
  if(!grid) return;
  grid.innerHTML=''; empty.style.display='block'; stats.textContent='';

  const qy = query(collection(db,'doctors'), where('status','==','pending'));
  const snap = await getDocs(qy);
  let n=0;
  snap.forEach(d=>{
    n++;
    const v=d.data();
    const card=document.createElement('div');
    card.className='cardItem';
    card.innerHTML=`
      <div class="row">
        <div>
          <div class="name">${esc(v.name||'-')}</div>
          <div class="meta">${esc(v.email||'')}</div>
          <div class="meta tiny">تخصص: ${esc(v.specialty||'-')} • جهة: ${esc(v.clinic||'-')}</div>
        </div>
        <div class="kit">
          <button class="btn primary approve">اعتماد</button>
          <button class="btn danger reject">رفض</button>
        </div>
      </div>
    `;
    card.querySelector('.approve').onclick = ()=> approveDoctor(d.id);
    card.querySelector('.reject').onclick  = ()=> rejectDoctor(d.id);
    grid.appendChild(card);
  });
  empty.style.display = n? 'none' : 'block';
  stats.textContent = `الطلبات المعلّقة: ${n}`;
}
async function approveDoctor(uid){
  await updateDoc(doc(db,'doctors',uid), { status:'approved' });
  await updateDoc(doc(db,'users',uid),   { role:'doctor' });
  toast('تم الاعتماد','success');
  loadPendingDoctors();
}
async function rejectDoctor(uid){
  await updateDoc(doc(db,'doctors',uid), { status:'rejected' });
  await updateDoc(doc(db,'users',uid),   { role:'doctor-rejected' });
  toast('تم الرفض','success');
  loadPendingDoctors();
}

/* أكواد الربط */
async function findCode(){
  const v = ($('#codeQ')?.value||'').trim().toUpperCase();
  const list = $('#codeList'), empty = $('#codeEmpty');
  if(!v){ list.innerHTML=''; empty.style.display='block'; return; }
  const qy = query(
    collection(db,'linkCodes'),
    where('__name__','>=',v),
    where('__name__','<=',v+'\uf8ff'),
    limit(20)
  );
  const snap = await getDocs(qy);
  let c=0; list.innerHTML='';
  snap.forEach(s=>{
    c++;
    const d=s.data();
    const el=document.createElement('div');
    el.className='cardItem';
    el.innerHTML=`
      <div class="row">
        <div>
          <div class="name">الكود: <b>${esc(s.id)}</b></div>
          <div class="meta tiny">
            دكتور: ${esc(d.doctorId||d.doctorUid||'-')} • مستخدم: ${d.used?'نعم':'لا'}
            ${d.parentId?`• وليّ: ${esc(d.parentId)}`:''}
            ${d.childId?`• طفل: ${esc(d.childId)}`:''}
          </div>
        </div>
      </div>`;
    list.appendChild(el);
  });
  empty.style.display = c? 'none':'block';
}

/* Auth & boot */
onAuthStateChanged(auth, async(u)=>{
  if(!u){ location.href='index.html'; return; }
  const us = await getDoc(doc(db,'users',u.uid));
  if(!us.exists() || us.data()?.role!=='admin'){ alert('صلاحية الأدمن مطلوبة'); location.href='index.html'; return; }

  wireTabs();

  if($('#refresh')) $('#refresh').onclick = loadPendingDoctors;
  await loadPendingDoctors();

  if($('#codeFind')) $('#codeFind').onclick = findCode;
});
