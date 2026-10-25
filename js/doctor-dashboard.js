// js/doctor-dashboard.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, collectionGroup, getDocs, doc, getDoc, updateDoc, setDoc, addDoc, query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let currentDoctorData = {};
let patients = [];
let activeFilter = 'all';

function showLoader(show) {
  const el = $('loader');
  if (el) el.classList.toggle('hidden', !show);
}

// دالة حماية النصوص ضد XSS
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// دالة التاريخ المحلي بصيغة YYYY-MM-DD
function localDateStr(dateObj = new Date()) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --- 1. التحقق من الدخول وصلاحيات الطبيب ---
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html"; return; }
  currentUser = user;

  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists() || userSnap.data().role !== 'doctor') {
    alert("حسابك لا يمتلك صلاحيات الطبيب.");
    location.href = "index.html";
    return;
  }

  currentDoctorData = userSnap.data();
  renderDoctorProfile(currentDoctorData);
  setupProfileModal(currentDoctorData);

  // تحميل الأكواد والمرضى بالتوازي لتسريع فتح الصفحة
  await Promise.all([
    loadCodes(),
    loadPatients()
  ]);
  setupEvents();
});

// --- عرض بيانات الطبيب والعيادة ---
function renderDoctorProfile(userData) {
  const name = userData.name || userData.displayName || 'طبيب';
  if ($('doctorName')) $('doctorName').textContent = `د. ${name}`;
  if ($('docCardName')) $('docCardName').textContent = `د. ${name}`;
  if ($('docAvatar')) $('docAvatar').textContent = name.charAt(0);
  if ($('docSpecialty')) $('docSpecialty').textContent = userData.specialty || 'استشاري سكري وغدد صماء أطفال';
  if ($('docCenter')) $('docCenter').textContent = userData.center || userData.clinic || 'عيادة السكري التخصصية';
  if ($('docEmail')) $('docEmail').textContent = userData.email || currentUser.email || '—';
  if ($('docPhone')) $('docPhone').textContent = userData.phone || 'غير مسجل';
  if ($('docPermCode')) $('docPermCode').textContent = userData.doctorCode || '—';
  if ($('docStatusBadge')) {
    $('docStatusBadge').textContent = userData.isApproved ? 'طبيب معتمد ✅' : 'بانتظار الاعتماد ⏳';
    $('docStatusBadge').style.background = userData.isApproved ? '#dcfce7' : '#fef3c7';
    $('docStatusBadge').style.color = userData.isApproved ? '#166534' : '#92400e';
  }
}

// --- نافذة تعديل بيانات الطبيب ---
function setupProfileModal(userData) {
  const modal = $('docProfileModal');
  const btnEdit = $('btnEditDocProfile');
  const btnClose = $('btnCloseDocModal');
  const btnCancel = $('btnCancelDocModal');
  const btnSave = $('btnSaveDocProfile');

  if (btnEdit && modal) {
    btnEdit.onclick = () => {
      if ($('inpDocName')) $('inpDocName').value = userData.name || userData.displayName || '';
      if ($('inpDocSpecialty')) $('inpDocSpecialty').value = userData.specialty || '';
      if ($('inpDocCenter')) $('inpDocCenter').value = userData.center || userData.clinic || '';
      if ($('inpDocPhone')) $('inpDocPhone').value = userData.phone || '';
      modal.classList.remove('hidden');
    };
  }

  const closeModal = () => modal?.classList.add('hidden');
  if (btnClose) btnClose.onclick = closeModal;
  if (btnCancel) btnCancel.onclick = closeModal;

  if (btnSave) {
    btnSave.onclick = async () => {
      const newName = $('inpDocName')?.value?.trim();
      const newSpecialty = $('inpDocSpecialty')?.value?.trim();
      const newCenter = $('inpDocCenter')?.value?.trim();
      const newPhone = $('inpDocPhone')?.value?.trim();

      if (!newName) {
        alert("يرجى إدخال اسم الطبيب");
        return;
      }

      showLoader(true);
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          name: newName,
          specialty: newSpecialty || null,
          center: newCenter || null,
          phone: newPhone || null,
          updatedAt: serverTimestamp()
        });

        userData.name = newName;
        userData.specialty = newSpecialty;
        userData.center = newCenter;
        userData.phone = newPhone;
        currentDoctorData = userData;

        renderDoctorProfile(userData);
        closeModal();
        alert("تم تحديث بيانات الطبيب والعيادة بنجاح! ✅");
      } catch (err) {
        console.error("Error updating doctor profile:", err);
        alert("حدث خطأ أثناء حفظ البيانات: " + err.message);
      } finally {
        showLoader(false);
      }
    };
  }
}

