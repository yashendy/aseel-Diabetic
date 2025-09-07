// meals.js — نسخة كاملة مع: أيقونات + Targets + AI + حفظ/تحميل Firestore
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, deleteDoc, doc, getDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ========== عناصر DOM ========== */
const mealFilter = document.getElementById('mealFilter');
const searchInput= document.getElementById('searchInput');
const resetBtn   = document.getElementById('resetBtn');

const presetGrid = document.getElementById('presetGrid');
const pickerGrid = document.getElementById('pickerGrid');
const itemsBody  = document.getElementById('itemsBody');
const savedBody  = document.getElementById('savedBody');

const dateInput  = document.getElementById('dateInput');
const chipDate   = document.getElementById('chipDate');

const targetCarb    = document.getElementById('targetCarb');
const targetProtein = document.getElementById('targetProtein');
const targetFat     = document.getElementById('targetFat');
const targetKcal    = document.getElementById('targetKcal');

const applyTargetsBtn = document.getElementById('applyTargetsBtn');
const toggleAiBtn     = document.getElementById('toggleAiBtn');
const aiPanel         = document.getElementById('aiPanel');
const aiCarbGoal      = document.getElementById('aiCarbGoal');
const aiSuggestBtn    = document.getElementById('aiSuggestBtn');
const aiRandomBtn     = document.getElementById('aiRandomBtn');
const aiOut           = document.getElementById('aiOut');

const saveDayBtn = document.getElementById('saveDayBtn');

const sumCarb = document.getElementById('sumCarb');
const sumProtein = document.getElementById('sumProtein');
const sumFat = document.getElementById('sumFat');
const sumKcal = document.getElementById('sumKcal');

/* ========== State ========== */
let currentUser = null;
let childId = null;
let childData = null;   // settings (targets, units, ...)
let presets = [];       // وجبات جاهزة كاملة
let library = [];       // مكتبة أصناف كاملة

/* ========== Utils ========== */
const qs = new URLSearchParams(location.search);
function todayStr(d=new Date()) { return d.toISOString().slice(0,10); }
function setTextSafe(el, text){
  if (!el) return;
  el.textContent = text;
}
function el(tag, cls, html){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html!=null) e.innerHTML = html;
  return e;
}

/* ========== بيانات مبدئية (تُستبدل ببياناتك) ========== */
function seedPresetsAndLibrary(){
  presets = [
    { id:'prs-1', title:'فطار بسيط', icon:'images/eggs.png', desc:'بيض + خبز + حليب', nutrients:{ carb:25, protein:18, fat:12, kcal:320 } },
    { id:'prs-2', title:'سلطة تونة', icon:'images/tuna.png', desc:'تونة + خضار + زيت', nutrients:{ carb:12, protein:22, fat:10, kcal:260 } },
    { id:'prs-3', title:'رز ودجاج',  icon:'images/rice.png', desc:'أرز + دجاج + سلطة', nutrients:{ carb:55, protein:26, fat:9, kcal:520 } },
  ];
  library = [
    { id:'it-1', title:'بيض مسلوق', cat:'protein', icon:'images/eggs.png',  unit:'حبة',  base:1,   nutrients:{ carb:1,  protein:6,   fat:5,  kcal:78 } },
    { id:'it-2', title:'أرز أبيض',   cat:'carb',    icon:'images/rice.png',  unit:'جرام', base:100, nutrients:{ carb:28, protein:2.7, fat:0.3,kcal:130 } },
    { id:'it-3', title:'تفاح',       cat:'fruit',   icon:'images/apple.png', unit:'حبة',  base:1,   nutrients:{ carb:19, protein:0.3, fat:0.2,kcal:95 } },
    { id:'it-4', title:'زيت زيتون',  cat:'fat',     icon:'images/oil.png',   unit:'ملعقة',base:1,   nutrients:{ carb:0,  protein:0,   fat:14, kcal:119 } },
  ];
}

/* ========== Render Presets & Library ========== */
function renderPresets(){
  presetGrid.innerHTML = '';
  presets.forEach(p=>{
    const card = el('div','preset-card', `
      <div class="preset-top">
        <div class="thumb"><img src="${p.icon}" alt="${p.title}"></div>
        <h3 class="title">${p.title}</h3>
      </div>
      <div class="preset-body">${p.desc}</div>
    `);
    card.title = p.title;
    card.tabIndex = 0;
    card.addEventListener('click', ()=> addItem({
      title:p.title, qty:1, unit:'وجبة', nutrients:p.nutrients
    }));
    presetGrid.appendChild(card);
  });
}

function renderLibrary(){
  const q = (searchInput.value||'').trim().toLowerCase();
  const f = (mealFilter.value || 'all');
  pickerGrid.innerHTML = '';

  library
    .filter(x=> f==='all' || x.cat===f)
    .filter(x=> !q || x.title.toLowerCase().includes(q))
    .forEach(it=>{
      const card = el('div','pick-card');
      card.title = it.title; card.tabIndex = 0;

      const th = el('div','pick-thumb');
      const img = el('img'); img.src = it.icon; img.alt = it.title;
      th.appendChild(img);
      const meta = el('div','pick-meta');
      meta.innerHTML = `<h4 class="pick-title">${it.title}</h4><span class="badge">${it.cat}</span>`;

      card.appendChild(th);
      card.appendChild(meta);
      card.addEventListener('click', ()=>{
        addItem({ title: it.title, qty: it.base, unit: it.unit, nutrients: it.nutrients });
      });
      pickerGrid.appendChild(card);
    });
}

