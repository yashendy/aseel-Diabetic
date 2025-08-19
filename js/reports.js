// js/reports.js — PRINT GRID (FILLED) + BLANK + UNIT + NOTES TOGGLE
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, query, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* DOM */
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl = document.getElementById('chipCR');
const chipCFEl = document.getElementById('chipCF');

const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const unitSel= document.getElementById('unitSel');

const tbody  = document.getElementById('tbody');
const table  = document.getElementById('reportTable');
const densityHint = document.getElementById('densityHint');

const openAnalytics = document.getElementById('openAnalytics');
const toggleNotesBtn= document.getElementById('toggleNotes');

const blankWeekBtn  = document.getElementById('blankWeek');
const blankWeekSec  = document.getElementById('blankWeekSection');
const blankBody     = document.getElementById('blankBody');
const blankUnit     = document.getElementById('blankUnit');

const printFilledBtn= document.getElementById('printFilledBtn');
const printFilledSec= document.getElementById('printFilledSection');
const printFilledContainer = document.getElementById('printFilledContainer');
const filledUnit    = document.getElementById('filledUnit');

/* Helpers */
const pad = n => String(n).padStart(2,'0');
function todayStr(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function addDaysStr(ds,delta){ const d=new Date(ds); d.setDate(d.getDate()+delta); return todayStr(d); }
const toMgdl = mmol => Math.round(Number(mmol)*18);
const toMmol = mgdl => Number(mgdl)/18;

function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    if(/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    const tryDate = new Date(any);
    if(!isNaN(tryDate)) return todayStr(tryDate);
    return any;
  }
  const d=(any?.toDate && typeof any.toDate==='function')? any.toDate(): new Date(any);
  if(!isNaN(d)) return todayStr(d);
  return '';
}
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return `${a} سنة`;
}
function stateLabel(s){ return {normal:'طبيعي', high:'ارتفاع', low:'هبوط'}[s] || '—'; }
function slotLabel(key){
  const map={
    wake:'الاستيقاظ',
    pre_bf:'قبل الإفطار', post_bf:'بعد الإفطار',
    pre_ln:'قبل الغداء',  post_ln:'بعد الغداء',
    pre_dn:'قبل العشاء',  post_dn:'بعد العشاء',
    snack:'سناك', pre_sleep:'قبل النوم', during_sleep:'أثناء النوم',
    pre_ex:'قبل الرياضة', post_ex:'بعد الرياضة'
  };
  if(!key) return '—';
  return map[key] || key;
}
function arrowSpan(state){
  if(state==='high') return '<span class="arrow up">↑</span>';
  if(state==='low')  return '<span class="arrow down">↓</span>';
  return '';
}

/* Child Id */
const params = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');
let lastRows = []; // cache for print grid

/* Main */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  localStorage.setItem('lastChildId', childId);

  // Load child header
  try{
    const cref = doc(db, `parents/${user.uid}/children/${childId}`);
    const csnap = await getDoc(cref);
    if(csnap.exists()){
      const c = csnap.data();
      childNameEl.textContent = c.name || 'طفل';
      childMetaEl.textContent = `${c.gender || '—'} • العمر: ${calcAge(c.birthDate)}`;
      chipRangeEl.textContent = `النطاق: ${(c.normalRange?.min ?? 4)}–${(c.normalRange?.max ?? 7)} mmol/L`;
      chipCREl.textContent    = `CR: ${c.carbRatio ?? '—'} g/U`;
      chipCFEl.textContent    = `CF: ${c.correctionFactor ?? '—'} mmol/L/U`;
      localStorage.setItem('lastChildName', c.name || 'طفل');
    }else{
      const cached = localStorage.getItem('lastChildName');
      if (cached) childNameEl.textContent = cached;
    }
  }catch(e){ console.error('child load error', e); }

  // defaults
  const today = todayStr();
  if(!toEl.value)   toEl.value   = today;
  if(!fromEl.value) fromEl.value = addDaysStr(today,-7);
  unitSel.value = localStorage.getItem('reports_unit') || 'mmol';
  blankUnit.textContent = unitSel.value==='mgdl' ? 'mg/dL' : 'mmol/L';

  // listeners
  fromEl.addEventListener('change', loadRange);
  toEl.addEventListener('change', loadRange);
  unitSel.addEventListener('change', ()=>{
    localStorage.setItem('reports_unit', unitSel.value);
    blankUnit.textContent = unitSel.value==='mgdl' ? 'mg/dL' : 'mmol/L';
    renderTable(lastRows); // إعادة عرض الجدول بالشاشة
  });

  await loadRange();

  openAnalytics.addEventListener('click', ()=>{
    const href = new URL('analytics.html', location.href);
    href.searchParams.set('child', childId);
    if(fromEl.value) href.searchParams.set('start', fromEl.value);
    if(toEl.value)   href.searchParams.set('end', toEl.value);
    location.href = href.toString();
  });

  // Toggle notes (يؤثر على الطباعة أيضًا عبر CSS)
  toggleNotesBtn.addEventListener('click', ()=>{
    const hidden = document.body.classList.toggle('notes-hidden');
    toggleNotesBtn.textContent = hidden ? '📝 إظهار الملاحظات' : '👁️‍🗨️ إخفاء الملاحظات';
  });

  // تقرير فارغ للأسبوع (بدون سناك) — للطباعة اليدوية
  blankWeekBtn.addEventListener('click', ()=>{
    buildBlankWeek();
    document.body.classList.add('print-blank');
    window.print();
    setTimeout(()=> document.body.classList.remove('print-blank'), 300);
  });

  // طباعة التقرير الممتلئ (شبكة أسبوعية بدون سناك)
  printFilledBtn.addEventListener('click', async ()=>{
    // بُني الشبكات (قد تكون عدة جداول كل 7 أيام)
    buildFilledGrids(lastRows);
    document.body.classList.add('print-filled');
    window.print();
    setTimeout(()=> document.body.classList.remove('print-filled'), 300);
  });
});

