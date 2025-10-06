// ====== Admin Food Items page ======
import {
  collection, doc, addDoc, updateDoc, onSnapshot, getDocs, getDoc,
  query, orderBy, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

if (!window.db) throw new Error('Firestore not initialized (window.db)!');

// ===== Constants =====
const collPath = ['admin','global','foodItems'];
const el = (id)=>document.getElementById(id);
const grid = el('grid');
const dlg  = el('editor');

const CATEGORIES = [
  'النشويات','منتجات الحليب','الفاكهة','الخضروات',
  'منتجات اللحوم','الدهون','الحلويات','اخرى'
];

const placeholderImg =
  'data:image/svg+xml;utf8,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72">
      <rect width="100%" height="100%" fill="#f5f5f5"/>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
            font-size="10" fill="#999">no image</text>
    </svg>`
  );

// ===== Admin guard =====
async function requireAdmin() {
  if (!window.__uid) throw new Error('يرجى تسجيل الدخول أولًا.');
  const snap = await getDoc(doc(window.db, 'users', window.__uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    throw new Error('ليست لديك صلاحية (admin).');
  }
}

// ===== UI helpers =====
const setText = (id,v)=>{ const n=el(id); if(n) n.value = (v??''); };
const splitCSV=s=>(s||'').split(',').map(x=>x.trim()).filter(Boolean);
const nOrNull=v=>v===''?null:+v;

// اسماء الأعمدة المحتملة
const ALIASES = {
  name_ar:  ['name_ar','الاسم','اسم AR','الاسم AR','Arabic Name','name','الاسم (AR)'],
  category: ['category','الفئة'],
  imageUrl: ['imageUrl','رابط صورة','image','صورة'],
  gi:       ['gi','GI'],
  cal_kcal: ['cal_kcal','kcal','السعرات','سعرات'],
  carbs_g:  ['carbs_g','carbs','الكارب'],
  fiber_g:  ['fiber_g','الألياف'],
  protein_g:['protein_g','البروتين'],
  fat_g:    ['fat_g','الدهون'],
  sodium_mg:['sodium_mg','الصوديوم'],
  tags:     ['tags','#Tags','الوسوم'],
  dietTags: ['dietTags','الأنظمة'],
  allergens:['allergens','الحساسية'],
  measures: ['measures','المقادير','المقادير البيتية'],
  brand_ar: ['brand_ar','البراند'],
  desc_ar:  ['desc_ar','الوصف']
};

function normalizeKey(s){
  return (s||'').toString()
    .replace(/[\u200f\u200e]/g,'')
    .replace(/[()\[\]{}]/g,'')
    .replace(/\s+/g,'')
    .toLowerCase();
}
function gByAliases(row, aliases){
  const map = {};
  for (const k of Object.keys(row)) map[normalizeKey(k)] = row[k];
  for (const a of aliases) {
    const v = map[normalizeKey(a)];
    if (v !== undefined) return v;
  }
  return undefined;
}

// ===== Fill selectors =====
function fillSelectors(){
  const f = el('category');
  if (f) {
    f.innerHTML = '<option value="">الفئة (الكل)</option>' +
      CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('');
  }
  const dl = document.getElementById('cats');
  if (dl) {
    dl.innerHTML = CATEGORIES.map(c=>`<option value="${c}">`).join('');
  }
}
fillSelectors();

// ===== Live watch =====
let unsub=null;
function watch(){
  const kw=(el('q')?.value||'').trim().toLowerCase();
  const cat=el('category')?.value||'';
  const only=el('onlyActive')?.checked;

  const qx = query(collection(window.db, ...collPath), orderBy('createdAt','desc'));
  if (unsub) unsub();
  unsub = onSnapshot(qx, (snap)=>{
    let items = snap.docs.map(d=>({id:d.id, ...d.data()}));
    // client filtering
    items = items.filter(it=>{
      if (only && it.isActive===false) return false;
      if (cat && it.category!==cat) return false;
      if (!kw) return true;
      const hay=[it.name_ar,it.brand_ar,it.category,...(it.tags||[]),(it.dietTags||[])]
        .join(' ').toLowerCase();
      return hay.includes(kw.replace('#',''));
    });
    render(items);
  });
}
watch();

// ===== Render =====
function render(list){
  grid.innerHTML='';
  if(!list.length){ grid.innerHTML='<div class="card">لا توجد أصناف مطابقة.</div>'; return; }

  list.forEach(it=>{
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

// ===== Editor =====
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

// ===== Validation & save =====
function validate(p){
  if(!p.name_ar) throw new Error('الاسم العربي مطلوب');
  if (!CATEGORIES.includes(p.category)) p.category = 'اخرى';
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
    await requireAdmin();
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
  try{
    await requireAdmin();
    if(!confirm('حذف ناعم؟ سيتم إخفاء الصنف.')) return;
    await updateDoc(doc(window.db, ...collPath, id), {isActive:false, deleted:true, updatedAt:serverTimestamp()});
  }catch(err){ console.error(err); alert(err.message||'لا تملك صلاحية'); }
}

// ===== Import (Preview then Save) =====
const btnPreviewImport = el('btnPreviewImport');
const fileInput       = el('excelFile');
const importBox       = el('importPreview');
const previewTable    = el('previewTable');
const selectAllRows   = el('selectAllRows');
const confirmImport   = el('confirmImport');
const cancelImport    = el('cancelImport');

let _previewRows = []; // normalized objects
let _selectedMap = new Map();

function toNum(v){ // safely convert
  if (v === undefined || v === null) return null;
  const s = (''+v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function parseMeasures(cell){
  const raw = (cell||'').toString().trim();
  if (!raw) return [];
  return raw.split('|').map(p=>p.trim()).filter(Boolean).map(p=>{
    const [name, grams] = p.split(':').map(z=>z.trim());
    return name ? { name, grams: toNum(grams)||0 } : null;
  }).filter(Boolean);
}
function buildPayloadFromRow(r){
  const name_ar  = gByAliases(r, ALIASES.name_ar);
  const category = (gByAliases(r, ALIASES.category) || '').toString().trim();
  const payload = {
    name_ar: (name_ar||'').toString().trim(),
    brand_ar: (gByAliases(r,ALIASES.brand_ar)||null) || null,
    desc_ar:  (gByAliases(r,ALIASES.desc_ar)||null)  || null,
    category,
    imageUrl: (gByAliases(r, ALIASES.imageUrl)||'').toString().trim() || null,
    gi: toNum(gByAliases(r, ALIASES.gi)),
    nutrPer100g: {
      cal_kcal:  toNum(gByAliases(r, ALIASES.cal_kcal)),
      carbs_g:   toNum(gByAliases(r, ALIASES.carbs_g)),
      fiber_g:   toNum(gByAliases(r, ALIASES.fiber_g)),
      protein_g: toNum(gByAliases(r, ALIASES.protein_g)),
      fat_g:     toNum(gByAliases(r, ALIASES.fat_g)),
      sodium_mg: toNum(gByAliases(r, ALIASES.sodium_mg)),
    },
    tags:      splitCSV(gByAliases(r, ALIASES.tags)),
    dietTags:  splitCSV(gByAliases(r, ALIASES.dietTags)),
    allergens: splitCSV(gByAliases(r, ALIASES.allergens)),
    measures:  parseMeasures(gByAliases(r, ALIASES.measures)),
    isActive: true
  };
  if (!payload.name_ar) payload._error = 'الاسم (AR) مفقود';
  if (!CATEGORIES.includes(payload.category)) payload.category = 'اخرى';
  return payload;
}

function renderPreviewTable(rows){
  // header
  const head = `
    <tr>
      <th><input type="checkbox" id="headSel" ${selectAllRows.checked?'checked':''}></th>
      <th>الاسم</th><th>الفئة</th><th>kcal</th><th>كارب</th><th>بروتين</th><th>دهون</th><th>ملاحظات</th>
    </tr>`;
  previewTable.querySelector('thead').innerHTML = head;

  const tb = previewTable.querySelector('tbody');
  tb.innerHTML = '';
  _selectedMap.clear();

  rows.forEach((r, i)=>{
    const ok = !r._error;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="rowSel" data-idx="${i}" ${ok && selectAllRows.checked ? 'checked':''} ${ok? '':'disabled'}></td>
      <td>${r.name_ar||''}</td>
      <td>${r.category||''}</td>
      <td>${r.nutrPer100g?.cal_kcal??''}</td>
      <td>${r.nutrPer100g?.carbs_g??''}</td>
      <td>${r.nutrPer100g?.protein_g??''}</td>
      <td>${r.nutrPer100g?.fat_g??''}</td>
      <td style="color:${ok?'#16a34a':'#b91c1c'}">${ok?'جاهز':r._error}</td>
    `;
    tb.appendChild(tr);
    _selectedMap.set(i, ok && selectAllRows.checked);
  });

  // head checkbox control
  const headSel = document.getElementById('headSel');
  if (headSel) headSel.addEventListener('change', ()=>{
    selectAllRows.checked = headSel.checked;
    tb.querySelectorAll('.rowSel').forEach(ch=>{
      if (!ch.disabled) { ch.checked = headSel.checked; _selectedMap.set(+ch.dataset.idx, headSel.checked); }
    });
  });

  tb.addEventListener('change', (e)=>{
    if (e.target.classList.contains('rowSel')) {
      _selectedMap.set(+e.target.dataset.idx, e.target.checked);
    }
  });
}

