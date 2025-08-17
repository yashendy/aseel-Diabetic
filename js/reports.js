// js/reports.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy,
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* الأوقات بالترتيب */
const SLOTS = [
  "الاستيقاظ","ق.الفطار","ب.الفطار","ق.الغدا","ب.الغدا",
  "ق.العشا","ب.العشا","سناك","ق.النوم","أثناء النوم",
  "ق.الرياضة","ب.الرياضة"
];

/* عناصر DOM */
const params = new URLSearchParams(location.search);
const childId = params.get('child');

const dateFromEl = document.getElementById('dateFrom');
const dateToEl   = document.getElementById('dateTo');
const unitSel    = document.getElementById('reportUnit');
const hideNotes  = document.getElementById('hideNotes');
const loadBtn    = document.getElementById('loadBtn');
const printBtn   = document.getElementById('printBtn');

const childNameEl = document.getElementById('childName');
const childAgeEl  = document.getElementById('childAge');
const childGenderEl = document.getElementById('childGender');
const rangeEl = document.getElementById('range');
const cfValEl = document.getElementById('cfVal');
const unitChosenEl = document.getElementById('unitChosen');
const genAtEl = document.getElementById('genAt');

const tableWrap = document.getElementById('reportTable');

/* متغيرات */
let currentUser, childData;
let normalMin = 4.4, normalMax = 7.8;  // mmol/L
let correctionFactor_mmol = null;

/* أدوات */
const pad = n => String(n).padStart(2,'0');
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function dateAdd(dStr, days){
  const d = new Date(dStr);
  d.setDate(d.getDate()+days);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function calcAge(birthDateStr){
  if(!birthDateStr) return '-';
  const b = new Date(birthDateStr), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return `${a}`;
}
function escapeHTML(s){
  return (s||'').toString()
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

/* تواريخ افتراضية (آخر 7 أيام) + منع المستقبل */
(function initDates(){
  const to = todayStr();
  const from = dateAdd(to, -6);
  dateFromEl.value = from;
  dateToEl.value = to;
  dateFromEl.max = to;
  dateToEl.max = to;
})();

/* تحميل بيانات الطفل */
onAuthStateChanged(auth, async (user) => {
  if (!user) return location.href = 'index.html';
  if (!childId){ alert('لا يوجد معرف طفل في الرابط'); return; }
  currentUser = user;

  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }

  childData = snap.data();
  childNameEl.textContent = childData.name || 'طفل';
  childAgeEl.textContent = calcAge(childData.birthDate);
  childGenderEl.textContent = childData.gender || '-';

  normalMin = Number(childData.normalRange?.min ?? 4.4);
  normalMax = Number(childData.normalRange?.max ?? 7.8);
  correctionFactor_mmol = childData.correctionFactor ? Number(childData.correctionFactor) : null;

  rangeEl.textContent = `${normalMin}–${normalMax}`;
  cfValEl.textContent = correctionFactor_mmol ?? '-';
  unitChosenEl.textContent = unitSel.value;
  genAtEl.textContent = new Date().toLocaleString('ar-EG');

  await loadReport();
});

/* أحداث الواجهة */
loadBtn.addEventListener('click', async ()=>{
  unitChosenEl.textContent = unitSel.value;
  await loadReport();
});
printBtn.addEventListener('click', ()=>{
  document.body.classList.toggle('print-no-notes', hideNotes.checked);
  window.print();
});

/* قراءة البيانات وبناء الجدول */
async function loadReport(){
  const from = dateFromEl.value;
  const to   = dateToEl.value;
  const today = todayStr();
  if (!from || !to){ alert('اختر نطاق التاريخ'); return; }
  if (from > to){ alert('تاريخ البداية أكبر من تاريخ النهاية'); return; }
  if (to > today){ dateToEl.value = today; }

  const ref = collection(db, `parents/${currentUser.uid}/children/${childId}/measurements`);
  const qy = query(
    ref,
    where('date','>=', from),
    where('date','<=', dateToEl.value),
    orderBy('date','asc'),
    orderBy('when','asc')
  );
  const snap = await getDocs(qy);

  // حضّر مصفوفة أيام النطاق
  const days = [];
  for(let d = from; d <= dateToEl.value; d = dateAdd(d,1)) days.push(d);

  // تجميع حسب (اليوم → الوقت)
  const byDaySlot = new Map();
  snap.forEach(docSnap=>{
    const m = docSnap.data();
    const date = m.date;
    const slot = m.slot || '-';

    if(!byDaySlot.has(date)) byDaySlot.set(date, {});
    const bucket = byDaySlot.get(date);

    if(!bucket[slot]){
      bucket[slot] = { latest: { id: docSnap.id, ...m }, extras: 0 };
    } else {
      bucket[slot].extras += 1;
      bucket[slot].latest = { id: docSnap.id, ...m }; // الأحدث
    }
  });

  tableWrap.innerHTML = buildTable(days, byDaySlot);
}

/* بناء جدول HTML */
function buildTable(days, byDaySlot){
  const unit = unitSel.value;

  const thead = `<thead><tr>
    <th class="date-col">التاريخ</th>
    ${SLOTS.map(s=>`<th class="slot-col">${s}</th>`).join('')}
  </tr></thead>`;

  let tbody = '<tbody>';
  for(const day of days){
    const bucket = byDaySlot.get(day) || {};
    tbody += `<tr><td class="date-col"><strong>${day}</strong></td>`;

    for(const slot of SLOTS){
      const data = bucket[slot];
      if(!data){
        tbody += `<td class="slot-col">
          <div class="cell">
            <div class="cell-line"><span class="val">____</span></div>
            <div class="cell-line corr">جرعة التصحيحي: ____</div>
            <div class="cell-line notes">ملاحظات: ____</div>
          </div>
        </td>`;
      }else{
        const m = data.latest;
        const extras = data.extras;

        // القيمة حسب وحدة التقرير المختارة
        const valueShown = unit === 'mg/dL'
          ? (m.value_mgdl ?? Math.round((m.value_mmol||0)*18))
          : (m.value_mmol ?? ((m.value_mgdl||0)/18));

        const valueText = unit === 'mg/dL'
          ? `${valueShown} <span class="unit">mg/dL</span>`
          : `${Number(valueShown).toFixed(1)} <span class="unit">mmol/L</span>`;

        // مؤشر الحالة (دائمًا بناءً على mmol/L)
        const mmol = m.value_mmol ?? ((m.value_mgdl||0)/18);
        let indHTML = '';
        if (mmol > normalMax) indHTML = `<span class="arrowUp">▲</span>`;
        else if (mmol < normalMin) indHTML = `<span class="arrowDown">▼</span>`;
        else indHTML = `<span class="dot"></span>`;

        const corrTxt = (m.correctionDose && mmol > normalMax)
          ? `جرعة التصحيحي: ${m.correctionDose}U`
          : `جرعة التصحيحي: ____`;

        const notesTxt = m.notes ? `ملاحظات: ${escapeHTML(m.notes)}` : `ملاحظات: ____`;

        tbody += `<td class="slot-col">
          <div class="cell">
            <div class="cell-line">
              <span class="ind">${indHTML}</span>
              <span class="val">${valueText}${extras>0?`<span class="extra">+${extras}</span>`:''}</span>
            </div>
            <div class="cell-line corr">${corrTxt}</div>
            <div class="cell-line notes">${notesTxt}</div>
          </div>
        </td>`;
      }
    }

    tbody += '</tr>';
  }
  tbody += '</tbody>';

  return `<table class="table">${thead}${tbody}</table>`;
}
