// js/meals.js
console.log("✅ [meals] module loaded v6.1 (Exact Date Sync)");

import { db, storage } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, addDoc, serverTimestamp,
  collection, collectionGroup, getDocs,
  query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $  = (s)=>document.querySelector(s);
const fmt = (n,d=1)=>Number.isFinite(n)?(+n).toFixed(d):"—";
const todayStr = ()=> new Date().toISOString().slice(0,10);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

const mgdl2mmol = mg => mg/18;
const mmol2mgdl = mmol => mmol*18;
const round1 = n => Math.round((Number(n)||0)*10)/10;
const FIXED_MMOL_UPPER = 7.1;

const els = {
  loader: $("#appLoader"), btnBack: $("#btnBack"),
  chipCF: $("#chipCF"), chipCR: $("#chipCR"), chipTargets: $("#chipTargets"),
  slotSelect: $("#slotSelect"), dateInput: $("#dateInput"), 
  preBg: $("#preBg"), preBgUnit: $("#preBgUnit"), btnFetchPre: $("#btnFetchPre"),
  netCarbRule: $("#netCarbRule"), doseCorrection: $("#doseCorrection"),
  doseCarbs: $("#doseCarbs"), progressBar: $("#progressBar"), iobValue: $("#iobValue"),
  smartAlerts: $("#smartAlerts"), btnScaleToTarget: $("#btnScaleToTarget"), btnClearMeal: $("#btnClearMeal"),
  btnOpenLibrary: $("#btnOpenLibrary"), mealBody: $("#mealBody"), doseFinal: $("#doseFinal"),
  sumGL: $("#sumGL"), sumGI: $("#sumGI"), sumFiber: $("#sumFiber"), sumProtein: $("#sumProtein"), sumFat: $("#sumFat"),
  sumCarbsNet: $("#sumCarbsNet"), sumCarbsRaw: $("#sumCarbsRaw"), sumCalories: $("#sumCalories"),
  libModal: $("#libModal"), libOverlay: $("#libOverlay"), libClose: $("#libClose"),
  searchBox: $("#searchBox"), itemsGrid: $("#itemsGrid"), tplModal: $("#tplModal"), tplList: $("#tplList"),
  btnSaveMeal: $("#btnSaveMeal"), btnSaveTemplate: $("#btnSaveTemplate"), btnLoadTemplates: $("#btnLoadTemplates")
};

const SLOT_MAP = { b:"BREAKFAST", l:"LUNCH", d:"DINNER", s:"SNACK" };

const state = {
  childId:null, parentId:null, child:null,
  slot:"b", date:todayStr(), rule:"fullFiber",
  CF:null, CRs:{b:null,l:null,d:null,s:null},
  targets:{ b:{min:0,max:0}, l:{min:0,max:0}, d:{min:0,max:0}, s:{min:0,max:0} },
  itemsLib:[], items:[], templates:[], IOB: 0, finalDoseVal: 0,
  corrDirty: false, carbDirty: false 
};

function showLoader(v){ if(els.loader) els.loader.style.display = v?"flex":"none"; }
function setBackHref(){ if(els.btnBack) els.btnBack.href = `child.html?child=${state.childId}&parentId=${state.parentId}`; }
function setChips(){
  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? "—";
  const t = state.targets[state.slot] || {min:"—",max:"—"};
  if(els.chipCF) els.chipCF.textContent = `CF: ${state.CF ?? "—"} ${state.child?.glucoseUnit||'mg/dL'}/U`;
  if(els.chipCR) els.chipCR.textContent = `CR: ${CR}`;
  if(els.chipTargets) els.chipTargets.textContent = `الهدف: ${t.min}–${t.max} g`;
}

const auth = getAuth();
function ensureAuth(){ return new Promise(res=>onAuthStateChanged(auth,u=>res(u),()=>res(null))); }

