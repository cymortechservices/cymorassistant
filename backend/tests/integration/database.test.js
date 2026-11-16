import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { getTestMongoUri, connectTestDb, resetDb, closeTestDb } from '../helpers/db.js';

/**
 * REAL-database tests: indexes, uniqueness, encrypted auth persistence, locks.
 * Run with a MongoDB: TEST_MONGODB_URI="mongodb://127.0.0.1:27017" npm run test:integration
 * (or let mongodb-memory-server download mongod on a machine with internet access).
 * Without a database the whole file is SKIPPED, never faked.
 */
const uri = await getTestMongoUri();

describe.skipIf(!uri)('MongoDB integration', () => {
  let M;
  let auth;
  let contacts;
  let lockMod;
  let requests;

  beforeAll(async () => {
    await connectTestDb(uri);
    M = await import('../../src/models/index.js');
    auth = await import('../../src/whatsapp/auth-store.js');
    contacts = await import('../../src/services/contacts.js');
    lockMod = await import('../../src/services/worker-lock.js');
    requests = await import('../../src/requests/request-service.js');
  });
  afterAll(closeTestDb);
  beforeEach(resetDb);

  const key = 'f'.repeat(64);

  describe('Contacts, conversations, messages', () => {
    it('creates a contact + conversation once per JID (idempotent, concurrency-safe)', async () => {
      const jid = '254711000111@s.whatsapp.net';
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => contacts.ensureConversation(jid, { displayName: 'Amina' })));
      expect(new Set(results.map((r) => String(r.conversation._id))).size).toBe(1);
      expect(await M.Contact.countDocuments()).toBe(1);
      expect(await M.Conversation.countDocuments()).toBe(1);
      expect((await M.Contact.findOne({ jid })).phone).toBe('254711000111');
    });

    it('prevents duplicate messages via the unique (jid, waMessageId) index', async () => {
      const { conversation } = await contacts.ensureConversation('254711000222@s.whatsapp.net');
      const base = { conversation, jid: conversation.jid, waMessageId: 'ABC123', sender: 'contact', text: 'hi' };
      expect(await contacts.storeMessage(base)).toBeTruthy();
      expect(await contacts.storeMessage(base)).toBeNull();
      expect(await M.Message.countDocuments({ waMessageId: 'ABC123' })).toBe(1);
    });

    it('allows many messages without an ID (partial index ignores nulls)', async () => {
      const { conversation } = await contacts.ensureConversation('254711000333@s.whatsapp.net');
      await contacts.storeMessage({ conversation, jid: conversation.jid, sender: 'assistant', text: 'a' });
      await contacts.storeMessage({ conversation, jid: conversation.jid, sender: 'assistant', text: 'b' });
      expect(await M.Message.countDocuments({ conversation: conversation._id })).toBe(2);
    });

    it('persists conversation state across reloads', async () => {
      const { conversation } = await contacts.ensureConversation('254711000444@s.whatsapp.net');
      await M.Conversation.updateOne({ _id: conversation._id }, { $set: { state: 'COLLECTING_REQUEST', category: 'kuccps', collected: { grade: 'B plain' } } });
      const again = await M.Conversation.findOne({ jid: conversation.jid });
      expect(again).toMatchObject({ state: 'COLLECTING_REQUEST', category: 'kuccps', collected: { grade: 'B plain' } });
    });

    it('rejects invalid states (schema enum)', async () => {
      const { conversation } = await contacts.ensureConversation('254711000555@s.whatsapp.net');
      conversation.state = 'NOT_A_STATE';
      await expect(conversation.save()).rejects.toThrow();
    });

    it('deletes all data of one contact and leaves others', async () => {
      const a = await contacts.ensureConversation('254711000001@s.whatsapp.net');
      const b = await contacts.ensureConversation('254711000002@s.whatsapp.net');
      await contacts.storeMessage({ conversation: a.conversation, jid: a.conversation.jid, waMessageId: '1', sender: 'contact', text: 'x' });
      await contacts.storeMessage({ conversation: b.conversation, jid: b.conversation.jid, waMessageId: '2', sender: 'contact', text: 'y' });
      await contacts.deleteContactData(a.conversation.jid);
      expect(await M.Contact.countDocuments()).toBe(1);
      expect(await M.Message.countDocuments()).toBe(1);
    });

    it('retention purges only old messages', async () => {
      const { conversation } = await contacts.ensureConversation('254711000666@s.whatsapp.net');
      await contacts.storeMessage({ conversation, jid: conversation.jid, waMessageId: 'old', sender: 'contact', text: 'old', timestamp: new Date(Date.now() - 200 * 86400_000) });
      await contacts.storeMessage({ conversation, jid: conversation.jid, waMessageId: 'new', sender: 'contact', text: 'new' });
      const out = await contacts.applyRetention(90);
      expect(out.messages).toBe(1);
      expect((await M.Message.find()).map((m) => m.waMessageId)).toEqual(['new']);
    });
  });

  describe('Requests', () => {
    it('creates a request linked to contact + conversation and updates it instead of duplicating', async () => {
      const { contact, conversation } = await contacts.ensureConversation('254711000777@s.whatsapp.net', { displayName: 'Brian' });
      const first = await requests.captureRequest({ conversation, contact, category: 'web_development', description: 'Site', collected: { a: 1 }, priority: 'normal' });
      const second = await requests.captureRequest({ conversation, contact, category: 'web_development', description: 'Site + blog', collected: { b: 2 }, priority: 'high' });
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      const all = await M.Request.find();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ description: 'Site + blog', priority: 'high', status: 'pending', contactName: 'Brian' });
      expect(all[0].collected).toMatchObject({ a: 1, b: 2 });
    });

    it('marking a request reviewed frees the conversation for a new request and supports filtering/search', async () => {
      const { contact, conversation } = await contacts.ensureConversation('254711000888@s.whatsapp.net', { displayName: 'Carol' });
      const { request } = await requests.captureRequest({ conversation, contact, category: 'kuccps', description: 'Course guidance needed' });
      await requests.updateRequest(request._id, { status: 'reviewed', ownerNotes: 'Called her' });
      expect((await M.Conversation.findById(conversation._id)).openRequest).toBeNull();
      expect(await requests.listRequests({ status: 'pending' })).toHaveLength(0);
      expect(await requests.listRequests({ category: 'kuccps', search: 'carol' })).toHaveLength(1);
      expect(await requests.listRequests({ search: '.*' })).toHaveLength(0); // regex chars are escaped
    });
  });

  describe('WhatsApp authentication persistence (MongoDB, encrypted)', () => {
    it('creates fresh creds on first run, persists them, and reloads the SAME identity after a "restart"', async () => {
      const first = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      expect(await auth.hasSavedCredentials('s')).toBe(false);
      await first.saveCreds();
      expect(await auth.hasSavedCredentials('s')).toBe(true);
      const second = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      expect(Buffer.from(second.state.creds.noiseKey.public).equals(Buffer.from(first.state.creds.noiseKey.public))).toBe(true);
      expect(second.state.creds.registrationId).toBe(first.state.creds.registrationId);
    });

    it('stores credentials and keys ENCRYPTED (no plaintext key material in MongoDB)', async () => {
      const a = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      await a.state.keys.set({ session: { 'user@s.whatsapp.net.1': new Uint8Array([1, 2, 3, 250]) } });
      await a.saveCreds();
      await a.flush();
      for (const doc of await M.WhatsAppAuth.find().lean()) {
        expect(doc.data.startsWith('v1:')).toBe(true);
        expect(doc.data).not.toContain('noiseKey');
        expect(doc.data).not.toContain('registrationId');
      }
    });

    it('round-trips Signal keys incl. binary data, and deletes keys set to null', async () => {
      const a = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      await a.state.keys.set({ session: { k1: new Uint8Array([9, 8, 7]) }, 'pre-key': { 5: { public: new Uint8Array([1]), private: new Uint8Array([2]) } } });
      const got = await a.state.keys.get('session', ['k1', 'missing']);
      expect(Array.from(got.k1)).toEqual([9, 8, 7]);
      expect(got.missing).toBeUndefined();
      await a.state.keys.set({ session: { k1: null } });
      expect(await a.state.keys.get('session', ['k1'])).toEqual({});
    });

    it('serialises concurrent key writes without losing any', async () => {
      const a = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      await Promise.all(Array.from({ length: 40 }, (_, i) => a.state.keys.set({ session: { [`k${i}`]: new Uint8Array([i]) } })));
      const ids = Array.from({ length: 40 }, (_, i) => `k${i}`);
      expect(Object.keys(await a.state.keys.get('session', ids))).toHaveLength(40);
    });

    it('refuses to start (instead of silently re-pairing) when the encryption key is wrong', async () => {
      const a = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      await a.saveCreds();
      await expect(auth.useMongoAuthState({ sessionId: 's', encryptionKey: '1'.repeat(64) })).rejects.toThrow(/SESSION_ENCRYPTION_KEY/);
    });

    it('supports key rotation: new key listed first, old key still reads existing data', async () => {
      const a = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      await a.saveCreds();
      const rotated = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: `${'2'.repeat(64)},${key}` });
      expect(rotated.state.creds.registrationId).toBe(a.state.creds.registrationId);
    });

    it('keeps sessions isolated by sessionId; clearSession wipes only the target', async () => {
      await (await auth.useMongoAuthState({ sessionId: 'one', encryptionKey: key })).saveCreds();
      await (await auth.useMongoAuthState({ sessionId: 'two', encryptionKey: key })).saveCreds();
      await auth.clearSession('one');
      expect(await auth.hasSavedCredentials('one')).toBe(false);
      expect(await auth.hasSavedCredentials('two')).toBe(true);
    });

    it('backup & recovery: restores the latest credential snapshot and keeps only a few backups', async () => {
      const a = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      await a.saveCreds();
      for (let i = 0; i < 7; i++) await auth.backupCreds('s', 3);
      expect(await M.WhatsAppBackup.countDocuments({ sessionId: 's' })).toBe(3);
      await M.WhatsAppAuth.deleteMany({ sessionId: 's' });
      expect(await auth.restoreLatestBackup('s')).toBe(true);
      const restored = await auth.useMongoAuthState({ sessionId: 's', encryptionKey: key });
      expect(restored.state.creds.registrationId).toBe(a.state.creds.registrationId);
    });
  });

  describe('Single-owner worker lock', () => {
    it('only one holder can own the session; expiry lets another take over', async () => {
      const a = new lockMod.SessionLock('wa:test', { holder: 'A', ttlMs: 150 });
      const b = new lockMod.SessionLock('wa:test', { holder: 'B', ttlMs: 150 });
      expect(await a.tryAcquire()).toBe(true);
      expect(await b.tryAcquire()).toBe(false);
      expect(await a.tryAcquire()).toBe(true); // renewal by the holder
      await new Promise((r) => setTimeout(r, 250));
      expect(await b.tryAcquire()).toBe(true); // A's lease expired (crashed dyno)
      expect(await a.tryAcquire()).toBe(false);
    });

    it('release frees the lock immediately', async () => {
      const a = new lockMod.SessionLock('wa:rel', { holder: 'A' });
      const b = new lockMod.SessionLock('wa:rel', { holder: 'B' });
      await a.tryAcquire();
      await a.release();
      expect(await b.tryAcquire()).toBe(true);
    });

    it('simultaneous start of several workers yields exactly one owner', async () => {
      const locks = ['A', 'B', 'C', 'D'].map((h) => new lockMod.SessionLock('wa:race', { holder: h }));
      const wins = (await Promise.all(locks.map((l) => l.tryAcquire()))).filter(Boolean);
      expect(wins).toHaveLength(1);
    });
  });

  describe('Settings persistence', () => {
    it('merges stored edits over defaults and survives reload', async () => {
      const s = await import('../../src/services/settings.js');
      await s.updateSetting('footer', '✦ TEST ✦');
      await s.updateSetting('services', [{ id: 'x', title: 'Custom', items: ['One'] }]);
      s.invalidateSettingsCache();
      const got = await s.getSettings({ fresh: true });
      expect(got.footer).toBe('✦ TEST ✦');
      expect(got.services[0].title).toBe('Custom');
      expect(got.ownerProfile.name).toBe('Legendary Smiley Cymor'); // default retained
      await expect(s.updateSetting('nope', 1)).rejects.toThrow();
    });

    it('env seeding never overwrites later dashboard edits', async () => {
      const s = await import('../../src/services/settings.js');
      await s.seedSettings({ ASSISTANT_ENABLED: true, OWNER_PHONE_NUMBER: '254700000001', NOTIFICATION_ENABLED: true });
      await s.updateSetting('assistantEnabled', false);
      await s.seedSettings({ ASSISTANT_ENABLED: true, OWNER_PHONE_NUMBER: '254700000001', NOTIFICATION_ENABLED: true });
      expect((await s.getSettings({ fresh: true })).assistantEnabled).toBe(false);
    });
  });
});

afterAll(() => mongoose.disconnect().catch(() => {}));
