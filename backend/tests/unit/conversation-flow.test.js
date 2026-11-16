import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/models/index.js', async (importOriginal) => {
  const orig = await importOriginal();
  const { createFakeDb } = await import('../helpers/fake-db.js');
  return { ...orig, ...createFakeDb() };
});

const models = await import('../../src/models/index.js');
const { ConversationEngine, setTakeover } = await import('../../src/assistant/conversation-engine.js');
const { Notifier } = await import('../../src/notifications/notifier.js');
const { AiUnavailableError } = await import('../../src/ai/gemini.js');
const { getSettings, updateSetting, invalidateSettingsCache } = await import('../../src/services/settings.js');
const { executeCommand } = await import('../../src/commands/index.js');
const { storeMessage, ensureConversation, deleteContactData } = await import('../../src/services/contacts.js');
const { DEFAULT_FOOTER } = await import('../../src/assistant/footer.js');

const JID = '254722000111@s.whatsapp.net';
let n = 0;
let sent;
let ownerNotes;
let ai;
let engine;

const aiReply = (over = {}) => ({
  reply: 'Hey! 😊 How can I help?', intent: 'small_talk', category: 'general_conversation', next_state: 'CONVERSATION_ACTIVE',
  request_detected: false, request_summary: '', collected: {}, notify_owner: false, unanswered_question: false, priority: 'normal', conversation_ended: false, ...over,
});

const say = (text, extra = {}) => engine.handleContactMessage({ jid: JID, waMessageId: `W${++n}`, text, type: 'text', pushName: 'Amina', timestamp: new Date(), ...extra });
const conv = () => models.Conversation.rows.find((c) => c.jid === JID);

beforeEach(async () => {
  Object.values(models).forEach((m) => m?.reset?.());
  invalidateSettingsCache();
  await updateSetting('assistantEnabled', true);
  await updateSetting('ownerPhone', '254700000001');
  sent = [];
  ownerNotes = [];
  ai = { respond: vi.fn(async () => aiReply()), configure: vi.fn(), summarize: vi.fn(async () => 'summary') };
  const notifier = new Notifier({ getSettings, send: async (t) => { ownerNotes.push(t); } });
  engine = new ConversationEngine({ ai, getSettings, notifier, send: async (jid, text) => { sent.push({ jid, text }); return { key: { id: `S${++n}` } }; } });
});

describe('Stage 1: first message & footer', () => {
  it('greets a first-time contact, appends the footer, persists contact + conversation + both messages', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ reply: 'Hey there! 👋😊 Welcome! How are you doing today?', intent: 'greeting', next_state: 'WAITING_FOR_WELLBEING_RESPONSE' }));
    const r = await say('Hi');
    expect(r.replied).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].jid).toBe(JID);
    expect(sent[0].text.endsWith(DEFAULT_FOOTER)).toBe(true);
    expect(models.Contact.rows[0]).toMatchObject({ jid: JID, displayName: 'Amina', phone: '254722000111' });
    expect(conv().state).toBe('WAITING_FOR_WELLBEING_RESPONSE');
    expect(models.Message.rows.map((m) => [m.sender, m.automated])).toEqual([['contact', false], ['assistant', true]]);
  });

  it('removes a duplicated footer the model might add', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ reply: `Hello!\n\n${DEFAULT_FOOTER}` }));
    await say('Hello');
    expect(sent[0].text.split(DEFAULT_FOOTER).length - 1).toBe(1);
  });

  it('does not force greeting steps on an urgent detailed first message (AI result drives the state)', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ reply: 'Got it, a shop website! What features do you need?', category: 'web_development', next_state: 'COLLECTING_REQUEST' }));
    await say('Hi, I urgently need an e-commerce website for my shop');
    expect(conv().state).toBe('COLLECTING_REQUEST');
    expect(conv().category).toBe('web_development');
  });

  it('prompt carries the new message wrapped as untrusted and current state', async () => {
    await say('Hello');
    const call = ai.respond.mock.calls[0][0];
    expect(call.userContent).toContain('<contact_message>Hello</contact_message>');
    expect(call.systemInstruction).toContain('CYMOR ASSISTANT');
  });
});

