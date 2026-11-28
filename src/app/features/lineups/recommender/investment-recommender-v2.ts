import { rosterInvestment } from '../investment';
import {
  AscensionRank,
  CollectionCatalogItem,
  CollectionInventoryItem,
  Hero,
  Investment,
  ModeConfig,
  ModeEventCoverage,
  Pet,
  PetRosterEntry,
  RecommendationCategory,
  RosterEntry,
  Submission,
} from '../models';
import {
  collectionLevelFromNodes,
  desiredStatsFromSnapshot,
  resolveCatalogItem,
  targetLevelFromSnapshot,
} from './collection-matcher';
import {
  buildInvestmentModel,
  classifyHeroCategory,
  computeSubmissionWeight,
  evaluateHeroAgainstTarget,
  snapToBreakpoint,
  weightedQuantile,
  WeightedSample,
} from './meta-model';

export type Si40Strategy = 'epic-focus' | 'split-305-380' | 'split-405-300' | 'balanced' | 'red-focus';

export interface Si40StrategyOption {
  readonly key: Si40Strategy;
  readonly label: string;
  readonly summary: string;
}

export const SI40_STRATEGY_OPTIONS: readonly Si40StrategyOption[] = [
  { key: 'epic-focus', label: '225R / 445E', summary: 'Epic focus (Red on 32–35)' },
  { key: 'split-305-380', label: '305R / 380E', summary: 'Lean Epic (Red on 32–36)' },
  { key: 'split-405-300', label: '405R / 300E', summary: 'Mid split (Red on 32–36, 38)' },
  { key: 'balanced', label: '495R / 230E', summary: 'Balanced (Red on 32–38)' },
  { key: 'red-focus', label: '660R / 110E', summary: 'Red focus (Red on 31–39)' },
];

export interface InvestmentRecommenderV2Input {
  readonly selectedModeSlugs: readonly string[];
  readonly modes: readonly ModeConfig[];
  readonly submissions: readonly Submission[];
  readonly roster: Readonly<Record<string, RosterEntry>>;
  readonly petRoster: Readonly<Record<string, PetRosterEntry>>;
  readonly collections: readonly CollectionInventoryItem[];
  readonly collectionCatalog: readonly CollectionCatalogItem[];
  readonly heroes: readonly Hero[];
  readonly pets: readonly Pet[];
  readonly si40Strategy?: Si40Strategy;
}

export interface ImpactTeamEntry {
  readonly submissionId: number;
  readonly modeSlug: string;
  readonly target: string;
  readonly slotLabel: string;
  readonly heroIds: readonly number[];
  readonly completesTeam: boolean;
}

export interface HeroInvestmentRecV2 {
  readonly heroId: number;
  readonly heroName: string;
  readonly iconUrl?: string;
  readonly category: RecommendationCategory;
  readonly kind: 'build' | 'invest';
  readonly score: number;
  readonly completeCount: number;
  readonly nearCount: number;
  readonly ownedAscension: AscensionRank | null;
  readonly ownedInv: Investment | null;
  readonly targetAscension: AscensionRank | null;
  readonly targetInv: Investment | null;
  readonly minViableInv: Investment | null;
  readonly missingMajorBreakpoints: readonly string[];
  readonly byModeEvents: Readonly<Record<string, ModeEventCoverage>>;
  readonly sampleCount: number;
  readonly submissionIds: readonly number[];
  readonly impactTeams: readonly ImpactTeamEntry[];
}

export interface PetInvestmentRecV2 {
  readonly petId: number;
  readonly petName: string;
  readonly iconUrl?: string;
  readonly petKind: 'standard' | 'awakened';
  readonly kind: 'build' | 'upgrade';
  readonly score: number;
  readonly ownedLevel: number | null;
  readonly targetLevel: number;
  readonly minViableLevel: number;
  readonly completeCount: number;
  readonly byMode: Readonly<Record<string, number>>;
  readonly impactTeams: readonly ImpactTeamEntry[];
}

export interface CollectionRecastCandidate {
  readonly ownedName: string;
  readonly matchedMythicCount: number;
  readonly matchedLegendaryCount: number;
  readonly targetMythicCount: number;
  readonly slotsRemaining: number;
  readonly estimatedElixirs: number;
}

export interface CollectionInvestmentRecV2 {
  readonly buildKey: string;
  readonly catalogId: number;
  readonly name: string;
  readonly collectionClass: CollectionCatalogItem['class'];
  readonly action: 'craft' | 'recast';
  readonly recastCandidate: CollectionRecastCandidate | null;
  readonly score: number;
  readonly targetLevel: number;
  readonly ownedMatchingCount: number;
  readonly maxCopiesInRun: number;
  readonly desiredStats: readonly string[];
  readonly topHeroIds: readonly number[];
  readonly demandCount: number;
  readonly impactTeams: readonly ImpactTeamEntry[];
}

export interface Si40Recommendation {
  readonly strategy: Si40Strategy;
  readonly missingSi30Count: number;
  readonly missingSi40Count: number;
  readonly reason: string;
}

export interface InvestmentRecommendationsV2Result {
  readonly overallHeroes: readonly HeroInvestmentRecV2[];
  readonly heroesByCategory: Readonly<Record<RecommendationCategory, readonly HeroInvestmentRecV2[]>>;
  readonly pets: readonly PetInvestmentRecV2[];
  readonly collections: readonly CollectionInvestmentRecV2[];
  readonly activeModeSlugs: readonly string[];
  readonly recommendedSi40: Si40Recommendation;
  readonly activeSi40Strategy: Si40Strategy;
}

