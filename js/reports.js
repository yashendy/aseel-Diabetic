// reports.js — صفحة التقارير النهائية (محدَّث)
// - جلب مزدوج when+date + دمج النتائج لمنع التكرار
// - لوحة تحليلات ذكية أعلى الجدول

import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- DOM & Helpers ---------- */
const $=id=>document.getElementById(id);
const round1=n=>Math.round((Number(n)||0)*10)/10;
const fmtDate=d=>new Date(d).toLocaleDateString('ar-EG',{weekday:'short',day:'2-digit',month:'2-digit'});
const todayISO=()=>new Date().toISOString().slice(0,10);
const addDays=(iso,d)=>{const t=new Date(iso);t.setDate(t.getDate()+d);return t.toISOString().slice(0,10);};
const toast=m=>{const t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(t._t);t._t=setTimeout(()=>t.style.display='none',1600);};

let childId,currentUser,childDoc,childRef,measCol;
let showNotes=true;

const fromInp=$('fromDate'),toInp=$('toDate');
const chkShowNotes=$('chkShowNotes');
const reportTable=$('reportTable'),tblHead=$('tblHead'),tblBody=$('tblBody'),reportRoot=$('reportRoot');

const childNameEl=$('childName'),childMetaEl=$('childMeta');
const stTIR=$('stTIR'),stAvg=$('stAvg'),stSD=$('stSD'),stCV=$('stCV'),stLow=$('stLow'),stHigh=$('stHigh'),stCrit=$('stCrit'),spark=$('spark');

/* AI panel */
const aiPanel=$('aiPanel'), aiList=$('aiList');

/* Quick map */
const SLOT_LABEL={ WAKE:'الاستيقاظ', FASTING:'صائم',
  PRE_BREAKFAST:'ق.الفطار', POST_BREAKFAST:'ب.الفطار',
  PRE_LUNCH:'ق.الغداء',     POST_LUNCH:'ب.الغداء',
  PRE_DINNER:'ق.العشاء',    POST_DINNER:'ب.العشاء',
  SNACK:'سناك', BEDTIME:'قبل النوم', DURING_SLEEP:'أثناء النوم', EXERCISE:'رياضة', OTHER:'أخرى' };
const SLOT_ALIAS={
  WAKE:['WAKE','UPON_WAKE','UPONWAKE'],
  FASTING:['FASTING'],
  PRE_BREAKFAST:['PRE_BREAKFAST'], POST_BREAKFAST:['POST_BREAKFAST'],
  PRE_LUNCH:['PRE_LUNCH'], POST_LUNCH:['POST_LUNCH'],
  PRE_DINNER:['PRE_DINNER'], POST_DINNER:['POST_DINNER'],
  SNACK:['SNACK'], BEDTIME:['BEDTIME','PRE_SLEEP','BEFORE_SLEEP','BEFORESLEEP','PRE-SLEEP'],
  DURING_SLEEP:['DURING_SLEEP','NIGHT'], EXERCISE:['EXERCISE'], OTHER:['OTHER']
};
const COLS=['WAKE','FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP'];

function normalizeSlot(k){
  if(!k) return 'OTHER';
  const t=String(k).trim().toUpperCase();
  for(const key of Object.keys(SLOT_ALIAS)){
    if(SLOT_ALIAS[key].includes(t)) return key;
  }
  return t in SLOT_LABEL ? t : 'OTHER';
}
function normalizeState(s){
  if(!s) return s; const t=String(s).trim().toLowerCase();
  if(t==='normal'||s==='داخل النطاق'||s==='طبيعي') return 'داخل النطاق';
  if(t==='low'||s==='هبوط') return 'هبوط';
  if(t==='high'||s==='ارتفاع') return 'ارتفاع';
  if(t==='severe high'||s==='ارتفاع شديد') return 'ارتفاع شديد';
  if(t==='critical low'||s==='هبوط حرج') return 'هبوط حرج';
  if(t==='critical high'||s==='ارتفاع حرج') return 'ارتفاع حرج';
  return s;
}
const severityRank = st => ({'داخل النطاق':0,'هبوط':1,'ارتفاع':1,'ارتفاع شديد':2,'هبوط حرج':3,'ارتفاع حرج':3}[normalizeState(st)]??0);
const stateClass = st => ({'داخل النطاق':'ok','هبوط':'low','ارتفاع':'high','ارتفاع شديد':'sev','هبوط حرج':'crit','ارتفاع حرج':'crit'}[normalizeState(st)]||'');
const cellBgClass = st => {
  const n=normalizeState(st);
  if(n==='داخل النطاق') return '';
  if(n==='هبوط')        return 'td-low';
  if(n==='ارتفاع')      return 'td-high';
  if(n==='ارتفاع شديد') return 'td-sev';
  if(n==='هبوط حرج'||n==='ارتفاع حرج') return 'td-crit';
  return '';
};

