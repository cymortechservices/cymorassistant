import { Setting } from '../models/index.js';
import { DEFAULT_SETTINGS } from '../knowledge/defaults.js';

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const k of Object.keys(override)) out[k] = isPlainObject(base[k]) ? merge(base[k], override[k]) : override[k];
  return out;
}

let cache = null;
let cacheAt = 0;
const TTL_MS = 5000;

/** Read all settings, merged over defaults. Cached for a few seconds. */
export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL_MS) return cache;
  const docs = await Setting.find({}).lean();
  let result = structuredClone(DEFAULT_SETTINGS);
  for (const d of docs) {
    if (d.key in DEFAULT_SETTINGS) result[d.key] = merge(DEFAULT_SETTINGS[d.key], d.value);
  }
  cache = result;
  cacheAt = Date.now();
  return result;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function updateSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`);
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
  invalidateSettingsCache();
}

export async function updateSettings(patch) {
  for (const [k, v] of Object.entries(patch)) await updateSetting(k, v);
}

/** Seed environment-based defaults the first time (never overwrites dashboard edits). */
export async function seedSettings(config) {
  const seeds = {
    assistantEnabled: config.ASSISTANT_ENABLED,
    ownerPhone: config.OWNER_PHONE_NUMBER,
    notifications: { ...DEFAULT_SETTINGS.notifications, enabled: config.NOTIFICATION_ENABLED },
  };
  for (const [key, value] of Object.entries(seeds)) {
    await Setting.updateOne({ key }, { $setOnInsert: { value } }, { upsert: true });
  }
  invalidateSettingsCache();
}

/** Is global automation active right now (considering ON/OFF and a timed pause)? */
export function automationActive(settings, now = new Date()) {
  if (!settings.assistantEnabled) return false;
  if (settings.pausedUntil && new Date(settings.pausedUntil) > now) return false;
  return true;
}