async function resolveParentIdIfNeeded(user){
  if (state.parentId && state.parentId === user.uid) return;
  const d1 = doc(db, "parents", user.uid, "children", state.childId);
  const s1 = await getDoc(d1);
  if (s1.exists()){ state.parentId = user.uid; return; }
  const cg = query(collectionGroup(db,"children"), where("parentId","==", user.uid), limit(1));
  const snap = await getDocs(cg);
  if (snap.empty) throw new Error("لا أملك صلاحية لهذا الطفل");
  state.parentId = snap.docs[0].ref.parent.parent.id;
}

async function loadChild(){
  const dref = doc(db,"parents",state.parentId,"children",state.childId);
  const snap = await getDoc(dref);
  if (!snap.exists()) throw new Error("لم يتم العثور على بيانات الطفل.");
  state.child = { id:snap.id, ...snap.data() };
  state.CF = state.child.correctionFactor ?? null;
  const byMeal = state.child.carbRatioByMeal || {};
  state.CRs.b = byMeal.breakfast ?? state.child.carbRatio ?? null;
  state.CRs.l = byMeal.lunch ?? state.child.carbRatio ?? null;
  state.CRs.d = byMeal.dinner ?? state.child.carbRatio ?? null;
  state.CRs.s = byMeal.snack ?? state.child.carbRatio ?? null;
  const tg = state.child.carbTargets || {};
  state.targets.b = tg.breakfast || {min:0,max:0};
  state.targets.l = tg.lunch    || {min:0,max:0};
  state.targets.d = tg.dinner   || {min:0,max:0};
  state.targets.s = tg.snack    || {min:0,max:0};
  state.rule = state.child.netCarbRule || state.rule;
  if(els.netCarbRule) els.netCarbRule.value = state.rule;
  if(els.preBgUnit) els.preBgUnit.value = state.child.glucoseUnit || 'mg/dL';
  setChips();
}

// 🌟 جلب القياسات باستخدام حقل التاريخ مباشرة (لضمان التطابق 100%)
async function fetchPreMeasurement(showAlert = false){
  try{
    if(showAlert === true && els.btnFetchPre) els.btnFetchPre.textContent = "⏳ جاري الجلب...";
    
    if(els.preBg) els.preBg.value = "";
    state.corrDirty = false; 
    
    let preKeys = [];
    if (state.slot === 'b') preKeys = ['PRE_BREAKFAST', 'FASTING'];
    else if (state.slot === 'l') preKeys = ['PRE_LUNCH'];
    else if (state.slot === 'd') preKeys = ['PRE_DINNER'];
    else if (state.slot === 's') preKeys = ['SNACK']; 
    
    const coll = collection(db,"parents",state.parentId,"children",state.childId,"measurements");
    
    // 🌟 البحث بالنص المباشر للتاريخ (يطابق ما يتم حفظه في صفحة القياسات تماماً)
    const qy = query(coll, where("date", "==", state.date));
    const snap = await getDocs(qy);
    
    // فلترة السجلات المطلوبة برمجياً
    const docs = [];
    snap.forEach(document => {
      const data = document.data();
      if (preKeys.includes(data.slotKey)) docs.push(data);
    });
    
    if (docs.length > 0 && els.preBg) {
      docs.sort((a,b)=> (b.when?.seconds || 0) - (a.when?.seconds || 0));
      const m = docs[0];
      
      els.preBgUnit.value = m.unit || state.child?.glucoseUnit || "mmol/L";
      els.preBg.value = m.unit === 'mg/dL' ? (m.value_mgdl ?? m.value) : (m.value_mmol ?? m.value);
      
      if(showAlert === true) alert(`✅ تم جلب القياس (${els.preBg.value} ${els.preBgUnit.value}) بنجاح!`);
    } else {
      if(showAlert === true) alert("🤷‍♂️ لم يتم العثور على قياس مسجل قبل هذه الوجبة.\nتأكد أن القياس محفوظ في صفحة القياسات بنفس التاريخ ونفس الوجبة.");
    }
    updateTotals();
  }catch(e){ 
    console.error("fetchPre error:", e); 
    if(showAlert === true) alert("حدث خطأ أثناء الاتصال بقاعدة البيانات.");
  } finally {
    if(showAlert === true && els.btnFetchPre) els.btnFetchPre.textContent = "جلب من القياسات";
  }
}

