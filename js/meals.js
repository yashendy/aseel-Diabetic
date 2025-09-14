import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, collection, addDoc, getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { suggestAlternatives } from "./ai.js";

/* ====== Helpers ====== */
const $=(s,r=document)=>r.querySelector(s); const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0"); const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
const round05=x=>Math.round(x/0.05)*0.05;
const nearest025=x=>Math.max(0,Math.round(x/0.25)*0.25);

/* ====== DOM ====== */
const qs=new URLSearchParams(location.search);
let childId=qs.get("child")||localStorage.getItem("lastChildId")||null;

const hdrChildName=$("#hdrChildName");
const s_name=$("#s_name"), s_unit=$("#s_unit"), s_cr=$("#s_cr"), s_cf=$("#s_cf"), s_normal=$("#s_normal"), s_targetPref=$("#s_targetPref");
const goalChips=$("#goalChips");
const mealType=$("#mealType");
const glucoseNow=$("#glucoseNow"), unitHint=$("#unitHint");
const gramsPerPortion=$("#gramsPerPortion"), portions=$("#portions"), carbs=$("#carbs");
const crUsed=$("#crUsed"), cfUsed=$("#cfUsed"), crSource=$("#crSource"), cfSource=$("#cfSource"), targetValue=$("#targetValue");
const doseMeal=$("#doseMeal"), doseCorr=$("#doseCorr"), doseTotal=$("#doseTotal");
const rangeText=$("#rangeText"), rangeHint=$("#rangeHint");
const btnSave=$("#btnSave"), statusEl=$("#status");
const backChild=$("#backChild");

/* مكتبة */
const btnOpenLibrary=$("#btnOpenLibrary"), libModal=$("#libModal"), libClose=$("#libClose");
const libSearch=$("#libSearch"), libList=$("#libList");
const libFilterDiet=$("#libFilterDiet"), libFilterAllergy=$("#libFilterAllergy");

/* AI */
const aiModal=$("#aiModal"), aiClose=$("#aiClose"), aiList=$("#aiList"), btnSuggestAI=$("#btnSuggestAI");

/* Presets */
const presetModal=$("#presetModal"), presetClose=$("#presetClose");
const presetList=$("#presetList"), presetName=$("#presetName");
const btnSavePreset=$("#btnSavePreset"), btnLoadPreset=$("#btnLoadPreset"), presetSaveNow=$("#presetSaveNow");

/* Fit */
const btnAutoFit=$("#btnAutoFit"), fitHint=$("#fitHint");

/* Basket */
const basketBody=$("#basketBody"), basketTotalEl=$("#basketTotal");

let user=null, child=null, parentId=null;
let basket=[];

/* ====== UI helpers ====== */
function setStatus(m){ if(statusEl) statusEl.textContent=m||"—"; }
function chip(text){ const s=document.createElement("span"); s.className="chip"; s.textContent=text; return s; }

/* ====== Logic ====== */
function computeNormal(unit, custom){
  if (custom && custom.min!=null && custom.max!=null) return {min:+custom.min,max:+custom.max,src:"custom"};
  if (unit==="mmol/L") return {min:3.5,max:7,src:"default"};
  if (unit==="mg/dL") return {min:63,max:126,src:"default"};
  return {min:null,max:null,src:"unknown"};
}
function targetFromPref(nrm,pref){ if(!nrm||nrm.min==null||nrm.max==null) return null; return (pref==="mid")? (+nrm.min + +nrm.max)/2 : +nrm.max; }

