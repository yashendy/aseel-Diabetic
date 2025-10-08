// js/firebase-config.js
// Firebase Modular v12 (CDN)

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
// (اختياري لاحقًا لو هترفعي ملفات للـ Storage)
import { getStorage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab"
};

// منع تهيئة مكررة لو الملف اتستورد أكتر من مرة
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// تصدير صريح بالأسماء — مهم لصفحاتك
export const auth = getAuth(app);
export const db   = getFirestore(app);
// export const storage = getStorage(app); // فعّليه لما تحتاجي رفع ملفات
