// js/food-items.js — Admin catalog with GI/GL + image upload + CSV/Excel import
import { auth, db } from './firebase-config.js';
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, doc, query, orderBy,
  serverTimestamp, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getStorage, ref as sRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

/* DOM */
const $ = (id)=>document.getElementById(id);
const qEl=$('q'), fCat=$('fCat'), grid=$('grid');
const btnNew=$('btnNew'), importBtn=$('importBtn'), anyInput=$('anyInput'), exportBtn=$('exportBtn'), templateBtn=$('templateBtn');

const form=$('form'), formTitle=$('formTitle');
const itemId=$('itemId'), nameEl=$('name'), categoryEl=$('category'), brandEl=$('brand');
const unitEl=$('unit');
const carb100El=$('carb100'), fiber100El=$('fiber100'), prot100El=$('prot100'), fat100El=$('fat100'), kcal100El=$('kcal100');
const giEl=$('gi'), glPreview=$('glPreview');
const unitsList=$('unitsList'), uNameEl=$('uName'), uGramsEl=$('uGrams'), btnAddUnit=$('btnAddUnit');
const tagsEl=$('tags'), sourceEl=$('source');

const imgFileEl=$('imgFile'), imgPrev=$('imgPrev'), imgProg=$('imgProg'), imageUrlEl=$('imageUrl');
const btnSave=$('btnSave'), btnReset=$('btnReset'), btnDelete=$('btnDelete');
const snack=$('snack'), snackText=$('snackText');

/* State */
let USER=null;
let ITEMS=[];
let UNITS=[];               // [{name, grams}]
let SELECTED_FILE=null;     // File object or null

/* Utils */
const esc=s=>(s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt=n=>(n==null||isNaN(+n)?'—':(+n).toFixed(1));
const normTags=(str)=>!str?[]:str.split(/[|,]/).map(t=>t.trim()).filter(Boolean).map(t=>t.startsWith('#')?t:'#'+t).map(t=>t.toLowerCase());
const num=v=>{ const n=Number(v); return Number.isFinite(n)?n:null; };
function showSnack(text){ snackText.textContent=text; snack.classList.remove('hidden'); setTimeout(()=>snack.classList.add('hidden'),2500); }

/* ========== GI/GL helpers ========== */
const netCarbs100 = (carbs,fiber)=> Math.max(0,(+carbs||0) - (+fiber||0)); // g per 100g
const glPer100 = (gi, carbs, fiber)=> {
  const GI = +gi; if(!Number.isFinite(GI)) return null;
  const nc = netCarbs100(carbs,fiber);
  return (GI/100) * nc; // GL per 100g
};
const glForGrams = (gi, carbs, fiber, grams)=> {
  const per100 = glPer100(gi,carbs,fiber);
  if (per100==null) return null;
  return per100 * ((+grams||0)/100);
};

/* Preview GL live */
[nameEl,carb100El,fiber100El,giEl].forEach(el=> el.addEventListener('input', updateGLPreview));
function updateGLPreview(){
  const gi = num(giEl.value);
  const carbs= num(carb100El.value) ?? 0;
  const fiber= num(fiber100El.value) ?? 0;
  const nc = netCarbs100(carbs,fiber);
  const gl100 = glPer100(gi,carbs,fiber);
  let html = `<div>NetCarbs/100g: <b>${fmt(nc)}</b> g</div>`;
  html += `<div>GL/100g: <b>${fmt(gl100)}</b></div>`;
  if(UNITS.length){
    html += `<div style="margin-top:6px">GL حسب المقادير:</div><div class="chips">`;
    for (const u of UNITS){
      html += `<span class="chip">${esc(u.name)}: ${fmt(glForGrams(gi,carbs,fiber,u.grams))}</span>`;
    }
    html += `</div>`;
  }
  glPreview.innerHTML = html;
}

/* Auth + load */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  // (اختياري) نقرأ الدور من users/{uid} لو حابة تمنعي غير الأدمن
  USER=user;
  await loadItems();
});

/* Load */
async function loadItems(){
  const ref=collection(db,'admin','global','foodItems');
  let snap;
  try{ snap=await getDocs(query(ref, orderBy('name'))); }
  catch{ snap=await getDocs(ref); }
  ITEMS=snap.docs.map(d=>({id:d.id,...d.data()}));
  renderGrid();
  fillCats();
}

/* Categories filter */
function fillCats(){
  const cats = Array.from(new Set(ITEMS.map(i=> (i.category||'').trim()).filter(Boolean))).sort();
  fCat.innerHTML = `<option value="">كل الفئات</option>` + cats.map(c=> `<option>${esc(c)}</option>`).join('');
}

