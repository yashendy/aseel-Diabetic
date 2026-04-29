// js/parent.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, orderBy, doc, getDoc, writeBatch,
  serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

let currentUser = null;
let kids = [], filtered = [];
const aiState = { child: null, history: [] };

function loader(x) { $('loader').classList.toggle('hidden', !x); }
function calcAge(bd) {
  if (!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
function avatarColor(i) { const c = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ec4899']; return c[i % c.length]; }

// تسجيل الخروج
$('logoutBtn').onclick = async () => {
  await signOut(auth);
  localStorage.clear();
  location.href = 'index.html';
};

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  currentUser = u;
  await loadKids();
});

$('search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  filtered = q ? kids.filter(k => (k.name||'').toLowerCase().includes(q)) : kids;
  render();
});

async function loadKids() {
  loader(true);
  try {
    const qy = query(collection(db, `parents/${currentUser.uid}/children`), orderBy('name', 'asc'));
    const snap = await getDocs(qy);
    kids = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // جلب آخر قراءة لكل طفل
    await Promise.all(kids.map(async k => {
      try {
        const mSnap = await getDocs(query(collection(db, `parents/${currentUser.uid}/children/${k.id}/measurements`), orderBy('when', 'desc'), limit(1)));
        if (!mSnap.empty) {
          const d = mSnap.docs[0].data();
          k._lastGlucose = d.value_mgdl ?? d.value;
          k._lastGlucoseUnit = 'mg/dL'; // لتوحيد العرض في اللوحة
        }
      } catch (e) {}
    }));

    filtered = kids;
    render();
  } catch (e) { alert('تعذّر تحميل قائمة الأطفال'); } 
  finally { loader(false); }
}

function getGlucoseStatus(v, child) {
  if (!v) return null;
  const low = child.hypo ?? 70; // نفترض mg/dL
  const high = child.hyper ?? 180;
  if (v <= 54) return { text: `حرج 🚨 ${v}`, cls: 'g-danger', alert: true };
  if (v < low) return { text: `منخفض ↓ ${v}`, cls: 'g-warn', alert: false };
  if (v > 250) return { text: `حرج 🚨 ${v}`, cls: 'g-danger', alert: true };
  if (v > high) return { text: `مرتفع ↑ ${v}`, cls: 'g-warn', alert: false };
  return { text: `طبيعي ✅ ${v}`, cls: 'g-ok', alert: false };
}

function render() {
  const grid = $('kidsGrid'); grid.innerHTML = '';
  if (!filtered.length) { $('empty').classList.remove('hidden'); return; }
  $('empty').classList.add('hidden');

  filtered.forEach((k, idx) => {
    const linked = !!k.assignedDoctor;
    const docBadge = linked ? `<span class="doc-badge linked">مرتبط بطبيب ✓</span>` : `<span class="doc-badge unlinked">غير مرتبط</span>`;
    
    const gs = getGlucoseStatus(k._lastGlucose, k);
    const glucoseHtml = gs ? `<div class="glucose-box ${gs.cls}">آخر قراءة: ${gs.text}</div>` : `<div class="glucose-box" style="background:#f1f5f9; color:#64748b">لا توجد قراءات حديثة</div>`;

    const card = document.createElement('div');
    card.className = 'kid-card';
    card.innerHTML = `
      <div class="kc-head">
        <div class="avatar" style="background:${avatarColor(idx)}">${(k.name||'?').charAt(0)}</div>
        <div class="kc-info">
          <h3>${k.name || 'الطفل'}</h3>
          <span class="kc-meta">${k.gender==='female'?'أنثى':'ذكر'} • ${calcAge(k.birthDate)} سنة</span><br>
          ${docBadge}
        </div>
      </div>
      
      ${glucoseHtml}

      <div class="kc-factors">
        <span class="factor-chip">معامل الكارب (CR): <b>${k.carbRatio || '-'}</b></span>
        <span class="factor-chip">معامل التصحيح (CF): <b>${k.correctionFactor || '-'}</b></span>
        <span class="factor-chip">قاعدي: <b>${k.insulin?.basalType || '-'}</b></span>
      </div>

      <div class="kc-actions">
        <a class="btn primary" href="child.html?child=${k.id}">فتح الملف 📂</a>
        <button class="btn secondary open-ai" data-id="${k.id}">المساعد 🤖</button>
      </div>
    `;

    card.querySelector('.open-ai').onclick = () => openAIForChild(k);
    if (gs?.alert) showCriticalAlert(k, gs);
    grid.appendChild(card);
  });
}

