// js/food-items.js — Admin catalog page
(function(){
  const $ = s=>document.querySelector(s);
  const $$ = s=>Array.from(document.querySelectorAll(s));

  // Offline banner
  let offlineShown = false;
  function showOffline(msg){
    if(offlineShown) return;
    offlineShown = true;
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;background:#fff3cd;color:#8a6d3b;border:1px solid #ffeeba;padding:12px 14px;border-radius:12px;z-index:50';
    b.textContent = msg || 'يبدو أنك غير متصل بالسيرفر. سيتم العمل في وضع Offline حتى يعود الاتصال.';
    document.body.appendChild(b);
    setTimeout(()=> b.remove(), 6000);
  }

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

  // Firestore helpers
  let db = window.db;
  async function fs(){
    if(db) return db;
    if(window.firebase && firebase.firestore) { db=firebase.firestore(); return db; }
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
    db = getFirestore(); return db;
  }
  async function addOrUpdate(docId, payload){
    const { doc, setDoc, collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
    const dbi = await fs();
    const col = collection(dbi,'admin','global','foodItems');
    if(docId){
      const ref = doc(dbi,'admin','global','foodItems',docId);
      payload.updatedAt = serverTimestamp();
      await setDoc(ref, payload, { merge:true }); 
      return docId;
    }else{
      payload.createdAt = serverTimestamp();
      payload.updatedAt = serverTimestamp();
      const d = await addDoc(col, payload);
      return d.id;
    }
  }
  async function softDelete(docId){
    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
    const dbi = await fs();
    const ref = doc(dbi,'admin','global','foodItems',docId);
    await updateDoc(ref, { isActive:false, deleted:true });
  }
  async function listDocs(filters){
    try{
      const { collection, getDocs, query, where, orderBy, limit } = await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js');
      const dbi = await fs();
      const col = collection(dbi,'admin','global','foodItems');
      const parts = [];
      if(filters.category) parts.push(where('category','==',filters.category));
      if(filters.onlyActive) parts.push(where('isActive','==',true));
      const q = parts.length ? query(col, ...parts, orderBy('name')) : query(col, orderBy('name'), limit(500));
      const snap = await getDocs(q);
      const arr=[]; snap.forEach(s=>arr.push({ id:s.id, ...s.data() }));
      return arr;
    }catch(e){
      console.warn('listDocs error', e);
      showOffline('تعذر الاتصال بـ Firestore (تأكدي من firebaseConfig والقواعد).');
      return [];
    }
  }

  // UI helpers
  const grid = $('#grid');
  function badge(text, cls){ return `<span class="badge ${cls||''}">${text}</span>`; }
  function pill(text){ return `<span class="pill">${text}</span>`; }

  function renderGrid(list){
    grid.innerHTML = list.map(it=>`
      <div class="card item">
        <img src="${it.imageUrl||''}" alt=""/>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <b>${it.name||'—'}</b>
            ${it.isActive===false?badge('غير منشور','warn'):''}
            ${it.deleted?badge('محذوف','danger'):''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">
            ${it.category?badge(it.category):''}
            ${(it.dietTags||[]).map(d=>badge(d)).join('')}
            ${(it.allergens||[]).map(a=>badge(a,'danger')).join('')}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${(it.measures||[]).map(m=>pill(`${m.name} (${m.grams}جم)`)).join('') || badge('لا مقادير','warn')}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn btn--ghost" data-edit="${it.id}">تعديل</button>
          <button class="btn" style="background:#222" data-del="${it.id}">حذف</button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('[data-edit]').forEach(btn=>{
      btn.addEventListener('click', ()=> openEditor(list.find(x=>x.id===btn.dataset.edit)));
    });
    grid.querySelectorAll('[data-del]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(confirm('تأكيد حذف الصنف؟ (حذف ناعم: سيصبح غير نشط)')){
          await softDelete(btn.dataset.del);
          await refresh();
        }
      });
    });
  }

  // Editor modal
  const editor = $('#editor');
  const docIdEl = $('#docId');
  function openEditor(data){
    $('#formTitle').textContent = data?.id ? 'تعديل صنف' : 'إضافة صنف';
    docIdEl.value = data?.id || '';
    $('#name_ar').value   = data?.name || '';
    $('#brand_ar').value  = data?.brand || '';
    $('#desc_ar').value   = data?.description || '';
    $('#category_in').value = data?.category || (window.CATEGORIES?.[0] || 'أخرى');
    $('#imageUrl').value  = data?.imageUrl || '';
    $('#gi').value        = data?.nutrPer100g?.gi ?? '';

    const n = data?.nutrPer100g || {};
    ['cal_kcal','carbs_g','fiber_g','protein_g','fat_g','sodium_mg'].forEach(k=>{
      const el = document.getElementById(k); if(el) el.value = (n[k] ?? '');
    });

    $('#measuresList').innerHTML='';
    (data?.measures||[]).forEach(m=> addMeasurePill(m.name, m.grams));

    $('#tags').value      = (data?.tags||[]).join(', ');
    $('#dietTags').value  = (data?.dietTags||[]).join(', ');
    $('#allergens').value = (data?.allergens||[]).join(', ');
    $('#isActive').checked = data?.isActive !== false;

    editor.showModal();
  }

  function addMeasurePill(name, grams){
    const el = document.createElement('span');
    el.className='pill';
    el.dataset.n = name; el.dataset.g = grams;
    el.textContent = `${name} (${grams}جم)`;
    const del = document.createElement('button'); del.textContent='×'; del.style.border='0'; del.style.background='transparent'; del.style.cursor='pointer';
    del.addEventListener('click', ()=> el.remove());
    el.appendChild(del);
    $('#measuresList').appendChild(el);
  }
  $('#addMeasure').addEventListener('click', ()=>{
    const n = $('#m_name_ar').value.trim();
    const g = Number($('#m_grams').value);
    if(!n || !(g>0)) return alert('أدخل اسم مقدار ووزنه بالجرام');
    addMeasurePill(n,g);
    $('#m_name_ar').value=''; $('#m_name_en').value=''; $('#m_grams').value='';
  });

  function parseCSVList(el){ return (el.value||'').split(',').map(x=>x.trim()).filter(Boolean); }

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

    const measures = Array.from(document.querySelectorAll('.measures .pill'))
      .map(x=>({ name: x.dataset.n, grams: Number(x.dataset.g) }));

    if(!name) throw new Error('ادخل الاسم');
    if(!window.CATEGORIES.includes(category)) throw new Error('الفئة غير معتمدة');
    if(measures.some(m=> !(m.name && m.grams>0))) throw new Error('مقدار بيتي غير صحيح');

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

  async function save(){
    try{
      const payload = gatherPayload();
      const id = $('#docId').value || null;
      await addOrUpdate(id, payload);
      editor.close();
      await refresh();
      alert('تم الحفظ');
    }catch(e){
      console.error(e);
      alert(e.message||'تعذر الحفظ (راجعي الاتصال ومفاتيح Firebase)');
    }
  }

  async function refresh(){
    const list = await listDocs({ category: $('#category').value, onlyActive: $('#onlyActive').checked });
    const q = ($('#q').value||'').trim();
    const qTag = q.startsWith('#') ? q.slice(1) : null;
    const filtered = list.filter(it=>{
      if(qTag) return (it.tags||[]).includes(qTag);
      const s = (q||'').toLowerCase();
      return !s || [it.name||'', it.brand||'', it.category||''].some(v=>String(v).toLowerCase().includes(s));
    });
    renderGrid(filtered);
  }

  // Wire
  $('#btnNew').addEventListener('click', ()=> openEditor(null));
  $('#save').addEventListener('click', save);
  $('#closeModal').addEventListener('click', ()=> editor.close());
  $('#q').addEventListener('input', refresh);
  $('#category').addEventListener('change', refresh);
  $('#onlyActive').addEventListener('change', refresh);

  fillCategories();
  refresh();
})();
