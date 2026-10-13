// js/food-items.js — إدارة مكتبة الطعام (الأدمن)
import { db, auth } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, query, where, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  esc, normAr, safeUrl, toNum, round1, normTags, buildSearchFields, kcalFromMacros, portionStats, hypoGramsFor,
  validateFood, watchedSnapshot, diffFood, recipeToPer100, parseCSV, csvTemplate, foodsToCSV, rowToFood, makeThumb,
  CATEGORIES, ALLERGENS, SOURCES, HYPO_TAG
} from './food-utils.js';

const $ = id => document.getElementById(id);
const FOODS = collection(db, 'admin', 'global', 'foodItems');
const REQS = collection(db, 'admin', 'global', 'foodRequests');
const PAGE = 24;

let me = null;
let cache = [];
let requests = [];
let view = { shown: PAGE };
let selectMode = false;
const selected = new Set();
let editing = null;       // { id, kind, req, thumb, imagePath, ingredients, existing }
let importRows = [];
let wired = false;

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 2600); }
const isArchived = f => f.isActive === false;
const isHypo = f => (f.tags || []).includes(HYPO_TAG);

// ============================================================
// 1) الدخول + صلاحية الأدمن (فعلياً من users/{uid}.role)
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = 'index.html'; return; }
  try {
    const u = await getDoc(doc(db, 'users', user.uid));
    const role = u.exists() ? u.data()?.role : null;
    if (role !== 'admin') { alert('🚫 تم الرفض: هذه الصفحة مخصصة للإدارة العليا فقط.'); location.href = 'index.html'; return; }
  } catch (e) { console.error(e); alert('تعذر التحقق من الصلاحية.'); location.href = 'index.html'; return; }

  me = { uid: user.uid, name: user.displayName || user.email || 'admin' };
  $('admin-name').textContent = me.name;
  if (!wired) { wire(); startLive(); wired = true; }   // مرة واحدة حتى لو تكرر حدث الدخول
});
$('btn-logout').onclick = () => signOut(auth).then(() => location.href = 'index.html');

function startLive() {
  onSnapshot(FOODS, snap => {
    cache = snap.docs.map(s => {
      const d = { id: s.id, ...s.data() };
      d._s = d.searchNorm || normAr(`${d.name} ${d.category} ${(d.tags || []).join(' ')}`);
      return d;
    });
    renderAll();
  }, err => { console.error(err); toast('تعذر تحميل المكتبة — راجعي الصلاحيات'); });

  onSnapshot(query(REQS, where('status', '==', 'pending')), snap => {
    requests = snap.docs.map(s => ({ id: s.id, ...s.data() }));
    renderRequests(); renderStats();
  }, err => console.error('requests:', err));
}

// ============================================================
// 2) العرض: إحصائيات / فلاتر / بطاقات
// ============================================================
function renderAll() { renderStats(); renderCards(); }

function renderStats() {
  const active = cache.filter(f => !isArchived(f));
  const stats = [
    ['active', active.length, 'صنف نشط', ''],
    ['unverified', active.filter(f => f.verified !== true).length, 'غير موثّق', 'warn'],
    ['hypo', active.filter(isHypo).length, 'أصناف رفع الهبوط', ''],
    ['recipe', active.filter(f => f.kind === 'recipe').length, 'وصفات', ''],
    ['archived', cache.length - active.length, 'مؤرشف', ''],
    [null, requests.length, 'طلبات معلّقة', requests.length ? 'danger' : '']
  ];
  $('stats').innerHTML = stats.map(([st, n, label, cls]) =>
    `<div class="stat-pill ${cls} ${st ? 'clickable' : ''}" ${st ? `data-status="${st}"` : ''}><b>${n}</b><span>${label}</span></div>`).join('');
}

function getFiltered() {
  const words = normAr($('search').value).split(' ').filter(Boolean);
  const cat = $('filter-category').value, st = $('filter-status').value, sort = $('sort-by').value;
  const list = cache.filter(f => {
    const arch = isArchived(f);
    if (st === 'active' && arch) return false;
    if (st === 'archived' && !arch) return false;
    if (st === 'unverified' && (arch || f.verified === true)) return false;
    if (st === 'hypo' && (arch || !isHypo(f))) return false;
    if (st === 'recipe' && (arch || f.kind !== 'recipe')) return false;
    if (cat && f.category !== cat) return false;
    return words.every(w => f._s.includes(w));
  });
  const ts = f => (f.updatedAt?.seconds || f.createdAt?.seconds || 0);
  if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  else if (sort === 'carbs-desc') list.sort((a, b) => (b.per100?.carbs_g || 0) - (a.per100?.carbs_g || 0));
  else if (sort === 'carbs-asc') list.sort((a, b) => (a.per100?.carbs_g || 0) - (b.per100?.carbs_g || 0));
  else list.sort((a, b) => ts(b) - ts(a));
  return list;
}

