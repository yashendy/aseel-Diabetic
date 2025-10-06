// ====== Admin Food Items page (نسخة كاملة مع استيراد Excel) ======
import {
  collection, doc, addDoc, updateDoc, onSnapshot, getDocs,
  query, orderBy, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

if (!window.db) throw new Error('Firestore not initialized (window.db)!');

const collPath = ['admin','global','foodItems'];
const el = (id)=>document.getElementById(id);
const grid = el('grid');
const dlg  = el('editor');

/* === القوائم المعتمدة === */
const CATEGORIES = [
  'النشويات','منتجات الحليب','الفاكهة','الخضروات',
  'منتجات اللحوم','الدهون','الحلويات','اخرى'
];
const DIET_TAGS = [
  'low-gi','low-carb','high-protein','gluten-free','lactose-free',
  'vegetarian','vegan','keto','diabetic-friendly','halal'
];

/* === أدوات بسيطة === */
const placeholderImg = 'https://via.placeholder.com/72';
const setText = (id,v)=>{ const n=el(id); if(n) n.value = (v??''); };

function fillSelectors(){
  // فلتر الفئات فوق
  const f = el('category');
  if (f) {
    f.innerHTML = '<option value="">الفئة (الكل)</option>' +
      CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('');
  }
  // datalist للنموذج
  const dl = document.getElementById('cats');
  if (dl) {
    dl.innerHTML = CATEGORIES.map(c=>`<option value="${c}">`).join('');
  }
}

/* === الاستماع المباشر === */
let unsub=null;
function watch(){
  const qx = query(collection(window.db, ...collPath), orderBy('createdAt','desc'));
  if (unsub) unsub();
  unsub = onSnapshot(qx, (snap)=>{
    const items = snap.docs.map(d=>({id:d.id, ...d.data()}));
    render(items);
  });
}

/* === العرض === */
function render(list){
  grid.innerHTML='';
  const kw=(el('q')?.value||'').trim().toLowerCase();
  const cat=el('category')?.value||'';
  const only=el('onlyActive')?.checked;

  const m = list.filter(it=>{
    if (only && it.isActive===false) return false;
    if (cat && it.category!==cat) return false;
    if (!kw) return true;
    const hay=[it.name_ar,it.brand_ar,it.category,...(it.tags||[]),(it.dietTags||[])]
      .join(' ').toLowerCase();
    return hay.includes(kw.replace('#',''));
  });

  if(!m.length){ grid.innerHTML='<div class="card">لا توجد أصناف مطابقة.</div>'; return; }

  m.forEach(it=>{
    const card=document.createElement('div');
    card.className='card';
    card.innerHTML=`
      <div class="item">
        <img src="${it.imageUrl||placeholderImg}" onerror="this.src='${placeholderImg}'"/>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
            <div>
              <div style="font-weight:700">${it.name_ar||'-'}</div>
              <div class="badge">${it.category||'-'}</div>
            </div>
            <div>${it.isActive===false?'<span class="badge danger">مخفي</span>':''}</div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            ${(it.tags||[]).slice(0,4).map(t=>`<span class="pill">#${t}</span>`).join('')}
          </div>
          <div style="margin-top:10px;display:flex;gap:6px">
            <button class="btn btn--ghost" data-edit="${it.id}">تعديل</button>
            <button class="btn" data-del="${it.id}">حذف</button>
          </div>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

/* === المحرر === */
function openEditor(data){
  el('formTitle').textContent = data ? 'تعديل صنف' : 'إضافة صنف';
  setText('docId', data?.id||'');
  setText('name_ar', data?.name_ar);
  setText('brand_ar', data?.brand_ar);
  setText('desc_ar', data?.desc_ar);
  setText('category_in', data?.category || '');
  setText('imageUrl', data?.imageUrl);
  setText('gi', data?.gi??'');

  setText('cal_kcal',  data?.nutrPer100g?.cal_kcal??'');
  setText('carbs_g',   data?.nutrPer100g?.carbs_g??'');
  setText('fiber_g',   data?.nutrPer100g?.fiber_g??'');
  setText('protein_g', data?.nutrPer100g?.protein_g??'');
  setText('fat_g',     data?.nutrPer100g?.fat_g??'');
  setText('sodium_mg', data?.nutrPer100g?.sodium_mg??'');

  setText('tags',      (data?.tags||[]).join(', '));
  setText('dietTags',  (data?.dietTags||[]).join(', '));
  setText('allergens', (data?.allergens||[]).join(', '));
  el('isActive').checked = data?.isActive !== false;

  renderMeasures(data?.measures||[]);
  dlg.showModal();
}

function renderMeasures(arr){
  const box=el('measuresList'); box.innerHTML='';
  (arr||[]).forEach((m,i)=>{
    const chip=document.createElement('span');
    chip.className='pill';
    chip.innerHTML=`${m.name||m.name_ar||''} <small>(${m.grams||0}g)</small> <button class="close" data-rm-measure="${i}" title="حذف">×</button>`;
    box.appendChild(chip);
  });
  box.dataset.payload = JSON.stringify(arr||[]);
}

function addMeasure(){
  const name_ar=el('m_name_ar').value.trim();
  const name_en=el('m_name_en').value.trim();
  const grams=parseFloat(el('m_grams').value);
  if(!name_ar || !grams) return alert('أدخلي اسم المقدار والجرام');
  const list=JSON.parse(el('measuresList').dataset.payload||'[]');
  list.push({name:name_ar,name_en,grams});
  renderMeasures(list);
  el('m_name_ar').value=''; el('m_name_en').value=''; el('m_grams').value='';
}

document.addEventListener('click',(e)=>{
  const t=e.target;
  if(t.dataset && t.dataset.rmMeasure!==undefined){
    const i=+t.dataset.rmMeasure;
    const list=JSON.parse(el('measuresList').dataset.payload||'[]');
    list.splice(i,1); renderMeasures(list);
  }
});

/* === حفظ/حذف Firestore === */
const splitCSV=s=>(s||'').split(',').map(x=>x.trim()).filter(Boolean);
const nOrNull=v=>v===''?null:+v;

function validate(p){
  if(!p.name_ar) throw new Error('الاسم العربي مطلوب');
  if (!CATEGORIES.includes(p.category)) {
    // نسمح بحرية، أو نطبّع:
    p.category = 'اخرى';
  }
  return p;
}

function gather(){
  const p={
    name_ar: el('name_ar').value.trim(),
    brand_ar: el('brand_ar').value.trim()||null,
    desc_ar: el('desc_ar').value.trim()||null,
    category: el('category_in').value.trim(),
    imageUrl: el('imageUrl').value.trim()||null,
    gi: el('gi').value?+el('gi').value:null,
    nutrPer100g:{
      cal_kcal:  nOrNull(el('cal_kcal').value),
      carbs_g:   nOrNull(el('carbs_g').value),
      fiber_g:   nOrNull(el('fiber_g').value),
      protein_g: nOrNull(el('protein_g').value),
      fat_g:     nOrNull(el('fat_g').value),
      sodium_mg: nOrNull(el('sodium_mg').value)
    },
    tags: splitCSV(el('tags').value),
    dietTags: splitCSV(el('dietTags').value),
    allergens: splitCSV(el('allergens').value),
    measures: JSON.parse(el('measuresList').dataset.payload||'[]'),
    isActive: el('isActive').checked!==false
  };
  return validate(p);
}

async function save(){
  try{
    const data=gather();
    const id=el('docId').value;
    if(id){
      await updateDoc(doc(window.db, ...collPath, id), {...data, updatedAt:serverTimestamp()});
    }else{
      await addDoc(collection(window.db, ...collPath), {...data, createdAt:serverTimestamp()});
    }
    dlg.close();
  }catch(err){ console.error(err); alert(err.message||'حدث خطأ أثناء الحفظ'); }
}

async function softDelete(id){
  if(!confirm('حذف ناعم؟ سيتم إخفاء الصنف.')) return;
  await updateDoc(doc(window.db, ...collPath, id), {isActive:false, deleted:true, updatedAt:serverTimestamp()});
}

/* === استيراد Excel =============================== */
const toNum = (v) => {
  if (v === undefined || v === null) return null;
  const s = (''+v).toString().trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// measures cell example: "رغيف:120 | كوب:100"
function parseMeasures(cell){
  const raw = (cell||'').toString().trim();
  if (!raw) return [];
  return raw.split('|').map(p=>p.trim()).filter(Boolean).map(p=>{
    const [name, grams] = p.split(':').map(z=>z.trim());
    return name ? { name, grams: toNum(grams)||0 } : null;
  }).filter(Boolean);
}

function buildPayloadFromRow(r){
  const g = (keys)=> { for (const k of keys) if (r[k] !== undefined) return r[k]; return undefined; };

  const name_ar  = g(['name_ar','الاسم','اسم AR']);
  const category = (g(['category','الفئة']) || '').toString().trim();

  const payload = {
    name_ar: (name_ar||'').toString().trim(),
    brand_ar: (g(['brand_ar','البراند'])||null) || null,
    desc_ar:  (g(['desc_ar','الوصف'])||null)  || null,
    category,
    imageUrl: (g(['imageUrl','رابط صورة'])||'').toString().trim() || null,
    gi: toNum(g(['gi','GI'])),

    nutrPer100g: {
      cal_kcal:  toNum(g(['cal_kcal','kcal','السعرات','سعرات'])),
      carbs_g:   toNum(g(['carbs_g','carbs','الكارب'])),
      fiber_g:   toNum(g(['fiber_g','الألياف'])),
      protein_g: toNum(g(['protein_g','البروتين'])),
      fat_g:     toNum(g(['fat_g','الدهون'])),
      sodium_mg: toNum(g(['sodium_mg','الصوديوم'])),
    },

    tags:      splitCSV(g(['tags','#Tags','الوسوم'])),
    dietTags:  splitCSV(g(['dietTags','الأنظمة'])),
    allergens: splitCSV(g(['allergens','الحساسية'])),
    measures:  parseMeasures(g(['measures','المقادير'])),
    isActive: (()=>{
      const v = (g(['isActive','نشط']) ?? '1').toString().trim();
      return ['1','true','نعم','yes','y'].includes(v.toLowerCase());
    })()
  };

  if (!CATEGORIES.includes(payload.category)) payload.category = 'اخرى';
  return payload;
}

async function importExcelFile(file){
  if (!window.XLSX) { alert('مكتبة Excel غير محمّلة'); return; }
  const buf = await file.arrayBuffer();
  const wb  = window.XLSX.read(buf, { type: 'array' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });

  if (!rows.length) { alert('الملف لا يحتوي صفوفاً'); return; }
  if (!confirm(`سيتم استيراد ${rows.length} صف. هل تريد المتابعة؟`)) return;

  const BATCH_LIMIT = 400;
  let count = 0;
  let batch = writeBatch(window.db);

  for (let i=0; i<rows.length; i++){
    try{
      const payload = buildPayloadFromRow(rows[i]);
      if (!payload.name_ar) continue;
      const ref = doc(collection(window.db, ...collPath));
      batch.set(ref, { ...payload, createdAt: serverTimestamp() });
      count++;
      if (count % BATCH_LIMIT === 0){ await batch.commit(); batch = writeBatch(window.db); }
    }catch(err){ console.error('Import row error @', i+1, err); }
  }
  await batch.commit();
  alert(`تم استيراد ${count} صنف بنجاح ✅`);
}

/* === ربط الأحداث === */
function wire(){
  ['q','category','onlyActive'].forEach(id=>{
    const n=el(id); if(!n) return;
    const handler=()=>watch();
    n.addEventListener('input',handler);
    if(n.tagName==='SELECT') n.addEventListener('change',handler);
  });

  el('btnNew')?.addEventListener('click',()=>openEditor(null));
  el('closeModal')?.addEventListener('click',()=>dlg.close());
  el('addMeasure')?.addEventListener('click',addMeasure);
  el('save')?.addEventListener('click',save);

  // تعديل/حذف من الجريد
  grid.addEventListener('click',(e)=>{
    const t=e.target;
    if(t.dataset.edit){
      getDocs(query(collection(window.db, ...collPath))).then(s=>{
        const it=s.docs.map(d=>({id:d.id,...d.data()})).find(x=>x.id===t.dataset.edit);
        openEditor(it);
      });
    }else if(t.dataset.del){
      softDelete(t.dataset.del);
    }
  });

  // الاستيراد من Excel
  const btnImport = el('btnImport');
  const inpExcel  = el('excelFile');
  if (btnImport && inpExcel){
    btnImport.addEventListener('click', ()=> inpExcel.click());
    inpExcel.addEventListener('change', async (e)=>{
      const file = e.target.files?.[0]; if (!file) return;
      try{ await importExcelFile(file); watch(); }
      catch(err){ console.error(err); alert('فشل استيراد الملف'); }
      finally{ inpExcel.value=''; }
    });
  }
}

/* === تشغيل === */
fillSelectors();
wire();
watch();
