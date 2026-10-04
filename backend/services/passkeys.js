/**
 * Passkeys (WebAuthn) for sign-in (spec 046), via @simplewebauthn/server.
 *
 * Passkeys are discoverable credentials, so signing in needs no email: the
 * browser offers the passkeys it holds for this site and the server finds
 * the account by credential ID. Only public keys are stored.
 *
 * The relying party is the site origin in FRONTEND_URL (rootsofthevalley.org in
 * production, localhost in development). Each ceremony's challenge lives in
 * the session and is consumed on first use, so a response can't be replayed.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Passkeys');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const PASSKEY_NAME_MAX = 60;

/**
 * Relying-party identity derived from the configured site origin.
 * @param {string} frontendUrl - e.g. https://rootsofthevalley.org
 * @returns {{rpID: string, origin: string, rpName: string}}
 */
function relyingParty(frontendUrl) {
  const url = new URL(frontendUrl);
  return { rpID: url.hostname, origin: url.origin, rpName: 'Roots of the Valley' };
}

function rememberChallenge(session, purpose, challenge) {
  session.webauthn = { purpose, challenge, expires: Date.now() + CHALLENGE_TTL_MS };
}

// Single use: the challenge is removed whether or not it matches.
function takeChallenge(session, purpose) {
  const pending = session.webauthn;
  delete session.webauthn;
  if (!pending || pending.purpose !== purpose || pending.expires < Date.now()) return null;
  return pending.challenge;
}

/**
 * Options for adding a passkey to a signed-in account.
 * @param {import('pg').Pool} pool
 * @param {object} session - req.session
 * @param {{id: number, email: string, name?: string}} user
 * @param {string} frontendUrl - site origin; sets the relying party
 * @returns {Promise<object>} PublicKeyCredentialCreationOptionsJSON for
 *   startRegistration() in the browser; its challenge is kept in the session
 */
export async function registrationOptions(pool, session, user, frontendUrl) {
  const { rpID, rpName } = relyingParty(frontendUrl);
  const existing = await pool.query('SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1', [user.id]);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email || `user-${user.id}`,
    userDisplayName: user.name || user.email || '',
    userID: new TextEncoder().encode(`rotv-${user.id}`),
    attestationType: 'none',
    excludeCredentials: existing.rows.map((row) => ({ id: row.credential_id, transports: row.transports || undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
  });
  rememberChallenge(session, 'register', options.challenge);
  return options;
}

/**
 * Verify a registration response and store the new passkey.
 * @param {import('pg').Pool} pool
 * @param {object} session - req.session holding the registration challenge (consumed here)
 * @param {{id: number}} user - the signed-in account the passkey is added to
 * @param {object} response - RegistrationResponseJSON from startRegistration()
 * @param {string} [name] - label shown in Settings; defaults to "Passkey"
 * @param {string} frontendUrl - site origin; must match the browser's origin
 * @returns {Promise<{id: number, name: string}|null>} the stored passkey, or null if verification failed
 */
export async function finishRegistration(pool, session, user, response, name, frontendUrl) {
  const expectedChallenge = takeChallenge(session, 'register');
  if (!expectedChallenge) return null;
  const { rpID, origin } = relyingParty(frontendUrl);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false
    });
  } catch (err) {
    logger.warn(`Passkey registration rejected: ${err.message}`);
    return null;
  }
  if (!verification.verified) return null;

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const label = String(name || '').trim().slice(0, PASSKEY_NAME_MAX) || 'Passkey';
  const stored = await pool.query(
    `INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (credential_id) DO NOTHING
     RETURNING id, name`,
    [user.id, credential.id, Buffer.from(credential.publicKey), credential.counter,
      credential.transports || null, credentialDeviceType, credentialBackedUp, label]
  );
  return stored.rows[0] || null;
}

/**
 * Options for signing in with any passkey the browser holds for this site.
 * @param {object} session - req.session; the challenge is kept there
 * @param {string} frontendUrl - site origin; sets the relying party
 * @returns {Promise<object>} PublicKeyCredentialRequestOptionsJSON for startAuthentication()
 */
export async function authenticationOptions(session, frontendUrl) {
  const { rpID } = relyingParty(frontendUrl);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  rememberChallenge(session, 'login', options.challenge);
  return options;
}

/**
 * Verify a sign-in response.
 * @param {import('pg').Pool} pool
 * @param {object} session - req.session holding the sign-in challenge (consumed here)
 * @param {object} response - AuthenticationResponseJSON from startAuthentication()
 * @param {string} frontendUrl - site origin; must match the browser's origin
 * @returns {Promise<number|null>} the user ID the passkey belongs to, or null
 */
export async function finishAuthentication(pool, session, response, frontendUrl) {
  const expectedChallenge = takeChallenge(session, 'login');
  if (!expectedChallenge || !response?.id) return null;
  const found = await pool.query(
    'SELECT id, user_id, credential_id, public_key, counter, transports FROM user_passkeys WHERE credential_id = $1',
    [String(response.id)]
  );
  const passkey = found.rows[0];
  if (!passkey) return null;

  const { rpID, origin } = relyingParty(frontendUrl);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter),
        transports: passkey.transports || undefined
      }
    });
  } catch (err) {
    logger.warn(`Passkey sign-in rejected: ${err.message}`);
    return null;
  }
  if (!verification.verified) return null;

  await pool.query(
    'UPDATE user_passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2',
    [verification.authenticationInfo.newCounter, passkey.id]
  );
  return passkey.user_id;
}

/** Trim a passkey label to what the table holds. */
export function passkeyLabel(name) {
  return String(name || '').trim().slice(0, PASSKEY_NAME_MAX);
}
