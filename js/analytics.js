// js/analytics.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===================== الإعدادات/الثوابت ===================== */

// ترجمة مفاتيح أوقات القياس لعرض عربي
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

// مجموعات جاهزة للفلترة (لو عندك أزرار/اختيارات)
const FILTER_GROUPS = {
  all:   null,
  pre:   ['PRE_BREAKFAST','PRE_LUNCH','PRE_DINNER'],
  post:  ['POST_BREAKFAST','POST_LUNCH','POST_DINNER'],
  sleep: ['BEDTIME','DURING_SLEEP'],
  sport: ['PRE_SPORT','POST_SPORT']
};

/* ===================== عناصر الصفحة (اختياري) ===================== */
const elChildName   = document.getElementById('childName');
const elFrom        = document.getElementById('fromDate');
const elTo          = document.getElementById('toDate');
const elApply       = document.getElementById('applyBtn');
const elFilterAll   = document.getElementById('fltAll');
const elFilterPre   = document.getElementById('fltPre');
const elFilterPost  = document.getElementById('fltPost');
const elFilterSleep = document.getElementById('fltSleep');
const elFilterSport = document.getElementById('fltSport');

const elAvgCard     = document.getElementById('avgCard');
const elCntCard     = document.getElementById('cntCard');
const elHypoCard    = document.getElementById('hypoCard');
const elTrendCard   = document.getElementById('trendCard');

const elSlotTable   = document.getElementById('slotTableBody');
const elCsvBtn      = document.getElementById('csvBtn');

/* ===================== أدوات ===================== */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (iso, delta) => { const d = new Date(iso); d.setDate(d.getDate()+delta); return todayStr(d); };
const toNum = x => { const n = Number(String(x).replace(',','.')); return isNaN(n) ? null : n; };

function mmolFromRow(r){
  if (r.value_mmol != null) return Number(r.value_mmol);
  if (r.unit === 'mmol/L' && r.value != null) return toNum(r.value);
  if (r.value_mgdl != null) return Number(r.value_mgdl)/18;
  if (r.unit === 'mg/dL' && r.value != null) return toNum(r.value)/18;
  return null;
}
function mgdlFromRow(r){
  if (r.value_mgdl != null) return Number(r.value_mgdl);
  const mmol = mmolFromRow(r);
  return mmol != null ? Math.round(mmol*18) : null;
}

// قراءة فلتر مختار من واجهة المستخدم (لو موجودة)
function getSelectedFilterKey(){
  if (elFilterPre?.classList?.contains('active'))   return 'pre';
  if (elFilterPost?.classList?.contains('active'))  return 'post';
  if (elFilterSleep?.classList?.contains('active')) return 'sleep';
  if (elFilterSport?.classList?.contains('active')) return 'sport';
  return 'all';
}
function setFilterActive(key){
  [elFilterAll, elFilterPre, elFilterPost, elFilterSleep, elFilterSport].forEach(b => b?.classList.remove('active'));
  const map = { all:elFilterAll, pre:elFilterPre, post:elFilterPost, sleep:elFilterSleep, sport:elFilterSport };
  map[key]?.classList?.add('active');
}

/* ===================== حالة ===================== */
const qs       = new URLSearchParams(location.search);
const childId  = qs.get('child');
const rangePar = (qs.get('range')||'').toLowerCase(); // مثال: 14d

let currentUser = null;
let loadedRows  = []; // بيانات القياسات بعد التوحيد/الفلترة

/* ===================== تهيئة التاريخ من range ===================== */
function applyRangeParam(){
  const to = todayStr();
  let from = addDays(to, -13); // افتراضي: 14 يوم

  const m = rangePar.match(/^(\d+)d$/);
  if (m){
    const days = Math.max(1, parseInt(m[1],10));
    from = addDays(to, -(days-1));
  }
  elFrom?.setAttribute('value', from);
  elTo?.setAttribute('value', to);
}

/* ===================== تحميل البيانات ===================== */
async function loadMeasurements(){
  if (!childId) throw new Error('لا يوجد معرف طفل في الرابط.');
  if (!currentUser) throw new Error('لم يتم تسجيل الدخول.');

  // التاريخين من الواجهة أو من range
  const from = elFrom?.value || addDays(todayStr(), -13);
  const to   = elTo?.value   || todayStr();
  if (from > to) throw new Error('نطاق التاريخ غير صالح.');

  const baseRef = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);

  // استعلام بالتاريخ فقط لتجنّب فهارس مركّبة
  const qy = query(
    baseRef,
    where('date','>=', from),
    where('date','<=', to),
    orderBy('date','asc')
  );

  const snap = await getDocs(qy);

  // فلترة محلية حسب خيار الواجهة (إن وُجد)
  const fltKey = getSelectedFilterKey();
  const allowed = FILTER_GROUPS[fltKey]; // null يعني الكل

  const rows = [];
  snap.forEach(d=>{
    const r = d.data();
    const slotKey = String(r.slotKey || '').toUpperCase().trim(); // مثال: PRE_BREAKFAST
    if (allowed && !allowed.includes(slotKey)) return;

    const mmol = mmolFromRow(r);
    const mgdl = mgdlFromRow(r);
    rows.push({
      id: d.id,
      date: r.date,
      time: r.time || null,
      unit: r.unit || null,
      state: r.state || null,
      slotKey,
      slotLabel: SLOT_LABEL[slotKey] || slotKey,
      mmol, mgdl,
      raw: r
    });
  });

  loadedRows = rows;
}

