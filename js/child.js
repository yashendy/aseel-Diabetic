// js/child.js
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر */
const goBackBtn = document.getElementById('goBack');
const logoutBtn = document.getElementById('logoutBtn');
const childNameEl = document.getElementById('childName');

/* بطاقة التحاليل */
const labCard = document.getElementById('labCard');
const labHba1cVal = document.getElementById('labHba1cVal');
const labHba1cDelta = document.getElementById('labHba1cDelta');
const labLastSince = document.getElementById('labLastSince');
const labLastDate = document.getElementById('labLastDate');
const labDueBadge = document.getElementById('labDueBadge');
const openLabsBtn = document.getElementById('openLabsBtn');
const openLastPdfBtn = document.getElementById('openLastPdfBtn');
const addLabBtn = document.getElementById('addLabBtn');

const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');

const params = new URLSearchParams(location.search);
const childId = params.get('child');

/* Utils */
const dayDiff = (a,b)=> Math.ceil((a-b)/86400000);
const pad = n => String(n).padStart(2,'0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function addMonths(date, m=4){
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth()+m);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

/* تنقل علوي */
goBackBtn?.addEventListener('click', ()=> history.back());
logoutBtn?.addEventListener('click', ()=> signOut(auth).catch(()=>{}));

/* جلسة */
onAuthStateChanged(auth, async user=>{
  if(!user){ location.href='index.html'; return; }
  if(!childId){ alert('لا يوجد child في الرابط'); return; }

  // تحميل بيانات الطفل (الاسم)
  const cref = doc(db, `parents/${user.uid}/children/${childId}`);
  const csnp = await getDoc(cref);
  const childName = csnp.exists() ? (csnp.data().name || 'طفل') : 'طفل';
  childNameEl.textContent = childName;

  // تحميل آخر 4 تقارير
  const labsRef = collection(db, `parents/${user.uid}/children/${childId}/labs`);
  const qy = query(labsRef, orderBy('when','desc'), limit(4));
  const sn = await getDocs(qy);

  const labs = sn.docs.map(d=>({ id:d.id, ...d.data() }));
  const lastLab = labs[0] || null;
  const prevLab = labs[1] || null;

  // عرض البطاقة
  renderLabCard(childId, childName, lastLab, prevLab);

  // أزرار
  openLabsBtn.addEventListener('click', (e)=> {
    e.stopPropagation();
    location.href = `labs.html?child=${encodeURIComponent(childId)}`;
  });
  addLabBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    location.href = `labs.html?child=${encodeURIComponent(childId)}`;
  });
  openLastPdfBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    if (lastLab?.id){
      window.open(`labs.html?child=${encodeURIComponent(childId)}&lab=${encodeURIComponent(lastLab.id)}`, '_blank');
    } else {
      location.href = `labs.html?child=${encodeURIComponent(childId)}`;
    }
  });

  // جعل البطاقة نفسها تفتح صفحة التحاليل
  labCard.addEventListener('click', ()=>{
    location.href = `labs.html?child=${encodeURIComponent(childId)}`;
  });
  labCard.addEventListener('keydown', (e)=>{
    if (e.key==='Enter' || e.key===' ') {
      e.preventDefault();
      location.href = `labs.html?child=${encodeURIComponent(childId)}`;
    }
  });

  // Sparkline
  buildSparkline(labs);
});

