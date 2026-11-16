import { EventEmitter } from 'node:events';
import { WhatsAppSession } from '../models/index.js';
import { child } from '../utils/logger.js';
import { ReconnectManager, classifyDisconnect } from './reconnect-manager.js';
import { clearSession, backupCreds } from './auth-store.js';

const log = child('whatsapp');

/**
 * Owns the single Baileys socket. Responsibilities:
 *  - build the socket from the Mongo-backed auth state
 *  - publish QR codes, track connection state in MongoDB
 *  - reconnect with backoff, never re-pair after an ordinary restart
 *  - handle logout / revoked / replaced sessions
 *  - emit 'message' events with raw Baileys messages
 *
 * `baileys` and `authFactory` are injected so tests can use a mock socket.
 */
export class WhatsAppConnection extends EventEmitter {
  constructor({ sessionId, baileys, authFactory, qrManager, reconnect = new ReconnectManager(), browserName = 'CYMOR ASSISTANT', pollMs = 5000 }) {
    super();
    this.sessionId = sessionId;
    this.baileys = baileys; // { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers }
    this.authFactory = authFactory; // async () => ({ state, saveCreds, flush })
    this.qr = qrManager;
    this.reconnect = reconnect;
    this.browserName = browserName;
    this.pollMs = pollMs;
    this.sock = null;
    this.auth = null;
    this.state = 'disconnected';
    this.stopped = false;
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.sentIds = new Set(); // IDs of messages this bot sent (to ignore fromMe echoes)
  }

  async start() {
    this.stopped = false;
    this.startPolling();
    await this.connect();
  }

  async setState(state, extra = {}) {
    this.state = state;
    this.emit('state', state);
    await WhatsAppSession.updateOne(
      { sessionId: this.sessionId },
      { $set: { connectionState: state, workerHeartbeatAt: new Date(), ...extra } },
      { upsert: true },
    ).catch((e) => log.warn({ err: e.message }, 'Could not persist connection state'));
  }

