import * as baileys from '@whiskeysockets/baileys';
import { getConfig } from '../config/index.js';
import { connectDatabase, disconnectDatabase, databaseStatus } from '../database/connect.js';
import { seedSettings, getSettings } from '../services/settings.js';
import { SessionLock } from '../services/worker-lock.js';
import { useMongoAuthState } from '../whatsapp/auth-store.js';
import { QrManager } from '../whatsapp/qr-manager.js';
import { WhatsAppConnection } from '../whatsapp/connection.js';
import { MessageHandler } from '../whatsapp/message-handler.js';
import { GeminiProvider, AiService } from '../ai/gemini.js';
import { ConversationEngine } from '../assistant/conversation-engine.js';
import { Notifier } from '../notifications/notifier.js';
import { applyRetention } from '../services/contacts.js';
import { Setting } from '../models/index.js';
import { phoneToJid, jidToPhone } from '../utils/phone.js';
import { logger } from '../utils/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Heroku `worker` process: owns the single WhatsApp connection.
 * Wires: WhatsAppConnection -> MessageHandler -> ConversationEngine -> AI.
 */
async function main() {
  const config = getConfig();
  await connectDatabase(config.MONGODB_URI);
  await seedSettings(config);

  // ---- Single-owner guarantee: only one worker may hold the session.
  const lock = new SessionLock(`wa-session:${config.SESSION_ID}`);
  let acquired = false;
  for (let i = 0; i < 12 && !acquired; i++) {
    acquired = await lock.tryAcquire();
    if (!acquired) {
      logger.warn('Another worker owns the WhatsApp session; waiting (old dyno may still be shutting down)...');
      await sleep(10_000);
    }
  }
  if (!acquired) {
    logger.error('Could not acquire the session lock. Is a second worker running? Exiting.');
    process.exit(1);
  }
  lock.startRenewing();

  const settings0 = await getSettings({ fresh: true });
  const ai = new AiService({
    provider: new GeminiProvider({ apiKey: config.GEMINI_API_KEY, model: settings0.ai.model || config.GEMINI_MODEL }),
    timeoutMs: settings0.ai.timeoutMs,
    maxRetries: settings0.ai.maxRetries,
  });
  if (!config.GEMINI_API_KEY) logger.warn('GEMINI_API_KEY is not set: the assistant will only use fallback replies.');

  const qr = new QrManager({ sessionId: config.SESSION_ID, printToTerminal: config.NODE_ENV !== 'production' });
  const conn = new WhatsAppConnection({
    sessionId: config.SESSION_ID,
    baileys,
    qrManager: qr,
    authFactory: () => useMongoAuthState({ sessionId: config.SESSION_ID, encryptionKey: config.SESSION_ENCRYPTION_KEY }),
  });

  const getLinked = () => {
    const u = conn.sock?.user;
    return { jid: u?.id ? `${jidToPhone(u.id)}@s.whatsapp.net` : '', phone: u?.id ? jidToPhone(u.id) : '', lid: u?.lid || '' };
  };

  const ownerJid = async () => {
    const s = await getSettings();
    return phoneToJid(s.ownerPhone) || getLinked().jid;
  };

  const notifier = new Notifier({
    getSettings,
    send: async (text) => {
      const jid = await ownerJid();
      if (!jid) throw new Error('Owner phone number is not configured');
      await conn.sendText(jid, text);
    },
  });

  const engine = new ConversationEngine({
    ai,
    getSettings,
    notifier,
    send: (jid, text) => conn.sendText(jid, text),
    presence: (jid, kind) => conn.sendPresence(jid, kind),
  });

  const getHealth = async () => ({ whatsapp: { state: conn.state }, database: databaseStatus(), ai: ai.health() });
  const handler = new MessageHandler({ conn, engine, getSettings, getHealth, ai, getLinked, tz: config.TIMEZONE });

  conn.on('messages', (m) => handler.handleUpsert(m).catch((e) => logger.error({ err: e.message }, 'handleUpsert failed')));
  conn.on('open', () => {
    const linked = getLinked();
    const owner = config.OWNER_PHONE_NUMBER;
    if (owner && linked.phone && !String(owner).replace(/\D/g, '').endsWith(linked.phone.slice(-9))) {
      logger.warn('The linked WhatsApp account does not match OWNER_PHONE_NUMBER. Owner commands typed on the linked phone will be REJECTED until they match.');
    }
  });

  lock.onLost = async () => {
    logger.error('Session lock lost: stopping WhatsApp connection to avoid a duplicate session');
    await conn.stop();
    process.exit(1);
  };

  await conn.start();

  // ---- Scheduled jobs: daily summary (configured hour, local time) and retention purge.
  const jobTimer = setInterval(async () => {
    try {
      const s = await getSettings();
      const now = new Date();
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.TIMEZONE, hour: '2-digit', hour12: false }).format(now));
      const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: config.TIMEZONE }).format(now);
      if (hour === s.notifications.dailySummaryHour && conn.state === 'connected') {
        // Atomic once-per-day claim: succeeds only if today's key is not stored yet.
        const claimed = await Setting.findOneAndUpdate(
          { key: 'lastDailySummary', value: { $ne: dayKey } },
          { $set: { value: dayKey } },
          { upsert: true, new: true },
        ).catch((e) => (e.code === 11000 ? null : Promise.reject(e))); // duplicate key => already sent today
        if (claimed) await notifier.sendDailySummary();
      }
      if (hour === 3) await applyRetention(s.automation.retentionDays);
    } catch (e) {
      logger.warn({ err: e.message }, 'Scheduled job failed');
    }
  }, 10 * 60_000);
  jobTimer.unref();

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down worker (flushing session data first)');
    clearInterval(jobTimer);
    try {
      await conn.stop();
      await lock.release();
      await disconnectDatabase();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => logger.error({ err: String(e?.message || e) }, 'Unhandled rejection'));
}

main().catch((e) => {
  logger.error({ err: e.message }, 'Worker failed to start');
  process.exit(1);
});
