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
  if (targetUnit === 'mmol/L' && sysUnit === 'mg/dL') return { low: round1(mgdl2mmol(sysLimits.low)), upper: round1(mgdl2mmol(sysLimits.high)), severe: round1(mgdl2mmol(sysLimits.critHigh)), critHigh: round1(mgdl2mmol(sysLimits.critHigh) + 2) };
  if (targetUnit === 'mg/dL' && sysUnit === 'mmol/L') return { low: round1(mmol2mgdl(sysLimits.low)), upper: round1(mmol2mgdl(sysLimits.high)), severe: round1(mmol2mgdl(sysLimits.critHigh)), critHigh: round1(mmol2mgdl(sysLimits.critHigh) + 36) };
  return { ...sysLimits };
}

function classFor(v, u){ 
  if(v == null) return '';
  const L=limitsInUnit(u); 
  if(v>=L.severe) return 'crit'; 
  if(v>L.upper) return 'mild'; 
  if(v<L.low) return 'sev'; 
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
        sysLimits.low = Number(childData.glucose_limits.low) || 70;
        sysLimits.high = Number(childData.glucose_limits.high) || 180;
        sysLimits.severe = Number(childData.glucose_limits.critical_high) || 250;
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
  const cr = child.cr?.breakfast || child.carbRatio || '—'; // نموذج للـ CR
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

  const TIR = valid.filter(x => x.displayValue >= L.low && x.displayValue <= L.upper).length;
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
  const patt=[];
  const valid = list.filter(x => x.displayValue !== null && x.displayValue !== undefined);
  
  const fast = valid.filter(x=>x.slotKey==='FASTING' || x.slotKey==='WAKE').map(x=>x.displayValue);
  const sleep = valid.filter(x=>x.slotKey==='DURING_SLEEP' || x.slotKey==='BEDTIME').map(x=>x.displayValue);
  const pBreakfast = valid.filter(x=>x.slotKey==='POST_BREAKFAST').map(x=>x.displayValue);
  const pDinner = valid.filter(x=>x.slotKey==='POST_DINNER').map(x=>x.displayValue);

  if(fast.length >= 3 && sleep.length >= 2) {
    const highFasting = fast.filter(v => v > L.upper).length;
    const normalSleep = sleep.filter(v => v >= L.low && v <= L.severe).length;
    if (highFasting >= 2 && normalSleep >= 2) { patt.push({ name: 'ظاهرة الفجر', desc: 'السكر طبيعي ليلاً ويرتفع صباحاً.', rec: 'تعديل المنظم.', conf: 'عالي 🔴' }); }
  }

  if(fast.length >= 3 && sleep.length >= 2) {
    const highFasting = fast.filter(v => v > L.upper).length;
    const lowSleep = sleep.filter(v => v < L.low).length;
    if (highFasting >= 2 && lowSleep >= 1) { patt.push({ name: 'هبوط ليلي (Somogyi)', desc: 'هبوط أثناء الليل يتبعه ارتفاع ارتدادي.', rec: 'تقليل المنظم.', conf: 'حرج 🚨' }); }
  }

  if(pBreakfast.length >= 3 && pBreakfast.filter(v=>v>=L.severe).length >= 2) {
    patt.push({ name: 'ارتفاع بعد الإفطار', desc: 'السكر يرتفع بشدة بعد الإفطار.', rec: 'تعديل معامل الكارب (CR).', conf: 'متوسط 🟡' });
  }

  if(!patt.length) patt.push({name:'✅ استقرار عام', desc:'الأنماط الحيوية للطفل ضمن الحدود الآمنة غالباً.', rec:'استمر على نفس الخطة!', conf:'—'});

  const aiContainer = document.getElementById('aiContent');
  if(aiContainer) aiContainer.innerHTML = patt.map(p=>`<div class="ai-item"><b>${p.name}</b>${p.desc} <br> <span style="color:#2563eb">${p.rec}</span></div>`).join('');
}

function calcAge(bd) { if(!bd) return '—'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth() || (t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) a--; return a; }
