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

const newVisitBtn = document.getElementById('newVisitBtn');
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

/* ====== حالة ====== */
let currentUser, childData;
let editingId = null;
let existingAttachments = [];     // من الوثيقة عند التعديل
let attachmentsToDelete = [];     // paths to delete
let selectedFiles = [];           // Files جديدة قبل الرفع

/* ====== أدوات ====== */
const pad = n => String(n).padStart(2,'0');
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function setMaxToday(inp){ if (inp) inp.setAttribute('max', todayStr()); }
setMaxToday(dateEl); setMaxToday(followUpEl);

function fmtDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseYMD(s){ const [y,m,da] = s.split('-').map(Number); return new Date(y, m-1, da); }
function daysDiff(a,b){ return Math.round((parseYMD(a)-parseYMD(b))/(1000*60*60*24)); }

function esc(s){ return (s||'').toString()
 .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
 .replaceAll('"','&quot;').replaceAll("'","&#039;"); }

/* ====== مصنّفات ألوان النوع ====== */
function typeClass(t){
  if (t === 'طارئة') return 'emergency';
  if (t === 'فحص معملي') return 'lab';
  if (t === 'استشارة أونلاين') return 'online';
  return 'regular';
}

/* ====== فتح/غلق المودال ====== */
function openModal(edit=false){
  visitModal.classList.remove('hidden');
  modalTitle.textContent = edit ? 'تعديل زيارة' : 'إضافة زيارة';
}
function closeModal(){
  visitModal.classList.add('hidden');
}

/* ====== ملفات مختارة (قبل الرفع) ====== */
filesInput.addEventListener('change', ()=>{
  selectedFiles = Array.from(filesInput.files || []);
  renderSelectedFiles();
});
function renderSelectedFiles(){
  selectedFilesEl.innerHTML = '';
  if (!selectedFiles.length) return;
  selectedFiles.forEach((f, idx)=>{
    const div = document.createElement('div');
    div.className = 'file';
    div.innerHTML = `
      <span>📎 ${esc(f.name)} (${Math.round(f.size/1024)}KB)</span>
      <button class="del" data-idx="${idx}">حذف</button>
    `;
    div.querySelector('.del').addEventListener('click', ()=>{
      selectedFiles.splice(idx,1);
      renderSelectedFiles();
    });
    selectedFilesEl.appendChild(div);
  });
}

/* ====== عرض المرفقات الحالية (وقت التعديل) ====== */
function renderExisting(){
  if (!existingAttachments.length){ existingWrap.classList.add('hidden'); existingFilesEl.innerHTML=''; return; }
  existingWrap.classList.remove('hidden');
  existingFilesEl.innerHTML = '';
  existingAttachments.forEach((att, i)=>{
    const div = document.createElement('div');
    div.className = 'file';
    div.innerHTML = `
      <a href="${att.url}" target="_blank">📄 ${esc(att.name)}</a>
      <button class="del" data-i="${i}">حذف</button>
    `;
    div.querySelector('.del').addEventListener('click', ()=>{
      // علّم للحذف
      attachmentsToDelete.push(att.path);
      existingAttachments.splice(i,1);
      renderExisting();
    });
    existingFilesEl.appendChild(div);
  });
}

/* ====== تحميل الطفل والزيارات + ذكاء مساعد ====== */
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
  await loadVisits();
  await buildAISuggestions();
});