/* ---------- Boot ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  currentUser=user;

  const p=new URLSearchParams(location.search);
  childId=(p.get('child')||'').trim();
  if(!childId){ toast('لا يوجد child في الرابط'); return; }

  // فترة افتراضية أو من الرابط
  const urlFrom=p.get('from'), urlTo=p.get('to');
  const to=todayISO(), from=addDays(to,-6);
  fromInp.value = urlFrom || from;
  toInp.value   = urlTo   || to;

  chkShowNotes.checked=showNotes = JSON.parse(localStorage.getItem('rep_showNotes')||'true');

  await loadChild();
  wire();
  refresh();
});

async function loadChild(){
  childRef = doc(db,'parents',auth.currentUser.uid,'children',childId);
  const s = await getDoc(childRef);
  if(!s.exists()){ toast('الطفل غير موجود'); return; }
  childDoc = s.data()||{};
  measCol  = collection(childRef,'measurements');

  const unit = childDoc.glucoseUnit || 'mg/dL';
  $('childName').textContent = childDoc.displayName||childDoc.name||'الطفل';
  $('childMeta').textContent  = `الوحدة: ${unit} • CR: ${childDoc.carbRatio??'—'} g/U • CF: ${childDoc.correctionFactor??'—'} ${unit}/U`;

  $('childChips').innerHTML = `
    <span class="chip">وحدة: ${unit}</span>
    <span class="chip">CR: ${childDoc.carbRatio??'—'} g/U</span>
    <span class="chip">CF: ${childDoc.correctionFactor??'—'} ${unit}/U</span>
    <span class="chip">Bolus: ${childDoc.bolusType||childDoc.bolus||'—'}</span>`;
}

/* ---------- Fetch (when + date) ---------- */
function toStart(fromISO){ return new Date(fromISO+'T00:00:00'); }
function toEnd(toISO){   return new Date(toISO+'T23:59:59'); }

