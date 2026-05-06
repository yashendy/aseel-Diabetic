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

$('logoutBtn').onclick = async () => {
  await signOut(auth);
  localStorage.clear();
  location.href = 'index.html';
};

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  currentUser = u;
  
  // تحديث بيانات ولي الأمر في الهيدر بذكاء
  const parentName = u.displayName || (u.email ? u.email.split('@')[0] : 'ولي الأمر');
  if($('parentNameDisplay')) $('parentNameDisplay').textContent = `مرحباً، ${parentName}`;
  if($('parentAvatar')) $('parentAvatar').textContent = parentName.charAt(0).toUpperCase();
  
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
    
    kids = snap.docs.map(d => {
      const data = d.data();
      const unit = data.glucoseUnit || 'mg/dL';
      
      // 1. استخراج الحدود (Limits)
      let limits = {
          critLow: unit === 'mmol/L' ? 3.0 : 54,
          low: unit === 'mmol/L' ? 3.9 : 70,
          high: unit === 'mmol/L' ? 10.0 : 180,
          critHigh: unit === 'mmol/L' ? 13.9 : 250,
          target: unit === 'mmol/L' ? 5.5 : 100
      };
      if (data.glucose_limits) {
          limits = {
              critLow: Number(data.glucose_limits.critical_low) || limits.critLow,
              low: Number(data.glucose_limits.low) || limits.low,
              high: Number(data.glucose_limits.high) || limits.high,
              critHigh: Number(data.glucose_limits.critical_high) || limits.critHigh,
              target: Number(data.glucose_limits.target) || limits.target
          };
      }
      
      // 2. استخراج المعاملات
      const cf = data.cf || data.correctionFactor || '-';
      let crStr = '-';
      if (data.cr) {
          crStr = `${data.cr.breakfast||'-'}/${data.cr.lunch||'-'}/${data.cr.dinner||'-'}`; // عرض (فطار/غدا/عشا)
      } else if (data.carbRatio) {
          crStr = data.carbRatio;
      }

      return { id: d.id, ...data, _limits: limits, _cf: cf, _crStr: crStr, _unit: unit };
    });

    // جلب آخر قراءة لكل طفل
    await Promise.all(kids.map(async k => {
      try {
        const mSnap = await getDocs(query(collection(db, `parents/${currentUser.uid}/children/${k.id}/measurements`), orderBy('when', 'desc'), limit(1)));
        if (!mSnap.empty) {
          const d = mSnap.docs[0].data();
          // نستخدم القيمة الموحدة للون، والقيمة المعروضة للعرض
          k._lastGlucoseNorm = d.normalizedValue || d.value;
          k._lastGlucoseDisplay = d.value;
          k._lastGlucoseUnit = d.unit || k._unit;
        }
      } catch (e) {}
    }));

    filtered = kids;
    render();
  } catch (e) { alert('تعذّر تحميل قائمة الأطفال'); console.error(e); } 
  finally { loader(false); }
}

// دالة التلوين المحدثة بناءً على الإعدادات الذكية
function getGlucoseStatus(valDisplay, valNorm, child) {
  if (!valDisplay) return null;
  const L = child._limits;
  const v = valNorm || valDisplay; 
  const u = child._lastGlucoseUnit;
  const disp = `${valDisplay} <span style="font-size:11px;font-weight:normal">${u}</span>`;

  if (v <= L.critLow) return { text: `هبوط حرج 🚨 ${disp}`, cls: 'g-danger', alert: true };
  if (v < L.low) return { text: `هبوط ↓ ${disp}`, cls: 'g-sev', alert: true }; 
  if (v >= L.critHigh) return { text: `ارتفاع حرج 🚨 ${disp}`, cls: 'g-danger', alert: true };
  if (v > L.high) return { text: `ارتفاع ↑ ${disp}`, cls: 'g-warn', alert: false };
  return { text: `طبيعي ✅ ${disp}`, cls: 'g-ok', alert: false };
}

function render() {
  const grid = $('kidsGrid'); grid.innerHTML = '';
  if (!filtered.length) { $('empty').classList.remove('hidden'); return; }
  $('empty').classList.add('hidden');

  filtered.forEach((k, idx) => {
    const linked = !!k.assignedDoctor;
    const docBadge = linked ? `<span class="doc-badge linked">مرتبط بطبيب ✓</span>` : `<span class="doc-badge unlinked">غير مرتبط</span>`;
    
    const gs = getGlucoseStatus(k._lastGlucoseDisplay, k._lastGlucoseNorm, k);
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
        <span class="factor-chip" title="معامل الكارب (فطار/غدا/عشا)">CR: 🍔 <b>${k._crStr}</b></span>
        <span class="factor-chip">CF: 💉 <b>${k._cf}</b></span>
        <span class="factor-chip">الهدف: 🎯 <b>${k._limits.target}</b></span>
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
  if (sessionStorage.getItem(key) === String(child._lastGlucoseDisplay)) return;
  sessionStorage.setItem(key, String(child._lastGlucoseDisplay));
  
  const div = document.createElement('div');
  div.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#dc2626; color:#fff; padding:15px 24px; border-radius:12px; font-weight:bold; z-index:9999; box-shadow:0 10px 25px rgba(220,38,38,0.5); cursor:pointer;`;
  div.textContent = `🚨 تحذير: قراءة سكر حرجة لـ (${child.name})`; 
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
$('aiMin').onclick = () => $('aiWidget').classList.toggle('minimized'); 
document.querySelectorAll('.ai-chip').forEach(c => c.onclick = () => { $('aiInput').value = c.dataset.q; sendAI(); });
$('aiSend').onclick = sendAI;

function openAIForChild(child) {
  aiState.child = child; aiState.history = [];
  $('aiWidget').classList.remove('hidden');
  $('aiMessages').innerHTML = '';
  
  if (child) {
    $('aiContext').textContent = `الطفل: ${child.name}`;
    appendMsg('sys', `أهلاً! أنا المساعد الذكي الخاص بـ ${child.name}.\nمعامل الكارب (CR): ${child._crStr}\nالتصحيح (CF): ${child._cf}\nالهدف (Target): ${child._limits.target}\nكيف أساعدك اليوم؟`);
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
    const sysPrompt = aiState.child 
        ? `أنت مساعد طبي ذكي متخصص في سكري الأطفال. أجب بناءً على هذه البيانات: اسم الطفل (${aiState.child.name})، هدف السكر (${aiState.child._limits.target})، معامل التصحيح (${aiState.child._cf})، معامل الكارب (${aiState.child._crStr}). أجب باختصار وطمأنينة.` 
        : `أنت مساعد طبي لإدارة سكر الأطفال. أجب باختصار وبأسلوب مطمئن وداعم.`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction: sysPrompt});
    
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