function goalsFor(meal, ct){
  const m={breakfast:"breakfast",lunch:"lunch",dinner:"dinner",snack:"snack"}[meal]||"breakfast";
  const g=(ct&&ct[m])||ct?.[m?.[0]]||null;
  if(!g) return {min:null,max:null};
  if(Array.isArray(g)) return {min:+g[0],max:+g[1]};
  return {min:(g.min!=null?+g.min:null),max:(g.max!=null?+g.max:null)};
}
function renderGoalChips(){
  goalChips.innerHTML="";
  const ct=child?.carbTargets||child?.carbGoals||{};
  const pairs=[["فطار",ct.breakfast||ct.b],["غدا",ct.lunch||ct.l],["عشا",ct.dinner||ct.d],["سناك",ct.snack||ct.s]];
  for(const [n,g] of pairs){
    let min=null,max=null;
    if(Array.isArray(g)){min=g[0];max=g[1];} else if(g){min=g.min;max=g.max;}
    const t=(min==null&&max==null)?`${n}: —`:`${n}: ${min??"—"}–${max??"—"} جم`;
    goalChips.appendChild(chip(t));
  }
}
function pickCR(meal){
  const map={breakfast:"b",lunch:"l",dinner:"d",snack:"s"}, k=map[meal];
  const by=child?.carbRatioByMeal?.[k]; if(by!=null && !Number.isNaN(+by)) return {val:+by,src:"حسب الوجبة"};
  if(child?.carbRatio!=null) return {val:+child.carbRatio,src:"عام"}; return {val:null,src:"غير متاح"};
}
function pickCF(meal){
  const map={breakfast:"b",lunch:"l",dinner:"d",snack:"s"}, k=map[meal];
  const by=child?.correctionFactorByMeal?.[k]; if(by!=null && !Number.isNaN(+by)) return {val:+by,src:"حسب الوجبة"};
  if(child?.correctionFactor!=null) return {val:+child.correctionFactor,src:"عام"}; return {val:null,src:"غير متاح"};
}
function paintRange(meal){
  const {min,max}=goalsFor(meal,child?.carbTargets||child?.carbGoals);
  const v=+carbs.value||0; let cls="range-ok", hint="";
  if(min==null && max==null){ rangeText.textContent="—"; rangeHint.textContent="لا يوجد هدف."; rangeText.className=""; return; }
  rangeText.textContent=`${min??"—"}–${max??"—"} جم`;
  if((min!=null&&v<min)||(max!=null&&v>max)){ cls=(max!=null&&v>max)?"range-bad":"range-warn"; hint="خارج النطاق"; }
  else hint="داخل النطاق";
  rangeText.className=cls; rangeHint.textContent=hint;
}
function updateCarbsFromInputs(){
  const gpp=+gramsPerPortion.value||0, p=+portions.value||0;
  if(gpp && p) carbs.value=+(gpp*p).toFixed(1);
}
function recalc(){
  const meal=mealType.value;
  const CR=pickCR(meal); crUsed.textContent=CR.val??"—"; crSource.textContent=CR.src;
  const CF=pickCF(meal); cfUsed.textContent=CF.val??"—"; cfSource.textContent=CF.src;

  const unit=child?.unit||child?.glucoseUnit||"";
  const nrm=computeNormal(unit, child?.glucoseTargets?.normal || child?.normalRange);
  const target=targetFromPref(nrm, child?.glucoseTargets?.targetPref || "max");
  targetValue.textContent=(target!=null?`${target} ${unit}`:"—");

  const c=+carbs.value;
  const gNow=+glucoseNow.value;

  let dm=null, dc=null, total=null;
  if(CR.val!=null && !Number.isNaN(c)) dm=c/CR.val;
  if(CF.val!=null && !Number.isNaN(gNow) && target!=null){
    const diff=gNow-target; dc=diff/CF.val;
  }
  if(dm!=null || dc!=null) total=round05((dm||0)+Math.max(0,dc||0));

  doseMeal.textContent=(dm==null?"—":round05(dm).toFixed(2));
  doseCorr.textContent=(dc==null?"—":round05(Math.max(0,dc)).toFixed(2));
  doseTotal.textContent=(total==null?"—":total.toFixed(2));

  paintRange(meal);
}

