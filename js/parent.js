// js/parent.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ❌ لا تستوردي Gemini هنا
// import { GoogleGenerativeAI } from "...";  // احذفيه

/* عناصر */
const kidsGrid = document.getElementById('kidsGrid');
const emptyEl  = document.getElementById('empty');
const searchEl = document.getElementById('search');
const loaderEl = document.getElementById('loader');

/* عناصر الشات */
const aiFab      = document.getElementById('aiFab');
const aiWidget   = document.getElementById('aiWidget');
const aiClose    = document.getElementById('aiClose');
const aiMin      = document.getElementById('aiMin');
const aiMessages = document.getElementById('aiMessages');
const aiInput    = document.getElementById('aiInput');
const aiSend     = document.getElementById('aiSend');
const aiContext  = document.getElementById('aiContext');
const quickBtns  = document.querySelectorAll('.ai-quick-btn');

const GEMINI_API_KEY = window.GEMINI_API_KEY || "";
const GEMINI_MODEL   = "gemini-1.5-flash";
let currentUser, kids=[], filtered=[];
const aiState = { child:null, chatSession:null };

const pad=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
function calcAge(bd){ if(!bd) return '-'; const b=new Date(bd),t=new Date(); let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth(); if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a;}
function avatarColor(i){const c=['#42A5F5','#7E57C2','#66BB6A','#FFA726','#26C6DA','#EC407A','#8D6E63'];return c[i%c.length]}
function esc(s){return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;")}
function loader(x){loaderEl?.classList.toggle('hidden',!x)}

onAuthStateChanged(auth, async (u)=>{ if(!u) return location.href='index.html'; currentUser=u; await loadKids(); });

searchEl.addEventListener('input', ()=>{ const q=searchEl.value.trim().toLowerCase(); filtered = q? kids.filter(k=>(k.name||'').toLowerCase().includes(q)) : kids; render(); });

async function loadKids(){
  loader(true);
  try{
    const ref=collection(db,`parents/${currentUser.uid}/children`);
    const qy=query(ref,orderBy('name','asc'));
    const snap=await getDocs(qy);
    kids=[];
    const today=todayStr();
    for(const d of snap.docs){
      const kid={id:d.id,...d.data()};

      const measRef=collection(db,`parents/${currentUser.uid}/children/${kid.id}/measurements`);
      const sMeas=await getDocs(query(measRef,where('date','==',today)));
      kid.measuresToday=sMeas.size||0;

      const mealsRef=collection(db,`parents/${currentUser.uid}/children/${kid.id}/meals`);
      const sMeals=await getDocs(query(mealsRef,where('date','==',today)));
      kid.mealsToday=sMeals.size||0;

      const visitsRef=collection(db,`parents/${currentUser.uid}/children/${kid.id}/visits`);
      const sVisit=await getDocs(query(visitsRef,where('followUpDate','>=',today),orderBy('followUpDate','asc'),limit(1)));
      kid.nextFollowUp=!sVisit.empty ? (sVisit.docs[0].data().followUpDate || '—') : '—';
      kids.push(kid);
    }
    filtered=kids; render();
  }catch(e){ console.error(e); alert('تعذّر تحميل قائمة الأطفال'); }
  finally{ loader(false); }
}

function render(){
  kidsGrid.innerHTML='';
  if(!filtered.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  filtered.forEach((k,idx)=>{
    const card=document.createElement('div'); card.className='kid card';
    card.innerHTML=`
      <div class="kid-head">
        <div class="avatar" style="background:${avatarColor(idx)}">${esc((k.name||'?').charAt(0))}</div>
        <div>
          <div class="name">${esc(k.name||'طفل')}</div>
          <div class="meta">${esc(k.gender||'-')} • العمر: ${calcAge(k.birthDate)} سنة</div>
        </div>
      </div>
      <div class="chips">
        <span class="chip">نطاق: ${(k.normalRange?.min ?? '—')}–${(k.normalRange?.max ?? '—')} mmol/L</span>
        <span class="chip">CR: ${k.carbRatio ?? '—'} g/U</span>
        <span class="chip">CF: ${k.correctionFactor ?? '—'} mmol/L/U</span>
      </div>
      <div class="stats">
        <div class="stat">📊 اليوم: <b>${k.measuresToday}</b> قياس</div>
        <div class="stat">🍽️ اليوم: <b>${k.mealsToday}</b> وجبة</div>
      </div>
      <div class="next">🩺 أقرب متابعة: <b>${k.nextFollowUp}</b></div>
      <div class="kid-actions">
        <button class="btn kid-open" data-id="${k.id}">📂 فتح لوحة الطفل</button>
        <button class="btn kid-ai" data-id="${k.id}">🤖 مساعد هذا الطفل</button>
      </div>`;
    card.querySelector('.kid-open').onclick=()=>location.href=`child.html?child=${encodeURIComponent(k.id)}`;
    card.querySelector('.kid-ai').onclick=()=>openAIForChild(k);
    card.onclick=()=>location.href=`child.html?child=${encodeURIComponent(k.id)}`;
    kidsGrid.appendChild(card);
  });
}

/* ====== المساعد ====== */
function buildSystemPrompt(child){
  const base=`أنت مساعد صحي ذكي للأسرة يدعم داء السكري من النوع الأول للأطفال.
- اشرح بالعربية الفصحى.
- لا تُصدر تعليمات دوائية إلزامية؛ قدّم حسابات واقتراحات عامة واطلب مراجعة الطبيب عند الشك.
- استخدم بيانات الطفل (CR, CF, النطاق الطبيعي) إن توفرت.
- الجرعة ≈ إجمالي الكربوهيدرات / CR. التصحيح: (السكر الحالي - الهدف)/CF لو خارج النطاق.`;
  if(!child) return base + `\nلا يوجد طفل محدد.`;
  return `${base}
بيانات الطفل:
- الاسم: ${child.name||'غير معروف'}
- العمر: ${calcAge(child.birthDate)} سنة
- CR: ${child.carbRatio ?? 'غير معروف'} g/U
- CF: ${child.correctionFactor ?? 'غير معروف'} mmol/L/U
- النطاق: ${(child.normalRange?.min ?? 'غير معلوم')}–${(child.normalRange?.max ?? 'غير معلوم')} mmol/L`;
}
function openAIWidget(){ aiWidget.classList.remove('hidden'); aiWidget.dataset.minimized='0'; }
function closeAIWidget(){ aiWidget.classList.add('hidden'); aiMessages.innerHTML=''; aiState.child=null; aiState.chatSession=null; aiContext.textContent='بدون سياق طفل'; }
function minimizeAI(){ const isMin=aiWidget.dataset.minimized==='1'; aiWidget.dataset.minimized=isMin?'0':'1'; aiWidget.style.height=isMin?'560px':'64px'; aiMessages.style.display=isMin?'flex':'none'; document.querySelector('.ai-input').style.display=isMin?'block':'none'; }
function appendMsg(role,text){ const d=document.createElement('div'); d.className=role==='assistant'?'msg assistant':(role==='system'?'msg sys':'msg user'); d.textContent=text; aiMessages.appendChild(d); aiMessages.scrollTop=aiMessages.scrollHeight;}

function openAIForChild(child){ aiState.child=child; aiState.chatSession=null; openAIWidget(); aiContext.textContent=`سياق: ${child.name||'طفل'}`; appendMsg('system','تم فتح المساعد بسياق هذا الطفل.'); }
function openAIGeneric(){ aiState.child=null; aiState.chatSession=null; openAIWidget(); aiContext.textContent='بدون سياق طفل'; appendMsg('system','مرحبًا! اسأليني عن الجرعات، الوجبات، والمقاييس.'); }

async function callGemini(systemText,userText){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY غير معرف.');
  const { GoogleGenerativeAI } = window;
  if(!aiState.chatSession){
    const genAI=new GoogleGenerativeAI(GEMINI_API_KEY);
    const model=genAI.getGenerativeModel({ model:GEMINI_MODEL, systemInstruction:systemText });
    aiState.chatSession=model.startChat({ history:[] });
  }
  const res=await aiState.chatSession.sendMessage(userText);
  return res.response.text();
}

async function sendAI(){
  const text=aiInput.value.trim(); if(!text) return; aiInput.value=''; appendMsg('user',text);
  const waitEl=document.createElement('div'); waitEl.className='msg assistant'; waitEl.textContent='… جارٍ التفكير'; aiMessages.appendChild(waitEl);
  try{ const reply=await callGemini(buildSystemPrompt(aiState.child), text); waitEl.remove(); appendMsg('assistant',reply); }
  catch(e){ waitEl.remove(); appendMsg('assistant','تعذّر الاتصال بالمساعد.'); console.error(e); }
}

aiFab?.addEventListener('click', openAIGeneric);
aiClose?.addEventListener('click', closeAIWidget);
aiMin?.addEventListener('click', minimizeAI);
aiSend?.addEventListener('click', sendAI);
aiInput?.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendAI(); }});
quickBtns.forEach(b=>b.addEventListener('click',()=>{ aiInput.value=b.dataset.q||''; aiInput.focus(); }));
