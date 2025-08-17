import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// 🔁 التحقق من تسجيل الدخول
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("parentName").innerText = user.displayName || "ولي الأمر";
    document.getElementById("parentEmail").innerText = user.email;

    const childrenList = document.getElementById("childrenList");

    const childrenRef = collection(db, `parents/${user.uid}/children`);
    const snapshot = await getDocs(childrenRef);

    snapshot.forEach((doc) => {
      const child = doc.data();
      const card = document.createElement("div");
      card.className = "child-card";
      card.innerHTML = `
        <h3>${child.name}</h3>
        <p>النوع: ${child.gender}</p>
        <p>العمر: ${calculateAge(child.birthDate)} سنة</p>
        <button onclick="goToChild('${doc.id}')">عرض التفاصيل</button>
      `;
      childrenList.insertBefore(card, childrenList.lastElementChild); // قبل كارت الإضافة
    });

  } else {
    // إعادة توجيه لتسجيل الدخول لو مش مسجل
    window.location.href = "index.html";
  }
});

// 🧠 تسجيل الخروج
document.getElementById("logoutBtn").addEventListener("click", () => {
  signOut(auth).then(() => {
    window.location.href = "index.html";
  });
});

// 🔁 حساب العمر من تاريخ الميلاد
function calculateAge(birthDateStr) {
  const birthDate = new Date(birthDateStr);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// 📎 الانتقال إلى صفحة الطفل
window.goToChild = function (childId) {
  window.location.href = `child.html?id=${childId}`;
}

