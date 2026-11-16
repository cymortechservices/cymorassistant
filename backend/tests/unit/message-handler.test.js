import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/commands/index.js', () => ({
  isCommand: (t) => /^\s*\.assistant(\s|$)/i.test(String(t || '')),
  executeCommand: vi.fn(async () => ({ reply: 'COMMAND-RESULT', deleteCommand: false })),
}));
vi.mock('../../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

const { MessageHandler, describeMessage } = await import('../../src/whatsapp/message-handler.js');
const { executeCommand } = await import('../../src/commands/index.js');
const { audit } = await import('../../src/utils/audit.js');
const { DEFAULT_SETTINGS } = await import('../../src/knowledge/defaults.js');

const OWNER = '254700000001';
const linked = { phone: OWNER, jid: `${OWNER}@s.whatsapp.net`, lid: '999@lid' };

function setup(settingsPatch = {}) {
  const conn = { sendText: vi.fn(async () => ({})), isOwnEcho: vi.fn(() => false), sock: { sendMessage: vi.fn(async () => ({})) } };
  const engine = { handleContactMessage: vi.fn(async () => ({})), recordOwnerMessage: vi.fn(async () => ({})) };
  const settings = { ...structuredClone(DEFAULT_SETTINGS), ownerPhone: OWNER, ...settingsPatch };
  const handler = new MessageHandler({ conn, engine, getSettings: async () => settings, getHealth: async () => ({}), ai: {}, getLinked: () => linked, tz: 'Africa/Nairobi' });
  return { handler, conn, engine };
}

const msg = (over = {}) => ({
  key: { remoteJid: '254722000111@s.whatsapp.net', fromMe: false, id: 'M' + Math.random().toString(36).slice(2) },
  message: { conversation: 'Hello' },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: 'Amina',
  ...over,
});
const withKey = (k, rest = {}) => msg({ key: { remoteJid: '254722000111@s.whatsapp.net', fromMe: false, id: 'K' + Math.random().toString(36).slice(2), ...k }, ...rest });

beforeEach(() => vi.clearAllMocks());

describe('describeMessage', () => {
  it('maps WhatsApp content types', () => {
    expect(describeMessage({ conversation: 'hi' })).toEqual({ type: 'text', text: 'hi' });
    expect(describeMessage({ extendedTextMessage: { text: 'quoted reply' } })).toEqual({ type: 'text', text: 'quoted reply' });
    expect(describeMessage({ imageMessage: { caption: 'my logo' } })).toEqual({ type: 'image', text: 'my logo' });
    expect(describeMessage({ audioMessage: { ptt: true } }).type).toBe('ptt');
    expect(describeMessage({ audioMessage: { ptt: false } }).type).toBe('audio');
    expect(describeMessage({ documentMessage: { caption: 'cv' } }).type).toBe('document');
    expect(describeMessage({ locationMessage: {} }).type).toBe('location');
    expect(describeMessage({ contactMessage: {} }).type).toBe('contact');
    expect(describeMessage({ reactionMessage: { text: '👍' } }).type).toBe('reaction');
  });
  it('ignores protocol messages, flags unknown types as unsupported', () => {
    expect(describeMessage({ protocolMessage: {} })).toBeNull();
    expect(describeMessage({ pollCreationMessage: {} }).type).toBe('unsupported');
    expect(describeMessage(null)).toBeNull();
  });
});

describe('MessageHandler routing', () => {
  it('sends ordinary contact messages to the conversation engine', async () => {
    const { handler, engine } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg()] });
    expect(engine.handleContactMessage).toHaveBeenCalledWith(expect.objectContaining({ jid: '254722000111@s.whatsapp.net', text: 'Hello', type: 'text', pushName: 'Amina' }));
  });

  it('ignores history/append batches', async () => {
    const { handler, engine } = setup();
    await handler.handleUpsert({ type: 'append', messages: [msg()] });
    expect(engine.handleContactMessage).not.toHaveBeenCalled();
  });

  it('ignores groups (default), status broadcasts, the bot\'s own echoes and stale messages', async () => {
    const { handler, engine, conn } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [withKey({ remoteJid: '123@g.us' })] });
    await handler.handleUpsert({ type: 'notify', messages: [withKey({ remoteJid: 'status@broadcast' })] });
    conn.isOwnEcho.mockReturnValueOnce(true);
    await handler.handleUpsert({ type: 'notify', messages: [withKey({ fromMe: true })] });
    await handler.handleUpsert({ type: 'notify', messages: [msg({ messageTimestamp: Math.floor(Date.now() / 1000) - 3 * 86400 })] });
    expect(engine.handleContactMessage).not.toHaveBeenCalled();
    expect(engine.recordOwnerMessage).not.toHaveBeenCalled();
  });

  it('does not reply to reactions', async () => {
    const { handler, engine } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg({ message: { reactionMessage: { text: '👍' } } })] });
    expect(engine.handleContactMessage).not.toHaveBeenCalled();
  });

  it('passes voice notes and images through with their type (engine replies politely)', async () => {
    const { handler, engine } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg({ message: { audioMessage: { ptt: true } } })] });
    expect(engine.handleContactMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ptt' }));
  });

  it('uses the phone-number JID as canonical chat id when WhatsApp also provides a LID', async () => {
    const { handler, engine } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [withKey({ remoteJid: '5551@lid', remoteJidAlt: '254733000222@s.whatsapp.net' })] });
    expect(engine.handleContactMessage).toHaveBeenCalledWith(expect.objectContaining({ jid: '254733000222@s.whatsapp.net' }));
  });
});

