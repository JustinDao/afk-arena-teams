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
    if (reportedTimes === 0) {
      if (result['timeSeconds'] !== undefined) {
        return `${formatDuration(Number(result['timeSeconds']))} total time`;
      }
      return 'Kill times not reported';
    }
    if (reportedTimes < submission.forms.length) return `${reportedTimes} of ${submission.forms.length} kill times reported`;
    const total = submission.forms.reduce((sum, f) => sum + (f.timeSeconds ?? 0), 0);
    return `${countLabel(submission.forms.length, 'boss kill time')} (${formatDuration(total)} total)`;
  }
  if (submission.mode === 'treasure-scramble' || submission.mode === 'heroes-of-esperia') {
    if (result['placement'] === undefined) return 'Result not reported';
    return result['placementType'] === 'rank'
      ? `Rank ${result['placement']}`
      : `Top ${result['placement']}%`;
  }
  if (submission.mode === 'temporal-rift') {
    return result['floor'] === undefined ? 'Floor not reported' : `Floor ${result['floor']}`;
  }
  if (submission.mode === 'dragonforge-trials') {
    if (result['stars'] === undefined) return 'Stars not reported';
    return countLabel(Number(result['stars']), 'star');
  }
  if (result['damage'] === undefined) return 'Damage not reported';
  return `${formatDamage(Number(result['damage']))} damage${submission.mode === 'cursed-realm' ? ' in total' : ''}`;
}

export function parseDamage(value: string): number | null {
  const match = /^\s*([\d.,]+)\s*([kmbt])?\s*$/i.exec(value);
  if (!match) return null;
  const number = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  return number * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]?.toLowerCase() ?? ''] ?? 1);
}

export function formatDamage(value: number): string {
  for (const [unit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (value >= unit) return `${Number((value / unit).toFixed(2))}${suffix}`;
  }
  return String(value);
}

export function parseDuration(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d+):(\d{1,2})(?:\.\d+)?$/.exec(trimmed);
  if (match) {
    const seconds = Number(match[2]);
    if (seconds > 59) return null;
    const duration = Number(match[1]) * 60 + seconds;
    return duration > 0 ? duration : null;
  }
  const withoutUnit = trimmed.replace(/s$/i, '').trim();
  const duration = /^\d+(?:\.\d+)?$/.test(withoutUnit) ? Number(withoutUnit) : 0;
  return duration > 0 ? duration : null;
}

export function formatDuration(value: number): string {
  const totalSec = Math.round(value);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

export function formatKillTime(value: number | null): string {
  return value === null ? '' : formatDuration(value);
}
