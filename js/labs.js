// js/labs.js
import { auth, db } from './firebase-config.js';
import { collection, doc, setDoc, addDoc, getDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, limit } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('lastChildId');
let _currentLabId = params.get('lab') || null;
let chartInstance = null;

// حدود النطاقات الطبيعية (بناءً على تقارير أسيل الحقيقية)
const RANGES = {
  hba1c: { normal: 7.0, warn: 8.5 },
  vitD: { deficiency: 50, sufficient: 75 },
  celiac: { limit: 20 },
  wbc: { min: 4.0, max: 10.4 }, // سن 11-12 سنة
  hgb: { min: 120, max: 155 },
  plt: { min: 150, max: 450 }
};

onAuthStateChanged(auth, async user => {
  if (!user) return;
  showLoader(true);
  try {
    const cref = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
    const childData = cref.data();
    
    await loadHistory(user.uid);
    if (_currentLabId) await loadSpecificLab(user.uid, _currentLabId);
    
    // الأحداث
    $('saveBtn').onclick = () => saveLab(user.uid, false);
    $('savePdfBtn').onclick = () => saveLab(user.uid, true);
    $('printBtn').onclick = () => window.print();
    $('hba1cVal').oninput = updateHbA1cUI;

  } catch (e) { console.error(e); }
  finally { showLoader(false); }
});

function updateHbA1cUI() {
  const v = parseFloat($('hba1cVal').value);
  const status = $('hba1cStatus');
  if (!v) { status.textContent = '—'; status.className = ''; return; }
  
  if (v <= RANGES.hba1c.normal) {
    status.textContent = 'ممتاز ✅'; status.className = 'ok-text';
    $('hba1cVal').style.borderColor = '#16a34a';
  } else if (v <= RANGES.hba1c.warn) {
    status.textContent = 'مقبول ⚠️'; status.className = 'warn-text';
    $('hba1cVal').style.borderColor = '#f59e0b';
  } else {
    status.textContent = 'مرتفع 🚨'; status.className = 'danger-text';
    $('hba1cVal').style.borderColor = '#ef4444';
  }
}

async function saveLab(uid, andPdf) {
  const data = buildDoc();
  try {
    const col = collection(db, `parents/${uid}/children/${childId}/labs`);
    let id = _currentLabId;
    if (id) {
      await setDoc(doc(col, id), data, { merge: true });
    } else {
      const ref = await addDoc(col, data);
      id = ref.id;
    }
    alert('تم حفظ السجل الطبي بنجاح ✅');
    if (andPdf) generateProfessionalPDF(childId, data);
    location.reload();
  } catch (e) { alert('خطأ في الحفظ'); }
}

function buildDoc() {
  const d = id => $(id).value;
  const n = id => d(id) === '' ? null : Number(d(id));
  return {
    date: d('labDate'), when: new Date(d('labDate') + 'T12:00:00'), type: d('labType'),
    hba1c: { value: n('hba1cVal'), note: d('hba1cNote') },
    cbc: { hgb: n('cbc_hgb'), wbc: n('cbc_wbc'), plt: n('cbc_plt') },
    vitaminD: { value: n('vit_d'), note: d('vit_note') },
    celiac: { iga: n('celiac_iga'), igg: n('celiac_igg') },
    organFunc: { tsh: n('thy_tsh'), renal: n('ren_mac'), alt: n('liv_alt') },
    clinical: { fundus: d('fundus_exam'), note: d('clinic_note') },
    createdAt: serverTimestamp()
  };
}

async function loadHistory(uid) {
  const q = query(collection(db, `parents/${uid}/children/${childId}/labs`), orderBy('when', 'desc'), limit(15));
  const snap = await getDocs(q);
  const body = $('historyBody'); body.innerHTML = '';
  const chartData = [];

  snap.forEach(s => {
    const v = s.data();
    chartData.push(v);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${v.date}</td>
      <td>${v.type === 'full' ? 'شامل' : 'دوري'}</td>
      <td><b class="${v.hba1c.value <= 7 ? 'ok-text' : 'warn-text'}">${v.hba1c.value}%</b></td>
      <td>
        <button class="btn small ghost act-edit" data-id="${s.id}">تعديل</button>
        <button class="btn small danger act-del" data-id="${s.id}">حذف</button>
      </td>
    `;
    tr.querySelector('.act-edit').onclick = () => { _currentLabId = s.id; fillForm(v); window.scrollTo(0,0); };
    body.appendChild(tr);
  });
  renderHbA1cChart(chartData);
}

function renderHbA1cChart(data) {
  const valid = data.filter(d => d.hba1c?.value).reverse();
  const ctx = $('hba1cChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: valid.map(d => d.date.split('-').slice(1).join('/')),
      datasets: [{
        label: 'HbA1c', data: valid.map(d => d.hba1c.value),
        borderColor: '#2563eb', tension: 0.3, fill: true, backgroundColor: 'rgba(37, 99, 235, 0.05)'
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 4, max: 14 } } }
  });
}

function showLoader(v) { $('appLoader').style.display = v ? 'flex' : 'none'; }

function fillForm(v) {
  $('labDate').value = v.date; $('labType').value = v.type;
  $('hba1cVal').value = v.hba1c.value; $('hba1cNote').value = v.hba1c.note;
  $('cbc_hgb').value = v.cbc?.hgb || ''; $('cbc_wbc').value = v.cbc?.wbc || '';
  $('vit_d').value = v.vitaminD?.value || ''; $('celiac_iga').value = v.celiac?.iga || '';
  updateHbA1cUI();
}

// دالة توليد PDF احترافية (مختصرة)
function generateProfessionalPDF(name, data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text(`Lab Report: ${data.date}`, 10, 10);
  doc.text(`HbA1c: ${data.hba1c.value}%`, 10, 20);
  // ... إضافة بقية الجداول عبر autoTable ...
  doc.save(`Lab_${data.date}.pdf`);
}
