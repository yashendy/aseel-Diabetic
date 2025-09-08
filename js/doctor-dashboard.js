// js/doctor-dashboard.js

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collectionGroup, collection, query, where, orderBy,
  getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);

// عناصر الواجهة (طبقًا للـ HTML لديك)
const elDoctorName   = $('doctorName');       // اسم الطبيب أعلى الصفحة (اختياري)
const elChildrenBody = $('childrenTbody');    // <tbody> لجدول الأطفال
const elChildSearch  = $('childSearch');      // input للبحث
const elChildrenCnt  = $('childrenCount');    // شارة العدّاد
const elCodesList    = $('codesList');        // قائمة أكواد الربط
const btnCreateCode  = $('btnCreateCode');
const btnReloadCodes = $('btnReloadCodes');
const btnRefresh     = $('btnRefresh');

let CURRENT_USER = null;
let ALL_CHILDREN = [];

/* ====== Boot ====== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  CURRENT_USER = user;

  // Debug مهم لتأكيد الـ UID
  console.log('[Doctor Dashboard] UID =', user.uid);
  if (elDoctorName) {
    elDoctorName.textContent = user.displayName || user.email || '—';
    elDoctorName.title = `UID: ${user.uid}`;
  }

  await Promise.all([
    loadChildren(),
    loadCodes()
  ]);

  // أحداث
  elChildSearch?.addEventListener('input', onSearch);
  btnCreateCode?.addEventListener('click', createLinkCode);
  btnReloadCodes?.addEventListener('click', loadCodes);
  btnRefresh?.addEventListener('click', async ()=>{
    await Promise.all([loadChildren(), loadCodes()]);
  });
});

/* ====== تحميل الأطفال المرتبطين ====== */
async function loadChildren(){
  if(!CURRENT_USER) return;

  // دالة صغيرة لعرض رسالة داخل الجدول
  const showMsg = (text)=> {
    elChildrenBody.innerHTML = `<tr><td class="empty" colspan="6">${text}</td></tr>`;
    elChildrenCnt.textContent = '0';
  };

  try {
    // الاستعلام الأساسي: دكتور + موافقة مشاركة
    let qy = query(
      collectionGroup(db, 'children'),
      where('assignedDoctor', '==', CURRENT_USER.uid),
      where('sharingConsent.doctor', '==', true)
    );

    let snap;
    try {
      snap = await getDocs(qy);
    } catch (e) {
      // لو محتاج فهرس كومبوزيت أو أي فشل، نعمل fallback على شرط واحد
      console.warn('[Doctor Dashboard] fallback to single where due to:', e?.code || e);
      qy = query(
        collectionGroup(db, 'children'),
        where('assignedDoctor', '==', CURRENT_USER.uid)
      );
      snap = await getDocs(qy);
    }

    ALL_CHILDREN = [];

    snap.forEach(docSnap=>{
      // /parents/{parentId}/children/{childId}
      const path = docSnap.ref.path.split('/'); // ["parents", pid, "children", cid]
      const parentId = path[1];
      const childId  = path[3];
      const d = docSnap.data();

      // فلترة نهائية بالأمان (القواعد بتتحقق برضه)
      const consent = d?.sharingConsent === true
        || (d?.sharingConsent && typeof d.sharingConsent === 'object' && d.sharingConsent.doctor === true);

      if (consent && d?.assignedDoctor === CURRENT_USER.uid) {
        ALL_CHILDREN.push({ parentId, childId, ...d });
      }
    });

    renderChildren(ALL_CHILDREN);
  } catch (e) {
    console.error('[Doctor Dashboard] loadChildren error:', e);
    showMsg('تعذّر تحميل الأطفال: تحقّق من الصلاحيات أو الاتصال.');
  }
}

/* ====== فلترة بالاسم ====== */
function onSearch(){
  const t = (elChildSearch?.value || '').trim().toLowerCase();
  const f = ALL_CHILDREN.filter(c => (c.name || '').toLowerCase().includes(t));
  renderChildren(f);
}

