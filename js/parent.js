// js/parent.js — نسخة محسّنة
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, orderBy, doc, getDoc, writeBatch,
  updateDoc, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- عناصر الواجهة ---------- */
const kidsGrid   = document.getElementById('kidsGrid');
const emptyEl    = document.getElementById('empty');
const searchEl   = document.getElementById('search');
const loaderEl   = document.getElementById('loader');

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
const aiState = { child: null, history: [] };

/* ---------- أدوات عامة ---------- */
function loader(x) { loaderEl?.classList.toggle('hidden', !x); }

function esc(s) {
  return (s ?? '').toString()
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", "&#039;");
}

function calcAge(bd) {
  if (!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}

function avatarColor(i) {
  const c = ['#42A5F5','#7E57C2','#66BB6A','#FFA726','#26C6DA','#EC407A','#8D6E63'];
  return c[i % c.length];
}

function normArabic(s = '') {
  return s.toString()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function currentMealTime() {
  const h = new Date().getHours();
  if (h >= 5  && h < 10) return { key: 'b', label: 'الفطور' };
  if (h >= 12 && h < 15) return { key: 'l', label: 'الغداء' };
  if (h >= 18 && h < 21) return { key: 'd', label: 'العشاء' };
  return { key: 's', label: 'سناك' };
}

/* ---------- تحميل الأطفال ---------- */
onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = 'index.html'; return; }
  currentUser = u;
  await loadKids();
});

searchEl?.addEventListener('input', () => {
  const q = normArabic(searchEl.value);
  filtered = q ? kids.filter(k => normArabic(k.name || '').includes(q)) : kids;
  render();
});

async function loadKids() {
  loader(true);
  try {
    const ref  = collection(db, `parents/${currentUser.uid}/children`);
    const qy   = query(ref, orderBy('name', 'asc'));
    const snap = await getDocs(qy);
    kids = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // جلب آخر قراءة لكل طفل
    await Promise.all(kids.map(k => enrichWithLastReading(k)));

    filtered = kids;
    render();
  } catch (e) {
    console.error(e);
    alert('تعذّر تحميل قائمة الأطفال');
  } finally {
    loader(false);
  }
}

/* جلب آخر قراءة جلوكوز للطفل */
async function enrichWithLastReading(child) {
  try {
    const ref  = collection(db, `parents/${currentUser.uid}/children/${child.id}/measurements`);
    const qy   = query(ref, orderBy('recordedAt', 'desc'), limit(1));
    const snap = await getDocs(qy);
    if (!snap.empty) {
      const d = snap.docs[0].data();
      child._lastGlucose    = d.glucose ?? d.value ?? null;
      child._lastGlucoseAt  = d.recordedAt ?? null;
      child._lastGlucoseUnit = d.unit ?? child.glucoseUnit ?? 'mmol/L';
    }
  } catch { /* تجاهل لو الـ subcollection فارغة */ }
}

/* ---------- حساب حالة الجلوكوز ---------- */
function glucoseStatus(child) {
  const v = child._lastGlucose;
  if (v == null) return null;
  const r = child.normalRange || {};
  const critLow  = r.criticalLow  ?? child.criticalLow  ?? 3.0;
  const critHigh = r.criticalHigh ?? child.criticalHigh ?? 14.0;
  const low       = r.min          ?? child.hypo         ?? 3.9;
  const high      = r.max          ?? child.hyper        ?? 10.0;

  if (v <= critLow)  return { label: `⚠️ حرج منخفض جداً: ${v}`,  cls: 'critical-low',  alert: true };
  if (v >= critHigh) return { label: `⚠️ حرج مرتفع جداً: ${v}`,  cls: 'critical-high', alert: true };
  if (v < low)       return { label: `↓ منخفض: ${v}`,            cls: 'low',           alert: false };
  if (v > high)      return { label: `↑ مرتفع: ${v}`,            cls: 'high',          alert: false };
  return               { label: `✓ طبيعي: ${v}`,                  cls: 'ok',            alert: false };
}

