// js/meals.js
import { db, storage } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, collectionGroup, getDocs,
  query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const $ = (s,p=document)=>p.querySelector(s);
const $$ = (s,p=document)=>[...p.querySelectorAll(s)];
const fmt = (n,d=1)=>Number.isFinite(n)?(+n).toFixed(d):"—";
const todayStr = ()=> new Date().toISOString().slice(0,10);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

// ===== Elements
const els = {
  loader: $("#appLoader"),
  btnBack: $("#btnBack"),
  chipCF: $("#chipCF"),
  chipCR: $("#chipCR"),
  chipTargets: $("#chipTargets"),
  slotSelect: $("#slotSelect"),
  dateInput: $("#dateInput"),
  preBg: $("#preBg"),
  btnFetchPre: $("#btnFetchPre"),
  netCarbRule: $("#netCarbRule"),
  doseCorrection: $("#doseCorrection"),
  doseCarbs: $("#doseCarbs"),
  dayCarbs: $("#dayCarbs"),
  progressBar: $("#progressBar"),
  btnScaleToTarget: $("#btnScaleToTarget"),
  btnClearMeal: $("#btnClearMeal"),
  btnOpenLibrary: $("#btnOpenLibrary"),
  mealBody: $("#mealBody"),
  sumGL: $("#sumGL"),
  sumGI: $("#sumGI"),
  sumFiber: $("#sumFiber"),
  sumCarbsNet: $("#sumCarbsNet"),
  sumCarbsRaw: $("#sumCarbsRaw"),
  sumCalories: $("#sumCalories"),
  doseFinal: $("#doseFinal"),
  // library
  libModal: $("#libModal"),
  libOverlay: $("#libOverlay"),
  libClose: $("#libClose"),
  searchBox: $("#searchBox"),
  itemsGrid: $("#itemsGrid"),
  // templates
  tplModal: $("#tplModal"),
  tplList: $("#tplList"),
  // chat
  chat: $("#chatDrawer"),
  btnChat: $("#btnChat"),
  btnChatClose: $("#btnChatClose"),
  chatLog: $("#chatLog"),
  chatMsg: $("#chatMsg"),
  btnChatSend: $("#btnChatSend"),
};

const SLOT_MAP = { b:"BREAKFAST", l:"LUNCH", d:"DINNER", s:"SNACK" };

const state = {
  childId: null,
  parentId: null,
  child: null,
  slot: "b",
  date: todayStr(),
  rule: "fullFiber", // الافتراضي حسب موافقتك (يمكن تغييره من الواجهة)
  CF: null,
  CRs: { b:null,l:null,d:null,s:null },
  targets: { b:{min:0,max:0}, l:{min:0,max:0}, d:{min:0,max:0}, s:{min:0,max:0} },
  itemsLib: [],
  items: [], // { id,name,per100:{carbs_g,fiber_g,cal_kcal,gi}, measures[], unitLabel, qty, grams, thumb }
  templates: []
};

function showLoader(v){ els.loader.style.display = v ? "flex" : "none"; }
function setBackHref(){
  const qp = new URLSearchParams({ child: state.childId, parentId: state.parentId });
  els.btnBack.href = `child.html?${qp.toString()}`;
}
function setChips(){
  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? "—";
  const t = state.targets[state.slot] || {min:"—",max:"—"};
  els.chipCF.textContent = `CF: ${state.CF ?? "—"}`;
  els.chipCR.textContent = `CR: ${CR}`;
  els.chipTargets.textContent = `الهدف: ${t.min}–${t.max} g`;
}
const auth = getAuth();
function ensureAuth(){ return new Promise(res=>onAuthStateChanged(auth,u=>res(u),()=>res(null))); }

// ======= Parent resolution (direct then fallback to collectionGroup)
async function resolveParentIdIfNeeded(user){
  if (state.parentId && state.parentId === user.uid) return;
  // جرّب مباشرة وثيقة الطفل تحت parentId = user.uid
  const d1 = doc(db, "parents", user.uid, "children", state.childId);
  const s1 = await getDoc(d1);
  if (s1.exists()){
    state.parentId = user.uid; return;
  }
  // Fallback: collectionGroup (يتطلب index children.parentId ASC)
  const cg = query(collectionGroup(db, "children"), where("parentId","==", user.uid), limit(200));
  const snap = await getDocs(cg);
  const hit = snap.docs.find(d => d.id === state.childId);
  if (!hit) throw new Error("لا أملك صلاحية لهذا الطفل أو لم يتم العثور عليه لهذا الحساب.");
  state.parentId = hit.ref.parent.parent.id;
}