async function calculateIOB() {
  state.IOB = 0;
  const now = new Date();
  try {
    const measColl = collection(db,"parents",state.parentId,"children",state.childId,"measurements");
    const measSnap = await getDocs(query(measColl, where("date","==", todayStr())));
    measSnap.forEach(d => {
      const data = d.data();
      const time = data.when?.toDate() || data.createdAt?.toDate();
      if(time) {
        const hrs = (now - time) / 3600000;
        if(hrs >= 0 && hrs < 4) state.IOB += (Number(data.correctionDose)||0) * (1 - (hrs/4));
      }
    });

    const mealsColl = collection(db,"parents",state.parentId,"children",state.childId,"meals");
    const mealsSnap = await getDocs(query(mealsColl, where("date","==", todayStr())));
    mealsSnap.forEach(d => {
      const data = d.data();
      const time = data.createdAt?.toDate();
      if(time) {
        const hrs = (now - time) / 3600000;
        if(hrs >= 0 && hrs < 4) state.IOB += (Number(data.doses?.final)||0) * (1 - (hrs/4));
      }
    });
  } catch(e) { console.error("IOB error", e); }
  if(els.iobValue) els.iobValue.textContent = fmt(state.IOB, 1) + ' U';
  updateTotals();
}

async function loadFoodLibrary(){
  try {
    const coll = collection(db,"admin","global","foodItems");
    const snap = await getDocs(coll);
    state.itemsLib = snap.docs.map(d=>{
      const x = { id:d.id, ...d.data() };
      x.per100 = { carbs_g:+x.carbs_g||0, fiber_g:+x.fiber_g||0, fat_g:+x.fat_g||0, protein_g:+x.protein_g||0, cal_kcal:+x.cal_kcal||0, gi: Number.isFinite(+x.gi) ? +x.gi : null };
      x.units = Array.isArray(x.units) ? x.units : (Array.isArray(x.measures) ? x.measures : []);
      return x;
    });
    renderLibrary();
  } catch(e) { console.error("lib load error", e); }
}

function renderLibrary(){
  if(!els.itemsGrid) return;
  const term = els.searchBox?.value?.trim().toLowerCase() || "";
  const list = term ? state.itemsLib.filter(x => (x.name||"").toLowerCase().includes(term)) : state.itemsLib;
  els.itemsGrid.innerHTML = "";
  for (const it of list){
    const card = document.createElement("div"); card.className="card-item";
    const body=document.createElement("div"); body.className="card-body";
    body.innerHTML = `<div style="font-weight:600">${it.name||"صنف"}</div><div class="badges"><span class="badge">Carbs: ${fmt(it.per100.carbs_g,1)}g</span><span class="badge">Fat: ${fmt(it.per100.fat_g,1)}g</span><span class="badge">Pro: ${fmt(it.per100.protein_g,1)}g</span></div>`;
    const rowMini=document.createElement("div"); rowMini.className="row-mini";
    const selUnit=document.createElement("select");
    selUnit.innerHTML = `<option value="__g__">جرام</option>` + (it.units||[]).map(m=>`<option value="${m.label}">${m.label} (${m.grams} جم)</option>`).join("");
    const inpQty=document.createElement("input"); inpQty.type="number"; inpQty.step="0.1"; inpQty.value = 1;
    const btnAdd=document.createElement("button"); btnAdd.className="btn primary"; btnAdd.textContent="إضافة";
    btnAdd.onclick=()=>{ const unitLabel = selUnit.value==="__g__" ? "جرام" : selUnit.value; addItemToMealFromLib(it, unitLabel, +inpQty.value||0); };
    rowMini.append(selUnit, inpQty, btnAdd); body.appendChild(rowMini); card.appendChild(body); els.itemsGrid.appendChild(card);
  }
}