/* ---------- عرض البطاقات ---------- */
function render() {
  kidsGrid.innerHTML = '';
  if (!filtered.length) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  filtered.forEach((k, idx) => {
    const linked  = !!k.assignedDoctor;
    const consent = (k.sharingConsent === true) ||
                    (k.sharingConsent && k.sharingConsent.doctor === true);

    const badge = linked
      ? `<span class="badge ${consent ? 'ok' : 'warn'}">${consent ? 'مرتبط بطبيب ✓' : 'مرتبط — الموافقة موقوفة'}</span>`
      : `<span class="badge">غير مرتبط بطبيب</span>`;

    // بطاقة آخر قراءة
    const gs = glucoseStatus(k);
    let glucoseBadge = '';
    if (gs) {
      const alertStyle = gs.alert
        ? 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;animation:pulse 1.5s infinite;'
        : gs.cls === 'ok'
          ? 'background:#d1fae5;color:#065f46;'
          : 'background:#fef3c7;color:#92400e;';
      glucoseBadge = `<div class="glucose-badge" style="margin-top:8px;padding:6px 10px;border-radius:8px;font-size:13px;font-weight:600;${alertStyle}">${gs.label} ${k._lastGlucoseUnit || ''}</div>`;
    }

    // نسبة الكربوهيدرات حسب وقت الأكل الحالي
    const meal = currentMealTime();
    const crNow = k.carbRatioByMeal?.[meal.key] ?? k.carbRatio ?? '—';
    const cfNow = k.correctionFactorByMeal?.[meal.key] ?? k.correctionFactor ?? '—';

    const card = document.createElement('div');
    card.className = 'kid card';
    card.innerHTML = `
      <div class="kid-head">
        <div class="avatar" style="background:${avatarColor(idx)}">${esc((k.name || '?').charAt(0))}</div>
        <div>
          <div class="name">${esc(k.name || 'طفل')}</div>
          <div class="meta">${esc(k.gender || '-')} • العمر: ${calcAge(k.birthDate)} سنة</div>
          ${badge}
        </div>
      </div>

      ${glucoseBadge}

      <div class="chips" style="margin-top:8px;">
        <span class="chip" title="نسبة الكربوهيدرات — ${meal.label}">CR (${meal.label}): ${crNow}</span>
        <span class="chip" title="عامل التصحيح — ${meal.label}">CF (${meal.label}): ${cfNow}</span>
        ${k.insulin?.bolusType ? `<span class="chip">💉 ${esc(k.insulin.bolusType)}</span>` : ''}
      </div>

      <div class="kid-actions">
        <a class="btn primary kid-open" href="child.html?child=${encodeURIComponent(k.id)}">📂 فتح لوحة الطفل</a>
        <button class="btn kid-ai" data-id="${k.id}">🤖 مساعد هذا الطفل</button>
      </div>
    `;

    card.querySelector('.kid-ai')?.addEventListener('click', (e) => {
      e.preventDefault();
      openAIForChild(k);
    });

    // تنبيه صوتي/بصري للقراءات الحرجة
    if (gs?.alert) showCriticalAlert(k, gs);

    kidsGrid.appendChild(card);
  });
}

/* ---------- تنبيه القراءات الحرجة ---------- */
function showCriticalAlert(child, gs) {
  // تجنب تكرار التنبيه في نفس الجلسة
  const key = `alert_${child.id}`;
  if (sessionStorage.getItem(key) === String(child._lastGlucose)) return;
  sessionStorage.setItem(key, String(child._lastGlucose));

  const div = document.createElement('div');
  div.style.cssText = `
    position:fixed; top:20px; left:50%; transform:translateX(-50%);
    background:#dc2626; color:#fff; padding:14px 20px; border-radius:12px;
    font-size:15px; font-weight:700; z-index:9999; direction:rtl;
    box-shadow:0 8px 24px rgba(220,38,38,0.4); cursor:pointer;
    max-width:90vw; text-align:center;
  `;
  div.textContent = `🚨 ${child.name}: ${gs.label} ${child._lastGlucoseUnit || ''} — يحتاج تدخلاً فورياً`;
  div.onclick = () => div.remove();
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 8000);
}

