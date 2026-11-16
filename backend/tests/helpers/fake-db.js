import { vi } from 'vitest';

/**
 * Minimal in-memory stand-in for the Mongoose models, with REAL filter/update
 * semantics for the operators the app uses ($set, $inc, $setOnInsert, $gt, $gte,
 * $lt, $in, $ne, equality, upsert, unique keys). Used so conversation-flow tests
 * can execute without a MongoDB server. It is NOT a substitute for the
 * integration tests in tests/integration (indexes, encryption round-trips).
 */
let counter = 0;
const nextId = () => String(++counter).padStart(24, '0');

const same = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b));

function matchValue(actual, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof RegExp) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, v]) => {
      switch (op) {
        case '$gt': return actual != null && new Date(actual) > new Date(v);
        case '$gte': return actual != null && new Date(actual) >= new Date(v);
        case '$lt': return actual != null && new Date(actual) < new Date(v);
        case '$in': return v.some((x) => same(actual, x));
        case '$ne': return !(actual === v || (actual != null && v != null && same(actual, v)));
        case '$type': return true;
        default: throw new Error(`fake-db: unsupported operator ${op}`);
      }
    });
  }
  if (cond instanceof RegExp) return cond.test(actual ?? '');
  if (cond === null) return actual === null || actual === undefined;
  return actual !== undefined && actual !== null && same(actual, cond);
}

const matches = (doc, filter = {}) =>
  Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return v.some((f) => matches(doc, f));
    return matchValue(doc[k], v);
  });

function applyUpdate(doc, update, inserting = false) {
  for (const [k, v] of Object.entries(update.$set || {})) doc[k] = v;
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
  if (inserting) for (const [k, v] of Object.entries(update.$setOnInsert || {})) doc[k] = v;
}

export class FakeModel {
  constructor(name, { unique = [], defaults = () => ({}) } = {}) {
    this.name = name;
    this.rows = [];
    this.unique = unique; // array of key arrays
    this.defaults = defaults;
    for (const m of ['find', 'findOne', 'findById', 'findOneAndUpdate', 'findByIdAndUpdate', 'updateOne', 'create', 'countDocuments', 'deleteOne', 'deleteMany', 'exists', 'aggregate']) {
      this[m] = vi.fn(this[`_${m}`].bind(this));
    }
  }

  reset() { this.rows = []; }

  #wrap(row) {
    if (!row) return null;
    const model = this;
    const doc = Object.create({
      save: async () => { model.#writeBack(doc); return doc; },
      toObject: () => ({ ...doc }),
    });
    Object.assign(doc, row);
    return doc;
  }

