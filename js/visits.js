// js/visits.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, updateDoc, serverTimestamp, where, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const setText = (el, v) => { if (el) el.textContent = (v == null || v === '') ? '—' : v; };

function calcAge(bd) {
  if (!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('lastChildId');
const parentIdParam = params.get('parentId');

let currentUser, childData;
let editingId = null;
let existingAttachments = [], attachmentsToDelete = [], selectedFiles = [], allVisits = [], filteredVisits = [];
let growthChart = null;

const pad = n => String(n).padStart(2,'0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
function dateAdd(s,days){ const d=new Date(s||new Date()); d.setDate(d.getDate()+days); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function showLoader(v) { const el = $('appLoader'); if (el) el.style.display = v ? 'flex' : 'none'; }

const numOrNull = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const strOrNull = v => (v && String(v).trim() !== '') ? String(v).trim() : null;

// حساب مؤشر كتلة الجسم (BMI) تلقائياً عند إدخال الوزن والطول
function wireBmiCalc() {
  const calc = () => {
    const w = Number($('weight')?.value);
    const h = Number($('height')?.value);
    if (w > 0 && h > 0) {
      const hm = h / 100;
      const bmi = w / (hm * hm);
      $('bmi').value = bmi.toFixed(1);
    } else {
      $('bmi').value = '';
    }
  };
  $('weight')?.addEventListener('input', calc);
  $('height')?.addEventListener('input', calc);
}

onAuthStateChanged(auth, async (user)=>{
  if (!user) { location.href = 'index.html'; return; }
  currentUser = user;
  
  showLoader(true);
  try {
    const parentId = parentIdParam || user.uid;
    const isDoctor = parentIdParam && parentIdParam !== user.uid;

    // زر الرجوع الذكي
    const backBtn = $('backBtn');
    const backUrl = isDoctor ? 'doctor-dashboard.html' : `child.html?child=${childId}`;
    if(backBtn) {
      backBtn.textContent = isDoctor ? '🩺 رجوع للعيادة' : '🏠 رجوع للوحة الطفل';
      backBtn.onclick = () => location.href = backUrl;
    }
    $('logoutBtn')?.addEventListener('click', () => signOut(auth).catch(() => {}));

    let snap = await getDoc(doc(db, `parents/${parentId}/children/${childId}`));
    if (!snap.exists() && parentId !== user.uid) {
      const fallbackSnap = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
      if (fallbackSnap.exists()) {
        snap = fallbackSnap;
        localStorage.setItem('selectedParentId', user.uid);
      }
    }
    if(snap.exists()) childData = snap.data();
    else childData = {};

    const childName = childData.name || 'الطفل';
    setText($('topChildName'), childName);
    setText($('breadChildName'), childName);
    if($('topAvatar')) $('topAvatar').textContent = childName.trim().charAt(0) || 'أ';

    const age = calcAge(childData.birthDate);
    const genderStr = childData.gender === 'female' ? 'أنثى' : (childData.gender === 'male' ? 'ذكر' : '');
    const regimenStr = childData.regimen === 'pump' ? 'مضخة إنسولين' : 'حقن يومية (MDI)';
    const metaParts = [];
    if (age !== '-') metaParts.push(`العمر: ${age} سنة`);
    if (genderStr) metaParts.push(genderStr);
    if (regimenStr) metaParts.push(regimenStr);
    setText($('topChildMeta'), metaParts.join(' • ') || '—');

    // تحديث روابط الشريط العلوي
    const qParams = `?child=${encodeURIComponent(childId)}${isDoctor ? `&parentId=${encodeURIComponent(parentId)}` : ''}`;
    $('navHome')?.setAttribute('href', `child.html${qParams}`);
    $('navMeas')?.setAttribute('href', `measurements.html${qParams}`);
    $('navMeals')?.setAttribute('href', `meals.html${qParams}`);
    $('navReports')?.setAttribute('href', `reports.html${qParams}`);
    $('navLabs')?.setAttribute('href', `labs.html${qParams}`);
    $('breadChildName')?.setAttribute('href', `child.html${qParams}`);

    const to = todayStr();
    $('fromDate').value = dateAdd(to, -90);
    $('toDate').value = to;

    wireBmiCalc();

    await loadVisits();
    await buildAISuggestions();

    // Events
    ['filterType', 'filterApplied', 'searchBox', 'fromDate', 'toDate'].forEach(id => {
      $(id)?.addEventListener('input', renderVisits);
    });

    $('newVisitBtn').onclick = () => openModal();
    $('closeModal').onclick = () => $('visitModal').classList.add('hidden');
    $('cancelVisitBtn').onclick = () => $('visitModal').classList.add('hidden');
    $('copyAgenda').onclick = copyAgendaToClipboard;
    $('exportCSV').onclick = exportCSV;
    $('printList').onclick = () => window.print();

    $('attachments').onchange = (e) => { selectedFiles = Array.from(e.target.files); renderSelectedFiles(); };
    $('visitForm').onsubmit = handleSaveVisit;

  } catch(e) { console.error(e); }
  finally { showLoader(false); }
});

async function loadVisits(){
  const parentId = parentIdParam || currentUser.uid;
  const qy = query(collection(db, `parents/${parentId}/children/${childId}/visits`), orderBy('date','desc'));
  const snap = await getDocs(qy);
  allVisits = [];
  
  snap.forEach(d => {
    const v = d.data();
    v.labsRequested = v.labsRequested ? String(v.labsRequested).split(',').map(s=>s.trim()).filter(Boolean) : [];
    v.labsCompleted = v.labsCompleted || [];
    allVisits.push({ id:d.id, ...v });
  });

  const today = todayStr();
  const future = allVisits.filter(r => r.followUpDate && r.followUpDate >= today).map(r => r.followUpDate).sort();
  
  $('lastVisit').textContent = allVisits.length ? allVisits[0].date : '—';
  $('nextFollowUp').textContent = future.length ? future[0] : '—';
  $('pendingCount').textContent = allVisits.filter(r => String(r.applied) !== 'true').length;

  renderGrowthChart(allVisits);
  renderVisits();
}

function renderGrowthChart(visits) {
  const canvas = $('growthCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // استخراج القياسات وترتيبها زمنياً من الأقدم للأحدث
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

  growthData.sort((a,b) => new Date(a.date) - new Date(b.date));

  // تحديث شارات آخر قياس في رأس الودجت
  const badgesBox = $('latestGrowthBadges');
  if (badgesBox) {
    if (growthData.length) {
      const last = growthData[growthData.length - 1];
      badgesBox.innerHTML = `
        ${last.weight ? `<span class="growth-badge">⚖️ الوزن: <b>${last.weight} kg</b></span>` : ''}
        ${last.height ? `<span class="growth-badge">📏 الطول: <b>${last.height} cm</b></span>` : ''}
        ${last.bmi ? `<span class="growth-badge">📊 BMI: <b>${last.bmi}</b></span>` : ''}
        ${last.bp ? `<span class="growth-badge">💓 الضغط: <b>${last.bp}</b></span>` : ''}
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

function renderVisits(){
  const list = $('visitsList'); list.innerHTML = '';
  const t = $('filterType').value, a = $('filterApplied').value, q = $('searchBox').value.toLowerCase();
  const s = $('fromDate').value, e = $('toDate').value;

  filteredVisits = allVisits.filter(r => {
    const matchType = !t || r.type === t;
    const matchApp = !a || String(r.applied) === a;
    const matchDate = (!s || r.date >= s) && (!e || r.date <= e);
    const matchSearch = !q || `${r.doctorName} ${r.reason} ${r.summary}`.toLowerCase().includes(q);
    return matchType && matchApp && matchDate && matchSearch;
  });

  if(!filteredVisits.length){
    list.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">لا توجد زيارات مطابقة للبحث.</div>`;
    return;
  }

  filteredVisits.forEach(r => {
    const card = document.createElement('div');
    card.className = 'visit-card';
    
    const isApplied = String(r.applied) === 'true';
    const typeCls = r.type === 'متابعة دورية' ? 'dori' : r.type === 'طارئة' ? 'tari2' : '';

    let vitalsHtml = '';
    if(r.weight || r.height || r.bmi || r.bloodPressure) {
      vitalsHtml = `
        <div class="vc-vitals">
          ${r.weight ? `<span>⚖️ الوزن: <b>${r.weight} kg</b></span>` : ''}
          ${r.height ? `<span>📏 الطول: <b>${r.height} cm</b></span>` : ''}
          ${r.bmi ? `<span>📊 BMI: <b>${r.bmi}</b></span>` : ''}
          ${r.bloodPressure ? `<span>💓 الضغط: <b>${r.bloodPressure}</b></span>` : ''}
        </div>
      `;
    }

    let labsHtml = '';
    if(r.labsRequested.length) {
      labsHtml = `<div class="vc-box"><h4>🧪 فحوصات مطلوبة</h4><div class="vc-labs">` +
        r.labsRequested.map(lab => `<span class="lab-chip ${r.labsCompleted.includes(lab)?'done':''}" data-id="${r.id}" data-lab="${lab}">${lab}</span>`).join('') +
      `</div></div>`;
    }

    let dosesHtml = '';
    if(r.longActingChange || r.mealDosesChange) {
      dosesHtml = `<div class="vc-box" style="border-color:#f59e0b; background:#fffbeb;"><h4>💉 تعديلات الجرعات</h4>
        ${r.longActingChange ? `<div><b>القاعدي:</b> ${r.longActingChange}</div>` : ''}
        ${r.mealDosesChange ? `<div><b>الوجبات:</b> ${r.mealDosesChange}</div>` : ''}
      </div>`;
    }

    card.innerHTML = `
      <div class="vc-header">
        <div class="vc-title">👨‍⚕️ ${r.doctorName || 'طبيب'} <span class="vc-type ${typeCls}">${r.type}</span></div>
        <div class="vc-date">${r.date} ${r.time ? `(${r.time})` : ''}</div>
      </div>
      <div class="vc-body">
        ${vitalsHtml}
        ${r.reason ? `<div class="vc-reason"><b>السبب:</b> ${r.reason}</div>` : ''}
        ${r.summary ? `<div class="vc-box"><h4>📝 خلاصة الزيارة</h4><div>${r.summary}</div></div>` : ''}
        ${r.recommendations ? `<div class="vc-box" style="border-color:#10b981; background:#ecfdf5;"><h4>💡 توصيات الطبيب</h4><div>${r.recommendations}</div></div>` : ''}
        ${dosesHtml}
        ${labsHtml}
      </div>
      <div class="vc-footer">
        <button class="status-btn ${isApplied ? 'applied' : 'pending'}" data-toggle="${r.id}">
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

async function toggleApplied(v){
  const parentId = parentIdParam || currentUser.uid;
  const newVal = String(v.applied) !== 'true';
  await updateDoc(doc(db, `parents/${parentId}/children/${childId}/visits`, v.id), { applied: newVal });
  loadVisits();
}

async function toggleLabDone(v, labName, chipEl){
  const parentId = parentIdParam || currentUser.uid;
  const done = new Set(v.labsCompleted);
  if(done.has(labName)) done.delete(labName); else {
    done.add(labName);
    const qParams = `?child=${encodeURIComponent(childId)}${parentIdParam ? `&parentId=${encodeURIComponent(parentIdParam)}` : ''}`;
    if(confirm(`تم تحديد "${labName}" كمكتمل. هل تريد الانتقال لصفحة التحاليل لتسجيل النتيجة؟`)) {
      window.location.href = `labs.html${qParams}`;
    }
  }
  await updateDoc(doc(db, `parents/${parentId}/children/${childId}/visits`, v.id), { labsCompleted: Array.from(done) });
  chipEl.classList.toggle('done');
}

async function deleteVisit(id){
  if(!confirm('هل أنت متأكد من حذف الزيارة نهائياً؟')) return;
  const parentId = parentIdParam || currentUser.uid;
  await deleteDoc(doc(db, `parents/${parentId}/children/${childId}/visits`, id));
  loadVisits();
}

function openModal(v = null){
  editingId = v ? v.id : null;
  $('visitForm').reset();
  selectedFiles = []; attachmentsToDelete = []; existingAttachments = [];
  
  if(v) {
    $('modalTitle').textContent = 'تعديل زيارة';
    ['date','time','type','doctorName','reason','summary','recommendations','longActingChange','mealDosesChange','followUpDate','weight','height','bmi','bloodPressure'].forEach(k => {
      if($(k)) $(k).value = v[k] ?? '';
    });
    $('labsRequested').value = v.labsRequested ? v.labsRequested.join(', ') : '';
    $('applied').value = String(v.applied);
    existingAttachments = v.attachments || [];
  } else {
    $('modalTitle').textContent = 'إضافة زيارة طبية';
    $('date').value = todayStr();
  }
  
  renderSelectedFiles(); renderExisting();
  $('visitModal').classList.remove('hidden');
}

function renderSelectedFiles(){
  const w = $('selectedFiles'); w.innerHTML = '';
  selectedFiles.forEach((f, i)=>{
    const div = document.createElement('div'); div.className = 'file-item';
    div.innerHTML = `<span>${f.name}</span> <button type="button" data-i="${i}">✕</button>`;
    div.querySelector('button').onclick = () => { selectedFiles.splice(i,1); renderSelectedFiles(); };
    w.appendChild(div);
  });
}
function renderExisting(){
  const w = $('existingFiles'); w.innerHTML = '';
  $('existingWrap').classList.toggle('hidden', !existingAttachments.length);
  existingAttachments.forEach((f, i)=>{
    const div = document.createElement('div'); div.className = 'file-item';
    div.innerHTML = `<a href="${f.url}" target="_blank">📄 ${f.name}</a> <button type="button" data-i="${i}">✕</button>`;
    div.querySelector('button').onclick = () => { attachmentsToDelete.push(f.path); existingAttachments.splice(i,1); renderExisting(); };
    w.appendChild(div);
  });
}

async function handleSaveVisit(e){
  e.preventDefault();
  showLoader(true);
  const parentId = parentIdParam || currentUser.uid;

  const payload = {
    date: $('date').value, time: $('time').value, type: $('type').value, doctorName: $('doctorName').value,
    reason: $('reason').value, summary: $('summary').value, recommendations: $('recommendations').value,
    longActingChange: $('longActingChange').value, mealDosesChange: $('mealDosesChange').value,
    labsRequested: $('labsRequested').value.split(',').map(s=>s.trim()).filter(Boolean),
    followUpDate: $('followUpDate').value, applied: $('applied').value === 'true',
    weight: numOrNull($('weight')?.value),
    height: numOrNull($('height')?.value),
    bmi: numOrNull($('bmi')?.value),
    bloodPressure: strOrNull($('bloodPressure')?.value),
    updatedAt: serverTimestamp()
  };

  try {
    const colRef = collection(db, `parents/${parentId}/children/${childId}/visits`);
    let vId = editingId;
    if (!vId) { payload.createdAt = serverTimestamp(); const added = await addDoc(colRef, payload); vId = added.id; }
    else { await updateDoc(doc(colRef, vId), payload); }

    const storage = getStorage();
    const uploaded = [];
    for (const f of selectedFiles){
      const p = `parents/${parentId}/children/${childId}/visits/${vId}/${Date.now()}_${f.name}`;
      const r = sRef(storage, p); await uploadBytes(r, f);
      uploaded.push({ name:f.name, url: await getDownloadURL(r), path: p });
    }
    for (const p of attachmentsToDelete){ try{ await deleteObject(sRef(storage, p)); }catch(e){} }
    
    await updateDoc(doc(colRef, vId), { attachments: [...existingAttachments, ...uploaded] });
    
    $('visitModal').classList.add('hidden');
    loadVisits();
  } catch(err){ alert('حدث خطأ'); console.error(err); }
  finally{ showLoader(false); }
}

async function buildAISuggestions(){
  const aiList = $('aiList');
  try{
    const parentId = parentIdParam || currentUser.uid;
    const from = dateAdd(todayStr(), -6);
    const qy = query(collection(db, `parents/${parentId}/children/${childId}/measurements`), where('date','>=', from));
    const snap = await getDocs(qy);
    
    if (snap.empty){ aiList.innerHTML = '<li>لا توجد قياسات كافية في آخر أسبوع.</li>'; return; }

    const unit = childData.glucoseUnit || 'mg/dL';
    const isMmol = unit.includes('mmol');
    const nMin = isMmol ? 3.9 : 70;
    const nMax = isMmol ? 7.8 : 140;

    let lows=0, highs=0, total=0;
    snap.forEach(d => {
      const v = d.data();
      let val = isMmol ? (v.value_mmol || v.value) : (v.value_mgdl || v.value);
      val = Number(val);
      if(isNaN(val)) return;
      total++;
      if (val < nMin) lows++;
      if (val > nMax) highs++;
    });

    const sug = [];
    if (highs > total*0.4) sug.push(`⚠️ قراءات الارتفاع تمثل ${Math.round((highs/total)*100)}% من الأسبوع الماضي. (اسأل الطبيب عن تعديل المعاملات CR/CF).`);
    if (lows > 1) sug.push(`🚨 تم رصد هبوط متكرر (${lows} مرات). (اسأل عن تقليل الجرعة القاعدية أو تعديل سناك النوم).`);
    sug.push(`💡 اطلب من الطبيب مراجعة أماكن حقن الأنسولين (للتأكد من عدم وجود تكتلات دهنية).`);

    aiList.innerHTML = sug.map(t=>`<li>${t}</li>`).join('');
  } catch(e) { aiList.innerHTML = '<li>تعذر تحليل البيانات.</li>'; }
}

function copyAgendaToClipboard(){
  const txt = Array.from($('aiList').querySelectorAll('li')).map(li=>`• ${li.textContent}`).join('\n');
  if(!txt) return;
  navigator.clipboard.writeText(txt).then(()=> alert('تم النسخ ✅'));
}

// دالة التصدير المكتملة
function exportCSV(){
  if(!filteredVisits || filteredVisits.length === 0) return alert('لا توجد زيارات لتصديرها');
  let csv = '\uFEFFالتاريخ,الوقت,النوع,الطبيب/المركز,الوزن(kg),الطول(cm),BMI,الضغط,السبب,تشخيص الطبيب,التوصيات,حالة التطبيق\n';
  
  filteredVisits.forEach(v => {
    const isApplied = String(v.applied) === 'true' ? 'تم التطبيق' : 'بانتظار التطبيق';
    const reason = (v.reason || '').replace(/"/g, '""').replace(/\n/g, ' ');
    const summary = (v.summary || '').replace(/"/g, '""').replace(/\n/g, ' ');
    const rec = (v.recommendations || '').replace(/"/g, '""').replace(/\n/g, ' ');
    
    csv += `${v.date},${v.time||''},${v.type},${v.doctorName},${v.weight||''},${v.height||''},${v.bmi||''},${v.bloodPressure||''},"${reason}","${summary}","${rec}",${isApplied}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Visits_Report_${todayStr()}.csv`;
  link.click();
}
