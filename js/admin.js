// js/admin.js
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
themeBtn.textContent = currentTheme === 'light' ? '🌙' : '🌞';

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

/* التحقق من الأدمن */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href = 'index.html'; return; }
  $('loader').classList.remove('hidden');
  
  const uSnap = await getDoc(doc(db, 'users', user.uid));
  if (uSnap.exists() && uSnap.data()?.role === 'admin'){
    CURRENT_ADMIN = user;
    $('adminName').textContent = user.displayName || user.email;
    await loadLists();
    wireEvents();
  } else {
    alert('🚫 الصفحة مخصصة للإدارة العليا فقط.');
    location.href = 'index.html';
  }
  $('loader').classList.add('hidden');
});

function wireEvents(){
  $('btnSignOut').onclick = () => signOut(auth);
  $('btnRefreshLists').onclick = loadLists;
  $('childSearch').oninput = filterTables;
  $('doctorSearch').oninput = filterTables;
}

async function loadLists(){
  $('loader').classList.remove('hidden');
  await Promise.all([loadDoctors(), loadChildren()]);
  $('doctorsApproved').textContent = ALL_DOCTORS_APPROVED.length;
  $('doctorsPending').textContent = ALL_DOCTORS_PENDING.length;
  $('childrenCount').textContent = ALL_CHILDREN.length;
  $('loader').classList.add('hidden');
}

async function loadDoctors(){
  ALL_DOCTORS_APPROVED = []; ALL_DOCTORS_PENDING = [];
  const qy = query(collection(db,'users'), where('role','==','doctor'));
  const snap = await getDocs(qy);
  snap.forEach(s => {
    const d = s.data();
    const docData = { uid: s.id, name: d.displayName || d.name, email: d.email, isApproved: d.isApproved };
    // لو لم يتم إضافة حقل isApproved بعد للطبيب، نعتبره معلق
    if(d.isApproved === true) ALL_DOCTORS_APPROVED.push(docData);
    else ALL_DOCTORS_PENDING.push(docData);
  });
  renderPendingDoctors();
  renderApprovedDoctors(ALL_DOCTORS_APPROVED);
}

function renderPendingDoctors(){
  const tbody = $('pendingDoctorsTbody'); tbody.innerHTML = '';
  if(!ALL_DOCTORS_PENDING.length){ tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted);">لا يوجد أطباء بانتظار الاعتماد.</td></tr>`; return; }
  
  ALL_DOCTORS_PENDING.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.name || '—'}</td><td>${d.email}</td><td>جديد</td>
      <td style="text-align:center;">
        <button class="btn primary" style="height:30px; font-size:12px;" onclick="approveDoctor('${d.uid}')">✅ اعتماد</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// دالة الاعتماد الحقيقية اللي بتعدل في الداتا بيز
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

// ... باقي دوال الأطفال والبحث القديمة اللي في الكود اللي فات ...
