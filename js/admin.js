import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, collectionGroup, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let CURRENT_ADMIN = null;
let ALL_DOCTORS_APPROVED = [];   
let ALL_DOCTORS_PENDING = [];
let ALL_CHILDREN = [];  
let DOCTOR_PATIENT_COUNTS = {};
let ACTIVE_CHILD_FILTER = 'all';

// --- نظام اللايت/دارك مود ---
const themeBtn = $('themeToggle');
const currentTheme = localStorage.getItem('adminTheme') || 'dark';
if (currentTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
if (themeBtn) themeBtn.textContent = currentTheme === 'light' ? '🌙' : '🌞';

if (themeBtn) {
  themeBtn.onclick = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
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
function escapeHtml(s) { 
  return (s ?? '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); 
}

/* 1. التحقق من صلاحيات الأدمن */
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = 'index.html'; return; }
  
  $('loader').classList.remove('hidden');
  
  try {
    const uSnap = await getDoc(doc(db, 'users', user.uid));
    const role = uSnap.exists() ? (uSnap.data()?.role) : null;
    
    if (role !== 'admin') {
      alert('🚫 تم الرفض: هذه الصفحة مخصصة للإدارة العليا فقط.');
      location.href = 'index.html';
      return;
    }

    CURRENT_ADMIN = user;
    if ($('adminName')) $('adminName').textContent = user.displayName || user.email || 'Admin';
    
    await loadLists();
    wireEvents();
  } catch (err) {
    console.error("Authentication Error:", err);
  } finally {
    $('loader').classList.add('hidden');
  }
});

/* 2. ربط الأحداث */
function wireEvents() {
  if ($('btnSignOut')) $('btnSignOut').onclick = () => signOut(auth);
  if ($('btnRefreshLists')) $('btnRefreshLists').onclick = loadLists;
  if ($('btnOpenAssign')) $('btnOpenAssign').onclick = openAssignModal;
  if ($('btnCloseModal')) $('btnCloseModal').onclick = closeAssignModal;
  if ($('btnCancelAssign')) $('btnCancelAssign').onclick = closeAssignModal;
  if ($('btnAssign')) $('btnAssign').onclick = assignNow;
  if ($('childSearch')) $('childSearch').oninput = filterChildrenTable;
  if ($('doctorSearch')) $('doctorSearch').oninput = filterDoctorsTable;

  // فلاتر جدول الأطفال
  const filterWrap = $('childrenFilterChips');
  if (filterWrap) {
    filterWrap.onclick = e => {
      const btn = e.target.closest('.chip-btn');
      if (!btn) return;
      filterWrap.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ACTIVE_CHILD_FILTER = btn.dataset.filter || 'all';
      filterChildrenTable();
    };
  }
}

/* 3. تحميل قواعد البيانات */
async function loadLists() {
  $('loader').classList.remove('hidden');
  await Promise.all([loadDoctors(), loadChildren(), loadFoodStats()]);
  
  if ($('doctorsApproved')) $('doctorsApproved').textContent = ALL_DOCTORS_APPROVED.length;
  if ($('doctorsPending')) $('doctorsPending').textContent = ALL_DOCTORS_PENDING.length;
  if ($('childrenCount')) $('childrenCount').textContent = ALL_CHILDREN.length;
  
  $('loader').classList.add('hidden');
}

