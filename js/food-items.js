// js/food-items.js — كتالوج عام للأصناف + جدول استخدام سابق
// - المصدر: foodItems (جذر عام)
// - الأدمن فقط: CRUD
// - غير الأدمن: قراءة فقط + اختيار للوجبات لو child موجود
// - جدول استخدام سابق: لطفل محدد أو لكل أطفال وليّ الأمر

import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc, getDoc,
  query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* ---------- DOM عناصر ---------- */
const grid = document.getElementById('grid');
const qEl = document.getElementById('q'),
      fCat = document.getElementById('fCat'),
      fSource = document.getElementById('fSource'),
      fPhoto = document.getElementById('fPhoto'),
      fSort = document.getElementById('fSort'),
      btnClear = document.getElementById('btnClear');

const btnAdd = document.getElementById('btnAdd');
const togglePick = document.getElementById('togglePickMode');

const drawer = document.getElementById('drawer'),
      btnClose = document.getElementById('btnClose'),
      btnCancel = document.getElementById('btnCancel'),
      formTitle = document.getElementById('formTitle');

const form = document.getElementById('itemForm');
const itemId = document.getElementById('itemId'),
      nameEl = document.getElementById('name'),
      brandEl = document.getElementById('brand'),
      categoryEl = document.getElementById('category'),
      carb100El = document.getElementById('carb100'),
      prot100El = document.getElementById('prot100'),
      fat100El = document.getElementById('fat100'),
      kcal100El = document.getElementById('kcal100'),
      unitsList = document.getElementById('unitsList'),
      uNameEl = document.getElementById('uName'),
      uGramsEl = document.getElementById('uGrams'),
      btnAddUnit = document.getElementById('btnAddUnit'),
      imageUrlEl = document.getElementById('imageUrl'),
      btnAutoImage = document.getElementById('btnAutoImage'),
      tagsEl = document.getElementById('tags'),
      notesEl = document.getElementById('notes'),
      sourceEl = document.getElementById('source'),
      metaText = document.getElementById('metaText');

const snack = document.getElementById('snack'),
      snackText = document.getElementById('snackText'),
      snackUndo = document.getElementById('snackUndo');

/* ---------- حالة ---------- */
let UNITS = [];
let ITEMS = [];
let USER = null;
let ROLE = 'parent'; // admin | parent | doctor
let lastDeleted = null, snackTimer = null;

const params = new URLSearchParams(location.search);
const currentChild = params.get('child') || '';  // لو موجود نشغّل وضع الاختيار للوجبات