function showCriticalAlert(child, gs) {
  const key = `alert_${child.id}`;
  if (sessionStorage.getItem(key) === String(child._lastGlucose)) return;
  sessionStorage.setItem(key, String(child._lastGlucose));
  
  const div = document.createElement('div');
  div.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#dc2626; color:#fff; padding:15px 24px; border-radius:12px; font-weight:bold; z-index:9999; box-shadow:0 10px 25px rgba(220,38,38,0.5); cursor:pointer;`;
  div.textContent = `🚨 تحذير: قراءة سكر حرجة لـ (${child.name}): ${gs.text}`;
  div.onclick = () => div.remove();
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

// ------ ربط الطبيب ------
$('openLinkDlg').onclick = () => { $('linkMsg').textContent=''; $('linkCodeInput').value=''; $('linkDlg').classList.remove('hidden'); };
$('linkCancel').onclick = () => $('linkDlg').classList.add('hidden');
$('linkSubmit').onclick = async () => {
  const code = $('linkCodeInput').value.trim().toUpperCase();
  if(!code) return;
  loader(true); $('linkMsg').textContent='جاري التحقق...'; $('linkMsg').classList.remove('hidden');
  try {
    const codeRef = doc(db, 'linkCodes', code);
    const s = await getDoc(codeRef);
    if (!s.exists() || s.data().used) { $('linkMsg').textContent = 'الكود غير صحيح أو مستخدم.'; return; }
    
    const d = s.data();
    const batch = writeBatch(db);
    kids.forEach(k => {
      batch.update(doc(db, `parents/${currentUser.uid}/children/${k.id}`), {
        assignedDoctor: d.doctorId, sharingConsent: true
      });
    });
    batch.update(codeRef, { used: true, parentId: currentUser.uid, usedAt: serverTimestamp() });
    await batch.commit();
    $('linkDlg').classList.add('hidden');
    loadKids(); alert('تم ربط حساب الطبيب بنجاح ✅');
  } catch(e) { $('linkMsg').textContent='حدث خطأ أثناء الربط.'; }
  finally { loader(false); }
};

// ------ المساعد الذكي ------
$('aiFab').onclick = () => openAIForChild(null);
$('aiClose').onclick = () => $('aiWidget').classList.add('hidden');
$('aiMin').onclick = () => $('aiWidget').classList.toggle('minimized'); // يمكنك إضافة كلاس التصغير لاحقاً
document.querySelectorAll('.ai-chip').forEach(c => c.onclick = () => { $('aiInput').value = c.dataset.q; sendAI(); });
$('aiSend').onclick = sendAI;

function openAIForChild(child) {
  aiState.child = child; aiState.history = [];
  $('aiWidget').classList.remove('hidden');
  $('aiMessages').innerHTML = '';
  
  if (child) {
    $('aiContext').textContent = `الطفل: ${child.name}`;
    appendMsg('sys', `أهلاً! أنا المساعد الذكي الخاص بـ ${child.name}. معامل الكارب له ${child.carbRatio||'-'} والتصحيح ${child.correctionFactor||'-'}. كيف أساعدك اليوم؟`);
  } else {
    $('aiContext').textContent = 'استشارة عامة';
    appendMsg('sys', 'مرحباً! أنا المساعد الطبي لمنصة أسيل. اسألني أي سؤال عام عن السكري.');
  }
}

function appendMsg(role, txt) {
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : role === 'sys' ? 'sys' : 'assistant'}`;
  div.innerHTML = txt.replace(/\n/g, '<br>');
  $('aiMessages').appendChild(div);
  $('aiMessages').scrollTop = $('aiMessages').scrollHeight;
  return div;
}

async function sendAI() {
  const text = $('aiInput').value.trim();
  if(!text) return;
  $('aiInput').value = '';
  appendMsg('user', text);
  const waitEl = appendMsg('assistant', 'جاري التفكير ⏳...');
  $('aiSend').disabled = true;

  try {
    const KEY = window.GEMINI_API_KEY;
    if (!KEY || KEY === 'YOUR_GEMINI_API_KEY') throw new Error('KeyMissing');
    
    const genAI = new window.GoogleGenerativeAI(KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction: "أنت مساعد طبي لإدارة سكر الأطفال. أجب باختصار وبأسلوب مطمئن وداعم."});
    
    const chat = model.startChat({ history: aiState.history });
    const res = await chat.sendMessage(text);
    
    aiState.history.push({ role:'user', parts:[{text}] }, { role:'model', parts:[{text:res.response.text()}] });
    waitEl.remove();
    appendMsg('assistant', res.response.text());
  } catch(e) {
    waitEl.remove();
    appendMsg('assistant', '⚠️ لم أتمكن من الاتصال. تأكدي من إعدادات المفتاح.');
    $('aiKeyWarn').classList.remove('hidden');
  } finally { $('aiSend').disabled = false; }
}
