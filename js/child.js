// js/child.js 

import { auth, db } from './firebase-config.js';

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {

  collection, getDocs, query, where, orderBy, limit, doc, getDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp

} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";



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

    let parentId = parentIdParam || localStorage.getItem('selectedParentId') || user.uid;

    let childRef = doc(db,`parents/${parentId}/children/${childId}`);

    let snap = await getDoc(childRef);



    // إذا لم يوجد وكان parentId مختلف عن user.uid، نحاول بحساب المستخدم الحالي

    if (!snap.exists() && parentId !== user.uid) {

      const fallbackRef = doc(db, `parents/${user.uid}/children/${childId}`);

      const fallbackSnap = await getDoc(fallbackRef);

      if (fallbackSnap.exists()) {

        parentId = user.uid;

        childRef = fallbackRef;

        snap = fallbackSnap;

      }

    }



    // إذا لم يوجد وكان المستخدم طبيباً، نبحث في سجل مرضى الطبيب لاستخراج parentId

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

    initEmergencyCard(user, c);

    setHref($('radarAddMeasBtn'), `measurements.html${qDocParams}`);



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
   - يقرأ ملف الطفل ومعاملاته وقراءاته الحية تلقائياً
   - يلتزم التزاماً تاماً بوحدة القياس المختارة للطفل (mg/dL أو mmol/L)
   - يدعم محرك مزدوج: Google Gemini Cloud AI + المحرك السريري الذكي المدمج
   - يضيف تنبيهاً طبياً استرشادياً إلزامياً بعد كل رسالة
============================================================================ */

const AI_DISCLAIMER_TEXT = '⚠️ تنبيه طبي هام: هذا الشات استرشادي وتعليمي فقط بناءً على المعطيات المسجلة لطفلك، ولا يُغني بأي حال عن استشارة الطبيب المعالج قبل اتخاذ أي قرار طبي أو تعديل في جرعات الأنسولين.';

let _aiChatHistory = [];
let _aiCurrentChild = null;
let _aiParentId = null;
let _aiMealBolusAvg = 0;
let _aiGeminiApiKey = localStorage.getItem('aseel_gemini_key') || '';

async function loadGlobalGeminiKey() {
  try {
    const snap = await getDoc(doc(db, 'admin/global/settings/ai'));
    if (snap.exists() && snap.data()?.geminiApiKey) {
      _aiGeminiApiKey = String(snap.data().geminiApiKey).trim();
      localStorage.setItem('aseel_gemini_key', _aiGeminiApiKey);
    }
  } catch (e) {
    // في حال عدم وجود مفتاح عام نعتمد على المفتاح المحلي أو المحرك السريري المدمج
  }
}

async function computeRecentBolusStats(uid) {
  try {
    const mealsRef = collection(db, `parents/${uid}/children/${childId}/meals`);
    const snap = await getDocs(query(mealsRef, orderBy('date', 'desc'), limit(25)));
    if (snap.empty) {
      _aiMealBolusAvg = 0;
      return;
    }
    const byDate = {};
    snap.docs.forEach(d => {
      const m = d.data();
      const dt = m.date || 'unknown';
      const dose = Number(m.totalDose ?? m.insulinUnits ?? m.recommendedDose ?? 0) || 0;
      byDate[dt] = (byDate[dt] || 0) + dose;
    });
    const days = Object.keys(byDate);
    if (days.length) {
      const total = days.reduce((acc, k) => acc + byDate[k], 0);
      _aiMealBolusAvg = +(total / days.length).toFixed(1);
    }
  } catch (e) {
    _aiMealBolusAvg = 0;
  }
}

