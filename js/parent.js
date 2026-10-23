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
function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

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

    // جلب آخر قراءة وتأكيد القاعدي لكل طفل
    const tStr = todayStr();
    await Promise.all(kids.map(async k => {
      try {
        const mSnap = await getDocs(query(collection(db, `parents/${currentUser.uid}/children/${k.id}/measurements`), limit(5)));
        if (!mSnap.empty) {
          const sorted = mSnap.docs.map(d => d.data()).sort((a,b) => {
            const ta = a.when?.toDate ? a.when.toDate() : new Date(a.when||0);
            const tb = b.when?.toDate ? b.when.toDate() : new Date(b.when||0);
            return tb - ta;
          });
          const d = sorted[0];
          k._lastGlucoseNorm = d.normalizedValue || d.value;
          k._lastGlucoseDisplay = d.value;
          k._lastGlucoseUnit = d.unit || k._unit;
        }
        if (!mSnap.empty) {
          const d = mSnap.docs[0].data();
          // نستخدم القيمة الموحدة للون، والقيمة المعروضة للعرض
          k._lastGlucoseNorm = d.normalizedValue || d.value;
          k._lastGlucoseDisplay = d.value;
          k._lastGlucoseUnit = d.unit || k._unit;
        }
      } catch (e) {}

      try {
        const bCache = localStorage.getItem(`basal_${k.id}_${tStr}`);
        let bData = null;
        if (bCache) {
          try {
            const parsed = JSON.parse(bCache);
            if (parsed.taken && parsed.date === tStr) bData = parsed;
          } catch(e){}
        }
        if (!bData) {
          const bSnap = await getDoc(doc(db, `parents/${currentUser.uid}/children/${k.id}/basalLogs/${tStr}`));
          if (bSnap.exists() && bSnap.data().taken) {
            bData = bSnap.data();
            localStorage.setItem(`basal_${k.id}_${tStr}`, JSON.stringify(bData));
          }
        }
        k._basalStatus = bData;
      } catch(e){}
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

    const basalHtml = k._basalStatus && k._basalStatus.taken
      ? `<div class="basal-pill done" title="تم تسجيل أخذ جرعة القاعدي اليوم">💉 القاعدي اليوم: تم (${k._basalStatus.dose}U في ${k._basalStatus.time || '—'}) ✓</div>`
      : `<div class="basal-pill pending" title="لم يتم تسجيل جرعة القاعدي اليوم بعد">⏳ القاعدي اليوم: لم يُسجّل بعد</div>`;

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
      ${basalHtml}

      <div class="kc-factors">
        <span class="factor-chip" title="معامل الكارب (فطار/غدا/عشا)">CR: 🍔 <b>${k._crStr}</b></span>
        <span class="factor-chip">CF: 💉 <b>${k._cf}</b></span>
        <span class="factor-chip">الهدف: 🎯 <b>${k._limits.target}</b></span>
      </div>

      <div class="kc-actions">
        <a class="btn primary" href="child.html?child=${k.id}">فتح الملف 📂</a>
        <a class="btn secondary" href="child.html?child=${k.id}&openEmergency=1" title="عرض وطباعة بطاقة الطوارئ والمدرسة">🪪 كارت الطوارئ</a>
        <button class="btn ghost open-ai" data-id="${k.id}">المساعد 🤖</button>
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
        assignedDoctor: d.doctorId,
        assignedDoctorInfo: { uid: d.doctorId },
        parentId: currentUser.uid,
        sharingConsent: true
      });
      batch.set(doc(db, `doctors/${d.doctorId}/patients/${k.id}`), {
        childId: k.id,
        parentId: currentUser.uid,
        childName: k.name || null,
        linkedAt: serverTimestamp()
      }, { merge: true });
    });
    batch.update(codeRef, { used: true, parentId: currentUser.uid, usedAt: serverTimestamp() });
    await batch.commit();
    $('linkDlg').classList.add('hidden');
    loadKids(); alert('تم ربط حساب الطبيب بنجاح ✅');
  } catch(e) { $('linkMsg').textContent='حدث خطأ أثناء الربط.'; }
  finally { loader(false); }
};

// ------ المساعد الذكي المتطور (Parent AI Assistant) ------
let _parentAiApiKey = localStorage.getItem('aseel_gemini_key') || '';

async function fetchParentAiKey() {
  try {
    const snap = await getDoc(doc(db, 'admin/global/settings/ai'));
    if (snap.exists() && snap.data()?.geminiApiKey) {
      _parentAiApiKey = String(snap.data().geminiApiKey).trim();
      localStorage.setItem('aseel_gemini_key', _parentAiApiKey);
    }
  } catch(e){}
}
fetchParentAiKey();

