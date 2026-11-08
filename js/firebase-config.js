// js/firebase-config.js — نسخة نهائية مجهزة بـ App Check ومفتاح reCAPTCHA Enterprise
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

// مفتاح reCAPTCHA Enterprise (Site Key)
const APP_CHECK_SITE_KEY = "6LeLoBYuAAAAAIb-j99hHQTuEEVUPJVYmbmu-mvY";

// إعدادات مشروع Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.firebasestorage.app",
  messagingSenderId: "251830888114",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab",
  measurementId: "G-L7YGX3PHLB"
};

// تهيئة تطبيق Firebase
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// تهيئة App Check بأمان
export let appCheck = null;

if (APP_CHECK_SITE_KEY && APP_CHECK_SITE_KEY.trim() !== "") {
  try {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js"
    );

    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
    console.log("App Check initialized successfully with reCAPTCHA Enterprise.");
  } catch (error) {
    console.warn("App Check failed to initialize, continuing without it:", error);
  }
}
