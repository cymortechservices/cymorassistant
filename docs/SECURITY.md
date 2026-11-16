# Security report

Scope: what the code does to protect credentials, owner access, conversations and the WhatsApp session, and what it **cannot** protect against. Items marked ✅ are covered by automated tests that were executed; ⚠️ are implemented but only verifiable in a live deployment.

## 1. Secrets
- No secret is hard-coded. Configuration is read from environment variables (Heroku Config Vars) and validated at start-up (`backend/src/config`); the app refuses to start with missing or weak values. ✅
- `.env` is git-ignored; only `backend/.env.example` (names only) is committed.
- Logs redact keys, tokens, passwords, credentials and message bodies (`pino` redaction); WhatsApp's own logger is silenced so Signal key material is never printed.
- The dashboard never returns secrets: Settings shows "configured (hidden)" and the settings API rejects unknown keys such as `GEMINI_API_KEY`. ✅

## 2. WhatsApp session (the most sensitive asset)
- Stored in MongoDB, **not** on Heroku's ephemeral disk. Each credential/key is a separate document encrypted with **AES-256-GCM** using `SESSION_ENCRYPTION_KEY` (random 12-byte IV per write, authentication tag detects tampering). ✅ (crypto) / ⚠️ (against a live Mongo — `tests/integration`)
- If the key is wrong, the worker refuses to start rather than silently creating a new session.
- **Key rotation:** set `SESSION_ENCRYPTION_KEY="NEWKEY,OLDKEY"` (comma-separated, newest first). New writes use the first key; reads try all. Once every record has been rewritten (or after you re-pair), remove the old key. ✅ (unit test)
- **Backup & recovery:** the worker keeps the last 5 encrypted credential snapshots (`WhatsAppBackup`) after every successful connection; `restoreLatestBackup()` restores the newest. Also back up the encryption key itself (password manager) and enable Atlas backups. Without the key the data is unreadable by design.
- **Single owner:** a MongoDB lease lock (`WorkerLock`, renewed every 20 s, expires after 60 s) ensures only one worker holds the session; a second worker waits then exits. If the lock is lost the connection is closed to avoid a duplicate login. ⚠️
- Graceful shutdown flushes queued key writes **before** closing the socket (SIGTERM from Heroku). ✅

## 3. Dashboard & API
- One administrator account. Password stored only as a **bcrypt** hash; username compared in constant time; identical error for wrong user or password. ✅
- Session = JWT (HS256, 12 h) in an **httpOnly, SameSite=Strict, Secure (production)** cookie — unreadable by page scripts. ✅
- **CSRF:** every state-changing request must carry an `X-CSRF-Token` bound to the session. ✅
- **Rate limiting:** 10 logins / 15 min per IP; 240 API calls / min. ✅ (login limiter exercised indirectly; thresholds in code)
- `helmet` security headers with a strict CSP (`default-src 'self'`), no `X-Powered-By`; CORS limited to `APP_BASE_URL`. ✅
- **The QR code is only returned by an authenticated endpoint** (`GET /api/whatsapp/status`, `Cache-Control: no-store`) and only while fresh (< 60 s). ✅ (unauthenticated access returns 401)
- All inputs validated with zod; settings use a strict whitelist; errors never leak internals.
- Audit log (`AuditLog`) for logins, setting changes, commands, takeovers, deletions; viewable via `/api/audit`. ✅

## 4. Owner authority
- Owner = a message that WhatsApp itself marks as coming from the owner: (a) typed on the linked account **and** that account's number equals `OWNER_PHONE_NUMBER`, or (b) sent from `OWNER_PHONE_NUMBER`. Display names, message text and claims like "I am the owner" are ignored. ✅
- Commands go to a command parser, **never** to the AI, and AI output never reaches the command parser (the reply guard also blocks AI text that starts with `.assistant` or claims to be the owner). ✅
- Command replies are sent only to the owner's own chat, never to a customer. ✅
- Non-owner `.assistant …` attempts are logged to the audit trail and treated as ordinary untrusted chat text. ✅

## 5. AI safety
- Rules and business facts live in the **system instruction**; customer text is passed only inside `<contact_message>` tags with delimiter-like text neutralised, and is labelled untrusted. ✅
- Output must be JSON matching a schema; unknown categories/priorities are coerced; the AI may only propose state transitions the state machine allows (it cannot place a chat into HUMAN_TAKEOVER). ✅
- The assistant must not invent prices, addresses, numbers, deadlines, guarantees or any KUCCPS cluster points/cut-offs; no numeric KUCCPS data exists in the code. It never asks for passwords/OTPs. These are *instructions to the model* — they reduce, not eliminate, the chance of a wrong answer. **Review the first conversations, and keep the owner in the loop for anything consequential.**
- The footer is appended by code, not by the model. ✅

## 6. Data protection & privacy
- Stored per contact: JID, phone number, display name, message text, collected request details. No media is downloaded. Voice notes/images get a polite "please type it" reply.
- Retention: `retentionDays` (default 90) purges old messages nightly; **Delete contact data** in the dashboard removes a contact's conversation, messages and requests. ✅ (flow test; DB version in integration tests)
- Contacts' messages are sent to Google's Gemini API to generate replies — mention this in your privacy notice if required (Kenya Data Protection Act, 2019).
- Never send MongoDB, Gemini or WhatsApp credentials by chat or email; rotate them if exposed.

## 7. Known residual risks
1. **Unofficial WhatsApp API** — account restrictions are possible.
2. **Single admin credential** — use a long unique password; there is no 2FA in this release.
3. MongoDB network access `0.0.0.0/0` (Atlas) relies on the DB password; use static IPs if you can.
4. Heroku Config Vars are readable by anyone with access to the Heroku app.
5. Prompt injection can never be fully excluded for any LLM; mitigations above limit what a successful injection can do (no tools, no commands, no data access beyond the current conversation).
