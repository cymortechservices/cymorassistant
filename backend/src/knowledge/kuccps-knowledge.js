/**
 * KUCCPS knowledge + inquiry module.
 *
 * DESIGN RULE: this module contains ONLY general, non-numeric guidance and the
 * conversation scaffolding. It deliberately contains no cluster points,
 * cut-offs, deadlines or institution requirements, because those change every
 * year and must come from official KUCCPS publications. Future integration
 * point: implement `KuccpsAdvisor` (see bottom) and register it so verified
 * data can be injected into the prompt without changing the engine.
 */

export const KUCCPS_KEYWORDS = [
  'kuccps', 'kcse', 'cluster', 'cut-off', 'cutoff', 'cut off', 'placement', 'university course', 'degree course',
  'course selection', 'choose a course', 'choosing a course', 'which course', 'diploma', 'certificate course',
  'mean grade', 'subject cluster', 'admission', 'tvet', 'colleges', 'university placement', 'revise courses', 'course revision',
  'kcpe', 'qualify for', 'eligib',
];

export const KUCCPS_GUIDANCE = {
  ownerRole:
    'The owner is a KUCCPS consultant who helps students with course selection, understanding KCSE requirements, cluster points, cut-off points and the application process.',
  generalConcepts: [
    'KUCCPS is the Kenya Universities and Colleges Central Placement Service, which places eligible KCSE candidates in government-sponsored university and college programmes.',
    'Cluster points are calculated from specific subjects for each programme; cut-off points vary by programme and by year.',
  ],
  intakeQuestions: [
    'Are you a KCSE candidate who has received results, or seeking guidance about an existing application?',
    'Which KCSE year are you asking about?',
    'What is your overall (mean) grade?',
    'Which courses or fields interest you?',
    'Do you have specific universities or colleges in mind?',
    'What exactly would you like help with?',
  ],
  safeguards: [
    'Never state or estimate cluster points, cut-off points, deadlines, or institution requirements.',
    'Never guarantee admission, placement or any particular university.',
    'Never claim to access a student’s KUCCPS account, and never ask for passwords, KUCCPS login details or OTPs.',
    'Personalised qualification assessments and course recommendations come from the owner himself.',
    'Clearly separate general guidance (fine) from official data (only from KUCCPS publications) and estimates (not to be given).',
  ],
};

export function isKuccpsText(text) {
  const t = String(text || '').toLowerCase();
  return KUCCPS_KEYWORDS.some((k) => k.length > 3 && t.includes(k));
}

/**
 * Hook for a future "CYMOR KUCCPS Advisor" integration. A provider returns
 * VERIFIED, sourced facts (with an `official: true|false` flag) that the prompt
 * builder will include. Until one is registered, nothing numeric is provided.
 */
let advisor = null;
export function registerKuccpsAdvisor(impl) {
  advisor = impl;
}
export async function getVerifiedKuccpsFacts(query) {
  if (!advisor?.lookup) return [];
  try {
    const facts = await advisor.lookup(query);
    return Array.isArray(facts) ? facts.filter((f) => f && f.official === true && f.source) : [];
  } catch {
    return [];
  }
}

/** Heuristic: has the student given enough for the owner to act on? */
export function kuccpsIntakeProgress(collected = {}) {
  const have = ['studentType', 'kcseYear', 'grade', 'interests', 'helpNeeded'].filter((k) => collected[k]);
  return { have, complete: have.length >= 3 };
}
