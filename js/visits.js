// js/visits.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, updateDoc, serverTimestamp, where, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('lastChildId');

let currentUser, childData;
let editingId = null;
let existingAttachments = [], attachmentsToDelete = [], selectedFiles = [], allVisits = [], filteredVisits = [];

const pad = n => String(n).padStart(2,'0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
function dateAdd(s,days){ const d=new Date(s||new Date()); d.setDate(d.getDate()+days); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function showLoader(v) { $('appLoader').style.display = v ? 'flex' : 'none'; }

onAuthStateChanged(auth, async (user)=>{
  if (!user) return;
  currentUser = user;
  
  showLoader(true);
  try {
    const snap = await getDoc(doc(db, `parents/${user.uid}/children/${childId}`));
    if(snap.exists()) childData = snap.data();
    
    const to = todayStr();
    $('fromDate').value = dateAdd(to, -90);
    $('toDate').value = to;

    await loadVisits();
    await buildAISuggestions();

    // Events
    ['filterType', 'filterApplied', 'searchBox', 'fromDate', 'toDate'].forEach(id => {
      $(id).addEventListener('input', renderVisits);
    });

    $('newVisitBtn').onclick = () => openModal();
    $('closeModal').onclick = () => $('visitModal').classList.add('hidden');
    $('cancelVisitBtn').onclick = () => $('visitModal').classList.add('hidden');
    $('copyAgenda').onclick = copyAgendaToClipboard;
    $('exportCSV').onclick = exportCSV;
    $('printList').onclick = () => window.print();

    $('attachments').onchange = (e) => { selectedFiles = Array.from(e.target.files); renderSelectedFiles(); };
    $('visitForm').onsubmit = handleSaveVisit;

  } catch(e) { console.error(e); }
  finally { showLoader(false); }
});

async function loadVisits(){
  const qy = query(collection(db, `parents/${currentUser.uid}/children/${childId}/visits`), orderBy('date','desc'));
  const snap = await getDocs(qy);
  allVisits = [];
  
  snap.forEach(d => {
    const v = d.data();
    v.labsRequested = v.labsRequested ? String(v.labsRequested).split(',').map(s=>s.trim()).filter(Boolean) : [];
    v.labsCompleted = v.labsCompleted || [];
    allVisits.push({ id:d.id, ...v });
  });

  const today = todayStr();
  const future = allVisits.filter(r => r.followUpDate && r.followUpDate >= today).map(r => r.followUpDate).sort();
  
  $('lastVisit').textContent = allVisits.length ? allVisits[0].date : '—';
  $('nextFollowUp').textContent = future.length ? future[0] : '—';
  $('pendingCount').textContent = allVisits.filter(r => String(r.applied) !== 'true').length;

  renderVisits();
}

function renderVisits(){
  const list = $('visitsList'); list.innerHTML = '';
  const t = $('filterType').value, a = $('filterApplied').value, q = $('searchBox').value.toLowerCase();
  const s = $('fromDate').value, e = $('toDate').value;

  filteredVisits = allVisits.filter(r => {
    const matchType = !t || r.type === t;
    const matchApp = !a || String(r.applied) === a;
    const matchDate = (!s || r.date >= s) && (!e || r.date <= e);
    const matchSearch = !q || `${r.doctorName} ${r.reason} ${r.summary}`.toLowerCase().includes(q);
    return matchType && matchApp && matchDate && matchSearch;
  });

  if(!filteredVisits.length){
    list.innerHTML = `<div style="text-align:center; padding:40px; color:#64748b;">لا توجد زيارات مطابقة للبحث.</div>`;
    return;
  }

  filteredVisits.forEach(r => {
    const card = document.createElement('div');
    card.className = 'visit-card';
    
    const isApplied = String(r.applied) === 'true';
    const typeCls = r.type === 'متابعة دورية' ? 'dori' : r.type === 'طارئة' ? 'tari2' : '';

    let labsHtml = '';
    if(r.labsRequested.length) {
      labsHtml = `<div class="vc-box"><h4>🧪 فحوصات مطلوبة</h4><div class="vc-labs">` +
        r.labsRequested.map(lab => `<span class="lab-chip ${r.labsCompleted.includes(lab)?'done':''}" data-id="${r.id}" data-lab="${lab}">${lab}</span>`).join('') +
      `</div></div>`;
    }

    let dosesHtml = '';
    if(r.longActingChange || r.mealDosesChange) {
      dosesHtml = `<div class="vc-box" style="border-color:#f59e0b; background:#fffbeb;"><h4>💉 تعديلات الجرعات</h4>
        ${r.longActingChange ? `<div><b>القاعدي:</b> ${r.longActingChange}</div>` : ''}
        ${r.mealDosesChange ? `<div><b>الوجبات:</b> ${r.mealDosesChange}</div>` : ''}
      </div>`;
    }

    card.innerHTML = `
      <div class="vc-header">
        <div class="vc-title">👨‍⚕️ ${r.doctorName || 'طبيب'} <span class="vc-type ${typeCls}">${r.type}</span></div>
        <div class="vc-date">${r.date} ${r.time ? `(${r.time})` : ''}</div>
      </div>
      <div class="vc-body">
        ${r.reason ? `<div class="vc-reason"><b>السبب:</b> ${r.reason}</div>` : ''}
        ${r.summary ? `<div class="vc-box"><h4>📝 خلاصة الزيارة</h4><div>${r.summary}</div></div>` : ''}
        ${r.recommendations ? `<div class="vc-box" style="border-color:#10b981; background:#ecfdf5;"><h4>💡 توصيات الطبيب</h4><div>${r.recommendations}</div></div>` : ''}
        ${dosesHtml}
        ${labsHtml}
      </div>
      <div class="vc-footer">
        <button class="status-btn ${isApplied ? 'applied' : 'pending'}" data-toggle="${r.id}">
          ${isApplied ? '✅ تم التطبيق' : '⏳ بانتظار التطبيق'}
        </button>
        <div class="vc-actions">
          ${r.attachments?.length ? `<span style="font-size:12px; color:#64748b; margin-left:10px;">📎 ${r.attachments.length} ملف</span>` : ''}
          <button class="btn small secondary act-edit">تعديل</button>
          <button class="btn small ghost act-del" style="color:#dc2626; border-color:#fecaca;">حذف</button>
        </div>
      </div>
    `;

    card.querySelector('[data-toggle]').onclick = () => toggleApplied(r);
    card.querySelector('.act-edit').onclick = () => openModal(r);
    card.querySelector('.act-del').onclick = () => deleteVisit(r.id);
    
    card.querySelectorAll('.lab-chip').forEach(chip => {
      chip.onclick = async () => {
        const labName = chip.getAttribute('data-lab');
        await toggleLabDone(r, labName, chip);
      };
    });

    list.appendChild(card);
  });
}

async function toggleApplied(v){
  const newVal = String(v.applied) !== 'true';
  await updateDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/visits`, v.id), { applied: newVal });
  loadVisits();
}

async function toggleLabDone(v, labName, chipEl){
  const done = new Set(v.labsCompleted);
  if(done.has(labName)) done.delete(labName); else {
    done.add(labName);
    if(confirm(`تم تحديد "${labName}" كمكتمل. هل تريد الانتقال لصفحة التحاليل لتسجيل النتيجة؟`)) {
      window.location.href = `labs.html?child=${childId}`;
    }
  }
  await updateDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/visits`, v.id), { labsCompleted: Array.from(done) });
  chipEl.classList.toggle('done');
}

