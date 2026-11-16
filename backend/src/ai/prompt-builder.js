import { buildSystemInstruction } from '../assistant/personality.js';
import { renderOwnerProfile } from '../knowledge/owner-profile.js';
import { renderServices, WEB_INTAKE_QUESTIONS } from '../knowledge/business-services.js';
import { renderFaqs } from '../knowledge/faq.js';
import { KUCCPS_GUIDANCE } from '../knowledge/kuccps-knowledge.js';

/** Neutralise anything in customer text that could close/spoof our delimiter tags. */
export function escapeUntrusted(text) {
  return String(text ?? '')
    .replace(/<\/?\s*(contact_message|assistant_message|owner_message|system|instructions?)[^>]*>/gi, '[tag removed]')
    .slice(0, 3000);
}

function renderKnowledge(settings, verifiedKuccpsFacts) {
  const facts = verifiedKuccpsFacts?.length
    ? '\nVERIFIED OFFICIAL KUCCPS FACTS (cite as official, with source):\n' + verifiedKuccpsFacts.map((f) => `- ${f.text} (source: ${f.source})`).join('\n')
    : '\nNo verified official KUCCPS data is available. Provide no numbers or deadlines.';
  return `=== BUSINESS KNOWLEDGE (the only source of facts about the owner and company) ===
${renderOwnerProfile(settings)}

SERVICES
${renderServices(settings)}

FAQ
${renderFaqs(settings)}

WEB/SOFTWARE INTAKE QUESTIONS (ask one at a time, only the relevant ones)
${WEB_INTAKE_QUESTIONS.map((q) => `- ${q}`).join('\n')}

KUCCPS GUIDANCE
${KUCCPS_GUIDANCE.ownerRole}
${KUCCPS_GUIDANCE.generalConcepts.map((x) => `- ${x}`).join('\n')}
KUCCPS intake questions (ask one at a time, only the relevant ones):
${KUCCPS_GUIDANCE.intakeQuestions.map((q) => `- ${q}`).join('\n')}
KUCCPS safeguards:
${KUCCPS_GUIDANCE.safeguards.map((x) => `- ${x}`).join('\n')}
${facts}`;
}

/**
 * Returns { systemInstruction, userContent } for the provider.
 * Trusted material (rules + knowledge) goes in the system instruction; the
 * transcript and new message are clearly delimited as untrusted.
 */
export function buildPrompt({ settings, conversation, contact, history, summary, newMessage, verifiedKuccpsFacts = [] }) {
  const o = settings.ownerProfile;
  const system =
    buildSystemInstruction({ ownerName: o.name, companyName: o.company, extraNotes: settings.personalityNotes }) +
    '\n\n' +
    renderKnowledge(settings, verifiedKuccpsFacts);

  const transcript = (history || [])
    .map((m) => {
      const tag = m.sender === 'contact' ? 'contact_message' : m.sender === 'owner' ? 'owner_message' : 'assistant_message';
      return `<${tag}>${escapeUntrusted(m.text)}</${tag}>`;
    })
    .join('\n');

  const userContent = [
    `CONVERSATION STATE: ${conversation?.state || 'NEW_CONTACT'}`,
    `CONTACT: name="${escapeUntrusted(contact?.displayName || 'unknown').slice(0, 60)}" (first message: ${conversation?.state === 'NEW_CONTACT' ? 'yes' : 'no'})`,
    `CURRENT CATEGORY: ${conversation?.category || 'general_conversation'}`,
    `DETAILS COLLECTED SO FAR: ${JSON.stringify(conversation?.collected || {})}`,
    summary ? `EARLIER CONVERSATION SUMMARY: ${escapeUntrusted(summary)}` : '',
    transcript ? `RECENT MESSAGES (oldest first):\n${transcript}` : 'RECENT MESSAGES: (none)',
    `NEW MESSAGE TO REPLY TO:\n<contact_message>${escapeUntrusted(newMessage)}</contact_message>`,
    'Reply now with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { systemInstruction: system, userContent };
}