async function fetchRange(fromISO,toISO){
  const unit = childDoc.glucoseUnit||'mg/dL';
  const seen = new Set();
  const rows = [];

  // 1) by when (Timestamp)
  try{
    const qWhen = query(
      measCol,
      where('when','>=',toStart(fromISO)),
      where('when','<=',toEnd(toISO)),
      orderBy('when','asc')
    );
    const sWhen = await getDocs(qWhen);
    sWhen.forEach(d=>{
      if(seen.has(d.id)) return; seen.add(d.id);
      const x=d.data();
      const dateStr = x.date || (x.when?.toDate? x.when.toDate().toISOString().slice(0,10) : null);
      let when = x.when?.toDate ? x.when.toDate() : (x.when ? new Date(x.when) : null);
      if (!when && dateStr) when = new Date(`${dateStr}T12:00:00`);
      const slot = normalizeSlot(x.slotKey);
      const state= normalizeState(x.state);
      const val = unit.includes('mmol')
        ? (Number(x.value_mmol) ?? (x.unit==='mg/dL'? Number(x.value)/18 : Number(x.value)))
        : (Number(x.value_mgdl) ?? (x.unit==='mmol/L'? Number(x.value)*18 : Number(x.value)));
      rows.push({ id:d.id, date:dateStr, when, slotOrder: x.slotOrder ?? 99, slot, state, value: Number(val)||0,
                  corr: Number(x.correctionDose)||0, notes: x.notes||'', hypo: x.hypoTreatment||'' });
    });
  }catch(e){ /* قد يحتاج لفهرس مركب — نتجاوز ونكمل */ }

  // 2) by date (String)
  try{
    const qDate = query(
      measCol,
      where('date','>=',fromISO),
      where('date','<=',toISO),
      orderBy('date','asc'),
      orderBy('slotOrder','asc')
    );
    const sDate = await getDocs(qDate);
    sDate.forEach(d=>{
      if(seen.has(d.id)) return; seen.add(d.id);
      const x=d.data();
      const dateStr = x.date || (x.when?.toDate? x.when.toDate().toISOString().slice(0,10) : null);
      let when = x.when?.toDate ? x.when.toDate() : (x.when ? new Date(x.when) : null);
      if (!when && dateStr) when = new Date(`${dateStr}T12:00:00`);
      const slot = normalizeSlot(x.slotKey);
      const state= normalizeState(x.state);
      const val = unit.includes('mmol')
        ? (Number(x.value_mmol) ?? (x.unit==='mg/dL'? Number(x.value)/18 : Number(x.value)))
        : (Number(x.value_mgdl) ?? (x.unit==='mmol/L'? Number(x.value)*18 : Number(x.value)));
      rows.push({ id:d.id, date:dateStr, when, slotOrder: x.slotOrder ?? 99, slot, state, value: Number(val)||0,
                  corr: Number(x.correctionDose)||0, notes: x.notes||'', hypo: x.hypoTreatment||'' });
    });
  }catch(e){ /* قد يحتاج لفهرس مركب — نتجاوز ونكمل */ }

  // sort stable by date asc, then slotOrder asc
  rows.sort((a,b)=> (a.date||'').localeCompare(b.date||'') || (a.slotOrder - b.slotOrder));
  return rows;
}

/* ---------- Build table ---------- */
function groupByDate(list){
  const map=new Map();
  for(const r of list){
    const k=r.date || (r.when? r.when.toISOString().slice(0,10):'');
    if(!map.has(k)) map.set(k,[]);
    map.get(k).push(r);
  }
  return map;
}
function markEmptyColumns(show=true){
  const ths=[...tblHead.querySelectorAll('th[data-col]')];
  const tds=[...tblBody.querySelectorAll('td[data-col]')];
  const colHas = Object.fromEntries(COLS.map(c=>[c,false]));
  tds.forEach(td=>{ if(td.textContent.trim()) colHas[td.dataset.col]=true; });
  ths.forEach(th=> th.classList.toggle('muted', !colHas[th.dataset.col]));
}
function buildTable(list){
  // head
  tblHead.innerHTML='<tr><th>التاريخ</th>'+COLS.map(c=>`<th data-col="${c}">${SLOT_LABEL[c]}</th>`).join('')+'</tr>';
  tblBody.innerHTML='';

  const byDate=groupByDate(list);
  [...byDate.keys()].sort().forEach(dkey=>{
    const day=byDate.get(dkey)||[];
    const tr=document.createElement('tr');
    let rowHtml=`<td class="date">${fmtDate(dkey)}</td>`;

    for(const c of COLS){
      const arr = day.filter(r=>r.slot===c);
      if(!arr.length){ rowHtml += `<td data-col="${c}"></td>`; continue; }

      // أسوأ حالة داخل الخلية لتحديد الخلفية
      let worst = arr[0];
      for(const r of arr){ if(severityRank(r.state) > severityRank(worst.state)) worst=r; }
      const tdClass = cellBgClass(worst.state);

      const parts=arr.map(r=>{
        const val = `<span class="c-val ${stateClass(r.state)}">${round1(r.value)}</span>`;
        const corr= r.corr? `<span class="badge">U ${round1(r.corr)}</span>`:'';
        const note= showNotes? `<span class="c-note">${(r.hypo?('رفع: '+r.hypo+' • '):'') + (r.notes||'')}</span>`:'';
        return `${val}${corr}${note}`;
      }).join('<hr class="hr">');

      rowHtml += `<td class="${tdClass}" data-col="${c}">${parts}</td>`;
    }
    tr.innerHTML=rowHtml;
    tblBody.appendChild(tr);
  });

  markEmptyColumns(false);
}

