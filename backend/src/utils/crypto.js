import crypto from 'node:crypto';

/**
 * AES-256-GCM helpers used to encrypt WhatsApp authentication data at rest.
 * Key rotation: SESSION_ENCRYPTION_KEY may hold several keys separated by commas.
 * The FIRST key encrypts; every key is tried when decrypting. See docs/SECURITY.md.
 */
function deriveKey(raw) {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return crypto.createHash('sha256').update(trimmed).digest();
}

export function parseKeys(keyString) {
  const keys = String(keyString || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map(deriveKey);
  if (!keys.length) throw new Error('No encryption key configured');
  return keys;
}

export function encryptString(plain, keyString) {
  const [key] = parseKeys(keyString);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptString(payload, keyString) {
  const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  let lastError;
  for (const key of parseKeys(keyString)) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Unable to decrypt payload with any configured key: ${lastError?.message}`);
}
