import { DEFAULT_FOOTER, stripFooters } from './footer.js';

export const MAX_MESSAGE_LENGTH = 1500; // keeps replies short and well under WhatsApp's limit

/**
 * Final step before any automated message is sent:
 *  1. remove accidental duplicate footers from the AI text
 *  2. clean whitespace
 *  3. enforce a sane length (cut at a sentence/word boundary)
 *  4. append the approved signature (never trusted to the model)
 */
export function formatAssistantMessage(text, { footer = DEFAULT_FOOTER, maxLength = MAX_MESSAGE_LENGTH } = {}) {
  let body = stripFooters(text, footer);
  body = body
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body) body = 'Thanks for your message! 😊';

  const budget = maxLength - footer.length - 2;
  if (body.length > budget) {
    let cut = body.slice(0, budget);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    cut = lastStop > budget * 0.5 ? cut.slice(0, lastStop + 1) : cut.slice(0, cut.lastIndexOf(' ')) + '…';
    body = cut.trim();
  }
  return `${body}\n\n${footer}`;
}

/** Owner notifications use a plainer signature and are NOT conversation replies. */
export function formatOwnerNotification(text) {
  return `${stripFooters(text).trim()}\n\n✦ CYMOR ASSISTANT ✦`;
}