/* ---------- Stats / Spark ---------- */
function computeStats(list){
  if(!list.length) return {avg:0,sd:0,cv:0,tir:0,low:0,high:0,crit:0};
  const n=list.length, mean=list.reduce((a,r)=>a+r.value,0)/n;
  const sd=Math.sqrt(list.reduce((a,r)=>a+(r.value-mean)**2,0)/n);
  const low = list.filter(r=>['هبوط'].includes(normalizeState(r.state))).length;
  const high= list.filter(r=>['ارتفاع','ارتفاع شديد'].includes(normalizeState(r.state))).length;
  const crit= list.filter(r=>['هبوط حرج','ارتفاع حرج'].includes(normalizeState(r.state))).length;
  const inRange = list.filter(r=>normalizeState(r.state)==='داخل النطاق').length;
  const tir = n? Math.round((inRange/n)*100):0;
  return {avg:mean,sd,cv:(mean? sd/mean : 0),tir,low,high,crit};
}
function renderSpark(list){
  spark.innerHTML='';
  if(list.length<2) return;
  const w=260,h=40,p=4;
  const xs=list.map((_,i)=>p+i*(w-2*p)/(list.length-1));
  const vals=list.map(r=>r.value);
  const min=Math.min(...vals), max=Math.max(...vals);
  const ys=vals.map(v=>h-p-((v-min)/(max-min||1))*(h-2*p));
  let d=`M ${xs[0]} ${ys[0]}`; for(let i=1;i<xs.length;i++) d+=` L ${xs[i]} ${ys[i]}`;
  spark.innerHTML=`<svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="#2563eb" stroke-width="2"/></svg>`;
}

/* ---------- AI Insights ---------- */
function bucket(slot){
  if(['WAKE','FASTING','PRE_BREAKFAST','POST_BREAKFAST'].includes(slot)) return 'صباح';
  if(['PRE_LUNCH','POST_LUNCH','SNACK'].includes(slot)) return 'ظهر/عصر';
  if(['PRE_DINNER','POST_DINNER','BEDTIME'].includes(slot)) return 'مساء';
  if(['DURING_SLEEP'].includes(slot)) return 'ليل';
  return 'عام';
}
function buildInsights(list){
  const tips=[];
  if(!list.length) return tips;

  // TIR عام وبحسب الفترات
  const byBkt={}; for(const r of list){ const b=bucket(r.slot); (byBkt[b]??=([])).push(r); }
  const statAll = computeStats(list);
  tips.push(`زمن داخل النطاق (TIR) العام: ${statAll.tir}% — متوسط ${round1(statAll.avg)} (${childDoc.glucoseUnit||'mg/dL'})، SD ${round1(statAll.sd)}.`);

  for(const [b,arr] of Object.entries(byBkt)){
    const st=computeStats(arr);
    tips.push(`TIR ${b}: ${st.tir}% • منخفضات: ${st.low} • ارتفاعات: ${st.high} • حرجة: ${st.crit}.`);
  }

  // ارتفاعات بعد الوجبات
  const postMeals = list.filter(r=>['POST_BREAKFAST','POST_LUNCH','POST_DINNER'].includes(r.slot));
  if(postMeals.length){
    const highPosts = postMeals.filter(r=>['ارتفاع','ارتفاع شديد','ارتفاع حرج'].includes(normalizeState(r.state)));
    if(highPosts.length){
      const rate = Math.round(highPosts.length*100/postMeals.length);
      tips.push(`رُصدت ارتفاعات بعد الوجبات في ~${rate}% من قراءات ما بعد الوجبة. راجع نسبة الكربوهيدرات/التصحيح حول الوجبات.`);
    }
  }

  // هبوط ليلي
  const night = list.filter(r=>r.slot==='DURING_SLEEP');
  const nightLows = night.filter(r=>['هبوط','هبوط حرج'].includes(normalizeState(r.state))).length;
  if(night.length && nightLows>0) tips.push(`ملاحظات ليلية: ${nightLows} هبوط أثناء النوم — يُفضّل مراجعة الوجبة المسائية/الجرعات القاعدية.`);

  // تذبذب (CV)
  if(statAll.cv>0.36) tips.push(`التذبذب مرتفع (CV ${(statAll.cv*100|0)}%). تحسين توزيع الوجبات/الجرعات قد يقلل التغيّر.`);

  return tips;
}
function renderInsights(list){
  if(!aiPanel || !aiList) return;
  const tips = buildInsights(list);
  aiList.innerHTML = tips.length ? tips.map(t=>`<li>${t}</li>`).join('') : `<li class="muted">لا توجد ملاحظات كافية للفترة المختارة.</li>`;
}

