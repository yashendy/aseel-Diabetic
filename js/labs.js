// js/labs.js

import { auth, db } from './firebase-config.js';
import {
  collection, doc, setDoc, addDoc, getDoc, getDocs, query, orderBy, serverTimestamp
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

// حقول
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

onAuthStateChanged(auth, async user=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد child في الرابط'); return; }

  const cref = doc(db, `parents/${user.uid}/children/${childId}`);
  const csnp = await getDoc(cref);
  const childName = csnp.exists() ? (csnp.data().name || 'طفل') : 'طفل';
  childNameEl.textContent = childName;
  hdrChild.textContent = `— ${childName}`;

  if (labIdParam){
    const labRef = doc(db, `parents/${user.uid}/children/${childId}/labs/${labIdParam}`);
    const labSnap= await getDoc(labRef);
    if (!labSnap.exists()){ alert('لم يتم العثور على التقرير'); return; }
    const labData = labSnap.data();
    fillFormFromDoc(labData);
    openPdf(labSnap.id, childName, labData);
    showDueBadge(labData.nextDue?.toDate ? labData.nextDue.toDate() : addMonths(labData.when?.toDate ? labData.when.toDate() : new Date(labData.date)));
    return;
  }

  const lref = collection(db, `parents/${user.uid}/children/${childId}/labs`);
  const qy = query(lref, orderBy('when','desc'));
  const sn = await getDocs(qy);
  if (!sn.empty){
    const last = sn.docs[0].data();
    const due = last.nextDue?.toDate ? last.nextDue.toDate()
              : addMonths(last.when?.toDate ? last.when.toDate() : new Date(last.date));
    showDueBadge(due);
  }

  saveBtn.addEventListener('click', ()=> saveLab(user.uid, childId, childName, false));
  savePdfBtn.addEventListener('click', ()=> saveLab(user.uid, childId, childName, true));
  pdfBtn.addEventListener('click', ()=>{
    const fake = buildDocFromForm();
    openPdf('preview', childName, fake);
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

  if (d?.fileUrl){
    fileLinkBox.innerHTML = `📎 مرفق: <a href="${d.fileUrl}" target="_blank">فتح الملف</a>`;
  } else {
    fileLinkBox.textContent = '';
  }
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function numOrNull(v){ return v==='' || v==null ? null : Number(v); }
function strOrNull(v){ return v && String(v).trim()!=='' ? String(v).trim() : null; }

async function saveLab(uid, childId, childName, andPdf=false){
  try{
    const data = buildDocFromForm();
    const col = collection(db, `parents/${uid}/children/${childId}/labs`);
    const added = await addDoc(col, {
      ...data,
      when: data.when,
      nextDue: data.nextDue
    });
    if (andPdf) openPdf(added.id, childName, data);
    alert('تم الحفظ بنجاح');
  }catch(e){
    console.error(e);
    alert('حدث خطأ أثناء الحفظ');
  }
}

// 🖨️ توليد PDF
function openPdf(labId, childName, data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});

  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text(`تقرير التحاليل — ${childName}`, 40, 40, {align:'right'});
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  doc.text(`رقم التقرير: ${labId}`, 40, 62, {align:'right'});
  doc.text(`تاريخ العينة: ${data.date}`, 40, 78, {align:'right'});

  const payload = `lab:${labId}|child:${childId}|date:${data.date}`;
  try{
    const qrDiv = document.getElementById('qr');
    qrDiv.innerHTML = '';
    const qr = new QRCode(qrDiv, {text: payload, width: 90, height: 90, correctLevel: QRCode.CorrectLevel.M});
    const qrCanvas = qrDiv.querySelector('canvas');
    const qrDataUrl = qrCanvas ? qrCanvas.toDataURL('image/png') : null;

    const svg = document.getElementById('barcode');
    JsBarcode(svg, payload,