// --- 2. إدارة أكواد الربط ---
async function loadCodes() {
  const list = $('codesList');
  if (!list) return;
  list.innerHTML = '<div class="empty">جاري التحميل...</div>';
  try {
    const q = query(collection(db, "linkCodes"), where("doctorId", "==", currentUser.uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      list.innerHTML = '<div class="empty">لا توجد أكواد نشطة. أنشئ كوداً جديداً لمشاركته مع الأسرة.</div>';
      return;
    }

    let html = '';
    snap.forEach(d => {
      const c = d.data();
      const dateStr = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('ar-EG') : 'حديث';
      html += `
        <div class="code-row">
          <div class="code-val">${escapeHtml(d.id)}</div>
          <div class="code-meta">
            ${c.used ? `<span style="color:var(--danger)">مستخدم ❌</span>` : `<span style="color:var(--good); font-weight:bold;">متاح للاستخدام ✅</span>`}
            <br><small style="color:var(--muted)">تاريخ الإنشاء: ${dateStr}</small>
          </div>
        </div>
      `;
    });
    list.innerHTML = html;
  } catch (e) {
    console.error(e);
    list.innerHTML = '<div class="empty">حدث خطأ في تحميل الأكواد.</div>';
  }
}

if ($('btnCreateCode')) {
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
    } catch (e) {
      alert("حدث خطأ أثناء إنشاء الكود");
    } finally {
      showLoader(false);
    }
  };
}

