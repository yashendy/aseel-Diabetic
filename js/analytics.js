// js/analytics.js (Module)

// Firebase (v12 modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// date-fns (ESM)
import {
  addDays, parseISO, isAfter, isBefore, format, subDays, startOfDay, endOfDay
} from "https://cdn.jsdelivr.net/npm/date-fns@3.6.0/+esm";

// --------- عناصر ---------
const params = new URLSearchParams(location.search);
const childId = params.get('child');
const rangeParam = params.get('range'); // مثل 14d

const backBtn = document.getElementById('backBtn');
const childNameEl = document.getElementById('childName');
const childMetaEl = document.getElementById('childMeta');

const dateFromEl = document.getElementById('dateFrom');
const dateToEl   = document.getElementById('dateTo');
const unitSel    = document.getElementById('unitSel');
const applyBtn   = document.getElementById('applyBtn');

const countEl = document.getElementById('kCnt');
const avgEl   = document.getElementById('kAvg');
const sdEl    = document.getElementById('kSd');
const tirEl   = document.getElementById('kTir');
const highEl  = document.getElementById('kHigh');
const lowEl   = document.getElementById('kLow');

const btnCsv  = document.getElementById('btnCsv');
const btnPdf  = document.getElementById('btnPdf');
const aiBtn   = document.getElementById('aiBtn');

const mainCanvas = document.getElementById('mainChart');
const cmpCanvas  = document.getElementById('cmpChart');

let currentUser, childData;
let allMeas = [];  // جميع القياسات (داخل الفترة)
let slotFilter = 'ALL';

// --------- إعدادات Firebase (كما تستخدمينها في المشروع) ---------
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// --------- أدوات ---------
const pad2 = n => String(n).padStart(2,'0');
const toYMD = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

function clamp(x, a, b){ return Math.min(Math.max(x,a),b); }

function mgdlToMmol(x){ return x/18; }
function mmolToMgdl(x){ return x*18; }

function convVal(v, unit){
  if (unit === 'mmol') return v;        // مخزن بالـ mmol/L
  return Math.round(v*18);              // إلى mg/dL
}

function readSlotKey(slot){
  // خريطة قياساتك القديمة/الجديدة
  const map = {
    "PRE_BREAKFAST":"ق.الفطار",
    "POST_BREAKFAST":"ب.الفطار",
    "PRE_LUNCH":"ق.الغدا",
    "POST_LUNCH":"ب.الغدا",
    "PRE_DINNER":"ق.العشا",
    "POST_DINNER":"ب.العشا",
    "SNACK":"سناك",
    "SLEEP":"النوم"
  };
  return map[slot] || slot || "-";
}

// --------- تحميل الطفل والفترة الافتراضية ---------
(function initUI(){
  const today = new Date();

  if (rangeParam && rangeParam.endsWith('d')){
    const n = Number(rangeParam.replace('d','')) || 14;
    dateFromEl.value = toYMD(addDays(today, -n+1));
    dateToEl.value   = toYMD(today);
  }else{
    dateFromEl.value = toYMD(addDays(today, -13));
    dateToEl.value   = toYMD(today);
  }
  unitSel.value = 'mmol';

  document.querySelectorAll('.chip.range').forEach(b=>{
    b.addEventListener('click', ()=>{
      const n = Number(b.dataset.r||'14');
      const t = new Date();
      dateFromEl.value = toYMD(addDays(t, -n+1));
      dateToEl.value   = toYMD(t);
      loadAndRender();
    });
  });

  document.querySelectorAll('.chip.slot').forEach(b=>{
    b.addEventListener('click', ()=>{
      slotFilter = b.dataset.slot || 'ALL';
      renderAll();
    });
  });

  backBtn.addEventListener('click', ()=> history.back());
  applyBtn.addEventListener('click', loadAndRender);

  btnCsv.addEventListener('click', exportCsv);
  btnPdf.addEventListener('click', ()=> window.print());

  aiBtn.addEventListener('click', openAIHelper);
})();

// --------- جلسة ---------
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href='index.html';
  if(!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;
  await loadChild();
  await loadAndRender();
});

// --------- تحميل الطفل ---------
async function loadChild(){
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    alert('لم يتم العثور على الطفل'); history.back(); return;
  }
  childData = snap.data();
  const ageY = (()=> {
    const bd = childData.birthDate ? new Date(childData.birthDate) : null;
    if(!bd) return '—';
    const t = new Date();
    let a = t.getFullYear()-bd.getFullYear();
    const m = t.getMonth()-bd.getMonth();
    if (m<0 || (m===0 && t.getDate()<bd.getDate())) a--;
    return a;
  })();

  childNameEl.textContent = childData.name || 'طفل';
  childMetaEl.textContent = `النطاق: ${childData?.normalRange?.min ?? 4.5}–${childData?.normalRange?.max ?? 11} mmol/L • CR: ${childData?.carbRatio ?? '—'} g/U • CF: ${childData?.correctionFactor ?? '—'} mmol/L/U`;
}

