import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import { WhatsAppAuth, WhatsAppSession, WhatsAppBackup } from '../models/index.js';
import { encryptString, decryptString } from '../utils/crypto.js';

/**
 * MongoDB-backed Baileys authentication state (replaces useMultiFileAuthState,
 * which relies on the ephemeral Heroku filesystem).
 *
 * - Every credential / Signal key is its own document, AES-256-GCM encrypted.
 * - Writes are serialised through a promise queue so concurrent key updates
 *   cannot interleave or reorder.
 * - Nothing here logs key material.
 */
export async function useMongoAuthState({ sessionId, encryptionKey }) {
  const enc = (value) => encryptString(JSON.stringify(value, BufferJSON.replacer), encryptionKey);
  const dec = (payload) => JSON.parse(decryptString(payload, encryptionKey), BufferJSON.reviver);

  let queue = Promise.resolve();
  const enqueue = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const credsDoc = await WhatsAppAuth.findOne({ sessionId, type: 'creds', keyId: 'main' }).lean();
  let creds;
  if (credsDoc) {
    try {
      creds = dec(credsDoc.data);
    } catch (e) {
      // Wrong key or corrupted data: surface clearly rather than silently re-pairing.
      throw new Error(`Stored WhatsApp credentials could not be decrypted (check SESSION_ENCRYPTION_KEY): ${e.message}`);
    }
  } else {
    creds = initAuthCreds();
  }

  const saveCreds = () =>
    enqueue(async () => {
      await WhatsAppAuth.updateOne(
        { sessionId, type: 'creds', keyId: 'main' },
        { $set: { data: enc(creds) } },
        { upsert: true },
      );
    });

  const keys = {
    get: async (type, ids) => {
      const docs = await WhatsAppAuth.find({ sessionId, type, keyId: { $in: ids } }).lean();
      const out = {};
      for (const d of docs) {
        let value = dec(d.data);
        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
        out[d.keyId] = value;
      }
      return out;
    },
    set: (data) =>
      enqueue(async () => {
        const ops = [];
        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            const value = data[type][id];
            const filter = { sessionId, type, keyId: id };
            if (value === null || value === undefined) ops.push({ deleteOne: { filter } });
            else ops.push({ updateOne: { filter, update: { $set: { data: enc(value) } }, upsert: true } });
          }
        }
        if (ops.length) await WhatsAppAuth.bulkWrite(ops, { ordered: true });
      }),
    clear: () => enqueue(() => WhatsAppAuth.deleteMany({ sessionId, type: { $ne: 'creds' } })),
  };

  return { state: { creds, keys }, saveCreds, flush: () => queue };
}

export async function hasSavedCredentials(sessionId) {
  const doc = await WhatsAppAuth.findOne({ sessionId, type: 'creds', keyId: 'main' }).lean();
  return Boolean(doc);
}

/** Remove ALL stored auth data (used on logout / revoked sessions). */
export async function clearSession(sessionId) {
  await WhatsAppAuth.deleteMany({ sessionId });
  await WhatsAppSession.updateOne(
    { sessionId },
    { $set: { qr: null, me: null, connectionState: 'disconnected', ownerLid: '' } },
    { upsert: true },
  );
}

/**
 * Recovery strategy: keep a few encrypted snapshots of the credential document.
 * Signal keys can be re-established by WhatsApp, but creds loss means re-pairing.
 */
export async function backupCreds(sessionId, keep = 5) {
  const doc = await WhatsAppAuth.findOne({ sessionId, type: 'creds', keyId: 'main' }).lean();
  if (!doc) return false;
  await WhatsAppBackup.create({ sessionId, data: doc.data });
  const old = await WhatsAppBackup.find({ sessionId }).sort({ createdAt: -1 }).skip(keep).select('_id').lean();
  if (old.length) await WhatsAppBackup.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  return true;
}

export async function restoreLatestBackup(sessionId) {
  const backup = await WhatsAppBackup.findOne({ sessionId }).sort({ createdAt: -1 }).lean();
  if (!backup) return false;
  await WhatsAppAuth.updateOne(
    { sessionId, type: 'creds', keyId: 'main' },
    { $set: { data: backup.data } },
    { upsert: true },
  );
  return true;
}
