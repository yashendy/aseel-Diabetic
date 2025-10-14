/* js/meals.js */

(function () {
  "use strict";

  // خطوة التقريب للأنسولين
  const ROUND_STEP = 0.25;

  // عناصر الصفحة
  const els = {
    head: {
      name: byId("childName"),
      CR: byId("headCR"), CF: byId("headCF"),
      hyper: byId("headHyper"), crit: byId("headCritHigh"),
      hyperMini: byId("hyperMini"), critMini: byId("critHighMini"),
    },
    mealType: byId("mealType"),
    mealDate: byId("mealDate"),
    gBefore: byId("glucoseBefore"),
    gAfter: byId("glucoseAfter"),
    doseCorr: byId("doseCorrection"),
    doseCarb: byId("doseCarb"),
    doseTotal: byId("doseTotal"),
    notes: byId("notes"),
    // هدف الكارب
    carb: {
      bar: byId("carbBar"),
      now: byId("carbNow"),
      min: byId("carbMin"),
      max: byId("carbMax"),
    },
    // الجدول
    tbody: byId("itemsBody"),
    t: { grams: byId("tGrams"), carbs: byId("tCarbs"), prot: byId("tProt"), fat: byId("tFat"), kcal: byId("tKcal") },
    // أزرار
    btn: {
      addFromLib: byId("btnAddFromLib"),
      smartFill: byId("btnSmartFill"),
      saveMeal: byId("btnSaveMeal"),
      reset: byId("btnReset"),
      ai: byId("btnAI"),
    }
  };

  // حالة الصفحة
  const state = {
    child: null,
    // معاملات فعالة حسب نوع الوجبة
    current: { CR: 0, CF: 0, hyper: 0, criticalHigh: 0, carbRange: { min: 0, max: 0 } },
    items: [], // {id,name,gramsPerUnit,homeLabel, qty, macros:{carbs,prot,fat,kcal} } القيم لكل وحدة
    totals: { grams: 0, carbs: 0, prot: 0, fat: 0, kcal: 0 }
  };

  // أدوات
  function byId(id){ return document.getElementById(id); }
  const roundStep = (v, step=ROUND_STEP)=> Math.round(v/step)*step;
  const clamp = (v,min,max)=> Math.min(max,Math.max(min,v || 0));

  // تحميل إعدادات الطفل في واجهة العرض
  function applyChildHeader() {
    const c = state.child;
    els.head.name.textContent = c?.name || "—";

    // المعاملات العامة
    els.head.CR.textContent = c?.carbRatio ?? "—";
    els.head.CF.textContent = c?.correctionFactor ?? "—";
    els.head.hyper.textContent = c?.hyperLevel ?? c?.normalRange?.hyper ?? "—";
    els.head.crit.textContent = c?.criticalHigh ?? c?.normalRange?.criticalHigh ?? "—";

    els.head.hyperMini.textContent = els.head.hyper.textContent;
    els.head.critMini.textContent = els.head.crit.textContent;
  }

  // استخراج CR لكل وجبة
  function resolveCR(mealType) {
    const c = state.child;
    const map = {
      breakfast: c?.cr_breakfast ?? c?.mealsDoses?.cr_breakfast,
      lunch:     c?.cr_lunch     ?? c?.mealsDoses?.cr_lunch,
      dinner:    c?.cr_dinner    ?? c?.mealsDoses?.cr_dinner,
      snack:     c?.cr_snack     ?? c?.mealsDoses?.cr_snack,
    };
    return map[mealType] ?? c?.carbRatio ?? 0;
  }

  // استخراج نطاق الكارب لكل وجبة
  function resolveCarbRange(mealType) {
    const t = state.child?.carbTargets || {};
    const map = {
      breakfast: t?.breakfast, lunch: t?.lunch, dinner: t?.dinner, snack: t?.snack
    };
    const r = map[mealType] || {};
    return { min: Number(r.min || 0), max: Number(r.max || 0) };
  }

  // ضبط المعاملات الفعالة حسب نوع الوجبة
  function refreshActiveDosing() {
    const mt = els.mealType.value;
    state.current.CR = Number(resolveCR(mt) || 0);
    state.current.CF = Number(state.child?.correctionFactor || 0);
    state.current.hyper = Number(state.child?.hyperLevel ?? state.child?.normalRange?.hyper ?? 0);
    state.current.criticalHigh = Number(state.child?.criticalHigh ?? state.child?.normalRange?.criticalHigh ?? 0);
    state.current.carbRange = resolveCarbRange(mt);

    // عكس CR الحالي في الهيدر ليساعد المستخدم
    els.head.CR.textContent = state.current.CR || "—";
  }

  // تحديث شريط هدف الكارب
  function renderCarbGoal() {
    const now = state.totals.carbs;
    const {min,max} = state.current.carbRange;
    els.carb.now.textContent = now.toFixed(1);
    els.carb.min.textContent = min || "—";
    els.carb.max.textContent = max || "—";

    if (min && max) {
      const p = clamp((now - min) / Math.max(1,(max - min)) * 100, 0, 100);
      els.carb.bar.style.width = `${p}%`;
      els.carb.bar.style.background = p>100 ? "linear-gradient(90deg,#fca5a5,#ef4444)" : "";
    } else {
      els.carb.bar.style.width = "0%";
    }
  }

  // حساب جرعة التصحيح
  function calcCorrectionDose() {
    const pre = Number(els.gBefore.value);
    const {criticalHigh, hyper, CF} = state.current;
    if (!pre || pre < criticalHigh || !CF) return 0;
    const raw = (pre - hyper) / CF;
    return roundStep(Math.max(0, raw));
  }

  // حساب جرعة الكارب
  function calcCarbDose() {
    const {CR} = state.current;
    if (!CR) return 0;
    const raw = state.totals.carbs / CR;
    return roundStep(Math.max(0, raw));
  }

  // جمع الإجماليات
  function recomputeTotals() {
    const totals = { grams:0, carbs:0, prot:0, fat:0, kcal:0 };
    for (const it of state.items) {
      const grams = it.gramsPerUnit * (Number(it.qty)||0);
      totals.grams += grams;
      totals.carbs += it.macros.carbs * (Number(it.qty)||0);
      totals.prot  += it.macros.prot  * (Number(it.qty)||0);
      totals.fat   += it.macros.fat   * (Number(it.qty)||0);
      totals.kcal  += it.macros.kcal  * (Number(it.qty)||0);
    }
    state.totals = totals;

    // رندر الإجمالي في الجدول
    els.t.grams.textContent = totals.grams.toFixed(0);
    els.t.carbs.textContent = totals.carbs.toFixed(1);
    els.t.prot.textContent  = totals.prot.toFixed(1);
    els.t.fat.textContent   = totals.fat.toFixed(1);
    els.t.kcal.textContent  = totals.kcal.toFixed(0);

    // تحديث هدف الكارب
    renderCarbGoal();

    // تحديث جرعة الكارب + الإجمالي
    els.doseCarb.value = calcCarbDose().toFixed(2);
    const corr = Number(els.doseCorrection.value||0);
    els.doseTotal.value = roundStep(Number(els.doseCarb.value) + corr).toFixed(2);
  }

  // رسم صف صنف واحد
  function renderItemRow(it, idx) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(it.name)}</td>
      <td><input class="home-est" value="${escapeHtml(it.homeLabel||'-')}" readonly></td>
      <td><input class="qty" type="number" min="0" step="0.5" value="${it.qty||0}" inputmode="decimal"></td>
      <td>${it.gramsPerUnit}</td>
      <td>${it.macros.carbs}</td>
      <td>${it.macros.prot}</td>
      <td>${it.macros.fat}</td>
      <td>${it.macros.kcal}</td>
      <td><button class="btn btn-light del">حذف</button></td>
    `;
    // ممنوع تعديل الجرامات
    tr.querySelectorAll("td")[3].style.opacity = .6;

    tr.querySelector(".qty").addEventListener("input", e=>{
      it.qty = Number(e.target.value || 0);
      recomputeTotals();
    });
    tr.querySelector(".del").addEventListener("click", ()=>{
      state.items.splice(idx,1);
      refreshItemsTable();
    });
    return tr;
  }

  function refreshItemsTable() {
    els.tbody.innerHTML = "";
    state.items.forEach((it, idx)=> els.tbody.appendChild(renderItemRow(it, idx)) );
    recomputeTotals();
  }

  // إضافة صنف (استخدمها بعد اختيارك من مكتبتك)
  function addItem(item) {
    // item: {id,name, gramsPerUnit, homeLabel, macros:{carbs, prot, fat, kcal}}
    state.items.push({...item, qty: 0});
    refreshItemsTable();
  }

  // زر إضافة من المكتبة (مثال فقط – بدّله بنداء مكتبتك)
  els.btn.addFromLib.addEventListener("click", ()=>{
    // مثال: أرز مسلوق 160g: كارب 44.8 / بروتين 3.2 / دهون 0.5 / 208 kcal
    addItem({
      id:"demo-rice",
      name:"أرز مسلوق",
      gramsPerUnit:160,
      homeLabel:"كوب (~160جم)",
      macros:{carbs:44.8, prot:3.2, fat:0.5, kcal:208}
    });
  });

  // التوزيع الذكي: يضبط كميات الأصناف للتقريب نحو الهدف
  els.btn.smartFill.addEventListener("click", ()=>{
    const {min,max} = state.current.carbRange;
    if (!min || !max || state.items.length === 0) return;

    // خوارزمية بسيطة: نجرب رفع الكميات تدريجيًا حتى نقترب من منتصف النطاق
    const target = (min + max)/2;
    // صفّر الكميات
    state.items.forEach(i=> i.qty = 0);
    let current = 0;
    // رتب الأصناف من الأقل للكارب في الحصة الواحدة
    const sorted = [...state.items].sort((a,b)=> a.macros.carbs - b.macros.carbs);
    outer:
    for (let round=0; round<200; round++){
      for (const it of sorted) {
        const next = current + it.macros.carbs;
        if (Math.abs(target - next) <= Math.abs(target - current)) {
          it.qty = (it.qty||0) + 1;
          current = next;
          if (current >= max) break outer;
        }
      }
    }
    refreshItemsTable();
  });

  // جرعات تلقائية عند تغيير القياس/نوع الوجبة
  function refreshDosesFromInputs() {
    // تصحيح
    const corr = calcCorrectionDose();
    if (!Number(els.doseCorrection.value)) {
      els.doseCorrection.value = corr.toFixed(2);
    }
    // كارب والإجمالي سيعاد حسابهما داخل recomputeTotals()
    recomputeTotals();
  }

  els.mealType.addEventListener("change", ()=>{ refreshActiveDosing(); recomputeTotals(); syncCarbRangeUI(); });
  els.gBefore.addEventListener("input", ()=>{ els.doseCorrection.value = calcCorrectionDose().toFixed(2); recomputeTotals(); });
  els.doseCorrection.addEventListener("input", ()=>{ recomputeTotals(); });
  els.doseCarb.addEventListener("input", ()=>{ els.doseTotal.value = roundStep(Number(els.doseCarb.value)+Number(els.doseCorrection.value||0)).toFixed(2); });

  // المساعد الذكي (stub)
  els.btn.ai.addEventListener("click", ()=>{
    alert("🤖 الشات الذكي: سنفعّله لاحقًا لشرح التصحيح والكميات اعتمادًا على بيانات الوجبة.");
  });

  // حفظ/إعادة ضبط (stub – اربطه بقاعدة بياناتك)
  els.btn.saveMeal.addEventListener("click", ()=>{
    const payload = {
      type: els.mealType.value,
      date: els.mealDate.value,
      before: Number(els.gBefore.value||0),
      after: Number(els.gAfter.value||0),
      doses: {
        correction: Number(els.doseCorrection.value||0),
        carb: Number(els.doseCarb.value||0),
        total: Number(els.doseTotal.value||0),
      },
      items: state.items.map(i=> ({id:i.id,name:i.name,qty:i.qty,gramsPerUnit:i.gramsPerUnit})),
      notes: els.notes.value||""
    };
    console.log("SAVE:", payload);
    alert("تم حفظ الوجبة (تجريبي) – اربط الحفظ بفايرستور.");
  });

  els.btn.reset.addEventListener("click", ()=>{
    els.gBefore.value = els.gAfter.value = "";
    els.doseCorrection.value = els.doseCarb.value = els.doseTotal.value = "";
    els.notes.value = "";
    state.items.forEach(i=> i.qty = 0);
    refreshItemsTable();
  });

  function syncCarbRangeUI(){
    els.carb.min.textContent = state.current.carbRange.min || "—";
    els.carb.max.textContent = state.current.carbRange.max || "—";
    renderCarbGoal();
  }

  // UTIL
  function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  // public API
  const MealsPage = {
    init(child){
      state.child = child;
      // تاريخ اليوم
      els.mealDate.valueAsDate = new Date();

      applyChildHeader();
      refreshActiveDosing();
      syncCarbRangeUI();
      refreshDosesFromInputs();
      refreshItemsTable();
    },
    addItem
  };
  window.MealsPage = MealsPage;

  // محاولة تلقائية لاستخدام __CHILD__ إن وُجد
  if (window.__CHILD__) {
    MealsPage.init(window.__CHILD__);
  }

})();
