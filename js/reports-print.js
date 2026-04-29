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
  html += `<div class="cell" style="background:#f8fafc"><b>${dailyCarbs}g</b><br><b>${dailyIns}U</b></div>`;

  SLOT_KEYS.forEach(key => {
    const m = dayData.find(d => d.slotKey === key);
    html += `<div class="cell v-cell">
      ${m ? `
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
        <h3>توصيات الذكاء الاصطناعي 🧠</h3>
        <div id="aiContent">جاري تحليل الأنماط...</div>
      </div>
    </div>
    <div class="footer">نهاية التقرير الطبي</div>
  `;
  
  // سنقوم بتشغيل رسم الشارت في Turn القادم لضمان وجود العنصر
  setTimeout(() => {
    renderPrintCharts(allData, child);
    // يمكنك هنا استدعاء دالة بناء الـ AI من ملف reports.js ووضعها في aiContent
  }, 100);
  
  return div;
}

function renderPrintCharts(list, child) {
  const valid = list.filter(x => x.value != null);
  const TIR = valid.filter(x => x.value >= 70 && x.value <= 180).length; // مثال mg/dL
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

function calcAge(bd) { if(!bd) return '—'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth() || (t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) a--; return a; }
