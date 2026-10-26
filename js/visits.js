// js/visits.js
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, orderBy, doc, getDoc, updateDoc, serverTimestamp, where, deleteDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

const $ = id => document.getElementById(id);
const setText = (el, v) => { if (el) el.textContent = (v == null || v === '') ? '—' : v; };

// دالة حماية النصوص ضد XSS
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function calcAge(bd) {
  if (!bd) return '-';
  const b = new Date(bd), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return Math.max(0, a);
}

const params = new URLSearchParams(location.search);
const childId = params.get('child') || localStorage.getItem('selectedChildId') || localStorage.getItem('lastChildId');
const parentIdParam = params.get('parentId');

let currentUser, childData = {};
let activeParentId = null;
let isDoctorMode = false;
let currentDoctorName = '';
let editingId = null;
let existingAttachments = [], attachmentsToDelete = [], selectedFiles = [], allVisits = [], filteredVisits = [];
let growthChart = null;

const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function dateAdd(s, days) { const d = new Date(s || new Date()); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function showLoader(v) { const el = $('appLoader'); if (el) el.style.display = v ? 'flex' : 'none'; }

const numOrNull = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const strOrNull = v => (v && String(v).trim() !== '') ? String(v).trim() : null;

// حساب مؤشر كتلة الجسم (BMI) تلقائياً عند إدخال الوزن والطول
function wireBmiCalc() {
  const calc = () => {
    const w = Number($('weight')?.value);
    const h = Number($('height')?.value);
    if (w > 0 && h > 0) {
      const hm = h / 100;
      const bmi = w / (hm * hm);
      if ($('bmi'))$('bmi').value = bmi.toFixed(1);
    } else {
      if ($('bmi'))$('bmi').value = '';
    }
  };
  $('weight')?.addEventListener('input', calc);$('height')?.addEventListener('input', calc);
}

// تكييف شريط التنقل والمسارات لفصل بيئة الطبيب عن بيئة الطفل/ولي الأمر
function adaptHeaderForRole(isDoc, parentId) {
  const safeChild = encodeURIComponent(childId);
  const safeParent = encodeURIComponent(parentId);
  const qParams = `?child=${safeChild}${isDoc ? `&parentId=${safeParent}` : ''}`;
  const workstationUrl = `doctor-child.html?child=${safeChild}&parentId=${safeParent}`;

  // تحديث الروابط المشتركة
  $('navReports')?.setAttribute('href', `reports.html${qParams}`);
  $('navLabs')?.setAttribute('href', `labs.html${qParams}`);

  const backBtn = $('backBtn');

  if (isDoc) {
    // 1. إخفاء أزرار صفحات الطفل اليومية عن الطبيب لمنع التشتت
    $('navHome')?.classList.add('hidden');
    $('navMeas')?.classList.add('hidden');$('navMeals')?.classList.add('hidden');

    // 2. إضافة زر المحطة السريرية في شريط التنقل العلوي للطبيب إن لم يكن موجوداً
    const navBar = document.querySelector('.topbar-nav');
    if (navBar && !$('navWorkstation')) {
      const wsLink = document.createElement('a');
      wsLink.id = 'navWorkstation';
      wsLink.className = 'nav-pill';
      wsLink.style.cssText = 'background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;';
      wsLink.href = workstationUrl;
      wsLink.innerHTML = '🩺 المحطة السريرية';
      navBar.insertBefore(wsLink, navBar.firstChild);
    } else if ($('navWorkstation')) {$('navWorkstation').href = workstationUrl;
      $('navWorkstation').classList.remove('hidden');
    }

    // 3. تحديث مسار التنقل (Breadcrumbs) ليخص الطبيب بدلاً من "أطفالي"
    const breadContainer = document.querySelector('.breadcrumbs');
    if (breadContainer) {
      const firstLink = breadContainer.querySelector('a');
      if (firstLink) {
        firstLink.textContent = 'بوابة الأطباء
