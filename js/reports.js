// js/reports.js
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

/** عناصر الواجهة */
const $ = (id)=>document.getElementById(id);
const fFrom = $("f_from");
const fTo = $("f_to");
const unitBadge = $("unitBadge");
const btnLoad = $("btnLoad");
const repHead = $("repHead");
const repBody = $("repBody");
const loader = $("loader");
const rangeCaption = $("rangeCaption");

/** تعريف الأعمدة (أوقات اليوم) */
const SLOTS = [
  { key:"wake",   label:"الاستيقاظ"    },
  { key:"pre_b",  label:"ق.الفطار"     },
  { key:"post_b", label:"ب.الفطار"     },
  { key:"pre_l",  label:"ق.الغدا"      },
  { key:"post_l", label:"ب.الغدا"      },
  { key:"pre_d",  label:"ق.العشا"      },
  { key:"post_d", label:"ب.العشا"      },
  { key:"snack",  label:"سناك"         },
  { key:"night",  label:"أثناء النوم"  },
];

/** أدوات مساعدة */
const fmtDate = (d)=>d.toISOString().slice(0,10);
function daysBetween(a,b){ return Math.round((b-a)/86400000); }
function addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function isNum(v){ return typeof v==='number' && Number.isFinite(v); }
const pct = (a,b)=> (b ? ((a-b)/b)*100 : 0);

/** عرض/إخفاء لودر */
const showLoader = (v)=> loader.classList.toggle("show", !!v);

/** رسم رأس الجدول */
function buildHead(){
  repHead.innerHTML = "";
  const thDate = document.createElement("th"); thDate.textContent = "التاريخ";
  repHead.appendChild(thDate);
  for (const s of SLOTS){
    const th = document.createElement("th"); th.textContent = s.label; repHead.appendChild(th);
  }
}

/** شارة الحالة اللونية */
function statusBadge(value, limits){
  if (!isNum(value)) return "";
  const { norm_min, norm_max, hypo, hyper, severeLow, severeHigh } = limits;

  let cls = "b-normal"; // افتراضي
  if (isNum(severeLow) && value <= severeLow) cls = "b-sevlow";
  else if (isNum(hypo) && value < hypo) cls = "b-low";
  else if (isNum(severeHigh) && value >= severeHigh) cls = "b-sevhigh";
  else if (isNum(hyper) && value > hyper) cls = "b-high";
  else if (isNum(norm_min) && isNum(norm_max) && (value < norm_min || value > norm_max)) cls = "b-high";
  return `<span class="badge ${cls}">حالة</span>`;
}

/** أيقونة “نقطة مع سهم” */
function trendIcon(){ 
  return `
  <span class="trend" title="أعلى من اليوم السابق">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle class="dot" cx="8" cy="16" r="3"></circle>
      <path class="arrow" d="M12 16 L12 6 M12 6 L9 9 M12 6 L15 9"></path>
    </svg>
  </span>`;
}

/** يبني خلية بأربع سطور */
function cellHTML(slotObj, limits, showTrend){
  const v = slotObj?.value;
  const notes = slotObj?.notes || "—";
  const raiseText = slotObj?.raiseText || "—";        // وصف: تفاحة - زبادي -
  const correction = (slotObj?.correction ?? "—");    // وحدات أنسولين

  const vTxt = isNum(v) ? String(v) : "—";
  const badge = statusBadge(v, limits);
  const arrow = (showTrend && isNum(v)) ? trendIcon() : "";

  const tl = notes.length > 28 ? ` title="${notes.replace(/"/g,'&quot;')}"` : "";
  const notesShort = notes.length > 28 ? notes.slice(0,28)+"…" : notes;

  return `
    <div class="cell">
      <div class="line"><span class="label">القياس</span><span class="value">${vTxt}</span>${badge}${arrow}</div>
      <div class="line"><span class="label">الملاحظات</span><span class="notes-text"${tl}>${notesShort}</span></div>
      <div class="line"><span class="label">الرفع</span><span class="value">${raiseText}</span></div>
      <div class="line"><span class="label">التصحيحي</span><span class="value">${correction}</span></div>
    </div>
  `;
}

