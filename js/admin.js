import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, updateDoc, getDoc, setDoc, addDoc, deleteDoc,
  serverTimestamp, orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);

/* ================= Tabs ================= */
document.querySelectorAll('.tab').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $('tab-pending').style.display = b.dataset.tab==='pending' ? 'block':'none';
    $('tab-assign').style.display  = b.dataset.tab==='assign'  ? 'block':'none';
    $('tab-foods').style.display   = b.dataset.tab==='foods'   ? 'block':'none';
  });
});

/* ================= Auth Guard (Admin only) ================= */
onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  const s = await getDoc(doc(db,'users',user.uid));
  const role = s.exists()? (s.data().role || 'parent') : 'parent';
  if(role !== 'admin'){
    if(role==='doctor') location.href='doctor-dashboard.html';
    else if(role==='doctor-pending') location.href='pending.html';
    else location.href='parent-dashboard.html';
    return;
  }
  await loadPending();
  await loadAssignSelectors();
  await foods.load(); // الأصناف
});

/* =============== تبويب: طلبات الدكاترة =============== */
async function loadPending(){
  const snap = await getDocs(query(collection(db,'users'), where('role','==','doctor-pending')));
  const list=[]; snap.forEach(s=> list.push({id:s.id, ...s.data()}));
  const cont = $('pendingList'); cont.innerHTML='';
  if(!list.length){ $('pendingEmpty').style.display='block'; return; }
  $('pendingEmpty').style.display='none';

  list.forEach(u=>{
    const div = document.createElement('div');
    div.className='meal-card';
    div.innerHTML = `
      <div class="type">👨‍⚕️ ${u.displayName||'-'}</div>
      <div class="muted">${u.email||''} ${u.specialty?('• '+u.specialty):''} ${u.clinic?('• '+u.clinic):''}</div>
      <div class="actions">
        <button class="approve">✅ موافقة</button>
        <button class="reject secondary">رفض ⇢ Parent</button>
      </div>
    `;
    div.querySelector('.approve').onclick = ()=> approveDoctor(u.id);
    div.querySelector('.reject').onclick  = ()=> rejectDoctor(u.id);
    cont.appendChild(div);
  });
}
async function approveDoctor(uid){
  await updateDoc(doc(db,'users',uid), { role:'doctor' });
  await loadPending();
}
async function rejectDoctor(uid){
  await updateDoc(doc(db,'users',uid), { role:'parent' });
  await loadPending();
}

/* =============== تبويب: الربط + توليد كود =============== */
async function loadAssignSelectors(){
  // parents
  const parentsSnap = await getDocs(collection(db,'parents'));
  const parents=[]; parentsSnap.forEach(s=> parents.push({id:s.id,...s.data()}));
  $('parentSel').innerHTML = parents.map(p=> `<option value="${p.id}">${p.displayName||p.name||p.id}</option>`).join('');

  // doctors
  const docSnap = await getDocs(query(collection(db,'users'), where('role','==','doctor')));
  const doctors=[]; docSnap.forEach(s=> doctors.push({id:s.id,...s.data()}));
  $('doctorSel').innerHTML = doctors.map(d=> `<option value="${d.id}">${d.displayName||d.email||d.id}</option>`).join('');

  // children (لأول ولي أمر)
  $('parentSel').addEventListener('change', fillChildren);
  await fillChildren();
}
async function fillChildren(){
  const pid = $('parentSel').value;
  const snap = await getDocs(collection(db,`parents/${pid}/children`));
  const kids=[]; snap.forEach(s=> kids.push({id:s.id,...s.data()}));
  $('childSel').innerHTML = kids.map(k=> `<option value="${k.id}">${k.name||k.id}</option>`).join('');
}

$('assignBtn')?.addEventListener('click', async ()=>{
  const pid = $('parentSel').value;
  const cid = $('childSel').value;
  const did = $('doctorSel').value;
  const cref = doc(db, `parents/${pid}/children/${cid}`);
  await updateDoc(cref, {
    assignedDoctor: did,
    assignedDoctorInfo: { uid: did },
    sharingConsent: { doctor: true, since: new Date().toISOString() }
  });
  alert('تم الربط بنجاح ✅');
});

