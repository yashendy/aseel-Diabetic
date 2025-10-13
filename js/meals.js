// /js/meals.js — FULL REPLACEMENT
// ✅ يقرأ admin/global/foodItems بالسكيمـا الجديدة
// ✅ يموحّد المقادير إلى measures[] (اسم + جرامات + default)
// ✅ يبني per100 من per100 أو nutrPer100g
// ✅ يحلّ image.path ➜ HTTPS via getDownloadURL (لو url مش موجود)
// ✅ يوفّر دوال/أحداث عامة لتتعاملي معها من أي UI موجود عندك

import { db, storage } from './firebase-config.js';
import {
  collection, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
  ref as sRef, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

// ————————————————————————————————————————————————
// مصدر البيانات
// ————————————————————————————————————————————————
const FOODS = collection(db, 'admin', 'global', 'foodItems');

// الحالة العامة
const state = {
  list: [],
  ready: false,
};

// أدوات صغيرة
const toArabicSearch = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/\s+/g, ' ')
    .trim();

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// تطبيع المقادير إلى شكل موحّد
function normalizeMeasures(d) {
  // schema v2 (units[])
  if (Array.isArray(d.units)) {
    return d.units
      .filter((u) => u && (u.label || u.name) && Number(u.grams) > 0)
      .map((u) => ({
        name: u.label || u.name,
        grams: Number(u.grams),
        default: !!u.default,
      }));
  }
  // legacy (measures[])
  if (Array.isArray(d.measures)) {
    return d.measures
      .filter((m) => m && m.name && Number(m.grams) > 0)
      .map((m) => ({ name: m.name, grams: Number(m.grams), default: !!m.default }));
  }
  // legacy object (measureQty)
  if (d.measureQty && typeof d.measureQty === 'object') {
    return Object.entries(d.measureQty)
      .map(([k, v]) => ({ name: k, grams: Number(v), default: false }))
      .filter((x) => x.grams > 0);
  }
  // legacy (householdUnits)
  if (Array.isArray(d.householdUnits)) {
    return d.householdUnits
      .filter((m) => m && m.name && Number(m.grams) > 0)
      .map((m) => ({ name: m.name, grams: Number(m.grams), default: false }));
  }
  // آخر حل: لو فيه per100 يبقى 100 جم
  if (d.per100 || d.nutrPer100g) {
    return [{ name: '100 جم', grams: 100, default: true }];
  }
  return [];
}

// تطبيع وثيقة Firestore إلى عنصر واحد موحّد
function normalizeDoc(snap) {
  const raw = { id: snap.id, ...snap.data() };

  const p = raw.per100 || raw.nutrPer100g || {};
  const per100 = {
    cal_kcal: asNumber(p.cal_kcal),
    carbs_g: asNumber(p.carbs_g),
    protein_g: asNumber(p.protein_g),
    fat_g: asNumber(p.fat_g),
    fiber_g: asNumber(p.fiber_g),
    sodium_mg: asNumber(p.sodium_mg),
    gi: asNumber(p.gi),
  };

  const measures = normalizeMeasures(raw);

  const image = raw.image || {};
  const imageUrl = image.url || raw.imageUrl || '';
  const imagePath = image.path || raw.imagePath || '';

  return {
    id: raw.id,
    name: raw.name || '',
    category: raw.category || '',
    isActive: raw.isActive !== false,
    per100,
    measures,
    imageUrl,
    imagePath,
    searchText: raw.searchText || '',
  };
}

// حوّل أي imagePath إلى رابط HTTPS (مرة واحدة لكل عنصر)
async function resolveImages(items) {
  await Promise.all(
    items.map(async (f) => {
      if (!f.imageUrl && f.imagePath && !/^https?:\/\//.test(f.imagePath)) {
        try {
          f.imageUrl = await getDownloadURL(sRef(storage, f.imagePath));
        } catch (_) {
          // تجاهل الخطأ الفردي
        }
      }
    })
  );
}

// انشر التحديث لباقي الصفحة (Global API بسيطة)
function publish() {
  // مصفوفة جاهزة للاستخدام
  window.FOOD_LIBRARY = state.list;

  // دوال مساعدة عامة
  window.searchFoods = function (q = '') {
    const t = toArabicSearch(q);
    let list = [...state.list];
    if (t) {
      list = list.filter((x) => {
        const unitsTxt = (x.measures || []).map((m) => m.name).join(' ');
        const hay = toArabicSearch(`${x.name} ${x.category} ${x.searchText} ${unitsTxt}`);
        return hay.includes(t);
      });
    }
    return list;
  };

  window.getFoodById = function (id) {
    return state.list.find((x) => x.id === id) || null;
  };

  // إيفنت لتحديث أي UI موجود
  const ev = new CustomEvent('foods:update', { detail: { list: state.list } });
  window.dispatchEvent(ev);

  state.ready = true;
}

// الاشتراك اللحظي في مكتبة الأصناف
function startLive() {
  onSnapshot(FOODS, async (snap) => {
    const arr = [];
    snap.forEach((s) => arr.push(normalizeDoc(s)));
    // إزالة التكرار + فرز
    const byId = new Map(arr.map((x) => [x.id, x]));
    const list = Array.from(byId.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'ar', { numeric: true })
    );
    await resolveImages(list);
    state.list = list;
    publish();
  });
}

startLive();

// لو حابة تستني جاهزية البيانات:
// window.addEventListener('foods:update', (e)=>{ console.log('foods ready', e.detail.list) });
