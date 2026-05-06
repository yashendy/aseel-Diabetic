// js/doctor-dashboard.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, collectionGroup, getDocs, doc, getDoc, setDoc, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let patients = [];

function showLoader(show) { $('loader').classList.toggle('hidden', !show); }

// --- 1. التحقق من الدخول وصلاحيات الطبيب ---
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }
  currentUser = user;
  
  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists() || userSnap.data().role !== 'doctor') {
    alert("حسابك لا يمتلك صلاحيات الطبيب.");
    location.href = "index.html"; return;
  }
  
  const userData = userSnap.data();
  $('doctorName').textContent = `د. ${userData.name || userData.displayName || 'طبيب'}`;
  
  await loadCodes();
  await loadPatients();
  setupEvents();
});

// --- 2. إدارة أكواد الربط (مبني على أسطر الكود الخاصة بك) ---
async function loadCodes() {
  const list = $('codesList');
  list.innerHTML = '<div class="empty">جاري التحميل...</div>';
  try {
    const q = query(collection(db, "linkCodes"), where("doctorId", "==", currentUser.uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    
    if (snap.empty) { list.innerHTML = '<div class="empty">لا توجد أكواد نشطة.</div>'; return; }
    
    let html = '';
    snap.forEach(d => {
      const c = d.data();
      html += `
        <div class="code-row">
          <div class="code-val">${d.id}</div>
          <div class="code-meta">
            ${c.used ? `<span style="color:var(--danger)">مستخدم ❌</span>` : `<span style="color:var(--good)">متاح ✅</span>`}
            <br>${c.createdAt?.toDate().toLocaleDateString('ar-EG') || ''}
          </div>
        </div>
      `;
    });
    list.innerHTML = html;
  } catch(e) { console.error(e); list.innerHTML = '<div class="empty">حدث خطأ في تحميل الأكواد.</div>'; }
}

$('btnCreateCode').onclick = async () => {
  showLoader(true);
  try {
    const newCode = 'DOC-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    await setDoc(doc(db, "linkCodes", newCode), {
      doctorId: currentUser.uid,
      used: false,
      createdAt: serverTimestamp()
    });
    await loadCodes();
  } catch(e) { alert("حدث خطأ أثناء إنشاء الكود"); }
  showLoader(false);
};

// --- 3. قائمة المرضى والأطفال ---
async function loadPatients() {
  showLoader(true);
  const tbody = $('childrenTbody');
  try {
    const q = query(collectionGroup(db, "children"), where("assignedDoctor", "==", currentUser.uid));
    const snap = await getDocs(q);
    
    patients = [];
    let criticalCount = 0;

    for (let d of snap.docs) {
      const p = { id: d.id, parentId: d.ref.parent.parent.id, ...d.data() };
      const mSnap = await getDocs(query(collection(db, `parents/${p.parentId}/children/${p.id}/measurements`), orderBy('when', 'desc'), limit(1)));
      if (!mSnap.empty) { p.lastMeasurement = mSnap.docs[0].data(); }
      patients.push(p);
    }

    $('childrenCount').textContent = `${patients.length} مرضى`;
    $('totalPatients').textContent = patients.length;
    renderPatients(patients);

  } catch(e) { 
    console.error(e); 
    tbody.innerHTML = `<tr><td colspan="6" class="empty">حدث خطأ. الرجاء التأكد من الاتصال.</td></tr>`;
  }
  showLoader(false);
}

function getPatientStatus(m, child) {
  if(!m) return { html: '<span class="status-badge bg-muted">لا توجد قراءات</span>', crit: false };
  
  const unit = child.glucoseUnit || 'mg/dL';
  const val = m.normalizedValue || m.value;
  let cLow = unit === 'mmol/L' ? 3.0 : 54;
  let low = unit === 'mmol/L' ? 3.9 : 70;
  let high = unit === 'mmol/L' ? 10.0 : 180;
  let cHigh = unit === 'mmol/L' ? 13.9 : 250;

  if(child.glucose_limits) {
    cLow = Number(child.glucose_limits.critical_low) || cLow;
    low = Number(child.glucose_limits.low) || low;
    high = Number(child.glucose_limits.high) || high;
    cHigh = Number(child.glucose_limits.critical_high) || cHigh;
  }

  if(val <= cLow) return { html: `<span class="status-badge bg-danger">هبوط حرج</span>`, crit: true };
  if(val < low) return { html: `<span class="status-badge bg-danger">هبوط</span>`, crit: false };
  if(val >= cHigh) return { html: `<span class="status-badge bg-danger">ارتفاع حرج</span>`, crit: true };
  if(val > high) return { html: `<span class="status-badge bg-warn">ارتفاع</span>`, crit: false };
  return { html: `<span class="status-badge bg-ok">طبيعي</span>`, crit: false };
}

