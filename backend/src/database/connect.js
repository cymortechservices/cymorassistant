import mongoose from 'mongoose';
import { child } from '../utils/logger.js';

const log = child('database');

export async function connectDatabase(uri) {
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => log.warn('MongoDB disconnected (driver will auto-reconnect)'));
  mongoose.connection.on('reconnected', () => log.info('MongoDB reconnected'));
  mongoose.connection.on('error', (e) => log.error({ err: e.message }, 'MongoDB error'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, maxPoolSize: 10 });
  log.info('MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function databaseStatus() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
}
