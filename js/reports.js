// js/reports.js — محسّن
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, query, where, orderBy, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر DOM */
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');
const chipRangeEl = document.getElementById('chipRange');
const chipCREl    = document.getElementById('chipCR');
const chipCFEl    = document.getElementById('chipCF');

const fromEl     = document.getElementById('fromDate');
const toEl       = document.getElementById('toDate');
const outUnitEl  = document.getElementById('outUnit');
const tbody      = document.getElementById('tbody');

const openAnalytics = document.getElementById('openAnalytics');
const openPrint     = document.getElementById('openPrint');
const openBlank     = document.getElementById('openBlank');
const toggleNotesBtn= document.getElementById('toggleNotes');

const csvBtn     = document.getElementById('csvBtn');
const loaderEl   = document.getElementById('loader');
const densityHint= document.getElementById('densityHint');

/* أدوات */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (ds,delta)=>{ const d=new Date(ds); d.setDate(d.getDate()+delta); return todayStr(d); };
const loader = (v)=> loaderEl?.classList.toggle('hidden', !v);

/* Mapping للسلوتات (عربي ← موحّد) */
const AR2KEY = {
  'الاستيقاظ':'wake',
  'ق.الفطار':'pre_bf','ب.الفطار':'post_bf',
  'ق.الغداء':'pre_ln','ب.الغداء':'post_ln',
  'ق.العشاء':'pre_dn','ب.العشاء':'post_dn',
  'سناك':'snack',
  'ق.النوم':'pre_sleep','أثناء النوم':'during_sleep',
  'ق.الرياضة':'pre_sport','ب.الرياضة':'post_sport'
};
const KEY2AR = {
  wake:'الاستيقاظ',
  pre_bf:'قبل الإفطار', post_bf:'بعد الإفطار',
  pre_ln:'قبل الغداء',  post_ln:'بعد الغداء',
  pre_dn:'قبل العشاء',  post_dn:'بعد العشاء',
  snack:'سناك', pre_sleep:'قبل النوم', during_sleep:'أثناء النوم',
  pre_sport:'قبل الرياضة', post_sport:'بعد الرياضة'
};

function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    // لو هي أصلاً yyyy-mm-dd
    if(/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    const d = new Date(any);
    if(!isNaN(d)) return todayStr(d);
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
const toMgdl = mmol => Math.round(Number(mmol)*18);

/* حالة */
const params = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');
let normalMin = 4, normalMax = 7;
let rowsCache = []; // كاش للعرض وإعادة الحساب عند تغيير الوحدة
let notesVisible = true;

/* تشغيل */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  localStorage.setItem('lastChildId', childId);

  // تحميل بيانات الطفل (Header)
  try{
    const cref = doc(db, `parents/${user.uid}/children/${childId}`);
    const csnap = await getDoc(cref);
    if(csnap.exists()){
      const c = csnap.data();
      childNameEl.textContent = c.name || 'طفل';
      childMetaEl.textContent = `${c.gender || '—'} • العمر: ${calcAge(c.birthDate)}`;
      normalMin = Number(c.normalRange?.min ?? 4);
      normalMax = Number(c.normalRange?.max ?? 7);
      chipRangeEl.textContent = `النطاق: ${normalMin}–${normalMax} mmol/L`;
      chipCREl.textContent    = `CR: ${c.carbRatio ?? '—'} g/U`;
      chipCFEl.textContent    = `CF: ${c.correctionFactor ?? '—'} mmol/L/U`;
      localStorage.setItem('lastChildName', c.name || 'طفل');
    }else{
      const cached = localStorage.getItem('lastChildName');
      if (cached) childNameEl.textContent = cached;
    }
  }catch(e){ console.error('child load error', e); }

  // تواريخ افتراضية (آخر 7 أيام)
  const today = todayStr();
  if(!toEl.value)   toEl.value   = today;
  if(!fromEl.value) fromEl.value = addDays(today,-7);

  // أحداث
  fromEl.addEventListener('change', loadRange);
  toEl.addEventListener('change', loadRange);
  outUnitEl.addEventListener('change', ()=> renderTable(rowsCache));

  toggleNotesBtn.addEventListener('click', ()=>{
    notesVisible = !notesVisible;
    document.body.classList.toggle('notes-hidden', !notesVisible);
    toggleNotesBtn.textContent = notesVisible ? 'إخفاء الملاحظات' : 'إظهار الملاحظات';
  });

  csvBtn.addEventListener('click', downloadCSV);

  openAnalytics.addEventListener('click', ()=>{
    const href = new URL('analytics.html', location.href);
    href.searchParams.set('child', childId);
    href.searchParams.set('range', '14d');
    location.href = href.toString();
  });

  openPrint.addEventListener('click', ()=>{
    const href = new URL('reports-print.html', location.href);
    href.searchParams.set('child', childId);
    if(fromEl.value) href.searchParams.set('from', fromEl.value);
    if(toEl.value)   href.searchParams.set('to', toEl.value);
    href.searchParams.set('unit', outUnitEl.value);
    location.href = href.toString();
  });

  openBlank.addEventListener('click', ()=>{
    const blankUrl = new URL('reports-print.html', location.href);
    blankUrl.searchParams.set('child', childId);
    blankUrl.searchParams.set('mode', 'blank');
    location.href = blankUrl.toString();
  });

  // تحميل أول مرة
  await loadRange();
});

/* حالة القراءة */
function getState(mmol){
  if(mmol < normalMin) return 'low';
  if(mmol > normalMax) return 'high';
  return 'ok';
}