/* ====== مكتبة الأصناف (عرض مضغوط + مقاييس) ====== */
function normalizeMeasures(it){
  const out=[],seen=new Set();
  if(Array.isArray(it.measures)){
    for(const m of it.measures){
      const grams=+m.grams||+m.g||null; const label=m.label||m.key||"حصة"; const key=(m.key||label).toString();
      if(!seen.has(key)&&grams){ out.push({key,label,grams:+grams}); seen.add(key); }
    }
  }
  if(+it.servingSize) out.push({key:"serv",label:`حصة (${it.servingSize} جم)`,grams:+it.servingSize});
  if(+it.pieceGrams)  out.push({key:"piece",label:`حبة (${it.pieceGrams} جم)`,grams:+it.pieceGrams});
  if(out.length===0){
    out.push({key:"cup",label:"كوب (240 جم تقريبًا)",grams:240});
    out.push({key:"tbsp",label:"ملعقة كبيرة (15 جم تقريبًا)",grams:15});
    out.push({key:"tsp",label:"ملعقة صغيرة (5 جم تقريبًا)",grams:5});
  }
  return out.slice(0,6);
}
function renderLibrary(items){
  libList.innerHTML="";
  if(!items.length){ libList.textContent="لا توجد أصناف مطابقة."; return; }
  for(const it of items){
    const img=it.image||it.imageUrl||it.photoUrl||"images/placeholder.png";
    const carbsPer100g=+it.carbsPer100g||0;
    const tags=[];
    if(it.is_vegan) tags.push("نباتي صارم");
    if(it.is_vegetarian) tags.push("نباتي");
    if(it.gluten===false || it.contains_gluten===false) tags.push("خالٍ من الجلوتين");
    if(it.lactose===false || it.contains_lactose===false) tags.push("خالٍ من اللاكتوز");
    if(it.halal) tags.push("حلال");
    const measures=normalizeMeasures(it);

    const div=document.createElement("div");
    div.className="lib-item";
    div.innerHTML=`
      <div class="head">
        <img class="thumb" src="${img}" alt="">
        <div>
          <div class="name">${it.nameAr||it.name||"صنف"}</div>
          <div class="meta">كارب/100جم: <b>${carbsPer100g||"—"}</b>${it.servingSize?` • الحصة: ${it.servingSize}جم`:""}</div>
        </div>
      </div>
      <div class="tags">${tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
      <div class="row">
        <select class="measure">${measures.map(m=>`<option value="${m.grams}">${m.label}</option>`).join("")}</select>
        <input type="number" step="0.25" min="0" placeholder="الكمية" class="qty" />
        <button class="btn sm add">إضافة</button>
      </div>
      <div class="row">
        <input type="number" step="0.1" min="0" placeholder="جرام/وحدة" class="gpp" />
        <input type="number" step="0.1" min="0" placeholder="كارب (جم)" class="cpg" disabled />
        <button class="btn sm calc">حساب</button>
      </div>
      <div class="hint">اختاري مقدار بيتي (كوب/حبة/ملعقة)؛ نحسب الجرام والكارب تلقائيًا.</div>
    `;
    const qty=div.querySelector(".qty"), gpp=div.querySelector(".gpp"), cpg=div.querySelector(".cpg"), sel=div.querySelector(".measure");
    const setGppFromMeasure=()=>{ const v=+sel.value||0; if(v) gpp.value=v; };
    setGppFromMeasure(); sel.addEventListener("change",setGppFromMeasure);
    const calc=()=>{ const portions=+qty.value||0; const gramsPerUnit=+gpp.value||(+sel.value||0);
      const totalGrams=portions*gramsPerUnit;
      const c=(carbsPer100g && totalGrams)? +((totalGrams*carbsPer100g)/100).toFixed(1) : 0;
      cpg.value=c;
    };
    div.querySelector(".calc").addEventListener("click",calc);
    div.querySelector(".add").addEventListener("click",()=>{
      const portions=+qty.value||0; const gramsPerUnit=+gpp.value||(+sel.value||0);
      const totalGrams=portions*gramsPerUnit;
      const c=(carbsPer100g && totalGrams)? +((totalGrams*carbsPer100g)/100).toFixed(1) : null;
      basket.push({id:it.id,name:it.nameAr||it.name||"صنف",gramsPerPortion:gramsPerUnit,portions,carbs:c,_c100:carbsPer100g,image:img});
      renderBasket(); closeLib();
    });
    libList.appendChild(div);
  }
}
async function fetchLibraryItems(){
  const col=collection(db,"admin","global","foodItems");
  try{ const snap=await getDocs(col); return snap.docs.map(d=>({id:d.id,...d.data()})); }catch{ return []; }
}
function isAllowedForChild(item,useDiet,useAllergy){
  if(!child) return true;
  const flags=new Set(child.dietaryFlags||[]), allergies=new Set((child.allergies||[]).map(a=>String(a).toLowerCase()));
  if(useDiet){
    if(flags.has("low_carb")&&item.high_carb===true) return false;
    if(flags.has("low_sodium")&&item.high_sodium===true) return false;
    if(flags.has("low_fat")&&item.high_fat===true) return false;
    if(flags.has("lactose_free")&&(item.contains_lactose||item.lactose===true)) return false;
    if(flags.has("gluten_free")&&(item.contains_gluten||item.gluten===true)) return false;
    if(flags.has("vegan")&&item.is_vegan===false) return false;
    if(flags.has("vegetarian")&&item.is_vegetarian===false) return false;
    if(flags.has("halal")&&item.halal===false) return false;
  }
  if(useAllergy){
    const itemAll=(item.allergens||[]).map(a=>String(a).toLowerCase());
    for(const a of itemAll){ if(allergies.has(a)) return false; }
  }
  return true;
}
async function loadLib(){
  libList.innerHTML="جارٍ التحميل…";
  const raw=await fetchLibraryItems();
  const q=(libSearch.value||"").trim().toLowerCase();
  const items=raw
    .filter(it=>isAllowedForChild(it, libFilterDiet?.checked, libFilterAllergy?.checked))
    .filter(it=>{ if(!q) return true; const name=String(it.nameAr||it.name||"").toLowerCase(); return name.includes(q); })
    .slice(0,80);
  renderLibrary(items);
}
function openLib(){ libModal.classList.remove("hidden"); libSearch.value=""; loadLib(); }
function closeLib(){ libModal.classList.add("hidden"); }

