import { countLabel } from '../../plural';
import { ModeConfig } from '../../models';

export interface ModeCount {
  readonly slug: string;
  readonly short: string;
  readonly count: number;
}

export function modeCountsFor(byMode: Readonly<Record<string, number>>, modes: readonly ModeConfig[]): readonly ModeCount[] {
  const shorts = new Map(modes.map((mode) => [mode.slug, mode.short]));
  return Object.entries(byMode)
    .map(([slug, count]) => ({ slug, short: shorts.get(slug) ?? slug, count }))
    .sort((left, right) => right.count - left.count);
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