describe('Stage 2: wellbeing', () => {
  it('continues from the greeting with history in context', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ next_state: 'WAITING_FOR_WELLBEING_RESPONSE', reply: 'Hey! How are you?' }));
    await say('Hi');
    ai.respond.mockResolvedValueOnce(aiReply({ reply: "I'm doing great, thanks for asking! 😃 What can I help you with today?", next_state: 'ASKING_FOR_REQUEST' }));
    await say("I'm fine, how are you?");
    expect(conv().state).toBe('ASKING_FOR_REQUEST');
    const second = ai.respond.mock.calls[1][0].userContent;
    expect(second).toContain('<assistant_message>Hey! How are you?');
    expect(second).toContain("<contact_message>I'm fine, how are you?</contact_message>");
    expect(sent).toHaveLength(2);
  });
});

describe('Stages 3-5: request collection, classification, persistence, notification', () => {
  it('records a website request ONLY after it is persisted, then notifies the owner once', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({
      reply: "Thank you for explaining that! 😊 I've captured the details. My owner will review it and get back to you when he's available. Want to chat while you wait?",
      intent: 'business_inquiry', category: 'web_development', next_state: 'REQUEST_CAPTURED', request_detected: true,
      request_summary: 'Customer needs a business website with an admin dashboard.', collected: { projectType: 'business website' }, priority: 'normal',
    }));
    await say('I need a business website with an admin dashboard, within a month');
    expect(models.Request.rows).toHaveLength(1);
    expect(models.Request.rows[0]).toMatchObject({ category: 'web_development', status: 'pending', phone: '254722000111', description: 'Customer needs a business website with an admin dashboard.' });
    expect(conv().state).toBe('REQUEST_CAPTURED');
    expect(conv().openRequest).toBe(models.Request.rows[0]._id);
    expect(ownerNotes).toHaveLength(1);
    expect(ownerNotes[0]).toContain('NEW CYMOR ASSISTANT INQUIRY');
    expect(ownerNotes[0]).toContain('Website Development');
    expect(ownerNotes[0]).toContain('+254722000111');
    expect(ownerNotes[0]).toContain('✦ CYMOR ASSISTANT ✦');
    expect(models.Request.rows[0].notifiedAt).toBeTruthy();
  });

  it('classifies KUCCPS inquiries and sends a KUCCPS-specific owner notification', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({
      reply: 'I will pass this to my owner, who is a KUCCPS consultant. 😊', category: 'kuccps', next_state: 'REQUEST_CAPTURED', request_detected: true,
      request_summary: 'KCSE 2025 candidate, mean grade B plain, wants help choosing degree courses.', collected: { kcseYear: '2025', grade: 'B plain' },
    }));
    await say('Hello, I need help choosing a university course. I got B plain in KCSE 2025');
    expect(models.Request.rows[0].category).toBe('kuccps');
    expect(ownerNotes[0]).toContain('KUCCPS CONSULTATION');
    expect(conv().category).toBe('kuccps');
    // the KUCCPS safeguards are part of what the model was told
    expect(ai.respond.mock.calls[0][0].systemInstruction).toContain('Never state or estimate cluster points');
  });

  it('does NOT create a request or notify while details are still being collected', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ category: 'web_development', next_state: 'COLLECTING_REQUEST', reply: 'What features would you like?' }));
    await say('I want a website');
    expect(models.Request.rows).toHaveLength(0);
    expect(ownerNotes).toHaveLength(0);
  });

  it('does not duplicate the request or re-notify when the AI flags the same request again', async () => {
    const detected = aiReply({ category: 'software_development', request_detected: true, request_summary: 'Needs an inventory app.', next_state: 'REQUEST_CAPTURED' });
    ai.respond.mockResolvedValue(detected);
    await say('I need an inventory app');
    await say('Also it should send SMS alerts');
    expect(models.Request.rows).toHaveLength(1);
    expect(ownerNotes).toHaveLength(1);
  });

  it('upgrades priority on the same request and still notifies only once', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ category: 'web_development', request_detected: true, request_summary: 'Site', next_state: 'REQUEST_CAPTURED' }));
    await say('Need a site');
    ai.respond.mockResolvedValueOnce(aiReply({ category: 'web_development', request_detected: true, request_summary: 'Site, urgent', priority: 'urgent', next_state: 'REQUEST_CAPTURED' }));
    await say('It is urgent!');
    expect(models.Request.rows).toHaveLength(1);
    expect(models.Request.rows[0].priority).toBe('urgent');
    expect(ownerNotes).toHaveLength(1);
  });

  it('never claims the request is saved when persistence fails', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ reply: "I've saved your request!", request_detected: true, request_summary: 'x', category: 'web_development', next_state: 'REQUEST_CAPTURED' }));
    models.Request.create.mockRejectedValueOnce(new Error('db down'));
    await say('I need a website');
    expect(sent[0].text).not.toMatch(/saved your request!/i);
    expect(sent[0].text).toMatch(/problem saving/i);
    expect(ownerNotes).toHaveLength(0);
    expect(conv().state).toBe('COLLECTING_REQUEST');
  });

  it('owner notification failure does not break the conversation and allows a later retry', async () => {
    const failing = new Notifier({ getSettings, send: async () => { throw new Error('whatsapp offline'); } });
    engine = new ConversationEngine({ ai, getSettings, notifier: failing, send: async (jid, text) => { sent.push({ jid, text }); return { key: { id: `S${++n}` } }; } });
    ai.respond.mockResolvedValueOnce(aiReply({ category: 'web_development', request_detected: true, request_summary: 'x', next_state: 'REQUEST_CAPTURED' }));
    const r = await say('I need a website');
    expect(r.replied).toBe(true);
    expect(models.Request.rows[0].notifiedAt).toBeNull(); // still eligible for retry
  });

  it('retries a failed owner notification on the contact\'s next message (still exactly one successful notification)', async () => {
    let fail = true;
    const flaky = new Notifier({ getSettings, send: async (t) => { if (fail) throw new Error('offline'); ownerNotes.push(t); } });
    engine = new ConversationEngine({ ai, getSettings, notifier: flaky, send: async (jid, text) => { sent.push({ jid, text }); return { key: { id: `S${++n}` } }; } });
    ai.respond.mockResolvedValue(aiReply({ category: 'web_development', request_detected: true, request_summary: 'x', next_state: 'REQUEST_CAPTURED' }));
    await say('I need a website');
    expect(ownerNotes).toHaveLength(0);
    fail = false;
    await say('are you there?');
    await say('hello again');
    expect(ownerNotes).toHaveLength(1);
    expect(models.Request.rows).toHaveLength(1);
  });

  it('forwards unanswered questions to the owner when flagged', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ reply: 'I will pass that question to my owner.', notify_owner: true, unanswered_question: true }));
    await say('How much does an e-commerce site cost?');
    expect(ownerNotes[0]).toContain('QUESTION NEEDS YOUR ANSWER');
    expect(ownerNotes[0]).toContain('How much does an e-commerce site cost?');
  });

  it('respects owner notification preferences', async () => {
    await updateSetting('notifications', { ...(await getSettings()).notifications, enabled: false });
    ai.respond.mockResolvedValueOnce(aiReply({ category: 'web_development', request_detected: true, request_summary: 'x', next_state: 'REQUEST_CAPTURED' }));
    await say('I need a website');
    expect(models.Request.rows).toHaveLength(1);
    expect(ownerNotes).toHaveLength(0);
  });
});

