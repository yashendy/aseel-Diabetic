import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* عناصر */
const kidsGrid = document.getElementById('kidsGrid');
const emptyEl  = document.getElementById('empty');
const searchEl = document.getElementById('search');
const loaderEl = document.getElementById('loader');

/* عناصر المساعد الذكي */
const aiFab     = document.getElementById('aiFab');
const aiWidget  = document.getElementById('aiWidget');
const aiClose   = document.getElementById('aiClose');
const aiMin     = document.getElementById('aiMin');
const aiMessages= document.getElementById('aiMessages');
const aiInput   = document.getElementById('aiInput');
const aiSend    = document.getElementById('aiSend');
const aiContext = document.getElementById('aiContext');
const quickBtns = document.querySelectorAll('.ai-quick-btn');

/* إعدادات المساعد (عدّلي endpoint لو عندك باك-إند مختلف) */
const AI_ENDPOINT = window.AI_ENDPOINT || '/api/chat'; // Proxy آمن على السيرفر
const AI_MODEL    = 'gpt-4o-mini'; // اسم نموذجي المُفضّل، غيّريه حسب الباك-إند

/* حالة */
let currentUser;
let kids = [];      // كل الأطفال
let filtered = [];  // بعد البحث

// حالة المساعد
const aiState = {
  child: null,
  history: [] // [{role:'system'|'user'|'assistant', content:'...'}]
};

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
function loader(show){ loaderEl?.classList.toggle('hidden', !show); }

/* إخفاء مبدئي (لو اللودر ظاهر بسبب كاش) */
if (loaderEl) loaderEl.classList.add('hidden');

/* بدء الجلسة */
onAuthStateChanged(auth, async (user)=>{
  if(!user) return location.href = 'index.html';
  currentUser = user;
  await loadKids();
});

