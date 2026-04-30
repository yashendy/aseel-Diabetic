// js/doctor-dashboard.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, collectionGroup, getDocs, doc, getDoc, setDoc, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let patients = [];

function showLoader(show) { $('loader').classList.toggle('hidden', !show); }

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }
  currentUser = user;
  
  // التحقق من أنه طبيب
  const docSnap = await getDoc(doc(db, "doctors", user.uid));
  if (!docSnap.exists() || docSnap.data().status !== 'approved') {
    alert("حسابك غير معتمد كطبيب بعد.");
    location.href = "index.html"; return;
  }
  
  $('doctorName').textContent = docSnap.data().fullName || 'دكتور';
  
  await loadCodes();
  await loadPatients();
  setupEvents();
});

// --- أكواد الربط ---
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

// --- قائمة المرضى (الأطفال) ---
async function loadPatients() {
  showLoader(true);
  const tbody = $('childrenTbody');
  try {
    // جلب جميع الأطفال المرتبطين بالطبيب الحالي باستخدام collectionGroup
    // ملاحظة: يتطلب إعداد index في Firebase (assignedDoctor ASC)
    const q = query(collectionGroup(db, "children"), where("assignedDoctor", "==", currentUser.uid));
    const snap = await getDocs(q);
    
    patients = [];
    let criticalCount = 0;

    for (let d of snap.docs) {
      const p = { id: d.id, parentId: d.ref.parent.parent.id, ...d.data() };
      
      // جلب آخر قياس لتلوين الحالة
      const mSnap = await getDocs(query(collection(db, `parents/${p.parentId}/children/${p.id}/measurements`), orderBy('when', 'desc'), limit(1)));
      if (!mSnap.empty) {
        p.lastMeasurement = mSnap.docs[0].data();
      }
      patients.push(p);
    }

    $('childrenCount').textContent = `${patients.length} مريض`;
    $('totalPatients').textContent = patients.length;

    renderPatients(patients);

  } catch(e) { 
    console.error(e); 
    tbody.innerHTML = `<tr><td colspan="6" class="empty">حدث خطأ. تأكد من إعداد فهارس قاعدة البيانات (Indexes) في Firebase.</td></tr>`;
  }
  showLoader(false);
}

function calcAge(bd) {
  if (!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  return a;
}

function getPatientStatus(m, child) {
  if(!m) return { html: '<span class="status-badge bg-muted">لا توجد بيانات</span>', crit: false };
  
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

  let text = 'طبيعي', css = 'bg-ok', crit = false;
  if(val <= cLow) { text = 'هبوط حرج'; css = 'bg-danger'; crit = true; }
  else if(val < low) { text = 'هبوط'; css = 'bg-danger'; }
  else if(val >= cHigh) { text = 'ارتفاع حرج'; css = 'bg-danger'; crit = true; }
  else if(val > high) { text = 'ارتفاع'; css = 'bg-warn'; }

  return { html: `<span class="status-badge ${css}">${text}</span>`, crit };
}

function renderPatients(list) {
  const tbody = $('childrenTbody');
  tbody.innerHTML = '';
  if(!list.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty">لا يوجد مرضى حالياً.</td></tr>`; return; }

  let critTotal = 0;

  list.forEach(p => {
    const m = p.lastMeasurement;
    const status = getPatientStatus(m, p);
    if(status.crit) critTotal++;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:bold; color:var(--primary);">${p.name || '—'}</td>
      <td>${calcAge(p.birthDate)} سنة</td>
      <td><span class="badge" style="background:#f1f5f9; color:#475569">${p.glucoseUnit || 'mg/dL'}</span></td>
      <td style="font-weight:bold; font-size:16px;">${m ? m.value : '—'}</td>
      <td>${status.html}</td>
      <td style="text-align: center;">
        <button class="btn secondary btn-open-child" data-id="${p.id}" data-pid="${p.parentId}">إعدادات المريض ⚙️</button>
        <button class="btn good btn-open-report" data-id="${p.id}" data-pid="${p.parentId}" style="margin-right: 5px;">التقرير الذكي 📊</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $('criticalPatients').textContent = critTotal;

  // ربط الأزرار بالصفحات الصحيحة
  document.querySelectorAll('.btn-open-child').forEach(btn => {
    btn.onclick = () => {
      // فتح صفحة تفاصيل وإعدادات الطفل
      location.href = `doctor-child.html?child=${btn.dataset.id}&parentId=${btn.dataset.pid}`;
    };
  });

  document.querySelectorAll('.btn-open-report').forEach(btn => {
    btn.onclick = () => {
      // فتح التقرير الذكي الذي برمجناه مسبقاً! 🔥
      // نحتاج لتمرير childId لصفحة التقارير، وصفحة التقارير يجب أن تتعامل مع الطبيب أيضاً إذا لزم الأمر
      window.open(`reports.html?child=${btn.dataset.id}&parentId=${btn.dataset.pid}`, '_blank');
    };
  });
}

function setupEvents() {
  $('btnLogout').onclick = async () => { await signOut(auth); location.href = "index.html"; };
  $('btnRefresh').onclick = async () => { await loadCodes(); await loadPatients(); };
  
  $('childSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = q ? patients.filter(p => (p.name||'').toLowerCase().includes(q)) : patients;
    renderPatients(filtered);
  });
}
