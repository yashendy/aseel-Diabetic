import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// 🧠 نحدد المستخدم الحالي
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
  } else {
    window.location.href = "index.html"; // يرجع لتسجيل الدخول لو مش مسجل
  }
});

// ✅ إضافة وجبة جديدة
window.addMeal = function () {
  const container = document.getElementById("mealsContainer");

  const mealDiv = document.createElement("div");
  mealDiv.innerHTML = `
    <input type="text" placeholder="اسم الوجبة" class="mealName" required />
    <input type="number" placeholder="الجرعة (وحدة)" class="mealUnits" required />
    <input type="time" class="mealTime" required />
    <hr />
  `;
  container.appendChild(mealDiv);
};

// ✅ التعامل مع الفورم
document.getElementById("childForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  // جمع البيانات
  const name = document.getElementById("name").value;
  const gender = document.getElementById("gender").value;
  const birthDate = document.getElementById("birthDate").value;
  const weight = parseFloat(document.getElementById("weight").value);
  const height = parseFloat(document.getElementById("height").value);

  const longInsulin = document.getElementById("longInsulin").value;
  const longDose = parseFloat(document.getElementById("longDose").value);
  const longTime = document.getElementById("longTime").value;

  const correctionFactor = parseFloat(document.getElementById("correctionFactor").value);
  const carbRatio = parseFloat(document.getElementById("carbRatio").value);
  const hypoLevel = parseFloat(document.getElementById("hypoLevel").value);
  const hyperLevel = parseFloat(document.getElementById("hyperLevel").value);
  const normalMin = parseFloat(document.getElementById("normalMin").value);
  const normalMax = parseFloat(document.getElementById("normalMax").value);

  const unitType = document.getElementById("unitType").value;

  // 👨‍🍳 قراءة الوجبات
  const meals = [];
  document.querySelectorAll("#mealsContainer > div").forEach((mealDiv) => {
    const mealName = mealDiv.querySelector(".mealName").value;
    const mealUnits = parseFloat(mealDiv.querySelector(".mealUnits").value);
    const mealTime = mealDiv.querySelector(".mealTime").value;

    meals.push({
      mealName,
      units: mealUnits,
      time: mealTime
    });
  });

  // بناء بيانات الطفل
  const childData = {
    name,
    gender,
    birthDate,
    weight,
    height,
    longActingDose: {
      insulin: longInsulin,
      units: longDose,
      time: longTime
    },
    mealsDoses: meals,
    correctionFactor,
    carbRatio,
    hypoLevel,
    hyperLevel,
    normalRange: {
      min: normalMin,
      max: normalMax
    },
    unitType
  };

  try {
    const childrenRef = collection(db, `parents/${currentUser.uid}/children`);
    await addDoc(childrenRef, childData);
    alert("✅ تم حفظ بيانات الطفل بنجاح!");
    window.location.href = "dashboard.html";
  } catch (error) {
    alert("❌ حدث خطأ أثناء الحفظ:\n" + error.message);
  }
});