// --- 3. جلب بيانات الأطفال والمرضى المتابعين بدقة وأمان ---
async function loadPatients() {
  showLoader(true);
  const tbody = $('childrenTbody');
  try {
    patients = [];
    const docsMap = new Map();

    // 1. الاستعلام السريع والآمن عبر collectionGroup (متوافق 100% مع Firestore Rules)
    const [res1, res2] = await Promise.allSettled([
      getDocs(query(collectionGroup(db, "children"), where("assignedDoctor", "==", currentUser.uid))),
      getDocs(query(collectionGroup(db, "children"), where("assignedDoctorInfo.uid", "==", currentUser.uid)))
    ]);

    if (res1.status === 'fulfilled') {
      res1.value.forEach(d => docsMap.set(d.id, d));
    }
    if (res2.status === 'fulfilled') {
      res2.value.forEach(d => docsMap.set(d.id, d));
    }

    // 2. فحص سجل مرضى الطبيب المباشر (doctors/{uid}/patients) كمسار داعم وآمن
    try {
      const docPatientsSnap = await getDocs(collection(db, `doctors/${currentUser.uid}/patients`));
      await Promise.all(docPatientsSnap.docs.map(async dp => {
        const dpData = dp.data();
        if (dpData.childId && dpData.parentId && !docsMap.has(dpData.childId)) {
          try {
            const cDoc = await getDoc(doc(db, `parents/${dpData.parentId}/children/${dpData.childId}`));
            if (cDoc.exists()) {
              cDoc._parentId = dpData.parentId;
              docsMap.set(cDoc.id, cDoc);
            }
          } catch (innerErr) {
            // يتم تجاهل الطفل إذا أوقفت الأسرة مشاركة البيانات (Consent Paused)
          }
        }
      }));
    } catch (e) {
      // تجاهل في حال عدم وجود المجموعة الفرعية بعد
    }

    // 3. معالجة كل طفل وجلب قياساته وتحاليله الأخيرة بالتوازي
    const d7 = new Date();
    d7.setDate(d7.getDate() - 7);
    const d7Str = localDateStr(d7);

    const processedPatients = await Promise.all(Array.from(docsMap.values()).map(async d => {
      const data = d.data();

      // التحقق من أن موافقة الأسرة غير موقوفة
      if (data.sharingConsent === false || (data.sharingConsent && data.sharingConsent.doctor === false)) {
        return null;
      }

      const parentId = d._parentId || data.parentId || (d.ref.parent?.parent ? d.ref.parent.parent.id : null);
      if (!parentId) return null;

      const p = { id: d.id, parentId, ...data, weekReadings: [] };

      const [measRes, labRes, weekRes] = await Promise.allSettled([
        getDocs(query(collection(db, `parents/${p.parentId}/children/${p.id}/measurements`), orderBy('when', 'desc'), limit(1))),
        getDocs(query(collection(db, `parents/${p.parentId}/children/${p.id}/labs`), orderBy('when', 'desc'), limit(1))),
        getDocs(query(collection(db, `parents/${p.parentId}/children/${p.id}/measurements`), where('date', '>=', d7Str)))
      ]);

      // أ) آخر قياس جلوكوز
      if (measRes.status === 'fulfilled' && !measRes.value.empty) {
        p.lastMeasurement = measRes.value.docs[0].data();
      } else {
        try {
          const mSnap2 = await getDocs(query(collection(db, `parents/${p.parentId}/children/${p.id}/measurements`), orderBy('date', 'desc'), limit(1)));
          if (!mSnap2.empty) p.lastMeasurement = mSnap2.docs[0].data();
        } catch (err) {}
      }

      // ب) آخر تحليل تراكمي
      if (labRes.status === 'fulfilled' && !labRes.value.empty) {
        p.lastLab = labRes.value.docs[0].data();
      }

      // ج) قراءات آخر 7 أيام لحساب الـ TIR
      if (weekRes.status === 'fulfilled') {
        weekRes.value.forEach(ws => {
          const wd = ws.data();
          const val = Number(wd.value_mgdl ?? wd.value ?? 0);
          if (val > 0) p.weekReadings.push(val);
        });
      }

      p.triage = evaluatePatientTriage(p);
      return p;
    }));

    patients = processedPatients.filter(Boolean);
    updateTriageCounts();
    renderPatients();

  } catch (e) {
    console.error(e);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">حدث خطأ في جلب بيانات المرضى. الرجاء المحاولة مرة أخرى.</td></tr>`;
    }
  } finally {
    showLoader(false);
  }
}

// تقييم وتصنيف حالة المريض السريرية
function evaluatePatientTriage(p) {
  const m = p.lastMeasurement;
  const unit = p.glucoseUnit || 'mg/dL';
  const cLow = Number(p.glucose_limits?.critical_low) || (unit === 'mmol/L' ? 3.0 : 54);
  const cHigh = Number(p.glucose_limits?.critical_high) || (unit === 'mmol/L' ? 13.9 : 250);
  const low = Number(p.glucose_limits?.low) || (unit === 'mmol/L' ? 3.9 : 70);
  const high = Number(p.glucose_limits?.high) || (unit === 'mmol/L' ? 10.0 : 180);

  let isCritical = false;
  let needsAttention = false;
  let isLabsDue = false;

  if (m) {
    const val = Number(m.normalizedValue || m.value);
    if (val <= cLow || val >= cHigh) isCritical = true;
    else if (val < low || val > high) needsAttention = true;
  }

  if (p.weekReadings && p.weekReadings.length >= 3) {
    const inRange = p.weekReadings.filter(v => v >= low && v <= high).length;
    const tir = Math.round((inRange / p.weekReadings.length) * 100);
    p.tirPct = tir;
    if (tir < 60) needsAttention = true;
  }

  if (!p.lastLab) {
    isLabsDue = true;
  } else {
    const labDate = p.lastLab.when?.toDate ? p.lastLab.when.toDate() : (p.lastLab.date ? new Date(p.lastLab.date) : null);
    if (labDate) {
      const daysSince = Math.floor((new Date() - labDate) / (1000 * 60 * 60 * 24));
      p.labDaysSince = daysSince;
      if (daysSince > 90) isLabsDue = true;
    } else {
      isLabsDue = true;
    }
  }

  p.isCritical = isCritical;
  p.needsAttention = needsAttention && !isCritical;
  p.isLabsDue = isLabsDue;
  p.isOk = !isCritical && !needsAttention;

  if (isCritical) return 'crit';
  if (needsAttention) return 'attention';
  if (isLabsDue) return 'labs';
  return 'ok';
}

