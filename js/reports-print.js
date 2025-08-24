// js/reports-print.js (v5) — يدعم: نموذج فارغ، إخفاء/إظهار الملاحظات، أسبوعي، وملاحظات أعلى التقرير.
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { collection, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* عناصر */
const params       = new URLSearchParams(location.search);
const childId      = params.get('child');

const childNameEl  = document.getElementById('childName');
const childAgeEl   = document.getElementById('childAge');
const childRangeEl = document.getElementById('childRange');
const childCREl    = document.getElementById('childCR');
const childCFEl    = document.getElementById('childCF');

const unitSelect   = document.getElementById('unitSelect');
const fromDateEl   = document.getElementById('fromDate');
const toDateEl     = document.getElementById('toDate');
const notesEl      = document.getElementById('notes');

const periodFrom   = document.getElementById('periodFrom');
const periodTo     = document.getElementById('periodTo');
const periodUnit   = document.getElementById('periodUnit');

const notesBar     = document.getElementById('notesBar');
const notesText    = document.getElementById('notesText');

const tbody        = document.getElementById('tbody');
const emptyEl      = document.getElementById('empty');

const maskTreat    = document.getElementById('maskTreat');  // إخفاء/إظهار ملاحظات الخلايا
const colorize     = document.getElementById('colorize');
const weeklyMode   = document.getElementById('weeklyMode');
const manualMode   = document.getElementById('manualMode');

const applyBtn     = document.getElementById('applyBtn');
const printBtn     = document.getElementById('printBtn');
const backBtn      = document.getElementById('backBtn');
const blankBtn     = document.getElementById('blankBtn');

/* أدوات */
const pad = n => String(n).padStart(2,'0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = ()=> fmtDate(new Date());
const addDays = (d,delta)=> { const x=new Date(d); x.setDate(x.getDate()+delta); return x; };
function calcAge(bd){ if(!bd) return '—'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return `${a} سنة`; }

/* الأعمدة */
const SLOT_MAP = {
  'WAKE':'الاستيقاظ','WAKEUP':'الاستيقاظ',
  'PRE_BREAKFAST':'ق.الفطار','POST_BREAKFAST':'ب.الفطار',
  'PRE_LUNCH':'ق.الغدا','POST_LUNCH':'ب.الغدا',
  'PRE_DINNER':'ق.العشا','POST_DINNER':'ب.العشا',
  'SNACKS':'سناك','SLEEP':'أثناء النوم','NIGHT':'أثناء النوم'
};
const TABLE_COLS = ['الاستيقاظ','ق.الفطار','ب.الفطار','ق.الغدا','ب.الغدا','ق.العشا','ب.العشا','سناك','أثناء النوم'];

/* حالة */
let currentUser, childData;
let cachedRows = []; // [{date, cols:{colName: [{value,state,notes,bolus,corr}...]}}]

/* تهيئة */
(function initUI(){
  const t = new Date();
  toDateEl.value   = fmtDate(t);
  fromDateEl.value = fmtDate(addDays(t,-7));
  periodUnit.textContent = unitSelect.value==='mmol'?'mmol/L':'mg/dL';
})();

/* جلسة */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href='index.html';
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); history.back(); return; }
  currentUser = user;

  await loadChild();
  await refreshData();
  renderQR();
});

/* رأس التقرير */
async function loadChild(){
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
  const dref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap = await getDoc(dref);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  childAgeEl.textContent  = calcAge(childData.birthDate);
  childRangeEl.textContent= `${childData?.normalRange?.min ?? '—'}–${childData?.normalRange?.max ?? '—'} mmol/L`;
  childCREl.textContent   = `${childData?.carbRatio ?? '—'} g/U`;
  childCFEl.textContent   = `${childData?.correctionFactor ?? '—'} mmol/L/U`;
}

/* تحميل القياسات */
async function loadMeasurements(){
  const from = fromDateEl.value || todayStr();
  const to   = toDateEl.value   || todayStr();

  periodFrom.textContent = from;
  periodTo.textContent   = to;
  periodUnit.textContent = unitSelect.value==='mmol'?'mmol/L':'mg/dL';

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, where('date','>=', from), where('date','<=', to), orderBy('date','asc'));
  const snap= await getDocs(qy);

  const byDate = new Map();
  snap.forEach(d=>{
    const m = d.data();

    let mmol = null, mgdl = null;
    if (typeof m.value_mmol === 'number') mmol = m.value_mmol;
    if (typeof m.value_mgdl === 'number') mgdl = m.value_mgdl;
    if (mmol==null && mgdl!=null) mmol = mgdl/18;
    if (mgdl==null && mmol!=null) mgdl = Math.round(mmol*18);

    const colName = SLOT_MAP[String(m.slotKey||'').toUpperCase()];
    if(!colName) return;

    const date = m.date || (m.when?.toDate ? fmtDate(m.when.toDate()) : null);
    if(!date) return;

    if(!byDate.has(date)){
      const cols={}; TABLE_COLS.forEach(c=> cols[c]=[]);
      byDate.set(date, { date, cols });
    }

    const showUnit = unitSelect.value;
    const value = showUnit==='mmol' ? +(+mmol).toFixed(1) : Math.round(mgdl);

    byDate.get(date).cols[colName].push({
      value,
      unit: showUnit==='mmol'?'mmol/L':'mg/dL',
      state: m.state || 'normal',
      bolus: m.bolusDose ?? null,
      corr:  m.correctionDose ?? null,
      notes: m.notes || ''
    });
  });

  cachedRows = Array.from(byDate.values()).sort((a,b)=> a.date.localeCompare(b.date));

  // أسبوعي: آخر 7 أيام فقط
  if (weeklyMode.checked) cachedRows = cachedRows.slice(-7);
}