/* ---- توليد كود للدكتور ومشاركته ---- */
function genCode(len=6){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c=''; for(let i=0;i<len;i++) c+=chars[Math.floor(Math.random()*chars.length)];
  return c;
}
async function createDoctorCode(doctorUid){
  // docId = الكود نفسه: جرّبي لحد ما تجيبي كود فريد
  let code, snap;
  do {
    code = genCode(6);
    snap = await getDoc(doc(db,'doctorCodes', code));
  } while (snap.exists());

  await setDoc(doc(db,'doctorCodes', code), {
    doctorUid, active:true, createdAt: serverTimestamp()
  });
  await updateDoc(doc(db,'users', doctorUid), { doctorCode: code });
  return code;
}
$('genCodeBtn')?.addEventListener('click', async ()=>{
  const did = $('doctorSel').value; if(!did){ alert('اختاري دكتور'); return; }
  const code = await createDoctorCode(did);
  $('theCode').textContent = code;
  $('codeBox').style.display = 'block';

  const parentURL = location.origin + location.pathname.replace(/\/[^\/]*$/,'/') + `parent-dashboard.html?doctorCode=${code}`;
  $('copyCodeBtn').onclick = async ()=>{ await navigator.clipboard.writeText(code); alert('تم نسخ الكود'); };
  const txt = encodeURIComponent(`كود ربط الدكتور: ${code}\nالرابط المباشر: ${parentURL}`);
  $('waLink').href   = `https://wa.me/?text=${txt}`;
  $('mailLink').href = `mailto:?subject=${encodeURIComponent('كود ربط الدكتور')}&body=${txt}`;
  $('qrImg').src     = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(parentURL)}`;
});

/* =============== تبويب: الأصناف (CRUD + CSV) =============== */
const foods = {
  all: [],

  colRef(){ return collection(db,'admin','global','foodItems'); },

  async load(){
    const snap = await getDocs(query(this.colRef(), orderBy('name')));
    this.all = [];
    snap.forEach(d=> this.all.push({id:d.id, ...d.data()}));
    this.render();
  },

  filterList(qtxt){
    const t = (qtxt||'').toLowerCase().trim();
    if(!t) return this.all;
    return this.all.filter(f =>
      (f.name||'').toLowerCase().includes(t) ||
      (f.category||'').toLowerCase().includes(t) ||
      (f.brand||'').toLowerCase().includes(t) ||
      (Array.isArray(f.tags) ? f.tags.join(',') : '').toLowerCase().includes(t)
    );
  },

  render(list = this.all){
    const cont = $('foodList');
    const items = this.filterList($('foodSearch')?.value);
    cont.innerHTML = '';
    if(!items.length){ $('foodsEmpty').style.display='block'; return; }
    $('foodsEmpty').style.display='none';

    for(const f of items){
      const row = document.createElement('div');
      row.className = 'food-row';
      row.innerHTML = `
        <div><strong>${esc(f.name)}</strong> <span class="muted">${esc(f.brand||'')}</span></div>
        <div>${esc(f.category||'-')}</div>
        <div>${esc(f.unit||'g')}</div>
        <div>${num(f.carbsPer100) ?? '-'}</div>
        <div>
          <button class="secondary edit">تعديل</button>
          <button class="danger del" style="background:#fee2e2;border:1px solid #fecaca">حذف</button>
        </div>
      `;
      row.querySelector('.edit').onclick = ()=> this.openDialog(f);
      row.querySelector('.del').onclick  = ()=> this.remove(f.id, f.name);
      cont.appendChild(row);
    }
  },

  openDialog(f=null){
    $('foodId').value   = f?.id || '';
    $('foodName').value = f?.name || '';
    $('foodCat').value  = f?.category || '';
    $('foodUnit').value = f?.unit || 'g';
    $('foodBrand').value= f?.brand || '';
    $('carb100').value  = f?.carbsPer100 ?? '';
    $('kcal100').value  = f?.kcalPer100 ?? '';
    $('prot100').value  = f?.proteinPer100 ?? '';
    $('fat100').value   = f?.fatPer100 ?? '';
    $('fiber100').value = f?.fiberPer100 ?? '';
    $('foodTags').value = Array.isArray(f?.tags) ? f.tags.join(', ') : '';
    $('imageUrl').value = f?.imageUrl || '';
    $('foodNotes').value= f?.notes || '';

    $('foodDlg').showModal();
  },

  async saveFromDialog(){
    const id    = $('foodId').value.trim();
    const data = {
      name: $('foodName').value.trim(),
      category: $('foodCat').value.trim() || null,
      unit: $('foodUnit').value || 'g',
      brand: $('foodBrand').value.trim() || null,
      carbsPer100: num($('carb100').value),
      kcalPer100:  num($('kcal100').value),
      proteinPer100: num($('prot100').value),
      fatPer100:   num($('fat100').value),
      fiberPer100: num($('fiber100').value),
      tags: parseTags($('foodTags').value),
      imageUrl: $('imageUrl').value.trim() || null,
      notes: $('foodNotes').value.trim() || null,
      updatedAt: serverTimestamp()
    };
    if(!data.name){ alert('الاسم مطلوب'); return; }

    if (id){
      await setDoc(doc(this.colRef(), id), data, { merge:true });
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(this.colRef(), data);
    }
    $('foodDlg').close();
    await this.load();
  },

  async remove(id, name){
    if(!confirm(`حذف الصنف "${name||id}"؟`)) return;
    await deleteDoc(doc(this.colRef(), id));
    await this.load();
  },

  async importCSV(file){
    const text = await file.text();
    const rows = parseCSV(text);
    if(!rows.length){ alert('ملف CSV فارغ'); return; }

    // توقع رؤوس أعمدة مثل: name,category,unit,carbsPer100,kcalPer100,proteinPer100,fatPer100,fiberPer100,brand,tags,imageUrl,notes
    const batch = writeBatch(db);
    let count = 0;
    for(const r of rows){
      if(!r.name) continue;
      const ref = doc(this.colRef()); // id عشوائي
      batch.set(ref, {
        name: r.name,
        category: r.category || null,
        unit: r.unit || 'g',
        brand: r.brand || null,
        carbsPer100: num(r.carbsPer100),
        kcalPer100:  num(r.kcalPer100),
        proteinPer100: num(r.proteinPer100),
        fatPer100:   num(r.fatPer100),
        fiberPer100: num(r.fiberPer100),
        tags: parseTags(r.tags),
        imageUrl: r.imageUrl || null,
        notes: r.notes || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      count++;
      // Firestore يحدّ 500 عملية بالباتش
      if (count % 450 === 0){ await batch.commit(); }
    }
    await batch.commit();
    alert('تم الاستيراد!');
    await this.load();
  },

  exportCSV(){
    const header = ['name','category','unit','carbsPer100','kcalPer100','proteinPer100','fatPer100','fiberPer100','brand','tags','imageUrl','notes'];
    const lines = [header.join(',')];
    for(const f of this.all){
      const row = [
        csvCell(f.name),
        csvCell(f.category),
        csvCell(f.unit||'g'),
        csvCell(f.carbsPer100),
        csvCell(f.kcalPer100),
        csvCell(f.proteinPer100),
        csvCell(f.fatPer100),
        csvCell(f.fiberPer100),
        csvCell(f.brand),
        csvCell(Array.isArray(f.tags)? f.tags.join('|') : ''),
        csvCell(f.imageUrl),
        csvCell(f.notes)
      ].join(',');
      lines.push(row);
    }
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='food-items.csv'; a.click();
    URL.revokeObjectURL(url);
  }
};

/* listeners للأصناف */
$('addFoodBtn')?.addEventListener('click', ()=> foods.openDialog(null));
$('saveFoodBtn')?.addEventListener('click', (e)=>{ e.preventDefault(); foods.saveFromDialog(); });
$('foodSearch')?.addEventListener('input', ()=> foods.render());
$('importBtn')?.addEventListener('click', ()=> $('csvInput').click());
$('csvInput')?.addEventListener('change', (e)=>{ const f=e.target.files?.[0]; if(f) foods.importCSV(f); e.target.value=''; });
$('exportBtn')?.addEventListener('click', ()=> foods.exportCSV());

/* ================= Helpers ================= */
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function parseTags(s){ return (s||'').split(/[,|]/).map(x=>x.trim()).filter(Boolean); }
function esc(s){ return (s??'').toString().replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m])); }
function csvCell(v){
  if (v==null) return '';
  const s = String(v).replace(/"/g,'""');
  return /[,"\n]/.test(s) ? `"${s}"` : s;
}
function parseCSV(text){
  // Parser بسيط للرؤوس + فواصل
  const lines = text.replace(/\r/g,'').split('\n').filter(Boolean);
  if(!lines.length) return [];
  const header = lines.shift().split(',').map(h=>h.trim());
  return lines.map(line=>{
    const cells = []; let cur=''; let q=false;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (q){
        if (ch === '"' && line[i+1] === '"'){ cur+='"'; i++; }
        else if (ch === '"'){ q=false; }
        else cur += ch;
      } else {
        if (ch === '"'){ q=true; }
        else if (ch === ','){ cells.push(cur); cur=''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    const rec = {};
    header.forEach((h,idx)=> rec[h] = (cells[idx] ?? '').trim());
    return rec;
  });
}
