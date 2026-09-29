import { ipKeyGenerator } from 'express-rate-limit';

// Fix: shared by the favorites, trips and visited write limiters instead of three copies (PR #687 review)
// Signed-in users are limited per account; anyone else per IP, with IPv6 collapsed to its /56.
export function userOrIpKey(req) {
  return req.user && req.user.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip);
}
