// js/doctor-dashboard.js (Module)
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collectionGroup, collection, query, where, getDocs, doc, setDoc, deleteDoc,
  orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ثوابت المشروع
import {
  LINK_CODE_TTL_HOURS, MAX_ACTIVE_LINK_CODES,
  COL_LINK_CODES
} from './app-consts.js';

const $ = (id)=>document.getElementById(id);
let allChildren = [];
let currentUser = null;
let activeCodes = [];

/* ========== Toast ========== */
function toast(msg, type='info'){
  const el = $('toast');
  if(!el){ alert(msg); return; }
  el.textContent = msg;
  el.style.background = (type==='error') ? '#b42318' : (type==='success') ? '#0a7d62' : '#111';
  el.classList.remove('hidden');
  clearTimeout(el._hid);
  el._hid = setTimeout(()=> el.classList.add('hidden'), 2200);
}

/* ========== Utils ========== */
function calcAge(bd){ const b = new Date(bd), t = new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; }
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }
function pad2(n){ return n<10?`0${n}`:String(n); }
function fmtDateTime(d){
  if(!(d instanceof Date)) d = new Date(d);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function remainingLabel(expiresAt){
  if(!expiresAt) return '—';
  const now = Date.now();
  const ts = (expiresAt.toDate ? expiresAt.toDate().getTime() : new Date(expiresAt).getTime());
  const diffMs = ts - now;
  if(diffMs <= 0) return 'انتهى';
  const mins = Math.round(diffMs/60000);
  if(mins < 60) return `${mins} دقيقة`;
  const hrs = Math.floor(mins/60);
  const rmins = mins % 60;
  return rmins ? `${hrs} س ${rmins} د` : `${hrs} ساعة`;
}

/* ========== Children (كما هي مع تحسينات طفيفة) ========== */
function renderChildren(list){
  const wrap = $('childList'); if(!wrap) return;
  wrap.innerHTML='';
  if(!list.length){ $('empty') && ( $('empty').style.display='block' ); return; }
  $('empty') && ( $('empty').style.display='none' );

  list.forEach(c=>{
    const div = document.createElement('div');
    div.className = 'cardx child-card';
    const age = c.birthDate ? calcAge(c.birthDate) : '-';
    div.innerHTML = `
      <div>
        <div><strong>${escapeHtml(c.name||'-')}</strong> <span class="muted">• ${escapeHtml(c.gender||'-')} • العمر ${escapeHtml(age)}</span></div>
        <div class="muted tiny">وحدة: ${escapeHtml(c.glucoseUnit||'-')} • CR ${escapeHtml(c.carbRatio??'-')} • CF ${escapeHtml(c.correctionFactor??'-')}</div>
      </div>
      <div><a class="secondary" href="doctor-child.html?parent=${encodeURIComponent(c.parentId)}&child=${encodeURIComponent(c.childId)}">عرض</a></div>
    `;
    wrap.appendChild(div);
  });
}

/* ========== Codes: UI Helpers ========== */
function updateCounts(){
  $('activeCount') && ($('activeCount').textContent = String(activeCodes.length));
  $('maxActive') && ($('maxActive').textContent = String(MAX_ACTIVE_LINK_CODES));
  const disable = activeCodes.length >= MAX_ACTIVE_LINK_CODES;
  $('genCode') && ($('genCode').disabled = disable);
}
function setTTLLabel(){
  $('ttlHours') && ($('ttlHours').textContent = String(LINK_CODE_TTL_HOURS));
}

/* ========== Codes: Render List ========== */
function renderCodes(){
  const listEl = $('codesList'); const emptyEl = $('codesEmpty');
  if(!listEl || !emptyEl) return;

  if(activeCodes.length === 0){
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    updateCounts();
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = activeCodes.map(c=>{
    const expires = remainingLabel(c.expiresAt);
    const created = c.createdAt?.toDate ? c.createdAt.toDate() : (c.createdAt ? new Date(c.createdAt) : null);
    return `
      <div class="cardx code-item" data-id="${escapeHtml(c.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="display:flex;align-items:center;gap:12px;flex:1">
          <div class="mono" style="font-weight:800">${escapeHtml(c.id)}</div>
          <div class="muted tiny">متبقي: ${escapeHtml(expires)}</div>
          ${created ? `<div class="muted tiny">إنشاء: ${escapeHtml(fmtDateTime(created))}</div>` : ''}
          ${c.expiresAt ? `<div class="muted tiny">انتهاء: ${escapeHtml(fmtDateTime(c.expiresAt.toDate?c.expiresAt.toDate():c.expiresAt))}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="secondary copy" data-id="${escapeHtml(c.id)}">نسخ</button>
          <button class="danger revoke" data-id="${escapeHtml(c.id)}">إلغاء</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind actions
  listEl.querySelectorAll('.copy').forEach(b=>{
    b.addEventListener('click', ()=> copyCodeString(b.dataset.id));
  });
  listEl.querySelectorAll('.revoke').forEach(b=>{
    b.addEventListener('click', ()=> revokeCode(b.dataset.id));
  });

  updateCounts();
}

/* ========== Codes: Data Ops ========== */
function codeColl(){ return collection(db, COL_LINK_CODES); }

function genCodeStr(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<7;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function loadActiveCodes(){
  if(!currentUser) return;
  // نعرض الأكواد غير المستخدمة والتابعة لهذا الدكتور
  // ملاحظة: قد يتطلب هذا الاستعلام فهرسًا مركبًا في بعض المشاريع.
  const qy = query(codeColl(), where('doctorId','==', currentUser.uid), where('used','==', false), orderBy('createdAt','desc'));
  const snap = await getDocs(qy);
  activeCodes = [];
  snap.forEach(s=>{
    activeCodes.push({ id:s.id, ...s.data() });
  });
  renderCodes();
}

async function generateLinkCode(){
  if(!currentUser) return;
  await loadActiveCodes(); // تأكيد العدّ قبل التوليد
  if(activeCodes.length >= MAX_ACTIVE_LINK_CODES){
    toast(`وصلت للحد الأقصى من الأكواد (${MAX_ACTIVE_LINK_CODES}). ألغِ كود أو انتظر انتهاء واحد.`, 'error');
    return;
  }

  const code = genCodeStr();
  const now  = new Date();
  const exp  = new Date(now.getTime() + LINK_CODE_TTL_HOURS*60*60*1000);

  await setDoc(doc(db, COL_LINK_CODES, code), {
    doctorId: currentUser.uid,
    used: false,
    parentId: null,
    childId: null,
    createdAt: serverTimestamp(),
    expiresAt: exp
  });

  $('linkCode') && ($('linkCode').textContent = code);
  $('genWrap') && ($('genWrap').classList.remove('hidden'));
  toast('تم توليد الكود ✅','success');

  await loadActiveCodes(); // تحديث القائمة والعدّاد
}

async function revokeCode(codeId){
  if(!currentUser || !codeId) return;
  try{
    await deleteDoc(doc(db, COL_LINK_CODES, codeId));
    toast('تم إلغاء الكود','success');
    await loadActiveCodes();
  }catch(e){
    console.error(e);
    toast('تعذّر إلغاء الكود','error');
  }
}

async function copyCodeString(codeStr){
  try{
    await navigator.clipboard.writeText(codeStr);
    toast('تم نسخ الكود ✔️','success');
  }catch{
    toast('تعذّر النسخ تلقائيًا — انسخه يدويًا','error');
  }
}

/* ========== Search ========== */
$('q')?.addEventListener('input', ()=>{
  const t = ($('q').value||'').trim().toLowerCase();
  const f = allChildren.filter(c=> (c.name||'').toLowerCase().includes(t));
  renderChildren(f);
});

/* ========== Auth & Boot ========== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  currentUser = user;

  // إعداد الملصقات
  setTTLLabel();
  updateCounts();

  // تحميل الأطفال المعيّنين
  const qy = query(collectionGroup(db,'children'), where('assignedDoctor','==', user.uid));
  const snap = await getDocs(qy);
  allChildren = [];
  snap.forEach(s=>{
    const path = s.ref.path.split('/');
    const parentId = path[1];
    const childId  = path[3];
    allChildren.push({ parentId, childId, ...s.data() });
  });
  renderChildren(allChildren);

  // تحميل الأكواد النشطة
  await loadActiveCodes();

  // ربط الأزرار
  $('genCode') && $('genCode').addEventListener('click', generateLinkCode);
  $('copyCode') && $('copyCode').addEventListener('click', ()=>{
    const v = ($('linkCode')?.textContent||'').trim();
    if(v) copyCodeString(v);
  });
  $('refreshCodes') && $('refreshCodes').addEventListener('click', loadActiveCodes);
});
