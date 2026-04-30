// js/meals.js
console.log("✅ [meals] module loaded v2026");

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, addDoc, deleteDoc, serverTimestamp, collection, getDocs, query, where, limit } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $  = (s)=>document.querySelector(s);
const fmt = (n,d=1)=>Number.isFinite(n)?(+n).toFixed(d):"—";
const todayStr = ()=> new Date().toISOString().slice(0,10);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

const mgdl2mmol = mg => mg/18.0182;
const mmol2mgdl = mmol => mmol*18.0182;
const round1 = n => Math.round((Number(n)||0)*10)/10;

const els = {
  loader: $("#appLoader"), chipCF: $("#chipCF"), chipCR: $("#chipCR"), chipTarget: $("#chipTarget"),
  slotSelect: $("#slotSelect"), dateInput: $("#dateInput"), preBg: $("#preBg"), preBgUnit: $("#preBgUnit"),
  btnFetchPre: $("#btnFetchPre"), netCarbRule: $("#netCarbRule"), doseCorrection: $("#doseCorrection"),
  doseCarbs: $("#doseCarbs"), iobValue: $("#iobValue"), smartAlerts: $("#smartAlerts"), 
  injectionAlert: $("#injectionAlert"), injectionAlertMsg: $("#injectionAlertMsg"),
  btnClearMeal: $("#btnClearMeal"), btnOpenLibrary: $("#btnOpenLibrary"), mealBody: $("#mealBody"), 
  doseFinal: $("#doseFinal"), sumGL: $("#sumGL"), sumGI: $("#sumGI"), sumFiber: $("#sumFiber"), 
  sumProtein: $("#sumProtein"), sumFat: $("#sumFat"), sumCarbsNet: $("#sumCarbsNet"), sumCarbsRaw: $("#sumCarbsRaw"), 
  sumCalories: $("#sumCalories"), libModal: $("#libModal"), libOverlay: $("#libOverlay"), libClose: $("#libClose"),
  searchBox: $("#searchBox"), itemsGrid: $("#itemsGrid"), btnSaveMeal: $("#btnSaveMeal"), 
  dailyMealsBody: $("#dailyMealsBody"), todayDateLabel: $("#todayDateLabel")
};

const state = {
  childId:null, parentId:null, child:null,
  slot:"PRE_BREAKFAST", date:todayStr(), rule:"fullFiber",
  CF: 50, Target: 100, CRs:{ breakfast: 10, lunch: 10, dinner: 10, snack: 15 },
  injectionMap: {}, itemsLib:[], items:[], IOB: 0, finalDoseVal: 0,
  corrDirty: false, carbDirty: false 
};

function showLoader(v){ if(els.loader) els.loader.style.display = v?"flex":"none"; }

const auth = getAuth();
function ensureAuth(){ return new Promise(res=>onAuthStateChanged(auth,u=>res(u),()=>res(null))); }

// 1. تحميل إعدادات الطفل الجديدة (Target, CF, CRs, Injection Map)
async function loadChild(){
  const dref = doc(db,"parents",state.parentId,"children",state.childId);
  const snap = await getDoc(dref);
  if (!snap.exists()) throw new Error("لم يتم العثور على بيانات الطفل.");
  const c = snap.data();
  state.child = { id:snap.id, ...c };
  
  // استخراج الإعدادات الجديدة من قاعدة البيانات الموحدة
  state.CF = Number(c.cf || c.correctionFactor) || 50;
  if(c.cr) state.CRs = c.cr;
  if(c.glucose_limits) state.Target = Number(c.glucose_limits.target) || (c.glucoseUnit==='mmol/L'? 5.5 : 100);
  
  // خريطة الحقن
  if(c.injection_map) state.injectionMap = c.injection_map;
  
  state.rule = c.netCarbRule || "fullFiber";
  if(els.netCarbRule) els.netCarbRule.value = state.rule;
  if(els.preBgUnit) els.preBgUnit.value = c.glucoseUnit || 'mg/dL';
  
  updateChipsAndAlerts();
}