function findMeasureGrams(it, unitLabel){ if (unitLabel==="جرام") return 1; const m=(it.units||[]).find(x=>x.label===unitLabel); return m ? m.grams : null; }
function computeGrams(unitLabel, qty, it){ if (unitLabel==="جرام") return +qty||0; const g=findMeasureGrams(it, unitLabel); return g ? (+qty||0)*g : 0; }
function computeRow(it){
  const grams=+it.grams||0, ratio=grams/100;
  const carbsRaw=(it.per100.carbs_g||0)*ratio, fiber=(it.per100.fiber_g||0)*ratio, fat=(it.per100.fat_g||0)*ratio, protein=(it.per100.protein_g||0)*ratio;
  const f= state.rule==="fullFiber"?1 : state.rule==="halfFiber"?0.5 : 0;
  const net=Math.max(0, carbsRaw - (fiber*f)), cal=(it.per100.cal_kcal||0)*ratio;
  const GI=Number.isFinite(it.per100.gi)?it.per100.gi:null, GL=GI ? (GI*net/100) : 0;
  return { carbsRaw, fiber, fat, protein, net, cal, GI, GL };
}

function renderMeal(){
  if(!els.mealBody) return; els.mealBody.innerHTML = "";
  if (!state.items.length){ els.mealBody.innerHTML = `<tr class="empty"><td colspan="12" style="text-align:center;color:#999">لا توجد أصناف مضافة.</td></tr>`; } 
  else {
    for(const it of state.items){
      const c=computeRow(it); const tr=document.createElement("tr");
      tr.innerHTML=`<td><button class="btn sm gray" data-del>×</button></td><td>${fmt(c.GL,1)}</td><td>${Number.isFinite(c.GI)?c.GI:"—"}</td><td>${fmt(c.fiber,1)}</td><td>${fmt(c.protein,1)}</td><td>${fmt(c.fat,1)}</td><td style="font-weight:bold;color:#7c3aed;">${fmt(c.net,1)}</td><td>${fmt(c.carbsRaw,1)}</td><td>${fmt(c.cal,0)}</td><td><input type="number" step="0.1" value="${it.qty||0}" data-qty style="width:60px" /></td><td><select data-unit>${[`جرام`, ...(it.units||[]).map(m=>m.label)].map(l=>`<option value="${l}" ${l===it.unitLabel?'selected':''}>${l}</option>`).join("")}</select></td><td>${it.name||"صنف"}</td>`;
      tr.querySelector("[data-qty]").addEventListener("input",(e)=>{ it.qty=+e.target.value||0; it.grams=computeGrams(it.unitLabel,it.qty,it); state.carbDirty = false; renderMeal(); });
      tr.querySelector("[data-unit]").addEventListener("change",(e)=>{ it.unitLabel=e.target.value; it.grams=computeGrams(it.unitLabel,it.qty,it); state.carbDirty = false; renderMeal(); });
      tr.querySelector("[data-del]").addEventListener("click",()=>{ state.items=state.items.filter(x=>x!==it); state.carbDirty = false; renderMeal(); });
      els.mealBody.appendChild(tr);
    }
  } updateTotals();
}