/* Units UI */
function renderUnits(){
  unitsList.innerHTML= UNITS.length? '' : '<span class="meta">لا توجد مقادير.</span>';
  UNITS.forEach((u,i)=>{
    const el=document.createElement('span');
    el.className='u';
    el.innerHTML=`<strong>${esc(u.name)}</strong> = ${esc(u.grams)} g <span class="x" data-i="${i}">✖</span>`;
    unitsList.appendChild(el);
  });
  updateGLPreview();
}
btnAddUnit.addEventListener('click',()=>{
  const n=uNameEl.value.trim(), g=Number(uGramsEl.value);
  if(!n||!g||g<=0){ alert('أدخل اسم المقدار والجرامات (>0)'); return; }
  UNITS.push({name:n,grams:g}); uNameEl.value=''; uGramsEl.value=''; renderUnits();
});
unitsList.addEventListener('click',e=>{
  const t=e.target; if(t.classList.contains('x')){ UNITS.splice(Number(t.dataset.i),1); renderUnits(); }
});

/* Image selection & preview */
imgFileEl.addEventListener('change',()=>{
  const f = imgFileEl.files?.[0]||null;
  SELECTED_FILE = f;
  if (f){ imgPrev.src = URL.createObjectURL(f); imageUrlEl.value = ''; }
  else { imgPrev.src = autoImg(nameEl.value || 'صنف'); }
});

/* New item */
btnNew.addEventListener('click', openNew);
function openNew(){
  formTitle.textContent='إضافة صنف';
  itemId.value='';
  nameEl.value=''; categoryEl.value=''; brandEl.value=''; unitEl.value='g';
  carb100El.value=''; fiber100El.value=''; prot100El.value=''; fat100El.value=''; kcal100El.value='';
  giEl.value='';
  tagsEl.value=''; sourceEl.value=''; imageUrlEl.value='';
  SELECTED_FILE = null; imgFileEl.value=''; imgProg.classList.add('hidden'); imgProg.value=0;
  UNITS=[]; renderUnits();
  imgPrev.src = autoImg();
  glPreview.innerHTML='';
  window.scrollTo({top:0,behavior:'smooth'});
}

/* Save (create or update) — with optional image upload */
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!nameEl.value.trim()){ alert('الاسم مطلوب'); return; }

  const carbs=+carb100El.value||0, fiber=+fiber100El.value||0, protein=+prot100El.value||0, fat=+fat100El.value||0;
  const kcal = +kcal100El.value || Math.round(4*carbs + 4*protein + 9*fat);
  const gi = num(giEl.value);

  // وثيقة متوافقة مع صفحة وجبات الأطفال
  const baseData = {
    name: nameEl.value.trim(),
    nameLower: nameEl.value.trim().toLowerCase(),
    category: (categoryEl.value||'').trim() || null,
    brand: (brandEl.value||'').trim() || null,
    unit: unitEl.value || 'g',
    imageUrl: (imageUrlEl.value||'').trim() || null, // سيتغير لو رفعنا صورة
    tags: normTags(tagsEl.value),
    source: (sourceEl.value||'').trim() || 'manual',
    gi: gi, // نحفظ GI
    nutrPer100g:{
      carbs_g:   carbs,
      fiber_g:   fiber,
      protein_g: protein,
      fat_g:     fat,
      cal_kcal:  kcal
    },
    measures: UNITS.map(u=>({name:u.name, grams:+u.grams})),
    updatedAt: serverTimestamp()
  };

  const col = collection(db,'admin','global','foodItems');

  try{
    // 1) رفع الصورة إن وُجدت
    let finalImageUrl = baseData.imageUrl;
    if (SELECTED_FILE){
      imgProg.classList.remove('hidden'); imgProg.value = 0;
      let id = itemId.value;
      if (!id){
        const refId = doc(col); id = refId.id;
        finalImageUrl = await uploadImageToStorage(id, SELECTED_FILE);
        await setDoc(refId, { ...baseData, imageUrl: finalImageUrl, createdAt: serverTimestamp() }, { merge:true });
        showSnack('تمت الإضافة ✅');
        itemId.value = id;
        SELECTED_FILE = null; imgProg.classList.add('hidden');
        await loadItems();
        openNew();
        return;
      } else {
        finalImageUrl = await uploadImageToStorage(id, SELECTED_FILE);
      }
    }

    // 2) حفظ البيانات
    if (itemId.value){
      await updateDoc(doc(col, itemId.value), { ...baseData, imageUrl: finalImageUrl });
      showSnack('تم التحديث ✅');
    } else {
      await addDoc(col, { ...baseData, imageUrl: finalImageUrl, createdAt: serverTimestamp() });
      showSnack('تمت الإضافة ✅');
    }

    SELECTED_FILE = null; imgProg.classList.add('hidden');
    await loadItems();
    openNew();

  }catch(err){
    console.error(err);
    alert('تعذّر الحفظ: '+ (err.message||''));
  }
});