describe('Stage 6: companionship & goodbye', () => {
  it('chats friendly after a request is captured', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ category: 'web_development', request_detected: true, request_summary: 'x', next_state: 'OFFERING_COMPANIONSHIP' }));
    await say('I need a website');
    ai.respond.mockResolvedValueOnce(aiReply({ reply: 'Why did the developer go broke? Because he used up all his cache! 😄', intent: 'small_talk', next_state: 'CONVERSATION_ACTIVE' }));
    await say('Sure, tell me a joke');
    expect(conv().state).toBe('CONVERSATION_ACTIVE');
    expect(sent).toHaveLength(2);
  });

  it('says goodbye politely, ends the conversation, and stays quiet on a bare "thanks" afterwards', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ reply: 'Take care! 😊', intent: 'goodbye', conversation_ended: true, next_state: 'CONVERSATION_ENDED' }));
    await say('Okay bye');
    expect(conv().state).toBe('CONVERSATION_ENDED');
    const before = sent.length;
    const r = await say('thanks');
    expect(r).toMatchObject({ replied: false, reason: 'ended_ack' });
    expect(sent.length).toBe(before);
  });

  it('restarts the conversation if the contact writes something new after goodbye', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ conversation_ended: true, next_state: 'CONVERSATION_ENDED', reply: 'Bye!' }));
    await say('bye');
    ai.respond.mockResolvedValueOnce(aiReply({ reply: 'Welcome back! 😊 What can I do for you?', next_state: 'ASKING_FOR_REQUEST' }));
    const r = await say('Actually I have another question about KUCCPS');
    expect(r.replied).toBe(true);
    expect(conv().state).toBe('ASKING_FOR_REQUEST');
  });

  it('the AI cannot end a conversation or jump to an illegal state by itself changing flags to takeover', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ next_state: 'HUMAN_TAKEOVER' }));
    await say('hello');
    expect(conv().state).not.toBe('HUMAN_TAKEOVER');
    expect(conv().humanTakeover).toBe(false);
  });
});

