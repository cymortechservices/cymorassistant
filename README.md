# CYMOR ASSISTANT
### Your Personal Digital Representative — *Powered by CYMOR TECH SERVICES*

CYMOR ASSISTANT links to the owner's WhatsApp account (QR pairing, like WhatsApp Web), greets and chats with contacts using Google Gemini, collects their requests (websites, software, KUCCPS consultation…), saves them in MongoDB, and notifies the owner. The owner can take over any chat at any time, and control everything from a secure web dashboard or WhatsApp commands.

> **Read first — honest status.** Everything in this repository was built and tested in a sandbox with **no access to WhatsApp, Gemini, MongoDB Atlas or Heroku**. 135 automated tests pass, the dashboard builds, and a real Baileys socket was constructed, but **real QR pairing, live Gemini replies and a Heroku deployment have not been exercised yet**. See [`docs/TESTING_REPORT.md`](docs/TESTING_REPORT.md) and [`docs/WHATSAPP_PAIRING.md`](docs/WHATSAPP_PAIRING.md) for the exact first-run checklist.
>
> **WhatsApp risk.** Baileys is an *unofficial* library that emulates WhatsApp Web. WhatsApp can restrict accounts that automate messaging. The assistant only replies to people who message first and never sends bulk/unsolicited messages, which lowers (but doesn't remove) the risk. Consider using a dedicated number.

## What's inside

| Part | Tech | Heroku process |
|---|---|---|
| Dashboard + admin API | React + Vite, Express 5 | `web` |
| WhatsApp connection + AI replies | Baileys 7 (rc14), Google Gen AI SDK, Mongoose | `worker` |
| Data & WhatsApp session | MongoDB Atlas (session encrypted AES-256-GCM) | — |

```
backend/   Node.js (ESM): whatsapp/, ai/, assistant/, knowledge/, commands/, notifications/, requests/, models/, routes/, workers/
frontend/  React dashboard (dark, responsive)
docs/      Installation, Heroku, pairing, security, owner guide, troubleshooting, testing report
```

## Quick start on Windows (PowerShell)

Prerequisites: [Node.js 22 LTS](https://nodejs.org), [Git](https://git-scm.com), a [MongoDB Atlas](https://www.mongodb.com/atlas) database, a [Gemini API key](https://aistudio.google.com/apikey).

```powershell
# 1. Get the code (or unzip the archive) and enter the folder
cd cymor-assistant

# 2. Install everything
npm run install:all

# 3. Create your settings file
Copy-Item backend\.env.example backend\.env
notepad backend\.env

# 4. Generate secrets and paste them into backend\.env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # run twice: JWT_SECRET and SESSION_ENCRYPTION_KEY
npm run hash -- "your-strong-dashboard-password"                          # -> DASHBOARD_PASSWORD_HASH

# 5. Build the dashboard
npm run build

# 6. Start the two processes (two PowerShell windows)
npm run start:web        # window 1 -> http://localhost:3000
npm run start:worker     # window 2 -> also prints a QR in the terminal (development only)
```

Then: open <http://localhost:3000>, sign in, go to **WhatsApp**, scan the QR (WhatsApp → Settings → **Linked devices** → **Link a device**), wait for **Connected**, and switch the assistant **ON** from **Overview**.

## Configuration

All variable names are in [`backend/.env.example`](backend/.env.example) (`MONGODB_URI`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OWNER_PHONE_NUMBER`, `JWT_SECRET`, `SESSION_ENCRYPTION_KEY`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD_HASH`, `APP_BASE_URL`, `ASSISTANT_ENABLED`, `NOTIFICATION_ENABLED`, `TIMEZONE`). Business knowledge (profile, services, FAQs, policies, footer, notifications) is edited in the dashboard — no code changes needed.

## Tests

```powershell
npm test                    # unit tests (no database needed): 135 tests
npm run test:integration    # needs a MongoDB: set TEST_MONGODB_URI first (22 tests)
```

```powershell
$env:TEST_MONGODB_URI = "mongodb://127.0.0.1:27017"   # a throw-away local/Atlas test database
npm run test:integration
```

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Heroku deployment (GitHub → Atlas → Heroku)](docs/HEROKU_DEPLOYMENT.md)
- [WhatsApp QR pairing guide + live test checklist](docs/WHATSAPP_PAIRING.md)
- [Owner guide (commands, takeover, dashboard)](docs/OWNER_GUIDE.md)
- [Security report](docs/SECURITY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Testing report](docs/TESTING_REPORT.md) · [Development status](DEVELOPMENT_STATUS.md)

© CYMOR TECH SERVICES. See [LICENSE](LICENSE).
