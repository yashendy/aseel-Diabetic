// js/analytics.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, getDoc, query, where, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* =============== ثوابت =============== */
const SLOT_LABEL = {
  PRE_BREAKFAST:  'ق.الفطار',
  POST_BREAKFAST: 'ب.الفطار',
  PRE_LUNCH:      'ق.الغدا',
  POST_LUNCH:     'ب.الغدا',
  PRE_DINNER:     'ق.العشا',
  POST_DINNER:    'ب.العشا',
  BEDTIME:        'ق.النوم',
  DURING_SLEEP:   'أثناء النوم',
  PRE_SPORT:      'ق.الرياضة',
  POST_SPORT:     'ب.الرياضة',
  WAKE:           'الاستيقاظ',
  SNACK:          'سناك'
};
const FILTER_GROUPS = {
  all:   null,
  pre:   ['PRE_BREAKFAST','PRE_LUNCH','PRE_DINNER'],
  post:  ['POST_BREAKFAST','POST_LUNCH','POST_DINNER'],
  sleep: ['BEDTIME','DURING_SLEEP'],
  sport: ['PRE_SPORT','POST_SPORT']
};

/* =============== عناصر =============== */
const elChildName   = document.getElementById('childName');
const elChildMeta   = document.getElementById('childMeta');
const elFrom        = document.getElementById('fromDate');
const elTo          = document.getElementById('toDate');
const elApply       = document.getElementById('applyBtn');
const elUnit        = document.getElementById('unitSel');

const elFilterAll   = document.getElementById('fltAll');
const elFilterPre   = document.getElementById('fltPre');
const elFilterPost  = document.getElementById('fltPost');
const elFilterSleep = document.getElementById('fltSleep');
const elFilterSport = document.getElementById('fltSport');

const elAvgCard     = document.getElementById('avgCard');
const elCntCard     = document.getElementById('cntCard');
const elHypoCard    = document.getElementById('hypoCard');
const elTrendCard   = document.getElementById('trendCard');
const elTirCard     = document.getElementById('tirCard');
const elSlotTable   = document.getElementById('slotTableBody');

const elCsvBtn      = document.getElementById('csvBtn');
const elPdfBtn      = document.getElementById('pdfBtn');
const elBackBtn     = document.getElementById('backBtn');

/* =============== أدوات =============== */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (iso, delta) => { const d=new Date(iso); d.setDate(d.getDate()+delta); return todayStr(d); };
const toNum = x => { const n=Number(String(x).replace(',','.')); return isNaN(n)?null:n; };

function mmolFromRow(r){
  if (r.value_mmol!=null) return Number(r.value_mmol);
  if (r.unit==='mmol/L' && r.value!=null) return toNum(r.value);
  if (r.value_mgdl!=null) return Number(r.value_mgdl)/18;
  if (r.unit==='mg/dL' && r.value!=null) return toNum(r.value)/18;
  return null;
}
function mgdlFromRow(r){
  if (r.value_mgdl!=null) return Number(r.value_mgdl);
  const mmol = mmolFromRow(r);
  return mmol!=null ? Math.round(mmol*18) : null;
}

function setFilterActive(key){
  [elFilterAll, elFilterPre, elFilterPost, elFilterSleep, elFilterSport].forEach(b=>b?.classList.remove('active'));
  ({all:elFilterAll,pre:elFilterPre,post:elFilterPost,sleep:elFilterSleep,sport:elFilterSport}[key])?.classList.add('active');
}
function getSelectedFilterKey(){
  if (elFilterPre?.classList.contains('active')) return 'pre';
  if (elFilterPost?.classList.contains('active')) return 'post';
  if (elFilterSleep?.classList.contains('active')) return 'sleep';
  if (elFilterSport?.classList.contains('active')) return 'sport';
  return 'all';
}

/* =============== حالة =============== */
const qs      = new URLSearchParams(location.search);
const childId = qs.get('child');
const rangePr = (qs.get('range')||'').toLowerCase();

let currentUser = null;
let childData   = null;
let loadedRows  = [];
let displayUnit = 'mmol'; // mmol | mgdl

