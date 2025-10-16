// js/firebase-config.js — بدون App Check
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "sugar-kids-tracker.firebaseapp.com",
  projectId: "sugar-kids-tracker",
  storageBucket: "sugar-kids-tracker.appspot.com",
  appId: "YOUR_APP_ID"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
