// js/food-utils.js — دوال مساعدة وثوابت لمكتبة الأغذية والوصفات

// ==========================================
// 1) الثوابت (Constants)
// ==========================================
export const HYPO_TAG = '#علاج_هبوط';

export const CATEGORIES = [
  'النشويات',
  'الفاكهة',
  'الخضروات',
  'منتجات الحليب',
  'منتجات اللحوم',
  'البقوليات',
  'المشروبات',
  'الحلويات',
  'الدهون والزيوت',
  'وجبات جاهزة',
  'أخرى'
];

export const ALLERGENS = [
  { key: 'gluten', label: 'جلوتين' },
  { key: 'lactose', label: 'ألبان / لاكتوز' },
  { key: 'peanut', label: 'فول سوداني' },
  { key: 'nuts', label: 'مكسرات' },
  { key: 'egg', label: 'بيض' },
  { key: 'fish', label: 'أسماك ومأكولات بحرية' },
  { key: 'soy', label: 'صويا' },
  { key: 'sesame', label: 'سمسم' }
];

export const SOURCES = [
  { key: 'label', label: 'ملصق العبوة الغذائي' },
  { key: 'usda', label: 'قاعدة بيانات USDA' },
  { key: 'doctor', label: 'مراجعة واعتماد الطبيب' },
  { key: 'manual', label: 'إدخال يدوي' },
  { key: 'recipe', label: 'وصفة مركبة' },
  { key: 'import', label: 'استيراد خارجي' },
  { key: 'family', label: 'طلب من أسرة' }
];

// ==========================================
// 2) تنسيق وتطهير النصوص والأرقام والروابط
// ==========================================

/** هروب نصوص HTML لتجنب XSS */
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** تطبيع النص العربي للبحث والمقارنة (تجاهل الهمزات، التشكيل، الياء، والتاء المربوطة) */
export function normAr(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // إزالة التشكيل
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/\s+/g, ' ')
    .trim();
}

/** فحص وتأمين رابط الصورة */
export function safeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^(https?:\/\/|data:image\/|\/|\.\/)/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

/** تحويل إلى رقم صالح أو إرجاع fallback (افتراضياً null) */
export function toNum(val, fallback = null) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

/** تقريب الرقم لأقرب منزلة عشرية واحدة */
export function round1(val) {
  const n = Number(val) || 0;
  return Math.round(n * 10) / 10;
}

/** تطبيع قائمة الوسوم وإزالة التكرار والتأكد من علامة # */
export function normTags(tags) {
  const list = [];
  (Array.isArray(tags) ? tags : [tags]).forEach(item => {
    if (!item) return;
    String(item).split(/\s+/).forEach(t => {
      let clean = t.trim();
      if (!clean) return;
      if (!clean.startsWith('#')) clean = '#' + clean;
      if (!list.includes(clean)) list.push(clean);
    });
  });
  return list;
}

// ==========================================
// 3) البحث والماكروز والجرامات
// ==========================================

/** بناء حقول البحث للفهرسة */
export function buildSearchFields(food) {
  const tagsStr = (food.tags || []).join(' ');
  const allerStr = (food.allergens || []).join(' ');
  const unitsStr = (food.units || []).map(u => u.label || '').join(' ');
  const raw = `${food.name || ''} ${food.category || ''} ${tagsStr} ${allerStr} ${unitsStr}`.trim();
  const searchNorm = normAr(raw);
  const searchTokens = Array.from(new Set(searchNorm.split(' ').filter(Boolean)));
  return {
    searchText: raw,
    searchNorm,
    searchTokens
  };
}

/** حساب السعرات الحرارية التقريبية من الماكروز: كارب*4 + بروتين*4 + دهون*9 */
export function kcalFromMacros(per100) {
  const p = per100 || {};
  const c = Number(p.carbs_g) || 0;
  const pr = Number(p.protein_g) || 0;
  const f = Number(p.fat_g) || 0;
  return (c * 4) + (pr * 4) + (f * 9);
}

