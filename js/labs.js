// js/labs.js
import { auth, db } from './firebase-config.js';
import {
  collection, doc, setDoc, addDoc, getDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

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

const childNameEl = $('childName');
const labDateEl   = $('labDate');
const labTypeEl   = $('labType');
const dueBadge    = $('dueBadge');
const saveBtn     = $('saveBtn');
const savePdfBtn  = $('savePdfBtn');
const pdfBtn      = $('pdfBtn');
const fileLinkBox = $('fileLinkBox');
const printBtn    = $('printBtn');

const hba1cVal  = $('hba1cVal');
const hba1cNote = $('hba1cNote');

const lip_tc = $('lip_tc');
const lip_ldl= $('lip_ldl');
const lip_hdl= $('lip_hdl');
const lip_tg = $('lip_tg');
const lip_note = $('lip_note');

const thy_tsh = $('thy_tsh');
const thy_ft4 = $('thy_ft4');
const thy_note= $('thy_note');

const ren_mac = $('ren_mac');
const ren_creat = $('ren_creat');
const ren_note = $('ren_note');

// حقول حساسية القمح والفحوصات الوقائية السنوية (ADA / ISPAD)
const cel_ttg = $('cel_ttg');
const cel_result = $('cel_result');
const cel_iga = $('cel_iga');
const cel_note = $('cel_note');

const eye_status = $('eye_status');
const eye_date = $('eye_date');
const eye_note = $('eye_note');

const foot_status = $('foot_status');
const foot_date = $('foot_date');
const foot_note = $('foot_note');

const generalNote = $('generalNote');
const historyBody = $('historyBody');

const params = new URLSearchParams(location.search);
const childId = params.get('child');
const labIdParam = params.get('lab');
const parentIdParam = params.get('parentId');

const pad = n => String(n).padStart(2,'0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
if (labDateEl) labDateEl.value = fmt(new Date());

function addMonths(date, m=3){
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth()+m);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

let _currentLabId = null;
let trendChart = null;

// --- نظام التلوين الذكي للمراجع الطبية ---
function checkRanges() {
  const validate = (el, condition) => {
    if (!el || !el.value) { if(el) el.classList.remove('out-of-range'); return; }
    if (condition(Number(el.value))) el.classList.add('out-of-range');
    else el.classList.remove('out-of-range');
  };

  validate(hba1cVal, v => v >= 7.0);
  validate(lip_tc, v => v > 200);
  validate(lip_ldl, v => v > 100);
  validate(lip_hdl, v => v < 40);
  validate(lip_tg, v => v > 150);
  validate(thy_tsh, v => v < 0.4 || v > 4.0);
  validate(thy_ft4, v => v < 0.9 || v > 1.7);
  validate(ren_mac, v => v > 30);
  validate(ren_creat, v => v > 1.2);
  validate(cel_ttg, v => v >= 10);
}

// ربط الحقول بنظام التلوين الذكي عند الكتابة
[hba1cVal, lip_tc, lip_ldl, lip_hdl, lip_tg, thy_tsh, thy_ft4, ren_mac, ren_creat, cel_ttg].forEach(input => {
  if(input) input.addEventListener('input', checkRanges);
});

onAuthStateChanged(auth, async user => {
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لم يتم العثور على رقم الطفل.'); return; }

  const parentId = parentIdParam || user.uid;
  const isDoctor = parentIdParam && parentIdParam !== user.uid;

  // إعداد زر الرجوع بذكاء
  const backBtn = $('backBtn');
  const fileBackBtn = $('fileBackBtn');
  const backUrl = isDoctor ? 'doctor-dashboard.html' : `child.html?child=${childId}`;
  if(backBtn) {
    backBtn.textContent = isDoctor ? '🩺 رجوع للعيادة' : '🏠 رجوع للوحة الطفل';
    backBtn.onclick = () => location.href = backUrl;
  }
  if(fileBackBtn) fileBackBtn.onclick = () => location.href = backUrl;

  $('logoutBtn')?.addEventListener('click', () => signOut(auth).catch(() => {}));

  let cref = doc(db, `parents/${parentId}/children/${childId}`);
  let csnp = await getDoc(cref);
  if (!csnp.exists() && parentId !== user.uid) {
    const fallbackRef = doc(db, `parents/${user.uid}/children/${childId}`);
    const fallbackSnap = await getDoc(fallbackRef);
    if (fallbackSnap.exists()) {
      cref = fallbackRef;
      csnp = fallbackSnap;
      localStorage.setItem('selectedParentId', user.uid);
    }
  }
  const childData = csnp.exists() ? csnp.data() : {};
  const childName = childData.name || 'الطفل';
  
  if(childNameEl) childNameEl.textContent = childName;
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

    // تحديث روابط وأزرار الشريط العلوي وفق دور المستخدم
  const safeChild = encodeURIComponent(childId);
  const safeParent = encodeURIComponent(parentId);
  const qDoc = `?child=${safeChild}&parentId=${safeParent}`;
  const qChild = `?child=${safeChild}`;
  const workstationUrl = `doctor-child.html${qDoc}`;

  const parentNav = $('parentNav');
  const doctorNav = $('doctorNav');
  const breadContainer = document.querySelector('.breadcrumbs');
  const firstBreadLink = breadContainer ? breadContainer.querySelector('a') : null;

  if (isDoctor) {
    if (parentNav) { parentNav.classList.add('hidden'); parentNav.style.display = 'none'; }
    if (doctorNav) { doctorNav.classList.remove('hidden'); doctorNav.style.display = 'flex'; }

    $('navDocStation')?.setAttribute('href', workstationUrl);
    $('navDocReports')?.setAttribute('href', `reports.html${qDoc}`);
    $('navDocLabs')?.setAttribute('href', `labs.html${qDoc}`);
    $('navDocVisits')?.setAttribute('href', `visits.html${qDoc}`);
    $('navDocDoses')?.setAttribute('href', `${workstationUrl}#protocolSection`);

    if (backBtn) {
      backBtn.textContent = '🏠 رجوع للوحة العيادة';
      backBtn.onclick = () => location.href = 'doctor-dashboard.html';
    }
    if (firstBreadLink) {
      firstBreadLink.textContent = 'عيادتي (قائمة المرضى) 👨‍⚕️';
      firstBreadLink.href = 'doctor-dashboard.html';
    }
    $('breadChildName')?.setAttribute('href', workstationUrl);
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
      backBtn.textContent = '🏠 رجوع للوحة الطفل';
      backBtn.onclick = () => location.href = `child.html${qChild}`;
    }
    if (firstBreadLink) {
      firstBreadLink.textContent = 'أطفالي 👨‍👩‍👧‍👦';
      firstBreadLink.href = 'parent.html';
    }
    $('breadChildName')?.setAttribute('href', `child.html${qChild}`);
  }

  await loadHistory(parentId, childId, childName);

  if (labIdParam){
    const labRef = doc(db, `parents/${parentId}/children/${childId}/labs/${labIdParam}`);
    const labSnap= await getDoc(labRef);
    if (!labSnap.exists()){ alert('التقرير غير موجود.'); return; }
    const labData = labSnap.data();
    _currentLabId = labSnap.id;
    fillFormFromDoc(labData);
    checkRanges(); 
    showDueBadge(labData.nextDue?.toDate ? labData.nextDue.toDate() : addMonths(labData.when?.toDate ? labData.when.toDate() : new Date(labData.date), 3));
    openPdf(_currentLabId, childName, labData);
  } else {
    const lref = collection(db, `parents/${parentId}/children/${childId}/labs`);
    const qy = query(lref, orderBy('when','desc'), limit(1));
    const sn = await getDocs(qy);
    if (!sn.empty){
      const last = sn.docs[0].data();
      const due = last.nextDue?.toDate ? last.nextDue.toDate()
                : addMonths(last.when?.toDate ? last.when.toDate() : new Date(last.date), 3);
      showDueBadge(due);
    }
  }

  if(saveBtn) saveBtn.addEventListener('click', ()=> saveLab(parentId, childId, childName, false));
  if(savePdfBtn) savePdfBtn.addEventListener('click', ()=> saveLab(parentId, childId, childName, true));
  if(pdfBtn) pdfBtn.addEventListener('click', ()=>{
    const fake = buildDocFromForm();
    openPdf(_currentLabId || 'preview', childName, fake);
  });
  if(printBtn) printBtn.addEventListener('click', ()=> window.print());
});

function showDueBadge(dueDate){
  if (!dueDate || !dueBadge){ return; }
  const today = new Date();
  const days = Math.ceil((dueDate - today)/86400000);
  const txt = `التحليل القادم: ${fmt(dueDate)} (${days} يوم)`;
  dueBadge.textContent = txt;
  dueBadge.className = 'pill tiny ' + (days<0 ? 'danger' : (days<=14 ? 'warn' : 'ok'));
}

function fillFormFromDoc(d){
  if(labDateEl) labDateEl.value = d.date || (d.when?.toDate ? fmt(d.when.toDate()) : fmt(new Date()));
  if(labTypeEl) labTypeEl.value = d.type || 'full';

  if(hba1cVal) hba1cVal.value  = d?.hba1c?.value ?? '';
  if(hba1cNote) hba1cNote.value = d?.hba1c?.note  ?? '';

  if(lip_tc) lip_tc.value = d?.lipid?.tc ?? '';
  if(lip_ldl) lip_ldl.value= d?.lipid?.ldl?? '';
  if(lip_hdl) lip_hdl.value= d?.lipid?.hdl?? '';
  if(lip_tg) lip_tg.value = d?.lipid?.tg ?? '';
  if(lip_note) lip_note.value= d?.lipid?.note ?? '';

  if(thy_tsh) thy_tsh.value= d?.thyroid?.tsh ?? '';
  if(thy_ft4) thy_ft4.value= d?.thyroid?.ft4 ?? '';
  if(thy_note) thy_note.value= d?.thyroid?.note ?? '';

  if(ren_mac) ren_mac.value= d?.renal?.microalb_creat ?? '';
  if(ren_creat) ren_creat.value= d?.renal?.creatinine ?? '';
  if(ren_note) ren_note.value= d?.renal?.note ?? '';

  if(cel_ttg) cel_ttg.value = d?.celiac?.ttg ?? '';
  if(cel_result) cel_result.value = d?.celiac?.result ?? '';
  if(cel_iga) cel_iga.value = d?.celiac?.iga ?? '';
  if(cel_note) cel_note.value = d?.celiac?.note ?? '';

  if(eye_status) eye_status.value = d?.preventive?.eye_status ?? '';
  if(eye_date) eye_date.value = d?.preventive?.eye_date ?? '';
  if(eye_note) eye_note.value = d?.preventive?.eye_note ?? '';

  if(foot_status) foot_status.value = d?.preventive?.foot_status ?? '';
  if(foot_date) foot_date.value = d?.preventive?.foot_date ?? '';
  if(foot_note) foot_note.value = d?.preventive?.foot_note ?? '';

  if(generalNote) generalNote.value = d?.generalNote ?? '';
}

function buildDocFromForm(){
  const when = new Date((labDateEl?.value || fmt(new Date()))+'T00:00:00');
  const nextDue = addMonths(when, 3);
  return {
    when,
    date: fmt(when),
    nextDue,
    type: labTypeEl?.value || 'full',
    hba1c: { value: numOrNull(hba1cVal?.value), note: strOrNull(hba1cNote?.value) },
    lipid: { tc:numOrNull(lip_tc?.value), ldl:numOrNull(lip_ldl?.value), hdl:numOrNull(lip_hdl?.value), tg:numOrNull(lip_tg?.value), note: strOrNull(lip_note?.value) },
    thyroid: { tsh:numOrNull(thy_tsh?.value), ft4:numOrNull(thy_ft4?.value), note: strOrNull(thy_note?.value) },
    renal: { microalb_creat:numOrNull(ren_mac?.value), creatinine:numOrNull(ren_creat?.value), note: strOrNull(ren_note?.value) },
    celiac: { ttg:numOrNull(cel_ttg?.value), result:strOrNull(cel_result?.value), iga:numOrNull(cel_iga?.value), note:strOrNull(cel_note?.value) },
    preventive: { 
      eye_status: strOrNull(eye_status?.value), eye_date: strOrNull(eye_date?.value), eye_note: strOrNull(eye_note?.value),
      foot_status: strOrNull(foot_status?.value), foot_date: strOrNull(foot_date?.value), foot_note: strOrNull(foot_note?.value)
    },
    generalNote: strOrNull(generalNote?.value),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  };
}

function numOrNull(v){ return v==='' || v==null ? null : Number(v); }
function strOrNull(v){ return v && String(v).trim()!=='' ? String(v).trim() : null; }

async function saveLab(uid, childId, childName, andPdf=false){
  try{
    const data = buildDocFromForm();
    const col = collection(db, `parents/${uid}/children/${childId}/labs`);

    if (_currentLabId){
      const ref = doc(db, `parents/${uid}/children/${childId}/labs/${_currentLabId}`);
      await setDoc(ref, { ...data }, { merge: true });
      if (andPdf) openPdf(_currentLabId, childName, data);
      alert('تم تحديث التقرير بنجاح.');
    } else {
      const added = await addDoc(col, {
        ...data,
        when: data.when,
        nextDue: data.nextDue
      });
      _currentLabId = added.id;
      if (andPdf) openPdf(added.id, childName, data);
      alert('تم حفظ التقرير بنجاح.');
    }

    await loadHistory(uid, childId, childName);
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ.');
  }
}

function buildReportUrl(labId){
  const url = new URL('labs.html', location.href);
  url.searchParams.set('child', childId);
  url.searchParams.set('lab', labId);
  if (parentIdParam) url.searchParams.set('parentId', parentIdParam);
  return url.toString();
}

async function openPdf(labId, childName, data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});
  
  doc.setFont('Helvetica');

  doc.setFontSize(16);
  doc.text(`Comprehensive Pediatric Lab Report — ${childName}`, 40, 40);
  doc.setFontSize(10);
  doc.text(`Report ID: ${labId}`, 40, 60);
  doc.text(`Sample Date: ${data.date}`, 40, 74);
  doc.text(`Clinical Target: HbA1c < 7.0% (ISPAD/ADA Standard)`, 40, 88);

  const reportUrl = labId==='preview' ? location.href : buildReportUrl(labId);

  try{
    const qrDiv = $('qr');
    if (qrDiv) {
      qrDiv.innerHTML = '';
      const qr = new QRCode(qrDiv, {text: reportUrl, width: 80, height: 80, correctLevel: QRCode.CorrectLevel.M});
      const qrCanvas = qrDiv.querySelector('canvas');
      const qrDataUrl = qrCanvas ? qrCanvas.toDataURL('image/png') : null;

      const svg = $('barcode');
      JsBarcode(svg, reportUrl, {format:'CODE128', displayValue:false, height:35, margin:0});
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));

      if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', 460, 40, 80, 80);
      doc.addImage(svgBase64, 'SVG', 330, 95, 210, 30);
    }
  }catch(e){ console.warn('Barcode/QR warning', e); }

  let y = 135;

  const baseTable = {
    styles:{halign:'left', font: 'Helvetica', fontSize: 9},
    headStyles:{fillColor:[241,245,249], textColor:[30,41,59], fontStyle:'bold'},
    theme:'grid',
    margin:{left:40,right:40}
  };

  // 1. HbA1c
  const hbaRows = [[ data?.hba1c?.value != null ? `${data.hba1c.value}%` : '-', '< 7.0%', data?.hba1c?.note ?? '-' ]];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['Glycemic Control (HbA1c)', 'Reference Target', 'Clinical Notes']],
    body: hbaRows
  });
  y = doc.lastAutoTable.finalY + 10;

  // 2. Lipid
  const lipRows = [
    ['TC (Total Cholesterol)', data?.lipid?.tc ?? '-', '< 200 mg/dL', data?.lipid?.note ?? '-'],
    ['LDL (Bad Cholesterol)', data?.lipid?.ldl ?? '-', '< 100 mg/dL', '-'],
    ['HDL (Good Cholesterol)', data?.lipid?.hdl ?? '-', '> 40 mg/dL', '-'],
    ['TG (Triglycerides)', data?.lipid?.tg  ?? '-', '< 150 mg/dL', '-'],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['Lipid Profile', 'Result', 'Reference Target', 'Notes']],
    body: lipRows
  });
  y = doc.lastAutoTable.finalY + 10;

  // 3. Thyroid & Renal
  const thRnRows = [
    ['TSH (Thyroid Stimulating Hormone)', data?.thyroid?.tsh ?? '-', '0.4 - 4.0 mIU/L', data?.thyroid?.note ?? '-'],
    ['FT4 (Free Thyroxine)', data?.thyroid?.ft4 ?? '-', '0.9 - 1.7 ng/dL', '-'],
    ['Microalbumin/Creatinine Ratio', data?.renal?.microalb_creat ?? '-', '< 30 mg/g', data?.renal?.note ?? '-'],
    ['Serum Creatinine', data?.renal?.creatinine ?? '-', '0.6 - 1.2 mg/dL', '-'],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['Thyroid & Renal Function', 'Result', 'Reference', 'Notes']],
    body: thRnRows
  });
  y = doc.lastAutoTable.finalY + 10;

  // 4. Celiac
  const celRows = [
    ['Anti-tTG IgA (Celiac Antibody)', data?.celiac?.ttg ?? '-', '< 10 U/mL (Negative)', data?.celiac?.result ?? (data?.celiac?.note ?? '-')],
    ['Total Serum IgA', data?.celiac?.iga ?? '-', '0.7 - 4.0 g/L', data?.celiac?.note ?? '-']
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['Celiac Screening (Anti-tTG)', 'Result', 'Reference', 'Notes']],
    body: celRows
  });
  y = doc.lastAutoTable.finalY + 10;

  const nextDue = data.nextDue ? (data.nextDue instanceof Date ? data.nextDue : new Date(data.nextDue)) : addMonths(new Date(data.date),3);
  doc.setFontSize(10);
  doc.text(`Next Recommended HbA1c Lab Due Date: ${fmt(nextDue)} (Every 3 months)`, 40, y);
  y += 14;

  if (data?.generalNote){
    doc.setFont('Helvetica','bold'); doc.text('Physician Recommendations & Notes:', 40, y); y+=12;
    doc.setFont('Helvetica','normal'); doc.text(String(data.generalNote), 40, y, {maxWidth:515});
  }

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ============================================================
// لوحة المتابعة الدورية + منحنى تطور السكر التراكمي
// ============================================================
function renderDueTracker(allDocs) {
  const grid = $('dueGrid');
  if(!grid) return;

  const now = new Date();

  // استخراج أحدث فحص مسجل لكل تصنيف سريري
  let latest = {
    hba1c: null,
    thyroid: null,
    celiac: null,
    renal: null,
    lipid: null,
    preventive: null
  };

  allDocs.forEach(d => {
    const w = d.when?.toDate ? d.when.toDate() : (d.date ? new Date(d.date) : null);
    if(!w || isNaN(w)) return;

    if(d.hba1c?.value != null && (!latest.hba1c || w > latest.hba1c.date)) {
      latest.hba1c = { date: w, val: `${d.hba1c.value}%`, note: d.hba1c.note };
    }
    if((d.thyroid?.tsh != null || d.thyroid?.ft4 != null) && (!latest.thyroid || w > latest.thyroid.date)) {
      latest.thyroid = { date: w, val: `TSH: ${d.thyroid?.tsh ?? '—'}`, note: d.thyroid?.note };
    }
    if((d.celiac?.ttg != null || d.celiac?.result) && (!latest.celiac || w > latest.celiac.date)) {
      latest.celiac = { date: w, val: d.celiac.result === 'negative' ? 'سلبي (سليم) ✅' : (d.celiac.ttg != null ? `${d.celiac.ttg} U/mL` : 'مسجل'), note: d.celiac.note };
    }
    if((d.renal?.microalb_creat != null || d.renal?.creatinine != null) && (!latest.renal || w > latest.renal.date)) {
      latest.renal = { date: w, val: `الزلال: ${d.renal?.microalb_creat ?? '—'} mg/g`, note: d.renal?.note };
    }
    if((d.lipid?.tc != null || d.lipid?.ldl != null) && (!latest.lipid || w > latest.lipid.date)) {
      latest.lipid = { date: w, val: `الكولسترول: ${d.lipid?.tc ?? '—'} mg/dL`, note: d.lipid?.note };
    }
    if((d.preventive?.eye_status || d.preventive?.foot_status) && (!latest.preventive || w > latest.preventive.date)) {
      latest.preventive = { date: w, val: d.preventive.eye_status === 'normal' ? 'فحص العيون سليم ✅' : 'متابع', note: d.preventive.eye_note };
    }
  });

  const categories = [
    { key: 'hba1c', name: 'السكر التراكمي (HbA1c)', icon: '🩸', intervalDays: 90, freqText: 'كل 3 أشهر', target: 'الهدف: < 7.0%' },
    { key: 'thyroid', name: 'وظائف الغدة الدرقية', icon: '🦋', intervalDays: 365, freqText: 'فحص سنوي', target: 'TSH / FT4' },
    { key: 'celiac', name: 'حساسية القمح (Celiac)', icon: '🌾', intervalDays: 365, freqText: 'فحص سنوي', target: 'Anti-tTG IgA' },
    { key: 'renal', name: 'زلال البول ووظائف الكلى', icon: '🧪', intervalDays: 365, freqText: 'فحص سنوي', target: 'Microalbumin / Creatinine' },
    { key: 'lipid', name: 'دهون الدم (Lipid Profile)', icon: '🫀', intervalDays: 365, freqText: 'فحص سنوي', target: 'TC, LDL, HDL, TG' },
    { key: 'preventive', name: 'قاع العين والأسنان', icon: '👁️', intervalDays: 365, freqText: 'فحص سنوي', target: 'كشف وقائي سريري' }
  ];

  let overdueCount = 0;
  let warnCount = 0;

  const html = categories.map(cat => {
    const item = latest[cat.key];
    let badgeClass = 'empty', badgeText = 'غير مسجل ⚪', subText = 'لم يُسجل أي فحص مسبقاً';
    let cardClass = '';

    if (item && item.date) {
      const daysSince = Math.floor((now - item.date) / (1000 * 60 * 60 * 24));
      const remaining = cat.intervalDays - daysSince;

      if (remaining < 0) {
        badgeClass = 'danger';
        cardClass = 'danger';
        badgeText = 'مستحق الآن 🚨';
        subText = `متأخر منذ ${Math.abs(remaining)} يوم (آخر فحص: ${fmt(item.date)})`;
        overdueCount++;
      } else if (remaining <= 30) {
        badgeClass = 'warn';
        cardClass = 'warn';
        badgeText = 'مستحق قريباً ⚠️';
        subText = `متبقي ${remaining} يوم (آخر فحص: ${fmt(item.date)})`;
        warnCount++;
      } else {
        badgeClass = 'ok';
        cardClass = 'ok';
        badgeText = 'مكتمل حديثاً 🟢';
        subText = `متبقي ${remaining} يوم (آخر فحص: ${fmt(item.date)})`;
      }
    } else {
      overdueCount++;
    }

    return `
      <div class="due-card ${cardClass}">
        <div class="dc-head">
          <div class="dc-title">
            <span>${cat.icon}</span> ${cat.name}
          </div>
          <span class="dc-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="dc-freq">${cat.freqText}</span>
          <span style="font-size:11.5px; color:#2563eb; font-weight:600;">${cat.target}</span>
        </div>
        <div class="dc-body">
          <div>آخر نتيجة: <b>${item ? item.val : 'لا توجد بيانات'}</b></div>
          <div class="tiny" style="color:#64748b;">${subText}</div>
        </div>
      </div>
    `;
  }).join('');

  grid.innerHTML = html;

  const summary = $('dueSummaryBadge');
  if(summary) {
    if(overdueCount > 0) {
      summary.className = 'pill tiny danger';
      summary.textContent = `${overdueCount} فحوصات مستحقة 🚨`;
    } else if(warnCount > 0) {
      summary.className = 'pill tiny warn';
      summary.textContent = `${warnCount} فحوصات مستحقة قريباً ⚠️`;
    } else {
      summary.className = 'pill tiny ok';
      summary.textContent = 'جميع الفحوصات مكتملة ومحدثة ✅';
    }
  }
}