describe('Automation controls', () => {
  it('global OFF: stores the message but sends nothing and never calls the AI', async () => {
    await updateSetting('assistantEnabled', false);
    const r = await say('Hello?');
    expect(r).toMatchObject({ replied: false, reason: 'global_off' });
    expect(sent).toHaveLength(0);
    expect(ai.respond).not.toHaveBeenCalled();
    expect(models.Message.rows).toHaveLength(1);
  });

  it('timed pause blocks replies until it expires', async () => {
    await updateSetting('pausedUntil', new Date(Date.now() + 60_000).toISOString());
    expect((await say('hi')).reason).toBe('global_off');
    await updateSetting('pausedUntil', new Date(Date.now() - 1000).toISOString());
    expect((await say('hi again')).replied).toBe(true);
  });

  it('per-contact automation OFF silences only that contact', async () => {
    await say('hi');
    conv().automationEnabled = false;
    expect((await say('hello?')).reason).toBe('contact_automation_off');
    const other = await engine.handleContactMessage({ jid: '254733000999@s.whatsapp.net', waMessageId: 'X1', text: 'hi', type: 'text' });
    expect(other.replied).toBe(true);
  });
});

describe('Human takeover', () => {
  it('takeover stops AI replies for that contact but keeps storing their messages', async () => {
    await say('hello');
    await setTakeover(JID, true);
    expect(conv().state).toBe('HUMAN_TAKEOVER');
    const before = sent.length;
    const r = await say('are you there?');
    expect(r).toMatchObject({ replied: false, reason: 'human_takeover' });
    expect(sent.length).toBe(before);
    expect(models.Message.rows.filter((m) => m.text === 'are you there?')).toHaveLength(1);
  });

  it('other contacts keep getting automatic replies during a takeover', async () => {
    await say('hello');
    await setTakeover(JID, true);
    const other = await engine.handleContactMessage({ jid: '254733000999@s.whatsapp.net', waMessageId: 'Y1', text: 'hi', type: 'text' });
    expect(other.replied).toBe(true);
  });

  it('release restores the previous state and AI replies resume', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ next_state: 'COLLECTING_REQUEST', category: 'web_development' }));
    await say('I need a website');
    await setTakeover(JID, true);
    await setTakeover(JID, false);
    expect(conv().humanTakeover).toBe(false);
    expect(conv().state).toBe('COLLECTING_REQUEST');
    expect((await say('with a blog')).replied).toBe(true);
  });

  it('owner replying personally from the phone auto-engages takeover and the owner message is not footered', async () => {
    await say('hello');
    await engine.recordOwnerMessage({ jid: JID, waMessageId: 'OWN1', text: 'Hi Amina, I will call you.' });
    expect(conv().humanTakeover).toBe(true);
    expect(models.Message.rows.at(-1)).toMatchObject({ sender: 'owner', automated: false, text: 'Hi Amina, I will call you.' });
    expect((await say('great, thanks!')).reason).toBe('human_takeover');
  });

  it('auto-takeover can be disabled in settings', async () => {
    await updateSetting('automation', { ...(await getSettings()).automation, autoTakeoverOnOwnerReply: false });
    await say('hello');
    await engine.recordOwnerMessage({ jid: JID, waMessageId: 'OWN2', text: 'hello from me' });
    expect(conv().humanTakeover).toBe(false);
  });

  it('inactivity timeout releases takeover only after the owner has been silent long enough', async () => {
    await updateSetting('automation', { ...(await getSettings()).automation, takeoverInactivityMinutes: 30 });
    await say('hello');
    await setTakeover(JID, true);
    conv().lastOwnerMessageAt = new Date(Date.now() - 5 * 60_000); // owner active 5 min ago
    expect((await say('ping')).reason).toBe('human_takeover');
    conv().lastOwnerMessageAt = new Date(Date.now() - 45 * 60_000);
    expect((await say('ping 2')).replied).toBe(true);
    expect(conv().humanTakeover).toBe(false);
  });
});

