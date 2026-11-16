/**
 * Phone / JID helpers. Kenya (254) is the default country.
 * WhatsApp may identify a user by phone-number JID (@s.whatsapp.net) or by
 * a privacy LID (@lid). LIDs can NOT be converted to numbers without a mapping,
 * so owner verification accepts either a phone JID or a stored owner LID.
 */
export function normalizePhone(input, defaultCountry = '254') {
  if (!input) return '';
  let digits = String(input).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = defaultCountry + digits.slice(1);
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) digits = defaultCountry + digits;
  return digits;
}

export function jidToPhone(jid) {
  if (!jid) return '';
  const [user, server] = String(jid).split('@');
  if (server !== 's.whatsapp.net') return '';
  return normalizePhone(user.split(':')[0]);
}

export function phoneToJid(phone) {
  const n = normalizePhone(phone);
  return n ? `${n}@s.whatsapp.net` : '';
}

export function isGroupJid(jid) {
  return String(jid || '').endsWith('@g.us');
}

export function isStatusJid(jid) {
  return String(jid || '') === 'status@broadcast' || String(jid || '').endsWith('@broadcast');
}

export function isLidJid(jid) {
  return String(jid || '').endsWith('@lid');
}

export function formatPhone(phone) {
  return phone ? `+${phone}` : 'unknown';
}
