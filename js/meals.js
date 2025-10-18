// js/food-items.js  — مقتطف رئيسي لعرض الصور من Storage عند غياب image.url
import { db, storage } from "./firebase-config.js";
import {
  collection, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { ref, getDownloadURL, uploadBytes } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

// كاش بسيط للروابط
const urlCache = new Map();
async function urlFromImage(image, fallbackPath){
  if (!image) image = {};
  if (image.url) return image.url;
  const path = image.path || fallbackPath;
  if (!path) return null;
  if (urlCache.has(path)) return urlCache.get(path);
  try{
    const u = await getDownloadURL(ref(storage, path));
    urlCache.set(path,u);
    return u;
  }catch(e){ return null; }
}

// عند بناء البطاقة:
async function buildCard(item){
  const card = document.createElement("div");
  card.className = "fi-card";
  const img = document.createElement("img");
  img.alt = item.name || "";
  const imgUrl = await urlFromImage(item.image, `food-items/items/${item.id}/main.webp`);
  if (imgUrl) img.src = imgUrl; else img.style.display="none";
  // ... اكمل بناء باقي تفاصيل البطاقة (كما في مشروعك) ...
  return card;
}

// عند الحفظ بعد رفع الصورة:
async function uploadMainImage(file, itemId){
  const ext = (file.name.split(".").pop() || "webp").toLowerCase();
  const path = `food-items/items/${itemId}/main.${ext}`;
  await uploadBytes(ref(storage,path), file);
  return { path }; // نخزن المسار فقط، العرض يقوم بترجمته إلى URL
}