/* =============== تهيئة التاريخ من range =============== */
function applyRangeParam(){
  const to = todayStr();
  let from = addDays(to, -13);
  const m = rangePr.match(/^(\d+)d$/);
  if (m) {
    const days = Math.max(1, parseInt(m[1],10));
    from = addDays(to, -(days-1));
  }
  elFrom?.setAttribute('value', from);
  elTo?.setAttribute('value', to);
}

/* =============== تحميل بيانات الطفل =============== */
async function loadChild(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    throw new Error('لم يتم العثور على الطفل');
  }
  childData = snap.data();
  // عرض الهيدر
  if (elChildName) elChildName.textContent = childData.name || 'طفل';
  const cr = childData.carbRatio ?? '—';
  const cf = childData.correctionFactor ?? '—';
  const range = childData.normalRange ? `${childData.normalRange.min ?? '—'}–${childData.normalRange.max ?? '—'} mmol/L` : '—';
  if (elChildMeta) elChildMeta.textContent = `CR: ${cr} g/U • CF: ${cf} mmol/L/U • النطاق: ${range}`;
}

/* =============== تحميل القياسات =============== */
async function loadMeasurements(){
  const from = elFrom?.value || addDays(todayStr(), -13);
  const to   = elTo?.value   || todayStr();
  if (from > to) throw new Error('نطاق التاريخ غير صالح');

  const baseRef = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy = query(baseRef, where('date','>=', from), where('date','<=', to), orderBy('date','asc'));
  const snap = await getDocs(qy);

  const fltKey = getSelectedFilterKey();
  const allowed = FILTER_GROUPS[fltKey];

  const rows = [];
  snap.forEach(d=>{
    const r = d.data();
    const slotKey = String(r.slotKey || '').toUpperCase().trim();
    if (allowed && !allowed.includes(slotKey)) return;

    const mmol = mmolFromRow(r);
    const mgdl = mgdlFromRow(r);

    rows.push({
      id: d.id,
      date: r.date,
      time: r.time || null,
      slotKey,
      slotLabel: SLOT_LABEL[slotKey] || slotKey,
      mmol, mgdl,
      state: r.state || null,
      raw: r
    });
  });

  loadedRows = rows;
}

/* =============== عرض الملخصات =============== */
function renderSummary(){
  // عدد
  const cnt = loadedRows.length;
  if (elCntCard) elCntCard.textContent = String(cnt || '—');

  // متوسط و SD بسيط
  const arr = loadedRows.map(r => displayUnit==='mmol' ? r.mmol : r.mgdl).filter(v=> v!=null);
  const avg = arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
  if (elAvgCard) elAvgCard.textContent = avg!=null ? (displayUnit==='mmol'? avg.toFixed(1) : Math.round(avg)) : '—';

  // انحراف معياري بسيط (نكتبه في trendCard)
  let sd = null;
  if (arr.length >= 2){
    const mu = avg;
    const v  = arr.reduce((s,x)=> s + Math.pow(x-mu,2), 0) / (arr.length-1);
    sd = Math.sqrt(v);
  }
  if (elTrendCard) elTrendCard.textContent = sd!=null ? (displayUnit==='mmol'? sd.toFixed(2) : Math.round(sd)) : '—';

  // هبوطات (%)
  const hypoCnt = loadedRows.filter(r => (r.mmol!=null && r.mmol < 3.9)).length;
  const hypoPct = cnt ? Math.round(hypoCnt*100/cnt) : null;
  if (elHypoCard) elHypoCard.textContent = hypoPct!=null ? `${hypoPct}%` : '—';

  // TIR (نطاق الطفل إن وُجد وإلا 3.9–10 mmol)
  const minT = childData?.normalRange?.min ?? 3.9;
  const maxT = childData?.normalRange?.max ?? 10;
  const inCnt = loadedRows.filter(r => r.mmol!=null && r.mmol>=minT && r.mmol<=maxT).length;
  const tir   = cnt ? Math.round(inCnt*100/cnt) : null;
  if (elTirCard) elTirCard.textContent = tir!=null ? `${tir}%` : '—';

  // جدول توزيع حسب slot
  if (elSlotTable){
    const bySlot = {};
    loadedRows.forEach(r=>{
      const k = r.slotLabel || 'غير محدد';
      (bySlot[k] ||= []).push(r);
    });
    const html = Object.entries(bySlot).map(([lab,arr])=>{
      const src = arr.map(x=>x.mmol).filter(v=>v!=null);
      const avg = src.length ? (src.reduce((a,b)=>a+b,0)/src.length).toFixed(1) : '—';
      return `<tr><td>${lab}</td><td>${arr.length}</td><td>${avg}</td></tr>`;
    }).join('');
    elSlotTable.innerHTML = html || `<tr><td colspan="3" class="muted">لا توجد بيانات</td></tr>`;
  }
}

