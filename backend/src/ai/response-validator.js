import { z } from 'zod';
import { CATEGORIES } from '../models/index.js';

const AI_STATES = [
  'GREETING_SENT',
  'WAITING_FOR_WELLBEING_RESPONSE',
  'ASKING_FOR_REQUEST',
  'COLLECTING_REQUEST',
  'REQUEST_CAPTURED',
  'OFFERING_COMPANIONSHIP',
  'CONVERSATION_ACTIVE',
  'CONVERSATION_ENDED',
];

export const aiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  intent: z.string().max(60).catch('unclear'),
  category: z.enum(CATEGORIES).catch('other'),
  next_state: z.enum(AI_STATES).optional().catch(undefined),
  request_detected: z.boolean().catch(false),
  request_summary: z.string().max(1500).catch(''),
  collected: z.record(z.string(), z.unknown()).catch({}),
  notify_owner: z.boolean().catch(false),
  unanswered_question: z.boolean().catch(false),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).catch('normal'),
  conversation_ended: z.boolean().catch(false),
});

export class InvalidAiResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidAiResponseError';
  }
}

/** Pull a JSON object out of raw model text (tolerates ```json fences and stray prose). */
export function extractJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new InvalidAiResponseError('Empty AI response');
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new InvalidAiResponseError('AI response is not JSON');
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new InvalidAiResponseError('AI response contains invalid JSON');
    }
  }
}

/** Parse + validate. Throws InvalidAiResponseError if unusable. */
export function validateAiResponse(raw) {
  const json = extractJson(raw);
  const result = aiResponseSchema.safeParse(json);
  if (!result.success) throw new InvalidAiResponseError(`AI response failed schema: ${result.error.issues[0]?.path.join('.')}`);
  const out = result.data;
  // The model may never smuggle commands to the owner channel or claim to be the owner.
  out.collected = sanitizeCollected(out.collected);
  return out;
}

function sanitizeCollected(collected) {
  const clean = {};
  let n = 0;
  for (const [k, v] of Object.entries(collected || {})) {
    if (n++ >= 20) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue;
    if (v === null || v === undefined) continue;
    clean[k] = typeof v === 'string' ? v.slice(0, 500) : typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v).slice(0, 500);
  }
  return clean;
}

const OWNER_IMPERSONATION = /\b(i am|i'm|this is)\s+(legendary\s+smiley\s+cymor|the owner|cymor himself)\b/i;
const COMMAND_LIKE = /^\s*\.assistant\b/i;

/** Last-line guard on the final reply text. Returns a safe string or null if it must be discarded. */
export function guardReply(reply) {
  if (OWNER_IMPERSONATION.test(reply)) return null;
  if (COMMAND_LIKE.test(reply)) return null;
  return reply;
}
