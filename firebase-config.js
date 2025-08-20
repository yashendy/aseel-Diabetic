// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// إعدادات مشروع Firebase بتاعك
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.firebasestorage.app",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};

// تهيئة Firebase
const app = initializeApp(firebaseConfig);

// تصدير الخدمات
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
