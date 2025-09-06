// js/reports-print.js — تلوين الطباعة low/ok/high على hypo/hyper، دون تغيير الـCSS/DOM
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

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

const maskTreat    = document.getElementById('maskTreat');
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
  const dref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap = await getDoc(dref);
  if(!snap.exists()){ alert('لم يتم العثور على الطفل'); return; }
  childData = snap.data();

  childNameEl.textContent = childData.name || 'طفل';
  childAgeEl.textContent  = calcAge(childData.birthDate);
  childRangeEl.textContent= `${childData?.normalRange?.min ?? '—'}–${childData?.normalRange?.max ?? '—'} mmol/L`;
  childCREl.textContent   = `${childData?.carbRatio ?? '—'} g/U`;
  childCFEl.textContent   = `${childData?.correctionFactor ?? '—'} mmol/L/U`;

  // حدود اللون للطباعة
  childData._hypo  = Number(childData.hypoLevel  ?? childData?.normalRange?.min ?? 4.5);
  childData._hyper = Number(childData.hyperLevel ?? childData?.normalRange?.max ?? 11);
}

/* تحميل القياسات */
async function refreshData(){
  const manual = (params.get('mode')==='blank') || manualMode.checked;

  tbody.innerHTML = '';
  emptyEl.classList.add('hidden');

  if (manual){
    renderTable(true);
    return;
  }

  await loadMeasurements();
  if(!cachedRows.length){
    emptyEl.classList.remove('hidden');
  }
  renderTable(false);
}
async function loadMeasurements(){
  const from = fromDateEl.value || todayStr();
  const to   = toDateEl.value   || todayStr();

  periodFrom.textContent = from;
  periodTo.textContent   = to;
  periodUnit.textContent = unitSelect.value==='mmol'?'mmol/L':'mg/dL';

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, where('date','>=', from), where('date','<=', to), orderBy('date','asc'));
  const snap= await getDocs(qy);

  const byDate = new Map(); // date -> {cols:{colName:[]}}
  const TABLE_COLS = ['wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn','snack','pre_sleep','during_sleep','pre_sport','post_sport'];

  const mapSlot = (s)=>{
    const x = String(s || '').toLowerCase();
    const m = {
      'wake':'wake',
      'pre_breakfast':'pre_bf', 'pre_bf':'pre_bf', 'ق. الفطار':'pre_bf',
      'post_breakfast':'post_bf','post_bf':'post_bf','ب. الفطار':'post_bf',
      'pre_lunch':'pre_ln','pre_ln':'pre_ln','ق. الغداء':'pre_ln',
      'post_lunch':'post_ln','post_ln':'post_ln','ب. الغداء':'post_ln',
      'pre_dinner':'pre_dn','pre_dn':'pre_dn','ق. العشاء':'pre_dn',
      'post_dinner':'post_dn','post_dn':'post_dn','ب. العشاء':'post_dn',
      'snack':'snack','سناك':'snack',
      'pre_sleep':'pre_sleep','ق. النوم':'pre_sleep',
      'during_sleep':'during_sleep','أثناء النوم':'during_sleep',
      'pre_sport':'pre_sport','ق. الرياضة':'pre_sport',
      'post_sport':'post_sport','ب. الرياضة':'post_sport'
    };
    return m[x] || x;
  };

  snap.forEach(d=>{
    const m = d.data();
    const date = m.date;
    if (!byDate.has(date)) byDate.set(date, {date, cols:Object.fromEntries(TABLE_COLS.map(c=>[c,[]]))});

    // تحويل القيمة
    let mmol=null, mgdl=null;
    if(typeof m.value_mmol === 'number'){ mmol=Number(m.value_mmol); mgdl=Math.round(mmol*18); }
    else if (typeof m.value_mgdl === 'number'){ mgdl=Number(m.value_mgdl); mmol=mgdl/18; }
    else if (m.unit==='mmol/L' && typeof m.value==='number'){ mmol=Number(m.value); mgdl=Math.round(mmol*18); }
    else if (m.unit==='mg/dL' && typeof m.value==='number'){ mgdl=Number(m.value); mmol=mgdl/18; }
    if(mmol==null || !isFinite(mmol)) return;

    // الحالة حسب hypo/hyper
    const st = (mmol < childData._hypo) ? 'low' : (mmol > childData._hyper) ? 'high' : 'ok';

    const unit = unitSelect.value==='mmol'?'mmol/L':'mg/dL';
    const value = unit==='mmol/L' ? Number(mmol.toFixed(1)) : Math.round(mgdl);

    const slot = mapSlot(m.slotKey || m.slot || m.timeLabel || 'random');
    byDate.get(date).cols[slot].push({
      value,
      unit,
      state: m.state || st,
      bolus: m.bolusDose ?? null,
      corr:  m.correctionDose ?? null,
      notes: m.notes || ''
    });
  });

  cachedRows = Array.from(byDate.values());
}

/* رسم الجدول */
function renderTable(isManual){
  tbody.innerHTML = '';
  const TABLE_COLS = ['wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn','snack','pre_sleep','during_sleep','pre_sport','post_sport'];

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
    // eslint-disable-next-line no-undef
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
