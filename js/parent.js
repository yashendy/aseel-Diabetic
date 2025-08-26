import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const kidsGrid = document.getElementById('kidsGrid');
const emptyEl  = document.getElementById('empty');
const searchEl = document.getElementById('search');
const loaderEl = document.getElementById('loader');

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
let currentUser, kids = [], filtered = [];
const aiState = { child:null, chatSession:null };

/* أدوات بسيطة */
const pad=n=>String(n).padStart(2,'0');
function calcAge(bd){if(!bd)return '-';const b=new Date(bd),t=new Date();let a=t.getFullYear()-b.getFullYear();const m=t.getMonth()-b.getMonth();if(m<0||(m===0&&t.getDate()<b.getDate()))a--;return a;}
function avatarColor(i){const c=['#42A5F5','#7E57C2','#66BB6A','#FFA726','#26C6DA','#EC407A','#8D6E63'];return c[i%c.length]}
function esc(s){return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;")}
function loader(x){loaderEl?.classList.toggle('hidden',!x)}
function normArabic(s=''){return s.toString().replace(/[\u064B-\u0652]/g,'').replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim().toLowerCase();}

/* دخول المستخدم وتحميل الأطفال */
onAuthStateChanged(auth, async (u)=>{ if(!u) return location.href='index.html'; currentUser=u; await loadKids(); });

searchEl?.addEventListener('input', ()=>{
  const q = normArabic(searchEl.value);
  filtered = q ? kids.filter(k => normArabic(k.name||'').includes(q)) : kids;
  render();
});

async function loadKids(){
  loader(true);
  try{
    const ref=collection(db,`parents/${currentUser.uid}/children`);
    const qy=query(ref,orderBy('name','asc'));
    const snap=await getDocs(qy);
    kids=[];
    for(const d of snap.docs){
      const kid={ id:d.id, ...d.data() };
      // نتوقع الحقول: assignedDoctor, assignedDoctorInfo, sharingConsent.doctor
      kids.push(kid);
    }
    filtered=kids;
    render();
  }catch(e){console.error(e);alert('تعذّر تحميل قائمة الأطفال');}
  finally{loader(false);}
}

function render(){
  kidsGrid.innerHTML='';
  if(!filtered.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  filtered.forEach((k,idx)=>{
    const linked = !!k.assignedDoctor;
    const consentOn = !!(k.sharingConsent?.doctor);
    const badge = linked
      ? `<span class="badge ${consentOn?'ok':'warn'}">${consentOn?'مرتبط بطبيب (موافقة فعّالة)':'مرتبط بطبيب (الموافقة موقوفة)'}</span>`
      : `<span class="badge">غير مرتبط بطبيب</span>`;

    const card=document.createElement('div');
    card.className='kid card';
    card.innerHTML=`
      <div class="kid-head">
        <div class="avatar" style="background:${avatarColor(idx)}">${esc((k.name||'?').charAt(0))}</div>
        <div>
          <div class="name">${esc(k.name||'طفل')}</div>
          <div class="meta">${esc(k.gender||'-')} • العمر: ${calcAge(k.birthDate)} سنة</div>
          ${badge}
        </div>
      </div>

      <div class="chips">
        <span class="chip">CR: ${k.carbRatio ?? '—'}</span>
        <span class="chip">CF: ${k.correctionFactor ?? '—'}</span>
      </div>

      <div class="kid-actions">
        <button class="btn primary kid-open" data-id="${k.id}">📂 فتح لوحة الطفل</button>
        <button class="btn kid-ai" data-id="${k.id}">🤖 مساعد هذا الطفل</button>
        <button class="btn kid-share" data-id="${k.id}">🔗 مشاركة بيانات الطفل</button>
      </div>
    `;

    // فتح لوحة الطفل
    card.querySelector('.kid-open').onclick = e=>{
      e.stopPropagation();
      location.href = `child.html?child=${encodeURIComponent(k.id)}`;
    };

    // فتح المساعد لسياق الطفل
    card.querySelector('.kid-ai').onclick = e=>{
      e.stopPropagation();
      openAIForChild(k);
    };

    // مشاركة بيانات الطفل (الربط مع الطبيب)
    card.querySelector('.kid-share').onclick = e=>{
      e.stopPropagation();
      location.href = `share-access.html?child=${encodeURIComponent(k.id)}`;
    };

    kidsGrid.appendChild(card);
  });
}

/* ====== المساعد الذكي ====== */
function openAIWidget(){ aiWidget.classList.remove('hidden'); aiWidget.dataset.minimized='0'; }
function closeAIWidget(){ aiWidget.classList.add('hidden'); aiMessages.innerHTML=''; aiState.child=null; aiState.chatSession=null; aiContext.textContent='بدون سياق طفل'; }
function appendMsg(role,text){const d=document.createElement('div');d.className=role==='assistant'?'msg assistant':(role==='system'?'msg sys':'msg user');d.textContent=text;aiMessages.appendChild(d);aiMessages.scrollTop=aiMessages.scrollHeight;}

function openAIForChild(child){
  aiState.child=child; aiState.chatSession=null;
  openAIWidget();
  aiContext.textContent=`سياق: ${child.name||'طفل'}`;
  appendMsg('system',`تم فتح المساعد لسياق ${child.name||'هذا الطفل'}.`);
}

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
  const text=aiInput.value.trim(); if(!text) return;
  aiInput.value=''; appendMsg('user',text);
  const waitEl=document.createElement('div'); waitEl.className='msg assistant'; waitEl.textContent='… جارٍ التفكير'; aiMessages.appendChild(waitEl);
  try{const reply=await callGemini("مساعد صحي", text);waitEl.remove();appendMsg('assistant',reply);}
  catch(e){waitEl.remove();appendMsg('assistant','تعذّر الاتصال.');console.error(e);}
}

aiFab?.addEventListener('click', ()=>openAIForChild({name:""}));
aiClose?.addEventListener('click', closeAIWidget);
aiMin?.addEventListener('click', ()=>aiWidget.classList.toggle('minimized'));
aiSend?.addEventListener('click', sendAI);
aiInput?.addEventListener('keydown', e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAI();}});
quickBtns.forEach(b=>b.addEventListener('click',()=>{ aiInput.value=b.dataset.q||''; aiInput.focus(); }));
