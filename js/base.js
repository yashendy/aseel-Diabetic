<!-- js/base.js (ESM Module) -->
<script type="module">
  import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
  import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

  // ✅ إعدادات مشروعك
  const firebaseConfig = {
    apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
    authDomain: "sugar-kids-tracker.firebaseapp.com",
    projectId: "sugar-kids-tracker",
    storageBucket: "sugar-kids-tracker.firebasestorage.app",
    messagingSenderId: "251830888114",
    appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
    measurementId: "G-L7YGX3PHLB"
  };

  // init once + جهّز Firestore جلوبال
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  window.db = getFirestore(app);

  // اختياري: لوج بسيط للتحقق
  console.log("✅ Firebase initialized. db =", window.db?.constructor?.name);
</script>
