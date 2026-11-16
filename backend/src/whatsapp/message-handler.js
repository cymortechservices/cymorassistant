import { extractMessageContent, getContentType } from '@whiskeysockets/baileys';
import { isGroupJid, isStatusJid, isLidJid, jidToPhone, phoneToJid, normalizePhone } from '../utils/phone.js';
import { isOwnerMessage } from './owner-verifier.js';
import { isCommand, executeCommand } from '../commands/index.js';
import { audit } from '../utils/audit.js';
import { child } from '../utils/logger.js';

const log = child('messages');

const MAX_AGE_MS = 24 * 3600 * 1000;

const TYPE_MAP = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
  reactionMessage: 'reaction',
};

/** Turn a raw Baileys message into { type, text } or null if it should be ignored. */
export function describeMessage(message) {
  const content = extractMessageContent(message);
  if (!content) return null;
  const key = getContentType(content);
  if (!key) return null;
  let type = TYPE_MAP[key];
  if (!type) return key === 'protocolMessage' || key === 'senderKeyDistributionMessage' ? null : { type: 'unsupported', text: '' };
  const m = content[key];
  let text = '';
  if (key === 'conversation') text = m;
  else if (key === 'extendedTextMessage') text = m?.text || '';
  else if (m?.caption) text = m.caption;
  if (key === 'audioMessage' && m?.ptt) type = 'ptt';
  if (type === 'location') text = '[Shared a location]';
  if (type === 'contact') text = '[Shared a contact card]';
  if (type === 'sticker') text = '';
  return { type, text: String(text || '') };
}

/**
 * Routes every incoming WhatsApp message:
 *   owner command      -> command processor (never the AI)
 *   owner typing in a customer chat -> record + human takeover
 *   contact message    -> conversation engine
 * deps: { conn, engine, getSettings, getHealth, ai, getLinked(): { phone, lid, jid } }
 */
export class MessageHandler {
  constructor(deps) {
    this.deps = deps;
  }

  async handleUpsert({ messages, type }) {
    if (type !== 'notify') return; // ignore history sync / appended messages
    for (const m of messages || []) {
      try {
        await this.handleOne(m);
      } catch (e) {
        log.error({ err: e.message }, 'Message handling failed');
      }
    }
  }

  async handleOne(m) {
    const { conn, engine, getSettings, getLinked } = this.deps;
    const key = m.key || {};
    const remoteJid = key.remoteJid;
    const id = key.id;
    if (!remoteJid || !id || !m.message) return;
    if (isStatusJid(remoteJid)) return;

    const settings = await getSettings();
    if (isGroupJid(remoteJid) && !settings.automation.groupsEnabled) return;
    if (isGroupJid(remoteJid)) return; // group handling is not implemented in this release even if enabled
    if (key.fromMe && conn.isOwnEcho(id)) return; // our own messages

    const ts = Number(m.messageTimestamp?.toString?.() ?? m.messageTimestamp) * 1000;
    const timestamp = Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date();
    if (Date.now() - timestamp.getTime() > MAX_AGE_MS) return;

    const desc = describeMessage(m.message);
    if (!desc) return;

    const linked = getLinked();
    const ownerPhone = normalizePhone(settings.ownerPhone);
    // Canonical chat JID: prefer the phone-number JID when WhatsApp gives both.
    const chatJid = isLidJid(remoteJid) && key.remoteJidAlt && !isLidJid(key.remoteJidAlt) ? key.remoteJidAlt : remoteJid;

    const owner = isOwnerMessage({
      fromMe: Boolean(key.fromMe),
      senderJid: remoteJid,
      senderJidAlt: key.remoteJidAlt,
      ownerPhone,
      linkedPhone: linked.phone,
      ownerLid: linked.lid,
    });

    const isSelfChat = Boolean(key.fromMe) && (jidToPhone(chatJid) === linked.phone || (linked.lid && remoteJid.split('@')[0].split(':')[0] === linked.lid.split('@')[0].split(':')[0]));

    // ---- Owner commands
    if (desc.type === 'text' && isCommand(desc.text)) {
      if (!owner) {
        await audit('unknown', 'unauthorized_command_attempt', jidToPhone(chatJid) || 'unknown');
        log.warn('Ignoring .assistant command from a non-owner');
        // Fall through: treated as an ordinary (untrusted) contact message, never executed.
      } else {
        const out = await executeCommand(desc.text, { chatJid, isSelfChat, getHealth: this.deps.getHealth, ai: this.deps.ai, tz: this.deps.tz });
        // Replies go to the owner's own chat so a customer can never see them.
        const ownerJid = linked.jid || phoneToJid(ownerPhone);
        const target = isSelfChat ? remoteJid : ownerJid;
        if (target) await conn.sendText(target, out.reply);
        if (out.deleteCommand && key.fromMe) {
          try {
            await conn.sock?.sendMessage(remoteJid, { delete: key });
          } catch {
            /* best effort */
          }
        }
        return;
      }
    }

    // ---- Owner typing in a customer chat from the linked phone
    if (key.fromMe) {
      if (isSelfChat) return; // owner's own notes chat
      if (owner) await this.deps.engine.recordOwnerMessage({ jid: chatJid, waMessageId: id, text: desc.text || `[${desc.type}]`, type: desc.type, timestamp });
      return;
    }

    // ---- Ordinary contact
    if (desc.type === 'reaction') return;
    await this.deps.engine.handleContactMessage({
      jid: chatJid,
      waMessageId: id,
      text: desc.text,
      type: desc.type,
      pushName: m.pushName || '',
      timestamp,
    });
  }
}
