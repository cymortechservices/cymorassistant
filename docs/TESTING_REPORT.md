# Testing report

Environment: Linux sandbox, Node 22, **no access** to WhatsApp, Google Gemini, MongoDB (download host blocked), Heroku or GitHub. Run in a *clean room*: project zipped without `node_modules`, unpacked into an empty folder, `npm ci` from the lockfiles, then the suite executed.

## Result of the executed run
| | Count |
|---|---|
| Tests executed and **passed** | **136** |
| Tests **failed** | **0** |
| Tests **skipped** (need a real MongoDB; not run) | **22** |

| File | Passed | What it covers |
|---|---|---|
| `unit/core.test.js` | 29 | AES-GCM session encryption + key rotation, phone/JID normalisation, footer formatter, state machine, **owner verification**, reconnect backoff, KUCCPS module, config validation, command parsing |
| `unit/ai.test.js` | 21 | Valid structured output, invalid JSON (+ one re-ask), timeout, 429 retry/backoff, API failure, non-retryable errors, missing history, **prompt-injection** handling, impersonation guard |
| `unit/whatsapp.test.js` | 15 | Mock Baileys socket: connect, **QR event & refresh**, successful pairing, credential persistence events, reconnect with saved session, restart-required, **logout/revoked → wipe + new QR**, bad session, connection replaced, max attempts, message forwarding, graceful flush-before-close, dashboard-requested logout |
| `unit/message-handler.test.js` | 16 | Message-type mapping, routing, **authorised vs unauthorised commands**, spoofed owner claims, command replies never reach customers, owner reply → takeover, groups/status/echo/stale/history ignored |
| `unit/api-auth.test.js` | 12 | Dashboard login, cookie flags, CSRF, forged cookies, **QR endpoint not public**, secrets never returned, settings validation, security headers, CORS |
| `unit/conversation-flow.test.js` | 43 | First-message greeting & footer, wellbeing, request capture/persist-before-confirm, **KUCCPS and website classification**, notifications (once, retry, preferences), friendly chat, goodbye, **automation off / pause**, **human takeover** (manual, auto, release, inactivity), owner commands, AI failure fallback/no-spam, duplicate IDs, burst/loop guard, media replies, delete contact data |
| `integration/database.test.js` | 0 (22 skipped) | **Real MongoDB**: unique indexes, duplicate prevention, contact/conversation/request persistence, encrypted auth-state round-trip, key rotation, backup/restore, worker lock exclusivity, settings persistence |

Mutation check: deliberately breaking the owner check and the footer made 16 tests fail; restoring them made the suite green again (so the tests do detect regressions).

## How the database-dependent behaviour was tested here
No MongoDB server could be started (the download host is blocked by the sandbox), so `conversation-flow.test.js` runs against an **in-memory fake** with real filter/update/unique-key semantics (`tests/helpers/fake-db.js`). That verifies application logic, **not MongoDB itself**. Index behaviour (unique `(jid, waMessageId)`, partial index), schema enums, `populate`, and the encrypted auth store against Mongo are covered only by the 22 skipped integration tests. One piece was checked separately: Baileys credentials survive `BufferJSON` serialisation + AES-GCM encryption intact.

## Other verification performed
- Frontend: `vite build` succeeds (≈92 KB gzipped JS).
- Express serves the built dashboard, SPA fallback, JS assets, and returns 401 for unauthenticated API calls.
- A **real** Baileys 7.0.0-rc14 socket was constructed with the exact options used by the connection module and attempted to reach WhatsApp (failed only because the sandbox cannot resolve `web.whatsapp.com`) — confirms API compatibility, **not** that pairing works.
- Production-style install (`npm ci --omit=dev` for backend) imports the app; the worker fails fast with a clear message when configuration is missing.
- Gemini SDK fields used (`systemInstruction`, `responseMimeType`, `abortSignal`, `usageMetadata.promptTokenCount/candidatesTokenCount`, `response.text`) were checked against the installed SDK's type definitions.

## NOT verified — you must test these
1. **Real WhatsApp QR pairing**, session persistence across a real restart, real message send/receive, deleting a command from a customer's chat, linked-account/LID behaviour.
2. **Live Gemini replies**: model name `gemini-2.5-flash` (configurable), JSON output compliance and answer quality/tone with your real key.
3. **MongoDB Atlas**: run `npm run test:integration` (see README) — 22 tests.
4. **Heroku deployment** (`heroku-postbuild`, web + worker dynos, restart behaviour, config vars).
5. Dashboard in a real browser on desktop and phone (built and served, but not visually inspected).
6. Daily-summary and retention schedulers (code only, no test).

## Known limitations
- Unofficial WhatsApp API (account-restriction risk). Group chats ignored. Voice notes / images / documents are not processed — the contact is asked to type; transcription is not implemented (optional in the brief).
- Owner "manual reply" detection treats any non-bot `fromMe` message as the owner (cannot tell phone from another linked device).
- Single admin user, no 2FA. English/Kiswahili behaviour depends on the model.
- `Message.timestamp` ordering and analytics aggregations were not exercised against a real database.
