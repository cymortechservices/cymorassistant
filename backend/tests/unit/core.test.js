import { describe, it, expect } from 'vitest';
import { encryptString, decryptString } from '../../src/utils/crypto.js';
import { normalizePhone, jidToPhone, phoneToJid, isGroupJid, isStatusJid } from '../../src/utils/phone.js';
import { formatAssistantMessage, MAX_MESSAGE_LENGTH } from '../../src/assistant/message-formatter.js';
import { DEFAULT_FOOTER, stripFooters } from '../../src/assistant/footer.js';
import { resolveNextState, canTransition, looksLikeGoodbye, looksLikeGreetingOnly } from '../../src/assistant/conversation-state.js';
import { isOwnerMessage } from '../../src/whatsapp/owner-verifier.js';
import { ReconnectManager, classifyDisconnect } from '../../src/whatsapp/reconnect-manager.js';
import { isKuccpsText, getVerifiedKuccpsFacts, registerKuccpsAdvisor } from '../../src/knowledge/kuccps-knowledge.js';
import { loadConfig } from '../../src/config/index.js';
import { parseCommand, isCommand } from '../../src/commands/index.js';

describe('crypto (session encryption at rest)', () => {
  const key = 'b'.repeat(64);
  it('round-trips and never stores plaintext', () => {
    const enc = encryptString('{"secret":"noise-key"}', key);
    expect(enc).not.toContain('noise-key');
    expect(decryptString(enc, key)).toBe('{"secret":"noise-key"}');
  });
  it('uses a fresh IV each time', () => {
    expect(encryptString('x', key)).not.toBe(encryptString('x', key));
  });
  it('rejects tampering and wrong keys', () => {
    const enc = encryptString('hello', key);
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptString(parts.join(':'), key)).toThrow();
    expect(() => decryptString(enc, 'c'.repeat(64))).toThrow();
  });
  it('supports key rotation: new key first, old key still decrypts', () => {
    const oldKey = 'd'.repeat(64);
    const newKey = 'e'.repeat(64);
    const enc = encryptString('data', oldKey);
    expect(decryptString(enc, `${newKey},${oldKey}`)).toBe('data');
    expect(decryptString(encryptString('data', `${newKey},${oldKey}`), newKey)).toBe('data');
  });
});

describe('phone helpers', () => {
  it('normalises Kenyan formats to international', () => {
    expect(normalizePhone('0712 345 678')).toBe('254712345678');
    expect(normalizePhone('+254 712-345-678')).toBe('254712345678');
    expect(normalizePhone('712345678')).toBe('254712345678');
    expect(normalizePhone('00254712345678')).toBe('254712345678');
  });
  it('converts JIDs and ignores device suffixes', () => {
    expect(jidToPhone('254712345678:12@s.whatsapp.net')).toBe('254712345678');
    expect(jidToPhone('1234567@lid')).toBe('');
    expect(phoneToJid('0712345678')).toBe('254712345678@s.whatsapp.net');
  });
  it('detects groups and status broadcasts', () => {
    expect(isGroupJid('123@g.us')).toBe(true);
    expect(isStatusJid('status@broadcast')).toBe(true);
  });
});

describe('message formatter / footer', () => {
  it('always appends the branded footer', () => {
    const out = formatAssistantMessage('Hello there!');
    expect(out.endsWith(DEFAULT_FOOTER)).toBe(true);
    expect(out).toContain('✦ 𝑪𝒀𝑴𝑶𝑹 𝑨𝑺𝑺𝑰𝑺𝑻𝑨𝑵𝑻 ✦');
  });
  it('removes duplicated footers produced by the model', () => {
    const out = formatAssistantMessage(`Hi!\n\n${DEFAULT_FOOTER}\n${DEFAULT_FOOTER}`);
    expect(out.split(DEFAULT_FOOTER).length - 1).toBe(1);
  });
  it('strips plain-text lookalike footers too', () => {
    expect(stripFooters('Hi ✦ CYMOR ASSISTANT ✦').trim()).toBe('Hi');
  });
  it('cleans whitespace and handles empty bodies', () => {
    expect(formatAssistantMessage('a   \n\n\n\n b')).toMatch(/^a\n\n b\n\n/);
    expect(formatAssistantMessage('   ')).toContain('Thanks for your message');
  });
  it('enforces the maximum length and keeps the footer', () => {
    const out = formatAssistantMessage('word '.repeat(2000));
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    expect(out.endsWith(DEFAULT_FOOTER)).toBe(true);
  });
  it('supports a custom footer from settings', () => {
    expect(formatAssistantMessage('Hi', { footer: '— BOT —' }).endsWith('— BOT —')).toBe(true);
  });
});

describe('conversation state machine', () => {
  it('only accepts legal transitions', () => {
    expect(canTransition('COLLECTING_REQUEST', 'REQUEST_CAPTURED')).toBe(true);
    expect(canTransition('GREETING_SENT', 'HUMAN_TAKEOVER')).toBe(false);
  });
  it('rejects AI attempts to enter takeover/paused states', () => {
    expect(resolveNextState('CONVERSATION_ACTIVE', 'HUMAN_TAKEOVER')).toBe('CONVERSATION_ACTIVE');
    expect(resolveNextState('CONVERSATION_ACTIVE', 'AUTOMATION_PAUSED')).toBe('CONVERSATION_ACTIVE');
  });
  it('a new contact moves to GREETING_SENT by default', () => {
    expect(resolveNextState('NEW_CONTACT', undefined)).toBe('GREETING_SENT');
  });
  it('detects goodbyes and bare greetings', () => {
    for (const t of ['bye', 'Goodbye!', 'kwaheri', 'good night', 'that is all'.replace('that is', "that's")]) expect(looksLikeGoodbye(t)).toBe(true);
    expect(looksLikeGoodbye('I need a website')).toBe(false);
    for (const t of ['Hi', 'hello!', 'Good morning', 'mambo', 'Niaje 👋']) expect(looksLikeGreetingOnly(t)).toBe(true);
    expect(looksLikeGreetingOnly('Hi, I need a website')).toBe(false);
  });
});