/* تحميل الفترة — فلترة على السيرفر */
async function loadRange(){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  if(!start || !end) return;

  tbody.innerHTML = `<tr><td colspan="7" class="muted center">جارِ التحميل…</td></tr>`;
  loader(true);

  try{
    const base = collection(db, `parents/${auth.currentUser.uid}/children/${childId}/measurements`);
    // ✅ فلترة على السيرفر + ترتيب
    const qy = query(base, where('date','>=',start), where('date','<=',end), orderBy('date','asc'));
    const snap = await getDocs(qy);

    const rows=[];
    snap.forEach(d=>{
      const r = d.data();
      const date = normalizeDateStr(r.date);
      if(!date) return;

      // slot موحّد
      let slot = String(r.slotKey || r.slot || '').trim();
      if(AR2KEY[slot]) slot = AR2KEY[slot]; // لو كان بالعربي
      // mmoll
      let mmol = null;
      if(typeof r.value_mmol === 'number') mmol = Number(r.value_mmol);
      else if (typeof r.value_mgdl === 'number') mmol = Number(r.value_mgdl)/18;
      else if (r.unit === 'mmol/L' && typeof r.value === 'number') mmol = Number(r.value);
      else if (r.unit === 'mg/dL' && typeof r.value === 'number') mmol = Number(r.value)/18;
      if(mmol==null || !isFinite(mmol)) return;

      const mgdl = (typeof r.value_mgdl === 'number') ? Number(r.value_mgdl) : toMgdl(mmol);

      const notes = r.notes || r.input?.notes || '';
      const corr  = r.correctionDose ?? r.input?.correctionDose ?? '';
      const hypo  = r.hypoTreatment  ?? r.input?.raisedWith     ?? '';

      const state = getState(mmol);
      rows.push({date, slot, mmol, mgdl, state, corr, hypo, notes});
    });

    // ترتيب داخل اليوم (slot order)
    const order = new Map([
      'wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn','snack','pre_sleep','during_sleep','pre_sport','post_sport'
    ].map((k,i)=>[k,i]));
    rows.sort((a,b)=> a.date!==b.date ? (a.date<b.date?-1:1) : ((order.get(a.slot)||999) - (order.get(b.slot)||999)));

    rowsCache = rows;
    autoDensity(rows.length);
    renderTable(rows);
  }catch(e){
    console.error('loadRange error', e);
    tbody.innerHTML = `<tr><td colspan="7" class="muted center">خطأ في تحميل البيانات.</td></tr>`;
  }finally{
    loader(false);
  }
}

/* كثافة تلقائية حسب حجم البيانات */
function autoDensity(n){
  document.body.classList.remove('dense','very-dense');
  if(n>300) document.body.classList.add('very-dense');
  else if(n>150) document.body.classList.add('dense');
  densityHint.textContent = n>150
    ? `تم تفعيل العرض الكثيف تلقائيًا (${n} صف).`
    : `سيتم تفعيل عرض كثيف تلقائيًا عند تعدّي 150 صف.`;
}

/* عرض الجدول من الكاش */
function renderTable(rows){
  if(!rows.length){
    tbody.innerHTML = `<tr><td colspan="7" class="muted center">لا يوجد قياسات للفترة المحددة.</td></tr>`;
    return;
  }
  const unit = outUnitEl.value; // 'mmol' | 'mgdl'

  // نبني HTML دفعة واحدة (أسرع)
  const html = rows.map(r=>{
    const valTxt = unit==='mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;
    const arrow  = r.state==='low'?'↓': r.state==='high'?'↑':'↔';
    const trCls  = (r.state==='low'?'state-low': r.state==='high'?'state-high':'state-ok');

    return `<tr class="${trCls}">
      <td>${r.date}</td>
      <td>${KEY2AR[r.slot] || r.slot || '—'}</td>
      <td class="reading"><span class="val ${r.state}">${valTxt}</span><span class="arrow ${r.state==='low'?'down':r.state==='high'?'up':''}">${arrow}</span></td>
      <td>${r.state==='low'?'هبوط': r.state==='high'?'ارتفاع':'طبيعي'}</td>
      <td>${(r.corr!=='' && r.corr!=null) ? r.corr : '—'}</td>
      <td>${r.hypo && String(r.hypo).trim() ? r.hypo : '—'}</td>
      <td class="notes col-notes">${r.notes && String(r.notes).trim() ? escapeHTML(r.notes) : '—'}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = html;
}

/* تنزيل CSV من المعروض حاليًا */
async function downloadCSV(){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  const unit  = outUnitEl.value;
  const rows  = rowsCache;

  const headers = ['date','slot','reading','state','correction','hypoTreatment','notes'];
  const toRow = (r)=>{
    const reading = unit==='mgdl' ? `${Math.round(r.mgdl)} mg/dL` : `${r.mmol.toFixed(1)} mmol/L`;
    const state   = r.state==='low'?'هبوط': r.state==='high'?'ارتفاع':'طبيعي';
    return [
      r.date, (KEY2AR[r.slot]||r.slot||'—'), reading, state,
      (r.corr!=='' && r.corr!=null) ? r.corr : '',
      (r.hypo && String(r.hypo).trim()) ? r.hypo : '',
      (r.notes && String(r.notes).trim()) ? r.notes : ''
    ];
  };

  const lines = [headers.join(','), ...rows.map(r => toRow(r).map(csvCell).join(','))];
  const blob  = new Blob(['\uFEFF'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reports_${start}_to_${end}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* Utils */
function escapeHTML(s){ return String(s)
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;')
  .replaceAll("'",'&#039;'); }
function csvCell(s){ return `"${String(s??'').replace(/"/g,'""')}"`; }
