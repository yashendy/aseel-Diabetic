// measurements.js — نسخة نهائية مُراجَعة (محدّث: خانة التصحيح مفتوحة + تعبئة تلقائية)
import { auth, db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, addDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => (s??'').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const round1 = n => Math.round((Number(n)||0)*10)/10;
const todayISO = () => new Date().toISOString().slice(0,10);
const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const mgdl2mmol = mg => mg/18;
const mmol2mgdl = mmol => mmol*18;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(()=>t.style.display='none',2200); }

/* ---------- Normalize state to Arabic ---------- */
function normalizeState(s){
  if(!s) return s;
  const t = String(s).trim().toLowerCase();
  if (t==='normal' || t==='in range' || t==='in-range' || t==='range' || s==='داخل النطاق' || s==='طبيعي') return 'داخل النطاق';
  if (t==='low' || s==='هبوط') return 'هبوط';
  if (t==='high' || s==='ارتفاع') return 'ارتفاع';
  if (t==='severe high' || s==='ارتفاع شديد') return 'ارتفاع شديد';
  if (t==='critical low' || s==='هبوط حرج') return 'هبوط حرج';
  if (t==='critical high' || s==='ارتفاع حرج') return 'ارتفاع حرج';
  return s;
}

/* ---------- DOM Refs (مختصر) ---------- */
let dayPicker, slotSel, readingInp, unitSel, convertedBox, stateBadge, corrDoseView;
let childNameEl, childMetaEl, chipsBar, targetsChips, backToChildBtn;
let gridEl, emptyEl, sortSel, liveToggle, toMealsBtn, saveBtn, exportCsvBtn, exportXlsxBtn;
let filtersBar, searchBox, statsBar, sparklineBox, undoBtn, redoBtn, autoSlotToggle;
let actionsPanel, alertBarEl, corrRow, corrDoseInput, useAutoCorr, hypoRow, hypoInput, notesRow, notesInput;
let lastComputedCorr = 0;

let currentUser=null, childRef=null, childData=null, measCol=null, unsubscribe=null;
let cache=[];    // كل قياسات اليوم (عرض سريع)

/* ---------- Boot ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.replace('index.html'); return; }
  currentUser=user;
  wireDom(); injectUI(); ensureActionPanel();
  await loadChild(user.uid); applyChildUI();
  dayPicker.value = dayPicker.value || todayISO();
  unitSel.value = (childData?.glucoseUnit || 'mg/dL');
  await refreshList(); wireEvents(); updateDerived();
});

/* ---------- Wire base DOM ---------- */
function wireDom(){
  dayPicker=$('dayPicker'); slotSel=$('slotKey'); readingInp=$('reading'); unitSel=$('unitSel');
  convertedBox=$('converted'); stateBadge=$('stateBadge'); corrDoseView=$('corrDoseView');
  childNameEl=$('childName'); childMetaEl=$('childMeta'); chipsBar=$('therapyChips'); targetsChips=$('targetsChips');
  gridEl=$('grid'); emptyEl=$('empty'); sortSel=$('sortSel'); liveToggle=$('liveToggle');
  toMealsBtn=$('toMeals'); saveBtn=$('saveBtn'); exportCsvBtn=$('exportCsvBtn'); exportXlsxBtn=$('exportXlsxBtn');
  backToChildBtn=$('backToChild');
}

/* ---------- Inject UI (filters + stats + undo/redo) ---------- */
// ... (باقي الكود كما عندك بدون تغيير)

/* ---------- Action Panel ---------- */
function ensureActionPanel(){
  if($('actionsPanel')){ actionsPanel=$('actionsPanel'); return; }
  const toolbar=document.querySelector('.toolbar');
  actionsPanel=document.createElement('div'); actionsPanel.id='actionsPanel';
  actionsPanel.innerHTML=`
    <div id="alertBar" class="alert" style="display:none;"></div>

    <div id="corrRow" class="row-actions" style="display:none;">
      <label class="field"><span>جرعة التصحيح</span><input id="corrDoseInput" type="number" step="0.5" min="0" placeholder="مثال: 1.5"></label>
      <!-- افتراضيًا غير مُفعّل: نريد الحقل مفتوح ويمكن تعديله -->
      <label class="field check"><input id="useAutoCorr" type="checkbox"><span>استخدام الحسابي (قفل القراءة)</span></label>
    </div>

    <div id="hypoRow" class="row-actions" style="display:none;">
      <label class="field" style="grid-column:1/-1;"><span>رفعنا بإيه؟</span><input id="hypoTreatment" type="text" placeholder="مثال: جلوكوز 15جم / عصير 100مل / تمر"></label>
      <div class="chips">
        <button class="chip chip-suggest" data-val="جلوكوز 15جم">جلوكوز 15جم</button>
        <button class="chip chip-suggest" data-val="عصير 100مل">عصير 100مل</button>
        <button class="chip chip-suggest" data-val="٣ تمرات">٣ تمرات</button>
      </div>
    </div>

    <div id="notesRow" class="row-actions"><label class="field" style="grid-column:1/-1;"><span>ملاحظات</span><textarea id="mNotes" rows="2" placeholder="تفاصيل الوجبة/النشاط/ملاحظات إضافية"></textarea></label></div>
  `;
  toolbar.after(actionsPanel);

  alertBarEl=$('alertBar'); corrRow=$('corrRow'); corrDoseInput=$('corrDoseInput'); useAutoCorr=$('useAutoCorr');
  hypoRow=$('hypoRow'); hypoInput=$('hypoTreatment'); notesRow=$('notesRow'); notesInput=$('mNotes');

  actionsPanel.querySelectorAll('.chip-suggest').forEach(btn=>btn.addEventListener('click',()=>{ hypoInput.value=btn.dataset.val; }));
  // تبديل وضع الحسابي: عند التفعيل نقفل الحقل ونملأه، عند الإلغاء نفتح الحقل
  useAutoCorr.addEventListener('change',()=>{
    if(useAutoCorr.checked){
      corrDoseInput.value=String(round1(Math.max(0,lastComputedCorr)));
      corrDoseInput.setAttribute('readonly','readonly');
    }else{
      corrDoseInput.removeAttribute('readonly');
      corrDoseInput.value=String(round1(Math.max(0,lastComputedCorr))); // يظل مُعبّأً بالقيمة المقترحة
      corrDoseInput.focus();
    }
  });
}
const show = e => { if(e) e.style.display='grid'; };
const hide = e => { if(e) e.style.display='none'; };
function setAlert(kind,msg){ if(!alertBarEl) return; if(!kind){ alertBarEl.style.display='none'; return; } alertBarEl.className='alert '+(kind==='danger'?'alert--danger':(kind==='warn'?'alert--warn':'alert--ok')); alertBarEl.textContent=msg||''; alertBarEl.style.display='block'; }

