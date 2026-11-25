import { auth } from './firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { db } from './firebase-config.js';

// تحقق من المستخدم الحالي
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }

  // التحقق من الدور
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists() || snap.data().role !== "admin") {
    alert("🚫 ليس لديك صلاحية الدخول إلى لوحة الأدمن");
    location.href = "index.html";
  }
});

// تسجيل الخروج
function logout() {
  signOut(auth).then(() => {
    location.href = "index.html";
  });
}
window.logout = logout;