/* تحميل الفترة وعرض جدول الشاشة */
async function loadRange(){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  if(!start || !end) return;

  tbody.innerHTML = `<tr><td colspan="6" class="muted center">جارِ التحميل…</td></tr>`;

  try{
    const base = collection(db, `parents/${auth.currentUser.uid}/children/${childId}/measurements`);
    const snap = await getDocs(query(base, orderBy('date','asc')));

    const rows=[];
    snap.forEach(d=>{
      const r = d.data();
      const date = normalizeDateStr(r.date);
      if(!date || date < start || date > end) return;

      const slot = r.slot || r.input?.slot || '';
      // نفضل value_mmol / value_mgdl، وإلا value + unit
      let mmol = (typeof r.value_mmol==='number') ? r.value_mmol : null;
      let mgdl = (typeof r.value_mgdl==='number') ? r.value_mgdl : null;
      if(mmol==null && typeof r.value==='number' && (r.unit||'')==='mmol/L') mmol = r.value;
      if(mgdl==null && typeof r.value==='number' && (r.unit||'')==='mg/dL') mgdl = r.value;
      if(mmol==null && mgdl!=null) mmol = toMmol(mgdl);
      if(mgdl==null && mmol!=null) mgdl = toMgdl(mmol);

      const unit  = (unitSel.value==='mgdl') ? 'mg/dL' : 'mmol/L'; // عرض حسب اختيار المستخدم
      const notes = r.notes || r.input?.notes || '';
      const corr  = r.correctionDose ?? r.input?.correctionDose ?? null;
      const hypo  = r.hypoTreatment  ?? r.input?.raisedWith   ?? '';
      const state = r.state || r.input?.state || '';

      rows.push({
        date, slot,
        value_mmol:mmol, value_mgdl:mgdl, unitDisplay:unit,
        state, corr, hypo, notes
      });
    });

    // sort by date then slot
    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1) : String(a.slot).localeCompare(String(b.slot),'ar'));

    lastRows = rows;
    tuneDensity(rows);
    renderTable(rows);
  }catch(e){
    console.error('loadRange error', e);
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">خطأ في تحميل البيانات.</td></tr>`;
  }
}

function tuneDensity(rows){
  document.body.classList.remove('dense','very-dense');
  densityHint.classList.add('hidden');
  const n = rows.length;
  if(n > 120){
    document.body.classList.add('very-dense');
    densityHint.classList.remove('hidden');
  }else if(n > 80){
    document.body.classList.add('dense');
    densityHint.classList.remove('hidden');
  }
}

function readingText(row){
  const useMg = unitSel.value==='mgdl';
  const v = useMg ? row.value_mgdl : row.value_mmol;
  if(v==null || isNaN(v)) return '—';
  return useMg ? `${Math.round(v)} mg/dL` : `${Number(v).toFixed(1)} mmol/L`;
}
function arrowFor(state){
  if(state==='high') return '<span class="arrow up">↑</span>';
  if(state==='low')  return '<span class="arrow down">↓</span>';
  return '';
}

function renderTable(rows){
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">لا يوجد قياسات للفترة المحددة.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r=>{
    const trClass = `state-${r.state||'normal'} ${r.slot==='snack'?'slot-snack':''}`;
    return `
    <tr class="${trClass}">
      <td>${r.date}</td>
      <td>${slotLabel(r.slot)}</td>
      <td class="reading"><span>${readingText(r)}</span>${arrowFor(r.state)}</td>
      <td>${stateLabel(r.state)}</td>
      <td>${(r.corr!=null && r.corr!=='') ? r.corr : '—'}</td>
      <td class="col-notes">${(r.notes && String(r.notes).trim()) ? r.notes : (r.hypo? `رفع: ${r.hypo}` : '—')}</td>
    </tr>`;
  }).join('');
}

