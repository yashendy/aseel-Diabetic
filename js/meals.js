// /js/meals.js — FULL REPLACEMENT
// ✅ يشترك لحظيًا في admin/global/foodItems
// ✅ يدعم per100 + units[] (+ fallbacks)
// ✅ يحوّل image.path إلى رابط عبر getDownloadURL

import { app, db, storage } from './firebase-config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { ref as sRef, getDownloadURL } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js';

const FOODS = collection(db, 'admin','global','foodItems');
let foodCache = [];
let unsub = null;

const toArabicSearch = s => (s||'').toString().toLowerCase()
  .replace(/[أإآا]/g,'ا').replace(/[ى]/g,'ي').replace(/[ؤئ]/g,'ء').replace(/\s+/g,' ').trim();

function normalizeMeasures(d){
  if (Array.isArray(d?.units))
    return d.units.filter(u=>u&&(u.label||u.name)&&Number(u.grams)>0)
                  .map(u=>({ name:(u.label||u.name), grams:Number(u.grams), default: !!u.default}));
  if (Array.isArray(d?.measures))
    return d.measures.filter(m=>m&&m.name&&Number(m.grams)>0)
                     .map(m=>({ name:m.name, grams:Number(m.grams) }));
  if (d?.measureQty && typeof d.measureQty === 'object')
    return Object.entries(d.measureQty).map(([k,v])=>({ name:k, grams:Number(v) })).filter(x=>x.grams>0);
  if (Array.isArray(d?.householdUnits))
    return d.householdUnits.filter(m=>m&&m.name&&Number(m.grams)>0).map(m=>({ name:m.name, grams:Number(m.grams) }));
  if (d?.per100) return [{ name:'100 جم', grams:100, default:true }];
  return [];
}

function mapFood(s){
  const d = { id:s.id, ...s.data() };
  const p = d.per100 || d.nutrPer100g || {};
  const per100 = {
    cal_kcal: Number(p.cal_kcal||0), carbs_g: Number(p.carbs_g||0),
    protein_g: Number(p.protein_g||0), fat_g: Number(p.fat_g||0),
    fiber_g: Number(p.fiber_g||0), sodium_mg: Number(p.sodium_mg||0),
    gi: Number(p.gi||0)
  };
  const measures = normalizeMeasures(d);
  const image = d.image || {};
  const imageUrl = image.url || d.imageUrl || '';
  const imagePath = image.path || d.imagePath || '';
  return {
    id: d.id, name: d.name||'', category: d.category||'', isActive: d.isActive!==false,
    per100, measures, imageUrl, imagePath, searchText: d.searchText||''
  };
}

async function resolveImages(arr){
  await Promise.all(arr.map(async f=>{
    if(!f.imageUrl && f.imagePath && !/^https?:\/\//.test(f.imagePath)){
      try{ f.imageUrl = await getDownloadURL(sRef(storage, f.imagePath)); }catch(_){}
    }
  }));
}

function startLive(){
  if (unsub) return;
  unsub = onSnapshot(FOODS, async snap=>{
    const arr = [];
    snap.forEach(s => arr.push(mapFood(s)));
    // إزالة التكرار + فرز
    const byId = new Map(arr.map(x=>[x.id,x]));
    const list = Array.from(byId.values()).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ar',{numeric:true}));
    await resolveImages(list);
    foodCache = list;
    // إن كانت نافذة الاختيار مستخدمة في صفحتك:
    if (window.renderPicker) window.renderPicker();
  });
}

export function searchFoods(q=''){
  const t = toArabicSearch(q);
  let list = [...foodCache];
  if (t) list = list.filter(x=>{
    const unitsTxt = (x.measures||[]).map(m=>m.name).join(' ');
    const hay = toArabicSearch(`${x.name} ${x.category} ${x.searchText} ${unitsTxt}`);
    return hay.includes(t);
  });
  return list;
}

// ابدأ الاشتراك
startLive();
