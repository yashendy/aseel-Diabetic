// js/labs.js
import { auth, db } from './firebase-config.js';
import { collection, doc, setDoc, addDoc, getDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, limit } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const labDateEl = document.getElementById('labDate');
const labTypeEl = document.getElementById('labType');
const dueBadge = document.getElementById('dueBadge');
const saveBtn = document.getElementById('saveBtn');
const savePdfBtn = document.getElementById('savePdfBtn');
const printBtn = document.getElementById('printBtn');

// حقول الإدخال
const hba1cVal = document.getElementById('hba1cVal'); const hba1cNote = document.getElementById('hba1cNote');
const vit_d = document.getElementById('vit_d'); const vit_note = document.getElementById('vit_note');
const celiac_iga = document.getElementById('celiac_iga'); const celiac_igg = document.getElementById('celiac_igg'); const celiac_note = document.getElementById('celiac_note');
const lip_tc = document.getElementById('lip_tc'); const lip_ldl= document.getElementById('lip_ldl'); const lip_hdl= document.getElementById('lip_hdl'); const lip_tg = document.getElementById('lip_tg'); const lip_note = document.getElementById('lip_note');
const thy_tsh = document.getElementById('thy_tsh'); const thy_ft4 = document.getElementById('thy_ft4'); const thy_note= document.getElementById('thy_note');
const ren_mac = document.getElementById('ren_mac'); const ren_note = document.getElementById('ren_note');
const liv_alt = document.getElementById('liv_alt'); const liv_ast = document.getElementById('liv_ast'); const liv_note = document.getElementById('liv_note');
const fundus_exam = document.getElementById('fundus_exam'); const clinic_note = document.getElementById('clinic_note');
const generalNote = document.getElementById('generalNote');
const historyBody = document.getElementById('historyBody');

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('lastChildId');
let _currentLabId = params.get('lab') || null;
let childNameGlobal = "الطفل";
let chartInstance = null;

const pad = n=>String(n).padStart(2,'0');
const fmt = d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
labDateEl.value = fmt(new Date());

function addMonths(date, m=4){ const d = new Date(date); const day = d.getDate(); d.setMonth(d.getMonth()+m); if (d.getDate() < day) d.setDate(0); return d; }
function showLoader(v){ const l = document.getElementById('appLoader'); if(l) l.style.display = v ? 'flex' : 'none'; }

onAuthStateChanged(auth, async user=>{
  if(!user) return;
  showLoader(true);
  try {
    const cref = doc(db, `parents/${user.uid}/children/${childId}`);
    const csnp = await getDoc(cref);
    childNameGlobal = csnp.exists() ? (csnp.data().name || 'الطفل') : 'الطفل';

    await loadHistory(user.uid, childId, childNameGlobal);

    if (_currentLabId){
      const labRef = doc(db, `parents/${user.uid}/children/${childId}/labs/${_currentLabId}`);
      const labSnap= await getDoc(labRef);
      if (labSnap.exists()){
        fillFormFromDoc(labSnap.data());
        showDueBadge(labSnap.data().nextDue?.toDate ? labSnap.data().nextDue.toDate() : addMonths(labSnap.data().when?.toDate ? labSnap.data().when.toDate() : new Date(labSnap.data().date)));
      }
    } else {
      const qy = query(collection(db, `parents/${user.uid}/children/${childId}/labs`), orderBy('when','desc'), limit(1));
      const sn = await getDocs(qy);
      if (!sn.empty){
        const last = sn.docs[0].data();
        showDueBadge(last.nextDue?.toDate ? last.nextDue.toDate() : addMonths(last.when?.toDate ? last.when.toDate() : new Date(last.date)));
      }
    }

    saveBtn.onclick = ()=> saveLab(user.uid, childId, false);
    savePdfBtn.onclick = ()=> saveLab(user.uid, childId, true);
    printBtn.onclick = ()=> window.print();

  } catch(e){ console.error(e); }
  finally { showLoader(false); }
});

function showDueBadge(dueDate){
  if (!dueDate){ dueBadge.textContent=''; return; }
  const today = new Date();
  const days = Math.ceil((dueDate - today)/86400000);
  dueBadge.textContent = `موعد التحليل القادم: ${fmt(dueDate)} (${days > 0 ? `متبقي ${days} يوم` : 'متأخر'})`;
  dueBadge.className = 'pill tiny bold ' + (days<0 ? 'danger' : (days<=14 ? 'warn' : 'ok'));
}

// تلوين ذكي لحقل السكر التراكمي
hba1cVal.addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  if(!v) e.target.style.backgroundColor = '#fff';
  else if(v <= 7.0) e.target.style.backgroundColor = '#dcfce7'; // أخضر
  else if(v <= 8.5) e.target.style.backgroundColor = '#fef08a'; // أصفر
  else e.target.style.backgroundColor = '#fee2e2'; // أحمر
});

