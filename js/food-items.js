/* js/food-items.js */
import { auth, db, storage } from "./firebase-config.js";
import { collection, getDocs, doc, getDoc, setDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { ref as sRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const $ = (id)=> document.getElementById(id);
const els = {
  adminName: $("admin-name"), adminRole: $("admin-role"),
  btnAuth: $("btn-auth"), btnLogout: $("btn-logout"),
  cards: $("cards"), tableWrap: $("table-wrap"), tableBody: $("table-body"),
  btnCards: $("btn-cards"), btnTable: $("btn-table"), btnAdd: $("btn-add"),
  dlg: $("edit-dialog"), dlgClose: $("dlg-close"), dlgTitle: $("dlg-title"),
  form: $("edit-form"),
  id: $("item-id"), name: $("name"), category: $("category"),
  cal_kcal: $("cal_kcal"), carbs_g: $("carbs_g"), protein_g: $("protein_g"), fat_g: $("fat_g"),
  isActive: $("isActive"), searchTags: $("searchTags"),
  imageUrl: $("imageUrl"), imageFile: $("imageFile"), imagePreview: $("imagePreview"),
};
let foodCache = [];

function mapCategoryArabic(c){
  c=(c||'').trim();
  const map=[[['النشويات','حبوب','خبز','معكرونة','مأكولات'],'النشويات'],[['منتجات الألبان','ألبان','حليب','جبن','أجبان'],'منتجات الألبان'],[['الفاكهة','فاكهة'],'الفاكهة'],[['الخضروات','خضروات','خضار'],'الخضروات'],[['منتجات اللحوم','لحوم','دواجن','أسماك','مأكولات بحرية'],'منتجات اللحوم'],[['الدهون','دهون','زيوت'],'الدهون'],[['الحلويات','حلويات','مسليات'],'الحلويات']];
  for(const [arr,val] of map){ if(arr.includes(c)) return val; } return 'أخرى';
}
function mapFood(s){const d=s.data()||{};const per100={cal_kcal:Number(d.cal_kcal??d.kcal??0),carbs_g:Number(d.carbs_g??d.carbs??0),protein_g:Number(d.protein_g??d.protein??0),fat_g:Number(d.fat_g??d.fat??0)};return{id:s.id,name:d.name||'صنف',category:mapCategoryArabic(d.category||'أخرى'),per100,isActive:(d.isActive!==false),imageUrl:d.imageUrl||'',searchText:(d.searchText||'')+''};}

async function ensureFoodCache(){
  if(foodCache.length) return;
  const arr=[];
  try{ (await getDocs(collection(db,'admin','global','foodItems'))).forEach(s=>arr.push(mapFood(s))); }catch(e){ console.warn('global read',e?.message||e); }
  try{ (await getDocs(collection(db,'fooditems'))).forEach(s=>arr.push(mapFood(s))); }catch(e){ console.warn('fooditems read',e?.message||e); }
  const seen=new Map(); for(const f of arr){ seen.set(f.name.toLowerCase(), f); }
  foodCache=Array.from(seen.values()).sort((a,b)=>a.name.localeCompare(b.name,'ar',{numeric:true}));
}

function render(){
  const list=foodCache;
  els.cards.innerHTML=list.map(f=>`<div class="card-item"><div class="name">${f.name}</div><div class="meta">${f.category} • ${f.per100.cal_kcal} kcal</div>${f.imageUrl?`<img src="${f.imageUrl}" alt="" style="width:100%;border-radius:12px;border:1px solid #e8eef5;margin-top:8px">`:''}<div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-edit="${f.id}">تعديل</button></div></div>`).join('');
  els.tableBody.innerHTML=list.map(f=>`<tr><td>${f.name}</td><td>${f.category}</td><td>${f.per100.cal_kcal}</td><td>${f.per100.carbs_g}</td><td>${f.per100.protein_g}</td><td>${f.per100.fat_g}</td><td>${f.isActive?'✓':'✗'}</td><td><button class="btn" data-edit="${f.id}">تعديل</button></td></tr>`).join('');
  document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openEdit(b.getAttribute('data-edit'))));
}

