import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../../src/models/index.js', async (importOriginal) => (await import('../helpers/model-stubs.js')).mockModels(importOriginal));
vi.mock('../../src/whatsapp/auth-store.js', () => ({ clearSession: vi.fn(async () => {}), backupCreds: vi.fn(async () => true) }));

const { WhatsAppConnection } = await import('../../src/whatsapp/connection.js');
const { ReconnectManager } = await import('../../src/whatsapp/reconnect-manager.js');
const authStore = await import('../../src/whatsapp/auth-store.js');
const { WhatsAppSession } = await import('../../src/models/index.js');

const DisconnectReason = { loggedOut: 401, connectionReplaced: 440, badSession: 500, restartRequired: 515, forbidden: 403, connectionLost: 408, connectionClosed: 428 };

function fakeSocket() {
  const ev = new EventEmitter();
  ev.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(ev);
  return { ev, user: { id: '254700000001:7@s.whatsapp.net', name: 'Owner', lid: '999@lid' }, sendMessage: vi.fn(async () => ({ key: { id: 'WAID1' } })), end: vi.fn(), logout: vi.fn(async () => {}), sendPresenceUpdate: vi.fn() };
}

function setup() {
  const sockets = [];
  const baileys = {
    makeWASocket: vi.fn(() => { const s = fakeSocket(); sockets.push(s); return s; }),
    fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 3000, 1] })),
    makeCacheableSignalKeyStore: (k) => k,
    Browsers: { ubuntu: (n) => ['Ubuntu', n, '1'] },
    DisconnectReason,
  };
  const saveCreds = vi.fn(async () => {});
  const flush = vi.fn(async () => {});
  const qr = { publish: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  const conn = new WhatsAppConnection({
    sessionId: 's1', baileys, qrManager: qr, pollMs: 100000,
    authFactory: async () => ({ state: { creds: {}, keys: {} }, saveCreds, flush }),
    reconnect: new ReconnectManager({ baseMs: 5, maxMs: 20, maxAttempts: 4, random: () => 0 }),
  });
  return { conn, baileys, sockets, saveCreds, flush, qr };
}

const closeWith = (sock, code) => sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: code } } } });

beforeEach(() => vi.clearAllMocks());