function cardHTML(f) {
  const p = f.per100 || {};
  const url = safeUrl(f.image?.url) || safeUrl(f.image?.thumb) || safeUrl(f.imageUrl);
  const thumb = safeUrl(f.image?.thumb);
  const img = url
    ? `<img loading="lazy" src="${esc(url)}" data-thumb="${esc(thumb)}" alt="${esc(f.name)}">`
    : `<div class="no-img">🍽️ بدون صورة</div>`;
  const ps = portionStats(f, 0);
  const hypoG = isHypo(f) ? hypoGramsFor(f, 15) : null;
  const archived = isArchived(f);
  const tl = [];
  if (p.gi > 0) tl.push(`<span class="badge">GI: ${esc(p.gi)}</span>`);
  if (isHypo(f)) tl.push(`<span class="badge hypo">🧃 رفع${hypoG ? ` • ${hypoG}g=15 كارب` : ''}</span>`);
  const tr = [];
  tr.push(f.verified === true ? `<span class="badge ok">✓ موثّق</span>` : `<span class="badge warn">غير موثّق</span>`);
  if (f.kind === 'recipe') tr.push(`<span class="badge recipe">🍲 وصفة</span>`);
  if (archived) tr.push(`<span class="badge arch">مؤرشف</span>`);
  const allergens = (f.allergens || []).map(k => `<span class="allergen-chip">⚠ ${esc((ALLERGENS.find(a => a.key === k) || {}).label || k)}</span>`).join('');

  return `
    <article class="food-card ${archived ? 'is-archived' : ''} ${selectMode ? 'select-mode' : ''} ${selected.has(f.id) ? 'selected' : ''}" data-id="${esc(f.id)}">
      ${selectMode ? `<label class="sel-box"><input type="checkbox" data-sel="${esc(f.id)}" ${selected.has(f.id) ? 'checked' : ''}></label>` : ''}
      <div class="badges-tl">${tl.join('')}</div>
      <div class="badges-tr">${tr.join('')}</div>
      ${img}
      <h3>${esc(f.name)}</h3>
      <div class="cat">${esc(f.category)} | ${esc(p.cal_kcal || 0)} kcal</div>
      <div class="macros">
        <div><strong>${esc(p.carbs_g || 0)}g</strong>كارب</div>
        <div><strong>${round1(Math.max(0, (p.carbs_g || 0) - (p.fiber_g || 0)))}g</strong>صافي</div>
        <div><strong>${esc(p.protein_g || 0)}g</strong>بروتين</div>
        <div><strong>${esc(p.fat_g || 0)}g</strong>دهون</div>
      </div>
      <div class="portion-line">${esc(ps.label)} (${round1(ps.grams)}g) ← كارب صافي <b>${round1(ps.net)}g</b></div>
      ${allergens ? `<div class="allergen-line">${allergens}</div>` : ''}
      <div class="card-actions">
        <button class="btn ghost sm" data-act="edit">✏️ تعديل</button>
        <button class="btn ghost sm" data-act="${archived ? 'restore' : 'archive'}">${archived ? '♻️ استرجاع' : '🗄️ أرشفة'}</button>
        <button class="btn ghost sm" data-act="history" title="سجل التعديلات">📜</button>
      </div>
    </article>`;
}

function renderCards() {
  const list = getFiltered();
  const shown = list.slice(0, view.shown);
  $('cards').innerHTML = shown.map(cardHTML).join('');
  $('empty-state').classList.toggle('hidden', list.length > 0);
  $('btn-more').classList.toggle('hidden', list.length <= view.shown);
  $('result-count').textContent = list.length ? `عرض ${shown.length} من ${list.length}` : '';
  $('bulk-count').textContent = selected.size;
}

