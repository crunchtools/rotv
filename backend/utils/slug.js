import crypto from 'crypto';

export function slugifyWithSuffix(name) {
  const base = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60) || 'trip';
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${base}-${suffix}`;
}
