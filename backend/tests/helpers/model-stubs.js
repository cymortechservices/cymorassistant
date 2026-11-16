import { vi } from 'vitest';

/** Thenable chain emulating Mongoose query builders (find().sort().limit().lean()). */
export function chain(result) {
  const c = {
    sort: () => c, limit: () => c, skip: () => c, select: () => c, populate: () => c, lean: () => Promise.resolve(result),
    then: (res, rej) => Promise.resolve(result).then(res, rej),
    catch: (rej) => Promise.resolve(result).catch(rej),
  };
  return c;
}

export function stubModel(overrides = {}) {
  return {
    find: vi.fn(() => chain([])),
    findOne: vi.fn(() => chain(null)),
    findById: vi.fn(() => chain(null)),
    findOneAndUpdate: vi.fn(() => chain(null)),
    findByIdAndUpdate: vi.fn(() => chain(null)),
    countDocuments: vi.fn(async () => 0),
    aggregate: vi.fn(async () => []),
    create: vi.fn(async (x) => x),
    updateOne: vi.fn(async () => ({})),
    deleteOne: vi.fn(async () => ({ deletedCount: 0 })),
    deleteMany: vi.fn(async () => ({ deletedCount: 0 })),
    exists: vi.fn(async () => null),
    ...overrides,
  };
}

/** Use inside vi.mock('../../src/models/index.js', ...) to keep constants but stub every model. */
export async function mockModels(importOriginal, overrides = {}) {
  const orig = await importOriginal();
  const names = ['Contact', 'Conversation', 'Message', 'Request', 'Setting', 'WhatsAppAuth', 'WhatsAppSession', 'WhatsAppBackup', 'WorkerLock', 'AuditLog', 'AiUsage'];
  const stubs = Object.fromEntries(names.map((n) => [n, stubModel(overrides[n])]));
  return { ...orig, ...stubs };
}
