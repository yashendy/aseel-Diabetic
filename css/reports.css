/* reports-print.js */

// DOM Elements
const tbody = document.getElementById("tbody");
const unitSelect = document.getElementById("unitSelect");
const colorizeEl = document.getElementById("colorize");
const maskTreatEl = document.getElementById("maskTreat");
const fromDateEl = document.getElementById("fromDate");
const toDateEl = document.getElementById("toDate");
const notesEl = document.getElementById("notes");
const periodFromEl = document.getElementById("periodFrom");
const periodToEl = document.getElementById("periodTo");
const periodUnitEl = document.getElementById("periodUnit");
const reportNotes = document.getElementById("reportNotes");
const applyBtn = document.getElementById("applyBtn");
const printBtn = document.getElementById("printBtn");
const blankBtn = document.getElementById("blankBtn");
const backBtn = document.getElementById("backBtn");

const cName = document.getElementById("cName");
const cAge = document.getElementById("cAge");
const cWeight = document.getElementById("cWeight");
const cBasal = document.getElementById("cBasal");
const cBolus = document.getElementById("cBolus");
const cCF = document.getElementById("cCF");
const cCR = document.getElementById("cCR");

// Constants
const MGDL_PER_MMOL = 18;
let HYPO_M = 3.9;
let HYPER_M = 10.0;

const DISPLAY_ORDER = [
  "FASTING",
  "PRE_BREAKFAST","POST_BREAKFAST",
  "PRE_LUNCH","POST_LUNCH",
  "PRE_DINNER","POST_DINNER",
  "RANDOM",
  "PRE_SLEEP",
  "OVERNIGHT",
];

const CANON = {
  FASTING: ["FASTING","الاستيقاظ","صيام"],
  PRE_BREAKFAST: ["PRE_BREAKFAST","ق.الفطار","ق. الفطار"],
  POST_BREAKFAST:["POST_BREAKFAST","ب.الفطار","ب. الفطار"],
  PRE_LUNCH: ["PRE_LUNCH","ق.الغدا","ق. الغدا"],
  POST_LUNCH: ["POST_LUNCH","ب.الغدا","ب. الغدا"],
  PRE_DINNER: ["PRE_DINNER","ق.العشا","ق. العشا"],
  POST_DINNER:["POST_DINNER","ب.العشا","ب. العشا"],
  RANDOM: ["RANDOM","SNACK","سناك"],
  PRE_SLEEP: ["PRE_SLEEP","ق.النوم","ق. النوم"],
  OVERNIGHT: ["OVERNIGHT","أثناء النوم"]
};

// Helpers
const toMmol = (val, unit) => unit === "mgdl" ? (val / MGDL_PER_MMOL) : val;
const fromMmol = (mmol, unit) => unit === "mgdl" ? Math.round(mmol * MGDL_PER_MMOL) : +mmol.toFixed(1);
function classifyByMmol(mmol){ if(mmol==null||isNaN(mmol))return null; if(mmol<HYPO_M)return"low"; if(mmol>HYPER_M)return"high"; return"okv"; }
function trendArrow(currMmol, prevMmol){ if(currMmol==null||prevMmol==null)return""; const d=currMmol-prevMmol; if(Math.abs(d)<0.2)return""; return d>0?"<span class='arrow up'>▲</span>":"<span class='arrow down'>▼</span>"; }
function tsToDateKey(when){ try{ if(!when) return new Date().toISOString().slice(0,10); if(when.toDate) return when.toDate().toISOString().slice(0,10); const t=new Date(when); return isNaN(+t)? new Date().toISOString().slice(0,10):t.toISOString().slice(0,10);}catch{return new Date().toISOString().slice(0,10);} }
function inDateRange(k, from, to){ return k>=from && k<=to; }

function mkBaseRow(date){ const slots={}; DISPLAY_ORDER.forEach(k=>slots[k]={mmol:null,note:""}); return {date,slots,rowNotes:""}; }
const rows=[]; const docsSeen=new Set();

