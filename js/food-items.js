/* food-items.js — Admin catalog editor (schema-aligned)
 * Writes to Firestore: admin/global/foodItems
 * Requires: dictionaries.js, Firebase app initialized (global 'firebase' or 'db' injected)
 */
(function(){
  const $ = s=>document.querySelector(s);
  const $$ = s=>Array.from(document.querySelectorAll(s));

  // Categories from dictionary
  function fillCategories(){
    const sel = $('#category_in');
    const filterSel = $('#category');
    if(!sel || !window.CATEGORIES) return;
    sel.innerHTML = '';
    window.CATEGORIES.forEach(c=>{
      const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o);
    });
    if(filterSel && filterSel.children.length<=1){
      window.CATEGORIES.forEach(c=>{
        const o=document.createElement('option'); o.value=c; o.textContent=c; filterSel.appendChild(o);
      });
    }
  }

  function parseCSVList(el){
    return (el.value||'').split(',').map(x=>x.trim()).filter(Boolean);
  }

  const grid = $('#grid');
  const editor = $('#editor');
  const docIdEl = $('#docId');

  function pill(label, cls=''){ const span=document.createElement('span'); span.className='pill '+cls; span.textContent=label; return span; }

  // Firestore helpers (support v9 modular or global)
  let db = window.db;
  async function fs(){
    if(db) return db;
    if(window.firebase && firebase.firestore) { db=firebase.firestore(); return db; }
    // try modular lazy import
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
    db = getFirestore(); return db;
  }
  async function addOrUpdate(docId, payload){
    const { doc, setDoc, collection } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
    const dbi = await fs();
    const c = collection(dbi,'admin','global','foodItems');
    const ref = docId ? doc(dbi,'admin','global','foodItems',docId) : undefined;
    if(ref){ await setDoc(ref, payload, { merge:true }); return docId; }
    const { addDoc } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
    const d = await addDoc(c, payload); return d.id;
  }
  async function listDocs(filters){
    const { collection, getDocs, query, where, orderBy, limit } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
    const dbi = await fs();
    const c = collection(dbi,'admin','global','foodItems');
    const parts = [];
    if(filters.category) parts.push(where('category','==',filters.category));
    if(filters.onlyActive) parts.push(where('isActive','==',true));
    const q = parts.length ? query(c, ...parts, orderBy('name')) : query(c, orderBy('name'), limit(200));
    const snap = await getDocs(q);
    const arr=[]; snap.forEach(s=>arr.push({ id:s.id, ...s.data() })); return arr;
  }

  function openEditor(data){
    $('#formTitle').textContent = data?.id ? 'تعديل صنف' : 'إضافة صنف';
    docIdEl.value = data?.id || '';
    $('#name_ar').value = data?.name || '';
    $('#brand_ar').value = data?.brand || '';
    $('#desc_ar').value = data?.description || '';
    $('#category_in').value = data?.category || (window.CATEGORIES?.[0]||'أخرى');
    $('#imageUrl').value = data?.imageUrl || '';
    $('#gi').value = data?.nutrPer100g?.gi ?? '';

    // nutrPer100g
    const n = data?.nutrPer100g || {};
    ['cal_kcal','carbs_g','fiber_g','protein_g','fat_g','sodium_mg'].forEach(k=>{
      const el = document.getElementById(k);
      if(el) el.value = (n[k] ?? '');
    });

    // measures
    $('#measuresList').innerHTML='';
    (data?.measures||[]).forEach(m=> addMeasurePill(m.name, m.grams));

    // tags/dietTags/allergens
    $('#tags').value = (data?.tags||[]).join(', ');
    $('#dietTags').value = (data?.dietTags||[]).join(', ');
    $('#allergens').value = (data?.allergens||[]).join(', ');
    $('#isActive').checked = data?.isActive !== false;

    editor.showModal();
  }

  function gatherPayload(){
    const name = $('#name_ar').value.trim();
    const brand = $('#brand_ar').value.trim();
    const category = $('#category_in').value.trim();
    const imageUrl = $('#imageUrl').value.trim();
    const nutr = {
      cal_kcal: +($('#cal_kcal').value||0) || 0,
      carbs_g : +($('#carbs_g').value||0) || 0,
      fiber_g : +($('#fiber_g').value||0) || 0,
      protein_g: +($('#protein_g').value||0) || 0,
      fat_g: +($('#fat_g').value||0) || 0,
    };
    const gi = $('#gi').value;
    if(gi !== '') nutr.gi = Number(gi);

    const measures = Array.from(document.querySelectorAll('.measures .pill[data-g]'))
      .map(x=>({ name: x.dataset.n, grams: Number(x.dataset.g) }));

    // Validations
    if(!name) throw new Error('ادخل الاسم');
    if(!window.CATEGORIES.includes(category)) throw new Error('الفئة غير معتمدة');
    if(measures.some(m=> !(m.name && m.grams>0))) throw new Error('مقدار بيتي غير صحيح');

    // Normalize dietTags from dictionary only
    const dietTags = parseCSVList($('#dietTags'));
    const invalid = dietTags.filter(t=> !window.DIET_TAGS.includes(t));
    if(invalid.length) throw new Error('قيم dietTags غير معتمدة: '+invalid.join('، '));

    return {
      name, brand: brand || null,
      description: $('#desc_ar').value.trim() || null,
      category, imageUrl: imageUrl || '',
      nutrPer100g: nutr,
      measures,
      tags: parseCSVList($('#tags')),
      dietTags,
      allergens: parseCSVList($('#allergens')),
      isActive: $('#isActive').checked
    };
  }

  function renderGrid(list){
    grid.innerHTML = list.map(it=>`
      <div class="card item">
        <img src="${it.imageUrl||''}" alt=""/>
        <div style="flex:1">
          <div><b>${it.name||'—'}</b></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">
            ${it.category?`<span class="badge">${it.category}</span>`:''}
            ${(it.dietTags||[]).map(d=>`<span class="badge">${d}</span>`).join('')}
            ${(it.allergens||[]).map(a=>`<span class="badge danger">${a}</span>`).join('')}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${(it.measures||[]).map(m=>`<span class="pill">${m.name} (${m.grams}جم)</span>`).join('') || '<span class="badge warn">لا مقادير</span>'}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn btn--ghost" data-edit="${it.id}">تعديل</button>
        </div>
      </div>
    `).join('');

    // wire edit
    grid.querySelectorAll('[data-edit]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const id = btn.dataset.edit;
        const list = await listDocs({ category: $('#category').value, onlyActive: $('#onlyActive').checked });
        const data = list.find(x=>x.id===id);
        openEditor(data);
        $('#docId').value = id;
      });
    });
  }

  // Measures UI
  function addMeasurePill(name, grams){
    const el = document.createElement('span');
    el.className='pill';
    el.dataset.n = name;
    el.dataset.g = grams;
    el.textContent = `${name} (${grams}جم)`;
    const del = document.createElement('button'); del.textContent='×'; del.style.border='0'; del.style.background='transparent'; del.style.cursor='pointer';
    del.addEventListener('click', ()=> el.remove());
    el.appendChild(del);
    $('#measuresList').appendChild(el);
  }
  $('#addMeasure').addEventListener('click', ()=>{
    const n = $('#m_name_ar').value.trim() || '';
    const g = Number($('#m_grams').value);
    if(!n || !(g>0)) { alert('أدخل اسم مقدار ووزنه بالجرام'); return; }
    addMeasurePill(n, g);
    $('#m_name_ar').value=''; $('#m_name_en').value=''; $('#m_grams').value='';
  });

  // Tabs (visual only)
  $$('.tab').forEach(t=> t.addEventListener('click',()=>{
    $$('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
  }));

  // Save
  $('#save').addEventListener('click', async ()=>{
    try{
      const payload = gatherPayload();
      const id = $('#docId').value || null;
      const newId = await addOrUpdate(id, payload);
      editor.close();
      await refresh();
      alert('تم الحفظ');
    }catch(e){ alert(e.message||'تعذر الحفظ'); }
  });

  // Modal open/close
  $('#btnNew').addEventListener('click', ()=> openEditor(null));
  $('#closeModal').addEventListener('click', ()=> editor.close());

  // Filters
  async function refresh(){
    const list = await listDocs({ category: $('#category').value, onlyActive: $('#onlyActive').checked });
    // client search
    const q = ($('#q').value||'').trim();
    const qTag = q.startsWith('#') ? q.slice(1) : null;
    const filtered = list.filter(it=>{
      if(qTag) return (it.tags||[]).includes(qTag);
      const s = (q||'').toLowerCase();
      return !s || [it.name||'', it.brand||'', it.category||''].some(v=>String(v).toLowerCase().includes(s));
    });
    renderGrid(filtered);
  }
  $('#q').addEventListener('input', refresh);
  $('#category').addEventListener('change', refresh);
  $('#onlyActive').addEventListener('change', refresh);

  // Import Excel
  $('#btnImport').addEventListener('click', ()=>{
    if(!window.runExcelImporter) { alert('ملف الاستيراد غير محمّل'); return; }
    window.runExcelImporter(addOrUpdate);
  });

  fillCategories();
  refresh();
})();