function updateTotals(){
  let sumRaw=0,sumNet=0,sumFiber=0,sumFat=0,sumPro=0,sumCal=0,sumGL=0, giVals=[];
  for(const it of state.items){ const c=computeRow(it); sumRaw+=c.carbsRaw; sumNet+=c.net; sumFiber+=c.fiber; sumFat+=c.fat; sumPro+=c.protein; sumCal+=c.cal; sumGL+=c.GL; if(Number.isFinite(c.GI)) giVals.push(c.GI); }
  if(els.sumCarbsRaw) els.sumCarbsRaw.textContent=`${fmt(sumRaw,1)} g`; if(els.sumCarbsNet) els.sumCarbsNet.textContent=`${fmt(sumNet,1)} g`;
  if(els.sumFiber) els.sumFiber.textContent=`${fmt(sumFiber,1)} g`; if(els.sumProtein) els.sumProtein.textContent=`${fmt(sumPro,1)} g`; 
  if(els.sumFat) els.sumFat.textContent=`${fmt(sumFat,1)} g`; if(els.sumCalories) els.sumCalories.textContent=`${fmt(sumCal,0)} kcal`; 
  if(els.sumGL) els.sumGL.textContent=fmt(sumGL,1); if(els.sumGI) els.sumGI.textContent = giVals.length ? Math.round(giVals.reduce((a,b)=>a+b,0)/giVals.length) : "—";

  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const bgInput = els.preBg ? parseFloat(els.preBg.value) : NaN;
  const inputUnit = els.preBgUnit ? els.preBgUnit.value : "mg/dL";
  const childUnit = state.child?.glucoseUnit || "mg/dL";
  const bgInChildUnit = Number.isFinite(bgInput) ? (childUnit === inputUnit ? bgInput : (childUnit.includes('mmol') ? mgdl2mmol(bgInput) : mmol2mgdl(bgInput))) : NaN;

  let rawCorr = 0; const upperLimit = childUnit.includes('mmol') ? FIXED_MMOL_UPPER : mmol2mgdl(FIXED_MMOL_UPPER);
  if (Number.isFinite(bgInChildUnit) && Number.isFinite(state.CF) && bgInChildUnit > upperLimit) { rawCorr = (bgInChildUnit - upperLimit) / state.CF; }
  let doseCarb = Number.isFinite(CR) ? (sumNet/CR) : 0;
  
  const step=0.5;
  if(els.doseCorrection && !state.corrDirty) els.doseCorrection.value = fmt(Math.round(rawCorr/step)*step, 1);
  if(els.doseCarbs && !state.carbDirty) els.doseCarbs.value = fmt(Math.round(doseCarb/step)*step, 1);
  
  const finalCorr = parseFloat(els.doseCorrection.value) || 0; const finalCarb = parseFloat(els.doseCarbs.value) || 0;
  let finalDose = Math.max(0, (finalCorr + finalCarb) - state.IOB);
  
  state.finalDoseVal = Math.round(finalDose/step)*step;
  if(els.doseFinal) els.doseFinal.textContent = fmt(state.finalDoseVal, 1);

  if(els.smartAlerts) {
    els.smartAlerts.style.display = 'none'; els.smartAlerts.innerHTML = ''; let alertsHtml = '';
    if (state.IOB > 0) alertsHtml += `<strong>⏳ يوجد أنسولين نشط (${fmt(state.IOB,1)} U)</strong> تم خصمه من الجرعة.<br>`;
    if (sumFat > 30 || sumPro > 40) { els.smartAlerts.classList.add('danger'); alertsHtml += `<strong style="margin-top:10px;">🍕 تنبيه الوجبة الدسمة:</strong> دهون وبروتين عالي. السكر سيرتفع متأخراً. يُنصح بتقسيم الجرعة (60% الآن و 40% بعد ساعتين).`; } 
    else { els.smartAlerts.classList.remove('danger'); }
    if (alertsHtml) { els.smartAlerts.innerHTML = alertsHtml; els.smartAlerts.style.display = 'block'; }
  }
  const t=state.targets[state.slot] || {min:0,max:0}; const max=t.max||0; const pct=max ? clamp((sumNet/max)*100,0,100) : 0;
  if(els.progressBar) { els.progressBar.style.width=`${pct}%`; els.progressBar.style.background = pct<=100 && sumNet>=t.min ? "var(--ok)" : (pct<=120 ? "var(--warn)" : "var(--danger)"); }
}

