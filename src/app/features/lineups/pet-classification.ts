const AWAKENED_PET_NAMES = new Set([
  'blazefang',
  'countsnickerfang',
  'nightfallpegasus',
  'twinlumspirit',
]);

function normalizeName(name: string): string {
  return name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isAwakenedPet(name: string, isAwakened = false): boolean {
  return isAwakened || AWAKENED_PET_NAMES.has(normalizeName(name));
}
