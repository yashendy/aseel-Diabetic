/* global db, auth, PLACEHOLDER_SVG, GEMINI_API_KEY */

// ==== عناصر DOM ====
const q = (s, r = document) => r.querySelector(s);
const qa = (s, r = document) => [...r.querySelectorAll(s)];

const childNameEl = q('#childName');
const mealTypeEl = q('#mealType');
const manualCarbsEl = q('#manualCarbs');
const btnAdjust025 = q('#btnAdjust025');
const btnAI = q('#btnAI');
const itemsBody = q('#itemsBody');
const totalCarbsEl = q('#totalCarbs');
const statCR = q('#statCR');
const statCF = q('#statCF');
const statGlucose = q('#statGlucose');

const lblMin = q('#lblMin');
const lblMax = q('#lblMax');
const rangeBar = q('.range-bar');
const rangeMarker = q('#rangeMarker');

const openLibBtn = q('#openLib');
const libDialog = q('#libDialog');
const closeLib = q('#closeLib');
const closeLib2 = q('#closeLib2');
const libGrid = q('#libGrid');

const savePresetBtn = q('#savePreset');
const loadPresetBtn = q('#loadPreset');
const saveMealBtn = q('#saveMeal');

const nameDialog = q('#nameDialog');
const closeName = q('#closeName');
const confirmName = q('#confirmName');
const presetNameEl = q('#presetName');

// ==== حالة الصفحة ====
let uid = null;
let parentId = null;
let childId = new URLSearchParams(location.search).get('child') || '';
let childDoc = null;
let carbTargets = { breakfast:{min:0,max:0}, lunch:{min:0,max:0}, dinner:{min:0,max:0}, snack:{min:0,max:0} };

// العناصر المختارة للوجبة
let items = []; // [{id,name,imageUrl, per100:{carbs_g,fiber_g}, unitGrams, qty, carb}]

// ==== Firebase helpers (v10+ بدون modules) ====
const { getDoc, doc, collection, query, where, getDocs, addDoc, setDoc, serverTimestamp } = window.firebase.firestore;

// ==== أدوات ====
const fmt = n => (Math.round(n*100)/100).toFixed(2);
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const step025 = v => Math.round(v / 0.25) * 0.25;

function updateTotalsAndRange() {
  const total = items.reduce((s, it) => s + (Number(it.carb)||0), 0);
  totalCarbsEl.textContent = fmt(total);

  // موضع المؤشر داخل الشريط
  const mt = mealTypeEl.value;
  const {min,max} = carbTargets[mt] || {min:0,max:0};
  lblMin.textContent = min||0;
  lblMax.textContent = max||0;

  // حساب نسبة داخل الشريط (0..1)
  let pct = 0;
  if (max > 0) pct = clamp(total/max, 0, 1);
  rangeMarker.style.left = (pct*100) + '%';

  // تلوين خلفية الشريط (تلميح إضافي)
  rangeBar.style.outline = (total < min || total > max) ? '2px solid #ff9f8f' : '2px solid rgba(0,0,0,0)';
}

function renderItems() {
  itemsBody.innerHTML = '';
  items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.innerHTML = `
      <div><button class="del" data-i="${idx}">حذف</button></div>
      <div>${it.name}</div>
      <div><input type="number" step="0.25" min="0" value="${it.qty || 0}" data-i="${idx}" data-k="qty"/></div>
      <div><input type="number" step="1" min="0" value="${it.unitGrams || 0}" data-i="${idx}" data-k="unitGrams"/></div>
      <div><input type="number" step="0.1" min="0" value="${fmt(it.carb||0)}" data-i="${idx}" data-k="carb" disabled/></div>
    `;
    itemsBody.appendChild(row);
  });

  itemsBody.addEventListener('input', onRowInput, { once:false, passive:true });
  itemsBody.addEventListener('click', onRowClick, { once:false, passive:true });
  updateTotalsAndRange();
}

