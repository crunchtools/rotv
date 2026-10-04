/**
 * Removes accounts whose email was never confirmed (spec 046).
 *
 * Email sign-ups can be used right away, so an address can be claimed by
 * someone who doesn't own it. Leaving those accounts in place forever would
 * let the address stay squatted, so anything unconfirmed after
 * UNCONFIRMED_DAYS is deleted with the same path as self-service deletion.
 */

import { deleteUserAccount } from './accountDeletion.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('UnconfirmedCleanup');

const UNCONFIRMED_DAYS = 30;
// Per run; a larger backlog continues on the next day's run.
const BATCH_SIZE = 200;

/**
 * Delete accounts left unconfirmed for longer than UNCONFIRMED_DAYS, oldest
 * first, up to BATCH_SIZE per run. Each goes through deleteUserAccount so its
 * sessions and newsletter rows go with it. Admin accounts are never touched.
 * @param {import('pg').Pool} pool
 * @returns {Promise<number>} how many accounts were deleted
 */
export async function deleteStaleUnconfirmedAccounts(pool) {
  const stale = await pool.query(
    `SELECT id FROM users
     WHERE email_verified_at IS NULL
       AND created_at < NOW() - make_interval(days => $1)
       AND is_admin IS NOT TRUE
     ORDER BY created_at
     LIMIT $2`,
    [UNCONFIRMED_DAYS, BATCH_SIZE]
  );
  // One account at a time on purpose: each deletion is its own transaction
  // (sessions, newsletter rows, cascades), so one bad row can't block the rest,
  // and a daily batch of at most BATCH_SIZE is small.
  let deleted = 0;
  for (const { id } of stale.rows) {
    try {
      // Fix: rechecked under the row lock, so an account confirmed after the
      // SELECT above is kept (PR #714 review).
      if (await deleteUserAccount(pool, id, { unconfirmedForDays: UNCONFIRMED_DAYS })) deleted += 1;
    } catch (err) {
      logger.error(`Could not delete unconfirmed account ${id}: ${err.message}`);
    }
  }
  if (deleted) logger.info(`Deleted ${deleted} account(s) unconfirmed for over ${UNCONFIRMED_DAYS} days`);
  return deleted;
}
