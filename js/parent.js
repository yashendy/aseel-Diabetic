import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر */
const kidsGrid = document.getElementById('kidsGrid');
const emptyEl  = document.getElementById('empty');
const searchEl = document.getElementById('search');
const loaderEl = document.getElementById('loader');

/* حالة */
let currentUser;
let kids = [];      // الكل
let filtered = [];  // بعد البحث

/* أدوات */
const pad = n => String(n).padStart(2,'0');
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function calcAge(bd){
  if(!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) a--;
  return a;
}
function avatarColor(i){
  const colors = ['#42A5F5','#7E57C2','#66BB6A','#FFA726','#26C6DA','#EC407A','#8D6E63'];
  return colors[i % colors.length];
}
function esc(s){ return (s||'').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;')
  .replaceAll("'",'&#039;'); }
function loader(show){ loaderEl.classList.toggle('hidden', !show); }

/* بدء الجلسة */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href = 'index.html';
  currentUser = user;
  await loadKids();
});

searchEl.addEventListener('input', ()=>{
  const q = searchEl.value.trim().toLowerCase();
  if (!q){ filtered = kids; render(); return; }
  filtered = kids.filter(k => (k.name||'').toLowerCase().includes(q));
  render();
});

/* تحميل الأطفال + إحصائيات اليوم */
async function loadKids(){
  loader(true);
  try{
    const ref = collection(db, `parents/${currentUser.uid}/children`);
    const qy  = query(ref, orderBy('name','asc'));
    const snap= await getDocs(qy);

    kids = [];
    for (const d of snap.docs){
      const kid = { id:d.id, ...d.data() };

      // إحصائيات اليوم
      const today = todayStr();

      // قياسات
      const measRef = collection(db, `parents/${currentUser.uid}/children/${kid.id}/measurements`);
      const qMeas = query(measRef, where('date','==', today));
      const sMeas = await getDocs(qMeas);
      kid.measuresToday = sMeas.size || 0;

      // وجبات
      const mealsRef = collection(db, `parents/${currentUser.uid}/children/${kid.id}/meals`);
      const qMeals = query(mealsRef, where('date','==', today));
      const sMeals = await getDocs(qMeals);
      kid.mealsToday = sMeals.size || 0;

      // أقرب متابعة
      const visitsRef = collection(db, `parents/${currentUser.uid}/children/${kid.id}/visits`);
      const qVisits   = query(visitsRef, where('followUpDate','>=', today), orderBy('followUpDate','asc'), limit(1));
      const sVisit    = await getDocs(qVisits);
      kid.nextFollowUp = !sVisit.empty ? (sVisit.docs[0].data().followUpDate || '—') : '—';

      kids.push(kid);
    }
    filtered = kids;
    render();
  }catch(e){
    console.error(e);
    alert('تعذّر تحميل قائمة الأطفال');
  }finally{
    loader(false);
  }
}

/* عرض البطاقات */
function render(){
  kidsGrid.innerHTML = '';
  if(!filtered.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  filtered.forEach((k, idx)=>{
    const card = document.createElement('div');
    card.className = 'kid card';
    card.innerHTML = `
      <div class="kid-head">
        <div class="avatar" style="background:${avatarColor(idx)}">${esc((k.name||'?').charAt(0))}</div>
        <div>
          <div class="name">${esc(k.name || 'طفل')}</div>
          <div class="meta">${esc(k.gender || '-')} • العمر: ${calcAge(k.birthDate)} سنة</div>
        </div>
      </div>

      <div class="chips">
        <span class="chip">نطاق: ${(k.normalRange?.min ?? '—')}–${(k.normalRange?.max ?? '—')} mmol/L</span>
        <span class="chip">CR: ${k.carbRatio ?? '—'} g/U</span>
        <span class="chip">CF: ${k.correctionFactor ?? '—'} mmol/L/U</span>
      </div>

      <div class="stats">
        <div class="stat">📊 <span>اليوم:</span> <b>${k.measuresToday}</b> قياس</div>
        <div class="stat">🍽️ <span>اليوم:</span> <b>${k.mealsToday}</b> وجبة</div>
      </div>

      <div class="next">🩺 أقرب متابعة: <b>${k.nextFollowUp}</b></div>
    `;
    card.addEventListener('click', ()=>{
      location.href = `child.html?child=${encodeURIComponent(k.id)}`;
    });
    kidsGrid.appendChild(card);
  });
}