// Dummy resolveIds (firebase integration assumed)
async function resolveIds(){
  const qs=new URLSearchParams(location.search);
  let parentId=qs.get("parent");
  let childId=qs.get("child")||qs.get("cid");
  return {parentId,childId};
}

// Render
function render(){
  const unit=unitSelect.value;
  tbody.innerHTML="";
  periodUnitEl.textContent = unit === "mgdl" ? "mg/dL" : "mmol/L";
  reportNotes.textContent = notesEl.value || "";
  rows.sort((a,b)=> a.date.localeCompare(b.date));

  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const tdDate = document.createElement("td");
    tdDate.textContent = row.date || "";
    tr.appendChild(tdDate);

    DISPLAY_ORDER.forEach(key => {
      const td=document.createElement("td");
      const mmol=row.slots[key].mmol;
      const note=row.slots[key].note;
      if(mmol==null){
        td.textContent="-";
      } else {
        const cls=classifyByMmol(mmol);
        if(colorizeEl.checked && cls) td.classList.add(cls);
        const prevMmol=rows[idx-1]?.slots?.[key]?.mmol ?? null;
        const arrow=trendArrow(mmol, prevMmol);
        const valHtml=`${arrow}${fromMmol(mmol,unit)}`;
        const noteHtml=note && !maskTreatEl.checked?`<div class="cell-note">${note}</div>`:"";
        td.innerHTML=`<div class="cell-wrap">${valHtml}${noteHtml}</div>`;
      }
      tr.appendChild(td);
    });

    const tdNotes=document.createElement("td");
    tdNotes.textContent=maskTreatEl.checked?"•••":(row.rowNotes||"");
    tr.appendChild(tdNotes);
    tbody.appendChild(tr);
  });
}

function setPeriodChips(from,to){
  periodFromEl.textContent=from;
  periodToEl.textContent=to;
  periodUnitEl.textContent=(unitSelect.value==="mgdl"?"mg/dL":"mmol/L");
}

// Load data (dummy)
async function loadAll(){
  let from=fromDateEl.value;
  let to=toDateEl.value;
  if(!from) from=new Date().toISOString().slice(0,10);
  if(!to) to=new Date().toISOString().slice(0,10);

  setPeriodChips(from,to);

  rows.length=0; docsSeen.clear();
  // Dummy: 3 days sample
  ["2025-09-07","2025-09-08","2025-09-09"].forEach(d=>{
    const row=mkBaseRow(d);
    row.slots.FASTING.mmol=toMmol(Math.random()*100+80,"mgdl");
    row.slots.PRE_BREAKFAST.mmol=toMmol(Math.random()*100+90,"mgdl");
    row.slots.PRE_BREAKFAST.note="ملاحظة";
    rows.push(row);
  });
  render();
}

// Events
applyBtn.addEventListener("click", loadAll);
blankBtn.addEventListener("click", ()=>{ rows.length=0; for(let i=0;i<14;i++) rows.push(mkBaseRow("")); render(); });
printBtn.addEventListener("click", ()=>window.print());
unitSelect.addEventListener("change", render);
colorizeEl.addEventListener("change", render);
maskTreatEl.addEventListener("change", render);

if(backBtn){
  backBtn.addEventListener("click",(e)=>{
    e.preventDefault?.();
    const qs=new URLSearchParams(location.search);
    const parentId=qs.get("parent");
    const childId=qs.get("child");
    const url=parentId
      ?`reports.html?parent=${encodeURIComponent(parentId)}&child=${encodeURIComponent(childId)}`
      :`reports.html?child=${encodeURIComponent(childId)}`;
    window.location.href=url;
  });
}

// Init
(function(){
  const now=new Date();
  const start=new Date(now); start.setDate(now.getDate()-6);
  fromDateEl.value=start.toISOString().slice(0,10);
  toDateEl.value=now.toISOString().slice(0,10);
  loadAll();
})();
