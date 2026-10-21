// js/child.js 
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---- childId ---- */
const params  = new URLSearchParams(location.search);
let   childId = params.get('child') || localStorage.getItem('lastChildId');
if (!childId) { location.replace('parent.html?pickChild=1'); throw new Error('Missing child id'); }
localStorage.setItem('lastChildId', childId);

/* ---- DOM ---- */
const $ = id => document.getElementById(id);
const loaderEl        = $('loader');
const childNameEl     = $('childName');
const childMetaEl     = $('childMeta');
const chipRangeEl     = $('chipRange');
const chipCREl        = $('chipCR');
const chipCFEl        = $('chipCF');
const todayMeasuresEl = $('todayMeasures');
const todayMealsEl    = $('todayMeals');
const nextVisitEl     = $('nextVisit');
const goMeasurements  = $('goMeasurements');
const goMeals         = $('goMeals');
const goReports       = $('goReports');
const goVisits        = $('goVisits');
const goChildEdit     = $('goChildEdit');

// روشتة الطبيب
const doctorNoteAlert = $('doctorNoteAlert');
const doctorNoteText  = $('doctorNoteText');

// كارت التحاليل
const labCard         = $('labCard');
const labHba1cVal     = $('labHba1cVal');
const labHba1cDelta   = $('labHba1cDelta');
const labLastSince    = $('labLastSince');
const labLastDate     = $('labLastDate');
const labDueBadge     = $('labDueBadge');
const openLabsBtn     = $('openLabsBtn');
const openLastPdfBtn  = $('openLastPdfBtn');
const addLabBtn       = $('addLabBtn');
const progressFill    = $('progressFill');
const progressLabel   = $('progressLabel');

