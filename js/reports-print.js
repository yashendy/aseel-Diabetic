// reports-print.js

const tbody = document.getElementById("tbody");
const unitSelect = document.getElementById("unitSelect");
const colorize = document.getElementById("colorize");
const maskTreat = document.getElementById("maskTreat");
const weeklyMode = document.getElementById("weeklyMode");
const manualMode = document.getElementById("manualMode");

const periodFrom = document.getElementById("periodFrom");
const periodTo = document.getElementById("periodTo");
const periodUnit = document.getElementById("periodUnit");

const applyBtn = document.getElementById("applyBtn");
const blankBtn = document.getElementById("blankBtn");
const printBtn = document.getElementById("printBtn");

let data = [];
let hypoThreshold = 3.9; // mmol/L
let hyperThreshold = 10.0; // mmol/L

function fromMmol(v, unit) {
  return unit === "mgdl" ? Math.round(v * 18) : v;
}

function toMmol(v, unit) {
  return unit === "mgdl" ? v / 18 : v;
}

function classify(valueMmol) {
  if (valueMmol < hypoThreshold) return "HYPO";
  if (valueMmol > hyperThreshold) return "HYPER";
  return "NORMAL";
}

function renderTable() {
  tbody.innerHTML = "";
  const unit = unitSelect.value;

  data.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.date}</td>`;

    ["breakfast", "lunch", "dinner", "bedtime"].forEach((slot, i) => {
      const td = document.createElement("td");
      const value = row[slot];
      if (value != null) {
        const mmol = toMmol(value, unit);
        const classification = classify(mmol);
        let cls = "";
        if (colorize.checked) {
          if (classification === "HYPO") cls = "cell-hypo";
          else if (classification === "HYPER") cls = "cell-hyper";
          else cls = "cell-normal";
        }

        let arrow = "";
        if (rowIndex > 0) {
          const prev = data[rowIndex - 1][slot];
          if (prev != null) {
            const prevMmol = toMmol(prev, unit);
            if (mmol - prevMmol > 0.2) arrow = `<span class="arrow-up">▲</span>`;
            else if (prevMmol - mmol > 0.2) arrow = `<span class="arrow-down">▼</span>`;
          }
        }

        td.className = cls;
        td.innerHTML = `${arrow}${fromMmol(mmol, unit)} ${unit === "mgdl" ? "mg/dL" : "mmol/L"}`;
      } else {
        td.innerHTML = "-";
      }
      tr.appendChild(td);
    });

    const tdNotes = document.createElement("td");
    tdNotes.textContent = maskTreat.checked ? "***" : (row.notes || "");
    tr.appendChild(tdNotes);

    tbody.appendChild(tr);
  });

  periodUnit.textContent = unit === "mgdl" ? "mg/dL" : "mmol/L";
}

applyBtn.addEventListener("click", () => {
  // هنا بنحمل البيانات من Firestore أو مصدر آخر
  // حاليًا بيانات تجريبية
  data = [
    { date: "2025-09-01", breakfast: 5.5, lunch: 8.2, dinner: 11.5, bedtime: 6.3, notes: "OK" },
    { date: "2025-09-02", breakfast: 3.2, lunch: 7.8, dinner: 12.1, bedtime: 4.0, notes: "Hypo قبل الفطور" },
    { date: "2025-09-03", breakfast: 4.9, lunch: 9.0, dinner: 15.2, bedtime: 5.5, notes: "Hyper بعد الغداء" }
  ];
  renderTable();
});

blankBtn.addEventListener("click", () => {
  data = Array.from({ length: 14 }, (_, i) => ({
    date: "",
    breakfast: null,
    lunch: null,
    dinner: null,
    bedtime: null,
    notes: ""
  }));
  renderTable();
});

printBtn.addEventListener("click", () => window.print());

unitSelect.addEventListener("change", renderTable);
colorize.addEventListener("change", renderTable);
maskTreat.addEventListener("change", renderTable);