// 2. تحديث الشاشة وتنبيهات الحقن
function updateChipsAndAlerts() {
  const s = state.slot;
  let currentCR = state.CRs.snack || 15;
  if(s.includes('BREAKFAST')) currentCR = state.CRs.breakfast || 10;
  if(s.includes('LUNCH')) currentCR = state.CRs.lunch || 10;
  if(s.includes('DINNER')) currentCR = state.CRs.dinner || 10;

  if(els.chipCF) els.chipCF.textContent = `CF: ${state.CF}`;
  if(els.chipCR) els.chipCR.textContent = `CR: ${currentCR}`;
  if(els.chipTarget) els.chipTarget.textContent = `الهدف: ${state.Target}`;
  if(els.todayDateLabel) els.todayDateLabel.textContent = state.date;

  // تنبيهات خريطة الحقن (العبقرية!) 🧍‍♀️
  let badZones = [];
  const mapTransl = { arm_right:'الذراع الأيمن', arm_left:'الذراع الأيسر', abd_top_right:'البطن أعلى يمين', abd_top_left:'البطن أعلى يسار', abd_bottom_right:'البطن أسفل يمين', abd_bottom_left:'البطن أسفل يسار', thigh_right:'الفخذ الأيمن', thigh_left:'الفخذ الأيسر' };
  
  for(let zone in state.injectionMap) {
    if(state.injectionMap[zone] === 'lump') badZones.push(`${mapTransl[zone]||zone} (تكتل دهني 🚨)`);
    if(state.injectionMap[zone] === 'rest') badZones.push(`${mapTransl[zone]||zone} (فترة إراحة ⏸)`);
  }

  if(badZones.length > 0) {
    els.injectionAlert.style.display = 'flex';
    els.injectionAlertMsg.innerHTML = badZones.join('<br>');
  } else {
    els.injectionAlert.style.display = 'none';
  }
}

// 3. التزامن الذكي: جلب السكر من سجل القياسات (اكتشاف التكرار FW)
async function fetchPreMeasurement(){
  try{
    if(els.preBg) els.preBg.value = "";
    if(els.doseCorrection) els.doseCorrection.value = "";
    if(els.doseCarbs) els.doseCarbs.value = "";
    state.corrDirty = false; state.carbDirty = false;
    
    // جلب آخر قراءة لنفس الـ Slot في اليوم
    const coll = collection(db,"parents",state.parentId,"children",state.childId,"measurements");
    const qy = query(coll, where("date", "==", state.date));
    const snap = await getDocs(qy);
    
    let latestMeas = null;
    snap.forEach(doc => {
      const d = doc.data();
      // نتحقق من تطابق الـ Slot الأساسي (تجاهل FW)
      if(d.slotKey && d.slotKey.startsWith(state.slot)) {
        if(!latestMeas || (d.when?.seconds > latestMeas.when?.seconds)) {
          latestMeas = { id: doc.id, ...d };
        }
      }
    });
    
    if (latestMeas) {
      if (els.preBg && latestMeas.value) {
        els.preBgUnit.value = latestMeas.unit || "mg/dL";
        els.preBg.value = latestMeas.value;
      }
      if (latestMeas.correctionDose && els.doseCorrection) { els.doseCorrection.value = latestMeas.correctionDose; state.corrDirty = true; }
      if (latestMeas.carbDose && els.doseCarbs) { els.doseCarbs.value = latestMeas.carbDose; state.carbDirty = true; }
      
      if(latestMeas.carbs) { alert("⚠️ توجد وجبة محفوظة مسبقاً بهذا الوقت! الحفظ سيقوم بتحديثها."); }
    }
    updateTotals();
  }catch(e){ console.error(e); }
}