// --------- تحميل القياسات للفترة ---------
async function loadAndRender(){
  const from = parseISO(dateFromEl.value);
  const to   = parseISO(dateToEl.value);
  if (!from || !to || isAfter(from, to)){ alert('اختر فترة صحيحة'); return; }

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  // مخزن عندك date = "YYYY-MM-DD"
  const qy = query(ref, where('date','>=', toYMD(from)), where('date','<=', toYMD(to)), orderBy('date','asc'));
  const snap = await getDocs(qy);

  allMeas = [];
  snap.forEach(d=>{
    const m = d.data();
    // دعم حقول مختلفة (value_mmol أو value_mgdl)
    const mmol = (m.value_mmol != null) ? Number(m.value_mmol)
                 : (m.value_mgdl != null) ? Number(m.value_mgdl)/18
                 : (m.input?.unit === 'mg/dL') ? Number(m.input?.value || 0)/18
                 : Number(m.input?.value || 0);

    // when: Timestamp أو ISO أو millis
    let when = new Date();
    if (m.when?.toDate) when = m.when.toDate();
    else if (typeof m.when === 'string') when = new Date(m.when);
    else if (typeof m.when === 'number') when = new Date(m.when);

    allMeas.push({
      id: d.id,
      mmol,
      mgdl: mmol*18,
      date: m.date || toYMD(when),
      when,
      slotKey: m.slotKey || slotFromArabic(m.slot) || 'UNSPEC',
      state: m.state || 'normal'
    });
  });

  renderAll();
}

function slotFromArabic(s){
  const map = {
    "ق.الفطار":"PRE_BREAKFAST","ب.الفطار":"POST_BREAKFAST",
    "ق.الغدا":"PRE_LUNCH","ب.الغدا":"POST_LUNCH",
    "ق.العشا":"PRE_DINNER","ب.العشا":"POST_DINNER",
    "سناك":"SNACK","النوم":"SLEEP"
  };
  return map[s] || null;
}

// --------- حسابات وعرض ---------
let mainChart, cmpChart;

function renderAll(){
  const unit = unitSel.value; // mmol | mgdl
  const min = Number(childData?.normalRange?.min ?? 4.5);
  const max = Number(childData?.normalRange?.max ?? 11);

  // فلترة حسب الـ slot إن لزم
  const dataF = (slotFilter==='ALL') ? allMeas : allMeas.filter(m=> m.slotKey===slotFilter);

  // تحضير بيانات الرسم الرئيسي
  const points = dataF
    .slice()
    .sort((a,b)=> a.when - b.when)
    .map(m=>({ x: m.when, y: unit==='mmol' ? m.mmol : Math.round(m.mgdl) }));

  // مؤشرات
  const arr = points.map(p=> p.y);
  const n = arr.length;

  const avg = n? arr.reduce((a,b)=>a+b,0)/n : 0;
  const sd  = n? Math.sqrt(arr.reduce((s,v)=> s + Math.pow(v-avg,2),0)/n) : 0;

  // داخل/خارج النطاق (حسب الوحدة المختارة)
  const rMin = unit==='mmol' ? min : Math.round(min*18);
  const rMax = unit==='mmol' ? max : Math.round(max*18);
  let inRange=0, hi=0, lo=0;
  arr.forEach(v=>{
    if (v<rMin) lo++;
    else if (v>rMax) hi++;
    else inRange++;
  });

  countEl.textContent = n;
  avgEl.textContent   = n? (unit==='mmol'? avg.toFixed(1) : Math.round(avg)) : '—';
  sdEl.textContent    = n? (unit==='mmol'? sd.toFixed(1) : Math.round(sd)) : '—';
  tirEl.textContent   = n? Math.round(inRange*100/n)+'%' : '—';
  highEl.textContent  = n? Math.round(hi*100/n)+'%' : '—';
  lowEl.textContent   = n? Math.round(lo*100/n)+'%' : '—';

  // رسم رئيسي: نقاط + حدود النطاق
  drawMain(points, rMin, rMax);

  // مقارنة أسبوع بأسبوع سابق (يونِت نفس المختارة)
  drawWeekCompare(unit);
}

function drawMain(points, rMin, rMax){
  if (mainChart) mainChart.destroy();

  mainChart = new Chart(mainCanvas.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'القراءات',
          data: points,
          borderWidth: 2,
          pointRadius: 2,
          tension: .2
        },
        {
          label: 'حد أدنى للنطاق',
          data: points.map(p=>({x:p.x,y:rMin})),
          borderDash: [6,6], borderWidth:1, pointRadius:0
        },
        {
          label: 'حد أعلى للنطاق',
          data: points.map(p=>({x:p.x,y:rMax})),
          borderDash: [6,6], borderWidth:1, pointRadius:0
        }
      ]
    },
    options: {
      responsive: true,
      parsing: false,
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'yyyy-MM-dd HH:mm' }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'nearest', intersect: false }
      }
    }
  });
}

