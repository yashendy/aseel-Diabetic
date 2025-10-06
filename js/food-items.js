import {
  collection, getDocs, doc, setDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const db = window.db;

/* عناصر الواجهة */
const grid = document.getElementById('grid');
const q = document.getElementById('q');
const categorySel = document.getElementById('category');
const onlyActive = document.getElementById('onlyActive');
const btnNew = document.getElementById('btnNew');
const btnRefresh = document.getElementById('btnRefresh');

const dlg = document.getElementById('editor');
const formTitle = document.getElementById('formTitle');
const closeModal = document.getElementById('closeModal');
const saveBtn = document.getElementById('save');
const docId = document.getElementById('docId');
const catsDL = document.getElementById('cats');

const fields = {
  name_ar: document.getElementById('name_ar'),
  brand_ar: document.getElementById('brand_ar'),
  desc_ar: document.getElementById('desc_ar'),
  category_in: document.getElementById('category_in'),
  imageUrl: document.getElementById('imageUrl'),
  gi: document.getElementById('gi'),
  cal_kcal: document.getElementById('cal_kcal'),
  carbs_g: document.getElementById('carbs_g'),
  fiber_g: document.getElementById('fiber_g'),
  protein_g: document.getElementById('protein_g'),
  fat_g: document.getElementById('fat_g'),
  sodium_mg: document.getElementById('sodium_mg'),
  tags: document.getElementById('tags'),
  dietTags: document.getElementById('dietTags'),
  allergens: document.getElementById('allergens'),
  isActive: document.getElementById('isActive'),
  measuresList: document.getElementById('measuresList'),
  m_name_ar: document.getElementById('m_name_ar'),
  m_name_en: document.getElementById('m_name_en'),
  m_grams: document.getElementById('m_grams'),
  addMeasure: document.getElementById('addMeasure'),
};

const importBtn = document.getElementById('btnPreviewImport');
const exportBtn = document.getElementById('btnExport');
const excelFile = document.getElementById('excelFile');
const importCard = document.getElementById('importPreview');
const previewTable = document.getElementById('previewTable');
const confirmImport = document.getElementById('confirmImport');
const cancelImport = document.getElementById('cancelImport');
const selectAllRows = document.getElementById('selectAllRows');

let ITEMS = [];
let CATEGORIES = [];

/* ---------------- Helpers ---------------- */
function toArray(v){
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v).split(',').map(s=>s.trim()).filter(Boolean);
}
function el(tag, attrs={}, children=[]){
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k==='class') e.className=v;
    else if (k==='text') e.textContent=v;
    else e.setAttribute(k,v);
  });
  (Array.isArray(children)?children:[children]).forEach(c=>{
    if (c==null) return;
    e.appendChild(typeof c==='string'?document.createTextNode(c):c);
  });
  return e;
}
function computeAutoTags(obj){
  const tags = new Set(toArray(obj.tags).map(t=>t.replace(/^#*/,'#')));
  const diet = new Set(toArray(obj.dietTags));

  const carbs = +obj.carbs_g || 0;
  const sodium = +obj.sodium_mg || 0;

  // أمثلة قواعد بسيطة:
  if (carbs <= 5){ tags.add('#كيتو'); tags.add('#لو_كارب'); diet.add('keto'); }
  else if (carbs <= 20){ tags.add('#لو_كارب'); }

  if ((+obj.gi || 0) <= 55){ diet.add('low-gi'); tags.add('#لو_GI'); }
  if (sodium <= 120){ tags.add('#قليل_الملح'); diet.add('low-sodium'); }

  // فئات مساعدة
  const cat = (obj.category||'').trim();
  if (cat === 'النشويات') tags.add('#كارب');
  if (cat === 'منتجات اللحوم') tags.add('#بروتين');

  return { tags: Array.from(tags), dietTags: Array.from(diet) };
}
function measuresUI(list, measures){
  list.innerHTML='';
  (measures||[]).forEach((m,i)=>{
    const pill = el('span',{class:'pill'},[
      el('span',{text:`${m.name || '—'} · ${m.grams||0}g`}),
      el('button',{type:'button',class:'btn btn--ghost',style:'padding:2px 8px',text:'×'})
    ]);
    pill.lastChild.onclick = ()=>{ measures.splice(i,1); measuresUI(list, measures); };
    list.appendChild(pill);
  });
}

/* -------------- Rendering -------------- */
async function fetchItems(){
  ITEMS = [];
  const snap = await getDocs(collection(db,'admin','global','foodItems'));
  snap.forEach(d=>{
    const x = d.data(); x.id=d.id; ITEMS.push(x);
    if (x.category && !CATEGORIES.includes(x.category)) CATEGORIES.push(x.category);
  });
  CATEGORIES.sort();
  renderCategorySelect();
  renderGrid();
}
function renderCategorySelect(){
  categorySel.innerHTML = '<option value="">الفئة (الكل)</option>' +
    CATEGORIES.map(c=>`<option>${c}</option>`).join('');
  catsDL.innerHTML = CATEGORIES.map(c=>`<option value="${c}">`).join('');
}
function passFilters(x){
  if (onlyActive.checked && x.isActive===false) return false;
  const cq = q.value.trim().toLowerCase();
  if (categorySel.value && x.category!==categorySel.value) return false;
  if (cq){
    const hay = [
      x.name_ar, x.brand_ar, x.desc_ar, x.category,
      ...(x.tags||[]), ...(x.dietTags||[])
    ].join(' ').toLowerCase();
    if (!hay.includes(cq.replace(/^#*/,'#')) && !hay.includes(cq)) return false;
  }
  return true;
}
function renderGrid(){
  grid.innerHTML='';
  ITEMS.filter(passFilters).forEach(x=>{
    const card = el('div',{class:'card'});
    const header = el('div',{class:'item'},[
      el('img',{src:x.imageUrl||'https://via.placeholder.com/72?text=%20', alt:''}),
      el('div',{},[
        el('div',{style:'font-weight:600',text:x.name_ar||'—'}),
        el('div',{class:'muted',text:x.category||'—'}),
        el('div',{}, (x.tags||[]).map(t=>el('span',{class:'badge',text:t})))
      ])
    ]);
    const actions = el('div',{style:'display:flex;gap:8px;margin-top:10px'},[
      el('button',{class:'btn btn--ghost',text:'تعديل'}),
      el('button',{class:'btn',text:'حذف'})
    ]);
    actions.children[0].onclick = ()=> openEditor(x);
    actions.children[1].onclick = ()=> removeItem(x.id);

    card.append(header, actions);
    grid.appendChild(card);
  });
}

/* -------------- Editor -------------- */
function openEditor(x={}){
  formTitle.textContent = x.id ? 'تعديل صنف' : 'إضافة صنف';
  docId.value = x.id || '';
  fields.name_ar.value = x.name_ar || '';
  fields.brand_ar.value = x.brand_ar || '';
  fields.desc_ar.value = x.desc_ar || '';
  fields.category_in.value = x.category || '';
  fields.imageUrl.value = x.imageUrl || '';
  fields.gi.value = x.gi ?? '';
  fields.cal_kcal.value = x.nutrPer100g?.cal_kcal ?? '';
  fields.carbs_g.value = x.nutrPer100g?.carbs_g ?? '';
  fields.fiber_g.value = x.nutrPer100g?.fiber_g ?? '';
  fields.protein_g.value = x.nutrPer100g?.protein_g ?? '';
  fields.fat_g.value = x.nutrPer100g?.fat_g ?? '';
  fields.sodium_mg.value = x.nutrPer100g?.sodium_mg ?? '';
  fields.tags.value = (x.tags||[]).join(', ');
  fields.dietTags.value = (x.dietTags||[]).join(', ');
  fields.allergens.value = (x.allergens||[]).join(', ');
  fields.isActive.checked = x.isActive!==false;

  const measures = JSON.parse(JSON.stringify(x.measures||[]));
  fields.addMeasure.onclick = ()=>{
    const name = fields.m_name_ar.value.trim();
    const nameEn = fields.m_name_en.value.trim();
    const grams = parseFloat(fields.m_grams.value);
    if (!name || !grams) return;
    measures.push({name, name_en:nameEn || null, grams});
    fields.m_name_ar.value = fields.m_name_en.value = fields.m_grams.value = '';
    measuresUI(fields.measuresList, measures);
  };
  measuresUI(fields.measuresList, measures);

  saveBtn.onclick = async ()=>{
    const obj = {
      name_ar: fields.name_ar.value.trim(),
      brand_ar: fields.brand_ar.value.trim()||null,
      desc_ar: fields.desc_ar.value.trim()||null,
      category: fields.category_in.value.trim()||null,
      imageUrl: fields.imageUrl.value.trim()||null,
      gi: fields.gi.value? Number(fields.gi.value): null,
      nutrPer100g: {
        cal_kcal: fields.cal_kcal.value? Number(fields.cal_kcal.value): null,
        carbs_g: fields.carbs_g.value? Number(fields.carbs_g.value): null,
        fiber_g: fields.fiber_g.value? Number(fields.fiber_g.value): null,
        protein_g: fields.protein_g.value? Number(fields.protein_g.value): null,
        fat_g: fields.fat_g.value? Number(fields.fat_g.value): null,
        sodium_mg: fields.sodium_mg.value? Number(fields.sodium_mg.value): null,
      },
      tags: toArray(fields.tags.value),
      dietTags: toArray(fields.dietTags.value),
      allergens: toArray(fields.allergens.value),
      isActive: !!fields.isActive.checked,
      measures,
      updatedAt: serverTimestamp(),
      createdAt: x.createdAt || serverTimestamp(),
    };
    // أوسمة وأنظمة تلقائية
    const auto = computeAutoTags({
      category: obj.category,
      gi: obj.gi,
      carbs_g: obj.nutrPer100g.carbs_g,
      sodium_mg: obj.nutrPer100g.sodium_mg,
      tags: obj.tags,
      dietTags: obj.dietTags
    });
    obj.tags = Array.from(new Set([...obj.tags, ...auto.tags]));
    obj.dietTags = Array.from(new Set([...obj.dietTags, ...auto.dietTags]));

    const id = docId.value || crypto.randomUUID();
    await setDoc(doc(db,'admin','global','foodItems', id), obj, {merge:true});
    dlg.close(); await fetchItems();
  };

  dlg.showModal();
}
async function removeItem(id){
  if (!confirm('حذف هذا الصنف؟')) return;
  await deleteDoc(doc(db,'admin','global','foodItems', id));
  await fetchItems();
}

closeModal.onclick = ()=> dlg.close();
btnNew.onclick = ()=> openEditor({});
btnRefresh.onclick = ()=> fetchItems();
[q,categorySel,onlyActive].forEach(c=> c.addEventListener('input',renderGrid));

/* -------------- Import / Export -------------- */
importBtn.onclick = ()=> excelFile.click();
excelFile.onchange = async ()=>{
  if (!excelFile.files?.length) return;
  const file = excelFile.files[0];
  const data = await file.arrayBuffer();
  const wb = window.XLSX.read(data, {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(ws, {defval:''});

  // معاينة
  buildPreview(rows);
};
cancelImport.onclick = ()=>{ importCard.style.display='none'; };
selectAllRows.onchange = ()=>{
  previewTable.querySelectorAll('tbody input[type=checkbox]').forEach(cb=> cb.checked = selectAllRows.checked);
};
confirmImport.onclick = async ()=>{
  const checks = [...previewTable.querySelectorAll('tbody input[type=checkbox]')];
  const chosen = checks.filter(c=>c.checked).map(c=> JSON.parse(c.dataset.row));
  if (!chosen.length) return alert('اختاري صفوف للحفظ');

  const batch = writeBatch(db);
  chosen.forEach(r=>{
    const id = r.id || crypto.randomUUID();
    const nutr = {
      cal_kcal: +r.cal_kcal || null,
      carbs_g: +r.carbs_g || null,
      fiber_g: +r.fiber_g || null,
      protein_g: +r.protein_g || null,
      fat_g: +r.fat_g || null,
      sodium_mg: +r.sodium_mg || null,
    };
    const obj = {
      name_ar: r.name_ar || r.name || '',
      brand_ar: r.brand_ar || null,
      desc_ar: r.desc_ar || null,
      category: r.category || null,
      imageUrl: r.imageUrl || null,
      gi: r.gi? +r.gi : null,
      nutrPer100g: nutr,
      tags: toArray(r.tags),
      dietTags: toArray(r.dietTags),
      allergens: toArray(r.allergens),
      isActive: r.isActive!=='' ? !!r.isActive : true,
      measures: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const auto = computeAutoTags({
      category: obj.category,
      gi: obj.gi,
      carbs_g: nutr.carbs_g,
      sodium_mg: nutr.sodium_mg,
      tags: obj.tags,
      dietTags: obj.dietTags
    });
    obj.tags = Array.from(new Set([...obj.tags, ...auto.tags]));
    obj.dietTags = Array.from(new Set([...obj.dietTags, ...auto.dietTags]));
    batch.set(doc(db,'admin','global','foodItems', id), obj, {merge:true});
  });

  await batch.commit();
  importCard.style.display='none';
  await fetchItems();
};

function buildPreview(rows){
  importCard.style.display='';
  const headers = [
    'id','name_ar','brand_ar','desc_ar','category','imageUrl','gi',
    'cal_kcal','carbs_g','fiber_g','protein_g','fat_g','sodium_mg',
    'tags','dietTags','allergens','isActive'
  ];
  previewTable.tHead.innerHTML = '<tr><th></th>' + headers.map(h=>`<th>${h}</th>`).join('') + '</tr>';
  const tb = previewTable.tBodies[0] || previewTable.createTBody();
  tb.innerHTML='';
  rows.forEach(r=>{
    const nutr = {
      cal_kcal: +r.cal_kcal || null, carbs_g:+r.carbs_g||null, fiber_g:+r.fiber_g||null,
      protein_g:+r.protein_g||null, fat_g:+r.fat_g||null, sodium_mg:+r.sodium_mg||null
    };
    const obj = {
      id: r.id || '',
      name_ar:r.name_ar||r.name||'',
      brand_ar:r.brand_ar||'',
      desc_ar:r.desc_ar||'',
      category:r.category||'',
      imageUrl:r.imageUrl||'',
      gi:r.gi||'',
      ...nutr,
      tags:r.tags||'',
      dietTags:r.dietTags||'',
      allergens:r.allergens||'',
      isActive:r.isActive===''?'':!!r.isActive
    };
    const tr = el('tr');
    const cb = el('input',{type:'checkbox'}); cb.checked = true; cb.dataset.row = JSON.stringify(obj);
    tr.appendChild(el('td',{},cb));
    headers.forEach(h=> tr.appendChild(el('td',{text: obj[h]===''?'':String(obj[h])})));
    tb.appendChild(tr);
  });
}

exportBtn.onclick = ()=>{
  const rows = ITEMS.map(x=>({
    id:x.id,
    name_ar:x.name_ar||'',
    brand_ar:x.brand_ar||'',
    desc_ar:x.desc_ar||'',
    category:x.category||'',
    imageUrl:x.imageUrl||'',
    gi:x.gi??'',
    cal_kcal:x.nutrPer100g?.cal_kcal??'',
    carbs_g:x.nutrPer100g?.carbs_g??'',
    fiber_g:x.nutrPer100g?.fiber_g??'',
    protein_g:x.nutrPer100g?.protein_g??'',
    fat_g:x.nutrPer100g?.fat_g??'',
    sodium_mg:x.nutrPer100g?.sodium_mg??'',
    tags:(x.tags||[]).join(', '),
    dietTags:(x.dietTags||[]).join(', '),
    allergens:(x.allergens||[]).join(', '),
    isActive:x.isActive!==false
  }));
  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'foodItems');
  window.XLSX.writeFile(wb, 'foodItems.xlsx');
};

/* init */
fetchItems();