/* ---------- Export ---------- */
function listForExport(list){
  const u=childDoc.glucoseUnit||'mg/dL';
  return list.map(x=>[x.date, (SLOT_LABEL[x.slot]||x.slot), `${round1(x.value)} ${u}`, normalizeState(x.state), x.corr||0, x.hypo||'', x.notes||'']);
}

/* ---------- Events / Wire ---------- */
function wire(){
  $('periodFrom').textContent=new Date(fromInp.value).toLocaleDateString('ar-EG');
  $('periodTo').textContent  =new Date(toInp.value).toLocaleDateString('ar-EG');

  $('btnShow')?.addEventListener('click',refresh);
  $('btnBack')?.addEventListener('click',()=> history.back());
  $('btnPrint')?.addEventListener('click',()=> window.print());
  $('btnPrintPage')?.addEventListener('click',()=>{
    const url=new URL('reports-print.html', location.href);
    url.searchParams.set('child', childId);
    url.searchParams.set('from', fromInp.value);
    url.searchParams.set('to',   toInp.value);
    location.href=url.toString();
  });
  $('btnAnalytics')?.addEventListener('click',()=> toast('أنت في صفحة التحليلات بالفعل'));
  chkShowNotes?.addEventListener('change',()=>{ showNotes=chkShowNotes.checked; localStorage.setItem('rep_showNotes', JSON.stringify(showNotes)); refresh(); });

  $('btnBlankWeek')?.addEventListener('click',()=>{ document.getElementById('view-default').classList.add('hidden'); document.getElementById('view-blank-week').classList.remove('hidden'); buildBlankWeek(); });
  $('btnBackToReport')?.addEventListener('click',()=>{ document.getElementById('view-blank-week').classList.add('hidden'); document.getElementById('view-default').classList.remove('hidden'); });
  $('btnExportPDF')?.addEventListener('click',async ()=>{
    const opt={
      margin:[10,10,10,10],
      filename:`report-${(childDoc.displayName||childDoc.name||'child')}-${fromInp.value}_to_${toInp.value}.pdf`,
      image:{type:'jpeg',quality:0.98},
      html2canvas:{scale:2,useCORS:true},
      jsPDF:{unit:'mm',format:'a4',orientation:'landscape'},
      pagebreak:{mode:['css','legacy']}
    };
    html2pdf().set(opt).from(reportRoot).save();
  });
  $('btnExportCSV')?.addEventListener('click',async ()=>{
    const L=await fetchRange(fromInp.value,toInp.value);
    const rows=[['التاريخ','النوع','القيمة','الحالة','جرعة التصحيح (U)','رفع الهبوط','ملاحظات'],...listForExport(L)];
    const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=`measurements-${fromInp.value}_to_${toInp.value}.csv`; a.click(); URL.revokeObjectURL(a.href);
  });
  $('btnExportXLSX')?.addEventListener('click',async ()=>{
    const L=await fetchRange(fromInp.value,toInp.value);
    const rows=[['التاريخ','النوع','القيمة','الحالة','جرعة التصحيح (U)','رفع الهبوط','ملاحظات'],...listForExport(L)];
    if(!window.XLSX){ await new Promise((res,rej)=>{const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s);}); }
    const ws = window.XLSX.utils.aoa_to_sheet(rows); ws['!cols']=[{wch:14},{wch:16},{wch:16},{wch:12},{wch:16},{wch:20},{wch:40}];
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb,ws,'Report');
    window.XLSX.writeFile(wb,`report-${fromInp.value}_to_${toInp.value}.xlsx`);
  });

  // فترة سريعة
  $('q7')?.addEventListener('click',()=>{ const to=todayISO(); const from=addDays(to,-6); fromInp.value=from; toInp.value=to; refresh(); });
  $('q14')?.addEventListener('click',()=>{ const to=todayISO(); const from=addDays(to,-13); fromInp.value=from; toInp.value=to; refresh(); });
  $('q30')?.addEventListener('click',()=>{ const to=todayISO(); const from=addDays(to,-29); fromInp.value=from; toInp.value=to; refresh(); });
}