function addItemToMealFromLib(fi, unitLabel, qty){
  const it={ id:fi.id, name:fi.name||"صنف", units:fi.units||[], per100:fi.per100, unitLabel:unitLabel||"جرام", qty:+qty||0, grams:0 };
  it.grams = computeGrams(it.unitLabel,it.qty,it); state.items.push(it); state.carbDirty = false; renderMeal(); 
  if(els.libModal) els.libModal.classList.remove("open");
}

function getSaveSlotKey(slot){
  if (slot === 'b') return 'PRE_BREAKFAST';
  if (slot === 'l') return 'PRE_LUNCH';
  if (slot === 'd') return 'PRE_DINNER';
  if (slot === 's') return 'SNACK';
  return 'OTHER';
}

async function saveMeal(){
  if(!state.child) return;
  const id=`${state.date}_${state.slot}`;
  const mref=doc(db,"parents",state.parentId,"children",state.childId,"meals",id);
  
  let sumRaw=0,sumNet=0,sumFiber=0,sumFat=0,sumPro=0,sumCal=0;
  const items=state.items.map(it=>{
    const c=computeRow(it); sumRaw+=c.carbsRaw; sumNet+=c.net; sumFiber+=c.fiber; sumFat+=c.fat; sumPro+=c.protein; sumCal+=c.cal;
    return { itemId:it.id, name:it.name, unitLabel:it.unitLabel, qty:it.qty, gramsComputed:+it.grams.toFixed(0), per100:it.per100 };
  });

  const payload={
    createdAt:serverTimestamp(), date:state.date, slot:state.slot, slotKey:SLOT_MAP[state.slot], rule:state.rule,
    items, totals:{ carbsRaw:+sumRaw.toFixed(1), carbsNet:+sumNet.toFixed(1), fiber:+sumFiber.toFixed(1), fat:+sumFat.toFixed(1), protein:+sumPro.toFixed(1), calories:Math.round(sumCal) },
    doses:{ final: state.finalDoseVal, IOB: state.IOB, CF:state.CF, CR:state.CRs[state.slot], correctionDose: parseFloat(els.doseCorrection.value)||0, carbDose: parseFloat(els.doseCarbs.value)||0 }
  };

  try {
    await setDoc(mref,payload);
    
    const bgInput = els.preBg ? parseFloat(els.preBg.value) : NaN;
    if (Number.isFinite(bgInput)) {
      const inputUnit = els.preBgUnit.value;
      const value_mmol = inputUnit === 'mmol/L' ? bgInput : mgdl2mmol(bgInput);
      const value_mgdl = inputUnit === 'mg/dL' ? bgInput : mmol2mgdl(bgInput);
      const childUnit = state.child.glucoseUnit || "mmol/L";
      const valInChild = childUnit === inputUnit ? bgInput : (childUnit.includes('mmol') ? value_mmol : value_mgdl);
      
      let stateLabel = 'داخل النطاق';
      const upperLimit = childUnit.includes('mmol') ? FIXED_MMOL_UPPER : mmol2mgdl(FIXED_MMOL_UPPER);
      const lowLimit = childUnit.includes('mmol') ? 3.9 : mmol2mgdl(3.9);
      if(valInChild > (childUnit.includes('mmol')? 14.1 : mmol2mgdl(14.1))) stateLabel = 'ارتفاع حرج';
      else if(valInChild > (childUnit.includes('mmol')? 10.9 : mmol2mgdl(10.9))) stateLabel = 'ارتفاع شديد';
      else if(valInChild > upperLimit) stateLabel = 'ارتفاع';
      else if(valInChild < lowLimit) stateLabel = 'هبوط';

      const savePreKey = getSaveSlotKey(state.slot);
      const measColl = collection(db,"parents",state.parentId,"children",state.childId,"measurements");
      const qy = query(measColl, where("date","==", state.date), where("slotKey","==", savePreKey));
      const snap = await getDocs(qy);
      
      if (snap.empty) {
        const [y,m,d] = state.date.split('-');
        const when = new Date(y, m-1, d, new Date().getHours(), new Date().getMinutes());
        await addDoc(measColl, {
          value: bgInput, unit: inputUnit,
          value_mmol: round1(value_mmol), value_mgdl: round1(value_mgdl),
          when: when, date: state.date, slotKey: savePreKey, slotOrder: 20,
          state: stateLabel, correctionDose: parseFloat(els.doseCorrection.value)||0,
          notes: "تم التسجيل تلقائياً من صفحة الوجبات 🍽️", createdAt: serverTimestamp()
        });
      }
    }
    alert("تم حفظ الوجبة والقياس بنجاح ✅");
  } catch(e) { console.error(e); alert("حدث خطأ أثناء الحفظ."); }
}

