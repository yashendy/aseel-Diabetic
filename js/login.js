import { auth } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// DOM Elements
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

// تسجيل الدخول
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("✅ تم تسجيل الدخول بنجاح");
window.location.href = "parent.html";
  } catch (error) {
    alert("❌ حدث خطأ في تسجيل الدخول\n" + error.message);
  }
});

// تسجيل حساب جديد
registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("register-name").value;
  const email = document.getElementById("register-email").value;
  const password = document.getElementById("register-password").value;
  const confirm = document.getElementById("register-confirm").value;

  if (password !== confirm) {
    alert("❌ كلمتا المرور غير متطابقتين");
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });
    alert("✅ تم إنشاء الحساب بنجاح");
    window.location.href = "dashboard.html";
  } catch (error) {
    alert("❌ حدث خطأ في التسجيل\n" + error.message);
  }
});
