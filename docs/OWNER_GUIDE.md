# Owner guide

## What the assistant does
When someone messages your number and the assistant is **ON**, CYMOR ASSISTANT greets them, asks how they are, finds out what they need (website, software, KUCCPS help, other), asks relevant questions one at a time, **saves the request**, tells you on WhatsApp, and chats politely while they wait. Every automated reply ends with `✦ 𝑪𝒀𝑴𝑶𝑹 𝑨𝑺𝑺𝑰𝑺𝑻𝑨𝑵𝑻 ✦`. It always says it is an AI and never pretends to be you.

It does **not** message anyone first, answer groups, quote prices, or give KUCCPS cluster points/cut-offs/deadlines.

## Commands
Type them in WhatsApp's **Message yourself** chat (or inside a customer's chat for takeover/release). Only you can use them.

| Command | What it does |
|---|---|
| `.assistant on` / `off` | Enable / disable automatic replies for everyone |
| `.assistant status` | Connection, ON/OFF, pending requests, chats in takeover |
| `.assistant requests` | Latest 10 pending requests |
| `.assistant summary` | AI summary of the last 24 h |
| `.assistant pause 30` | Pause all replies for 30 minutes (max 1440) |
| `.assistant resume` | Clear the pause |
| `.assistant takeover` | Stop the AI in **this** customer chat |
| `.assistant takeover 2547XXXXXXXX` | Same, from your self-chat |
| `.assistant release [number]` | Let the AI resume in that chat |
| `.assistant contacts` | Recent contacts |
| `.assistant health` | WhatsApp, database, AI, uptime, memory |
| `.assistant help` | List of commands |

Replies to commands are sent to your self-chat. A takeover/release typed inside a customer's chat is deleted from that chat right away (best effort).

## Taking over a conversation
- **Automatic:** if you type a message to a customer from your phone, the AI stops in that chat (setting *Auto takeover when I reply personally*, on by default).
- **Manual:** `.assistant takeover`, or **Dashboard → Conversations → open chat → Take over**.
- Other contacts are unaffected. Release with `.assistant release` or the dashboard button.
- Optional: *Settings → Automation → Release takeover after owner inactivity* (minutes). It never releases while you are actively replying.
- Limitation: any message sent from your account (phone **or** another linked device) counts as "you replying".

## Notifications you receive
New inquiry (once per request), urgent inquiry, KUCCPS consultation, questions the assistant couldn't answer, and a daily summary at the hour you set. Toggle each in **Settings → Notifications**.

## The dashboard
- **Overview** — status of WhatsApp, Gemini, MongoDB, Heroku; ON/OFF switch; counts.
- **WhatsApp** — QR pairing, connection state, reconnect / disconnect / log out.
- **Conversations** — read chats, take over, per-contact AI on/off, delete a contact's data.
- **Requests** — filter (pending, completed, KUCCPS, software, websites, urgent), search, add private notes, mark reviewed/completed, open the chat in WhatsApp.
- **Analytics** — activity, categories, common questions, AI usage.
- **Settings** — everything below.

## Teaching the assistant about your business
**Settings → Business profile / Services & FAQs** — owner details, company description, services, FAQs, consultation info, working hours, official links and policies. Edit and press **Save changes**; it applies to the next message. If you leave prices/hours/contact details empty, the assistant will say it will pass the question to you instead of guessing. Add a price FAQ **only** if you want it quoted.

## Good habits
- Check **Requests** daily; contact people from your own number.
- For KUCCPS students, the assistant only collects details (year, grade, interests, help needed); you give the actual advice.
- Review early conversations in **Conversations** to make sure the tone is right; adjust *Extra personality notes* if needed.