/* ---------- تقدير الحالة + تهيئة صفوف الإجراء ---------- */
// … حساب الحالة كما في نسختك …
function onStateComputed(state, valueInChildUnit, upper){
  const st = normalizeState(state);
  const cf=Number(childData?.correctionFactor)||0;
  let corr=0; if(cf>0 && Number.isFinite(upper) && valueInChildUnit>upper) corr=(valueInChildUnit-upper)/cf;
  lastComputedCorr=corr;

  ensureActionPanel(); setAlert(null,null);
  if(st==='هبوط' || st==='هبوط حرج'){
    show(hypoRow); hide(corrRow);
    setAlert(st==='هبوط حرج'?'danger':'warn', st==='هبوط حرج'?'فضلاً ابدأ معالجة الهبوط فورًا':'فضلاً قم بمعالجة الهبوط ثم دوّن ما استُخدم للرفع.');
  }
  else if(st==='ارتفاع' || st==='ارتفاع شديد' || st==='ارتفاع حرج'){
    hide(hypoRow); show(corrRow);
    // التغيير المطلوب: الحقل مفتوح افتراضيًا + مُعبّأ بالقيمة المقترحة + صندوق "الحسابي" غير مُفعل
    if(useAutoCorr){ useAutoCorr.checked=false; }
    corrDoseInput.removeAttribute('readonly');
    corrDoseInput.value=String(round1(Math.max(0,corr)));
    setAlert(st==='ارتفاع حرج'?'danger':(st==='ارتفاع شديد'?'warn':null), st==='ارتفاع شديد'?'القراءة أعلى من حد الارتفاع الشديد.':null);
  }
  else{
    hide(hypoRow); hide(corrRow);
  }
  show(notesRow);

  // عرض القراءة المقترحة لأغراض معلوماتية (badge)
  if(corrDoseView) corrDoseView.textContent=String(round1(Math.max(0,corr)));
}

/* ---------- حفظ ---------- */
async function saveMeasurement(){
  const unit=unitSel.value; const v=Number(readingInp.value);
  if(!Number.isFinite(v)){ toast('أدخل قراءة صحيحة'); return; }

  const dateStr=dayPicker.value||todayISO();
  const when=new Date(`${dateStr}T${new Date().toTimeString().slice(0,8)}`);

  const value_mmol = unit==='mmol/L'? v : mgdl2mmol(v);
  const value_mgdl = unit==='mg/dL'? v : mmol2mgdl(v);

  const childUnit=childData?.glucoseUnit||'mg/dL';
  const valInChild = childUnit===unit ? v : (childUnit.includes('mmol') ? mgdl2mmol(v) : mmol2mgdl(v));
  const upper=getTargetUpper(); const cf=Number(childData?.correctionFactor)||0;

  let correctionDose=0; if(cf>0 && Number.isFinite(upper) && valInChild>upper) correctionDose=(valInChild-upper)/cf;
  // إذا الصف ظاهر وافتراضيًا نسمح بالتعديل — خُذ قيمة الحقل إن كانت صالحة
  if(corrRow && corrRow.style.display!=='none' && corrDoseInput){
    const mv=Number(corrDoseInput.value); if(Number.isFinite(mv)) correctionDose=mv;
  }

  const notes=(notesInput?.value||'').trim()||null;
  const hypoTreatment=(hypoInput?.value||'').trim()||null;

  const payload={
    value:v, unit,
    value_mmol:round1(value_mmol), value_mgdl:round1(value_mgdl),
    when, slotKey:slotSel.value, slotOrder:slotOrder(slotSel.value),
    state: inferState(valInChild,childUnit),
    correctionDose: round1(Math.max(0,correctionDose)),
    hypoTreatment: hypoTreatment||null, notes,
    createdAt: serverTimestamp()
  };

  const ref=await addDoc(measCol,payload);
  lastOps.push({id:ref.id,data:payload}); redoStack=[];
  toast('تم حفظ القياس ✔️'); readingInp.value=''; updateDerived();
}

/* ---------- باقي الملف كما هو (قوائم/إحصاءات/تصدير/تراجع/إلخ) ---------- */
// … احتفظنا بكل بقية الكود دون تغيير وظيفي …