/* ---------- حوار ربط الدكتور ---------- */
linkOpen?.addEventListener('click', () => {
  linkMsg.textContent = ''; linkInput.value = ''; linkDlg.showModal();
});
linkCancel?.addEventListener('click', () => linkDlg.close());
linkSubmit?.addEventListener('click', linkDoctor);

async function fetchDoctorInfo(doctorUid) {
  const d1 = await getDoc(doc(db, `doctors/${doctorUid}`));
  if (d1.exists()) {
    const x = d1.data();
    return { uid: doctorUid, name: x.name||null, specialty: x.specialty||null, clinic: x.clinic||null, phone: x.phone||null };
  }
  const d2 = await getDoc(doc(db, `users/${doctorUid}`));
  if (d2.exists()) {
    const x = d2.data();
    return { uid: doctorUid, name: x.displayName||null, specialty: x.specialty||null, clinic: x.clinic||null, phone: x.phone||null };
  }
  return { uid: doctorUid };
}

async function linkDoctor() {
  const code = (linkInput.value || '').trim().toUpperCase();
  if (!code) { linkMsg.textContent = 'أدخلي الكود.'; return; }
  loader(true); linkMsg.textContent = 'جارٍ التحقق…';

  try {
    const codeRef = doc(db, 'linkCodes', code);
    const s = await getDoc(codeRef);
    if (!s.exists()) { linkMsg.textContent = 'الكود غير موجود.'; return; }
    const d = s.data();
    if (d.used) { linkMsg.textContent = 'الكود مستخدم مسبقًا.'; return; }

    const doctorId = d.doctorId;
    const info     = await fetchDoctorInfo(doctorId);

    const ref  = collection(db, `parents/${currentUser.uid}/children`);
    const snap = await getDocs(ref);
    if (snap.empty) { linkMsg.textContent = 'لا يوجد أطفال لربطهم.'; return; }

    const batch = writeBatch(db);
    snap.forEach(docu => {
      batch.update(docu.ref, {
        assignedDoctor: doctorId,
        assignedDoctorInfo: {
          uid: info.uid,
          name: info.name || null,
          specialty: info.specialty || null,
          clinic: info.clinic || null,
          phone: info.phone || null,
          linkedAt: serverTimestamp()
        },
        sharingConsent: true
      });
    });

    batch.update(codeRef, {
      used: true,
      parentId: currentUser.uid,
      usedAt: serverTimestamp(),
      doctorId: d.doctorId
    });

    await batch.commit();
    linkMsg.textContent = 'تم الربط ✅';
    await loadKids();
    setTimeout(() => linkDlg.close(), 700);
  } catch (e) {
    console.error(e);
    linkMsg.textContent = 'فشل الربط. تحققي من الصلاحيات والاتصال.';
  } finally {
    loader(false);
  }
}

/* =====================================================
   المساعد الذكي — محسّن بالسياق الكامل للطفل
   ===================================================== */