function getChildClinicalProfile(child) {
  const unit = child.glucoseUnit || 'mg/dL';
  const isMmol = unit === 'mmol/L';
  const name = child.identity?.name || child.name || 'الطفل';
  const dob = child.identity?.dob || child.birthDate || null;
  const age = calcAge(dob);
  const genderRaw = child.identity?.gender || child.gender || '';
  const gender = genderRaw === 'female' ? 'أنثى' : (genderRaw === 'male' ? 'ذكر' : 'غير محدد');
  const weight = Number(child.weight || child.identity?.weight || 0) || null;

  const limits = child.glucose_limits || {};
  const low = Number(limits.low) || (isMmol ? 3.9 : 70);
  const high = Number(limits.high) || (isMmol ? 10.0 : 180);
  const critLow = Number(limits.critical_low) || (isMmol ? 3.0 : 54);
  const critHigh = Number(limits.critical_high) || (isMmol ? 13.9 : 250);
  const target = Number(limits.target || child.targetGlucose) || (isMmol ? 6.5 : 120);

  const crObj = child.cr || {};
  const crBreakfast = Number(crObj.breakfast || child.carbRatio || 0) || null;
  const crLunch = Number(crObj.lunch || child.carbRatio || 0) || null;
  const crDinner = Number(crObj.dinner || child.carbRatio || 0) || null;
  const crSnack = Number(crObj.snack || child.carbRatio || 0) || null;
  const mealNow = currentMeal();
  const activeCR = Number(crObj[mealNow.key] || child.carbRatio || crLunch || crBreakfast || 15);

  let cf = Number(child.cf ?? child.correctionFactor ?? 0) || null;
  // مواءمة معامل التصحيح مع وحدة القياس
  if (cf) {
    if (isMmol && cf > 15) cf = +(cf / 18).toFixed(1);
    if (!isMmol && cf < 10) cf = Math.round(cf * 18);
  } else {
    cf = isMmol ? 2.8 : 50;
  }

  const basalType = child.insulin?.basal || child.basalType || 'طويل المفعول (قاعدي)';
  const basalDose = Number(child.basalDose || child.insulin?.basalDose || 0) || null;
  const bolusType = child.insulin?.bolus || child.bolusType || 'سريع المفعول';
  const hypoCarbs = Number(child.hypoCarbs || 15);
  const doctorNote = child.doctor_note || '';

  const tdd = basalDose ? +(basalDose + (_aiMealBolusAvg || basalDose)).toFixed(1) : null;
  const tddPerKg = (tdd && weight) ? +(tdd / weight).toFixed(2) : null;
  const basalPct = (tdd && basalDose) ? Math.round((basalDose / tdd) * 100) : null;

  return {
    name, age, gender, weight,
    unit, isMmol,
    low, high, critLow, critHigh, target,
    crBreakfast, crLunch, crDinner, crSnack, activeCR, mealNowLabel: mealNow.label,
    cf, basalType, basalDose, bolusType, hypoCarbs, doctorNote,
    bolusAvg: _aiMealBolusAvg, tdd, tddPerKg, basalPct,
    stats: window._aiGlucoseStats || { hasData: false },
    hba1c: window._aiLastHba1c || null
  };
}

