import { auth, db } from './firebase-config.js';
import { saveContextToStorage, getContextFromStorage } from './common-auth.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, collection, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ====== IDs from URL (with fallback) ====== */
const params = new URLSearchParams(location.search);
let parentId = params.get('parent');
let childId  = params.get('child');

// fallback من آخر سياق محفوظ
if (!parentId || !childId) {
  const ctx = getContextFromStorage();
  if (ctx) {
    parentId = ctx.parentId;
    childId  = ctx.childId;
  }
}
/* ====== Helpers / DOM ====== */
const $ = (id)=>document.getElementById(id);
const title = $('title'), meta = $('meta');
const msg   = $('msg');

/* ====== Auth Gate ====== */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  if(!parentId || !childId){ 
    alert('بيانات الرابط ناقصة'); 
    history.back(); 
    return; 
  }

  // خزن السياق دائمًا ليستفيد منه التحليل/التقرير لاحقًا
  try { saveContextToStorage(parentId, childId); } catch(e){}

  await loadChild();
  await loadMeals();
  await loadMeasurements();

  // ربط زر الحفظ
  const saveButton = $('saveBtn');
  if (saveButton) saveButton.onclick = saveEdits;

  // أزرار التحليل/التقرير
  initChildActions(parentId, childId);
});

/* ====== Load Child ====== */
async function loadChild(){
  const ref = doc(db, `parents/${parentId}/children/${childId}`);
  const s = await getDoc(ref);
  if(!s.exists()){ alert('الطفل غير موجود'); return; }
  const c = s.data();

  title.textContent = c.name || 'طفل';
  meta.textContent  = `${c.gender||'-'} • مواليد: ${c.birthDate||'-'}`;

  $('glucoseUnit').value       = c.glucoseUnit || 'mg/dL';
  $('carbRatio').value         = c.carbRatio ?? '';
  $('correctionFactor').value  = c.correctionFactor ?? '';
  $('bolusType').value         = c.bolusType || '';
  $('basalType').value         = c.basalType || '';
  $('nMin').value              = c.normalRange?.min ?? '';
  $('nMax').value              = c.normalRange?.max ?? '';

  $('bMin').value = c.carbTargets?.breakfast?.min ?? '';
  $('bMax').value = c.carbTargets?.breakfast?.max ?? '';
  $('lMin').value = c.carbTargets?.lunch?.min ?? '';
  $('lMax').value = c.carbTargets?.lunch?.max ?? '';
  $('dMin').value = c.carbTargets?.dinner?.min ?? '';
  $('dMax').value = c.carbTargets?.dinner?.max ?? '';
}

/* ====== Save Edits ====== */
async function saveEdits(){
  msg.textContent = 'جارٍ الحفظ…';
  const ref = doc(db, `parents/${parentId}/children/${childId}`);
  const payload = {
    glucoseUnit: $('glucoseUnit').value || null,
    carbRatio: Number($('carbRatio').value)||null,
    correctionFactor: Number($('correctionFactor').value)||null,
    bolusType: $('bolusType').value||null,
    basalType: $('basalType').value||null,
    normalRange: {
      min: Number($('nMin').value)||null,
      max: Number($('nMax').value)||null
    },
    carbTargets: {
      breakfast: { min: num($('bMin').value), max: num($('bMax').value) },
      lunch:     { min: num($('lMin').value), max: num($('lMax').value) },
      dinner:    { min: num($('dMin').value), max: num($('dMax').value) }
    },
    // معلومة الطبيب الحالي (قابلة لقراءتها في التقارير إن احتجتِ)
    assignedDoctorInfo: { uid: auth.currentUser?.uid || null }
  };
  try{
    await updateDoc(ref, payload);
    msg.textContent = 'تم الحفظ ✅';
  }catch(e){
    console.error(e);
    msg.textContent = 'تعذّر الحفظ (تحققي من الصلاحيات والقواعد).';
  }
}
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

/* ====== Load Meals ====== */
async function loadMeals(){
  const qy = query(
    collection(db, `parents/${parentId}/children/${childId}/meals`),
    orderBy('createdAt','desc'),
    limit(10)
  );
  const snap = await getDocs(qy);
  const tb = $('mealsTbl')?.querySelector('tbody');
  if (!tb) return;
  tb.innerHTML='';
  snap.forEach(s=>{
    const m = s.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.date||'-'}</td><td>${m.type||'-'}</td><td>${(m.totals?.carbs_g??0).toFixed(1)}</td><td>${m.suggestedMealDose??'-'}</td>`;
    tb.appendChild(tr);
  });
}

/* ====== Load Measurements ====== */
async function loadMeasurements(){
  const qy = query(
    collection(db, `parents/${parentId}/children/${childId}/measurements`),
    orderBy('when','desc'),
    limit(10)
  );
  const snap = await getDocs(qy);
  const tb = $('measTbl')?.querySelector('tbody');
  if (!tb) return;
  tb.innerHTML='';
  snap.forEach(s=>{
    const m = s.data();
    const dt = m.when?.toDate ? m.when.toDate() : (m.when? new Date(m.when): null);
    const dateStr = dt ? dt.toISOString().slice(0,10) : (m.date||'-');
    const timeStr = dt ? dt.toTimeString().slice(0,5) : '';
    const val = (m.value_mmol!=null) ? `${m.value_mmol.toFixed(1)} mmol/L`
              : (m.value_mgdl!=null? `${m.value_mgdl} mg/dL`:'-');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${dateStr}</td><td>${timeStr}</td><td>${m.slot||'-'}</td><td>${val}</td>`;
    tb.appendChild(tr);
  });
}

/* ====== New: Child actions (Analytics/Report) ====== */
function initChildActions(parentId, childId){
  const btnAnalytics = document.getElementById('btnOpenAnalytics');
  const btnReport    = document.getElementById('btnOpenReport');
  if (!btnAnalytics || !btnReport) return;

  const makeUrl = (page) =>
    `${page}?parentId=${encodeURIComponent(parentId)}&childId=${encodeURIComponent(childId)}`;

  btnAnalytics.onclick = () => window.open(makeUrl('analytics.html'), '_blank');
  btnReport.onclick    = () => window.open(makeUrl('reports-print.html'), '_blank');
}

/* … بقيّة كود doctor-child.js إن وُجد (أحداث/دوال إضافية) يبقى كما هو … */