  #writeBack(doc) {
    const i = this.rows.findIndex((r) => String(r._id) === String(doc._id));
    if (i >= 0) this.rows[i] = { ...doc };
  }

  #chain(getResult, { docs = false } = {}) {
    const state = { sort: null, limit: null };
    const run = () => {
      let out = getResult();
      if (state.sort) {
        const [[k, dir]] = Object.entries(state.sort);
        out = [...out].sort((a, b) => (new Date(a[k]) - new Date(b[k])) * dir);
      }
      if (state.limit) out = out.slice(0, state.limit);
      return out;
    };
    const c = {
      sort: (s) => ((state.sort = s), c),
      limit: (n) => ((state.limit = n), c),
      skip: () => c, select: () => c, populate: () => c,
      lean: () => Promise.resolve(run().map((r) => ({ ...r }))),
      then: (res, rej) => Promise.resolve(docs ? run().map((r) => this.#wrap(r)) : run().map((r) => ({ ...r }))).then(res, rej),
    };
    return c;
  }

  _find(filter) { return this.#chain(() => this.rows.filter((r) => matches(r, filter)), { docs: true }); }

  _findOne(filter) {
    const c = this.#chain(() => this.rows.filter((r) => matches(r, filter)).slice(0, 1), { docs: true });
    const base = c.then;
    c.then = (res, rej) => base.call(c, (arr) => res(arr[0] ?? null), rej);
    c.lean = () => Promise.resolve(this.rows.filter((r) => matches(r, filter))[0] ? { ...this.rows.filter((r) => matches(r, filter))[0] } : null);
    return c;
  }

  _findById(id) { return this._findOne({ _id: id }); }

  async _create(data) {
    const row = { _id: nextId(), createdAt: new Date(), ...this.defaults(), ...data };
    for (const keys of this.unique) {
      const present = keys.every((k) => row[k] !== undefined && row[k] !== null);
      if (present && this.rows.some((r) => keys.every((k) => same(r[k], row[k])))) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    this.rows.push(row);
    return this.#wrap(row);
  }

  async _updateOne(filter, update, opts = {}) {
    const row = this.rows.find((r) => matches(r, filter));
    if (row) { applyUpdate(row, update); return { matchedCount: 1, modifiedCount: 1 }; }
    if (opts.upsert) {
      const base = Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || v instanceof Date));
      const created = { _id: nextId(), ...this.defaults(), ...base };
      applyUpdate(created, update, true);
      this.rows.push(created);
      return { upsertedCount: 1 };
    }
    return { matchedCount: 0 };
  }

  async _findOneAndUpdate(filter, update, opts = {}) {
    const row = this.rows.find((r) => matches(r, filter));
    if (row) {
      const before = { ...row };
      applyUpdate(row, update);
      return this.#wrap(opts.new ? row : before);
    }
    if (opts.upsert) {
      const base = Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || v instanceof Date));
      const created = { _id: nextId(), ...this.defaults(), ...base };
      applyUpdate(created, update, true);
      this.rows.push(created);
      return opts.new ? this.#wrap(created) : null;
    }
    return null;
  }

  _findByIdAndUpdate(id, update, opts) { return this._findOneAndUpdate({ _id: id }, update, opts); }
  async _countDocuments(filter) { return this.rows.filter((r) => matches(r, filter)).length; }
  async _exists(filter) { return this.rows.some((r) => matches(r, filter)) ? { _id: 1 } : null; }
  async _deleteOne(filter) { const i = this.rows.findIndex((r) => matches(r, filter)); if (i >= 0) this.rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
  async _deleteMany(filter) { const before = this.rows.length; this.rows = this.rows.filter((r) => !matches(r, filter)); return { deletedCount: before - this.rows.length }; }
  async _aggregate() { return []; }
}

export function createFakeDb() {
  const now = () => new Date();
  return {
    Contact: new FakeModel('Contact', { unique: [['jid']], defaults: () => ({ displayName: '', phone: '', status: 'active', firstInteractionAt: now(), lastInteractionAt: now() }) }),
    Conversation: new FakeModel('Conversation', {
      unique: [['jid']],
      defaults: () => ({ state: 'NEW_CONTACT', stateBeforeOverride: null, category: 'general_conversation', automationEnabled: true, humanTakeover: false, takeoverAt: null, lastOwnerMessageAt: null, lastMessageAt: now(), lastMessagePreview: '', summary: '', summarizedUpTo: null, collected: {}, openRequest: null, consecutiveBotReplies: 0, aiFailureNotifiedAt: null }),
    }),
    Message: new FakeModel('Message', { unique: [['jid', 'waMessageId']], defaults: () => ({ type: 'text', text: '', automated: false, timestamp: now() }) }),
    Request: new FakeModel('Request', { defaults: () => ({ status: 'pending', priority: 'normal', collected: {}, ownerNotes: '', notifiedAt: null, category: 'other' }) }),
    Setting: new FakeModel('Setting', { unique: [['key']] }),
    AuditLog: new FakeModel('AuditLog'),
    AiUsage: new FakeModel('AiUsage'),
    WhatsAppSession: new FakeModel('WhatsAppSession'),
    WhatsAppAuth: new FakeModel('WhatsAppAuth'),
    WhatsAppBackup: new FakeModel('WhatsAppBackup'),
    WorkerLock: new FakeModel('WorkerLock'),
  };
}
