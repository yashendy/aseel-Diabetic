// js/labs.js
import { auth, db } from './firebase-config.js';
import {
  collection, doc, setDoc, addDoc, getDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const childNameEl = document.getElementById('childName');
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

let _currentLabId = null;

// --- نظام التلوين الذكي للمراجع الطبية ---
function checkRanges() {
  const validate = (el, condition) => {
    if (!el.value) { el.classList.remove('out-of-range'); return; }
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
}

// ربط الحقول بنظام التلوين الذكي عند الكتابة
[hba1cVal, lip_tc, lip_ldl, lip_hdl, lip_tg, thy_tsh, thy_ft4, ren_mac, ren_creat].forEach(input => {
  if(input) input.addEventListener('input', checkRanges);
});

onAuthStateChanged(auth, async user=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لم يتم العثور على رقم الطفل.'); return; }

  const cref = doc(db, `parents/${user.uid}/children/${childId}`);
  const csnp = await getDoc(cref);
  const childName = csnp.exists() ? (csnp.data().name || 'طفل') : 'طفل';
  
  if(childNameEl) childNameEl.textContent = childName;

  await loadHistory(user.uid, childId, childName);

  if (labIdParam){
    const labRef = doc(db, `parents/${user.uid}/children/${childId}/labs/${labIdParam}`);
    const labSnap= await getDoc(labRef);
    if (!labSnap.exists()){ alert('التقرير غير موجود.'); return; }
    const labData = labSnap.data();
    _currentLabId = labSnap.id;
    fillFormFromDoc(labData);
    checkRanges(); 
    showDueBadge(labData.nextDue?.toDate ? labData.nextDue.toDate() : addMonths(labData.when?.toDate ? labData.when.toDate() : new Date(labData.date)));
    openPdf(_currentLabId, childName, labData);
  } else {
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

  // ربط الأزرار الآن سيعمل بنجاح
  if(saveBtn) saveBtn.addEventListener('click', ()=> saveLab(user.uid, childId, childName, false));
  if(savePdfBtn) savePdfBtn.addEventListener('click', ()=> saveLab(user.uid, childId, childName, true));
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

  if(generalNote) generalNote.value = d?.generalNote ?? '';
}

function buildDocFromForm(){
  const when = new Date((labDateEl?.value || fmt(new Date()))+'T00:00:00');
  const nextDue = addMonths(when, 4);
  return {
    when,
    date: fmt(when),
    nextDue,
    type: labTypeEl?.value || 'full',
    hba1c: { value: numOrNull(hba1cVal?.value), note: strOrNull(hba1cNote?.value) },
    lipid: { tc:numOrNull(lip_tc?.value), ldl:numOrNull(lip_ldl?.value), hdl:numOrNull(lip_hdl?.value), tg:numOrNull(lip_tg?.value), note: strOrNull(lip_note?.value) },
    thyroid: { tsh:numOrNull(thy_tsh?.value), ft4:numOrNull(thy_ft4?.value), note: strOrNull(thy_note?.value) },
    renal: { microalb_creat:numOrNull(ren_mac?.value), creatinine:numOrNull(ren_creat?.value), note: strOrNull(ren_note?.value) },
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
  return url.toString();
}

async function openPdf(labId, childName, data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});
  
  doc.setFont('Helvetica');

  doc.setFontSize(16);
  doc.text(`Lab Report — ${childName}`, 40, 40);
  doc.setFontSize(11);
  doc.text(`Report ID: ${labId}`, 40, 62);
  doc.text(`Sample Date: ${data.date}`, 40, 78);

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

    doc.link(40, 96, 90, 90, { url: reportUrl });
    doc.textWithLink('Open Report', 370, 135, { url: reportUrl, align: 'right' });
  }catch(e){ console.warn('Barcode/QR warning', e); }

  let y = 210;

  const baseTable = {
    styles:{halign:'left', font: 'Helvetica'},
    headStyles:{fillColor:[244,247,255], font:'Helvetica'},
    theme:'grid',
    margin:{left:40,right:40}
  };

  const hbaRows = [[ data?.hba1c?.value ?? '-', '%', data?.hba1c?.note ?? '-' ]];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['HbA1c', 'Unit', 'Notes']],
    body: [ hbaRows[0].map(v => (v===null?'-':v)) ]
  });
  y = doc.lastAutoTable.finalY + 14;

  const lipRows = [
    ['TC', data?.lipid?.tc ?? '-', 'mg/dL', data?.lipid?.note ?? '-'],
    ['LDL', data?.lipid?.ldl ?? '-', 'mg/dL', '-'],
    ['HDL', data?.lipid?.hdl ?? '-', 'mg/dL', '-'],
    ['TG', data?.lipid?.tg  ?? '-', 'mg/dL', '-'],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['Lipid Profile', 'Value', 'Unit', 'Notes']],
    body: lipRows
  });
  y = doc.lastAutoTable.finalY + 14;

  const thRows = [
    ['TSH', data?.thyroid?.tsh ?? '-', 'mIU/L', data?.thyroid?.note ?? '-'],
    ['FT4', data?.thyroid?.ft4 ?? '-', 'ng/dL', '-'],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['Thyroid', 'Value', 'Unit', 'Notes']],
    body: thRows
  });
  y = doc.lastAutoTable.finalY + 14;

  const rnRows = [
    ['Microalbumin/Creatinine', data?.renal?.microalb_creat ?? '-', 'mg/g', data?.renal?.note ?? '-'],
    ['Creatinine', data?.renal?.creatinine ?? '-', 'mg/dL', '-'],
  ];
  doc.autoTable({
    ...baseTable,
    startY: y,
    head: [['Renal', 'Value', 'Unit', 'Notes']],
    body: rnRows
  });
  y = doc.lastAutoTable.finalY + 14;

  const nextDue = data.nextDue ? (data.nextDue instanceof Date ? data.nextDue : new Date(data.nextDue)) : addMonths(new Date(data.date),4);
  doc.setFontSize(11);
  doc.text(`Next Lab Due (HbA1c every 4 months): ${fmt(nextDue)}`, 40, y);
  y += 18;
  if (data?.generalNote){
    doc.setFont('Helvetica','bold'); doc.text('General Notes:', 40, y); y+=14;
    doc.setFont('Helvetica','normal'); doc.text(String(data.generalNote), 40, y, {maxWidth:515});
  }

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

async function loadHistory(uid, childId, childName){
  if(!historyBody) return;
  const lref = collection(db, `parents/${uid}/children/${childId}/labs`);
  const qy = query(lref, orderBy('when','desc'), limit(20));
  const sn = await getDocs(qy);

  historyBody.innerHTML = '';
  if (sn.empty){
    historyBody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align: center; padding: 20px;">لا توجد سجلات سابقة</td></tr>`;
    return;
  }

  sn.forEach(d=>{
    const v = d.data();
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
}
