// js/reports-print.js
import { auth, db } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const params = new URLSearchParams(location.search);
const childId = params.get('child');
const fromDate = params.get('from');
const toDate = params.get('to');
const isBlank = params.get('blank') === '1';
const urlUnit = params.get('unit'); 

const SLOT_KEYS = ['FASTING','PRE_BREAKFAST','POST_BREAKFAST','PRE_LUNCH','POST_LUNCH','PRE_DINNER','POST_DINNER','SNACK','BEDTIME','DURING_SLEEP'];
const SLOT_LABELS = ['صائم','ق.الفطار','ب.الفطار','ق.الغداء','ب.الغداء','ق.العشاء','ب.العشاء','سناك','ق.النوم','أثناء النوم'];

const mgdl2mmol=v=>v/18.0182, mmol2mgdl=v=>v*18.0182, round1=n=>Math.round((+n||0)*10)/10;

// استيراد النطاقات ديناميكياً
let sysLimits = { critLow: 54, low: 70, high: 180, critHigh: 250 };
let sysUnit = 'mg/dL';

function limitsInUnit(targetUnit){
  if (targetUnit === sysUnit) return { ...sysLimits };
  if (targetUnit === 'mmol/L' && sysUnit === 'mg/dL') {
    return { 
      critLow: round1(mgdl2mmol(sysLimits.critLow)), 
      low: round1(mgdl2mmol(sysLimits.low)), 
      high: round1(mgdl2mmol(sysLimits.high)), 
      critHigh: round1(mgdl2mmol(sysLimits.critHigh)) 
    }; 
  }
  if (targetUnit === 'mg/dL' && sysUnit === 'mmol/L') {
    return { 
      critLow: round1(mmol2mgdl(sysLimits.critLow)), 
      low: round1(mmol2mgdl(sysLimits.low)), 
      high: round1(mmol2mgdl(sysLimits.high)), 
      critHigh: round1(mmol2mgdl(sysLimits.critHigh)) 
    };
  }
  return { ...sysLimits };
}

function classFor(val, u){ 
  if(val == null) return '';
  const L=limitsInUnit(u); 
  if(val >= L.critHigh) return 'crit'; 
  if(val > L.high) return 'mild'; 
  if(val <= L.critLow) return 'sev'; 
  if(val < L.low) return 'sev'; 
  return 'ok'; 
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const container = document.getElementById('printContainer');
  
  try {
    const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
    const childSnap = await getDoc(childRef);
    const childData = childSnap.data();
    
    sysUnit = childData.glucoseUnit || 'mg/dL';
    if(childData.glucose_limits) {
        sysLimits.low = Number(childData.glucose_limits.low) || (sysUnit==='mmol/L'? 3.9 : 70);
        sysLimits.high = Number(childData.glucose_limits.high) || (sysUnit==='mmol/L'? 10.0 : 180);
        sysLimits.critLow = Number(childData.glucose_limits.critical_low) || (sysUnit==='mmol/L'? 3.0 : 54);
        sysLimits.critHigh = Number(childData.glucose_limits.critical_high) || (sysUnit==='mmol/L'? 13.9 : 250);
    }

    const displayUnit = urlUnit || sysUnit;

    let data = [];
    if (!isBlank) {
      const q = query(collection(childRef, 'measurements'), where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'asc'));
      const snap = await getDocs(q);
      snap.forEach(d => {
         const x = d.data();
         let v = displayUnit.includes('mmol') 
            ? (x.value_mmol ?? (x.unit==='mg/dL'? mgdl2mmol(x.value): x.value))
            : (x.value_mgdl ?? (x.unit==='mmol/L'? mmol2mgdl(x.value): x.value));
         
         x.displayValue = Number.isFinite(+v) ? round1(+v) : null;
         data.push(x);
      });
    }

    const weeks = chunkIntoWeeks(fromDate, toDate);
    
    weeks.forEach((weekDays, index) => {
      const page = createPageStructure(childData, weekDays[0], weekDays[weekDays.length-1], index + 1, weeks.length, displayUnit);
      const grid = page.querySelector('.grid-body');
      
      weekDays.forEach(date => {
        const dayData = data.filter(d => d.date === date);
        grid.appendChild(createDayRow(date, dayData, childData, displayUnit));
      });
      
      container.appendChild(page);
    });

    if (!isBlank && data.length > 0) {
      container.appendChild(createSummaryPage(childData, data, displayUnit));
    }

    document.getElementById('appLoader').style.display = 'none';
    setTimeout(() => window.print(), 1000);

  } catch (e) { console.error(e); }
});