describe('Owner commands (executed only after verification upstream)', () => {
  const ctx = { chatJid: JID, isSelfChat: true, tz: 'Africa/Nairobi', ai: { summarize: async () => 'bullet' }, getHealth: async () => ({ whatsapp: { state: 'connected' }, database: 'connected', ai: { provider: 'gemini', model: 'm', configured: true, lastError: null } }) };

  it('.assistant on / off / pause / resume change global automation', async () => {
    await executeCommand('.assistant off', ctx);
    expect((await getSettings({ fresh: true })).assistantEnabled).toBe(false);
    await executeCommand('.assistant on', ctx);
    expect((await getSettings({ fresh: true })).assistantEnabled).toBe(true);
    const p = await executeCommand('.assistant pause 30', ctx);
    expect(p.reply).toMatch(/30 minute/);
    expect((await say('hi')).reason).toBe('global_off');
    await executeCommand('.assistant resume', ctx);
    expect((await say('hi')).replied).toBe(true);
  });

  it('validates pause arguments', async () => {
    expect((await executeCommand('.assistant pause abc', ctx)).reply).toMatch(/Usage/);
    expect((await executeCommand('.assistant pause 99999', ctx)).reply).toMatch(/Usage/);
  });

  it('takeover/release by number from the self-chat; inside a customer chat uses that chat and removes the command', async () => {
    await say('hello');
    const byNumber = await executeCommand('.assistant takeover 0722000111', ctx);
    expect(byNumber.reply).toMatch(/Takeover ACTIVE/);
    expect(conv().humanTakeover).toBe(true);
    const inChat = await executeCommand('.assistant release', { ...ctx, isSelfChat: false });
    expect(inChat.reply).toMatch(/Released/);
    expect(inChat.deleteCommand).toBe(true);
    expect(conv().humanTakeover).toBe(false);
    expect((await executeCommand('.assistant takeover', ctx)).reply).toMatch(/Usage/);
  });

  it('status, requests, contacts, summary, health and help produce owner-only reports', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ category: 'kuccps', request_detected: true, request_summary: 'Needs course guidance', next_state: 'REQUEST_CAPTURED' }));
    await say('KUCCPS help please');
    expect((await executeCommand('.assistant status', ctx)).reply).toMatch(/WhatsApp: connected[\s\S]*Assistant: ON[\s\S]*Pending requests: 1/);
    expect((await executeCommand('.assistant requests', ctx)).reply).toMatch(/KUCCPS Consultation[\s\S]*Needs course guidance/);
    expect((await executeCommand('.assistant contacts', ctx)).reply).toMatch(/RECENT CONTACTS[\s\S]*request_captured/); // names need populate(): covered by real-DB tests
    expect((await executeCommand('.assistant summary', ctx)).reply).toMatch(/SUMMARY[\s\S]*bullet/);
    expect((await executeCommand('.assistant health', ctx)).reply).toMatch(/MongoDB: connected/);
    expect((await executeCommand('.assistant help', ctx)).reply).toMatch(/\.assistant takeover/);
    expect((await executeCommand('.assistant bogus', ctx)).reply).toMatch(/owner commands/);
  });

  it('writes an audit trail for important owner actions', async () => {
    await executeCommand('.assistant off', ctx);
    await executeCommand('.assistant on', ctx);
    expect(models.AuditLog.rows.map((a) => a.action)).toEqual(['assistant_off', 'assistant_on']);
  });
});

