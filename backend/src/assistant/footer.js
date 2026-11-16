/** Default branded signature (Unicode mathematical italic; WhatsApp has no custom fonts). */
export const DEFAULT_FOOTER = '✦ 𝑪𝒀𝑴𝑶𝑹 𝑨𝑺𝑺𝑰𝑺𝑻𝑨𝑵𝑻 ✦';

/** Plain-text variants the model might emit by accident; stripped before the real footer is appended. */
const FOOTER_VARIANTS = [
  /✦\s*[^\n✦]*C\s*Y\s*M\s*O\s*R[^\n✦]*A\s*S\s*S\s*I\s*S\s*T\s*A\s*N\s*T[^\n✦]*✦/giu,
  /✦\s*[𝑪𝒀𝑴𝑶𝑹\s𝑨𝑺𝑰𝑻𝑵]+\s*✦/gu,
];

export function stripFooters(text, footer = DEFAULT_FOOTER) {
  let out = String(text ?? '');
  out = out.split(footer).join('');
  for (const re of FOOTER_VARIANTS) out = out.replace(re, '');
  return out;
}
