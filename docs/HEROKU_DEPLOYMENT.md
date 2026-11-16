# Heroku deployment guide (beginner friendly)

> This guide has **not** been executed against a real Heroku account by the author of this repository (no access). Commands are standard Heroku/Git usage; if something differs on your account, [TROUBLESHOOTING.md](TROUBLESHOOTING.md) helps.

## 0. Costs — please read
Heroku no longer has a free tier. You need **two dynos**: one `web` (dashboard) and one `worker` (the always-on WhatsApp connection). They are billed separately according to the dyno type you choose. Check the current plans on <https://www.heroku.com/pricing> and pick types that fit your budget. If the **worker** is stopped, the assistant does not reply. Never run more than **one** worker (a lock prevents duplicates, but extra workers waste money).

## 1. Create a GitHub repository and upload the project
1. Create an empty **private** repository on <https://github.com/new> (e.g. `cymor-assistant`).
2. In PowerShell, inside the project folder:
```powershell
git init
git add .
git commit -m "Initial commit: CYMOR ASSISTANT"
git branch -M main
git remote add origin https://github.com/YOUR-USER/cymor-assistant.git
git push -u origin main
```
`.gitignore` already excludes `.env`, `node_modules` and session folders. **Check `git status` shows no `.env`** before pushing.

## 2. Create the MongoDB Atlas database
1. Sign up at <https://www.mongodb.com/atlas> → **Create a cluster** (the free *M0* tier is enough to start).
2. **Database Access → Add New Database User**: choose a username and a long random password (letters and digits avoid URL-encoding problems). Role: *Read and write to any database*.
3. **Network Access → Add IP Address**. Heroku dynos do not have fixed IP addresses, so the simplest option is **Allow access from anywhere (`0.0.0.0/0`)**. This is safe only because the database user has a strong password; for stricter control use a Heroku add-on that provides static outbound IPs and allow just those.
4. **Connect → Drivers** → copy the connection string and add the database name:
```
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/cymor-assistant?retryWrites=true&w=majority
```

## 3. Generate the secrets
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_ENCRYPTION_KEY  (BACK THIS UP)
npm run hash -- "your strong dashboard password"                           # DASHBOARD_PASSWORD_HASH
```
Get `GEMINI_API_KEY` from <https://aistudio.google.com/apikey>.

## 4. Create the Heroku app
Install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli), then:
```powershell
heroku login
heroku create your-app-name
heroku buildpacks:set heroku/nodejs -a your-app-name
```
(Alternatively connect the GitHub repo from the Heroku dashboard → **Deploy → GitHub**.)

## 5. Add the configuration variables
Use **single quotes** in PowerShell so `$` in the password hash is not interpreted:
```powershell
heroku config:set -a your-app-name `
  NODE_ENV=production `
  TIMEZONE=Africa/Nairobi `
  MONGODB_URI='mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/cymor-assistant?retryWrites=true&w=majority' `
  GEMINI_API_KEY='YOUR_GEMINI_KEY' `
  GEMINI_MODEL=gemini-2.5-flash `
  OWNER_PHONE_NUMBER=2547XXXXXXXX `
  JWT_SECRET='PASTE_64_HEX' `
  SESSION_ENCRYPTION_KEY='PASTE_64_HEX' `
  DASHBOARD_USERNAME=admin `
  DASHBOARD_PASSWORD_HASH='$2a$12$PASTE_THE_HASH' `
  APP_BASE_URL=https://your-app-name.herokuapp.com `
  ASSISTANT_ENABLED=false `
  NOTIFICATION_ENABLED=true
```
(Or set them in the dashboard: **Settings → Config Vars**.)

## 6. Deploy
```powershell
git push heroku main
```
Heroku runs `npm run heroku-postbuild`, which installs the backend, builds the React dashboard and discards build-only tools. The `Procfile` defines the two process types:
```
web:    npm run start:web
worker: npm run start:worker
```

## 7. Start the web and worker dynos
```powershell
heroku ps:scale web=1 worker=1 -a your-app-name
heroku ps -a your-app-name
heroku logs --tail -a your-app-name
```
Healthy logs show `MongoDB connected`, `Web server listening`, and from the worker `Scheduling…`/`WhatsApp connected` after pairing.

## 8. Open the dashboard
```powershell
heroku open -a your-app-name
```
Sign in with `DASHBOARD_USERNAME` and your password.

## 9. Pair WhatsApp
Go to **WhatsApp** in the dashboard, scan the QR — full steps in [WHATSAPP_PAIRING.md](WHATSAPP_PAIRING.md). The status turns **Connected**.

## 10. Test automatic replies
1. **Overview → Assistant ON** (or send `.assistant on` to yourself in WhatsApp).
2. From a *different* phone, message the linked number: "Hi".
3. Expect a friendly greeting ending with `✦ 𝑪𝒀𝑴𝑶𝑹 𝑨𝑺𝑺𝑰𝑺𝑻𝑨𝑵𝑻 ✦`.

## 11. Restart and confirm the session persists
```powershell
heroku ps:restart worker -a your-app-name
heroku logs --tail -a your-app-name
```
The dashboard should return to **Connected** within about a minute **without a new QR**. Heroku also restarts dynos about once a day; the session is stored (encrypted) in MongoDB, so this is harmless. If a QR *does* appear after a restart, see Troubleshooting (usually a changed `SESSION_ENCRYPTION_KEY` or a logout from the phone).

## Updating later
```powershell
git add . ; git commit -m "Update" ; git push origin main ; git push heroku main
```
