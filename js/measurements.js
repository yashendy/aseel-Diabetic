import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const params = new URLSearchParams(location.search);
const childId = params.get('child');

const childNameEl = document.getElementById('childName');
const dayInput = document.getElementById('day');
const dayLabel = document.getElementById('dayLabel');

const btnPrintToday = document.getElementById('btnPrintToday');
const btnPrintBlankWeek = document.getElementById('btnPrintBlankWeek');
const btnLabs = document.getElementById('btnLabs');

const pad = n => String(n).padStart(2,'0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const arDate = d => d.toLocaleDateString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد معرف طفل'); history.back(); return; }

  // جلب اسم الطفل للعنوان
  const childRef = doc(db, `parents/${user.uid}/children/${childId}`);
  const snap = await getDoc(childRef);
  const childName = snap.exists() ? (snap.data().name || 'طفل') : 'طفل';
  childNameEl.textContent = childName;

  // تعيين تاريخ اليوم
  const now = new Date();
  dayInput.value = fmt(now);
  dayLabel.textContent = arDate(now);

  // تحديث عنوان التاريخ عند التغيير
  dayInput.addEventListener('change', ()=>{
    const v = dayInput.value ? new Date(dayInput.value) : new Date();
    if (v > new Date()){  // منع المستقبل
      alert('لا يمكن اختيار تاريخ مستقبلي');
      dayInput.value = fmt(new Date());
      dayLabel.textContent = arDate(new Date());
      return;
    }
    dayLabel.textContent = arDate(v);
    // (لو عندك تحميل قراءات اليوم من فايرستور… تنفّذيه هنا)
  });

  // طباعة اليوم (CSS سيخفي سناك/الرياضة تلقائيًا)
  btnPrintToday.addEventListener('click', ()=> window.print());

  // طباعة نموذج أسبوع فارغ (صفحة واحدة بلا تواريخ)
  btnPrintBlankWeek.addEventListener('click', printBlankWeek);

  // فتح تقارير التحاليل الطبية للطفل
  btnLabs.addEventListener('click', ()=>{
    location.href = `labs.html?child=${encodeURIComponent(childId)}`;
  });
});

/* ====== طباعة نموذج أسبوع فارغ ====== */
function printBlankWeek(){
  const win = window.open('', '_blank', 'width=1200,height=800');
  const css = `
  <style>
    :root{--border:#cfd8e3}
    body{direction:rtl;font-family:Segoe UI,Tahoma,Arial,sans-serif;margin:0;padding:12px}
    h2{margin:0 0 8px}
    .grid{display:grid;grid-template-columns:160px repeat(7,1fr);gap:4px;align-items:stretch}
    .cell{border:1px solid var(--border);padding:6px;min-height:38px}
    .head{background:#f4f8ff;font-weight:700;text-align:center}
    .time{font-weight:700;background:#fafcff}
    .muted{color:#555;font-size:12px;margin:6px 0}
    @media print{
      @page{size:A4 landscape; margin:10mm;}
    }
  </style>`;

  const times = [
    'الاستيقاظ','ق.الفطار','ب.الفطار','ق.الغداء','ب.الغداء',
    'ق.العشاء','ب.العشاء','ق.النوم','أثناء النوم'
  ]; // لاحظ حذف سناك والرياضة من النموذج الفارغ
  const days = ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];

  let html = `<h2>نموذج قياسات أسبوع فارغ</h2>
    <div class="muted">بدون تواريخ • مخصص للكتابة اليدوية</div>
    <div class="grid">
      <div class="cell head">الوقت / اليوم</div>`;
  days.forEach(d=> html += `<div class="cell head">${d}</div>`);
  html += `</div>`;

  times.forEach(t=>{
    html += `<div class="grid">`;
    html += `<div class="cell time">${t}</div>`;
    for(let i=0;i<7;i++) html += `<div class="cell"></div>`;
    html += `</div>`;
  });

  win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${css}</head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
  //win.close();  // اتركيه لو حابة يغلق بعد الطباعة
}
