import mongoose from 'mongoose';

/**
 * Integration tests need a real MongoDB-compatible server. Resolution order:
 *  1. TEST_MONGODB_URI (e.g. a local mongod or a throw-away Atlas database)
 *  2. mongodb-memory-server (downloads a mongod binary on first use)
 * Returns null when neither is available so the suite can SKIP (never fake-pass).
 */
let memServer = null;

export async function getTestMongoUri() {
  if (process.env.TEST_MONGODB_URI) return process.env.TEST_MONGODB_URI;
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memServer = await MongoMemoryServer.create();
    return memServer.getUri();
  } catch {
    return null;
  }
}

export async function connectTestDb(uri) {
  await mongoose.connect(uri, { dbName: `cymor_test_${process.pid}`, serverSelectionTimeoutMS: 10000 });
  await mongoose.connection.dropDatabase();
  // Make sure indexes (unique / partial) exist before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

export async function resetDb() {
  const cols = await mongoose.connection.db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}

export async function closeTestDb() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  if (memServer) await memServer.stop();
}
