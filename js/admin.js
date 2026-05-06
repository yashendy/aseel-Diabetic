// js/admin-dashboard.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, collectionGroup, query, where,
  getDocs, getDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

/* عناصر واجهة */
const adminName = $('adminName');
const btnSignOut = $('btnSignOut');
const btnRefreshLists = $('btnRefreshLists');
const btnOpenAssign = $('btnOpenAssign');

const childrenTbody = $('childrenTbody');
const doctorsTbody  = $('doctorsTbody');
const childSearch = $('childSearch');
const doctorSearch = $('doctorSearch');
const childrenHint = $('childrenHint');
const doctorsHint  = $('doctorsHint');

const modal = $('assignModal');
const btnCloseModal = $('btnCloseModal');
const btnCancelAssign = $('btnCancelAssign');
const btnAssign = $('btnAssign');
const childSelect = $('childSelect');
const doctorSelect = $('doctorSelect');
const modalStatus = $('modalStatus');

const doctorsCount = $('doctorsCount');
const childrenCount = $('childrenCount');
const loader = $('loader');

let CURRENT_ADMIN = null;
let ALL_DOCTORS = [];   
let ALL_CHILDREN = [];  

function showLoader(v=true){ loader?.classList.toggle('hidden', !v); }
function escapeHtml(s){ return (s ?? '').toString().replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* 1. التحقق من صلاحيات الأدمن (من كودك) */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  
  showLoader(true);
  const uSnap = await getDoc(doc(db, 'users', user.uid));
  const role = uSnap.exists() ? (uSnap.data()?.role) : null;
  
  if (role !== 'admin'){
    alert('🚫 تم الرفض: هذه الصفحة مخصصة للإدارة العليا فقط.');
    location.href = 'index.html';
    return;
  }

  CURRENT_ADMIN = user;
  adminName.textContent = user.displayName || user.email || 'Admin';
  
  await loadLists();
  wireEvents();
  showLoader(false);
});

/* 2. ربط الأحداث */
function wireEvents(){
  btnSignOut?.addEventListener('click', ()=>signOut(auth));
  btnRefreshLists?.addEventListener('click', loadLists);
  btnOpenAssign?.addEventListener('click', openAssignModal);
  btnCloseModal?.addEventListener('click', closeAssignModal);
  btnCancelAssign?.addEventListener('click', closeAssignModal);
  btnAssign?.addEventListener('click', assignNow);
  childSearch?.addEventListener('input', filterChildrenTable);
  doctorSearch?.addEventListener('input', filterDoctorsTable);
}

/* 3. تحميل قواعد البيانات (من كودك العميق) */
async function loadLists(){
  showLoader(true);
  await Promise.all([loadDoctors(), loadChildren()]);
  doctorsCount.textContent = String(ALL_DOCTORS.length);
  childrenCount.textContent = String(ALL_CHILDREN.length);
  showLoader(false);
}

async function loadDoctors(){
  try{
    const qy = query(collection(db,'users'), where('role','==','doctor'));
    const snap = await getDocs(qy);
    ALL_DOCTORS = [];
    snap.forEach(s=>{
      const d = s.data();
      ALL_DOCTORS.push({ uid: s.id, name: d.displayName || d.name || '—', email: d.email || '—' });
    });
    renderDoctorsTable(ALL_DOCTORS);
    doctorsHint.textContent = ALL_DOCTORS.length;
  }catch(e){
    console.error(e);
    doctorsTbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">تعذّر تحميل الأطباء.</td></tr>`;
  }
}

async function loadChildren(){
  try{
    const qy = query(collectionGroup(db, 'children'));
    const snap = await getDocs(qy);
    ALL_CHILDREN = [];
    snap.forEach(s=>{
      const parts = s.ref.path.split('/');
      const parentId = parts[1], childId = parts[3];
      const d = s.data();
      const consent = d?.sharingConsent === true || (d?.sharingConsent && typeof d.sharingConsent === 'object' && d.sharingConsent.doctor === true) || d?.shareDoctor === true;

      ALL_CHILDREN.push({ parentId, childId, name: d?.name || '—', parentName: d?.parentName || parentId, assignedDoctor: d?.assignedDoctor || null, consent: !!consent });
    });
    renderChildrenTable(ALL_CHILDREN);
    childrenHint.textContent = ALL_CHILDREN.length;
  }catch(e){
    console.error(e);
    childrenTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">تعذّر تحميل الأطفال.</td></tr>`;
  }
}

