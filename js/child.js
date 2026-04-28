// js/child.js — نسخة محسّنة
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---- childId ---- */
const params  = new URLSearchParams(location.search);
let   childId = params.get('child') || localStorage.getItem('lastChildId');
if (!childId) { location.replace('parent.html?pickChild=1'); throw new Error('Missing child id'); }
localStorage.setItem('lastChildId', childId);

/* ---- DOM ---- */
const $ = id => document.getElementById(id);
const loaderEl        = $('loader');
const childNameEl     = $('childName');
const childMetaEl     = $('childMeta');
const chipRangeEl     = $('chipRange');
const chipCREl        = $('chipCR');
const chipCFEl        = $('chipCF');
const todayMeasuresEl = $('todayMeasures');
const todayMealsEl    = $('todayMeals');
const nextVisitEl     = $('nextVisit');
const miniMeasuresEl  = $('miniMeasures');
const miniMealsEl     = $('miniMeals');
const miniFollowUpEl  = $('miniFollowUp');
const goMeasurements  = $('goMeasurements');
const goMeals         = $('goMeals');
const goFoodItems     = $('goFoodItems');
const goReports       = $('goReports');
const goVisits        = $('goVisits');
const goChildEdit     = $('goChildEdit');
const infoName        = $('infoName');
const infoAge         = $('infoAge');
const infoGender      = $('infoGender');
const infoWeight      = $('infoWeight');
const infoHeight      = $('infoHeight');
const infoDevice      = $('infoDevice');
const infoInsulin     = $('infoInsulin');
const infoRange       = $('infoRange');
const infoCR          = $('infoCR');
const infoCF          = $('infoCF');
const labCard         = $('labCard');
const labHba1cVal     = $('labHba1cVal');
const labHba1cDelta   = $('labHba1cDelta');
const labLastSince    = $('labLastSince');
const labLastDate     = $('labLastDate');
const labDueBadge     = $('labDueBadge');
const openLabsBtn     = $('openLabsBtn');
const openLastPdfBtn  = $('openLastPdfBtn');
const addLabBtn       = $('addLabBtn');
const progressFill    = $('progressFill');
const progressLabel   = $('progressLabel');

