import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, collectionGroup, query, where, getDocs, getDoc, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let CURRENT_ADMIN = null;
let ALL_DOCTORS_APPROVED = [];   
let ALL_DOCTORS_PENDING = [];
let ALL_CHILDREN = [];  

// --- نظام اللايت/دارك مود ---
const themeBtn = $('themeToggle');
const currentTheme = localStorage.getItem('adminTheme') || 'dark';
if(currentTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
if(themeBtn) themeBtn.textContent = currentTheme === 'light' ? '🌙' : '🌞';

if(themeBtn) {
  themeBtn.onclick = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if(isLight) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('adminTheme', 'dark');
      themeBtn.textContent = '🌞';
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('adminTheme', 'light');
      themeBtn.textContent = '🌙';
    }
  };
}

// دالة منع أكواد الاختراق (Security)
function escapeHtml(s){ return (s ?? '').toString().replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* 1. التحقق من صلاحيات الأدمن */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  
  $('loader').classList.remove('hidden');
  
  try {
    const uSnap = await getDoc(doc(db, 'users', user.uid));
    const role = uSnap.exists() ? (uSnap.data()?.role) : null;
    
    if (role !== 'admin'){
      alert('🚫 تم الرفض: هذه الصفحة مخصصة للإدارة العليا فقط.');
      location.href = 'index.html';
      return;
    }

    CURRENT_ADMIN = user;
    if($('adminName')) $('adminName').textContent = user.displayName || user.email || 'Admin';
    
    await loadLists();
    wireEvents();
  } catch (err) {
    console.error("Authentication Error:", err);
  } finally {
    $('loader').classList.add('hidden');
  }
});

/* 2. ربط الأحداث */
function wireEvents(){
  if($('btnSignOut')) $('btnSignOut').onclick = () => signOut(auth);
  if($('btnRefreshLists')) $('btnRefreshLists').onclick = loadLists;
  if($('btnOpenAssign')) $('btnOpenAssign').onclick = openAssignModal;
  if($('btnCloseModal')) $('btnCloseModal').onclick = closeAssignModal;
  if($('btnCancelAssign')) $('btnCancelAssign').onclick = closeAssignModal;
  if($('btnAssign')) $('btnAssign').onclick = assignNow;
  if($('childSearch')) $('childSearch').oninput = filterChildrenTable;
  if($('doctorSearch')) $('doctorSearch').oninput = filterDoctorsTable;
}

/* 3. تحميل قواعد البيانات */
async function loadLists(){
  $('loader').classList.remove('hidden');
  await Promise.all([loadDoctors(), loadChildren()]);
  if($('doctorsApproved')) $('doctorsApproved').textContent = ALL_DOCTORS_APPROVED.length;
  if($('doctorsPending')) $('doctorsPending').textContent = ALL_DOCTORS_PENDING.length;
  if($('childrenCount')) $('childrenCount').textContent = ALL_CHILDREN.length;
  $('loader').classList.add('hidden');
}

/* جلب الأطباء مع إضافة المركز */
async function loadDoctors(){
  ALL_DOCTORS_APPROVED = []; ALL_DOCTORS_PENDING = [];
  try {
    const qy = query(collection(db,'users'), where('role','==','doctor'));
    const snap = await getDocs(qy);
    snap.forEach(s => {
      const d = s.data();
      const docData = { 
        uid: s.id, 
        name: d.displayName || d.name, 
        email: d.email, 
        center: d.center || d.clinic || d.email, 
        isApproved: d.isApproved 
      };
      
      if(d.isApproved === true) ALL_DOCTORS_APPROVED.push(docData);
      else ALL_DOCTORS_PENDING.push(docData);
    });
    renderPendingDoctors();
    renderApprovedDoctors(ALL_DOCTORS_APPROVED);
  } catch(e) {
    console.error("Error loading doctors:", e);
  }
}

/* جلب الأطفال */
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
    if($('childrenHint')) $('childrenHint').textContent = ALL_CHILDREN.length;
  }catch(e){
    console.error("Error loading children:", e);
    if($('childrenTbody')) $('childrenTbody').innerHTML = `<tr><td colspan="3" style="text-align:center;">تعذّر تحميل الأطفال.</td></tr>`;
  }
}

/* 4. البحث داخل الجداول */
function filterChildrenTable(){
  const t = ($('childSearch').value || '').trim().toLowerCase();
  renderChildrenTable(ALL_CHILDREN.filter(c => (c.name||'').toLowerCase().includes(t) || (c.parentName||'').toLowerCase().includes(t)));
}

function filterDoctorsTable(){
  const t = ($('doctorSearch').value || '').trim().toLowerCase();
  renderApprovedDoctors(ALL_DOCTORS_APPROVED.filter(d => (d.name||'').toLowerCase().includes(t) || (d.email||'').toLowerCase().includes(t)));
}