const DEFAULT_OVERALL_MODES = ['nightmare-corridor', 'cursed-realm', 'treasure-scramble'] as const;
const NEAR_MISS_DECAY = 0.4;
const GAP_CAP = 8;
const BREADTH_BONUS = 0.15;
const BREADTH_MIN_SHARE = 0.10;
const COST_EXPONENT = 0.55;
const LUXURY_ONLY_URGENCY_MULTIPLIER = 0.78;
const PET_BREAKPOINTS = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36] as const;

// Exact AFK Arena per-level SI emblem costs (SI 21-30 = 300 Red = 1.0 SI30-unit).
const SI_21_30_RED = [10, 20, 20, 20, 30, 30, 40, 40, 40, 50] as const;
const SI_31_40_RED = [40, 45, 50, 60, 70, 80, 90, 100, 125, 160] as const;
const SI_31_40_EPIC = [30, 40, 50, 55, 60, 65, 70, 80, 90, 110] as const;
const SI_41_50_EPIC = [50, 60, 70, 80, 120, 140, 180, 200, 220, 240] as const;

interface Si40CostProfile {
  /** Which SI 31-40 levels (0-based index: 0 = SI31 .. 9 = SI40) are paid with Red emblems. */
  readonly redLevels: ReadonlySet<number>;
  /** Effective weight of 1 Red emblem in SI30-red equivalents. */
  readonly redWeight: number;
  /** Effective weight of 1 Epic emblem in SI30-red equivalents. */
  readonly epicWeight: number;
}

const SI40_COST_PROFILES: Readonly<Record<Si40Strategy, Si40CostProfile>> = {
  // 225 Red (32-35) + 445 Epic (31, 36-40) -> ~4.61 SI30-units (saving Reds for SI30s).
  'epic-focus': { redLevels: new Set([1, 2, 3, 4]), redWeight: 1.0, epicWeight: 2.6 },
  // 305 Red (32-36) + 380 Epic (31, 37-40) -> ~4.28 SI30-units.
  'split-305-380': { redLevels: new Set([1, 2, 3, 4, 5]), redWeight: 1.0, epicWeight: 2.58 },
  // 405 Red (32-36, 38) + 300 Epic (31, 37, 39, 40) -> ~3.90 SI30-units.
  'split-405-300': { redLevels: new Set([1, 2, 3, 4, 5, 7]), redWeight: 1.0, epicWeight: 2.55 },
  // 495 Red (32-38) + 230 Epic (31, 39, 40) -> ~3.57 SI30-units (balanced endgame split).
  balanced: { redLevels: new Set([1, 2, 3, 4, 5, 6, 7]), redWeight: 1.0, epicWeight: 2.5 },
  // 660 Red (31-39) + 110 Epic (40) -> ~2.60 SI30-units (surplus Reds, pushing SI40s).
  'red-focus': { redLevels: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]), redWeight: 0.85, epicWeight: 2.0 },
};

const CATEGORY_BUILD_COST: Readonly<Record<RecommendationCategory, number>> = {
  'standard-4f': 1.0,
  'drago-lite': 1.8,
  'cele-hypo': 2.6,
  awakened: 3.4,
  'dragon-highborn': 4.4,
};

function computeSiUpgradeUnits(haveSi: number, targetSi: number, strategy: Si40Strategy): number {
  if (targetSi <= haveSi) return 0;
  let units = 0;

  // SI 0 -> 20: Purple + Gold emblems (cheap, farmable).
  const si20From = Math.max(0, haveSi);
  const si20To = Math.min(20, targetSi);
  if (si20To > si20From) {
    units += (si20To - si20From) * 0.015;
  }

  // SI 21 -> 30: exact Red emblem curve (300 Red = 1.0 unit).
  const si30From = Math.max(20, haveSi);
  const si30To = Math.min(30, targetSi);
  for (let lvl = si30From + 1; lvl <= si30To; lvl += 1) {
    units += SI_21_30_RED[lvl - 21] / 300;
  }

  // SI 31 -> 40: exact Red/Epic split curve for the chosen strategy.
  const profile = SI40_COST_PROFILES[strategy];
  const si40From = Math.max(30, haveSi);
  const si40To = Math.min(40, targetSi);
  for (let lvl = si40From + 1; lvl <= si40To; lvl += 1) {
    const idx = lvl - 31;
    const redEq = profile.redLevels.has(idx)
      ? SI_31_40_RED[idx] * profile.redWeight
      : SI_31_40_EPIC[idx] * profile.epicWeight;
    units += redEq / 300;
  }

  // SI 41 -> 50: Epic emblems only (1,360 Epics).
  const si50From = Math.max(40, haveSi);
  const si50To = Math.min(50, targetSi);
  for (let lvl = si50From + 1; lvl <= si50To; lvl += 1) {
    units += (SI_41_50_EPIC[lvl - 41] * profile.epicWeight) / 300;
  }

  return units;
}

export function recommendSi40Strategy(
  missingSi30Count: number,
  missingSi40Count: number,
): Si40Recommendation {
  if (missingSi30Count >= 10) {
    return {
      strategy: 'epic-focus',
      missingSi30Count,
      missingSi40Count,
      reason: `${missingSi30Count} owned meta heroes still need SI30 — save Reds`,
    };
  }
  if (missingSi30Count >= 6) {
    return {
      strategy: 'split-305-380',
      missingSi30Count,
      missingSi40Count,
      reason: `${missingSi30Count} owned meta heroes still need SI30 — lean Epic`,
    };
  }
  if (missingSi30Count >= 3) {
    return {
      strategy: 'split-405-300',
      missingSi30Count,
      missingSi40Count,
      reason: `${missingSi30Count} owned meta heroes still need SI30 — moderate Red/Epic split`,
    };
  }
  if (missingSi30Count >= 1) {
    return {
      strategy: 'balanced',
      missingSi30Count,
      missingSi40Count,
      reason: `Only ${missingSi30Count} owned meta ${missingSi30Count === 1 ? 'hero needs' : 'heroes need'} SI30 — balanced split`,
    };
  }
  return {
    strategy: 'red-focus',
    missingSi30Count,
    missingSi40Count,
    reason: missingSi40Count > 0
      ? `All owned meta SI30s done (${missingSi40Count} SI40 targets) — push with Reds`
      : 'All owned meta SI30s done — Red focus',
  };
}