/* إحصائيات مكتبة الأطعمة والطلبات المعلقة */
async function loadFoodStats() {
  try {
    const reqsQuery = query(collection(db, 'admin', 'global', 'foodRequests'), where('status', '==', 'pending'));
    const reqsSnap = await getDocs(reqsQuery);
    const count = reqsSnap.size;

    const navBadge = $('navReqBadge');
    const pendingBadge = $('pendingReqBadge');
    const pendingCount = $('pendingReqCount');

    if (count > 0) {
      if (navBadge) { navBadge.textContent = count; navBadge.classList.remove('hidden'); }
      if (pendingBadge) pendingBadge.classList.remove('hidden');
      if (pendingCount) pendingCount.textContent = count;
    } else {
      if (navBadge) navBadge.classList.add('hidden');
      if (pendingBadge) pendingBadge.classList.add('hidden');
    }

    const foodsSnap = await getDocs(collection(db, 'admin', 'global', 'foodItems'));
    if ($('foodItemsCount')) $('foodItemsCount').textContent = `${foodsSnap.size} صنف`;
  } catch (err) {
    console.warn("تعذر جلب إحصائيات مكتبة الطعام:", err);
  }
}

/* جلب الأطباء مع إضافة المركز */
async function loadDoctors() {
  ALL_DOCTORS_APPROVED = []; 
  ALL_DOCTORS_PENDING = [];
  try {
    const qy = query(collection(db, 'users'), where('role', '==', 'doctor'));
    const snap = await getDocs(qy);
    snap.forEach(s => {
      const d = s.data();
      const docData = { 
        uid: s.id, 
        name: d.displayName || d.name || 'طبيب', 
        email: d.email || '—', 
        center: d.center || d.clinic || d.email || 'عيادة عامة', 
        isApproved: d.isApproved 
      };
      
      if (d.isApproved === true) ALL_DOCTORS_APPROVED.push(docData);
      else ALL_DOCTORS_PENDING.push(docData);
    });
    renderPendingDoctors();
    renderApprovedDoctors(ALL_DOCTORS_APPROVED);
  } catch (e) {
    console.error("Error loading doctors:", e);
  }
}

/* جلب الأطفال وربطهم بالأطباء (مع دعم المسار المباشر كخطة بديلة لحصانة الصلاحيات) */
async function loadChildren() {
  try {
    let docsList = [];
    
    // 1. المحاولة الأولى: عبر collectionGroup
    try {
      const qy = query(collectionGroup(db, 'children'));
      const snap = await getDocs(qy);
      snap.forEach(s => docsList.push(s));
    } catch (cgErr) {
      console.warn("تعذر الجلب عبر collectionGroup (بسبب قيود القواعد أو الفهرس)، التبديل التلقائي للمسار المباشر للأسر:", cgErr);
      
      // 2. المحاولة البديلة: جلب حسابات المستخدمين/الأسر وفحص أطفال كل أسرة مباشرة
      const usersSnap = await getDocs(collection(db, 'users'));
      const parentDocs = usersSnap.docs.filter(u => {
        const r = u.data()?.role;
        return r === 'parent' || !r || r === 'user';
      });

      await Promise.all(parentDocs.map(async pDoc => {
        try {
          const cSnap = await getDocs(collection(db, 'parents', pDoc.id, 'children'));
          cSnap.docs.forEach(cd => {
            cd._parentData = pDoc.data();
            docsList.push(cd);
          });
        } catch (cErr) {
          console.warn(`فحص أطفال الأسرة ${pDoc.id}:`, cErr);
        }
      }));
    }

    ALL_CHILDREN = [];
    DOCTOR_PATIENT_COUNTS = {};

    const doctorMap = {};
    ALL_DOCTORS_APPROVED.forEach(d => { doctorMap[d.uid] = d; });

    let assignedCount = 0;

    docsList.forEach(s => {
      const parts = s.ref.path.split('/');
      const parentId = parts[1], childId = parts[3];
      const d = s.data();
      const parentUser = s._parentData || {};
      const parentName = d?.parentName || parentUser?.name || parentUser?.displayName || parentUser?.email || parentId;
      const consent = d?.sharingConsent === true || (d?.sharingConsent && typeof d.sharingConsent === 'object' && d.sharingConsent.doctor === true) || d?.shareDoctor === true;

      const docUid = d?.assignedDoctor || null;
      let docName = d?.assignedDoctorInfo?.name || null;
      let docCenter = d?.assignedDoctorInfo?.center || null;

      if (docUid) {
        assignedCount++;
        DOCTOR_PATIENT_COUNTS[docUid] = (DOCTOR_PATIENT_COUNTS[docUid] || 0) + 1;
        if (!docName && doctorMap[docUid]) {
          docName = doctorMap[docUid].name;
          docCenter = doctorMap[docUid].center;
        }
      }

      ALL_CHILDREN.push({ 
        parentId, 
        childId, 
        name: d?.name || '—', 
        parentName: parentName, 
        assignedDoctor: docUid,
        assignedDoctorName: docName,
        assignedDoctorCenter: docCenter,
        consent: !!consent 
      });
    });

    // تحديث العدادات الإجمالية
    if ($('assignedChildrenCount')) $('assignedChildrenCount').textContent = assignedCount;
    if ($('childrenHint')) $('childrenHint').textContent = ALL_CHILDREN.length;

    // تحديث أرقام الفلاتر
    const countAll = ALL_CHILDREN.length;
    const countUnassigned = ALL_CHILDREN.filter(c => !c.assignedDoctor).length;
    const countAssigned = assignedCount;
    const countNoConsent = ALL_CHILDREN.filter(c => !c.consent).length;

    if ($('countAll')) $('countAll').textContent = countAll;
    if ($('countUnassigned')) $('countUnassigned').textContent = countUnassigned;
    if ($('countAssigned')) $('countAssigned').textContent = countAssigned;
    if ($('countNoConsent')) $('countNoConsent').textContent = countNoConsent;

    // إعادة رسم جدول الأطباء لتحديث عداد المرضى لكل طبيب
    renderApprovedDoctors(ALL_DOCTORS_APPROVED);

    // تطبيق الفلتر الحالي على جدول الأطفال
    filterChildrenTable();
  } catch (e) {
    console.error("Error loading children:", e);
    if ($('childrenTbody')) $('childrenTbody').innerHTML = `<tr><td colspan="3" style="text-align:center; padding:15px; color:var(--muted);">لا توجد بيانات أطفال متاحة حالياً.</td></tr>`;
  }
}

