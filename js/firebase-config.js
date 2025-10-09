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

/* ------------------------------------------------------------------
   ⚙️ التهيئة الأساسية لمشروعك
------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab"
};

// منع تهيئة مكرّرة
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* ------------------------------------------------------------------
   🔐 App Check (reCAPTCHA v3)
   - تأكدي أنك سجّلتِ reCAPTCHA داخل App Check وأضفتِ الـ Secret key هناك.
   - الدومينات المسموح بها يجب أن تتضمن: yashendy.github.io (+ localhost للتجربة).
   - جرّبي الرفع و Enforce = Off، وبعد النجاح فعّليه = On.
------------------------------------------------------------------- */

// للتجربة المحلية فقط (اختياري):
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

// ✅ Site key المستخدم في الواجهة (App Check reCAPTCHA v3)
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6Leov-MrAAAAAJ982eHqf7CWxf-k1ntDF7-nDnWX"),
  isTokenAutoRefreshEnabled: true,
});

/* ------------------------------------------------------------------
   تصدير الخدمات
------------------------------------------------------------------- */
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
export { app };