describe('WhatsApp connection (mocked Baileys socket)', () => {
  it('starts a connection and registers handlers', async () => {
    const { conn, baileys, sockets } = setup();
    await conn.start();
    expect(baileys.makeWASocket).toHaveBeenCalledTimes(1);
    expect(sockets[0].ev.listenerCount('creds.update')).toBe(1);
    expect(sockets[0].ev.listenerCount('connection.update')).toBe(1);
    await conn.stop();
  });

  it('QR event: publishes the QR for the admin pairing page and exposes qr_pending', async () => {
    const { conn, sockets, qr } = setup();
    await conn.start();
    sockets[0].ev.emit('connection.update', { qr: 'QR-STRING-1' });
    await vi.waitFor(() => expect(qr.publish).toHaveBeenCalledWith('QR-STRING-1'));
    expect(conn.state).toBe('qr_pending');
    sockets[0].ev.emit('connection.update', { qr: 'QR-STRING-2' }); // refreshed QR
    await vi.waitFor(() => expect(qr.publish).toHaveBeenCalledWith('QR-STRING-2'));
    await conn.stop();
  });

  it('successful pairing: connection open clears the QR, stores linked account and backs up creds', async () => {
    const { conn, sockets, qr } = setup();
    const opened = vi.fn();
    conn.on('open', opened);
    await conn.start();
    sockets[0].ev.emit('connection.update', { connection: 'open' });
    await vi.waitFor(() => expect(conn.state).toBe('connected'));
    expect(qr.clear).toHaveBeenCalled();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ id: '254700000001:7@s.whatsapp.net' }));
    expect(WhatsAppSession.updateOne).toHaveBeenCalledWith({ sessionId: 's1' }, expect.objectContaining({ $set: expect.objectContaining({ connectionState: 'connected' }) }), expect.anything());
    expect(authStore.backupCreds).toHaveBeenCalledWith('s1');
    await conn.stop();
  });

  it('persists credentials whenever Baileys reports creds.update', async () => {
    const { conn, sockets, saveCreds } = setup();
    await conn.start();
    sockets[0].ev.emit('creds.update', {});
    await vi.waitFor(() => expect(saveCreds).toHaveBeenCalledTimes(1));
    await conn.stop();
  });

  it('reconnects with the SAVED session after a transient close (no re-pairing, no session wipe)', async () => {
    const { conn, baileys, sockets } = setup();
    await conn.start();
    closeWith(sockets[0], DisconnectReason.connectionLost);
    await vi.waitFor(() => expect(baileys.makeWASocket).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(authStore.clearSession).not.toHaveBeenCalled();
    await conn.stop();
  });

  it('restartRequired (right after QR scan) reopens immediately without clearing the session', async () => {
    const { conn, baileys, sockets } = setup();
    await conn.start();
    closeWith(sockets[0], DisconnectReason.restartRequired);
    await vi.waitFor(() => expect(baileys.makeWASocket).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(authStore.clearSession).not.toHaveBeenCalled();
    await conn.stop();
  });

  it('logout / revoked session: wipes stored credentials and offers a fresh QR', async () => {
    const { conn, baileys, sockets } = setup();
    const loggedOut = vi.fn();
    conn.on('logged_out', loggedOut);
    await conn.start();
    closeWith(sockets[0], DisconnectReason.loggedOut);
    await vi.waitFor(() => expect(authStore.clearSession).toHaveBeenCalledWith('s1'));
    expect(loggedOut).toHaveBeenCalled();
    await vi.waitFor(() => expect(baileys.makeWASocket).toHaveBeenCalledTimes(2), { timeout: 4000 });
    await conn.stop();
  });

  it('bad session is treated like a revoked session', async () => {
    const { conn, sockets } = setup();
    await conn.start();
    closeWith(sockets[0], DisconnectReason.badSession);
    await vi.waitFor(() => expect(authStore.clearSession).toHaveBeenCalled());
    await conn.stop();
  });

  it('connection replaced by another client: does not wipe the session and backs off', async () => {
    const { conn, baileys, sockets } = setup();
    await conn.start();
    closeWith(sockets[0], DisconnectReason.connectionReplaced);
    await vi.waitFor(() => expect(conn.state).toBe('replaced'));
    expect(authStore.clearSession).not.toHaveBeenCalled();
    expect(baileys.makeWASocket).toHaveBeenCalledTimes(1);
    await conn.stop();
  });

  it('gives up after the maximum number of reconnect attempts', async () => {
    const { conn, baileys, sockets } = setup();
    // make socket creation fail so each attempt closes immediately
    await conn.start();
    for (let i = 0; i < 6; i++) {
      const s = sockets[sockets.length - 1];
      closeWith(s, DisconnectReason.connectionLost);
      await new Promise((r) => setTimeout(r, 60));
    }
    await vi.waitFor(() => expect(conn.state).toBe('failed'), { timeout: 3000 });
    expect(baileys.makeWASocket.mock.calls.length).toBeLessThanOrEqual(5);
    await conn.stop();
  });

  it('forwards incoming messages to listeners', async () => {
    const { conn, sockets } = setup();
    const got = vi.fn();
    conn.on('messages', got);
    await conn.start();
    sockets[0].ev.emit('messages.upsert', { messages: [{ key: { id: 'A' } }], type: 'notify' });
    expect(got).toHaveBeenCalledWith({ messages: [{ key: { id: 'A' } }], type: 'notify' });
    await conn.stop();
  });

  it('sendText records the sent ID so the echo is recognised as our own', async () => {
    const { conn, sockets } = setup();
    await conn.start();
    sockets[0].ev.emit('connection.update', { connection: 'open' });
    await vi.waitFor(() => expect(conn.state).toBe('connected'));
    await conn.sendText('254711@s.whatsapp.net', 'hi');
    expect(conn.isOwnEcho('WAID1')).toBe(true);
    expect(conn.isOwnEcho('OTHER')).toBe(false);
    await conn.stop();
  });

  it('refuses to send while disconnected', async () => {
    const { conn } = setup();
    await expect(conn.sendText('x@s.whatsapp.net', 'hi')).rejects.toThrow(/not connected/);
  });

  it('graceful stop flushes pending key writes BEFORE closing the socket', async () => {
    const { conn, sockets, flush } = setup();
    await conn.start();
    const order = [];
    flush.mockImplementation(async () => { order.push('flush'); });
    sockets[0].end.mockImplementation(() => order.push('end'));
    await conn.stop();
    expect(order).toEqual(['flush', 'end']);
  });

  it('dashboard-requested logout logs out of WhatsApp and clears local credentials', async () => {
    const { conn, sockets } = setup();
    await conn.start();
    WhatsAppSession.findOneAndUpdate.mockReturnValueOnce({ lean: async () => ({ requestedAction: 'logout' }) });
    await conn.pollRequestedAction();
    expect(sockets[0].logout).toHaveBeenCalled();
    expect(authStore.clearSession).toHaveBeenCalledWith('s1');
    await conn.stop();
  });
});
