// js/labs.js

import { auth, db } from './firebase-config.js';
import {
  collection, doc, setDoc, addDoc, getDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const childNameEl = document.getElementById('childName');
const hdrChild    = document.getElementById('hdrChild');
const labDateEl   = document.getElementById('labDate');
const labTypeEl   = document.getElementById('labType');
const dueBadge    = document.getElementById('dueBadge');
const saveBtn     = document.getElementById('saveBtn');
const savePdfBtn  = document.getElementById('savePdfBtn');
const pdfBtn      = document.getElementById('pdfBtn');
const fileLinkBox = document.getElementById('fileLinkBox');
const printBtn    = document.getElementById('printBtn');

const hba1cVal  = document.getElementById('hba1cVal');
const hba1cNote = document.getElementById('hba1cNote');

const lip_tc = document.getElementById('lip_tc');
const lip_ldl= document.getElementById('lip_ldl');
const lip_hdl= document.getElementById('lip_hdl');
const lip_tg = document.getElementById('lip_tg');
const lip_note = document.getElementById('lip_note');

const thy_tsh = document.getElementById('thy_tsh');
const thy_ft4 = document.getElementById('thy_ft4');
const thy_note= document.getElementById('thy_note');

const ren_mac = document.getElementById('ren_mac');
const ren_creat = document.getElementById('ren_creat');
const ren_note = document.getElementById('ren_note');

const generalNote = document.getElementById('generalNote');
const historyBody = document.getElementById('historyBody');

const params = new URLSearchParams(location.search);
const childId = params.get('child');
const labIdParam = params.get('lab');

const pad = n=>String(n).padStart(2,'0');
const fmt = d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
labDateEl.value = fmt(new Date());

function addMonths(date, m=4){
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth()+m);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

// حالة تعديل/إنشاء
let _currentLabId = null;

/* -------------------- دعم العربية في jsPDF -------------------- */
/** دالة تشكيل + RTL: تستخدم المكتبتين، مع fallback بسيط لو مش متاحين */
function shape(text){
  if (!text) return '';
  // تحقق من وجود المكتبة أولًا
  if (typeof window.arabicPersianReshaper === 'undefined' || typeof window.Bidi === 'undefined') {
    return text; // لا تقم بالتشكيل إذا كانت المكتبة غير موجودة
  }
  try{
    const reshaped = window.arabicPersianReshaper.reshape(text);
    const bidi = new window.Bidi();
    bidi.setRTL(true);
    return bidi.doBidi(reshaped);
  }catch(e){
    console.error('Error reshaping text:', e);
    return text;
  }
}

/** تحميل خط عربي (Noto Naskh) مرة واحدة */
async function ensureArabicFont(doc){
  if (window._arabicFontLoaded){ doc.setFont('NotoNaskh'); return; }
  const url = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/phaseIII_only/unhinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Regular.ttf';
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  doc.addFileToVFS('NotoNaskhArabic-Regular.ttf', b64);
  doc.addFont('NotoNaskhArabic-Regular.ttf', 'NotoNaskh', 'normal');
  window._arabicFontLoaded = true;
  doc.setFont('NotoNaskh');
}
/* -------------------------------------------------------------- */

onAuthStateChanged(auth, async user=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد child في الرابط'); return; }

  const cref = doc(db, `parents/${user.uid}/children/${childId}`);
  const csnp = await getDoc(cref);
  const childName = csnp.exists() ? (csnp.data().name || 'طفل') : 'طفل';
  childNameEl.textContent = childName;
  hdrChild.textContent = `— ${childName}`;

  // حمّل السجلّات
  await loadHistory(user.uid, childId, childName);

  if (labIdParam){
    const labRef = doc(db, `parents/${user.uid}/children/${childId}/labs/${labIdParam}`);
    const labSnap= await getDoc(labRef);
    if (!labSnap.exists()){ alert('لم يتم العثور على التقرير'); return; }
    const labData = labSnap.data();
    _currentLabId = labSnap.id; // وضع تعديل
    fillFormFromDoc(labData);
    showDueBadge(labData.nextDue?.toDate ? labData.nextDue.toDate() : addMonths(labData.when?.toDate ? labData.when.toDate() : new Date(labData.date)));
    openPdf(_currentLabId, childName, labData); // فتح تلقائي
  } else {
    // عرض الشارة من آخر تقرير
    const lref = collection(db, `parents/${user.uid}/children/${childId}/labs`);
    const qy = query(lref, orderBy('when','desc'), limit(1));
    const sn = await getDocs(qy);
    if (!sn.empty){
      const last = sn.docs[0].data();
      const due = last.nextDue?.toDate ? last.nextDue.toDate()
                : addMonths(last.when?.toDate ? last.when.toDate() : new Date(last.date));
      showDueBadge(due);
    }
  }

  saveBtn.addEventListener('click', ()=> saveLab(user.uid, childId, childName, false));
  savePdfBtn.addEventListener('click', ()=> saveLab(user.uid, childId, childName, true));
  pdfBtn.addEventListener('click', ()=>{
    const fake = buildDocFromForm();
    openPdf(_currentLabId || 'preview', childName, fake);
  });
  printBtn.addEventListener('click', ()=> window.print());
});

