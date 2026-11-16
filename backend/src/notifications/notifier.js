import { Request, Message } from '../models/index.js';
import { formatOwnerNotification } from '../assistant/message-formatter.js';
import { formatPhone } from '../utils/phone.js';
import { child } from '../utils/logger.js';

const log = child('notifier');

const CATEGORY_LABEL = {
  web_development: 'Website Development',
  software_development: 'Software Development',
  kuccps: 'KUCCPS Consultation',
  academic_guidance: 'Academic Guidance',
  technical_support: 'Technical Support',
  business_inquiry: 'Business Inquiry',
  partnership: 'Partnership',
  personal: 'Personal',
  general_conversation: 'General',
  other: 'Other',
};
export const categoryLabel = (c) => CATEGORY_LABEL[c] || 'Other';

/**
 * Sends WhatsApp notifications to the owner. `send(text)` is injected (the
 * worker passes a function that messages the owner's chat), so this module is
 * easy to test and never talks to WhatsApp directly.
 */
export class Notifier {
  constructor({ send, getSettings }) {
    this.send = send;
    this.getSettings = getSettings;
  }

  async #enabled(kind) {
    const s = (await this.getSettings()).notifications;
    return Boolean(s.enabled && s[kind]);
  }

  /** New / updated request. Only notifies ONCE per request (notifiedAt guard). */
  async notifyRequest(request, { urgent = false } = {}) {
    const kind = request.category === 'kuccps' ? 'kuccps' : urgent || request.priority === 'urgent' ? 'urgent' : 'newInquiry';
    if (!(await this.#enabled(kind)) && !(await this.#enabled('newInquiry'))) return false;
    // Atomic claim so concurrent events cannot double-notify.
    const claimed = await Request.findOneAndUpdate({ _id: request._id, notifiedAt: null }, { $set: { notifiedAt: new Date() } }, { new: true });
    if (!claimed) return false;
    const urgentTag = request.priority === 'urgent' || urgent ? '🚨 URGENT — ' : '';
    const title = request.category === 'kuccps' ? 'NEW KUCCPS CONSULTATION REQUEST' : 'NEW CYMOR ASSISTANT INQUIRY';
    const text = [
      `🔔 ${urgentTag}${title}`,
      '',
      `Contact: ${request.contactName || 'Not provided'}`,
      `Number: ${formatPhone(request.phone)}`,
      `Category: ${categoryLabel(request.category)}`,
      `Priority: ${request.priority}`,
      '',
      'Request:',
      request.description,
      '',
      'Status: Pending owner review.',
    ].join('\n');
    try {
      await this.send(formatOwnerNotification(text));
      return true;
    } catch (e) {
      log.error({ err: e.message }, 'Owner notification failed; will not mark as sent');
      await Request.updateOne({ _id: request._id }, { $set: { notifiedAt: null } });
      return false;
    }
  }

  async notifyUnanswered({ contactName, phone, question }) {
    if (!(await this.#enabled('unansweredQuestion'))) return false;
    const text = ['❓ QUESTION NEEDS YOUR ANSWER', '', `Contact: ${contactName || 'Not provided'}`, `Number: ${formatPhone(phone)}`, '', 'Question:', String(question).slice(0, 600)].join('\n');
    try {
      await this.send(formatOwnerNotification(text));
      return true;
    } catch (e) {
      log.error({ err: e.message }, 'Unanswered-question notification failed');
      return false;
    }
  }

  async sendDailySummary() {
    if (!(await this.#enabled('dailySummary'))) return false;
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [msgCount, pending, created] = await Promise.all([
      Message.countDocuments({ timestamp: { $gte: since }, sender: 'contact' }),
      Request.countDocuments({ status: 'pending' }),
      Request.find({ createdAt: { $gte: since } }).lean(),
    ]);
    const byCat = created.reduce((a, r) => ((a[categoryLabel(r.category)] = (a[categoryLabel(r.category)] || 0) + 1), a), {});
    const text = [
      '📊 DAILY SUMMARY (last 24h)',
      '',
      `Messages received: ${msgCount}`,
      `New requests: ${created.length}`,
      ...Object.entries(byCat).map(([k, v]) => `  • ${k}: ${v}`),
      `Pending requests overall: ${pending}`,
    ].join('\n');
    try {
      await this.send(formatOwnerNotification(text));
      return true;
    } catch (e) {
      log.error({ err: e.message }, 'Daily summary failed');
      return false;
    }
  }
}
