/**
 * Default, editable business knowledge. These are seeded into the Settings
 * collection on first run and can then be edited from the dashboard without
 * touching code. Nothing here invents prices, addresses or phone numbers:
 * unknown facts are intentionally left empty and the assistant refers the
 * contact to the owner instead.
 */
export const DEFAULT_OWNER_PROFILE = {
  name: 'Legendary Smiley Cymor',
  position: 'C.E.O of CYMOR TECH SERVICES',
  professions: ['Software Developer', 'KUCCPS Consultant'],
  company: 'CYMOR TECH SERVICES',
  primaryChannel: 'WhatsApp',
  country: 'Kenya',
  currency: 'KES',
};

export const DEFAULT_COMPANY = {
  description:
    'CYMOR TECH SERVICES is a Kenyan technology company led by Legendary Smiley Cymor. It provides software and web development, AI-powered and automation solutions, and KUCCPS consultation for students.',
};

export const DEFAULT_SERVICES = [
  {
    id: 'software_web',
    title: 'Software and web development',
    items: [
      'Website development',
      'Business websites',
      'Portfolio websites',
      'E-commerce websites',
      'Web applications',
      'Backend and API development',
      'Frontend development',
      'Database integration',
      'Website maintenance',
      'Software development consulting',
      'Automation systems',
      'AI-powered applications',
      'Custom software solutions',
    ],
  },
  {
    id: 'kuccps',
    title: 'KUCCPS consultation',
    items: [
      'KUCCPS application guidance',
      'University and college course selection',
      'Understanding KCSE grade requirements',
      'Degree course qualification guidance',
      'University programme selection',
      'Understanding KUCCPS cluster points',
      'Understanding course cut-off points',
      'Course and institution comparisons',
      'Application procedure guidance',
      'Student course-placement consultations',
    ],
  },
  {
    id: 'tech_consulting',
    title: 'General technology consultation',
    items: [
      'Technology advice',
      'Software recommendations',
      'Programming assistance',
      'Project consultations',
      'AI development discussions',
      'General digital solutions',
    ],
  },
];

export const DEFAULT_FAQS = [
  {
    q: 'Who is Legendary Smiley Cymor?',
    a: 'Legendary Smiley Cymor is the C.E.O of CYMOR TECH SERVICES, a software developer and KUCCPS consultant based in Kenya.',
  },
  {
    q: 'What is CYMOR TECH SERVICES?',
    a: 'CYMOR TECH SERVICES is a technology company offering software and web development, automation and AI solutions, and KUCCPS consultation for students.',
  },
  {
    q: 'Does the owner develop websites or software?',
    a: 'Yes. Websites, web apps, e-commerce, APIs, automation and custom software are all part of the services offered.',
  },
  {
    q: 'Does the owner offer KUCCPS consultation?',
    a: 'Yes. He guides students on course selection, KCSE requirements, cluster points, cut-off points and the application process. Personal advice is given by the owner himself.',
  },
  {
    q: 'How can someone request a consultation?',
    a: 'Tell me what you need and I will record the details for the owner, who will follow up when he is available.',
  },
];

export const DEFAULT_POLICIES = {
  communication: [
    'The assistant is an AI and never claims to be the human owner.',
    'Prices, quotations, addresses, phone numbers, deadlines and guarantees are only given if they appear in this knowledge base. Otherwise the question is recorded for the owner.',
    'The assistant never asks for passwords, OTPs or login credentials.',
  ],
  consultationInfo:
    'Consultations are arranged by the owner personally. The assistant records the request and the owner follows up.',
  officialLinks: [],
  workingHours: '',
};

export const DEFAULT_SETTINGS = {
  assistantEnabled: false,
  pausedUntil: null,
  ownerPhone: '',
  footer: '✦ 𝑪𝒀𝑴𝑶𝑹 𝑨𝑺𝑺𝑰𝑺𝑻𝑨𝑵𝑻 ✦',
  personalityNotes: '',
  ai: { provider: 'gemini', model: '', temperature: 0.7, timeoutMs: 20000, maxRetries: 2, historyMessages: 14 },
  notifications: {
    enabled: true,
    newInquiry: true,
    urgent: true,
    kuccps: true,
    unansweredQuestion: true,
    dailySummary: true,
    dailySummaryHour: 20,
  },
  automation: {
    groupsEnabled: false,
    autoTakeoverOnOwnerReply: true,
    takeoverInactivityMinutes: 0, // 0 = never auto-release
    maxConsecutiveBotReplies: 12,
    maxMediaBytes: 5 * 1024 * 1024,
    retentionDays: 90,
  },
  ownerProfile: DEFAULT_OWNER_PROFILE,
  company: DEFAULT_COMPANY,
  services: DEFAULT_SERVICES,
  faqs: DEFAULT_FAQS,
  policies: DEFAULT_POLICIES,
};
