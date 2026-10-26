// js/visits.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, updateDoc, serverTimestamp, where, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const setText = (el, v) => { if (el) el.textContent = (v == null || v === '') ? '—' : v; };

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function calcAge(bd) {
  if (!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return Math.max(0, a);
}

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId') || localStorage.getItem('lastChildId');
const parentIdParam = params.get('parentId');

let currentUser, childData = {};
let activeParentId = null;
let isDoctorMode = false;
let currentDoctorName = '';
let editingId = null;
let existingAttachments = [], attachmentsToDelete = [], selectedFiles = [], allVisits = [], filteredVisits = [];
let growthChart = null;

const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function dateAdd(s, days) { const d = new Date(s || new Date()); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function showLoader(v) { const el = $('appLoader'); if (el) el.style.display = v ? 'flex' : 'none'; }

const numOrNull = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const strOrNull = v => (v && String(v).trim() !== '') ? String(v).trim() : null;

function wireBmiCalc() {
  const calc = () => {
    const w = Number($('weight')?.value);
    const h = Number($('height')?.value);
    if (w > 0 && h > 0) {
      const hm = h / 100;
      const bmi = w / (hm * hm);
      if ($('bmi')) $('bmi').value = bmi.toFixed(1);
    } else {
      if ($('bmi')) $('bmi').value = '';
    }
  };
  $('weight')?.addEventListener('input', calc);
  $('height')?.addEventListener('input', calc);
}

function adaptHeaderForRole(isDoc, parentId) {
  const safeChild = encodeURIComponent(childId);
  const safeParent = encodeURIComponent(parentId);
  const qParams = `?child=${safeChild}${isDoc ? `&parentId=${safeParent}` : ''}`;
  const workstationUrl = `doctor-child.html?child=${safeChild}&parentId=${safeParent}`;

  $('navReports')?.setAttribute('href', `reports.html${qParams}`);
  $('navLabs')?.setAttribute('href', `labs.html${qParams}`);

  const backBtn = $('backBtn');

  if (isDoc) {
    $('navHome')?.classList.add('hidden');
    $('navMeas')?.classList.add('hidden');
    $('navMeals')?.classList.add('hidden');

    const navBar = document.querySelector('.topbar-nav');
    if (navBar && !$('navWorkstation')) {
      const wsLink = document.createElement('a');
      wsLink.id = 'navWorkstation';
      wsLink.className = 'nav-pill';
      wsLink.style.cssText = 'background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;';
      wsLink.href = workstationUrl;
      wsLink.innerHTML = '🩺 المحطة السريرية';
      navBar.insertBefore(wsLink, navBar.firstChild);
    } else if ($('navWorkstation')) {
      $('navWorkstation').href = workstationUrl;
      $('navWorkstation').classList.remove('hidden');
    }

    const breadContainer = document.querySelector('.breadcrumbs');
    if (breadContainer) {
      const firstLink = breadContainer.querySelector('a');
      if (firstLink) {
        firstLink.textContent = 'بوابة الأطباء 🩺';
        firstLink.href = 'doctor-dashboard.html';
      }
    }
    $('breadChildName')?.setAttribute('href', workstationUrl);

    if (backBtn) {
      backBtn.textContent = '🩺 المحطة السريرية';
      backBtn.onclick = () => location.href = workstationUrl;
    }
  } else {
    $('navHome')?.classList.remove('hidden');
    $('navMeas')?.classList.remove('hidden');
    $('navMeals')?.classList.remove('hidden');
    $('navHome')?.setAttribute('href', `child.html${qParams}`);
    $('navMeas')?.setAttribute('href', `measurements.html${qParams}`);
    $('navMeals')?.setAttribute('href', `meals.html${qParams}`);
    $('breadChildName')?.setAttribute('href', `child.html${qParams}`);

    if (backBtn) {
      backBtn.textContent = '🏠 رجوع للوحة الطفل';
      backBtn.onclick = () => location.href = `child.html?child=${safeChild}`;
    }
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = 'index.html'; return; }
  currentUser = user;

  showLoader(true);
  try {
    activeParentId = parentIdParam || localStorage.getItem('selectedParentId') || user.uid;
    isDoctorMode = Boolean(parentIdParam && parentIdParam !== user.uid);

    $('logoutBtn')?.addEventListener('click', () => signOut(auth).then(() => location.href = 'index.html').catch(() => {}));

    let snap = await getDoc(doc(db, `parents/${activeParentId}/children/${childId}`));
    if (!snap.exists() && activeParentId !== user.uid) {
      const fallbackSnap = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
      if (fallbackSnap.exists()) {
        snap = fallbackSnap;
        activeParentId = user.uid;
        isDoctorMode = false;
        localStorage.setItem('selectedParentId', user.uid);
      }
    }

    if (snap.exists()) childData = snap.data();
    else childData = {};

    if (isDoctorMode) {
      try {
        const docSnap = await getDoc(doc(db, 'users', user.uid));
        if (docSnap.exists()) {
          currentDoctorName = docSnap.data().name || docSnap.data().displayName || user.displayName || '';
        }
      } catch (e) {}
      if (!currentDoctorName) {
        currentDoctorName = childData.assignedDoctorInfo?.name || user.displayName || '';
      }
    }

    const childName = childData.name || 'الطفل';
    setText($('topChildName'), childName);
    setText($('breadChildName'), childName);
    if ($('topAvatar')) $('topAvatar').textContent = childName.trim().charAt(0) || 'أ';

    const age = calcAge(childData.birthDate);
    const genderStr = childData.gender === 'female' ? 'أنثى' : (childData.gender === 'male' ? 'ذكر' : '');
    const regimenStr = childData.regimen === 'pump' ? 'مضخة إنسولين' : 'حقن يومية (MDI)';
    const metaParts = [];
    if (age !== '-') metaParts.push(`العمر: ${age} سنة`);
    if (genderStr) metaParts.push(genderStr);
    if (regimenStr) metaParts.push(regimenStr);
    setText($('topChildMeta'), metaParts.join(' • ') || '—');

    adaptHeaderForRole(isDoctorMode, activeParentId);

    if ($('fromDate')) $('fromDate').value = '';
    if ($('toDate')) $('toDate').value = '';

    wireBmiCalc();

    await Promise.all([
      loadVisits(),
      buildAISuggestions()
    ]);

    ['filterType', 'filterApplied', 'searchBox', 'fromDate', 'toDate'].forEach(id => {
      $(id)?.addEventListener('input', renderVisits);
    });

    if ($('newVisitBtn')) $('newVisitBtn').onclick = () => openModal();
    if ($('closeModal')) $('closeModal').onclick = () => $('visitModal').classList.add('hidden');
    if ($('cancelVisitBtn')) $('cancelVisitBtn').onclick = () => $('visitModal').classList.add('hidden');
    if ($('copyAgenda')) $('copyAgenda').onclick = copyAgendaToClipboard;
    if ($('exportCSV')) $('exportCSV').onclick = exportCSV;
    if ($('printList')) $('printList').onclick = () => window.print();

    if ($('attachments')) {
      $('attachments').onchange = (e) => { selectedFiles = Array.from(e.target.files); renderSelectedFiles(); };
    }
    if ($('visitForm')) {
      $('visitForm').onsubmit = handleSaveVisit;
    }

  } catch (e) { console.error(e); }
  finally { showLoader(false); }
});

async function loadVisits() {
  const qy = query(collection(db, `parents/${activeParentId}/children/${childId}/visits`), orderBy('date', 'desc'));
  const snap = await getDocs(qy);
  allVisits = [];

  snap.forEach(d => {
    const v = d.data();
    const rawLabs = v.labsRequested;
    v.labsRequested = Array.isArray(rawLabs)
      ? rawLabs.filter(Boolean)
      : (rawLabs ? String(rawLabs).split(',').map(s => s.trim()).filter(Boolean) : []);
    v.labsCompleted = Array.isArray(v.labsCompleted) ? v.labsCompleted : [];
    allVisits.push({ id: d.id, ...v });
  });

  const today = todayStr();
  const future = allVisits.filter(r => r.followUpDate && r.followUpDate >= today).map(r => r.followUpDate).sort();

  if ($('lastVisit')) $('lastVisit').textContent = allVisits.length ? allVisits[0].date : '—';
  if ($('nextFollowUp')) $('nextFollowUp').textContent = future.length ? future[0] : '—';
  if ($('pendingCount')) $('pendingCount').textContent = allVisits.filter(r => String(r.applied) !== 'true').length;

  renderGrowthChart(allVisits);
  renderVisits();
}

function renderGrowthChart(visits) {
  const canvas = $('growthCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const growthData = [];
  visits.forEach(v => {
    if (v.weight != null || v.height != null || v.bmi != null) {
      growthData.push({
        date: v.date,
        weight: numOrNull(v.weight),
        height: numOrNull(v.height),
        bmi: numOrNull(v.bmi),
        bp: v.bloodPressure || ''
      });
    }
  });

  if (!growthData.length && (childData.weight || childData.vitals?.weight)) {
    growthData.push({
      date: todayStr(),
      weight: numOrNull(childData.weight || childData.vitals?.weight),
      height: numOrNull(childData.height || childData.vitals?.height),
      bmi: null,
      bp: ''
    });
  }

  growthData.sort((a, b) => new Date(a.date) - new Date(b.date));

  const badgesBox = $('latestGrowthBadges');
  if (badgesBox) {
    if (growthData.length) {
      const last = growthData[growthData.length - 1];
      badgesBox.innerHTML = `
        ${last.weight ? `<span class="growth-badge">⚖️ الوزن: <b>${escapeHtml(last.weight)} kg</b></span>` : ''}
        ${last.height ? `<span class="growth-badge">📏 الطول: <b>${escapeHtml(last.height)} cm</b></span>` : ''}
        ${last.bmi ? `<span class="growth-badge">📊 BMI: <b>${escapeHtml(last.bmi)}</b></span>` : ''}
        ${last.bp ? `<span class="growth-badge">💓 الضغط: <b>${escapeHtml(last.bp)}</b></span>` : ''}
      `;
    } else {
      badgesBox.innerHTML = `<span class="tiny-text" style="color:#64748b;">لا توجد قياسات نمو مسجلة بعد</span>`;
    }
  }

  if (growthChart) {
    growthChart.destroy();
    growthChart = null;
  }

  if (!growthData.length) {
    growthChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'سجل الوزن والطول في الزيارات لتفعيل منحنى النمو السريري' }
        }
      }
    });
    return;
  }

  const labels = growthData.map(d => d.date);

  growthChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'الوزن (kg)',
          data: growthData.map(d => d.weight),
          borderColor: '#2563eb',
          backgroundColor: '#2563eb',
          yAxisID: 'yWeight',
          tension: 0.2,
          pointRadius: 5,
          spanGaps: true
        },
        {
          label: 'الطول (cm)',
          data: growthData.map(d => d.height),
          borderColor: '#16a34a',
          backgroundColor: '#16a34a',
          borderDash: [4, 4],
          yAxisID: 'yHeight',
          tension: 0.2,
          pointRadius: 5,
          spanGaps: true
        },
        {
          label: 'مؤشر الكتلة (BMI)',
          data: growthData.map(d => d.bmi),
          borderColor: '#7c3aed',
          backgroundColor: '#7c3aed',
          yAxisID: 'yWeight',
          borderDash: [2, 2],
          tension: 0.2,
          pointRadius: 4,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        yWeight: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'الوزن (kg) / BMI', font: { size: 11, weight: 'bold' } },
          grid: { color: '#f1f5f9' }
        },
        yHeight: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'الطول (cm)', font: { size: 11, weight: 'bold' } },
          grid: { display: false }
        },
        x: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11 } }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          rtl: true,
          callbacks: {
            afterBody: (context) => {
              const idx = context[0].dataIndex;
              const bp = growthData[idx]?.bp;
              return bp ? `ضغط الدم: ${bp}` : '';
            }
          }
        }
      }
    }
  });
}