/* إنشاء صفوف فارغة قابلة للتحرير */
function buildBlankRows(){
  const from = new Date(fromDateEl.value || todayStr());
  const to   = new Date(toDateEl.value   || todayStr());

  periodFrom.textContent = fmtDate(from);
  periodTo.textContent   = fmtDate(to);
  periodUnit.textContent = unitSelect.value==='mmol'?'mmol/L':'mg/dL';

  const rows=[];
  for(let d=new Date(from); d<=to; d.setDate(d.getDate()+1)){
    const cols={}; TABLE_COLS.forEach(c=> cols[c]=[]);
    rows.push({ date: fmtDate(d), cols });
  }
  // أسبوعي في الوضع اليدوي: آخر 7 تواريخ فقط
  cachedRows = weeklyMode.checked ? rows.slice(-7) : rows;
}

/* تحديث حسب الوضع */
async function refreshData(){
  updateTopNotes();
  if (manualMode.checked){
    buildBlankRows();
    renderTable(true);
  }else{
    await loadMeasurements();
    renderTable(false);
  }
}

/* رسم الجدول */
function renderTable(isManual=false){
  tbody.innerHTML='';
  emptyEl.classList.toggle('hidden', cachedRows.length>0);

  const colorizeOn   = !isManual && colorize.checked;
  const hideAllNotes = maskTreat.checked;

  for(const r of cachedRows){
    const tr=document.createElement('tr');

    const tdDate=document.createElement('td');
    tdDate.textContent = isManual ? '' : r.date;
    if(isManual) tdDate.contentEditable='true';
    tr.appendChild(tdDate);

    for(const cName of TABLE_COLS){
      const td=document.createElement('td');
      const items=r.cols[cName]||[];

      if(items.length===0){
        td.innerHTML = isManual ? '' : '—';
      }else{
        items.forEach((it,idx)=>{
          const span=document.createElement('div');
          span.textContent=it.value;
          if(colorizeOn){
            const st=(it.state||'').toLowerCase();
            if(st.startsWith('low')) span.classList.add('low');
            else if(st.startsWith('high')) span.classList.add('high');
            else span.classList.add('okv');
          }
          td.appendChild(span);

          if(it.corr!=null || it.bolus!=null){
            const d=document.createElement('span');
            d.className='dose';
            const parts=[];
            if(it.corr!=null)  parts.push(`تصحيح: ${it.corr}U`);
            if(it.bolus!=null) parts.push(`وجبة: ${it.bolus}U`);
            d.textContent=parts.join(' • ');
            td.appendChild(d);
          }

          // الملاحظات داخل الخلية — تُخفى كلها عند تفعيل الخيار
          if(it.notes && !hideAllNotes){
            const n=document.createElement('span');
            n.className='note';
            n.textContent=it.notes;
            td.appendChild(n);
          }

          if(idx<items.length-1){
            const hr=document.createElement('hr');
            hr.style.border='none'; hr.style.borderTop='1px dashed #eee'; hr.style.margin='6px 0';
            td.appendChild(hr);
          }
        });
      }

      if(isManual) td.contentEditable='true';
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

/* شريط الملاحظات أعلى التقرير */
function updateTopNotes(){
  const val = (notesEl.value || '').trim();
  if(val){
    notesText.textContent = val;
    notesBar.classList.remove('hidden');
  }else{
    notesText.textContent = '';
    notesBar.classList.add('hidden');
  }
}

/* QR */
function renderQR(){
  try{
    const canvas=document.getElementById('qr');
    QRCode.toCanvas(canvas, location.href, { width:128, margin:1 }, ()=>{});
  }catch{}
}

/* أحداث */
applyBtn.addEventListener('click', refreshData);
printBtn.addEventListener('click', ()=> window.print());
backBtn.addEventListener('click', ()=> history.back());
blankBtn.addEventListener('click', ()=>{
  manualMode.checked = true;
  refreshData();
});
unitSelect.addEventListener('change', refreshData);
weeklyMode.addEventListener('change', refreshData);
manualMode.addEventListener('change', refreshData);
maskTreat.addEventListener('change', ()=> renderTable(manualMode.checked));
notesEl.addEventListener('input', updateTopNotes);

/* قراءة URL (لو وُجدت) */
(function applyParamsFromURL(){
  const from=params.get('from'); const to=params.get('to'); const unit=params.get('unit');
  if(from) fromDateEl.value=from;
  if(to)   toDateEl.value=to;
  if(unit) unitSelect.value=unit;
  periodUnit.textContent = unitSelect.value==='mmol'?'mmol/L':'mg/dL';
})();
