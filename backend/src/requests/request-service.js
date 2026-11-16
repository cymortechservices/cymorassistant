import { Request, Conversation } from '../models/index.js';

/**
 * Create (or update) the open request for a conversation. Returns { request, created }.
 * Persistence is confirmed by MongoDB before this resolves — callers must only
 * tell the contact "saved" after it returns successfully.
 */
export async function captureRequest({ conversation, contact, category, description, collected, priority }) {
  const existing = conversation.openRequest ? await Request.findById(conversation.openRequest) : null;
  if (existing && existing.status === 'pending') {
    existing.description = description || existing.description;
    existing.collected = { ...(existing.collected || {}), ...(collected || {}) };
    if (priority && rank(priority) > rank(existing.priority)) existing.priority = priority;
    existing.category = category || existing.category;
    await existing.save();
    return { request: existing, created: false };
  }
  const request = await Request.create({
    contact: contact._id,
    conversation: conversation._id,
    jid: conversation.jid,
    phone: contact.phone,
    contactName: contact.displayName,
    category,
    description,
    collected: collected || {},
    priority: priority || 'normal',
  });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { openRequest: request._id } });
  conversation.openRequest = request._id;
  return { request, created: true };
}

const rank = (p) => ['low', 'normal', 'high', 'urgent'].indexOf(p);

export async function listRequests({ status, category, search, priority, limit = 100 } = {}) {
  const q = {};
  if (status) q.status = status;
  if (category) q.category = category;
  if (priority) q.priority = priority;
  if (search) {
    const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ description: re }, { contactName: re }, { phone: re }];
  }
  return Request.find(q).sort({ createdAt: -1 }).limit(Math.min(limit, 500)).lean();
}

export async function updateRequest(id, patch) {
  const allowed = {};
  if (patch.status) allowed.status = patch.status;
  if (typeof patch.ownerNotes === 'string') allowed.ownerNotes = patch.ownerNotes.slice(0, 2000);
  if (patch.priority) allowed.priority = patch.priority;
  const req = await Request.findByIdAndUpdate(id, { $set: allowed }, { new: true }).lean();
  if (req && (allowed.status === 'reviewed' || allowed.status === 'completed')) {
    await Conversation.updateOne({ _id: req.conversation, openRequest: req._id }, { $set: { openRequest: null } });
  }
  return req;
}
