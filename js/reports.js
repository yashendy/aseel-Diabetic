import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const params = new URLSearchParams(location.search);
const childId = params.get('child');

onAuthStateChanged(auth, async (user) => {
  if (!user) return location.href = 'index.html';
  if (!childId) {
    alert('لا يوجد معرف طفل');
    history.back();
    return;
  }

  // لو عايزة تحطي أي إعدادات أو تحميل بيانات التقارير القديمة هنا
});

// 🔹 إضافة زر "تحليل القياسات"
document.addEventListener("DOMContentLoaded", () => {
  const container = document.querySelector(".container") || document.body;

  const btn = document.createElement("button");
  btn.textContent = "📊 تحليل القياسات";
  btn.className = "btn primary";
  btn.style.marginTop = "15px";

  btn.addEventListener("click", () => {
    location.href = `analytics.html?child=${childId}`;
  });

  container.appendChild(btn);
});
