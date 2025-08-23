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

onAuthStateChanged(auth, async user=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('No child ID found in URL.'); return; }

  const cref = doc(db, `parents/${user.uid}/children/${childId}`);
  const csnp = await getDoc(cref);
  const childName = csnp.exists() ? (csnp.data().name || 'Child') : 'Child';
  childNameEl.textContent = childName;
  hdrChild.textContent = `— ${childName}`;

  // Load history records
  await loadHistory(user.uid, childId, childName);

  if (labIdParam){
    const labRef = doc(db, `parents/${user.uid}/children/${childId}/labs/${labIdParam}`);
    const labSnap= await getDoc(labRef);
    if (!labSnap.exists()){ alert('Lab report not found.'); return; }
    const labData = labSnap.data();
    _currentLabId = labSnap.id;
    fillFormFromDoc(labData);
    showDueBadge(labData.nextDue?.toDate ? labData.nextDue.toDate() : addMonths(labData.when?.toDate ? labData.when.toDate() : new Date(labData.date)));
    openPdf(_currentLabId, childName, labData);
  } else {
    // Show badge from last report
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
  const txt = `Next Lab: ${fmt(dueDate)} (${days} days)`;
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
      // Edit existing doc
      const ref = doc(db, `parents/${uid}/children/${childId}/labs/${_currentLabId}`);
      await setDoc(ref, { ...data }, { merge: true });
      if (andPdf) openPdf(_currentLabId, childName, data);
      alert('Report updated successfully.');
    } else {
      // Create new
      const added = await addDoc(col, {
        ...data,
        when: data.when,
        nextDue: data.nextDue
      });
      _currentLabId = added.id;
      if (andPdf) openPdf(added.id, childName, data);
      alert('Report saved successfully.');
    }

    // Update history table
    await loadHistory(uid, childId, childName);
  }catch(e){
    console.error(e);
    alert('An error occurred while saving/updating the report.');
  }
}

// Build report URL (absolute link to open from QR)
function buildReportUrl(labId){
  const url = new URL('labs.html', location.href);
  url.searchParams.set('child', childId);
  url.searchParams.set('lab', labId);
  return url.toString();
}

// 🖨️ Generate PDF
async function openPdf(labId, childName, data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});
  
  // Use a standard font for English
  doc.setFont('Helvetica');

  // Titles
  doc.setFontSize(16);
  doc.text(`Lab Report — ${childName}`, 40, 40);
  doc.setFontSize(11);
  doc.text(`Report ID: ${labId}`, 40, 62);
  doc.text(`Sample Date: ${data.date}`, 40, 78);

  // QR + Barcode with a direct link
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

    // Clickable area over QR
    doc.link(40, 96, 90, 90, { url: reportUrl });
    doc.textWithLink('Open Report', 370, 135, { url: reportUrl, align: 'right' });
  }catch(e){ console.warn('Barcode/QR warning', e); }

  let y = 210;

  // General table settings for English
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

/* =================== السجلات السابقة =================== */
async function loadHistory(uid, childId, childName){
  const lref = collection(db, `parents/${uid}/children/${childId}/labs`);
  const qy = query(lref, orderBy('when','desc'), limit(20));
  const sn = await getDocs(qy);

  historyBody.innerHTML = '';
  if (sn.empty){
    historyBody.innerHTML = `<tr><td colspan="4" class="muted">No records found.</td></tr>`;
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
          <button class="btn small gray act-open">Open PDF</button>
          <button class="btn small act-edit">Edit</button>
          <button class="btn small danger act-del">Delete</button>
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
      if (confirm('Are you sure you want to delete this report?')){
        await deleteDoc(doc(db, `parents/${uid}/children/${childId}/labs/${d.id}`));
        if (_currentLabId === d.id) _currentLabId = null;
        await loadHistory(uid, childId, childName);
        alert('Report deleted successfully.');
      }
    });
    historyBody.appendChild(tr);
  });
}