/* ---- أدوات ---- */
function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function calcAge(bd){
  if(!bd) return '-';
  const b=new Date(bd),t=new Date(); let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a;
}
function loader(show){ loaderEl?.classList.toggle('hidden',!show); }
function setText(el,v){ if(el) el.textContent=(v==null||v==='')?'—':v; }
function setHref(el,url){ if(el) el.href=url; }
function fmt(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${d.getDate().toString().padStart(2,'0')}`; }
function dayDiff(a,b){ return Math.ceil((a-b)/86400000); }
function addMonths(date,m=4){
  const d=new Date(date); const day=d.getDate();
  d.setMonth(d.getMonth()+m);
  if(d.getDate()<day) d.setDate(0); return d;
}
function monthsDaysBetween(from,to){
  let m=(to.getFullYear()-from.getFullYear())*12+(to.getMonth()-from.getMonth());
  let anchor=addMonths(from,m);
  if(to.getDate()<from.getDate()){m-=1;anchor=addMonths(from,m);}
  const d=Math.max(0,dayDiff(to,anchor)); return {months:Math.max(0,m),days:d};
}
function formatCountdown(baseDate,dueDate){
  const dLeft=dayDiff(dueDate,baseDate);
  if(dLeft<0) return `متأخر ${Math.abs(dLeft)} يوم`;
  if(dLeft===0) return 'اليوم';
  const md=monthsDaysBetween(baseDate,dueDate); const parts=[];
  if(md.months>0) parts.push(`${md.months} شهر`);
  if(md.days>0) parts.push(`${md.days} يوم`);
  return `باقي ${parts.join(' و ')}`;
}

function currentMeal(){
  const h = new Date().getHours();
  if(h >= 5  && h < 11) return { key: 'breakfast', label: 'الفطور' };
  if(h >= 11 && h < 16) return { key: 'lunch', label: 'الغداء' };
  if(h >= 16 && h < 22) return { key: 'dinner', label: 'العشاء' };
  return { key: 'snack', label: 'سناك' };
}

function timeAgo(date) {
  if (!date) return '';
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  const diffDays = Math.floor(diffHours / 24);
  return `منذ ${diffDays} يوم`;
}

function glucoseState(v, child){
  if(v == null) return null;
  const unit = child.glucoseUnit || 'mg/dL';
  const limits = child.glucose_limits || {};
  const critLow  = Number(limits.critical_low) || (unit === 'mmol/L' ? 3.0 : 54);
  const low      = Number(limits.low) || (unit === 'mmol/L' ? 3.9 : 70);
  const high     = Number(limits.high) || (unit === 'mmol/L' ? 10.0 : 180);
  const critHigh = Number(limits.critical_high) || (unit === 'mmol/L' ? 13.9 : 250);

  if(v <= critLow)  return { cls: 'crit-low',  label: 'حرج منخفض 🚨', color: '#dc2626' };
  if(v >= critHigh) return { cls: 'crit-high', label: 'حرج مرتفع 🚨', color: '#dc2626' };
  if(v < low)       return { cls: 'low',       label: 'منخفض ↓',     color: '#3b82f6' };
  if(v > high)      return { cls: 'high',      label: 'مرتفع ↑',     color: '#f59e0b' };
  return            { cls: 'ok',        label: 'في النطاق ✅', color: '#10b981' };
}

function pointColors(readings, child){
  return readings.map(r => glucoseState(r, child)?.color ?? '#10b981');
}

async function renderGlucoseSparkline(uid, child){
  const container = $('glucoseSparkContainer');
  if(!container) return;

  const ref  = collection(db,`parents/${uid}/children/${childId}/measurements`);
  const snap = await getDocs(query(ref, orderBy('when','desc'), limit(50)));

  if(snap.empty){
    container.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:12px 0;text-align:center">لا توجد قراءات مسجلة بعد. ابدأ بتسجيل أول قراءة اليوم!</p>';
    return;
  }

  const unit = child.glucoseUnit || 'mg/dL';
  const isMmol = unit === 'mmol/L';

  const points = snap.docs.map(d=>{
    const data = d.data();
    let val = null;
    if (isMmol) {
      if (data.value_mmol != null) val = Number(data.value_mmol);
      else if (data.unit === 'mmol/L' && data.value != null) val = Number(data.value);
      else if (data.value_mgdl != null) val = +(Number(data.value_mgdl) / 18).toFixed(1);
      else if (data.value != null) val = +(Number(data.value) / 18).toFixed(1);
    } else {
      if (data.value_mgdl != null) val = Math.round(Number(data.value_mgdl));
      else if (data.unit === 'mg/dL' && data.value != null) val = Math.round(Number(data.value));
      else if (data.value_mmol != null) val = Math.round(Number(data.value_mmol) * 18);
      else if (data.value != null) val = Math.round(Number(data.value) * 18);
    }
    const when = data.when?.toDate ? data.when.toDate() : (data.when ? new Date(data.when) : null);
    return { val, when, slotKey: data.slotKey, state: data.state };
  }).filter(p=>p.val != null && !isNaN(p.val) && p.when).reverse();

  if(!points.length){
    container.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:8px 0;text-align:center">لا توجد قراءات صالحة للعرض</p>';
    return;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayPoints = points.filter(p => p.when >= startOfToday);

  const last = points[points.length-1];
  const gs   = glucoseState(last.val, child);
  const timeAgoText = timeAgo(last.when);

  const vals   = points.map(p=>p.val);
  const minVal = isMmol ? Math.min(...vals).toFixed(1) : Math.min(...vals);
  const maxVal = isMmol ? Math.max(...vals).toFixed(1) : Math.max(...vals);
  
  const limits = child.glucose_limits || {};
  const low    = Number(limits.low) || (isMmol ? 3.9 : 70);
  const high   = Number(limits.high) || (isMmol ? 10.0 : 180);

  const todayVals = todayPoints.map(p => p.val);
  const todayAvg = todayVals.length
    ? (isMmol ? (todayVals.reduce((a,b)=>a+b,0)/todayVals.length).toFixed(1) : Math.round(todayVals.reduce((a,b)=>a+b,0)/todayVals.length))
    : (isMmol ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : Math.round(vals.reduce((a,b)=>a+b,0)/vals.length));

  const relevantPoints = todayPoints.length ? todayPoints : points;
  const inRange = relevantPoints.filter(p=>p.val>=low && p.val<=high).length;
  const tir = Math.round(inRange / relevantPoints.length * 100);

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:14px;font-weight:700;color:#0f172a">📊 تحليل الجلوكوز الحي</span>
        <span style="background:${gs?.color??'#10b981'}22;color:${gs?.color??'#10b981'};border:1px solid ${gs?.color??'#10b981'}55;
              padding:3px 12px;border-radius:999px;font-size:13px;font-weight:700">
          آخر قراءة: ${last.val} ${unit} (${gs?.label??''}) • ${timeAgoText}
        </span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#0f172a">${todayAvg}</div>
        <div style="font-size:11px;color:#64748b">${todayVals.length ? 'متوسط اليوم' : 'المتوسط العام'} (${unit})</div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#15803d">${tir}%</div>
        <div style="font-size:11px;color:#64748b">داخل النطاق (TIR)</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#1e40af">${minVal}</div>
        <div style="font-size:11px;color:#64748b">الأدنى (${unit})</div>
      </div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#9a3412">${maxVal}</div>
        <div style="font-size:11px;color:#64748b">الأعلى (${unit})</div>
      </div>
    </div>

    <div style="position:relative;height:120px;width:100%">
      <canvas id="glucoseSparkCanvas"></canvas>
    </div>
  `;

  const colors = pointColors(vals, child);
  const ctx = $('glucoseSparkCanvas')?.getContext('2d');
  if(!ctx) return;

  const labels = points.map(p=>{
    const d=p.when;
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  if (window._glucoseChart) {
    try { window._glucoseChart.destroy(); } catch(e){}
  }

  const minGraphVal = Math.max(0, Math.min(...vals, low) - (isMmol ? 0.5 : 10));
  const maxGraphVal = Math.max(...vals, high) + (isMmol ? 0.5 : 15);

  window._glucoseChart = new Chart(ctx,{
    type:'line',
    data:{
      labels,
      datasets:[
        {
          label: `الحد الأدنى (${low} ${unit})`,
          data: Array(vals.length).fill(low),
          borderColor: '#10b981',
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          order: 3
        },
        {
          label: `الحد الأعلى (${high} ${unit})`,
          data: Array(vals.length).fill(high),
          borderColor: '#10b981',
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: '-1',
          backgroundColor: 'rgba(16, 185, 129, 0.07)',
          order: 2
        },
        {
          label: 'رادار الجلوكوز',
          data: vals,
          borderColor: '#3b82f6',
          borderWidth: 2.2,
          pointBackgroundColor: colors,
          pointBorderColor: colors,
          pointRadius: vals.length>30 ? 2 : 4,
          pointHoverRadius: 6,
          tension: 0.3,
          fill: { target: 'origin', above: 'rgba(59,130,246,0.06)' },
          order: 1
        }
      ]
    },
    options:{
      responsive: true, maintainAspectRatio: false,
      plugins:{
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label && ctx.dataset.label.includes('الحد')) return ctx.dataset.label;
              return `${ctx.parsed.y} ${unit}`;
            },
            title: ctx => labels[ctx[0].dataIndex]
          }
        }
      },
      scales:{
        x:{ display: false },
        y:{
          min: minGraphVal,
          max: maxGraphVal,
          ticks:{ font: { size: 10 }, color: '#94a3b8' },
          grid:{ color: '#f1f5f9' },
          border:{ display: false }
        }
      }
    }
  });
}