function renderHbA1cTrend(allDocs) {
  const canvas = $('hba1cTrendCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');

  // استخراج القراءات الصالحة فقط وترتيبها تصاعدياً حسب التاريخ
  const hbaList = [];
  allDocs.forEach(d => {
    if(d?.hba1c?.value != null && !isNaN(Number(d.hba1c.value))) {
      const w = d.when?.toDate ? d.when.toDate() : (d.date ? new Date(d.date) : new Date());
      hbaList.push({
        date: fmt(w),
        val: Number(d.hba1c.value),
        when: w,
        note: d.hba1c.note || ''
      });
    }
  });

  hbaList.sort((a,b) => a.when - b.when);

  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }

  if(!hbaList.length) {
    trendChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'لا توجد قراءات كافية للسكر التراكمي لعرض المنحنى' }
        }
      }
    });
    return;
  }

  const pointColors = hbaList.map(item => {
    if(item.val < 7.0) return '#16a34a'; // good green
    if(item.val <= 8.5) return '#f59e0b'; // amber
    return '#dc2626'; // bad red
  });

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hbaList.map(x => x.date),
      datasets: [
        {
          label: 'السكر التراكمي (HbA1c %)',
          data: hbaList.map(x => x.val),
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: pointColors,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8
        },
        {
          label: 'الهدف السريري (7.0%)',
          data: hbaList.map(() => 7.0),
          borderColor: '#16a34a',
          borderWidth: 1.5,
          borderDash: [6, 6],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 4.5,
          suggestedMax: 11,
          title: { display: true, text: 'HbA1c (%)', font: { weight: 'bold', size: 11 } },
          grid: { color: '#f1f5f9' }
        },
        x: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11 } }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          rtl: true,
          callbacks: {
            label: (ctx) => {
              const item = hbaList[ctx.dataIndex];
              let res = `HbA1c: ${item.val}%`;
              if (item.val < 7.0) res += ' (ضمن الهدف السريري ✅)';
              else res += ' (أعلى من الهدف ⚠️)';
              if(item.note) res += ` • ملاحظات: ${item.note}`;
              return res;
            }
          }
        }
      }
    }
  });
}