function updateTriageCounts() {
  const total = patients.length;
  const crit = patients.filter(p => p.isCritical).length;
  const att = patients.filter(p => p.needsAttention).length;
  const labs = patients.filter(p => p.isLabsDue).length;
  const ok = patients.filter(p => p.isOk).length;

  if ($('totalPatients')) $('totalPatients').textContent = total;
  if ($('criticalPatients')) $('criticalPatients').textContent = crit;
  if ($('attentionPatients')) $('attentionPatients').textContent = att;
  if ($('dueLabsPatients')) $('dueLabsPatients').textContent = labs;
  if ($('childrenCount')) $('childrenCount').textContent = `${total} مريض`;

  if ($('countAll')) $('countAll').textContent = total;
  if ($('countCrit')) $('countCrit').textContent = crit;
  if ($('countAtt')) $('countAtt').textContent = att;
  if ($('countLabs')) $('countLabs').textContent = labs;
  if ($('countOk')) $('countOk').textContent = ok;
}

function getPatientStatusBadge(m, p) {
  if (!m) return '<span class="status-badge bg-muted">لا قراءات</span>';

  const unit = p.glucoseUnit || 'mg/dL';
  const val = Number(m.normalizedValue || m.value);
  const cLow = Number(p.glucose_limits?.critical_low) || (unit === 'mmol/L' ? 3.0 : 54);
  const cHigh = Number(p.glucose_limits?.critical_high) || (unit === 'mmol/L' ? 13.9 : 250);
  const low = Number(p.glucose_limits?.low) || (unit === 'mmol/L' ? 3.9 : 70);
  const high = Number(p.glucose_limits?.high) || (unit === 'mmol/L' ? 10.0 : 180);

  const timeStr = m.time || (m.when?.toDate ? m.when.toDate().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '');
  const timeDisplay = timeStr ? `<small style="display:block; font-size:10px; color:#64748b; font-weight:normal;">${escapeHtml(timeStr)}</small>` : '';

  if (val <= cLow) return `<span class="status-badge bg-danger">هبوط حرج 🚨 (${val})</span>${timeDisplay}`;
  if (val < low) return `<span class="status-badge bg-warn">هبوط (${val})</span>${timeDisplay}`;
  if (val >= cHigh) return `<span class="status-badge bg-danger">ارتفاع حرج 🚨 (${val})</span>${timeDisplay}`;
  if (val > high) return `<span class="status-badge bg-warn">مرتفع (${val})</span>${timeDisplay}`;
  return `<span class="status-badge bg-ok">في النطاق (${val})</span>${timeDisplay}`;
}

