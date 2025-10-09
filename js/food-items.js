/* eslint-disable no-alert */
import { auth, db, storage } from "./firebase-config.js";
import {
  collection, query, where, orderBy, limit, startAfter, getDocs,
  addDoc, updateDoc, deleteDoc, doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  ref as sRef, uploadBytesResumable, getDownloadURL, uploadBytes
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const $ = (id)=> document.getElementById(id);
const on = (el,ev,cb)=> el && el.addEventListener(ev,cb);
const num = (x)=> (x===""||x==null)?null:Number(x);

const els = {
  search: $("search"), fCategory: $("filter-category"), fDiet: $("filter-diet"), fActive: $("filter-active"),
  btnClear: $("btn-clear"), cards: $("cards"), tableWrap: $("table-wrap"), tableBody: $("table-body"),
  btnAdd: $("btn-add"), btnCards: $("btn-cards"), btnTable: $("btn-table"),
  prev: $("prev"), next: $("next"), pageLabel: $("page-label"),

  dlg: $("edit-dialog"), dlgClose: $("dlg-close"), dlgTitle: $("dlg-title"), form: $("edit-form"),
  id: $("item-id"), name: $("name"), category: $("category"), isActive: $("isActive"),
  searchTags: $("searchTags"), dietChips: $("diet-chips"), addMeasure: $("add-measure"), measuresList: $("measures-list"),
  cal_kcal: $("cal_kcal"), carbs_g: $("carbs_g"), protein_g: $("protein_g"), fat_g: $("fat_g"), fiber_g: $("fiber_g"), sodium_mg: $("sodium_mg"),
  imageUrl: $("image-url"), imageFile: $("image-file"), uploadBtn: $("btn-upload"), progress: $("upload-progress"), preview: $("preview"), btnDelete: $("delete"),
  btnAuth: $("btn-auth"), adminName: $("admin-name"), adminRole: $("admin-role"), btnAi: $("btn-ai-tags"),
};

let user=null, isAdmin=false, paging={page:1,pageSize:20,lastDoc:null}, currentQuerySnapshot=null;

/* ===== Gate overlay لمنع غير الأدمن ===== */
const gate = (()=> {
  let el = document.getElementById("admin-gate");
  if(!el){
    el=document.createElement("div");
    el.id="admin-gate"; el.style.cssText="position:fixed;inset:0;display:none;z-index:9999;align-items:center;justify-content:center;background:rgba(24,31,55,.35);backdrop-filter:blur(2px)";
    el.innerHTML = `
      <div style="background:#fff;border:1px solid #e6ecf5;border-radius:16px;box-shadow:0 20px 60px rgba(27,35,48,.18);padding:20px;max-width:520px;width:92%;">
        <h3 style="margin:0 0 8px;font-weight:800;color:#1b2330">صلاحيات الوصول</h3>
        <p id="gate-msg" style="margin:0 0 12px;color:#4b5875">هذه الصفحة مخصصة للمشرفين فقط.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="gate-close" class="btn light" style="padding:8px 12px">إغلاق</button>
          <button id="gate-auth" class="btn primary" style="padding:8px 12px">تسجيل الدخول</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    on(el.querySelector("#gate-close"),"click",()=>el.style.display="none");
    on(el.querySelector("#gate-auth"),"click",()=>signIn());
  }
  return { show(msg){$("gate-msg").textContent=msg||"هذه الصفحة للمشرفين فقط."; el.style.display="flex";}, hide(){el.style.display="none";} };
})();

/* ===== auth ===== */
async function signIn(){ try{ await signInWithPopup(auth,new GoogleAuthProvider()); }catch(e){ console.warn(e.message);} }
on(els.btnAuth,"click",async()=>{ if(auth.currentUser) await signOut(auth); else await signIn(); });

async function loadProfile(u){
  if(!u) return {role:null,data:null};
  try{ const snap=await getDoc(doc(db,"users",u.uid)); const data=snap.exists()?snap.data():null; return {role:data?.role||null,data}; }
  catch(e){ console.warn("users read fail",e.message); return {role:null,data:null}; }
}
function setAdminBadge(u,profile,roleText){
  const name=(profile?.displayName||profile?.name||u?.displayName||(u?.email||"").split("@")[0]||"مستخدم");
  if(els.adminName) els.adminName.textContent=name;
  if(els.adminRole) els.adminRole.textContent=roleText||"";
  if(els.btnAuth) els.btnAuth.textContent = u ? "تسجيل الخروج" : "تسجيل الدخول";
}

/* ===== diet chips ===== */
const DIET_LABELS=[{code:"lowGi",label:"#منخفض_GI"},{code:"glutenFree",label:"#بدون_جلوتين"},{code:"dairyFree",label:"#بدون_ألبان"},{code:"vegan",label:"#نباتي"},{code:"keto",label:"#كيتو"}];
function renderDietChips(selected=[]){ els.dietChips.innerHTML=""; const set=new Set(selected); DIET_LABELS.forEach(d=>{ const s=document.createElement("span"); s.className="chip"+(set.has(d.code)?" active":""); s.dataset.code=d.code; s.textContent=d.label; s.onclick=()=>s.classList.toggle("active"); els.dietChips.appendChild(s); });}
const getDietCodes=()=> Array.from(document.querySelectorAll("#diet-chips .chip.active")).map(x=>x.dataset.code);

/* ===== measures ===== */
const PRESETS=[{name:"ملعقة",grams:5},{name:"كوب",grams:240},{name:"طبق",grams:150},{name:"حبة",grams:80}];
function renderMeasuresEditor(data){
  els.measuresList.innerHTML="";
  const list = Array.isArray(data?.measures)?data.measures
    : (data?.measureQty && typeof data.measureQty==='object') ? Object.entries(data.measureQty).map(([n,g])=>({name:n,grams:Number(g)||0})) : [];
  function addRow(init={name:"",grams:""}){
    const row=document.createElement("div"); row.className="measure-row";
    row.innerHTML=`<div style="display:flex;gap:8px">
      <input class="m-name" placeholder="اسم المقدار" value="${init.name||""}">
      <select class="m-preset"><option value="">—</option>${PRESETS.map(p=>`<option value="${p.name}|${p.grams}">${p.name}</option>`).join("")}</select>
    </div>
    <input class="m-grams" type="number" min="0" step="1" placeholder="جم" value="${init.grams??""}">
    <button type="button" class="btn light m-del">حذف</button>`;
    row.querySelector(".m-preset").addEventListener("change",(e)=>{ const [n,g]=(e.target.value||"").split("|"); if(n) row.querySelector(".m-name").value=n; if(g) row.querySelector(".m-grams").value=g; });
    row.querySelector(".m-del").onclick=()=>row.remove();
    els.measuresList.appendChild(row);
  }
  if(list.length) list.forEach(addRow); else addRow({});
  on(els.addMeasure,"click",()=>addRow({}));
}
const readMeasures=()=> Array.from(document.querySelectorAll("#measures-list .measure-row")).map(r=>({name:r.querySelector(".m-name").value.trim(), grams:Number(r.querySelector(".m-grams").value)||0})).filter(m=>m.name && m.grams>0);

/* ===== nutrition ===== */
const pickNutr=(raw)=>{ const n=raw?.nutrPer100g||{}; const v=(k)=> raw?.[k] ?? n?.[k]; return { cal_kcal:num(v("cal_kcal")), carbs_g:num(v("carbs_g")), protein_g:num(v("protein_g")), fat_g:num(v("fat_g")), fiber_g:num(v("fiber_g")), sodium_mg:num(v("sodium_mg")), }; };
const readNutr=()=>({ cal_kcal:num(els.cal_kcal.value), carbs_g:num(els.carbs_g.value), protein_g:num(els.protein_g.value), fat_g:num(els.fat_g.value), fiber_g:num(els.fiber_g.value), sodium_mg:num(els.sodium_mg.value) });
const fillNutr=(n)=>{ els.cal_kcal.value=n.cal_kcal??""; els.carbs_g.value=n.carbs_g??""; els.protein_g.value=n.protein_g??""; els.fat_g.value=n.fat_g??""; els.fiber_g.value=n.fiber_g??""; els.sodium_mg.value=n.sodium_mg??""; };
const nutrLine=(n)=>{ const a=[]; if(n.cal_kcal!=null)a.push(`${n.cal_kcal} kcal`); if(n.carbs_g!=null)a.push(`كربوهيدرات ${n.carbs_g} جم`); if(n.protein_g!=null)a.push(`بروتين ${n.protein_g} جم`); if(n.fat_g!=null)a.push(`دهون ${n.fat_g} جم`); return a.join(" · "); };

/* ===== AI tags بسيطة ===== */
function aiSuggest(n){ const search=new Set(), diets=new Set(); if(n.carbs_g!=null && n.carbs_g<=15) diets.add("lowGi"); if(n.carbs_g!=null && n.carbs_g>=40) search.add("نشويات_عالية"); if(n.fiber_g!=null && n.fiber_g>=4) search.add("غني_بالألياف"); if(n.fat_g!=null && n.fat_g<=3) search.add("قليل_الدهون"); if(n.fat_g!=null && n.fat_g>=17) search.add("دهون_مرتفعة"); if(n.protein_g!=null && n.protein_g>=10) search.add("غني_بالبروتين"); if(n.sodium_mg!=null && n.sodium_mg>=400) search.add("صوديوم_مرتفع"); return { searchTags:Array.from(search).join(" "), dietSystemsAuto:Array.from(diets) }; }
on(els.btnAi,"click",()=>{ const s=aiSuggest(readNutr()); els.searchTags.value=[(els.searchTags.value||"").trim(), s.searchTags].filter(Boolean).join(" ").trim(); renderDietChips([...new Set([...getDietCodes(), ...s.dietSystemsAuto])]); });

/* ===== مصادر البيانات ===== */
const colNew = collection(db,"fooditems");
const colOld = collection(db,"admin","global","foodItems");
const toSearch=(it)=> [it.name||"", it.category||"", it.searchTags||"", (it.tags||[]).join(" "), (it.dietSystems||[]).map(x=>`#${x}`).join(" ")].join(" ").toLowerCase();

function normalize(raw,id){
  const nutr = pickNutr(raw);
  const measures = Array.isArray(raw.measures)?raw.measures
    : (raw.measureQty && typeof raw.measureQty==='object') ? Object.entries(raw.measureQty).map(([n,g])=>({name:n,grams:Number(g)||0})) : [];
  const tags = Array.isArray(raw.tags)?raw.tags : (raw.tags?String(raw.tags).split(" "):[]);
  const diet = new Set([...(raw.dietSystems||[]), ...(raw.dietSystemsAuto||[]), ...(raw.dietSystemsManual||[])]);
  const item = {
    id,
    name: raw.name || raw.title || raw.name_ar || "",
    category: raw.category || "أخرى",
    isActive: raw.isActive!==false,
    imageUrl: raw.imageUrl || raw.photoUrl || "",
    tags, searchTags: raw.searchText || raw.searchTags || "",
    dietSystems: Array.from(diet),
    measures, measureQty:Object.fromEntries(measures.map(m=>[m.name,m.grams])),
    ...nutr
  };
  item.searchText = toSearch(item);
  return item;
}

/* ===== CRUD ===== */
async function saveItem(e){
  e.preventDefault();
  if(!isAdmin){ gate.show("هذه العملية متاحة للأدمن فقط."); return; }

  const nutr=readNutr();
  const payload={
    name:(els.name.value||"").trim(),
    category:els.category.value,
    isActive:!!els.isActive.checked,
    imageUrl:(els.imageUrl.value||"").trim(),
    searchTags:(els.searchTags.value||"").trim(),
    dietSystems:getDietCodes(),
    measures:readMeasures(),
    nutrPer100g:{...nutr},
    cal_kcal:nutr.cal_kcal, carbs_g:nutr.carbs_g, protein_g:nutr.protein_g, fat_g:nutr.fat_g, fiber_g:nutr.fiber_g, sodium_mg:nutr.sodium_mg,
    updatedAt:serverTimestamp(),
  };
  payload.measureQty=Object.fromEntries(payload.measures.map(m=>[m.name,m.grams]));
  payload.searchText=toSearch({...payload});

  const id=els.id.value;
  if(id) await updateDoc(doc(db,"fooditems",id),payload);
  else   await addDoc(colNew,{...payload,createdAt:serverTimestamp()});

  closeDialog(); await fetchAndRender(true);
}
async function delItem(){ if(!isAdmin) return; const id=els.id.value; if(!id) return; if(!confirm("تأكيد حذف الصنف؟")) return; await deleteDoc(doc(db,"fooditems",id)); closeDialog(); await fetchAndRender(true); }

/* ===== استعلام + جلب ===== */
const buildQuery=()=>{ const f=[]; if(els.fActive?.checked) f.push(where("isActive","==",true)); if(els.fCategory?.value) f.push(where("category","==",els.fCategory.value)); if(els.fDiet?.value) f.push(where("dietSystems","array-contains",els.fDiet.value)); return query(colNew, ...f, orderBy("name"), limit(paging.pageSize)); };

async function fetchAndRender(reset=false){
  els.cards.innerHTML=""; els.tableBody.innerHTML="";
  if(reset){ paging.page=1; paging.lastDoc=null; currentQuerySnapshot=null; }

  let q=buildQuery(); if(paging.lastDoc) q=query(q,startAfter(paging.lastDoc));
  const snapNew=await getDocs(q); currentQuerySnapshot=snapNew; paging.lastDoc=snapNew.docs[snapNew.docs.length-1]||null;
  const snapOld=await getDocs(colOld);

  let items=[ ...snapOld.docs.map(d=>normalize(d.data(),d.id)), ...snapNew.docs.map(d=>normalize(d.data(),d.id)) ];
  const qText=(els.search?.value||"").trim().toLowerCase(), only=!!els.fActive?.checked, cat=els.fCategory?.value||"", diet=els.fDiet?.value||"";
  if(only) items=items.filter(i=>i.isActive!==false); if(cat) items=items.filter(i=>i.category===cat); if(diet) items=items.filter(i=>(i.dietSystems||[]).includes(diet)); if(qText) items=items.filter(i=>(i.searchText||toSearch(i)).includes(qText));
  items.sort((a,b)=>(a.name||"").localeCompare(b.name||"","ar"));

  if(els.pageLabel) els.pageLabel.textContent = `صفحة ${paging.page}`;
  if(els.prev) els.prev.disabled = paging.page<=1;
  if(els.next) els.next.disabled = snapNew.size < paging.pageSize;

  renderCards(items); renderTable(items);
  if(!items.length){ const e=document.createElement("div"); e.className="card"; e.style.padding="16px"; e.style.textAlign="center"; e.textContent="لا توجد نتائج مطابقة."; els.cards.appendChild(e); }
}

/* ===== عرض ===== */
function renderCards(items){
  const frag=document.createDocumentFragment();
  items.forEach(it=>{
    const card=document.createElement("div"); card.className="card card-item";
    const th=document.createElement("div"); th.className="thumb"; const img=document.createElement("img"); img.src=it.imageUrl||""; img.alt=it.name||""; th.appendChild(img);
    const name=document.createElement("h3"); name.className="name"; name.textContent=it.name;
    const meta=document.createElement("div"); meta.className="meta"; meta.innerHTML=`<span>${it.category||"-"}</span><span>${it.isActive===false?"⛔":"✅"}</span>`;
    const nutr=document.createElement("div"); nutr.className="muted"; nutr.style.marginTop="6px"; nutr.textContent=nutrLine(it);
    const chips=document.createElement("div"); chips.className="chips"; (it.measures||[]).slice(0,3).forEach(m=>{ const c=document.createElement("span"); c.className="chip"; c.textContent=`${m.name}: ${m.grams}جم`; chips.appendChild(c); });
    const ops=document.createElement("div"); ops.style.display="flex"; ops.style.gap="8px"; const eb=document.createElement("button"); eb.className="btn light"; eb.textContent="تعديل"; eb.onclick=()=>openDialog(it); ops.appendChild(eb);
    card.append(th,name,meta,nutr,chips,ops); frag.appendChild(card);
  });
  els.cards.appendChild(frag);
}
function renderTable(items){
  const frag=document.createDocumentFragment();
  items.forEach(it=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><img src="${it.imageUrl||""}" style="width:60px;height:40px;object-fit:cover;border-radius:8px;border:1px solid #e6ecf5"></td>
      <td>${it.name||""}</td><td>${it.category||"-"}</td><td>${it.isActive===false?"—":"✓"}</td>
      <td>${nutrLine(it)}</td><td>${(it.measures||[]).map(m=>`${m.name}:${m.grams}جم`).join("، ")}</td>
      <td><button class="btn light">تعديل</button></td>`;
    tr.querySelector("button").onclick=()=>openDialog(it);
    frag.appendChild(tr);
  });
  els.tableBody.appendChild(frag);
}

/* ===== dialog ===== */
function openDialog(data){
  if(!isAdmin){ gate.show("هذه الصفحة للمديرين فقط."); return; }
  els.dlgTitle.textContent=data?.id?"تعديل صنف":"إضافة صنف";
  els.id.value=data?.id||""; els.name.value=data?.name||""; els.category.value=data?.category||""; els.isActive.checked=data?.isActive!==false;
  els.searchTags.value = data?.searchTags || (Array.isArray(data?.tags)?data.tags.join(" "):(data?.tags||""));
  renderDietChips(data?.dietSystems||[]);
  renderMeasuresEditor(data||{});
  fillNutr({ cal_kcal:data?.cal_kcal, carbs_g:data?.carbs_g, protein_g:data?.protein_g, fat_g:data?.fat_g, fiber_g:data?.fiber_g, sodium_mg:data?.sodium_mg });
  els.imageUrl.value=data?.imageUrl||""; els.preview.src=els.imageUrl.value||"";
  setupUploader();
  els.btnDelete.hidden=!data?.id;
  els.dlg.showModal();
}
function closeDialog(){ els.dlg.close(); }

/* ===== upload (معاينة + fallback) ===== */
function humanize(e){ const m=e?.message||""; if(m.includes("storage/retry-limit-exceeded")) return "تعذّر الرفع: فشل الاتصال. جرّبي متصفح آخر أو أعيدي المحاولة."; if(m.includes("app-check")) return "App Check يمنع الوصول. تأكدي من المفتاح والدومين."; if(m.includes("storage/unauthorized")) return "لا تملكين صلاحية الرفع."; return "تعذّر الرفع: "+m; }

function setupUploader(){
  // preview فوري
  if(els.imageFile && els.preview){
    els.imageFile.onchange=(ev)=>{ const f=ev.target.files?.[0]; if(f) els.preview.src = URL.createObjectURL(f); };
  }
  if(!els.uploadBtn) return;
  els.uploadBtn.onclick = async ()=>{
    if(!auth.currentUser){ gate.show("سجّلي الدخول أولًا لرفع الصور."); return; }
    if(!isAdmin){ gate.show("الرفع متاح للأدمن فقط."); return; }
    const file=els.imageFile?.files?.[0]; if(!file){ alert("اختاري ملف صورة"); return; }
    const safe=file.name.replace(/[^\w.\-]+/g,"_"); const path=`food-items/${auth.currentUser.uid}/${Date.now()}-${safe}`; const ref=sRef(storage,path);
    try{
      els.progress.value=0;
      await new Promise((res,rej)=>{ const t=uploadBytesResumable(ref,file,{contentType:file.type}); t.on("state_changed",(s)=>{ els.progress.value=Math.round((s.bytesTransferred/s.totalBytes)*100); },rej,res); });
      const url=await getDownloadURL(ref); els.imageUrl.value=url; els.preview.src=url; els.progress.value=100;
    }catch(e1){
      try{ await uploadBytes(ref,file,{contentType:file.type}); const url=await getDownloadURL(ref); els.imageUrl.value=url; els.preview.src=url; els.progress.value=100; }
      catch(e2){ console.error("upload fail",e2); alert(humanize(e2)); }
    }
  };
}

/* ===== listeners ===== */
[["search","input"],["filter-category","input"],["filter-diet","input"]].forEach(([id,ev])=> on($(id),ev,()=>fetchAndRender(true)));
on(els.fActive,"change",()=>fetchAndRender(true));
on(els.btnClear,"click",()=>{ els.search.value=""; els.fCategory.value=""; els.fDiet.value=""; els.fActive.checked=true; fetchAndRender(true); });
on(els.btnAdd,"click",()=>openDialog(null));
on(els.dlgClose,"click",closeDialog);
on(els.form,"submit",saveItem);
on(els.btnDelete,"click",delItem);
on(els.btnCards,"click",()=>{ els.btnCards.classList.add("active"); els.btnTable.classList.remove("active"); els.cards.hidden=false; els.tableWrap.hidden=true; });
on(els.btnTable,"click",()=>{ els.btnTable.classList.add("active"); els.btnCards.classList.remove("active"); els.cards.hidden=true; els.tableWrap.hidden=false; });
on(els.prev,"click",async()=>{ if(paging.page<=1) return; paging.page-=1; await fetchAndRender(true); });
on(els.next,"click",async()=>{ if(!currentQuerySnapshot || currentQuerySnapshot.size<paging.pageSize) return; paging.page+=1; await fetchAndRender(false); });

/* ===== boot ===== */
onAuthStateChanged(auth, async (u)=>{
  user=u||null;
  const {role,data} = await loadProfile(user);
  isAdmin = role==="admin";
  setAdminBadge(user,data,isAdmin?"admin":(role||""));
  if(!user){ gate.show("سجّلي الدخول لمتابعة العمل على صفحة الأصناف."); return; }
  if(!isAdmin){ gate.show("صلاحيات غير كافية. هذه الصفحة للمشرفين فقط."); return; }
  gate.hide(); setupUploader(); await fetchAndRender(true);
});
