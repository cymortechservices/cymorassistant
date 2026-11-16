import { Conversation, Message } from '../models/index.js';
import { ensureConversation, storeMessage } from '../services/contacts.js';
import { automationActive } from '../services/settings.js';
import { buildPrompt } from '../ai/prompt-builder.js';
import { loadContext, maybeSummarize } from '../ai/conversation-memory.js';
import { guardReply } from '../ai/response-validator.js';
import { AiUnavailableError } from '../ai/gemini.js';
import { captureRequest } from '../requests/request-service.js';
import { getVerifiedKuccpsFacts, isKuccpsText } from '../knowledge/kuccps-knowledge.js';
import { formatAssistantMessage } from './message-formatter.js';
import { resolveNextState, looksLikeGoodbye, looksLikeGreetingOnly, SILENT_STATES } from './conversation-state.js';
import { child } from '../utils/logger.js';

const log = child('engine');

const ACK_ONLY = /^\s*(ok(ay)?|k|kk|thanks?|thank you|thx|asante|sawa|poa|cool|nice|alright|👍|🙏|😊|👌)[\s!.]*$/iu;

const FALLBACKS = {
  greeting:
    "Hey there! 👋😊\n\nWelcome! It's really nice to hear from you.\n\nHow are you doing today? I hope everything is going well!",
  goodbye: 'Take care! 😊 It was lovely chatting. Reach out any time.',
  generic:
    "Thanks for your message! 😊 I'm having a little trouble thinking right now, but I've noted it and my owner will see it when he's available.",
};

/**
 * Orchestrates one incoming contact message end-to-end.
 * deps: { ai, getSettings, send(jid, text), notifier, presence?(jid, kind) }
 */
export class ConversationEngine {
  constructor(deps) {
    this.deps = deps;
    this.queues = new Map(); // per-chat serialisation so replies stay in order
  }

