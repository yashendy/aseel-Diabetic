// ملف الطفل للطبيب — عرض أسبوع قياسات + آخر 3 وجبات + (ملاحظات/تصحيح/رفعنا بإيه) — v3
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  doc, getDoc, collection, query, where, orderBy, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const params = new URLSearchParams(location.search);
const parentUid = params.get('parent');
const childId = params.get('child');

const childMetaEl = document.getElementById('childMeta');
const weekBodyEl  = document.getElementById('weekBody');
const weekTableEl = document.getElementById('weekTable');
const weekEmptyEl = document.getElementById('weekEmpty');
const unitLabelEl = document.getElementById('unitLabel');

const mealsListEl = document.getElementById('mealsList');
const mealsEmptyEl = document.getElementById('mealsEmpty');

// ترتيب الأعمدة ثابت حسب شكل الجدول
const SLOT_COLUMNS = [
  'أثناء النوم',
  'سناك',
  'ب.العشا','ق.العشا',
  'ب.الغدا','ق.الغدا',
  'ب.الفطار','ق.الفطار',
  'الاستيقاظ'
];

onAuthStateChanged(auth, async (user)=>{
  if (!user){ location.href='index.html'; return; }
  if (!parentUid || !childId){ alert('رابط غير مكتمل'); history.back(); return; }

  // تحقق واجهة — الحماية الحقيقية في Rules
  const childRef = doc(db, `parents/${parentUid}/children/${childId}`);
  const snap = await getDoc(childRef);
  if (!snap.exists()){ alert('لم يتم العثور على الطفل'); history.back(); return; }
  const child = snap.data();

  if (!(child.assignedDoctor === user.uid && child.sharingConsent?.doctor === true)){
    alert('لا تملك إذن الاطلاع على هذا الطفل'); history.back(); return;
  }

  const unit = child.glucoseUnit || 'mgdl'; // 'mgdl' | 'mmol'
  unitLabelEl.textContent = `الوحدة: ${unit === 'mmol' ? 'mmol/L' : 'mg/dL'}`;
  childMetaEl.textContent = `${child.name||'-'} • العمر: ${ageFromBirthDate(child.birthDate)} سنة`;

  await loadWeekMeasurements(parentUid, childId, child, unit);
  await loadRecentMeals(parentUid, childId);
});

/* ========== القياسات (أسبوع) ========== */
async function loadWeekMeasurements(pUid, cId, child, unit){
  const { start, end, days } = lastNDays(7); // يشمل اليوم
  const ref = collection(db, `parents/${pUid}/children/${cId}/measurements`);
  // الحقل date بصيغة YYYY-MM-DD → فلترة بنطاق
  const qy = query(ref, where('date','>=', start), where('date','<=', end), orderBy('date','asc'));
  const snap = await getDocs(qy);

  // تجميع حسب التاريخ + slot
  const byDate = new Map(); // date => {slot=>measurement}
  snap.forEach(s=>{
    const m = s.data();
    const d = m.date; if (!d) return;
    const slot = normalizeSlot(m.slot || m.slotKey); // دعم slotKey لو موجود
    if (!byDate.has(d)) byDate.set(d, {});
    const bucket = byDate.get(d);
    const when = toDate(m.when);
    const prev = bucket[slot];
    if (!prev || (when && toDate(prev.when) && toDate(prev.when) < when)) {
      bucket[slot] = m;
    }
  });

  const rows = [];
  days.reverse().forEach(d=>{
    const cells = SLOT_COLUMNS.map(col=>{
      const m = byDate.get(d)?.[col];
      if (!m) return null;

      // القيمة حسب الوحدة المختارة
      const v = unit === 'mmol'
        ? (m.value_mmol ?? (m.value_mgdl ? (m.value_mgdl/18) : null))
        : (m.value_mgdl ?? (m.value_mmol ? Math.round(m.value_mmol*18) : null));

      // الحقول المرنة (احتمالات متعددة)
      const note = firstNonNull(m.note, m.notes);
      const corrRaw = firstNonNull(m.correction, m.correctionDose, m.correction_units, m.correctionU);
      const treat = firstNonNull(m.treatment, m.hypoTreatment, m.raisedWith);

      return {
        val: (v!=null) ? (unit==='mmol' ? round1(v) : Math.round(v)) : null,
        note: safeStr(note),
        corr: corrRaw!=null ? String(corrRaw) : null,
        treat: safeStr(treat)
      };
    });
    rows.push({ date: d, cells });
  });

  renderWeekTable(rows, child, unit);
}