function renderVisits() {
  const list = $('visitsList');
  if (!list) return;
  list.innerHTML = '';

  const t = $('filterType')?.value || '';
  const a = $('filterApplied')?.value || '';
  const q = ($('searchBox')?.value || '').toLowerCase().trim();
  const s = $('fromDate')?.value || '';
  const e = $('toDate')?.value || '';

  filteredVisits = allVisits.filter(r => {
    const matchType = !t || r.type === t;
    const matchApp = !a || String(r.applied) === a;
    const matchDate = (!s || r.date >= s) && (!e || r.date <= e);
    const matchSearch = !q || `${r.doctorName || ''} ${r.reason || ''} ${r.summary || ''} ${r.recommendations || ''}`.toLowerCase().includes(q);
    return matchType && matchApp && matchDate && matchSearch;
  });

  if (!filteredVisits.length) {
    list.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">لا توجد زيارات مطابقة للبحث.</div>`;
    return;
  }

  filteredVisits.forEach(r => {
    const card = document.createElement('div');
    card.className = 'visit-card';

    const isApplied = String(r.applied) === 'true';
    const typeCls = r.type === 'متابعة دورية' ? 'dori' : r.type === 'طارئة' ? 'tari2' : '';

    let vitalsHtml = '';
    if (r.weight || r.height || r.bmi || r.bloodPressure) {
      vitalsHtml = `
        <div class="vc-vitals">
          ${r.weight ? `<span>⚖️ الوزن: <b>${escapeHtml(r.weight)} kg</b></span>` : ''}
          ${r.height ? `<span>📏 الطول: <b>${escapeHtml(r.height)} cm</b></span>` : ''}
          ${r.bmi ? `<span>📊 BMI: <b>${escapeHtml(r.bmi)}</b></span>` : ''}
          ${r.bloodPressure ? `<span>💓 الضغط: <b>${escapeHtml(r.bloodPressure)}</b></span>` : ''}
        </div>
      `;
    }

    let labsHtml = '';
    if (r.labsRequested && r.labsRequested.length) {
      labsHtml = `<div class="vc-box"><h4>🧪 فحوصات مطلوبة</h4><div class="vc-labs">` +
        r.labsRequested.map(lab => `<span class="lab-chip ${r.labsCompleted.includes(lab) ? 'done' : ''}" data-id="${escapeHtml(r.id)}" data-lab="${escapeHtml(lab)}">${escapeHtml(lab)}</span>`).join('') +
        `</div></div>`;
    }

    let dosesHtml = '';
    if (r.longActingChange || r.mealDosesChange) {
      dosesHtml = `<div class="vc-box" style="border-color:#f59e0b; background:#fffbeb;"><h4>💉 تعديلات الجرعات</h4>
        ${r.longActingChange ? `<div><b>القاعدي:</b> ${escapeHtml(r.longActingChange)}</div>` : ''}
        ${r.mealDosesChange ? `<div><b>الوجبات:</b> ${escapeHtml(r.mealDosesChange)}</div>` : ''}
      </div>`;
    }

    card.innerHTML = `
      <div class="vc-header">
        <div class="vc-title">👨‍⚕️ ${escapeHtml(r.doctorName || 'طبيب')} <span class="vc-type ${typeCls}">${escapeHtml(r.type || '')}</span></div>
        <div class="vc-date">${escapeHtml(r.date)} ${r.time ? `(${escapeHtml(r.time)})` : ''}</div>
      </div>
      <div class="vc-body">
        ${vitalsHtml}
        ${r.reason ? `<div class="vc-reason"><b>السبب:</b> ${escapeHtml(r.reason)}</div>` : ''}
        ${r.summary ? `<div class="vc-box"><h4>📝 خلاصة الزيارة</h4><div>${escapeHtml(r.summary)}</div></div>` : ''}
        ${r.recommendations ? `<div class="vc-box" style="border-color:#10b981; background:#ecfdf5;"><h4>💡 توصيات الطبيب</h4><div>${escapeHtml(r.recommendations)}</div></div>` : ''}
        ${dosesHtml}
        ${labsHtml}
      </div>
      <div class="vc-footer">
        <button class="status-btn ${isApplied ? 'applied' : 'pending'}" data-toggle="${escapeHtml(r.id)}">
          ${isApplied ? '✅ تم التطبيق' : '⏳ بانتظار التطبيق'}
        </button>
        <div class="vc-actions">
          ${r.attachments?.length ? `<span style="font-size:12px; color:#64748b; margin-left:10px;">📎 ${r.attachments.length} ملف</span>` : ''}
          <button class="btn small secondary act-edit">تعديل</button>
          <button class="btn small ghost act-del" style="color:#dc2626; border-color:#fecaca;">حذف</button>
        </div>
      </div>
    `;

    card.querySelector('[data-toggle]').onclick = () => toggleApplied(r);
    card.querySelector('.act-edit').onclick = () => openModal(r);
    card.querySelector('.act-del').onclick = () => deleteVisit(r.id);

    card.querySelectorAll('.lab-chip').forEach(chip => {
      chip.onclick = async () => {
        const labName = chip.getAttribute('data-lab');
        await toggleLabDone(r, labName, chip);
      };
    });

    list.appendChild(card);
  });
}