function renderPatients(list) {
  const tbody = $('childrenTbody');
  tbody.innerHTML = '';
  if(!list.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty" style="text-align:center; padding:20px;">لا يوجد مرضى متابعين حالياً. أرسل كود الربط للمرضى.</td></tr>`; $('criticalPatients').textContent = '0'; return; }

  let critTotal = 0;
  list.forEach(p => {
    const status = getPatientStatus(p.lastMeasurement, p);
    if(status.crit) critTotal++;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:bold; color:var(--primary);">${p.name || '—'}</td>
      <td>${p.birthDate ? (new Date().getFullYear() - new Date(p.birthDate).getFullYear()) : '—'} سنة</td>
      <td><span class="badge badge-primary">${p.glucoseUnit || 'mg/dL'}</span></td>
      <td style="font-weight:bold; font-size:16px;">${p.lastMeasurement ? p.lastMeasurement.value : '—'}</td>
      <td>${status.html}</td>
      <td style="text-align: center; display:flex; gap:8px; justify-content:center;">
        <button class="btn secondary sm btn-open-child" data-id="${p.id}">الجرعات والحقن ⚙️</button>
        <button class="btn alt sm btn-open-report" data-id="${p.id}" data-pid="${p.parentId}">التقرير 📊</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  $('criticalPatients').textContent = critTotal;

  document.querySelectorAll('.btn-open-child').forEach(btn => {
    btn.onclick = () => window.openMedicalModal(btn.dataset.id);
  });
  document.querySelectorAll('.btn-open-report').forEach(btn => {
    btn.onclick = () => window.open(`reports.html?child=${btn.dataset.id}&parentId=${btn.dataset.pid}`, '_blank');
  });
}

// --- 4. النافذة الطبية الذكية (Medical Modal) ---
const modal = $('medical-modal');
$('modal-close').onclick = () => modal.close();
$('btn-cancel').onclick = () => modal.close();

window.openMedicalModal = (childId) => {
  const p = patients.find(x => x.id === childId);
  if (!p) return;

  $('parent-id').value = p.parentId;
  $('child-id').value = p.id;
  $('patientNameTitle').textContent = `ملف المريض: ${p.name}`;

  $('targetBg').value = p.glucose_limits?.target || '';
  $('cfVal').value = p.cf || p.correctionFactor || '';
  $('crBreakfast').value = p.cr?.breakfast || '';
  $('crLunch').value = p.cr?.lunch || '';
  $('crDinner').value = p.cr?.dinner || '';
  $('crSnack').value = p.cr?.snack || '';
  $('doctorNote').value = p.doctor_note || '';

  const map = p.injection_map || {};
  ['arm_right', 'arm_left', 'abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'thigh_right', 'thigh_left'].forEach(zone => {
    if($(`inj_${zone}`)) $(`inj_${zone}`).value = map[zone] || 'ok';
  });

  modal.showModal();
};

$('medical-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('btn-save-medical'); btn.disabled = true; btn.textContent = 'جاري التحديث...';
  const pId = $('parent-id').value; const cId = $('child-id').value;

  try {
    const newMap = {};
    ['arm_right', 'arm_left', 'abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'thigh_right', 'thigh_left'].forEach(z => newMap[z] = $(`inj_${z}`).value);

    const payload = {
      glucose_limits: { target: Number($('targetBg').value) },
      cf: Number($('cfVal').value),
      cr: { breakfast: Number($('crBreakfast').value), lunch: Number($('crLunch').value), dinner: Number($('crDinner').value), snack: Number($('crSnack').value) },
      doctor_note: $('doctorNote').value.trim(),
      injection_map: newMap,
      lastMedicalUpdate: serverTimestamp()
    };

    // التحديث بخاصية merge للاحتفاظ بالحدود الخطرة القديمة
    await setDoc(doc(db, `parents/${pId}/children/${cId}`), payload, { merge: true });
    
    alert("✅ تم حفظ البروتوكول! ستظهر التعليمات عند الأم فوراً.");
    modal.close();
    await loadPatients();
  } catch (err) { alert("❌ حدث خطأ أثناء الحفظ."); } 
  finally { btn.disabled = false; btn.textContent = '💾 اعتماد وتحديث البروتوكول'; }
};

function setupEvents() {
  $('btnLogout').onclick = async () => { await signOut(auth); location.href = "index.html"; };
  $('btnRefresh').onclick = async () => { await loadCodes(); await loadPatients(); };
  $('childSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    renderPatients(q ? patients.filter(p => (p.name||'').toLowerCase().includes(q)) : patients);
  });
}
