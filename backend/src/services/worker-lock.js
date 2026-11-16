import crypto from 'node:crypto';
import { WorkerLock } from '../models/index.js';
import { child } from '../utils/logger.js';

const log = child('worker-lock');

/**
 * MongoDB lease lock: guarantees only ONE worker owns a WhatsApp session.
 * The holder renews the lease; if the process dies the lease expires and
 * another instance may take over. A second concurrent WhatsApp connection
 * for the same account would cause "connection replaced" logout loops.
 */
export class SessionLock {
  constructor(name, { ttlMs = 60_000, renewMs = 20_000, holder } = {}) {
    this.name = name;
    this.ttlMs = ttlMs;
    this.renewMs = renewMs;
    this.holder = holder || `${process.env.DYNO || 'local'}-${crypto.randomBytes(4).toString('hex')}`;
    this.timer = null;
    this.onLost = null;
  }

  async tryAcquire() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    try {
      const doc = await WorkerLock.findOneAndUpdate(
        { name: this.name, $or: [{ holder: this.holder }, { expiresAt: { $lt: now } }] },
        { $set: { holder: this.holder, expiresAt } },
        { upsert: true, new: true },
      );
      return doc?.holder === this.holder;
    } catch (e) {
      // Duplicate key => another live holder exists.
      if (e.code === 11000) return false;
      throw e;
    }
  }

  startRenewing() {
    this.timer = setInterval(async () => {
      try {
        const ok = await this.tryAcquire();
        if (!ok) {
          log.error('Lost session lock to another instance');
          this.stopRenewing();
          this.onLost?.();
        }
      } catch (e) {
        log.warn({ err: e.message }, 'Lock renewal failed (will retry)');
      }
    }, this.renewMs);
    this.timer.unref?.();
  }

  stopRenewing() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async release() {
    this.stopRenewing();
    await WorkerLock.deleteOne({ name: this.name, holder: this.holder }).catch(() => {});
  }
}