btnPreviewImport?.addEventListener('click', ()=> fileInput.click());
fileInput?.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0]; if (!file) return;
  try{
    const buf = await file.arrayBuffer();
    const wb  = window.XLSX.read(buf, { type:'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
    _previewRows = rows.map(buildPayloadFromRow);
    importBox.style.display = '';
    renderPreviewTable(_previewRows);
  }catch(err){ console.error(err); alert('فشل قراءة الملف'); }
  finally{ fileInput.value=''; }
});
selectAllRows?.addEventListener('change', ()=> renderPreviewTable(_previewRows));
cancelImport?.addEventListener('click', ()=> { importBox.style.display='none'; _previewRows=[]; });

confirmImport?.addEventListener('click', async ()=>{
  try{
    await requireAdmin();
    const chosen = _previewRows
      .map((r,i)=> (_selectedMap.get(i) ? r : null))
      .filter(Boolean)
      .filter(r=>!r._error);

    if (!chosen.length) return alert('لم يتم اختيار صفوف صالحة.');
    if (!confirm(`سيتم حفظ ${chosen.length} عنصر. متابعة؟`)) return;

    const BATCH_LIMIT = 400;
    let count = 0;
    let batch = writeBatch(window.db);

    for (let i=0;i<chosen.length;i++){
      const ref = doc(collection(window.db, ...collPath));
      batch.set(ref, { ...chosen[i], createdAt: serverTimestamp() });
      count++;
      if (count % BATCH_LIMIT === 0){ await batch.commit(); batch = writeBatch(window.db); }
    }
    await batch.commit();
    alert(`تم حفظ ${count} عنصر ✅`);
    importBox.style.display = 'none';
    _previewRows = [];
  }catch(err){ console.error(err); alert(err.message||'فشل الحفظ'); }
});

