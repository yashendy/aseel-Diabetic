// js/doctor-dashboard.js

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collectionGroup, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);

let ALL_CHILDREN = [];

/* ====== Boot ====== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }

  try {
    // يقرأ فقط الأطفال الذين تم تعيين الطبيب لهم
    const qy = query(
      collectionGroup(db, 'children'),
      where('assignedDoctor', '==', user.uid)
    );

    const snap = await getDocs(qy);
    ALL_CHILDREN = [];

    snap.forEach(docSnap=>{
      // /parents/{parentId}/children/{childId}
      const path = docSnap.ref.path.split('/'); // ["parents", pid, "children", cid]
      const parentId = path[1];
      const childId  = path[3];

      const d = docSnap.data();

      // لو القواعد سمحت، الوثيقة أصلاً مرشّحة. (إضافة تحقق احتياطي UI فقط)
      const consent = d?.sharingConsent === true
        || (d?.sharingConsent && typeof d.sharingConsent === 'object' && d.sharingConsent.doctor === true);

      if (consent) {
        ALL_CHILDREN.push({
          parentId,
          childId,
          ...d
        });
      }
    });

    render(ALL_CHILDREN);
  } catch (e) {
    console.error(e);
    $('childList').innerHTML = '';
    $('empty').style.display = 'block';
    $('empty').textContent = 'تعذّر تحميل الأطفال: صلاحيات غير كافية أو خطأ في الاتصال.';
  }
});

/* ====== بحث بالاسم ====== */
$('q')?.addEventListener('input', ()=>{
  const t = ($('q').value || '').trim().toLowerCase();
  const f = ALL_CHILDREN.filter(c => (c.name || '').toLowerCase().includes(t));
  render(f);
});

/* ====== Render ====== */
function render(list){
  const wrap = $('childList');
  wrap.innerHTML = '';

  if(!list.length){
    $('empty').style.display = 'block';
    return;
  }
  $('empty').style.display = 'none';

  list.forEach(c=>{
    const div = document.createElement('div');
    div.className = 'cardx child-card';

    const age = c.birthDate ? calcAge(c.birthDate) : '-';
    const unit = c.glucoseUnit || '-';
    const cr   = (c.carbRatio ?? '-') ;
    const cf   = (c.correctionFactor ?? '-') ;

    div.innerHTML = `
      <div>
        <div><strong>${escapeHtml(c.name || '-')}</strong>
          <span class="muted">• ${escapeHtml(c.gender || '-')} • العمر ${age}</span>
        </div>
        <div class="muted tiny">وحدة: ${escapeHtml(unit)} • CR ${escapeHtml(String(cr))} • CF ${escapeHtml(String(cf))}</div>
      </div>
      <div>
        <a class="secondary" href="doctor-child.html?parent=${encodeURIComponent(c.parentId)}&child=${encodeURIComponent(c.childId)}">عرض</a>
      </div>
    `;
    wrap.appendChild(div);
  });
}

/* ====== Utils ====== */
function calcAge(birthDateStr){
  const b = new Date(birthDateStr);
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

function escapeHtml(s){
  return (s ?? '').toString().replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