/* ===================== عرض الملخصات ===================== */
function renderSummary(){
  if (!loadedRows.length){
    // صفرّي البطاقات
    if (elAvgCard) elAvgCard.textContent = '—';
    if (elCntCard) elCntCard.textContent = '0';
    if (elHypoCard) elHypoCard.textContent = '—';
    if (elTrendCard) elTrendCard.textContent = '—';
    if (elSlotTable) elSlotTable.innerHTML = '';
    return;
  }

  // متوسط (mmol/L)
  const arrMmol = loadedRows.map(r=> r.mmol).filter(v=> v!=null);
  const avgMmol = arrMmol.length ? (arrMmol.reduce((a,b)=>a+b,0)/arrMmol.length) : null;

  // عدد القياسات
  const cnt = loadedRows.length;

  // نسبة المنخفض (mmol < 3.9 مثالاً)
  const hypoCnt = loadedRows.filter(r=> r.mmol!=null && r.mmol < 3.9).length;
  const hypoPct = cnt ? Math.round((hypoCnt/cnt)*100) : null;

  // اتجاه بسيط (آخر 3 قراءات)
  let trend = '—';
  if (arrMmol.length >= 3){
    const a = arrMmol.slice(-3);
    const diff = (a[2] - a[0]);
    if (diff > 0.5) trend = '↗︎ صاعد';
    else if (diff < -0.5) trend = '↘︎ هابط';
    else trend = '→ مستقر';
  }

  if (elAvgCard) elAvgCard.textContent = avgMmol!=null ? avgMmol.toFixed(1) : '—';
  if (elCntCard) elCntCard.textContent = String(cnt);
  if (elHypoCard) elHypoCard.textContent = hypoPct!=null ? (`${hypoPct}%`) : '—';
  if (elTrendCard) elTrendCard.textContent = trend;

  // جدول توزيع حسب slot
  if (elSlotTable){
    const bySlot = {};
    loadedRows.forEach(r=>{
      const key = r.slotLabel || 'غير محدد';
      (bySlot[key] ||= []).push(r);
    });
    const rows = Object.entries(bySlot).map(([lab, arr])=>{
      const avg = arr.filter(x=>x.mmol!=null).map(x=>x.mmol);
      const avgVal = avg.length ? (avg.reduce((a,b)=>a+b,0)/avg.length) : null;
      return `<tr>
        <td>${lab}</td>
        <td>${arr.length}</td>
        <td>${avgVal!=null ? avgVal.toFixed(1) : '—'}</td>
      </tr>`;
    });
    elSlotTable.innerHTML = rows.join('');
  }
}

/* ===================== تصدير CSV ===================== */
function exportCSV(){
  if (!loadedRows.length){ alert('لا توجد بيانات للتصدير'); return; }
  const header = ['date','slot','mmol','mgdl','state'];
  const lines = [header.join(',')];
  loadedRows.forEach(r=>{
    const row = [
      r.date || '',
      (r.slotLabel || r.slotKey || ''),
      r.mmol!=null ? r.mmol.toFixed(1) : '',
      r.mgdl!=null ? r.mgdl : '',
      r.state || ''
    ];
    lines.push(row.map(x => String(x).replaceAll('"','""')).join(','));
  });
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `measurements_${todayStr()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ===================== ربط الأحداث ===================== */
elApply?.addEventListener('click', handleRefresh);
elCsvBtn?.addEventListener('click', exportCSV);

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

/* ===================== بدء الجلسة ===================== */
applyRangeParam();

onAuthStateChanged(auth, async (user)=>{
  if (!user) return location.href = 'index.html';
  currentUser = user;

  if (!childId){
    alert('لا يوجد معرف طفل في الرابط');
    location.href = 'parent.html';
    return;
  }

  // تحديث اسم الطفل في الهيدر (لو موجود)
  try{
    // اختياري: لو عندك اسم الطفل في الذاكرة/صفحة سابقة
    const nameFromUrl = new URLSearchParams(location.search).get('childName');
    if (elChildName && nameFromUrl) elChildName.textContent = nameFromUrl;
  }catch{}

  handleRefresh();
});