// 4. الحسابات الذكية (تعتمد على الهدف Target)
function updateTotals(){
  let sumRaw=0,sumNet=0,sumFiber=0,sumFat=0,sumPro=0,sumCal=0;
  for(const it of state.items){ 
    const grams=+it.grams||0, r=grams/100;
    const f= state.rule==="fullFiber"?1 : state.rule==="halfFiber"?0.5 : 0;
    sumRaw+= (it.per100.carbs_g||0)*r; sumFiber+= (it.per100.fiber_g||0)*r; sumFat+= (it.per100.fat_g||0)*r; sumPro+= (it.per100.protein_g||0)*r; sumCal+= (it.per100.cal_kcal||0)*r;
    sumNet+= Math.max(0, ((it.per100.carbs_g||0)*r) - (((it.per100.fiber_g||0)*r)*f));
  }
  
  if(els.sumCarbsRaw) els.sumCarbsRaw.textContent=`${fmt(sumRaw,1)} g`; if(els.sumCarbsNet) els.sumCarbsNet.textContent=`${fmt(sumNet,1)} g`;
  if(els.sumFiber) els.sumFiber.textContent=`${fmt(sumFiber,1)} g`; if(els.sumProtein) els.sumProtein.textContent=`${fmt(sumPro,1)} g`; 
  if(els.sumFat) els.sumFat.textContent=`${fmt(sumFat,1)} g`; if(els.sumCalories) els.sumCalories.textContent=`${fmt(sumCal,0)} kcal`; 

  const s = state.slot;
  let currentCR = state.CRs.snack || 15;
  if(s.includes('BREAKFAST')) currentCR = state.CRs.breakfast || 10;
  if(s.includes('LUNCH')) currentCR = state.CRs.lunch || 10;
  if(s.includes('DINNER')) currentCR = state.CRs.dinner || 10;

  const bgInput = parseFloat(els.preBg.value);
  const inputUnit = els.preBgUnit.value;
  const childUnit = state.child?.glucoseUnit || "mg/dL";
  
  // تحويل لتوحيد الحسابات
  const bgInChildUnit = Number.isFinite(bgInput) ? (childUnit === inputUnit ? bgInput : (childUnit.includes('mmol') ? mgdl2mmol(bgInput) : mmol2mgdl(bgInput))) : NaN;

  // جرعة التصحيح (من الهدف مباشرة)
  let rawCorr = 0; 
  if (Number.isFinite(bgInChildUnit) && state.CF > 0 && bgInChildUnit > state.Target) { 
    rawCorr = (bgInChildUnit - state.Target) / state.CF; 
  }
  
  let doseCarb = currentCR > 0 ? (sumNet/currentCR) : 0;
  const step = 0.5;
  if(els.doseCorrection && !state.corrDirty) els.doseCorrection.value = fmt(Math.round(rawCorr/step)*step, 1);
  if(els.doseCarbs && !state.carbDirty) els.doseCarbs.value = fmt(Math.round(doseCarb/step)*step, 1);
  
  const finalCorr = parseFloat(els.doseCorrection.value) || 0; const finalCarb = parseFloat(els.doseCarbs.value) || 0;
  let finalDose = Math.max(0, (finalCorr + finalCarb) - state.IOB);
  
  state.finalDoseVal = Math.round(finalDose/step)*step;
  if(els.doseFinal) els.doseFinal.textContent = fmt(state.finalDoseVal, 1);

  // تنبيهات الدسم
  if(els.smartAlerts) {
    els.smartAlerts.style.display = 'none'; els.smartAlerts.innerHTML = ''; let alertsHtml = '';
    if (state.IOB > 0) alertsHtml += `<strong>⏳ يوجد أنسولين نشط (${fmt(state.IOB,1)} U)</strong> تم خصمه من الجرعة.<br>`;
    if (sumFat > 30 || sumPro > 40) { els.smartAlerts.classList.add('danger'); alertsHtml += `<strong>🍕 وجبة دسمة:</strong> السكر سيرتفع متأخراً (قسم الجرعة).`; } 
    if (alertsHtml) { els.smartAlerts.innerHTML = alertsHtml; els.smartAlerts.style.display = 'block'; }
  }
}