function showDueBadge(dueDate){
  if (!dueDate){ dueBadge.textContent=''; return; }
  const today = new Date();
  const days = Math.ceil((dueDate - today)/86400000);
  const txt = `التحليل القادم: ${fmt(dueDate)} (${days} يوم)`;
  dueBadge.textContent = txt;
  dueBadge.className = 'pill tiny ' + (days<0 ? 'danger' : (days<=14 ? 'warn' : 'ok'));
}

function fillFormFromDoc(d){
  labDateEl.value = d.date || (d.when?.toDate ? fmt(d.when.toDate()) : fmt(new Date()));
  labTypeEl.value = d.type || 'full';

  hba1cVal.value  = d?.hba1c?.value ?? '';
  hba1cNote.value = d?.hba1c?.note  ?? '';

  lip_tc.value = d?.lipid?.tc ?? '';
  lip_ldl.value= d?.lipid?.ldl?? '';
  lip_hdl.value= d?.lipid?.hdl?? '';
  lip_tg.value = d?.lipid?.tg ?? '';
  lip_note.value= d?.lipid?.note ?? '';

  thy_tsh.value= d?.thyroid?.tsh ?? '';
  thy_ft4.value= d?.thyroid?.ft4 ?? '';
  thy_note.value= d?.thyroid?.note ?? '';

  ren_mac.value= d?.renal?.microalb_creat ?? '';
  ren_creat.value= d?.renal?.creatinine ?? '';
  ren_note.value= d?.renal?.note ?? '';

  generalNote.value = d?.generalNote ?? '';
}

function buildDocFromForm(){
  const when = new Date(labDateEl.value+'T00:00:00');
  const nextDue = addMonths(when, 4);
  return {
    when,
    date: fmt(when),
    nextDue,
    type: labTypeEl.value,
    hba1c: { value: numOrNull(hba1cVal.value), note: strOrNull(hba1cNote.value) },
    lipid: { tc:numOrNull(lip_tc.value), ldl:numOrNull(lip_ldl.value), hdl:numOrNull(lip_hdl.value), tg:numOrNull(lip_tg.value), note: strOrNull(lip_note.value) },
    thyroid: { tsh:numOrNull(thy_tsh.value), ft4:numOrNull(thy_ft4.value), note: strOrNull(thy_note.value) },
    renal: { microalb_creat:numOrNull(ren_mac.value), creatinine:numOrNull(ren_creat.value), note: strOrNull(ren_note.value) },
    generalNote: strOrNull(generalNote.value),
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
      // تعديل مستند موجود
      const ref = doc(db, `parents/${uid}/children/${childId}/labs/${_currentLabId}`);
      await setDoc(ref, { ...data }, { merge: true });
      if (andPdf) openPdf(_currentLabId, childName, data);
      alert('تم التحديث بنجاح');
    } else {
      // إنشاء جديد
      const added = await addDoc(col, {
        ...data,
        when: data.when,
        nextDue: data.nextDue
      });
      _currentLabId = added.id;
      if (andPdf) openPdf(added.id, childName, data);
      alert('تم الحفظ بنجاح');
    }

    // حدّث جدول السجلات
    await loadHistory(uid, childId, childName);
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ/التحديث');
  }
}

