import { HERO_BY_ID } from './lineup-data';
import { displayHeroName, Investment, Submission } from './models';
import { countLabel } from './plural';
import { formatInvestment as formatInvestmentCode } from './investment';

export function heroName(heroId: number): string {
  const hero = HERO_BY_ID.get(heroId);
  if (!hero) throw new Error(`Unknown hero id: ${heroId}`);
  return displayHeroName(hero);
}

export function heroHue(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

export function formatInvestment(investment: Investment | null): string {
  return formatInvestmentCode(investment);
}

export function resultLine(submission: Submission): string {
  const result = submission.result;
  if (submission.mode === 'nightmare-corridor') {
    const reportedTimes = submission.forms.filter(({ timeSeconds }) => timeSeconds !== null).length;
    if (reportedTimes === 0) return 'Kill times not reported';
    if (reportedTimes < submission.forms.length) return `${reportedTimes} of ${submission.forms.length} kill times reported`;
    return `${countLabel(submission.forms.length, 'boss kill time')}`;
  }
  if (submission.mode === 'treasure-scramble') {
    if (result['placement'] === undefined) return 'Result not reported';
    return result['placementType'] === 'rank'
      ? `Rank ${result['placement']}`
      : `Top ${result['placement']}%`;
  }
  if (result['damage'] === undefined) return 'Damage not reported';
  return `${formatDamage(Number(result['damage']))} damage${submission.mode === 'cursed-realm' ? ' in total' : ''}`;
}

function formatDamage(value: number): string {
  for (const [unit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (value >= unit) return `${Number((value / unit).toFixed(2))}${suffix}`;
  }
  return String(value);
}

function formatDuration(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function formatKillTime(value: number | null): string {
  return value === null ? '' : formatDuration(value);
}
