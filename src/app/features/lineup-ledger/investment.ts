import { Investment, RosterEntry } from './models';

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

  if ((si !== null && si > 40) || (furn !== null && furn > 12) || (eng !== null && eng > 100)) return null;
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
