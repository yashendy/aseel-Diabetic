// js/child-edit.js
// يستورد التهيئة الموحّدة (v12) + نستخدم الكائنات المصدّرة
import { app, auth, db, storage } from "./js/firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ===== Helpers =====
const $ = (sel) => document.querySelector(sel);
const qs = new URLSearchParams(location.search);
const parentId = qs.get("parentId") || "";
const childId  = qs.get("id")       || "";

function valStr(id) {
  const el = document.getElementById(id);
  return el ? (el.value ?? "").toString().trim() : "";
}
function valNum(id) {
  const el = document.getElementById(id);
  if (!el || el.value === "") return undefined;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : undefined;
}
function setVal(id, v) {
  const el = document.getElementById(id);
  if (el != null && v != null) el.value = v;
}

function collectDietFlags() {
  const boxes = document.querySelectorAll("input.diet-flag");
  const out = [];
  boxes.forEach((b) => { if (b.checked && b.value) out.push(b.value); });
  return out;
}
function checkDietFlags(flags = []) {
  const set = new Set(flags);
  document.querySelectorAll("input.diet-flag").forEach((b) => {
    b.checked = set.has(b.value);
  });
}

// ويدجت اختيار (لو غير موجودة ترجع [])
function getWidgetValues(widget) {
  try {
    if (!widget || typeof widget.getValues !== "function") return [];
    const v = widget.getValues();
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function buildChildPayloadSafe() {
  const flags = collectDietFlags();
  const payload = {
    // الهوية
    name:        valStr("f_name"),
    gender:      valStr("f_gender"),
    birthDate:   valStr("f_birthDate"),
    glucoseUnit: valStr("f_unit"),
    nationalId:  valStr("f_civilId"),

    // القياسات
    height:      valNum("f_heightCm"),
    weight:      valNum("f_weightKg"),

    // تفضيلات (اختياري)
    preferred:   getWidgetValues(window.preferred),
    disliked:    getWidgetValues(window.disliked),

    // الأنظمة الغذائية (اسمين للتوافق)
    dietaryFlags: flags,
    specialDiet:  flags,

    updatedAt:   new Date().toISOString(),
  };

  // تنظيف القيم غير المعرّفة
  Object.keys(payload).forEach((k) => {
    if (payload[k] === undefined || payload[k] === null) delete payload[k];
  });
  return payload;
}

async function fillFormFromDoc(pId, cId) {
  if (!pId || !cId) return;
  try {
    const ref = doc(db, "parents", pId, "children", cId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const d = snap.data() || {};

    setVal("f_name",       d.name);
    setVal("f_gender",     d.gender);
    setVal("f_birthDate",  d.birthDate);
    setVal("f_unit",       d.glucoseUnit);
    setVal("f_civilId",    d.nationalId);
    setVal("f_heightCm",   d.height ?? "");
    setVal("f_weightKg",   d.weight ?? "");

    const flags = Array.isArray(d.dietaryFlags) ? d.dietaryFlags :
                  (Array.isArray(d.specialDiet) ? d.specialDiet : []);
    checkDietFlags(flags);
  } catch (e) {
    console.error("fillFormFromDoc error", e);
    alert("تعذّر تحميل بيانات الطفل.");
  }
}

async function saveChild(pId, cId) {
  if (!pId || !cId) throw new Error("مفقود parentId/childId");
  const payload = buildChildPayloadSafe();
  const ref = doc(db, "parents", pId, "children", cId);
  // merge للحفاظ على الحقول الأخرى
  await setDoc(ref, payload, { merge: true });
}

function initChildEditPage() {
  // حمّل البيانات
  if (parentId && childId) fillFormFromDoc(parentId, childId);

  // زر الحفظ
  const saveBtn = document.getElementById("btnSave");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      try {
        await saveChild(parentId, childId);
        alert("تم الحفظ بنجاح");
      } catch (e) {
        console.error(e);
        alert("تعذّر الحفظ. تأكد من الصلاحيات والاتصال.");
      }
    });
  }

  // زر الرئيسية → child.html بنفس البارامترات
  const home = document.getElementById("nav-home");
  if (home && parentId && childId) {
    home.addEventListener("click", (e) => {
      e.preventDefault();
      location.href = `child.html?parentId=${encodeURIComponent(parentId)}&id=${encodeURIComponent(childId)}`;
    });
  }
}

window.addEventListener("DOMContentLoaded", initChildEditPage);