// 5. الحفظ والمزامنة العبقرية مع جدول القياسات
async function saveMeal(){
  const bgInput = parseFloat(els.preBg.value);
  const netCarbs = parseFloat(els.sumCarbsNet.textContent) || 0;
  const carbDose = parseFloat(els.doseCarbs.value) || 0;
  const corrDose = parseFloat(els.doseCorrection.value) || 0;
  const totalDose = state.finalDoseVal;

  if (isNaN(bgInput) && netCarbs === 0) { alert("أدخل قراءة السكر أو مكونات الوجبة للحفظ."); return; }

  try {
    const measColl = collection(db,"parents",state.parentId,"children",state.childId,"measurements");
    const qy = query(measColl, where("date","==", state.date));
    const snap = await getDocs(qy);
    
    let targetDocId = null;
    let targetPayload = null;

    // بحث عن السجل الموجود (حتى لو كان FW متابعة)
    snap.forEach(doc => {
      const d = doc.data();
      if(d.slotKey && d.slotKey.startsWith(state.slot)) {
        if(!targetPayload || (d.when?.seconds > targetPayload.when?.seconds)) {
          targetDocId = doc.id;
          targetPayload = { ...d };
        }
      }
    });

    const timeObj = new Date();
    
    // التحديثات التي ستُحقن في كارت الخط الزمني للقياسات
    const updateData = {
      carbs: netCarbs,
      carbDose: carbDose,
      correctionDose: corrDose,
      totalDose: totalDose,
      updatedAt: serverTimestamp()
    };

    if (targetDocId) {
      // 1. إذا كان فيه قياس، ندمج بيانات الوجبة جواه
      if(!isNaN(bgInput) && targetPayload.value !== bgInput) {
        updateData.value = bgInput; // تحديث الرقم لو الأم غيرته هنا
        updateData.unit = els.preBgUnit.value;
      }
      await setDoc(doc(measColl, targetDocId), updateData, { merge: true });
    } else {
      // 2. إذا لم يكن هناك قياس أصلاً، ننشئ كارت جديد في الخط الزمني!
      updateData.date = state.date;
      updateData.time = `${pad(timeObj.getHours())}:${pad(timeObj.getMinutes())}`;
      updateData.when = timeObj;
      updateData.slotKey = state.slot;
      updateData.createdAt = serverTimestamp();
      updateData.notes = "🍽️ مسجل من حاسبة الوجبات";
      
      if(!isNaN(bgInput)) {
        updateData.value = bgInput;
        updateData.unit = els.preBgUnit.value;
      }
      
      await addDoc(measColl, updateData);
    }

    alert("تم حفظ الوجبة وتحديث سجل القياسات بنجاح! ✅");
    location.href = `measurements.html?child=${state.childId}`; // نرجعها للقياسات تشوف الكارت!
  } catch(e) { console.error(e); alert("حدث خطأ في الحفظ"); }
}

// تهيئة البداية واستقبال التمرير من الـ URL (Smart Routing)
async function init(){
  try {
    const qp = new URLSearchParams(location.search);
    state.childId=qp.get("child"); state.parentId=qp.get("parentId")||localStorage.getItem('selectedParentId');
    state.slot = qp.get("slot") || "PRE_BREAKFAST"; 
    state.date = qp.get("date") || todayStr();
    
    if(els.slotSelect) els.slotSelect.value = state.slot;
    if(els.dateInput) els.dateInput.value = state.date;

    const user = await ensureAuth();
    if(!user || !state.childId) return;

    await loadChild();
    
    // استقبال السكر الممرر من الرابط (من صفحة القياسات)
    const passedBg = qp.get("bg");
    const passedUnit = qp.get("unit");
    if(passedBg) {
      els.preBg.value = passedBg;
      if(passedUnit) els.preBgUnit.value = passedUnit;
    } else {
      // إذا لم يكن ممرراً في الرابط، نحاول جلبه من الداتا بيز لنفس اليوم والوقت
      await fetchPreMeasurement(); 
    }

    // Events
    if(els.slotSelect) els.slotSelect.addEventListener("change", ()=>{ state.slot=els.slotSelect.value; updateChipsAndAlerts(); fetchPreMeasurement(); updateTotals(); });
    if(els.dateInput) els.dateInput.addEventListener("change", ()=>{ state.date=els.dateInput.value; fetchPreMeasurement(); updateTotals(); });
    if(els.preBg) els.preBg.addEventListener("input", ()=>{ state.corrDirty=false; updateTotals(); });
    if(els.preBgUnit) els.preBgUnit.addEventListener("change", ()=>{ state.corrDirty=false; updateTotals(); });
    if(els.doseCorrection) els.doseCorrection.addEventListener("input", ()=>{ state.corrDirty=true; updateTotals(); });
    if(els.doseCarbs) els.doseCarbs.addEventListener("input", ()=>{ state.carbDirty=true; updateTotals(); });
    if(els.btnSaveMeal) els.btnSaveMeal.addEventListener("click", saveMeal);
    
    showLoader(false);
  } catch(e) { console.error(e); }
}

function pad(n){ return String(n).padStart(2,'0'); }
init();