describe('owner verification', () => {
  const base = { ownerPhone: '0700000001', linkedPhone: '254700000001', ownerLid: '999@lid' };
  it('accepts fromMe when the linked account is the owner', () => {
    expect(isOwnerMessage({ ...base, fromMe: true, senderJid: '254799999999@s.whatsapp.net' })).toBe(true);
  });
  it('rejects fromMe when the linked account is NOT the configured owner', () => {
    expect(isOwnerMessage({ ...base, linkedPhone: '254711111111', fromMe: true, senderJid: 'x@s.whatsapp.net' })).toBe(false);
  });
  it('accepts a message from the owner number, rejects other numbers', () => {
    expect(isOwnerMessage({ ...base, fromMe: false, senderJid: '254700000001@s.whatsapp.net' })).toBe(true);
    expect(isOwnerMessage({ ...base, fromMe: false, senderJid: '254722222222@s.whatsapp.net' })).toBe(false);
  });
  it('accepts the owner LID via alt JID or known LID, rejects unknown LIDs', () => {
    expect(isOwnerMessage({ ...base, fromMe: false, senderJid: '555@lid', senderJidAlt: '254700000001@s.whatsapp.net' })).toBe(true);
    expect(isOwnerMessage({ ...base, fromMe: false, senderJid: '999@lid' })).toBe(true);
    expect(isOwnerMessage({ ...base, fromMe: false, senderJid: '123@lid' })).toBe(false);
  });
  it('nobody is the owner when OWNER_PHONE_NUMBER is unset', () => {
    expect(isOwnerMessage({ ...base, ownerPhone: '', fromMe: true, senderJid: 'x@s.whatsapp.net' })).toBe(false);
  });
});

describe('reconnect manager', () => {
  it('backs off exponentially, caps, and stops after max attempts', () => {
    const r = new ReconnectManager({ baseMs: 1000, maxMs: 8000, maxAttempts: 5, random: () => 0 });
    expect([r.nextDelay(), r.nextDelay(), r.nextDelay(), r.nextDelay(), r.nextDelay()]).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(r.nextDelay()).toBeNull();
    r.reset();
    expect(r.nextDelay()).toBe(1000);
  });
  it('classifies disconnect reasons', () => {
    const DR = { loggedOut: 401, connectionReplaced: 440, badSession: 500, restartRequired: 515, forbidden: 403 };
    expect(classifyDisconnect(401, DR)).toBe('logged_out');
    expect(classifyDisconnect(440, DR)).toBe('replaced');
    expect(classifyDisconnect(515, DR)).toBe('restart');
    expect(classifyDisconnect(408, DR)).toBe('reconnect');
    expect(classifyDisconnect(undefined, DR)).toBe('reconnect');
  });
});

describe('KUCCPS module', () => {
  it('recognises KUCCPS-related text', () => {
    expect(isKuccpsText('I need help choosing a university course after KCSE')).toBe(true);
    expect(isKuccpsText('what are the cluster points for medicine?')).toBe(true);
    expect(isKuccpsText('I need a website for my shop')).toBe(false);
  });
  it('provides no numeric facts unless a verified, sourced advisor is registered', async () => {
    expect(await getVerifiedKuccpsFacts('cutoff')).toEqual([]);
    registerKuccpsAdvisor({ lookup: async () => [{ text: 'ok', official: true, source: 'KUCCPS' }, { text: 'estimate', official: false, source: 'x' }, { text: 'nosource', official: true }] });
    const facts = await getVerifiedKuccpsFacts('x');
    expect(facts).toHaveLength(1);
    registerKuccpsAdvisor(null);
  });
});

describe('configuration', () => {
  const ok = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 'x'.repeat(20), SESSION_ENCRYPTION_KEY: 'k'.repeat(20), DASHBOARD_USERNAME: 'a', DASHBOARD_PASSWORD_HASH: 'h'.repeat(20) };
  it('loads valid config with defaults', () => {
    const c = loadConfig(ok);
    expect(c.TIMEZONE).toBe('Africa/Nairobi');
    expect(c.ASSISTANT_ENABLED).toBe(false);
    expect(c.NOTIFICATION_ENABLED).toBe(true);
  });
  it('fails fast without required secrets', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ ...ok, JWT_SECRET: 'short' })).toThrow();
  });
});

describe('command parsing', () => {
  it('recognises and parses commands', () => {
    expect(isCommand('.assistant on')).toBe(true);
    expect(isCommand('  .Assistant OFF')).toBe(true);
    expect(isCommand('please .assistant on')).toBe(false);
    expect(isCommand('.assistants')).toBe(false);
    expect(parseCommand('.assistant pause 30')).toEqual({ name: 'pause', args: ['30'] });
    expect(parseCommand('.assistant')).toEqual({ name: 'help', args: [] });
  });
});