async function toggleApplied(v) {
  const newVal = String(v.applied) !== 'true';
  await updateDoc(doc(db, `parents/${activeParentId}/children/${childId}/visits`, v.id), { applied: newVal });
  loadVisits();
}

async function toggleLabDone(v, labName, chipEl) {
  const done = new Set(v.labsCompleted);
  if (done.has(labName)) {
    done.delete(labName);
  } else {
    done.add(labName);
    const qParams = `?child=${encodeURIComponent(childId)}${isDoctorMode ? `&parentId=${encodeURIComponent(activeParentId)}` : ''}`;
    if (confirm(`تم تحديد "${labName}" كمكتمل. هل تريد الانتقال لصفحة التحاليل لتسجيل النتيجة؟`)) {
      window.location.href = `labs.html${qParams}`;
    }
  }
  await updateDoc(doc(db, `parents/${activeParentId}/children/${childId}/visits`, v.id), { labsCompleted: Array.from(done) });
  chipEl.classList.toggle('done');
}

async function deleteVisit(id) {
  if (!confirm('هل أنت متأكد من حذف الزيارة نهائياً؟')) return;
  await deleteDoc(doc(db, `parents/${activeParentId}/children/${childId}/visits`, id));
  loadVisits();
}

function openModal(v = null) {
  editingId = v ? v.id : null;
  $('visitForm')?.reset();
  selectedFiles = []; attachmentsToDelete = []; existingAttachments = [];

  if (v) {
    if ($('modalTitle')) $('modalTitle').textContent = 'تعديل زيارة';
    ['date','time','type','doctorName','reason','summary','recommendations','longActingChange','mealDosesChange','followUpDate','weight','height','bmi','bloodPressure'].forEach(k => {
      if ($(k)) $(k).value = v[k] ?? '';
    });
    if ($('labsRequested')) $('labsRequested').value = v.labsRequested ? v.labsRequested.join(', ') : '';
    if ($('applied')) $('applied').value = String(v.applied);
    existingAttachments = v.attachments || [];
  } else {
    if ($('modalTitle')) $('modalTitle').textContent = 'إضافة زيارة طبية';
    if ($('date')) $('date').value = todayStr();
    if ($('doctorName') && isDoctorMode && currentDoctorName) {
      $('doctorName').value = currentDoctorName;
    } else if ($('doctorName') && childData.assignedDoctorInfo?.name) {
      $('doctorName').value = childData.assignedDoctorInfo.name;
    }
  }

  renderSelectedFiles();
  renderExisting();
  $('visitModal')?.classList.remove('hidden');
}

