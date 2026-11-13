// js/child.js 

import { app, auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js";
import { MGDL_PER_MMOL, getProtocol, labelOf } from './child-protocol.js';

/* ---- childId ---- */
const params  = new URLSearchParams(location.search);
const parentIdParam = params.get('parentId');
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
  const proto = getProtocol(child);
  const { critical_low: critLow, low, high, critical_high: critHigh } = proto.limits;

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

  const proto = getProtocol(child);
  const unit = proto.unit;
  const isMmol = unit === 'mmol/L';

  const points = snap.docs.map(d=>{
    const data = d.data();
    let val = null;
    if (isMmol) {
      if (data.value_mmol != null) val = Number(data.value_mmol);
      else if (data.unit === 'mmol/L' && data.value != null) val = Number(data.value);
      else if (data.value_mgdl != null) val = +(Number(data.value_mgdl) / MGDL_PER_MMOL).toFixed(1);
      else if (data.value != null) val = +(Number(data.value) / MGDL_PER_MMOL).toFixed(1);
    } else {
      if (data.value_mgdl != null) val = Math.round(Number(data.value_mgdl));
      else if (data.unit === 'mg/dL' && data.value != null) val = Math.round(Number(data.value));
      else if (data.value_mmol != null) val = Math.round(Number(data.value_mmol) * MGDL_PER_MMOL);
      else if (data.value != null) val = Math.round(Number(data.value) * MGDL_PER_MMOL);
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
  
  const low  = proto.limits.low;
  const high = proto.limits.high;

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

  const proto = getProtocol(child);
  const basalName = proto.insulin.basal || 'الأنسولين القاعدي';
  const basalDose = proto.insulin.basalDose;
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
        $('basalDoseInput').value = basalDose ?? '';
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
function normalizePhone(v) {
  return String(v || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[\s\-().]/g, '').replace(/^00/, '+');
}

function initEmergencyCard(user, child, ctx = {}) {
  const dialog = $('emergencyCardDialog');
  const btnOpen = $('btnEmergencyCard');
  const btnClose = $('btnCloseEmergencyCard');
  const btnPrint = $('btnPrintEmergencyCard');

  if (!dialog) return;

  const proto = getProtocol(child);
  const name = child.identity?.name || child.name || 'الطفل';
  const gender = child.identity?.gender || child.gender || '-';
  const dob = child.identity?.dob || child.birthDate || null;
  const ageStr = `${gender === 'female' ? 'أنثى' : (gender === 'male' ? 'ذكر' : gender)} • ${calcAge(dob)} سنة`;
  const unit = proto.unit;
  const min = proto.limits.low;
  const max = proto.limits.high;
  const hypoCarbs = proto.safety.hypoCarbs;

  setText($('emChildName'), name);
  setText($('emChildAge'), ageStr);
  setText($('emGlucoseRange'), `${min} - ${max} ${unit}`);

  // تحديث أرقام بروتوكول الهبوط داخل الصندوق الأصفر حسب وحدة الطفل وإعداداته
  const lowWithUnit = `${min} ${unit}`;
  const hypoText = `${hypoCarbs} جرام`;
  setText($('emLowLimit1'), lowWithUnit);
  setText($('emLowLimit2'), lowWithUnit);
  setText($('emLowLimit3'), lowWithUnit);
  setText($('emHypoGrams1'), hypoText);
  setText($('emHypoGrams2'), hypoText);

  // ولي الأمر: من بيانات الطفل (emergencyContact) ثم رقم حسابه من التسجيل
  const ec = child.emergencyContact || {};
  const parentName = ec.name || child.parentName || user.displayName || 'ولي الأمر';
  setText($('emParentName'), parentName);
  const parentPhone = ec.phone || child.parentPhone || user.phoneNumber || '';
  const pPhoneBtn = $('emParentPhoneBtn');
  const showParentPhone = (p) => {
    pPhoneBtn.href = `tel:${p}`;
    pPhoneBtn.textContent = `📞 ${p}`;
    pPhoneBtn.onclick = null;
  };
  const askParentPhone = async (e) => {
    e.preventDefault();
    const raw = prompt('أدخل رقم هاتف ولي الأمر للتواصل في الطوارئ (سيُحفظ في بيانات الطفل):');
    if (!raw) return;
    const p = normalizePhone(raw);
    if (!/^\+?\d{7,15}$/.test(p)) { alert('رقم غير صحيح. اكتب أرقاماً فقط (من 7 إلى 15 رقماً).'); return; }
    showParentPhone(p);
    try {
      if (ctx.parentId && ctx.childId) {
        await updateDoc(doc(db, 'parents', ctx.parentId, 'children', ctx.childId), { 'emergencyContact.phone': p, 'emergencyContact.name': parentName });
      }
      await setDoc(doc(db, 'users', user.uid), { phone: p }, { merge: true });
    } catch (err) {
      console.warn('save parent phone:', err);
      alert('تعذّر حفظ الرقم، وسيظهر الآن فقط. يمكنك إضافته من صفحة إعدادات الطفل.');
    }
  };
  if (pPhoneBtn) {
    if (parentPhone) {
      showParentPhone(parentPhone);
    } else {
      pPhoneBtn.href = '#';
      pPhoneBtn.textContent = '📞 غير مسجل — اضغط للإضافة';
      pPhoneBtn.onclick = askParentPhone;
      getDoc(doc(db, 'users', user.uid))
        .then(s => { const p = s.exists() ? s.data().phone : ''; if (p) showParentPhone(p); })
        .catch(() => {});
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

  // الأنسولين (من البروتوكول الموحد)
  const basal = proto.insulin.basal || 'طويل المفعول';
  const bolus = proto.insulin.bolus || 'سريع المفعول';
  const cf = proto.CF ?? '—';

  setText($('emBasalText'), basal);
  setText($('emBolusText'), bolus);
  setText($('emCFText'), String(cf));
  setText($('emHypoCarbsText'), hypoText);

  btnOpen?.addEventListener('click', () => dialog.showModal());
  btnClose?.addEventListener('click', () => dialog.close());
  btnPrint?.addEventListener('click', () => window.print());

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
    let parentId = parentIdParam || localStorage.getItem('selectedParentId') || user.uid;
    let childRef = doc(db,`parents/${parentId}/children/${childId}`);
    let snap = await getDoc(childRef);

    if (!snap.exists() && parentId !== user.uid) {
      const fallbackRef = doc(db, `parents/${user.uid}/children/${childId}`);
      const fallbackSnap = await getDoc(fallbackRef);
      if (fallbackSnap.exists()) {
        parentId = user.uid;
        childRef = fallbackRef;
        snap = fallbackSnap;
      }
    }

    if (!snap.exists()) {
      try {
        const docPatientSnap = await getDoc(doc(db, `doctors/${user.uid}/patients/${childId}`));
        if (docPatientSnap.exists() && docPatientSnap.data()?.parentId) {
          const docParentId = docPatientSnap.data().parentId;
          const docChildRef = doc(db, `parents/${docParentId}/children/${childId}`);
          const docChildSnap = await getDoc(docChildRef);
          if (docChildSnap.exists()) {
            parentId = docParentId;
            childRef = docChildRef;
            snap = docChildSnap;
          }
        }
      } catch (e) {
        console.warn('Doctor patient fallback error:', e);
      }
    }

    if(!snap.exists()){
      alert('لم يتم العثور على ملف الطفل');
      if (parentIdParam && parentIdParam !== user.uid) { location.href = 'doctor-dashboard.html'; }
      else { localStorage.removeItem('lastChildId'); location.replace('parent.html?pickChild=1'); }
      return;
    }
    const c = snap.data();
    const proto = getProtocol(c);
    const isDoctor = parentId !== user.uid;
    localStorage.setItem('selectedParentId', parentId);
    localStorage.setItem('lastChildId', childId);
    localStorage.setItem('selectedChildId', childId);

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
    
    setText(childNameEl, name);
    setText(childMetaEl, ageStr);

    const topAvatar = $('topAvatar');
    if(topAvatar) topAvatar.textContent = name.charAt(0);
    
    const topChildName = $('topChildName');
    if(topChildName) topChildName.textContent = name;
    
    const topChildMeta = $('topChildMeta');
    if(topChildMeta) topChildMeta.textContent = ageStr;
    
    const breadChildName = $('breadChildName');
    if(breadChildName) breadChildName.textContent = name;
    
    // --- تحديث روابط وأزرار الشريط العلوي وفق دور المستخدم ---
    const safeChild = encodeURIComponent(childId);
    const safeParent = encodeURIComponent(parentId);
    const qDoc = `?child=${safeChild}&parentId=${safeParent}`;
    const qChild = `?child=${safeChild}`;
    const qDocParams = isDoctor ? qDoc : qChild;
    const workstationUrl = `doctor-child.html${qDoc}`;

    const parentNav = $('parentNav');
    const doctorNav = $('doctorNav');
    const backBtn = $('backBtn');
    const breadRoot = $('breadRootLink');

    if (isDoctor) {
      if (parentNav) { parentNav.classList.add('hidden'); parentNav.style.display = 'none'; }
      if (doctorNav) { doctorNav.classList.remove('hidden'); doctorNav.style.display = 'flex'; }

      $('navDocStation')?.setAttribute('href', workstationUrl);
      $('navDocReports')?.setAttribute('href', `reports.html${qDoc}`);
      $('navDocLabs')?.setAttribute('href', `labs.html${qDoc}`);
      $('navDocVisits')?.setAttribute('href', `visits.html${qDoc}`);
      $('navDocDoses')?.setAttribute('href', `${workstationUrl}#protocolSection`);

      if (backBtn) {
        backBtn.classList.remove('hidden');
        backBtn.textContent = '🏠 رجوع للوحة العيادة';
        backBtn.onclick = () => location.href = 'doctor-dashboard.html';
      }

      if (breadRoot) {
        breadRoot.textContent = 'عيادتي (قائمة المرضى) 👨‍⚕️';
        breadRoot.href = 'doctor-dashboard.html';
      }
      if (breadChildName) {
        breadChildName.href = workstationUrl;
      }
    } else {
      if (doctorNav) { doctorNav.classList.add('hidden'); doctorNav.style.display = 'none'; }
      if (parentNav) { parentNav.classList.remove('hidden'); parentNav.style.display = 'flex'; }

      $('navHome')?.setAttribute('href', `child.html${qChild}`);
      $('navMeas')?.setAttribute('href', `measurements.html${qChild}`);
      $('navMeals')?.setAttribute('href', `meals.html${qChild}`);
      $('navReports')?.setAttribute('href', `reports.html${qChild}`);
      $('navLabs')?.setAttribute('href', `labs.html${qChild}`);
      $('navVisits')?.setAttribute('href', `visits.html${qChild}`);

      if (backBtn) {
        backBtn.classList.add('hidden');
      }

      if (breadRoot) {
        breadRoot.textContent = 'أطفالي 👨‍👩‍👧‍👦';
        breadRoot.href = 'parent.html';
      }
      if (breadChildName) {
        breadChildName.href = `child.html${qChild}`;
      }
    }

    const unit = proto.unit;
    const min = proto.limits.low;
    const max = proto.limits.high;
    const cf = proto.CF;
    const meal = currentMeal();
    const crNow = proto.CR[meal.key] ?? '—';

    setText(chipRangeEl, `النطاق الطبيعي: ${min}–${max} ${unit}`);
    setText(chipCREl,    `CR (${meal.label}): ${crNow}`);
    setText(chipCFEl,    `CF: ${cf != null ? cf : '—'}`);

    setHref(goMeasurements,`measurements.html${qDocParams}`);
    setHref(goMeals,       `meals.html${qDocParams}`);
    setHref(goReports,     `reports.html${qDocParams}`);
    setHref(goVisits,      `visits.html${qDocParams}`);
    setHref(goChildEdit,   `child-edit.html?parentId=${encodeURIComponent(parentId)}&id=${encodeURIComponent(childId)}`);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayStrFormat = todayStr();

    const measRef  = collection(db,`parents/${parentId}/children/${childId}/measurements`);
    const mealsRef = collection(db,`parents/${parentId}/children/${childId}/meals`);
    const visRef   = collection(db,`parents/${parentId}/children/${childId}/visits`);

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
    await renderLabCard(parentId);
    await initBasalTracker(parentId, c);
    initEmergencyCard(user, c, { parentId, childId });
    setHref($('radarAddMeasBtn'), `measurements.html${qDocParams}`);
    await initAiAssistant(parentId, c);

    addLabBtn?.addEventListener('click',e=>{ e.stopPropagation(); location.href=`labs.html${qDocParams}`; });
    openLabsBtn?.addEventListener('click',e=>{ e.stopPropagation(); location.href=`labs.html${qDocParams}`; });
    openLastPdfBtn?.addEventListener('click',async e=>{
      e.stopPropagation();
      const lastId=await getLastLabId(parentId);
      if(lastId) window.open(`labs.html${qDocParams}&lab=${encodeURIComponent(lastId)}`,'_blank');
      else location.href=`labs.html${qDocParams}`;
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
  window._aiLastHba1c = (hba!=null && !Number.isNaN(Number(hba))) ? { value: Number(hba).toFixed(1), date: fmt(when) } : null;

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

/* ============================================================================
   🤖 مساعد أسيل الطبي الذكي (Context-Aware AI Medical Chat Assistant)
   - يقرأ ملف الطفل عبر البروتوكول الموحد (child-protocol.js) بدون قيم افتراضية صامتة
============================================================================ */

const AI_DISCLAIMER_TEXT = '⚠️ تنبيه طبي هام: هذا الشات استرشادي وتعليمي فقط بناءً على المعطيات المسجلة لطفلك، ولا يُغني بأي حال عن استشارة الطبيب المعالج قبل اتخاذ أي قرار طبي أو تعديل في جرعات الأنسولين.';

let _aiChatHistory = [];
let _aiCurrentChild = null;
let _aiParentId = null;
let _aiMealBolusAvg = 0;
try { localStorage.removeItem('aseel_gemini_key'); } catch (e) {}
const askGemini = httpsCallable(getFunctions(app, 'europe-west1'), 'askGemini', { timeout: 25000 });

let _aiPresetMeals = [];
let _aiCommonFoodNames = [];
let _aiFavoriteFoodNames = [];

async function computeRecentBolusStats(uid) {
  try {
    const mealsRef = collection(db, `parents/${uid}/children/${childId}/meals`);
    const snap = await getDocs(query(mealsRef, orderBy('date', 'desc'), limit(30)));
    if (snap.empty) {
      _aiMealBolusAvg = 0;
    } else {
      const byDate = {};
      const foodFreq = {};
      snap.docs.forEach(d => {
        const m = d.data();
        const dt = m.date || 'unknown';
        const dose = Number(m.totalDose ?? m.insulinUnits ?? m.recommendedDose ?? 0) || 0;
        byDate[dt] = (byDate[dt] || 0) + dose;

        const items = m.items || m.foodItems || [];
        if (Array.isArray(items)) {
          items.forEach(it => {
            const name = it.name || it.foodName || it.title;
            if (name) foodFreq[name] = (foodFreq[name] || 0) + 1;
          });
        }
      });
      const days = Object.keys(byDate);
      if (days.length) {
        const total = days.reduce((acc, k) => acc + byDate[k], 0);
        _aiMealBolusAvg = +(total / days.length).toFixed(1);
      }
      _aiCommonFoodNames = Object.entries(foodFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(entry => entry[0]);
    }
  } catch (e) {
    _aiMealBolusAvg = 0;
  }

  try {
    const presetsSnap = await getDocs(collection(db, `parents/${uid}/children/${childId}/presetMeals`));
    if (!presetsSnap.empty) {
      _aiPresetMeals = presetsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch(e){}

  try {
    const favsRaw = localStorage.getItem(`fav_foods_${childId}`);
    if (favsRaw) {
      const parsed = JSON.parse(favsRaw);
      if (Array.isArray(parsed)) _aiFavoriteFoodNames = parsed;
    }
  } catch(e){}
}

// يقرأ البروتوكول عبر getProtocol الموحد دون تخمين أي معامل علاجي ناقص
function getChildClinicalProfile(child) {
  const proto = getProtocol(child);
  const unit = proto.unit;
  const isMmol = unit === 'mmol/L';
  const name = child.identity?.name || child.name || 'الطفل';
  const dob = child.identity?.dob || child.birthDate || null;
  const age = calcAge(dob);
  const genderRaw = child.identity?.gender || child.gender || '';
  const gender = genderRaw === 'female' ? 'أنثى' : (genderRaw === 'male' ? 'ذكر' : 'غير محدد');
  const weight = proto.weightKg;

  const { critical_low: critLow, low, high, critical_high: critHigh } = proto.limits;
  const target = proto.target; // null إذا كان غير محدد (لا نخمّن)

  const crBreakfast = proto.CR.breakfast;
  const crLunch = proto.CR.lunch;
  const crDinner = proto.CR.dinner;
  const crSnack = proto.CR.snack;
  const mealNow = currentMeal();
  const activeCR = proto.CR[mealNow.key] ?? null; // null إذا لم يُحدد لهذه الوجبة

  const cf = proto.CF; // null إذا كان غير محدد

  const basalType = proto.insulin.basal || 'طويل المفعول (قاعدي)';
  const basalDose = proto.insulin.basalDose;
  const bolusType = proto.insulin.bolus || 'سريع المفعول';
  const hypoCarbs = proto.safety.hypoCarbs;
  const doctorNote = child.doctor_note || '';

  const tdd = basalDose ? +(basalDose + (_aiMealBolusAvg || basalDose)).toFixed(1) : null;
  const tddPerKg = (tdd && weight) ? +(tdd / weight).toFixed(2) : null;
  const basalPct = (tdd && basalDose) ? Math.round((basalDose / tdd) * 100) : null;

  return {
    name, age, gender, weight,
    unit, isMmol, unitMissing: proto.unitMissing,
    low, high, critLow, critHigh, target,
    crBreakfast, crLunch, crDinner, crSnack, activeCR, mealNowKey: mealNow.key, mealNowLabel: mealNow.label,
    cf, basalType, basalDose, bolusType, hypoCarbs, doctorNote,
    missingKeys: proto.missing,
    missingLabels: proto.missing.map(labelOf),
    bolusAvg: _aiMealBolusAvg, tdd, tddPerKg, basalPct,
    stats: window._aiGlucoseStats || { hasData: false },
    hba1c: window._aiLastHba1c || null,
    dietary: {
      presetMeals: _aiPresetMeals,
      commonFoods: _aiCommonFoodNames,
      favoriteFoods: _aiFavoriteFoodNames
    }
  };
}

function formatAiMarkdown(text) {
  if (!text) return '';
  let safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  safe = safe.replace(/⚠️\s*تنبيه طبي هام:[\s\S]*$/g, '').trim();

  safe = safe.replace(/^###\s+(.+)$/gm, '<h5>$1</h5>');
  safe = safe.replace(/^##\s+(.+)$/gm, '<h5>$1</h5>');
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const lines = safe.split('\n');
  let html = '';
  let inList = false;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('• ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.slice(2).trim()}</li>`;
    } else if (/^\d+[\.|\)]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^\d+[\.|\)]\s+/, '')}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.startsWith('<h5>')) html += line;
      else html += `<p>${line}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function appendAiMessage(role, contentHtml, includeDisclaimer = true) {
  const container = $('aiChatMessages');
  if (!container) return;

  const msgEl = document.createElement('div');
  msgEl.className = `ai-msg ${role}`;

  if (role === 'user') {
    const body = document.createElement('div');
    body.className = 'ai-msg-body';
    body.textContent = contentHtml;
    msgEl.appendChild(body);
  } else {
    const body = document.createElement('div');
    body.className = 'ai-msg-body';
    body.innerHTML = contentHtml;
    msgEl.appendChild(body);

    if (includeDisclaimer) {
      const disc = document.createElement('div');
      disc.className = 'ai-medical-disclaimer';
      disc.textContent = AI_DISCLAIMER_TEXT;
      msgEl.appendChild(disc);
    }
  }

  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

function showAiTyping(show) {
  const container = $('aiChatMessages');
  if (!container) return;
  const existing = $('aiTypingIndicator');
  if (existing) existing.remove();

  if (show) {
    const typing = document.createElement('div');
    typing.id = 'aiTypingIndicator';
    typing.className = 'ai-typing';
    typing.innerHTML = `<span>جاري تحليل بيانات الطفل</span><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }
}

/* ---- بناء موجه النظام الطبي لـ Gemini Cloud AI ---- */
function buildGeminiSystemPrompt(p) {
  const s = p.stats;
  const statsSummary = s.hasData
    ? `- عدد القراءات المحللة: ${s.count} قراءة
- آخر قراءة مسجلة: ${s.lastVal} ${p.unit} (${s.lastLabel} - ${s.lastTimeAgo})
- متوسط السكر العام: ${s.allMean} ${p.unit} (متوسط اليوم: ${s.todayAvg} ${p.unit})
- نسبة الوقت داخل النطاق المستهدف (TIR): ${s.tir}%
- نسبة الهبوط (TBR < ${p.low} ${p.unit}): ${s.tbr}% (منها هبوط حرج < ${p.critLow} ${p.unit}: ${s.tbrCrit}%)
- نسبة الارتفاع (TAR > ${p.high} ${p.unit}): ${s.tar}% (منها ارتفاع حرج > ${p.critHigh} ${p.unit}: ${s.tarCrit}%)
- معامل التذبذب (CV%): ${s.cvPct}% (المثالي أقل من 36%)
- أدنى قراءة: ${s.minVal} ${p.unit} | أعلى قراءة: ${s.maxVal} ${p.unit}
- هبوط ليلي (12 ص - 6 ص): ${s.nightHypos} مرات | ارتفاع صباحي (5 ص - 9 ص): ${s.morningHighs} مرات | ارتفاع بعد الوجبات: ${s.postMealHighs} مرات`
    : 'لا توجد قراءات مسجلة كافية بعد في سجل القياسات.';

  return `أنت "مساعد أسيل الطبي الذكي"، مستشار طبي افتراضي متخصص في سكري الأطفال من النوع الأول (Type 1 Diabetes) داخل منصة أسيل.
مهمتك: الإجابة على أسئلة ولي الأمر بدقة طبية عالية، بلغة عربية واضحة ومطمئنة، مع ربط الإجابة مباشرة ببيانات وتحليلات الطفل المذكورة أدناه.

[قاعدة صارمة جداً بخصوص وحدة القياس وعدم تخمين المعاملات]:
- وحدة القياس المختارة في إعدادات هذا الطفل هي: **${p.unit}** فقط.
- النطاق المستهدف لهذا الطفل هو: **${p.low} إلى ${p.high} ${p.unit}**، والهدف التصحيحي: **${p.target ? p.target + ' ' + p.unit : 'غير محدد بعد في الإعدادات'}**.
- معاملات ناقصة في ملف الطفل حالياً: ${p.missingLabels.length ? p.missingLabels.join('، ') : 'لا يوجد (جميع المعاملات مكتملة)'}.
- تحذير حاسم: إذا كان معامل الكارب للوجبة أو معامل التصحيح (CF) أو هدف السكر (target) "غير محدد"، لا تخمّن أي رقم افتراضي ولا تحسب جرعة افتراضية أبداً، بل أخبر ولي الأمر بلطف بضرورة تحديده في صفحة إعدادات الطفل أو مع الطبيب المعالج أولاً.

[ملف الطفل الطبي الحالي]:
- الاسم: ${p.name} | العمر: ${p.age} سنة | النوع: ${p.gender} | الوزن: ${p.weight ? p.weight + ' كجم' : 'غير مسجل'}
- الأنسولين القاعدي: ${p.basalType} | الجرعة اليومية: ${p.basalDose ? p.basalDose + ' وحدة' : 'غير محددة'}
- الأنسولين السريع: ${p.bolusType} | متوسط جرعات الوجبات اليومي: ${p.bolusAvg ? p.bolusAvg + ' وحدة' : 'غير محدد'}
- معامل الكارب (CR): الفطور=${p.crBreakfast || 'غير محدد'}، الغداء=${p.crLunch || 'غير محدد'}، العشاء=${p.crDinner || 'غير محدد'}، السناك=${p.crSnack || 'غير محدد'} (المعامل النشط الآن لوجبة ${p.mealNowLabel}: ${p.activeCR ? '1 وحدة لكل ' + p.activeCR + ' جرام كارب' : 'غير محدد'})
- معامل التصحيح (CF): ${p.cf ? '1 وحدة تخفض السكر بمقدار ' + p.cf + ' ' + p.unit : 'غير محدد'}
- كارب علاج الهبوط المعتمد للطفل: ${p.hypoCarbs} جرام سكريات سريعة
- آخر تحليل تراكمي (HbA1c): ${p.hba1c ? `${p.hba1c.value}% (بتاريخ ${p.hba1c.date})` : 'غير مسجل'}
- ملاحظة الطبيب المعالج المباشرة: ${p.doctorNote || 'لا توجد'}

[تحليل قراءات الجلوكوز الحية للطفل]:
${statsSummary}

[قواعد الرد الإلزامية]:
- كلّم ولي الأمر بلغته (عامية مصرية مبسّطة أو عربية ميسّرة)، وابدأ بالإجابة المباشرة في سطر أو سطرين.
- إن كانت معلومة أساسية ناقصة لا يمكن الإجابة بدونها، اسأل سؤالاً واحداً قصيراً أو وجّه لاستكمال الإعداد الناقص بدل التخمين.
- الرقم المقترن بـ(جرام/جم/غ) بجوار اسم صنف أو عبوة هو **وزن الصنف** وليس كمية الكارب.
- لا تكتب نص التحذير الطبي في ردك لأن النظام يضيفه تلقائياً.`;
}

async function callGeminiCloudApi(userText, profile) {
  const sysInstruction = buildGeminiSystemPrompt(profile);
  const contents = [];

  const recentHistory = _aiChatHistory.slice(-6);
  for (const item of recentHistory) {
    contents.push({
      role: item.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(item.text || '').slice(0, 5500) }]
    });
  }
  while (contents.length && contents[0].role === 'model') contents.shift();
  contents.push({
    role: 'user',
    parts: [{ text: String(userText || '').slice(0, 5500) }]
  });

  try {
    const out = await askGemini({
      feature: 'child_assistant',
      systemInstruction: sysInstruction,
      contents,
      temperature: 0.6,
      maxOutputTokens: 1200
    });
    const reply = out?.data?.text;
    if (reply && reply.trim()) return reply.trim();
  } catch (e) {
    console.warn('askGemini:', e?.code || e);
  }
  return null;
}

/* ---- المحرك السريري الذكي المدمج (Built-in Clinical Expert Engine) ---- */

function generateSmartMealSuggestions(qLower, p) {
  const u = p.unit;
  const bolusType = p.bolusType;
  let slotTitle = p.mealNowLabel;
  let activeRatio = p.activeCR;

  if (/فطور|فطار|صباح/.test(qLower)) {
    slotTitle = 'الفطور';
    activeRatio = p.crBreakfast;
  } else if (/غداء|غدا/.test(qLower)) {
    slotTitle = 'الغداء';
    activeRatio = p.crLunch;
  } else if (/عشاء|عشا|مساء/.test(qLower)) {
    slotTitle = 'العشاء';
    activeRatio = p.crDinner;
  } else if (/سناك|خفيف|تصبيرة|بين الوجبات/.test(qLower)) {
    slotTitle = 'السناك الخفيف';
    activeRatio = p.crSnack;
  }

  const doseLabel = (carbs) => activeRatio ? ` ⬅️ جرعة ${+(carbs / activeRatio).toFixed(1)} وحدة ${bolusType}` : ' (حدد معامل الكارب CR في الإعدادات لحساب الجرعة)';

  let suggestionsBody = '';
  if (slotTitle === 'الفطور') {
    suggestionsBody = `
- **الخيار 1: الفطور الشعبي المتوازن (25g كارب${doseLabel(25)})**
  - نصف رغيف خبز بلدي أسمر (20g كارب) + 2 بيضة مسلوقة أو قطعة جبن قريش بزيت زيتون (0g) + طبق شرائح خيار وخس وطماطم (5g).
- **الخيار 2: فطور الفول المشبع بالألياف (35g كارب${doseLabel(35)})**
  - 4 ملاعق كبيرة فول مدمس بالكمون والليمون (15g) + نصف رغيف بلدي (20g) + بيضة مسلوقة (0g).
- **الخيار 3: وعاء الشوفان والحليب الدافئ (25g كارب${doseLabel(25)})**
  - 3 ملاعق شوفان حبة كاملة (15g) + نصف كوب حليب قليل الدسم (6g) + رشة قرفة ونصف تفاحة مقطعة (8g) ومكسرات نيئة.`;
  } else if (slotTitle === 'الغداء') {
    suggestionsBody = `
- **الخيار 1: الأرز مع الدجاج والملوخية (35g كارب${doseLabel(35)})**
  - 6 ملاعق أرز أبيض أو بسمتي مطبوخ (25g كارب) + طبق ملوخية بيتي بدون سكر (4g) + ربع دجاجة مشوية أو مسلوقة (0g) + طبق سلطة ملونة بزيت زيتون (6g).
- **الخيار 2: صينية السمك المشوي والخضار (30g كارب${doseLabel(30)})**
  - سمكة بلطي أو بوري مشوية بالردة (0g) + 5 ملاعق أرز صيادية (22g) + طبق سلطة خضراء وطحينة خفيفة (8g).
- **الخيار 3: مكرونة مع كفتة مشوية (45g كارب${doseLabel(45)})**
  - طبق مكرونة مسلوقة بصلصة الطماطم الخفيفة (35g) + 3 أصابع كفتة لحم مشوية بالفرن (2g) + سلطة جرجير وخيار وفجل (5g).`;
  } else if (slotTitle === 'العشاء') {
    suggestionsBody = `
- **الخيار 1: عشاء خفيف يحمي من هبوط الفجر (20g كارب${doseLabel(20)})**
  - كوب زبادي طبيعي أو لبن رايب (10g) + ملعقة بذور شيا أو شوفان (5g) + ربع رغيف بلدي مع بيضة مسلوقة أو قطعة جبن (10g).
- **الخيار 2: سندوتش توست الحبوب الكاملة (25g كارب${doseLabel(25)})**
  - 2 شريحة توست بني بحبوب كاملة (20g) + شرائح جبن شيدر أو بيض أومليت (0g) + شرائح خيار وجزر (5g).`;
  } else {
    suggestionsBody = `
- **سناك 1 (15g كارب${doseLabel(15)}):** كوب ونصف فشار منزلي بزيت خفيف (15g) + حفنة سوداني أو مكسرات نيئة.
- **سناك 2 (15g كارب${doseLabel(15)}):** ثمرة تفاح متوسطة أو برتقالة (15g) مع ملعقة صغيرة زبدة فول سوداني طبيعية.`;
  }

  return `### 🥗 مقترحات وجبات متوازنة لـ ${p.name} (${slotTitle})\n` +
    `**معامل الكارب المعتمد لهذه الوجبة:** ${activeRatio ? `1 وحدة أنسولين (${bolusType}) لكل **${activeRatio} جرام كارب**` : '⚠️ غير محدد بعد في إعدادات الطفل'}.\n\n` +
    suggestionsBody +
    `\n\n### 🩺 إرشادات ذهبية لحماية سكر ${p.name} بعد الوجبة:\n` +
    `1. **القياس قبل الأكل:** قِس السكر بوحدة **${u}**؛ إذا كان في النطاق (${p.low}–${p.high} ${u}) احقن جرعة الوجبة فقط قبل الأكل بـ 10–15 دقيقة.\n` +
    `2. **ترتيب الأكل:** ابدأ بالخضار والسلطة والبروتين، ثم النشويات.`;
}

function aiNormalizeDigits(t) {
  return String(t || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}
function aiNormAr(t) {
  return String(t || '').toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

const AI_FOOD_CARBS = [
  { keys: ['زبادي', 'روب'], name: 'زبادي سادة', c: 5, alt: { when: /(فواكه|فاكهه|نكهه|فراوله|محلي|عسل|بالسكر)/, name: 'زبادي بنكهة/محلى', c: 14 } },
  { keys: ['لبن', 'حليب'], name: 'لبن', c: 5 },
  { keys: ['ارز', 'رز'], name: 'أرز مطبوخ', c: 28 },
  { keys: ['مكرونه', 'معكرونه', 'باستا', 'اسباجيتي'], name: 'مكرونة مطبوخة', c: 27 },
  { keys: ['عيش بلدي', 'خبز بلدي'], name: 'عيش بلدي', c: 50 },
  { keys: ['فينو', 'عيش فينو'], name: 'عيش فينو', c: 50 },
  { keys: ['توست'], name: 'توست', c: 47 },
  { keys: ['عيش', 'خبز'], name: 'عيش/خبز', c: 50 },
  { keys: ['بطاطس مقليه', 'فرايز', 'بطاطس محمره'], name: 'بطاطس مقلية', c: 40 },
  { keys: ['شيبسي', 'شيبس'], name: 'شيبسي', c: 53 },
  { keys: ['بطاطس', 'بطاطا'], name: 'بطاطس مسلوقة', c: 20 },
  { keys: ['عدس'], name: 'عدس مطبوخ', c: 20 },
  { keys: ['فول'], name: 'فول مدمس', c: 12 },
  { keys: ['حمص'], name: 'حمص مطبوخ', c: 27 },
  { keys: ['تفاح'], name: 'تفاح', c: 14 },
  { keys: ['موز'], name: 'موز', c: 23 },
  { keys: ['برتقال'], name: 'برتقال', c: 12 },
  { keys: ['مانجو', 'مانجا'], name: 'مانجو', c: 15 },
  { keys: ['عنب'], name: 'عنب', c: 17 },
  { keys: ['بطيخ'], name: 'بطيخ', c: 8 },
  { keys: ['فراوله'], name: 'فراولة', c: 8 },
  { keys: ['تمر'], name: 'تمر', c: 75 },
  { keys: ['عصير'], name: 'عصير فواكه', c: 11 },
  { keys: ['كولا', 'بيبسي', 'مشروب غازي', 'سفن اب'], name: 'مشروب غازي', c: 11 },
  { keys: ['شوكولاته', 'شيكولاته'], name: 'شوكولاتة', c: 57 },
  { keys: ['بسكويت', 'بسكوت'], name: 'بسكويت', c: 68 },
  { keys: ['كيك', 'كعك'], name: 'كيك', c: 50 },
  { keys: ['ايس كريم', 'جيلاتي'], name: 'آيس كريم', c: 24 },
  { keys: ['عسل'], name: 'عسل', c: 82 },
  { keys: ['سكر ابيض', 'سكر مكعب', 'مكعبات سكر', 'ملعقه سكر', 'معلقه سكر'], name: 'سكر', c: 100 },
  { keys: ['بيتزا'], name: 'بيتزا', c: 33 },
  { keys: ['بيض', 'فراخ', 'دجاج', 'لحمه', 'لحم', 'سمك', 'جبنه', 'جبن'], name: 'بروتين (بدون كارب تقريباً)', c: 1 },
].map(f => ({ ...f, keys: f.keys.map(aiNormAr) }));

function aiExtractExplicitCarbs(q) {
  const t = aiNormalizeDigits(q).replace(/،/g, ' ');
  const word = '(?:كارب|جارب|كربوهيدرات|كربو|نشويات|carbs?)';
  let m = t.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:جرام|جم|غرام|غ|g|gm)?\\s*(?:من\\s*ال)?\\s*' + word, 'i'));
  if (m) return +m[1];
  m = t.match(new RegExp(word + '\\s*(?:الوجبه|الوجبة|الاكل|الأكل)?\\s*(?:=|:|هو|هي|حوالي|تقريبا|تقريباً|يعني)?\\s*(\\d+(?:\\.\\d+)?)', 'i'));
  if (m) return +m[1];
  return null;
}

function aiExtractFoodWeight(q) {
  const t = aiNormalizeDigits(q);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:جرامات|جرام|جم|غرام|غ|gm|gr|g)(?![\u0600-\u06FFA-Za-z])/i);
  if (!m) return null;
  const grams = +m[1];
  const nq = aiNormAr(t);
  const tokens = nq.split(/[^\u0600-\u06FFa-z0-9]+/).filter(Boolean);
  const stripPrefix = w => {
    let x = w.replace(/^(وال|بال|لل|فال|كال|ال)/, '');
    if (x === w && w.length > 3) x = w.replace(/^[وبلف]/, '');
    return x;
  };
  const variants = new Set();
  tokens.forEach(w => { variants.add(w); variants.add(stripPrefix(w)); });
  const joined = ' ' + tokens.join(' ') + ' ';
  let best = null, bestLen = 0;
  for (const f of AI_FOOD_CARBS) {
    for (const k of f.keys) {
      const hit = k.includes(' ') ? joined.includes(' ' + k + ' ') : variants.has(k);
      if (k && hit && k.length > bestLen) { best = f; bestLen = k.length; }
    }
  }
  if (!best) return { grams, food: null };
  const food = (best.alt && best.alt.when.test(nq)) ? best.alt : best;
  return { grams, food: { name: food.name, c: food.c } };
}

function generateSmartClinicalReply(userText, p) {
  const q = aiNormalizeDigits(userText.trim());
  const qLower = q.toLowerCase();
  const s = p.stats;
  const u = p.unit;
  const isMmol = p.isMmol;

  const numMatches = q.match(/(\d+(?:\.\d+)?)/g);
  const hasCarbWord = /(كارب|نشويات|جرام|غ|وجب|اكل|أكل|ياكل|يأكل)/.test(qLower);
  const hasBgWord = /(سكر|قراء|قياس|لقيته|وصل|دلوقتي|الان|الآن|تصحيح|جرع|هبوط|عالي|مرتفع|منخفض)/.test(qLower);

  if (numMatches && numMatches.length > 0 && (hasBgWord || hasCarbWord)) {
    const nums = numMatches.map(Number).filter(n => !isNaN(n) && n > 0);
    let bgVal = null;
    let carbVal = aiExtractExplicitCarbs(q);
    let convertedNote = '';
    const usedNums = new Set();
    let foodInfo = null;
    let weightOnly = null;
    if (carbVal !== null) usedNums.add(carbVal);

    if (carbVal === null) {
      const fw = aiExtractFoodWeight(q);
      if (fw) {
        usedNums.add(fw.grams);
        if (fw.food) {
          carbVal = +(fw.grams * fw.food.c / 100).toFixed(1);
          foodInfo = { grams: fw.grams, name: fw.food.name };
        } else {
          weightOnly = fw;
        }
      }
    }

    if (hasBgWord) {
      for (const n of nums) {
        if (!usedNums.has(n)) { bgVal = n; break; }
      }
    }

    if (weightOnly && carbVal === null && bgVal === null) {
      return `الرقم **${weightOnly.grams} جرام** ده وزن الصنف مش كمية الكارب. 🙂\nقولّي اسم الصنف وأقدّر الكارب، أو اكتب الكارب صراحةً (مثال: \`كارب 15\`) وأحسبلك الجرعة.`;
    }

    if (bgVal !== null) {
      if (isMmol && bgVal >= 35) {
        const converted = +(bgVal / MGDL_PER_MMOL).toFixed(1);
        convertedNote = `💡 *ملاحظة وحدة القياس:* الرقم المدخل (${bgVal}) يبدو بوحدة \`mg/dL\`، وبما أن ملف **${p.name}** مضبوط على وحدة **\`mmol/L\`** فقد قمت بتحويله تلقائياً إلى **${converted} mmol/L**.\n\n`;
        bgVal = converted;
      } else if (!isMmol && bgVal > 0 && bgVal <= 28 && !hasCarbWord) {
        const converted = Math.round(bgVal * MGDL_PER_MMOL);
        convertedNote = `💡 *ملاحظة وحدة القياس:* الرقم المدخل (${bgVal}) يبدو بوحدة \`mmol/L\`، وبما أن ملف **${p.name}** مضبوط على وحدة **\`mg/dL\`** فقد قمت بتحويله تلقائياً إلى **${converted} mg/dL**.\n\n`;
        bgVal = converted;
      }

      let resp = convertedNote + `### 🩺 تحليل القراءة الفورية لـ ${p.name} (${bgVal} ${u})\n`;
      if (bgVal < p.low) {
        const isCrit = bgVal <= p.critLow;
        resp += `- **الحالة:** ${isCrit ? '🚨 **هبوط حرج في السكر!**' : '⚠️ **هبوط في السكر (أقل من ' + p.low + ' ' + u + ')**'}\n`;
        resp += `- **يُمنع إعطاء أنسولين الآن منعاً باتاً.**\n`;
        resp += `- **الخطوة 1 (قاعدة 15-15):** أعطِ الطفل فوراً **${p.hypoCarbs} جرام سكريات سريعة الامتصاص**.\n`;
        resp += `- **الخطوة 2:** انتظر **15 دقيقة** ثم أعد القياس؛ إذا ظل السكر أقل من **${p.low} ${u}** كرر إعطاء **${p.hypoCarbs} جرام**.\n`;
        return resp;
      }

      if (bgVal > p.high) {
        resp += `- **الحالة:** ${bgVal >= p.critHigh ? '🚨 **ارتفاع شديد يحتاج متابعة الكيتون**' : '⬆️ **ارتفاع فوق النطاق المستهدف (' + p.low + '–' + p.high + ' ' + u + ')**'}\n`;
        if (!p.cf || !p.target) {
          const miss = [!p.cf ? 'معامل التصحيح (CF)' : null, !p.target ? 'هدف السكر' : null].filter(Boolean).join(' و');
          resp += `- ⚠️ **لا يمكن حساب جرعة التصحيح تلقائياً:** ينقص تحديد **${miss}** في إعدادات ملف الطفل. يرجى استكماله من إعدادات الطفل أو مراجعة الطبيب.\n`;
          return resp;
        }
        const diff = Math.max(0, bgVal - p.target);
        const rawCorr = diff / p.cf;
        const corrRounded = Math.round(rawCorr * 2) / 2;
        const mealDose = (carbVal && p.activeCR) ? +(carbVal / p.activeCR).toFixed(1) : 0;
        const totalSuggested = +(rawCorr + mealDose).toFixed(1);

        resp += `- **الهدف التصحيحي في ملف الطفل:** ${p.target} ${u} | **معامل التصحيح (CF):** 1 وحدة لكل ${p.cf} ${u}\n`;
        resp += `- **جرعة التصحيح الحسابية:** \`(${bgVal} - ${p.target}) ÷ ${p.cf}\` = **${rawCorr.toFixed(1)} وحدة** (تُقرّب إلى **${corrRounded} وحدة** من ${p.bolusType}).\n`;
        if (carbVal) {
          if (p.activeCR) {
            resp += `- **جرعة الوجبة (${carbVal} جرام كارب على معامل ${p.activeCR}):** **${mealDose} وحدة**.\n`;
            resp += `- **إجمالي الجرعة المقترحة (وجبة + تصحيح):** **${totalSuggested} وحدة** تقريباً.\n`;
          } else {
            resp += `- ⚠️ نسبة الكارب لوجبة ${p.mealNowLabel} غير محددة في الإعدادات لحساب جرعة الأكل.\n`;
          }
        }
        return resp;
      }

      resp += `- **الحالة:** ✅ **ممتاز! القراءة داخل النطاق المستهدف (${p.low}–${p.high} ${u}).**\n`;
      resp += `- **جرعة التصحيح:** **0 وحدة** (لا يحتاج لتصحيح).\n`;
      if (carbVal) {
        if (p.activeCR) {
          const mealDose = +(carbVal / p.activeCR).toFixed(1);
          resp += `- **جرعة الوجبة (${carbVal} جرام كارب ÷ معامل ${p.mealNowLabel} ${p.activeCR}):** **${mealDose} وحدة** من ${p.bolusType}.`;
        } else {
          resp += `- ⚠️ يرجى تحديد نسبة الكارب (CR) لوجبة ${p.mealNowLabel} في إعدادات الطفل لحساب جرعة الوجبة.`;
        }
      }
      return resp;
    }

    if (carbVal !== null) {
      const head = foodInfo
        ? `**${foodInfo.grams} جم ${foodInfo.name} ≈ ${carbVal} جم كارب** _(تقدير، راجع الملصق الغذائي)_`
        : `**${carbVal} جم كارب**`;

      if (!p.activeCR) {
        return `${head}\n⚠️ لم يتم تحديد **نسبة الكارب (CR) لوجبة ${p.mealNowLabel}** في إعدادات ${p.name} بعد؛ أكمليها من إعدادات الطفل لأحسب لكِ الجرعة بدقة.`;
      }

      const mealDose = +(carbVal / p.activeCR).toFixed(1);
      const mealRounded = Math.round(mealDose * 2) / 2;
      if (carbVal > 150 || mealDose > 15) {
        return `⚠️ **${carbVal} جرام كارب** (جرعة ≈ ${mealDose} وحدة) رقم كبير جداً لوجبة واحدة.\nتأكد أن الرقم **كارب فعلاً** وليس وزن الصنف، وراجع الطبيب قبل أي جرعة.`;
      }

      return `${head}\nالجرعة لـ ${p.name}: ${carbVal} ÷ ${p.activeCR} = **${mealDose} وحدة** (≈ ${mealRounded}) ${p.bolusType}.\n💡 قِس السكر قبل الأكل بـ ${u}؛ لو فوق **${p.high} ${u}** تُضاف جرعة تصحيح.`;
    }
  }

  if (/(قاعدي|ترسيبا|لانتوس|توجيو|وزن|كجم|تراكم|tdd|طويل المفعول)/.test(qLower)) {
    let resp = `### ⚖️ تقييم الأنسولين القاعدي ومقارنته بوزن ${p.name}\n`;
    resp += `- **نوع القاعدي المسجل:** ${p.basalType}\n`;
    resp += `- **جرعة القاعدي اليومية:** ${p.basalDose ? `**${p.basalDose} وحدة/يوم**` : 'غير مسجلة بعد في الإعدادات'}\n`;
    resp += `- **وزن الطفل:** ${p.weight ? `**${p.weight} كجم**` : 'غير مسجل بعد في الإعدادات'}\n`;
    if (p.basalDose && p.weight) {
      const basalPerKg = +(p.basalDose / p.weight).toFixed(2);
      resp += `- **نسبة القاعدي للوزن:** **${basalPerKg} وحدة/كجم/يوم**.\n`;
    }
    return resp;
  }

  if (/(وجب|اقترح|فطور|غداء|عشاء|سناك|طعام|أكل|اكل|تغذية)/.test(qLower)) {
    return generateSmartMealSuggestions(qLower, p);
  }

  let reply = `### 💡 إجابة مباشرة لـ **${p.name}**:\n`;
  if (s.hasData && s.lastVal != null) {
    reply += `- آخر قراءة مسجلة: **${s.lastVal} ${u}** (${s.lastLabel} • ${s.lastTimeAgo}).\n`;
  }
  reply += `- **معامل الكارب الحالي (${p.mealNowLabel}):** ${p.activeCR ? `1 وحدة لكل **${p.activeCR}g كارب**` : 'غير محدد'} | **التصحيح:** ${p.cf ? `1 وحدة لكل **${p.cf} ${u}**` : 'غير محدد'}.\n`;
  if (p.missingLabels.length) {
    reply += `- ⚠️ **إعدادات تحتاج استكمالاً في ملف الطفل:** (${p.missingLabels.join('، ')}).\n`;
  }
  reply += `- لحساب أي وجبة أو تصحيح: اكتبي الصنف والكمية أو قراءة السكر وسأحسب لك الجرعة فوراً!`;
  return reply;
}

function buildWelcomeMessage(p) {
  const s = p.stats;
  let statusLine = '';
  if (s.hasData) {
    statusLine = `📊 **ملخص سريع الآن:** آخر قراءة لـ **${p.name}** هي **${s.lastVal} ${p.unit}** (${s.lastLabel} • ${s.lastTimeAgo})، ونسبة البقاء في النطاق المستهدف (**${p.low}–${p.high} ${p.unit}**) هي **${s.tir}%** بمتوسط **${s.allMean} ${p.unit}**.`;
  } else {
    statusLine = `📊 النطاق المستهدف المضبوط لـ **${p.name}** هو **${p.low}–${p.high} ${p.unit}**${p.activeCR ? `، ومعامل الكارب الحالي لوجبة ${p.mealNowLabel} هو **1:${p.activeCR}**` : ''}.`;
  }

  const missingNote = p.missingLabels.length
    ? `\n\n⚠️ *ملاحظة:* ينقص في إعدادات ${p.name} تحديد (**${p.missingLabels.join('، ')}**) لتفعيل حسابات الجرعات والتصحيح كاملة.`
    : '';

  return `أهلاً بك! أنا **مساعد أسيل الطبي الذكي** 🤖، متصل الآن بملف **${p.name}** الطبي وأتحدث معك بوحدة القياس المختارة لديكم (**\`${p.unit}\`**).\n\n` +
    `${statusLine}${missingNote}\n\n` +
    `يمكنك سؤالي عن أي استفسار طبي، أو الضغط على أحد الأزرار بالأسفل، أو كتابة قراءة السكر/جرامات الكارب مباشرة لحساب الجرعة والتصحيح!`;
}

async function handleAiUserSubmit(rawText) {
  const text = (rawText || '').trim();
  if (!text || !_aiCurrentChild) return;

  const inputEl = $('aiChatInput');
  const sendBtn = $('aiChatSendBtn');
  if (inputEl) inputEl.value = '';
  if (sendBtn) sendBtn.disabled = true;

  appendAiMessage('user', text, false);
  _aiChatHistory.push({ role: 'user', text });

  showAiTyping(true);
  try {
    const profile = getChildClinicalProfile(_aiCurrentChild);
    let replyText = await callGeminiCloudApi(text, profile);
    if (!replyText) {
      await new Promise(r => setTimeout(r, 420));
      replyText = generateSmartClinicalReply(text, profile);
    }

    _aiChatHistory.push({ role: 'assistant', text: replyText });
    showAiTyping(false);
    appendAiMessage('bot', formatAiMarkdown(replyText), true);
  } catch (err) {
    console.error('AI Chat Error:', err);
    showAiTyping(false);
    const profile = getChildClinicalProfile(_aiCurrentChild);
    const fallback = generateSmartClinicalReply(text, profile);
    appendAiMessage('bot', formatAiMarkdown(fallback), true);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    inputEl?.focus();
  }
}

async function initAiAssistant(parentId, child) {
  _aiParentId = parentId;
  _aiCurrentChild = child;

  const fab = $('aiChatFab');
  const headerBtn = $('btnOpenAiHeader');
  const widget = $('aiChatWidget');
  const closeBtn = $('aiBtnClose');
  const resetBtn = $('aiBtnReset');
  const settingsBtn = $('aiBtnSettings');
  const settingsPanel = $('aiSettingsPanel');
  const unitBadge = $('aiUnitBadge');
  const subText = $('aiChildContextSub');
  const form = $('aiChatForm');
  const quickChips = $('aiQuickChips');

  if (!widget) return;

  function renderInitialWelcome() {
    const container = $('aiChatMessages');
    if (!container) return;
    container.innerHTML = '';
    _aiChatHistory = [];
    const freshProfile = getChildClinicalProfile(_aiCurrentChild || child);
    const welcomeMd = buildWelcomeMessage(freshProfile);
    appendAiMessage('bot', formatAiMarkdown(welcomeMd), true);
  }

  function openChat() {
    widget.classList.remove('hidden');
    const container = $('aiChatMessages');
    if (container && container.children.length === 0) {
      renderInitialWelcome();
    }
    setTimeout(() => $('aiChatInput')?.focus(), 100);
  }

  function closeChat() {
    widget.classList.add('hidden');
  }

  fab?.addEventListener('click', (e) => {
    e.preventDefault();
    if (widget.classList.contains('hidden')) openChat();
    else closeChat();
  });

  headerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    openChat();
  });

  closeBtn?.addEventListener('click', () => closeChat());

  resetBtn?.addEventListener('click', () => {
    renderInitialWelcome();
  });

  settingsBtn?.addEventListener('click', () => {
    settingsPanel?.classList.toggle('hidden');
  });

  const initialProfile = getChildClinicalProfile(child);
  if (unitBadge) unitBadge.textContent = `📏 ${initialProfile.unit}`;
  if (subText) subText.textContent = `متصل بملف: ${initialProfile.name} • الوحدة: ${initialProfile.unit}`;

  Promise.all([
    computeRecentBolusStats(parentId)
  ]).then(() => {
    const fresh = getChildClinicalProfile(child);
    if (unitBadge) unitBadge.textContent = `📏 ${fresh.unit}`;
    if (subText) subText.textContent = `متصل بملف: ${fresh.name} • الوحدة: ${fresh.unit}`;
  }).catch(e => console.warn('Background init warning:', e));

  if (settingsBtn) settingsBtn.style.display = 'none';
  if (settingsPanel) settingsPanel.style.display = 'none';

  quickChips?.querySelectorAll('.ai-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const promptText = btn.getAttribute('data-prompt');
      if (promptText) handleAiUserSubmit(promptText);
    });
  });

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('aiChatInput')?.value;
    if (val) handleAiUserSubmit(val);
  });
}