function onRowInput(e) {
  const t = e.target;
  if (!('i' in t.dataset && 'k' in t.dataset)) return;
  const i = +t.dataset.i;
  const k = t.dataset.k;
  items[i][k] = Number(t.value);

  // إعادة حساب كارب العنصر
  const per100 = items[i].per100 || {carbs_g:0,fiber_g:0};
  const grams = (Number(items[i].qty)||0) * (Number(items[i].unitGrams)||0);
  const carbs = per100.carbs_g * grams / 100;
  items[i].carb = carbs; // طرح الألياف لاحقًا لو أردتِ
  // عكس القيمة في حقل الكارب
  const carbInput = itemsBody.querySelector(`input[data-i="${i}"][data-k="carb"]`);
  if (carbInput) carbInput.value = fmt(items[i].carb || 0);

  updateTotalsAndRange();
}

function onRowClick(e) {
  const t = e.target;
  if (t.classList.contains('del')) {
    const i = +t.dataset.i;
    items.splice(i,1);
    renderItems();
  }
}

// ==== مكتبة الأصناف ====
async function loadLibrary() {
  libGrid.innerHTML = '';
  // نبحث أولًا في admin/global/foodItems (يمكنكِ تغييره لاحقًا)
  const base = collection(db, 'admin','global','foodItems');
  const snap = await getDocs(base);
  if (snap.empty) {
    libGrid.innerHTML = `<div class="card">لا توجد أصناف بعد.</div>`;
    return;
  }
  snap.forEach(d => {
    const v = d.data();
    const img = v.imageUrl || PLACEHOLDER_SVG;
    const measures = Array.isArray(v.measures) ? v.measures : [];
    const m0 = measures[0] || {name:'وحدة', grams: v.measureQty || 0};
    const per100 = v.nutrPer100 || {carbs_g:0,fiber_g:0};

    const card = document.createElement('div');
    card.className = 'lib-card';
    card.innerHTML = `
      <div class="img"><img src="${img}" onerror="this.src='${PLACEHOLDER_SVG}'" alt=""></div>
      <div class="title">${v.name || 'صنف'}</div>
      <small>${per100.carbs_g||0}g كارب / 100g</small>
      <div class="row">
        <select class="mSel">
          ${measures.map(m=>`<option value="${m.grams}">${m.name}</option>`).join('')}
        </select>
        <input class="qty" type="number" step="0.25" min="0" placeholder="الكمية" value="1"/>
      </div>
      <small class="hint">جرام/وحدة: <b class="ug">${m0.grams||0}</b></small>
      <div class="foot">
        <button class="btn add">إضافة</button>
      </div>
    `;
    const mSel = card.querySelector('.mSel');
    const ug = card.querySelector('.ug');
    mSel.addEventListener('change', ()=> ug.textContent = mSel.value);

    card.querySelector('.add').addEventListener('click', ()=>{
      const qty = Number(card.querySelector('.qty').value)||0;
      const unitGrams = Number(mSel.value)||0;
      items.push({
        id: d.id,
        name: v.name || 'صنف',
        imageUrl: img,
        per100: per100,
        unitGrams,
        qty,
        carb: (per100.carbs_g||0) * (unitGrams*qty) / 100
      });
      renderItems();
    });

    libGrid.appendChild(card);
  });
}

openLibBtn.addEventListener('click', async()=>{
  await ensureAuth();
  await loadLibrary();
  libDialog.showModal();
});
[closeLib, closeLib2].forEach(b=>b.addEventListener('click', ()=>libDialog.close()));

// ==== تعديل المقادير 0.25 للوصول للنطاق ====
function adjustToRange() {
  const mt = mealTypeEl.value;
  const {min,max} = carbTargets[mt] || {min:0,max:0};
  if (!items.length || (!min && !max)) return;

  const target = (min + max)/2; // نهدف للمنتصف
  // سنوزّع الفرق النسبي على العناصر، مع التقريب 0.25 على الكميات فقط
  const cur = items.reduce((s,it)=>s+(it.carb||0),0);
  if (cur === 0) return;

  const ratio = clamp(target/cur, 0.1, 5); // لا نبالغ
  items = items.map(it=>{
    const newQty = step025((it.qty||0)*ratio);
    const grams = newQty * (Number(it.unitGrams)||0);
    const carbs = (it.per100?.carbs_g||0) * grams / 100;
    return {...it, qty:newQty, carb:carbs};
  });

  renderItems();
}
btnAdjust025.addEventListener('click', adjustToRange);

