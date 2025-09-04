// js/parent.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, orderBy, doc, getDoc, writeBatch,
  updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- عناصر الواجهة ---------- */
const kidsGrid  = document.getElementById('kidsGrid');
const emptyEl   = document.getElementById('empty');
const searchEl  = document.getElementById('search');
const loaderEl  = document.getElementById('loader');

const linkDlg    = document.getElementById('linkDlg');
const linkOpen   = document.getElementById('openLinkDlg');
const linkCancel = document.getElementById('linkCancel');
const linkSubmit = document.getElementById('linkSubmit');
const linkInput  = document.getElementById('linkCodeInput');
const linkMsg    = document.getElementById('linkMsg');

const aiFab      = document.getElementById('aiFab');
const aiWidget   = document.getElementById('aiWidget');
const aiClose    = document.getElementById('aiClose');
const aiMin      = document.getElementById('aiMin');
const aiMessages = document.getElementById('aiMessages');
const aiInput    = document.getElementById('aiInput');
const aiSend     = document.getElementById('aiSend');
const aiContext  = document.getElementById('aiContext');
const aiKeyWarn  = document.getElementById('aiKeyWarn');
const quickBtns  = document.querySelectorAll('.ai-quick-btn');

/* ---------- حالة ---------- */
let currentUser = null;
let kids = [], filtered = [];
const aiState = { child:null, chatSession:null };

/* ---------- أدوات ---------- */
function loader(x){loaderEl?.classList.toggle('hidden', !x);}
function esc(s){return (s??'').toString()
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'","&#039;");}
function calcAge(bd){ if(!bd) return '-'; const b=new Date(bd),t=new Date();
  let a=t.getFullYear()-b.getFullYear(); const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a; }
function avatarColor(i){ const c=['#42A5F5','#7E57C2','#66BB6A','#FFA726','#26C6DA','#EC407A','#8D6E63']; return c[i%c.length]; }
function normArabic(s=''){return s.toString().replace(/[\u064B-\u0652]/g,'').replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim().toLowerCase();}

/* ---------- تحميل الأطفال ---------- */
onAuthStateChanged(auth, async (u)=>{
  if(!u){ location.href='index.html'; return; }
  currentUser=u; await loadKids();
});

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
    kids = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    filtered = kids;
    render();
  }catch(e){ console.error(e); alert('تعذّر تحميل قائمة الأطفال'); }
  finally{ loader(false); }
}