  async connect() {
    if (this.stopped) return;
    const { makeWASocket, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers } = this.baileys;
    await this.setState('connecting');
    try {
      this.auth = await this.authFactory();
      let version;
      try {
        ({ version } = await fetchLatestBaileysVersion());
      } catch {
        log.warn('Could not fetch latest WhatsApp Web version; using library default');
      }
      const { state } = this.auth;
      const silent = { level: 'silent', child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
      this.sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore ? makeCacheableSignalKeyStore(state.keys, silent) : state.keys },
        browser: Browsers?.ubuntu ? Browsers.ubuntu(this.browserName) : [this.browserName, 'Chrome', '1.0'],
        logger: silent,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async () => undefined,
      });
    } catch (e) {
      log.error({ err: e.message }, 'Failed to create WhatsApp socket');
      await this.setState('error', { lastDisconnectReason: e.message });
      this.scheduleReconnect();
      return;
    }

    this.sock.ev.on('creds.update', async () => {
      try {
        await this.auth.saveCreds();
      } catch (e) {
        log.error({ err: e.message }, 'Failed to persist credentials');
      }
    });
    this.sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u).catch((e) => log.error({ err: e.message }, 'connection.update handler failed')));
    this.sock.ev.on('messages.upsert', (m) => this.emit('messages', m));
  }

  async onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      await this.setState('qr_pending');
      await this.qr.publish(qr);
      this.emit('qr', qr);
    }
    if (connection === 'connecting') await this.setState('connecting');

    if (connection === 'open') {
      this.reconnect.reset();
      const me = this.sock?.user ? { id: this.sock.user.id, name: this.sock.user.name || '', lid: this.sock.user.lid || '' } : null;
      await this.qr.clear();
      await this.setState('connected', { me, ownerLid: me?.lid || '', lastConnectedAt: new Date(), reconnectAttempts: 0, lastDisconnectReason: '' });
      log.info('WhatsApp connected');
      backupCreds(this.sessionId).catch(() => {});
      this.emit('open', me);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const kind = classifyDisconnect(code, this.baileys.DisconnectReason);
      const reason = `${kind} (${code ?? 'no code'})`;
      log.warn({ kind, code }, 'WhatsApp connection closed');
      await this.qr.clear();
      this.detachSocket();
      this.emit('close', kind);
      if (this.stopped) return;

      if (kind === 'logged_out' || kind === 'bad_session') {
        // Session revoked from the phone, or corrupted: stored credentials are useless.
        await clearSession(this.sessionId);
        await this.setState('logged_out', { lastDisconnectReason: reason, me: null });
        this.emit('logged_out');
        // Start a fresh connection so a NEW QR is offered to the admin.
        this.reconnect.reset();
        this.scheduleReconnect(1500);
        return;
      }
      if (kind === 'replaced') {
        // Another client took over this session; do not fight it.
        await this.setState('replaced', { lastDisconnectReason: reason });
        this.scheduleReconnect(60_000);
        return;
      }
      if (kind === 'restart') {
        // Normal right after QR scan: reopen immediately with the saved creds.
        await this.setState('connecting', { lastDisconnectReason: reason });
        this.scheduleReconnect(250, { countAttempt: false });
        return;
      }
      await this.setState('reconnecting', { lastDisconnectReason: reason });
      this.scheduleReconnect();
    }
  }

  scheduleReconnect(forcedDelay, { countAttempt = true } = {}) {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    const delay = forcedDelay ?? this.reconnect.nextDelay();
    if (delay === null) {
      log.error('Max reconnection attempts reached; giving up until manually restarted');
      this.setState('failed', { lastDisconnectReason: 'max reconnect attempts reached' });
      return;
    }
    if (forcedDelay !== undefined && countAttempt) this.reconnect.attempts += 1;
    WhatsAppSession.updateOne({ sessionId: this.sessionId }, { $set: { reconnectAttempts: this.reconnect.attempts } }).catch(() => {});
    log.info({ delayMs: delay, attempt: this.reconnect.attempts }, 'Scheduling reconnect');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  detachSocket() {
    try {
      this.sock?.ev?.removeAllListeners?.('connection.update');
      this.sock?.ev?.removeAllListeners?.('messages.upsert');
      this.sock?.end?.(undefined);
    } catch {
      /* ignore */
    }
    this.sock = null;
  }

  /** Send a text message and remember its ID so we can recognise it as ours. */
  async sendText(jid, text) {
    if (!this.sock || this.state !== 'connected') throw new Error('WhatsApp is not connected');
    const sent = await this.sock.sendMessage(jid, { text });
    const id = sent?.key?.id;
    if (id) {
      this.sentIds.add(id);
      if (this.sentIds.size > 2000) this.sentIds.delete(this.sentIds.values().next().value);
    }
    return sent;
  }

  isOwnEcho(id) {
    return this.sentIds.has(id);
  }

  async sendPresence(jid, type) {
    try {
      await this.sock?.sendPresenceUpdate(type, jid);
    } catch {
      /* cosmetic only */
    }
  }

  /** Dashboard asks the worker (via Mongo) to disconnect / log out / reconnect. */
  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollRequestedAction().catch(() => {}), this.pollMs);
    this.pollTimer.unref?.();
  }

  async pollRequestedAction() {
    const meta = await WhatsAppSession.findOneAndUpdate(
      { sessionId: this.sessionId, requestedAction: { $ne: 'none' } },
      { $set: { requestedAction: 'none' } },
      { new: false },
    ).lean();
    await WhatsAppSession.updateOne({ sessionId: this.sessionId }, { $set: { workerHeartbeatAt: new Date() } });
    if (!meta) return;
    log.info({ action: meta.requestedAction }, 'Dashboard requested connection action');
    if (meta.requestedAction === 'logout') await this.logout();
    else if (meta.requestedAction === 'disconnect') await this.disconnect();
    else if (meta.requestedAction === 'reconnect') {
      this.detachSocket();
      this.reconnect.reset();
      await this.connect();
    }
  }

  async logout() {
    try {
      await this.sock?.logout?.();
    } catch (e) {
      log.warn({ err: e.message }, 'logout() failed; clearing local session anyway');
    }
    this.detachSocket();
    await clearSession(this.sessionId);
    await this.setState('logged_out');
    this.reconnect.reset();
    this.scheduleReconnect(1500, { countAttempt: false });
  }

  async disconnect() {
    clearTimeout(this.reconnectTimer);
    this.detachSocket();
    await this.qr.clear();
    await this.setState('disconnected');
  }

  /** Graceful shutdown: flush pending key writes BEFORE closing. */
  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pollTimer);
    try {
      await this.auth?.flush?.();
    } catch {
      /* ignore */
    }
    this.detachSocket();
    await this.setState('disconnected').catch(() => {});
  }
}