/* =============== تصدير CSV =============== */
function exportCSV(){
  if (!loadedRows.length){ alert('لا توجد بيانات للتصدير'); return; }
  const header = ['date','slot','mmol','mgdl','state'];
  const lines = [header.join(',')];
  loadedRows.forEach(r=>{
    lines.push([
      r.date || '',
      r.slotLabel || r.slotKey || '',
      r.mmol!=null ? r.mmol.toFixed(1) : '',
      r.mgdl!=null ? r.mgdl : '',
      r.state || ''
    ].map(x => String(x).replaceAll('"','""')).join(','));
  });
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `measurements_${todayStr()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* =============== أحداث الواجهة =============== */
function setRangeDays(days){
  const to = todayStr();
  const from = addDays(to, -(days-1));
  elFrom.value = from; elTo.value = to;
}

document.getElementById('rng14')?.addEventListener('click', ()=>{ setRangeDays(14); handleRefresh(); });
document.getElementById('rng30')?.addEventListener('click', ()=>{ setRangeDays(30); handleRefresh(); });
document.getElementById('rng90')?.addEventListener('click', ()=>{ setRangeDays(90); handleRefresh(); });

elApply?.addEventListener('click', handleRefresh);
elCsvBtn?.addEventListener('click', exportCSV);
elPdfBtn?.addEventListener('click', ()=>{
  // Placeholder: افتح صفحة الطباعة لو حابّة توصلينه لاحقًا
  // location.href = `reports-print.html?child=${encodeURIComponent(childId)}&from=${elFrom.value}&to=${elTo.value}`;
  alert('قريبًا: تصدير PDF/طباعة.');
});
elBackBtn?.addEventListener('click', ()=>{
  // رجوع إلى لوحة الطفل
  location.href = `child.html?child=${encodeURIComponent(childId)}`;
});

elUnit?.addEventListener('change', ()=>{
  displayUnit = elUnit.value; // mmol | mgdl
  renderSummary();
});

elFilterAll?.addEventListener('click', ()=>{ setFilterActive('all');  handleRefresh(); });
elFilterPre?.addEventListener('click', ()=>{ setFilterActive('pre');  handleRefresh(); });
elFilterPost?.addEventListener('click',()=>{ setFilterActive('post'); handleRefresh(); });
elFilterSleep?.addEventListener('click',()=>{ setFilterActive('sleep');handleRefresh(); });
elFilterSport?.addEventListener('click',()=>{ setFilterActive('sport');handleRefresh(); });

async function handleRefresh(){
  try{
    await loadMeasurements();
    renderSummary();
  }catch(e){
    console.error('Analytics load failed:', e);
    alert('تعذّر تحميل التحليل.\n' + (e?.message || ''));
  }
}

/* =============== بدء الجلسة =============== */
applyRangeParam();

onAuthStateChanged(auth, async (user)=>{
  if (!user) return location.href = 'index.html';
  if (!childId){ alert('لا يوجد معرف طفل في الرابط'); location.href='parent.html'; return; }
  currentUser = user;

  try{
    await loadChild();       // 👈 يجلب الاسم و CR/CF والنطاق
    await loadMeasurements();
    renderSummary();
  }catch(e){
    console.error(e);
    alert('تعذّر تحميل بيانات الطفل/القياسات.\n' + (e?.message || ''));
  }
});