function renderWeekTable(rows, child, unit){
  weekBodyEl.innerHTML = '';
  if (!rows.length){ weekEmptyEl.classList.remove('hidden'); weekTableEl.classList.add('hidden'); return; }
  weekEmptyEl.classList.add('hidden'); weekTableEl.classList.remove('hidden');

  const rangeMin = toNum(child?.normalRange?.min);
  const rangeMax = toNum(child?.normalRange?.max);

  rows.forEach(r=>{
    const tr = document.createElement('tr');

    SLOT_COLUMNS.forEach((col, idx)=>{
      const td = document.createElement('td');
      const cell = r.cells[idx];

      if (cell && cell.val!=null){
        const cls = classify(cell.val, rangeMin, rangeMax);
        td.className = `cell ${cls}`;
        const lines = [];

        // القيمة
        const valLine = `<span class="val">${escapeHTML(String(cell.val))}</span>`;
        // الميتا: تصحيح / رفعنا بإيه / ملاحظات
        if (cell.corr || cell.treat || cell.note){
          if (cell.corr) lines.push(`<span class="line"><strong>تصحيح:</strong> ${escapeHTML(formatUnits(cell.corr))}</span>`);
          if (cell.treat) lines.push(`<span class="line"><strong>رفعنا بإيه؟</strong> ${escapeHTML(cell.treat)}</span>`);
          if (cell.note)  lines.push(`<span class="line">${escapeHTML(cell.note)}</span>`);
        }
        td.innerHTML = lines.length
          ? `${valLine}<div class="meta">${lines.join('')}</div>`
          : valLine;
      } else {
        td.textContent = '—';
      }
      tr.appendChild(td);
    });

    // التاريخ
    const tdDate = document.createElement('td');
    tdDate.textContent = formatDateAr(r.date);
    tr.appendChild(tdDate);

    weekBodyEl.appendChild(tr);
  });
}

/* ========== آخر 3 وجبات (كما هي) ========== */
async function loadRecentMeals(pUid, cId){
  const ref = collection(db, `parents/${pUid}/children/${cId}/meals`);
  const qy = query(ref, orderBy('createdAt','desc'), limit(3));
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach(s=>{
    const m = s.data();
    rows.push({ type:m.type||'-', carbs: round1(m.totals?.carbs_g||0), cal: Math.round(m.totals?.cal_kcal||0) });
  });
  mealsListEl.innerHTML='';
  if (!rows.length){ mealsEmptyEl.classList.remove('hidden'); return; }
  mealsEmptyEl.classList.add('hidden');
  rows.forEach(r=>{
    const div=document.createElement('div');
    div.className='row';
    div.textContent = `${r.type} — كارب ${r.carbs}g • ${r.cal} kcal`;
    mealsListEl.appendChild(div);
  });
}

/* ========== مساعدات ========== */
function lastNDays(n){
  const days = [];
  const pad = (x)=> String(x).padStart(2,'0');
  const today = new Date(); today.setHours(0,0,0,0);
  for (let i=0;i<n;i++){
    const d = new Date(today); d.setDate(today.getDate()-i);
    days.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
  }
  const start = days[days.length-1], end = days[0];
  return { start, end, days };
}
function toDate(x){ return x?.toDate ? x.toDate() : (x ? new Date(x) : null); }
function round1(x){ return Math.round((x||0)*10)/10; }
function toNum(x){ const n = Number(x); return isNaN(n)? null : n; }
function safeStr(v){ return (v==null) ? null : String(v); }
function escapeHTML(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function formatUnits(x){ // 1 → 1U ، "1" → 1U ، "1U" تبقى كما هي
  const s = String(x).trim();
  if (/u$/i.test(s)) return s;
  return `${s}U`;
}

function ageFromBirthDate(bd){ if(!bd) return '-'; const b=new Date(bd), t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; }
function formatDateAr(yyyy_mm_dd){
  const [y,m,d] = (yyyy_mm_dd||'').split('-'); return `${d}-${m}-${y}`;
}

function normalizeSlot(s){
  const x = (s||'').trim();
  const map = {
    'قبل الفطار':'ق.الفطار','ق.الفطار':'ق.الفطار','ب.الفطار':'ب.الفطار','بعد الفطار':'ب.الفطار',
    'قبل الغدا':'ق.الغدا','ق.الغدا':'ق.الغدا','ب.الغدا':'ب.الغدا','بعد الغدا':'ب.الغدا','الغدا':'ق.الغدا',
    'قبل العشا':'ق.العشا','ق.العشا':'ق.العشا','ب.العشا':'ب.العشا','بعد العشا':'ب.العشا',
    'الاستيقاظ':'الاستيقاظ','قيام':'الاستيقاظ','morning':'الاستيقاظ',
    'سناك':'سناك','snack':'سناك',
    'أثناء النوم':'أثناء النوم','night':'أثناء النوم',
    // مفاتيح إنجليزية شائعة
    'POST_LUNCH':'ب.الغدا','PRE_LUNCH':'ق.الغدا','POST_BREAKFAST':'ب.الفطار','PRE_BREAKFAST':'ق.الفطار','POST_DINNER':'ب.العشا','PRE_DINNER':'ق.العشا'
  };
  return map[x] || x || '—';
}

function classify(val, min, max){
  if (min==null || max==null) return 'ok';
  if (val < min) return 'low';
  if (val > max) return 'high';
  return 'ok';
}
