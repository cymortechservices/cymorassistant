# Troubleshooting

First look at logs: `heroku logs --tail -a your-app-name` (or the two PowerShell windows locally). Logs never contain message text or secrets.

| Symptom | Likely cause → fix |
|---|---|
| App crashes at start with `Invalid configuration: …` | A required variable is missing/too short. Compare with `backend/.env.example`. `JWT_SECRET` ≥ 16 chars; `SESSION_ENCRYPTION_KEY` ≥ 16 chars (use 64 hex). |
| `MongoServerSelectionError` | Atlas Network Access doesn't allow Heroku (add `0.0.0.0/0`), wrong password, or the password contains special characters that must be URL-encoded. |
| Can't sign in to the dashboard | Wrong `DASHBOARD_USERNAME`; `DASHBOARD_PASSWORD_HASH` not a bcrypt hash or truncated (on Windows use **single quotes** when setting it). Regenerate with `npm run hash -- "password"`. After 10 failed attempts wait 15 minutes. |
| WhatsApp page says **Worker not detected** | Worker dyno not running: `heroku ps:scale worker=1`. Locally run `npm run start:worker`. |
| QR never appears | Check worker logs. The worker waits up to ~2 min for a session lock if an old dyno is shutting down. If it exits with "Could not acquire the session lock", another worker is running — `heroku ps` and scale extras to 0. |
| QR keeps changing and never pairs | Normal until scanned (rotates ~every 20–60 s). Make sure you use *Linked devices → Link a device*, not another QR scanner, and that your phone has internet. |
| After a restart a new QR is demanded | (a) `SESSION_ENCRYPTION_KEY` changed → the app refuses to start with a decrypt error; restore the old key (or `NEWKEY,OLDKEY`). (b) The device was removed in WhatsApp or the phone was offline 14+ days → scan again. |
| Status **Session opened elsewhere** | The same account was linked by another program. Stop the other one, then press **Reconnect**. |
| Status **Failed** | Max reconnect attempts reached (network). Press **Reconnect** or restart the worker. |
| The assistant doesn't answer | Check in order: Overview shows **ON — replying** (not paused); WhatsApp **Connected**; that chat isn't in **takeover**; per-contact AI isn't off; Gemini key configured (Overview → Gemini AI); it's not a group chat. |
| It only sends "I'm having a little trouble thinking right now" | Gemini failing: wrong/blocked API key, model name invalid for your key (`GEMINI_MODEL`), or quota exceeded. See `.assistant health`. Greeting still works via built-in fallback. |
| Owner commands are ignored | The linked WhatsApp number must equal `OWNER_PHONE_NUMBER` (digits, with country code), or send commands from that number. Check the worker warns "linked WhatsApp account does not match". Unauthorized attempts appear in `/api/audit`. |
| I didn't receive a notification | `OWNER_PHONE_NUMBER` unset; notifications disabled in Settings; or WhatsApp was disconnected at the time (the request is still in **Requests**; a failed notification is retried when that contact sends their next message). |
| The AI keeps talking after I replied | Auto takeover is off in Settings, or the message was sent from the *assistant* (not recognised as yours). Use `.assistant takeover`. |
| Contacts appear with no phone number | WhatsApp identified them by a privacy ID (LID) without a number. Conversation still works. |
| Heroku build fails | Make sure Node 22 (`engines`), that `package-lock.json` exists in root, `backend/` and `frontend/`, and that the buildpack is `heroku/nodejs`. Read the first red error in the build log. |
| Frontend shows "API is running. Frontend build not found" | Run `npm run build` (locally) — on Heroku this is done by `heroku-postbuild`. |

## Resetting WhatsApp pairing completely
Dashboard → **WhatsApp → Log out & unlink**, then scan the new QR. If the dashboard is unreachable, delete the documents of collection `whatsappauths` for `sessionId: "primary"` in Atlas, and restart the worker.
