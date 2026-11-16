# WhatsApp QR pairing guide

## How it works
1. The **worker** starts a Baileys connection. With no saved session it receives a QR code from WhatsApp.
2. The worker stores the current QR in MongoDB (short-lived) — **never** exposed publicly.
3. The **web** dashboard, for a signed-in administrator only, converts it into an image and refreshes it every ~2.5 s. WhatsApp rotates QR codes about every 20–60 s; the page follows automatically.
4. After you scan, WhatsApp closes the socket once with code 515 ("restart required"); the worker reopens it immediately using the new credentials.
5. Credentials and Signal keys are saved **encrypted** in MongoDB. Later restarts reuse them — no new QR.

## Pair the owner's number
1. Open the dashboard → **WhatsApp**. Wait for the QR (a few seconds). If it says "Worker not detected", start the worker (`heroku ps:scale worker=1` or `npm run start:worker`).
2. On the **owner's phone**: WhatsApp → **Settings → Linked devices → Link a device** (Android: ⋮ → Linked devices).
3. Scan the QR on the dashboard.
4. The page shows **Connected** and the linked number. Confirm it matches `OWNER_PHONE_NUMBER`.
5. **Overview → Assistant ON.**

## Important behaviours
- The linked device appears under **Linked devices** (listed as a browser session; the exact label is chosen by WhatsApp). Removing it there logs the worker out; the dashboard shows *Logged out* and offers a **new QR** automatically.
- WhatsApp unlinks devices if the primary phone stays offline for ~14 days.
- Do not link the same account from a second automation: WhatsApp reports "connection replaced" and the worker backs off instead of fighting.
- **Self-chat**: owner commands are typed in WhatsApp's "Message yourself" chat. Replies and notifications appear there.

## Live integration test checklist (not yet run by the author — please run once)
| # | Step | Expected |
|---|---|---|
| 1 | Start worker with an empty database | Dashboard shows a QR within ~10 s |
| 2 | Wait 60 s without scanning | QR image changes (refresh) |
| 3 | Scan the QR | Status → Connected; linked number shown |
| 4 | Restart worker (`heroku ps:restart worker`) | Connected again, **no QR** |
| 5 | Send `.assistant status` to yourself | Status report appears in the same chat |
| 6 | `.assistant on`; from another phone send "Hi" | Greeting with ✦ footer |
| 7 | Reply "I'm fine, how are you?" | Natural reply asking what they need |
| 8 | Say "I need a website with a dashboard" and answer follow-ups | Request saved (Requests page) + you get a 🔔 notification |
| 9 | Ask "Can you help me choose a university course?" | KUCCPS-style reply, no invented points/deadlines |
| 10 | Type a normal message to that contact from your phone | AI stops in that chat (takeover) |
| 11 | In that chat send `.assistant release` | Command disappears from the chat; you get a confirmation in your self-chat; AI resumes |
| 12 | `.assistant off`; contact sends a message | No reply |
| 13 | Dashboard → **Log out & unlink** | New QR appears |
| 14 | From a third phone send `.assistant off` | Ignored — no admin access |

## Limitations to know about
- **Detecting the owner's manual replies.** WhatsApp gives the worker the owner's own messages as `fromMe`. The worker ignores its own sends (it remembers their IDs). Any other `fromMe` message — typed on the phone or on another linked device such as WhatsApp Web — is treated as *the owner replying* and activates takeover. It cannot tell who physically typed it.
- **Command visibility.** A command typed inside a customer's chat is visible to the customer for a moment; the system deletes it immediately (best effort). Prefer using the self-chat or the dashboard, or pass the number: `.assistant takeover 2547XXXXXXXX`.
- **LIDs.** WhatsApp may identify some people by a privacy ID (LID) instead of a phone number. The system uses the phone number when WhatsApp supplies it; otherwise the contact is stored by LID and shows without a number.
