import { AuditLog } from '../models/index.js';
import { child } from './logger.js';

const log = child('audit');

/** Record an important owner/admin action. Never throws. */
export async function audit(actor, action, detail = '') {
  try {
    await AuditLog.create({ actor, action, detail: String(detail).slice(0, 500) });
  } catch (e) {
    log.warn({ err: e.message }, 'Audit write failed');
  }
}