/* ---------- عرض البطاقات ---------- */
function render(){
  kidsGrid.innerHTML='';
  if(!filtered.length){ emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  filtered.forEach((k,idx)=>{
    const linked  = !!k.assignedDoctor;
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
        <!-- رابط فعلي يعمل حتى لو تعطّل JS -->
        <a class="btn primary kid-open" href="child.html?child=${encodeURIComponent(k.id)}">📂 فتح لوحة الطفل</a>
        <button class="btn kid-ai" data-id="${k.id}">🤖 مساعد هذا الطفل</button>
      </div>
    `;

    // زر المساعد
    card.querySelector('.kid-ai')?.addEventListener('click', (e)=>{
      e.preventDefault();
      openAIForChild(k);
    });

    kidsGrid.appendChild(card);
  });
}

/* ---------- حوار ربط الدكتور ---------- */
linkOpen?.addEventListener('click', ()=>{ linkMsg.textContent=''; linkInput.value=''; linkDlg.showModal(); });
linkCancel?.addEventListener('click', ()=> linkDlg.close());
linkSubmit?.addEventListener('click', linkDoctor);

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
  loader(true); linkMsg.textContent='جارٍ التحقق…';

  try{
    // 1) تحقق من الكود
    const codeRef = doc(db,'linkCodes',code);
    const s = await getDoc(codeRef);
    if(!s.exists()){ linkMsg.textContent='الكود غير موجود.'; return; }
    const d = s.data();
    if(d.used){ linkMsg.textContent='الكود مستخدم مسبقًا.'; return; }

    // 2) جلب دكتور
    const doctorId = d.doctorId;
    const info     = await fetchDoctorInfo(doctorId);

    // 3) ربط كل أطفال هذا الوليّ (يمكن لاحقًا تخصيص طفل واحد)
    const ref = collection(db,`parents/${currentUser.uid}/children`);
    const snap = await getDocs(ref);
    if(snap.empty){ linkMsg.textContent='لا يوجد أطفال لربطهم.'; return; }

    const batch = writeBatch(db);
    snap.forEach(docu=>{
      batch.update(docu.ref, {
        assignedDoctor: doctorId,
        assignedDoctorInfo: {
          uid: info.uid,
          name: info.name||null,
          specialty: info.specialty||null,
          clinic: info.clinic||null,
          phone: info.phone||null,
          linkedAt: serverTimestamp()
        },
        // ✅ لازم Boolean لتوافق القواعد
        sharingConsent: true
      });
    });

    // 4) تعليم الكود مستخدمًا وفق القواعد
    batch.update(codeRef, {
      used:true,
      parentId: currentUser.uid,
      usedAt: serverTimestamp(),
      doctorId: d.doctorId // لا نغيّره
    });

    await batch.commit();

    linkMsg.textContent='تم الربط ✅';
    await loadKids();
    setTimeout(()=> linkDlg.close(), 700);
  }catch(e){
    console.error(e);
    linkMsg.textContent='فشل الربط. تحققي من الصلاحيات والاتصال.';
  }finally{
    loader(false); // لا يعلق اللودر أبداً
  }
}

/* ---------- المساعد الذكي ---------- */
function openAIWidget(){ aiWidget.classList.remove('hidden'); }
function closeAIWidget(){ aiWidget.classList.add('hidden'); aiMessages.innerHTML=''; aiState.child=null; aiState.chatSession=null; aiContext.textContent='بدون سياق طفل'; }
function appendMsg(role,text){const d=document.createElement('div');d.className=role==='assistant'?'msg assistant':(role==='system'?'msg sys':'msg user');d.textContent=text;aiMessages.appendChild(d);aiMessages.scrollTop=aiMessages.scrollHeight;}

function openAIForChild(child){
  aiState.child=child; aiState.chatSession=null;
  openAIWidget();
  aiContext.textContent=`سياق: ${child.name||'طفل'}`;
  appendMsg('system',`تم فتح المساعد لسياق ${child.name||'هذا الطفل'}.`);
  const key = window.GEMINI_API_KEY;
  aiKeyWarn.style.display = (!key || key==="YOUR_GEMINI_API_KEY") ? 'block' : 'none';
}

async function callGemini(systemText,userText){
  // لديك خياران:
  // 1) عبر الباك-إند (أفضل للإنتاج): /api/aiChat  ← لو عاملـة Functions
  // 2) مباشرة عبر المفتاح المحلي (للاختبار الشخصي فقط)

  if (typeof fetch === 'function' && location.pathname !== '/index.html' && typeof auth?.currentUser?.getIdToken === 'function') {
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch('/api/aiChat', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({ systemText, userText, model:'gemini-1.5-flash' })
      });
      if (r.ok){ const data = await r.json(); return data.text || 'لم يصل رد.'; }
    } catch {}
  }

  // رجوع للاستخدام المحلي (لو عاملـة مفتاح في المتصفح)
  const KEY = window.GEMINI_API_KEY;
  if(!KEY || KEY==="YOUR_GEMINI_API_KEY") throw new Error('GEMINI_API_KEY غير مضبوط.');
  const { GoogleGenerativeAI } = window;
  const genAI=new GoogleGenerativeAI(KEY);
  const model=genAI.getGenerativeModel({ model:'gemini-1.5-flash', systemInstruction:systemText });
  const chat=model.startChat({ history:[] });
  const res=await chat.sendMessage(userText);
  return res.response.text();
}

async function sendAI(){
  const text=aiInput.value.trim(); if(!text) return;
  aiInput.value=''; appendMsg('user',text);
  const waitEl=document.createElement('div'); waitEl.className='msg assistant'; waitEl.textContent='… جارٍ التفكير'; aiMessages.appendChild(waitEl);
  try{
    const context = aiState.child ? `الطفل: ${aiState.child.name||''}, CR=${aiState.child.carbRatio??'-'}, CF=${aiState.child.correctionFactor??'-'}` : '';
    const reply=await callGemini("أنت مساعد صحي مختص بمرض السكري لدى الأطفال. أجب بإيجاز وبالعربية.", `${context}\n\nسؤالي: ${text}`);
    waitEl.remove(); appendMsg('assistant',reply);
  }catch(e){
    waitEl.remove(); appendMsg('assistant','تعذّر الاتصال بالمساعد.'); console.error(e);
    aiKeyWarn.style.display='block';
  }
}

aiFab?.addEventListener('click', ()=>openAIForChild({name:''}));
aiClose?.addEventListener('click', closeAIWidget);
aiMin?.addEventListener('click', ()=> aiWidget.classList.toggle('hidden'));
aiSend?.addEventListener('click', sendAI);
aiInput?.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendAI(); }});
quickBtns.forEach(b=>b.addEventListener('click',()=>{ aiInput.value=b.dataset.q||''; aiInput.focus(); }));
