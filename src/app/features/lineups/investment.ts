import { ASCENSION_RANKS, AscensionRank, Investment, RosterEntry } from './models';

export function isAscensionAtLeast(rank: AscensionRank | null | undefined, threshold: AscensionRank): boolean {
  if (!rank) return false;
  const rankIndex = ASCENSION_RANKS.indexOf(rank);
  const thresholdIndex = ASCENSION_RANKS.indexOf(threshold);
  return rankIndex >= 0 && thresholdIndex >= 0 && rankIndex >= thresholdIndex;
}

export function sanitizeInvestmentForAscension(
  investment: Investment | null,
  ascension: AscensionRank | null | undefined,
): Investment | null {
  if (!investment) return null;

  const canSi = isAscensionAtLeast(ascension, 'mythic');
  const canFurn = isAscensionAtLeast(ascension, 'ascended');
  const canEng = isAscensionAtLeast(ascension, 'ascended_1');

  const si = !canSi ? (investment.si !== null && investment.si !== undefined ? 0 : null) : investment.si;
  const furn = !canFurn ? (investment.furn !== null && investment.furn !== undefined ? 0 : null) : investment.furn;
  const eng = !canEng ? (investment.eng !== null && investment.eng !== undefined ? 0 : null) : investment.eng;

  return { si, furn, eng };
}

export function defaultAscensionForInvestment(investment: Investment | null): AscensionRank | null {
  if (!investment) return null;
  if (investment.eng !== null && investment.eng !== undefined && investment.eng > 0) {
    return investment.eng >= 60 ? 'ascended_1' : 'ascended_1';
  }
  if (investment.furn !== null && investment.furn !== undefined && investment.furn > 0) {
    return 'ascended';
  }
  if (investment.si !== null && investment.si !== undefined && investment.si > 0) {
    return 'mythic';
  }
  return null;
}

export function parseInvestment(value: string | undefined): Investment | null {
  const trimmed = value?.trim().toLowerCase() ?? '';
  if (!trimmed) return null;

  const match = /^(?:(\d{2})(\d{1,2})?|(--)(\d{1,2})?)?(?:e(\d{1,3}))?$/.exec(trimmed);
  if (!match || (!match[1] && !match[3] && match[5] === undefined)) return null;

  const si = match[1] === undefined ? null : Number(match[1]);
  const furn = match[2] === undefined
    ? (match[4] === undefined ? null : Number(match[4]))
    : Number(match[2]);
  const eng = match[5] === undefined
    ? (furn === null ? null : 0)
    : Number(match[5]);

  if ((si !== null && si > 50) || (furn !== null && furn > 36) || (eng !== null && eng > 100)) return null;
  return { si, furn, eng };
}

export function rosterInvestment(entry: RosterEntry | undefined): Investment | null {
  if (!entry) return null;
  if ('si' in entry || 'furn' in entry || 'eng' in entry) {
    return {
      si: entry.si ?? null,
      furn: entry.furn ?? null,
      eng: entry.eng ?? (entry.furn === null || entry.furn === undefined ? null : 0),
    };
  }
  return parseInvestment(entry.inv);
}

export function formatInvestment(investment: Investment | null): string {
  if (!investment) return '';
  const si = investment.si === null ? (investment.furn === null ? '' : '--') : String(investment.si).padStart(2, '0');
  const furniture = investment.furn === null ? '' : String(investment.furn);
  const engraving = investment.eng === null ? '' : `e${investment.eng}`;
  return `${si}${furniture}${engraving}`;
}
