// js/parent.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, orderBy, doc, getDoc, writeBatch, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

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
const aiKeyWarn  = document.getElementById('aiKeyWarn');

const linkDlg    = document.getElementById('linkDlg');
const linkOpen   = document.getElementById('openLinkDlg');
const linkCancel = document.getElementById('linkCancel');
const linkSubmit = document.getElementById('linkSubmit');
const linkInput  = document.getElementById('linkCodeInput');
const linkMsg    = document.getElementById('linkMsg');

const GEMINI_API_KEY = window.GEMINI_API_KEY || "";
const GEMINI_MODEL   = "gemini-1.5-flash";

let currentUser, kids = [], filtered = [];
const aiState = { child:null, chatSession:null };

function calcAge(bd){if(!bd)return '-';const b=new Date(bd),t=new Date();let a=t.getFullYear()-b.getFullYear();const m=t.getMonth()-b.getMonth();if(m<0||(m===0&&t.getDate()<b.getDate()))a--;return a;}
function avatarColor(i){const c=['#42A5F5','#7E57C2','#66BB6A','#FFA726','#26C6DA','#EC407A','#8D6E63'];return c[i%c.length]}
function esc(s){return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;")}
function loader(x){loaderEl?.classList.toggle('hidden',!x)}
function normArabic(s=''){return s.toString().replace(/[\u064B-\u0652]/g,'').replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim().toLowerCase();}

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
    const consent = (k.sharingConsent===true) || (k.sharingConsent && k.sharingConsent.doctor===true);
    const badge = linked
      ? `<span class="badge ${consent?'ok':'warn'}">${consent?'مرتبط بطبيب (موافقة فعّالة)':'مرتبط بطبيب (الموافقة موقوفة)'}</span>`
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
      </div>
    `;

    card.querySelector('.kid-open').onclick = e=>{
      e.stopPropagation();
      location.href = `child.html?child=${encodeURIComponent(k.id)}`;
    };

    card.querySelector('.kid-ai').onclick = e=>{
      e.stopPropagation();
      openAIForChild(k);
    };

    kidsGrid.appendChild(card);
  });
}

/* ====================== ربط الطبيب عبر الكود ====================== */
linkOpen?.addEventListener('click', ()=>{ linkMsg.textContent=''; linkInput.value=''; linkDlg.showModal(); });
linkCancel?.addEventListener('click', ()=> linkDlg.close());
linkSubmit?.addEventListener('click', linkDoctor);

// جلب بيانات الطبيب لتعبئة assignedDoctorInfo
async function fetchDoctorInfo(doctorUid){
  const d1 = await getDoc(doc(db, `doctors/${doctorUid}`));
  if (d1.exists()){
    const x = d1.data();
    return { uid: doctorUid, name: x.name||null, specialty: x.specialty||null, clinic: x.clinic||null, phone: x.phone||null };
  }
  const d2 = await getDoc(doc(db, `users/${doctorUid}`));
  if (d2.exists()){
    const x = d2.data();
    return { uid: doctorUid, name: x.displayName||null, specialty: x.specialty||null, clinic: x.clinic||null, phone: x.phone||null };
  }
  return { uid: doctorUid };
}

async function linkDoctor(){
  const code = (linkInput.value||'').trim().toUpperCase();
  if(!code){ linkMsg.textContent='أدخلي الكود.'; return; }
  loader(true); linkMsg.textContent='جارٍ التحقق من الكود…';

  try{
    const codeRef = doc(db,'linkCodes',code);
    const s = await getDoc(codeRef);
    if(!s.exists()){ linkMsg.textContent='الكود غير موجود.'; loader(false); return; }
    const d = s.data();
    if(d.used){ linkMsg.textContent='الكود مستخدم بالفعل.'; loader(false); return; }

    const doctorId = d.doctorId;
    const info     = await fetchDoctorInfo(doctorId);

    // ربط جميع أطفال هذا الوليّ (حسب رغبتك). لو عايزة طفل محدد نعدّل لاحقًا.
    const ref = collection(db,`parents/${currentUser.uid}/children`);
    const snap = await getDocs(ref);
    const batch = writeBatch(db);
    snap.forEach(docu=>{
      batch.update(docu.ref, {
        assignedDoctor: doctorId,
        assignedDoctorInfo: {
          uid: info.uid, name: info.name||null, specialty: info.specialty||null,
          clinic: info.clinic||null, phone: info.phone||null, linkedAt: serverTimestamp()
        },
        sharingConsent: { doctor: true }
      });
    });

    // تعليم الكود مستخدمًا (وفق القاعدة: لا نغيّر doctorId)
    batch.update(codeRef, { used:true, parentId: currentUser.uid, usedAt: serverTimestamp(), doctorId: d.doctorId });
    await batch.commit();

    linkMsg.textContent='تم الربط بنجاح ✅';
    await loadKids();
    setTimeout(()=>linkDlg.close(), 700);
  }catch(e){
    console.error(e);
    linkMsg.textContent='تعذّر الربط. تحقّقي من الاتصال والصلاحيات.';
  }finally{
    loader(false);
  }
}

/* ======================== المساعد الذكي ======================== */
function openAIWidget(){ aiWidget.classList.remove('hidden'); aiWidget.dataset.minimized='0'; }
function closeAIWidget(){ aiWidget.classList.add('hidden'); aiMessages.innerHTML=''; aiState.child=null; aiState.chatSession=null; aiContext.textContent='بدون سياق طفل'; }
function appendMsg(role,text){const d=document.createElement('div');d.className=role==='assistant'?'msg assistant':(role==='system'?'msg sys':'msg user');d.textContent=text;aiMessages.appendChild(d);aiMessages.scrollTop=aiMessages.scrollHeight;}

function openAIForChild(child){
  aiState.child=child; aiState.chatSession=null;
  openAIWidget();
  aiContext.textContent=`سياق: ${child.name||'طفل'}`;
  appendMsg('system',`تم فتح المساعد لسياق ${child.name||'هذا الطفل'}.`);
  if(!GEMINI_API_KEY || GEMINI_API_KEY==="YOUR_GEMINI_API_KEY"){
    aiKeyWarn && (aiKeyWarn.style.display='block');
  }else{
    aiKeyWarn && (aiKeyWarn.style.display='none');
  }
}

async function callGemini(systemText,userText){
  if(!GEMINI_API_KEY || GEMINI_API_KEY==="YOUR_GEMINI_API_KEY"){
    throw new Error('GEMINI_API_KEY غير مضبوط. خزّنيه في localStorage أو حدّثه في الصفحة.');
  }
  const { GoogleGenerativeAI } = window;
  if(!GoogleGenerativeAI) throw new Error('SDK غير محمّل');
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
  try{
    const reply=await callGemini("مساعد صحي مختص بمرض السكري عند الأطفال. أجب بإيجاز وبنص عربي واضح.", text);
    waitEl.remove(); appendMsg('assistant',reply);
  }catch(e){
    waitEl.remove();
    appendMsg('assistant','تعذّر الاتصال بالمساعد. تأكدي من المفتاح أو أعيدي المحاولة.');
    console.error(e);
    aiKeyWarn && (aiKeyWarn.style.display='block');
  }
}

aiFab?.addEventListener('click', ()=>openAIForChild({name:""}));
aiClose?.addEventListener('click', closeAIWidget);
aiMin?.addEventListener('click', ()=>aiWidget.classList.toggle('minimized'));
aiSend?.addEventListener('click', sendAI);
aiInput?.addEventListener('keydown', e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAI();}});
quickBtns.forEach(b=>b.addEventListener('click',()=>{ aiInput.value=b.dataset.q||''; aiInput.focus(); }));
