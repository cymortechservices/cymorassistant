import { Contact, Conversation, Message, Request } from '../models/index.js';
import { jidToPhone } from '../utils/phone.js';

/** Find or create the contact + conversation for a chat JID. */
export async function ensureConversation(jid, { displayName = '', phone = '' } = {}) {
  const resolvedPhone = phone || jidToPhone(jid);
  let contact = await Contact.findOneAndUpdate(
    { jid },
    {
      $setOnInsert: { jid, firstInteractionAt: new Date(), phone: resolvedPhone },
      $set: { lastInteractionAt: new Date(), ...(displayName ? { displayName } : {}) },
    },
    { upsert: true, new: true },
  );
  if (resolvedPhone && !contact.phone) {
    contact.phone = resolvedPhone;
    await contact.save();
  }
  let conversation = await Conversation.findOne({ jid });
  if (!conversation) {
    try {
      conversation = await Conversation.create({ contact: contact._id, jid });
    } catch (e) {
      if (e.code !== 11000) throw e;
      conversation = await Conversation.findOne({ jid });
    }
  }
  return { contact, conversation };
}

/**
 * Store a message. Returns null if it was a duplicate (same WhatsApp message ID),
 * which is how duplicate WhatsApp events are ignored.
 */
export async function storeMessage({ conversation, jid, waMessageId, sender, type = 'text', text = '', automated = false, timestamp = new Date() }) {
  try {
    const msg = await Message.create({ conversation: conversation._id, jid, waMessageId: waMessageId || null, sender, type, text: String(text).slice(0, 4000), automated, timestamp });
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessageAt: timestamp, lastMessagePreview: String(text).slice(0, 120) } },
    );
    return msg;
  } catch (e) {
    if (e.code === 11000) return null;
    throw e;
  }
}

/** Privacy: remove every stored trace of one contact. */
export async function deleteContactData(jid) {
  const conv = await Conversation.findOne({ jid });
  const reqs = await Request.deleteMany({ jid });
  const msgs = await Message.deleteMany({ jid });
  if (conv) await Conversation.deleteOne({ _id: conv._id });
  const c = await Contact.deleteOne({ jid });
  return { contacts: c.deletedCount, messages: msgs.deletedCount, requests: reqs.deletedCount, conversations: conv ? 1 : 0 };
}

/** Retention policy: purge old message bodies and ended conversations. */
export async function applyRetention(days) {
  if (!days || days <= 0) return { messages: 0 };
  const cutoff = new Date(Date.now() - days * 86400_000);
  const msgs = await Message.deleteMany({ timestamp: { $lt: cutoff } });
  return { messages: msgs.deletedCount };
}