// بناء لينك التقرير (رابط مطلق ليفتح من QR)
function buildReportUrl(labId){
  const url = new URL('labs.html', location.href);
  url.searchParams.set('child', childId);
  url.searchParams.set('lab', labId);
  return url.toString();
}

// 🖨️ توليد PDF مع دعم العربية + QR/Barcode كرابط مباشر
async function openPdf(labId, childName, data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});

  await ensureArabicFont(doc);         // تأكد تحميل الخط العربي
  doc.setFont('NotoNaskh');
  // لو الإصدار يدعم RTL:
  if (doc.setR2L) try { doc.setR2L(true); } catch(e){}

  // عناوين
  doc.setFontSize(16);
  doc.text(shape(`تقرير التحاليل — ${childName}`), 555, 40, {align:'right'});
  doc.setFontSize(11);
  doc.text(shape(`رقم التقرير: ${labId}`), 555, 62, {align:'right'});
  doc.text(shape(`تاريخ العينة: ${data.date}`), 555, 78, {align:'right'});

  // QR + Barcode برابط مباشر
  const reportUrl = labId==='preview' ? location.href : buildReportUrl(labId);

  try{
    const qrDiv = document.getElementById('qr');
    qrDiv.innerHTML = '';
    const qr = new QRCode(qrDiv, {text: reportUrl, width: 90, height: 90, correctLevel: QRCode.CorrectLevel.M});
    const qrCanvas = qrDiv.querySelector('canvas');
    const qrDataUrl = qrCanvas ? qrCanvas.toDataURL('image/png') : null;

    const svg = document.getElementById('barcode');
    JsBarcode(svg, reportUrl, {format:'CODE128', displayValue:false, height:45, margin:0});
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBase64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));

    if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', 40, 96, 90, 90);
    doc.addImage(svgBase64, 'SVG', 140, 120, 220, 40);

    // منطقة قابلة للنقر فوق الـQR
    doc.link(40, 96, 90, 90, { url: reportUrl });
    doc.textWithLink(shape('فتح التقرير'), 370, 135, { url: reportUrl, align: 'right' });
  }catch(e){ console.warn('Barcode/QR warning', e); }

  let y = 210;

  // إعدادات عامة للجداول بالعربية
  const baseTable = {
    styles:{halign:'right', font: 'NotoNaskh', fontSize: 10},
    headStyles:{fillColor:[244,247,255], font:'NotoNaskh'},
    theme:'grid',
    margin:{left:40,right:40},
    didParseCell: (hookData)=>{
      // شكّل النص العربي للخلايا والرؤوس
      if (hookData.cell && Array.isArray(hookData.cell.text)) {
        hookData.cell.text = hookData.cell.text.map(t => shape(String(t)));
      }
    }
  };

  const hbaRows = [[ data?.hba1c?.value ?? '-', '%', data?.hba1c?.note ?? '-' ]];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [[ shape('HbA1c'), shape('الوحدة'), shape('ملاحظات') ]],
    body: [ hbaRows[0].map(v => (v===null?'-':v)) ]
  });
  y = doc.lastAutoTable.finalY + 14;

  const lipRows = [
    [shape('TC'), data?.lipid?.tc ?? '-', shape('mg/dL'), shape(data?.lipid?.note ?? '-')],
    [shape('LDL'), data?.lipid?.ldl ?? '-', shape('mg/dL'), shape('-')],
    [shape('HDL'), data?.lipid?.hdl ?? '-', shape('mg/dL'), shape('-')],
    [shape('TG'), data?.lipid?.tg  ?? '-', shape('mg/dL'), shape('-')],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [[ shape('دهون الدم'), shape('القيمة'), shape('الوحدة'), shape('ملاحظات') ]],
    body: lipRows,
    didParseCell: (hookData) => {
        if (hookData.cell.raw.text) {
          hookData.cell.text = [shape(hookData.cell.raw.text)];
        }
    }
  });
  y = doc.lastAutoTable.finalY + 14;

  const thRows = [
    [shape('TSH'), data?.thyroid?.tsh ?? '-', shape('mIU/L'), shape(data?.thyroid?.note ?? '-')],
    [shape('FT4'), data?.thyroid?.ft4 ?? '-', shape('ng/dL'), shape('-')],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [[ shape('الغدة الدرقية'), shape('القيمة'), shape('الوحدة'), shape('ملاحظات') ]],
    body: thRows,
    didParseCell: (hookData) => {
        if (hookData.cell.raw.text) {
          hookData.cell.text = [shape(hookData.cell.raw.text)];
        }
    }
  });
  y = doc.lastAutoTable.finalY + 14;

  const rnRows = [
    [shape('Microalbumin/Creatinine'), data?.renal?.microalb_creat ?? '-', shape('mg/g'), shape(data?.renal?.note ?? '-')],
    [shape('Creatinine'), data?.renal?.creatinine ?? '-', shape('mg/dL'), shape('-')],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [[ shape('الكُلى'), shape('القيمة'), shape('الوحدة'), shape('ملاحظات') ]],
    body: rnRows,
    didParseCell: (hookData) => {
        if (hookData.cell.raw.text) {
          hookData.cell.text = [shape(hookData.cell.raw.text)];
        }
    }
  });
  y = doc.lastAutoTable.finalY + 14;

  const nextDue = data.nextDue ? (data.nextDue instanceof Date ? data.nextDue : new Date(data.nextDue)) : addMonths(new Date(data.date),4);
  doc.setFontSize(11);
  doc.text(shape(`موعد التحليل القادم (HbA1c كل 4 أشهر): ${fmt(nextDue)}`), 555, y, {align:'right'});
  y += 18;
  if (data?.generalNote){
    doc.setFont('NotoNaskh','bold'); doc.text(shape('ملاحظات عامة:'), 555, y, {align:'right'}); y+=14;
    doc.setFont('NotoNaskh','normal'); doc.text(shape(String(data.generalNote)), 555, y, {align:'right', maxWidth:515});
  }

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