function formatAiMarkdown(text) {
  if (!text) return '';
  let safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // إزالة أي تكرار لنص التنبيه إذا كتبه النموذج داخل المتن لأننا نضيفه في صندوق مستقل
  safe = safe.replace(/⚠️\s*تنبيه طبي هام:[\s\S]*$/g, '').trim();

  // تحويل العناوين والخط العريض والقوائم إلى HTML أنيق
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

[قاعدة صارمة جداً بخصوص وحدة القياس]:
- وحدة القياس المختارة في إعدادات هذا الطفل هي: **${p.unit}** فقط.
- يجب أن تكون جميع الأرقام، النطاقات، الأمثلة، والحسابات في ردك بوحدة **${p.unit}** حصراً.
- النطاق المستهدف لهذا الطفل هو: **${p.low} إلى ${p.high} ${p.unit}**، والهدف التصحيحي: **${p.target} ${p.unit}**.
- حد الهبوط هو أقل من **${p.low} ${p.unit}**، والهبوط الحرج أقل من **${p.critLow} ${p.unit}**.
- حد الارتفاع هو أعلى من **${p.high} ${p.unit}**، والارتفاع الحرج أعلى من **${p.critHigh} ${p.unit}**.
- إذا ذكر ولي الأمر رقماً يبدو بالوحدة الأخرى (مثلاً ذكر رقم مثل 240 بينما الوحدة mmol/L، أو ذكر 5.5 بينما الوحدة mg/dL)، قم بتحويله فوراً لوحدة الطفل (${p.unit}) باستخدام المعامل 18 ووضّح له ذلك بلطف.

[ملف الطفل الطبي الحالي]:
- الاسم: ${p.name} | العمر: ${p.age} سنة | النوع: ${p.gender} | الوزن: ${p.weight ? p.weight + ' كجم' : 'غير مسجل'}
- الأنسولين القاعدي: ${p.basalType} | الجرعة اليومية: ${p.basalDose ? p.basalDose + ' وحدة' : 'غير محددة'}
- الأنسولين السريع: ${p.bolusType} | متوسط جرعات الوجبات اليومي: ${p.bolusAvg ? p.bolusAvg + ' وحدة' : 'غير محدد'}
- إجمالي الأنسولين اليومي التقديري (TDD): ${p.tdd ? p.tdd + ' وحدة' : 'غير محدد'} ${p.tddPerKg ? `(${p.tddPerKg} وحدة/كجم/يوم - نسبة القاعدي ${p.basalPct}%)` : ''}
- معامل الكارب (CR): الفطور=${p.crBreakfast || '—'}، الغداء=${p.crLunch || '—'}، العشاء=${p.crDinner || '—'}، السناك=${p.crSnack || '—'} (المعامل النشط الآن لوجبة ${p.mealNowLabel}: 1 وحدة لكل ${p.activeCR} جرام كارب)
- معامل التصحيح (CF): 1 وحدة تخفض السكر بمقدار ${p.cf} ${p.unit}
- كارب علاج الهبوط المعتمد للطفل: ${p.hypoCarbs} جرام سكريات سريعة
- آخر تحليل تراكمي (HbA1c): ${p.hba1c ? `${p.hba1c.value}% (بتاريخ ${p.hba1c.date})` : 'غير مسجل'}
- ملاحظة الطبيب المعالج المباشرة: ${p.doctorNote || 'لا توجد'}

[تحليل قراءات الجلوكوز الحية للطفل]:
${statsSummary}

قدّم إجابة منظمة بنقاط واضحة وعناوين فرعية قصيرة، ولا تكتب نص التحذير الطبي في نهاية الرسالة لأن النظام يضيفه تلقائياً.`;
}

async function callGeminiCloudApi(userText, profile) {
  if (!_aiGeminiApiKey) return null;

  const sysInstruction = buildGeminiSystemPrompt(profile);
  const contents = [];

  // إضافة آخر 6 رسائل من المحادثة للحفاظ على السياق
  const recentHistory = _aiChatHistory.slice(-6);
  for (const item of recentHistory) {
    contents.push({
      role: item.role === 'user' ? 'user' : 'model',
      parts: [{ text: item.text }]
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: userText }]
  });

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  for (const modelName of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(_aiGeminiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sysInstruction }] },
          contents,
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 900
          }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply && reply.trim()) return reply.trim();
    } catch (e) {
      console.warn(`Gemini model ${modelName} fallback:`, e);
    }
  }
  return null;
}

/* ---- المحرك السريري الذكي المدمج (Built-in Clinical Expert Engine) ----
   يعمل تلقائياً 100% بدون الحاجة لأي إعدادات، ويحلل السؤال + أرقام الطفل الحية
   مع التزام كامل بوحدة القياس (mg/dL أو mmol/L) */
function generateSmartClinicalReply(userText, p) {
  const q = userText.trim();
  const qLower = q.toLowerCase();
  const s = p.stats;
  const u = p.unit;
  const isMmol = p.isMmol;

  const fmtVal = (mgVal) => isMmol ? +(mgVal / 18).toFixed(1) : Math.round(mgVal);

  // 1. فحص ما إذا كان ولي الأمر يسأل عن رقم قراءة سكر محدد أو كمية كارب في الرسالة
  const numMatches = q.match(/(\d+(?:\.\d+)?)/g);
  const hasCarbWord = /(كارب|نشويات|جرام|غ|وجب|اكل|أكل|ياكل|يأكل)/.test(qLower);
  const hasBgWord = /(سكر|قراء|قياس|لقيته|وصل|دلوقتي|الان|الآن|تصحيح|جرع|هبوط|عالي|مرتفع|منخفض)/.test(qLower);

  if (numMatches && numMatches.length > 0 && (hasBgWord || hasCarbWord)) {
    const nums = numMatches.map(Number).filter(n => !isNaN(n) && n > 0);
    let bgVal = null;
    let carbVal = null;
    let convertedNote = '';

    for (const n of nums) {
      if (hasCarbWord && (q.includes(`${n} جرام`) || q.includes(`${n}غ`) || q.includes(`${n} كارب`) || ( nums.length === 1 && !hasBgWord ))) {
        carbVal = n;
      } else if (bgVal === null) {
        bgVal = n;
      } else if (carbVal === null) {
        carbVal = n;
      }
    }

    // التحقق من تطابق الرقم مع وحدة قياس الطفل (mg/dL مقابل mmol/L)
    if (bgVal !== null) {
      if (isMmol && bgVal >= 35) {
        const converted = +(bgVal / 18).toFixed(1);
        convertedNote = `💡 *ملاحظة وحدة القياس:* الرقم المدخل (${bgVal}) يبدو بوحدة \`mg/dL\`، وبما أن ملف **${p.name}** مضبوط على وحدة **\`mmol/L\`** فقد قمت بتحويله تلقائياً إلى **${converted} mmol/L**.\n\n`;
        bgVal = converted;
      } else if (!isMmol && bgVal > 0 && bgVal <= 28 && !hasCarbWord) {
        const converted = Math.round(bgVal * 18);
        convertedNote = `💡 *ملاحظة وحدة القياس:* الرقم المدخل (${bgVal}) يبدو بوحدة \`mmol/L\`، وبما أن ملف **${p.name}** مضبوط على وحدة **\`mg/dL\`** فقد قمت بتحويله تلقائياً إلى **${converted} mg/dL**.\n\n`;
        bgVal = converted;
      }

      // تقييم القراءة المدخلة وحساب التصحيح أو إسعاف الهبوط
      let resp = convertedNote + `### 🩺 تحليل القراءة الفورية لـ ${p.name} (${bgVal} ${u})\n`;
      if (bgVal < p.low) {
        const isCrit = bgVal <= p.critLow;
        resp += `- **الحالة:** ${isCrit ? '🚨 **هبوط حرج في السكر!**' : '⚠️ **هبوط في السكر (أقل من ' + p.low + ' ' + u + ')**'}\n`;
        resp += `- **يُمنع إعطاء أنسولين الآن منعاً باتاً.**\n`;
        resp += `- **الخطوة 1 (قاعدة 15-15):** أعطِ الطفل فوراً **${p.hypoCarbs} جرام سكريات سريعة الامتصاص** (نصف كوب عصير محلى أو ملعقة كبيرة سكر/عسل مذابة في ماء).\n`;
        resp += `- **الخطوة 2:** انتظر **15 دقيقة** ثم أعد القياس؛ إذا ظل السكر أقل من **${p.low} ${u}** كرر إعطاء **${p.hypoCarbs} جرام** سكريات سريعة.\n`;
        resp += `- **الخطوة 3:** بمجرد ارتفاع السكر فوق **${p.low} ${u}**، أعطِ وجبة خفيفة تحتوي على نشويات معقدة وبروتين لتثبيت السكر.\n`;
        if (isCrit) {
          resp += `- ⛔ **تحذير هام:** إذا كان الطفل يعاني من تشنجات أو عدم قدرة على البلع، لا تعطه شيئاً بالفم واحقن **الجلوكاجون** فوراً وتواصل مع الطوارئ (123).`;
        }
        return resp;
      }

      if (bgVal > p.high) {
        const diff = Math.max(0, bgVal - p.target);
        const rawCorr = diff / p.cf;
        const corrRounded = Math.round(rawCorr * 2) / 2;
        const mealDose = carbVal ? +(carbVal / p.activeCR).toFixed(1) : 0;
        const totalSuggested = +(rawCorr + mealDose).toFixed(1);

        resp += `- **الحالة:** ${bgVal >= p.critHigh ? '🚨 **ارتفاع شديد يحتاج متابعة الكيتون**' : '⬆️ **ارتفاع فوق النطاق المستهدف (' + p.low + '–' + p.high + ' ' + u + ')**'}\n`;
        resp += `- **الهدف التصحيحي في ملف الطفل:** ${p.target} ${u} | **معامل التصحيح (CF):** 1 وحدة لكل ${p.cf} ${u}\n`;
        resp += `- **جرعة التصحيح الحسابية:** \`(${bgVal} - ${p.target}) ÷ ${p.cf}\` = **${rawCorr.toFixed(1)} وحدة** (تُقرّب إلى **${corrRounded} وحدة** من ${p.bolusType}).\n`;
        if (carbVal) {
          resp += `- **جرعة الوجبة (${carbVal} جرام كارب على معامل ${p.activeCR}):** **${mealDose} وحدة**.\n`;
          resp += `- **إجمالي الجرعة المقترحة (وجبة + تصحيح):** **${totalSuggested} وحدة** تقريباً.\n`;
        }
        resp += `- **تنبيه منع تكدس الأنسولين (Insulin Stacking):** تأكد من مرور **3 ساعات على الأقل** منذ آخر جرعة أنسولين سريع قبل إعطاء جرعة تصحيح جديدة.\n`;
        if (bgVal >= p.critHigh) {
          resp += `- 🧪 **فحص الكيتون:** لأن القراءة أعلى من **${p.critHigh} ${u}**، يُنصح بفحص الكيتون في البول أو الدم وتشجيع الطفل على شرب الماء بكثرة.`;
        }
        return resp;
      }

      // القراءة داخل النطاق الطبيعي
      resp += `- **الحالة:** ✅ **ممتاز! القراءة داخل النطاق المستهدف (${p.low}–${p.high} ${u}).**\n`;
      resp += `- **جرعة التصحيح:** **0 وحدة** (لا يحتاج لتصحيح).\n`;
      if (carbVal) {
        const mealDose = +(carbVal / p.activeCR).toFixed(1);
        resp += `- **جرعة الوجبة (${carbVal} جرام كارب ÷ معامل ${p.mealNowLabel} ${p.activeCR}):** **${mealDose} وحدة** من ${p.bolusType}.`;
      } else {
        resp += `- إذا كان سيتناول وجبة الآن، اقسم جرامات الكارب على معامل ${p.mealNowLabel} (**${p.activeCR}**) لحساب جرعة الوجبة.`;
      }
      return resp;
    }

    if (carbVal !== null) {
      const mealDose = +(carbVal / p.activeCR).toFixed(1);
      const mealRounded = Math.round(mealDose * 2) / 2;
      return `### 🥗 حساب جرعة الكارب لـ ${p.name}\n` +
        `- **كمية الكارب المدخلة:** ${carbVal} جرام\n` +
        `- **معامل الكارب النشط الآن (${p.mealNowLabel}):** 1 وحدة لكل **${p.activeCR} جرام كارب**\n` +
        `- **جرعة الأنسولين السريع (${p.bolusType}) للوجبة:** \`${carbVal} ÷ ${p.activeCR}\` = **${mealDose} وحدة** (حوالي **${mealRounded} وحدة**).\n` +
        `- 💡 *نصيحة:* قِس سكر الطفل قبل الوجبة بوحدة **${u}**؛ إذا كان أعلى من **${p.high} ${u}** ستُضاف جرعة التصحيح، وإذا كان في النطاق (**${p.low}–${p.high} ${u}**) نكتفي بجرعة الوجبة فقط.`;
    }
  }

  // 2. سؤال عن تقييم جرعة القاعدي والوزن (Basal & Weight / TDD)
  if (/(قاعدي|ترسيبا|لانتوس|توجيو|وزن|كجم|تراكم|tdd|طويل المفعول)/.test(qLower)) {
    let resp = `### ⚖️ تقييم الأنسولين القاعدي ومقارنته بوزن ${p.name}\n`;
    resp += `- **نوع القاعدي المسجل:** ${p.basalType}\n`;
    resp += `- **جرعة القاعدي اليومية:** ${p.basalDose ? `**${p.basalDose} وحدة/يوم**` : 'غير مسجلة بعد في الإعدادات'}\n`;
    resp += `- **وزن الطفل:** ${p.weight ? `**${p.weight} كجم**` : 'غير مسجل بعد في الإعدادات'}\n`;

    if (p.basalDose && p.weight) {
      const basalPerKg = +(p.basalDose / p.weight).toFixed(2);
      const minExpectedTdd = +(p.weight * 0.5).toFixed(1);
      const maxExpectedTdd = +(p.weight * 1.0).toFixed(1);
      resp += `- **نسبة القاعدي للوزن:** **${basalPerKg} وحدة/كجم/يوم** (المعدل المعتاد للقاعدي وحده يتراوح غالباً بين \`0.25\` إلى \`0.45\` وحدة/كجم حسب عمر الطفل ومرحلة السكر).\n`;
      resp += `- **إجمالي الأنسولين اليومي المتوقع للوزن (TDD):** بين **${minExpectedTdd} إلى ${maxExpectedTdd} وحدة/يوم** (حيث يمثل القاعدي عادةً **40% إلى 50%** منها).\n`;
      if (p.tdd) {
        resp += `- **إجمالي الأنسولين الفعلي المسجل (قاعدي + وجبات):** **${p.tdd} وحدة/يوم** (**${p.tddPerKg} وحدة/كجم** — القاعدي يمثل **${p.basalPct}%**).\n`;
      }
      if (s.hasData) {
        if (s.nightHypos > 0 || (p.basalPct && p.basalPct > 55 && s.tbr > 4)) {
          resp += `- ⚠️ **ملاحظة سريرية هامة (احتمال زيادة القاعدي Over-basalization):** نلاحظ وجود **${s.nightHypos} قراءات هبوط ليلي** (< ${p.low} ${u}) مع نسبة هبوط عامة **${s.tbr}%**. قد تكون جرعة القاعدي (${p.basalDose} وحدة) أعلى قليلاً من احتياج الطفل الليلي، ويُنصح بمراجعة الطبيب لتخفيضها بمقدار 10%–15%.\n`;
        } else if (s.morningHighs >= 2 && s.nightHypos === 0) {
          resp += `- 📈 **ملاحظة سريرية (احتمال نقص القاعدي أو ظاهرة الفجر):** توجد **${s.morningHighs} قراءات مرتفعة صباحاً** (> ${p.high} ${u}) دون هبوط ليلي، مما قد يشير إلى أن جرعة القاعدي تحتاج ضبطاً بسيطاً مع الطبيب.\n`;
        } else if (p.tddPerKg && p.tddPerKg > 1.0 && s.tar > 30) {
          resp += `- 🔍 **تنبيه فحص أماكن الحقن (Lipohypertrophy):** إجمالي الجرعات مرتفع نسبياً للوزن (${p.tddPerKg} وحدة/كجم) مع استمرار ارتفاع السكر فوق ${p.high} ${u} بنسبة ${s.tar}%؛ يُرجى فحص أماكن الحقن للتأكد من عدم وجود تكتلات دهنية تمنع امتصاص الأنسولين.\n`;
        } else {
          resp += `- ✅ **التوازن الحالي:** جرعة القاعدي تبدو متناسقة مع وزن الطفل ومع قراءاته المسجلة في نطاق **${p.low}–${p.high} ${u}**.`;
        }
      }
    } else {
      resp += `- 💡 *توصية:* تأكد من إدخال **وزن الطفل بالكيلوجرام** و**جرعة القاعدي اليومية** في صفحة (إعدادات الطفل) أو (صفحة الطبيب) ليقوم النظام بحساب معادلة \`وحدة/كجم/يوم\` بدقة.`;
    }
    return resp;
  }

  // 3. سؤال عن طوارئ الهبوط أو الارتفاع
  if (/(طوارئ|هبوط|انخفاض|دوخ|عرق|رجف|كيتون|اسيتون|أسيتون|عالي جدا|مرتفع جدا)/.test(qLower)) {
    return `### 🚨 بروتوكول التعامل السريع لـ ${p.name} (بوحدة ${u})\n` +
      `#### 1️⃣ في حالة هبوط السكر (أقل من **${p.low} ${u}**):\n` +
      `- **قاعدة 15-15 الفورية:** أعطِ **${p.hypoCarbs} جرام سكريات سريعة** فوراً (نصف كوب عصير محلى أو 3 ملاعق صغيرة سكر مذابة في ماء).\n` +
      `- **لا تعطِ شوكولاتة أو أطعمة دهنية** في لحظة الهبوط لأن الدهون تبطئ رفع السكر.\n` +
      `- **أعد القياس بعد 15 دقيقة:** إذا كان لا يزال أقل من **${p.low} ${u}**، كرر نفس الكمية (${p.hypoCarbs} جرام).\n` +
      `- إذا كان الهبوط حرجاً (أقل من **${p.critLow} ${u}**) مع فقدان وعي أو تشنجات: **يُمنع إعطاء أي شيء بالفم**، ويُحقن الجلوكاجون فوراً.\n\n` +
      `#### 2️⃣ في حالة الارتفاع الشديد (أعلى من **${p.critHigh} ${u}**):\n` +
      `- احسب جرعة التصحيح بمعامل الطفل (**1 وحدة لكل ${p.cf} ${u}** للوصول إلى الهدف **${p.target} ${u}**)، بشرط مرور أكثر من 3 ساعات على آخر جرعة سريع.\n` +
      `- افحص **الكيتون (الأسيتون)** في البول أو الدم وقدم الماء بكثرة للطفل.\n` +
      `- إذا وُجد كيتون متوسط/كبير أو قيء مستمر أو ألم بالبطن، توجه فوراً للمستشفى أو تواصل مع الطبيب.`;
  }

  // 4. سؤال عن ضبط سكر الليل والفجر (Dawn vs Somogyi)
  if (/(ليل|نوم|فجر|صباح|صائم|سوموجي|dawn)/.test(qLower)) {
    let nightAnalysis = '';
    if (s.hasData) {
      nightAnalysis = `- **في سجل ${p.name} الأخير:** تم رصد **${s.nightHypos} مرات هبوط ليلي** (< ${p.low} ${u}) و**${s.morningHighs} مرات ارتفاع صباحي** (> ${p.high} ${u}).\n`;
    }
    return `### 🌙 تفسير وضبط سكر الليل والفجر لـ ${p.name} (${u})\n` +
      nightAnalysis +
      `- **الفرق بين السببين الرئيسيين لارتفاع سكر الصباح (أعلى من ${p.high} ${u}):**\n` +
      `  1. **ظاهرة الفجر (Dawn Phenomenon):** يرتفع السكر بين الساعة 4 و8 صباحاً بسبب هرمونات النمو والكورتيزول الطبيعية دون حدوث هبوط ليلي، ويكون السكر عند الساعة 3 فجراً طبيعياً أو مرتفعاً.\n` +
      `  2. **تأثير سوموجي (Somogyi Effect / ارتفاع ارتدادي):** يحدث هبوط خفي أثناء النوم (أقل من **${p.low} ${u}**، غالباً بين 1 و3 فجراً) فيفرز الجسم هرمونات ترفع السكر بشدة صباحاً.\n` +
      `- **خطة الفحص الذكية لليلة القادمة:**\n` +
      `  - قِس السكر قبل النوم، وعند الساعة **3:00 فجراً**، وعند الاستيقاظ بوحدة **${u}**.\n` +
      `  - إذا كان قياس 3 فجراً أقل من **${p.low} ${u}** فالسبب زيادة في القاعدي (${p.basalType}) أو جرعة العشاء، أما إذا كان مرتفعاً طوال الليل فالسبب نقص في الجرعة أو كارب متأخر في العشاء.`;
  }

  // 5. سؤال عن اقتراح وجبة صحية محسوبة الكارب والجرعة
  if (/(وجب|اقترح|فطور|غداء|عشاء|سناك|طعام|أكل|اكل|تغذية)/.test(qLower)) {
    const cr = p.activeCR;
    const dose30 = +(30 / cr).toFixed(1);
    const dose45 = +(45 / cr).toFixed(1);
    const dose15 = +(15 / cr).toFixed(1);
    return `### 🥗 مقترحات وجبات متوازنة لـ ${p.name} (محسوبة بمعامل ${p.mealNowLabel}: 1 وحدة لكل ${cr}g كارب)\n` +
      `- **الخيار الأول: وجبة متوسطة (30 جرام كارب) ⬅️ الجرعة التقريبية: ${dose30} وحدة (${p.bolusType})**\n` +
      `  - نصف رغيف خبز أسمر (15g) + بيضة مسلوقة أو قطعة جبن قريش/صدور دجاج (0g) + ثمرة تفاح صغيرة أو برتقالة (15g) + خيار وخس.\n` +
      `- **الخيار الثاني: وجبة غداء مشبعة (45 جرام كارب) ⬅️ الجرعة التقريبية: ${dose45} وحدة (${p.bolusType})**\n` +
      `  - 6 ملاعق أرز مطبوخ أو مكرونة (30g) + طبق خضار مطبوخ وقطعة لحم/سمك مشوي (0–5g) + كوب زبادي صغير مع نصف ثمرة فاكهة (12–15g).\n` +
      `- **الخيار الثالث: سناك خفيف (15 جرام كارب) ⬅️ الجرعة التقريبية: ${dose15} وحدة (${p.bolusType})**\n` +
      `  - كوب فشار منزلي متوسط (15g) أو ثمرة فاكهة متوسطة مع حفنة مكسرات نيئة.\n` +
      `- 💡 *تذكير بوحدة **${u}**:* قِس السكر قبل الأكل؛ إذا كان داخل النطاق (**${p.low}–${p.high} ${u}**) تُعطى جرعة الكارب فقط قبل الأكل بـ 10–15 دقيقة.`;
  }

  // 6. الرد الافتراضي الشامل: تحليل ذكي متكامل لملف الطفل وقراءاته + إجابة السياق
  let reply = `### 📊 التحليل الطبي الذكي لملف **${p.name}** (بوحدة **${u}**)\n`;
  if (s.hasData) {
    reply += `- **آخر قراءة مسجلة:** **${s.lastVal} ${u}** (${s.lastLabel} — ${s.lastTimeAgo})\n`;
    reply += `- **متوسط السكر:** **${s.allMean} ${u}** | **النطاق المستهدف للطفل:** **${p.low}–${p.high} ${u}**\n`;
    reply += `- **الوقت داخل النطاق (TIR):** **${s.tir}%** (الهدف العالمي > 70%)\n`;
    reply += `- **نسبة الهبوط (< ${p.low} ${u}):** **${s.tbr}%** | **نسبة الارتفاع (> ${p.high} ${u}):** **${s.tar}%**\n`;
    reply += `- **استقرار السكر (CV%):** **${s.cvPct}%** (${s.cvPct <= 36 ? 'مستقر وممتاز ✅' : 'يوجد تذبذب يحتاج مراجعة الأوقات والجرعات ⚠️'})\n\n`;

    reply += `### 🔍 أهم الملاحظات والتوصيات لحالة ${p.name}:\n`;
    if (s.tbr > 4) {
      reply += `- **أولوية أولى (منع الهبوط المتكرر):** نسبة الهبوط لديكم **${s.tbr}%** (أقل من **${p.low} ${u}**). تذكروا قاعدة التدرج الطبي: ضبط الهبوط يسبق دائماً علاج الارتفاع. راقبوا أوقات الهبوط (${s.nightHypos > 0 ? `خاصة الهبوط الليلي المسجل ${s.nightHypos} مرات` : 'خاصة بعد الوجبات أو المجهود البدني'}).\n`;
    }
    if (s.tar > 25) {
      reply += `- **تحسين قراءات الارتفاع:** نسبة الارتفاع فوق **${p.high} ${u}** هي **${s.tar}%**. تأكدوا من إعطاء جرعة ${p.bolusType} قبل الوجبة بـ **10–15 دقيقة** وحساب الكارب بدقة على معامل **${p.activeCR} جرام/وحدة**.\n`;
    }
    if (s.tir >= 70 && s.tbr <= 4) {
      reply += `- **تحكم ممتاز:** ما شاء الله! نسبة البقاء في النطاق (**${s.tir}%**) ضمن المستهدف العالمي وبأمان عالٍ.\n`;
    }
  } else {
    reply += `- لا توجد قراءات مسجلة كافية في آخر 7 أيام. ابدأ بتسجيل قراءات السكر اليومية بوحدة **${u}** ليقوم المساعد بتحليل المنحنى بدقة.\n`;
  }

  reply += `\n### ⚙️ المعاملات المعتمدة حالياً في حسابات ${p.name}:\n`;
  reply += `- **وحدة القياس المعتمدة:** \`${u}\` (النطاق: **${p.low}–${p.high} ${u}** | الهدف: **${p.target} ${u}**)\n`;
  reply += `- **معامل الكارب النشط الآن (${p.mealNowLabel}):** 1 وحدة لكل **${p.activeCR} جرام كارب**\n`;
  reply += `- **معامل التصحيح (CF):** 1 وحدة تخفض السكر بمقدار **${p.cf} ${u}**\n`;
  reply += `- **القاعدي:** ${p.basalType} (${p.basalDose ? p.basalDose + ' وحدة' : 'غير محدد'}) ${p.weight ? `| **الوزن:** ${p.weight} كجم` : ''}\n`;
  if (p.doctorNote) {
    reply += `- **تعليمات الطبيب المسجلة:** "${p.doctorNote}"\n`;
  }
  reply += `- 💬 *يمكنك كتابة أي قراءة سكر (بوحدة ${u}) أو كمية كارب في الشات مباشرة وسأحسب لك التصحيح أو الجرعة فوراً!*`;

  return reply;
}