// ===== Export to Excel =====
el('btnExport')?.addEventListener('click', async ()=>{
  try{
    const snap = await getDocs(query(collection(window.db, ...collPath)));
    const rows = snap.docs.map(d=>{
      const v = d.data();
      return {
        id: d.id,
        name_ar: v.name_ar||'',
        category: v.category||'',
        imageUrl: v.imageUrl||'',
        gi: v.gi??'',
        cal_kcal: v.nutrPer100g?.cal_kcal??'',
        carbs_g:  v.nutrPer100g?.carbs_g??'',
        fiber_g:  v.nutrPer100g?.fiber_g??'',
        protein_g:v.nutrPer100g?.protein_g??'',
        fat_g:    v.nutrPer100g?.fat_g??'',
        sodium_mg:v.nutrPer100g?.sodium_mg??'',
        tags: (v.tags||[]).join(', '),
        dietTags: (v.dietTags||[]).join(', '),
        allergens:(v.allergens||[]).join(', '),
        measures: (v.measures||[]).map(m=>`${m.name}:${m.grams}`).join(' | '),
        isActive: v.isActive!==false
      };
    });
    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'foodItems');
    window.XLSX.writeFile(wb, 'foodItems-export.xlsx');
  }catch(err){ console.error(err); alert('فشل التصدير'); }
});

// ===== Wire =====
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
}
wire();