/* ---------- أدوات ---------- */
const toNumber = v => (v===''||v==null?0:Number(v));
const calcCalories = (c,p,f)=>Math.round(4*toNumber(c)+4*toNumber(p)+9*toNumber(f));
const fmt = n => (n==null||isNaN(+n)?'—':(+n).toFixed(1));
const esc = s => (s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

const normalTags = str => !str?[]:str.split(',')
  .map(t=>t.trim()).filter(Boolean)
  .map(t=>t.startsWith('#')?t:'#'+t)
  .map(t=>t.toLowerCase());

const setGrid = (html)=>{ grid.innerHTML = html; };
const showLoading = ()=> setGrid(`<div class="meta">جارِ التحميل…</div>`);
const showError = (msg, retryFn)=> setGrid(`
  <div class="card">
    <div style="color:#b91c1c;font-weight:600">تعذّر التحميل</div>
    <div class="meta" style="margin:6px 0">${esc(msg)}</div>
    ${retryFn ? `<button class="btn" id="__retry">إعادة المحاولة</button>` : ''}
  </div>
`);
function attachRetry(fn){ document.getElementById('__retry')?.addEventListener('click', fn); }

/* ---------- صورة تلقائية (SVG) ---------- */
function autoImageFor(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  const bg=`hsl(${hue} 80% 90%)`, fg=`hsl(${hue} 60% 40%)`, ch=esc(name[0]||'ص');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>
      <rect width='100%' height='100%' fill='${bg}'/>
      <text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle'
        font-family='Segoe UI' font-size='140' fill='${fg}'>${ch}</text>
    </svg>`
  );
}

/* ---------- تحقّق الدور ---------- */
async function loadRole(uid){
  try{
    const s = await getDoc(doc(db, 'users', uid));
    if(!s.exists()) return 'parent';
    return s.data().role || 'parent';
  }catch{ return 'parent'; }
}

/* ---------- Auth + تحميل ---------- */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  USER = user;
  ROLE = await loadRole(user.uid);

  // وضع الاختيار: لو child موجود فعّل التوجل تلقائيًا
  if(togglePick){
    const fromLS = localStorage.getItem('fi_pickmode');
    const defaultPick = currentChild ? '1' : (fromLS || '0');
    togglePick.checked = defaultPick === '1';
  }

  // زر الإضافة للأدمن فقط
  if(btnAdd) btnAdd.style.display = (ROLE==='admin') ? 'inline-flex' : 'none';

  await safeLoadItems();
  await renderUsageTable(); // جدول الاستخدام السابق
});

async function safeLoadItems(){
  try{ await loadItems(); }
  catch(err){ console.error('[food-items] load error:', err); showError(err.message || 'تحقق من الاتصال والصلاحيات.', safeLoadItems); attachRetry(safeLoadItems); }
}

async function loadItems(){
  showLoading();
  const ref = collection(db, 'foodItems'); // ← كتالوج عام
  const snap = await getDocs(query(ref, orderBy('name')));
  ITEMS = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  renderGrid();
}

/* ---------- فلاتر + رندر ---------- */
[qEl,fCat,fSource,fPhoto,fSort].forEach(el=> el?.addEventListener('input', renderGrid));
btnClear?.addEventListener('click', ()=>{
  if(qEl) qEl.value='';
  if(fCat) fCat.value='';
  if(fSource) fSource.value='';
  if(fPhoto) fPhoto.value='';
  if(fSort) fSort.value='name_asc';
  renderGrid();
});

function renderGrid(){
  let arr=ITEMS.slice();
  const q = (qEl?.value||'').trim().toLowerCase();
  const cat=fCat?.value||'', src=fSource?.value||'', ph=fPhoto?.value||'', sort=fSort?.value||'name_asc';

  if(q){
    arr=arr.filter(it=>{
      const inName=(it.name||'').toLowerCase().includes(q);
      const inTags=(it.tags||[]).some(t=>t.toLowerCase().includes(q)) || ((q.startsWith('#')) && (it.tags||[]).includes(q));
      return inName||inTags;
    });
  }
  if(cat) arr=arr.filter(it=>it.category===cat);
  if(src) arr=arr.filter(it=>(it.source||'manual')===src);
  if(ph==='with') arr=arr.filter(it=>!!it.imageUrl);
  if(ph==='without') arr=arr.filter(it=>!it.imageUrl);

  arr.sort((a,b)=>{
    if(sort==='name_asc')  return (a.name||'').localeCompare(b.name||'','ar');
    if(sort==='name_desc') return (b.name||'').localeCompare(a.name||'','ar');
    if(sort==='newest')    return (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0);
    if(sort==='oldest')    return (a.createdAt?.seconds||0)-(b.createdAt?.seconds||0);
    return 0;
  });

  if(!arr.length){ setGrid(`<div class="meta">لا توجد أصناف (جرّبي تغيير الفلاتر أو أضيفي من زر «إضافة صنف» إن كنتِ أدمن).</div>`); return; }

  grid.innerHTML='';
  arr.forEach(it=>{
    const kcal = it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g);
    const img  = it.imageUrl || autoImageFor(it.name||'صنف');

    const card = document.createElement('div');
    card.className='card';
    card.innerHTML = `
      <div class="head">
        <img class="thumb" src="${esc(img)}" onerror="this.src='${autoImageFor(it.name||'صنف')}'" alt="">
        <div>
          <div class="title">${esc(it.name||'—')}</div>
          <div class="meta">${esc(it.brand||'—')} • ${esc(it.category||'—')}</div>
          <div class="chips">
            <span class="chip">كارب/100g: <strong>${fmt(it.carbs_100g)}</strong></span>
            <span class="chip">بروتين/100g: ${fmt(it.protein_100g)}</span>
            <span class="chip">دهون/100g: ${fmt(it.fat_100g)}</span>
            <span class="chip">سعرات/100g: ${isNaN(kcal)?'—':kcal}</span>
            <span class="badge src">${esc(it.source||'manual')}</span>
            ${(it.householdUnits?.length>0)?'<span class="badge units">مقادير منزلية</span>':''}
            ${(it.tags?.length>0)?'<span class="badge tags">تاجات</span>':''}
          </div>
        </div>
      </div>

      <div class="quick">
        <label>حساب سريع للحصة:</label>
        <input type="number" step="1" min="0" placeholder="جرام" class="input qG">
        <select class="input qU">
          <option value="">أو اختَر مقدارًا منزليًا</option>
          ${(it.householdUnits||[]).map(u=>`<option value="${u.grams}">${esc(u.name)} (${u.grams}g)</option>`).join('')}
        </select>
        <button class="btn ghost qCalc">احسب</button>
        <span class="meta qOut"></span>
      </div>

      <div class="actions">
        ${ (ROLE!=='admin' && currentChild) ? `<button class="btn primary qSend">استخدام داخل الوجبات</button>` : '' }
        ${ (ROLE==='admin') ? `
          <button class="btn qEdit">تعديل</button>
          <button class="btn qCopy">نسخ</button>
          <button class="btn qDel" style="color:#fff;background:#ef4444;border:0">حذف</button>
        ` : '' }
      </div>

      <div class="meta">${esc((it.tags||[]).join(', '))}</div>
    `;

    // حساب سريع
    const qG=card.querySelector('.qG'), qU=card.querySelector('.qU'), qOut=card.querySelector('.qOut');
    card.querySelector('.qCalc')?.addEventListener('click', ()=>{
      const grams = Number(qU.value || qG.value);
      if(!grams){ qOut.textContent='أدخل وزنًا أو اختر مقدار'; return; }
      const factor = grams/100;
      const carbs = factor*(it.carbs_100g||0);
      const kcal2  = factor*(it.calories_100g ?? calcCalories(it.carbs_100g, it.protein_100g, it.fat_100g));
      qOut.textContent=`كارب: ${carbs.toFixed(1)}g • سعرات: ${Math.round(kcal2)} kcal`;
    });

    // اختيار داخل الوجبات (لغير الأدمن + child موجود)
    if(ROLE!=='admin' && currentChild){
      card.querySelector('.qSend')?.addEventListener('click', ()=>{
        const grams = Number(qU.value || qG.value);
        if(!grams){ alert('أدخل وزنًا أو اختر مقدار'); return; }
        location.href = `meals.html?child=${encodeURIComponent(currentChild)}&item=${encodeURIComponent(it.id)}&grams=${grams}`;
      });
    }

    // أدوات الإدارة (للأدمن فقط)
    if(ROLE==='admin'){
      card.querySelector('.qEdit')?.addEventListener('click', ()=> openEdit(it));
      card.querySelector('.qCopy')?.addEventListener('click', ()=> openCopy(it));
      card.querySelector('.qDel')?.addEventListener('click', async ()=>{
        if(!confirm(`حذف الصنف «${it.name}»؟`)) return;
        lastDeleted={...it};
        await deleteDoc(doc(db, `foodItems/${it.id}`));
        await safeLoadItems();
        showSnack(`تم حذف «${it.name}»`);
      });
    }

    grid.appendChild(card);
  });
}

/* ---------- Drawer (نموذج) ---------- */
function openDrawer(){ drawer?.classList.add('open'); }
function closeDrawer(){ drawer?.classList.remove('open'); resetForm(); }
function resetForm(){
  if(!form) return;
  itemId.value=''; formTitle.textContent='إضافة صنف';
  nameEl.value=''; brandEl.value=''; categoryEl.value='';
  carb100El.value=''; prot100El.value=''; fat100El.value=''; kcal100El.value='';
  UNITS=[]; renderUnits(); imageUrlEl.value=''; tagsEl.value=''; notesEl.value='';
  sourceEl.value='manual'; metaText.textContent='—';
}
function renderUnits(){
  if(!unitsList) return;
  unitsList.innerHTML = UNITS.length? '' : '<span class="meta">لا توجد مقادير مضافة.</span>';
  UNITS.forEach((u,i)=>{
    const el=document.createElement('span');
    el.className='unit';
    el.innerHTML=`<strong>${esc(u.name)}</strong> = <span>${esc(u.grams)} g</span> <span class="x" data-i="${i}">✖</span>`;
    unitsList.appendChild(el);
  });
}

btnAdd?.addEventListener('click', ()=>{ if(ROLE!=='admin') return; resetForm(); openDrawer(); });
btnClose?.addEventListener('click', closeDrawer);
btnCancel?.addEventListener('click', closeDrawer);

btnAddUnit?.addEventListener('click', ()=>{
  if(ROLE!=='admin') return;
  const n=uNameEl.value.trim(), g=Number(uGramsEl.value);
  if(!n||!g||g<=0){ alert('أدخل اسم المقدار والجرام (>0)'); return; }
  UNITS.push({name:n, grams:g}); uNameEl.value=''; uGramsEl.value=''; renderUnits();
});
unitsList?.addEventListener('click', e=>{
  if(ROLE!=='admin') return;
  const t=e.target; if(t.classList.contains('x')){ UNITS.splice(Number(t.dataset.i),1); renderUnits(); }
});
btnAutoImage?.addEventListener('click', ()=>{
  if(!nameEl?.value.trim()){ alert('أدخل اسم الصنف أولاً'); return; }
  imageUrlEl.value=autoImageFor(nameEl.value.trim());
});

function fillForm(it){
  itemId.value=it.id||''; formTitle.textContent= it.id?'تعديل صنف':'إضافة صنف';
  nameEl.value=it.name||''; brandEl.value=it.brand||''; categoryEl.value=it.category||'';
  carb100El.value=it.carbs_100g ?? ''; prot100El.value=it.protein_100g ?? ''; fat100El.value=it.fat_100g ?? ''; kcal100El.value=it.calories_100g ?? '';
  UNITS=(it.householdUnits||[]).map(u=>({name:u.name, grams:u.grams})); renderUnits();
  imageUrlEl.value=it.imageUrl||''; tagsEl.value=(it.tags||[]).join(', '); notesEl.value=it.notes||''; sourceEl.value=it.source||'manual';
  const c=it.createdAt?.toDate?it.createdAt.toDate():null, u=it.updatedAt?.toDate?it.updatedAt.toDate():null;
  metaText.textContent=`أُنشئ: ${c?c.toLocaleString('ar-EG'):'—'} • آخر تحديث: ${u?u.toLocaleString('ar-EG'):'—'}`;
}
function openEdit(it){ if(ROLE!=='admin') return; fillForm(it); openDrawer(); }
function openCopy(it){ if(ROLE!=='admin') return; const x={...it}; delete x.id; x.name=(x.name||'')+' - نسخة'; fillForm(x); openDrawer(); }

form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(ROLE!=='admin') return;

  const name=nameEl.value.trim(), category=categoryEl.value, carbs=Number(carb100El.value);
  if(!name||!category||isNaN(carbs)){ alert('الاسم + التصنيف + كارب/100g مطلوبة'); return; }
  if(carbs<0||toNumber(prot100El.value)<0||toNumber(fat100El.value)<0){ alert('القيم ≥ 0'); return; }
  let kcal = kcal100El.value==='' ? calcCalories(carb100El.value, prot100El.value, fat100El.value) : Number(kcal100El.value);
  if(isNaN(kcal)) kcal=0;

  const payload={
    name, brand:brandEl.value.trim()||null, category,
    carbs_100g:+carb100El.value||0, protein_100g:+prot100El.value||0, fat_100g:+fat100El.value||0,
    calories_100g:+kcal||0, householdUnits:UNITS.slice(),
    imageUrl:imageUrlEl.value.trim()||null, tags:normalTags(tagsEl.value), notes:notesEl.value.trim()||null,
    source:sourceEl.value||'manual', updatedAt:serverTimestamp()
  };
  try{
    if(itemId.value){
      await updateDoc(doc(db, `foodItems/${itemId.value}`), payload);
      alert('تم التحديث بنجاح');
    }else{
      await addDoc(collection(db, `foodItems`), {...payload, createdAt:serverTimestamp()});
      alert('تمت الإضافة بنجاح');
    }
    closeDrawer(); await safeLoadItems();
  }catch(err){
    console.error(err); alert('حدث خطأ أثناء الحفظ');
  }
});

/* ---------- Snack (تراجع) ---------- */
function showSnack(t){ if(!snack) return; snackText.textContent=t; snack.hidden=false; clearTimeout(snackTimer); snackTimer=setTimeout(()=>snack.hidden=true,5000); }
snackUndo?.addEventListener('click', async ()=>{
  if(!lastDeleted) return; snack.hidden=true;
  const data={...lastDeleted}; lastDeleted=null;
  try{
    await setDoc(doc(db, `foodItems/${data.id}`), {...data, updatedAt: serverTimestamp()});
  }catch{
    await addDoc(collection(db, `foodItems`), {...data, id: undefined, createdAt: serverTimestamp(), updatedAt: serverTimestamp()});
  }
  await safeLoadItems();
  showSnack('تم التراجع عن الحذف');
});

/* ---------- جدول الاستخدام السابق ---------- */
/* يبني سكشن لو مش موجود */
function ensureUsageSection(){
  let sec = document.getElementById('usageSection');
  if(sec) return sec;
  sec = document.createElement('section');
  sec.id = 'usageSection';
  sec.className = 'card';
  sec.innerHTML = `
    <h2>🕘 أصناف تم استخدامها قبل كده</h2>
    <div class="meta" id="usageMeta">—</div>
    <table class="usageTable">
      <thead>
        <tr>
          <th>الصنف</th>
          <th>عدد المرات</th>
          <th>آخر استخدام</th>
          ${ currentChild ? '<th>استخدام الآن</th>' : '' }
        </tr>
      </thead>
      <tbody id="usageBody"><tr><td colspan="4" class="meta">جارِ التحميل…</td></tr></tbody>
    </table>
  `;
  // لو عندك كونتينر تاني حطيه فيه؛ وإلا هنضيفه آخر الصفحة
  (document.querySelector('.page') || document.querySelector('.container') || document.body).appendChild(sec);
  return sec;
}

async function renderUsageTable(){
  const sec = ensureUsageSection();
  const usageMeta = document.getElementById('usageMeta');
  const tbody = document.getElementById('usageBody');
  if(!USER){ tbody.innerHTML = `<tr><td class="meta" colspan="4">لم يتم تسجيل الدخول</td></tr>`; return; }

  // 1) نجيب الوجبات: لطفل محدد أو لكل الأطفال
  let mealDocs = [];
  const today = new Date();
  const since = new Date(); since.setDate(today.getDate() - 90); // 90 يوم الأخيرة تقريبًا

  function dateStr(d){ return d.toISOString().slice(0,10); }
  const minDate = dateStr(since);

  if(currentChild){
    // وجبات طفل واحد
    const ref = collection(db, `parents/${USER.uid}/children/${currentChild}/meals`);
    // مفيش composite index للفلترة بالتاريخ؟ هنجمع الكل ونفلتر على العميل (للأمان)
    const snap = await getDocs(query(ref, orderBy('date','desc')));
    mealDocs = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(r=> (r.date||'') >= minDate);
    usageMeta.textContent = 'آخر 90 يوم — لطفل محدد';
  }else{
    // نجيب كل الأطفال ثم كل وجباتهم
    const kidsSnap = await getDocs(collection(db, `parents/${USER.uid}/children`));
    const kids = kidsSnap.docs.map(d=> d.id);
    let all = [];
    for(const kidId of kids){
      const ref = collection(db, `parents/${USER.uid}/children/${kidId}/meals`);
      const snap = await getDocs(query(ref, orderBy('date','desc')));
      const arr = snap.docs.map(d=>({id:d.id, childId:kidId, ...d.data()})).filter(r=> (r.date||'') >= minDate);
      all = all.concat(arr);
    }
    mealDocs = all;
    usageMeta.textContent = 'آخر 90 يوم — كل الأطفال';
  }

  // 2) نجمع حسب itemId
  const byItem = new Map();
  for(const m of mealDocs){
    if(!m.itemId) continue;
    const prev = byItem.get(m.itemId) || {count:0, last:'0000-00-00'};
    const last = prev.last >= (m.date||'') ? prev.last : (m.date||'');
    byItem.set(m.itemId, {count: prev.count+1, last});
  }

  if(byItem.size===0){
    tbody.innerHTML = `<tr><td colspan="4" class="meta">لا يوجد استخدام مؤخرًا</td></tr>`;
    return;
  }

  // 3) ربط الأسماء من الكتالوج العام
  const nameOf = (id)=>{
    const it = ITEMS.find(x=>x.id===id);
    return it ? it.name : '—';
  };

  // 4) تحويل لمصفوفة مرتبة حسب آخر استخدام
  const rows = Array.from(byItem.entries()).map(([id,agg])=>({
    id, count: agg.count, last: agg.last, name: nameOf(id)
  })).sort((a,b)=> b.last.localeCompare(a.last)).slice(0,50);

  // 5) رندر
  tbody.innerHTML = '';
  for(const r of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r.name)}</td>
      <td>${r.count}</td>
      <td>${r.last || '—'}</td>
      ${ currentChild ? `<td><button class="btn small" data-id="${r.id}">استخدام الآن</button></td>` : '' }
    `;
    if(currentChild){
      tr.querySelector('button')?.addEventListener('click', ()=>{
        // نقفز لصفحة الوجبات مع الـ itemId (بدون جرامات — يحددها المستخدم هناك)
        location.href = `meals.html?child=${encodeURIComponent(currentChild)}&item=${encodeURIComponent(r.id)}`;
      });
    }
    tbody.appendChild(tr);
  }
}
