// visits.js — v5 (زيارات + فلاتر + CSV + طباعة + AI) — بدون واتساب
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, addDoc, getDocs, query, orderBy, doc, getDoc,
  updateDoc, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* ====== عناصر ====== */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const nextFollowUpEl = document.getElementById('nextFollowUp');
const pendingCountEl = document.getElementById('pendingCount');
const lastVisitEl = document.getElementById('lastVisit');

const filterTypeEl = document.getElementById('filterType');
const filterAppliedEl = document.getElementById('filterApplied');
const searchBoxEl = document.getElementById('searchBox');
const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');

const newVisitBtn = document.getElementById('newVisitBtn');
const exportCSVBtn = document.getElementById('exportCSV');
const printListBtn = document.getElementById('printList');

const visitModal = document.getElementById('visitModal');
const closeModalBtn = document.getElementById('closeModal');
const cancelVisitBtn = document.getElementById('cancelVisitBtn');

const visitForm = document.getElementById('visitForm');
const modalTitle = document.getElementById('modalTitle');

const dateEl = document.getElementById('date');
const timeEl = document.getElementById('time');
const typeEl = document.getElementById('type');
const doctorEl = document.getElementById('doctorName');
const reasonEl = document.getElementById('reason');
const summaryEl = document.getElementById('summary');
const recsEl = document.getElementById('recommendations');
const longActingEl = document.getElementById('longActingChange');
const mealChangeEl = document.getElementById('mealDosesChange');
const labsEl = document.getElementById('labsRequested');
const followUpEl = document.getElementById('followUpDate');
const appliedEl = document.getElementById('applied');

const filesInput = document.getElementById('attachments');
const selectedFilesEl = document.getElementById('selectedFiles');
const existingWrap = document.getElementById('existingWrap');
const existingFilesEl = document.getElementById('existingFiles');

const visitsListEl = document.getElementById('visitsList');

const aiListEl = document.getElementById('aiList');
const copyAgendaBtn = document.getElementById('copyAgenda');

/* ====== حالة ====== */
let currentUser, childData;
let editingId = null;
let existingAttachments = [];
let attachmentsToDelete = [];
let selectedFiles = [];
let allVisits = [];
let filteredVisits = [];