async function deleteVisit(id){
  if(!confirm('هل أنت متأكد من حذف الزيارة نهائياً؟')) return;
  await deleteDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/visits`, id));
  loadVisits();
}

function openModal(v = null){
  editingId = v ? v.id : null;
  $('visitForm').reset();
  selectedFiles = []; attachmentsToDelete = []; existingAttachments = [];
  
  if(v) {
    $('modalTitle').textContent = 'تعديل زيارة';
    ['date','time','type','doctorName','reason','summary','recommendations','longActingChange','mealDosesChange','followUpDate'].forEach(k => $(k).value = v[k] || '');
    $('labsRequested').value = v.labsRequested.join(', ');
    $('applied').value = String(v.applied);
    existingAttachments = v.attachments || [];
  } else {
    $('modalTitle').textContent = 'إضافة زيارة طبية';
    $('date').value = todayStr();
  }
  
  renderSelectedFiles(); renderExisting();
  $('visitModal').classList.remove('hidden');
}

function renderSelectedFiles(){
  const w = $('selectedFiles'); w.innerHTML = '';
  selectedFiles.forEach((f, i)=>{
    const div = document.createElement('div'); div.className = 'file-item';
    div.innerHTML = `<span>${f.name}</span> <button type="button" data-i="${i}">✕</button>`;
    div.querySelector('button').onclick = () => { selectedFiles.splice(i,1); renderSelectedFiles(); };
    w.appendChild(div);
  });
}
function renderExisting(){
  const w = $('existingFiles'); w.innerHTML = '';
  $('existingWrap').classList.toggle('hidden', !existingAttachments.length);
  existingAttachments.forEach((f, i)=>{
    const div = document.createElement('div'); div.className = 'file-item';
    div.innerHTML = `<a href="${f.url}" target="_blank">📄 ${f.name}</a> <button type="button" data-i="${i}">✕</button>`;
    div.querySelector('button').onclick = () => { attachmentsToDelete.push(f.path); existingAttachments.splice(i,1); renderExisting(); };
    w.appendChild(div);
  });
}

async function handleSaveVisit(e){
  e.preventDefault();
  showLoader(true);
  const payload = {
    date: $('date').value, time: $('time').value, type: $('type').value, doctorName: $('doctorName').value,
    reason: $('reason').value, summary: $('summary').value, recommendations: $('recommendations').value,
    longActingChange: $('longActingChange').value, mealDosesChange: $('mealDosesChange').value,
    labsRequested: $('labsRequested').value.split(',').map(s=>s.trim()).filter(Boolean),
    followUpDate: $('followUpDate').value, applied: $('applied').value === 'true',
    updatedAt: serverTimestamp()
  };

  try {
    const colRef = collection(db, `parents/${currentUser.uid}/children/${childId}/visits`);
    let vId = editingId;
    if (!vId) { payload.createdAt = serverTimestamp(); const added = await addDoc(colRef, payload); vId = added.id; }
    else { await updateDoc(doc(colRef, vId), payload); }

    const storage = getStorage();
    const uploaded = [];
    for (const f of selectedFiles){
      const p = `parents/${currentUser.uid}/children/${childId}/visits/${vId}/${Date.now()}_${f.name}`;
      const r = sRef(storage, p); await uploadBytes(r, f);
      uploaded.push({ name:f.name, url: await getDownloadURL(r), path: p });
    }
    for (const p of attachmentsToDelete){ try{ await deleteObject(sRef(storage, p)); }catch(e){} }
    
    await updateDoc(doc(colRef, vId), { attachments: [...existingAttachments, ...uploaded] });
    
    $('visitModal').classList.add('hidden');
    loadVisits();
  } catch(err){ alert('حدث خطأ'); console.error(err); }
  finally{ showLoader(false); }
}

async function buildAISuggestions(){
  const aiList = $('aiList');
  try{
    const from = dateAdd(todayStr(), -6);
    const qy = query(collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`), where('date','>=', from));
    const snap = await getDocs(qy);
    
    if (snap.empty){ aiList.innerHTML = '<li>لا توجد قياسات كافية في آخر أسبوع.</li>'; return; }

    const unit = childData.glucoseUnit || 'mg/dL';
    const isMmol = unit.includes('mmol');
    const nMin = isMmol ? 3.9 : 70;
    const nMax = isMmol ? 7.8 : 140;

    let lows=0, highs=0, total=0;
    snap.forEach(d => {
      const v = d.data();
      let val = isMmol ? (v.value_mmol || v.value) : (v.value_mgdl || v.value);
      val = Number(val);
      if(isNaN(val)) return;
      total++;
      if (val < nMin) lows++;
      if (val > nMax) highs++;
    });

    const sug = [];
    if (highs > total*0.4) sug.push(`⚠️ قراءات الارتفاع تمثل ${Math.round((highs/total)*100)}% من الأسبوع الماضي. (اسأل الطبيب عن تعديل المعاملات CR/CF).`);
    if (lows > 1) sug.push(`🚨 تم رصد هبوط متكرر (${lows} مرات). (اسأل عن تقليل الجرعة القاعدية أو تعديل سناك النوم).`);
    sug.push(`💡 اطلب من الطبيب مراجعة أماكن حقن الأنسولين (للتأكد من عدم وجود تكتلات دهنية).`);

    aiList.innerHTML = sug.map(t=>`<li>${t}</li>`).join('');
  } catch(e) { aiList.innerHTML = '<li>تعذر تحليل البيانات.</li>'; }
}