/* عرض بطاقة التحاليل */
function renderLabCard(childId, childName, lastLab, prevLab){
  if (!lastLab){
    labHba1cVal.textContent = '—';
    labHba1cVal.className = 'value tone';
    labHba1cDelta.textContent = 'لا توجد بيانات';
    labLastSince.textContent = '—';
    labLastDate.textContent = '—';
    labDueBadge.textContent = 'لا توجد تقارير بعد';
    labDueBadge.className = 'pill tiny';
    progressFill.style.width = '0%';
    progressLabel.textContent = '—';
    return;
  }

  // تواريخ
  const when = lastLab.when?.toDate ? lastLab.when.toDate() : (lastLab.date ? new Date(lastLab.date) : new Date());
  labLastDate.textContent = fmt(when);
  labLastSince.textContent = `${dayDiff(new Date(), when)} يوم`;

  // HbA1c + تلوين
  const hba = lastLab?.hba1c?.value;
  let toneClass = 'good';
  let lastTxt = '—';
  if (hba==null || Number.isNaN(Number(hba))){
    labHba1cVal.textContent = '—';
    labHba1cVal.className = 'value tone';
  } else {
    const v = Number(hba);
    lastTxt = `${v.toFixed(1)}%`;
    labHba1cVal.textContent = lastTxt;
    if (v >= 7.5 && v <= 9) toneClass = 'mid';
    if (v > 9) toneClass = 'bad';
    labHba1cVal.className = `value tone ${toneClass}`;
  }

  // دلتا عن السابق + Tooltip
  if (prevLab?.hba1c?.value!=null){
    const pv = Number(prevLab.hba1c.value);
    if (!Number.isNaN(pv) && hba!=null){
      const diff = Number(hba) - pv;
      const sign = diff>0 ? '+' : (diff<0 ? '−' : '±');
      labHba1cDelta.textContent = `مقارنة بالسابق: ${sign}${Math.abs(diff).toFixed(1)}%`;
      labHba1cVal.title = `السابق: ${pv.toFixed(1)}% • الفرق: ${sign}${Math.abs(diff).toFixed(1)}%`;
    } else {
      labHba1cDelta.textContent = '—';
    }
  } else {
    labHba1cDelta.textContent = '—';
  }

  // nextDue (كل 4 شهور) + شارة
  const nextDue = lastLab.nextDue?.toDate ? lastLab.nextDue.toDate() : addMonths(when, 4);
  const daysToDue = dayDiff(nextDue, new Date());
  if (daysToDue < 0){
    labDueBadge.textContent = `متأخر — ${fmt(nextDue)}`;
    labDueBadge.className = 'pill tiny bad';
  } else if (daysToDue <= 14){
    labDueBadge.textContent = `قرب الموعد — ${fmt(nextDue)}`;
    labDueBadge.className = 'pill tiny warn';
  } else {
    labDueBadge.textContent = `التحليل القادم: ${fmt(nextDue)}`;
    labDueBadge.className = 'pill tiny ok';
  }

  // تقدّم نحو الاستحقاق
  const totalDays = Math.max(1, dayDiff(nextDue, when)); // إجمالي أيام الدورة
  const passedDays = Math.max(0, Math.min(totalDays, dayDiff(new Date(), when)));
  const pct = Math.round((passedDays / totalDays) * 100);
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = `${passedDays} / ${totalDays} يوم (${pct}%)`;
}

/* Sparkline HbA1c لآخر 4 تقارير */
function buildSparkline(labs){
  const ctx = document.getElementById('hbaSpark').getContext('2d');
  // رتب تصاعديًا بالزمن لعرض الترند الصحيح
  const sorted = [...labs].reverse();
  const labels = sorted.map(l=>{
    const d = l.when?.toDate ? l.when.toDate() : (l.date ? new Date(l.date) : new Date());
    return fmt(d);
  });
  const data = sorted.map(l=>{
    const v = l?.hba1c?.value;
    return (v==null || Number.isNaN(Number(v))) ? null : Number(v);
  });

  // إن لم توجد قيم كافية، لا ترسم
  const haveData = data.some(v=> v!=null);
  if (!haveData){
    if (window._spark){ window._spark.destroy(); }
    return;
  }

  if (window._spark){ window._spark.destroy(); }
  window._spark = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#8E24AA',
        backgroundColor: 'rgba(142,36,170,0.08)',
        pointRadius: 1.5,
        tension: .25,
        fill: false,
        spanGaps: true
      }]
    },
    options:{
      responsive:true,
      plugins:{ legend:{display:false}, tooltip:{enabled:true} },
      elements:{ point:{ hitRadius:6 } },
      scales:{
        x:{ display:false },
        y:{ display:false, suggestedMin:5, suggestedMax:12 }
      }
    }
  });
}