function buildWelcomeMessage(p) {
  const s = p.stats;
  let statusLine = '';
  if (s.hasData) {
    statusLine = `📊 **ملخص سريع الآن:** آخر قراءة لـ **${p.name}** هي **${s.lastVal} ${p.unit}** (${s.lastLabel} • ${s.lastTimeAgo})، ونسبة البقاء في النطاق المستهدف (**${p.low}–${p.high} ${p.unit}**) هي **${s.tir}%** بمتوسط **${s.allMean} ${p.unit}**.`;
  } else {
    statusLine = `📊 النطاق المستهدف المضبوط لـ **${p.name}** هو **${p.low}–${p.high} ${p.unit}**، ومعامل الكارب الحالي لوجبة ${p.mealNowLabel} هو **1:${p.activeCR}**.`;
  }

  return `أهلاً بك! أنا **مساعد أسيل الطبي الذكي** 🤖، متصل الآن بملف **${p.name}** الطبي وأتحدث معك بوحدة القياس المختارة لديكم (**\`${p.unit}\`**).\n\n` +
    `${statusLine}\n\n` +
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
  const keyInput = $('aiGeminiKeyInput');
  const saveKeyBtn = $('aiSaveKeyBtn');
  const keyStatus = $('aiKeyStatusMsg');
  const unitBadge = $('aiUnitBadge');
  const subText = $('aiChildContextSub');
  const form = $('aiChatForm');
  const quickChips = $('aiQuickChips');

  if (!widget) return;

  await Promise.all([
    loadGlobalGeminiKey(),
    computeRecentBolusStats(parentId)
  ]);

  const profile = getChildClinicalProfile(child);
  if (unitBadge) unitBadge.textContent = `📏 ${profile.unit}`;
  if (subText) subText.textContent = `متصل بملف: ${profile.name} • الوحدة: ${profile.unit}`;
  if (keyInput && _aiGeminiApiKey) keyInput.value = _aiGeminiApiKey;

  function renderInitialWelcome() {
    const container = $('aiChatMessages');
    if (!container) return;
    container.innerHTML = '';
    _aiChatHistory = [];
    const freshProfile = getChildClinicalProfile(_aiCurrentChild);
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

  fab?.addEventListener('click', () => {
    if (widget.classList.contains('hidden')) openChat();
    else closeChat();
  });

  headerBtn?.addEventListener('click', () => openChat());
  closeBtn?.addEventListener('click', () => closeChat());

  resetBtn?.addEventListener('click', () => {
    renderInitialWelcome();
  });

  settingsBtn?.addEventListener('click', () => {
    settingsPanel?.classList.toggle('hidden');
  });

  saveKeyBtn?.addEventListener('click', async () => {
    const val = (keyInput?.value || '').trim();
    _aiGeminiApiKey = val;
    if (val) {
      localStorage.setItem('aseel_gemini_key', val);
      try {
        await setDoc(doc(db, 'admin/global/settings/ai'), { geminiApiKey: val, updatedAt: serverTimestamp() }, { merge: true });
      } catch (e) {}
      if (keyStatus) keyStatus.textContent = '✅ تم حفظ وتفعيل مفتاح Gemini السحابي بنجاح!';
    } else {
      localStorage.removeItem('aseel_gemini_key');
      if (keyStatus) keyStatus.textContent = 'ℹ️ تم التبديل إلى محرك أسيل السريري المدمج.';
    }
    setTimeout(() => {
      if (keyStatus) keyStatus.textContent = '';
      settingsPanel?.classList.add('hidden');
    }, 1500);
  });

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