/* ====== أدوات ====== */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseYMD(s){ if(!s) return null; const [y,m,da] = s.split('-').map(Number); return new Date(y, m-1, da||1); }
function daysDiff(a,b){ return Math.round((parseYMD(a)-parseYMD(b))/(1000*60*60*24)); }
function dateAdd(s,days){ const d=parseYMD(s)||new Date(); d.setDate(d.getDate()+days); return fmtDate(d); }
function esc(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;"); }
function calcAge(bd){ if(!bd) return '-'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; }
function typeClass(t){ if (t === 'طارئة') return 'emergency'; if (t === 'فحص معملي') return 'lab'; if (t === 'استشارة أونلاين') return 'online'; return 'regular'; }

/* ====== مودال ====== */
function openModal(edit=false){ visitModal.classList.remove('hidden'); modalTitle.textContent = edit ? 'تعديل زيارة' : 'إضافة زيارة'; }
function closeModal(){ visitModal.classList.add('hidden'); }

/* ====== ملفات مختارة (قبل الرفع) ====== */
filesInput.addEventListener('change', ()=>{ selectedFiles = Array.from(filesInput.files || []); renderSelectedFiles(); });
function renderSelectedFiles(){
  selectedFilesEl.innerHTML = '';
  if (!selectedFiles.length) return;
  selectedFiles.forEach((f, idx)=>{
    const div = document.createElement('div');
    div.className = 'file';
    div.innerHTML = `<span>📎 ${esc(f.name)} (${Math.round(f.size/1024)}KB)</span><button class="del" data-idx="${idx}">حذف</button>`;
    div.querySelector('.del').addEventListener('click', ()=>{ selectedFiles.splice(idx,1); renderSelectedFiles(); });
    selectedFilesEl.appendChild(div);
  });
}

/* ====== المرفقات الحالية (وقت التعديل) ====== */
function renderExisting(){
  if (!existingAttachments.length){ existingWrap.classList.add('hidden'); existingFilesEl.innerHTML=''; return; }
  existingWrap.classList.remove('hidden');
  existingFilesEl.innerHTML = '';
  existingAttachments.forEach((att, i)=>{
    const div = document.createElement('div');
    div.className = 'file';
    div.innerHTML = `<a href="${att.url}" target="_blank">📄 ${esc(att.name)}</a><button class="del" data-i="${i}">حذف</button>`;
    div.querySelector('.del').addEventListener('click', ()=>{ attachmentsToDelete.push(att.path); existingAttachments.splice(i,1); renderExisting(); });
    existingFilesEl.appendChild(div);
  });
}

/* ====== تشغيل ====== */
onAuthStateChanged(auth, async (user)=>{
  if (!user) return location.href = 'index.html';
  if (!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `${childData.gender || '-'} • العمر: ${calcAge(childData.birthDate)} سنة`;

  const to = todayStr();
  const from = dateAdd(to, -30);
  if(!fromEl.value) fromEl.value = from;
  if(!toEl.value)   toEl.value   = to;

  await loadVisits();
  await buildAISuggestions();

  filterTypeEl.addEventListener('change', renderVisits);
  filterAppliedEl.addEventListener('change', renderVisits);
  searchBoxEl.addEventListener('input', renderVisits);
  fromEl.addEventListener('change', renderVisits);
  toEl.addEventListener('change', renderVisits);

  copyAgendaBtn.addEventListener('click', copyAgendaToClipboard);
  exportCSVBtn.addEventListener('click', exportCSV);
  printListBtn.addEventListener('click', ()=> window.print());
});

/* ====== تحميل الزيارات ====== */
async function loadVisits(){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/visits`);
  const qy = query(ref, orderBy('date','desc'));
  const snap = await getDocs(qy);

  allVisits = [];
  let last = '—';
  let nextFollow = '—';
  let pending = 0;

  snap.forEach(d=>{
    const v = d.data();
    if(!Array.isArray(v.labsRequested)) v.labsRequested = v.labsRequested ? String(v.labsRequested).split(',').map(s=>s.trim()).filter(Boolean) : [];
    if(!Array.isArray(v.labsCompleted)) v.labsCompleted = v.labsCompleted ? Array.from(new Set(v.labsCompleted)) : [];
    allVisits.push({ id:d.id, ...v });
  });

  if (allVisits.length){ last = allVisits[0].date || '—'; }

  const today = todayStr();
  const futureFollows = allVisits.filter(r=> r.followUpDate && r.followUpDate >= today).map(r=> r.followUpDate).sort();
  if (futureFollows.length) nextFollow = futureFollows[0];

  pending = allVisits.filter(r=> String(r.applied) !== 'true').length;

  lastVisitEl.textContent = last;
  nextFollowUpEl.textContent = nextFollow;
  pendingCountEl.textContent = pending;

  renderVisits();
}

/* ====== فلترة + عرض مع فواصل شهرية ====== */
function byDateRange(r){
  const s = (fromEl.value||'').trim(), e = (toEl.value||'').trim();
  if(!s || !e) return true;
  return r.date >= s && r.date <= e;
}

function renderVisits(){
  visitsListEl.innerHTML = '';
  const t = (filterTypeEl.value||'').trim();
  const a = (filterAppliedEl.value||'').trim();
  const q = (searchBoxEl.value||'').trim().toLowerCase();

  filteredVisits = allVisits.filter(r=>{
    const byType = t? (r.type===t) : true;
    const byApplied = a!=='' ? (String(r.applied)===a) : true;
    const byRange = byDateRange(r);
    const hay = `${r.doctorName||''} ${r.reason||''}`.toLowerCase();
    const bySearch = q ? hay.includes(q) : true;
    return byType && byApplied && byRange && bySearch;
  });

  if(!filteredVisits.length){
    visitsListEl.innerHTML = `<div class="row" style="justify-content:center">لا توجد زيارات مطابقة.</div>`;
    return;
  }

  const today = todayStr();
  let lastMonth = '';

  filteredVisits.forEach(r=>{
    const yymm = (r.date||'').slice(0,7);
    if(yymm && yymm !== lastMonth){
      const m = document.createElement('div');
      m.className = 'month-head';
      m.textContent = yymm;
      visitsListEl.appendChild(m);
      lastMonth = yymm;
    }

    const row = document.createElement('div');
    row.className = 'row';

    const typeCls = typeClass(r.type);
    const appliedCls = String(r.applied) === 'true' ? 'true' : 'false';

    const isFuture = r.date && r.date > today;
    const needsFollow = !r.applied && r.date && (daysDiff(today, r.date) >= 7) && !isFuture;

    const flags = [];
    if(isFuture) flags.push('<span class="flag upcoming">موعد قادم</span>');
    if(needsFollow) flags.push('<span class="flag due">بحاجة لمتابعة</span>');

    const labs = (r.labsRequested||[]);
    const done = new Set(r.labsCompleted||[]);
    const labChips = labs.map(name=>{
      const isDone = done.has(name);
      return `<span class="lab-chip ${isDone?'done':''}" data-id="${r.id}" data-lab="${esc(name)}">${esc(name)}</span>`;
    }).join(' ');

    row.innerHTML = `
      <div>${r.date || '—'}${r.time?`<br><small>${r.time}</small>`:''}</div>
      <div class="type ${typeCls}">${r.type || '—'}</div>
      <div>${esc(r.doctorName || '')}<br><small>${esc(r.reason || '')}</small></div>
      <div>
        ${esc(r.summary || '')}
        <br><small class="muted">${esc(r.recommendations || '')}</small>
        ${labs.length? `<div class="labs">${labChips}</div>`:''}
      </div>
      <div>${(r.attachments?.length||0)} ملف<br>${flags.join(' ')}</div>
      <div class="applied ${appliedCls}">${appliedCls==='true'?'تم':'بانتظار'}</div>

      <div class="right">
        <button class="quick" data-apply="${r.id}">${appliedCls==='true'?'تعطيل التطبيق':'تطبيق الآن'}</button>
        <button class="quick editBtn">عرض/تعديل</button>
      </div>
    `;

    row.querySelector('.editBtn').addEventListener('click', ()=> openEdit(r));
    row.querySelector('[data-apply]')?.addEventListener('click', ()=> toggleApplied(r));
    row.querySelectorAll('.lab-chip').forEach(chip=>{
      chip.addEventListener('click', async ()=>{
        const labName = chip.getAttribute('data-lab');
        await toggleLabDone(r, labName, chip);
      });
    });

    visitsListEl.appendChild(row);
  });
}

/* ====== تبديل الحالات ====== */
async function toggleApplied(v){
  try{
    const visitsRef = collection(db, `parents/${currentUser.uid}/children/${childId}/visits`);
    const newVal = !v.applied;
    await updateDoc(doc(visitsRef, v.id), { applied: newVal, updatedAt: serverTimestamp() });
    v.applied = newVal;
    renderVisits();
  }catch(e){ console.error(e); alert('تعذر تغيير حالة التطبيق'); }
}

async function toggleLabDone(v, labName, chipEl){
  try{
    const visitsRef = collection(db, `parents/${currentUser.uid}/children/${childId}/visits`);
    const done = new Set(v.labsCompleted||[]);
    if(done.has(labName)) done.delete(labName); else done.add(labName);
    await updateDoc(doc(visitsRef, v.id), { labsCompleted: Array.from(done), updatedAt: serverTimestamp() });
    v.labsCompleted = Array.from(done);
    chipEl.classList.toggle('done');
  }catch(e){ console.error(e); alert('تعذر تحديث حالة الفحص'); }
}

/* ====== إضافة/تعديل ====== */
newVisitBtn.addEventListener('click', ()=>{
  editingId = null;
  visitForm.reset();
  selectedFiles = [];
  attachmentsToDelete = [];
  existingAttachments = [];
  renderSelectedFiles(); renderExisting();
  dateEl.value = todayStr(); // مسموح بتاريخ مستقبلي عادي حسب طلبك
  openModal(false);
});

closeModalBtn.addEventListener('click', ()=> closeModal());
cancelVisitBtn.addEventListener('click', ()=> closeModal());

function openEdit(v){
  editingId = v.id;
  visitForm.reset();
  selectedFiles = [];
  attachmentsToDelete = [];
  existingAttachments = Array.isArray(v.attachments) ? [...v.attachments] : [];
  renderSelectedFiles(); renderExisting();

  dateEl.value = v.date || '';
  timeEl.value = v.time || '';
  typeEl.value = v.type || '';
  doctorEl.value = v.doctorName || '';
  reasonEl.value = v.reason || '';
  summaryEl.value = v.summary || '';
  recsEl.value = v.recommendations || '';
  longActingEl.value = v.longActingChange || '';
  mealChangeEl.value = v.mealDosesChange || '';
  labsEl.value = Array.isArray(v.labsRequested) ? v.labsRequested.join(', ') : (v.labsRequested || '');
  followUpEl.value = v.followUpDate || '';
  appliedEl.value = String(v.applied) === 'true' ? 'true' : 'false';

  openModal(true);
}

visitForm.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const labsReq = labsEl.value ? labsEl.value.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const payload = {
    date: dateEl.value,
    time: timeEl.value || null,
    type: typeEl.value,
    doctorName: doctorEl.value.trim(),
    reason: reasonEl.value.trim() || null,
    summary: summaryEl.value.trim() || null,
    recommendations: recsEl.value.trim() || null,
    longActingChange: longActingEl.value.trim() || null,
    mealDosesChange: mealChangeEl.value.trim() || null,
    labsRequested: labsReq,
    followUpDate: followUpEl.value || null,
    applied: appliedEl.value === 'true',
    updatedAt: serverTimestamp()
  };

  try{
    const visitsRef = collection(db, `parents/${currentUser.uid}/children/${childId}/visits`);

    let visitId = editingId;
    if (!editingId){
      payload.createdAt = serverTimestamp();
      payload.labsCompleted = [];
      const added = await addDoc(visitsRef, payload);
      visitId = added.id;
    } else {
      await updateDoc(doc(visitsRef, editingId), payload);
    }

    const storage = getStorage();
    const uploaded = [];
    for (const file of selectedFiles){
      const safeName = `${Date.now()}_${file.name.replace(/\s+/g,'_')}`;
      const path = `parents/${currentUser.uid}/children/${childId}/visits/${visitId}/${safeName}`;
      const r = sRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      uploaded.push({ name:file.name, url, type:file.type||'application/octet-stream', size:file.size, uploadedAt:new Date().toISOString(), path });
    }

    for (const p of attachmentsToDelete){
      try { await deleteObject(sRef(storage, p)); } catch(e){ console.warn('delete failed for', p, e.message); }
    }

    const newAttachments = [...existingAttachments, ...uploaded];
    await updateDoc(doc(visitsRef, visitId), { attachments: newAttachments });

    alert(editingId ? '✅ تم تحديث الزيارة' : '✅ تم حفظ الزيارة');
    closeModal();
    await loadVisits();

  } catch(err){
    console.error(err);
    alert('حدث خطأ أثناء الحفظ');
  }
});

/* ====== ذكاء مساعد: آخر 7 أيام ====== */
async function buildAISuggestions(){
  aiListEl.innerHTML = '<li>يتم التحليل...</li>';

  try{
    const to = todayStr();
    const from = dateAdd(to, -6);
    const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
    const qy = query(ref, where('date','>=', from), where('date','<=', to));
    const snap = await getDocs(qy);

    if (snap.empty){ aiListEl.innerHTML = '<li>لا توجد قياسات كافية لعرض اقتراحات.</li>'; return; }

    const vals = [];
    const bySlot = {};
    let lows=0, highs=0;

    const nMin = Number(childData.normalRange?.min ?? 4.4);
    const nMax = Number(childData.normalRange?.max ?? 7.8);

    snap.forEach(d=>{
      const m = d.data();
      const mmol = Number(m.value_mmol ?? ((m.value_mgdl||0)/18));
      vals.push(mmol);
      if (mmol < nMin) lows++;
      if (mmol > nMax) highs++;
      const slot = m.slot || '-';
      bySlot[slot] = bySlot[slot] || { count:0, lows:0, highs:0, values:[] };
      bySlot[slot].count++;
      bySlot[slot].values.push(mmol);
      if (mmol < nMin) bySlot[slot].lows++;
      if (mmol > nMax) bySlot[slot].highs++;
    });

    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const sd   = Math.sqrt(vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/vals.length);
    const avg = Math.round(mean*10)/10;

    const maxHigh = Object.entries(bySlot).map(([k,o])=>({k, x:o.highs})).sort((a,b)=>b.x-a.x)[0];
    const maxLow  = Object.entries(bySlot).map(([k,o])=>({k, x:o.lows})).sort((a,b)=>b.x-a.x)[0];

    const arabicLabel = (s)=>({
      'wake':'الاستيقاظ','pre_bf':'ق.الفطار','post_bf':'ب.الفطار',
      'pre_ln':'ق.الغداء','post_ln':'ب.الغداء',
      'pre_dn':'ق.العشاء','post_dn':'ب.العشاء',
      'snack':'سناك','pre_sleep':'ق.النوم','during_sleep':'أثناء النوم',
      'pre_ex':'ق.الرياضة','post_ex':'ب.الرياضة','-':'—'
    }[s]||s);

    const sug = [];
    sug.push(`متوسط آخر 7 أيام: ${avg} mmol/L (SD ${sd.toFixed(1)}، ${vals.length} قياس).`);
    if (maxHigh?.x>=2) sug.push(`ارتفاعات متكررة في: ${arabicLabel(maxHigh.k)} (${maxHigh.x}).`);
    if (maxLow?.x >=2)  sug.push(`هبوطات متكررة في: ${arabicLabel(maxLow.k)} (${maxLow.x}).`);
    if (highs >= 3) sug.push(`تصحيحات متكررة/ارتفاعات مستمرة — راجعي CF.`);
    if (lows  >= 2) sug.push(`هبوطات متكررة — راجعي التوقيت والقاعدي/السناك.`);

    const postMeals = ['post_bf','post_ln','post_dn'];
    postMeals.forEach(k=>{
      const o = bySlot[k]; if(!o || !o.values.length) return;
      const m = o.values.reduce((A,B)=>A+B,0)/o.values.length;
      if (m > nMax + 1.5) sug.push(`بعد ${arabicLabel(k)} أعلى من المتوقع — ربما يحتاج CR ضبطًا.`);
    });

    aiListEl.innerHTML = '';
    sug.forEach(t=>{ const li = document.createElement('li'); li.textContent = t; aiListEl.appendChild(li); });

  } catch(e){
    console.error(e);
    aiListEl.innerHTML = '<li>تعذر توليد الاقتراحات حاليًا.</li>';
  }
}

function copyAgendaToClipboard(){
  const items = Array.from(aiListEl.querySelectorAll('li')).map(li=>`• ${li.textContent}`);
  const text = items.join('\n');
  if(!text.trim()){ alert('لا توجد أجندة لنسخها.'); return; }
  navigator.clipboard.writeText(text).then(()=> alert('✅ تم نسخ الأجندة')).catch(()=> alert('تعذر النسخ'));
}

/* ====== CSV ====== */
function exportCSV(){
  if(!filteredVisits.length){ alert('لا توجد بيانات للتصدير.'); return; }
  const headers = [
    'التاريخ','الوقت','النوع','الطبيب/المركز','السبب','الملخص','التوصيات',
    'تعديل طويل المفعول','تعديلات جرعات الوجبات',
    'فحوصات مطلوبة','فحوصات مكتملة','تاريخ متابعة','تم التطبيق','عدد المرفقات'
  ];
  const rows = filteredVisits.map(v=>[
    v.date||'', v.time||'', v.type||'', safeCSV(v.doctorName), safeCSV(v.reason),
    safeCSV(v.summary), safeCSV(v.recommendations), safeCSV(v.longActingChange),
    safeCSV(v.mealDosesChange), (v.labsRequested||[]).join('; '), (v.labsCompleted||[]).join('; '),
    v.followUpDate||'', String(!!v.applied), (v.attachments?.length||0)
  ]);
  const csv = [headers, ...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  const d = new Date();
  a.download = `visits_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function safeCSV(s){ return (s==null?'':String(s)); }
function csvCell(s){ const v = safeCSV(s); if (/[",\n]/.test(v)) return `"${v.replace(/"/g,'""')}"`; return v; }
