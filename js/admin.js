// js/admin.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, updateDoc, getDoc, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = s=>document.querySelector(s);
const $$= s=>document.querySelectorAll(s);
const toast=(t)=>{ const el=$('#toast'); el.textContent=t; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),1500); };

onAuthStateChanged(auth, async(u)=>{
  if(!u){ location.href='index.html'; return; }
  const us = await getDoc(doc(db,'users',u.uid));
  if(!us.exists() || us.data().role!=='admin'){ alert('صلاحية الأدمن مطلوبة'); location.href='index.html'; return; }
  boot();
});

function boot(){
  $$('.tab-btn').forEach(b=>{
    b.onclick=()=>{
      $$('.tab-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const t=b.dataset.tab;
      $$('.tab').forEach(s=>s.classList.toggle('active', s.id===`tab-${t}`));
    };
  });

  loadPendingDoctors();
  $('#refresh').onclick = loadPendingDoctors;
  $('#codeFind').onclick = findCode;
}

async function loadPendingDoctors(){
  $('#grid').innerHTML=''; $('#empty').style.display='block'; $('#stats').textContent='';
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
        <div><div class="name">${esc(v.name||'-')}</div><div class="meta">${v.email||''}</div></div>
        <div class="kit">
          <button class="btn primary approve">اعتماد</button>
          <button class="btn danger reject">رفض</button>
        </div>
      </div>
      <div class="meta">تخصص: ${esc(v.specialty||'-')} • جهة: ${esc(v.clinic||'-')}</div>
    `;
    card.querySelector('.approve').onclick = ()=> approveDoctor(d.id);
    card.querySelector('.reject').onclick  = ()=> rejectDoctor(d.id);
    $('#grid').appendChild(card);
  });
  $('#empty').style.display = n? 'none':'block';
  $('#stats').textContent = `الطلبات المعلّقة: ${n}`;
}

async function approveDoctor(uid){
  await updateDoc(doc(db,'doctors',uid), { status:'approved' });
  await updateDoc(doc(db,'users',uid),   { role:'doctor' });
  toast('تم الاعتماد');
  loadPendingDoctors();
}
async function rejectDoctor(uid){
  await updateDoc(doc(db,'doctors',uid), { status:'rejected' });
  await updateDoc(doc(db,'users',uid),   { role:'doctor-rejected' });
  toast('تم الرفض');
  loadPendingDoctors();
}

async function findCode(){
  const v = ($('#codeQ').value||'').trim().toUpperCase();
  if(!v){ $('#codeList').innerHTML=''; $('#codeEmpty').style.display='block'; return; }
  const qy = query(collection(db,'linkCodes'), where('__name__','>=',v), where('__name__','<=',v+'\uf8ff'), limit(10));
  const snap = await getDocs(qy);
  let c=0; $('#codeList').innerHTML='';
  snap.forEach(s=>{
    c++;
    const d=s.data();
    const el=document.createElement('div');
    el.className='cardItem';
    el.innerHTML=`
      <div class="row">
        <div>
          <div class="name">الكود: <b>${esc(s.id)}</b></div>
          <div class="meta">دكتور: ${esc(d.doctorId||'-')} • مستخدم: ${d.used?'نعم':'لا'} • وليّ: ${esc(d.parentId||'-')}</div>
        </div>
      </div>
    `;
    $('#codeList').appendChild(el);
  });
  $('#codeEmpty').style.display = c? 'none':'block';
}

function esc(s){return (s??'').toString().replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));}