describe('AI failures', () => {
  it('uses a built-in friendly greeting if the AI is down on a first "Hi", still with footer', async () => {
    ai.respond.mockRejectedValue(new AiUnavailableError('down'));
    const r = await say('Hi');
    expect(r).toMatchObject({ replied: true, reason: 'ai_fallback' });
    expect(sent[0].text).toContain('Welcome!');
    expect(sent[0].text.endsWith(DEFAULT_FOOTER)).toBe(true);
    expect(conv().state).toBe('GREETING_SENT');
  });

  it('sends at most one generic apology per 10 minutes (no error spam)', async () => {
    ai.respond.mockRejectedValue(new AiUnavailableError('down'));
    await say('I need a website');
    await say('hello??');
    await say('anyone there?');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/trouble/);
  });

  it('an unexpected (non-AI) error is contained and never crashes the queue', async () => {
    ai.respond.mockRejectedValueOnce(new Error('boom'));
    const r = await say('hi');
    expect(r).toMatchObject({ replied: false, reason: 'error' });
    expect((await say('hi again')).replied).toBe(true);
  });

  it('blocks an AI reply that impersonates the owner and substitutes an honest identity line', async () => {
    ai.respond.mockResolvedValueOnce(aiReply({ reply: 'Hi, I am Legendary Smiley Cymor, call me!' }));
    await say('who is this?');
    expect(sent[0].text).not.toMatch(/I am Legendary/);
    expect(sent[0].text).toMatch(/AI assistant/);
  });
});

describe('Duplicate & loop protection, media', () => {
  it('ignores a duplicate WhatsApp message ID (one reply only)', async () => {
    await say('hello', { waMessageId: 'DUP1' });
    const r = await say('hello', { waMessageId: 'DUP1' });
    expect(r).toMatchObject({ replied: false, reason: 'duplicate' });
    expect(sent).toHaveLength(1);
    expect(models.Message.rows.filter((m) => m.waMessageId === 'DUP1')).toHaveLength(1);
  });

  it('burst guard stops a runaway ping-pong (e.g. another bot) after 5 replies a minute', async () => {
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await say(`msg ${i}`));
    expect(results.filter((r) => r.replied)).toHaveLength(5);
    expect(results.at(-1).reason).toBe('burst_guard');
  });

  it('processes messages of one chat strictly in order', async () => {
    const order = [];
    ai.respond.mockImplementation(async ({ userContent }) => {
      const current = userContent.match(/NEW MESSAGE TO REPLY TO:\n<contact_message>(.*)<\/contact_message>/)[1];
      await new Promise((r) => setTimeout(r, current === 'first' ? 30 : 1));
      order.push(current);
      return aiReply();
    });
    await Promise.all([say('first'), say('second')]);
    expect(order).toEqual(['first', 'second']);
  });

  it('replies politely to voice notes, images and locations without calling the AI or downloading anything', async () => {
    for (const type of ['ptt', 'image', 'location', 'document']) await say('', { type });
    expect(ai.respond).not.toHaveBeenCalled();
    expect(sent[0].text).toMatch(/voice note/i);
    expect(sent[1].text).toMatch(/attachments/i);
    expect(sent.every((s) => s.text.endsWith(DEFAULT_FOOTER))).toBe(true);
  });

  it('delete-contact-data removes every trace of one contact only', async () => {
    await say('hello');
    await engine.handleContactMessage({ jid: '254733000999@s.whatsapp.net', waMessageId: 'Z1', text: 'hey', type: 'text' });
    const out = await deleteContactData(JID);
    expect(out).toMatchObject({ contacts: 1, conversations: 1 });
    expect(models.Contact.rows.map((c) => c.jid)).toEqual(['254733000999@s.whatsapp.net']);
    expect(models.Message.rows.every((m) => m.jid !== JID)).toBe(true);
  });

  it('storeMessage reports duplicates as null', async () => {
    const { conversation } = await ensureConversation(JID);
    expect(await storeMessage({ conversation, jid: JID, waMessageId: 'Q', sender: 'contact', text: 'a' })).toBeTruthy();
    expect(await storeMessage({ conversation, jid: JID, waMessageId: 'Q', sender: 'contact', text: 'a' })).toBeNull();
  });
});
