// js/child-edit.js

// 1) تهيئة Firebase من ملفك الموحد (بدون أي initializeApp هنا)
import { app, auth, db /*, storage */ } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ================== Helpers ================== */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function getParam(name){
  const qs = new URLSearchParams(location.search);
  return qs.get(name) || "";
}

function setVal(id, v){
  const el = document.getElementById(id);
  if(!el) return;
  if(el.type === "checkbox") el.checked = !!v;
  else el.value = (v ?? "");
}
function getStr(id){
  const el = document.getElementById(id);
  return el ? String(el.value ?? "").trim() : "";
}
function getNum(id){
  const el = document.getElementById(id);
  if(!el || el.value === "") return undefined;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : undefined;
}

function setHeaderText(id, txt){
  const el = document.getElementById(id);
  if(el) el.textContent = txt ?? "";
}
function formatDate(ts){
  try{
    if(!ts) return "";
    if (typeof ts === "string") return new Date(ts).toLocaleString();
    if (ts && typeof ts.toDate === "function") return ts.toDate().toLocaleString();
    return new Date(ts).toLocaleString();
  }catch{ return ""; }
}
function calcAge(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(isNaN(d)) return "";
  const now = new Date();
  let y = now.getFullYear() - d.getFullYear();
  let m = now.getMonth() - d.getMonth();
  if(m < 0 || (m === 0 && now.getDate() < d.getDate())) y--;
  return y >= 0 ? `${y} سنة` : "";
}

/* ===== Diet flags (checkboxes) ===== */
function checkDietFlags(flags=[]){
  const set = new Set(flags);
  $$("#card-diet .diet-rows input.diet-flag").forEach(b => {
    b.checked = set.has(b.value);
  });
}
function collectDietFlags(){
  const out = [];
  $$("#card-diet .diet-rows input.diet-flag").forEach(b=>{
    if(b.checked && b.value) out.push(b.value);
  });
  return out;
}

/* ===== Chip inputs (widgets) ===== */
function widgetSetValues(widgetId, values){
  const w = window[widgetId];
  if(w && typeof w.setValues === "function"){
    try{ w.setValues(Array.isArray(values)? values : []); return; }catch{}
  }
  // fallback: لو في input نصّي بديل بنفس الـid
  const el = document.getElementById(widgetId);
  if(el) el.value = (Array.isArray(values) ? values.join(", ") : "");
}
function widgetGetValues(widgetId){
  const w = window[widgetId];
  if(w && typeof w.getValues === "function"){
    try{
      const v = w.getValues();
      return Array.isArray(v) ? v : [];
    }catch{}
  }
  const el = document.getElementById(widgetId);
  if(el) return String(el.value||"").split(",").map(s=>s.trim()).filter(Boolean);
  return [];
}

