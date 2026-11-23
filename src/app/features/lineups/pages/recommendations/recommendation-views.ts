import { countLabel } from '../../plural';
import { ModeConfig, ModeEventCoverage } from '../../models';

export interface ModeCount {
  readonly slug: string;
  readonly short: string;
  readonly count: number;
  readonly events?: ModeEventCoverage;
}

export function modeCountsFor(
  byMode: Readonly<Record<string, number>>,
  modes: readonly ModeConfig[],
  byModeEvents?: Readonly<Record<string, ModeEventCoverage>>,
): readonly ModeCount[] {
  const shorts = new Map(modes.map((mode) => [mode.slug, mode.short]));
  return Object.entries(byMode)
    .map(([slug, count]) => ({
      slug,
      short: shorts.get(slug) ?? slug,
      count,
      events: byModeEvents?.[slug],
    }))
    .sort((left, right) => {
      const leftRatio = left.events && left.events.total > 0 ? left.events.used / left.events.total : -1;
      const rightRatio = right.events && right.events.total > 0 ? right.events.used / right.events.total : -1;
      return rightRatio - leftRatio || right.count - left.count;
    });
}

export function reasonFor(
  recommendation: { readonly kind: 'build' | 'invest' | 'upgrade'; readonly completeCount: number; readonly nearCount: number },
  modeCounts: readonly ModeCount[],
): string {
  const { kind, completeCount, nearCount } = recommendation;
  const plural = (count: number) => countLabel(count, 'top team');
  if (completeCount === 0 && nearCount === 0) {
    return `Used in ${plural(modeCounts.reduce((total, mode) => total + mode.count, 0))}`;
  }
  const parts: string[] = [];
  if (completeCount > 0) parts.push(`${kind === 'build' ? 'Completes' : 'Fully unlocks'} ${plural(completeCount)}`);
  if (nearCount > 0) parts.push(`${completeCount > 0 ? 'gets you closer on' : 'Gets you closer on'} ${nearCount} more`);
  return parts.join(' and ');
}
