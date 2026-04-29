// js/reports-print.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const params = new URLSearchParams(location.search);
const childId = params.get('child');
const fromDate = params.get('from');
const toDate = params.get('to');
const isBlank = params.get('blank') === '1'; // خيار السجل الفارغ

const SLOT_KEYS = ['FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP'];
const SLOT_LABELS = ['صائم','ق.الفطار','ب.الفطار','ق.الغداء','ب.الغداء','ق.العشاء','ب.العشاء','سناك','ق.النوم','أثناء النوم'];

// أداة التحويل للذكاء الاصطناعي
const mgdl2mmol=v=>v/18, mmol2mgdl=v=>v*18, round1=n=>Math.round((+n||0)*10)/10;
const FIXED_MMOL={low:3.9,upper:7.1,severe:10.9,critHigh:14.1};
function limitsInUnit(u){return u.includes('mmol')?{...FIXED_MMOL}:{low:round1(mmol2mgdl(3.9)),upper:round1(mmol2mgdl(7.1)),severe:round1(mmol2mgdl(10.9)),critHigh:round1(mmol2mgdl(14.1))}}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const container = document.getElementById('printContainer');
  
  try {
    const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
    const childSnap = await getDoc(childRef);
    const childData = childSnap.data();

    // 1. جلب البيانات
    let data = [];
    if (!isBlank) {
      const q = query(collection(childRef, 'measurements'), where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'asc'));
      const snap = await getDocs(q);
      snap.forEach(d => data.push(d.data()));
    }

    // 2. تقسيم البيانات إلى أسابيع
    const weeks = chunkIntoWeeks(fromDate, toDate);
    
    // 3. توليد صفحات الأسابيع
    weeks.forEach((weekDays, index) => {
      const page = createPageStructure(childData, weekDays[0], weekDays[weekDays.length-1], index + 1, weeks.length);
      const grid = page.querySelector('.grid-body');
      
      weekDays.forEach(date => {
        const dayData = data.filter(d => d.date === date);
        grid.appendChild(createDayRow(date, dayData, childData));
      });
      
      container.appendChild(page);
    });

    // 4. إضافة صفحة الملخص (إذا لم تكن نسخة فارغة)
    if (!isBlank && data.length > 0) {
      container.appendChild(createSummaryPage(childData, data));
    }

    document.getElementById('appLoader').style.display = 'none';
    
    // الانتظار ثانية ليتم رسم الشارت ثم فتح نافذة الطباعة تلقائياً
    setTimeout(() => window.print(), 1000);

  } catch (e) { console.error(e); }
});

function chunkIntoWeeks(start, end) {
  let days = [];
  let curr = new Date(start);
  const last = new Date(end);
  while (curr <= last) {
    days.push(curr.toISOString().slice(0, 10));
    curr.setDate(curr.getDate() + 1);
  }
  let chunks = [];
  for (let i = 0; i < days.length; i += 7) chunks.push(days.slice(i, i + 7));
  return chunks;
}

function createPageStructure(child, start, end, pageNum, totalPages) {
  const div = document.createElement('div');
  div.className = 'print-page';
  div.innerHTML = `
    <header class="header">
      <div class="header-right">
        <h2>منصة أسيل - سجل المتابعة اليومي ${isBlank ? '(نسخة يدوية)' : ''}</h2>
        <div class="muted">الفترة: من ${start} إلى ${end}</div>
      </div>
      <div class="header-left">
        <b>اسم الطفل:</b> ${child.name}<br>
        <b>العمر:</b> ${calcAge(child.birthDate)} سنة | <b>الوحدة:</b> ${child.glucoseUnit || 'mg/dL'}<br>
        <b>المعاملات:</b> CF: ${child.correctionFactor || '—'} | CR: ${child.carbRatio || '—'}
      </div>
    </header>
    <div class="grid-wrap">
      <div class="grid-head">
        <div class="r">التاريخ</div><div class="r">الإجمالي</div>
        ${SLOT_LABELS.map(l => `<div>${l}</div>`).join('')}
      </div>
      <div class="grid-body"></div>
    </div>
    <div class="footer">صفحة ${pageNum} من ${totalPages} — تم الإنشاء بواسطة تطبيق أسيل لمتابعة السكري</div>
  `;
  return div;
}