/* ====== Render: أطفال في جدول ====== */
function renderChildren(list){
  elChildrenBody.innerHTML = '';

  if(!list.length){
    elChildrenBody.innerHTML = `<tr><td class="empty" colspan="6">لا يوجد أطفال مرتبطون حتى الآن.</td></tr>`;
    elChildrenCnt.textContent = '0';
    return;
  }

  list.forEach(c=>{
    const tr = document.createElement('tr');
    const age = c.birthDate ? calcAge(c.birthDate) : '-';
    const unit = c.glucoseUnit || c.unit || '-';

    tr.innerHTML = `
      <td>${escapeHtml(c.name || '-')}</td>
      <td>${escapeHtml(c.gender || '-')}</td>
      <td>${escapeHtml(c.birthDate || '-')}</td>
      <td>${escapeHtml(String(age))}</td>
      <td>${escapeHtml(unit)}</td>
      <td>
        <a class="btn small secondary" href="doctor-child.html?parent=${encodeURIComponent(c.parentId)}&child=${encodeURIComponent(c.childId)}">عرض</a>
      </td>
    `;
    elChildrenBody.appendChild(tr);
  });

  elChildrenCnt.textContent = String(list.length);
}

/* ====== أكواد الربط (الدكتور) ====== */
// توليد كود بسيط 6 خانات (حروف كبيرة + أرقام)
function genCode(len=6){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

async function createLinkCode(){
  if(!CURRENT_USER) return;

  try{
    const code = genCode(6);

    // تأكد من عدم التصادم مرة واحدة فقط
    const codeRef = doc(db, 'linkCodes', code);
    const existsSnap = await getDoc(codeRef);
    const finalCode = existsSnap.exists() ? genCode(6) : code;
    const finalRef  = existsSnap.exists() ? doc(db,'linkCodes',finalCode) : codeRef;

    await setDoc(finalRef, {
      doctorId: CURRENT_USER.uid,
      createdAt: serverTimestamp(),
      used: false,
      parentId: null,
      childId: null
    });

    await loadCodes();
  }catch(e){
    console.error(e);
    renderCodesError('تعذّر إنشاء الكود.');
  }
}

async function deleteLinkCode(code){
  if(!CURRENT_USER) return;
  if(!confirm('حذف هذا الكود؟')) return;

  try{
    const ref = doc(db,'linkCodes', code);
    const s = await getDoc(ref);
    if(!s.exists()){ return; }
    const d = s.data();
    if (d.used !== true && d.doctorId === CURRENT_USER.uid){
      await deleteDoc(ref);
      await loadCodes();
    }
  }catch(e){
    console.error(e);
    renderCodesError('تعذّر حذف الكود.');
  }
}

async function loadCodes(){
  if(!CURRENT_USER) return;

  try{
    elCodesList.innerHTML = `<div class="empty">جارٍ التحميل…</div>`;

    const qy = query(
      collection(db,'linkCodes'),
      where('doctorId','==', CURRENT_USER.uid),
      orderBy('createdAt','desc')
    );
    const snap = await getDocs(qy);

    const rows = [];
    snap.forEach(s=>{
      const d = s.data();
      const code = s.id;
      const meta = d.used
        ? `مستخدم ✓ — parent: ${d.parentId||'-'} — child: ${d.childId||'-'}`
        : `غير مستخدم`;
      const actions = d.used
        ? `<button class="btn small secondary" onclick="(()=>navigator.clipboard.writeText('${code}'))()">نسخ</button>`
        : `<button class="btn small secondary" onclick="(()=>navigator.clipboard.writeText('${code}'))()">نسخ</button>
           <button class="btn small danger" onclick="window.__delCode && window.__delCode('${code}')">حذف</button>`;

      rows.push(`
        <div class="row">
          <div class="meta">
            <div><strong class="mono">${escapeHtml(code)}</strong></div>
            <div class="muted">${meta}</div>
          </div>
          <div class="actions">${actions}</div>
        </div>
      `);
    });

    elCodesList.innerHTML = rows.length ? rows.join('') : `<div class="empty">لا توجد أكواد بعد.</div>`;
  }catch(e){
    console.error(e);
    renderCodesError('تعذّر تحميل الأكواد.');
  }
}

function renderCodesError(msg){
  elCodesList.innerHTML = `<div class="empty">${msg}</div>`;
}
window.__delCode = deleteLinkCode;

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