async function loadChild(){
  const dref = doc(db, "parents", state.parentId, "children", state.childId);
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
  state.targets.l = tg.lunch || {min:0,max:0};
  state.targets.d = tg.dinner || {min:0,max:0};
  state.targets.s = tg.snack || {min:0,max:0};

  // قاعدة صافي الكارب الافتراضية — مسموح تعديلها من الواجهة
  state.rule = state.child.netCarbRule || state.rule;

  const tForSlot = state.targets[state.slot];
  els.dayCarbs.value = Number.isFinite(tForSlot?.max) ? tForSlot.max : 0;

  setChips();
}

// ====== PRE measurement (date + slotKey only)
async function fetchPreMeasurement(){
  const preKey = `PRE_${SLOT_MAP[state.slot]}`;
  const coll = collection(db, "parents", state.parentId, "children", state.childId, "measurements");
  const qy = query(coll, where("date","==", state.date), where("slotKey","==", preKey), orderBy("when","desc"), limit(1));
  const snap = await getDocs(qy);
  if (snap.empty) return alert("لا يوجد قياس PRE لليوم/الوجبة المحددة.");
  const m = snap.docs[0].data();
  els.preBg.value = m.value_mmol ?? m.value ?? "";
  updateTotals();
}

// ===== Library
async function loadFoodLibrary(){
  const coll = collection(db, "admin", "global", "foodItems");
  const snap = await getDocs(coll);
  state.itemsLib = snap.docs.map(d=>{
    const x = { id:d.id, ...d.data() };
    // تطبيع أسماء الحقول
    x.per100 = {
      carbs_g: +x.carbs_g || 0,
      fiber_g: +x.fiber_g || 0,
      cal_kcal: +x.cal_kcal || 0,
      gi: Number.isFinite(+x.gi) ? +x.gi : null
    };
    x.measures = Array.isArray(x.measures) ? x.measures : []; // [{label,grams,default}]
    return x;
  });
  renderLibrary();
}

function filterLib(){
  const term = els.searchBox.value?.trim().toLowerCase() || "";
  return term ? state.itemsLib.filter(x =>
    (x.name||"").toLowerCase().includes(term) ||
    (x.category||"").toLowerCase().includes(term)
  ) : state.itemsLib;
}

function renderLibrary(){
  const list = filterLib();
  els.itemsGrid.innerHTML = "";
  for (const it of list){
    const card = document.createElement("div"); card.className="card-item";
    const t = document.createElement("div"); t.className="thumb-wrap";
    const img = document.createElement("img"); img.alt = it.name || "item";
    (async()=>{
      const paths = [
        `food-items/items/${it.id}/main.webp`,
        `food-items/items/${it.id}/main.jpg`,
        `food-items/items/${it.id}/main.png`,
        `food-items/items/${it.id}/1.webp`,
        `food-items/items/${it.id}/1.jpg`,
        `food-items/items/${it.id}/1.png`,
      ];
      for (const p of paths){ try{ img.src = await getDownloadURL(ref(storage,p)); break; } catch(_){ } }
    })();
    t.appendChild(img);

    const body = document.createElement("div"); body.className="card-body";
    const title = document.createElement("div"); title.textContent = it.name || "صنف"; title.style.fontWeight="600";
    const badges = document.createElement("div"); badges.className="badges";
    badges.innerHTML = `
      <span class="badge">Carbs: ${fmt(it.per100.carbs_g,1)} g</span>
      <span class="badge">Fiber: ${fmt(it.per100.fiber_g,1)} g</span>
      <span class="badge">GI: ${Number.isFinite(it.per100.gi)?it.per100.gi:"—"}</span>
      <span class="badge">kcal: ${fmt(it.per100.cal_kcal,0)}</span>
    `;

    // اختيار المقياس والكمية
    const rowMini = document.createElement("div"); rowMini.className="row-mini";
    const selUnit = document.createElement("select");
    // خيار جرام دائمًا
    selUnit.innerHTML = `<option value="__g__">جرام</option>` + (it.measures||[]).map(m=>`<option value="${m.label}">${m.label} (${m.grams} جم)</option>`).join("");
    // افتراضي: المقياس الذي له default=true وإلا جرام
    const def = (it.measures||[]).find(m=>m.default) || null;
    selUnit.value = def ? def.label : "__g__";
    const inpQty = document.createElement("input"); inpQty.type="number"; inpQty.step="0.1"; inpQty.value = def ? 1 : 100;

    const actions = document.createElement("div"); actions.className="actions";
    const btnAdd=document.createElement("button"); btnAdd.className="btn primary"; btnAdd.textContent="إضافة";
    btnAdd.onclick = ()=>{
      const unitLabel = selUnit.value==="__g__" ? "جرام" : selUnit.value;
      const qty = +inpQty.value || 0;
      addItemToMealFromLib(it, unitLabel, qty);
    };
    const btnFav1=document.createElement("button"); btnFav1.className="btn"; btnFav1.textContent="⭐";
    const btnFav2=document.createElement("button"); btnFav2.className="btn"; btnFav2.textContent="🚫";
    actions.append(btnFav1,btnFav2,btnAdd);

    rowMini.append(selUnit, inpQty);
    body.append(title,badges,rowMini,actions);
    card.append(t,body);
    els.itemsGrid.appendChild(card);
  }
}