/** إحصائيات المقدار/الحصة المختارة لصنف غذائي */
export function portionStats(food, unitIndex = 0) {
  const units = food?.units || [];
  const u = units[unitIndex] || units[0] || { label: '100 جرام', grams: 100 };
  const grams = Number(u.grams) || 100;
  const p = food?.per100 || {};
  const carbs = Number(p.carbs_g) || 0;
  const fiber = Number(p.fiber_g) || 0;
  const net100 = Math.max(0, carbs - fiber);
  const net = (net100 * grams) / 100;
  const totalCarbs = (carbs * grams) / 100;
  return {
    label: u.label || '100 جرام',
    grams,
    net,
    carbs: totalCarbs
  };
}

/** كمية الجرامات من هذا الصنف التي تعطي عدد الكاربوهيدرات المستهدف (لعلاج الهبوط - قاعدة 15 كارب) */
export function hypoGramsFor(food, targetCarbs = 15) {
  const carbs = Number(food?.per100?.carbs_g) || 0;
  if (carbs <= 0) return null;
  return Math.round((targetCarbs / carbs) * 100);
}

// ==========================================
// 4) التحقق (Validation) وسجل التعديلات
// ==========================================

/** التحقق من صحة بيانات الصنف */
export function validateFood(food) {
  const errors = [];
  const warnings = [];
  const p = food.per100 || {};

  if (!food.name || !food.name.trim()) {
    errors.push('اسم الصنف مطلوب.');
  }

  const checkMacro = (val, name) => {
    if (val !== null && val !== undefined) {
      if (val < 0) errors.push(`قيمة ${name} لا يمكن أن تكون سالبة.`);
      if (val > 100) errors.push(`قيمة ${name} لا يمكن أن تتجاوز 100 جم.`);
    }
  };

  checkMacro(p.carbs_g, 'الكارب');
  checkMacro(p.fiber_g, 'الألياف');
  checkMacro(p.protein_g, 'البروتين');
  checkMacro(p.fat_g, 'الدهون');

  if (p.fiber_g !== null && p.carbs_g !== null && p.fiber_g > p.carbs_g) {
    errors.push('الألياف لا يمكن أن تتجاوز إجمالي الكاربوهيدرات.');
  }

  const sum = (Number(p.carbs_g) || 0) + (Number(p.protein_g) || 0) + (Number(p.fat_g) || 0);
  if (sum > 100) {
    errors.push(`مجموع الماكروز (${round1(sum)} جم) يتجاوز 100 جم لكل 100 جم.`);
  }

  if (p.cal_kcal !== null && p.cal_kcal !== undefined) {
    if (p.cal_kcal < 0 || p.cal_kcal > 900) {
      errors.push('السعرات الحرارية يجب أن تكون بين 0 و 900 ك.س.');
    } else {
      const calcKcal = kcalFromMacros(p);
      if (sum > 0 && Math.abs(p.cal_kcal - calcKcal) > Math.max(50, calcKcal * 0.35)) {
        warnings.push(`السعرات المدخلة (${p.cal_kcal}) تختلف عن المحسوبة من الماكروز (≈ ${Math.round(calcKcal)}).`);
      }
    }
  }

  if (p.gi !== null && p.gi !== undefined && (p.gi < 0 || p.gi > 110)) {
    warnings.push('المؤشر الجلايسيمي (GI) عادة ما يكون بين 1 و 110.');
  }

  if ((food.tags || []).includes(HYPO_TAG)) {
    if ((Number(p.fat_g) || 0) > 3) {
      warnings.push('أصناف رفع الهبوط يجب أن تكون خالية أو منخفضة الدهون جداً لتجنب تأخير امتصاص السكر.');
    }
    if ((Number(p.carbs_g) || 0) < 5) {
      warnings.push('صنف رفع الهبوط يحتوي على كاربوهيدرات قليلة جداً.');
    }
  }

  if (food.units && Array.isArray(food.units)) {
    food.units.forEach((u, i) => {
      if (!u.label?.trim()) errors.push(`المقدار رقم ${i + 1} بدون اسم.`);
      if (!u.grams || u.grams <= 0) errors.push(`المقدار "${u.label || i + 1}" وزنه غير صالح.`);
    });
  }

  return { errors, warnings };
}

