// firebase-config.js (v8 compat)

// 🔥 إعدادات Firebase الخاصة بمشروعك
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};

// ✅ تهيئة Firebase
firebase.initializeApp(firebaseConfig);

// 📦 الخدمات اللي هنحتاجها
const auth = firebase.auth();
const db   = firebase.firestore();

// 📤 إتاحة المتغيرات للاستخدام في باقي الملفات
window.auth = auth;
window.db   = db;