/* ====== Basket ====== */
function renderBasket(){
  basketBody.innerHTML="";
  if(!basket.length){ basketBody.innerHTML=`<tr class="empty"><td colspan="5">لا توجد أصناف بعد</td></tr>`; basketTotalEl.textContent="0"; carbs.value=""; recalc(); return; }
  let total=0;
  for(const [i,row] of basket.entries()){
    total+=(+row.carbs||0);
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${row.name}</td>
      <td><input type="number" step="0.25" min="0" class="bPortions" value="${row.portions??""}"></td>
      <td><input type="number" step="0.1"  min="0" class="bGpp" value="${row.gramsPerPortion??""}"></td>
      <td class="bCarbs">${row.carbs??"—"}</td>
      <td><button class="btn" data-i="${i}">حذف</button></td>
    `;
    const inpP=tr.querySelector(".bPortions"), inpG=tr.querySelector(".bGpp"), cellC=tr.querySelector(".bCarbs");
    function updateRow(){
      const p=+inpP.value||0, gpp=+inpG.value||0;
      row.portions=p; row.gramsPerPortion=gpp;
      if(row._c100 && gpp && p){ row.carbs=+(((gpp*p)*row._c100)/100).toFixed(1); }
      else row.carbs=null;
      cellC.textContent=(row.carbs??"—");
      renderBasket();
    }
    inpP.addEventListener("input",updateRow); inpG.addEventListener("input",updateRow);
    tr.querySelector("button[data-i]").addEventListener("click",()=>{ basket.splice(i,1); renderBasket(); });
    basketBody.appendChild(tr);
  }
  basketTotalEl.textContent=total.toFixed(1);
  carbs.value=total.toFixed(1);
  recalc();
}

/* ====== Fit to target ====== */
function autoFitToTarget(maxTarget){
  if(!maxTarget || !basket.length) return false;
  const total=basket.reduce((s,b)=>s+(+b.carbs||0),0);
  if(!total || total<=maxTarget) return false;
  const k=maxTarget/total;
  for(const b of basket){
    const p=+b.portions||0;
    const np=nearest025(p*k);
    b.portions=np;
    if(b._c100 && b.gramsPerPortion && b.portions){
      const grams=b.gramsPerPortion*b.portions;
      b.carbs=+((grams*b._c100)/100).toFixed(1);
    }else b.carbs=null;
  }
  let newTotal=basket.reduce((s,b)=>s+(+b.carbs||0),0), guard=30;
  while(newTotal>maxTarget && guard-- > 0){
    let idx=-1, best=-1; basket.forEach((b,i)=>{ if((+b.carbs||0)>best){ best=+b.carbs; idx=i; }});
    if(idx<0) break;
    basket[idx].portions=Math.max(0,(+basket[idx].portions||0)-0.25);
    if(basket[idx]._c100 && basket[idx].gramsPerPortion && basket[idx].portions){
      const grams=basket[idx].gramsPerPortion*basket[idx].portions;
      basket[idx].carbs=+((grams*basket[idx]._c100)/100).toFixed(1);
    } else basket[idx].carbs=null;
    newTotal=basket.reduce((s,b)=>s+(+b.carbs||0),0);
  }
  renderBasket(); return true;
}

/* ====== Presets ====== */
function openPresets(){ presetModal.classList.remove("hidden"); listPresets(); }
function closePresets(){ presetModal.classList.add("hidden"); }
presetClose?.addEventListener("click",closePresets);
btnSavePreset?.addEventListener("click",openPresets);
btnLoadPreset?.addEventListener("click",openPresets);

presetSaveNow?.addEventListener("click",async ()=>{
  const name=(presetName.value||"").trim(); if(!name){ alert("اكتبي اسمًا للوجبة."); return; }
  const payload={ name, mealType: mealType.value, createdAt: Date.now(),
    items: basket.map(b=>({ name:b.name, portions:b.portions, gramsPerPortion:b.gramsPerPortion, carbs:b.carbs, _c100:b._c100, image:b.image||null })) };
  const ref=collection(db,`parents/${parentId}/presets`); await addDoc(ref,payload);
  presetName.value=""; await listPresets(); alert("تم الحفظ ✔️");
});
async function listPresets(){
  presetList.innerHTML="جارٍ التحميل…";
  try{
    const ref=collection(db,`parents/${parentId}/presets`); const snap=await getDocs(ref);
    const arr=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(!arr.length){ presetList.textContent="لا توجد وجبات محفوظة."; return; }
    presetList.innerHTML=""; for(const p of arr){
      const card=document.createElement("div"); card.className="lib-item";
      card.innerHTML=`<div class="name">🍽️ ${p.name}</div>
        <div class="meta tiny">${new Date(p.createdAt||Date.now()).toLocaleString()}</div>
        <div class="row"><button class="btn sm load">تحميل</button></div>`;
      card.querySelector(".load").addEventListener("click",()=>{
        basket=(p.items||[]).map(x=>({...x})); renderBasket(); mealType.value=p.mealType||mealType.value; closePresets();
      });
      presetList.appendChild(card);
    }
  }catch{ presetList.textContent="تعذّر التحميل."; }
}

/* ====== AI ====== */
async function openAISuggestions(){
  aiModal.classList.remove("hidden"); aiList.textContent="جارٍ التحليل…";
  try{
    const suggestions=await suggestAlternatives({
      child:{ dietaryFlags: child?.dietaryFlags||[], allergies: child?.allergies||[], carbTargets: child?.carbTargets||child?.carbGoals||{} },
      mealType: mealType.value,
      basket: basket.map(b=>({name:b.name,portions:b.portions,gramsPerPortion:b.gramsPerPortion,carbs:b.carbs}))
    });
    aiList.innerHTML="";
    if(!suggestions?.length){ aiList.textContent="لا توجد بدائل مناسبة الآن."; return; }
    for(const it of suggestions.slice(0,6)){
      const card=document.createElement("div"); card.className="lib-item";
      card.innerHTML=`<div class="name">${it.name||"بديل"}</div>
        <div class="meta">${it.why||""}</div>
        <div class="row"><button class="btn sm apply">استبدال</button></div>`;
      card.querySelector(".apply").addEventListener("click",()=>{
        const targetName=it.swapFor || (basket[0]?.name);
        const i=basket.findIndex(b=>b.name===targetName);
        if(i>=0){ basket[i].name=it.name; basket[i].carbs=null; }
        else { basket.push({ id:"ai-"+Date.now(), name:it.name, gramsPerPortion:null, portions:null, carbs:null }); }
        renderBasket(); aiModal.classList.add("hidden");
      });
      aiList.appendChild(card);
    }
  }catch(e){ console.error(e); aiList.textContent="تعذّر الحصول على بدائل الآن."; }
}
aiClose?.addEventListener("click",()=>aiModal.classList.add("hidden"));

/* ====== Init ====== */
auth.onAuthStateChanged(async (u)=>{
  if(!u){ location.href="index.html"; return; }
  user=u; parentId=u.uid;
  if(!childId){ childId=localStorage.getItem("lastChildId"); if(!childId){ location.replace("parent.html?pickChild=1"); return; } }
  $("#backChild").href=`child.html?child=${encodeURIComponent(childId)}`;
  try{
    setStatus("جارٍ التحميل…");
    const childRef=doc(db,`parents/${parentId}/children/${childId}`); const snap=await getDoc(childRef);
    if(!snap.exists()){ setStatus("❌ لا توجد بيانات للطفل"); return; }
    child=snap.data();
    s_name.textContent=child.name||"—"; hdrChildName.textContent=child.name||"—";
    const unit=child.unit||child.glucoseUnit||""; s_unit.textContent=unit||"—"; unitHint.textContent=unit?`الوحدة: ${unit}`:"—";
    s_cr.textContent=(child.carbRatio!=null?`${child.carbRatio} g/U`:"—");
    s_cf.textContent=(child.correctionFactor!=null?`${child.correctionFactor} ${unit}/U`:"—");
    const nrm=computeNormal(unit, child?.glucoseTargets?.normal || child?.normalRange);
    s_normal.textContent=(nrm.min==null||nrm.max==null)?"—":`${nrm.min}–${nrm.max} ${unit}`;
    s_targetPref.textContent=(child?.glucoseTargets?.targetPref==="mid")?"منتصف المدى":"الحد الأعلى";
    renderGoalChips(); recalc(); setStatus("✅ جاهز");
  }catch(e){ console.error(e); setStatus("❌ خطأ في التحميل"); }
});

/* ====== Events ====== */
[mealType, glucoseNow, gramsPerPortion, portions, carbs].forEach(el=> el?.addEventListener("input",()=>{ if(el===portions||el===gramsPerPortion) updateCarbsFromInputs(); recalc(); }));
btnOpenLibrary?.addEventListener("click",openLib);
libClose?.addEventListener("click",()=>libModal.classList.add("hidden"));
libSearch?.addEventListener("input",loadLib);
libFilterDiet?.addEventListener("change",loadLib);
libFilterAllergy?.addEventListener("change",loadLib);
btnSuggestAI?.addEventListener("click",openAISuggestions);

btnAutoFit?.addEventListener("click",async ()=>{
  const {max}=goalsFor(mealType.value, child?.carbTargets||child?.carbGoals);
  if(!max){ fitHint.textContent="لا يوجد هدف للوجبة."; return; }
  const ok=autoFitToTarget(+max);
  if(ok){ fitHint.textContent="✔️ تم ضبط المقادير تلقائيًا"; return; }
  try{
    const out=await suggestAlternatives({ mode:"fit", target:+max,
      basket: basket.map(b=>({name:b.name,portions:b.portions,gramsPerPortion:b.gramsPerPortion,carbs:b.carbs,c100:b._c100})) });
    if(Array.isArray(out)&&out.length){
      for(const adj of out){
        const i=basket.findIndex(b=>b.name===adj.name);
        if(i>=0){
          basket[i].portions=nearest025(+adj.portions||0);
          if(basket[i]._c100 && basket[i].gramsPerPortion){
            const grams=basket[i].gramsPerPortion*basket[i].portions;
            basket[i].carbs=+((grams*basket[i]._c100)/100).toFixed(1);
          }
        }
      }
      renderBasket(); fitHint.textContent="✔️ تم الضبط بواسطة الذكاء الاصطناعي";
    }else fitHint.textContent="لا يمكن الضبط الآن.";
  }catch{ fitHint.textContent="لا يمكن الضبط الآن."; }
});

btnSave?.addEventListener("click",async ()=>{
  try{
    setStatus("جارٍ الحفظ…");
    const meal=mealType.value;
    const unit=child?.unit||child?.glucoseUnit||"";
    const CR=pickCR(meal).val??null, CF=pickCF(meal).val??null;
    const nrm=computeNormal(unit, child?.glucoseTargets?.normal || child?.normalRange);
    const target=targetFromPref(nrm, child?.glucoseTargets?.targetPref || "max");
    const payload={
      date: todayStr(), createdAt: Date.now(), mealType: meal,
      gramsPerPortion:(+gramsPerPortion.value)||null, portions:(+portions.value)||null, carbs:(+carbs.value)||null,
      glucoseNow:(+glucoseNow.value)||null, unit, usedCR:CR, usedCF:CF, target,
      doses:{
        meal: doseMeal.textContent==="—"?null:+doseMeal.textContent,
        corr: doseCorr.textContent==="—"?null:+doseCorr.textContent,
        total: doseTotal.textContent==="—"?null:+doseTotal.textContent,
      },
      items: basket.map(b=>({ name:b.name, portions:b.portions??null, gramsPerPortion:b.gramsPerPortion??null, carbs:b.carbs??null }))
    };
    const ref=collection(db,`parents/${parentId}/children/${childId}/meals`); await addDoc(ref,payload);
    setStatus("✅ تم حفظ الوجبة");
  }catch(e){ console.error(e); setStatus("❌ تعذّر حفظ الوجبة"); }
});
