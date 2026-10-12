/**
 * Warning printed in the browser console against "self-XSS": someone talks a speaker into
 * pasting code into the developer tools, which would hand over their signed-in session.
 * Bilingual on purpose: it must be read before any app state (locale) is trusted.
 */
export const SELF_XSS_LINES = [
  "Stop! / Arrêtez !",
  "This browser feature is for developers. If someone told you to copy and paste something here, it is a scam: it would give them access to your Afriklang account and recordings.",
  "Cette fonction du navigateur est réservée aux développeurs. Si quelqu'un vous a demandé de copier-coller quelque chose ici, c'est une arnaque : cela lui donnerait accès à votre compte Afriklang et à vos enregistrements.",
] as const;

let shown = false;

export function printSelfXssWarning(log: (...args: string[]) => void = console.log): void {
  if (shown) return;
  shown = true;
  const [title, en, fr] = SELF_XSS_LINES;
  log(`%c${title}`, "color:#d32f2f;font-size:40px;font-weight:900;-webkit-text-stroke:1px #000");
  log(`%c${en}\n\n${fr}`, "font-size:16px;line-height:1.4");
}
