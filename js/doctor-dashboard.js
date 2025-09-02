<!-- js/doctor-dashboard.js -->
<script type="module">
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collectionGroup, query, where, getDocs, doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);
let allChildren = [];

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }

  // لو مش معتمد، امنعه
  // (اختياري: جلب users/{uid} role… لكن نفترض أنه دخل بعد الموافقة)
  const qy = query(collectionGroup(db,'children'), where('assignedDoctor','==', user.uid));
  const snap = await getDocs(qy);
  allChildren = [];
  snap.forEach(s=>{
    const path = s.ref.path.split('/');
    const parentId = path[1];
    const childId  = path[3];
    allChildren.push({ parentId, childId, ...s.data() });
  });
  render(allChildren);

  $('genCode').onclick = ()=> generateLinkCode(user.uid);
  $('copyCode').onclick = copyCode;
});

$('q')?.addEventListener('input', ()=>{
  const t = $('q').value.trim().toLowerCase();
  const f = allChildren.filter(c=> (c.name||'').toLowerCase().includes(t));
  render(f);
});

function render(list){
  const wrap = $('childList'); wrap.innerHTML='';
  if(!list.length){ $('empty').style.display='block'; return; }
  $('empty').style.display='none';

  list.forEach(c=>{
    const div = document.createElement('div');
    div.className = 'cardx child-card';
    const age = c.birthDate ? calcAge(c.birthDate) : '-';
    div.innerHTML = `
      <div>
        <div><strong>${escapeHtml(c.name||'-')}</strong> <span class="muted">• ${c.gender||'-'} • العمر ${age}</span></div>
        <div class="muted tiny">وحدة: ${c.glucoseUnit||'-'} • CR ${c.carbRatio??'-'} • CF ${c.correctionFactor??'-'}</div>
      </div>
      <div><a class="secondary" href="doctor-child.html?parent=${encodeURIComponent(c.parentId)}&child=${encodeURIComponent(c.childId)}">عرض</a></div>
    `;
    wrap.appendChild(div);
  });
}

function calcAge(bd){ const b = new Date(bd), t = new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; }
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }

function genCodeStr(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<7;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
async function generateLinkCode(doctorId){
  const code = genCodeStr();
  await setDoc(doc(db,'linkCodes', code), {
    doctorId, used:false, parentId:null, createdAt: serverTimestamp()
  });
  $('linkCode').textContent = code;
  document.getElementById('genWrap').classList.remove('hidden');
}
function copyCode(){
  const v = $('linkCode').textContent.trim();
  if(!v) return;
  navigator.clipboard.writeText(v);
  alert('تم نسخ الكود');
}
</script>
