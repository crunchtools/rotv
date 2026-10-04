/**
 * Newsletter opt-in from sign-up (spec 046).
 *
 * The box on the sign-up form is stored on the account and only sent to
 * Buttondown once the address is confirmed, so nobody can subscribe an
 * address they don't own. Buttondown then runs its own double opt-in.
 */

import { addSubscriber } from './buttondownClient.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SignupNewsletter');

/**
 * Subscribe a confirmed account that opted in, then clear the opt-in so it's
 * only sent once. Failures are logged, never thrown: sign-in must not depend on
 * the newsletter service.
 * @param {import('pg').Pool} pool
 * @param {{id: number, email: string, newsletter_opt_in: boolean, email_verified_at: string|null}} user
 * @returns {Promise<boolean>} true when a subscription was sent
 */
export async function releaseNewsletterOptIn(pool, user) {
  if (!user?.newsletter_opt_in || !user.email_verified_at || !user.email) return false;
  try {
    await addSubscriber(user.email, pool);
    await pool.query(
      'INSERT INTO newsletter_subscriptions (email, source) VALUES ($1, $2)',
      [user.email, 'signup']
    );
    await pool.query('UPDATE users SET newsletter_opt_in = FALSE WHERE id = $1', [user.id]);
    return true;
  } catch (err) {
    logger.error(`Newsletter opt-in for user ${user.id} failed: ${err.message}`);
    return false;
  }
}