/* 4. البحث داخل الجداول */
function filterChildrenTable(){
  const t = (childSearch.value || '').trim().toLowerCase();
  renderChildrenTable(ALL_CHILDREN.filter(c => (c.name||'').toLowerCase().includes(t) || (c.parentName||'').toLowerCase().includes(t)));
}
function filterDoctorsTable(){
  const t = (doctorSearch.value || '').trim().toLowerCase();
  renderDoctorsTable(ALL_DOCTORS.filter(d => (d.name||'').toLowerCase().includes(t) || (d.email||'').toLowerCase().includes(t)));
}

/* 5. رسم الجداول */
function renderChildrenTable(list){
  childrenTbody.innerHTML = '';
  if (!list.length){ childrenTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">لا يوجد بيانات.</td></tr>`; return; }
  for (const c of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.parentName || c.parentId)}</td>
      <td>
        ${c.consent ? '<span class="badge">✅ مُصرّح</span>' : '<span class="badge err">❌ غير مُصرّح</span>'}
        ${c.assignedDoctor ? ` <span class="badge" style="background:#3b82f6;color:#fff;">تم الربط</span>` : ''}
      </td>
      <td style="text-align:center;"><input type="radio" name="childPick" value="${escapeHtml(`${c.parentId}|${c.childId}|${c.name}`)}" style="transform: scale(1.5);"></td>
    `;
    childrenTbody.appendChild(tr);
  }
}

function renderDoctorsTable(list){
  doctorsTbody.innerHTML = '';
  if (!list.length){ doctorsTbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">لا يوجد بيانات.</td></tr>`; return; }
  for (const d of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.email)}</td>
      <td style="text-align:center;"><input type="radio" name="doctorPick" value="${escapeHtml(`${d.uid}|${d.name}|${d.email}`)}" style="transform: scale(1.5);"></td>
    `;
    doctorsTbody.appendChild(tr);
  }
}

/* 6. منطق الإسناد (Assignment) */
function openAssignModal(){
  const childSel = document.querySelector('input[name="childPick"]:checked');
  const docSel   = document.querySelector('input[name="doctorPick"]:checked');

  if (!childSel || !docSel){ alert('⚠️ الرجاء تحديد طفل وطبيب من الجداول أولاً.'); return; }

  childSelect.innerHTML = ''; doctorSelect.innerHTML = '';

  const [parentId, childId, childName] = childSel.value.split('|');
  const [doctorUid, doctorName, doctorEmail] = docSel.value.split('|');

  childSelect.innerHTML = `<option value="${parentId}|${childId}">${childName}</option>`;
  doctorSelect.innerHTML = `<option value="${doctorUid}|${doctorName}|${doctorEmail}">${doctorName} (${doctorEmail})</option>`;

  modalStatus.textContent = '';
  modal.classList.remove('hidden');
}

function closeAssignModal(){ modal.classList.add('hidden'); }

async function assignNow(){
  const [parentId, childId] = childSelect.value.split('|');
  const [doctorUid, doctorName, doctorEmail] = doctorSelect.value.split('|');

  try{
    btnAssign.disabled = true; btnAssign.textContent = "جاري الاعتماد...";
    const ref = doc(db, `parents/${parentId}/children/${childId}`);

    await updateDoc(ref, {
      assignedDoctor: doctorUid,
      assignedDoctorInfo: { uid: doctorUid, name: doctorName || null, email: doctorEmail || null },
      sharingConsent: { doctor: true }, shareDoctor: true,
      updatedAt: serverTimestamp()
    });

    modalStatus.style.color = "#10b981";
    modalStatus.textContent = '✅ تم ربط الطبيب بالمريض بنجاح!';
    setTimeout(() => { closeAssignModal(); loadLists(); }, 1500);
  }catch(e){
    console.error(e);
    modalStatus.style.color = "#ef4444";
    modalStatus.textContent = '❌ تعذّر الإسناد. تحقّق من الصلاحيات والاتصال.';
  }finally {
    btnAssign.disabled = false; btnAssign.textContent = "✅ اعتماد الإسناد الآن";
  }
}