/* =================== السجلات السابقة =================== */
async function loadHistory(uid, childId, childName){
  const lref = collection(db, `parents/${uid}/children/${childId}/labs`);
  const qy = query(lref, orderBy('when','desc'), limit(20));
  const sn = await getDocs(qy);

  historyBody.innerHTML = '';
  if (sn.empty){
    historyBody.innerHTML = `<tr><td colspan="4" class="muted">لا توجد سجلات</td></tr>`;
    return;
  }

  sn.forEach(d=>{
    const v = d.data();
    const when = v.when?.toDate ? v.when.toDate() : (v.date ? new Date(v.date) : new Date());
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmt(when)}</td>
      <td>${v?.hba1c?.value!=null ? Number(v.hba1c.value).toFixed(1)+'%' : '—'}</td>
      <td>${v?.hba1c?.note ?? '—'}</td>
      <td>
        <div class="actions">
          <button class="btn small gray act-open">فتح PDF</button>
          <button class="btn small act-edit">تعديل</button>
          <button class="btn small danger act-del">حذف</button>
        </div>
      </td>
    `;
    tr.querySelector('.act-open').addEventListener('click', ()=> openPdf(d.id, childName, v));
    tr.querySelector('.act-edit').addEventListener('click', ()=>{
      _currentLabId = d.id;
      fillFormFromDoc(v);
      window.scrollTo({top:0, behavior:'smooth'});
    });
    tr.querySelector('.act-del').addEventListener('click', async ()=>{
      if (confirm('هل تريد حذف هذا التقرير؟')){
        await deleteDoc(doc(db, `parents/${uid}/children/${childId}/labs/${d.id}`));
        if (_currentLabId === d.id) _currentLabId = null;
        await loadHistory(uid, childId, childName);
        alert('تم الحذف');
      }
    });
    historyBody.appendChild(tr);
  });
}