  /** Serialise processing per chat; different chats run concurrently. */
  handleContactMessage(msg) {
    const prev = this.queues.get(msg.jid) || Promise.resolve();
    const run = prev.then(() => this.#process(msg)).catch((e) => {
      log.error({ err: e.message }, 'Unhandled error processing message');
      return { replied: false, reason: 'error' };
    });
    this.queues.set(msg.jid, run.finally(() => {
      if (this.queues.get(msg.jid) === run) this.queues.delete(msg.jid);
    }));
    return run;
  }

  async #process({ jid, waMessageId, text, type = 'text', pushName = '', timestamp = new Date() }) {
    const { getSettings, send } = this.deps;
    const settings = await getSettings();
    const { contact, conversation } = await ensureConversation(jid, { displayName: pushName });

    const stored = await storeMessage({ conversation, jid, waMessageId, sender: 'contact', type, text, timestamp });
    if (!stored) return { replied: false, reason: 'duplicate' };
    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: timestamp } });

    // ---- Gate: should the assistant answer at all?
    const gate = await this.#gate(conversation, settings);
    if (gate) return { replied: false, reason: gate };

    if (type === 'reaction') return { replied: false, reason: 'reaction' };

    // Respect finished conversations: don't answer a bare "thanks"/"ok" after goodbye.
    if (conversation.state === 'CONVERSATION_ENDED' && ACK_ONLY.test(text || '')) return { replied: false, reason: 'ended_ack' };

    // Loop guard: if we've already sent many replies in the last minute, stop.
    const recent = await Message.countDocuments({ conversation: conversation._id, sender: 'assistant', timestamp: { $gt: new Date(Date.now() - 60_000) } });
    if (recent >= 5) {
      log.warn({ jid: '[chat]' }, 'Reply burst guard triggered; skipping');
      return { replied: false, reason: 'burst_guard' };
    }

    // ---- Non-text content: polite, no downloading, no AI
    const mediaReply = this.#mediaReply(type);
    if (mediaReply) return this.#deliver(conversation, jid, mediaReply, settings, { state: conversation.state === 'NEW_CONTACT' ? 'GREETING_SENT' : undefined });

    // ---- AI turn
    const history = await loadContext(conversation, settings.ai.historyMessages);
    // The newest message is already stored; drop it from history to avoid duplication.
    const trimmed = history.history.filter((m) => String(m._id) !== String(stored._id));
    const verified = isKuccpsText(text) ? await getVerifiedKuccpsFacts(text) : [];
    const prompt = buildPrompt({ settings, conversation, contact, history: trimmed, summary: history.summary, newMessage: text, verifiedKuccpsFacts: verified });

    this.deps.ai.configure?.({ timeoutMs: settings.ai.timeoutMs, maxRetries: settings.ai.maxRetries });
    let result;
    try {
      this.deps.presence?.(jid, 'composing');
      result = await this.deps.ai.respond({ ...prompt, temperature: settings.ai.temperature });
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      return this.#fallback(conversation, jid, text, settings);
    }

    let reply = guardReply(result.reply);
    if (!reply) {
      log.warn('AI reply blocked by guard');
      reply = "I'm CYMOR ASSISTANT, an AI assistant for Legendary Smiley Cymor. How can I help you today? 😊";
    }

    // ---- Persist the request BEFORE telling the contact it is saved
    let requestRecord = null;
    if (result.request_detected) {
      try {
        const category = result.category === 'general_conversation' || result.category === 'personal' ? 'other' : result.category;
        const { request, created } = await captureRequest({
          conversation,
          contact,
          category,
          description: result.request_summary || String(text).slice(0, 500),
          collected: { ...(conversation.collected || {}), ...result.collected },
          priority: result.priority,
        });
        requestRecord = { request, created };
      } catch (e) {
        log.error({ err: e.message }, 'Failed to persist request');
        reply = "Thank you for explaining that! 😊 I hit a small problem saving your request just now. Could you please send the main details once more so I can record them for my owner?";
        result.next_state = 'COLLECTING_REQUEST';
      }
    }

    const nextState = result.conversation_ended || looksLikeGoodbye(text) ? 'CONVERSATION_ENDED' : resolveNextState(conversation.state, result.next_state);
    const delivered = await this.#deliver(conversation, jid, reply, settings, {
      state: nextState,
      category: result.category,
      collected: result.collected,
    });

    // ---- Notifications (after the reply so contact latency is unaffected)
    // Notify on creation, and retry later if an earlier notification attempt failed (notifiedAt still null).
    if (requestRecord && (requestRecord.created || !requestRecord.request.notifiedAt)) {
      await this.deps.notifier.notifyRequest(requestRecord.request, { urgent: result.priority === 'urgent' }).catch((e) => log.error({ err: e.message }, 'notify failed'));
    }
    if (result.unanswered_question && result.notify_owner) {
      await this.deps.notifier.notifyUnanswered({ contactName: contact.displayName, phone: contact.phone, question: text }).catch(() => {});
    }
    maybeSummarize(conversation, this.deps.ai).catch(() => {});
    return { ...delivered, result };
  }

  /** Returns a reason string if the assistant must stay silent, else null. */
  async #gate(conversation, settings) {
    if (conversation.humanTakeover) {
      const mins = settings.automation.takeoverInactivityMinutes;
      const last = conversation.lastOwnerMessageAt || conversation.takeoverAt;
      if (mins > 0 && last && Date.now() - new Date(last).getTime() > mins * 60_000) {
        // Owner has been silent long enough: hand the chat back to the assistant.
        await Conversation.updateOne(
          { _id: conversation._id },
          { $set: { humanTakeover: false, state: conversation.stateBeforeOverride || 'CONVERSATION_ACTIVE', stateBeforeOverride: null } },
        );
        conversation.humanTakeover = false;
        conversation.state = conversation.stateBeforeOverride || 'CONVERSATION_ACTIVE';
      } else {
        return 'human_takeover';
      }
    }
    if (SILENT_STATES.has(conversation.state)) return 'silent_state';
    if (!conversation.automationEnabled) return 'contact_automation_off';
    if (!automationActive(settings)) return 'global_off';
    return null;
  }

  #mediaReply(type) {
    switch (type) {
      case 'audio':
      case 'ptt':
        return "Thanks for the voice note! 🎙️ I can't listen to audio yet, so could you please type your message? I'll make sure my owner gets it.";
      case 'image':
      case 'document':
      case 'video':
      case 'sticker':
        return "Thanks for sharing that! 📎 I can't open attachments myself, so please describe what you need in a message and I'll pass it on to my owner.";
      case 'location':
        return 'Thanks for sharing your location! 📍 Please tell me in a message what you need help with, and I will record it for my owner.';
      case 'contact':
        return 'Thanks for sharing that contact! 😊 Please let me know in a message what it is about so I can pass it on to my owner.';
      case 'unsupported':
        return "I can't process that kind of message yet 🙏 — could you type it out for me?";
      default:
        return null;
    }
  }

  async #fallback(conversation, jid, text, settings) {
    // Never spam errors: at most one fallback every 10 minutes per chat.
    const last = conversation.aiFailureNotifiedAt;
    const state = conversation.state;
    let body = null;
    if (looksLikeGoodbye(text)) body = FALLBACKS.goodbye;
    else if (state === 'NEW_CONTACT' && looksLikeGreetingOnly(text)) body = FALLBACKS.greeting;
    else if (!last || Date.now() - new Date(last).getTime() > 10 * 60_000) body = FALLBACKS.generic;
    if (!body) return { replied: false, reason: 'ai_unavailable_silent' };
    if (body === FALLBACKS.generic) await Conversation.updateOne({ _id: conversation._id }, { $set: { aiFailureNotifiedAt: new Date() } });
    const nextState = body === FALLBACKS.goodbye ? 'CONVERSATION_ENDED' : state === 'NEW_CONTACT' ? 'GREETING_SENT' : undefined;
    const out = await this.#deliver(conversation, jid, body, settings, { state: nextState });
    return { ...out, reason: 'ai_fallback' };
  }

  async #deliver(conversation, jid, body, settings, { state, category, collected } = {}) {
    const formatted = formatAssistantMessage(body, { footer: settings.footer });
    const sent = await this.deps.send(jid, formatted);
    await storeMessage({ conversation, jid, waMessageId: sent?.key?.id, sender: 'assistant', text: formatted, automated: true });
    const $set = { consecutiveBotReplies: (conversation.consecutiveBotReplies || 0) + 1 };
    if (state) $set.state = state;
    if (category) $set.category = category;
    if (collected && Object.keys(collected).length) $set.collected = { ...(conversation.collected || {}), ...collected };
    await Conversation.updateOne({ _id: conversation._id }, { $set });
    Object.assign(conversation, $set);
    return { replied: true, text: formatted, state };
  }

  /** Owner typed a normal (non-command) message in a customer chat from the linked phone. */
  async recordOwnerMessage({ jid, waMessageId, text, type = 'text', timestamp = new Date() }) {
    const settings = await this.deps.getSettings();
    const { conversation } = await ensureConversation(jid);
    const stored = await storeMessage({ conversation, jid, waMessageId, sender: 'owner', type, text, automated: false, timestamp });
    if (!stored) return { stored: false };
    const $set = { lastOwnerMessageAt: timestamp };
    if (settings.automation.autoTakeoverOnOwnerReply && !conversation.humanTakeover) {
      Object.assign($set, { humanTakeover: true, takeoverAt: timestamp, stateBeforeOverride: SILENT_STATES.has(conversation.state) ? conversation.stateBeforeOverride : conversation.state, state: 'HUMAN_TAKEOVER' });
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set });
    return { stored: true, takeover: Boolean($set.humanTakeover) };
  }
}

export async function setTakeover(jid, on) {
  const conv = await Conversation.findOne({ jid });
  if (!conv) return null;
  if (on) {
    if (!conv.humanTakeover) {
      conv.stateBeforeOverride = SILENT_STATES.has(conv.state) ? conv.stateBeforeOverride : conv.state;
    }
    conv.humanTakeover = true;
    conv.takeoverAt = new Date();
    conv.state = 'HUMAN_TAKEOVER';
  } else {
    conv.humanTakeover = false;
    conv.state = conv.stateBeforeOverride && !SILENT_STATES.has(conv.stateBeforeOverride) ? conv.stateBeforeOverride : 'CONVERSATION_ACTIVE';
    conv.stateBeforeOverride = null;
  }
  await conv.save();
  return conv;
}
