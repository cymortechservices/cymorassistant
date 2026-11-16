export function renderServices(settings) {
  return (settings.services || [])
    .map((s) => `${s.title}:\n${(s.items || []).map((i) => `- ${i}`).join('\n')}`)
    .join('\n\n');
}

export const WEB_INTAKE_QUESTIONS = [
  'What kind of project do you need?',
  'What is the purpose of the project?',
  'What features would you like?',
  'Do you already have a design or specification?',
  'What is your expected timeline?',
];
