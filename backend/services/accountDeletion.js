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
 * @returns {Promise<boolean>} true when the account was deleted, false if no such user exists.
 * @throws Rethrows any database error after rolling back, leaving the account intact.
 */
export async function deleteUserAccount(pool, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id, email FROM users WHERE id = $1 FOR UPDATE', [userId]);
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