function chunkIntoWeeks(start, end) {
  let days = []; let curr = new Date(start); const last = new Date(end);
  while (curr <= last) { days.push(curr.toISOString().slice(0, 10)); curr.setDate(curr.getDate() + 1); }
  let chunks = [];
  for (let i = 0; i < days.length; i += 7) chunks.push(days.slice(i, i + 7));
  return chunks;
}

function createPageStructure(child, start, end, pageNum, totalPages, displayUnit) {
  const div = document.createElement('div');
  div.className = 'print-page';
  const cf = child.cf || child.correctionFactor || '—';
  const cr = child.cr?.breakfast || child.carbRatio || '—';
  div.innerHTML = `
    <header class="header">
      <div class="header-right">
        <h2>منصة أسيل - سجل المتابعة اليومي ${isBlank ? '(نسخة يدوية)' : ''}</h2>
        <div class="muted">الفترة: من ${start} إلى ${end}</div>
      </div>
      <div class="header-left">
        <b>اسم الطفل:</b> ${child.name || '—'}<br>
        <b>العمر:</b> ${calcAge(child.birthDate)} سنة | <b>الوحدة المستخدمة:</b> ${displayUnit}<br>
        <b>المعاملات:</b> CF: ${cf} | CR: ${cr}
      </div>
    </header>
    <div class="grid-wrap">
      <div class="grid-head">
        <div class="r">التاريخ</div><div class="r">الإجمالي</div>
        ${SLOT_LABELS.map(l => `<div>${l}</div>`).join('')}
      </div>
      <div class="grid-body"></div>
    </div>
    <div class="footer">صفحة ${pageNum} من ${totalPages} — تم الإنشاء بواسطة منصة أسيل لمتابعة السكري</div>
  `;
  return div;
}

function createDayRow(date, dayData, child, displayUnit) {
  const row = document.createElement('div');
  row.className = 'grid-row';
  const d = new Date(date);
  const dayName = d.toLocaleDateString('ar-EG', { weekday: 'short' });
  
  let dailyCarbs = 0, dailyIns = 0;
  dayData.forEach(m => { dailyCarbs += (m.carbs || 0); dailyIns += (m.totalInsulin || m.correctionDose || m.totalDose || 0); });

  let html = `<div class="cell"><b>${date}</b><br><small>${dayName}</small></div>`;
  if(!isBlank && (dailyCarbs > 0 || dailyIns > 0)){
    html += `<div class="cell" style="background:#f8fafc"><b>${dailyCarbs}g</b><br><b>${dailyIns}U</b></div>`;
  } else {
    html += `<div class="cell" style="background:#f8fafc"></div>`;
  }

  SLOT_KEYS.forEach(key => {
    const m = dayData.find(d => d.slotKey === key);
    const ins = m ? (m.totalInsulin || m.correctionDose || m.totalDose || 0) : 0;
    html += `<div class="cell v-cell">
      ${m && !isBlank ? `
        ${m.displayValue !== null ? `<div class="val ${classFor(m.displayValue, displayUnit)}">${m.displayValue}</div>` : ''}
        ${m.carbs > 0 ? `<span class="c-badge">🍔${m.carbs}g</span>` : ''}
        ${ins > 0 ? `<span class="i-badge">💉${ins}U</span>` : ''}
      ` : ''}
    </div>`;
  });

  row.innerHTML = html;
  return row;
}

function createSummaryPage(child, allData, displayUnit) {
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
  
  setTimeout(() => { renderPrintCharts(allData, displayUnit); renderAI(allData, displayUnit); }, 100);
  return div;
}