function renderSelectedFiles() {
  const w = $('selectedFiles');
  if (!w) return;
  w.innerHTML = '';
  selectedFiles.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `<span>${escapeHtml(f.name)}</span> <button type="button" data-i="${i}">✕</button>`;
    div.querySelector('button').onclick = () => { selectedFiles.splice(i, 1); renderSelectedFiles(); };
    w.appendChild(div);
  });
}

function renderExisting() {
  const w = $('existingFiles');
  if (!w) return;
  w.innerHTML = '';
  $('existingWrap')?.classList.toggle('hidden', !existingAttachments.length);
  existingAttachments.forEach((f, i) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `<a href="${escapeHtml(f.url)}" target="_blank">📄 ${escapeHtml(f.name)}</a> <button type="button" data-i="${i}">✕</button>`;
    div.querySelector('button').onclick = () => { attachmentsToDelete.push(f.path); existingAttachments.splice(i, 1); renderExisting(); };
    w.appendChild(div);
  });
}

async function handleSaveVisit(e) {
  e.preventDefault();
  showLoader(true);

  const wVal = numOrNull($('weight')?.value);
  const hVal = numOrNull($('height')?.value);
  const bmiVal = numOrNull($('bmi')?.value);

  const payload = {
    date: $('date').value,
    time: $('time').value,
    type: $('type').value,
    doctorName: $('doctorName').value,
    reason: $('reason').value,
    summary: $('summary').value,
    recommendations: $('recommendations').value,
    longActingChange: $('longActingChange').value,
    mealDosesChange: $('mealDosesChange').value,
    labsRequested: $('labsRequested').value.split(',').map(s => s.trim()).filter(Boolean),
    followUpDate: $('followUpDate').value,
    applied: $('applied').value === 'true',
    weight: wVal,
    height: hVal,
    bmi: bmiVal,
    bloodPressure: strOrNull($('bloodPressure')?.value),
    updatedAt: serverTimestamp()
  };

  try {
    const colRef = collection(db, `parents/${activeParentId}/children/${childId}/visits`);
    let vId = editingId;
    if (!vId) {
      payload.createdAt = serverTimestamp();
      const added = await addDoc(colRef, payload);
      vId = added.id;
    } else {
      await updateDoc(doc(colRef, vId), payload);
    }

    if (wVal || hVal) {
      const childUpdates = { updatedAt: serverTimestamp() };
      if (wVal) { childUpdates.weight = wVal; childUpdates['vitals.weight'] = wVal; childData.weight = wVal; }
      if (hVal) { childUpdates.height = hVal; childUpdates['vitals.height'] = hVal; childData.height = hVal; }
      await updateDoc(doc(db, `parents/${activeParentId}/children/${childId}`), childUpdates).catch(() => {});
    }

    const storage = getStorage();
    const uploaded = [];
    for (const f of selectedFiles) {
      const p = `parents/${activeParentId}/children/${childId}/visits/${vId}/${Date.now()}_${f.name}`;
      const r = sRef(storage, p);
      await uploadBytes(r, f);
      uploaded.push({ name: f.name, url: await getDownloadURL(r), path: p });
    }
    for (const p of attachmentsToDelete) {
      try { await deleteObject(sRef(storage, p)); } catch (e) {}
    }

    await updateDoc(doc(colRef, vId), { attachments: [...existingAttachments, ...uploaded] });

    $('visitModal')?.classList.add('hidden');
    await loadVisits();
  } catch (err) {
    alert('حدث خطأ أثناء حفظ الزيارة');
    console.error(err);
  } finally {
    showLoader(false);
  }
}

