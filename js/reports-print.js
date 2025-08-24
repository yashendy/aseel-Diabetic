// js/reports-print.js  (نسخة مُعدَّلة لإخفاء/إظهار كل الملاحظات)
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { collection, query, where, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* عناصر DOM */
const params     = new URLSearchParams(location.search);
const childId    = params.get('child');

const childNameEl = document.getElementById('childName');
const childAgeEl  = document.getElementById('childAge');
const childRangeEl= document.getElementById('childRange');
const childCREl   = document.getElementById('childCR');
const childCFEl   = document.getElementById('childCF');

const unitSelect = document.getElementById('unitSelect');
const fromDateEl = document.getElementById('fromDate');
const toDateEl   = document.getElementById('toDate');
const notesEl    = document.getElementById('notes');

const periodFrom = document.getElementById('periodFrom');
const periodTo   = document.getElementById('periodTo');
const periodUnit = document.getElementById('periodUnit');

const tbody      = document.getElementById('tbody');
const emptyEl    = document.getElementById('empty');

/* المفاتيح (Checkboxes) */
const maskTreat  = document.getElementById('maskTreat');   // ✅ الآن: يخفي/يظهر "كل" الملاحظات
const colorize   = document.getElementById('colorize');
const weeklyMode = document.getElementById('weeklyMode');

const applyBtn   = document.getElementById('applyBtn');
const printBtn   = document.getElementById('printBtn');
const backBtn    = document.getElementById('backBtn');

/* أدوات */
const pad = n => String(n).padStart(2,'0');
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const addDays  = (d,delta)=> { const x=new Date(d); x.setDate(x.getDate()+delta); return x; };
const fmtDate  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--;
  return `${a} سنة`;
}

/* خريطة الأعمدة */
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
let cachedRows = []; // [{date:'YYYY-MM-DD', cols:{'الاستيقاظ':[], ...}}]

/* تهيئة مبدئية للواجهة */
(function initUI(){
  const t = new Date();
  toDateEl.value   = fmtDate(t);
  fromDateEl.value = fmtDate(addDays(t,-7));
  periodUnit.textContent = unitSelect.value === 'mmol' ? 'mmol/L' : 'mg/dL';
})();

/* جلسة المستخدم */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href = 'index.html';
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); history.back(); return; }
  currentUser = user;

  await loadChild();
  await loadMeasurements();
  renderTable();
  renderQR();
});

/* تحميل بيانات الطفل (لرأس التقرير) */
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

/* تحميل القياسات (خلال الفترة) */
async function loadMeasurements(){
  const from = fromDateEl.value || todayStr();
  const to   = toDateEl.value   || todayStr();

  periodFrom.textContent = from;
  periodTo.textContent   = to;
  periodUnit.textContent = unitSelect.value === 'mmol' ? 'mmol/L' : 'mg/dL';

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy  = query(ref, where('date','>=', from), where('date','<=', to), orderBy('date','asc'));
  const snap= await getDocs(qy);

  const byDate = new Map();
  snap.forEach(d=>{
    const m = d.data();

    // توحيد القيم (mmol/mgdl)
    let mmol = null, mgdl = null;
    if (typeof m.value_mmol === 'number') mmol = m.value_mmol;
    if (typeof m.value_mgdl === 'number') mgdl = m.value_mgdl;
    if (mmol==null && mgdl!=null) mmol = mgdl/18;
    if (mgdl==null && mmol!=null) mgdl = Math.round(mmol*18);

    const slotKey = String(m.slotKey||'').toUpperCase();
    const colName = SLOT_MAP[slotKey] || null;
    if(!colName) return;

    const date = m.date || (m.when?.toDate ? fmtDate(m.when.toDate()) : null);
    if(!date) return;

    if(!byDate.has(date)){
      const cols = {}; TABLE_COLS.forEach(c=> cols[c]=[]);
      byDate.set(date, { date, cols });
    }

    const showUnit = unitSelect.value; // mmol | mgdl
    const value = showUnit==='mmol' ? +(+mmol).toFixed(1) : Math.round(mgdl);

    const row = byDate.get(date);
    row.cols[colName].push({
      value,
      unit: showUnit==='mmol'?'mmol/L':'mg/dL',
      state: m.state || 'normal',
      bolus: m.bolusDose ?? null,
      corr:  m.correctionDose ?? null,
      notes: m.notes || ''
    });
  });

  cachedRows = Array.from(byDate.values()).sort((a,b)=> a.date.localeCompare(b.date));

  // وضع أسبوعي: آخر 7 أيام فقط
  if (weeklyMode.checked) {
    cachedRows = cachedRows.slice(-7);
  }
}

