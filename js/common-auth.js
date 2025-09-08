// js/common-auth.js
import { auth, db } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

/* ===== Helpers ===== */
export function getParams() {
  const qs = new URLSearchParams(location.search);
  return { parentId: qs.get('parentId'), childId: qs.get('childId') };
}

export function saveContextToStorage(parentId, childId) {
  try { sessionStorage.setItem('lastChildCtx', JSON.stringify({ parentId, childId })); } catch {}
}
export function getContextFromStorage() {
  try {
    const raw = sessionStorage.getItem('lastChildCtx');
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (ctx?.parentId && ctx?.childId) return ctx;
  } catch {}
  return null;
}

export async function getUserRole(uid) {
  const u = await getDoc(doc(db, 'users', uid));
  return u.exists() ? (u.data()?.role ?? null) : null;
}

/* موافقة الطبيب */
function doctorConsentOK(d) {
  return (
    d?.sharingConsent === true ||
    (d?.sharingConsent && typeof d.sharingConsent === 'object' && d.sharingConsent.doctor === true) ||
    d?.shareDoctor === true
  );
}

/* الطبيب فقط */
export function ensureDoctorAccess(parentId, childId) {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      try{
        if(!user) throw new Error('not-signed-in');
        const role = await getUserRole(user.uid);
        if (role !== 'doctor') throw new Error('not-doctor');

        const ref = doc(db, `parents/${parentId}/children/${childId}`);
        const s = await getDoc(ref);
        if(!s.exists()) throw new Error('child-not-found');

        const d = s.data();
        if (d?.assignedDoctor !== user.uid || !doctorConsentOK(d)) throw new Error('forbidden');
        resolve({ user, role, childData: d });
      }catch(e){ reject(e); }
    });
  });
}

/* ✅ طبيب أو ولي أمر */
export function ensureDoctorOrParentAccess(parentId, childId) {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      try{
        if(!user) throw new Error('not-signed-in');
        const role = await getUserRole(user.uid);

        const ref = doc(db, `parents/${parentId}/children/${childId}`);
        const s = await getDoc(ref);
        if(!s.exists()) throw new Error('child-not-found');
        const d = s.data();

        const okDoctor = (role === 'doctor')
          && d?.assignedDoctor === user.uid
          && doctorConsentOK(d);

        const okParent = (role === 'parent' || user.uid === parentId)
          && user.uid === parentId; // parentId = uid لوليّ الأمر

        if (!(okDoctor || okParent)) throw new Error('forbidden');

        // خزّني السياق لفتح الصفحة لاحقًا بدون بارامترات
        saveContextToStorage(parentId, childId);

        resolve({ user, role, childData: d });
      }catch(e){ reject(e); }
    });
  });
}
