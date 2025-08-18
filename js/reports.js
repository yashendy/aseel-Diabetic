// js/reports-print.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ============ DOM ============ */
const fromEl = document.getElementById('fromDate');
const toEl   = document.getElementById('toDate');
const printArea = document.getElementById('printArea');

const childNameEl = document.getElementById('childName');
const childAgeEl  = document.getElementById('childAge');
const childGenderEl = document.getElementById('childGender');
const chipRangeEl = document.getElementById('chipRange');
const chipCFEl    = document.getElementById('chipCF');
const chipCREl    = document.getElementById('chipCR');
const unitEl      = document.getElementById('unit');
const genAtEl     = document.getElementById('generatedAt');

const btnLoad  = document.getElementById('btnLoad');
const btnBlank = document.getElementById('btnBlank');
const btnPrint = document.getElementById('btnPrint');
const chkNotes = document.getElementById('chkNotes');

/* ============ helpers ============ */
const pad = n => String(n).padStart(2,'0');
const todayStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const addDays = (ds,delta)=>{ const d=new Date(ds); d.setDate(d.getDate()+delta); return todayStr(d); };

function normalizeDateStr(any){
  if(!any) return '';
  if(typeof any==='string'){
    const d = new Date(any);
    if(!isNaN(d)) return todayStr(d);
    if(/^\d{4}-\d{2}-\d{2}$/.test(any)) return any;
    return any;
  }
  const d=(any.toDate && typeof any.toDate==='function')? any.toDate(): new Date(any);
  if(!isNaN(d)) return todayStr(d);
  return '';
}
function calcAge(bd){
  if(!bd) return '—';
  const b=new Date(bd), t=new Date();
  let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a + ' سنة';
}

/* الأعمدة المطلوبة في النسخة المطبوعة (دون سناك والرياضة) */
const PRINT_SLOTS = [
  'wake','pre_bf','post_bf','pre_ln','post_ln','pre_dn','post_dn'
];
const SLOT_TITLES = {
  wake:'الاستيقاظ',
  pre_bf:'ق.الفطار', post_bf:'ب.الفطار',
  pre_ln:'ق.الغدا',  post_ln:'ب.الغدا',
  pre_dn:'ق.العشا',  post_dn:'ب.العشا'
};

/* ============ main ============ */
const params = new URLSearchParams(location.search);
let childId = params.get('child') || localStorage.getItem('lastChildId');

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); location.href='parent.html?pickChild=1'; return; }
  localStorage.setItem('lastChildId', childId);

  // تعبئة التواريخ الافتراضية لآخر 7 أيام
  const today = todayStr();
  if(!toEl.value)   toEl.value   = today;
  if(!fromEl.value) fromEl.value = addDays(today,-7);
  genAtEl.textContent = new Date().toLocaleString('ar-EG');

  // بيانات الطفل
  try {
    const cref = doc(db, `parents/${user.uid}/children/${childId}`);
    const csnap = await getDoc(cref);
    if(csnap.exists()){
      const c = csnap.data();
      childNameEl.textContent = c.name || 'طفل';
      childAgeEl.textContent  = calcAge(c.birthDate);
      childGenderEl.textContent = c.gender || '—';
      chipRangeEl.textContent = `${c.normalRange?.min ?? 4}–${c.normalRange?.max ?? 7} mmol/L`;
      chipCFEl.textContent    = c.correctionFactor!=null? `${c.correctionFactor} mmol/L/U` : '—';
      chipCREl.textContent    = c.carbRatio!=null? `${c.carbRatio} g/U` : '—';
    }
  } catch(e){ console.error('child load', e); }

  // تحميل/طباعة
  btnLoad.addEventListener('click', ()=> buildFilled(user.uid));
  btnBlank.addEventListener('click', buildBlankSheet);
  btnPrint.addEventListener('click', ()=> window.print());

  // إظهار/إخفاء الملاحظات
  chkNotes.addEventListener('change', ()=>{
    printArea.classList.toggle('show-notes', chkNotes.checked);
    printArea.classList.toggle('hide-notes', !chkNotes.checked);
  });

  // أول تحميل افتراضي
  buildFilled(user.uid);
});