/* ---- أدوات ---- */
function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function calcAge(bd){
  if(!bd) return '-';
  const b=new Date(bd),t=new Date(); let a=t.getFullYear()-b.getFullYear();
  const m=t.getMonth()-b.getMonth();
  if(m<0||(m===0&&t.getDate()<b.getDate())) a--; return a;
}
function loader(show){ loaderEl?.classList.toggle('hidden',!show); }
function setText(el,v){ if(el) el.textContent=(v==null||v==='')?'—':v; }
function setHref(el,url){ if(el) el.href=url; }
function fmt(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${d.getDate().toString().padStart(2,'0')}`; }
function dayDiff(a,b){ return Math.ceil((a-b)/86400000); }
function addMonths(date,m=4){
  const d=new Date(date); const day=d.getDate();
  d.setMonth(d.getMonth()+m);
  if(d.getDate()<day) d.setDate(0); return d;
}
function monthsDaysBetween(from,to){
  let m=(to.getFullYear()-from.getFullYear())*12+(to.getMonth()-from.getMonth());
  let anchor=addMonths(from,m);
  if(to.getDate()<from.getDate()){m-=1;anchor=addMonths(from,m);}
  const d=Math.max(0,dayDiff(to,anchor)); return {months:Math.max(0,m),days:d};
}
function formatCountdown(baseDate,dueDate){
  const dLeft=dayDiff(dueDate,baseDate);
  if(dLeft<0) return `متأخر ${Math.abs(dLeft)} يوم`;
  if(dLeft===0) return 'اليوم';
  const md=monthsDaysBetween(baseDate,dueDate); const parts=[];
  if(md.months>0) parts.push(`${md.months} شهر`);
  if(md.days>0) parts.push(`${md.days} يوم`);
  return `باقي ${parts.join(' و ')}`;
}

/* ---- وقت الوجبة الحالي ---- */
function currentMeal(){
  const h=new Date().getHours();
  if(h>=5  && h<10)  return {key:'b', label:'الفطور'};
  if(h>=12 && h<15)  return {key:'l', label:'الغداء'};
  if(h>=18 && h<21)  return {key:'d', label:'العشاء'};
  return {key:'s', label:'سناك'};
}

/* ---- حالة الجلوكوز ---- */
function glucoseState(v, child){
  if(v==null) return null;
  const nr=child.normalRange||{};
  const critLow  = nr.criticalLow  ?? child.criticalLow  ?? 3.0;
  const critHigh = nr.criticalHigh ?? child.criticalHigh ?? 14.0;
  const low  = nr.min ?? child.hypo  ?? 3.9;
  const high = nr.max ?? child.hyper ?? 10.0;
  if(v<=critLow)  return {cls:'crit-low',  label:'حرج منخفض', color:'#dc2626'};
  if(v>=critHigh) return {cls:'crit-high', label:'حرج مرتفع', color:'#dc2626'};
  if(v<low)       return {cls:'low',       label:'منخفض',      color:'#3b82f6'};
  if(v>high)      return {cls:'high',      label:'مرتفع',      color:'#f59e0b'};
  return              {cls:'ok',        label:'طبيعي',      color:'#10b981'};
}

function pointColors(readings, child){
  return readings.map(r => glucoseState(r, child)?.color ?? '#10b981');
}

/* ============================================================
   Sparkline الجلوكوز
   ============================================================ */
async function renderGlucoseSparkline(uid, child){
  const container = $('glucoseSparkContainer');
  if(!container) return;

  // جلب آخر 7 أيام
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate()-7);

  const ref  = collection(db,`parents/${uid}/children/${childId}/measurements`);
  const snap = await getDocs(query(ref, orderBy('when','desc'), limit(50)));

  if(snap.empty){
    container.innerHTML = '<p style="color:#94a3b8;font-size:13px;padding:8px 0">لا توجد قراءات بعد</p>';
    return;
  }

  const points = snap.docs.map(d=>{
    const data = d.data();
    const val  = data.value_mmol ?? (data.value && data.unit==='mmol/L' ? data.value
                 : data.value_mgdl ? +(data.value_mgdl/18).toFixed(1) : null);
    const when = data.when?.toDate ? data.when.toDate() : new Date(data.when);
    return { val, when, slotKey: data.slotKey, state: data.state };
  }).filter(p=>p.val!=null).reverse(); // تصاعدي زمنياً

  if(!points.length){ container.innerHTML = '<p style="color:#94a3b8;font-size:13px">لا توجد قراءات صالحة</p>'; return; }

  // آخر قراءة
  const last = points[points.length-1];
  const gs   = glucoseState(last.val, child);
  const unit = child.glucoseUnit || 'mmol/L';

  // إحصائيات
  const vals   = points.map(p=>p.val);
  const avg    = (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1);
  const minVal = Math.min(...vals).toFixed(1);
  const maxVal = Math.max(...vals).toFixed(1);
  const nr     = child.normalRange||{};
  const low    = nr.min ?? child.hypo  ?? 3.9;
  const high   = nr.max ?? child.hyper ?? 10.0;
  const inRange= vals.filter(v=>v>=low&&v<=high).length;
  const tir    = Math.round(inRange/vals.length*100);

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;font-weight:600;color:#0f172a">📊 منحنى الجلوكوز — آخر 7 أيام</span>
        <span style="background:${gs?.color??'#10b981'}22;color:${gs?.color??'#10b981'};border:1px solid ${gs?.color??'#10b981'}44;
              padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600">
          ${last.val} ${unit} — ${gs?.label??''}
        </span>
      </div>
      <a href="measurements.html?child=${encodeURIComponent(childId)}"
         style="font-size:12px;color:#2563eb;text-decoration:none">عرض كل القراءات ←</a>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:#0f172a">${avg}</div>
        <div style="font-size:11px;color:#64748b">متوسط</div>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:8px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:#1e40af">${minVal}</div>
        <div style="font-size:11px;color:#64748b">الأدنى</div>
      </div>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:8px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:#92400e">${maxVal}</div>
        <div style="font-size:11px;color:#64748b">الأعلى</div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:#065f46">${tir}%</div>
        <div style="font-size:11px;color:#64748b">في النطاق</div>
      </div>
    </div>

    <div style="position:relative;height:100px">
      <canvas id="glucoseSparkCanvas"></canvas>
    </div>

    <div style="margin-top:8px;background:#f1f5f9;border-radius:6px;overflow:hidden;height:10px;display:flex">
      <div style="width:${Math.round(vals.filter(v=>v<low).length/vals.length*100)}%;background:#3b82f6;height:100%"></div>
      <div style="width:${tir}%;background:#10b981;height:100%"></div>
      <div style="width:${Math.round(vals.filter(v=>v>high).length/vals.length*100)}%;background:#f59e0b;height:100%"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:#94a3b8">
      <span style="color:#3b82f6">منخفض</span>
      <span style="color:#10b981">في النطاق (${tir}%)</span>
      <span style="color:#f59e0b">مرتفع</span>
    </div>
  `;

  // رسم الـ Chart
  const colors = pointColors(vals, child);
  const ctx = $('glucoseSparkCanvas')?.getContext('2d');
  if(!ctx) return;

  const labels = points.map(p=>{
    const d=p.when;
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  new Chart(ctx,{
    type:'line',
    data:{
      labels,
      datasets:[{
        data: vals,
        borderColor:'#6366f1',
        borderWidth:1.5,
        pointBackgroundColor: colors,
        pointBorderColor: colors,
        pointRadius: vals.length>30 ? 2 : 4,
        pointHoverRadius:6,
        tension:0.35,
        fill:{target:'origin',above:'rgba(99,102,241,0.05)'}
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{
          label: ctx=>`${ctx.parsed.y} ${unit}`,
          title: ctx=>labels[ctx[0].dataIndex]
        }}
      },
      scales:{
        x:{ display:false },
        y:{
          min: Math.max(0, Math.min(...vals)-1),
          max: Math.max(...vals)+1,
          ticks:{font:{size:10},color:'#94a3b8'},
          grid:{color:'#f1f5f9'},
          border:{display:false}
        }
      }
    }
  });
}

/* ============================================================
   التشغيل الرئيسي
   ============================================================ */
document.getElementById('logoutBtn')?.addEventListener('click',()=>signOut(auth).catch(()=>{}));

onAuthStateChanged(auth, async (user)=>{
  if(!user){ location.href='index.html'; return; }
  try{
    loader(true);
    const childRef = doc(db,`parents/${user.uid}/children/${childId}`);
    const snap = await getDoc(childRef);
    if(!snap.exists()){
      alert('لم يتم العثور على الطفل');
      localStorage.removeItem('lastChildId');
      location.replace('parent.html?pickChild=1'); return;
    }
    const c = snap.data();
    localStorage.setItem('lastChildId', childId);

    /* ---- هيدر ---- */
    setText(childNameEl, c.name||'طفل');
    setText(childMetaEl, `${c.gender||'-'} • العمر: ${calcAge(c.birthDate)} سنة`);

    const min = Number(c.normalRange?.min ?? 4.4);
    const max = Number(c.normalRange?.max ?? 7.8);
    const cf  = c.correctionFactor != null ? Number(c.correctionFactor) : null;

    // CR/CF حسب وقت الأكل الحالي
    const meal  = currentMeal();
    const crNow = c.carbRatioByMeal?.[meal.key] ?? c.carbRatio ?? '—';
    const cfNow = c.correctionFactorByMeal?.[meal.key] ?? cf ?? '—';

    setText(chipRangeEl, `النطاق الطبيعي: ${min}–${max} ${c.glucoseUnit||'mmol/L'}`);
    setText(chipCREl,    `CR (${meal.label}): ${crNow} g/U`);
    setText(chipCFEl,    `CF (${meal.label}): ${cfNow} mmol/L per U`);

    /* ---- ملخص بيانات الطفل ---- */
    const weightStr = c.weightKg!=null?`${c.weightKg} كجم`:c.weight!=null?`${c.weight} كجم`:'—';
    const heightStr = c.heightCm!=null?`${c.heightCm} سم`:c.height!=null?`${c.height} سم`:'—';
    const devType   = c.device?.type||null;
    const devName   = c.device?.name||c.deviceName||null;
    const devModel  = c.device?.model||null;
    let deviceStr   = devName||devType||'—';
    if(devType&&devName) deviceStr=`${devType} — ${devName}`;
    if(devModel) deviceStr+=` (${devModel})`;
    const bolus     = c.insulin?.bolusType||c.insulinBolusType||c.insulinType||null;
    const basal     = c.insulin?.basalType||c.insulinBasalType||null;
    let insulinStr  = '—';
    if(bolus||basal){
      insulinStr=`${bolus?`Bolus: ${bolus}`:''}${(bolus&&basal)?' • ':''}${basal?`Basal: ${basal}`:''}`;
    }

    setText(infoName,    c.name??'—');
    setText(infoAge,     calcAge(c.birthDate));
    setText(infoGender,  c.gender??'—');
    setText(infoWeight,  weightStr);
    setText(infoHeight,  heightStr);
    setText(infoDevice,  deviceStr);
    setText(infoInsulin, insulinStr);
    setText(infoRange,   `${min}–${max} ${c.glucoseUnit||'mmol/L'}`);
    setText(infoCR,      `${crNow} g/U`);
    setText(infoCF,      cfNow!=null&&cfNow!='—'?`${cfNow} mmol/L/U`:'—');

    /* ---- روابط ---- */
    setHref(goMeasurements,`measurements.html?child=${encodeURIComponent(childId)}`);
    setHref(goMeals,       `meals.html?child=${encodeURIComponent(childId)}`);
    setHref(goFoodItems,   `food-items.html?child=${encodeURIComponent(childId)}`);
    setHref(goReports,     `reports.html?child=${encodeURIComponent(childId)}`);
    setHref(goVisits,      `visits.html?child=${encodeURIComponent(childId)}`);
    localStorage.setItem('selectedParentId',user.uid);
    localStorage.setItem('selectedChildId',childId);
    setHref(goChildEdit,`child-edit.html?parentId=${encodeURIComponent(user.uid)}&id=${encodeURIComponent(childId)}`);

    /* ---- إحصائيات اليوم (مظبوطة مع الـ Timestamps والتحديث اللحظي) ---- */
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const todayStrFormat = todayStr();

    const measRef  = collection(db,`parents/${user.uid}/children/${childId}/measurements`);
    const mealsRef = collection(db,`parents/${user.uid}/children/${childId}/meals`);
    const visRef   = collection(db,`parents/${user.uid}/children/${childId}/visits`);

    // 1. عداد القياسات (باستخدام حقل when والتحديث اللحظي)
    onSnapshot(query(measRef, where('when', '>=', startOfDay), where('when', '<', endOfDay)), (snap) => {
      setText(todayMeasuresEl, snap.size);
      setText(miniMeasuresEl,  snap.size);
    });

    // 2. عداد الوجبات (بافتراض إنها محفوظة بحقل date كنص)
    onSnapshot(query(mealsRef, where('date', '==', todayStrFormat)), (snap) => {
      setText(todayMealsEl, snap.size);
      setText(miniMealsEl,  snap.size);
    });

    // 3. أقرب متابعة طبية (Get عادية لأنها مش بتتغير كتير)
    const snapVisit = await getDocs(query(visRef, where('date','>=',todayStrFormat), orderBy('date','asc'), limit(1)));
    let displayFollow = '—';
    if(!snapVisit.empty){
      const nf  = snapVisit.docs[0].data().date||'—';
      const due = new Date(nf);
      displayFollow = `${nf} — ${formatCountdown(new Date(), due)}`;
    }
    setText(nextVisitEl, displayFollow);
    setText(miniFollowUpEl, displayFollow);

    /* ---- Sparkline الجلوكوز ---- */
    await renderGlucoseSparkline(user.uid, c);

    /* ---- التحاليل ---- */
    await renderLabCard(user.uid);

    addLabBtn?.addEventListener('click',e=>{ e.stopPropagation(); location.href=`labs.html?child=${encodeURIComponent(childId)}`; });
    openLabsBtn?.addEventListener('click',e=>{ e.stopPropagation(); location.href=`labs.html?child=${encodeURIComponent(childId)}`; });
    openLastPdfBtn?.addEventListener('click',async e=>{
      e.stopPropagation();
      const lastId=await getLastLabId(user.uid);
      if(lastId) window.open(`labs.html?child=${encodeURIComponent(childId)}&lab=${encodeURIComponent(lastId)}`,'_blank');
      else location.href=`labs.html?child=${encodeURIComponent(childId)}`;
    });

  }catch(err){ console.error(err); alert('حدث خطأ غير متوقع'); }
  finally{ loader(false); }
});

/* ---- بطاقة التحاليل ---- */
async function getLastLabId(uid){
  const sn=await getDocs(query(collection(db,`parents/${uid}/children/${childId}/labs`),orderBy('when','desc'),limit(1)));
  return sn.empty?null:sn.docs[0].id;
}

async function renderLabCard(uid){
  if(!labCard) return;
  const sn=await getDocs(query(collection(db,`parents/${uid}/children/${childId}/labs`),orderBy('when','desc'),limit(4)));
  const labs=sn.docs.map(d=>({id:d.id,...d.data()}));

  if(!labs.length){
    setText(labHba1cVal,'—'); if(labHba1cVal) labHba1cVal.className='value tone';
    setText(labHba1cDelta,'لا توجد بيانات');
    setText(labLastSince,'—'); setText(labLastDate,'—');
    setText(labDueBadge,'لا توجد تقارير بعد'); if(labDueBadge) labDueBadge.className='pill tiny';
    if(progressFill) progressFill.style.width='0%'; setText(progressLabel,'—');
    if(window._spark) window._spark.destroy(); return;
  }

  const last=labs[0], prev=labs[1]||null;
  const when=last.when?.toDate?last.when.toDate():(last.date?new Date(last.date):new Date());
  setText(labLastDate,fmt(when));
  setText(labLastSince,`${dayDiff(new Date(),when)} يوم`);
  const hba=last?.hba1c?.value;
  if(hba==null||Number.isNaN(Number(hba))){
    setText(labHba1cVal,'—'); if(labHba1cVal) labHba1cVal.className='value tone';
  } else {
    const v=Number(hba); setText(labHba1cVal,`${v.toFixed(1)}%`);
    let tone='good'; if(v>=7.5&&v<=9) tone='mid'; if(v>9) tone='bad';
    if(labHba1cVal) labHba1cVal.className=`value tone ${tone}`;
  }
  if(prev?.hba1c?.value!=null&&hba!=null){
    const pv=Number(prev.hba1c.value);
    if(!Number.isNaN(pv)){
      const diff=Number(hba)-pv; const sign=diff>0?'+':(diff<0?'−':'±');
      setText(labHba1cDelta,`مقارنة بالسابق: ${sign}${Math.abs(diff).toFixed(1)}%`);
      if(labHba1cVal) labHba1cVal.title=`السابق: ${pv.toFixed(1)}% • الفرق: ${sign}${Math.abs(diff).toFixed(1)}%`;
    }
  } else { setText(labHba1cDelta,'—'); if(labHba1cVal) labHba1cVal.title='—'; }

  const nextDue=last.nextDue?.toDate?last.nextDue.toDate():addMonths(when,4);
  const daysToDue=dayDiff(nextDue,new Date());
  if(daysToDue<0){ setText(labDueBadge,`متأخر — ${fmt(nextDue)}`); if(labDueBadge) labDueBadge.className='pill tiny bad'; }
  else if(daysToDue<=14){ setText(labDueBadge,`قرب الموعد — ${fmt(nextDue)}`); if(labDueBadge) labDueBadge.className='pill tiny warn'; }
  else { setText(labDueBadge,`التحليل القادم: ${fmt(nextDue)}`); if(labDueBadge) labDueBadge.className='pill tiny ok'; }

  const totalDays=Math.max(1,dayDiff(nextDue,when));
  const passedDays=Math.max(0,Math.min(totalDays,dayDiff(new Date(),when)));
  const pct=Math.round((passedDays/totalDays)*100);
  if(progressFill) progressFill.style.width=`${pct}%`;
  setText(progressLabel,`${passedDays} / ${totalDays} يوم (${pct}%)`);

  const sorted=[...labs].reverse();
  const chartLabels=sorted.map(l=>{const d=l.when?.toDate?l.when.toDate():(l.date?new Date(l.date):new Date());return fmt(d);});
  const chartData=sorted.map(l=>{const v=l?.hba1c?.value;return(v==null||Number.isNaN(Number(v)))?null:Number(v);});
  if(window._spark) window._spark.destroy();
  const ctx=document.getElementById('hbaSpark')?.getContext('2d');
  if(!ctx) return;
  window._spark=new Chart(ctx,{
    type:'line',
    data:{ labels:chartLabels, datasets:[{data:chartData,borderColor:'#8E24AA',backgroundColor:'rgba(142,36,170,0.08)',pointRadius:1.5,tension:.25,fill:false,spanGaps:true}] },
    options:{ responsive:true, plugins:{legend:{display:false},tooltip:{enabled:true}}, elements:{point:{hitRadius:6}}, scales:{x:{display:false},y:{display:false,suggestedMin:5,suggestedMax:12}} }
  });
}
