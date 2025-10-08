// ============ Firebase SDK via CDN ============
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy,
  limit, startAfter, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.1/firebase-storage.js";

// --------- Firebase Config ---------
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// ============ Constants / State ============
const COLL_PATH = ["admin","global","foodItems"];
const PAGE_SIZE = 20;
const state = { page:1,lastDoc:null,q:"",category:"",dietSystem:"",onlyActive:true,sortBy:"createdAt_desc",cache:new Map(),currentDocs:[],view:"cards" };

// ============ Utils ============
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function resolveImageUrl(path){
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const isGH = location.hostname.endsWith("github.io");
  const base = isGH ? location.origin + "/" + location.pathname.split("/")[1] + "/" : location.origin + "/";
  return base + path.replace(/^\/+/, "");
}
const toSearchText = (item)=>[
  item.name,item.category,
  ...(item.dietTagsManual||[]),...(item.dietTagsAuto||[]),
  ...(item.dietSystemsManual||[]),...(item.dietSystemsAuto||[]),
  ...(item.hashTags||[])
].filter(Boolean).join(" ").toLowerCase();
const filterByKeyword=(list,kw)=> !kw? list : list.filter(x=>(x.searchText||"").includes(kw.toLowerCase())||(x.name||"").toLowerCase().includes(kw.toLowerCase()));
const setPageInfo=(n)=> $("#page-info").textContent=`صفحة ${state.page} — ${n} عنصر`;
const n=x=>typeof x==='number'&&!isNaN(x);
const autoDietTags=({gi,carbs_g,protein_g,fat_g,fiber_g,cal_kcal})=>{
  const t=new Set(); if(n(gi)){if(gi<55)t.add("منخفض GI"); else if(gi>=70)t.add("مرتفع GI");}
  if(n(carbs_g)&&carbs_g<15)t.add("منخفض الكربوهيدرات");
  if(n(protein_g)&&protein_g>=15)t.add("عالي البروتين");
  if(n(fat_g)&&fat_g<3)t.add("منخفض الدهون");
  if(n(fiber_g)&&fiber_g>=5)t.add("غني بالألياف");
  if(n(cal_kcal)&&cal_kcal<80)t.add("منخفض السعرات");
  if((n(carbs_g)&&carbs_g<15)||(n(gi)&&gi<55))t.add("صديق لمرضى السكري");
  return [...t];
};
const autoDietSystems=({carbs_g,fat_g,gi,protein_g,sodium_mg})=>{
  const t=new Set(); if(n(carbs_g)&&carbs_g<=10&&n(fat_g)&&fat_g>=10)t.add("كيتو");
  if(n(carbs_g)&&carbs_g<15)t.add("قليل الكربوهيدرات");
  if(n(sodium_mg)&&sodium_mg<=120)t.add("قليل الملح");
  if(n(protein_g)&&protein_g>=20&&n(carbs_g)&&carbs_g>=10&&carbs_g<=30)t.add("بعد التمرين");
  if((n(gi)&&gi<55)||(n(carbs_g)&&carbs_g<15))t.add("صديق لمرضى السكري");
  return [...t];
};
const autoHashTags=(item)=>{
  const base=[item.category,item.name, ...(item.dietTagsManual||[]),...(item.dietTagsAuto||[]), ...(item.dietSystemsManual||[]),...(item.dietSystemsAuto||[])]
    .filter(Boolean).join(" ").toLowerCase();
  const words=base.replace(/[^\p{L}\p{N}\s]/gu," ").split(/\s+/).filter(w=>w.length>=3);
  return [...new Set(words)].slice(0,12).map(w=>"#"+w.replace(/^#+/,""));
};
function normalizeLegacyFields(d){
  const m={...d};
  m.cal_kcal=(d.cal_kcal??d.calories??d.kcal??null);
  m.carbs_g=(d.carbs_g??d.carb??d.carbs??null);
  m.protein_g=(d.protein_g??d.protein??null);
  m.fat_g=(d.fat_g??d.fat??null);
  m.fiber_g=(d.fiber_g??d.fiber??null);
  m.gi=(d.gi??d.GI??null);
  m.category=(d.category||"اخرى");
  m.sodium_mg=(d.sodium_mg??d.sodium??null);
  m.dietTagsManual=Array.isArray(d.dietTagsManual)?d.dietTagsManual:(d.dietTagsManual||"").toString().split(",").map(s=>s.trim()).filter(Boolean);
  m.dietSystemsManual=Array.isArray(d.dietSystemsManual)?d.dietSystemsManual:(d.dietSystemsManual||"").toString().split(",").map(s=>s.trim()).filter(Boolean);
  m.hashTagsManual=Array.isArray(d.hashTagsManual)?d.hashTagsManual:(d.hashTagsManual||"").toString().split(",").map(s=>s.trim()).filter(Boolean);
  m.dietTagsAuto=d.dietTagsAuto||autoDietTags(m);
  m.dietSystemsAuto=d.dietSystemsAuto||autoDietSystems(m);
  return m;
}

// ============ Query ============
function buildQuery(){
  const base = collection(db, ...COLL_PATH);
  const qs=[];
  if(state.onlyActive) qs.push(where("isActive","==",true));
  if(state.category)   qs.push(where("category","==",state.category));
  if(state.dietSystem) qs.push(where("dietSystems","array-contains",state.dietSystem));
  if(state.sortBy==="name_asc") qs.push(orderBy("name")); else qs.push(orderBy("createdAt","desc"));
  let q=query(base,...qs,limit(PAGE_SIZE));
  if(state.lastDoc) q=query(base,...qs,startAfter(state.lastDoc),limit(PAGE_SIZE));
  return q;
}

// ============ Render ============
function renderCards(items){
  const host=$("#cards-view"); host.innerHTML="";
  items.forEach(item=>{
    const card=document.createElement("article"); card.className="card";
    const imgSrc=resolveImageUrl(item.imageUrl||"");
    card.innerHTML=`
      <img class="thumb" src="${imgSrc}" alt="" onerror="this.src='';this.style.background='#eef2f7'">
      <div class="name">${item.name||"—"}</div>
      <div class="meta">
        <span>${item.category||"غير مصنّف"}</span>
        <span>سعرات: ${item.cal_kcal ?? "—"}</span>
        <span>كارب: ${item.carbs_g ?? "—"}</span>
        <span>GI: ${item.gi ?? "—"}</span>
        <span>${item.isActive? "نشط" : "غير نشط"}</span>
      </div>
      <div class="chips">
        ${(item.dietTagsAuto||[]).map(t=>`<span class="chip green">${t}</span>`).join("")}
        ${(item.dietSystems||item.dietSystemsAuto||[]).map(t=>`<span class="chip yellow">${t}</span>`).join("")}
        ${(item.dietTagsManual||[]).map(t=>`<span class="chip">${t}</span>`).join("")}
      </div>
      <div class="actions">
        <button class="btn light" data-edit="${item.id}">تعديل</button>
        <button class="btn ${item.isActive? 'danger' : 'primary'}" data-toggle="${item.id}">
          ${item.isActive? 'تعطيل' : 'تفعيل'}
        </button>
      </div>`;
    host.appendChild(card);
  });
  bindRowActions(); setPageInfo(items.length);
}
function renderTable(items){
  const tb=$("#table-body"); tb.innerHTML="";
  items.forEach(item=>{
    const imgSrc=resolveImageUrl(item.imageUrl||"");
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><img class="thumb" src="${imgSrc}" onerror="this.src='';this.style.background='#eef2f7'"/></td>
      <td>${item.name||"—"}</td>
      <td>${item.category||"—"}</td>
      <td>${item.cal_kcal ?? "—"}</td>
      <td>${item.carbs_g ?? "—"}</td>
      <td>${item.protein_g ?? "—"}</td>
      <td>${item.fat_g ?? "—"}</td>
      <td>${item.fiber_g ?? "—"}</td>
      <td>${item.gi ?? "—"}</td>
      <td>${item.isActive? "✅" : "❌"}</td>
      <td>
        <button class="btn light" data-edit="${item.id}">تعديل</button>
        <button class="btn ${item.isActive? 'danger' : 'primary'}" data-toggle="${item.id}">
          ${item.isActive? 'تعطيل' : 'تفعيل'}
        </button>
      </td>`;
    tb.appendChild(tr);
  });
  bindRowActions(); setPageInfo(items.length);
}
function bindRowActions(){
  $$("[data-edit]").forEach(b=>b.onclick=()=>openEditDialog(b.dataset.edit));
  $$("[data-toggle]").forEach(b=>b.onclick=()=>quickToggle(b.dataset.toggle));
}

// ============ Fetch ============
async function fetchAndRender(reset=false){
  if(reset){state.page=1;state.lastDoc=null;}
  try{
    const snap=await getDocs(buildQuery());
    const docs=snap.docs.map(d=>({id:d.id,...d.data()}));
    state.currentDocs=docs; docs.forEach(d=>{d.searchText=d.searchText||toSearchText(d); state.cache.set(d.id,d);});
    const filtered=filterByKeyword(docs,state.q);
    state.view==="table"?renderTable(filtered):renderCards(filtered);
    state.lastDoc=snap.docs[snap.docs.length-1]||null;
  }catch(e){
    if(e?.code==="failed-precondition" && e?.message?.includes("index")) alert("الاستعلام محتاج فهرس. أنشئيه ثم أعيدي التحميل.");
    else { console.error(e); alert("تعذّر جلب البيانات."); }
  }
}

// ============ Filters ============
$("#q").addEventListener("input",debounce(e=>{state.q=e.target.value.trim();fetchAndRender(true);},300));
$("#category").addEventListener("input",e=>{state.category=(e.target.value||"").trim();fetchAndRender(true);});
$("#onlyActive").addEventListener("change",e=>{state.onlyActive=e.target.checked;fetchAndRender(true);});
$("#sortBy").addEventListener("change",e=>{state.sortBy=e.target.value;fetchAndRender(true);});
$("#dietSystem").addEventListener("change",e=>{state.dietSystem=e.target.value;fetchAndRender(true);});
$("#next-page").onclick=async()=>{if(!state.lastDoc)return;state.page++;await fetchAndRender(false);};
$("#prev-page").onclick=async()=>{if(state.page===1)return;state.page--;state.lastDoc=null;for(let i=1;i<state.page;i++)await getDocs(buildQuery());await fetchAndRender(false);};
$("#tab-cards").onclick=()=>{state.view="cards";$("#tab-cards").classList.add("active");$("#tab-table").classList.remove("active");$("#cards-view").classList.remove("hidden");$("#table-view").classList.add("hidden");};
$("#tab-table").onclick=()=>{state.view="table";$("#tab-table").classList.add("active");$("#tab-cards").classList.remove("active");$("#table-view").classList.remove("hidden");$("#cards-view").classList.add("hidden");};

// ============ Add / Edit ============
$("#btn-add").onclick=()=>openEditDialog(null);

async function openEditDialog(id){
  const dlg=$("#edit-dialog"), form=$("#edit-form");
  $("#btn-delete").classList.toggle("hidden",!id);
  $("#edit-title").textContent=id?"تعديل صنف":"إضافة صنف";
  form.reset(); form.dataset.id=id||"";
  let data={}; if(id){ data=state.cache.get(id) || (await getDoc(doc(db,...COLL_PATH,id))).data() || {}; }
  data=normalizeLegacyFields(data);

  form.elements["name"].value=data.name||"";
  form.elements["category"].value=data.category||"اخرى";
  form.elements["imageUrl"].value=data.imageUrl||"";
  form.elements["isActive"].checked=(data.isActive!==false);
  form.elements["cal_kcal"].value=data.cal_kcal??"";
  form.elements["carbs_g"].value=data.carbs_g??"";
  form.elements["protein_g"].value=data.protein_g??"";
  form.elements["fat_g"].value=data.fat_g??"";
  form.elements["fiber_g"].value=data.fiber_g??"";
  form.elements["gi"].value=data.gi??"";
  form.elements["sodium_mg"].value=data.sodium_mg??"";
  form.elements["dietTagsManual"].value=(data.dietTagsManual||[]).join(", ");
  form.elements["dietSystemsManual"].value=(data.dietSystemsManual||[]).join(", ");
  form.elements["hashTagsManual"].value=(data.hashTagsManual||[]).join(", ");

  $("#image-preview").src=resolveImageUrl(data.imageUrl||"");
  form.elements["imageUrl"].addEventListener("input",e=>{
    $("#image-preview").src=resolveImageUrl(e.target.value.trim()||"");
  });

  renderAutoTagsPreview(); dlg.showModal();
}

["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg","category","name","dietTagsManual","dietSystemsManual"]
  .forEach(n=>{$("#edit-form").elements[n]?.addEventListener("input",renderAutoTagsPreview);});

function toggleManualChip(form,inputName,value){
  const inp=form.elements[inputName];
  const list=(inp.value||"").split(",").map(s=>s.trim()).filter(Boolean);
  const i=list.indexOf(value); if(i>=0)list.splice(i,1); else list.push(value);
  inp.value=list.join(", "); }

function renderAutoTagsPreview(){
  const form=$("#edit-form");
  const fd=new FormData(form);
  const payload=Object.fromEntries(fd.entries());
  ["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg"].forEach(k=>payload[k]=payload[k]===""?null:Number(payload[k]));
  const dietTags=autoDietTags(payload), dietSystems=autoDietSystems(payload);
  const auto=$("#auto-tags"); auto.innerHTML="";
  dietTags.forEach(t=>{const s=document.createElement("span");s.className="chip green auto";s.textContent=t;s.onclick=()=>{toggleManualChip(form,"dietTagsManual",t);renderAutoTagsPreview();};auto.appendChild(s);});
  const diets=$("#auto-diets"); diets.innerHTML="";
  dietSystems.forEach(t=>{const s=document.createElement("span");s.className="chip yellow auto";s.textContent=t;s.onclick=()=>{toggleManualChip(form,"dietSystemsManual",t);renderAutoTagsPreview();};diets.appendChild(s);});
}

$("#edit-form").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const id=e.currentTarget.dataset.id||null;
  const fd=new FormData(e.currentTarget);
  const payload=Object.fromEntries(fd.entries());
  payload.isActive=$("#edit-form").elements["isActive"].checked;
  ["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg"].forEach(k=>payload[k]=payload[k]===""?null:Number(payload[k]));
  payload.dietTagsManual=(payload.dietTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  payload.dietSystemsManual=(payload.dietSystemsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  payload.hashTagsManual=(payload.hashTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);

  payload.dietTagsAuto=autoDietTags(payload);
  payload.dietSystemsAuto=autoDietSystems(payload);
  payload.dietSystems=[...new Set([...(payload.dietSystemsManual||[]),...(payload.dietSystemsAuto||[])])];
  const hashAuto=autoHashTags(payload), hashManual=payload.hashTagsManual||[];
  payload.hashTagsAuto=hashAuto; payload.hashTags=[...new Set([...hashManual,...hashAuto])];
  payload.searchText=toSearchText(payload);

  const now=serverTimestamp();
  const ref=id?doc(db,...COLL_PATH,id):doc(collection(db,...COLL_PATH));
  const batch=writeBatch(db);
  batch.set(ref,{...payload,createdAt:id?(state.cache.get(id)?.createdAt||now):now,updatedAt:now},{merge:true});
  await batch.commit(); $("#edit-dialog").close(); await fetchAndRender(true);
});

$("#btn-delete").onclick=async()=>{
  const id=$("#edit-form").dataset.id; if(!id) return;
  const batch=writeBatch(db);
  batch.set(doc(db,...COLL_PATH,id),{isActive:false,updatedAt:serverTimestamp()},{merge:true});
  await batch.commit(); $("#edit-dialog").close(); await fetchAndRender(true);
};

// ============ Image Upload (Storage) ============
const imageUrlInput = document.querySelector('#edit-form input[name="imageUrl"]');
imageUrlInput?.addEventListener('input', e=>{
  const v=(e.target.value||'').trim();
  const img=document.getElementById('image-preview');
  if(img) img.src=v||'';
});

const imageFileInput = document.getElementById('image-file');
if (imageFileInput){
  imageFileInput.addEventListener('change', async (e)=>{
    const file = e.target.files?.[0];
    if (!file) return;
    const form   = document.getElementById('edit-form');
    const status = document.getElementById('image-status');
    const uid    = auth.currentUser?.uid || 'anon';
    const path = `food-items/${uid}/${Date.now()}-${file.name}`;
    const ref  = sRef(storage, path);
    try{
      status.textContent = 'جارِ الرفع...';
      const task = uploadBytesResumable(ref, file);
      task.on('state_changed', (snap)=>{
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        status.textContent = `جارِ الرفع… ${pct}%`;
      });
      await task;
      const url = await getDownloadURL(ref);
      form.elements['imageUrl'].value = url;
      document.getElementById('image-preview').src = url;
      status.textContent = '✔️ تم الرفع وحُفِظ الرابط';
    }catch(err){
      console.error(err);
      status.textContent = '❌ تعذّر الرفع — تحقّقي من القواعد وتسجيل الدخول';
      alert('تعذّر رفع الصورة. تحقّقي من قواعد Storage وتسجيل الدخول.');
    }
  });
}

// ============ Auth ============
onAuthStateChanged(auth, async (user)=>{
  if(!user){ try{ await signInWithPopup(auth,new GoogleAuthProvider()); }catch(e){console.error(e); alert("يلزم تسجيل الدخول."); return; } }
  const name=auth.currentUser?.displayName||auth.currentUser?.email||"مسؤول";
  const el=$("#admin-name"); if(el) el.textContent=name;
  fetchAndRender(true);
});
$("#btn-signout")?.addEventListener("click",()=>signOut(auth));

// ============ Close dialogs ============
$$("dialog [data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