/* ============ build filled report ============ */
async function buildFilled(uid){
  const start = normalizeDateStr(fromEl.value);
  const end   = normalizeDateStr(toEl.value);
  if(!start || !end){ alert('حددي فترة صحيحة'); return; }

  // نجلب كل القياسات مرتبة بالتاريخ
  const base = collection(db, `parents/${uid}/children/${childId}/measurements`);
  const snap = await getDocs(query(base, orderBy('date','asc')));

  // تجميع حسب اليوم + الخانة
  const byDate = {}; // {date: {slot:{value,unit,notes,correction}}}
  snap.forEach(d=>{
    const r = d.data();
    const dstr = normalizeDateStr(r.date);
    if(!dstr || dstr < start || dstr > end) return;

    const slot = r.slot || r.input?.slot || '';
    if(!PRINT_SLOTS.includes(slot)) return; // تجاهل السناك/الرياضة وأي خانة غير مطلوبة

    const value = (r.value!=null? r.value :
                  r.input?.value!=null? r.input.value :
                  r.input?.value_mmol!=null? r.input.value_mmol :
                  r.input?.value_mgdl!=null? r.input.value_mgdl : null);

    const unit  = r.unit || r.input?.unit || 'mmol/L';
    const notes = r.notes || r.input?.notes || '';
    const corr  = r.correctionDose ?? r.input?.correctionDose ?? null;

    if(!byDate[dstr]) byDate[dstr] = {};
    byDate[dstr][slot] = { value, unit, notes, corr };
  });

  // بناء الجدول
  const dates = Object.keys(byDate).sort();
  const table = makeSheet(dates, (date)=> byDate[date] || {});
  renderSheet(table);
}

/* ============ build blank weekly sheet ============ */
function buildBlankSheet(){
  // 7 صفوف بدون تواريخ (فراغ للكتابة)
  const rows = Array.from({length:7}, ()=> ''); // تاريخ فارغ
  const table = makeSheet(rows, ()=> ({}), true);
  renderSheet(table);
}

/* ============ render helpers ============ */
function makeSheet(dates, rowGetter, blank=false){
  // عنوان الأعمدة: التاريخ + 7 خانات (بدون سناك/رياضة)
  const thead =
    `<thead>
      <tr>
        <th style="width:110px">التاريخ</th>
        ${PRINT_SLOTS.map(k=>`<th>${SLOT_TITLES[k]}</th>`).join('')}
      </tr>
    </thead>`;

  const rows = dates.map(date=>{
    const row = rowGetter(date);
    return `<tr>
      <td class="cell">
        ${blank? '____' : date}
      </td>
      ${PRINT_SLOTS.map(slot=>{
        const c = row[slot] || {};
        const showVal = (c.value!=null && c.value!=='');
        const valTxt  = showVal ? `${c.value} ${c.unit||'mmol/L'}` : '—';
        const corrTxt = (c.corr!=null && c.corr!=='') ? c.corr : '____';
        const noteTxt = (c.notes && String(c.notes).trim()) ? c.notes : '____';
        return `<td class="cell">
          <div class="val">${blank? '____' : valTxt}</div>
          <div class="sub">
            <span class="corr">جرعة التصحيحي: ${blank? '____' : corrTxt}</span>
            <span class="note">ملاحظات: ${blank? '____' : noteTxt}</span>
          </div>
        </td>`;
      }).join('')}
    </tr>`;
  }).join('');

  return `<table class="sheet ${chkNotes.checked? '' : 'hide-notes'}">
    ${thead}
    <tbody>${rows || `<tr><td colspan="8" class="cell">لا يوجد بيانات ضمن الفترة المحددة.</td></tr>`}</tbody>
  </table>`;
}
function renderSheet(html){
  printArea.innerHTML = html;
  // وسوم للطباعة
  printArea.classList.toggle('show-notes', chkNotes.checked);
  printArea.classList.toggle('hide-notes', !chkNotes.checked);
}