function createDayRow(date, dayData, child) {
  const row = document.createElement('div');
  row.className = 'grid-row';
  const d = new Date(date);
  const dayName = d.toLocaleDateString('ar-EG', { weekday: 'short' });
  
  let dailyCarbs = 0, dailyIns = 0;
  dayData.forEach(m => { dailyCarbs += (m.carbs || 0); dailyIns += (m.totalInsulin || 0); });

  let html = `<div class="cell"><b>${date}</b><br><small>${dayName}</small></div>`;
  if(!isBlank && (dailyCarbs > 0 || dailyIns > 0)){
    html += `<div class="cell" style="background:#f8fafc"><b>${dailyCarbs}g</b><br><b>${dailyIns}U</b></div>`;
  } else {
    html += `<div class="cell" style="background:#f8fafc"></div>`;
  }

  SLOT_KEYS.forEach(key => {
    const m = dayData.find(d => d.slotKey === key);
    html += `<div class="cell v-cell">
      ${m && !isBlank ? `
        <div class="val">${m.value || '—'}</div>
        ${m.carbs > 0 ? `<span class="c-badge">🍔${m.carbs}g</span>` : ''}
        ${m.totalInsulin > 0 ? `<span class="i-badge">💉${m.totalInsulin}U</span>` : ''}
      ` : ''}
    </div>`;
  });

  row.innerHTML = html;
  return row;
}

function createSummaryPage(child, allData) {
  const div = document.createElement('div');
  div.className = 'print-page';
  div.innerHTML = `
    <header class="header"><h2>الملخص الطبي والتحليلات الذكية</h2></header>
    <div class="summary-page">
      <div class="chart-box"><canvas id="printPieTIR"></canvas></div>
      <div class="ai-box">
        <h3 style="margin-top:0; color:#2563eb;">توصيات الذكاء الاصطناعي 🧠</h3>
        <div id="aiContent"></div>
      </div>
    </div>
    <div class="footer">نهاية التقرير الطبي</div>
  `;
  
  setTimeout(() => {
    renderPrintCharts(allData, child);
    renderAI(allData, child);
  }, 100);
  
  return div;
}

function renderPrintCharts(list, child) {
  const unit = child.glucoseUnit || 'mg/dL';
  const L = limitsInUnit(unit);
  const valid = list.filter(x => x.value != null);
  if(valid.length === 0) return;

  const TIR = valid.filter(x => x.value >= L.low && x.value <= L.severe).length;
  const ctx = document.getElementById('printPieTIR').getContext('2d');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['داخل النطاق', 'خارج النطاق'],
      datasets: [{ data: [TIR, valid.length - TIR], backgroundColor: ['#16a34a', '#ef4444'] }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });
}

function renderAI(list, child) {
  const unit = child.glucoseUnit || 'mg/dL';
  const L = limitsInUnit(unit);
  const patt=[];
  const valid = list.filter(x => x.value !== null && x.value !== undefined);
  
  const fast = valid.filter(x=>x.slotKey==='FASTING' || x.slotKey==='WAKE').map(x=>x.value);
  const sleep = valid.filter(x=>x.slotKey==='DURING_SLEEP' || x.slotKey==='BEDTIME').map(x=>x.value);
  const pBreakfast = valid.filter(x=>x.slotKey==='POST_BREAKFAST').map(x=>x.value);
  const pDinner = valid.filter(x=>x.slotKey==='POST_DINNER').map(x=>x.value);

  if(fast.length >= 3 && sleep.length >= 2) {
    const highFasting = fast.filter(v => v > L.upper).length;
    const normalSleep = sleep.filter(v => v >= L.low && v <= L.severe).length;
    if (highFasting >= 2 && normalSleep >= 2) {
      patt.push({ name: 'ظاهرة الفجر', desc: 'السكر طبيعي ليلاً ويرتفع صباحاً.', rec: 'تعديل المنظم.', conf: 'عالي 🔴' });
    }
  }

  if(fast.length >= 3 && sleep.length >= 2) {
    const highFasting = fast.filter(v => v > L.upper).length;
    const lowSleep = sleep.filter(v => v < L.low).length;
    if (highFasting >= 2 && lowSleep >= 1) {
      patt.push({ name: 'هبوط ليلي (Somogyi)', desc: 'هبوط أثناء الليل يتبعه ارتفاع ارتدادي.', rec: 'تقليل المنظم.', conf: 'حرج 🚨' });
    }
  }

  if(pBreakfast.length >= 3 && pBreakfast.filter(v=>v>L.severe).length >= 2) {
    patt.push({ name: 'ارتفاع بعد الإفطار', desc: 'السكر يرتفع بشدة بعد الإفطار.', rec: 'تعديل معامل الكارب (CR).', conf: 'متوسط 🟡' });
  }

  if(!patt.length) patt.push({name:'✅ استقرار عام', desc:'الأنماط الحيوية للطفل ضمن الحدود الآمنة غالباً.', rec:'استمر على نفس الخطة!', conf:'—'});

  const aiContainer = document.getElementById('aiContent');
  if(aiContainer){
      aiContainer.innerHTML = patt.map(p=>`<div class="ai-item"><b>${p.name}</b>${p.desc} <br> <span style="color:#2563eb">${p.rec}</span></div>`).join('');
  }
}

function calcAge(bd) { if(!bd) return '—'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth() || (t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) a--; return a; }
