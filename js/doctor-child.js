// js/doctor-child.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const mgdl2mmol = v => v / 18.0182;
const mmol2mgdl = v => v * 18.0182;

const params = new URLSearchParams(location.search);
const childId = params.get('child');
const parentId = params.get('parentId');

let currentUser = null;
let childData = {};
let sysUnit = 'mg/dL';
let sysLimits = { critLow: 54, low: 70, target: 100, high: 180, critHigh: 250 };
let measurementsData = [];
let doughnutChart = null;

function showLoader(show) { $('loader').classList.toggle('hidden', !show); }

onAuthStateChanged(auth, async (user) => {
  if (!user || !childId || !parentId) { location.href = "doctor-dashboard.html"; return; }
  currentUser = user;
  
  showLoader(true);
  try {
    await loadChildProfile();
    await fetchAndRenderData(14); // افتراضياً آخر 14 يوم
    setupEvents();
  } catch (e) {
    console.error(e);
    alert("حدث خطأ أثناء تحميل بيانات المريض.");
  }
  showLoader(false);
});

// --- 1. تحميل بروفايل المريض ---
async function loadChildProfile() {
  const childRef = doc(db, "parents", parentId, "children", childId);
  const snap = await getDoc(childRef);
  if (!snap.exists()) throw new Error("Patient not found");
  
  childData = snap.data();
  sysUnit = childData.glucoseUnit || 'mg/dL';
  
  // استخراج النطاقات (Fallback للقيم الافتراضية إذا لم تكن موجودة)
  if(childData.glucose_limits) {
    sysLimits = {
      critLow: Number(childData.glucose_limits.critical_low) || (sysUnit==='mmol/L'? 3.0 : 54),
      low: Number(childData.glucose_limits.low) || (sysUnit==='mmol/L'? 3.9 : 70),
      target: Number(childData.glucose_limits.target) || (sysUnit==='mmol/L'? 5.5 : 100),
      high: Number(childData.glucose_limits.high) || (sysUnit==='mmol/L'? 10.0 : 180),
      critHigh: Number(childData.glucose_limits.critical_high) || (sysUnit==='mmol/L'? 13.9 : 250)
    };
  } else if (sysUnit === 'mmol/L') {
      sysLimits = { critLow: 3.0, low: 3.9, target: 5.5, high: 10.0, critHigh: 13.9 };
  }

  // تعبئة واجهة المعلومات
  $('childTitle').textContent = childData.name || '—';
  $('c_name').textContent = childData.name || '—';
  $('c_gender').textContent = childData.gender === 'female' ? 'أنثى' : 'ذكر';
  $('c_unit').textContent = sysUnit;
  $('lblUnit').textContent = sysUnit;
  
  if (childData.birthDate) {
    const b = new Date(childData.birthDate); const age = new Date().getFullYear() - b.getFullYear();
    $('c_age').textContent = `${age} سنة`;
  }
  
  $('c_target').textContent = sysLimits.target;
  $('c_cf').textContent = childData.cf || childData.correctionFactor || '—';
  $('c_basal').textContent = childData.insulin?.basal || '—';
  $('c_bolus').textContent = childData.insulin?.bolus || '—';
  
  // 4 CRs
  const cr = childData.cr || {};
  $('c_cr_b').textContent = cr.breakfast || '—';
  $('c_cr_l').textContent = cr.lunch || '—';
  $('c_cr_d').textContent = cr.dinner || '—';
  $('c_cr_s').textContent = cr.snack || '—';

  // تعبئة محرر الإعدادات
  $('f_target').value = sysLimits.target;
  $('f_critLow').value = sysLimits.critLow;
  $('f_low').value = sysLimits.low;
  $('f_high').value = sysLimits.high;
  $('f_critHigh').value = sysLimits.critHigh;

  $('f_cf').value = childData.cf || childData.correctionFactor || '';
  $('f_cr_b').value = cr.breakfast || '';
  $('f_cr_l').value = cr.lunch || '';
  $('f_cr_d').value = cr.dinner || '';
  $('f_cr_s').value = cr.snack || '';

  $('f_basal').value = childData.insulin?.basal || '';
  $('f_bolus').value = childData.insulin?.bolus || '';

  // تعبئة خريطة الحقن
  const imap = childData.injection_map || {};
  const mapIds = ['abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'arm_right', 'arm_left', 'thigh_right', 'thigh_left'];
  mapIds.forEach(id => {
    if($(`inj_${id}`)) $(`inj_${id}`).value = imap[id] || 'normal';
  });

  // تعبئة روشتة الطبيب
  if(childData.doctor_note) {
    $('doctorPrescription').value = childData.doctor_note;
  }
}

// --- 2. جلب البيانات وتحليلها ---
async function fetchAndRenderData(daysBack) {
  showLoader(true);
  
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - daysBack);
  
  const toStr = toDate.toISOString().slice(0, 10);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const col = collection(db, "parents", parentId, "children", childId, "measurements");
  const qy = query(col, where("date", ">=", fromStr), where("date", "<=", toStr));
  const snap = await getDocs(qy);
  
  measurementsData = [];
  snap.forEach(d => {
    const x = d.data();
    // توحيد القيمة لوحدة العرض
    let v = sysUnit.includes('mmol') 
        ? (x.value_mmol ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
        : (x.value_mgdl ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
    
    measurementsData.push({
      dateStr: x.date,
      timeStr: x.time || '',
      when: x.when?.toDate() || new Date(x.date),
      slotKey: x.slotKey || 'OTHER',
      val: Number.isFinite(+v) ? Math.round((+v)*10)/10 : null,
      carbs: x.carbs || 0,
      ins: x.totalInsulin || x.totalDose || x.correctionDose || 0,
      notes: x.notes || ''
    });
  });

  measurementsData.sort((a, b) => b.when - a.when); // الأحدث أولاً
  
  renderTable();
  renderAnalytics();
  runQuickAI();
  
  showLoader(false);
}

// --- 3. جدول القياسات والوجبات المدمج ---
function renderTable() {
  const tbody = $('combinedRows');
  tbody.innerHTML = '';
  if(!measurementsData.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">لا توجد بيانات في هذه الفترة.</td></tr>'; return; }

  const SLOT_LABELS = { FASTING:'صائم', PRE_BREAKFAST:'ق. الفطار', POST_BREAKFAST:'ب. الفطار', PRE_LUNCH:'ق. الغداء', PRE_DINNER:'ق. العشاء', SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم' };

  measurementsData.forEach(m => {
    let statusHtml = '';
    if(m.val !== null) {
      if(m.val <= sysLimits.critLow) statusHtml = `<span style="color:#b91c1c;font-weight:bold;">هبوط حرج</span>`;
      else if(m.val < sysLimits.low) statusHtml = `<span style="color:#b45309;font-weight:bold;">هبوط</span>`;
      else if(m.val >= sysLimits.critHigh) statusHtml = `<span style="color:#b91c1c;font-weight:bold;">ارتفاع حرج</span>`;
      else if(m.val > sysLimits.high) statusHtml = `<span style="color:#b45309;font-weight:bold;">ارتفاع</span>`;
      else statusHtml = `<span style="color:#16a34a;font-weight:bold;">طبيعي</span>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-size:13px; color:#475569;">${m.dateStr} <br> <span style="font-weight:bold;color:#0f172a;">${m.timeStr}</span></td>
      <td>${SLOT_LABELS[m.slotKey] || m.slotKey}</td>
      <td style="font-weight:bold; font-size:16px;">${m.val !== null ? m.val : '—'}</td>
      <td>${statusHtml}</td>
      <td style="color:#7c3aed; font-weight:bold;">${m.carbs > 0 ? m.carbs + 'g' : '—'}</td>
      <td style="color:#dc2626; font-weight:bold;">${m.ins > 0 ? m.ins + 'U' : '—'}</td>
      <td style="font-size:12px; color:#64748b; max-width:200px;">${m.notes}</td>
    `;
    tbody.appendChild(tr);
  });
}

// --- 4. التحليلات (TIR) ---
function renderAnalytics() {
  const valid = measurementsData.filter(x => x.val !== null);
  const total = valid.length || 1;

  const tbr = valid.filter(x => x.val < sysLimits.low).length;
  const tir = valid.filter(x => x.val >= sysLimits.low && x.val <= sysLimits.high).length;
  const tar = valid.filter(x => x.val > sysLimits.high).length;

  const pctTIR = Math.round((tir/total)*100);
  const pctTBR = Math.round((tbr/total)*100);
  const pctTAR = Math.round((tar/total)*100);

  $('analysisNumbers').innerHTML = `
    <div class="stat-badge ok"><span>داخل النطاق (TIR)</span> <span>${pctTIR}%</span></div>
    <div class="stat-badge danger"><span>انخفاض (TBR)</span> <span>${pctTBR}%</span></div>
    <div class="stat-badge danger" style="border-color:#fde68a; background:#fffbeb; color:#b45309;"><span>ارتفاع (TAR)</span> <span>${pctTAR}%</span></div>
  `;

  const ctx = $('doughnutChart').getContext('2d');
  if(doughnutChart) doughnutChart.destroy();
  doughnutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['في النطاق', 'هبوط', 'ارتفاع'], datasets: [{ data: [pctTIR, pctTBR, pctTAR], backgroundColor: ['#16a34a', '#ef4444', '#f59e0b'] }] },
    options: { plugins: { legend: { display: false } }, cutout: '75%' }
  });
}

// --- 5. الذكاء الاصطناعي المصغر للطبيب 🧠 ---
function runQuickAI() {
  const valid = measurementsData.filter(x => x.val !== null);
  const fast = valid.filter(x=>x.slotKey==='FASTING' || x.slotKey==='WAKE').map(x=>x.val);
  const sleep = valid.filter(x=>x.slotKey==='DURING_SLEEP' || x.slotKey==='BEDTIME').map(x=>x.val);
  const pBreakfast = valid.filter(x=>x.slotKey==='POST_BREAKFAST').map(x=>x.val);
  
  const patt = [];

  if(fast.length >= 2 && sleep.length >= 2) {
    if (fast.filter(v => v > sysLimits.high).length >= 2 && sleep.filter(v => v >= sysLimits.low && v <= sysLimits.high).length >= 2) {
      patt.push({ name: 'ظاهرة الفجر', desc: 'ارتفاع السكر صباحاً رغم استقراره ليلاً. (فكّر بتعديل القاعدي).', cls: 'warn' });
    }
  }

  if(pBreakfast.length >= 3 && pBreakfast.filter(v=>v >= sysLimits.critHigh).length >= 2) {
    patt.push({ name: 'قفزات إفطار', desc: 'السكر يقفز بشدة بعد الإفطار. (تحقق من CR الفطار).', cls: 'crit' });
  }

  const aiBox = $('aiQuickLook');
  const aiSum = $('aiSummary');
  
  if(patt.length > 0) {
    aiBox.classList.remove('hidden');
    aiSum.innerHTML = patt.map(p => `<div class="ai-item ${p.cls}"><b>${p.name}:</b> ${p.desc}</div>`).join('');
  } else {
    aiBox.classList.remove('hidden');
    aiSum.innerHTML = `<div class="ai-item" style="border-color:#16a34a;">لا توجد أنماط حرجة واضحة في هذه الفترة. السيطرة تبدو جيدة ✅.</div>`;
  }
}

// --- 6. حفظ الروشتة والتعديلات الطبية ---
async function saveMedicalProtocol() {
  const status = $('saveStatus');
  status.textContent = 'جاري الحفظ...'; status.style.color = 'var(--primary)';
  
  const crData = {
    breakfast: parseFloat($('f_cr_b').value) || null,
    lunch: parseFloat($('f_cr_l').value) || null,
    dinner: parseFloat($('f_cr_d').value) || null,
    snack: parseFloat($('f_cr_s').value) || null
  };

  const limitsData = {
    target: parseFloat($('f_target').value) || null,
    critical_low: parseFloat($('f_critLow').value) || null,
    low: parseFloat($('f_low').value) || null,
    high: parseFloat($('f_high').value) || null,
    critical_high: parseFloat($('f_critHigh').value) || null
  };

  const mapIds = ['abd_top_right', 'abd_top_left', 'abd_bottom_right', 'abd_bottom_left', 'arm_right', 'arm_left', 'thigh_right', 'thigh_left'];
  const injectionMapData = {};
  mapIds.forEach(id => { injectionMapData[id] = $(`inj_${id}`).value; });

  const payload = {
    cf: parseFloat($('f_cf').value) || null,
    cr: crData,
    glucose_limits: limitsData,
    insulin: { basal: $('f_basal').value.trim() || null, bolus: $('f_bolus').value.trim() || null },
    injection_map: injectionMapData,
    doctor_note: $('doctorPrescription').value.trim() || null,
    updatedAt: serverTimestamp()
  };

  try {
    const childRef = doc(db, "parents", parentId, "children", childId);
    await updateDoc(childRef, payload);
    status.textContent = 'تم حفظ البروتوكول وتحديث حساب الأم بنجاح ✅'; status.style.color = 'var(--success)';
    
    // تحديث الأرقام المعروضة في البطاقة العلوية فوراً
    loadChildProfile(); 
    
    setTimeout(()=> status.textContent = '', 4000);
  } catch (e) {
    console.error(e);
    status.textContent = 'خطأ في الحفظ!'; status.style.color = 'var(--danger)';
  }
}

// --- 7. ربط الأحداث ---
function setupEvents() {
  $('runData').onclick = () => fetchAndRenderData(parseInt($('preset').value));
  $('btnSaveMedical').onclick = saveMedicalProtocol;
  $('btnSaveNote').onclick = saveMedicalProtocol; // زر إضافي للروشتة يقوم بنفس عمل الحفظ الكامل
  
  $('btnOpenReport').onclick = () => {
    window.open(`reports.html?child=${childId}&parentId=${parentId}`, '_blank');
  };
}