describe('Owner authorisation & commands', () => {
  it('executes a command typed by the verified owner in the self-chat and replies there, never to the AI', async () => {
    const { handler, conn, engine } = setup();
    const self = `${OWNER}@s.whatsapp.net`;
    await handler.handleUpsert({ type: 'notify', messages: [msg({ key: { remoteJid: self, fromMe: true, id: 'C1' }, message: { conversation: '.assistant status' } })] });
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(conn.sendText).toHaveBeenCalledWith(self, 'COMMAND-RESULT');
    expect(engine.handleContactMessage).not.toHaveBeenCalled();
  });

  it('REJECTS commands from an unauthorised contact: never executed, audited, treated as ordinary untrusted text', async () => {
    const { handler, engine, conn } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg({ message: { conversation: '.assistant off' } })] });
    expect(executeCommand).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith('unknown', 'unauthorized_command_attempt', expect.any(String));
    expect(conn.sendText).not.toHaveBeenCalled(); // no admin info leaks to the contact
    expect(engine.handleContactMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '.assistant off' }));
  });

  it('rejects a spoofed "I am the owner" claim: only WhatsApp-verified identity counts', async () => {
    const { handler } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg({ pushName: 'Legendary Smiley Cymor (OWNER)', message: { conversation: '.assistant on' } })] });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('rejects owner-looking fromMe commands when the linked account is not the configured owner', async () => {
    const { handler } = setup({ ownerPhone: '254799999999' });
    await handler.handleUpsert({ type: 'notify', messages: [msg({ key: { remoteJid: `${OWNER}@s.whatsapp.net`, fromMe: true, id: 'C2' }, message: { conversation: '.assistant on' } })] });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('accepts commands sent from the owner\'s number to the assistant number', async () => {
    const { handler, conn } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg({ key: { remoteJid: `${OWNER}@s.whatsapp.net`, fromMe: false, id: 'C3' }, message: { conversation: '.assistant health' } })] });
    expect(executeCommand).toHaveBeenCalled();
    expect(conn.sendText).toHaveBeenCalled();
  });

  it('a takeover command typed in a CUSTOMER chat replies privately to the owner and deletes the command', async () => {
    const { handler, conn } = setup();
    executeCommand.mockResolvedValueOnce({ reply: 'Takeover ACTIVE', deleteCommand: true });
    const customer = '254722000111@s.whatsapp.net';
    await handler.handleUpsert({ type: 'notify', messages: [msg({ key: { remoteJid: customer, fromMe: true, id: 'C4' }, message: { conversation: '.assistant takeover' } })] });
    expect(conn.sendText).toHaveBeenCalledWith(linked.jid, 'Takeover ACTIVE');
    expect(conn.sendText).not.toHaveBeenCalledWith(customer, expect.anything());
    expect(conn.sock.sendMessage).toHaveBeenCalledWith(customer, { delete: expect.objectContaining({ id: 'C4' }) });
  });

  it('owner typing normally in a customer chat is recorded (triggers human takeover) and not answered by the AI', async () => {
    const { handler, engine } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg({ key: { remoteJid: '254722000111@s.whatsapp.net', fromMe: true, id: 'O1' }, message: { conversation: 'Hi Amina, it is me' } })] });
    expect(engine.recordOwnerMessage).toHaveBeenCalledWith(expect.objectContaining({ jid: '254722000111@s.whatsapp.net', text: 'Hi Amina, it is me' }));
    expect(engine.handleContactMessage).not.toHaveBeenCalled();
  });

  it('ignores the owner\'s non-command notes in the self-chat', async () => {
    const { handler, engine } = setup();
    await handler.handleUpsert({ type: 'notify', messages: [msg({ key: { remoteJid: `${OWNER}@s.whatsapp.net`, fromMe: true, id: 'N1' }, message: { conversation: 'buy milk' } })] });
    expect(engine.recordOwnerMessage).not.toHaveBeenCalled();
    expect(engine.handleContactMessage).not.toHaveBeenCalled();
  });
});