function copyAgendaToClipboard(){
  const txt = Array.from($('aiList').querySelectorAll('li')).map(li=>`• ${li.textContent}`).join('\n');
  if(!txt) return;
  navigator.clipboard.writeText(txt).then(()=> alert('تم النسخ ✅'));
}

// دالة التصدير المكتملة
function exportCSV(){
  if(!filteredVisits || filteredVisits.length === 0) return alert('لا توجد زيارات لتصديرها');
  let csv = '\uFEFFالتاريخ,الوقت,النوع,الطبيب/المركز,السبب,تشخيص الطبيب,التوصيات,حالة التطبيق\n';
  
  filteredVisits.forEach(v => {
    const isApplied = String(v.applied) === 'true' ? 'تم التطبيق' : 'بانتظار التطبيق';
    // تنظيف النصوص من الفواصل والأسطر الجديدة لتجنب كسر ملف الـ CSV
    const reason = (v.reason || '').replace(/"/g, '""').replace(/\n/g, ' ');
    const summary = (v.summary || '').replace(/"/g, '""').replace(/\n/g, ' ');
    const rec = (v.recommendations || '').replace(/"/g, '""').replace(/\n/g, ' ');
    
    csv += `${v.date},${v.time||''},${v.type},${v.doctorName},"${reason}","${summary}","${rec}",${isApplied}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Visits_Report_${todayStr()}.csv`;
  link.click();
}
