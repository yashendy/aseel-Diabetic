/* =========================================================
   إدارة الوجبات – منطق الصفحة
   يعتمد على:
   - child data (CR/CF/targets per-meal)
   - optional window.ai (ai.js) لبدائل واقتراحات
========================================================= */

(() => {
  // عناصر DOM
  const glucoseNowEl  = $('#glucoseNow');
  const glucoseUnitEl = $('#glucoseUnit');
  const targetText    = $('#targetText');
  const mealTypeSel   = $('#mealType');
  const carbsTotalEl  = $('#carbsTotal');
  const rangeText     = $('#rangeText');
  const rangeBadge    = $('#rangeBadge');
  const btnEditRange  = $('#btnEditRange');
  const libModal      = $('#libModal');
  const libList       = $('#libList');
  const btnOpenLib    = $('#btnOpenLib');
  const btnAutoFit    = $('#btnAutoFit');
  const btnSuggest    = $('#btnSuggest');
  const btnSavePreset = $('#btnSavePreset');
  const btnLoadPreset = $('#btnLoadPreset');
  const basketBody    = $('#basketBody');
  const basketTotalEl = $('#basketTotal');
  const fitHint       = $('#fitHint');
  const doseCarbEl    = $('#doseCarb');
  const doseCorrEl    = $('#doseCorr');
  const doseTotalEl   = $('#doseTotal');

  const rangeModal    = $('#rangeModal');
  const rangeMinInput = $('#rangeMinInput');
  const rangeMaxInput = $('#rangeMaxInput');
  const rangeSaveBtn  = $('#rangeSave');

  // حالة
  let child = null;            // يُملأ من مشروعك (Firestore مثلاً)
  let mealType = 'breakfast';
  let targetsOverride = null;  // تعديل محلي للنطاق لهذه الوجبة
  let basket = [];             // [{id,name,gramsPerPortion,portions,_c100,carbs,image}]
  let library = [];            // أصناف المكتبة (مصدر مشروعك)
  let glucoseUnit = 'mmol/L';  // من child
  let target = null;           // رقم الهدف (mmol/L أو mg/dL حسب الوحدة)
  let CR = null;               // per-meal أو عام
  let CF = null;               // per-meal أو عام

  // أدوات
  const nearest025 = x => Math.max(0, Math.round((+x||0)/0.25)*0.25);
  const round1     = x => Math.round((+x||0)*10)/10;
  const roundDose  = x => Math.round((+x||0)/0.05)*0.05; // تقريب لأقرب 0.05

  function $(q){ return document.querySelector(q); }
  function show(el){ el.removeAttribute('hidden'); }
  function hide(el){ el.setAttribute('hidden',''); }

  function getQueryParam(k){
    const u = new URL(location.href);
    return u.searchParams.get(k);
  }

  function statusBadge(inRange){
    rangeBadge.textContent = inRange ? 'داخل النطاق' : 'خارج النطاق';
    rangeBadge.classList.toggle('ok', inRange);
    rangeBadge.classList.toggle('warn', !inRange);
  }

  function getMealTargets(){
    const t = targetsOverride || (child?.carbTargets?.[mealType] || child?.carbGoals?.[mealType]);
    if(!t) return {min:null, max:null};
    if(Array.isArray(t)) return {min:+t[0]||0, max:+t[1]||0};
    return {min: t.min!=null ? +t.min : null, max: t.max!=null ? +t.max : null};
  }

  function getMealCR(){
    const by = child?.carbRatioByMeal?.[mealType];
    return by != null ? +by : (child?.carbRatio != null ? +child.carbRatio : null);
  }

  function getMealCF(){
    const by = child?.correctionFactorByMeal?.[mealType];
    return by != null ? +by : (child?.correctionFactor != null ? +child.correctionFactor : null);
  }

  function getTarget(){
    // نستخدم mid (متوسط المدى) أو الأعلى حسب تفضيل الطفل
    const pref = child?.targetPref || 'mid';
    const rn = child?.normalRange || child?.glucoseTargets?.normal || null; // {min,max}
    if(!rn) return null;
    const min=+rn.min||0, max=+rn.max||0;
    if(pref === 'max') return max||null;
    return (min&&max) ? round1((min+max)/2) : (max||min||null);
  }

  function renderHeader(){
    // وحدة السكر
    glucoseUnit = child?.glucoseUnit || 'mmol/L';
    glucoseUnitEl.textContent = glucoseUnit;

    // هدف التصحيح
    target = getTarget();
    targetText.textContent = target!=null ? `${target} ${glucoseUnit}` : '—';

    // CR/CF
    CR = getMealCR();
    CF = getMealCF();
    $('#crText').textContent = CR!=null ? CR : '—';
    $('#cfText').textContent = CF!=null ? CF : '—';
    $('#crSource').textContent = child?.carbRatioByMeal?.[mealType]!=null ? 'حسب الوجبة' : 'عام';

    // نطاق
    const {min,max} = getMealTargets();
    if(min!=null && max!=null){
      rangeText.textContent = `النطاق: ${min}–${max} جم`;
    }else{
      rangeText.textContent = 'لا يوجد نطاق محدد لهذه الوجبة';
    }
  }

  /* ========== مكتبة الأصناف ========== */

  function normalizeMeasures(it){
    const out=[], seen=new Set();
    if(Array.isArray(it.measures)){
      for(const m of it.measures){
        const grams=+m.grams||+m.g||null;
        const label=m.label||m.key||"حصة";
        const key=(m.key||label).toString();
        if(!seen.has(key)&&grams){ out.push({key,label,grams:+grams}); seen.add(key); }
      }
    }
    if(+it.servingSize) out.push({key:"serv",label:`حصة (${it.servingSize} جم)`,grams:+it.servingSize});
    if(+it.pieceGrams)  out.push({key:"piece",label:`حبة (${it.pieceGrams} جم)`,grams:+it.pieceGrams});
    if(out.length===0){
      out.push({key:"cup",label:"كوب (240 جم تقريبًا)",grams:240});
      out.push({key:"tbsp",label:"ملعقة كبيرة (15 جم تقريبًا)",grams:15});
      out.push({key:"tsp",label:"ملعقة صغيرة (5 جم تقريبًا)",grams:5});
    }
    return out.slice(0,6);
  }

  function renderLibrary(items){
    libList.innerHTML="";
    if(!items.length){
      libList.textContent="لا توجد أصناف مطابقة.";
      return;
    }
    for(const it of items){
      const img = it.image||it.imageUrl||it.photoUrl||"images/placeholder.png";
      const name = it.nameAr || it.name || "صنف";
      const c100 = +it.carbsPer100g || 0;
      const measures = normalizeMeasures(it);

      const tags=[];
      if(it.is_vegan) tags.push("نباتي صارم");
      if(it.is_vegetarian) tags.push("نباتي");
      if(it.gluten===false || it.contains_gluten===false) tags.push("خالٍ من الجلوتين");
      if(it.lactose===false || it.contains_lactose===false) tags.push("خالٍ من اللاكتوز");
      if(it.halal) tags.push("حلال");

      const card = document.createElement("div");
      card.className="lib-item";
      card.innerHTML = `
        <img class="thumb" src="${img}" alt="">
        <div class="name">${name}</div>
        <div class="meta">كارب/100جم: <b>${c100||"—"}</b>${it.servingSize?` • الحصة: ${it.servingSize}جم`:""}</div>
        <div class="tags">${tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>

        <div class="row">
          <select class="measure">
            ${measures.map(m=>`<option value="${m.grams}">${m.label}</option>`).join("")}
          </select>
          <input class="qty" type="number" step="0.25" min="0" placeholder="الكمية (وحدات)">
          <input class="gpp" type="number" step="0.1"  min="0" placeholder="جرام/وحدة">
          <input class="cpg" type="number" step="0.1"  min="0" placeholder="كارب محسوب" disabled>
          <button class="btn sm add">إضافة</button>
        </div>
        <div class="hint">اختاري مقدارًا ثم الكمية، وسيُحسب الجرام والكارب تلقائيًا.</div>
      `;

      const sel = card.querySelector(".measure");
      const qty = card.querySelector(".qty");
      const gpp = card.querySelector(".gpp");
      const cpg = card.querySelector(".cpg");

      const setGppFromMeasure = ()=>{ const v=+sel.value||0; if(v){ gpp.value=v; calc(); } };
      const calc = ()=>{
        const p=+qty.value||0, gramsPerUnit=+gpp.value||0;
        const grams = p * gramsPerUnit;
        const carb = c100 && grams ? round1((grams*c100)/100) : 0;
        cpg.value = carb;
      };

      sel.addEventListener("change", setGppFromMeasure);
      qty.addEventListener("input", calc);
      gpp.addEventListener("input", calc);
      setGppFromMeasure();

      card.querySelector(".add").addEventListener("click", ()=>{
        const p=+qty.value||0, gramsPerUnit=+gpp.value||0;
        const grams=p*gramsPerUnit;
        const carb=c100 && grams ? round1((grams*c100)/100) : null;

        basket.push({
          id: it.id, name, image: img,
          gramsPerPortion: gramsPerUnit,
          portions: p,
          carbs: carb,
          _c100: c100
        });
        renderBasket(); closeLib();
      });

      libList.appendChild(card);
    }
  }

  /* ========== السلة والعمليات ========== */

  function renderBasket(){
    basketBody.innerHTML="";
    if(!basket.length){
      basketBody.innerHTML=`<tr class="empty"><td colspan="5">لا توجد أصناف بعد</td></tr>`;
      basketTotalEl.textContent="0.0";
      carbsTotalEl.value="";
      recalc();
      return;
    }
    let total=0;
    for(const [i,row] of basket.entries()){
      total += (+row.carbs||0);
      const tr=document.createElement("tr");
      tr.innerHTML=`
        <td>${row.name}</td>
        <td><input type="number" step="0.25" min="0" class="bPortions" value="${row.portions??""}"></td>
        <td><input type="number" step="0.1"  min="0" class="bGpp" value="${row.gramsPerPortion??""}"></td>
        <td class="bCarbs">${row.carbs??"—"}</td>
        <td><button class="btn ghost sm" data-i="${i}">حذف</button></td>
      `;
      const inpP=tr.querySelector(".bPortions");
      const inpG=tr.querySelector(".bGpp");
      const cellC=tr.querySelector(".bCarbs");

      function recomputeRow(){
        const p=+inpP.value||0, gpp=+inpG.value||0;
        row.portions=p; row.gramsPerPortion=gpp;
        if(row._c100 && gpp && p){
          const grams=gpp*p;
          row.carbs= round1((grams*row._c100)/100);
        }else{
          row.carbs=null;
        }
        cellC.textContent=(row.carbs??"—");
        renderBasket(); // لإعادة حساب الإجمالي وتحديث كل شيء
      }

      inpP.addEventListener("input", recomputeRow);
      inpG.addEventListener("input", recomputeRow);
      tr.querySelector("button[data-i]").addEventListener("click", ()=>{ basket.splice(i,1); renderBasket(); });

      basketBody.appendChild(tr);
    }
    basketTotalEl.textContent= total.toFixed(1);
    carbsTotalEl.value    = total.toFixed(1);
    recalc();
  }

  function recalc(){
    // حالة النطاق
    const total = +carbsTotalEl.value || 0;
    const {min,max} = getMealTargets();
    const hasRange = (min!=null && max!=null);
    const inRange  = hasRange ? (total>=min && total<=max) : true;
    statusBadge(inRange);

    // جرعات
    const doseCarb = (CR ? (total/CR) : 0);
    const gNowRaw  = +glucoseNowEl.value || 0;
    const gNow     = gNowRaw; // نفترض أن الوحدة متطابقة مع target (أرقام من مشروعك)
    const doseCorr = (CF && target!=null) ? Math.max(0, (gNow - target)/CF) : 0;
    const totalDose= roundDose(doseCarb + doseCorr);

    doseCarbEl.textContent = (Math.round(doseCarb*100)/100).toFixed(2);
    doseCorrEl.textContent = (Math.round(doseCorr*100)/100).toFixed(2);
    doseTotalEl.textContent= totalDose.toFixed(2);

    fitHint.textContent = hasRange
      ? (inRange ? "✔️ الكارب داخل النطاق." : "⚠️ الكارب خارج النطاق — يمكنك استخدام تعديل المقادير (0.25) أو تعديل النطاق.")
      : "لا يوجد نطاق محدد لهذه الوجبة.";
  }

  function autoFitToTarget(maxTarget, minTarget){
    if(!basket.length || !maxTarget) return false;
    const sum0 = basket.reduce((s,b)=>s+(+b.carbs||0),0);

    // لو أقل من الحد الأدنى: لا نزود تلقائيًا (حسب الاتفاق)
    if(minTarget!=null && sum0 < minTarget) return false;

    if(sum0 <= maxTarget) return false;

    // تخفيض نسبي أولًا
    const k = maxTarget / sum0;
    for(const b of basket){
      b.portions = nearest025((+b.portions||0) * k);
      if(b._c100 && b.gramsPerPortion && b.portions){
        const grams=b.gramsPerPortion*b.portions;
        b.carbs= round1((grams*b._c100)/100);
      }else b.carbs=null;
    }

    // تحسين بالنقص 0.25
    let guard=40, total=basket.reduce((s,b)=>s+(+b.carbs||0),0);
    while(total>maxTarget && guard-- > 0){
      let idx=-1, best=-1;
      basket.forEach((b,i)=>{ if((+b.carbs||0)>best){ best=+b.carbs; idx=i; }});
      if(idx<0) break;
      basket[idx].portions = Math.max(0, (+basket[idx].portions||0) - 0.25);
      if(basket[idx]._c100 && basket[idx].gramsPerPortion && basket[idx].portions){
        const grams=basket[idx].gramsPerPortion*basket[idx].portions;
        basket[idx].carbs= round1((grams*basket[idx]._c100)/100);
      } else basket[idx].carbs=null;
      total=basket.reduce((s,b)=>s+(+b.carbs||0),0);
    }
    renderBasket();
    return true;
  }

  /* ========== نطاق محلي (هذه الوجبة فقط) ========== */
  btnEditRange.addEventListener('click', ()=>{
    const {min,max} = getMealTargets();
    rangeMinInput.value = min ?? '';
    rangeMaxInput.value = max ?? '';
    show(rangeModal);
  });
  rangeSaveBtn.addEventListener('click', ()=>{
    const mn = rangeMinInput.value==='' ? null : +rangeMinInput.value;
    const mx = rangeMaxInput.value==='' ? null : +rangeMaxInput.value;
    targetsOverride = (mn!=null && mx!=null) ? {min:mn,max:mx} : null;
    renderHeader(); renderBasket(); hide(rangeModal);
  });

  /* ========== مكتبة: فتح/غلق ========== */
  btnOpenLib.addEventListener('click', ()=>{
    show(libModal);
    renderLibrary(library);
  });
  document.addEventListener('click', (e)=>{
    const closeSel = e.target.getAttribute?.('data-close');
    if(closeSel){
      hide($(closeSel));
    }
  });
  function closeLib(){ hide(libModal); }

  /* ========== أزرار أخرى ========== */
  btnAutoFit.addEventListener('click', ()=>{
    const {min,max} = getMealTargets();
    const ok = autoFitToTarget(+max||0, (min!=null?+min:null));
    fitHint.textContent = ok ? "✔️ تم ضبط المقادير بمضاعفات 0.25" : "لا يمكن الضبط الآن.";
  });

  // بدائل بالذكاء الاصطناعي (اختياري – يتطلب ai.js)
  btnSuggest.addEventListener('click', async ()=>{
    if(!window.ai || typeof ai.suggestAlternatives!=='function'){
      alert('ميزة البدائل الذكية غير مفعلة (ai.js غير متاح).');
      return;
    }
    try{
      const flags = child?.dietaryFlags || {};
      const allergies = child?.allergies || [];
      const res = await ai.suggestAlternatives({ basket, library, mealType, flags, allergies });
      // res: [{index, suggestion:{id,name,_c100,gramsPerPortion,portions}}...]
      if(Array.isArray(res) && res.length){
        // نطبّق أول بديل بشكل توضيحي:
        const r0 = res[0];
        if(r0 && r0.index!=null && r0.suggestion){
          basket[r0.index] = {
            id: r0.suggestion.id,
            name: r0.suggestion.name,
            _c100: r0.suggestion._c100,
            gramsPerPortion: r0.suggestion.gramsPerPortion,
            portions: r0.suggestion.portions,
            carbs: r0.suggestion._c100 && r0.suggestion.gramsPerPortion && r0.suggestion.portions
              ? round1((r0.suggestion._c100 * r0.suggestion.gramsPerPortion * r0.suggestion.portions)/100)
              : null
          };
          renderBasket();
          alert('تم تطبيق بديل على أول صنف (تجريبي).');
        }else{
          alert('لا توجد بدائل مناسبة الآن.');
        }
      }else{
        alert('لا توجد بدائل مناسبة الآن.');
      }
    }catch(err){
      console.error(err);
      alert('تعذّر جلب بدائل حالياً.');
    }
  });

  btnSavePreset.addEventListener('click', ()=>{
    // هنا تربطيه بحفظ Firestore كما هو في مشروعك
    alert('سيتم حفظ هذه الوجبة كقالب (يرجى ربطه بـ Firestore في مشروعك).');
  });
  btnLoadPreset.addEventListener('click', ()=>{
    // هنا تربطيه بالتحميل من Firestore
    alert('سيتم تحميل وجبة جاهزة (يرجى ربطه بـ Firestore في مشروعك).');
  });

  /* ========== تحميل بيانات الطفل + المكتبة ========== */
  async function bootstrap(){
    mealType = mealTypeSel.value;

    // TODO: اربطيها بمشروعك (Firestore). مؤقتًا بنموذج بسيط محافظ.
    child = window.__CHILD__ || {
      glucoseUnit:"mmol/L",
      normalRange:{min:3.5,max:7},
      targetPref:"mid",
      carbRatio:12,
      correctionFactor:3,
      carbRatioByMeal:{breakfast:12,lunch:12,dinner:12,snack:12},
      correctionFactorByMeal:{breakfast:3,lunch:3,dinner:3,snack:3},
      carbTargets:{
        breakfast:{min:40,max:60},
        lunch:{min:60,max:90},
        dinner:{min:50,max:75},
        snack:{min:10,max:20}
      },
      dietaryFlags:{ halal:true, lowFat:false },
      allergies:["lactose"]
    };

    library = window.__FOODS__ || [
      {id:"1", nameAr:"فينو - صمول", carbsPer100g:50, measures:[{label:"حبة صغيرة",grams:35},{label:"حبة متوسطة",grams:55}], image:"images/placeholder.png"},
      {id:"2", nameAr:"جبنة قريش", carbsPer100g:4,  measures:[{label:"ملعقة كبيرة",grams:15},{label:"كوب",grams:200}]},
      {id:"3", nameAr:"تفاح", carbsPer100g:12, measures:[{label:"حبة",grams:150}]}
    ];

    renderHeader();
    renderBasket();
  }

  mealTypeSel.addEventListener('change', ()=>{
    mealType = mealTypeSel.value;
    targetsOverride = null;
    renderHeader(); renderBasket();
  });
  glucoseNowEl.addEventListener('input', recalc);

  // boot
  bootstrap();

})();