function drawWeekCompare(unit){
  if (cmpChart) cmpChart.destroy();

  const today = endOfDay(new Date());
  const last7_from = startOfDay(subDays(today,6));
  const last7_to   = today;
  const prev7_from = startOfDay(subDays(today,13));
  const prev7_to   = endOfDay(subDays(today,7));

  const last7 = allMeas.filter(m => !isBefore(m.when,last7_from) && !isAfter(m.when,last7_to));
  const prev7 = allMeas.filter(m => !isBefore(m.when,prev7_from) && !isAfter(m.when,prev7_to));

  const getAvg = a=>{
    if(!a.length) return 0;
    const arr = a.map(m=> unit==='mmol'? m.mmol : Math.round(m.mgdl));
    return arr.reduce((s,v)=>s+v,0)/arr.length;
  };
  const getHi = a=>{
    if(!a.length) return 0;
    const min = unit==='mmol' ? (childData?.normalRange?.min ?? 4.5) : Math.round((childData?.normalRange?.min ?? 4.5)*18);
    const max = unit==='mmol' ? (childData?.normalRange?.max ?? 11)  : Math.round((childData?.normalRange?.max ?? 11)*18);
    const arr = a.map(m=> unit==='mmol'? m.mmol : Math.round(m.mgdl));
    const hi = arr.filter(v=> v>max).length;
    return Math.round(hi*100/arr.length);
  };
  const getLo = a=>{
    if(!a.length) return 0;
    const min = unit==='mmol' ? (childData?.normalRange?.min ?? 4.5) : Math.round((childData?.normalRange?.min ?? 4.5)*18);
    const arr = a.map(m=> unit==='mmol'? m.mmol : Math.round(m.mgdl));
    const lo = arr.filter(v=> v<min).length;
    return Math.round(lo*100/arr.length);
  };

  const data = {
    labels: ['متوسط','ارتفاعات %','هبوطات %'],
    datasets: [
      {
        label: 'الأسبوع الحالي',
        data: [getAvg(last7), getHi(last7), getLo(last7)],
        borderWidth:2
      },
      {
        label: 'الأسبوع السابق',
        data: [getAvg(prev7), getHi(prev7), getLo(prev7)],
        borderWidth:2
      },
    ]
  };

  cmpChart = new Chart(cmpCanvas.getContext('2d'), {
    type: 'bar',
    data,
    options:{
      responsive: true,
      scales:{ y:{ beginAtZero:true } }
    }
  });
}

// --------- CSV ---------
function exportCsv(){
  if (!allMeas.length){ alert('لا توجد بيانات'); return; }
  const unit = unitSel.value;
  const rows = [
    ['datetime','slot','value('+ (unit==='mmol'?'mmol/L':'mg/dL') +')']
  ];
  allMeas.forEach(m=>{
    rows.push([
      format(m.when,'yyyy-MM-dd HH:mm'),
      readSlotKey(m.slotKey),
      unit==='mmol' ? m.mmol.toFixed(1) : Math.round(m.mgdl)
    ]);
  });
  const csv = rows.map(r=> r.join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'analytics.csv';
  a.click();
}

// --------- مساعد الذكاء (Gemini) بسيط جداً ---------
async function openAIHelper() {
  const key = 'AIzaSyBJOzP2znhOTBeVDdLn7XwMs_KtYn_tMV4'; // المفتاح الخاص بك تم وضعه هنا مباشرة.

  // جمع الإحصائيات من العناصر
  const unit = unitSel.value;
  const n = allMeas.length;
  const avg = avgEl.textContent;
  const tir = tirEl.textContent;
  const hi = highEl.textContent;
  const lo = lowEl.textContent;

  // صياغة الـ prompt
  const promptText = `
    حلّل هذه الإحصائيات لطفل سكري من النوع الأول:
    - عدد القياسات: ${n}
    - الوحدة: ${unit}
    - المتوسط: ${avg}
    - وقت داخل النطاق (TIR): ${tir}
    - ارتفاعات: ${hi}
    - هبوطات: ${lo}
    قدّم نصائح عامة غير طبية لتحسين التحكم، ودائمًا اطلب مراجعة الطبيب لتعديل العلاج. لغة عربية بسيطة.
  `;

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
      }
    );

    // التحقق من استجابة ناجحة
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(`خطأ في استدعاء API: ${res.status} - ${errorData.error.message}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || 'تعذر الحصول على رد.';
    alert(text);
  } catch (e) {
    console.error('فشل الاتصال بالمساعد:', e);
    alert('تعذر الاتصال بالمساعد. تأكد من أن مفتاح API صحيح أو حاول مرة أخرى لاحقاً.');
  }
}