/* Upload to Storage and return downloadURL */
async function uploadImageToStorage(itemId, file){
  const storage = getStorage();
  const path = `foodItems/${itemId}/${Date.now()}_${file.name}`.replace(/\s+/g,'_');
  const ref = sRef(storage, path);
  const task = uploadBytesResumable(ref, file);
  return await new Promise((resolve, reject)=>{
    task.on('state_changed', (snap)=>{
      if (imgProg){ imgProg.value = Math.round(100 * snap.bytesTransferred / snap.totalBytes); }
    }, reject, async ()=>{
      const url = await getDownloadURL(task.snapshot.ref);
      resolve(url);
    });
  });
}

/* Delete */
btnDelete.addEventListener('click', async ()=>{
  const id = itemId.value;
  if(!id){ alert('اختر صنفًا أولًا'); return; }
  if(!confirm('حذف هذا الصنف؟')) return;
  await deleteDoc(doc(db,'admin','global','foodItems', id));
  showSnack('تم الحذف');
  await loadItems();
  openNew();
});

/* Reset */
btnReset.addEventListener('click', openNew);

/* Render grid (includes GI/GL) */
qEl.addEventListener('input', renderGrid);
fCat.addEventListener('change', renderGrid);

function renderGrid(){
  const term=(qEl.value||'').trim().toLowerCase();
  const cat=(fCat.value||'').trim().toLowerCase();

  const list = ITEMS.filter(it=>{
    const okCat = !cat || (it.category||'').toLowerCase()===cat;
    const hay = [
      (it.name||''),(it.category||''),(it.brand||''),
      Array.isArray(it.tags)? it.tags.join(' '):''
    ].join(' ').toLowerCase();
    const okTxt = !term || hay.includes(term);
    return okCat && okTxt;
  });

  if(!list.length){ grid.innerHTML = `<div class="meta">لا توجد نتائج.</div>`; return; }

  grid.innerHTML='';
  list.forEach(it=>{
    const n = it.nutrPer100g || {};
    const img = it.imageUrl || autoImg(it.name);
    const nc = netCarbs100(n.carbs_g, n.fiber_g);
    const gl100 = glPer100(it.gi, n.carbs_g, n.fiber_g);

    const firstMeasure = (it.measures && it.measures[0]) ? `${it.measures[0].name}: ${fmt(glForGrams(it.gi, n.carbs_g, n.fiber_g, it.measures[0].grams))}` : null;

    const card=document.createElement('div');
    card.className='item';
    card.innerHTML = `
      <div style="display:flex;gap:10px">
        <div class="imgbox"><img src="${esc(img)}" alt=""></div>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <div><strong>${esc(it.name||'-')}</strong> <span class="meta">${esc(it.brand||'')}</span></div>
            <span class="meta">${esc(it.category||'-')}</span>
          </div>
          <div class="chips">
            <span class="chip">GI: <strong>${fmt(it.gi)}</strong></span>
            <span class="chip">NetCarbs/100g: <strong>${fmt(nc)}</strong> g</span>
            <span class="chip">GL/100g: <strong>${fmt(gl100)}</strong></span>
            ${(firstMeasure?`<span class="chip">GL (${esc(it.measures[0].name)}): <strong>${firstMeasure.split(': ')[1]}</strong></span>`:'')}
            <span class="chip">كارب/100: ${fmt(n.carbs_g)}</span>
            <span class="chip">ألياف/100: ${fmt(n.fiber_g)}</span>
            <span class="chip">بروتين/100: ${fmt(n.protein_g)}</span>
            <span class="chip">دهون/100: ${fmt(n.fat_g)}</span>
            <span class="chip">سعرات/100: ${fmt(n.cal_kcal)}</span>
            ${(it.measures?.length?`<span class="chip">مقادير: ${it.measures.length}</span>`:'')}
          </div>
          <div class="row two" style="margin-top:8px">
            <button class="btn" data-act="edit">تعديل</button>
            <button class="btn danger" data-act="del">حذف</button>
          </div>
        </div>
      </div>
    `;
    card.querySelector('[data-act="edit"]').addEventListener('click',()=> openEdit(it));
    card.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
      if(!confirm(`حذف «${it.name}»؟`)) return;
      await deleteDoc(doc(db,'admin','global','foodItems', it.id));
      await loadItems();
      showSnack('تم الحذف');
    });
    grid.appendChild(card);
  });
}

