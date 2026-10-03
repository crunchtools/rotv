# Spec 045: Email sign-in

## Why
Facebook Login needs Meta business verification, which waits on a registered ROTV nonprofit (#700). Google-only sign-in shuts out everyone without a Google account. Email sign-in has no third-party gatekeeper.

## User stories
- As a visitor without Google, I enter my email, get one message with a link and a 6-digit code, and I'm signed in by either.
- As someone browsing on a laptop who reads email on a phone, I type the code instead of opening the link.
- As an existing Google user, signing in by email with the same address lands me in the same account.

## Behavior
- `POST /auth/email/start {email}` answers the same for every valid address, so it never reveals whether an account exists. It returns 501 when mail is not configured and 502 if the relay rejects the message.
- `POST /auth/email/verify {token}` or `{email, code}` signs in with `req.login` (the session is regenerated).
- The link is `/signin#token=…`. The token is in the fragment, so it never reaches the server, proxy logs or analytics, and the page strips it from the address bar. Signing in takes a click, because mail scanners prefetch links and would otherwise consume the token.
- Links and codes are single-use and expire after `email_login_ttl_minutes` (admin Settings › Users, default 30, allowed 5–60). Only the newest request's code is accepted, with 5 wrong guesses per request.
- Rate limits: start is 5/hour per IP, 3 per 15 minutes and 10/day per address; verify is 30 per 15 minutes per IP.
- Only digests are stored (`email_login_tokens`, migration 092): SHA-256 for link tokens, HMAC keyed from SESSION_SECRET for codes, so a database copy alone cannot recover live codes.
- New accounts use provider `email` with the normalized address. Existing accounts link by email through `findOrCreateUser`.

## Delivery
`backend/services/mailer.js` uses SMTP from the environment, DKIM-signed with selector `rotv1`. In production it relays through `mail.crunchtools.com` (Postfix on lotor, which queues and retries). SPF, DKIM and DMARC are published for `rootsofthevalley.org`. Moving to a hosted provider only means changing `SMTP_*`.
