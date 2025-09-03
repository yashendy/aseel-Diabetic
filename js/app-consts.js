// =============================
// 🔹 Application Constants
// =============================

// صلاحية الكود بالساعات (ممكن تغيرها هنا بسهولة)
export const LINK_CODE_TTL_HOURS = 48;

// الحد الأقصى للأكواد غير المستخدمة لكل دكتور
export const MAX_ACTIVE_LINK_CODES = 5;

// أسماء المجموعات في Firestore (نستخدمها لتوحيد المسارات)
export const COL_USERS   = 'users';
export const COL_DOCTORS = 'doctors';
export const COL_LINK_CODES = 'linkCodes';
export const COL_PARENTS = 'parents';

// أسماء الحقول القياسية
export const FIELD_ASSIGNED_DOCTOR      = 'assignedDoctor';
export const FIELD_ASSIGNED_DOCTOR_INFO = 'assignedDoctorInfo';

// 🔹 Helper: حساب صلاحية الكود (يضيف الساعات للوقت الحالي)
export function generateExpiryDate(hours = LINK_CODE_TTL_HOURS) {
  const now = new Date();
  now.setHours(now.getHours() + hours);
  return now;
}