/* ========== Items (اختيارات اليوم) ========== */
function addItem({title, qty, unit, nutrients}){
  const row = el('div','row');
  row.innerHTML = `
    <div>${title}</div>
    <div><input type="number" step="1" value="${qty}" class="qty" aria-label="الكمية"></div>
    <div>${unit}</div>
    <div class="n-carb">${nutrients.carb}</div>
    <div class="n-protein">${nutrients.protein}</div>
    <div class="n-fat">${nutrients.fat}</div>
    <div class="n-kcal">${nutrients.kcal}</div>
    <div><input type="text" class="note" placeholder="ملاحظة…" aria-label="ملاحظة"></div>
    <div class="del" role="button" aria-label="حذف">حذف</div>
  `;
  row.querySelector('.del').addEventListener('click', ()=> { row.remove(); computeTotals(); });
  // اعادة حساب الإجماليات عند تغيير الكمية
  row.querySelector('.qty').addEventListener('input', computeTotals);
  itemsBody.appendChild(row);
  computeTotals();
}

function collectItems(){
  const rows = Array.from(itemsBody.querySelectorAll('.row'));
  return rows.map(r=>{
    const title = r.children[0]?.textContent || '';
    const qty   = Number(r.querySelector('.qty')?.value || 0);
    const unit  = r.children[2]?.textContent || '';
    const carb  = Number(r.querySelector('.n-carb')?.textContent || 0);
    const protein = Number(r.querySelector('.n-protein')?.textContent || 0);
    const fat   = Number(r.querySelector('.n-fat')?.textContent || 0);
    const kcal  = Number(r.querySelector('.n-kcal')?.textContent || 0);
    const note  = r.querySelector('.note')?.value || '';
    return { title, qty, unit, nutrients:{carb, protein, fat, kcal}, note };
  });
}

function computeTotals(){
  const it = collectItems();
  const sums = it.reduce((acc, x)=>{
    const q = Number(x.qty || 0);
    acc.carb    += x.nutrients.carb    * q;
    acc.protein += x.nutrients.protein * q;
    acc.fat     += x.nutrients.fat     * q;
    acc.kcal    += x.nutrients.kcal    * q;
    return acc;
  }, {carb:0, protein:0, fat:0, kcal:0});
  setTextSafe(sumCarb,    `إجمالي الكارب: ${Math.round(sums.carb)}`);
  setTextSafe(sumProtein, `إجمالي البروتين: ${Math.round(sums.protein)}`);
  setTextSafe(sumFat,     `إجمالي الدهون: ${Math.round(sums.fat)}`);
  setTextSafe(sumKcal,    `إجمالي السعرات: ${Math.round(sums.kcal)}`);
  return sums;
}

/* ========== Targets (Settings) ========== */
function applyTargets(targets){
  if (!targets) return;
  const { carb, protein, fat, kcal } = targets;
  setTextSafe(targetCarb,    `كارب: ${carb ?? '—'}`);
  setTextSafe(targetProtein, `بروتين: ${protein ?? '—'}`);
  setTextSafe(targetFat,     `دهون: ${fat ?? '—'}`);
  setTextSafe(targetKcal,    `سعرات: ${kcal ?? '—'}`);
}

