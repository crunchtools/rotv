import crypto from 'crypto';

// Must match the frontend slugify logic (frontend/src/utils/slug.js).
export function slugify(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

// kebab-cased name (≤60 chars) plus a short random hash suffix. Cheap
// collision avoidance for a UNIQUE column; callers retry on UniqueViolation.
export function slugifyWithSuffix(name) {
  const base = slugify(name) || 'trip';
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${base}-${suffix}`;
}
