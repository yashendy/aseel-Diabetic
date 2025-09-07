/* ====== Reset ====== */
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Tahoma,Arial;background:#f7f8fa;color:#0f172a}

/* ====== Header ====== */
.head{background:#fff;border-bottom:1px solid #eef1f4}
.head-grid{
  max-width:1100px;margin:0 auto;
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:14px 16px
}
.page-title{font-size:20px;margin:0}
.controls{
  display:grid;grid-template-columns:160px 1fr auto;gap:10px;min-width:380px
}
.controls .btn{padding:8px 12px;border:1px solid #dde3ea;background:#fff;border-radius:10px;cursor:pointer}

/* ====== Container ====== */
.container{max-width:1100px;margin:18px auto;padding:0 12px}
.section{margin-bottom:18px}
.section-title{margin:0 0 10px;font-size:16px;color:#0b1220}

/* ====== Preset grid (default) ====== */
.preset-grid{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px
}
.preset-card{
  background:#fff;border:1px solid #e6ebf0;border-radius:12px;overflow:hidden;
  display:flex;flex-direction:column;gap:6px;
  transition:transform .12s ease, box-shadow .12s ease;
}
.preset-card:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(17,24,39,.06)}
.preset-top{display:flex;align-items:center;gap:10px;padding:10px 10px 0}
.preset-top .thumb{
  width:52px;height:52px;border-radius:10px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;background:#f3f5f8
}
.preset-top .thumb img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.preset-top .title{font-size:14px;margin:0}
.preset-body{padding:0 10px 10px;font-size:13px;color:#475569}

/* ====== Picker grid (default) ====== */
.picker-grid{
  display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px
}
.pick-card{
  background:#fff;border:1px solid #e6ebf0;border-radius:12px;padding:10px;
  display:flex;align-items:center;gap:10px;cursor:pointer;
  transition:transform .12s ease, box-shadow .12s ease;
}
.pick-card:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(17,24,39,.06)}
.pick-thumb{
  width:56px;height:56px;border-radius:10px;overflow:hidden;
  display:flex;align-items:center;justify-content:center;background:#f3f5f8;flex:0 0 auto
}
.pick-thumb img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.pick-meta{display:flex;flex-direction:column;gap:2px}
.pick-title{font-size:14px;margin:0}
.badge{align-self:flex-start;padding:3px 8px;border-radius:999px;font-size:12px;background:#eef2ff;color:#3730a3}

/* ====== Items table ====== */
.items-table{background:#fff;border:1px solid #e6ebf0;border-radius:12px;overflow:auto}
.row{
  display:grid;
  grid-template-columns:1.5fr 100px 100px 90px 90px 90px 90px 1fr 80px;
  align-items:center;gap:0;border-bottom:1px solid #eef1f4;min-width:1040px
}
.row.header{background:#f9fafb;color:#111827;font-weight:600}
.row > div{padding:10px}
.row .del{color:#ef4444;cursor:pointer}

/* ====== Chips ====== */
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid #e6ebf0;border-radius:999px;background:#fff;font-size:12px}

/* =============================================================================
   ✅ Overrides: بطاقات أيقونات صغيرة + احتواء الصورة + إظهار الاسم تحت الأيقونة
============================================================================= */

/* 1) تصغير البطاقات جداً + منع خروج الصورة */
.picker-grid .pick-card,
.preset-grid .preset-card{
  width:60px;height:60px;padding:6px;border-radius:10px;
  justify-content:center;align-items:center;overflow:hidden;
}

/* إطار الأيقونة */
.picker-grid .pick-thumb,
.preset-grid .thumb{
  width:36px;height:36px;border-radius:8px;overflow:hidden;background:#f3f5f8;
  display:flex;align-items:center;justify-content:center;
}

/* الصورة نفسها 32×32 داخل الإطار */
.picker-grid .pick-thumb img,
.preset-grid .thumb img{
  width:32px;height:32px;max-width:100%;max-height:100%;object-fit:contain;display:block;
}

/* 2) عرض الاسم تحت الأيقونة — نكبر الكارت قليلاً ونجعل التخطيط عمودي */
.picker-grid .pick-card{
  width:72px;height:84px;flex-direction:column;gap:6px;
}
.preset-grid .preset-card{
  width:72px;height:84px;gap:4px;justify-content:center;
}
.preset-grid .preset-top{
  padding:6px;gap:6px;flex-direction:column;align-items:center;justify-content:center;
}

/* إظهار عنوان البطاقة أسفل الأيقونة وقص الطويل */
.picker-grid .pick-meta{display:block;text-align:center}
.picker-grid .pick-title{
  display:block;font-size:11px;line-height:1.2;margin:0;max-width:100%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.preset-grid .title{
  display:block !important;font-size:11px;line-height:1.2;margin:0;text-align:center;max-width:100%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
/* إخفاء تفاصيل لا داعي لها في الحجم الصغير */
.preset-grid .preset-body{display:none}
.picker-grid .badge{display:none}

/* تحسين الوصول */
.pick-card:focus-visible,.preset-card:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}

/* 3) Responsive للموبايل */
@media (max-width: 680px){
  .head-grid{flex-direction:column;align-items:flex-start;gap:10px}
  .controls{min-width:unset;grid-template-columns:1fr 1fr;gap:8px}
  .items-table{overflow-x:auto}
  .row{
    min-width:820px;
    grid-template-columns:1.5fr 90px 90px 80px 80px 80px 80px 1fr 70px
  }
  .picker-grid{grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:10px}
  .preset-grid{grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:10px}
}
@media (max-width: 420px){
  .controls{grid-template-columns:1fr}
  .row{min-width:720px}
}