/* ---------- Refresh ---------- */
async function refresh(){
  $('periodFrom').textContent=new Date(fromInp.value).toLocaleDateString('ar-EG');
  $('periodTo').textContent  =new Date(toInp.value).toLocaleDateString('ar-EG');

  const list=await fetchRange(fromInp.value,toInp.value);
  buildTable(list);

  const stats=computeStats(list);
  stTIR.textContent=stats.tir+'%';
  stAvg.textContent=round1(stats.avg);
  stSD.textContent=round1(stats.sd);
  stCV.textContent=(stats.cv*100|0)+'%';
  stLow.textContent=String(stats.low);
  stHigh.textContent=String(stats.high);
  stCrit.textContent=String(stats.crit);
  renderSpark(list);

  // AI panel
  renderInsights(list);

  // blank 7 days UI refresh
  $('bkChildName')&&(bkChildName.textContent=childDoc.displayName||childDoc.name||'الطفل');
  $('bkUnit')&&(bkUnit.textContent=childDoc.glucoseUnit||'mg/dL');
  $('bkCR')&&(bkCR.textContent=(childDoc.carbRatio!=null)?`${childDoc.carbRatio} g/U`:'—');
  $('bkCF')&&(bkCF.textContent=(childDoc.correctionFactor!=null)?`${childDoc.correctionFactor} ${(childDoc.glucoseUnit||'mg/dL')}/U`:'—');
}

/* ---------- Quick blank 7 days ---------- */
const bkChildName=$('bkChildName'),bkUnit=$('bkUnit'),bkCR=$('bkCR'),bkCF=$('bkCF'),bkFrom=$('bkFrom'),bkTo=$('bkTo'),bkGrid=$('bkGrid'),bkNotesGrid=$('bkNotesGrid');
function cell(cls,html){ const d=document.createElement('div'); if(cls)d.className=cls; d.innerHTML=html||''; return d; }
function buildBlankWeek(){
  const from=fromInp.value, to=toInp.value;
  bkFrom.textContent=new Date(from).toLocaleDateString('ar-EG'); bkTo.textContent=new Date(to).toLocaleDateString('ar-EG');
  const unit=childDoc.glucoseUnit||'mg/dL';
  bkChildName.textContent=childDoc.displayName||childDoc.name||'الطفل';
  bkUnit.textContent=unit; bkCR.textContent=(childDoc.carbRatio!=null)?`${childDoc.carbRatio} g/U`:'—'; bkCF.textContent=(childDoc.correctionFactor!=null)?`${childDoc.correctionFactor} ${unit}/U`:'—';

  const d0=new Date(from), days=[]; for(let i=0;i<7;i++){ const d=new Date(d0); d.setDate(d0.getDate()+i); days.push(d); }
  const rows=['الاستيقاظ','ق.الفطار','ب.الفطار','ق.الغداء','ب.الغداء','ق.العشاء','ب.العشاء','سناك','قبل النوم','أثناء النوم'];

  bkGrid.innerHTML=''; bkGrid.appendChild(cell('head row-label','الوقت \\ اليوم')); days.forEach(d=>bkGrid.appendChild(cell('head',fmtDate(d))));
  rows.forEach(r=>{ bkGrid.appendChild(cell('row-label',r)); days.forEach(()=>bkGrid.appendChild(cell('', ''))); });

  bkNotesGrid.innerHTML=''; bkNotesGrid.appendChild(cell('row-label','ملاحظات')); days.forEach(d=>bkNotesGrid.appendChild(cell('head',fmtDate(d))));
  for(let i=0;i<2;i++){ bkNotesGrid.appendChild(cell('row-label', i===0?'الوجبات/الكارب':'الملاحظات/الجرعات')); days.forEach(()=>bkNotesGrid.appendChild(cell('', ''))); }
}