function buildChildContext(child) {
  if (!child || !child.id) return '';

  const meal = currentMealTime();
  const crNow = child.carbRatioByMeal?.[meal.key] ?? child.carbRatio ?? '—';
  const cfNow = child.correctionFactorByMeal?.[meal.key] ?? child.correctionFactor ?? '—';
  const nr    = child.normalRange || {};

  const lines = [
    `== بيانات الطفل ==`,
    `الاسم: ${child.name || '—'}`,
    `العمر: ${calcAge(child.birthDate)} سنة`,
    `الجنس: ${child.gender === 'female' ? 'أنثى' : 'ذكر'}`,
    `الوزن: ${child.weightKg ?? child.weight ?? '—'} كجم`,
    `الطول: ${child.heightCm ?? child.height ?? '—'} سم`,
    ``,
    `== نسب الأنسولين ==`,
    `وقت الأكل الحالي: ${meal.label}`,
    `CR (نسبة الكربوهيدرات الآن): ${crNow}`,
    `CF (عامل التصحيح الآن): ${cfNow}`,
    `CR الإفطار: ${child.carbRatioByMeal?.b ?? child.cr_breakfast ?? '—'}`,
    `CR الغداء: ${child.carbRatioByMeal?.l ?? child.cr_lunch ?? '—'}`,
    `CR العشاء: ${child.carbRatioByMeal?.d ?? child.cr_dinner ?? '—'}`,
    `CR السناك: ${child.carbRatioByMeal?.s ?? child.cr_snack ?? '—'}`,
    ``,
    `== مستهدفات الكربوهيدرات ==`,
    `الإفطار: ${child.carbTargets?.breakfast?.min ?? '—'} – ${child.carbTargets?.breakfast?.max ?? '—'} جرام`,
    `الغداء: ${child.carbTargets?.lunch?.min ?? '—'} – ${child.carbTargets?.lunch?.max ?? '—'} جرام`,
    `العشاء: ${child.carbTargets?.dinner?.min ?? '—'} – ${child.carbTargets?.dinner?.max ?? '—'} جرام`,
    ``,
    `== نطاق الجلوكوز ==`,
    `المستوى الطبيعي: ${nr.min ?? child.hypo ?? '—'} – ${nr.max ?? child.hyper ?? '—'} ${child.glucoseUnit || 'mmol/L'}`,
    `منخفض حرج: ${nr.criticalLow ?? child.criticalLow ?? '—'}`,
    `مرتفع حرج: ${nr.criticalHigh ?? child.criticalHigh ?? '—'}`,
    child._lastGlucose != null
      ? `آخر قراءة جلوكوز: ${child._lastGlucose} ${child._lastGlucoseUnit || ''}` : '',
    ``,
    `== الأنسولين ==`,
    `نوع البازال: ${child.insulin?.basalType ?? child.basalType ?? '—'}`,
    `نوع البولوس: ${child.insulin?.bolusType ?? child.bolusType ?? '—'}`,
    `جرعة اللانج-آكتينج: ${child.longActingDose?.units ?? '—'} وحدة (${child.longActingDose?.insulin ?? '—'})`,
    ``,
    `== تفضيلات الغذاء ==`,
    `قاعدة صافي الكارب: ${child.netCarbRule || '—'}`,
    `استخدام صافي الكارب: ${child.useNetCarbs ? 'نعم' : 'لا'}`,
  ].filter(Boolean).join('\n');

  return lines;
}

const AI_SYSTEM_PROMPT = `أنت مساعد طبي متخصص في إدارة مرض السكري من النوع الأول لدى الأطفال.
مهمتك مساعدة الأهل في:
- حساب جرعات الأنسولين بدقة (بولوس الوجبة وبولوس التصحيح)
- تفسير قراءات الجلوكوز
- تقديم نصائح غذائية مناسبة لمريض السكر
- الإجابة على أسئلة إدارة السكري اليومية

قواعد مهمة:
1. استخدم دائماً بيانات الطفل المُقدَّمة (CR, CF, نطاق الجلوكوز) في إجاباتك
2. احسب بولوس الوجبة = الكارب ÷ CR
3. احسب بولوس التصحيح = (الجلوكوز الحالي - المستهدف) ÷ CF
4. نبّه دائماً إذا كانت القراءة حرجة (منخفضة أو مرتفعة جداً)
5. أجب بالعربية بأسلوب واضح ومبسط للأهل
6. في الحالات الطارئة، أوصِ بالتواصل مع الطبيب فوراً
7. لا تقدم تشخيصات طبية — أنت مساعد للمعلومات والحسابات فقط`;

function openAIWidget() { aiWidget.classList.remove('hidden'); }
function closeAIWidget() {
  aiWidget.classList.add('hidden');
  aiMessages.innerHTML = '';
  aiState.child = null;
  aiState.history = [];
  aiContext.textContent = 'بدون سياق طفل';
}

function appendMsg(role, text) {
  const d = document.createElement('div');
  d.className = role === 'assistant' ? 'msg assistant'
              : role === 'system'    ? 'msg sys'
              : 'msg user';
  // دعم بسيط للنص المنسّق
  d.innerHTML = text.replace(/\n/g, '<br>');
  aiMessages.appendChild(d);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  return d;
}