// ==== AI بدائل ====
btnAI.addEventListener('click', async()=>{
  try{
    if (!window.ai || !window.ai.suggestAlternatives) throw new Error('AI غير متاح الآن');
    const mt = mealTypeEl.value;
    const {min,max} = carbTargets[mt] || {min:0,max:0};
    const resp = await window.ai.suggestAlternatives(items, min, max);
    if (!resp || !Array.isArray(resp.items) || !resp.items.length) { alert('لا توجد بدائل مناسبة الآن.'); return; }
    // استبدال العناصر (أو دمج؟) – هنا هنستبدل
    items = resp.items.map(v=>({
      id: v.id || '',
      name: v.name || 'صنف',
      imageUrl: v.imageUrl || PLACEHOLDER_SVG,
      per100: v.per100 || {carbs_g:0,fiber_g:0},
      unitGrams: Number(v.unitGrams)||0,
      qty: Number(v.qty)||0,
      carb: Number(v.carb)||0
    }));
    renderItems();
  }catch(e){
    console.error(e);
    alert('لا توجد بدائل مناسبة الآن.');
  }
});

// ==== حفظ/تحميل وجبات جاهزة ====
async function ensureAuth(){
  const u = auth.currentUser;
  if (!u) throw new Error('يجب تسجيل الدخول');
  uid = u.uid; parentId = u.uid;
}
savePresetBtn.addEventListener('click', async()=>{
  try{
    await ensureAuth();
    if (!items.length) return alert('أضف أصنافًا أولًا');
    presetNameEl.value = '';
    nameDialog.showModal();
    confirmName.onclick = async ()=>{
      const name = presetNameEl.value?.trim() || `وجبة جاهزة ${(Date.now()%10000)}`;
      await addDoc(collection(db,'parents',parentId,'presetMeals'),{
        name, createdAt: serverTimestamp(),
        items
      });
      nameDialog.close();
      alert('تم الحفظ كوجبة جاهزة.');
    };
    closeName.onclick = ()=> nameDialog.close();
  }catch(e){ console.error(e); alert('تعذر الحفظ.'); }
});

loadPresetBtn.addEventListener('click', async()=>{
  try{
    await ensureAuth();
    const snap = await getDocs(collection(db,'parents',parentId,'presetMeals'));
    if (snap.empty) return alert('لا توجد وجبات جاهزة.');
    // أبسط شكل: نختار أول وجبة – يمكنكِ تبديله بـ Dialog اختيار
    const d = snap.docs[0]; const v = d.data();
    if (!v.items) return alert('الوجبة فارغة.');
    items = v.items;
    renderItems();
  }catch(e){ console.error(e); alert('تعذر التحميل.'); }
});

saveMealBtn.addEventListener('click', async()=>{
  try{
    await ensureAuth();
    if (!childId) return alert('لا يوجد childId بالرابط.');
    const name = prompt('اسم الوجبة؟ (سيظهر في سجل الوجبات)', 'وجبتي');
    await addDoc(collection(db,'parents',parentId,'children',childId,'meals'),{
      name: name||'وجبة',
      type: mealTypeEl.value,
      carbs: Number(totalCarbsEl.textContent)||0,
      items,
      createdAt: serverTimestamp()
    });
    alert('تم حفظ الوجبة للطفل.');
  }catch(e){ console.error(e); alert('تعذر حفظ الوجبة.'); }
});

// ==== تحميل بيانات الطفل (الاسم + CR/CF + نطاقات) ====
async function loadChild() {
  try{
    await ensureAuth();
    if (!childId) return;
    const d = await getDoc(doc(db,'parents',parentId,'children',childId));
    if (!d.exists()) return;
    childDoc = d.data();
    childNameEl.textContent = '— ' + (childDoc.name||'');
    statCR.textContent = childDoc.carbRatio ?? '—';
    statCF.textContent = childDoc.correctionFactor ?? '—';
    // افتراضي قراءة السكر الحالية (إن وجدت)
    statGlucose.textContent = childDoc.glucoseNow ? String(childDoc.glucoseNow) : '—';

    // نطاقات
    carbTargets = childDoc.carbTargets || carbTargets;
    updateTotalsAndRange();
  }catch(e){ console.error(e); }
}

// تحديث عند تغيير نوع الوجبة
mealTypeEl.addEventListener('change', updateTotalsAndRange);

// ==== تشغيل أولي ====
(function boot(){
  renderItems();
  loadChild();
})();