function calcAge(bd){
  if(!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if (m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}

/* ====== تحميل الزيارات ====== */
async function loadVisits(){
  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/visits`);
  // نخزن التاريخ كسلسلة YYYY-MM-DD → ينفع orderBy('date','desc')
  const qy = query(ref, orderBy('date','desc'));
  const snap = await getDocs(qy);

  visitsListEl.innerHTML = '';
  let last = '—';
  let nextFollow = '—';
  let pending = 0;

  const rows = [];
  snap.forEach(d=>{
    const v = d.data();
    rows.push({ id:d.id, ...v });
  });

  if (rows.length){
    last = rows[0].date || '—';
  }

  // أقرب متابعة
  const futureFollows = rows
    .filter(r=> r.followUpDate && r.followUpDate >= todayStr())
    .map(r=> r.followUpDate)
    .sort(); // أبكر تاريخ
  if (futureFollows.length) nextFollow = futureFollows[0];

  // تعليمات غير مطبقة
  pending = rows.filter(r=> String(r.applied) !== 'true').length;

  lastVisitEl.textContent = last;
  nextFollowUpEl.textContent = nextFollow;
  pendingCountEl.textContent = pending;

  // عرض الجدول
  rows.forEach(r=>{
    const row = document.createElement('div');
    row.className = 'row';
    const typeCls = typeClass(r.type);
    const appliedCls = String(r.applied) === 'true' ? 'true' : 'false';

    row.innerHTML = `
      <div>${r.date || '—'}${r.time?`<br><small>${r.time}</small>`:''}</div>
      <div class="type ${typeCls}">${r.type || '—'}</div>
      <div>${esc(r.doctorName || '')}<br><small>${esc(r.reason || '')}</small></div>
      <div>${esc(r.summary || '')}<br><small class="muted">${esc(r.recommendations || '')}</small></div>
      <div>${(r.attachments?.length||0)} ملف</div>
      <div class="applied ${appliedCls}">${appliedCls==='true'?'تم':'بانتظار'}</div>
      <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end">
        <button class="editBtn">عرض/تعديل</button>
      </div>
    `;

    row.querySelector('.editBtn').addEventListener('click', ()=>{
      openEdit(r);
    });

    visitsListEl.appendChild(row);
  });
}

/* ====== إضافة/تعديل ====== */
newVisitBtn.addEventListener('click', ()=>{
  editingId = null;
  visitForm.reset();
  selectedFiles = [];
  attachmentsToDelete = [];
  existingAttachments = [];
  renderSelectedFiles();
  renderExisting();
  dateEl.value = todayStr();
  openModal(false);
});

closeModalBtn.addEventListener('click', closeModal);
cancelVisitBtn.addEventListener('click', closeModal);

function openEdit(v){
  editingId = v.id;
  visitForm.reset();
  selectedFiles = [];
  attachmentsToDelete = [];
  existingAttachments = Array.isArray(v.attachments) ? [...v.attachments] : [];
  renderSelectedFiles();
  renderExisting();

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

/* ====== حفظ الزيارة ====== */
visitForm.addEventListener('submit', async (e)=>{
  e.preventDefault();

  // منع تاريخ مستقبلي
  if (dateEl.value > todayStr()){
    alert('لا يمكن اختيار تاريخ مستقبلي للزيارة'); return;
  }
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
    labsRequested: labsEl.value ? labsEl.value.split(',').map(s=>s.trim()).filter(Boolean) : [],
    followUpDate: followUpEl.value || null,
    applied: appliedEl.value === 'true',
    updatedAt: serverTimestamp()
  };

  try{
    const visitsRef = collection(db, `parents/${currentUser.uid}/children/${childId}/visits`);

    // إنشاء أو تحديث
    let visitId = editingId;
    if (!editingId){
      payload.createdAt = serverTimestamp();
      const added = await addDoc(visitsRef, payload);
      visitId = added.id;
    } else {
      await updateDoc(doc(visitsRef, editingId), payload);
    }

    // رفع المرفقات الجديدة
    const storage = getStorage();
    const uploaded = [];
    for (const file of selectedFiles){
      const safeName = `${Date.now()}_${file.name.replace(/\s+/g,'_')}`;
      const path = `parents/${currentUser.uid}/children/${childId}/visits/${visitId}/${safeName}`;
      const r = sRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      uploaded.push({
        name: file.name,
        url,
        type: file.type || 'application/octet-stream',
        size: file.size,
        uploadedAt: new Date().toISOString(),
        path
      });
    }

    // حذف المطلوب حذفه من التخزين
    for (const p of attachmentsToDelete){
      try {
        await deleteObject(sRef(storage, p));
      } catch(e){
        console.warn('delete failed for', p, e.message);
      }
    }

    // جمع المرفقات (المتبقي + المرفوع)
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

/* ====== ذكاء مساعد: اقتراح نقاط للطبيب من آخر 7 أيام ====== */
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

    // حدود الطفل بالـ mmol/L
    const nMin = Number(childData.normalRange?.min ?? 4.4);
    const nMax = Number(childData.normalRange?.max ?? 7.8);

    snap.forEach(d=>{
      const m = d.data();
      const mmol = Number(m.value_mmol ?? ((m.value_mgdl||0)/18));
      vals.push(mmol);
      if (mmol < nMin) lows++;
      if (mmol > nMax) highs++;
      const slot = m.slot || '-';
      bySlot[slot] = bySlot[slot] || { count:0, lows:0, highs:0 };
      bySlot[slot].count++;
      if (mmol < nMin) bySlot[slot].lows++;
      if (mmol > nMax) bySlot[slot].highs++;
    });

    const avg = Math.round((vals.reduce((a,b)=>a+b,0)/vals.length)*10)/10;
    const sug = [];

    // 1) متوسط عام
    sug.push(`متوسط آخر 7 أيام: ${avg} mmol/L (${vals.length} قياس).`);

    // 2) ارتفاع/هبوط عام متكرر
    if (highs >= 3) sug.push(`ارتفاعات متكررة (${highs} مرات) — راجعي معامل التصحيح أو جرعات الوجبات.`);
    if (lows  >= 2) sug.push(`هبوطات متكررة (${lows} مرات) — راجعي الحدود والأوقات قبل النوم.`);

    // 3) أماكن محددة (بعد الفطار/الغداء...)
    const focusSlots = ["ب.الفطار","ب.الغدا","ب.العشا","ق.النوم","الاستيقاظ"];
    focusSlots.forEach(s=>{
      if (bySlot[s]?.highs >= 2) sug.push(`ارتفاع بعد ${s.replace('ب.','')} متكرر (${bySlot[s].highs} مرات).`);
      if (bySlot[s]?.lows  >= 2) sug.push(`هبوط ${s} متكرر (${bySlot[s].lows} مرات).`);
    });

    // 4) تذكير فحوصات
    sug.push('تأكد من متابعة HbA1c كل 3 أشهر إن أمكن.');

    aiListEl.innerHTML = '';
    sug.forEach(t=>{
      const li = document.createElement('li');
      li.textContent = t;
      aiListEl.appendChild(li);
    });

  } catch(e){
    console.error(e);
    aiListEl.innerHTML = '<li>تعذر توليد الاقتراحات حاليًا.</li>';
  }
}

function dateAdd(dStr, days){
  const d = new Date(dStr);
  d.setDate(d.getDate()+days);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