async function init(){
  try {
    showLoader(true);
    const qp=new URLSearchParams(location.search);
    state.childId=qp.get("child")||null; state.parentId=qp.get("parentId")||null;
    state.slot=qp.get("slot")||"b"; state.date=qp.get("date")||todayStr();

    if(els.slotSelect) els.slotSelect.value=state.slot; 
    if(els.dateInput) els.dateInput.value=state.date;
    
    if(!state.childId) { alert("لا يوجد طفل في الرابط."); return; }

    const user=await ensureAuth();
    if(!user) { alert("يجب تسجيل الدخول."); return; }
    
    await resolveParentIdIfNeeded(user);
    setBackHref(); await loadChild(); await loadFoodLibrary(); await calculateIOB();
    
    await fetchPreMeasurement(false);

    // Events
    if(els.slotSelect) els.slotSelect.addEventListener("change", ()=>{ state.slot=els.slotSelect.value; setChips(); fetchPreMeasurement(false); });
    if(els.dateInput) els.dateInput.addEventListener("change", ()=>{ state.date=els.dateInput.value; fetchPreMeasurement(false); calculateIOB(); });
    
    if(els.btnFetchPre) els.btnFetchPre.addEventListener("click", () => fetchPreMeasurement(true));
    
    if(els.preBg) els.preBg.addEventListener("input", ()=>{ state.corrDirty=false; updateTotals(); });
    if(els.preBgUnit) els.preBgUnit.addEventListener("change", ()=>{ state.corrDirty=false; updateTotals(); });
    if(els.doseCorrection) els.doseCorrection.addEventListener("input", ()=>{ state.corrDirty=true; updateTotals(); });
    if(els.doseCarbs) els.doseCarbs.addEventListener("input", ()=>{ state.carbDirty=true; updateTotals(); });

    if(els.netCarbRule) els.netCarbRule.addEventListener("change", ()=>{ state.rule=els.netCarbRule.value; renderMeal(); });
    if(els.btnClearMeal) els.btnClearMeal.addEventListener("click", ()=>{ state.items=[]; state.carbDirty=false; renderMeal(); });
    if(els.btnSaveMeal) els.btnSaveMeal.addEventListener("click", saveMeal);
    if(els.btnOpenLibrary) els.btnOpenLibrary.addEventListener("click", ()=> { if(els.libModal) els.libModal.classList.add("open"); });
    if(els.libClose) els.libClose.addEventListener("click", ()=> { if(els.libModal) els.libModal.classList.remove("open"); });
    if(els.searchBox) els.searchBox.addEventListener("input", renderLibrary);
    
    document.querySelectorAll("[data-close]").forEach(el => { el.addEventListener("click", () => { if(els.libModal) els.libModal.classList.remove("open"); if(els.tplModal) els.tplModal.classList.remove("open"); }); });
    renderMeal();
  } catch(e) { console.error("Init error:", e); alert("حدث خطأ في التهيئة: " + e.message); } finally { showLoader(false); }
}

init();