$('aiFab').onclick = () => openAIForChild(kids.length ? kids[0] : null);
$('aiClose').onclick = () => $('aiWidget').classList.add('hidden');
$('aiMin').onclick = () => $('aiWidget').classList.toggle('minimized'); 
document.querySelectorAll('.ai-chip').forEach(c => c.onclick = () => { $('aiInput').value = c.dataset.q; sendAI(); });
$('aiSend').onclick = sendAI;
$('aiInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
});

function openAIForChild(child) {
  aiState.child = child; aiState.history = [];
  $('aiWidget').classList.remove('hidden');
  $('aiMessages').innerHTML = '';
  $('aiKeyWarn').classList.add('hidden');
  
  if (child) {
    $('aiContext').textContent = `الطفل: ${child.name} (${child._unit})`;
    const crDisplay = typeof child._crStr === 'string' && child._crStr.includes('/') ? child._crStr : (child._crStr || '10');
    appendMsg('sys', `أهلاً بك! أنا مساعد أسيل الطبي الخاص بـ **${child.name}** 🤖.\n- **وحدة القياس:** ${child._unit}\n- **معامل الكارب (CR):** ${crDisplay}\n- **معامل التصحيح (CF):** ${child._cf} ${child._unit}\n- **الهدف المستهدف:** ${child._limits.target} ${child._unit}\n\nكيف أساعدك اليوم في حساب الوجبات أو ضبط الجرعات؟`);
  } else {
    $('aiContext').textContent = 'استشارة عامة';
    appendMsg('sys', 'مرحباً بك! أنا مساعد أسيل الطبي الذكي. اسألني أي سؤال عن جرعات الأنسولين، حساب الكارب، أو تغذية السكري.');
  }
}

function appendMsg(role, txt, isDisclaimer = false) {
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : role === 'sys' ? 'sys' : 'assistant'}`;
  
  // تنسيق بسيط للخط العريض والأسطر
  let html = txt
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
    
  if (role === 'assistant' && !isDisclaimer) {
    html += '<div style="margin-top:8px; padding:6px 8px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; font-size:11px; color:#92400e; font-weight:600;">⚠️ تنبيه طبي: هذا الشات استرشادي ولا يغني عن مراجعة الطبيب.</div>';
  }

  div.innerHTML = html;
  $('aiMessages').appendChild(div);
  $('aiMessages').scrollTop = $('aiMessages').scrollHeight;
  return div;
}

function generateLocalParentReply(text, child) {
  const q = text.toLowerCase();
  const cName = child ? child.name : 'الطفل';
  const unit = child ? child._unit : 'mg/dL';
  
  // استخراج معامل الكارب النشط
  let activeCR = 10;
  if (child) {
    if (typeof child.carbRatio === 'number') activeCR = child.carbRatio;
    else if (child.cr) activeCR = Number(child.cr.lunch || child.cr.breakfast || child.cr.dinner || 10);
    else if (typeof child._crStr === 'string' && !child._crStr.includes('/')) activeCR = Number(child._crStr) || 10;
  }

  // سؤال عن الأرز / النشويات والوجبات
  if (/(ارز|أرز|رز)/.test(q)) {
    const carbsSmall = 30; // 5 ملاعق أرز
    const carbsMed = 45;   // طبق أرز متوسط (حوالي 150 جرام)
    const doseSmall = +(carbsSmall / activeCR).toFixed(1);
    const doseMed = +(carbsMed / activeCR).toFixed(1);

    return `### 🍚 حساب جرعة الأنسولين للأرز لـ **${cName}**:\n` +
      `- **طبق الأرز المتوسط (حوالي 150 جرام مطبوخ / 8 ملاعق كبيرة):** يحتوي على حوالي **40 إلى 45 جرام كارب**.\n` +
      `- **إذا كان طبق صغير (5 إلى 6 ملاعق كبيرة):** يحتوي على حوالي **25 إلى 30 جرام كارب**.\n\n` +
      `### 💉 الجرعة المقترحة بناءً على معامل الكارب (1 وحدة لكل ${activeCR}g):\n` +
      `- **لطبق الأرز المتوسط (45g كارب):** \`45 ÷ ${activeCR}\` = **${doseMed} وحدة** أنسولين سريع.\n` +
      `- **لطبق الأرز الصغير (30g كارب):** \`30 ÷ ${activeCR}\` = **${doseSmall} وحدة** أنسولين سريع.\n\n` +
      `💡 **نصائح هامة:**\n` +
      `1. قيسي سكر الطفل قبل الوجبة بوحدة **${unit}**؛ إذا كان مرتفعاً يتم إضافة جرعة تصحيح.\n` +
      `2. يُفضل إعطاء الأنسولين قبل تناول الأرز بـ **10 إلى 15 دقيقة** لتجنب الارتفاع المفاجئ بعد الأكل.\n` +
      `3. إضافة خضار وسلطة وبروتين مع الأرز يبطئ امتصاص النشويات ويمنع تذبذب السكر.`;
  }

  // سؤال عن المكرونة
  if (/(مكرون|مكرونة)/.test(q)) {
    const carbs = 40;
    const dose = +(carbs / activeCR).toFixed(1);
    return `### 🍝 حساب جرعة المكرونة لـ **${cName}**:\n` +
      `- طبق المكرونة المسلوقة المتوسط (حوالي كوب مسلوق) يحتوي على حوالي **35 إلى 40 جرام كارب**.\n` +
      `- **الجرعة المقترحة بمعامل الكارب (${activeCR}):** \`${carbs} ÷ ${activeCR}\` = **${dose} وحدة** أنسولين سريع.\n` +
      `- يُحقن الأنسولين قبل الأكل بـ 15 دقيقة ويُفضل تناول سلطة خضراء أولاً.`;
  }

  // سؤال عن الخبز / العيش
  if (/(خبز|عيش|توست|سندوتش)/.test(q)) {
    const doseBaladi = +(25 / activeCR).toFixed(1);
    return `### 🍞 حساب جرعة الخبز لـ **${cName}**:\n` +
      `- **نصف رغيف بلدي:** حوالي **25 إلى 28 جرام كارب** (الجرعة: **${doseBaladi} وحدة**).\n` +
      `- **شريحة توست بني:** حوالي **12 إلى 15 جرام كارب**.\n` +
      `- احسبي إجمالي الكارب واقسميه على معامل الكارب (${activeCR}).`;
  }

  // سؤال عام عن حساب الوجبة
  return `### 🧮 طريقة حساب جرعة الوجبة لـ **${cName}**:\n` +
    `- **القاعدة:** \`جرعة الأنسولين = إجمالي جرامات الكارب ÷ معامل الكارب (${activeCR})\`.\n` +
    `- **معامل الكارب الحالي للطفل:** 1 وحدة لكل **${activeCR} جرام نشويات**.\n` +
    `- اكتبي لي اسم الطعام أو عدد جرامات الكارب وسأحسب لك الجرعة فوراً!`;
}

