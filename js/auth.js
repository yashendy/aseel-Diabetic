// توحيد منطق الدخول/التسجيل/الاسترجاع + إنشاء users/{uid} + توجيه حسب الدور
(function(){
  const auth = firebase.auth();
  const db   = firebase.firestore();

  const toastEl = document.getElementById('toast');
  const showToast = (s)=>{ if(!toastEl) return; toastEl.textContent=s; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'),1800); };

  // توجيه حسب الدور
  function routeByRole(role){
    switch((role||'parent').toLowerCase()){
      case 'admin':  location.href='admin-doctors.html'; break;
      case 'doctor': location.href='doctor-dashboard.html'; break;
      default:       location.href='parent.html'; // parent
    }
  }

  // قراءة وثيقة المستخدم، وإن لم توجد ننشئها كوليّ أمر
  async function ensureUserDoc(u, extra){
    const ref = db.doc(`users/${u.uid}`);
    const snap = await ref.get();
    if (snap.exists) return snap.data();

    const data = {
      name: u.displayName || extra?.name || null,
      email: u.email || null,
      role: 'parent',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      emailVerified: !!u.emailVerified
    };
    await ref.set(data, { merge:true });
    return data;
  }

  // مراقبة الحالة العامة: لو المستخدم داخل بالفعل → وجّهه حسب الدور
  auth.onAuthStateChanged(async (u)=>{
    // لو نحن بالفعل في صفحات auth و المستخدم داخل، نعمل توجيه فوري
    if (u && isAuthPage()){
      try{
        const me = await ensureUserDoc(u);
        routeByRole(me.role);
      }catch(e){
        console.error(e);
        routeByRole('parent');
      }
    }
  });

  function isAuthPage(){
    const p = location.pathname;
    return /login\.html$|register\.html$|forgot\.html$|index\.html$/.test(p);
  }

  /* ========== تسجيل الدخول ========== */
  const loginForm = document.getElementById('loginForm');
  if (loginForm){
    loginForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const pass  = document.getElementById('loginPassword').value;
      try{
        const { user } = await auth.signInWithEmailAndPassword(email, pass);
        const me = await ensureUserDoc(user);
        showToast('تم تسجيل الدخول ✅');
        routeByRole(me.role);
      }catch(err){
        console.error(err);
        showToast(mapAuthError(err));
      }
    });
  }

  /* ========== إنشاء حساب ========== */
  const regForm = document.getElementById('registerForm');
  if (regForm){
    regForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const name  = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const pass  = document.getElementById('regPassword').value;

      try{
        const { user } = await auth.createUserWithEmailAndPassword(email, pass);
        // تحديث الاسم المعروض
        await user.updateProfile({ displayName: name });
        // إنشاء وثيقة المستخدم كـ parent افتراضيًا
        const me = await ensureUserDoc({ uid:user.uid, email:user.email, displayName:name, emailVerified:user.emailVerified }, { name });
        showToast('تم إنشاء الحساب ✅');
        // (اختياري) إرسال تأكيد بريد
        try{ if(!user.emailVerified) await user.sendEmailVerification(); }catch(_){}
        routeByRole(me.role); // parent
      }catch(err){
        console.error(err);
        showToast(mapAuthError(err));
      }
    });
  }

  /* ========== استرجاع كلمة السر ========== */
  const forgotForm = document.getElementById('forgotForm');
  if (forgotForm){
    forgotForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = document.getElementById('forgotEmail').value.trim();
      try{
        await auth.sendPasswordResetEmail(email);
        showToast('تم إرسال رابط الاسترجاع إلى بريدك ✉️');
      }catch(err){
        console.error(err);
        showToast(mapAuthError(err));
      }
    });
  }

  function mapAuthError(e){
    const c = e?.code || '';
    if (c.includes('user-not-found')) return 'الحساب غير موجود';
    if (c.includes('wrong-password')) return 'كلمة السر غير صحيحة';
    if (c.includes('too-many-requests')) return 'محاولات كثيرة، جرّب لاحقًا';
    if (c.includes('network-request-failed')) return 'تعذّر الاتصال بالإنترنت';
    if (c.includes('email-already-in-use')) return 'هذا البريد مُسجَّل بالفعل';
    if (c.includes('invalid-email')) return 'بريد غير صالح';
    if (c.includes('weak-password')) return 'كلمة السر ضعيفة';
    return 'حدث خطأ غير متوقع';
  }
})();
