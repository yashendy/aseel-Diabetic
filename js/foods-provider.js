// /js/foods-provider.js
import { db, storage } from './firebase-config.js';
import {
  collection, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import {
  ref as sRef, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

const FOODS = collection(db, 'admin', 'global', 'foodItems');

const state = { list: [], ready:false };

const toArabic = s => (s||'').toString().toLowerCase()
  .replace(/[أإآا]/g,'ا').replace(/[ى]/g,'ي').replace(/[ؤئ]/g,'ء').replace(/\s+/g,' ').trim();

const num = (v,fb=0)=>Number.isFinite(Number(v)) ? Number(v) : fb;

function normalizeMeasures(d){
  if (Array.isArray(d.units)) {
    return d.units.filter(u=>u && (u.label||u.name) && Number(u.grams)>0)
      .map(u=>({ name:u.label||u.name, grams:Number(u.grams), default:!!u.default }));
  }
  if (Array.isArray(d.measures)) {
    return d.measures.filter(m=>m && m.name && Number(m.grams)>0)
      .map(m=>({ name:m.name, grams:Number(m.grams), default:!!m.default }));
  }
  if (d.measureQty && typeof d.measureQty==='object') {
    return Object.entries(d.measureQty)
      .map(([k,v])=>({ name:k, grams:Number(v), default:false }))
      .filter(x=>x.grams>0);
  }
  if (Array.isArray(d.householdUnits)) {
    return d.householdUnits.filter(m=>m && m.name && Number(m.grams)>0)
      .map(m=>({ name:m.name, grams:Number(m.grams), default:false }));
  }
  if (d.per100 || d.nutrPer100g) return [{ name:'100 جم', grams:100, default:true }];
  return [];
}

function normalizeDoc(snap){
  const r = { id:snap.id, ...snap.data() };
  const p = r.per100 || r.nutrPer100g || {};
  const per100 = {
    cal_kcal: num(p.cal_kcal), carbs_g: num(p.carbs_g), protein_g:num(p.protein_g),
    fat_g: num(p.fat_g), fiber_g:num(p.fiber_g), sodium_mg:num(p.sodium_mg), gi:num(p.gi)
  };
  const measures = normalizeMeasures(r);
  const imageUrl = r.image?.url || r.imageUrl || '';
  const imagePath = r.image?.path || r.imagePath || '';
  return { id:r.id, name:r.name||'', category:r.category||'', per100, measures, imageUrl, imagePath, isActive: r.isActive !== false, searchText:r.searchText||'' };
}

async function resolveImages(items){
  await Promise.all(items.map(async f=>{
    if (!f.imageUrl && f.imagePath && !/^https?:\/\//.test(f.imagePath)) {
      try { f.imageUrl = await getDownloadURL(sRef(storage, f.imagePath)); } catch(_) {}
    }
  }));
}

function publish(){
  window.FOOD_LIBRARY = state.list;
  window.searchFoods = function(q=''){
    const t = toArabic(q);
    let list = [...state.list];
    if (t) {
      list = list.filter(x=>{
        const m = (x.measures||[]).map(v=>v.name).join(' ');
        const hay = toArabic(`${x.name} ${x.category} ${x.searchText} ${m}`);
        return hay.includes(t);
      });
    }
    return list;
  };
  window.getFoodById = id => state.list.find(x=>x.id===id) || null;
  window.dispatchEvent(new CustomEvent('foods:update', { detail:{ list: state.list }}));
  state.ready=true;
}

onSnapshot(FOODS, async snap=>{
  const arr=[]; snap.forEach(s=>arr.push(normalizeDoc(s)));
  const byId=new Map(arr.map(x=>[x.id,x]));
  const list=[...byId.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar',{numeric:true}));
  await resolveImages(list);
  state.list=list;
  publish();
});
