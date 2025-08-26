// إدارة أكواد الأطباء — عرض/بحث/توليد/حفظ/نسخ/إلغاء
import { auth, db } from './firebase-config.js';
import {
  doc, getDoc, collection, query, where, getDocs, updateDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const searchEl = document.getElementById('search');
const toastEl  = document.getElementById('toast');
const loaderEl = document.getElementById('loader');

function toast(s){ toastEl.textContent=s; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 1600); }
function busy(b){ loaderEl.classList.toggle('hidden', !b); }
function esc(s){ return (s??'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function norm(s=''){ return s.toLowerCase().trim(); }

let currentUser = null;
let doctors = [], view = [];

onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  currentUser = u;
  // التحقق من صلاحية admin عبر وثيقة المستخدم
  const me = await getDoc(doc(db, 'users', u.uid));
  const role = me.exists() ? (me.data().role || '') : '';
  if (role !== 'admin'){ alert('هذه الصفحة للمسؤول فقط'); location.href='parent.html'; return; }

  await loadDoctors();
  render();
});

searchEl.addEventListener('input', ()=>{
  const t = norm(searchEl.value);
  view = t ? doctors.filter(d => norm(d.name||'').includes(t) || norm(d.email||'').includes(t)) : doctors;
  render();
});

async function loadDoctors(){
  busy(true);
  try{
    const qy = query(collection(db,'users'), where('role','==','doctor'));
    const snap = await getDocs(qy);
    doctors = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    view = doctors;
  }catch(e){ console.error(e); alert('تعذر تحميل قائمة الأطباء'); }
  finally{ busy(false); }
}

function render(){
  gridEl.innerHTML = '';
  countEl.textContent = `الأطباء: ${view.length}`;
  if(!view.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  view.forEach(d=>{
    const div=document.createElement('div');
    div.className='cardItem';
    div.innerHTML = `
      <div class="row">
        <div>
          <div class="name">${esc(d.name||'طبيب')}</div>
          <div class="meta">${esc(d.email||'—')}</div>
        </div>
        <div class="meta">UID: <span title="${esc(d.id)}">${esc(d.id.slice(0,6))}…</span></div>
      </div>

      <div class="code">
        <span class="v" id="code-${d.id}">${esc(d.doctorCode || '—')}</span>
        <div class="kit">
          <button class="btn" data-act="gen" data-id="${d.id}">توليد</button>
          <button class="btn" data-act="copy" data-id="${d.id}" ${d.doctorCode?'':'disabled'}>نسخ</button>
          <button class="btn danger" data-act="clear" data-id="${d.id}" ${d.doctorCode?'':'disabled'}>إلغاء</button>
          <button class="btn primary" data-act="save" data-id="${d.id}">حفظ</button>
        </div>
      </div>
    `;
    // أحداث الأزرار
    div.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button'); if(!btn) return;
      const act = btn.dataset.act, id = btn.dataset.id;
      if (act==='gen'){ const code = await generateUniqueCode(); setCodeUI(id, code); }
      else if (act==='copy'){ await copyCode(id); }
      else if (act==='clear'){ setCodeUI(id, ''); }
      else if (act==='save'){ await saveCode(id); }
    });

    gridEl.appendChild(div);
  });
}

function setCodeUI(id, code){
  const el = document.getElementById(`code-${id}`);
  if(!el) return;
  el.textContent = code || '—';
  // تفعيل/تعطيل أزرار النسخ/الإلغاء
  const card = el.closest('.cardItem');
  card.querySelector('[data-act="copy"]').disabled = !code;
  card.querySelector('[data-act="clear"]').disabled = !code;
}

async function copyCode(id){
  const el = document.getElementById(`code-${id}`);
  const v = (el?.textContent || '').trim();
  if(!v || v==='—'){ toast('لا يوجد كود'); return; }
  await navigator.clipboard.writeText(v);
  toast('تم النسخ ✅');
}

async function saveCode(id){
  const span = document.getElementById(`code-${id}`);
  const code = (span?.textContent || '').trim();
  busy(true);
  try{
    await updateDoc(doc(db,'users',id), { doctorCode: code || null });
    // حدّث المصفوفة المحلية
    const idx = doctors.findIndex(x=>x.id===id);
    if (idx>=0) doctors[idx].doctorCode = code || null;
    toast('تم الحفظ ✅');
  }catch(e){ console.error(e); alert('تعذر الحفظ'); }
  finally{ busy(false); }
}

async function generateUniqueCode(length=6){
  // نحاول لحد 10 مرات نجيب كود غير مستخدم
  for(let i=0;i<10;i++){
    const code = randomCode(length + (Math.random()<0.25 ? 1 : 0)); // أحياناً 7 أحرف
    const exists = await codeExists(code);
    if(!exists) return code;
  }
  // fallback
  return randomCode(length+2);
}
function randomCode(n){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون 0,O,1,I
  let s=''; for(let i=0;i<n;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
async function codeExists(code){
  const qy = query(collection(db,'users'), where('role','==','doctor'), where('doctorCode','==', code));
  const snap = await getDocs(qy);
  return !snap.empty;
}
