/* ===================== js/meals-netcarb-addon.js =====================
   Non-invasive: لا يلمس Firebase ولا يستبدل دوالك.
   فقط يسمع لتغيير "useNetCarbDose" ويحاول ينادي دوالك لإعادة الحساب.
====================================================================== */
(function(){
  const $ = (id)=>document.getElementById(id);

  function triggerRecompute(){
    try{
      if (typeof window.recomputeAllDoseViews === 'function') return window.recomputeAllDoseViews();
      if (typeof window.computeTotals === 'function')        return window.computeTotals();
      // fallback: dispatch event
      document.dispatchEvent(new CustomEvent('meal:recompute'));
    }catch(e){ console.warn('recompute fallback warn', e); }
  }

  function hook(){
    const el = $('useNetCarbDose') || $('useNetCarb');
    if (!el) return;
    el.addEventListener('change', triggerRecompute);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hook);
  } else {
    hook();
  }
})();
