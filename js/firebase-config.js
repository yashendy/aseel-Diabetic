// js/firebase-config.js
// Firebase Modular v12 (CDN) — ملف تهيئة موحّد لكل الصفحات

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage }    from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

// ✅ القيم الحقيقية لمشروعك
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",   // مهم للرفع/الصور
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab"
};

// منع تهيئة مكررة لو الملف اتستورد أكثر من مرة
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// تصدير موحّد تُستخدمه كل الصفحات
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
