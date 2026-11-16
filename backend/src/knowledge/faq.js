export function renderFaqs(settings) {
  return (settings.faqs || []).map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
}