export function computeInvestmentCostFactor(
  category: RecommendationCategory,
  kind: 'build' | 'invest',
  ownedInv: Investment | null,
  targetInv: Investment | null,
  si40Strategy: Si40Strategy = 'balanced',
): number {
  const baseCost = kind === 'build' ? CATEGORY_BUILD_COST[category] : 0.55;
  let upgradeCost = 0;
  if (targetInv) {
    const haveSi = ownedInv?.si ?? 0;
    const haveFurn = ownedInv?.furn ?? 0;
    const haveEng = ownedInv?.eng ?? 0;

    if (targetInv.si && targetInv.si > haveSi) {
      upgradeCost += computeSiUpgradeUnits(haveSi, targetInv.si, si40Strategy);
    }

    if (targetInv.furn && targetInv.furn > haveFurn) {
      const f3 = Math.max(0, Math.min(3, targetInv.furn) - haveFurn);
      const f9 = Math.max(0, Math.min(9, targetInv.furn) - Math.max(3, haveFurn));
      const fOver = Math.max(0, targetInv.furn - Math.max(9, haveFurn));
      upgradeCost += f3 * 0.12 + f9 * 0.15 + fOver * 0.25;
    }

    if (targetInv.eng && targetInv.eng > haveEng) {
      // E0->E30: 3,750 Shards (cheap); E30->E60: 4,500 Cores (scarce); E60->E80+: 6,000+ Cores (luxury).
      const e30 = Math.max(0, Math.min(30, targetInv.eng) - haveEng);
      const e60 = Math.max(0, Math.min(60, targetInv.eng) - Math.max(30, haveEng));
      const e80 = Math.max(0, targetInv.eng - Math.max(60, haveEng));
      upgradeCost += e30 * 0.014 + e60 * 0.08 + e80 * 0.16;
    }
  }
  const totalCost = Math.max(0.55, baseCost + upgradeCost);
  return Math.pow(totalCost, COST_EXPONENT);
}

interface NormalizedFormationRow {
  readonly submission: Submission;
  readonly formation: Submission['forms'][number];
  readonly modeSlug: string;
  readonly eventKey: string;
  readonly weight: number;
  readonly compHeroSig: string;
}

