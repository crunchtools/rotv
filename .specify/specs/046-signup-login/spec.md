# Spec 046: Sign-up and sign-in

## Why
Accounts were created silently on the first Google or emailed-code sign-in, and returning meant another email every time. People expect the familiar pattern: Sign up / Sign in, then Google or email, with a password or a passkey. Modeled on Khan Academy.

## User stories
- As a visitor, I choose **Sign up**, then Google or email. With email I enter my full name, an optional username, how I want to appear (name or username), my email, and a password or a passkey, tick "13 or older" and the Terms/Privacy box, and optionally the newsletter. I can use the account immediately.
- As a new account holder, I get a confirmation email (link + code, valid 7 days). Until I confirm, my favorites, visits, trips and settings work; nothing goes out (no newsletter) and a banner reminds me.
- As a returning visitor, I choose **Sign in**, then Google or email: a password, a passkey (also offered in the email field's autofill), or an emailed code. The code is also "forgot password".
- As someone whose first sign-in came through Google or an emailed code, I finish sign-up once on `/welcome` (name, username, show-as, consents).
- In Settings › Your Account I edit my profile, see whether my email is confirmed, add/rename/remove passkeys, and set/change/remove my password.

## Behavior
- Pages: `/signup`, `/login`, `/welcome`, `/terms` (admin-editable, `admin_settings.about_terms_md`, server-rendered `<noscript>` like `/privacy`). The header menu shows only Sign up and Sign in.
- Usernames: 3–30 letters, digits, `-` or `_`, starting with a letter; unique ignoring case; a reserved list is refused.
- Passwords: scrypt (N=2^15, r=8, p=3, per-password salt; 32 MiB per hash, bounded by the 4-thread libuv pool), stored as `scrypt$N$r$p$salt$hash` in `user_passwords` and upgraded on login if the parameters were weaker. 12–128 characters; known-breached passwords are refused through the Have I Been Pwned range API (only a 5-character SHA-1 prefix leaves the server; the check is skipped if the API is down). Wrong password and unknown email get the same answer. Admin accounts can't have a password.
- Passkeys: WebAuthn discoverable credentials via `@simplewebauthn`. The relying party is the `FRONTEND_URL` host. Only public keys are stored (`user_passkeys`). Challenges live in the session for 5 minutes and are single-use.
- Changing a password or passkey needs a sign-in within the last 15 minutes (`req.session.authAt`); otherwise the API answers 403 `{reauth: true}`.
- Rate limits: sign-up 10/hour per IP and 3 per 15 minutes per address; password sign-in 10 per 15 minutes per IP and 5 per address; passkey sign-in 30 per 15 minutes per IP; resend confirmation 3/hour per account.
- Sign-up reveals that an address already has an account (409), because the account is usable at once and can't be hidden the way email sign-in hides it.

## Unconfirmed accounts
- Account pre-hijacking guard: Google, Facebook and emailed-code sign-ins link by email to an existing account. If that account is unconfirmed, the verified owner takes it over: passwords, passkeys, sessions and the newsletter opt-in added before confirmation are removed, and the person sees a one-time notice. The account's own confirmation link (purpose `confirm`) confirms without removing anything, because the creator often confirms on another device. The confirmation page also offers **I didn't create this account** (`POST /auth/email/reject {token}`), which deletes the unconfirmed account with its password and passkeys; the confirmation email points to it.
- Accepted risk (product decision: use now, confirm later): a confirmation link proves the mailbox, not who set the password or passkey, so if an address owner confirms a sign-up someone else made with their email, that person's credentials survive. Binding confirmation to the creator's browser would wipe the credentials of everyone who signs up on one device and confirms on another (the common case). Mitigations: the email and page say what to do if you didn't create the account, "I didn't create this account" deletes it, and the account holds only personal map data (favorites, visits, trips). Requiring confirmation before first use would remove the risk entirely.
- The newsletter opt-in is held until confirmation, then sent to Buttondown (which runs its own double opt-in).
- A daily job (`unconfirmed-account-cleanup`, 04:15 ET) deletes accounts unconfirmed for 30 days, through the same path as self-service deletion.
- Accounts that existed before this spec were marked confirmed and finished (migration 093).

## Routes
All bodies are JSON. Errors are `{error}` with a message for the person; rate limits answer 429.

| Route | Auth | Request | Success | Errors |
|---|---|---|---|---|
| `POST /auth/signup` | — | `name, username?, displayPreference ('name'\|'username'), email, method ('password'\|'passkey'), password?, ageConfirmed, termsAccepted, newsletter` | 201 `{success, method}`, signed in, confirmation emailed | 400 invalid field/consent/password policy; 409 email or username taken |
| `GET /auth/username-available?username=` | — | — | `{available, error}` | — |
| `POST /auth/password/login` | — | `email, password` | `{success}`, signed in | 401 same message for wrong password, unknown email, or admin account |
| `PUT /auth/password` | fresh | `password` | `{success}` | 400 policy; 403 admin or `{reauth: true}` |
| `DELETE /auth/password` | fresh | — | `{success}` | 403 `{reauth: true}` |
| `POST /auth/passkey/register/options` | fresh | — | WebAuthn creation options | 403 `{reauth: true}` |
| `POST /auth/passkey/register/verify` | fresh | `response, name?` | 201 `{success, passkey: {id, name}}` | 400 verification failed or challenge expired |
| `POST /auth/passkey/login/options` | — | — | WebAuthn request options | — |
| `POST /auth/passkey/login/verify` | — | `response` | `{success}`, signed in | 401 unknown passkey, bad signature, or replay |
| `GET /auth/methods` | signed in | — | `{hasPassword, passwordAllowed, passkeys: [{id, name, createdAt, lastUsedAt}]}` | — |
| `PATCH /auth/passkeys/:id` | signed in | `name` | `{success}` | 400 empty name; 404 not yours |
| `DELETE /auth/passkeys/:id` | fresh | — | `{success}` | 403 `{reauth: true}`; 404 not yours |
| `PUT /auth/profile` | signed in | `name, username?, displayPreference` | `{success}` | 400 invalid; 409 username taken |
| `POST /auth/complete-signup` | signed in | `name, username?, displayPreference, ageConfirmed, termsAccepted, newsletter` | `{success}` | 400 invalid or consent missing; 409 username taken |
| `POST /auth/email/reject` | — | `token` (a sign-up confirmation link's) | `{success}`, the unconfirmed account and its credentials are deleted | 400 invalid, used, or a sign-in (not confirmation) token; 409 the account is already confirmed, so it was kept |
| `POST /auth/confirm-email/resend` | signed in | — | `{success, message}` | 400 already confirmed; 501 mail off; 502 send failed |

`GET /auth/providers` adds `password: true` and `passkey: true` alongside `google`, `facebook` and `email`. "fresh" means signed in within the last 15 minutes. `POST /auth/email/verify` now also returns `{confirmed, needsSignupCompletion}`. `/auth/user` adds `username`, `displayName`, `displayPreference`, `emailVerified`, `needsSignupCompletion` and a one-time `notice` (`credentials_reset`).
