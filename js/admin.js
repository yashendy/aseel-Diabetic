import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, updateDoc, getDoc, setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);

/* Tabs */
document.querySelectorAll('.tab').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $('tab-pending').style.display = b.dataset.tab==='pending' ? 'block':'none';
    $('tab-assign').style.display  = b.dataset.tab==='assign'  ? 'block':'none';
  });
});

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  // مبدئيًا: افتراضي إن الأدمن فقط يفتح الصفحة (في الحارس أو القواعد)
  await loadPending();
  await loadAssignSelectors();
});

/* ---- تبويب: طلبات الدكاترة ---- */
async function loadPending(){
  const snap = await getDocs(query(collection(db,'users'), where('role','==','doctor-pending')));
  const list=[]; snap.forEach(s=> list.push({id:s.id, ...s.data()}));
  const cont = $('pendingList'); cont.innerHTML='';
  if(!list.length){ $('pendingEmpty').style.display='block'; return; }
  $('pendingEmpty').style.display='none';

  list.forEach(u=>{
    const div = document.createElement('div');
    div.className='meal-card';
    div.innerHTML = `
      <div class="type">👨‍⚕️ ${u.displayName||'-'}</div>
      <div>${u.email||''} ${u.specialty?('• '+u.specialty):''} ${u.clinic?('• '+u.clinic):''}</div>
      <div class="actions">
        <button class="approve">✅ موافقة</button>
        <button class="reject secondary">رفض ⇢ Parent</button>
      </div>
    `;
    div.querySelector('.approve').onclick = ()=> approveDoctor(u.id);
    div.querySelector('.reject').onclick  = ()=> rejectDoctor(u.id);
    cont.appendChild(div);
  });
}
async function approveDoctor(uid){
  await updateDoc(doc(db,'users',uid), { role:'doctor' });
  await loadPending();
}
async function rejectDoctor(uid){
  await updateDoc(doc(db,'users',uid), { role:'parent' });
  await loadPending();
}

/* ---- تبويب: الربط ---- */
async function loadAssignSelectors(){
  // parents
  const parentsSnap = await getDocs(collection(db,'parents'));
  const parents=[]; parentsSnap.forEach(s=> parents.push({id:s.id,...s.data()}));
  $('parentSel').innerHTML = parents.map(p=> `<option value="${p.id}">${p.displayName||p.name||p.id}</option>`).join('');

  // doctors
  const docSnap = await getDocs(query(collection(db,'users'), where('role','==','doctor')));
  const doctors=[]; docSnap.forEach(s=> doctors.push({id:s.id,...s.data()}));
  $('doctorSel').innerHTML = doctors.map(d=> `<option value="${d.id}">${d.displayName||d.email||d.id}</option>`).join('');

  // children (لأول ولي أمر)
  $('parentSel').addEventListener('change', fillChildren);
  await fillChildren();
}
async function fillChildren(){
  const pid = $('parentSel').value;
  const snap = await getDocs(collection(db,`parents/${pid}/children`));
  const kids=[]; snap.forEach(s=> kids.push({id:s.id,...s.data()}));
  $('childSel').innerHTML = kids.map(k=> `<option value="${k.id}">${k.name||k.id}</option>`).join('');
}

$('assignBtn').addEventListener('click', async ()=>{
  const pid = $('parentSel').value;
  const cid = $('childSel').value;
  const did = $('doctorSel').value;
  const cref = doc(db, `parents/${pid}/children/${cid}`);
  await updateDoc(cref, {
    assignedDoctor: did,
    assignedDoctorInfo: { uid: did },
    sharingConsent: { doctor: true, since: new Date().toISOString() }
  });
  alert('تم الربط بنجاح ✅');
});

/* ---- توليد كود للدكتور ومشاركته ---- */
function genCode(len=6){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c=''; for(let i=0;i<len;i++) c+=chars[Math.floor(Math.random()*chars.length)];
  return c;
}
async function createDoctorCode(doctorUid){
  let code, snap;
  do {
    code = genCode(6);
    snap = await getDoc(doc(db,'doctorCodes', code));
  } while (snap.exists());

  await setDoc(doc(db,'doctorCodes', code), {
    doctorUid, active:true, createdAt: serverTimestamp()
  });
  await updateDoc(doc(db,'users', doctorUid), { doctorCode: code });
  return code;
}

$('genCodeBtn').addEventListener('click', async ()=>{
  const did = $('doctorSel').value; if(!did){ alert('اختاري دكتور'); return; }
  const code = await createDoctorCode(did);
  $('theCode').textContent = code;
  $('codeBox').style.display = 'block';

  const parentURL = location.origin + location.pathname.replace(/\/[^\/]*$/,'/') + `parent-dashboard.html?doctorCode=${code}`;
  $('copyCodeBtn').onclick = async ()=>{ await navigator.clipboard.writeText(code); alert('تم نسخ الكود'); };
  const txt = encodeURIComponent(`كود ربط الدكتور: ${code}\nالرابط المباشر: ${parentURL}`);
  $('waLink').href   = `https://wa.me/?text=${txt}`;
  $('mailLink').href = `mailto:?subject=${encodeURIComponent('كود ربط الدكتور')}&body=${txt}`;
  $('qrImg').src     = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(parentURL)}`;
});
