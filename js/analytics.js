// js/analytics.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, getDoc, query, where, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ===== خريطة الأوقات ===== */
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

/* ===== عناصر ===== */
const qs          = new URLSearchParams(location.search);
const childId     = qs.get('child');
const rangePr     = (qs.get('range')||'').toLowerCase();

const elChildName = document.getElementById('childName');
const elChildMeta = document.getElementById('childMeta');
const elFrom      = document.getElementById('fromDate');
const elTo        = document.getElementById('toDate');
const elUnit      = document.getElementById('unitSel');
const elApply     = document.getElementById('applyBtn');

const elFilterAll   = document.getElementById('fltAll');
const elFilterPre   = document.getElementById('fltPre');
const elFilterPost  = document.getElementById('fltPost');
const elFilterSleep = document.getElementById('fltSleep');
const elFilterSport = document.getElementById('fltSport');

const elAvgCard   = document.getElementById('avgCard');
const elCntCard   = document.getElementById('cntCard');
const elHypoCard  = document.getElementById('hypoCard');
const elTrendCard = document.getElementById('trendCard');
const elTirCard   = document.getElementById('tirCard');
const elSlotTable = document.getElementById('slotTableBody');

const elCsvBtn  = document.getElementById('csvBtn');
const elPdfBtn  = document.getElementById('pdfBtn');
const elBackBtn = document.getElementById('backBtn');

/* AI */
const aiOpen   = document.getElementById('aiOpen');
const aiW      = document.getElementById('aiWidget');
const aiMin    = document.getElementById('aiMin');
const aiClose  = document.getElementById('aiClose');
const aiMsgEl  = document.getElementById('aiMessages');
const aiInput  = document.getElementById('aiInput');
const aiSend   = document.getElementById('aiSend');
const aiCtx    = document.getElementById('aiContext');

/* ===== أدوات ===== */
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

/* ===== حالة ===== */
let currentUser = null;
let childData   = null;
let loadedRows  = [];
let displayUnit = 'mmol'; // mmol | mgdl

/* ===== تهيئة التاريخ من range ===== */
function initRange(){
  const to = todayStr();
  let from = addDays(to, -13);
  const m = rangePr.match(/^(\d+)d$/);
  if (m) {
    const days = Math.max(1, parseInt(m[1],10));
    from = addDays(to, -(days-1));
  }
  elFrom.value = from;
  elTo.value   = to;
}

/* ===== تحميل بيانات الطفل ===== */
async function loadChild(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('لا يوجد طفل');
  childData = snap.data();
  elChildName.textContent = childData.name || 'طفل';
  const cr = childData.carbRatio ?? '—';
  const cf = childData.correctionFactor ?? '—';
  const range = childData.normalRange ? `${childData.normalRange.min ?? '—'}–${childData.normalRange.max ?? '—'} mmol/L` : '—';
  elChildMeta.textContent = `CR: ${cr} g/U • CF: ${cf} mmol/L/U • النطاق: ${range}`;
}

