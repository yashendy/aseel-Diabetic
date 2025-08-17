import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// نتأكد إن الـ DOM اتحمّل
document.addEventListener('DOMContentLoaded', () => {
  const parentNameEl   = document.getElementById("parentName");
  const parentEmailEl  = document.getElementById("parentEmail");
  const logoutBtn      = document.getElementById("logoutBtn");
  const childrenListEl = document.getElementById("childrenList");

  // حارس الجلسة
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    // عرض بيانات ولي الأمر
    parentNameEl.innerText  = user.displayName || "ولي الأمر";
    parentEmailEl.innerText = user.email || "";

    // جلب الأطفال
    try {
      const childrenRef = collection(db, `parents/${user.uid}/children`);
      const snapshot = await getDocs(childrenRef);

      // لو فيه أطفال، نولد بطاقاتهم قبل كارت الإضافة
      snapshot.forEach((docSnap) => {
        const child = docSnap.data();
        const card = document.createElement("div");
        card.className = "child-card";
        card.innerHTML = `
          <h3>${child.name || "بدون اسم"}</h3>
          <p>النوع: ${child.gender || "-"}</p>
          <p>العمر: ${child.birthDate ? calculateAge(child.birthDate) : "-"} سنة</p>
          <button class="details-btn">عرض التفاصيل</button>
        `;
        // زر التفاصيل
        card.querySelector(".details-btn").addEventListener("click", () => {
          window.location.href = `child.html?id=${docSnap.id}`;
        });

        // إدراج البطاقة قبل كارت الإضافة (آخر عنصر)
        childrenListEl.insertBefore(card, childrenListEl.lastElementChild);
      });
    } catch (e) {
      console.error(e);
      alert("حدث خطأ أثناء تحميل الأطفال.");
    }
  });

  // تسجيل الخروج
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
  });
});

// دالة حساب العمر من تاريخ الميلاد
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
