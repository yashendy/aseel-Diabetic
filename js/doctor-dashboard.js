// js/doctor-dashboard.js
import { db, auth } from "./firebase-config.js";
import {
  collection, query, where, orderBy, limit, getDocs,
  setDoc, doc, getDoc, serverTimestamp,
  collectionGroup
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

/* عناصر */
const doctorNameEl   = document.getElementById("doctorName");
const btnRefresh     = document.getElementById("btnRefresh");

const btnCreateCode  = document.getElementById("btnCreateCode");
const btnReloadCodes = document.getElementById("btnReloadCodes");
const codesList      = document.getElementById("codesList");

const childSearch    = document.getElementById("childSearch");
const childrenCount  = document.getElementById("childrenCount");
const childrenTbody  = document.getElementById("childrenTbody");

/* حالة */
let currentDoctor = { uid: null, name: "" };
let linkCodes = [];
let childrenRows = [];
let filterText = "";

/* أدوات */
const escapeHtml = (s)=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const ageFrom = (iso)=> {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  const today = new Date();
  let years = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) years--;
  return `${years} س`;
};
function copy(text){
  navigator.clipboard?.writeText(text).catch(()=>{
    const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove();
  });
}

/* ملاحظة: تقدري تغيّري الصفحات دي لاحقًا بدون ما تغيّري أي شيء آخر */
function urlMeasurements(parentId, childId){
  return `child-measurements.html?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`;
}
function urlLabs(parentId, childId){
  return `child-labs.html?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`;
}

/* بداية */
onAuthStateChanged(auth, async (user)=>{
  if (!user) {
    document.body.innerHTML = `
      <div style="max-width:720px;margin:40px auto;padding:24px;border:1px solid #e6ecf7;border-radius:16px;background:#fff">
        <h2>تسجيل الدخول مطلوب</h2>
        <p>يرجى تسجيل الدخول بحساب الطبيب للوصول إلى هذه الصفحة.</p>
      </div>`;
    return;
  }
  currentDoctor.uid = user.uid;

  // اسم الدكتور من users/{uid}
  try {
    const us = await getDoc(doc(db, "users", user.uid));
    currentDoctor.name = (us.exists() && (us.data().displayName || us.data().name)) || user.email || "—";
  } catch {
    currentDoctor.name = user.email || "—";
  }
  doctorNameEl.textContent = currentDoctor.name;

  await Promise.all([loadCodes(), loadChildren()]);
});

/* ===== أكواد الربط ===== */
function genCode(n=6){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s=""; for(let i=0;i<n;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}

async function loadCodes(){
  try{
    const qCodes = query(
      collection(db, "linkCodes"),
      where("doctorId","==", currentDoctor.uid),
      orderBy("createdAt","desc"),
      limit(20)
    );
    const snap = await getDocs(qCodes);
    linkCodes = snap.docs.map(s=>({ id:s.id, ...s.data() }));
  }catch(e){
    console.warn("codes fetch:", e?.message||e);
    linkCodes = [];
  }
  renderCodes();
}

function renderCodes(){
  if (!linkCodes.length) {
    codesList.innerHTML = `<div class="empty">لا توجد أكواد بعد.</div>`;
    return;
  }
  codesList.innerHTML = linkCodes.map(c=>`
    <div class="row" data-id="${c.id}">
      <div class="meta">
        <strong class="mono">${escapeHtml(c.id)}</strong>
        <span class="muted">Used: ${c.used ? "✅" : "❌"}</span>
        ${c.parentId ? `<span class="muted">by: ${escapeHtml(c.parentId)}</span>` : ""}
      </div>
      <div class="actions">
        <button class="btn secondary btn-copy" data-id="${c.id}">نسخ</button>
      </div>
    </div>
  `).join("");
}

btnCreateCode?.addEventListener("click", async ()=>{
  if (!currentDoctor.uid) return;
  const id = genCode();
  try{
    await setDoc(doc(db,"linkCodes", id), {
      doctorId: currentDoctor.uid,
      used: false,
      parentId: null,
      childId: null,
      createdAt: serverTimestamp()
    });
    await loadCodes();
    copy(id);
    alert(`تم إنشاء الكود ونسخه: ${id}`);
  }catch(e){
    console.error(e);
    alert("تعذّر إنشاء الكود.");
  }
});

codesList?.addEventListener("click",(e)=>{
  const t=e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.classList.contains("btn-copy")) {
    copy(t.dataset.id);
  }
});
btnReloadCodes?.addEventListener("click", loadCodes);

/* ===== الأطفال المرتبطين بالطبيب ===== */
async function loadChildren(){
  childrenTbody.innerHTML = `<tr><td class="empty" colspan="6">جارِ التحميل…</td></tr>`;
  let rows = [];
  try{
    // الاستعلام المُفضّل (قد يطلب Index مركّب)
    const q1 = query(
      collectionGroup(db, "children"),
      where("assignedDoctor","==", currentDoctor.uid),
      where("sharingConsent.doctor","==", true)
    );
    const snap = await getDocs(q1);
    rows = snap.docs.map(mapChildDoc);
  }catch(e){
    // Fallback: assignedDoctor فقط ثم فلترة مشاركة محليًا
    try{
      const q2 = query(
        collectionGroup(db, "children"),
        where("assignedDoctor","==", currentDoctor.uid)
      );
      const snap2 = await getDocs(q2);
      rows = snap2.docs.map(mapChildDoc).filter(r => r.sharingOk);
    }catch(err){
      console.error(err);
      rows = [];
    }
  }
  childrenRows = rows;
  renderChildren();
}

function mapChildDoc(d){
  const path = d.ref.path;                 // parents/{parentId}/children/{childId}
  const parts = path.split("/");
  const parentId = parts[1];
  const childId  = parts[3];
  const v = d.data() || {};
  const consent = (v.sharingConsent === true) ||
                  (typeof v.sharingConsent === "object" && v.sharingConsent?.doctor === true);
  return {
    parentId, childId,
    name: v.name || "—",
    gender: v.gender || "—",
    birthDate: v.birthDate || "",
    age: ageFrom(v.birthDate),
    glucoseUnit: v.glucoseUnit || "—",
    sharingOk: consent
  };
}

function renderChildren(){
  const q = (filterText||"").trim().toLowerCase();
  const list = childrenRows.filter(r => !q || (r.name||"").toLowerCase().includes(q));

  childrenCount.textContent = String(list.length);

  if (!list.length){
    childrenTbody.innerHTML = `<tr><td class="empty" colspan="6">لا توجد نتائج.</td></tr>`;
    return;
  }

  childrenTbody.innerHTML = list.map(r=>`
    <tr data-parent="${r.parentId}" data-child="${r.childId}">
      <td><strong>${escapeHtml(r.name)}</strong></td>
      <td class="muted">${escapeHtml(r.gender)}</td>
      <td class="muted">${escapeHtml(r.birthDate || "—")}</td>
      <td class="muted">${escapeHtml(r.age)}</td>
      <td class="muted">${escapeHtml(r.glucoseUnit)}</td>
      <td>
        <div class="inline">
          <a class="btn small" href="${urlMeasurements(r.parentId, r.childId)}">ملف القياسات</a>
          <a class="btn small secondary" href="${urlLabs(r.parentId, r.childId)}">التحاليل</a>
        </div>
      </td>
    </tr>
  `).join("");
}

childSearch?.addEventListener("input",(e)=>{
  filterText = e.currentTarget.value || "";
  renderChildren();
});

btnRefresh?.addEventListener("click", async ()=>{
  await Promise.all([loadCodes(), loadChildren()]);
});
