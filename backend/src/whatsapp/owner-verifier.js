import { normalizePhone, jidToPhone, isLidJid } from '../utils/phone.js';

/**
 * Decide whether a WhatsApp message genuinely comes from the owner.
 * Trust is based ONLY on WhatsApp-authenticated identifiers (the sender JID and
 * the fromMe flag set by WhatsApp), never on message text, display names or
 * anything a contact can type.
 *
 *  A. fromMe=true (typed on the linked phone) AND the linked account's number
 *     equals the configured OWNER_PHONE_NUMBER.
 *  B. fromMe=false and the sender's phone-number JID equals OWNER_PHONE_NUMBER
 *     (owner messaging the assistant's number from a different phone).
 *  C. fromMe=false and the sender is the owner's known LID.
 */
export function isOwnerMessage({ fromMe, senderJid, senderJidAlt, ownerPhone, linkedPhone, ownerLid }) {
  const owner = normalizePhone(ownerPhone);
  if (!owner) return false; // not configured => nobody is the owner
  if (fromMe) return normalizePhone(linkedPhone) === owner;
  const senderPhone = jidToPhone(senderJid) || jidToPhone(senderJidAlt);
  if (senderPhone) return senderPhone === owner;
  if (isLidJid(senderJid) && ownerLid && senderJid.split('@')[0].split(':')[0] === ownerLid.split('@')[0].split(':')[0]) return true;
  return false;
}