async function sendAI() {
  const text = $('aiInput').value.trim();
  if(!text) return;
  $('aiInput').value = '';
  appendMsg('user', text);
  const waitEl = appendMsg('assistant', 'جاري التفكير ⏳...', true);
  $('aiSend').disabled = true;

  try {
    let reply = null;

    // محاولة الاتصال بـ Google Gemini إذا كان المفتاح متوفراً
    if (_parentAiApiKey) {
      const child = aiState.child;
      const cName = child ? child.name : 'الطفل';
      const cUnit = child ? child._unit : 'mg/dL';
      const cTarget = child ? child._limits.target : (cUnit === 'mmol/L' ? '6.0' : '110');
      const cCf = child ? child._cf : (cUnit === 'mmol/L' ? '2.8' : '50');
      const cCr = child ? child._crStr : '10';

      const sysPrompt = `أنت مساعد أسيل الطبي المتخصص في سكري الأطفال.
معطيات الطفل الحالية: الاسم (${cName})، وحدة القياس (${cUnit})، السكر المستهدف (${cTarget} ${cUnit})، معامل التصحيح (${cCf})، ومعامل الكارب (${cCr}).
أجب باللغة العربية بدقة وحسابات واضحة لجرامات الكارب وجرعة الأنسولين المطلوبة بوحدة ${cUnit}.`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(_parentAiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sysPrompt }] },
          contents: [{ parts: [{ text }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 600 }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    }

    // إذا لم يتوفر مفتاح أو فشل الاتصال الخارجي، نستخدم المحرك السريري الذكي المدمج
    if (!reply) {
      await new Promise(r => setTimeout(r, 350));
      reply = generateLocalParentReply(text, aiState.child);
    }

    waitEl.remove();
    appendMsg('assistant', reply);
  } catch(e) {
    console.warn('AI parent fallback:', e);
    waitEl.remove();
    const fallback = generateLocalParentReply(text, aiState.child);
    appendMsg('assistant', fallback);
  } finally {
    $('aiSend').disabled = false;
    $('aiInput')?.focus();
  }
}