/* Edit helpers */
function openEdit(it){
  formTitle.textContent='تعديل صنف';
  itemId.value = it.id;
  nameEl.value = it.name||''; categoryEl.value = it.category||''; brandEl.value = it.brand||'';
  unitEl.value = it.unit || 'g';
  const n = it.nutrPer100g || {};
  carb100El.value = n.carbs_g ?? ''; fiber100El.value = n.fiber_g ?? '';
  prot100El.value = n.protein_g ?? ''; fat100El.value = n.fat_g ?? ''; kcal100El.value = n.cal_kcal ?? '';
  giEl.value = it.gi ?? '';
  tagsEl.value = (Array.isArray(it.tags)? it.tags.join(', ') : '');
  sourceEl.value = it.source || '';
  imageUrlEl.value = it.imageUrl || '';
  SELECTED_FILE = null; imgFileEl.value=''; imgProg.classList.add('hidden'); imgProg.value=0;

  UNITS = Array.isArray(it.measures)? it.measures.map(m=>({name:m.name, grams:m.grams})) : [];
  renderUnits();

  imgPrev.src = it.imageUrl || autoImg(it.name);
  updateGLPreview();
  window.scrollTo({top:0,behavior:'smooth'});
}

/* Fallback image */
function autoImg(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <rect width="100%" height="100%" fill="hsl(${hue} 80% 90%)"/>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
        font-family="Segoe UI" font-size="54" fill="hsl(${hue} 60% 35%)">${esc((name||'ص')[0])}</text>
    </svg>`
  );
}

/* ================= Import / Export ================= */

/** كشف نوع الملف واستيراد CSV/Excel */
importBtn.addEventListener('click', ()=> anyInput.click());
anyInput.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const text = await file.text();
      await importRecords(parseCSV(text));
    } else if (ext === 'xlsx' || ext === 'xls') {
      const rows = await parseExcel(file);
      await importRecords(rows);
    } else {
      alert('صيغة غير مدعومة. استخدم CSV أو Excel');
    }
  }catch(err){
    console.error(err);
    alert('تعذّر الاستيراد: ' + (err.message||''));
  } finally {
    e.target.value = '';
  }
});

/** تصدير CSV */
exportBtn.addEventListener('click', ()=>{
  const header = ['name','category','brand','unit','carbs_g','fiber_g','protein_g','fat_g','cal_kcal','gi','measures','tags','imageUrl','notes','source'];
  const lines = [header.join(',')];
  for(const it of ITEMS){
    const n = it.nutrPer100g||{};
    const measures = Array.isArray(it.measures) ? it.measures.map(m=>`${m.name}:${m.grams}`).join('|') : '';
    const row = [
      csvCell(it.name), csvCell(it.category), csvCell(it.brand), csvCell(it.unit||'g'),
      csvCell(n.carbs_g), csvCell(n.fiber_g), csvCell(n.protein_g), csvCell(n.fat_g), csvCell(n.cal_kcal),
      csvCell(it.gi),
      csvCell(measures),
      csvCell(Array.isArray(it.tags)? it.tags.join('|') : ''),
      csvCell(it.imageUrl),
      csvCell(it.notes),
      csvCell(it.source||'manual')
    ].join(',');
    lines.push(row);
  }
  const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='food-items.csv'; a.click();
  URL.revokeObjectURL(url);
});

/** تنزيل قالب Excel بالترتيب الصحيح */
templateBtn.addEventListener('click', ()=>{
  const header = ['name','category','brand','unit','carbs_g','fiber_g','protein_g','fat_g','cal_kcal','gi','measures','tags','imageUrl','notes','source'];
  const sample = [{
    name:'أرز أبيض مطبوخ',
    category:'حبوب',
    brand:'',
    unit:'g',
    carbs_g:28,
    fiber_g:0.4,
    protein_g:2.6,
    fat_g:0.3,
    cal_kcal:130,
    gi:73,
    measures:'ملعقة:15|كوب:180',
    tags:'نشاء,أرز',
    imageUrl:'',
    notes:'قيم تقريبية',
    source:'manual'
  }];
  const ws = XLSX.utils.json_to_sheet(sample, {header});
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'food-items');
  XLSX.writeFile(wb, 'food-items-template.xlsx');
});

/* ---- Parsers ---- */
function csvCell(v){
  if (v==null) return '';
  const s = String(v).replace(/"/g,'""');
  return /[,"\n]/.test(s) ? `"${s}"` : s;
}
function parseCSV(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(Boolean);
  if(!lines.length) return [];
  const header = lines.shift().split(',').map(h=>h.trim());
  return lines.map(line=>{
    const cells = []; let cur=''; let q=false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (q){
        if (ch === '"' && line[i+1] === '"'){ cur+='"'; i++; }
        else if (ch === '"'){ q=false; }
        else cur += ch;
      } else {
        if (ch === '"'){ q=true; }
        else if (ch === ','){ cells.push(cur); cur=''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    const rec = {};
    header.forEach((h,idx)=> rec[h] = (cells[idx] ?? '').trim());
    return rec;
  });
}
async function parseExcel(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {defval:'', raw:true});
  return rows;
}

/** تطبيع رؤوس الحقول وتكوين سجل موحّد */
function unifyRecord(r){
  const key = s=> s.toString().trim().toLowerCase().replace(/[\s_]+/g,'');
  const map = {};
  for (const k in r){ map[key(k)] = r[k]; }

  const pick = (...names)=> {
    for (const n of names){ const v = map[key(n)]; if (v!==undefined) return v; }
    return '';
  };

  const measuresStr = pick('measures','units');
  const measures = (measuresStr||'').split('|').map(x=>x.trim()).filter(Boolean).map(seg=>{
    const [n,g]=seg.split(':');
    const grams = Number(g);
    return n && Number.isFinite(grams) ? {name:n.trim(), grams} : null;
  }).filter(Boolean);

  return {
    name: pick('name','اسم'),
    category: pick('category','الفئة') || null,
    brand: pick('brand','براند') || null,
    unit: pick('unit','الوحدة') || 'g',
    carbs_g: Number(pick('carbs_g','carbsg','carbsper100','carbs100')) || 0,
    fiber_g: Number(pick('fiber_g','fiberg','fiberper100','fiber100')) || 0,
    protein_g: Number(pick('protein_g','proteing','proteinper100','protein100')) || 0,
    fat_g: Number(pick('fat_g','fatg','fatper100','fat100')) || 0,
    cal_kcal: Number(pick('cal_kcal','kcalper100','calories','kcal')) || null,
    gi: Number(pick('gi','glycemicindex','giindex')) || null,
    measures,
    tags: normTags(pick('tags','وسوم')),
    imageUrl: pick('imageurl','image'),
    notes: pick('notes','ملاحظات'),
    source: pick('source','مصدر') || 'manual'
  };
}

async function importRecords(rows){
  if(!Array.isArray(rows) || !rows.length){ alert('لا توجد صفوف'); return; }
  const col = collection(db,'admin','global','foodItems');

  // سنستخدم batch على دفعات (500 حد أقصى)
  let batch = writeBatch(db), count=0, total=0;
  for (const raw of rows){
    const r = unifyRecord(raw);
    if(!r.name) continue;
    const kcal = Number.isFinite(r.cal_kcal) && r.cal_kcal!=null
      ? r.cal_kcal
      : Math.round(4*r.carbs_g + 4*r.protein_g + 9*r.fat_g);

    const ref = doc(col); // id عشوائي
    batch.set(ref, {
      name: r.name,
      nameLower: r.name.toLowerCase(),
      category: r.category,
      brand: r.brand,
      unit: r.unit || 'g',
      imageUrl: r.imageUrl || null,
      tags: r.tags,
      source: r.source || 'manual',
      gi: r.gi ?? null,
      nutrPer100g:{
        carbs_g:   r.carbs_g,
        fiber_g:   r.fiber_g,
        protein_g: r.protein_g,
        fat_g:     r.fat_g,
        cal_kcal:  kcal
      },
      measures: r.measures,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    count++; total++;
    if (count===450){ await batch.commit(); batch = writeBatch(db); count=0; }
  }
  if (count>0) await batch.commit();
  showSnack(`تم الاستيراد (${total})`);
  await loadItems();
}

/* ========= Excel Template is created in templateBtn handler above ========= */

/* ========= Helpers ========= */
function autoImg(name='صنف'){
  const hue=(Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0)%360);
  return 'data:image/svg+xml;utf8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <rect width="100%" height="100%" fill="hsl(${hue} 80% 90%)"/>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
        font-family="Segoe UI" font-size="54" fill="hsl(${hue} 60% 35%)">${esc((name||'ص')[0])}</text>
    </svg>`
  );
}
