// js/firebase-config.js
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyBs6rFN0JH26Yz9tiGdBcFK8ULZ2zeXiq4",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.firebasestorage.app",
  appId: "1:251830888114:web:a20716d3d4ad86a6724bab"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Site key الخاص بـ App Check (بعد التسجيل)
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6Leov-MrAAAAAJ982eHqf7CWxf-k1ntDF7-nDnWX"),
  isTokenAutoRefreshEnabled: true,
});

export const auth = getAuth(app);
export const db   = getFirestore(app);
export const storage = getStorage(app);
export { app };
