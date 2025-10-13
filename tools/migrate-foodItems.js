import { db } from '../js/firebase-config.js';
import {
  collection, getDocs, doc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const FOODS = collection(db,'admin','global','foodItems');
const logEl = document.getElementById('log');
const btn = document.getElementById('run');

const tidy = s => (s||'').toString().trim();
const toSearch = s => (s||'').toString().toLowerCase()
  .replace(/[أإآا]/g,'ا').replace(/[ى]/g,'ي').replace(/[ؤئ]/g,'ء').replace(/\s+/g,' ').trim();

function normUnits(d){
  if (Array.isArray(d.units)) return d.units;
  if (Array.isArray(d.measures)) return d.measures.map(m=>({key:(m.name||m.label), label:(m.name||m.label), grams:Number(m.grams), default:!!m.default}));
  if (d.measureQty && typeof d.measureQty==='object') return Object.entries(d.measureQty).map(([k,v])=>({key:k,label:k,grams:Number(v),default:false}));
  if (Array.isArray(d.householdUnits)) return d.householdUnits.map(m=>({key:m.name,label:m.name,grams:Number(m.grams),default:false}));
  if (d.per100) return [{key:'g100',label:'100 جم',grams:100,default:true}];
  return [];
}

function normPer100(d){
  const p = d.per100 || d.nutrPer100g || {};
  return {
    cal_kcal: Number(p.cal_kcal||d.cal_kcal||0),
    carbs_g:  Number(p.carbs_g||d.carbs_g||0),
    protein_g:Number(p.protein_g||d.protein_g||0),
    fat_g:    Number(p.fat_g||d.fat_g||0),
    fiber_g:  Number(p.fiber_g||d.fiber_g||0),
    sodium_mg:Number(p.sodium_mg||d.sodium_mg||0),
    gi:       Number(p.gi||d.gi||0)
  };
}

function buildSearch(d, units, dietTags, hashTags){
  const u = (units||[]).map(x=>x.label).join(' ');
  const t = [...(dietTags||[]), ...(hashTags||[])].join(' ');
  return toSearch(`${d.name||''} ${d.category||''} ${t} ${u}`);
}

btn.onclick = async ()=>{
  btn.disabled = true;
  logEl.textContent = 'جارٍ التحميل...\n';
  const snap = await getDocs(FOODS);
  let i=0;
  for (const s of snap.docs){
    const d = { id:s.id, ...s.data() };
    const per100 = normPer100(d);
    const units  = normUnits(d);
    const dietTags = d.dietTags || [...(d.dietTagsManual||[]), ...(d.dietTagsAuto||[])];
    const hashTags = d.hashTags || [...(d.hashTagsManual||[]), ...(d.hashTagsAuto||[])];
    const image = {
      url: tidy(d.image?.url || d.imageUrl || ''),
      path: tidy(d.image?.path || d.imagePath || '')
    };
    const payload = {
      name: tidy(d.name),
      category: tidy(d.category||'أخرى'),
      isActive: (d.isActive !== false),
      per100, units, image, dietTags, hashTags,
      searchText: buildSearch(d, units, dietTags, hashTags),
      schemaVersion: 2,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(FOODS, d.id), payload, { merge:true });
    i++;
    logEl.textContent += `✔︎ ${i}) ${d.name}\n`;
  }
  logEl.textContent += `\nانتهت الهجرة بنجاح. عدد العناصر: ${i}.\n`;
  btn.disabled = false;
};