/* 5. رسم الجداول (بالتنسيق الجديد) */
function renderPendingDoctors(){
  const tbody = $('pendingDoctorsTbody'); 
  if(!tbody) return;
  tbody.innerHTML = '';
  if(!ALL_DOCTORS_PENDING.length){ tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted);">لا يوجد أطباء بانتظار الاعتماد.</td></tr>`; return; }
  
  ALL_DOCTORS_PENDING.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold;">${escapeHtml(d.name || '—')}</div>
      </td>
      <td>${escapeHtml(d.email)}</td>
      <td><span class="badge warn">جديد</span></td>
      <td style="text-align:center;">
        <button class="btn primary" style="height:30px; font-size:12px;" onclick="approveDoctor('${d.uid}')">✅ اعتماد</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderApprovedDoctors(list){
  const tbody = $('doctorsTbody'); 
  if(!tbody) return;
  tbody.innerHTML = '';
  if (!list.length){ tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--muted);">لا يوجد أطباء معتمدين.</td></tr>`; return; }
  
  for (const d of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold; font-size:15px;">${escapeHtml(d.name)}</div>
        <div style="font-size:12px; color:var(--muted); margin-top:4px;">🏥 ${escapeHtml(d.center)}</div>
      </td>
      <td style="text-align:center; vertical-align:middle;">
        <input type="radio" name="doctorPick" value="${escapeHtml(`${d.uid}|${d.name}|${d.email}`)}" style="transform: scale(1.5); cursor:pointer;">
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function renderChildrenTable(list){
  const tbody = $('childrenTbody'); 
  if(!tbody) return;
  tbody.innerHTML = '';
  if (!list.length){ tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--muted);">لا توجد بيانات.</td></tr>`; return; }
  
  for (const c of list){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold; font-size:15px;">${escapeHtml(c.name)}</div>
        <div style="font-size:12px; color:var(--muted); margin-top:4px;">ولي الأمر: ${escapeHtml(c.parentName || 'غير مسجل')}</div>
      </td>
      <td>
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
          ${c.consent ? '<span class="badge">✅ مُصرّح</span>' : '<span class="badge err">❌ غير مُصرّح</span>'}
          ${c.assignedDoctor ? `<span class="badge" style="background:var(--primary);color:#fff;border-color:var(--primary);">🔗 تم الربط</span>` : ''}
        </div>
      </td>
      <td style="text-align:center; vertical-align:middle;">
        <input type="radio" name="childPick" value="${escapeHtml(`${c.parentId}|${c.childId}|${c.name}`)}" style="transform: scale(1.5); cursor:pointer;">
      </td>
    `;
    tbody.appendChild(tr);
  }
}

/* 6. منطق الاعتماد والإسناد */
window.approveDoctor = async function(uid) {
  if(!confirm('هل أنت متأكد من اعتماد هذا الطبيب؟')) return;
  $('loader').classList.remove('hidden');
  try {
    await updateDoc(doc(db, 'users', uid), { isApproved: true });
    alert('تم الاعتماد بنجاح!');
    await loadLists();
  } catch(e) { alert('حدث خطأ'); console.error(e); }
  $('loader').classList.add('hidden');
}

function openAssignModal(){
  const childSel = document.querySelector('input[name="childPick"]:checked');
  const docSel   = document.querySelector('input[name="doctorPick"]:checked');

  if (!childSel || !docSel){ alert('⚠️ الرجاء تحديد طفل وطبيب من الجداول أولاً.'); return; }

  $('childSelect').innerHTML = ''; $('doctorSelect').innerHTML = '';

  const [parentId, childId, childName] = childSel.value.split('|');
  const [doctorUid, doctorName, doctorEmail] = docSel.value.split('|');

  $('childSelect').innerHTML = `<option value="${parentId}|${childId}">${childName}</option>`;
  $('doctorSelect').innerHTML = `<option value="${doctorUid}|${doctorName}|${doctorEmail}">${doctorName} (${doctorEmail})</option>`;

  $('modalStatus').textContent = '';
  $('assignModal').classList.remove('hidden');
}

function closeAssignModal(){ $('assignModal').classList.add('hidden'); }

async function assignNow(){
  const [parentId, childId] = $('childSelect').value.split('|');
  const [doctorUid, doctorName, doctorEmail] = $('doctorSelect').value.split('|');

  try{
    $('btnAssign').disabled = true; $('btnAssign').textContent = "جاري الاعتماد...";
    const ref = doc(db, `parents/${parentId}/children/${childId}`);

    await updateDoc(ref, {
      assignedDoctor: doctorUid,
      assignedDoctorInfo: { uid: doctorUid, name: doctorName || null, email: doctorEmail || null },
      sharingConsent: { doctor: true }, shareDoctor: true,
      updatedAt: serverTimestamp()
    });

    $('modalStatus').style.color = "var(--success)";
    $('modalStatus').textContent = '✅ تم ربط الطبيب بالمريض بنجاح!';
    setTimeout(() => { closeAssignModal(); loadLists(); }, 1500);
  }catch(e){
    console.error(e);
    $('modalStatus').style.color = "var(--danger)";
    $('modalStatus').textContent = '❌ تعذّر الإسناد. تحقّق من الصلاحيات والاتصال.';
  }finally {
    $('btnAssign').disabled = false; $('btnAssign').textContent = "✅ اعتماد الإسناد الآن";
  }
}