/* 4. البحث والفلترة داخل الجداول */
function filterChildrenTable() {
  const search = ($('childSearch').value || '').trim().toLowerCase();
  
  let list = ALL_CHILDREN;

  if (ACTIVE_CHILD_FILTER === 'unassigned') {
    list = list.filter(c => !c.assignedDoctor);
  } else if (ACTIVE_CHILD_FILTER === 'assigned') {
    list = list.filter(c => !!c.assignedDoctor);
  } else if (ACTIVE_CHILD_FILTER === 'noconsent') {
    list = list.filter(c => !c.consent);
  }

  if (search) {
    list = list.filter(c => 
      (c.name || '').toLowerCase().includes(search) || 
      (c.parentName || '').toLowerCase().includes(search) ||
      (c.assignedDoctorName || '').toLowerCase().includes(search)
    );
  }

  renderChildrenTable(list);
}

function filterDoctorsTable() {
  const t = ($('doctorSearch').value || '').trim().toLowerCase();
  renderApprovedDoctors(ALL_DOCTORS_APPROVED.filter(d => (d.name || '').toLowerCase().includes(t) || (d.email || '').toLowerCase().includes(t) || (d.center || '').toLowerCase().includes(t)));
}

/* 5. رسم الجداول */
function renderPendingDoctors() {
  const tbody = $('pendingDoctorsTbody'); 
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!ALL_DOCTORS_PENDING.length) { 
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted);">لا يوجد أطباء بانتظار الاعتماد.</td></tr>`; 
    return; 
  }
  
  ALL_DOCTORS_PENDING.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold;">${escapeHtml(d.name || '—')}</div>
        <div style="font-size:12px; color:var(--muted); margin-top:2px;">🏥 ${escapeHtml(d.center)}</div>
      </td>
      <td>${escapeHtml(d.email)}</td>
      <td><span class="badge warn">جديد</span></td>
      <td style="text-align:center;">
        <button class="btn primary btn-sm" onclick="approveDoctor('${d.uid}')">✅ اعتماد</button>
        <button class="btn-sm btn-danger-outline" style="margin-inline-start:6px;" onclick="rejectDoctor('${d.uid}', '${escapeHtml(d.name)}')">❌ رفض</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderApprovedDoctors(list) {
  const tbody = $('doctorsTbody'); 
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!list.length) { 
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--muted);">لا يوجد أطباء معتمدين.</td></tr>`; 
    return; 
  }
  
  for (const d of list) {
    const patientCount = DOCTOR_PATIENT_COUNTS[d.uid] || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold; font-size:15px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;">
          <span>${escapeHtml(d.name)}</span>
          <button type="button" class="btn-sm btn-danger-outline" title="إلغاء اعتماد الطبيب" onclick="revokeDoctorApproval('${d.uid}', '${escapeHtml(d.name)}')">إلغاء الاعتماد</button>
        </div>
        <div style="font-size:12px; color:var(--muted); margin-top:4px;">🏥 ${escapeHtml(d.center)}</div>
        <div style="font-size:11px; color:var(--success); margin-top:3px; font-weight:bold;">👶 المرضى المسندين: <b>${patientCount}</b></div>
      </td>
      <td style="text-align:center; vertical-align:middle;">
        <input type="radio" name="doctorPick" value="${escapeHtml(`${d.uid}|${d.name}|${d.email}`)}" style="transform: scale(1.4); cursor:pointer;">
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function renderChildrenTable(list) {
  const tbody = $('childrenTbody'); 
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!list.length) { 
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--muted); padding:20px;">لا توجد بيانات مطابقة للفلتر المحدد.</td></tr>`; 
    return; 
  }
  
  for (const c of list) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold; font-size:15px;">${escapeHtml(c.name)}</div>
        <div style="font-size:12px; color:var(--muted); margin-top:3px;">ولي الأمر: ${escapeHtml(c.parentName || 'غير مسجل')}</div>
        ${c.assignedDoctor ? `
          <div style="font-size:12px; color:var(--primary); margin-top:5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>👨‍⚕️ <b>${escapeHtml(c.assignedDoctorName || 'طبيب مسند')}</b></span>
            <button type="button" class="btn-sm btn-danger-outline" onclick="unassignDoctor('${c.parentId}', '${c.childId}', '${escapeHtml(c.name)}')">فك الارتباط ✕</button>
          </div>
        ` : `<div style="font-size:11px; color:var(--warn); margin-top:4px;">⏳ لم يتم إسناد طبيب بعد</div>`}
      </td>
      <td>
        <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
          ${c.consent ? '<span class="badge">✅ مُصرّح بالمشاركة</span>' : '<span class="badge err">❌ غير مُصرّح</span>'}
          ${c.assignedDoctor ? `<span class="badge" style="background:rgba(59,130,246,0.15);color:var(--primary);border-color:var(--primary);">🔗 مسند</span>` : '<span class="badge warn">حُر</span>'}
        </div>
      </td>
      <td style="text-align:center; vertical-align:middle;">
        <input type="radio" name="childPick" value="${escapeHtml(`${c.parentId}|${c.childId}|${c.name}`)}" style="transform: scale(1.4); cursor:pointer;">
      </td>
    `;
    tbody.appendChild(tr);
  }
}

/* 6. منطق الاعتماد والإسناد وفك الارتباط */
window.approveDoctor = async function(uid) {
  if (!confirm('هل أنت متأكد من اعتماد هذا الطبيب؟')) return;
  $('loader').classList.remove('hidden');
  try {
    await updateDoc(doc(db, 'users', uid), { isApproved: true, updatedAt: serverTimestamp() });
    alert('تم الاعتماد بنجاح! ✅');
    await loadLists();
  } catch (e) { 
    console.error(e); 
    alert('حدث خطأ: ' + e.message); 
  } finally {
    $('loader').classList.add('hidden');
  }
};

window.rejectDoctor = async function(uid, doctorName) {
  if (!confirm(`هل تريد رفض طلب الطبيب "${doctorName}"؟`)) return;
  $('loader').classList.remove('hidden');
  try {
    await updateDoc(doc(db, 'users', uid), { isApproved: false, status: 'rejected', updatedAt: serverTimestamp() });
    alert(`تم رفض طلب الطبيب "${doctorName}".`);
    await loadLists();
  } catch (e) {
    console.error(e);
    alert('حدث خطأ: ' + e.message);
  } finally {
    $('loader').classList.add('hidden');
  }
};

window.revokeDoctorApproval = async function(uid, doctorName) {
  if (!confirm(`هل أنت متأكد من إلغاء اعتماد الطبيب "${doctorName}"؟\nلن يتمكن الطبيب من الوصول لبيانات الأطفال حتى يعاد اعتماده.`)) return;
  $('loader').classList.remove('hidden');
  try {
    await updateDoc(doc(db, 'users', uid), { isApproved: false, updatedAt: serverTimestamp() });
    alert(`تم إلغاء اعتماد الطبيب "${doctorName}".`);
    await loadLists();
  } catch (e) {
    console.error("Revoke error:", e);
    alert("حدث خطأ أثناء إلغاء الاعتماد: " + e.message);
  } finally {
    $('loader').classList.add('hidden');
  }
};

window.unassignDoctor = async function(parentId, childId, childName) {
  if (!confirm(`هل أنت متأكد من فك ارتباط الطفل "${childName}" بالطبيب المعالج؟\nسيتم إلغاء وصول الطبيب لسجلات المريض.`)) return;
  $('loader').classList.remove('hidden');
  try {
    const ref = doc(db, `parents/${parentId}/children/${childId}`);
    await updateDoc(ref, {
      assignedDoctor: deleteField(),
      assignedDoctorInfo: deleteField(),
      shareDoctor: false,
      updatedAt: serverTimestamp()
    });
    alert(`تم فك الارتباط للطفل "${childName}" بنجاح! ✅`);
    await loadLists();
  } catch (e) {
    console.error("Unassign error:", e);
    alert("تعذر فك الارتباط: " + e.message);
  } finally {
    $('loader').classList.add('hidden');
  }
};

function openAssignModal() {
  const childSel = document.querySelector('input[name="childPick"]:checked');
  const docSel   = document.querySelector('input[name="doctorPick"]:checked');

  if (!childSel || !docSel) { alert('⚠️ الرجاء تحديد طفل وطبيب من الجداول أولاً.'); return; }

  $('childSelect').innerHTML = ''; $('doctorSelect').innerHTML = '';

  const [parentId, childId, childName] = childSel.value.split('|');
  const [doctorUid, doctorName, doctorEmail] = docSel.value.split('|');

  $('childSelect').innerHTML = `<option value="${parentId}|${childId}">${childName}</option>`;
  $('doctorSelect').innerHTML = `<option value="${doctorUid}|${doctorName}|${doctorEmail}">${doctorName} (${doctorEmail})</option>`;

  $('modalStatus').textContent = '';
  $('assignModal').classList.remove('hidden');
}

function closeAssignModal() { $('assignModal').classList.add('hidden'); }

async function assignNow() {
  const [parentId, childId] = $('childSelect').value.split('|');
  const [doctorUid, doctorName, doctorEmail] = $('doctorSelect').value.split('|');

  try {
    $('btnAssign').disabled = true; $('btnAssign').textContent = "جاري الاعتماد...";
    const ref = doc(db, `parents/${parentId}/children/${childId}`);

    await updateDoc(ref, {
      assignedDoctor: doctorUid,
      assignedDoctorInfo: { uid: doctorUid, name: doctorName || null, email: doctorEmail || null },
      parentId: parentId,
      sharingConsent: { doctor: true }, 
      shareDoctor: true,
      updatedAt: serverTimestamp()
    });

    try {
      await setDoc(doc(db, `doctors/${doctorUid}/patients/${childId}`), {
        childId: childId,
        parentId: parentId,
        childName: childName || null,
        linkedAt: serverTimestamp()
      }, { merge: true });
    } catch(errDoc) {
      console.warn("Could not write to doctors subcollection:", errDoc);
    }

    $('modalStatus').style.color = "var(--success)";
    $('modalStatus').textContent = '✅ تم ربط الطبيب بالمريض بنجاح!';
    setTimeout(() => { closeAssignModal(); loadLists(); }, 1500);
  } catch (e) {
    console.error(e);
    $('modalStatus').style.color = "var(--danger)";
    $('modalStatus').textContent = '❌ تعذّر الإسناد. تحقّق من الصلاحيات والاتصال.';
  } finally {
    $('btnAssign').disabled = false; $('btnAssign').textContent = "✅ اعتماد الإسناد الآن";
  }
}


/* ========================================================= */
/* إعدادات الذكاء الاصطناعي العامة للأدمن (Gemini Global API) */
/* ========================================================= */
const globalKeyInput = $('globalGeminiKeyInput');
const btnSaveGlobalAiKey = $('btnSaveGlobalAiKey');
const btnTestGlobalAiKey = $('btnTestGlobalAiKey');
const btnToggleKeyVisibility = $('btnToggleKeyVisibility');
const aiGlobalKeyMsg = $('aiGlobalKeyMsg');
const aiGlobalStatusBadge = $('aiGlobalStatusBadge');

async function loadGlobalAiSettings() {
  if (!globalKeyInput) return;
  try {
    const snap = await getDoc(doc(db, 'admin/global/settings/ai'));
    if (snap.exists() && snap.data()?.geminiApiKey) {
      const key = String(snap.data().geminiApiKey).trim();
      globalKeyInput.value = key;
      if (aiGlobalStatusBadge) {
        aiGlobalStatusBadge.textContent = '✅ مفعل ويعمل للجميع';
        aiGlobalStatusBadge.style.color = '#4ade80';
        aiGlobalStatusBadge.style.background = 'rgba(74, 222, 128, 0.15)';
      }
    } else {
      if (aiGlobalStatusBadge) {
        aiGlobalStatusBadge.textContent = '⚠️ غير مفعل (المحرك السريري الافتراضي نشط)';
        aiGlobalStatusBadge.style.color = '#fbbf24';
        aiGlobalStatusBadge.style.background = 'rgba(251, 191, 36, 0.15)';
      }
    }
  } catch (err) {
    console.warn('Error reading global AI settings:', err);
    if (aiGlobalStatusBadge) {
      aiGlobalStatusBadge.textContent = 'المحرك السريري الافتراضي نشط';
    }
  }
}

if (btnToggleKeyVisibility && globalKeyInput) {
  btnToggleKeyVisibility.onclick = () => {
    const isPass = globalKeyInput.type === 'password';
    globalKeyInput.type = isPass ? 'text' : 'password';
    btnToggleKeyVisibility.textContent = isPass ? '🔒' : '👁️';
  };
}

if (btnSaveGlobalAiKey && globalKeyInput) {
  btnSaveGlobalAiKey.onclick = async () => {
    const key = globalKeyInput.value.trim();
    if (!key) {
      if (!confirm('هل تريد حذف المفتاح والاعتماد على المحرك السريري الذكي المدمج فقط؟')) return;
    }
    
    btnSaveGlobalAiKey.disabled = true;
    if (aiGlobalKeyMsg) {
      aiGlobalKeyMsg.style.color = 'var(--muted)';
      aiGlobalKeyMsg.textContent = 'جاري الحفظ والتعميم على المنصة...';
    }

    try {
      await setDoc(doc(db, 'admin/global/settings/ai'), {
        geminiApiKey: key,
        updatedAt: serverTimestamp(),
        updatedBy: CURRENT_ADMIN?.email || CURRENT_ADMIN?.uid || 'admin'
      }, { merge: true });

      if (key) {
        localStorage.setItem('aseel_gemini_key', key);
        if (aiGlobalKeyMsg) {
          aiGlobalKeyMsg.style.color = 'var(--success)';
          aiGlobalKeyMsg.textContent = '✅ تم حفظ وتعميم المفتاح بنجاح! أصبح مساعد الذكاء الاصطناعي السحابي مفعل الآن لجميع أطفال المنصة.';
        }
        if (aiGlobalStatusBadge) {
          aiGlobalStatusBadge.textContent = '✅ مفعل ويعمل للجميع';
          aiGlobalStatusBadge.style.color = '#4ade80';
          aiGlobalStatusBadge.style.background = 'rgba(74, 222, 128, 0.15)';
        }
      } else {
        localStorage.removeItem('aseel_gemini_key');
        if (aiGlobalKeyMsg) {
          aiGlobalKeyMsg.style.color = 'var(--warn)';
          aiGlobalKeyMsg.textContent = 'تم إلغاء المفتاح؛ ستعمل المنصة بالمحرك السريري الذكي المدمج تلقائياً.';
        }
        if (aiGlobalStatusBadge) {
          aiGlobalStatusBadge.textContent = 'المحرك السريري الافتراضي نشط';
        }
      }
    } catch (err) {
      console.error(err);
      if (aiGlobalKeyMsg) {
        aiGlobalKeyMsg.style.color = 'var(--danger)';
        aiGlobalKeyMsg.textContent = '❌ حدث خطأ أثناء الحفظ: ' + (err.message || 'يرجى التحقق من الصلاحيات');
      }
    } finally {
      btnSaveGlobalAiKey.disabled = false;
    }
  };
}

if (btnTestGlobalAiKey && globalKeyInput) {
  btnTestGlobalAiKey.onclick = async () => {
    const key = globalKeyInput.value.trim();
    if (!key) {
      alert('يرجى إدخال المفتاح أولاً لفحصه.');
      return;
    }

    btnTestGlobalAiKey.disabled = true;
    if (aiGlobalKeyMsg) {
      aiGlobalKeyMsg.style.color = 'var(--muted)';
      aiGlobalKeyMsg.textContent = 'جاري اختبار الاتصال بخوادم Google Gemini...';
    }

    try {
      const candidateModels = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
      let workingModel = null;
      let reply = '';
      let lastError = null;

      for (const m of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'قل كلمة واحدة للتأكيد: جاهز' }] }]
            })
          });

          if (res.ok) {
            const data = await res.json();
            reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'جاهز';
            workingModel = m;
            break;
          } else {
            const errJson = await res.json().catch(() => ({}));
            lastError = new Error(errJson?.error?.message || `HTTP ${res.status}`);
          }
        } catch (subErr) {
          lastError = subErr;
        }
      }

      if (workingModel) {
        if (aiGlobalKeyMsg) {
          aiGlobalKeyMsg.style.color = 'var(--success)';
          aiGlobalKeyMsg.textContent = `⚡ الاتصال ناجح ومستقر تماماً عبر النموذج (${workingModel})! رد النموذج: "${reply.trim()}". المفتاح مفعل وجاهز.`;
        }
      } else {
        throw lastError || new Error('تعذر العثور على نموذج متوافق مع المفتاح.');
      }
    } catch (e) {
      if (aiGlobalKeyMsg) {
        aiGlobalKeyMsg.style.color = 'var(--danger)';
        aiGlobalKeyMsg.textContent = `❌ فشل الاتصال بالمفتاح: ${e.message}`;
      }
    } finally {
      btnTestGlobalAiKey.disabled = false;
    }
  };
}
