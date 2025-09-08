// js/admin.js
import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, collectionGroup, query, where, orderBy,
  getDocs, getDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);

/* عناصر */
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

const assignStatus = $('assignStatus');

const modal = $('assignModal');
const btnCloseModal = $('btnCloseModal');
const btnCancelAssign = $('btnCancelAssign');
const btnAssign = $('btnAssign');
const childSelect = $('childSelect');
const doctorSelect = $('doctorSelect');
const modalStatus = $('modalStatus');

const doctorsCount = $('doctorsCount');
const childrenCount = $('childrenCount');
const opsToday = $('opsToday');

const loader = $('loader');
const toast = $('toast');

let CURRENT_ADMIN = null;
let ALL_DOCTORS = [];   // { uid, name, email }
let ALL_CHILDREN = [];  // { parentId, childId, name, parentName, consent, assignedDoctor }

/* أدوات UI */
function showLoader(v=true){ loader?.classList.toggle('hidden', !v); }
function showToast(msg='تم'){ if(!toast) return; toast.querySelector('.msg').textContent=msg; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.add('hidden'), 1500); }
function setStatus(el, msg, ok=false){ el.textContent = msg; el.className = 'status ' + (ok?'ok':'err'); }
function escapeHtml(s){ return (s ?? '').toString().replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* مصادقة + تحقق أن المستخدم أدمن */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  CURRENT_ADMIN = user;
  adminName.textContent = user.displayName || user.email || '—';

  // تحقق دور الأدمن
  const uSnap = await getDoc(doc(db, 'users', user.uid));
  const role = uSnap.exists() ? (uSnap.data()?.role) : null;
  if (role !== 'admin'){
    alert('هذه الصفحة للأدمن فقط.');
    location.href = 'index.html';
    return;
  }

  await loadLists();
  wireEvents();
});

/* أحداث */
function wireEvents(){
  btnSignOut?.addEventListener('click', ()=>signOut(auth));

  btnRefreshLists?.addEventListener('click', async ()=>{
    await loadLists();
    showToast('تم التحديث');
  });

  btnOpenAssign?.addEventListener('click', openAssignModal);
  btnCloseModal?.addEventListener('click', closeAssignModal);
  btnCancelAssign?.addEventListener('click', closeAssignModal);
  btnAssign?.addEventListener('click', assignNow);

  childSearch?.addEventListener('input', filterChildrenTable);
  doctorSearch?.addEventListener('input', filterDoctorsTable);
}

/* تحميل القوائم */
async function loadLists(){
  showLoader(true);
  assignStatus.textContent = '';

  await Promise.all([loadDoctors(), loadChildren()]);
  updateCounts();
  showLoader(false);
}

async function loadDoctors(){
  try{
    const qy = query(collection(db,'users'), where('role','==','doctor'));
    const snap = await getDocs(qy);
    ALL_DOCTORS = [];
    snap.forEach(s=>{
      const d = s.data();
      ALL_DOCTORS.push({
        uid: s.id,
        name: d.displayName || d.name || '—',
        email: d.email || '—'
      });
    });
    renderDoctorsTable(ALL_DOCTORS);
    doctorsHint.textContent = `${ALL_DOCTORS.length} دكتور/ة`;
  }catch(e){
    console.error(e);
    doctorsTbody.innerHTML = `<tr><td class="empty" colspan="3">تعذّر تحميل الأطباء.</td></tr>`;
    doctorsHint.textContent = '—';
  }
}

async function loadChildren(){
  try{
    // نقرأ الأطفال من collection group
    const qy = query(collectionGroup(db, 'children'));
    const snap = await getDocs(qy);
    ALL_CHILDREN = [];
    snap.forEach(s=>{
      const p = s.ref.path.split('/'); // parents/{pid}/children/{cid}
      const parentId = p[1], childId = p[3];
      const d = s.data();
      const consent = d?.sharingConsent === true
        || (d?.sharingConsent && typeof d.sharingConsent === 'object' && d.sharingConsent.doctor === true)
        || d?.shareDoctor === true;

      ALL_CHILDREN.push({
        parentId, childId,
        name: d?.name || '—',
        parentName: d?.parentName || parentId,
        assignedDoctor: d?.assignedDoctor || null,
        consent: !!consent
      });
    });
    renderChildrenTable(ALL_CHILDREN);
    childrenHint.textContent = `${ALL_CHILDREN.length} طفل`;
  }catch(e){
    console.error(e);
    childrenTbody.innerHTML = `<tr><td class="empty" colspan="4">تعذّر تحميل الأطفال.</td></tr>`;
    childrenHint.textContent = '—';
  }
}

