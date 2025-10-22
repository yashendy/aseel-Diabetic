# db-schema (منصّة السكر) — مصدر الحقيقة
> التزم بهذه الأسماء حرفيًا. أي تغيير اسم يتم بتذكرة Rename منفصلة.

## users
| field        | type     | required | notes                        |
|--------------|----------|----------|------------------------------|
| uid          | string   | ✓        | معرّف المنصة                 |
| role         | string   | ✓        | one of: admin, doctor, parent, child |
| name         | string   | ✓        |                              |
| phone        | string   |          |                              |
| email        | string   |          |                              |
| createdAt    | timestamp| ✓        |                              |
| updatedAt    | timestamp| ✓        |                              |

## children
| field        | type     | required | notes                              |
|--------------|----------|----------|------------------------------------|
| id           | string   | ✓        |                                    |
| parentUid    | string   | ✓        | يشير لـ users.uid                  |
| name         | string   | ✓        |                                    |
| gender       | string   |          |                                    |
| birthDate    | date     |          |                                    |
| createdAt    | timestamp| ✓        |                                    |
| updatedAt    | timestamp| ✓        |                                    |

## food_items
| field            | type     | required | notes                                |
|------------------|----------|----------|--------------------------------------|
| id               | string   | ✓        |                                      |
| name             | string   | ✓        | اسم الصنف                            |
| category         | string   |          | حبوب/ألبان/حلويات...                 |
| unit             | string   |          | g, ml, قطعة...                       |
| weight_grams     | number   |          | وزن الحصة الافتراضي بالجرام          |
| carbs_100g       | number   |          | كارب بالجرام لكل 100g                |
| protein_100g     | number   |          |                                       |
| fat_100g         | number   |          |                                       |
| kcal_100g        | number   |          |                                       |
| GI               | number   |          | اختياري                               |
| GL               | number   |          | اختياري                               |
| imageUrl         | string   |          | رابط صورة بالمخزن                     |
| ownerUid         | string   |          | لو الصفحة مقيّدة بالمستخدم            |
| createdAt        | timestamp| ✓        |                                       |
| updatedAt        | timestamp| ✓        |                                       |

## meals
| field        | type     | required | notes                                 |
|--------------|----------|----------|---------------------------------------|
| id           | string   | ✓        |                                       |
| childId      | string   | ✓        | يشير لـ children.id                   |
| date         | date     | ✓        |                                       |
| timeSlot     | string   | ✓        | before_breakfast/after_breakfast/...  |
| items        | array    | ✓        | [{foodItemId, grams, carbs, kcal}]    |
| notes        | string   |          |                                       |
| createdAt    | timestamp| ✓        |                                       |
| updatedAt    | timestamp| ✓        |                                       |

## visits
| field        | type     | required | notes                      |
|--------------|----------|----------|----------------------------|
| id           | string   | ✓        |                            |
| childId      | string   | ✓        |                            |
| visitDate    | date     | ✓        |                            |
| weight       | number   |          |                            |
| height       | number   |          |                            |
| hba1c        | number   |          |                            |
| doctorNotes  | string   |          |                            |
| createdAt    | timestamp| ✓        |                            |
| updatedAt    | timestamp| ✓        |                            |

## storage paths (صور)
- **food items images:** `/food-items/{uid}/{filename}`
- قراءة: عام/حسب القواعد الحالية — كتابة: المالك فقط.

> TODO: لو عندك مجموعات إضافية (analytics/…)، نزودها هنا بنفس الجدول.