// ====== meal table logic
function findMeasureGrams(it, unitLabel){
  if (unitLabel==="جرام") return 1; // لكل 1 كمية = 1 جم
  const m = (it.measures||[]).find(x=>x.label===unitLabel);
  return m ? m.grams : null;
}
function computeGrams(unitLabel, qty, it){
  if (unitLabel==="جرام") return +qty || 0;
  const g = findMeasureGrams(it, unitLabel);
  return g ? (+qty||0) * g : 0;
}
function computeRow(it){
  const per = 100; // per 100g
  const grams = +it.grams || 0;
  const ratio = grams / per;

  const carbsRaw = (it.per100.carbs_g||0) * ratio;
  const fiber = (it.per100.fiber_g||0) * ratio;

  const f = state.rule==="fullFiber"?1 : state.rule==="halfFiber"?0.5 : 0;
  const net = Math.max(0, carbsRaw - (fiber * f));

  const cal = (it.per100.cal_kcal||0) * ratio;
  const GI = Number.isFinite(it.per100.gi) ? it.per100.gi : null;
  const GL = GI ? (GI * net / 100) : 0;

  return { carbsRaw, fiber, net, cal, GI, GL };
}
function renderMeal(){
  els.mealBody.innerHTML = "";
  if (!state.items.length){
    const tr = document.createElement("tr"); tr.className="empty";
    const td = document.createElement("td"); td.colSpan=12; td.style.textAlign="center"; td.style.color="#999"; td.textContent="لا توجد أصناف مضافة.";
    tr.appendChild(td); els.mealBody.appendChild(tr);
  } else {
    for (const it of state.items){
      const c = computeRow(it);
      const gramsStr = fmt(it.grams,0)+" g";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><button class="btn sm gray" data-del>حذف</button></td>
        <td>${fmt(c.GL,1)}</td>
        <td>${Number.isFinite(c.GI)?c.GI:"—"}</td>
        <td>${fmt(c.fiber,1)} g</td>
        <td>${fmt(c.net,1)} g</td>
        <td>${fmt(c.carbsRaw,1)} g</td>
        <td>${fmt(c.cal,0)} kcal</td>
        <td class="muted">${gramsStr}</td>
        <td><input type="number" step="0.1" value="${it.qty||0}" data-qty /></td>
        <td>
          <select data-unit>
            ${[`جرام`, ...(it.measures||[]).map(m=>m.label)].map(l=>`<option value="${l}" ${l===it.unitLabel?'selected':''}>${l}</option>`).join("")}
          </select>
        </td>
        <td>${it.name || "صنف"}</td>
        <td>${it.thumb ? `<img src="${it.thumb}" style="width:46px;height:32px;object-fit:cover;border-radius:6px" />` : "—"}</td>
      `;
      tr.querySelector("[data-qty]").addEventListener("input",(e)=>{
        it.qty = +e.target.value||0;
        it.grams = computeGrams(it.unitLabel, it.qty, it);
        renderMeal(); // لإظهار الجرام المكافئ الجديد
      });
      tr.querySelector("[data-unit]").addEventListener("change",(e)=>{
        it.unitLabel = e.target.value;
        it.grams = computeGrams(it.unitLabel, it.qty, it);
        renderMeal();
      });
      tr.querySelector("[data-del]").addEventListener("click", ()=>{ state.items = state.items.filter(x => x!==it); renderMeal(); updateTotals(); });
      els.mealBody.appendChild(tr);
    }
  }
  updateTotals();
}

function updateTotals(){
  let sumRaw=0,sumNet=0,sumFiber=0,sumCal=0,sumGL=0, giVals=[];
  for (const it of state.items){
    const c = computeRow(it);
    sumRaw += c.carbsRaw;
    sumNet += c.net;
    sumFiber += c.fiber;
    sumCal += c.cal;
    sumGL += c.GL;
    if (Number.isFinite(c.GI)) giVals.push(c.GI);
  }
  const avgGI = giVals.length ? Math.round(giVals.reduce((a,b)=>a+b,0)/giVals.length) : "—";
  els.sumCarbsRaw.textContent = `${fmt(sumRaw,1)} g`;
  els.sumCarbsNet.textContent = `${fmt(sumNet,1)} g`;
  els.sumFiber.textContent = `${fmt(sumFiber,1)} g`;
  els.sumCalories.textContent = `${fmt(sumCal,0)} kcal`;
  els.sumGL.textContent = fmt(sumGL,1);
  els.sumGI.textContent = avgGI;

  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const bg = parseFloat(els.preBg.value);
  let doseCorr = 0;
  if (Number.isFinite(bg) && Number.isFinite(state.CF) && bg > 10.9){
    doseCorr = Math.max(0, (bg - 7) / state.CF);
  }
  const doseCarb = Number.isFinite(CR) ? (sumNet / CR) : 0;

  // تقريب 0.5U
  const step = 0.5;
  const dc = Math.round(doseCorr / step) * step;
  const dk = Math.round(doseCarb / step) * step;

  els.doseCorrection.value = fmt(dc,1);
  els.doseCarbs.value = fmt(dk,1);
  els.doseFinal.textContent = fmt(dc + dk,1);

  const t = state.targets[state.slot] || {min:0,max:0};
  const max = t.max || 0;
  const pct = max ? clamp((sumNet / max) * 100, 0, 100) : 0;
  els.progressBar.style.width = `${pct}%`;
  els.progressBar.style.background =
    pct <= 100 && sumNet>=t.min ? "var(--ok)" :
    pct <= 120 ? "var(--warn)" : "var(--danger)";
}

function addItemToMealFromLib(fi, unitLabel, qty){
  const it = {
    id: fi.id,
    name: fi.name || "صنف",
    measures: fi.measures || [],
    per100: fi.per100,
    unitLabel: unitLabel || "جرام",
    qty: +qty || 0,
    grams: 0,
    thumb: null
  };
  it.grams = computeGrams(it.unitLabel, it.qty, it);
  (async()=>{
    const p = `food-items/items/${it.id}/main.webp`;
    try{ it.thumb = await getDownloadURL(ref(storage, p)); renderMeal(); }catch(_){}
  })();
  state.items.push(it);
  renderMeal();
}

// ===== save meal
async function saveMeal(){
  if (!state.child) return;
  const id = `${state.date}_${state.slot}`;
  const mref = doc(db, "parents", state.parentId, "children", state.childId, "meals", id);

  let sumRaw=0,sumNet=0,sumFiber=0,sumCal=0,sumGL=0, giVals=[];
  const items = state.items.map(it=>{
    const c = computeRow(it);
    sumRaw+=c.carbsRaw; sumNet+=c.net; sumFiber+=c.fiber; sumCal+=c.cal; sumGL+=c.GL;
    if (Number.isFinite(c.GI)) giVals.push(c.GI);
    return {
      itemId: it.id, name: it.name, unitLabel: it.unitLabel, qty: it.qty,
      gramsComputed: +it.grams.toFixed(0),
      per100: it.per100, // للحفاظ على الدقة حتى لو تغيّر الصنف لاحقًا
      measures: it.measures?.map(m=>({label:m.label,grams:m.grams})) || []
    };
  });
  const avgGI = giVals.length ? Math.round(giVals.reduce((a,b)=>a+b,0)/giVals.length) : null;

  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const bg = parseFloat(els.preBg.value);
  let doseCorr = 0;
  if (Number.isFinite(bg) && Number.isFinite(state.CF) && bg > 10.9){
    doseCorr = Math.max(0, (bg - 7) / state.CF);
  }
  const doseCarb = Number.isFinite(CR) ? (sumNet / CR) : 0;
  const step = 0.5;
  const dc = Math.round(doseCorr / step) * step;
  const dk = Math.round(doseCarb / step) * step;

  const payload = {
    createdAt: serverTimestamp(),
    date: state.date,
    slot: state.slot,
    slotKey: SLOT_MAP[state.slot],
    rule: state.rule,
    items,
    totals: {
      carbsRaw:+sumRaw.toFixed(1),
      carbsNet:+sumNet.toFixed(1),
      fiber:+sumFiber.toFixed(1),
      calories:Math.round(sumCal),
      GL:+sumGL.toFixed(1),
      GIavg: avgGI
    },
    doses: {
      correction: +dc.toFixed(1),
      carbs: +dk.toFixed(1),
      final: +(dc+dk).toFixed(1),
      CF: state.CF,
      CR: CR
    }
  };

  await setDoc(mref, payload);
  alert("تم حفظ الوجبة بنجاح ✅");
}

// ===== templates
async function saveTemplate(){
  const name = prompt("اسم القالب:");
  if (!name) return;
  const id = name.trim().replace(/\s+/g,"_")+"_"+Date.now();
  const pref = doc(db,"parents",state.parentId,"presets",id);

  const tpl = {
    name, slot: state.slot, rule: state.rule,
    items: state.items.map(it=>({
      itemId: it.id, name: it.name, unitLabel: it.unitLabel, qty: it.qty,
      gramsComputed: +it.grams.toFixed(0),
      per100: it.per100, measures: it.measures?.map(m=>({label:m.label,grams:m.grams}))||[]
    })),
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };

  await setDoc(pref, tpl);
  alert("تم حفظ القالب بنجاح ✅");
}
async function loadTemplates(){
  els.tplList.innerHTML = "";
  const snap = await getDocs(collection(db,"parents",state.parentId,"presets"));
  state.templates = snap.docs.map(d=>({id:d.id, ...d.data()}));
  for (const t of state.templates){
    const card = document.createElement("div"); card.className="tpl-card";
    card.innerHTML = `
      <div class="tpl-title">${t.name}</div>
      <div class="muted">وجبة: ${t.slot || "—"}</div>
      <div class="tpl-actions">
        <button data-append class="btn">إضافة</button>
        <button data-replace class="btn primary">استبدال</button>
      </div>
    `;
    card.querySelector("[data-append]").onclick = ()=> applyTemplate(t,false);
    card.querySelector("[data-replace]").onclick = ()=> applyTemplate(t,true);
    els.tplList.appendChild(card);
  }
  els.tplModal.classList.add("open");
}
function applyTemplate(t, replace=false){
  const from = (t.items||[]).map(x=>({
    id: x.itemId, name: x.name, unitLabel: x.unitLabel||"جرام", qty:+x.qty||0,
    grams: +x.gramsComputed||0, measures: x.measures||[], per100: x.per100||{carbs_g:0,fiber_g:0,cal_kcal:0,gi:null}, thumb:null
  }));
  if (replace) state.items = from; else state.items = [...state.items, ...from];
  els.tplModal.classList.remove("open");
  renderMeal();
}

// ===== CSV
function exportCSV(){
  const rows = [["الاسم","الوحدة","الكمية","جرام","Carbs raw","Fiber","Net","kcal","GL","GI"]];
  for (const it of state.items){
    const c = computeRow(it);
    rows.push([it.name,it.unitLabel,it.qty,Math.round(it.grams),fmt(c.carbsRaw,1),fmt(c.fiber,1),fmt(c.net,1),fmt(c.cal,0),fmt(c.GL,1),Number.isFinite(c.GI)?c.GI:"—"]);
  }
  const csv = rows.map(r=>r.join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `meal_${state.date}_${state.slot}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== Chat (local explainer)
function chatSay(text, me=false){
  const d = document.createElement("div"); d.className = "chat-msg"+(me?" me":"");
  d.textContent = text; els.chatLog.appendChild(d); els.chatLog.scrollTop = els.chatLog.scrollHeight;
}
function chatExplain(msg){
  // ملخّص عام من الحالة الحالية
  let sumNet=0;
  for (const it of state.items) sumNet += computeRow(it).net;
  const CR = state.CRs[state.slot] ?? state.child?.carbRatio ?? null;
  const CF = state.CF;
  const bg = parseFloat(els.preBg.value);
  let txt = `📌 ملخص سريع:\n- صافي كارب الوجبة: ${fmt(sumNet,1)} g.\n- CR لهذه الوجبة: ${CR ?? "غير محدد"}.\n- CF: ${CF ?? "غير محدد"}.\n`;
  if (Number.isFinite(bg)){
    txt += `- قراءة قبل الوجبة: ${bg} mmol/L.\n`;
    if (Number.isFinite(CF) && bg>10.9){
      const correction = Math.max(0,(bg-7)/CF);
      const corr05 = Math.round(correction/0.5)*0.5;
      txt += `→ التصحيح: ((BG-7)/CF) = ${fmt(correction,2)} ≈ ${fmt(corr05,1)} U.\n`;
    }
  }
  if (Number.isFinite(CR)){
    const carbDose = sumNet/CR; const cd05 = Math.round(carbDose/0.5)*0.5;
    txt += `→ جرعة كارب: Net/CR = ${fmt(carbDose,2)} ≈ ${fmt(cd05,1)} U.\n`;
  }
  txt += "⚠️ هذه توصيفات تعليمية وليست تشخيصًا طبيًا.";
  return txt;
}

// ===== init
async function init(){
  showLoader(true);

  const qp = new URLSearchParams(location.search);
  state.childId = qp.get("child") || null;
  state.parentId = qp.get("parentId") || null;
  state.slot = qp.get("slot") || "b";
  state.date = qp.get("date") || todayStr();

  els.slotSelect.value = state.slot;
  els.dateInput.value = state.date;

  if (!state.childId){
    alert("لا يوجد child في الرابط.");
    showLoader(false);
    return;
  }

  const user = await ensureAuth();
  if (!user){
    alert("يجب تسجيل الدخول للوصول إلى بيانات الطفل.");
    showLoader(false);
    return;
  }

  try {
    await resolveParentIdIfNeeded(user);
  } catch (e) {
    console.error(e);
    alert(e.message);
    showLoader(false);
    return;
  }

  setBackHref();

  try{
    await loadChild();
  }catch(e){
    console.error(e);
    alert(e.message);
    showLoader(false);
    return;
  }

  els.netCarbRule.value = state.rule;
  await loadFoodLibrary();

  // Events
  els.slotSelect.addEventListener("change", ()=>{ state.slot = els.slotSelect.value; setChips(); updateTotals(); });
  els.dateInput.addEventListener("change", ()=>{ state.date = els.dateInput.value; });
  els.btnFetchPre.addEventListener("click", fetchPreMeasurement);
  els.netCarbRule.addEventListener("change", ()=>{ state.rule = els.netCarbRule.value; renderMeal(); });
  els.btnClearMeal.addEventListener("click", ()=>{ state.items = []; renderMeal(); });
  els.btnScaleToTarget.addEventListener("click", ()=>{
    const t = state.targets[state.slot] || {min:0,max:0}; if (!t.max || !state.items.length) return;
    const target = (t.min + t.max) / 2;
    let sumNet = 0; for (const it of state.items) sumNet += computeRow(it).net;
    if (!sumNet) return;
    const factor = target / sumNet;
    for (const it of state.items){ it.qty = +(it.qty * factor).toFixed(1); it.grams = computeGrams(it.unitLabel, it.qty, it); }
    renderMeal();
  });

  $("#btnSaveMeal").addEventListener("click", saveMeal);
  $("#btnSaveTemplate").addEventListener("click", saveTemplate);
  $("#btnLoadTemplates").addEventListener("click", loadTemplates);
  $("#btnExportCSV").addEventListener("click", exportCSV);
  $("#btnPrint").addEventListener("click", ()=> window.print());
  $("#btnSaveFavorites").addEventListener("click", ()=> alert("قريبًا: المفضلة"));

  // Library modal
  els.btnOpenLibrary.addEventListener("click", ()=> els.libModal.classList.add("open"));
  els.libOverlay.addEventListener("click", e=>{ if(e.target.dataset.close!==undefined) els.libModal.classList.remove("open"); });
  els.libClose.addEventListener("click", ()=> els.libModal.classList.remove("open"));
  els.searchBox.addEventListener("input", renderLibrary);

  // Templates modal close
  els.tplModal.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>els.tplModal.classList.remove("open")));

  // Chat
  els.btnChat.addEventListener("click", ()=> els.chat.classList.add("open"));
  els.btnChatClose.addEventListener("click", ()=> els.chat.classList.remove("open"));
  els.btnChatSend.addEventListener("click", ()=>{
    const msg = els.chatMsg.value.trim(); if(!msg) return;
    els.chatMsg.value=""; chatSay(msg,true);
    chatSay(chatExplain(msg),false);
  });

  renderMeal();
  showLoader(false);
}

init().catch(err=>{
  console.error(err);
  alert(`خطأ في التهيئة: ${err.message}`);
  showLoader(false);
});
