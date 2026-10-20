// js/doctor-dashboard.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, collectionGroup, getDocs, doc, getDoc, updateDoc, setDoc, addDoc, query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let patients = [];
let activeFilter = 'all';

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

// --- 2. إدارة أكواد الربط ---
async function loadCodes() {
  const list = $('codesList');
  list.innerHTML = '<div class="empty">جاري التحميل...</div>';
  try {
    const q = query(collection(db, "linkCodes"), where("doctorId", "==", currentUser.uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    
    if (snap.empty) { list.innerHTML = '<div class="empty">لا توجد أكواد نشطة. أنشئ كوداً جديداً لمشاركته مع الأسرة.</div>'; return; }
    
    let html = '';
    snap.forEach(d => {
      const c = d.data();
      const dateStr = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('ar-EG') : 'حديث';
      html += `
        <div class="code-row">
          <div class="code-val">${d.id}</div>
          <div class="code-meta">
            ${c.used ? `<span style="color:var(--danger)">مستخدم ❌</span>` : `<span style="color:var(--good); font-weight:bold;">متاح للاستخدام ✅</span>`}
            <br><small style="color:var(--muted)">تاريخ الإنشاء: ${dateStr}</small>
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

// --- 3. جلب بيانات الأطفال والمرضى المتابعين بدقة وأمان ---
async function loadPatients() {
  showLoader(true);
  const tbody = $('childrenTbody');
  try {
    patients = [];
    const docsMap = new Map();

    // استعلام 1: الأطفال المسندين عبر حقل assignedDoctor المباشر
    try {
      const q1 = query(collectionGroup(db, "children"), where("assignedDoctor", "==", currentUser.uid));
      const snap1 = await getDocs(q1);
      snap1.forEach(d => docsMap.set(d.id, d));
    } catch(e) {
      console.warn("assignedDoctor query notice:", e);
    }

    // استعلام 2: الأطفال المسندين عبر كائن assignedDoctorInfo.uid لضمان عدم سقوط أي طفل مسند
    try {
      const q2 = query(collectionGroup(db, "children"), where("assignedDoctorInfo.uid", "==", currentUser.uid));
      const snap2 = await getDocs(q2);
      snap2.forEach(d => docsMap.set(d.id, d));
    } catch(e) {
      console.warn("assignedDoctorInfo.uid query notice:", e);
    }

    // استعلام 3: فحص مجموعة فرعية للأطباء doctors/{uid}/patients كخيار احتياطي
    try {
      const docPatientsSnap = await getDocs(collection(db, `doctors/${currentUser.uid}/patients`));
      for (const dp of docPatientsSnap.docs) {
        const dpData = dp.data();
        if (dpData.childId && dpData.parentId && !docsMap.has(dpData.childId)) {
          const cDoc = await getDoc(doc(db, `parents/${dpData.parentId}/children/${dpData.childId}`));
          if (cDoc.exists()) docsMap.set(cDoc.id, cDoc);
        }
      }
    } catch(e) {
      // ignore
    }

    // معالجة كل طفل وجلب قياساته وتحاليله الأخيرة
    for (const [id, d] of docsMap.entries()) {
      const data = d.data();
      const parentId = data.parentId || (d.ref.parent?.parent ? d.ref.parent.parent.id : null);
      if (!parentId) continue;

      const p = { id: d.id, parentId, ...data };

      // 1. جلب آخر قياس جلوكوز مسجل
      try {
        const mSnap = await getDocs(query(
          collection(db, `parents/${p.parentId}/children/${p.id}/measurements`),
          orderBy('when', 'desc'),
          limit(1)
        ));
        if (!mSnap.empty) {
          p.lastMeasurement = mSnap.docs[0].data();
        } else {
          const mSnap2 = await getDocs(query(
            collection(db, `parents/${p.parentId}/children/${p.id}/measurements`),
            orderBy('date', 'desc'),
            limit(1)
          ));
          if (!mSnap2.empty) p.lastMeasurement = mSnap2.docs[0].data();
        }
      } catch(err) {
        console.warn(`Last measurement fetch error for ${p.id}:`, err);
      }

      // 2. جلب آخر تحليل سكر تراكمي لمعرفة الاستحقاق
      try {
        const lSnap = await getDocs(query(
          collection(db, `parents/${p.parentId}/children/${p.id}/labs`),
          orderBy('when', 'desc'),
          limit(1)
        ));
        if (!lSnap.empty) {
          p.lastLab = lSnap.docs[0].data();
        }
      } catch(err) {
        console.warn(`Last lab fetch error for ${p.id}:`, err);
      }

      // 3. جلب قياسات آخر أسبوع لحساب الـ TIR التقديري
      try {
        const d7 = new Date(); d7.setDate(d7.getDate() - 7);
        const d7Str = d7.toISOString().slice(0, 10);
        const wSnap = await getDocs(query(
          collection(db, `parents/${p.parentId}/children/${p.id}/measurements`),
          where('date', '>=', d7Str)
        ));
        p.weekReadings = [];
        wSnap.forEach(ws => {
          const wd = ws.data();
          const val = Number(wd.value_mgdl ?? wd.value ?? 0);
          if (val > 0) p.weekReadings.push(val);
        });
      } catch(err) {
        p.weekReadings = [];
      }

      // تصنيف المريض سريرياً (Triage State)
      p.triage = evaluatePatientTriage(p);
      patients.push(p);
    }

    updateTriageCounts();
    renderPatients();

  } catch(e) { 
    console.error(e); 
    tbody.innerHTML = `<tr><td colspan="6" class="empty">حدث خطأ في جلب بيانات المرضى. الرجاء المحاولة مرة أخرى.</td></tr>`;
  }
  showLoader(false);
}

// تقييم وتصنيف حالة المريض السريرية
function evaluatePatientTriage(p) {
  const m = p.lastMeasurement;
  const unit = p.glucoseUnit || 'mg/dL';
  const cLow = unit === 'mmol/L' ? 3.0 : 54;
  const cHigh = unit === 'mmol/L' ? 13.9 : 250;
  const low = unit === 'mmol/L' ? 3.9 : 70;
  const high = unit === 'mmol/L' ? 10.0 : 180;

  let isCritical = false;
  let needsAttention = false;
  let isLabsDue = false;

  // فحص آخر قراءة
  if (m) {
    const val = Number(m.normalizedValue || m.value);
    if (val <= cLow || val >= cHigh) isCritical = true;
    else if (val < low || val > high) needsAttention = true;
  }

  // فحص قراءات الأسبوع والـ TIR
  if (p.weekReadings && p.weekReadings.length >= 3) {
    const inRange = p.weekReadings.filter(v => v >= 70 && v <= 180).length;
    const tir = Math.round((inRange / p.weekReadings.length) * 100);
    p.tirPct = tir;
    if (tir < 60) needsAttention = true;
  }

  // فحص استحقاق التحاليل (التراكمي كل 90 يوم)
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

  $('totalPatients').textContent = total;
  $('criticalPatients').textContent = crit;
  $('attentionPatients').textContent = att;
  $('dueLabsPatients').textContent = labs;
  $('childrenCount').textContent = `${total} مريض`;

  $('countAll').textContent = total;
  $('countCrit').textContent = crit;
  $('countAtt').textContent = att;
  $('countLabs').textContent = labs;
  $('countOk').textContent = ok;
}

function getPatientStatusBadge(m, p) {
  if(!m) return '<span class="status-badge bg-muted">لا قراءات</span>';
  
  const unit = p.glucoseUnit || 'mg/dL';
  const val = Number(m.normalizedValue || m.value);
  const cLow = unit === 'mmol/L' ? 3.0 : 54;
  const cHigh = unit === 'mmol/L' ? 13.9 : 250;
  const low = unit === 'mmol/L' ? 3.9 : 70;
  const high = unit === 'mmol/L' ? 10.0 : 180;

  const timeStr = m.time || (m.when?.toDate ? m.when.toDate().toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}) : '');
  const timeDisplay = timeStr ? `<small style="display:block; font-size:10px; color:#64748b; font-weight:normal;">${timeStr}</small>` : '';

  if (val <= cLow) return `<span class="status-badge bg-danger">هبوط حرج 🚨 (${val})</span>${timeDisplay}`;
  if (val < low) return `<span class="status-badge bg-warn">هبوط (${val})</span>${timeDisplay}`;
  if (val >= cHigh) return `<span class="status-badge bg-danger">ارتفاع حرج 🚨 (${val})</span>${timeDisplay}`;
  if (val > high) return `<span class="status-badge bg-warn">مرتفع (${val})</span>${timeDisplay}`;
  return `<span class="status-badge bg-ok">في النطاق (${val})</span>${timeDisplay}`;
}

function renderPatients() {
  const tbody = $('childrenTbody');
  tbody.innerHTML = '';

  const q = $('childSearch').value.toLowerCase().trim();

  let list = patients;

  // تطبيق فلتر الفرز السريري (Triage)
  if (activeFilter === 'crit') list = list.filter(p => p.isCritical);
  else if (activeFilter === 'attention') list = list.filter(p => p.needsAttention);
  else if (activeFilter === 'labs') list = list.filter(p => p.isLabsDue);
  else if (activeFilter === 'ok') list = list.filter(p => p.isOk);

  // تطبيق البحث
  if (q) {
    list = list.filter(p => {
      const name = (p.name || '').toLowerCase();
      const parent = (p.parentName || '').toLowerCase();
      const note = (p.doctor_note || '').toLowerCase();
      return name.includes(q) || parent.includes(q) || note.includes(q);
    });
  }

  if(!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty" style="text-align:center; padding:30px; color:#64748b;">لا يوجد مرضى مطابقين لهذا الفرز حالياً.</td></tr>`;
    return;
  }

  list.forEach(p => {
    const statusHtml = getPatientStatusBadge(p.lastMeasurement, p);
    
    // شارة TIR للأسبوع
    let tirBadge = '<span class="tiny muted">—</span>';
    if (p.tirPct != null) {
      const tirColor = p.tirPct >= 70 ? 'bg-ok' : (p.tirPct >= 50 ? 'bg-warn' : 'bg-danger');
      tirBadge = `<span class="status-badge ${tirColor}">TIR: ${p.tirPct}%</span>`;
    }

    // شارة التحاليل
    let labBadge = '<span class="status-badge bg-muted">لا توجد تحاليل</span>';
    if (p.lastLab) {
      const hba = p.lastLab.hba1c?.value;
      if (p.isLabsDue) {
        labBadge = `<span class="status-badge bg-warn" title="متأخر">تراكمي مستحق 🚨</span>`;
      } else {
        labBadge = `<span class="status-badge bg-ok">تراكمي: ${hba ? hba+'%' : 'مكتمل ✅'}</span>`;
      }
    } else {
      labBadge = `<span class="status-badge bg-warn">فحص مبدئي مستحق 🔬</span>`;
    }

    const age = p.birthDate ? (new Date().getFullYear() - new Date(p.birthDate).getFullYear()) : '—';
    const regimen = p.regimen === 'pump' ? 'مضخة 📟' : 'حقن MDI 💉';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="font-weight:bold; color:var(--primary); font-size:15px;">${p.name || '—'}</div>
        <small style="color:var(--muted); font-size:11px;">رقم الملف: ${p.id.slice(0,8)}</small>
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
          <a href="doctor-child.html?child=${p.id}&parentId=${p.parentId}" class="action-link-btn primary" title="محطة المريض والجرعات والذكاء الاصطناعي">
            🩺 المحطة السريرية
          </a>
          <a href="reports.html?child=${p.id}&parentId=${p.parentId}" target="_blank" class="action-link-btn" title="تقرير AGP المعياري">
            📈 التقرير (AGP)
          </a>
          <a href="labs.html?child=${p.id}&parentId=${p.parentId}" target="_blank" class="action-link-btn" title="سجل التحاليل المخبرية">
            🔬 التحاليل
          </a>
          <a href="visits.html?child=${p.id}&parentId=${p.parentId}" target="_blank" class="action-link-btn" title="الزيارات ومنحنى النمو">
            🩺 الزيارات
          </a>
          <button class="action-link-btn alt btn-open-modal" data-id="${p.id}" title="تعديل بروتوكول الجرعات السريع">
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
$('modal-close').onclick = () => modal.close();
$('btn-cancel').onclick = () => modal.close();

$('btn-view-workstation').onclick = () => {
  const pId = $('parent-id').value;
  const cId = $('child-id').value;
  if(pId && cId) location.href = `doctor-child.html?child=${cId}&parentId=${pId}`;
};

$('btn-view-reports').onclick = () => {
  const pId = $('parent-id').value;
  const cId = $('child-id').value;
  if(pId && cId) window.open(`reports.html?child=${cId}&parentId=${pId}`, '_blank');
};

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
  const btn = $('btn-save-medical'); btn.disabled = true; btn.textContent = 'جاري التحديث والتوثيق...';
  const pId = $('parent-id').value; const cId = $('child-id').value;

  try {
    const newMap = {};
    ['arm_right', 'arm_left', 'abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'thigh_right', 'thigh_left'].forEach(z => newMap[z] = $(`inj_${z}`).value);

    const payload = {
      "glucose_limits.target": Number($('targetBg').value),
      cf: Number($('cfVal').value),
      "cr.breakfast": Number($('crBreakfast').value),
      "cr.lunch": Number($('crLunch').value),
      "cr.dinner": Number($('crDinner').value),
      "cr.snack": Number($('crSnack').value),
      doctor_note: $('doctorNote').value.trim(),
      injection_map: newMap,
      lastMedicalUpdate: serverTimestamp()
    };

    // 1. تحديث بروتوكول الطفل
    await updateDoc(doc(db, `parents/${pId}/children/${cId}`), payload);

    // 2. توثيق التعديل في سجل التاريخ الطبي للطفل (Audit Trail)
    try {
      await addDoc(collection(db, `parents/${pId}/children/${cId}/regimen_history`), {
        timestamp: serverTimestamp(),
        doctorId: currentUser.uid,
        doctorName: $('doctorName').textContent,
        targetBg: Number($('targetBg').value),
        cf: Number($('cfVal').value),
        cr: {
          breakfast: Number($('crBreakfast').value),
          lunch: Number($('crLunch').value),
          dinner: Number($('crDinner').value),
          snack: Number($('crSnack').value)
        },
        doctorNote: $('doctorNote').value.trim()
      });
    } catch(auditErr) {
      console.warn("Could not save regimen history record:", auditErr);
    }
    
    alert("✅ تم حفظ واعتماد البروتوكول وتوثيقه بنجاح! ستظهر التحديثات عند الأسرة فوراً.");
    modal.close();
    await loadPatients();
  } catch (err) { 
    console.error(err);
    alert("❌ حدث خطأ أثناء الحفظ. يرجى مراجعة الاتصال."); 
  } 
  finally { btn.disabled = false; btn.textContent = '💾 اعتماد وتحديث البروتوكول'; }
};

function setupEvents() {
  $('btnLogout').onclick = async () => { await signOut(auth); location.href = "index.html"; };
  $('btnRefresh').onclick = async () => { await loadCodes(); await loadPatients(); };
  
  $('childSearch').addEventListener('input', () => {
    renderPatients();
  });

  // فلاتر الفرز السريري (Triage Buttons)
  document.querySelectorAll('.triage-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.triage-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderPatients();
    };
  });
}
