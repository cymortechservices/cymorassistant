# Installation (local development)

## 1. Requirements
- Node.js **22 LTS** (`node -v`), npm 10+
- Git
- A MongoDB database (Atlas free tier is fine) — see step 2 of [HEROKU_DEPLOYMENT.md](HEROKU_DEPLOYMENT.md) for creating one
- A Gemini API key from <https://aistudio.google.com/apikey>

## 2. Install
```powershell
cd cymor-assistant
npm run install:all
```

## 3. Configure
```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
```
Fill in every value. Generate the secrets:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run it twice — one value for `JWT_SECRET`, one for `SESSION_ENCRYPTION_KEY` (**back up `SESSION_ENCRYPTION_KEY`**: without it the stored WhatsApp session cannot be read and you must scan the QR again).

Create the dashboard password hash:
```powershell
npm run hash -- "a long strong password"
```
Paste the output (starts with `$2a$` or `$2b$`) into `DASHBOARD_PASSWORD_HASH`.

`OWNER_PHONE_NUMBER` is the owner's WhatsApp number as digits with country code, e.g. `2547XXXXXXXX`. For commands typed on the linked phone to be accepted, the **linked WhatsApp account must be this number**.

## 4. Build and run
```powershell
npm run build            # builds the React dashboard into frontend/dist
npm run start:web        # PowerShell window 1: http://localhost:3000
npm run start:worker     # PowerShell window 2: WhatsApp + AI
```
During development you can instead run the dashboard with hot reload: `npm run dev:frontend` (http://localhost:5173, proxies `/api` to port 3000).

In development the worker also prints the QR in the terminal. In production (`NODE_ENV=production`) it does not — use the dashboard.

## 5. First use
1. Open the dashboard and sign in.
2. **WhatsApp** page → scan the QR ([pairing guide](WHATSAPP_PAIRING.md)).
3. **Overview** → switch the assistant **ON**.
4. From another phone, message the linked number and watch the replies.

## 6. Run the tests
```powershell
npm test
```
