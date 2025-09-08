// js/common-auth.js
import { auth, db } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';

/** قراءة بارامترات URL */
export function getParams() {
  const qs = new URLSearchParams(location.search);
  const parentId = qs.get('parentId');
  const childId  = qs.get('childId');
  return { parentId, childId };
}

/** جلب دور المستخدم من users/{uid} */
export async function getUserRole(uid) {
  const u = await getDoc(doc(db, 'users', uid));
  return u.exists() ? (u.data()?.role ?? null) : null;
}

/**
 * Gate: تأكيد أن المستخدم طبيب ومصرَّح له بالاطلاع على الطفل
 */
export function ensureDoctorAccess(parentId, childId) {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      try{
        if(!user) throw new Error('not-signed-in');
        const role = await getUserRole(user.uid);
        if (role !== 'doctor') throw new Error('not-doctor');

        const childRef = doc(db, `parents/${parentId}/children/${childId}`);
        const snap = await getDoc(childRef);
        if (!snap.exists()) throw new Error('child-not-found');

        const d = snap.data();
        const consentOK =
          d?.sharingConsent === true ||
          (d?.sharingConsent && typeof d.sharingConsent === 'object' && d.sharingConsent.doctor === true) ||
          d?.shareDoctor === true;

        if (d?.assignedDoctor !== user.uid || !consentOK) {
          throw new Error('forbidden');
        }
        resolve({ user, childData: d });
      }catch(e){
        reject(e);
      }
    });
  });
}
