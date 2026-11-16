import { CONVERSATION_STATES } from '../models/index.js';

export const STATES = Object.freeze(Object.fromEntries(CONVERSATION_STATES.map((s) => [s, s])));

/** States in which the assistant must not reply on its own. */
export const SILENT_STATES = new Set([STATES.HUMAN_TAKEOVER, STATES.AUTOMATION_PAUSED]);

/**
 * Allowed transitions. The AI proposes `next_state`; the engine only accepts it
 * if the transition is legal, so a confused or manipulated model cannot jump
 * the conversation into an arbitrary state (e.g. into HUMAN_TAKEOVER).
 */
const ALLOWED = {
  NEW_CONTACT: ['GREETING_SENT', 'WAITING_FOR_WELLBEING_RESPONSE', 'COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'CONVERSATION_ACTIVE', 'ASKING_FOR_REQUEST', 'CONVERSATION_ENDED'],
  GREETING_SENT: ['WAITING_FOR_WELLBEING_RESPONSE', 'ASKING_FOR_REQUEST', 'COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'CONVERSATION_ACTIVE', 'CONVERSATION_ENDED'],
  WAITING_FOR_WELLBEING_RESPONSE: ['ASKING_FOR_REQUEST', 'COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'CONVERSATION_ACTIVE', 'CONVERSATION_ENDED'],
  ASKING_FOR_REQUEST: ['COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'CONVERSATION_ACTIVE', 'CONVERSATION_ENDED'],
  COLLECTING_REQUEST: ['COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'CONVERSATION_ACTIVE', 'CONVERSATION_ENDED'],
  REQUEST_CAPTURED: ['OFFERING_COMPANIONSHIP', 'CONVERSATION_ACTIVE', 'COLLECTING_REQUEST', 'CONVERSATION_ENDED'],
  OFFERING_COMPANIONSHIP: ['CONVERSATION_ACTIVE', 'COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'CONVERSATION_ENDED'],
  CONVERSATION_ACTIVE: ['CONVERSATION_ACTIVE', 'COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'ASKING_FOR_REQUEST', 'CONVERSATION_ENDED'],
  CONVERSATION_ENDED: ['GREETING_SENT', 'WAITING_FOR_WELLBEING_RESPONSE', 'ASKING_FOR_REQUEST', 'COLLECTING_REQUEST', 'REQUEST_CAPTURED', 'CONVERSATION_ACTIVE'],
  HUMAN_TAKEOVER: [],
  AUTOMATION_PAUSED: [],
};

export function canTransition(from, to) {
  if (from === to) return true;
  return (ALLOWED[from] || []).includes(to);
}

/** Returns the accepted next state: the AI's proposal if legal, otherwise a safe default. */
export function resolveNextState(current, proposed) {
  if (proposed && canTransition(current, proposed)) return proposed;
  if (current === 'NEW_CONTACT') return 'GREETING_SENT';
  if (current === 'CONVERSATION_ENDED') return 'CONVERSATION_ACTIVE';
  return current;
}

const GOODBYE = /^\s*(bye|goodbye|good\s?bye|good\s?night|goodnight|see\s?you|see ya|cya|talk later|ttyl|kwaheri|tutaonana|asante.*(bye|kwaheri)|that'?s all|nothing else|i'?m done|thanks?,?\s*(bye|that'?s all))\b/i;
const GREETING_ONLY = /^\s*(hi+|hello+|hey+|hallo|hullo|yo|sup|mambo|niaje|vipi|habari|jambo|sasa|good\s*(morning|afternoon|evening)|howdy)[\s!.?,😊👋]*$/iu;

export const looksLikeGoodbye = (t) => GOODBYE.test(String(t || ''));
export const looksLikeGreetingOnly = (t) => GREETING_ONLY.test(String(t || ''));