/* رسم الجدول */
function renderTable(){
  tbody.innerHTML = '';
  emptyEl.classList.toggle('hidden', cachedRows.length>0);

  const colorizeOn   = colorize.checked;
  const hideAllNotes = maskTreat.checked; // ✅ جديد: إخفاء/إظهار كل الملاحظات

  for(const r of cachedRows){
    const tr = document.createElement('tr');

    // التاريخ
    const tdDate = document.createElement('td');
    tdDate.textContent = r.date;
    tr.appendChild(tdDate);

    // بقية الأعمدة
    for(const cName of TABLE_COLS){
      const td = document.createElement('td');
      const items = r.cols[cName] || [];

      if(items.length===0){
        td.textContent = '—';
      }else{
        items.forEach((it, idx)=>{
          const span = document.createElement('div');
          span.textContent = it.value;

          // تلوين الحالة
          if(colorizeOn){
            const st = String(it.state||'').toLowerCase();
            if(st.startsWith('low'))      span.classList.add('low');
            else if(st.startsWith('high'))span.classList.add('high');
            else                          span.classList.add('okv');
          }
          td.appendChild(span);

          // الجرعات (لا تتأثر بخيار إخفاء الملاحظات)
          if (it.corr!=null || it.bolus!=null){
            const d = document.createElement('span');
            d.className='dose';
            const parts=[];
            if (it.corr!=null)  parts.push(`تصحيح: ${it.corr}U`);
            if (it.bolus!=null) parts.push(`وجبة: ${it.bolus}U`);
            d.textContent = parts.join(' • ');
            td.appendChild(d);
          }

          // ✅ الملاحظات — تظهر/تختفي كلها حسب المربع
          if (it.notes && !hideAllNotes){
            const n = document.createElement('span');
            n.className='note';
            n.textContent = it.notes;
            td.appendChild(n);
          }

          // فاصل بسيط لو أكثر من قراءة في نفس الخلية
          if (idx < items.length-1){
            const hr = document.createElement('hr');
            hr.style.border='none';
            hr.style.borderTop='1px dashed #eee';
            hr.style.margin='6px 0';
            td.appendChild(hr);
          }
        });
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

/* QR */
function renderQR(){
  try{
    const canvas = document.getElementById('qr');
    const url = location.href;
    QRCode.toCanvas(canvas, url, { width:128, margin:1 }, ()=>{});
  }catch{}
}

/* أحداث */
applyBtn.addEventListener('click', async ()=>{
  // نحفظ الخيارات في رابط الصفحة
  const u = new URL(location.href);
  u.searchParams.set('child', childId);
  u.searchParams.set('from', fromDateEl.value);
  u.searchParams.set('to',   toDateEl.value);
  u.searchParams.set('unit', unitSelect.value);
  history.replaceState(null,'',u);

  await loadMeasurements();
  renderTable();
});

printBtn.addEventListener('click', ()=> window.print());
backBtn.addEventListener('click', ()=> history.back());

unitSelect.addEventListener('change', async ()=>{
  periodUnit.textContent = unitSelect.value==='mmol'?'mmol/L':'mg/dL';
  await loadMeasurements();
  renderTable();
});

/* ✅ إعادة الرسم فورًا عند تغيير حالة إخفاء الملاحظات/الوضع الأسبوعي */
maskTreat.addEventListener('change', ()=> renderTable());
weeklyMode.addEventListener('change', async ()=>{
  await loadMeasurements();
  renderTable();
});

/* قراءة قيم من الـURL إن وُجدت */
(function applyParamsFromURL(){
  const from = params.get('from');
  const to   = params.get('to');
  const unit = params.get('unit');
  if (from) fromDateEl.value = from;
  if (to)   toDateEl.value   = to;
  if (unit) unitSelect.value = unit;
  periodUnit.textContent = unitSelect.value==='mmol'?'mmol/L':'mg/dL';
})();