export function computeInvestmentRecommendationsV2(
  input: InvestmentRecommenderV2Input,
): InvestmentRecommendationsV2Result {
  const {
    selectedModeSlugs,
    submissions,
    roster,
    petRoster,
    collections,
    collectionCatalog,
    heroes,
    pets,
    si40Strategy,
  } = input;

  const activeModeSlugs = selectedModeSlugs.length > 0
    ? [...selectedModeSlugs]
    : [...DEFAULT_OVERALL_MODES];
  const activeModeSet = new Set(activeModeSlugs);

  const heroById = new Map<number, Hero>(heroes.map((h) => [h.id, h]));
  const petById = new Map<number, Pet>(pets.map((p) => [p.id, p]));
  const hasRoster = Object.keys(roster).length > 0;

  // Build global investment consensus model across ALL submissions so missing investments are imputed.
  const investmentModel = buildInvestmentModel(submissions);

  const scopedSubs = submissions.filter((s) => activeModeSet.has(s.mode));

  // Precompute max upvotes / best NC time / max CR damage per target & slot for scoring.
  const maxUpvotesByTarget = new Map<string, number>();
  const bestTimeBySlot = new Map<string, number>();
  const maxDamageBySlot = new Map<string, number>();

  for (const sub of scopedSubs) {
    const tKey = `${sub.mode}|${sub.target}`;
    maxUpvotesByTarget.set(tKey, Math.max(maxUpvotesByTarget.get(tKey) ?? 0, sub.up));
    for (const form of sub.forms) {
      const sKey = `${tKey}|${form.key}`;
      if (sub.mode === 'nightmare-corridor' && form.timeSeconds && form.timeSeconds > 0) {
        const prev = bestTimeBySlot.get(sKey);
        if (prev === undefined || form.timeSeconds < prev) bestTimeBySlot.set(sKey, form.timeSeconds);
      }
      const dmg = form.damage ?? (typeof sub.result['damage'] === 'number' ? sub.result['damage'] : null);
      if (dmg && dmg > 0) {
        maxDamageBySlot.set(sKey, Math.max(maxDamageBySlot.get(sKey) ?? 0, dmg));
      }
    }
  }

  // Build raw weighted formation rows and normalize each mode to 100 total weight split evenly by event.
  const rawRows: {
    submission: Submission;
    formation: Submission['forms'][number];
    modeSlug: string;
    eventKey: string;
    rawWeight: number;
    compHeroSig: string;
  }[] = [];

  const eventsByMode = new Map<string, Set<string>>();
  const weightSumByModeEvent = new Map<string, number>();
  const weightSumByMode = new Map<string, number>();

  for (const sub of scopedSubs) {
    const tKey = `${sub.mode}|${sub.target}`;
    const maxUp = maxUpvotesByTarget.get(tKey) ?? 0;
    const formCount = Math.max(1, sub.forms.filter((f) => f.heroes.length > 0).length);

    for (const form of sub.forms) {
      if (form.heroes.length === 0) continue;
      const sKey = `${tKey}|${form.key}`;
      const eventKey = sub.mode === 'nightmare-corridor' ? form.key : sub.target;
      const compHeroSig = [...form.heroes].map((h) => h.hid).sort((a, b) => a - b).join(',');
      const rawWeight = computeSubmissionWeight(
        sub,
        form,
        maxUp,
        bestTimeBySlot.get(sKey) ?? null,
        maxDamageBySlot.get(sKey) ?? null,
      ) / Math.sqrt(formCount);

      rawRows.push({
        submission: sub,
        formation: form,
        modeSlug: sub.mode,
        eventKey,
        rawWeight,
        compHeroSig,
      });

      let evSet = eventsByMode.get(sub.mode);
      if (!evSet) {
        evSet = new Set<string>();
        eventsByMode.set(sub.mode, evSet);
      }
      evSet.add(eventKey);

      const meKey = `${sub.mode}|${eventKey}`;
      weightSumByModeEvent.set(meKey, (weightSumByModeEvent.get(meKey) ?? 0) + rawWeight);
      weightSumByMode.set(sub.mode, (weightSumByMode.get(sub.mode) ?? 0) + rawWeight);
    }
  }

  const normalizedRows: NormalizedFormationRow[] = rawRows.map((row) => {
    const eventCount = Math.max(1, eventsByMode.get(row.modeSlug)?.size ?? 1);
    const weight = row.modeSlug === 'nightmare-corridor'
      ? (row.rawWeight * 100) / Math.max(1e-6, weightSumByMode.get(row.modeSlug) ?? 1)
      : (row.rawWeight / Math.max(1e-6, weightSumByModeEvent.get(`${row.modeSlug}|${row.eventKey}`) ?? 1))
        * (100 / eventCount);
    return {
      submission: row.submission,
      formation: row.formation,
      modeSlug: row.modeSlug,
      eventKey: row.eventKey,
      weight,
      compHeroSig: row.compHeroSig,
    };
  });

  // ---- 1. HERO INVESTMENT RECOMMENDATIONS ----
  interface ImpactAccEntry {
    readonly entry: ImpactTeamEntry;
    readonly weight: number;
  }

  const recordImpact = (
    map: Map<string, ImpactAccEntry>,
    row: NormalizedFormationRow,
    completesTeam: boolean,
    weight: number,
  ): void => {
    const k = `${row.modeSlug}|${row.submission.target}|${row.formation.label}`;
    const existing = map.get(k);
    const rankScore = weight + (completesTeam ? 1000 : 0);
    if (!existing || rankScore > existing.weight) {
      map.set(k, {
        weight: rankScore,
        entry: {
          submissionId: row.submission.id,
          modeSlug: row.modeSlug,
          target: row.submission.target,
          slotLabel: row.formation.label,
          heroIds: row.formation.heroes.map((h) => h.hid),
          completesTeam,
        },
      });
    }
  };

  const topImpactTeams = (map: Map<string, ImpactAccEntry>, limit = 5): readonly ImpactTeamEntry[] =>
    [...map.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map((item) => item.entry);

  interface HeroAcc {
    heroId: number;
    category: RecommendationCategory;
    isMissing: boolean;
    completeCount: number;
    nearCount: number;
    modePts: Map<string, number>;
    modeEvents: Map<string, Set<string>>;
    submissionIds: Set<number>;
    gapSeveritySum: number;
    gapWeightSum: number;
    impacts: Map<string, ImpactAccEntry>;
  }

  const heroAccMap = new Map<number, HeroAcc>();

  for (const row of normalizedRows) {
    // Resolve every hero's modeled investment target for this formation (imputing null investments!).
    const heroStates = row.formation.heroes
      .filter((pick) => !pick.merc)
      .map((pick) => {
        const target = investmentModel.resolve(
          row.modeSlug,
          row.submission.target,
          row.formation.key,
          row.compHeroSig,
          pick.hid,
        );
        const gap = hasRoster
          ? evaluateHeroAgainstTarget(pick.hid, target, roster)
          : { status: 'missing' as const, belowMinViable: true, penalty: 100, missingMajorBreakpoints: [] };
        return { pick, target, gap };
      });

    const teamGapCount = heroStates.filter((s) => s.gap.status !== 'ok').length;
    if (teamGapCount === 0) continue;

    const decayFactor = hasRoster
      ? Math.pow(NEAR_MISS_DECAY, Math.min(teamGapCount, GAP_CAP) - 1)
      : 1;

    for (const { pick, gap } of heroStates) {
      if (gap.status === 'ok') continue;
      const heroMeta = heroById.get(pick.hid);
      const category = classifyHeroCategory(heroMeta);
      if (!category) continue;

      // Weight upgrade urgency by breakpoint severity (missing hero = 1.0, below min viable = 0.9,
      // core gaps = 0.35-0.85, luxury-only SI40/E60/E80 gaps discounted slightly).
      const isLuxuryOnly = gap.status === 'under'
        && !gap.belowMinViable
        && gap.missingMajorBreakpoints.length > 0
        && gap.missingMajorBreakpoints.every((bp) => bp === 'SI40' || bp === 'E60' || bp === 'E80');
      const baseSeverity = gap.status === 'missing'
        ? 1.0
        : gap.belowMinViable
          ? 0.9
          : Math.min(0.85, 0.35 + gap.penalty / 120);
      const severity = isLuxuryOnly ? baseSeverity * LUXURY_ONLY_URGENCY_MULTIPLIER : baseSeverity;

      const pts = row.weight * decayFactor * severity;

      let acc = heroAccMap.get(pick.hid);
      if (!acc) {
        acc = {
          heroId: pick.hid,
          category,
          isMissing: gap.status === 'missing',
          completeCount: 0,
          nearCount: 0,
          modePts: new Map(),
          modeEvents: new Map(),
          submissionIds: new Set(),
          gapSeveritySum: 0,
          gapWeightSum: 0,
          impacts: new Map(),
        };
        heroAccMap.set(pick.hid, acc);
      }

      if (gap.status === 'missing') acc.isMissing = true;
      if (teamGapCount === 1) acc.completeCount += 1;
      else if (teamGapCount > 1 && teamGapCount < 99) acc.nearCount += 1;

      acc.modePts.set(row.modeSlug, (acc.modePts.get(row.modeSlug) ?? 0) + pts);
      let evs = acc.modeEvents.get(row.modeSlug);
      if (!evs) {
        evs = new Set<string>();
        acc.modeEvents.set(row.modeSlug, evs);
      }
      evs.add(row.eventKey);
      acc.submissionIds.add(row.submission.id);
      acc.gapSeveritySum += severity * row.weight;
      acc.gapWeightSum += row.weight;
      recordImpact(acc.impacts, row, teamGapCount === 1, pts);
    }
  }

  // Max mode pts per mode (for thresholded multi-mode breadth bonus).
  const maxHeroPtsByMode = new Map<string, number>();
  for (const acc of heroAccMap.values()) {
    for (const [modeSlug, pts] of acc.modePts.entries()) {
      maxHeroPtsByMode.set(modeSlug, Math.max(maxHeroPtsByMode.get(modeSlug) ?? 0, pts));
    }
  }

  // Recommend an SI40 Red/Epic split based on how many owned meta heroes still need SI30 vs SI40.
  const singleMode = activeModeSlugs.length === 1 ? activeModeSlugs[0] : undefined;
  let missingSi30Count = 0;
  let missingSi40Count = 0;
  if (hasRoster) {
    for (const acc of heroAccMap.values()) {
      if (acc.isMissing) continue;
      const owned = roster[acc.heroId];
      const ownedInv = rosterInvestment(owned);
      const consensusTarget = investmentModel.resolveForHero(acc.heroId, singleMode);
      const targetSi = consensusTarget.inv?.si ?? 0;
      const haveSi = ownedInv?.si ?? 0;
      if (targetSi >= 30 && haveSi < 30) missingSi30Count += 1;
      if (targetSi >= 40 && haveSi < 40) missingSi40Count += 1;
    }
  }
  const recommendedSi40: Si40Recommendation = hasRoster
    ? recommendSi40Strategy(missingSi30Count, missingSi40Count)
    : {
        strategy: 'balanced',
        missingSi30Count: 0,
        missingSi40Count: 0,
        reason: 'Default balanced split (add your roster for a personalized split)',
      };
  const activeSi40Strategy: Si40Strategy = si40Strategy ?? recommendedSi40.strategy;

  const allHeroRecs: HeroInvestmentRecV2[] = [];
  for (const acc of heroAccMap.values()) {
    const heroMeta = heroById.get(acc.heroId);
    const owned = roster[acc.heroId];
    const ownedInv = rosterInvestment(owned);
    const consensusTarget = investmentModel.resolveForHero(acc.heroId, singleMode);
    const gapEval = evaluateHeroAgainstTarget(acc.heroId, consensusTarget, roster);

    // If user owns the hero and already meets the global/mode consensus target, skip noise.
    if (hasRoster && !acc.isMissing && gapEval.status === 'ok') continue;

    let rawScore = 0;
    let activeModes = 0;
    const byModeEvents: Record<string, ModeEventCoverage> = {};

    for (const [modeSlug, pts] of acc.modePts.entries()) {
      rawScore += pts;
      const modeMax = maxHeroPtsByMode.get(modeSlug) ?? 0;
      if (modeMax > 0 && pts >= modeMax * BREADTH_MIN_SHARE) {
        activeModes += 1;
      }
      const totalEvs = modeSlug === 'nightmare-corridor'
        ? Math.min(6, eventsByMode.get(modeSlug)?.size ?? 6)
        : (eventsByMode.get(modeSlug)?.size ?? 1);
      byModeEvents[modeSlug] = {
        used: Math.min(acc.modeEvents.get(modeSlug)?.size ?? 0, totalEvs),
        total: totalEvs,
      };
    }

    const breadthMultiplier = 1 + BREADTH_BONUS * Math.max(0, activeModes - 1);
    const kind: 'build' | 'invest' = acc.isMissing ? 'build' : 'invest';
    const costFactor = computeInvestmentCostFactor(
      acc.category,
      kind,
      ownedInv,
      consensusTarget.inv,
      activeSi40Strategy,
    );
    const finalScore = Math.round(((rawScore * breadthMultiplier) / costFactor) * 100) / 100;

    allHeroRecs.push({
      heroId: acc.heroId,
      heroName: heroMeta?.name ?? `Hero #${acc.heroId}`,
      iconUrl: heroMeta?.iconUrl,
      category: acc.category,
      kind,
      score: finalScore,
      completeCount: acc.completeCount,
      nearCount: acc.nearCount,
      ownedAscension: owned?.ascension ?? null,
      ownedInv,
      targetAscension: consensusTarget.ascension,
      targetInv: consensusTarget.inv,
      minViableInv: consensusTarget.minViableInv,
      missingMajorBreakpoints: gapEval.missingMajorBreakpoints,
      byModeEvents,
      sampleCount: consensusTarget.sampleCount,
      submissionIds: [...acc.submissionIds].slice(0, 6),
      impactTeams: topImpactTeams(acc.impacts, 5),
    });
  }

  allHeroRecs.sort((a, b) => b.score - a.score);

  const heroesByCategory: Record<RecommendationCategory, HeroInvestmentRecV2[]> = {
    'standard-4f': [],
    'cele-hypo': [],
    awakened: [],
    'drago-lite': [],
    'dragon-highborn': [],
  };
  for (const rec of allHeroRecs) {
    if (heroesByCategory[rec.category].length < 8) {
      heroesByCategory[rec.category].push(rec);
    }
  }

  // ---- 2. PET RECOMMENDATIONS V2 ----
  interface PetAcc {
    petId: number;
    petKind: 'standard' | 'awakened';
    levels: WeightedSample[];
    pts: number;
    completeCount: number;
    byMode: Record<string, number>;
    impacts: Map<string, ImpactAccEntry>;
  }
  const petAccMap = new Map<number, PetAcc>();

  for (const row of normalizedRows) {
    const pid = row.formation.petId;
    if (pid === null) continue;
    const petMeta = petById.get(pid);
    if (!petMeta || petMeta.kind === 'basic') continue;

    const ownedPet = petRoster[pid];
    const reqLevel = row.formation.petLevel ?? 18;
    if (ownedPet && ownedPet.level >= reqLevel) continue;

    const crossing18 = !ownedPet || (ownedPet.level < 18 && reqLevel >= 18);
    const priorityBoost = crossing18 ? 1.35 : 0.75;

    let acc = petAccMap.get(pid);
    if (!acc) {
      acc = {
        petId: pid,
        petKind: petMeta.kind,
        levels: [],
        pts: 0,
        completeCount: 0,
        byMode: {},
        impacts: new Map(),
      };
      petAccMap.set(pid, acc);
    }
    acc.levels.push({ value: reqLevel, weight: row.weight });
    acc.pts += row.weight * priorityBoost;
    acc.completeCount += 1;
    acc.byMode[row.modeSlug] = (acc.byMode[row.modeSlug] ?? 0) + 1;
    recordImpact(acc.impacts, row, crossing18, row.weight * priorityBoost);
  }

  const petRecs: PetInvestmentRecV2[] = [...petAccMap.values()]
    .map((acc) => {
      const petMeta = petById.get(acc.petId)!;
      const owned = petRoster[acc.petId];
      const targetRaw = weightedQuantile(acc.levels, 0.6) ?? 18;
      const minRaw = weightedQuantile(acc.levels, 0.25) ?? 18;
      return {
        petId: acc.petId,
        petName: petMeta.name,
        iconUrl: petMeta.iconUrl,
        petKind: acc.petKind,
        kind: (owned ? 'upgrade' : 'build') as 'build' | 'upgrade',
        score: Math.round(acc.pts * 100) / 100,
        ownedLevel: owned?.level ?? null,
        targetLevel: snapToBreakpoint(targetRaw, PET_BREAKPOINTS),
        minViableLevel: snapToBreakpoint(minRaw, PET_BREAKPOINTS),
        completeCount: acc.completeCount,
        byMode: acc.byMode,
        impactTeams: topImpactTeams(acc.impacts, 5),
      };
    })
    .filter((p) => p.ownedLevel === null || p.ownedLevel < p.targetLevel)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  // ---- 3. COLLECTION RECOMMENDATIONS V2 ----
  // Group by distinct build: (catalogId, exact level, mythic stat build).
  // Models Ghoulish Gallery Recasting Elixir economics:
  // - Exact level is required (Skill Level +1 cannot be recast).
  // - Recasting L->M costs ~400 Elixirs per slot (and requires >=3 unlocked stat nodes).
  // - Owned copies already close to the target (e.g. 2/3 Mythics, 1 slot away) are strongly
  //   weighted toward Recast, while 0-match copies recommend a fresh Craft.
  const NON_RECASTABLE_STATS = new Set<string>(['skill_level', 'err']);

  interface OwnedColSummary {
    readonly id: string;
    readonly name: string;
    readonly catalogId: number;
    readonly level: number;
    readonly totalStatNodes: number;
    readonly mythicStatCounts: ReadonlyMap<string, number>;
    readonly legendaryStatCounts: ReadonlyMap<string, number>;
  }

  const ownedColsByCatalog = new Map<number, OwnedColSummary[]>();
  for (const item of collections) {
    const resolved = resolveCatalogItem(collectionCatalog, item.catalogId, item.name);
    const cid = item.catalogId ?? resolved?.id;
    if (cid === undefined) continue;
    const level = collectionLevelFromNodes(item.nodes);
    const mythicStatCounts = new Map<string, number>();
    const legendaryStatCounts = new Map<string, number>();
    let totalStatNodes = 0;

    for (const node of item.nodes) {
      if (node.stat === 'skill_level') continue;
      totalStatNodes += 1;
      if (node.tier === 'mythic') {
        mythicStatCounts.set(node.stat, (mythicStatCounts.get(node.stat) ?? 0) + 1);
      } else if (node.tier === 'legendary') {
        legendaryStatCounts.set(node.stat, (legendaryStatCounts.get(node.stat) ?? 0) + 1);
      }
    }

    let list = ownedColsByCatalog.get(cid);
    if (!list) {
      list = [];
      ownedColsByCatalog.set(cid, list);
    }
    list.push({
      id: item.id,
      name: item.name,
      catalogId: cid,
      level,
      totalStatNodes,
      mythicStatCounts,
      legendaryStatCounts,
    });
  }

  const normalizeStatBuild = (stats: readonly string[]): readonly string[] =>
    [...new Set(stats)].sort().slice(0, 3);

  const makeBuildKey = (catalogId: number, level: number, stats: readonly string[]): string =>
    `${catalogId}|${level}|${stats.join(',')}`;

  // Lv.3 uses 2 slots for +1 Skill Level nodes, so 2 target Mythics is already a strong build;
  // Lv.1 and Lv.2 have more open slots so 3 target Mythics is the full-build benchmark.
  const targetMythicBenchmark = (reqLevel: number): number => (reqLevel >= 3 ? 2 : 3);

  const countMatchingNodes = (
    counts: ReadonlyMap<string, number>,
    desiredStats: readonly string[],
  ): number => desiredStats.reduce((sum, st) => sum + (counts.get(st) ?? 0), 0);

  // Pass 1: learn consensus mythic stat builds across ALL submissions for imputation.
  const heroColBuildVotes = new Map<string, Map<string, number>>();
  const colLevelBuildVotes = new Map<string, Map<string, number>>();

  const recordStatVote = (
    outer: Map<string, Map<string, number>>,
    outerKey: string,
    statsKey: string,
    weight: number,
  ): void => {
    let inner = outer.get(outerKey);
    if (!inner) {
      inner = new Map<string, number>();
      outer.set(outerKey, inner);
    }
    inner.set(statsKey, (inner.get(statsKey) ?? 0) + weight);
  };

  for (const sub of submissions) {
    const w = Math.pow(0.5, Math.max(0, sub.days) / 45) * (1 + Math.log1p(Math.max(0, sub.up)));
    for (const form of sub.forms) {
      for (const pick of form.heroes) {
        if (!pick.collection) continue;
        const resolved = resolveCatalogItem(collectionCatalog, pick.collection.catalogId, pick.collection.name);
        const cid = pick.collection.catalogId ?? resolved?.id;
        if (cid === undefined) continue;
        const lvl = targetLevelFromSnapshot(pick.collection);
        const stats = normalizeStatBuild(desiredStatsFromSnapshot(pick.collection));
        if (stats.length === 0) continue;
        const statsKey = stats.join(',');
        recordStatVote(heroColBuildVotes, `${pick.hid}|${cid}|${lvl}`, statsKey, w);
        recordStatVote(colLevelBuildVotes, `${cid}|${lvl}`, statsKey, w);
      }
    }
  }

  const bestVotedStats = (votes: Map<string, number> | undefined): readonly string[] => {
    if (!votes || votes.size === 0) return [];
    let bestKey = '';
    let bestW = -1;
    for (const [k, w] of votes.entries()) {
      if (w > bestW) {
        bestW = w;
        bestKey = k;
      }
    }
    return bestKey ? bestKey.split(',') : [];
  };

  const resolveBuildStats = (
    heroId: number,
    cid: number,
    lvl: number,
    rawStats: readonly string[],
  ): readonly string[] => {
    const normalized = normalizeStatBuild(rawStats);
    if (normalized.length > 0) return normalized;
    const fromHero = bestVotedStats(heroColBuildVotes.get(`${heroId}|${cid}|${lvl}`));
    if (fromHero.length > 0) return fromHero;
    return bestVotedStats(colLevelBuildVotes.get(`${cid}|${lvl}`));
  };

  const evaluateOwnedCollectionBuild = (
    catalogId: number,
    reqLevel: number,
    desiredStats: readonly string[],
  ): {
    readonly fullMatchingCount: number;
    readonly bestRecast: CollectionRecastCandidate | null;
    readonly closenessMultiplier: number;
  } => {
    const ownedList = ownedColsByCatalog.get(catalogId) ?? [];
    const targetMythics = targetMythicBenchmark(reqLevel);
    const canRecastTarget = desiredStats.some((st) => !NON_RECASTABLE_STATS.has(st));

    let fullMatchingCount = 0;
    let bestRecast: CollectionRecastCandidate | null = null;
    let bestProximity = -1;

    for (const owned of ownedList) {
      // Collections at different levels are completely distinct builds (Skill Level cannot be recast).
      if (owned.level !== reqLevel) continue;
      const mCount = countMatchingNodes(owned.mythicStatCounts, desiredStats);
      const lCount = countMatchingNodes(owned.legendaryStatCounts, desiredStats);

      if (mCount >= targetMythics) {
        fullMatchingCount += 1;
        continue;
      }

      // Evaluate as a Recast candidate if it already has >=1 matching Mythic stat and >=3 unlocked nodes.
      if (canRecastTarget && owned.totalStatNodes >= 3 && mCount >= 1) {
        const slotsRemaining = Math.max(1, targetMythics - mCount);
        const proximity = mCount * 10 + lCount * 3 - slotsRemaining * 2;
        if (proximity > bestProximity) {
          bestProximity = proximity;
          // L->M recast costs ~400 Elixirs; if fewer L matches than slotsRemaining, non-L slots cost more (~500).
          const lUpgrades = Math.min(lCount, slotsRemaining);
          const otherUpgrades = slotsRemaining - lUpgrades;
          const estimatedElixirs = lUpgrades * 400 + otherUpgrades * 500;
          bestRecast = {
            ownedName: owned.name,
            matchedMythicCount: mCount,
            matchedLegendaryCount: lCount,
            targetMythicCount: targetMythics,
            slotsRemaining,
            estimatedElixirs,
          };
        }
      }
    }

    // Weight recasting strongly by closeness:
    // - 1 slot away (e.g. 2/3 Mythic Erosion) -> strong boost (1.45x, +0.1x if an L match is ready)
    // - 2 slots away (e.g. 1/3 Mythic Erosion) -> modest weight (1.05x if L match, 0.92x otherwise)
    // - 0 matches (fresh craft) -> standard 1.0x
    let closenessMultiplier = 1.0;
    if (bestRecast) {
      if (bestRecast.slotsRemaining === 1) {
        closenessMultiplier = bestRecast.matchedLegendaryCount > 0 ? 1.55 : 1.45;
      } else {
        closenessMultiplier = bestRecast.matchedLegendaryCount > 0 ? 1.05 : 0.92;
      }
    }

    return { fullMatchingCount, bestRecast, closenessMultiplier };
  };

  // Track max concurrent copies of each distinct (catalogId, level, statBuild) used within a single run.
  const maxCopiesPerRun = new Map<string, number>();
  for (const sub of scopedSubs) {
    const runCounts = new Map<string, number>();
    for (const form of sub.forms) {
      for (const pick of form.heroes) {
        if (!pick.collection) continue;
        const resolved = resolveCatalogItem(collectionCatalog, pick.collection.catalogId, pick.collection.name);
        const cid = pick.collection.catalogId ?? resolved?.id;
        if (cid === undefined) continue;
        const lvl = targetLevelFromSnapshot(pick.collection);
        const stats = resolveBuildStats(pick.hid, cid, lvl, desiredStatsFromSnapshot(pick.collection));
        if (stats.length === 0) continue;
        const key = makeBuildKey(cid, lvl, stats);
        runCounts.set(key, (runCounts.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of runCounts.entries()) {
      maxCopiesPerRun.set(key, Math.max(maxCopiesPerRun.get(key) ?? 0, count));
    }
  }

  interface ColAcc {
    buildKey: string;
    catalogId: number;
    targetLevel: number;
    desiredStats: readonly string[];
    name: string;
    collectionClass: CollectionCatalogItem['class'];
    heroWeights: Map<number, number>;
    pts: number;
    demandCount: number;
    impacts: Map<string, ImpactAccEntry>;
  }
  const colAccMap = new Map<string, ColAcc>();

  for (const row of normalizedRows) {
    for (const pick of row.formation.heroes) {
      if (!pick.collection) continue;
      const resolved = resolveCatalogItem(collectionCatalog, pick.collection.catalogId, pick.collection.name);
      const cid = pick.collection.catalogId ?? resolved?.id;
      if (cid === undefined) continue;
      const cls = pick.collection.class ?? resolved?.class ?? 'Support';
      const reqLvl = targetLevelFromSnapshot(pick.collection);
      const rawStats = desiredStatsFromSnapshot(pick.collection);
      const desired = resolveBuildStats(pick.hid, cid, reqLvl, rawStats);
      // Skip stat-less entries that have no mythic stat nodes anywhere in the DB.
      if (desired.length === 0) continue;

      const key = makeBuildKey(cid, reqLvl, desired);
      const evalOwned = evaluateOwnedCollectionBuild(cid, reqLvl, desired);
      const copiesNeeded = maxCopiesPerRun.get(key) ?? 1;
      if (evalOwned.fullMatchingCount >= copiesNeeded) continue;

      let acc = colAccMap.get(key);
      if (!acc) {
        acc = {
          buildKey: key,
          catalogId: cid,
          targetLevel: reqLvl,
          desiredStats: desired,
          name: resolved?.name ?? pick.collection.name,
          collectionClass: cls,
          heroWeights: new Map(),
          pts: 0,
          demandCount: 0,
          impacts: new Map(),
        };
        colAccMap.set(key, acc);
      }

      const statConfidence = rawStats.length > 0 ? 1.0 : 0.75;
      const gapMult = evalOwned.fullMatchingCount === 0 ? 1.25 : 0.7;
      acc.pts += row.weight * gapMult * statConfidence * evalOwned.closenessMultiplier;
      acc.demandCount += 1;
      acc.heroWeights.set(pick.hid, (acc.heroWeights.get(pick.hid) ?? 0) + row.weight);
      recordImpact(acc.impacts, row, false, row.weight * gapMult);
    }
  }

  const colRecs: CollectionInvestmentRecV2[] = [...colAccMap.values()]
    .map((acc) => {
      const topHeroIds = [...acc.heroWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);

      const evalOwned = evaluateOwnedCollectionBuild(acc.catalogId, acc.targetLevel, acc.desiredStats);
      const maxCopiesInRun = maxCopiesPerRun.get(acc.buildKey) ?? 1;
      // Recommend Recast when we have an eligible close candidate (e.g. 1 slot away, or 1M+1L);
      // otherwise recommend a fresh Craft.
      const action: 'craft' | 'recast' = evalOwned.bestRecast !== null ? 'recast' : 'craft';

      return {
        buildKey: acc.buildKey,
        catalogId: acc.catalogId,
        name: acc.name,
        collectionClass: acc.collectionClass,
        action,
        recastCandidate: evalOwned.bestRecast,
        score: Math.round(acc.pts * 100) / 100,
        targetLevel: acc.targetLevel,
        ownedMatchingCount: evalOwned.fullMatchingCount,
        maxCopiesInRun,
        desiredStats: acc.desiredStats,
        topHeroIds,
        demandCount: acc.demandCount,
        impactTeams: topImpactTeams(acc.impacts, 5),
      };
    })
    .filter((c) => c.ownedMatchingCount < c.maxCopiesInRun)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);

  return {
    overallHeroes: allHeroRecs.slice(0, 10),
    heroesByCategory,
    pets: petRecs,
    collections: colRecs,
    activeModeSlugs,
    recommendedSi40,
    activeSi40Strategy,
  };
}
