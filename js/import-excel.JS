// import-excel.js — Excel importer (requires SheetJS/xlsx to be available)
// It expects columns like: name, brand, category, imageUrl, cal_kcal, carbs_g, fiber_g, protein_g, fat_g, gi, tags, dietTags, allergens, measures_json
// measures_json example: [{ "name": "نصف كوب", "grams": 80 }, { "name": "كوب", "grams": 160 }]
(function(){
  async function ensureXLSX(){
    if(window.XLSX) return window.XLSX;
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload=res; s.onerror=()=>rej(new Error('فشل تحميل XLSX'));
      document.head.appendChild(s);
    });
    return window.XLSX;
  }
  function parseList(v){ return String(v||'').split(',').map(x=>x.trim()).filter(Boolean); }

  window.runExcelImporter = async function(addOrUpdate){
    try{
      await ensureXLSX();
      const inp=document.createElement('input'); inp.type='file'; inp.accept='.xlsx,.xls,.csv';
      inp.onchange = async ()=>{
        const file = inp.files[0]; if(!file) return;
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        let ok=0, fail=0;
        for(const r of rows){
          try{
            const payload = {
              name: r.name || r['name_ar'] || '',
              brand: r.brand || null,
              category: r.category || 'أخرى',
              imageUrl: r.imageUrl || '',
              nutrPer100g: {
                cal_kcal: Number(r.cal_kcal)||0,
                carbs_g: Number(r.carbs_g)||0,
                fiber_g: Number(r.fiber_g)||0,
                protein_g: Number(r.protein_g)||0,
                fat_g: Number(r.fat_g)||0,
                ...(r.gi!==undefined ? {gi:Number(r.gi)} : {})
              },
              tags: parseList(r.tags),
              dietTags: parseList(r.dietTags),
              allergens: parseList(r.allergens),
              measures: (()=>{
                try{ const arr = JSON.parse(r.measures_json||'[]'); return Array.isArray(arr)?arr:[]; }catch{return [];}
              })(),
              isActive: String(r.isActive||'true')==='true'
            };
            await addOrUpdate(null, payload);
            ok++;
          }catch(e){ console.error(e); fail++; }
        }
        alert('تم الاستيراد: '+ok+' ناجح / '+fail+' فاشل');
      };
      inp.click();
    }catch(e){
      alert('تعذر بدء الاستيراد: '+(e.message||e));
    }
  }
})();
