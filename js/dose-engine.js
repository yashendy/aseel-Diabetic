// js/dose-engine.js
// ========================================================
// المحرك المشترك لحسابات الجرعات والسكر — تستخدمه meals / measurements / child-edit
// ملاحظة: هذه حسابات مساعدة وليست بديلاً عن تعليمات الطبيب المعالج.
// ========================================================

import { MGDL_PER_MMOL, getProtocol, toTherapy } from './child-protocol.js';
export { MGDL_PER_MMOL };

// ---------- أدوات عامة ----------
const pad = n => String(n).padStart(2, '0');
export const round = (n, d = 1) => { const f = 10 ** d; return Math.round((Number(n) || 0) * f) / f; };

// تاريخ ووقت محليين (بدل toISOString الذي يرجع UTC ويُخطئ في اليوم بعد منتصف الليل)
export const localDateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTimeStr = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function whenFromParts(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}
export function toDateObj(w) {
  if (!w) return null;
  if (w instanceof Date) return w;
  if (typeof w.toDate === 'function') return w.toDate();
  if (typeof w.seconds === 'number') return new Date(w.seconds * 1000);
  const d = new Date(w); return isNaN(d) ? null : d;
}

// منع حقن HTML (XSS) عند عرض نصوص مخزنة
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- تحويل الوحدات ----------
export const toMgdl = (v, unit) => unit === 'mmol/L' ? v * MGDL_PER_MMOL : v;
export const convert = (v, from, to) => {
  if (!from || !to || from === to) return v;
  return to === 'mmol/L' ? v / MGDL_PER_MMOL : v * MGDL_PER_MMOL;
};

// ---------- الوجبات والـ Slots ----------
export const SLOT_ORDER = { FASTING: 10, PRE_BREAKFAST: 20, POST_BREAKFAST: 25, PRE_LUNCH: 30, POST_LUNCH: 35, PRE_DINNER: 40, POST_DINNER: 45, SNACK: 50, EXERCISE: 60, BEDTIME: 90, OTHER: 200 };
export function mealOfSlot(slotKey = '') {
  if (slotKey.includes('BREAKFAST')) return 'breakfast';
  if (slotKey.includes('LUNCH')) return 'lunch';
  if (slotKey.includes('DINNER')) return 'dinner';
  if (slotKey === 'SNACK') return 'snack';
  return null;
}

// ---------- إعدادات العلاج للطفل (مربوطة بـ child-protocol الموحد) ----------
export function getTherapy(c = {}) {
  return toTherapy(getProtocol(c));
}

export function roundToStep(x, step = 0.5) {
  if (!(x > 0)) return 0;
  return Math.round((Math.round(x / step) * step) * 100