/* بحث */
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
    const today = todayStr();

    for (const d of snap.docs){
      const kid = { id:d.id, ...d.data() };

      // قياسات اليوم
      const measRef = collection(db, `parents/${currentUser.uid}/children/${kid.id}/measurements`);
      const qMeas   = query(measRef, where('date','==', today));
      const sMeas   = await getDocs(qMeas);
      kid.measuresToday = sMeas.size || 0;

      // وجبات اليوم
      const mealsRef = collection(db, `parents/${currentUser.uid}/children/${kid.id}/meals`);
      const qMeals   = query(mealsRef, where('date','==', today));
      const sMeals   = await getDocs(qMeals);
      kid.mealsToday = sMeals.size || 0;

      // أقرب متابعة طبية
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
    setTimeout(()=>{ try{ loader(false); }catch{} }, 5000);
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

      <div class="kid-actions">
        <button class="btn kid-open" data-id="${k.id}">📂 فتح لوحة الطفل</button>
        <button class="btn kid-ai"   data-id="${k.id}">🤖 مساعد هذا الطفل</button>
      </div>
    `;

    // فتح لوحة الطفل
    card.querySelector('.kid-open')?.addEventListener('click', (e)=>{
      e.stopPropagation();
      location.href = `child.html?child=${encodeURIComponent(k.id)}`;
    });

    // فتح المساعد بسياق الطفل
    card.querySelector('.kid-ai')?.addEventListener('click', (e)=>{
      e.stopPropagation();
      openAIForChild(k);
    });

    // النقر على البطاقة كلها يفتح لوحة الطفل (سلوك قديم)
    card.addEventListener('click', ()=>{
      location.href = `child.html?child=${encodeURIComponent(k.id)}`;
    });

    kidsGrid.appendChild(card);
  });
}

/* ===== المساعد الذكي: منطق الواجهة ===== */
function buildSystemPrompt(child){
  // ملخص سياق للالتزام الطبي (لا إرشادات علاجية مباشرة، حسابات وشرح فقط)
  const base = `
أنت مساعد صحي ذكي للأسرة يدعم داء السكري من النوع الأول للأطفال.
- قدّم شرحًا تعليميًا مبسطًا باللغة العربية الفصحى.
- تجنب إعطاء تعليمات دوائية إلزامية؛ اكتفِ بالحسابات والاقتراحات العامة، واطلب مراجعة الطبيب عند الشك.
- استخدم بيانات الطفل (CR "نسبة الكربوهيدرات", CF "عامل التصحيح", نطاقه الطبيعي) إن توفرت.
- عند حساب الجرعة: الجرعة ≈ إجمالي الكربوهيدرات / CR. بالنسبة للتصحيح: (السكر الحالي - الهدف)/CF (لو تجاوز النطاق).
- انتبه أن الدهون/البروتين العالي قد يسبب بطء امتصاص الكربوهيدرات.
`.trim();

  if(!child) return base + `\nلا يوجد طفل محدد في السياق الحالي.`;

  const age = calcAge(child.birthDate);
  const cr  = child.carbRatio ?? 'غير معروف';
  const cf  = child.correctionFactor ?? 'غير معروف';
  const min = child.normalRange?.min ?? 'غير معلوم';
  const max = child.normalRange?.max ?? 'غير معلوم';

  return `${base}
بيانات الطفل:
- الاسم: ${child.name || 'غير معروف'}
- العمر التقريبي: ${age} سنة
- CR: ${cr} g/U
- CF: ${cf} mmol/L/U
- النطاق المستهدف: ${min}–${max} mmol/L
استخدم هذه المعلومات عند الحساب والتفسير.`;
}

function openAIWidget(){
  aiWidget.classList.remove('hidden');
  aiWidget.dataset.minimized = '0';
}

function closeAIWidget(){
  aiWidget.classList.add('hidden');
  aiMessages.innerHTML = '';
  aiState.child = null;
  aiState.history = [];
  aiContext.textContent = 'بدون سياق طفل';
}

function minimizeAI(){
  const isMin = aiWidget.dataset.minimized === '1';
  aiWidget.dataset.minimized = isMin ? '0' : '1';
  aiWidget.style.height = isMin ? '560px' : '64px';
  aiMessages.style.display = isMin ? 'flex' : 'none';
  document.querySelector('.ai-input').style.display = isMin ? 'block' : 'none';
}

function appendMsg(role, text){
  const div = document.createElement('div');
  div.className = role === 'system' ? 'msg sys' : (role === 'assistant' ? 'msg assistant' : 'msg user');
  div.textContent = text;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function openAIForChild(child){
  aiState.child = child;
  aiState.history = [];
  openAIWidget();
  aiContext.textContent = `سياق: ${child.name || 'طفل'}`;
  appendMsg('system', 'تم فتح المساعد بسياق هذا الطفل. يمكنك طرح سؤالك الآن.');
  // أضف رسالة system للـ history (لا تُعرض للعميل الباك-إند إن أردت)
}

function openAIGeneric(){
  aiState.child = null;
  aiState.history = [];
  openAIWidget();
  aiContext.textContent = 'بدون سياق طفل';
  appendMsg('system', 'مرحبًا! أنا مساعدك الذكي. يمكنك سؤالي عن الجرعات، الوجبات، والمقاييس.');
}

/* إرسال رسالة إلى الباك-إند */
async function sendAI(){
  const text = aiInput.value.trim();
  if(!text) return;
  aiInput.value = '';
  appendMsg('user', text);

  // جهّز الرسائل
  const system = buildSystemPrompt(aiState.child);
  const history = [
    { role:'system', content: system },
    ...aiState.history,
    { role:'user', content: text }
  ];

  // احفظ محليًا
  aiState.history = history;

  // مؤشّر انتظار
  const waitEl = document.createElement('div');
  waitEl.className = 'msg assistant';
  waitEl.textContent = '… جارٍ التفكير';
  aiMessages.appendChild(waitEl);
  aiMessages.scrollTop = aiMessages.scrollHeight;

  try{
    // 🚩 استدعي باك-إندك الآمن (Proxy) — يُفترض أن يوجّه إلى OpenAI أو أي مزود
    const res = await fetch(AI_ENDPOINT, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ model: AI_MODEL, messages: history })
    });
    if(!res.ok) throw new Error('فشل الاتصال بالمساعد');
    const data = await res.json();

    // توقّع { reply: "..." } من الباك-إند
    const reply = data.reply || 'تعذّر الحصول على رد حالياً.';
    waitEl.remove();
    appendMsg('assistant', reply);

    // ضمّ الرد للتاريخ
    aiState.history.push({ role:'assistant', content: reply });

  }catch(err){
    waitEl.remove();
    appendMsg('assistant', 'حدث خطأ أثناء الاتصال بالمساعد. حاول مجددًا.');
    console.error(err);
  }
}

/* روابط واجهة المساعد */
aiFab?.addEventListener('click', openAIGeneric);
aiClose?.addEventListener('click', closeAIWidget);
aiMin?.addEventListener('click', minimizeAI);
aiSend?.addEventListener('click', sendAI);
aiInput?.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    sendAI();
  }
});
quickBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    aiInput.value = btn.dataset.q || '';
    aiInput.focus();
  });
});