function fillFormFromDoc(d){
  labDateEl.value = d.date || (d.when?.toDate ? fmt(d.when.toDate()) : fmt(new Date()));
  labTypeEl.value = d.type || 'full';
  hba1cVal.value = d?.hba1c?.value ?? ''; hba1cNote.value = d?.hba1c?.note ?? '';
  vit_d.value = d?.vitaminD?.value ?? ''; vit_note.value = d?.vitaminD?.note ?? '';
  celiac_iga.value = d?.celiac?.iga ?? ''; celiac_igg.value = d?.celiac?.igg ?? ''; celiac_note.value = d?.celiac?.note ?? '';
  lip_tc.value = d?.lipid?.tc ?? ''; lip_ldl.value= d?.lipid?.ldl?? ''; lip_hdl.value= d?.lipid?.hdl?? ''; lip_tg.value = d?.lipid?.tg ?? ''; lip_note.value= d?.lipid?.note ?? '';
  thy_tsh.value= d?.thyroid?.tsh ?? ''; thy_ft4.value= d?.thyroid?.ft4 ?? ''; thy_note.value= d?.thyroid?.note ?? '';
  ren_mac.value= d?.renal?.microalb_creat ?? ''; ren_note.value= d?.renal?.note ?? '';
  liv_alt.value= d?.liver?.alt ?? ''; liv_ast.value= d?.liver?.ast ?? ''; liv_note.value= d?.liver?.note ?? '';
  fundus_exam.value = d?.clinical?.fundus ?? ''; clinic_note.value = d?.clinical?.note ?? '';
  generalNote.value = d?.generalNote ?? '';
  hba1cVal.dispatchEvent(new Event('input'));
}

function buildDocFromForm(){
  const when = new Date(labDateEl.value+'T12:00:00');
  return {
    when, date: fmt(when), nextDue: addMonths(when, labTypeEl.value==='full'? 12 : 4), type: labTypeEl.value,
    hba1c: { value: numOrNull(hba1cVal.value), note: strOrNull(hba1cNote.value) },
    vitaminD: { value: numOrNull(vit_d.value), note: strOrNull(vit_note.value) },
    celiac: { iga: numOrNull(celiac_iga.value), igg: numOrNull(celiac_igg.value), note: strOrNull(celiac_note.value) },
    lipid: { tc:numOrNull(lip_tc.value), ldl:numOrNull(lip_ldl.value), hdl:numOrNull(lip_hdl.value), tg:numOrNull(lip_tg.value), note: strOrNull(lip_note.value) },
    thyroid: { tsh:numOrNull(thy_tsh.value), ft4:numOrNull(thy_ft4.value), note: strOrNull(thy_note.value) },
    renal: { microalb_creat:numOrNull(ren_mac.value), note: strOrNull(ren_note.value) },
    liver: { alt: numOrNull(liv_alt.value), ast: numOrNull(liv_ast.value), note: strOrNull(liv_note.value) },
    clinical: { fundus: strOrNull(fundus_exam.value), note: strOrNull(clinic_note.value) },
    generalNote: strOrNull(generalNote.value),
    updatedAt: serverTimestamp(), createdAt: serverTimestamp()
  };
}

const numOrNull = v => v==='' || v==null ? null : Number(v);
const strOrNull = v => v && String(v).trim()!=='' ? String(v).trim() : null;

async function saveLab(uid, childId, andPdf=false){
  showLoader(true);
  try{
    const data = buildDocFromForm();
    const col = collection(db, `parents/${uid}/children/${childId}/labs`);
    if (_currentLabId){
      await setDoc(doc(col, _currentLabId), { ...data }, { merge: true });
    } else {
      const added = await addDoc(col, data);
      _currentLabId = added.id;
    }
    await loadHistory(uid, childId, childNameGlobal);
    if (andPdf) generatePDF(_currentLabId, childNameGlobal, data);
    alert('تم حفظ التقرير بنجاح!');
  }catch(e){ console.error(e); alert('حدث خطأ أثناء الحفظ.'); }
  finally { showLoader(false); }
}