async function loadHistory(uid, childId, childName){
  if(!historyBody) return;
  const lref = collection(db, `parents/${uid}/children/${childId}/labs`);
  const qy = query(lref, orderBy('when','desc'), limit(30));
  const sn = await getDocs(qy);

  historyBody.innerHTML = '';
  const allDocs = [];

  if (sn.empty){
    historyBody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align: center; padding: 20px;">لا توجد سجلات سابقة</td></tr>`;
    renderDueTracker([]);
    renderHbA1cTrend([]);
    return;
  }

  sn.forEach(d => {
    const v = d.data();
    v._id = d.id;
    allDocs.push(v);

    const when = v.when?.toDate ? v.when.toDate() : (v.date ? new Date(v.date) : new Date());
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmt(when)}</td>
      <td style="font-weight: bold; color: ${v?.hba1c?.value >= 7 ? '#ef4444' : '#15803d'}">${v?.hba1c?.value!=null ? Number(v.hba1c.value).toFixed(1)+'%' : '—'}</td>
      <td>${v?.hba1c?.note ?? '—'}</td>
      <td style="text-align: center;">
        <div class="row" style="justify-content: center;">
          <button class="btn small ghost act-open" style="border-color:#cbd5e1;">📄 PDF</button>
          <button class="btn small secondary act-edit">✏️ تعديل</button>
          <button class="btn small danger act-del">🗑️ حذف</button>
        </div>
      </td>
    `;
    tr.querySelector('.act-open').addEventListener('click', ()=> openPdf(d.id, childName, v));
    tr.querySelector('.act-edit').addEventListener('click', ()=>{
      _currentLabId = d.id;
      fillFormFromDoc(v);
      checkRanges();
      window.scrollTo({top:0, behavior:'smooth'});
    });
    tr.querySelector('.act-del').addEventListener('click', async ()=>{
      if (confirm('هل أنت متأكد من حذف التقرير؟')){
        await deleteDoc(doc(db, `parents/${uid}/children/${childId}/labs/${d.id}`));
        if (_currentLabId === d.id) _currentLabId = null;
        await loadHistory(uid, childId, childName);
        alert('تم حذف التقرير.');
      }
    });
    historyBody.appendChild(tr);
  });

  renderDueTracker(allDocs);
  renderHbA1cTrend(allDocs);
}
