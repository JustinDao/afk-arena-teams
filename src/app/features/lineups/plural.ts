import pluralize from 'pluralize';

/** "1 team", "2 teams", "0 mercenaries". */
export function countLabel(count: number, noun: string): string {
  return pluralize(noun, count, true);
}

/** The noun alone, pluralized for the count: "pet" or "pets". */
export function pluralNoun(count: number, noun: string): string {
  return pluralize(noun, count);
}