/** لقطة نظيفة لحقول الصنف لاستخدامها في سجل التعديلات */
export function watchedSnapshot(food) {
  if (!food) return null;
  return {
    name: food.name || '',
    category: food.category || '',
    per100: { ...(food.per100 || {}) },
    units: (food.units || []).map(u => ({ label: u.label, grams: u.grams })),
    tags: [...(food.tags || [])],
    allergens: [...(food.allergens || [])],
    isActive: food.isActive !== false,
    verified: food.verified === true,
    source: food.source || '',
    kind: food.kind || 'food'
  };
}

/** مقارنة بين نسختين من الصنف لاستخراج التغييرات */
export function diffFood(beforeFood, afterFood) {
  const b = watchedSnapshot(beforeFood);
  const a = watchedSnapshot(afterFood);
  const changed = [];

  const fields = ['name', 'category', 'source', 'kind', 'isActive', 'verified'];
  fields.forEach(k => {
    if (b[k] !== a[k]) changed.push(k);
  });

  const pKeys = ['carbs_g', 'fiber_g', 'protein_g', 'fat_g', 'cal_kcal', 'gi'];
  const pDiff = pKeys.some(pk => (b.per100?.[pk] ?? null) !== (a.per100?.[pk] ?? null));
  if (pDiff) changed.push('per100');

  if (JSON.stringify(b.units) !== JSON.stringify(a.units)) changed.push('units');
  if (JSON.stringify((b.tags || []).sort()) !== JSON.stringify((a.tags || []).sort())) changed.push('tags');
  if (JSON.stringify((b.allergens || []).sort()) !== JSON.stringify((a.allergens || []).sort())) changed.push('allergens');

  return { changed, before: b, after: a };
}

// ==========================================
// 5) حسابات الوصفات المركبة (Recipe)
// ==========================================

/** حساب القيم الغذائية لكل 100 جم من وصفة مركبة بالاعتماد على مكوناتها */
export function recipeToPer100(ingredients = [], cookedGrams = null) {
  if (!ingredients || !ingredients.length) {
    return { per100: null, rawGrams: 0, denom: 0 };
  }

  let rawGrams = 0;
  let totalCarbs = 0;
  let totalFiber = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalKcal = 0;
  let giCarbWeighted = 0;
  let totalGiCarbs = 0;

  for (const item of ingredients) {
    const g = Number(item.grams) || 0;
    if (g <= 0) continue;
    rawGrams += g;
    const p = item.per100 || {};
    const c = (Number(p.carbs_g) || 0) * (g / 100);
    const fib = (Number(p.fiber_g) || 0) * (g / 100);
    const pr = (Number(p.protein_g) || 0) * (g / 100);
    const f = (Number(p.fat_g) || 0) * (g / 100);
    const kc = p.cal_kcal ? Number(p.cal_kcal) * (g / 100) : ((c * 4) + (pr * 4) + (f * 9));

    totalCarbs += c;
    totalFiber += fib;
    totalProtein += pr;
    totalFat += f;
    totalKcal += kc;

    if (Number(p.gi) > 0 && c > 0) {
      giCarbWeighted += Number(p.gi) * c;
      totalGiCarbs += c;
    }
  }

  if (rawGrams <= 0) {
    return { per100: null, rawGrams: 0, denom: 0 };
  }

  const denom = (cookedGrams && Number(cookedGrams) > 0) ? Number(cookedGrams) : rawGrams;
  const factor = 100 / denom;

  const per100 = {
    carbs_g: round1(totalCarbs * factor),
    fiber_g: round1(totalFiber * factor),
    protein_g: round1(totalProtein * factor),
    fat_g: round1(totalFat * factor),
    cal_kcal: Math.round(totalKcal * factor),
    gi: totalGiCarbs > 0 ? Math.round(giCarbWeighted / totalGiCarbs) : null
  };

  return { per100, rawGrams, denom };
}

// ==========================================
// 6) معالجة CSV (استيراد وتصدير)
// ==========================================