async function buildAISuggestions() {
  const aiList = $('aiList');
  if (!aiList) return;

  const agendaHeader = aiList.closest('aside')?.querySelector('h3');
  if (agendaHeader && isDoctorMode) {
    agendaHeader.textContent = '💡 ملخص الفحص السريري للزيارة (AI)';
  }

  try {
    const from = dateAdd(todayStr(), -6);
    const qy = query(collection(db, `parents/${activeParentId}/children/${childId}/measurements`), where('date', '>=', from));
    const snap = await getDocs(qy);

    if (snap.empty) {
      aiList.innerHTML = '<li>لا توجد قياسات كافية في آخر 7 أيام.</li>';
      return;
    }

    const unit = childData.glucoseUnit || 'mg/dL';
    const isMmol = unit.includes('mmol');
    const nMin = Number(childData.glucose_limits?.low) || (isMmol ? 3.9 : 70);
    const nMax = Number(childData.glucose_limits?.high) || (isMmol ? 10.0 : 180);

    let lows = 0, highs = 0, total = 0;
    snap.forEach(d => {
      const v = d.data();
      let val = isMmol ? (v.value_mmol ?? v.value) : (v.value_mgdl ?? v.value);
      val = Number(val);
      if (isNaN(val)) return;
      total++;
      if (val < nMin) lows++;
      if (val > nMax) highs++;
    });

    const sug = [];
    if (isDoctorMode) {
      if (highs > total * 0.35) sug.push(`⬆️ قراءات الارتفاع تمثل ${Math.round((highs / total) * 100)}% في آخر 7 أيام — يُوصى بمراجعة معامل الكارب (CR) أو التصحيح (CF).`);
      if (lows > 1) sug.push(`🚨 سُجل هبوط متكرر (${lows} مرات) — يُوصى بمراجعة جرعة الإنسولين القاعدي أو سناك ما قبل النوم.`);
      sug.push(`🔍 فحص مواضع حقن الإنسولين سريرياً للتأكد من خلوها من التكتلات الدهنية (Lipohypertrophy).`);
    } else {
      if (highs > total * 0.35) sug.push(`⚠️ قراءات الارتفاع تمثل ${Math.round((highs / total) * 100)}% من الأسبوع الماضي. (اسأل الطبيب عن تعديل المعاملات CR/CF).`);
      if (lows > 1) sug.push(`🚨 تم رصد هبوط متكرر (${lows} مرات). (اسأل عن تقليل الجرعة القاعدية أو تعديل سناك النوم).`);
      sug.push(`💡 اطلب من الطبيب مراجعة أماكن حقن الأنسولين (للتأكد من عدم وجود تكتلات دهنية).`);
    }

    aiList.innerHTML = sug.map(t => `<li>${t}</li>`).join('');
  } catch (e) {
    aiList.innerHTML = '<li>تعذر تحليل البيانات.</li>';
  }
}

