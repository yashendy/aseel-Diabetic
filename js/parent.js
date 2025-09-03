// js/parent.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, orderBy, doc, getDoc, writeBatch, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const kidsGrid = document.getElementById('kidsGrid');
const emptyEl  = document.getElementById('empty');
const searchEl = document.getElementById('search');
const loaderEl = document.getElementById('loader');

const linkDlg    = document.getElementById('linkDlg');
const linkOpen   = document.getElementById('openLinkDlg');
const linkCancel = document.getElementById('linkCancel');
const linkSubmit = document.getElementById('linkSubmit');
const linkInput  = document.getElementById('linkCodeInput');
const linkMsg    = document.getElementById('linkMsg');

let currentUser, kids = [], filtered = [];

function loader(x){loaderEl?.classList.toggle('hidden',!x)}
function esc(s){return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;")}

onAuthStateChanged(auth, async (u)=>{
  if(!u) return location.href='index.html';
  currentUser=u; 
  await loadKids();
});

searchEl?.addEventListener('input', ()=>{
  const q = searchEl.value.trim().toLowerCase();
  filtered = q ? kids.filter(k => (k.name||'').toLowerCase().includes(q)) : kids;
  render();
});

async function loadKids(){
  loader(true);
  try{
    const ref=collection(db,`parents/${currentUser.uid}/children`);
    const qy=query(ref,orderBy('name','asc'));
    const snap=await getDocs(qy);
    kids=[];
    snap.forEach(d=> kids.push({ id:d.id, ...d.data() }));
    filtered=kids;
    render();
  }catch(e){console.error(e);alert('تعذّر تحميل الأطفال');}
  finally{loader(false);}
}

function render(){
  kidsGrid.innerHTML='';
  if(!filtered.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');
  filtered.forEach(k=>{
    const card=document.createElement('div');
    card.className='kid card';
    card.innerHTML=`
      <div class="kid-head">
        <div class="name">${esc(k.name||'طفل')}</div>
        <div class="meta">${esc(k.gender||'-')}</div>
        ${k.assignedDoctor ? `<span class="badge">مرتبط بدكتور</span>` : `<span class="badge">بدون دكتور</span>`}
      </div>
    `;
    kidsGrid.appendChild(card);
  });
}

/* ====================== ربط الطبيب عبر الكود ====================== */
linkOpen?.addEventListener('click', ()=>{ linkMsg.textContent=''; linkInput.value=''; linkDlg.showModal(); });
linkCancel?.addEventListener('click', ()=> linkDlg.close());
linkSubmit?.addEventListener('click', linkDoctor);

async function fetchDoctorInfo(doctorUid){
  const d1 = await getDoc(doc(db, `doctors/${doctorUid}`));
  if (d1.exists()){
    const x = d1.data();
    return { uid: doctorUid, name: x.name||null, specialty: x.specialty||null, clinic: x.clinic||null, phone: x.phone||null };
  }
  const d2 = await getDoc(doc(db, `users/${doctorUid}`));
  if (d2.exists()){
    const x = d2.data();
    return { uid: doctorUid, name: x.displayName||null };
  }
  return { uid: doctorUid };
}

async function linkDoctor(){
  const code = (linkInput.value||'').trim().toUpperCase();
  if(!code){ linkMsg.textContent='أدخلي الكود.'; return; }
  loader(true); linkMsg.textContent='جارٍ التحقق…';

  try{
    const codeRef = doc(db,'linkCodes',code);
    const s = await getDoc(codeRef);
    if(!s.exists()){ linkMsg.textContent='الكود غير موجود.'; loader(false); return; }
    const d = s.data();
    if(d.used){ linkMsg.textContent='الكود مستخدم.'; loader(false); return; }

    const doctorId = d.doctorId;
    const info     = await fetchDoctorInfo(doctorId);

    // ربط كل أطفال وليّ الأمر
    const ref = collection(db,`parents/${currentUser.uid}/children`);
    const snap = await getDocs(ref);
    const batch = writeBatch(db);
    snap.forEach(docu=>{
      batch.update(docu.ref, {
        assignedDoctor: doctorId,
        assignedDoctorInfo: {
          uid: info.uid,
          name: info.name||null,
          specialty: info.specialty||null,
          clinic: info.clinic||null,
          phone: info.phone||null,
          linkedAt: serverTimestamp()
        },
        // ✨ الإضافة المهمة
        sharingConsent: { doctor: true }
      });
    });

    batch.update(codeRef, { used:true, parentId: currentUser.uid, usedAt: serverTimestamp(), doctorId: d.doctorId });
    await batch.commit();

    linkMsg.textContent='تم الربط ✅';
    await loadKids();
    setTimeout(()=>linkDlg.close(), 700);
  }catch(e){
    console.error(e);
    linkMsg.textContent='فشل الربط.';
  }finally{loader(false);}
}
