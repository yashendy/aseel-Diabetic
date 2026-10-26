// js/visits.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, updateDoc, serverTimestamp, where, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const setText = (el, v) => { if (el) el.textContent = (v == null || v === '') ? '—' : v; };

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
      if ($('bmi'))$('bmi').value = bmi.toFixed(1);
    } else {
      if ($('bmi'))$('bmi').value = '';
    }
  };
  $('weight')?.addEventListener('input', calc);$('height')?.addEventListener('input', calc);
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
    $('navMeas')?.classList.add('hidden');$('navMeals')?.classList.add('hidden');

    const navBar = document.querySelector('.topbar-nav');
    if (navBar && !$('navWorkstation')) {
      const wsLink = document.createElement('a');
      wsLink.id = 'navWorkstation';
      wsLink.className = 'nav-pill';
      wsLink.style.cssText = 'background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;';
      wsLink.href = workstationUrl;
      wsLink.innerHTML = '🩺 المحطة السريرية';
      navBar.insertBefore(wsLink, navBar.firstChild);
    } else if ($('navWorkstation')) {$('navWorkstation').href = workstationUrl;
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
    $('navHome')?.classList.remove('hidden');$('navMeas')?.classList.remove('hidden');
    $('navMeals')?.classList.remove('hidden');$('navHome')?.setAttribute('href', `child.html${qParams}`);
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
    if ($('topAvatar'))$('topAvatar').textContent = childName.trim().charAt(0) || 'أ';

    const age = calcAge(childData.birthDate);
    const genderStr = childData.gender === 'female' ? 'أنثى' : (childData.gender === 'male' ? 'ذكر' : '');
    const regimenStr = childData.regimen === 'pump' ? 'مضخة إنسولين' : 'حقن يومية (MDI)';
    const metaParts = [];
    if (age !== '-') metaParts.push(`العمر: ${age} سنة`);
    if (genderStr) metaParts.push(genderStr);
    if (regimenStr) metaParts.push(regimenStr);
    setText($('topChildMeta'), metaParts.join(' • ') || '—');

    adaptHeaderForRole(isDoctorMode, activeParentId);

    if ($('fromDate'))$('fromDate').value = '';
    if ($('toDate'))$('toDate').value = '';

    wireBmiCalc();

    await Promise.all([
      loadVisits(),
      buildAISuggestions()
    ]);

    ['filterType', 'filterApplied', 'searchBox', 'fromDate', 'toDate'].forEach(id => {
      $(id)?.addEventListener('input', renderVisits);
    });

    if ($('newVisitBtn'))$('newVisitBtn').onclick = () => openModal();
    if ($('closeModal')) $('closeModal').onclick = () =>$('visitModal').classList.add('hidden');
    if ($('cancelVisitBtn')) $('cancelVisitBtn').onclick = () =>$('visitModal').classList.add('hidden');
    if ($('copyAgenda'))$('copyAgenda').onclick = copyAgendaToClipboard;
    if ($('exportCSV'))$('exportCSV').onclick = exportCSV;
    if ($('printList'))$('printList').onclick = () => window.print();

    if ($('attachments')) {$('attachments').onchange = (e) => { selectedFiles = Array.from(e.target.files); renderSelectedFiles(); };
    }
    if ($('visitForm')) {$('visitForm').onsubmit = handleSaveVisit;
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

  if ($('lastVisit'))$('lastVisit').textContent = allVisits.length ? allVisits[0].date : '—';
  if ($('nextFollowUp'))$('nextFollowUp').textContent = future.length ? future[0] : '—';
  if ($('pendingCount'))$('pendingCount').textContent = allVisits.filter(r => String(r.applied) !== 'true').length;

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
          tension:
