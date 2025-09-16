// reports.js — صفحة التقارير النهائية
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

function normalizeSlot(k){ if(!k) return 'OTHER'; const t=String(k).toUpperCase(); for(const key in SLOT_ALIAS){ if(SLOT_ALIAS[key].includes(t)) return key; } return t in SLOT_LABEL ? t : 'OTHER'; }
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
const stateClass=st=>{
  st=normalizeState(st); if(st==='هبوط حرج'||st==='ارتفاع حرج')return's-crit';
  if(st==='ارتفاع شديد')return's-sevhigh'; if(st==='ارتفاع')return's-high';
  if(st==='هبوط')return's-low'; return's-ok';
};

/* شدة الحالة لتلوين الخلية */
const severityRank = (st)=>{
  st = normalizeState(st);
  switch(st){
    case 'داخل النطاق': return 0;
    case 'هبوط': case 'ارتفاع': return 2;
    case 'ارتفاع شديد': return 3;
    case 'هبوط حرج': case 'ارتفاع حرج': return 4;
    default: return 1;
  }
};
const cellBgClass = (st)=>{
  st = normalizeState(st);
  if(st==='داخل النطاق') return 'td-ok';
  if(st==='هبوط')        return 'td-low';
  if(st==='ارتفاع')      return 'td-high';
  if(st==='ارتفاع شديد') return 'td-sev';
  if(st==='هبوط حرج'||st==='ارتفاع حرج') return 'td-crit';
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

/* ---------- Fetch (date + slotOrder) ---------- */
async function fetchRange(fromISO,toISO){
  // فهرس مركّب: date asc, slotOrder asc
  const qy = query(measCol,
    where('date','>=',fromISO),
    where('date','<=',toISO),
    orderBy('date','asc'),
    orderBy('slotOrder','asc')
  );
  const snap = await getDocs(qy);
  const unit = childDoc.glucoseUnit||'mg/dL';

  const rows=[];
  snap.forEach(d=>{
    const x=d.data();
    const slot = normalizeSlot(x.slotKey);
    const state= normalizeState(x.state);
    const val = unit.includes('mmol') ? (Number(x.value_mmol) ?? (x.unit==='mg/dL'? Number(x.value)/18 : Number(x.value)))
                                      : (Number(x.value_mgdl) ?? (x.unit==='mmol/L'? Number(x.value)*18 : Number(x.value)));

    // إصلاح when لو لا يطابق date (يدعم بيانات قديمة)
    const dateStr = x.date || (x.when?.toDate? x.when.toDate().toISOString().slice(0,10) : null);
    let when = x.when?.toDate ? x.when.toDate() : (x.when ? new Date(x.when) : null);
    if (!when || (dateStr && when.toISOString().slice(0,10)!==dateStr))
      when = new Date(`${dateStr}T12:00:00`);

    rows.push({
      id:d.id, date:dateStr, when,
      slotOrder: x.slotOrder ?? 99,
      slot, state, value: Number(val)||0,
      corr: Number(x.correctionDose)||0,
      notes: x.notes||'', hypo: x.hypoTreatment||''
    });
  });
  return rows;
}

/* ---------- Table (with colored cells) ---------- */
function buildTable(list){
  tblHead.innerHTML=''; tblBody.innerHTML='';
  const trh=document.createElement('tr');
  trh.innerHTML=`<th style="width:130px">التاريخ</th>`+COLS.map(c=>`<th data-col="${c}">${SLOT_LABEL[c]||c}</th>`).join('');
  tblHead.appendChild(trh);

  const byDate=list.reduce((m,x)=>((m[x.date]=m[x.date]||[]).push(x),m),{});
  Object.keys(byDate).sort().forEach(d=>{
    const tr=document.createElement('tr');

    // عمود التاريخ
    let rowHtml = `<td class="mono">${fmtDate(d)}<div class="muted">${d}</div></td>`;

    // بقية الأعمدة
    for(const c of COLS){
      const arr=(byDate[d]||[]).filter(r=>r.slot===c);
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
  const tir = list.filter(r=>normalizeState(r.state)==='داخل النطاق').length/n*100;
  const cv  = mean>0 ? sd/mean*100 : 0;
  return {avg:mean,sd,cv,tir,low,high,crit};
}
function renderStats(list){
  $('periodFrom').textContent=new Date(fromInp.value).toLocaleDateString('ar-EG');
  $('periodTo').textContent  =new Date(toInp.value).toLocaleDateString('ar-EG');

  const u=childDoc.glucoseUnit||'mg/dL';
  const s=computeStats(list);
  $('stTIR').textContent = `${Math.round(s.tir)}%`;
  $('stAvg').textContent = `${round1(s.avg)} ${u}`;
  $('stSD').textContent  = `${round1(s.sd)}`;
  $('stCV').textContent  = `${Math.round(s.cv)}%`;
  $('stLow').textContent = s.low; $('stHigh').textContent=s.high; $('stCrit').textContent=s.crit;

  spark.innerHTML='';
  if(list.length>1){
    const sorted=[...list].sort((a,b)=> a.date===b.date ? (a.slotOrder||0)-(b.slotOrder||0) : (a.date<b.date?-1:1));
    const w=260,h=48,p=4;
    const xs=sorted.map((_,i)=>p+i*(w-2*p)/(sorted.length-1));
    const min=Math.min(...sorted.map(r=>r.value)), max=Math.max(...sorted.map(r=>r.value));
    const ys=sorted.map(r=>h-p-((r.value-min)/(max-min||1))*(h-2*p));
    let d=`M ${xs[0]} ${ys[0]}`; for(let i=1;i<xs.length;i++) d+=` L ${xs[i]} ${ys[i]}`;
    spark.innerHTML=`<svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="#4f46e5" stroke-width="2"/></svg>`;
  }
}

/* ---------- Print helpers (إصلاح قوي) ---------- */
function markEmptyColumns(forPrint) {
  const headRow = tblHead ? tblHead.querySelector('tr') : null;
  const bodyRows = tblBody ? Array.from(tblBody.querySelectorAll('tr')) : [];
  if (!headRow) return;

  const cols = headRow.children.length;
  const allRows = [headRow, ...bodyRows];

  for (let c = 1; c < cols; c++) {
    let empty = true;
    for (let r = 1; r < allRows.length; r++) {
      const row = allRows[r];
      const el = row && row.children ? row.children[c] : null;
      if (el && el.textContent && el.textContent.trim() !== '') {
        empty = false; break;
      }
    }
    for (const row of allRows) {
      const el = row && row.children ? row.children[c] : null;
      if (!el) continue;
      if (empty && forPrint) el.classList.add('col-empty');
      else el.classList.remove('col-empty');
    }
  }
}
window.addEventListener('beforeprint',()=>{ markEmptyColumns(true); document.documentElement.style.setProperty('--print-zoom', String($('printZoom').value||1)); });
window.addEventListener('afterprint', ()=>{ document.querySelectorAll('.col-empty').forEach(e=>e.classList.remove('col-empty')); });

/* ---------- Export ---------- */
$('btnExportPDF')?.addEventListener('click',()=>{
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
function listForExport(list){
  const u=childDoc.glucoseUnit||'mg/dL';
  return list.map(x=>[x.date, (SLOT_LABEL[x.slot]||x.slot), `${round1(x.value)} ${u}`, normalizeState(x.state), x.corr||0, x.hypo||'', x.notes||'']);
}
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
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb,ws,'التقرير'); window.XLSX.writeFile(wb,`report-${fromInp.value}_to_${toInp.value}.xlsx`);
});

/* ---------- Refresh / Events ---------- */
async function refresh(){
  const from=fromInp.value||todayISO(), to=toInp.value||todayISO();
  const list=await fetchRange(from,to);
  buildTable(list);
  renderStats(list);
}
function wire(){
  $('btnShow')?.addEventListener('click',()=>document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'))||$('view-report').classList.remove('hidden'));
  $('btnBack')?.addEventListener('click',()=>history.back());
  $('btnPrint')?.addEventListener('click',()=>window.print());
  $('btnPrintPage')?.addEventListener('click',()=>{ document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); $('view-report').classList.remove('hidden'); window.print(); });

  $('btnAnalytics')?.addEventListener('click',()=>{
    const url = new URL(location.origin + location.pathname.replace('reports.html','analytics.html'));
    url.searchParams.set('child', childId);
    url.searchParams.set('from', fromInp.value);
    url.searchParams.set('to', toInp.value);
    location.href = url.toString();
  });

  $('btnBlankWeek')?.addEventListener('click',()=>{ document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); $('view-blank-week').classList.remove('hidden'); buildBlankWeek(); });

  chkShowNotes?.addEventListener('change',()=>{ showNotes=chkShowNotes.checked; localStorage.setItem('rep_showNotes',JSON.stringify(showNotes)); refresh(); });
  $('printZoom')?.addEventListener('input',(e)=>{ document.documentElement.style.setProperty('--print-zoom', String(e.target.value||1)); });

  [fromInp,toInp].forEach(i=>i?.addEventListener('change',refresh));
  document.querySelectorAll('.quick-range .chip').forEach(b=>b.addEventListener('click',()=>{
    const days=Number(b.dataset.days)||7; const to=todayISO(), from=addDays(to, -(days-1));
    fromInp.value=from; toInp.value=to; refresh();
  }));
}

/* ---------- Blank 7 days ---------- */
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

  bkGrid.innerHTML=''; bkGrid.appendChild(cell('head row-label','اليوم/الفترة')); days.forEach(d=>bkGrid.appendChild(cell('head',fmtDate(d))));
  rows.forEach(r=>{ bkGrid.appendChild(cell('row-label',r)); days.forEach(()=>bkGrid.appendChild(cell('', ''))); });

  bkNotesGrid.innerHTML=''; bkNotesGrid.appendChild(cell('row-label','ملاحظات / الوجبات / التصحيحي')); days.forEach(d=>bkNotesGrid.appendChild(cell('head',fmtDate(d))));
  for(let i=0;i<2;i++){ bkNotesGrid.appendChild(cell('row-label',`سطر ${i+1}`)); days.forEach(()=>bkNotesGrid.appendChild(cell('', ''))); }
}