function updateCounts(){
  doctorsCount.textContent = String(ALL_DOCTORS.length);
  childrenCount.textContent = String(ALL_CHILDREN.length);
  opsToday.textContent = new Date().toLocaleDateString('ar-EG');
}

/* فلترة جداول */
function filterChildrenTable(){
  const t = (childSearch.value || '').trim().toLowerCase();
  const list = ALL_CHILDREN.filter(c =>
    (c.name||'').toLowerCase().includes(t) ||
    (c.parentId||'').toLowerCase().includes(t) ||
    (c.parentName||'').toLowerCase().includes(t)
  );
  renderChildrenTable(list);
}
function filterDoctorsTable(){
  const t = (doctorSearch.value || '').trim().toLowerCase();
  const list = ALL_DOCTORS.filter(d =>
    (d.name||'').toLowerCase().includes(t) ||
    (d.email||'').toLowerCase().includes(t) ||
    (d.uid||'').toLowerCase().includes(t)
  );
  renderDoctorsTable(list);
}

/* Render الجداول */
function renderChildrenTable(list){
  childrenTbody.innerHTML = '';
  if (!list.length){
    childrenTbody.innerHTML = `<tr><td class="empty" colspan="4">لا يوجد بيانات.</td></tr>`;
    return;
  }
  for (const c of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.parentName || c.parentId)}</td>
      <td>
        ${c.consent ? '<span class="badge ok">مُصرّح</span>' : '<span class="badge err">غير مُصرّح</span>'}
        ${c.assignedDoctor ? ` <span class="badge">معين</span>` : ''}
      </td>
      <td><input type="radio" name="childPick" value="${escapeHtml(`${c.parentId}|${c.childId}|${c.name}`)}"></td>
    `;
    childrenTbody.appendChild(tr);
  }
}

function renderDoctorsTable(list){
  doctorsTbody.innerHTML = '';
  if (!list.length){
    doctorsTbody.innerHTML = `<tr><td class="empty" colspan="3">لا يوجد بيانات.</td></tr>`;
    return;
  }
  for (const d of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.email)}</td>
      <td><input type="radio" name="doctorPick" value="${escapeHtml(`${d.uid}|${d.name}|${d.email}`)}"></td>
    `;
    doctorsTbody.appendChild(tr);
  }
}

/* فتح/إغلاق المودال + تعبئة الخيارات */
function openAssignModal(){
  const childSel = document.querySelector('input[name="childPick"]:checked');
  const docSel   = document.querySelector('input[name="doctorPick"]:checked');

  if (!childSel || !docSel){
    setStatus(assignStatus, 'اختر طفلًا وطبيبًا أولًا.', false);
    return;
  }

  // عبّي select داخل المودال
  childSelect.innerHTML = '';
  doctorSelect.innerHTML = '';

  const [parentId, childId, childName] = childSel.value.split('|');
  const [doctorUid, doctorName, doctorEmail] = docSel.value.split('|');

  const childOpt = document.createElement('option');
  childOpt.value = `${parentId}|${childId}|${childName}`;
  childOpt.textContent = `${childName} — ${parentId}`;
  childSelect.appendChild(childOpt);

  const docOpt = document.createElement('option');
  docOpt.value = `${doctorUid}|${doctorName}|${doctorEmail}`;
  docOpt.textContent = `${doctorName} — ${doctorEmail}`;
  doctorSelect.appendChild(docOpt);

  modalStatus.textContent = '';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
}
function closeAssignModal(){
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  modalStatus.textContent = '';
}

/* تنفيذ الإسناد */
async function assignNow(){
  const childVal = childSelect.value;
  const docVal   = doctorSelect.value;
  if (!childVal || !docVal){
    setStatus(modalStatus, 'لم يتم اختيار طفل/طبيب.', false);
    return;
  }

  const [parentId, childId] = childVal.split('|');
  const [doctorUid, doctorName, doctorEmail] = docVal.split('|');

  try{
    showLoader(true);
    const ref = doc(db, `parents/${parentId}/children/${childId}`);

    await updateDoc(ref, {
      assignedDoctor: doctorUid,
      assignedDoctorInfo: {
        uid: doctorUid, name: doctorName || null, email: doctorEmail || null
      },
      // ✅ نثبت الموافقة بالشكلين لضمان توافق كل الواجهات
      sharingConsent: { doctor: true },
      shareDoctor: true,
      updatedAt: serverTimestamp()
    });

    setStatus(modalStatus, 'تم الإسناد بنجاح ✅', true);
    showToast('تم الإسناد');
    await loadChildren(); // تحديث القائمة لتظهر شارة "معين"
  }catch(e){
    console.error(e);
    setStatus(modalStatus, 'تعذّر الإسناد. تحقّق من الصلاحيات/الاتصال.', false);
  }finally{
    showLoader(false);
  }
}

/* انتهاء */