// ---------------- متابعة الأنسولين القاعدي اليومي (Basal Tracker) ----------------
async function initBasalTracker(uid, child) {
  const basalCard = $('basalCard');
  if (!basalCard) return;

  const basalName = child.insulin?.basal || child.basalType || 'الأنسولين القاعدي';
  const basalDose = child.basalDose || child.insulin?.basalDose || null;
  const basalTime = child.basalTime || child.insulin?.basalTime || 'مساءً';

  setText($('basalTypeName'), basalName);
  setText($('basalDoseRec'), basalDose ? `${basalDose} وحدة` : 'حسب الوصفة');
  setText($('basalTimeRec'), basalTime || 'مساءً');

  const today = todayStr();
  const cacheKey = `basal_${childId}_${today}`;
  let loggedData = null;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.taken && parsed.date === today) loggedData = parsed;
    }
  } catch(e){}

  if (!loggedData) {
    try {
      const snap = await getDoc(doc(db, `parents/${uid}/children/${childId}/basalLogs/${today}`));
      if (snap.exists() && snap.data().taken) {
        loggedData = snap.data();
        localStorage.setItem(cacheKey, JSON.stringify(loggedData));
      }
    } catch(e) {
      console.warn('Could not read basal log:', e);
    }
  }

  function renderBasalState(data) {
    const badge = $('basalStatusBadge');
    const btnConfirm = $('btnConfirmBasal');
    const loggedInfo = $('basalLoggedInfo');
    const loggedText = $('basalLoggedText');
    const form = $('basalConfirmForm');

    if (data && data.taken) {
      if (badge) {
        badge.className = 'basal-status-badge done';
        badge.textContent = '✅ تم أخذ جرعة اليوم';
      }
      if (btnConfirm) btnConfirm.classList.add('hidden');
      if (loggedInfo) loggedInfo.classList.remove('hidden');
      if (loggedText) loggedText.textContent = `✅ تم التسجيل: ${data.dose} وحدة (${data.time || '—'})`;
      if (form) form.classList.add('hidden');
    } else {
      if (badge) {
        badge.className = 'basal-status-badge pending';
        badge.textContent = '⏳ لم تُسجّل جرعة اليوم بعد';
      }
      if (btnConfirm) btnConfirm.classList.remove('hidden');
      if (loggedInfo) loggedInfo.classList.add('hidden');
      if (form) form.classList.add('hidden');
    }
  }

  renderBasalState(loggedData);

  // زر فتح النموذج
  $('btnConfirmBasal')?.addEventListener('click', () => {
    const form = $('basalConfirmForm');
    if (!form) return;
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
      const now = new Date();
      if ($('basalTimeInput')) $('basalTimeInput').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      if ($('basalDoseInput') && !$('basalDoseInput').value) {
        $('basalDoseInput').value = basalDose || 10;
      }
      $('basalDoseInput')?.focus();
    }
  });

  // زر إلغاء النموذج
  $('btnCancelBasalDose')?.addEventListener('click', () => {
    $('basalConfirmForm')?.classList.add('hidden');
  });

  // زر حفظ وتأكيد الجرعة
  $('btnSaveBasalDose')?.addEventListener('click', async () => {
    const doseVal = parseFloat($('basalDoseInput')?.value);
    const timeVal = $('basalTimeInput')?.value || `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
    if (!doseVal || doseVal <= 0) {
      alert('يرجى إدخال عدد وحدات الجرعة بشكل صحيح');
      return;
    }

    loader(true);
    try {
      const payload = {
        taken: true,
        date: today,
        dose: doseVal,
        time: timeVal,
        insulin: basalName,
        recordedAt: serverTimestamp()
      };
      await setDoc(doc(db, `parents/${uid}/children/${childId}/basalLogs/${today}`), payload, { merge: true });
      localStorage.setItem(cacheKey, JSON.stringify(payload));
      loggedData = payload;
      renderBasalState(loggedData);
    } catch(err) {
      console.error(err);
      alert('تعذر حفظ جرعة القاعدي، يرجى المحاولة مرة أخرى.');
    } finally {
      loader(false);
    }
  });

  // زر التراجع
  $('btnUndoBasal')?.addEventListener('click', async () => {
    if (!confirm('هل أنت متأكد من إلغاء تأكيد جرعة القاعدي لليوم؟')) return;
    loader(true);
    try {
      await setDoc(doc(db, `parents/${uid}/children/${childId}/basalLogs/${today}`), { taken: false }, { merge: true });
      localStorage.removeItem(cacheKey);
      loggedData = null;
      renderBasalState(null);
    } catch(err) {
      console.error(err);
      alert('تعذر إلغاء التسجيل.');
    } finally {
      loader(false);
    }
  });
}

// ---------------- بطاقة الطوارئ والمدرسة ----------------
function initEmergencyCard(user, child) {
  const dialog = $('emergencyCardDialog');
  const btnOpen = $('btnEmergencyCard');
  const btnClose = $('btnCloseEmergencyCard');
  const btnPrint = $('btnPrintEmergencyCard');

  if (!dialog) return;

  const name = child.identity?.name || child.name || 'الطفل';
  const gender = child.identity?.gender || child.gender || '-';
  const dob = child.identity?.dob || child.birthDate || null;
  const ageStr = `${gender === 'female' ? 'أنثى' : (gender === 'male' ? 'ذكر' : gender)} • ${calcAge(dob)} سنة`;
  const unit = child.glucoseUnit || 'mg/dL';
  const limits = child.glucose_limits || {};
  const min = limits.low ?? (unit === 'mmol/L' ? 3.9 : 70);
  const max = limits.high ?? (unit === 'mmol/L' ? 10.0 : 180);

  setText($('emChildName'), name);
  setText($('emChildAge'), ageStr);
  setText($('emGlucoseRange'), `${min} - ${max} ${unit}`);

  // ولي الأمر
  const parentName = user.displayName || 'ولي الأمر';
  setText($('emParentName'), parentName);
  const parentPhone = child.parentPhone || user.phoneNumber || '';
  const pPhoneBtn = $('emParentPhoneBtn');
  if (pPhoneBtn) {
    if (parentPhone) {
      pPhoneBtn.href = `tel:${parentPhone}`;
      pPhoneBtn.textContent = `📞 ${parentPhone}`;
    } else {
      pPhoneBtn.href = '#';
      pPhoneBtn.textContent = '📞 غير مسجل';
      pPhoneBtn.onclick = (e) => {
        e.preventDefault();
        const p = prompt('أدخل رقم هاتف ولي الأمر للتواصل في الطوارئ:');
        if (p) {
          pPhoneBtn.href = `tel:${p}`;
          pPhoneBtn.textContent = `📞 ${p}`;
        }
      };
    }
  }

  // الطبيب المعالج
  const docInfo = child.assignedDoctorInfo || {};
  const docName = docInfo.name || child.assignedDoctorName || 'غير مسند بعد';
  setText($('emDoctorName'), docName);
  const docPhoneBtn = $('emDoctorPhoneBtn');
  if (docPhoneBtn) {
    const docPhone = docInfo.phone || child.doctorPhone || '';
    if (docPhone) {
      docPhoneBtn.href = `tel:${docPhone}`;
      docPhoneBtn.textContent = `📞 ${docPhone}`;
      docPhoneBtn.classList.remove('hidden');
    } else {
      docPhoneBtn.textContent = '📞 بدون هاتف';
      docPhoneBtn.classList.add('hidden');
    }
  }

  // الأنسولين
  const basal = child.insulin?.basal || child.basalType || 'طويل المفعول';
  const bolus = child.insulin?.bolus || child.bolusType || 'سريع المفعول';
  const cf = child.cf ?? child.correctionFactor ?? '—';
  const hypoCarbs = child.hypoCarbs || 15;

  setText($('emBasalText'), basal);
  setText($('emBolusText'), bolus);
  setText($('emCFText'), String(cf));
  setText($('emHypoCarbsText'), `${hypoCarbs} جرام`);

  btnOpen?.addEventListener('click', () => dialog.showModal());
  btnClose?.addEventListener('click', () => dialog.close());
  btnPrint?.addEventListener('click', () => window.print());

  // فتح تلقائي إذا تم تمرير openEmergency=1 في الرابط
  if (params.get('openEmergency') === '1' || params.get('emergency') === '1') {
    setTimeout(() => {
      try { dialog.showModal(); } catch(e){}
    }, 300);
  }
}

document.getElementById('logoutBtn')?.addEventListener('click',()=>signOut(auth).catch(()=>{}));

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  try{
    loader(true);
    const parentId = parentIdParam || user.uid;
    const isDoctor = parentIdParam && parentIdParam !== user.uid;
    const childRef = doc(db,`parents/${parentId}/children/${childId}`);
    const snap = await getDoc(childRef);
    if(!snap.exists()){
      alert('لم يتم العثور على ملف الطفل');
      if (isDoctor) { location.href = 'doctor-dashboard.html'; }
      else { localStorage.removeItem('lastChildId'); location.replace('parent.html?pickChild=1'); }
      return;
    }
    const c = snap.data();
    localStorage.setItem('lastChildId', childId);

    /* ---- إظهار تعليمات الطبيب المباشرة ---- */
    if (c.doctor_note && c.doctor_note.trim() !== '') {
      if(doctorNoteText) doctorNoteText.textContent = c.doctor_note;
      if(doctorNoteAlert) doctorNoteAlert.classList.remove('hidden');
    } else {
      if(doctorNoteAlert) doctorNoteAlert.classList.add('hidden');
    }

    const name = c.identity?.name || c.name || 'طفل';
    const gender = c.identity?.gender || c.gender || '-';
    const dob = c.identity?.dob || c.birthDate || null;
    const ageStr = `${gender === 'female' ? 'أنثى' : (gender === 'male' ? 'ذكر' : gender)} • ${calcAge(dob)} سنة`;
    
    // --- تحديث الـ Vitals Header القديم ---
    setText(childNameEl, name);
    setText(childMetaEl, ageStr);

    // --- تحديث الـ Topbar والـ Breadcrumbs الجديد ---
    const topAvatar = $('topAvatar');
    if(topAvatar) topAvatar.textContent = name.charAt(0);
    
    const topChildName = $('topChildName');
    if(topChildName) topChildName.textContent = name;
    
    const topChildMeta = $('topChildMeta');
    if(topChildMeta) topChildMeta.textContent = ageStr;
    
    const breadChildName = $('breadChildName');
    if(breadChildName) breadChildName.textContent = name;
    
    // --- تحديث روابط الـ Nav Pills الجديدة ---
    const qDocParams = `?child=${encodeURIComponent(childId)}${isDoctor ? `&parentId=${encodeURIComponent(parentId)}` : ''}`;
    setHref($('navMeas'), `measurements.html${qDocParams}`);
    setHref($('navMeals'), `meals.html${qDocParams}`);
    setHref($('navVisits'), `visits.html${qDocParams}`);
    setHref($('navLabs'), `labs.html${qDocParams}`);

    const unit = c.glucoseUnit || 'mg/dL';
    const limits = c.glucose_limits || {};
    const min = limits.low ?? (unit === 'mmol/L' ? 3.9 : 70);
    const max = limits.high ?? (unit === 'mmol/L' ? 10.0 : 180);
    
    const cf = c.cf ?? c.correctionFactor ?? null;
    
    const meal = currentMeal();
    const crNow = c.cr?.[meal.key] ?? c.carbRatio ?? '—';

    setText(chipRangeEl, `النطاق الطبيعي: ${min}–${max} ${unit}`);
    setText(chipCREl,    `CR (${meal.label}): ${crNow}`);
    setText(chipCFEl,    `CF: ${cf != null ? cf : '—'}`);

    setHref(goMeasurements,`measurements.html?child=${encodeURIComponent(childId)}`);
    setHref(goMeals,       `meals.html?child=${encodeURIComponent(childId)}`);
    setHref(goReports,     `reports.html?child=${encodeURIComponent(childId)}`);
    setHref(goVisits,      `visits.html?child=${encodeURIComponent(childId)}`);
    
    localStorage.setItem('selectedParentId',user.uid);
    localStorage.setItem('selectedChildId',childId);
    setHref(goChildEdit,`child-edit.html?parentId=${encodeURIComponent(user.uid)}&id=${encodeURIComponent(childId)}`);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayStrFormat = todayStr();

    const measRef  = collection(db,`parents/${user.uid}/children/${childId}/measurements`);
    const mealsRef = collection(db,`parents/${user.uid}/children/${childId}/meals`);
    const visRef   = collection(db,`parents/${user.uid}/children/${childId}/visits`);

    onSnapshot(query(measRef, where('when', '>=', startOfDay), where('when', '<', endOfDay)), (snap) => {
      setText(todayMeasuresEl, snap.size);
    });

    onSnapshot(query(mealsRef, where('date', '==', todayStrFormat)), (snap) => {
      setText(todayMealsEl, snap.size);
    });

    const snapVisit = await getDocs(query(visRef, where('date','>=',todayStrFormat), orderBy('date','asc'), limit(1)));
    let displayFollow = '—';
    if(!snapVisit.empty){
      const nf  = snapVisit.docs[0].data().date||'—';
      const due = new Date(nf);
      displayFollow = `${nf} — ${formatCountdown(new Date(), due)}`;
    }
    setText(nextVisitEl, displayFollow);

    await renderGlucoseSparkline(parentId, c);
    await renderLabCard(user.uid);
    await initBasalTracker(parentId, c);
    initEmergencyCard(user, c);
    setHref($('radarAddMeasBtn'), `measurements.html?child=${encodeURIComponent(childId)}`);

    addLabBtn?.addEventListener('click',e=>{ e.stopPropagation(); location.href=`labs.html?child=${encodeURIComponent(childId)}`; });
    openLabsBtn?.addEventListener('click',e=>{ e.stopPropagation(); location.href=`labs.html?child=${encodeURIComponent(childId)}`; });
    openLastPdfBtn?.addEventListener('click',async e=>{
      e.stopPropagation();
      const lastId=await getLastLabId(user.uid);
      if(lastId) window.open(`labs.html?child=${encodeURIComponent(childId)}&lab=${encodeURIComponent(lastId)}`,'_blank');
      else location.href=`labs.html?child=${encodeURIComponent(childId)}`;
    });

  }catch(err){ console.error(err); alert('حدث خطأ غير متوقع'); }
  finally{ loader(false); }
});

async function getLastLabId(uid){
  const sn=await getDocs(query(collection(db,`parents/${uid}/children/${childId}/labs`),orderBy('when','desc'),limit(1)));
  return sn.empty?null:sn.docs[0].id;
}

async function renderLabCard(uid){
  if(!labCard) return;
  const sn=await getDocs(query(collection(db,`parents/${uid}/children/${childId}/labs`),orderBy('when','desc'),limit(4)));
  const labs=sn.docs.map(d=>({id:d.id,...d.data()}));

  if(!labs.length){
    setText(labHba1cVal,'—'); if(labHba1cVal) labHba1cVal.className='value tone';
    setText(labHba1cDelta,'لا توجد بيانات');
    setText(labLastSince,'—'); setText(labLastDate,'—');
    setText(labDueBadge,'لا توجد تقارير بعد'); if(labDueBadge) labDueBadge.className='pill tiny';
    if(progressFill) progressFill.style.width='0%'; setText(progressLabel,'—');
    if(window._spark) window._spark.destroy(); return;
  }

  const last=labs[0], prev=labs[1]||null;
  const when=last.when?.toDate?last.when.toDate():(last.date?new Date(last.date):new Date());
  setText(labLastDate,fmt(when));
  setText(labLastSince,`${dayDiff(new Date(),when)} يوم`);
  const hba=last?.hba1c?.value;
  if(hba==null||Number.isNaN(Number(hba))){
    setText(labHba1cVal,'—'); if(labHba1cVal) labHba1cVal.className='value tone';
  } else {
    const v=Number(hba); setText(labHba1cVal,`${v.toFixed(1)}%`);
    let tone='good'; if(v>=7.5&&v<=9) tone='mid'; if(v>9) tone='bad';
    if(labHba1cVal) labHba1cVal.className=`value tone ${tone}`;
  }
  if(prev?.hba1c?.value!=null&&hba!=null){
    const pv=Number(prev.hba1c.value);
    if(!Number.isNaN(pv)){
      const diff=Number(hba)-pv; const sign=diff>0?'+':(diff<0?'−':'±');
      setText(labHba1cDelta,`مقارنة بالسابق: ${sign}${Math.abs(diff).toFixed(1)}%`);
      if(labHba1cVal) labHba1cVal.title=`السابق: ${pv.toFixed(1)}% • الفرق: ${sign}${Math.abs(diff).toFixed(1)}%`;
    }
  } else { setText(labHba1cDelta,'—'); if(labHba1cVal) labHba1cVal.title='—'; }

  const nextDue=last.nextDue?.toDate?last.nextDue.toDate():addMonths(when,4);
  const daysToDue=dayDiff(nextDue,new Date());
  if(daysToDue<0){ setText(labDueBadge,`متأخر — ${fmt(nextDue)}`); if(labDueBadge) labDueBadge.className='pill tiny bad'; }
  else if(daysToDue<=14){ setText(labDueBadge,`قرب الموعد — ${fmt(nextDue)}`); if(labDueBadge) labDueBadge.className='pill tiny warn'; }
  else { setText(labDueBadge,`التحليل القادم: ${fmt(nextDue)}`); if(labDueBadge) labDueBadge.className='pill tiny ok'; }

  const sorted=[...labs].reverse();
  const chartLabels=sorted.map(l=>{const d=l.when?.toDate?l.when.toDate():(l.date?new Date(l.date):new Date());return fmt(d);});
  const chartData=sorted.map(l=>{const v=l?.hba1c?.value;return(v==null||Number.isNaN(Number(v)))?null:Number(v);});
  if(window._spark) window._spark.destroy();
  const ctx=document.getElementById('hbaSpark')?.getContext('2d');
  if(!ctx) return;
  window._spark=new Chart(ctx,{
    type:'line',
    data:{ labels:chartLabels, datasets:[{data:chartData,borderColor:'#8E24AA',backgroundColor:'rgba(142,36,170,0.08)',pointRadius:1.5,tension:.25,fill:false,spanGaps:true}] },
    options:{ responsive:true, plugins:{legend:{display:false},tooltip:{enabled:true}}, elements:{point:{hitRadius:6}}, scales:{x:{display:false},y:{display:false,suggestedMin:5,suggestedMax:12}} }
  });
}
