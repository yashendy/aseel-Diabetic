// js/meals.js
// يعتمد على window.db من firebase-config.js (compat)

(() => {
  // تحقق أن الـ db متاح
  const db = window.db;
  if (!db) {
    console.error("Firestore `db` غير متاح. تأكدي من تحميل js/firebase-config.js (compat) قبل هذا الملف.");
    return;
  }

  // عناصر DOM
  const btnAddFromLibrary = document.getElementById('btnAddFromLibrary');
  const itemsBody = document.getElementById('itemsBody');
  const tGrams = document.getElementById('tGrams');
  const tCarbs = document.getElementById('tCarbs');
  const tProt  = document.getElementById('tProt');
  const tFat   = document.getElementById('tFat');
  const tKcal  = document.getElementById('tKcal');

  // المكتبة
  const libModal   = document.getElementById('libModal');
  const libList    = document.getElementById('libList');
  const libSearch  = document.getElementById('libSearch');
  const libCatSel  = document.getElementById('libCategory');
  const libClose   = document.getElementById('libClose');
  const libCount   = document.getElementById('libCount');

  // مودال الإضافة
  const addModal   = document.getElementById('addModal');
  const addTitle   = document.getElementById('addTitle');
  const addUnitSel = document.getElementById('addUnit');
  const addQtyInp  = document.getElementById('addQty');
  const addConfirm = document.getElementById('addConfirm');
  const addCancel  = document.getElementById('addCancel');
  const addClose   = document.getElementById('addClose');

  // بيانات داخلية
  let libItems = [];          // أصناف المكتبة
  let filtered = [];          // نتائج البحث/الفلاتر
  let selectedItem = null;    // الصنف المختار قبل الإضافة
  const addedRows = [];       // أصناف مضافة للجدول

  // Helpers لفتح/غلق المودالات
  function open(el)  { el.classList.remove('hidden'); el.setAttribute('aria-hidden','false'); }
  function close(el) { el.classList.add('hidden');    el.setAttribute('aria-hidden','true'); }

  // تحميل أصناف المكتبة من Firestore: admin/global/foodItems
  async function loadLibrary() {
    // قرّينا من: admin/global/foodItems
    const snap = await db
      .collection('admin')
      .doc('global')
      .collection('foodItems')
      .where('isActive', 'in', [true, null]) // بعض عندها null
      .get();

    libItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // توحيد أسماء الحقول المتوقعة
    libItems.forEach(it => {
      it.name = it.name || it.name_ar || it.name_en || 'بدون اسم';
      // قيَم 100 جم
      it.per100 = it.per100 || it.nutrPer100g || {};
      // الوحدات
      it.measures = it.measures || it.units || [];
    });

    filtered = libItems.slice();
    renderLibrary();
  }

  // رسم كروت المكتبة
  function renderLibrary() {
    const q = (libSearch.value || '').trim().toLowerCase();
    const cat = libCatSel.value;

    const items = filtered.filter(it => {
      let ok = true;
      if (q) {
        const hay = (it.name + ' ' + (it.searchText || '') + ' ' + ((it.hashTagsAuto||[]).join(' '))).toLowerCase();
        ok = hay.includes(q);
      }
      if (ok && cat) ok = (it.category === cat);
      return ok;
    });

    libList.innerHTML = '';
    items.forEach(it => {
      const img = (it.image && (it.image.url || it.imageUrl)) || it.imageUrl || 'images/food-placeholder.svg';
      const kcal = it.per100.cal_kcal ?? 0;
      const carb = it.per100.carbs_g ?? 0;

      const card = document.createElement('button');
      card.className = 'card item-card';
      card.innerHTML = `
        <img class="thumb" src="${img}" alt="">
        <div class="card-body">
          <div class="title">${escapeHtml(it.name)}</div>
          <div class="muted">${it.category || '—'}</div>
          <div class="muted">kcal/100g: ${kcal} • كارب/100g: ${carb}</div>
        </div>
      `;
      card.addEventListener('click', () => onPickItem(it));
      libList.appendChild(card);
    });

    libCount.textContent = `${items.length} صنف`;
  }

  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  // عند اختيار صنف من المكتبة
  function onPickItem(it) {
    selectedItem = it;
    addTitle.textContent = `إضافة: ${it.name}`;

    // إعداد قائمة الوحدات
    addUnitSel.innerHTML = '';
    const units = Array.isArray(it.measures) ? it.measures : [];
    if (units.length) {
      units.forEach(u => {
        // توقع هيكل: { name: "كوب", grams: 160 } أو {label/name_ar/name, grams}
        const grams = +u.grams || 0;
        const label = u.name || u.label || u.name_ar || 'وحدة';
        const opt = document.createElement('option');
        opt.value = grams;
        opt.textContent = `${label} (~${grams} جم)`;
        addUnitSel.appendChild(opt);
      });
    } else {
      // fallback = 100 جم
      const opt = document.createElement('option');
      opt.value = 100;
      opt.textContent = '100 جم';
      addUnitSel.appendChild(opt);
    }

    addQtyInp.value = 1;
    open(addModal);
  }

  // إضافة الصف للجدول
  function addSelectedToTable() {
    if (!selectedItem) return;
    const gramsPerUnit = +addUnitSel.value || 100;
    const qty = Math.max(0.25, +addQtyInp.value || 1);
    const totalGrams = Math.round(gramsPerUnit * qty);

    // قيم 100 جم
    const p100 = selectedItem.per100 || {};
    const scale = (x) => Math.round(((+x || 0) * totalGrams / 100) * 10) / 10;

    const row = {
      id: selectedItem.id,
      name: selectedItem.name,
      grams: totalGrams,
      carbs: scale(p100.carbs_g),
      prot:  scale(p100.protein_g),
      fat:   scale(p100.fat_g),
      kcal:  scale(p100.cal_kcal)
    };
    addedRows.push(row);
    renderRows();
    close(addModal);
  }

  // رسم صفوف الجدول + الحسابات
  function renderRows() {
    itemsBody.innerHTML = '';
    let sGrams=0, sCarb=0, sProt=0, sFat=0, sKcal=0;

    addedRows.forEach((r,idx) => {
      sGrams += r.grams; sCarb += r.carbs; sProt += r.prot; sFat += r.fat; sKcal += r.kcal;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name)}</td>
        <td>—</td>
        <td><input type="number" class="input small qty" step="0.25" min="0.25" value="1" disabled /></td>
        <td>${r.grams}</td>
        <td>${r.carbs}</td>
        <td>${r.prot}</td>
        <td>${r.fat}</td>
        <td>${r.kcal}</td>
        <td><button class="btn icon danger" title="حذف" data-i="${idx}">🗑</button></td>
      `;
      tr.querySelector('button').addEventListener('click', e => {
        const i = +e.currentTarget.dataset.i;
        addedRows.splice(i,1);
        renderRows();
      });
      itemsBody.appendChild(tr);
    });

    tGrams.textContent = Math.round(sGrams);
    tCarbs.textContent = Math.round(sCarb*10)/10;
    tProt.textContent  = Math.round(sProt*10)/10;
    tFat.textContent   = Math.round(sFat*10)/10;
    tKcal.textContent  = Math.round(sKcal);
    // ممكن هنا تحدثي الكارب الحالي والـProgress لو حابة
    document.getElementById('carbNow').textContent = Math.round(sCarb*10)/10;
  }

  // فتح المكتبة
  async function openLibrary() {
    // أول مرة فقط نحمّل من Firestore
    if (!libItems.length) {
      try {
        await loadLibrary();
      } catch (err) {
        console.error('خطأ في قراءة مكتبة الأصناف:', err);
        alert('تعذر قراءة مكتبة الأصناف.');
        return;
      }
    }
    renderLibrary();
    open(libModal);
  }

  // أحداث
  btnAddFromLibrary?.addEventListener('click', openLibrary);
  libClose?.addEventListener('click', () => close(libModal));
  libSearch?.addEventListener('input', renderLibrary);
  libCatSel?.addEventListener('change', renderLibrary);

  addConfirm?.addEventListener('click', addSelectedToTable);
  addCancel?.addEventListener('click', () => close(addModal));
  addClose?.addEventListener('click', () => close(addModal));

  // Reset
  document.getElementById('btnReset')?.addEventListener('click', () => {
    addedRows.length = 0;
    renderRows();
  });

  // حفظ الوجبة (Placeholder ـ احفظي بطريقتك الحالية)
  document.getElementById('btnSaveMeal')?.addEventListener('click', () => {
    const payload = {
      createdAt: new Date().toISOString(),
      items: addedRows
    };
    console.log('حفظ الوجبة:', payload);
    alert('تم تحضير بيانات الحفظ في الـConsole. وصّليها بمسارك في Firestore.');
  });

})();