/* تقرير فارغ لأسبوع (بدون سناك) */
blankWeekBtn?.addEventListener('click', ()=>{}); // listener متسجل فوق

function buildBlankWeek(){
  blankBody.innerHTML = '';
  const base = normalizeDateStr(fromEl.value) || todayStr();
  const days = [...Array(7)].map((_,i)=> addDaysStr(base, i));

  const dayName = (dStr)=>{
    const d = new Date(dStr);
    const names = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    return names[d.getDay()];
    };

  days.forEach(date=>{
    blankBody.insertAdjacentHTML('beforeend', `
      <tr>
        <td><div><strong>${dayName(date)}</strong></div><div class="small">${date}</div></td>
        <td></td> <!-- الاستيقاظ -->
        <td></td> <!-- ق.الفطار -->
        <td></td> <!-- ب.الفطار -->
        <td></td> <!-- ق.الغداء -->
        <td></td> <!-- ب.الغداء -->
        <td></td> <!-- ق.العشاء -->
        <td></td> <!-- ب.العشاء -->
        <td></td> <!-- ق.النوم -->
        <td></td> <!-- أثناء النوم -->
      </tr>
    `);
  });
}

/* تقرير ممتلئ: جداول أسبوعية بدون سناك (الخلية = قراءة + سهم + جرعة + ملاحظات) */
const GRID_COLS = [
  {key:'wake',        label:'الاستيقاظ'},
  {key:'pre_bf',      label:'ق.الفطار'},
  {key:'post_bf',     label:'ب.الفطار'},
  {key:'pre_ln',      label:'ق.الغداء'},
  {key:'post_ln',     label:'ب.الغداء'},
  {key:'pre_dn',      label:'ق.العشاء'},
  {key:'post_dn',     label:'ب.العشاء'},
  {key:'pre_sleep',   label:'ق.النوم'},
  {key:'during_sleep',label:'أثناء النوم'},
]; // بدون snack

function buildFilledGrids(rows){
  printFilledContainer.innerHTML = '';
  filledUnit.textContent = unitSel.value==='mgdl' ? 'mg/dL' : 'mmol/L';

  if(!rows.length){
    printFilledContainer.innerHTML = '<div class="muted">لا توجد بيانات للطباعة.</div>';
    return;
  }

  // اجمع التواريخ ضمن الفترة واختر تسلسلها
  const allDates = Array.from(new Set(rows.map(r=>r.date))).sort();
  // قسّم إلى أسابيع (chunks of 7)
  for(let i=0; i<allDates.length; i+=7){
    const chunk = allDates.slice(i, i+7);
    const html = renderFilledGridForDates(chunk, rows);
    printFilledContainer.insertAdjacentHTML('beforeend', html);
  }
}

function renderFilledGridForDates(dates, rows){
  const rowsByDateSlot = new Map();
  rows.forEach(r=>{
    const key = r.date+'|'+r.slot;
    if(!rowsByDateSlot.has(key)) rowsByDateSlot.set(key, []);
    rowsByDateSlot.get(key).push(r);
  });

  // خلية واحدة لكل (يوم، وقت) — لو تعدد قياسات لنفس الوقت نعرض أول واحدة (أو نختصر)
  const cellHTML = (list)=>{
    if(!list || !list.length) return '';
    const r = list[0]; // أبسط اختيار
    const reading = readingText(r);
    const arrow = arrowFor(r.state);
    const dose = (r.corr!=null && r.corr!=='') ? `جرعة: ${r.corr}U` : (r.hypo? `رفع: ${r.hypo}` : '');
    const note = (r.notes && String(r.notes).trim()) ? `ملاحظات: ${r.notes}` : '';
    return `
      <div class="filled-cell">
        <div class="reading">${reading} ${arrow}</div>
        ${dose? `<div class="dose">${dose}</div>`:''}
        ${note? `<div class="note">${note}</div>`:''}
      </div>`;
  };

  const dayName = (dStr)=>{
    const d = new Date(dStr);
    const names = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    return names[d.getDay()];
  };

  // هيدر الجدول
  let thead = `<thead><tr><th>اليوم</th>`;
  GRID_COLS.forEach(c=> thead += `<th>${c.label}</th>`);
  thead += `</tr></thead>`;

  // جسم الجدول
  let tbody = `<tbody>`;
  dates.forEach(date=>{
    tbody += `<tr>`;
    tbody += `<td><div><strong>${dayName(date)}</strong></div><div class="small">${date}</div></td>`;
    GRID_COLS.forEach(c=>{
      const list = rowsByDateSlot.get(date+'|'+c.key);
      tbody += `<td>${cellHTML(list)}</td>`;
    });
    tbody += `</tr>`;
  });
  tbody += `</tbody>`;

  return `
    <div class="table-wrap">
      <table class="filled-grid">
        ${thead}
        ${tbody}
      </table>
    </div>
  `;
}