function renderPrintCharts(list, displayUnit) {
  const L = limitsInUnit(displayUnit);
  const valid = list.filter(x => x.displayValue != null);
  if(valid.length === 0) return;

  const TIR = valid.filter(x => x.displayValue >= L.low && x.displayValue <= L.high).length;
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

function renderAI(list, displayUnit) {
  const L = limitsInUnit(displayUnit);
  const patterns = [];
  
  // استخراج القراءات الصحيحة فقط
  const valid = list.filter(x => typeof x.displayValue === 'number');

  if (valid.length < 5) {
    const aiContainer = document.getElementById('aiContent');
    if (aiContainer) {
      aiContainer.innerHTML = '<div style="color:#64748b; font-size:14px;">لا توجد قراءات كافية في هذه الفترة لاستخراج أنماط دقيقة (مطلوب 5 قراءات على الأقل).</div>';
    }
    return;
  }

  // تجميع القراءات حسب الفترات
  const slots = {};
  valid.forEach(m => {
    if (!slots[m.slotKey]) slots[m.slotKey] = [];
    slots[m.slotKey].push(m.displayValue);
  });

  const countHigh = (arr) => arr ? arr.filter(v => v > L.high).length : 0;
  const countLow = (arr) => arr ? arr.filter(v => v < L.low).length : 0;

  const sleep = slots['DURING_SLEEP'] || [];
  const fast = slots['FASTING'] || slots['WAKE'] || slots['PRE_BREAKFAST'] || [];

  // 1. تحليل فترة النوم والصباح (ظاهرة الفجر مقابل تأثير سوموجي)
  if (fast.length >= 3) {
    const fastHighRatio = countHigh(fast) / fast.length;
    if (fastHighRatio >= 0.5) {
      const sleepLowRatio = sleep.length > 0 ? (countLow(sleep) / sleep.length) : 0;
      if (sleepLowRatio >= 0.3) {
        patterns.push({
          name: 'تأثير سوموجي (Somogyi Effect) 🚨',
          desc: 'هبوط متكرر أثناء النوم يتبعه ارتفاع ارتدادي في الصباح.',
          rec: 'يُرجى مراجعة الطبيب لمناقشة تقليل جرعة المنظم (القاعدي) المسائي.'
        });
      } else {
        patterns.push({
          name: 'ظاهرة الفجر (Dawn Phenomenon) 🌅',
          desc: 'ارتفاع متكرر في سكر الصباح (الصائم) بدون تسجيل هبوط ليلي.',
          rec: 'قد تحتاج جرعة المنظم (القاعدي) لضبط توقيتها أو زيادتها طفيفاً بعد استشارة الطبيب.'
        });
      }
    } else if (countLow(fast) / fast.length >= 0.3) {
        patterns.push({
          name: 'هبوط صباحي متكرر 📉',
          desc: 'قراءات الصائم تميل للهبوط المتكرر عن المعدل الطبيعي.',
          rec: 'يُرجى مراجعة الطبيب لمناقشة تقليل جرعة المنظم (القاعدي).'
        });
    }
  }

  // 2. تحليل الوجبات (مراجعة معامل الكارب CR)
  const meals = [
    { name: 'الإفطار', post: slots['POST_BREAKFAST'] },
    { name: 'الغداء', post: slots['POST_LUNCH'] },
    { name: 'العشاء', post: slots['POST_DINNER'] }
  ];

  meals.forEach(meal => {
    if (meal.post && meal.post.length >= 3) {
      const postHighRatio = countHigh(meal.post) / meal.post.length;
      const postLowRatio = countLow(meal.post) / meal.post.length;

      if (postHighRatio >= 0.5) {
        patterns.push({
          name: `ارتفاع متكرر بعد ${meal.name} 📈`,
          desc: `السكر يرتفع باستمرار بعد وجبة ${meal.name} ويتجاوز النطاق المستهدف.`,
          rec: 'قد تحتاج لتعديل معامل الكارب (CR) لهذه الوجبة (تقليل الرقم لزيادة الجرعة) بالتنسيق مع طبيبك.'
        });
      } else if (postLowRatio >= 0.3) {
        patterns.push({
          name: `هبوط متكرر بعد ${meal.name} 📉`,
          desc: `السكر يهبط باستمرار بعد وجبة ${meal.name}.`,
          rec: 'قد تحتاج لتعديل معامل الكارب (CR) لهذه الوجبة (زيادة الرقم لتقليل الجرعة) بالتنسيق مع طبيبك.'
        });
      }
    }
  });

  // 3. حالة الاستقرار (إذا لم يتم رصد أي أنماط سلبية)
  if (patterns.length === 0) {
    patterns.push({
      name: 'استقرار عام في القراءات ✅',
      desc: 'لم يتم رصد أنماط خطيرة أو تذبذبات حادة متكررة في هذه الفترة.',
      rec: 'استمر على الخطة العلاجية والغذائية الحالية، أداء ممتاز!'
    });
  }

  // طباعة النتائج في التقرير
  const aiContainer = document.getElementById('aiContent');
  if (aiContainer) {
    aiContainer.innerHTML = patterns.map(p => `
      <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed #cbd5e1; page-break-inside: avoid;">
        <div style="font-weight: 700; color: #1e3a8a; font-size: 14px; margin-bottom: 4px;">${p.name}</div>
        <div style="color: #475569; font-size: 13px; margin-bottom: 6px; line-height: 1.4;">${p.desc}</div>
        <div style="color: #059669; font-size: 13px; font-weight: 600;">💡 توصية: ${p.rec}</div>
      </div>
    `).join('');
  }
}

function calcAge(bd) { if(!bd) return '—'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth() || (t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) a--; return a; }