function openEdit(id){
  const f=foodCache.find(x=>x.id===id);
  els.dlgTitle.textContent=f?'تعديل صنف':'إضافة صنف';
  els.id.value=f?.id||''; els.name.value=f?.name||''; els.category.value=f?.category||'';
  els.cal_kcal.value=f?.per100.cal_kcal??''; els.carbs_g.value=f?.per100.carbs_g??''; els.protein_g.value=f?.per100.protein_g??''; els.fat_g.value=f?.per100.fat_g??'';
  els.isActive.value=f?.isActive?'true':'false'; els.imageUrl.value=f?.imageUrl||''; els.imagePreview.src=f?.imageUrl||'';
  els.dlg.showModal();
}

async function saveItem(){
  const id=els.id.value.trim();
  const payload={ name:els.name.value.trim(), category:mapCategoryArabic(els.category.value), cal_kcal:Number(els.cal_kcal.value||0), carbs_g:Number(els.carbs_g.value||0), protein_g:Number(els.protein_g.value||0), fat_g:Number(els.fat_g.value||0), isActive:els.isActive.value==='true', imageUrl:els.imageUrl.value.trim(), searchText:(els.name.value+' '+els.category.value).toLowerCase() };
  try{
    if(id){ await setDoc(doc(db,'fooditems',id),{...payload,updatedAt:serverTimestamp()},{merge:true}); }
    else{ await addDoc(collection(db,'fooditems'),{...payload,createdAt:serverTimestamp()}); }
    foodCache=[]; await ensureFoodCache(); render(); els.dlg.close();
  }catch(e){ alert('تعذر الحفظ: '+(e?.message||e)); }finally{}
}
function bindUI(){
  $('btn-save').addEventListener('click',e=>{e.preventDefault();saveItem();});
  $('btn-delete').addEventListener('click',e=>{e.preventDefault();alert('الحذف ممكن إضافته لاحقًا');});
  els.dlgClose.addEventListener('click',()=>els.dlg.close());
  els.btnAdd.addEventListener('click',()=>openEdit(''));
  els.btnCards.addEventListener('click',()=>{els.btnCards.classList.add('active');els.btnTable.classList.remove('active');els.cards.style.display='grid';els.tableWrap.style.display='none';});
  els.btnTable.addEventListener('click',()=>{els.btnTable.classList.add('active');els.btnCards.classList.remove('active');els.cards.style.display='none';els.tableWrap.style.display='block';});
  els.imageFile.addEventListener('change',async e=>{const file=e.target.files?.[0]; if(!file) return; const ref=sRef(storage,`food-items/${Date.now()}_${file.name}`); const task=uploadBytesResumable(ref,file); task.on('state_changed',()=>{}, err=>alert('رفع الصورة فشل: '+(err?.message||err)), async()=>{ const url=await getDownloadURL(task.snapshot.ref); els.imageUrl.value=url; els.imagePreview.src=url; });});
}
function authInit(){
  onAuthStateChanged(auth,async user=>{
    if(!user){ els.adminName.textContent=''; els.adminRole.textContent=''; els.btnAuth.style.display='inline-block'; els.btnLogout.style.display='none'; return; }
    els.btnAuth.style.display='none'; els.btnLogout.style.display='inline-block'; els.adminName.textContent=user.displayName||user.email||'مشرف';
    try{ const u=await getDoc(doc(db,'users',user.uid)); els.adminRole.textContent=u.exists()?(u.data().role||''):''; }catch{}
  });
  $('btn-auth').addEventListener('click',async()=>{ try{ await signInWithPopup(auth,new GoogleAuthProvider()); }catch(e){ alert('فشل تسجيل الدخول: '+(e?.message||e)); }});
  $('btn-logout').addEventListener('click',async()=>{ try{ await signOut(auth); }catch(e){ alert('فشل تسجيل الخروج: '+(e?.message||e)); }});
}
(async function(){ authInit(); bindUI(); await ensureFoodCache(); render(); })();