/** تفكيك ملف CSV إلى مصفوفة صفوف وأعمدة مع دعم الفواصل والنصوص المقتبسة */
export function parseCSV(text) {
  if (!text) return [];
  const lines = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (insideQuotes) {
      if (c === '"') {
        if (next === '"') {
          cell += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        insideQuotes = true;
      } else if (c === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (c === '\r') {
        // تجاهل
      } else if (c === '\n') {
        row.push(cell.trim());
        if (row.some(x => x.length > 0)) lines.push(row);
        row = [];
        cell = '';
      } else {
        cell += c;
      }
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some(x => x.length > 0)) lines.push(row);
  }

  return lines;
}

/** قالب CSV فارغ كمرجع للاستيراد */
export function csvTemplate() {
  const headers = ['name', 'category', 'carbs_g', 'fiber_g', 'protein_g', 'fat_g', 'cal_kcal', 'gi', 'units', 'source', 'allergens', 'tags'];
  const sample1 = ['تفاح أحمر', 'الفاكهة', '13.8', '2.4', '0.3', '0.2', '52', '36', 'حبة متوسطة:150|كوب:125', 'usda', '', '#طبيعي #ألياف'];
  const sample2 = ['خبز بلدي', 'النشويات', '53.0', '4.0', '9.0', '1.5', '260', '70', 'رغيف:100|نصف رغيف:50', 'label', 'gluten', ''];
  return [headers.join(','), sample1.join(','), sample2.join(',')].join('\n');
}

/** تحويل مصفوفة الأصناف الغذائية إلى ملف CSV */
export function foodsToCSV(foods) {
  const headers = ['name', 'category', 'carbs_g', 'fiber_g', 'protein_g', 'fat_g', 'cal_kcal', 'gi', 'units', 'source', 'allergens', 'tags', 'verified'];
  const escapeCell = val => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = foods.map(f => {
    const p = f.per100 || {};
    const unitsStr = (f.units || []).map(u => `${u.label}:${u.grams}`).join('|');
    const allerStr = (f.allergens || []).join(';');
    const tagsStr = (f.tags || []).join(' ');
    return [
      escapeCell(f.name),
      escapeCell(f.category),
      p.carbs_g ?? '',
      p.fiber_g ?? '',
      p.protein_g ?? '',
      p.fat_g ?? '',
      p.cal_kcal ?? '',
      p.gi ?? '',
      escapeCell(unitsStr),
      escapeCell(f.source || ''),
      escapeCell(allerStr),
      escapeCell(tagsStr),
      f.verified ? 'true' : 'false'
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/** تحويل سطر مقروء من CSV إلى كائن صنف غذائي مع فحصه */
export function rowToFood(row) {
  const name = (row.name || '').trim();
  const category = (row.category || 'أخرى').trim();
  const per100 = {
    carbs_g: toNum(row.carbs_g),
    fiber_g: toNum(row.fiber_g, 0),
    protein_g: toNum(row.protein_g, 0),
    fat_g: toNum(row.fat_g, 0),
    cal_kcal: toNum(row.cal_kcal),
    gi: toNum(row.gi)
  };

  const units = [];
  if (row.units) {
    const rawUnits = String(row.units).split('|');
    rawUnits.forEach(uStr => {
      const parts = uStr.split(':');
      if (parts.length >= 2) {
        const lbl = parts[0].trim();
        const gr = Number(parts[1]);
        if (lbl && gr > 0) units.push({ label: lbl, grams: gr });
      }
    });
  }
  if (!units.length) {
    units.push({ label: '100 جرام', grams: 100 });
  }

  const allergens = [];
  if (row.allergens) {
    String(row.allergens).split(/[;,]/).forEach(a => {
      const k = a.trim();
      if (k) allergens.push(k);
    });
  }

  const tags = row.tags ? normTags(row.tags) : [];
  const source = (row.source || 'import').trim();

  const food = {
    name,
    category,
    per100,
    units,
    tags,
    allergens,
    source,
    verified: false,
    kind: 'food'
  };

  const { errors, warnings } = validateFood(food);
  return { food, errors, warnings };
}

// ==========================================
// 7) تصغير ومعالجة الصور
// ==========================================

/** تصغير الصورة إلى صورة مصغّرة خفيفة base64 لحفظها مجاناً بدون استهلاك باندويث */
export function makeThumb(file, maxWidth = 300, maxHeight = 300, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('الملف المحدد ليس صورة صالحة.'));
    }
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
