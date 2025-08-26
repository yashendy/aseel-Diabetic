// لوحة الطبيب — فلتر (7/14/30) + متوسط الفترة + بحث عربي محسّن — v4
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  collectionGroup, query, where, getDocs,
  collection, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const gridEl   = document.getElementById('grid');
const emptyEl  = document.getElementById('empty');
const totalsEl = document.getElementById('totals');
const searchEl = document.getElementById('search');
const loaderEl = document.getElementById('loader');
const rangeBtns = Array.from(document.querySelectorAll('.chipBtn'));

let doctorUid = null;
let childrenRows = [];
let selectedDays = 7;

/* ========== تطبيع عربي + Debounce ========== */
function normArabic(s=''){
  return s.toString()
    .replace(/[\u064B-\u0652]/g,'')          
    .replace(/[إأآا]/g,'ا')                  
    .replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
}
function debounce(fn, ms=200){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  doctorUid = user.uid;
  await loadChildren();
  await computePeriodStats();
  render();
});

searchEl.addEventListener('input', debounce(render, 200));
rangeBtns.forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    rangeBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    selectedDays = Number(btn.dataset.days) || 7;
    await computePeriodStats();
    render();
  });
});

async function loadChildren(){
  busy(true);
  try{
    const cg = collectionGroup(db, 'children');
    const qy = query(cg, where('assignedDoctor','==', doctorUid), where('sharingConsent.doctor','==', true));
    const snap = await getDocs(qy);

    childrenRows = [];
    const tasks = [];

    snap.forEach(docSnap=>{
      const data = docSnap.data();
      const path = docSnap.ref.path.split('/'); 
      const parentUid = path[1], childId = path[3];

      const row = {
        parentUid, childId,
        name: data.name || '-',
        birthDate: data.birthDate || null,
        unit: data.glucoseUnit || 'mgdl',
        rangeMin: num(data?.normalRange?.min),
        rangeMax: num(data?.normalRange?.max)
      };
      childrenRows.push(row);
      tasks.push( loadLastMeasurement(row).then(v=> row._last = v) );
    });

    await Promise.allSettled(tasks);
  }finally{ busy(false); }
}

async function computePeriodStats(){
  busy(true);
  try{
    const {start, end} = lastNDays(selectedDays);
    const tasks = childrenRows.map(async (r)=>{
      const base = collection(db, `parents/${r.parentUid}/children/${r.childId}/measurements`);
      const qy = query(base, where('date','>=', start), where('date','<=', end));
      const snap = await getDocs(qy);

      let count = 0, sum = 0;
      snap.forEach(d=>{
        const m = d.data();
        const v = valueInUnit(m, r.unit);
        if (v!=null){ sum += v; count++; }
      });

      r._week = { count };
      if (count>0){
        const avg = sum / count;
        const cls = classify(avg, r.rangeMin, r.rangeMax);
        r._avg = { days: selectedDays, value: (r.unit==='mmol'? round1(avg) : Math.round(avg)), cls };
      }else{
        r._avg = { days: selectedDays, value: null, cls: '' };
      }
    });
    await Promise.allSettled(tasks);
  }finally{ busy(false); }
}

function render(){
  const token = normArabic(searchEl.value || '');
  const list = token
    ? childrenRows.filter(r => normArabic(r.name||'').includes(token))
    : childrenRows;

  gridEl.innerHTML = '';
  totalsEl.textContent = list.length ? `عدد الأطفال: ${list.length}` : '—';

  if(!list.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  list.forEach(r=>{
    const last = r._last;
    const week = r._week;
    const avg  = r._avg;

    const div = document.createElement('div');
    div.className = 'cardItem';
    div.innerHTML = `
      <div class="row">
        <div class="name">${escape(r.name)}</div>
        <div class="meta">العمر: ${age(r.birthDate)} سنة</div>
      </div>
      <div class="kpi">
        <span class="chip">وحدة: ${r.unit === 'mmol' ? 'mmol/L' : 'mg/dL'}</span>
        <span class="chip">قياسات ${selectedDays} يوم: ${week?.count ?? 0}</span>
      </div>
      <div class="last ${last?.cls || ''}">
        <div class="v">${last ? escape(last.val) : '—'}</div>
        <div class="meta">${last?.timeStr ? escape(last.timeStr) : 'لا يوجد قياس حديث'}</div>
      </div>
      <div class="avg ${avg?.cls || ''}">
        <div class="v">متوسط ${selectedDays} يوم: ${avg?.value ?? '—'}</div>
      </div>
      <div class="actions">
        <a class="btn" href="doctor-child.html?parent=${encodeURIComponent(r.parentUid)}&child=${encodeURIComponent(r.childId)}">فتح ملف الطفل</a>
      </div>
    `;
    gridEl.appendChild(div);
  });
}

/* ========== Helpers ========== */
async function loadLastMeasurement(row){
  const base = collection(db, `parents/${row.parentUid}/children/${row.childId}/measurements`);
  let snap;
  try{ snap = await getDocs( query(base, orderBy('when','desc'), limit(1)) ); } catch {}
  if (!snap || snap.empty){
    try{ snap = await getDocs( query(base, orderBy('createdAt','desc'), limit(1)) ); } catch {}
  }
  if (!snap || snap.empty) return null;

  const m = snap.docs[0].data();
  const v = valueInUnit(m, row.unit);
  if (v == null) return null;

  const cls = classify(v, row.rangeMin, row.rangeMax);
  const timeStr = humanTime( m.when?.toDate?.() || (m.when? new Date(m.when): (m.createdAt?.toDate?.() ?? null)) );
  return { val: row.unit==='mmol' ? round1(v) : Math.round(v), cls, timeStr };
}

function valueInUnit(m, unit){
  if (unit==='mmol'){
    if (num(m.value_mmol)!=null) return num(m.value_mmol);
    if (num(m.value_mgdl)!=null) return num(m.value_mgdl)/18;
  } else {
    if (num(m.value_mgdl)!=null) return num(m.value_mgdl);
    if (num(m.value_mmol)!=null) return Math.round(num(m.value_mmol)*18);
  }
  return null;
}

function classify(val, min, max){
  if (min==null || max==null) return 'ok';
  if (val < min) return 'low';
  if (val > max) return 'high';
  return 'ok';
}

function lastNDays(n){
  const pad = x=> String(x).padStart(2,'0');
  const days = [];
  const today = new Date(); today.setHours(0,0,0,0);
  for(let i=0;i<n;i++){
    const d = new Date(today); d.setDate(today.getDate()-i);
    days.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
  }
  return { start: days[n-1], end: days[0] };
}

function humanTime(dt){
  if (!dt) return '';
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2,'0');
  const mi = String(dt.getMinutes()).padStart(2,'0');
  return `${dd}-${mm}-${yyyy} • ${hh}:${mi}`;
}

function age(birthDate){
  if(!birthDate) return '-';
  const b=new Date(birthDate), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return a<0? '-' : a;
}

function escape(s){ return (s??'').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function num(x){ const n=Number(x); return isNaN(n)? null : n; }
function round1(x){ return Math.round((x||0)*10)/10; }

function busy(b){ loaderEl.classList.toggle('hidden', !b); }
