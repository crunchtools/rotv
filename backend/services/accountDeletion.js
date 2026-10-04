/**
 * Self-service account deletion (#700).
 *
 * Removes a user and everything personal tied to them in one transaction:
 * - Tables that own per-user data (favorites, visits, trips, identities,
 *   notification reads, subscriptions) reference users ON DELETE CASCADE.
 * - Contribution and moderation columns (submitted_by, moderated_by,
 *   updated_by) are ON DELETE SET NULL (migration 091). Published
 *   contributions stay on the site — uploaders license them to ROTV — but are
 *   detached from the account.
 * - Local newsletter analytics rows keyed by the account email are removed.
 *   Buttondown remains the source of truth for the subscription itself.
 * - Every login session for the account is dropped, on all devices.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('AccountDeletion');

/**
 * Delete a user account and its personal data in one transaction.
 *
 * @param {import('pg').Pool} pool - pg pool; a dedicated client is checked out for the transaction.
 * @param {number|string} userId - users.id of the account to delete.
 * @param {{unconfirmedForDays?: number}} [options] - when set, delete only if the
 *   account is still unconfirmed and older than this many days (0: any age),
 *   checked under the row lock, so an account confirmed meanwhile is kept
 *   (spec 046 cleanup and "I didn't create this account").
 * @returns {Promise<boolean>} true when the account was deleted, false if no such
 *   user exists or it no longer matches the condition.
 * @throws Rethrows any database error after rolling back, leaving the account intact.
 */
export async function deleteUserAccount(pool, userId, { unconfirmedForDays = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = unconfirmedForDays === null
      ? await client.query('SELECT id, email FROM users WHERE id = $1 FOR UPDATE', [userId])
      : await client.query(
        `SELECT id, email FROM users
         WHERE id = $1 AND email_verified_at IS NULL AND created_at < NOW() - make_interval(days => $2)
         FOR UPDATE`,
        [userId, unconfirmedForDays]
      );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    const { email } = existing.rows[0];

    if (email) {
      await client.query('DELETE FROM newsletter_subscriptions WHERE LOWER(email) = LOWER($1)', [email]);
    }

    await client.query(
      `DELETE FROM sessions WHERE sess -> 'passport' ->> 'user' = $1`,
      [String(userId)]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    logger.info(`Deleted user account ${userId}`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr) =>
      logger.error(`Rollback after failed deletion of user ${userId} also failed:`, rollbackErr));
    throw err;
  } finally {
    client.release();
  }
}