/** تحميل إعدادات الطفل */
async function loadChildConfig(parentId, childId){
  const s = await getDoc(doc(db, `parents/${parentId}/children/${childId}`));
  if (!s.exists()) throw new Error("لم يتم العثور على إعدادات الطفل");
  const d = s.data() || {};
  const unit = d?.unit || "mmol"; // 'mmol' | 'mgdl'
  const limits = {
    norm_min: d?.normalRange?.min ?? null,
    norm_max: d?.normalRange?.max ?? null,
    severeLow: d?.normalRange?.severeLow ?? null,
    severeHigh: d?.normalRange?.severeHigh ?? null,
    hypo: d?.hypoLevel ?? null,
    hyper: d?.hyperLevel ?? null,
  };
  return { unit, limits };
}

/** تحميل يوم واحد: parents/{p}/children/{c}/days/{YYYY-MM-DD} */
async function loadDay(parentId, childId, ymd){
  const s = await getDoc(doc(db, `parents/${parentId}/children/${childId}/days/${ymd}`));
  if (!s.exists()) return null;
  const d = s.data() || {};
  // نتوقّع d.slots = { wake:{value,notes,raiseText,correction}, ... }
  return d?.slots || null;
}

/** منطق “أعلى من اليوم السابق” */
function isHigher(curr, prev, unit){
  const v = curr?.value, p = prev?.value;
  if (!isNum(v) || !isNum(p)) return false;
  const deltaAbs = unit === "mgdl" ? 10 : 0.6;
  const deltaPct = 10; // %
  return (v - p) >= deltaAbs || pct(v, p) >= deltaPct;
}

/** بناء الجدول من-إلى */
async function buildTable({parentId, childId, from, to}){
  showLoader(true);
  repBody.innerHTML = "";

  const { unit, limits } = await loadChildConfig(parentId, childId);
  unitBadge.textContent = unit === "mgdl" ? "mg/dL" : "mmol/L";

  // رأس الجدول
  buildHead();

  // تجهيز التواريخ
  const days = daysBetween(from, to);
  const list = [];
  for (let i=0;i<=days;i++){
    const d = addDays(from, i);
    list.push(fmtDate(d));
  }

  // تحميل كل الأيام (تتابعيًا لسلامة المعدّل — تقدر تبدّله بتوازي)
  const dayMap = {};
  for (const ymd of list){
    dayMap[ymd] = await loadDay(parentId, childId, ymd);
  }

  // بناء الصفوف
  for (const ymd of list){
    const tr = document.createElement("tr");
    const th = document.createElement("th"); th.textContent = ymd; tr.appendChild(th);

    const prevYmd = fmtDate(addDays(new Date(ymd), -1));
    const prevSlots = dayMap[prevYmd] || {};

    for (const s of SLOTS){
      const td = document.createElement("td");
      const curr = (dayMap[ymd]||{})[s.key] || null;
      const prev = (prevSlots||{})[s.key] || null;
      const trendUp = isHigher(curr, prev, unit);
      td.innerHTML = cellHTML(curr, limits, trendUp);
      tr.appendChild(td);
    }
    repBody.appendChild(tr);
  }

  rangeCaption.textContent = `من: ${fmtDate(from)} إلى: ${fmtDate(to)} — الوحدة: ${unit === "mgdl" ? "mg/dL" : "mmol/L"}`;
  showLoader(false);
}

/** قراءة باراميترات الرابط (parent & child) */
function qs(name){ return new URLSearchParams(location.search).get(name) || ""; }

/** تهيئة */
onAuthStateChanged(auth, async (user)=>{
  if (!user){ location.href = "/login.html"; return; }
  const parentId = qs("parent") || user.uid;
  const childId  = qs("child")  || "";

  // قيم افتراضية للمدى: آخر 7 أيام
  const today = new Date();
  const from = addDays(today, -6);
  fFrom.value = fmtDate(from);
  fTo.value   = fmtDate(today);

  btnLoad.addEventListener("click", async ()=>{
    const d1 = new Date(fFrom.value || fmtDate(from));
    const d2 = new Date(fTo.value   || fmtDate(today));
    await buildTable({ parentId, childId, from:d1, to:d2 });
  });

  // تحميل أولي
  await buildTable({ parentId, childId, from, to: today });
});
