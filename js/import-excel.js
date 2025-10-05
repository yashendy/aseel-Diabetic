// js/import-excel.js
// Excel/CSV importer for admin catalog
// - Auto-loads SheetJS if not present
// - Expected columns (header names can be Arabic or English):
//   name | brand | category | imageUrl | cal_kcal | carbs_g | fiber_g | protein_g | fat_g | gi | tags | dietTags | allergens | measures_json | isActive
// - measures_json example: 
//   [{"name":"نصف كوب","grams":80},{"name":"كوب","grams":160}]

(function(){
  function parseList(v){ return String(v||'').split(',').map(s=>s.trim()).filter(Boolean); }
  async function ensureXLSX(){
    if (window.XLSX) return window.XLSX;
    await new Promise((res, rej)=>{
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = res; s.onerror = ()=>rej(new Error('فشل تحميل مكتبة XLSX'));
      document.head.appendChild(s);
    });
    return window.XLSX;
  }

  window.runExcelImporter = async function(addOrUpdate){
    try{
      await ensureXLSX();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.csv';
      input.onchange = async ()=>{
        const file = input.files[0];
        if(!file) return;
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        let ok = 0, fail = 0;
        for(const r of rows){
          try{
            const payload = {
              name: r.name || r['الاسم'] || '',
              brand: r.brand || r['البراند'] || null,
              category: r.category || r['الفئة'] || 'أخرى',
              imageUrl: r.imageUrl || r['رابط_صورة'] || '',
              nutrPer100g: {
                cal_kcal: Number(r.cal_kcal || r['السعرات']) || 0,
                carbs_g : Number(r.carbs_g || r['الكارب']) || 0,
                fiber_g : Number(r.fiber_g || r['الألياف']) || 0,
                protein_g: Number(r.protein_g || r['البروتين']) || 0,
                fat_g   : Number(r.fat_g || r['الدهون']) || 0,
                ...(r.gi!=null || r['GI']!=null ? { gi: Number(r.gi || r['GI']) } : {})
              },
              tags     : parseList(r.tags || r['الوسوم']),
              dietTags : parseList(r.dietTags || r['الأنظمة']),
              allergens: parseList(r.allergens || r['الحساسية']),
              measures : (()=>{
                try{ const a = JSON.parse(r.measures_json || r['المقادير']); return Array.isArray(a)?a:[]; }catch{return [];}
              })(),
              isActive : String(r.isActive ?? r['نشط']).toLowerCase() !== 'false'
            };
            await addOrUpdate(null, payload);
            ok++;
          }catch(e){ console.error('row failed', e, r); fail++; }
        }
        alert(`تم الاستيراد: ${ok} ناجح / ${fail} فاشل`);
      };
      input.click();
    }catch(e){
      alert('تعذر بدء الاستيراد: '+(e.message||e));
    }
  };
})();