/* ===== تحميل القياسات ===== */
async function loadMeasurements(){
  const from = elFrom.value;
  const to   = elTo.value;
  if (from>to) throw new Error('نطاق التاريخ غير صالح');

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

/* ===== ملخصات ===== */
function renderSummary(){
  // استبعاد قراءات غير منطقية (<2 mmol أو <36 mg/dL)
  const valid = loadedRows.filter(r=>{
    if (r.mmol!=null) return r.mmol >= 2;
    if (r.mgdl!=null) return r.mgdl >= 36;
    return false;
  });

  const cnt = valid.length;
  elCntCard.textContent = String(cnt || '—');

  const arr = valid.map(r => displayUnit==='mmol' ? r.mmol : r.mgdl).filter(v=> v!=null);
  const avg = arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
  elAvgCard.textContent = avg!=null ? (displayUnit==='mmol'? avg.toFixed(1) : Math.round(avg)) : '—';

  let sd = null;
  if (arr.length >= 2){
    const mu = avg;
    const v  = arr.reduce((s,x)=> s + Math.pow(x-mu,2), 0) / (arr.length-1);
    sd = Math.sqrt(v);
  }
  elTrendCard.textContent = sd!=null ? (displayUnit==='mmol'? sd.toFixed(2) : Math.round(sd)) : '—';

  const minT = childData?.normalRange?.min ?? 3.9;
  const maxT = childData?.normalRange?.max ?? 10;
  const inCnt = valid.filter(r => r.mmol!=null && r.mmol>=minT && r.mmol<=maxT).length;
  const tir   = cnt ? Math.round(inCnt*100/cnt) : null;
  elTirCard.textContent = tir!=null ? `${tir}%` : '—';

  const hypoCnt = valid.filter(r => r.mmol!=null && r.mmol<3.9).length;
  const hypoPct = cnt ? Math.round(hypoCnt*100/cnt) : null;
  elHypoCard.textContent = hypoPct!=null ? `${hypoPct}%` : '—';

  // جدول التوزيع
  const bySlot = {};
  valid.forEach(r=>{
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

/* ===== الرسوم (Chart.js) ===== */
let timeChart, donutChart;

function buildCharts(){
  const ctx1 = document.getElementById('timeChart');
  const ctx2 = document.getElementById('donutChart');
  if (timeChart){ timeChart.destroy(); }
  if (donutChart){ donutChart.destroy(); }

  // تجهيز بيانات الزمن
  const points = loadedRows
    .filter(r => r.mmol!=null)
    .map(r=>{
      // حاول استخدام when (Timestamp) إن كان موجوداً
      let t = r.raw?.when?.toDate ? r.raw.when.toDate() : null;
      if (!t){
        // fallback: date + time (HH:mm)
        t = new Date(r.date + (r.time ? 'T'+r.time : 'T12:00'));
      }
      const y = (displayUnit==='mmol') ? r.mmol : Math.round(r.mmol*18);
      return { x: t, y };
    })
    .sort((a,b)=> a.x - b.x);

  timeChart = new Chart(ctx1, {
    type: 'line',
    data: {
      datasets: [{
        label: displayUnit==='mmol' ? 'الجلوكوز (mmol/L)' : 'الجلوكوز (mg/dL)',
        data: points,
        tension: .25,
        pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      parsing: false,
      scales: {
        x: { type: 'time', time: { unit: 'day' } },
        y: { beginAtZero: false }
      },
      plugins: { legend: { display: true } }
    }
  });

  // تجهيز بيانات الدونات
  const bySlot = {};
  loadedRows.forEach(r=>{
    const k = SLOT_LABEL[r.slotKey] || r.slotKey || 'غير محدد';
    (bySlot[k] ||= []).push(r);
  });
  const labels = Object.keys(bySlot);
  const counts = labels.map(k=> bySlot[k].length);

  donutChart = new Chart(ctx2, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: counts }] },
    options: { responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });
}

/* ===== CSV ===== */
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

/* ===== AI Widget ===== */
function aiAppend(role, text){
  const div = document.createElement('div');
  div.className = 'msg ' + (role==='system'?'sys':role);
  div.textContent = text;
  aiMsgEl.appendChild(div);
  aiMsgEl.scrollTop = aiMsgEl.scrollHeight;
}
function buildSystemPrompt(){
  const cr = childData?.carbRatio ?? 'غير معروف';
  const cf = childData?.correctionFactor ?? 'غير معروف';
  const min = childData?.normalRange?.min ?? 3.9;
  const max = childData?.normalRange?.max ?? 10;
  const cnt = elCntCard.textContent;
  const avg = elAvgCard.textContent;
  const tir = elTirCard.textContent;
  const hypo= elHypoCard.textContent;
  const from = elFrom.value, to = elTo.value;

  return `أنت مساعد صحي تعليمي للأطفال المصابين بالسكري (نوع أول). 
قدّم شرحًا مبسطًا بالعربية وتجنّب النصائح الدوائية الملزمة.
بيانات الطفل:
- الاسم: ${childData?.name || 'طفل'}
- CR: ${cr} g/U
- CF: ${cf} mmol/L/U
- النطاق المستهدف: ${min}–${max} mmol/L
ملخص الفترة ${from} → ${to}:
- عدد القياسات: ${cnt}
- المتوسط: ${avg}
- وقت داخل النطاق (TIR): ${tir}
- نسبة الهبوط: ${hypo}
استخدم هذه المعلومات للحسابات والتفسير والتعليم فقط.`;
}
async function callGemini(prompt){
  const key = window.GEMINI_API_KEY || '';
  const payload = {
    contents:[{parts:[{text: prompt}]}]
  };

  // أولوية: المفتاح المباشر (Client) — مفضّل استخدام Proxy للإنتاج
  if (key){
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='+key, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'لم يصل رد.';
    return text;
  }
  // بديل: بروكسي على السيرفر
  const res = await fetch('/api/gemini', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({payload}) });
  if (!res.ok) throw new Error('فشل الاتصال بالمساعد');
  const data = await res.json();
  return data.reply || '…';
}

/* ===== أحداث ===== */
function setRangeDays(days){
  const to = todayStr();
  const from = addDays(to, -(days-1));
  elFrom.value = from; elTo.value = to;
}
document.querySelectorAll('.chip-row .chip[data-range]')?.forEach(btn=>{
  btn.addEventListener('click', ()=>{ setRangeDays(Number(btn.dataset.range||'14')); refresh(); });
});

elFilterAll?.addEventListener('click', ()=>{ setFilterActive('all'); refresh(); });
elFilterPre?.addEventListener('click', ()=>{ setFilterActive('pre'); refresh(); });
elFilterPost?.addEventListener('click', ()=>{ setFilterActive('post'); refresh(); });
elFilterSleep?.addEventListener('click', ()=>{ setFilterActive('sleep'); refresh(); });
elFilterSport?.addEventListener('click', ()=>{ setFilterActive('sport'); refresh(); });

elApply?.addEventListener('click', refresh);
elUnit?.addEventListener('change', ()=>{ displayUnit = elUnit.value; renderSummary(); buildCharts(); });
elCsvBtn?.addEventListener('click', exportCSV);
elPdfBtn?.addEventListener('click', ()=> alert('قريبًا: تصدير PDF/طباعة.'));
elBackBtn?.addEventListener('click', ()=> location.href = `child.html?child=${encodeURIComponent(childId)}`);

/* AI UI */
document.getElementById('aiOpen')?.addEventListener('click', ()=>{
  aiW.classList.remove('hidden');
  aiMsgEl.innerHTML = '';
  aiCtx.textContent = `سياق: ${childData?.name || 'طفل'} • ${elFrom.value} → ${elTo.value}`;
  aiAppend('system','مرحبًا! أنا مساعد التحليل. اسألني عن تفسير النتائج أو تحسين TIR (تعليمي فقط).');
});
aiClose?.addEventListener('click', ()=> aiW.classList.add('hidden'));
aiMin?.addEventListener('click', ()=>{
  const body = aiW.querySelector('.ai-body');
  body.style.display = (body.style.display==='none') ? 'block' : 'none';
});
aiSend?.addEventListener('click', async ()=>{
  const txt = (aiInput.value||'').trim();
  if (!txt) return;
  aiInput.value = '';
  aiAppend('user', txt);
  const sys = buildSystemPrompt();
  try{
    aiAppend('assistant','… يتم التفكير');
    const reply = await callGemini(sys + '\n\nسؤال ولي الأمر: ' + txt);
    aiMsgEl.lastChild.textContent = reply;
  }catch(e){
    aiMsgEl.lastChild.textContent = 'حدث خطأ أثناء الاتصال.';
    console.error(e);
  }
});
aiInput?.addEventListener('keydown', e=>{
  if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); aiSend.click(); }
});

/* ===== دورة التحميل ===== */
async function refresh(){
  try{
    await loadMeasurements();
    renderSummary();
    buildCharts();
  }catch(e){
    console.error(e);
    alert('تعذّر تحميل التحليل.\n' + (e?.message || ''));
  }
}

/* ===== تشغيل ===== */
initRange();
onAuthStateChanged(auth, async (user)=>{
  if (!user) return location.href = 'index.html';
  if (!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html'; return; }
  currentUser = user;

  try{
    await loadChild();
    await loadMeasurements();
    renderSummary();
    buildCharts();
  }catch(e){
    console.error(e);
    alert('تعذّر تحميل البيانات.\n' + (e?.message || ''));
  }
});
