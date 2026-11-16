/** Render the owner profile / company / policies (from editable settings) into prompt text. */
export function renderOwnerProfile(settings) {
  const o = settings.ownerProfile;
  const c = settings.company;
  const p = settings.policies;
  const lines = [
    `Owner name: ${o.name}`,
    `Position: ${o.position}`,
    `Professions: ${(o.professions || []).join(', ')}`,
    `Company: ${o.company}`,
    `Country: ${o.country}; currency: ${o.currency}`,
    `Primary channel: ${o.primaryChannel}`,
    `Company description: ${c.description}`,
  ];
  if (p.workingHours) lines.push(`Working hours: ${p.workingHours}`);
  if (p.consultationInfo) lines.push(`Consultation information: ${p.consultationInfo}`);
  if (p.officialLinks?.length) lines.push(`Official links: ${p.officialLinks.join(', ')}`);
  if (p.communication?.length) lines.push('Communication policies:\n' + p.communication.map((x) => `- ${x}`).join('\n'));
  return lines.join('\n');
}