function openAIForChild(child) {
  aiState.child   = child;
  aiState.history = [];
  openAIWidget();

  const key = window.GEMINI_API_KEY;
  aiKeyWarn.style.display = (!key || key === 'YOUR_GEMINI_API_KEY') ? 'block' : 'none';

  if (child?.id) {
    aiContext.textContent = `سياق: ${child.name || 'طفل'}`;
    const gs = glucoseStatus(child);
    const glucoseInfo = gs
      ? `\nآخر قراءة: ${gs.label} ${child._lastGlucoseUnit || ''}`
      : '';
    appendMsg('system',
      `مرحباً! أنا مساعدك لمتابعة ${child.name || 'الطفل'}.${glucoseInfo}\n` +
      `CR الآن (${currentMealTime().label}): ${child.carbRatioByMeal?.[currentMealTime().key] ?? child.carbRatio ?? '—'} | ` +
      `CF: ${child.correctionFactorByMeal?.[currentMealTime().key] ?? child.correctionFactor ?? '—'}\n` +
      `اسألني عن الجرعة، الغذاء، أو أي شيء عن مرض السكري.`
    );
  } else {
    aiContext.textContent = 'بدون سياق طفل';
    appendMsg('system', 'اختر طفلاً من البطاقات أو اسألني سؤالاً عاماً عن السكري.');
  }
}

async function callGemini(userText) {
  const childCtx = buildChildContext(aiState.child);

  // محاولة الـ Backend أولاً (لو مفعّل)
  if (auth?.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      const r = await fetch('/api/aiChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          systemText: AI_SYSTEM_PROMPT,
          childContext: childCtx,
          history: aiState.history,
          userText,
          model: 'gemini-1.5-flash'
        })
      });
      if (r.ok) {
        const data = await r.json();
        return data.text || 'لم يصل رد.';
      }
    } catch { /* سيستخدم المفتاح المحلي */ }
  }

  // استخدام مفتاح محلي (للاختبار فقط)
  const KEY = window.GEMINI_API_KEY;
  if (!KEY || KEY === 'YOUR_GEMINI_API_KEY') throw new Error('مفتاح Gemini غير مضبوط.');

  const { GoogleGenerativeAI } = window;
  const genAI = new GoogleGenerativeAI(KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: AI_SYSTEM_PROMPT + (childCtx ? `\n\n${childCtx}` : '')
  });

  // إرسال التاريخ الكامل للمحادثة (ذاكرة)
  const chat = model.startChat({ history: aiState.history });
  const res  = await chat.sendMessage(userText);
  return res.response.text();
}

async function sendAI() {
  const text = aiInput.value.trim();
  if (!text) return;
  aiInput.value = '';
  appendMsg('user', text);

  const waitEl = appendMsg('assistant', '… جارٍ التفكير');
  aiSend.disabled = true;

  try {
    const reply = await callGemini(text);

    // حفظ التاريخ للمحادثة المتعددة
    aiState.history.push(
      { role: 'user',      parts: [{ text }] },
      { role: 'model',     parts: [{ text: reply }] }
    );
    // الحد الأقصى للتاريخ — 10 رسائل (5 جولات)
    if (aiState.history.length > 10) aiState.history = aiState.history.slice(-10);

    waitEl.remove();
    appendMsg('assistant', reply);
  } catch (e) {
    waitEl.remove();
    appendMsg('assistant', '⚠️ تعذّر الاتصال بالمساعد. تأكد من المفتاح أو الاتصال.');
    console.error(e);
    aiKeyWarn.style.display = 'block';
  } finally {
    aiSend.disabled = false;
    aiInput.focus();
  }
}

/* ---------- أحداث المساعد ---------- */
aiFab?.addEventListener('click', () => openAIForChild(aiState.child || {}));
aiClose?.addEventListener('click', closeAIWidget);
aiMin?.addEventListener('click', () => aiWidget.classList.toggle('hidden'));
aiSend?.addEventListener('click', sendAI);
aiInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
});
quickBtns.forEach(b => b.addEventListener('click', () => {
  aiInput.value = b.dataset.q || '';
  sendAI(); // إرسال مباشر بدلاً من مجرد الكتابة
}));