/* =================== الرسم البياني والسجلات =================== */
async function loadHistory(uid, childId, childName){
  const qy = query(collection(db, `parents/${uid}/children/${childId}/labs`), orderBy('when','desc'), limit(15));
  const sn = await getDocs(qy);
  
  let historyData = [];
  historyBody.innerHTML = '';
  if (sn.empty){
    historyBody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center">لا توجد سجلات.</td></tr>`;
    renderChart([]); return;
  }

  sn.forEach(d=>{
    const v = d.data(); historyData.push(v);
    const when = v.when?.toDate ? v.when.toDate() : new Date(v.date);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmt(when)}</td>
      <td>${v.type==='full' ? 'شامل' : 'دوري'}</td>
      <td><span class="pill ${v.hba1c?.value<=7 ? 'ok' : (v.hba1c?.value<=8.5 ? 'warn' : 'danger')}">${v?.hba1c?.value!=null ? v.hba1c.value+'%' : '—'}</span></td>
      <td>
        <div class="row" style="justify-content:center; gap:4px">
          <button class="btn small alt act-pdf">PDF</button>
          <button class="btn small secondary act-edit">تعديل</button>
          <button class="btn small danger act-del">حذف</button>
        </div>
      </td>
    `;
    tr.querySelector('.act-pdf').onclick = ()=> generatePDF(d.id, childName, v);
    tr.querySelector('.act-edit').onclick = ()=>{ _currentLabId = d.id; fillFormFromDoc(v); window.scrollTo({top:0, behavior:'smooth'}); };
    tr.querySelector('.act-del').onclick = async ()=>{
      if (confirm('هل تريد حذف هذا التقرير نهائياً؟')){
        await deleteDoc(doc(db, `parents/${uid}/children/${childId}/labs/${d.id}`));
        if (_currentLabId === d.id) _currentLabId = null;
        await loadHistory(uid, childId, childName);
      }
    };
    historyBody.appendChild(tr);
  });
  
  renderChart(historyData);
}

function renderChart(dataArr){
  const valid = dataArr.filter(d => d.hba1c && d.hba1c.value != null).reverse();
  const labels = valid.map(d => d.date);
  const data = valid.map(d => d.hba1c.value);

  const ctx = document.getElementById('hba1cChart').getContext('2d');
  if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
          labels: labels,
          datasets: [{
              label: 'السكر التراكمي (HbA1c) %',
              data: data, borderColor: '#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.1)', borderWidth: 2,
              pointBackgroundColor: data.map(v => v <= 7.0 ? '#16a34a' : (v <= 8.5 ? '#f59e0b' : '#ef4444')),
              pointRadius: 6, fill: true, tension: 0.3
          }]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 4, max: 14 } }, plugins: { legend: { display: false } } }
  });
}

/* =================== تصدير PDF =================== */
function generatePDF(labId, childName, data){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});
  doc.setFont('Helvetica');

  doc.setFontSize(18); doc.setTextColor(37, 99, 235);
  doc.text(`Aseel Platform - Lab Report`, 40, 40);
  
  doc.setFontSize(11); doc.setTextColor(0,0,0);
  doc.text(`Patient: ${childName}`, 40, 65);
  doc.text(`Date: ${data.date}   |   Type: ${data.type==='full'?'Full Annual':'HbA1c Only'}`, 40, 80);

  let y = 110;
  const tblOpt = { styles:{font:'Helvetica', halign:'left'}, headStyles:{fillColor:[37,99,235]}, margin:{left:40,right:40}, theme:'grid' };

  if(data.hba1c?.value || data.vitaminD?.value || data.celiac?.iga) {
    const rows = [];
    if(data.hba1c?.value) rows.push(['HbA1c', `${data.hba1c.value} %`, data.hba1c.note||'-']);
    if(data.vitaminD?.value) rows.push(['Vitamin D', `${data.vitaminD.value} nmol/L`, data.vitaminD.note||'-']);
    if(data.celiac?.iga) rows.push(['Celiac TTG IgA', `${data.celiac.iga} AU/ml`, data.celiac.note||'-']);
    if(data.celiac?.igg) rows.push(['Celiac TTG IgG', `${data.celiac.igg} AU/ml`, '-']);
    
    doc.autoTable({ ...tblOpt, startY:y, head:[['Test', 'Result', 'Notes']], body:rows });
    y = doc.lastAutoTable.finalY + 15;
  }

  if(data.lipid?.tc || data.thyroid?.tsh || data.liver?.alt) {
    const rows2 = [];
    if(data.lipid?.tc) rows2.push(['Total Cholesterol', `${data.lipid.tc} mmol/L`]);
    if(data.lipid?.ldl) rows2.push(['LDL Cholesterol', `${data.lipid.ldl} mmol/L`]);
    if(data.thyroid?.tsh) rows2.push(['TSH (Thyroid)', `${data.thyroid.tsh} mIU/L`]);
    if(data.renal?.microalb_creat) rows2.push(['Microalbumin/Creatinine', `${data.renal.microalb_creat} mg/g`]);
    if(data.liver?.alt) rows2.push(['ALT (Liver)', `${data.liver.alt} U/L`]);
    
    doc.autoTable({ ...tblOpt, startY:y, head:[['Extended Panel (Lipid, Thyroid, Renal, Liver)', 'Result']], body:rows2 });
    y = doc.lastAutoTable.finalY + 15;
  }

  if(data.clinical?.fundus || data.generalNote) {
    doc.setFont('Helvetica', 'bold'); doc.text('Clinical Notes:', 40, y); y += 15;
    doc.setFont('Helvetica', 'normal');
    if(data.clinical?.fundus) { doc.text(`Eye Fundus Exam: ${data.clinical.fundus}`, 40, y); y += 15; }
    if(data.generalNote) { doc.text(`Doctor Recommendations: ${data.generalNote}`, 40, y, {maxWidth:500}); }
  }

  window.open(URL.createObjectURL(doc.output('blob')), '_blank');
}
