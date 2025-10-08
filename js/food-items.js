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
const state = { page:1,lastDoc:null,q:"",category:"",dietSystem:"",sort:"createdAt_desc",cache:new Map(),currentDocs:[],view:"cards" };

// ============ Utils ============
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function resolveImageUrl(path){
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const isGH = location.hostname.endsWith("github.io");
  const base = isGH ? location.origin + "/" + location.pathname.split("/")[1] + "/" : location.origin + "/";
  return base + (path[0]==="/" ? path.slice(1) : path);
}

// .......... [باقي الدوال: الجلب، الرسم، الفلاتر، الاستيراد/التصدير] ..........
// (المحتوى الأصلي كما هو دون حذف، اختصرته هنا لتقليل الطول غير المهم)

// ============ جزء من الرسم (Cards/Table) ============
// renderCards / renderTable يبقيان كما في نسختك الأصلية ويستعملان resolveImageUrl(imageUrl)

// ============ نموذج التعديل/الإضافة ============
// (استماع submit، تجهيز payload، إلخ)
$("#edit-form").addEventListener("submit",async(e)=>{
  e.preventDefault();
  const id=e.currentTarget.dataset.id||null;
  const fd=new FormData(e.currentTarget);
  const payload=Object.fromEntries(fd.entries());
  payload.isActive=$("#edit-form").elements["isActive"].checked;
  if(payload.imageUrl && !/^https?:\/\//.test(payload.imageUrl)){ payload.imageUrl=''; }
  ["cal_kcal","carbs_g","protein_g","fat_g","fiber_g","gi","sodium_mg"].forEach(k=>payload[k]=payload[k]===""?null:Number(payload[k]));
  payload.dietTagsManual=(payload.dietTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  payload.dietSystemsManual=(payload.dietSystemsManual||"").split(",").map(s=>s.trim()).filter(Boolean);
  payload.hashTagsManual=(payload.hashTagsManual||"").split(",").map(s=>s.trim()).filter(Boolean);

  // ... حفظ المستند (إضافة/تحديث) كما في نسختك الأصلية ...
});

// ============ زر رفع الصورة + حفظ تلقائي للرابط ============
function ensureImageControls() {
  const form = document.getElementById('edit-form');
  if (!form) return;

  let urlInput = form.querySelector('input[name="imageUrl"]');
  if (!urlInput) {
    const firstLabel = form.querySelector('.grid label') || form;
    const wrapper = document.createElement('label');
    wrapper.innerHTML = `
      صورة (رابط)
      <div class="img-row">
        <input name="imageUrl" placeholder="https://..." />
        <label class="file-input">
          <input id="image-file" type="file" accept="image/*" />
          <span>تحميل صورة</span>
        </label>
        <img id="image-preview" class="thumb-mini" alt="" />
        <small id="image-status" class="muted"></small>
      </div>`;
    firstLabel.parentElement.insertBefore(wrapper, firstLabel);
    urlInput = wrapper.querySelector('input[name="imageUrl"]');
    if(urlInput){ urlInput.readOnly=true; urlInput.classList.add('visually-hidden'); }
  }

  if (form.elements["imageUrl"]) {
    form.elements["imageUrl"].addEventListener("input",e=>{
      const img=$("#image-preview"); if(img) img.src=resolveImageUrl(e.target.value.trim()||"");
    }, { once:true });
  }

  let row = urlInput.closest('.img-row');
  if(urlInput){ urlInput.readOnly=true; urlInput.classList.add('visually-hidden'); }
  if (!row) {
    row = document.createElement('div');
    row.className = 'img-row';
    urlInput.parentElement.appendChild(row);
    row.appendChild(urlInput);
  }

  let fileInput = row.querySelector('#image-file');
  if (!fileInput) {
    const fileLabel = document.createElement('label');
    fileLabel.className = 'file-input';
    fileLabel.innerHTML = `<input id="image-file" type="file" accept="image/*" /><span>تحميل صورة</span>`;
    row.appendChild(fileLabel);
    fileInput = fileLabel.querySelector('#image-file');
  }

  let preview = row.querySelector('#image-preview');
  if (!preview) {
    preview = document.createElement('img');
    preview.id = 'image-preview';
    preview.className = 'thumb-mini';
    row.appendChild(preview);
  }

  let status = row.querySelector('#image-status');
  if (!status) {
    status = document.createElement('small');
    status.id = 'image-status';
    status.className = 'muted';
    row.appendChild(status);
  }

  if (!urlInput._boundPreview) {
    urlInput.addEventListener('input', e=>{
      const v=(e.target.value||'').trim();
      preview.src = v || '';
    });
    urlInput._boundPreview = true;
  }

  if (!fileInput._boundUpload) {
    fileInput.addEventListener('change', async (e)=>{
      const file = e.target.files?.[0];
      if (!file) return;
      if(!/^image\//.test(file.type)){ alert('الملف المختار ليس صورة'); return; }
      if(file.size > 5*1024*1024){ alert('حجم الصورة كبير، الحد الأقصى 5MB'); return; }

      const uid = auth.currentUser?.uid || 'anon';
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
        urlInput.value = url;
        preview.src    = url;
        status.textContent = '✔️ تم الرفع وحُفِظ الرابط';
        // إن كان الصنف موجودًا (تعديل)، حدّث Firestore فورًا ليظهر في الموقع مباشرة
        try{
          const itemId = form.dataset.id;
          if (itemId) {
            const b = writeBatch(db);
            const dref = doc(collection(db, ...COLL_PATH), itemId);
            b.update(dref, { imageUrl: url, updatedAt: serverTimestamp() });
            await b.commit();
            status.textContent = '✔️ تم الرفع والحفظ في قاعدة البيانات';
          } else {
            status.textContent = '✔️ تم الرفع — سيتم الحفظ عند حفظ النموذج';
          }
        }catch(err){
          console.error(err);
          status.textContent = 'تم الرفع لكن تعذّر الحفظ التلقائي، احفظي النموذج يدويًا';
          alert('تم رفع الصورة، لكن لم يُحدّث المستند تلقائيًا. احفظي النموذج.');
        }
      }catch(err){
        console.error(err);
        alert('تعذّر رفع الصورة. تحققي من الاتصال والصلاحيات.');
        status.textContent = 'فشل الرفع';
      }
    });
    fileInput._boundUpload = true;
  }
}

// ============ Auth ============
onAuthStateChanged(auth, async (user)=>{
  if(!user){
    try{ await signInWithPopup(auth,new GoogleAuthProvider()); }
    catch(e){ console.error(e); alert("يلزم تسجيل الدخول."); return; }
  }
  const name=auth.currentUser?.displayName||auth.currentUser?.email||"مسؤول";
  const el=$("#admin-name"); if(el) el.textContent=name;
  fetchAndRender(true);
});
$("#btn-signout")?.addEventListener("click",()=>signOut(auth));

// ============ Close dialogs ============
$$("dialog [data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());

// تأكد من تجهيز زر الرفع عند فتح نموذج التعديل
document.addEventListener('DOMContentLoaded', ensureImageControls);