function renderPatients() {
  const tbody = $('childrenTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const q = ($('childSearch')?.value || '').toLowerCase().trim();
  let list = patients;

  if (activeFilter === 'crit') list = list.filter(p => p.isCritical);
  else if (activeFilter === 'attention') list = list.filter(p => p.needsAttention);
  else if (activeFilter === 'labs') list = list.filter(p => p.isLabsDue);
  else if (activeFilter === 'ok') list = list.filter(p => p.isOk);

  if (q) {
    list = list.filter(p => {
      const name = (p.name || '').toLowerCase();
      const parent = (p.parentName || '').toLowerCase();
      const note = (p.doctor_note || '').toLowerCase();
      return name.includes(q) || parent.includes(q) || note.includes(q);
    });
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="text-align:center; padding:30px; color:#64748b;">لا يوجد مرضى مطابقين لهذا الفرز حالياً.</td></tr>`;
    return;
  }

  list.forEach(p => {
    const statusHtml = getPatientStatusBadge(p.lastMeasurement, p);

    let tirBadge = '<span class="tiny muted">—</span>';
    if (p.tirPct != null) {
      const tirColor = p.tirPct >= 70 ? 'bg-ok' : (p.tirPct >= 50 ? 'bg-warn' : 'bg-danger');
      tirBadge = `<span class="status-badge ${tirColor}">TIR: ${p.tirPct}%</span>`;
    }

    let labBadge = '<span class="status-badge bg-muted">لا توجد تحاليل</span>';
    if (p.lastLab) {
      const hba = p.lastLab.hba1c?.value;
      if (p.isLabsDue) {
        labBadge = `<span class="status-badge bg-warn" title="متأخر">تراكمي مستحق 🚨</span>`;
      } else {
        labBadge = `<span class="status-badge bg-ok">تراكمي: ${hba ? escapeHtml(hba) + '%' : 'مكتمل ✅'}</span>`;
      }
    } else {
      labBadge = `<span class="status-badge bg-warn">فحص مبدئي مستحق 🔬</span>`;
    }

    const age = p.birthDate ? (new Date().getFullYear() - new Date(p.birthDate).getFullYear()) : '—';
    const regimen = p.regimen === 'pump' ? 'مضخة 📟' : 'حقن MDI 💉';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold; color:var(--primary); font-size:15px;">${escapeHtml(p.name || '—')}</div>
        <small style="color:var(--muted); font-size:11px;">رقم الملف: ${escapeHtml(p.id.slice(0, 8))}</small>
      </td>
      <td>
        <div>${age} سنة • ${p.gender === 'female' ? 'أنثى' : 'ذكر'}</div>
        <span class="badge" style="background:#eef2ff; color:#3b82f6; font-size:11px;">${regimen}</span>
      </td>
      <td>
        <div style="font-weight:bold;">${statusHtml}</div>
      </td>
      <td>
        <div>${tirBadge}</div>
      </td>
      <td>
        <div>${labBadge}</div>
      </td>
      <td style="text-align: center;">
        <div class="actions-cell">
          <a href="doctor-child.html?child=${encodeURIComponent(p.id)}&parentId=${encodeURIComponent(p.parentId)}" class="action-link-btn primary" title="محطة المريض والجرعات والذكاء الاصطناعي">
            🩺 المحطة السريرية
          </a>
          <a href="reports.html?child=${encodeURIComponent(p.id)}&parentId=${encodeURIComponent(p.parentId)}" target="_blank" class="action-link-btn" title="تقرير AGP المعياري">
            📈 التقرير (AGP)
          </a>
          <a href="labs.html?child=${encodeURIComponent(p.id)}&parentId=${encodeURIComponent(p.parentId)}" target="_blank" class="action-link-btn" title="سجل التحاليل المخبرية">
            🔬 التحاليل
          </a>
          <a href="visits.html?child=${encodeURIComponent(p.id)}&parentId=${encodeURIComponent(p.parentId)}" target="_blank" class="action-link-btn" title="الزيارات ومنحنى النمو">
            🩺 الزيارات
          </a>
          <button class="action-link-btn alt btn-open-modal" data-id="${escapeHtml(p.id)}" title="تعديل بروتوكول الجرعات السريع">
            ⚙️ تعديل الجرعات
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.btn-open-modal').forEach(btn => {
    btn.onclick = () => window.openMedicalModal(btn.dataset.id);
  });
}

// --- 4. النافذة الطبية الذكية (Medical Modal) ---
const modal = $('medical-modal');
if ($('modal-close')) $('modal-close').onclick = () => modal?.close();
if ($('btn-cancel')) $('btn-cancel').onclick = () => modal?.close();

if ($('btn-view-workstation')) {
  $('btn-view-workstation').onclick = () => {
    const pId = $('parent-id').value;
    const cId = $('child-id').value;
    if (pId && cId) location.href = `doctor-child.html?child=${encodeURIComponent(cId)}&parentId=${encodeURIComponent(pId)}`;
  };
}

if ($('btn-view-reports')) {
  $('btn-view-reports').onclick = () => {
    const pId = $('parent-id').value;
    const cId = $('child-id').value;
    if (pId && cId) window.open(`reports.html?child=${encodeURIComponent(cId)}&parentId=${encodeURIComponent(pId)}`, '_blank');
  };
}

const INJ_ZONES = ['arm_right', 'arm_left', 'abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'thigh_right', 'thigh_left'];

window.openMedicalModal = (childId) => {
  const p = patients.find(x => x.id === childId);
  if (!p || !modal) return;

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
  INJ_ZONES.forEach(zone => {
    const el = $(`inj_${zone}`);
    if (el) {
      // توحيد القيمة الافتراضية لتكون normal مع دعم القيم المسجلة سابقاً
      const savedVal = map[zone];
      el.value = (savedVal === 'ok' ? 'normal' : savedVal) || 'normal';
    }
  });

  modal.showModal();
};

if ($('medical-form')) {
  $('medical-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('btn-save-medical');
    if (btn) { btn.disabled = true; btn.textContent = 'جاري التحديث والتوثيق...'; }
    const pId = $('parent-id').value;
    const cId = $('child-id').value;

    try {
      const newMap = {};
      INJ_ZONES.forEach(z => {
        if ($(`inj_${z}`)) newMap[z] = $(`inj_${z}`).value || 'normal';
      });

      const targetNum = Number($('targetBg').value) || null;
      const cfNum = Number($('cfVal').value) || null;
      const crObj = {
        breakfast: Number($('crBreakfast').value) || null,
        lunch: Number($('crLunch').value) || null,
        dinner: Number($('crDinner').value) || null,
        snack: Number($('crSnack').value) || null
      };
      const noteStr = $('doctorNote').value.trim();

      const payload = {
        "glucose_limits.target": targetNum,
        cf: cfNum,
        "cr.breakfast": crObj.breakfast,
        "cr.lunch": crObj.lunch,
        "cr.dinner": crObj.dinner,
        "cr.snack": crObj.snack,
        doctor_note: noteStr,
        injection_map: newMap,
        lastMedicalUpdate: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      // 1. تحديث بروتوكول الطفل
      await updateDoc(doc(db, `parents/${pId}/children/${cId}`), payload);

      // 2. توثيق التعديل في سجل التاريخ الطبي للطفل (Audit Trail) بصيغة موحدة مع doctor-child.js
      const docCleanName = currentDoctorData.name || currentDoctorData.displayName || currentUser.displayName || 'الطبيب المعالج';
      try {
        await addDoc(collection(db, `parents/${pId}/children/${cId}/regimen_history`), {
          timestamp: serverTimestamp(),
          dateStr: new Date().toISOString().slice(0, 19).replace('T', ' '),
          doctorId: currentUser.uid,
          doctorName: docCleanName,
          target: targetNum,
          targetBg: targetNum,
          cf: cfNum,
          cr: crObj,
          doctorNote: noteStr
        });
      } catch (auditErr) {
        console.warn("Could not save regimen history record:", auditErr);
      }

      alert("✅ تم حفظ واعتماد البروتوكول وتوثيقه بنجاح! ستظهر التحديثات عند الأسرة فوراً.");
      modal?.close();
      await loadPatients();
    } catch (err) {
      console.error(err);
      alert("❌ حدث خطأ أثناء الحفظ. يرجى مراجعة الاتصال.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 اعتماد وتحديث البروتوكول'; }
    }
  };
}

function setupEvents() {
  if ($('btnLogout')) {
    $('btnLogout').onclick = async () => { await signOut(auth); location.href = "index.html"; };
  }
  if ($('btnRefresh')) {
    $('btnRefresh').onclick = async () => { await Promise.all([loadCodes(), loadPatients()]); };
  }
  if ($('childSearch')) {
    $('childSearch').addEventListener('input', () => renderPatients());
  }

  document.querySelectorAll('.triage-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.triage-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderPatients();
    };
  });
}