/* ================== Load (Read) ================== */
async function loadChild(parentId, childId){
  const ref = doc(db, "parents", parentId, "children", childId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return null;
  const d = snap.data() || {};

  // الهوية
  setVal("f_name",      d.name);
  setVal("f_civilId",   d.nationalId);
  setVal("f_gender",    d.gender);
  setVal("f_birthDate", d.birthDate);
  setVal("f_unit",      d.glucoseUnit);
  setVal("f_heightCm",  d.height);
  setVal("f_weightKg",  d.weight);

  // حدود السكر
  setVal("f_criticalLow", d.criticalLowLevel);
  setVal("f_severeLow",   d.severeLowLevel);
  setVal("f_hypo",        d.hypoLevel);
  setVal("f_hyper",       d.hyperLevel);
  setVal("f_severeHigh",  d.severeHighLevel);
  setVal("f_criticalHigh",d.criticalHighLevel);

  // أهداف الكارب
  setVal("f_carb_b_min", d.carbTargets?.breakfast?.min);
  setVal("f_carb_b_max", d.carbTargets?.breakfast?.max);
  setVal("f_carb_l_min", d.carbTargets?.lunch?.min);
  setVal("f_carb_l_max", d.carbTargets?.lunch?.max);
  setVal("f_carb_d_min", d.carbTargets?.dinner?.min);
  setVal("f_carb_d_max", d.carbTargets?.dinner?.max);
  setVal("f_carb_s_min", d.carbTargets?.snack?.min);
  setVal("f_carb_s_max", d.carbTargets?.snack?.max);

  // معاملات عامة
  setVal("f_carbRatio",       d.carbRatio);
  setVal("f_correctionFactor",d.correctionFactor);
  setVal("f_targetPref",      d.targetPreference);

  // معاملات لكل وجبة (إن وُجدت)
  setVal("f_cf_b", d.cf_breakfast);
  setVal("f_cr_b", d.cr_breakfast);
  setVal("f_cf_l", d.cf_lunch);
  setVal("f_cr_l", d.cr_lunch);
  setVal("f_cf_d", d.cf_dinner);
  setVal("f_cr_d", d.cr_dinner);
  setVal("f_cf_s", d.cf_snack);
  setVal("f_cr_s", d.cr_snack);

  // أنواع الأنسولين والجهاز
  setVal("f_basalType", d.basalType);
  setVal("f_bolusType", d.bolusType);
  setVal("f_deviceType",d.deviceType);
  setVal("f_deviceModel",d.deviceModel);

  // مواقع الحقن + ملاحظات الأنسولين
  widgetSetValues("injectionSitesInput", d.injectionSites || d.injectionSitesInput || []);
  setVal("f_insulinNotes", d.insulinNotes);

  // الحساسية/المفضلات/غير المفضلات
  widgetSetValues("allergiesInput", d.allergies || []);
  widgetSetValues("preferredInput", d.preferred || []);
  widgetSetValues("dislikedInput",  d.disliked  || []);

  // الأنظمة الغذائية
  const diet = Array.isArray(d.dietaryFlags) ? d.dietaryFlags :
               (Array.isArray(d.specialDiet) ? d.specialDiet : []);
  checkDietFlags(diet);

  // ملاحظات عامة + آخر تحديث
  setVal("f_notes", d.notes);
  setVal("f_updated", d.updatedAt ? formatDate(d.updatedAt) : "");

  // الهيدر (عرض)
  setHeaderText("hdrName",   d.name || "");
  setHeaderText("hdrCivil",  d.nationalId || "—");
  setHeaderText("hdrAge",    d.birthDate ? calcAge(d.birthDate) : "—");
  setHeaderText("hdrUnit",   d.glucoseUnit || "—");
  setHeaderText("hdrUpdated",formatDate(d.updatedAt) || "—");

  // الطبيب (إن وُجد)
  const dr =
    d.assignedDoctorInfo?.name ||
    d.assignedDoctorName ||
    d.assignedDoctor ||
    "";
  setHeaderText("hdrDoctor", dr || "—");

  // شرائح الأنظمة في الهيدر
  const chipsWrap = $("#hdrDietChips");
  if (chipsWrap){
    chipsWrap.innerHTML = (diet || []).map(t=>`<span class="chip">${t}</span>`).join("");
  }

  return d;
}

/* ================== Save (Write) ================== */
function buildPayloadFromForm(){
  // الأساسيات
  const payload = {
    name:        getStr("f_name"),
    nationalId:  getStr("f_civilId"),
    gender:      getStr("f_gender"),
    birthDate:   getStr("f_birthDate"),
    glucoseUnit: getStr("f_unit"),
    height:      getNum("f_heightCm"),
    weight:      getNum("f_weightKg"),
  };

  // حدود السكر
  payload.criticalLowLevel = getNum("f_criticalLow");
  payload.severeLowLevel   = getNum("f_severeLow");
  payload.hypoLevel        = getNum("f_hypo");
  payload.hyperLevel       = getNum("f_hyper");
  payload.severeHighLevel  = getNum("f_severeHigh");
  payload.criticalHighLevel= getNum("f_criticalHigh");

  // أهداف الكارب
  const carbTargets = {
    breakfast: { min:getNum("f_carb_b_min"), max:getNum("f_carb_b_max") },
    lunch:     { min:getNum("f_carb_l_min"), max:getNum("f_carb_l_max") },
    dinner:    { min:getNum("f_carb_d_min"), max:getNum("f_carb_d_max") },
    snack:     { min:getNum("f_carb_s_min"), max:getNum("f_carb_s_max") },
  };
  payload.carbTargets = carbTargets;

  // معاملات عامة
  payload.carbRatio        = getNum("f_carbRatio");
  payload.correctionFactor = getNum("f_correctionFactor");
  payload.targetPreference = getStr("f_targetPref");

  // معاملات لكل وجبة (إن وُجدت)
  payload.cf_breakfast = getNum("f_cf_b");
  payload.cr_breakfast = getNum("f_cr_b");
  payload.cf_lunch     = getNum("f_cf_l");
  payload.cr_lunch     = getNum("f_cr_l");
  payload.cf_dinner    = getNum("f_cf_d");
  payload.cr_dinner    = getNum("f_cr_d");
  payload.cf_snack     = getNum("f_cf_s");
  payload.cr_snack     = getNum("f_cr_s");

  // أنواع الأنسولين والجهاز
  payload.basalType  = getStr("f_basalType");
  payload.bolusType  = getStr("f_bolusType");
  payload.deviceType = getStr("f_deviceType");
  payload.deviceModel= getStr("f_deviceModel");

  // مواقع الحقن + ملاحظات
  payload.injectionSites = widgetGetValues("injectionSitesInput");
  payload.insulinNotes   = getStr("f_insulinNotes");

  // الحساسية/المفضلات/غير المفضلات
  payload.allergies = widgetGetValues("allergiesInput");
  payload.preferred = widgetGetValues("preferredInput");
  payload.disliked  = widgetGetValues("dislikedInput");

  // الأنظمة الغذائية (مرآة باسمين للتوافق)
  const diet = collectDietFlags();
  payload.dietaryFlags = diet;
  payload.specialDiet  = diet;

  // ملاحظات عامة + آخر تحديث
  payload.notes     = getStr("f_notes");
  payload.updatedAt = serverTimestamp(); // Firestore
  payload.f_updated = new Date().toISOString(); // لعرض فوري في الواجهة

  // تنظيف القيم undefined/null
  Object.keys(payload).forEach(k => (payload[k] == null) && delete payload[k]);

  // تنظيف فرعي لأهداف الكارب (لو الحقلين فاضيين)
  ["breakfast","lunch","dinner","snack"].forEach(k=>{
    const r = payload.carbTargets?.[k];
    if(r && r.min==null && r.max==null){
      delete payload.carbTargets[k];
    }
  });

  return payload;
}

async function saveChild(parentId, childId){
  const ref = doc(db, "parents", parentId, "children", childId);
  const payload = buildPayloadFromForm();
  await setDoc(ref, payload, { merge:true });
}

/* ================== Init ================== */
async function boot(){
  const parentId = getParam("parentId");
  const childId  = getParam("id");

  if(!parentId || !childId){
    console.warn("Missing parentId or id in URL");
  }else{
    try{ await loadChild(parentId, childId); }
    catch(e){ console.error(e); alert("تعذر تحميل بيانات الطفل"); }
  }

  // زر الحفظ
  const btn = $("#btnSave");
  if(btn){
    btn.addEventListener("click", async ()=>{
      try{
        await saveChild(parentId, childId);
        // تحديث ملخص الهيدر السريع
        setHeaderText("hdrName", getStr("f_name") || "—");
        setHeaderText("hdrCivil", getStr("f_civilId") || "—");
        setHeaderText("hdrUnit",  getStr("f_unit") || "—");
        setHeaderText("hdrUpdated", new Date().toLocaleString());
        alert("تم الحفظ");
      }catch(e){
        console.error(e);
        alert("تعذر الحفظ. تحقق من الاتصال والصلاحيات.");
      }
    });
  }

  // زر الرئيسية → child.html بنفس البارامترات (لو موجود)
  const home = $("#nav-home");
  if(home && parentId && childId){
    home.addEventListener("click", (e)=>{
      e.preventDefault();
      location.href = `child.html?parentId=${encodeURIComponent(parentId)}&id=${encodeURIComponent(childId)}`;
    });
  }
}

window.addEventListener("DOMContentLoaded", boot);