async function loadChild(){
  childId = qs.get('child');
  if (!childId) return;
  const ref = doc(db, `parents/${currentUser.uid}/children/${childId}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  childData = snap.data() || {};

  // أهداف التغذية (مثال: childData.targets = {carb: 130, protein: 60, ...})
  applyTargets(childData?.targets || {});
}

/* زر التظبيط حسب هدف الكارب — توزيع تقريبي */
applyTargetsBtn.addEventListener('click', ()=>{
  const sums = computeTotals();
  // لو إجمالي الكارب أقل بكثير من الهدف، نقترح إضافة رز/تفاح… (من المكتبة)
  const goal = Number((childData?.targets?.carb) || 0);
  if (!goal) return alert('لا يوجد هدف للكارب في الإعدادات.');
  const deficit = goal - Math.round(sums.carb);
  if (deficit <= 0) return alert('إجمالي الكارب يطابق أو يتجاوز الهدف.');
  // إضافة "أرز أبيض" كوحدة 100g تقريبية حتى نقترب من الهدف
  const rice = library.find(x=>x.title.includes('أرز')) || library[0];
  if (!rice) return;
  const per = rice.nutrients.carb;
  const need = Math.max(1, Math.round(deficit / per));
  addItem({ title: rice.title, qty: need, unit: rice.unit, nutrients: rice.nutrients });
  alert(`أضفنا ${need} × ${rice.title} لتقريب الكارب من الهدف.`);
});

/* ========== AI Panel ========== */
toggleAiBtn.addEventListener('click', ()=>{
  const open = aiPanel.hasAttribute('hidden') ? false : true;
  if (open){ aiPanel.setAttribute('hidden',''); toggleAiBtn.setAttribute('aria-expanded','false'); }
  else     { aiPanel.removeAttribute('hidden'); toggleAiBtn.setAttribute('aria-expanded','true'); }
});

aiSuggestBtn.addEventListener('click', ()=>{
  const goal = Number(aiCarbGoal.value||0);
  if (!goal) { aiOut.textContent = 'من فضلك أدخل رقم للكارب'; return; }
  // خوارزمية بسيطة: (تفاح + أرز) بنسب تقرّب الهدف
  const apple = library.find(x=>x.title.includes('تفاح'));
  const rice  = library.find(x=>x.title.includes('أرز')) || library[0];

  if (!apple || !rice){ aiOut.textContent = 'المكتبة غير كافية للاقتراح.'; return; }

  const carbApple = apple.nutrients.carb; // ~19
  const carbRice  = rice.nutrients.carb;  // ~28 لكل 100g
  // نجرب توليفة سريعة: n من التفاح + m من الأرز
  let best = {n:0,m:0, diff:Infinity, total:0};
  for (let n=0;n<=3;n++){
    for (let m=0;m<=6;m++){
      const total = n*carbApple + m*carbRice;
      const diff  = Math.abs(goal - total);
      if (diff < best.diff) best = {n,m,diff,total};
    }
  }
  aiOut.textContent = `اقتراح: ${best.n} × ${apple.title} + ${best.m} × ${rice.title} ≈ ${Math.round(best.total)} كارب.`;
});

aiRandomBtn.addEventListener('click', ()=>{
  const pick = (arr)=> arr[Math.floor(Math.random()*arr.length)];
  const p = pick(presets);
  if (!p){ aiOut.textContent = 'لا توجد وجبات جاهزة.'; return; }
  addItem({ title: p.title, qty:1, unit:'وجبة', nutrients: p.nutrients });
  aiOut.textContent = `أضفنا: ${p.title}`;
});

/* ========== حفظ اليوم / تحميل السجلات ========== */
saveDayBtn.addEventListener('click', saveDay);

async function saveDay(){
  if (!currentUser || !childId) return alert('حساب غير مفعّل.');
  const date = dateInput.value || todayStr();
  const items = collectItems();
  if (!items.length) return alert('لا توجد عناصر لحفظها.');

  const sums = computeTotals();
  const payload = {
    date,
    items,
    sums,
    notes: '',
    createdAt: serverTimestamp()
  };
  const col = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
  await addDoc(col, payload);
  await loadSaved();
  alert('تم حفظ اليوم بنجاح.');
}

async function loadSaved(){
  savedBody.innerHTML = '';
  if (!currentUser || !childId) return;
  const col = collection(db, `parents/${currentUser.uid}/children/${childId}/meals`);
  // نعرض سجلات التاريخ المحدد فقط
  const d = dateInput.value || todayStr();
  const snap = await getDocs(query(col, where('date','==', d)));
  snap.forEach(ds=>{
    const dta = ds.data();
    const r = el('div','row');
    r.innerHTML = `
      <div>${dta.date}</div>
      <div>${dta.items?.length || 0}</div>
      <div>${Math.round(dta.sums?.carb || 0)}</div>
      <div>${Math.round(dta.sums?.protein || 0)}</div>
      <div>${Math.round(dta.sums?.fat || 0)}</div>
      <div>${Math.round(dta.sums?.kcal || 0)}</div>
      <div>${dta.notes || '—'}</div>
      <div class="del" role="button" aria-label="حذف">حذف</div>
    `;
    r.querySelector('.del').addEventListener('click', async ()=>{
      if (!confirm('حذف هذا السجل؟')) return;
      await deleteDoc(doc(db, `parents/${currentUser.uid}/children/${childId}/meals/${ds.id}`));
      await loadSaved();
    });
    savedBody.appendChild(r);
  });
}

/* ========== Events: بحث/فلتر/إعادة ضبط/تاريخ ========== */
mealFilter.addEventListener('change', renderLibrary);
searchInput.addEventListener('input', renderLibrary);
resetBtn.addEventListener('click', ()=>{ searchInput.value=''; mealFilter.value='all'; renderLibrary(); });
dateInput.addEventListener('change', ()=>{
  chipDate.textContent = `اليوم: ${dateInput.value}`;
  loadSaved();
});

/* ========== Boot ========== */
onAuthStateChanged(auth, async (user)=>{
  if (!user){ location.href = 'index.html'; return; }
  currentUser = user;

  // تاريخ افتراضي اليوم
  dateInput.value = todayStr();
  chipDate.textContent = `اليوم: ${dateInput.value}`;

  // بيانات
  seedPresetsAndLibrary();
  renderPresets();
  renderLibrary();

  // تحميل الطفل وأهدافه + السجلات
  try {
    await loadChild();
    await loadSaved();
  } catch (e) {
    console.warn(e);
  }
});
