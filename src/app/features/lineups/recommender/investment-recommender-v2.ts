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

export interface InvestmentRecommendationsV2Result {
  readonly overallHeroes: readonly HeroInvestmentRecV2[];
  readonly heroesByCategory: Readonly<Record<RecommendationCategory, readonly HeroInvestmentRecV2[]>>;
  readonly pets: readonly PetInvestmentRecV2[];
  readonly collections: readonly CollectionInvestmentRecV2[];
  readonly activeModeSlugs: readonly string[];
}

const DEFAULT_OVERALL_MODES = ['nightmare-corridor', 'cursed-realm', 'treasure-scramble'] as const;
const NEAR_MISS_DECAY = 0.4;
const GAP_CAP = 8;
const BREADTH_BONUS = 0.15;
const BREADTH_MIN_SHARE = 0.10;
const COST_EXPONENT = 0.30;
const PET_BREAKPOINTS = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36] as const;

const CATEGORY_BUILD_COST: Readonly<Record<RecommendationCategory, number>> = {
  'standard-4f': 1.0,
  'drago-lite': 1.8,
  'cele-hypo': 2.6,
  awakened: 3.4,
  'dragon-highborn': 4.4,
};

function computeInvestmentCostFactor(
  category: RecommendationCategory,
  kind: 'build' | 'invest',
  ownedInv: Investment | null,
  targetInv: Investment | null,
): number {
  const baseCost = kind === 'build' ? CATEGORY_BUILD_COST[category] : 0.45;
  let upgradeCost = 0;
  if (targetInv) {
    const haveSi = ownedInv?.si ?? 0;
    const haveFurn = ownedInv?.furn ?? 0;
    const haveEng = ownedInv?.eng ?? 0;
    if (targetInv.si && targetInv.si > haveSi) {
      const si40Part = Math.max(0, targetInv.si - Math.max(30, haveSi));
      const si30Part = Math.max(0, Math.min(30, targetInv.si) - haveSi);
      upgradeCost += si30Part * 0.025 + si40Part * 0.095;
    }
    if (targetInv.furn && targetInv.furn > haveFurn) {
      upgradeCost += (targetInv.furn - haveFurn) * 0.08;
    }
    if (targetInv.eng && targetInv.eng > haveEng) {
      upgradeCost += (targetInv.eng - haveEng) * 0.018;
    }
  }
  const totalCost = Math.max(0.5, baseCost + upgradeCost);
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

      // Weight upgrade urgency by breakpoint severity (missing hero = 1.0, major breakpoint gap = 0.75-1.0, minor gap = 0.35).
      const severity = gap.status === 'missing'
        ? 1.0
        : gap.belowMinViable
          ? 0.9
          : Math.min(0.85, 0.35 + gap.penalty / 120);

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

  const allHeroRecs: HeroInvestmentRecV2[] = [];
  for (const acc of heroAccMap.values()) {
    const heroMeta = heroById.get(acc.heroId);
    const owned = roster[acc.heroId];
    const ownedInv = rosterInvestment(owned);
    const singleMode = activeModeSlugs.length === 1 ? activeModeSlugs[0] : undefined;
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
    const costFactor = computeInvestmentCostFactor(acc.category, kind, ownedInv, consensusTarget.inv);
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
  };
}