function copyAgendaToClipboard() {
  const txt = Array.from($('aiList').querySelectorAll('li')).map(li => `• ${li.textContent}`).join('\n');
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(() => alert('تم النسخ ✅'));
}

function exportCSV() {
  if (!filteredVisits || filteredVisits.length === 0) return alert('لا توجد زيارات لتصديرها');
  let csv = '\uFEFFالتاريخ,الوقت,النوع,الطبيب/المركز,الوزن(kg),الطول(cm),BMI,الضغط,السبب,تشخيص الطبيب,التوصيات,حالة التطبيق\n';

  filteredVisits.forEach(v => {
    const isApplied = String(v.applied) === 'true' ? 'تم التطبيق' : 'بانتظار التطبيق';
    const reason = (v.reason || '').replace(/"/g, '""').replace(/\n/g, ' ');
    const summary = (v.summary || '').replace(/"/g, '""').replace(/\n/g, ' ');
    const rec = (v.recommendations || '').replace(/"/g, '""').replace(/\n/g, ' ');

    csv += `${v.date},${v.time || ''},${v.type},${v.doctorName},${v.weight || ''},${v.height || ''},${v.bmi || ''},${v.bloodPressure || ''},"${reason}","${summary}","${rec}",${isApplied}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Visits_Report_${todayStr()}.csv`;
  link.click();
}
