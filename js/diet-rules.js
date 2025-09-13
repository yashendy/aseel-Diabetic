// ===== diet-rules.js =====
// قواعد الفلترة والـ Boost حسب بروفايل الطفل

const VEGAN_CONFLICT = new Set(['meat','chicken','fish','egg','dairy','gelatin']);
const VEGETARIAN_CONFLICT = new Set(['meat','chicken','fish','gelatin']);
const GLUTEN = new Set(['wheat','barley','rye','malt','gluten']);
const LACTOSE = new Set(['dairy','milk','lactose']);
const HIGH_SUGAR = new Set(['sugary','sweetened']);
const HIGH_SODIUM = new Set(['salty','pickled']);

function hasAnyTag(food, set){
  const tags = (food?.tags||[]).map(String);
  return tags.some(t=> set.has(t));
}

// هل الصنف مسموح؟
export function isAllowedForProfile(food, profile){
  const p = profile||{};
  const flags = new Set(p.dietaryFlags||[]);
  const allergies = new Set((p.allergies||[]).map(a=>a.toLowerCase()));

  const tags = (food?.tags||[]).map(t=> String(t).toLowerCase());

  for(const a of allergies){
    if(tags.includes(a)) return false;
  }

  if(flags.has('vegan') && hasAnyTag(food, VEGAN_CONFLICT)) return false;
  if(flags.has('vegetarian') && hasAnyTag(food, VEGETARIAN_CONFLICT)) return false;
  if(flags.has('gluten_free') && hasAnyTag(food, GLUTEN)) return false;
  if(flags.has('lactose_free') && hasAnyTag(food, LACTOSE)) return false;
  if(flags.has('low_sugar') && hasAnyTag(food, HIGH_SUGAR)) return false;
  if(flags.has('low_sodium') && hasAnyTag(food, HIGH_SODIUM)) return false;

  if(flags.has('halal') && tags.includes('not_halal')) return false;

  return true;
}

// Boost إضافي في الترتيب
export function dietBoostForProfile(food, profile){
  const p = profile||{};
  const flags = new Set(p.dietaryFlags||[]);
  const preferred = new Set((p.preferred||[]).map(a=>a.toLowerCase()));
  const disliked  = new Set((p.disliked||[]).map(a=>a.toLowerCase()));

  let score = 0;
  const name = String(food?.name||"").toLowerCase();

  for(const pref of preferred){ if(name.includes(pref)) score += 6; }
  for(const dis  of disliked){  if(name.includes(dis))  score -= 6; }

  if(flags.has('vegan') && !hasAnyTag(food, VEGAN_CONFLICT)) score += 4;
  if(flags.has('vegetarian') && !hasAnyTag(food, VEGETARIAN_CONFLICT)) score += 3;
  if(flags.has('gluten_free') && !hasAnyTag(food, GLUTEN)) score += 4;
  if(flags.has('lactose_free') && !hasAnyTag(food, LACTOSE)) score += 3;
  if(flags.has('low_sugar') && !hasAnyTag(food, HIGH_SUGAR)) score += 2;
  if(flags.has('low_sodium') && !hasAnyTag(food, HIGH_SODIUM)) score += 2;

  return score;
}