function renderRequests() {
  $('req-panel').classList.toggle('hidden', requests.length === 0);
  $('req-count').textContent = requests.length;
  $('req-list').innerHTML = requests.map(r => {
    const p = r.per100 || {};
    const hasMacros = ['carbs_g', 'fiber_g', 'protein_g', 'fat_g'].some(k => p[k] !== undefined && p[k] !== null && p[k] !== '');
    return `
    <div class="req-item" data-id="${esc(r.id)}">
      <div class="info">
        <b>${esc(r.name)}</b>
        <div class="meta">من: ${esc(r.requestedByName || 'مستخدم')} • ${esc(r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('ar-EG') : '')}</div>
        ${r.notes ? `<div class="meta">📝 ${esc(r.notes)}</div>` : ''}
        ${hasMacros ? `<div class="meta">مقترح لكل 100جم: كارب ${esc(p.carbs_g ?? '—')} | ألياف ${esc(p.fiber_g ?? '—')} | بروتين ${esc(p.protein_g ?? '—')} | دهون ${esc(p.fat_g ?? '—')}</div>` : ''}
      </div>
      <div class="actions">
        <button class="btn primary sm" data-act="req-approve">➕ إضافة للمكتبة</button>
        <button class="btn ghost sm" data-act="req-reject">رفض</button>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// 3) ربط الأحداث (مرة واحدة)
// ============================================================
function wire() {
  // قوائم ثابتة
  const catOpts = CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('');
  $('category').innerHTML = catOpts;
  $('filter-category').insertAdjacentHTML('beforeend', catOpts);
  $('source').innerHTML = SOURCES.filter(s => s.key !== 'family').map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
  $('allergen-tags').innerHTML = ALLERGENS.map(a => `<button class="tag-btn allergen-btn" type="button" data-allergen="${a.key}">${esc(a.label)}</button>`).join('');

  // فلاتر
  const reset = () => { view.shown = PAGE; renderCards(); };
  $('search').oninput = reset;
  ['filter-category', 'filter-status', 'sort-by'].forEach(id => $(id).onchange = reset);
  $('btn-more').onclick = () => { view.shown += PAGE; renderCards(); };
  $('stats').addEventListener('click', e => {
    const p = e.target.closest('[data-status]'); if (!p) return;
    $('filter-status').value = p.dataset.status; reset();
  });

  // البطاقات
  $('cards').addEventListener('click', e => {
    const sel = e.target.closest('[data-sel]');
    if (sel) { toggleSel(sel.dataset.sel, sel.checked); return; }
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.food-card').dataset.id;
    if (btn.dataset.act === 'edit') openEditor(id);
    if (btn.dataset.act === 'archive') setActive([id], false);
    if (btn.dataset.act === 'restore') setActive([id], true);
    if (btn.dataset.act === 'history') openHistory(id);
  });
  // فشل تحميل الصورة الخارجية → نرجع للمصغّرة أو للصورة البديلة
  $('cards').addEventListener('error', e => {
    const img = e.target; if (img.tagName !== 'IMG') return;
    const th = img.dataset.thumb;
    if (th && img.src !== th) { img.src = th; return; }
    const ph = document.createElement('div'); ph.className = 'no-img'; ph.textContent = '🍽️ بدون صورة'; img.replaceWith(ph);
  }, true);

  // الطلبات
  $('req-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.req-item').dataset.id; const r = requests.find(x => x.id === id); if (!r) return;
    if (btn.dataset.act === 'req-approve') openEditor(null, { prefill: { name: r.name, per100: r.per100 || {} }, req: { id: r.id } });
    if (btn.dataset.act === 'req-reject') rejectRequest(r);
  });

  // أزرار الأعلى
  $('btn-add').onclick = () => openEditor(null);
  $('btn-add-recipe').onclick = () => openEditor(null, { recipe: true });
  $('btn-import').onclick = openImport;
  $('btn-export').onclick = exportCSV;
  $('btn-select-mode').onclick = () => {
    selectMode = !selectMode; if (!selectMode) selected.clear();
    $('bulk-bar').classList.toggle('hidden', !selectMode);
    $('btn-select-mode').textContent = selectMode ? '✖️ إنهاء التحديد' : '☑️ تحديد متعدد';
    renderCards();
  };
  $('bulk-all').onclick = () => { getFiltered().slice(0, view.shown).forEach(f => selected.add(f.id)); renderCards(); };
  $('bulk-none').onclick = () => { selected.clear(); renderCards(); };
  $('bulk-archive').onclick = () => bulk('archive');
  $('bulk-restore').onclick = () => bulk('restore');
  $('bulk-verify').onclick = () => bulk('verify');

  wireEditor();
  wireImport();
  $('hist-close').onclick = () => $('hist-dialog').close();
}

function toggleSel(id, on) {
  on ? selected.add(id) : selected.delete(id);
  $('bulk-count').textContent = selected.size;
  const card = document.querySelector(`.food-card[data-id="${CSS.escape(id)}"]`);
  if (card) card.classList.toggle('selected', on);
}

// ============================================================
// 4) كتابة مجمّعة: أرشفة / استرجاع / توثيق (مع سجل)
// ============================================================
async function setActive(ids, active) {
  if (!ids.length) return;
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const batch = writeBatch(db);
      ids.slice(i, i + 200).forEach(id => {
        const ref = doc(FOODS, id);
        batch.update(ref, { isActive: active, updatedAt: serverTimestamp(), updatedBy: me.uid });
        batch.set(doc(collection(ref, 'history')), historyEntry(active ? 'restore' : 'archive', ['isActive'], { isActive: !active }, { isActive: active }));
      });
      await batch.commit();
    }
    toast(active ? 'تم الاسترجاع ♻️' : 'تمت الأرشفة 🗄️ (لن يظهر للأسر)');
  } catch (e) { console.error(e); alert('تعذر التنفيذ: ' + e.message); }
}

async function bulk(kind) {
  const ids = [...selected]; if (!ids.length) { toast('حددي أصنافاً أولاً'); return; }
  if (kind === 'verify' && !confirm(`توثيق ${ids.length} صنف؟ تأكدي أنك راجعتِ قيمها فعلاً.`)) return;
  if (kind === 'archive' && !confirm(`أرشفة ${ids.length} صنف؟`)) return;
  if (kind === 'verify') {
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const batch = writeBatch(db);
        ids.slice(i, i + 200).forEach(id => {
          const ref = doc(FOODS, id);
          batch.update(ref, { verified: true, verifiedBy: me.uid, verifiedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid });
          batch.set(doc(collection(ref, 'history')), historyEntry('verify', ['verified'], { verified: false }, { verified: true }));
        });
        await batch.commit();
      }
      toast('تم التوثيق ✅');
    } catch (e) { console.error(e); alert('تعذر التنفيذ: ' + e.message); }
  } else await setActive(ids, kind === 'restore');
  selected.clear(); renderCards();
}

function historyEntry(action, changed, before, after) {
  return { at: serverTimestamp(), byUid: me.uid, byName: me.name, action, changed, before: before ?? null, after: after ?? null };
}

async function rejectRequest(r) {
  const note = prompt(`سبب رفض طلب "${r.name}" (اختياري):`, '');
  if (note === null) return;
  try {
    const batch = writeBatch(db);
    batch.update(doc(REQS, r.id), { status: 'rejected', adminNote: note || '', resolvedBy: me.uid, resolvedAt: serverTimestamp() });
    await batch.commit(); toast('تم رفض الطلب');
  } catch (e) { console.error(e); alert('تعذر التنفيذ: ' + e.message); }
}

// ============================================================
// 5) المحرر
// ============================================================
const setVal = (id, v) => { $(id).value = (v === null || v === undefined) ? '' : v; };

function createUnitRow(u = { label: '', grams: '' }) {
  const row = document.createElement('div'); row.className = 'unit-row';
  const l = document.createElement('input'); l.type = 'text'; l.className = 'u-lbl'; l.placeholder = 'الاسم (مثال: كوب)'; l.value = u.label || '';
  const g = document.createElement('input'); g.type = 'number'; g.className = 'u-gr'; g.placeholder = 'جرام'; g.style.width = '90px'; g.min = '1'; g.value = u.grams ?? '';
  const d = document.createElement('button'); d.type = 'button'; d.className = 'btn danger sm'; d.textContent = '✕';
  d.onclick = () => { row.remove(); validateLive(); };
  row.append(l, g, d); return row;
}
function readUnits() {
  const arr = [];
  document.querySelectorAll('#units-list .unit-row').forEach(r => {
    const label = r.querySelector('.u-lbl').value.trim(), gramsRaw = r.querySelector('.u-gr').value;
    if (!label && gramsRaw === '') return;
    arr.push({ label, grams: toNum(gramsRaw) });
  });
  return arr;
}

function setActiveTags(tags) {
  const known = new Set();
  document.querySelectorAll('#edit-dialog .tag-btn[data-tag]').forEach(b => { const on = (tags || []).includes(b.dataset.tag); b.classList.toggle('active', on); known.add(b.dataset.tag); });
  $('hashTagsManual').value = (tags || []).filter(t => !known.has(t)).join(' ');
}
function activeTags() {
  const t = [...document.querySelectorAll('#edit-dialog .tag-btn[data-tag].active')].map(b => b.dataset.tag);
  return normTags([...t, $('hashTagsManual').value]);
}
function activeAllergens() { return [...document.querySelectorAll('.allergen-btn.active')].map(b => b.dataset.allergen); }

function updatePreview() {
  const img = $('imagePreview');
  const src = safeUrl($('imageUrl').value) || editing?.thumb || '';
  if (src) { img.src = src; img.classList.remove('hidden'); } else { img.removeAttribute('src'); img.classList.add('hidden'); }
  $('btn-remove-thumb').classList.toggle('hidden', !editing?.thumb);
}

function setRecipeMode(on) {
  editing.kind = on ? 'recipe' : 'food';
  $('is-recipe').checked = on;
  $('recipe-card').classList.toggle('hidden', !on);
  ['carbs_g', 'fiber_g', 'protein_g', 'fat_g', 'cal_kcal', 'gi'].forEach(id => $(id).readOnly = on);
  if (on) recomputeRecipe();
}

function openEditor(id, opts = {}) {
  const f = id ? cache.find(x => x.id === id) : null;
  if (id && !f) { toast('الصنف غير موجود'); return; }
  editing = { id: id || null, kind: f?.kind || (opts.recipe ? 'recipe' : 'food'), req: opts.req || null, thumb: f?.image?.thumb || '', imagePath: f?.image?.path || '', ingredients: [], existing: f || null };

  $('edit-form').reset(); $('units-list').innerHTML = ''; $('val-box').classList.add('hidden'); $('calc-info').textContent = '';
  document.querySelectorAll('.allergen-btn').forEach(b => b.classList.remove('active'));
  $('rc-results').innerHTML = ''; $('rc-list').innerHTML = '';

  const pre = opts.prefill || {};
  const p = f?.per100 || pre.per100 || {};
  $('item-id').value = id || '';
  $('dlg-title').textContent = id ? 'تعديل صنف' : (opts.req ? 'إضافة صنف من طلب' : (editing.kind === 'recipe' ? 'وصفة مركبة جديدة' : 'إضافة صنف جديد'));
  setVal('name', f?.name ?? pre.name ?? '');
  $('category').value = f?.category || 'أخرى';
  $('source').value = f?.source && SOURCES.some(s => s.key === f.source) ? f.source : (editing.kind === 'recipe' ? 'recipe' : 'manual');
  $('verified').checked = f?.verified === true;
  ['carbs_g', 'fiber_g', 'protein_g', 'fat_g', 'cal_kcal'].forEach(k => setVal(k, p[k]));
  setVal('gi', p.gi > 0 ? p.gi : '');   // الأصناف القديمة خزّنت GI الفارغ كـ 0 — نعرضه فارغاً

  const units = f?.units?.length ? f.units : [{ label: '100 جرام', grams: 100 }];
  units.forEach(u => $('units-list').appendChild(createUnitRow(u)));
  setActiveTags(f?.tags || []);
  (f?.allergens || []).forEach(k => { const b = document.querySelector(`.allergen-btn[data-allergen="${k}"]`); if (b) b.classList.add('active'); });

  setVal('imageUrl', f?.image?.url || '');
  updatePreview();

  if (f?.kind === 'recipe' && f.recipe) {
    editing.ingredients = (f.recipe.ingredients || []).map(i => ({ ...i }));
    setVal('rc-cooked', f.recipe.cookedGrams);
  }
  setRecipeMode(editing.kind === 'recipe');
  renderIngredients();

  $('btn-delete').classList.toggle('hidden', !(f && isArchived(f)));
  $('btn-archive').classList.toggle('hidden', !f);
  $('btn-archive').textContent = f && isArchived(f) ? '♻️ استرجاع' : '🗄️ أرشفة';
  $('btn-history').classList.toggle('hidden', !f);

  $('edit-dialog').showModal();
  validateLive();
}

function collectForm() {
  const per100 = { carbs_g: toNum($('carbs_g').value), fiber_g: toNum($('fiber_g').value), protein_g: toNum($('protein_g').value), fat_g: toNum($('fat_g').value), cal_kcal: toNum($('cal_kcal').value), gi: toNum($('gi').value) };
  const units = readUnits();
  const food = {
    name: $('name').value.trim(), category: $('category').value, per100,
    units: units.length ? units : [{ label: '100 جرام', grams: 100 }],
    tags: activeTags(), allergens: activeAllergens(), source: $('source').value, verified: $('verified').checked,
    kind: editing.kind, recipe: null
  };
  if (editing.kind === 'recipe') {
    const rc = recipeToPer100(editing.ingredients, toNum($('rc-cooked').value));
    food.recipe = { ingredients: editing.ingredients.map(i => ({ foodId: i.foodId, name: i.name, grams: Number(i.grams) || 0, per100: i.per100 || {} })), rawGrams: rc.rawGrams, cookedGrams: toNum($('rc-cooked').value) };
  }
  return food;
}

// ---------- التحقق الحي ----------
let vTimer = null;
function validateLive() { clearTimeout(vTimer); vTimer = setTimeout(runValidation, 120); }
function showValidation(errors, warnings) {
  const box = $('val-box');
  if (!errors.length && !warnings.length) { box.className = 'val-box hidden'; return; }
  box.className = 'val-box ' + (errors.length ? 'has-err' : 'has-warn');
  box.innerHTML =
    (errors.length ? `<strong>❌ يجب تصحيحها:</strong><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '') +
    (errors.length && warnings.length ? '<div class="sep"></div>' : '') +
    (warnings.length ? `<strong>⚠️ تنبيهات:</strong><ul>${warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '');
}
function runValidation() {
  if (!editing || !$('edit-dialog').open) return;
  const f = collectForm();
  const { errors, warnings } = validateFood(f);
  // أخطاء "مطلوب" لا تُعرض قبل أن تبدأ بالإدخال (نظهرها عند الحفظ)
  const touched = ['name', 'carbs_g', 'fiber_g', 'protein_g', 'fat_g'].some(id => $(id).value !== '');
  showValidation(touched ? errors : [], touched ? warnings : []);

  const p = f.per100;
  const allNum = [p.carbs_g, p.protein_g, p.fat_g].every(v => v !== null);
  $('calc-info').textContent = allNum ? `السعرات المحسوبة من الماكروز ≈ ${Math.round(kcalFromMacros(p))} kcal${p.cal_kcal === null ? ' (ستُستخدم عند الحفظ لأن الحقل فارغ)' : ''}` : '';
  const hel = $('hypo-helper');
  if (f.tags.includes(HYPO_TAG) && p.carbs_g > 0) { hel.textContent = `🧃 ${hypoGramsFor(f, 15)} جرام/مل من هذا الصنف تعطي 15 جم كارب.`; hel.classList.remove('hidden'); }
  else hel.classList.add('hidden');
}

function wireEditor() {
  const dlg = $('edit-dialog');
  $('dlg-close').onclick = () => dlg.close();
  $('btn-cancel').onclick = () => dlg.close();
  $('btn-add-unit').onclick = () => { $('units-list').appendChild(createUnitRow()); };
  document.querySelectorAll('.chip-sm').forEach(c => c.onclick = () => {
    const [, lbl, gr] = c.dataset.unit.split('|'); $('units-list').appendChild(createUnitRow({ label: lbl, grams: gr })); validateLive();
  });
  dlg.addEventListener('click', e => {
    const t = e.target.closest('.tag-btn'); if (!t) return;
    t.classList.toggle('active'); validateLive();
  });
  $('edit-form').addEventListener('input', validateLive);
  $('imageUrl').addEventListener('input', updatePreview);

  $('btn-calc-kcal').onclick = () => {
    const p = collectForm().per100;
    if ([p.carbs_g, p.protein_g, p.fat_g].some(v => v === null)) { toast('أدخلي الكارب والبروتين والدهون أولاً'); return; }
    setVal('cal_kcal', Math.round(kcalFromMacros(p))); validateLive();
  };

  $('btn-pick').onclick = () => $('imageFile').click();
  $('imageFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { editing.thumb = await makeThumb(file); updatePreview(); toast('تم تجهيز الصورة المصغرة'); }
    catch (err) { console.error(err); toast('تعذر معالجة الصورة — جرّبي صيغة JPG/PNG أو رابطاً خارجياً'); }
    e.target.value = '';
  };
  $('btn-remove-thumb').onclick = () => { editing.thumb = ''; updatePreview(); };

  // وصفة
  $('is-recipe').onchange = () => { setRecipeMode($('is-recipe').checked); validateLive(); };
  $('rc-cooked').addEventListener('input', () => { recomputeRecipe(); validateLive(); });
  $('rc-search').addEventListener('input', renderRecipeResults);
  $('rc-results').addEventListener('click', e => {
    const b = e.target.closest('button[data-fid]'); if (!b) return;
    const food = cache.find(x => x.id === b.dataset.fid); if (!food) return;
    editing.ingredients.push({ foodId: food.id, name: food.name, grams: 100, per100: { ...(food.per100 || {}) } });
    $('rc-search').value = ''; $('rc-results').innerHTML = '';
    renderIngredients(); recomputeRecipe(); validateLive();
  });
  $('rc-list').addEventListener('input', e => {
    const inp = e.target.closest('input[data-i]'); if (!inp) return;
    editing.ingredients[Number(inp.dataset.i)].grams = toNum(inp.value) || 0;
    recomputeRecipe(); validateLive();
  });
  $('rc-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    editing.ingredients.splice(Number(b.dataset.rm), 1);
    renderIngredients(); recomputeRecipe(); validateLive();
  });

  $('edit-form').onsubmit = onSave;
  $('btn-archive').onclick = async () => {
    const f = editing?.existing; if (!f) return;
    await setActive([f.id], isArchived(f)); dlg.close();
  };
  $('btn-history').onclick = () => { if (editing?.id) openHistory(editing.id); };
  $('btn-delete').onclick = onDelete;
}

function renderRecipeResults() {
  const words = normAr($('rc-search').value).split(' ').filter(Boolean);
  if (!words.length) { $('rc-results').innerHTML = ''; return; }
  const res = cache.filter(f => !isArchived(f) && f.kind !== 'recipe' && f.id !== editing?.id && words.every(w => f._s.includes(w))).slice(0, 8);
  $('rc-results').innerHTML = res.map(f => `<button type="button" data-fid="${esc(f.id)}"><span>${esc(f.name)}</span><span class="muted">${esc(f.per100?.carbs_g ?? 0)}g كارب/100</span></button>`).join('');
}
function renderIngredients() {
  $('rc-list').innerHTML = editing.ingredients.map((i, idx) =>
    `<div class="rc-row"><span class="nm">${esc(i.name)}</span><input type="number" min="1" step="1" data-i="${idx}" value="${esc(i.grams)}" inputmode="decimal"> <span class="muted">جم</span><button type="button" class="btn danger sm" data-rm="${idx}">✕</button></div>`).join('');
}
function recomputeRecipe() {
  if (editing?.kind !== 'recipe') return;
  const rc = recipeToPer100(editing.ingredients, toNum($('rc-cooked').value));
  if (!rc.per100) { $('rc-summary').textContent = 'أضيفي مكونات لحساب القيم.'; return; }
  ['carbs_g', 'fiber_g', 'protein_g', 'fat_g', 'cal_kcal', 'gi'].forEach(k => setVal(k, rc.per100[k]));
  $('rc-summary').textContent = `الوزن الخام ${rc.rawGrams} جم — القيم محسوبة لكل 100 جم من ${rc.denom} جم${toNum($('rc-cooked').value) ? ' (بعد الطهي)' : ' (بدون وزن الطهي: افترضنا أن الوزن لا يتغير)'}. القيم محفوظة وقت الحفظ ولا تتغير تلقائياً لو تغيّرت المكونات.`;
}

// ---------- الحفظ ----------
async function onSave(e) {
  e.preventDefault();
  const f = collectForm();
  const { errors, warnings } = validateFood(f);
  const nn = normAr(f.name);
  const dup = cache.find(x => x.id !== editing.id && !isArchived(x) && (x.normalizedName || normAr(x.name)) === nn);
  if (dup) warnings.push(`يوجد صنف بنفس الاسم بالفعل ("${dup.name}").`);
  if (editing.kind === 'recipe' && editing.ingredients.length === 0) errors.push('أضيفي مكوناً واحداً على الأقل للوصفة.');
  showValidation(errors, warnings);
  if (errors.length) { toast('صححي الأخطاء أولاً'); return; }
  if (warnings.length && !confirm('تنبيهات:\n- ' + warnings.join('\n- ') + '\n\nهل تريدين الحفظ رغم ذلك؟')) return;

  const btn = $('btn-save'); btn.disabled = true; btn.textContent = 'جاري الحفظ...';
  try {
    const per100 = { ...f.per100 };
    let kcalEstimated = false;
    if (per100.cal_kcal === null) { per100.cal_kcal = Math.round(kcalFromMacros(per100)); kcalEstimated = true; }
    const ex = editing.existing;
    const id = editing.id || doc(FOODS).id;
    const ref = doc(FOODS, id);

    const after = { ...f, per100, isActive: ex ? ex.isActive !== false : true };
    const sf = buildSearchFields(f);
    const wasVerified = ex?.verified === true;

    const payload = {
      name: f.name, category: f.category, kind: f.kind, per100, units: f.units, tags: f.tags, allergens: f.allergens, source: f.source,
      verified: f.verified, kcalEstimated, recipe: f.recipe,
      image: { path: editing.imagePath || '', url: safeUrl($('imageUrl').value), thumb: editing.thumb || '' },
      ...sf, isActive: after.isActive, updatedAt: serverTimestamp(), updatedBy: me.uid
    };
    if (f.verified && !wasVerified) { payload.verifiedBy = me.uid; payload.verifiedAt = serverTimestamp(); }
    if (!f.verified) { payload.verifiedBy = null; payload.verifiedAt = null; }
    if (!ex) { payload.createdAt = serverTimestamp(); payload.createdBy = me.uid; }

    // 1) حفظ الصنف الأساسي أولاً
    await setDoc(ref, payload, { merge: true });

    // 2) محاولة حفظ السجل والطلب بشكل منفصل (حتى لا يفشل حفظ الصنف إذا كانت صلاحيات المجموعات الفرعية مقيدة)
    try {
      if (!ex) {
        await setDoc(doc(collection(ref, 'history')), historyEntry('create', ['*'], null, watchedSnapshot(after)));
      } else {
        const d = diffFood(ex, after);
        if (d.changed.length) {
          await setDoc(doc(collection(ref, 'history')), historyEntry('update', d.changed, d.before, d.after));
        }
      }
      if (editing.req) {
        await updateDoc(doc(REQS, editing.req.id), { status: 'approved', resolvedBy: me.uid, resolvedAt: serverTimestamp(), resultFoodId: id });
      }
    } catch (subErr) {
      console.warn('تعذر حفظ السجل التاريخي أو الطلب بسبب الصلاحيات:', subErr);
    }

    $('edit-dialog').close();
    toast(ex ? 'تم الحفظ ✅' : 'تمت إضافة الصنف ✅');
  } catch (err) { console.error(err); alert('خطأ في الحفظ: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = '💾 حفظ الصنف في المكتبة'; }
}

async function onDelete() {
  const f = editing?.existing; if (!f) return;
  if (!isArchived(f)) { toast('أرشفي الصنف أولاً'); return; }
  const ans = prompt(`حذف "${f.name}" نهائياً؟ اكتبي كلمة: حذف`);
  if (ans !== 'حذف') return;
  try {
    const ref = doc(FOODS, f.id);
    const batch = writeBatch(db);
    batch.set(doc(collection(ref, 'history')), historyEntry('delete', ['*'], watchedSnapshot(f), null));
    batch.delete(ref);
    await batch.commit();
    $('edit-dialog').close(); toast('تم الحذف النهائي');
  } catch (e) { console.error(e); alert('تعذر الحذف: ' + e.message); }
}

// ============================================================
// 6) سجل التعديلات
// ============================================================
const FIELD_LABEL = { name: 'الاسم', category: 'الفئة', per100: 'القيم الغذائية', units: 'المقادير', tags: 'الوسوم', allergens: 'الحساسية', isActive: 'الحالة', verified: 'التوثيق', source: 'المصدر', kind: 'النوع', recipe: 'الوصفة', '*': 'الصنف كاملاً' };
const ACTION_LABEL = { create: '➕ إنشاء', update: '✏️ تعديل', archive: '🗄️ أرشفة', restore: '♻️ استرجاع', verify: '✅ توثيق', delete: '🗑️ حذف', import: '📥 استيراد' };
const P100_LABEL = { carbs_g: 'كارب', fiber_g: 'ألياف', protein_g: 'بروتين', fat_g: 'دهون', cal_kcal: 'سعرات', gi: 'GI' };

function describeChange(h, key) {
  const b = h.before?.[key], a = h.after?.[key];
  if (key === 'per100') {
    const parts = Object.keys(P100_LABEL).filter(k => (b?.[k] ?? null) !== (a?.[k] ?? null)).map(k => `${P100_LABEL[k]}: <code>${esc(b?.[k] ?? '—')}</code> ← <code>${esc(a?.[k] ?? '—')}</code>`);
    return parts.join(' | ') || 'بدون فرق ظاهر';
  }
  if (['name', 'category', 'source', 'kind'].includes(key)) return `<code>${esc(b ?? '—')}</code> ← <code>${esc(a ?? '—')}</code>`;
  if (key === 'isActive') return a ? 'نشط' : 'مؤرشف';
  if (key === 'verified') return a ? 'موثّق' : 'غير موثّق';
  if (key === 'units') return (a || []).map(u => `${esc(u.label)}=${esc(u.grams)}g`).join('، ');
  if (key === 'tags' || key === 'allergens') return (a || []).map(esc).join(' ') || 'بدون';
  return '';
}

async function openHistory(id) {
  const f = cache.find(x => x.id === id);
  $('hist-title').textContent = `سجل: ${f?.name || ''}`;
  $('hist-body').innerHTML = '<div class="muted">جاري التحميل...</div>';
  $('hist-dialog').showModal();
  try {
    const snap = await getDocs(query(collection(FOODS, id, 'history'), orderBy('at', 'desc'), limit(30)));
    if (snap.empty) { $('hist-body').innerHTML = '<div class="muted">لا يوجد سجل لهذا الصنف (الأصناف القديمة يبدأ سجلها من أول تعديل).</div>'; return; }
    $('hist-body').innerHTML = snap.docs.map(s => {
      const h = s.data();
      const when = h.at?.toDate ? h.at.toDate().toLocaleString('ar-EG') : '';
      const changed = (h.changed || []).filter(k => k !== '*');
      return `<div class="hist-item">
        <div class="h"><span>${esc(ACTION_LABEL[h.action] || h.action)} — ${esc(h.byName || '')}</span><span>${esc(when)}</span></div>
        ${changed.length ? changed.map(k => `<div><b>${esc(FIELD_LABEL[k] || k)}:</b> ${describeChange(h, k)}</div>`).join('') : `<div class="muted">${esc(FIELD_LABEL['*'])}</div>`}
      </div>`;
    }).join('');
  } catch (e) { console.error(e); $('hist-body').innerHTML = `<div class="muted">تعذر تحميل السجل: ${esc(e.message)}</div>`; }
}

// ============================================================
// 7) استيراد / تصدير CSV
// ============================================================
function download(name, text) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportCSV() {
  const list = [...cache].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  download(`food-library-${new Date().toISOString().slice(0, 10)}.csv`, foodsToCSV(list));
  toast(`تم تصدير ${list.length} صنف`);
}

function openImport() {
  importRows = []; $('imp-file').value = ''; $('imp-table').innerHTML = ''; $('imp-summary').textContent = ''; $('imp-run').disabled = true;
  $('imp-dialog').showModal();
}
function wireImport() {
  $('imp-close').onclick = () => $('imp-dialog').close();
  $('imp-cancel').onclick = () => $('imp-dialog').close();
  $('imp-template').onclick = () => download('food-import-template.csv', csvTemplate());
  $('imp-file').onchange = async e => { const f = e.target.files[0]; if (f) parseImport(await f.text()); };
  $('imp-skipdup').onchange = () => renderImport();
  $('imp-run').onclick = runImport;
}

function parseImport(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { $('imp-summary').textContent = '❌ الملف فارغ أو بدون صفوف بيانات.'; return; }
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const need = ['name', 'carbs_g', 'fiber_g', 'protein_g', 'fat_g'];
  const missing = need.filter(h => !headers.includes(h));
  if (missing.length) { $('imp-summary').textContent = `❌ أعمدة ناقصة: ${missing.join(', ')}`; $('imp-table').innerHTML = ''; return; }

  const existing = new Set(cache.map(f => f.normalizedName || normAr(f.name)));
  const seen = new Set();
  importRows = rows.slice(1).map((r, i) => {
    const obj = {}; headers.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    const res = rowToFood(obj);
    const key = normAr(res.food.name);
    const dup = !!key && (existing.has(key) || seen.has(key));
    if (key) seen.add(key);
    return { n: i + 2, ...res, dup };
  });
  renderImport();
}
function renderImport() {
  const skip = $('imp-skipdup').checked;
  const ok = importRows.filter(r => !r.errors.length && !(skip && r.dup));
  const bad = importRows.filter(r => r.errors.length).length;
  const dups = importRows.filter(r => !r.errors.length && r.dup).length;
  $('imp-summary').textContent = `الإجمالي ${importRows.length} • صالح للاستيراد ${ok.length} • به أخطاء ${bad} • مكرر ${dups}${skip ? ' (سيُتخطّى)' : ''}`;
  $('imp-run').disabled = ok.length === 0;
  $('imp-table').innerHTML = `<thead><tr><th>#</th><th>الاسم</th><th>الفئة</th><th>كارب</th><th>ألياف</th><th>بروتين</th><th>دهون</th><th>الحالة</th></tr></thead><tbody>` +
    importRows.slice(0, 300).map(r => {
      const p = r.food.per100; const cls = r.errors.length ? 'bad' : (r.dup ? 'dup' : (r.warnings.length ? 'warn' : ''));
      const msg = r.errors.length ? '❌ ' + r.errors.join(' • ') : (r.dup ? '↺ مكرر' + (r.warnings.length ? ' • ' + r.warnings.join(' • ') : '') : (r.warnings.length ? '⚠️ ' + r.warnings.join(' • ') : '✓'));
      return `<tr class="${cls}"><td>${r.n}</td><td>${esc(r.food.name)}</td><td>${esc(r.food.category)}</td><td>${esc(p.carbs_g ?? '')}</td><td>${esc(p.fiber_g ?? '')}</td><td>${esc(p.protein_g ?? '')}</td><td>${esc(p.fat_g ?? '')}</td><td>${esc(msg)}</td></tr>`;
    }).join('') + `</tbody>`;
}

async function runImport() {
  const skip = $('imp-skipdup').checked;
  const rows = importRows.filter(r => !r.errors.length && !(skip && r.dup));
  if (!rows.length) return;
  if (!confirm(`استيراد ${rows.length} صنف؟ سيُحفظون غير موثّقين.`)) return;
  const btn = $('imp-run'); btn.disabled = true; btn.textContent = 'جاري الاستيراد...';
  try {
    for (let i = 0; i < rows.length; i += 150) {
      const batch = writeBatch(db);
      rows.slice(i, i + 150).forEach(r => {
        const f = r.food; const per100 = { ...f.per100 };
        let kcalEstimated = false;
        if (per100.cal_kcal === null) { per100.cal_kcal = Math.round(kcalFromMacros(per100)); kcalEstimated = true; }
        const ref = doc(FOODS);
        const after = { ...f, per100, verified: false, kind: 'food', isActive: true };
        batch.set(ref, {
          name: f.name, category: f.category, kind: 'food', per100, units: f.units, tags: f.tags, allergens: f.allergens, source: f.source || 'import',
          verified: false, kcalEstimated, recipe: null, image: { path: '', url: '', thumb: '' },
          ...buildSearchFields(f), isActive: true, createdAt: serverTimestamp(), createdBy: me.uid, updatedAt: serverTimestamp(), updatedBy: me.uid
        });
        batch.set(doc(collection(ref, 'history')), historyEntry('import', ['*'], null, watchedSnapshot(after)));
      });
      await batch.commit();
    }
    toast(`تم استيراد ${rows.length} صنف ✅`);
    $('imp-dialog').close();
  } catch (e) { console.error(e); alert('تعذر الاستيراد: ' + e.message); }
  finally { btn.textContent = 'استيراد الصالح'; btn.disabled = false; }
}
