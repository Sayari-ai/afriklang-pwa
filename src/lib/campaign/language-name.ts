/**
 * A language name inside a sentence. French writes it in lower case (« Dites ceci en pulaar »,
 * « le test en wolof »), as the dashboard's French emails do (doc 10); English keeps the capital.
 * Only a name that reads as a capitalised word changes, and only its first letter: a code shown
 * in place of a missing name ("FUC") or a name like "N'Ko" stays as it is, and so do the capitals
 * further in ("pulaar du Fouta"). Badges that show the name alone keep the catalogue's name.
 */
export function languageInText(name: string, locale: string): string {
  if (!locale.toLowerCase().startsWith("fr")) return name;
  const [first, second] = Array.from(name);
  if (!first || !second) return name;
  const isUpper = (c: string) => c !== c.toLocaleLowerCase("fr") && c === c.toLocaleUpperCase("fr");
  const isLower = (c: string) => c !== c.toLocaleUpperCase("fr") && c === c.toLocaleLowerCase("fr");
  if (!isUpper(first) || !isLower(second)) return name;
  return first.toLocaleLowerCase("fr") + name.slice(first.length);
}
