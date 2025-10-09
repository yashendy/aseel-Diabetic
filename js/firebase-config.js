// js/firebase-config.js
// Firebase v12 (CDN) + App Check (reCAPTCHA v3)

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage }    from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js";

// ✅ إعدادات مشروعك (زي ما هي)
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab"
};

// تهيئة التطبيق مرة واحدة
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* ------------------------------------------------------------------
   App Check (reCAPTCHA v3)
   ملاحظات مهمة:
   1) في Firebase Console → App Check → sugarKidsWeb → Register reCAPTCHA
      ضيفي الـ Secret Key (اللي جيبتيه من Google reCAPTCHA).
   2) بعد التسجيل هتلاقي **Site key** داخل App Check — انسخيه.
   3) استبدلي النص RECAPTCHA_SITE_KEY_HERE بالـ Site key الحقيقي.
   4) خلى Storage → App Check Enforcement = Off مؤقتًا للتجربة،
      وبعد نجاح الرفع فعّليه = On.
------------------------------------------------------------------- */

// للتطوير المحلي فقط (اختياري):
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

// 🔐 فعّلي App Check بالـ Site Key
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("RECAPTCHA_SITE_KEY_HERE"),
  isTokenAutoRefreshEnabled: true,
});

// تصدير الخدمات لاستخدامها في بقية الصفحات
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
export { app };
