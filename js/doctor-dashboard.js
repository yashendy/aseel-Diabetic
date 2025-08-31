import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collectionGroup, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);
let allChildren = [];

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }

  // اقرأ الأطفال المعيّنين للدكتور
  // ملاحظة: قد يطلب Index مركّب عند إضافة orderBy لاحقًا.
  const qy = query(collectionGroup(db,'children'), where('assignedDoctor','==', user.uid));
  const snap = await getDocs(qy);
  allChildren = [];
  snap.forEach(s=>{
    // parentId = /parents/{pid}/children/{cid}
    const path = s.ref.path.split('/');
    const parentId = path[1];
    const childId  = path[3];
    allChildren.push({ parentId, childId, ...s.data() });
  });

  render(allChildren);
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

function calcAge(bd){
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
