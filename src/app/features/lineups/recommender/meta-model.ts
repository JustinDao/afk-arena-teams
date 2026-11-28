import { isAscensionAtLeast, rosterInvestment } from '../investment';
import {
  ASCENSION_RANKS,
  AscensionRank,
  CollectionCatalogItem,
  CollectionNodeStat,
  CollectionSnapshot,
  Formation,
  Hero,
  HeroPick,
  Investment,
  ModeConfig,
  Pet,
  RecommendationCategory,
  RosterEntry,
  Submission,
} from '../models';
import {
  ATTACK_COLLECTION_NODE_STATS,
  DEFENSE_COLLECTION_NODE_STATS,
} from '../collection-catalog';
import {
  desiredStatsFromSnapshot,
  resolveCatalogItem,
  targetLevelFromSnapshot,
} from './collection-matcher';

export interface WeightedSample {
  readonly value: number;
  readonly weight: number;
}

export interface HeroInvestmentTarget {
  readonly ascension: AscensionRank | null;
  readonly inv: Investment | null;
  readonly minViableInv: Investment | null;
  readonly source: 'comp' | 'mode' | 'global' | 'none';
  readonly sampleCount: number;
}

export interface ModeledCompHero {
  readonly pos: number;
  readonly hid: number;
  readonly name: string;
  readonly iconUrl?: string;
  readonly faction?: string | null;
  readonly target: HeroInvestmentTarget;
  readonly collection: CollectionSnapshot | null;
}

export interface ModeledComp {
  readonly compKey: string;
  readonly slotKey: string;
  readonly slotLabel: string;
  readonly modeSlug: string;
  readonly target: string;
  readonly heroes: readonly ModeledCompHero[];
  readonly heroIds: readonly number[];
  readonly petId: number | null;
  readonly beast: string;
  readonly petIconUrl: string | null;
  readonly petLevel: number | null;
  readonly spHeroId: number | null;
  readonly avgTimeSeconds: number | null;
  readonly avgDamage: number | null;
  readonly evidenceWeight: number;
  readonly submissionCount: number;
  readonly investmentCoverage: number;
  readonly collectionCoverage: number;
  readonly representativeSubmission: Submission;
  readonly representativeFormation: Formation;
  readonly sourceSubmissionIds: readonly number[];
}

export interface InvestmentGapDetail {
  readonly status: 'ok' | 'under' | 'missing';
  readonly belowMinViable: boolean;
  readonly penalty: number;
  readonly missingMajorBreakpoints: readonly string[];
}

const SI_BREAKPOINTS = [0, 10, 20, 30, 40, 50] as const;
const FURN_BREAKPOINTS = [0, 3, 9, 18, 27, 36] as const;
const ENG_BREAKPOINTS = [0, 30, 60, 80, 100] as const;
const PET_BREAKPOINTS = [6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36] as const;
const RECENCY_HALF_LIFE_DAYS = 45;
const ATTACK_STAT_SET = new Set<string>(ATTACK_COLLECTION_NODE_STATS);
const DEFENSE_STAT_SET = new Set<string>(DEFENSE_COLLECTION_NODE_STATS);

export function weightedQuantile(samples: readonly WeightedSample[], q: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
  if (totalWeight <= 0) return sorted[Math.floor(sorted.length * q)]?.value ?? null;
  const threshold = totalWeight * Math.min(1, Math.max(0, q));
  let acc = 0;
  for (const s of sorted) {
    acc += Math.max(0, s.weight);
    if (acc >= threshold) return s.value;
  }
  return sorted[sorted.length - 1].value;
}

export function snapToBreakpoint(value: number, breakpoints: readonly number[]): number {
  let best = breakpoints[0];
  let bestDist = Math.abs(value - best);
  for (const bp of breakpoints) {
    const dist = Math.abs(value - bp);
    if (dist < bestDist || (dist === bestDist && bp > best)) {
      best = bp;
      bestDist = dist;
    }
  }
  return best;
}

export function hasRecordedInvestment(pick: Pick<HeroPick, 'inv'>): boolean {
  if (!pick.inv) return false;
  return pick.inv.si !== null || pick.inv.furn !== null || pick.inv.eng !== null;
}

export function classifyHeroCategory(hero: Hero | undefined): RecommendationCategory | null {
  if (!hero) return null;
  if (hero.isAwakened) return 'awakened';
  const faction = hero.faction ?? '';
  if (faction === 'Lightbearer' || faction === 'Mauler' || faction === 'Wilder' || faction === 'Graveborn') {
    return 'standard-4f';
  }
  if (faction === 'Celestial' || faction === 'Hypogean') {
    return 'cele-hypo';
  }
  if (faction === 'Draconis') {
    return /\(highborn\)/i.test(hero.name) ? 'dragon-highborn' : 'drago-lite';
  }
  return null;
}

interface InvestmentBucket {
  si: WeightedSample[];
  furn: WeightedSample[];
  eng: WeightedSample[];
  asc: WeightedSample[];
  count: number;
}

function createBucket(): InvestmentBucket {
  return { si: [], furn: [], eng: [], asc: [], count: 0 };
}

function addPickToBucket(bucket: InvestmentBucket, pick: HeroPick, weight: number): void {
  const hasInv = hasRecordedInvestment(pick);
  if (hasInv && pick.inv) {
    if (pick.inv.si !== null) bucket.si.push({ value: pick.inv.si, weight });
    if (pick.inv.furn !== null) bucket.furn.push({ value: pick.inv.furn, weight });
    if (pick.inv.eng !== null) bucket.eng.push({ value: pick.inv.eng, weight });
    bucket.count += 1;
  }
  if (pick.ascension) {
    const idx = ASCENSION_RANKS.indexOf(pick.ascension);
    if (idx >= 0) {
      // Only trust ascension from picks that also recorded investment, or give lower weight to bare Ascended defaults.
      const ascWeight = hasInv ? weight : weight * 0.25;
      bucket.asc.push({ value: idx, weight: ascWeight });
    }
  }
}

function clampAscensionForInvestment(
  ascension: AscensionRank | null,
  inv: Investment | null,
): AscensionRank | null {
  let minIdx = ascension ? ASCENSION_RANKS.indexOf(ascension) : -1;
  if (inv) {
    if ((inv.eng ?? 0) > 0) minIdx = Math.max(minIdx, ASCENSION_RANKS.indexOf('ascended_1'));
    else if ((inv.furn ?? 0) > 0) minIdx = Math.max(minIdx, ASCENSION_RANKS.indexOf('ascended'));
    else if ((inv.si ?? 0) > 0) minIdx = Math.max(minIdx, ASCENSION_RANKS.indexOf('mythic'));
  }
  return minIdx >= 0 ? ASCENSION_RANKS[minIdx] : null;
}

function summarizeBucket(
  bucket: InvestmentBucket | undefined,
  source: 'comp' | 'mode' | 'global',
): HeroInvestmentTarget | null {
  if (!bucket || (bucket.count === 0 && bucket.asc.length === 0)) return null;

  const siTargetRaw = weightedQuantile(bucket.si, 0.6);
  const furnTargetRaw = weightedQuantile(bucket.furn, 0.6);
  const engTargetRaw = weightedQuantile(bucket.eng, 0.6);

  const siMinRaw = weightedQuantile(bucket.si, 0.25);
  const furnMinRaw = weightedQuantile(bucket.furn, 0.25);
  const engMinRaw = weightedQuantile(bucket.eng, 0.25);

  const hasAnyInv = siTargetRaw !== null || furnTargetRaw !== null || engTargetRaw !== null;
  const inv: Investment | null = hasAnyInv
    ? {
        si: siTargetRaw !== null ? snapToBreakpoint(siTargetRaw, SI_BREAKPOINTS) : null,
        furn: furnTargetRaw !== null ? snapToBreakpoint(furnTargetRaw, FURN_BREAKPOINTS) : null,
        eng: engTargetRaw !== null ? snapToBreakpoint(engTargetRaw, ENG_BREAKPOINTS) : null,
      }
    : null;

  const minViableInv: Investment | null = hasAnyInv && inv
    ? {
        si: siMinRaw !== null ? snapToBreakpoint(siMinRaw, SI_BREAKPOINTS) : inv.si,
        furn: furnMinRaw !== null ? snapToBreakpoint(furnMinRaw, FURN_BREAKPOINTS) : inv.furn,
        eng: engMinRaw !== null ? snapToBreakpoint(engMinRaw, ENG_BREAKPOINTS) : inv.eng,
      }
    : null;

  const ascRaw = weightedQuantile(bucket.asc, 0.6);
  const rawAsc = ascRaw !== null ? ASCENSION_RANKS[Math.round(ascRaw)] ?? null : null;
  const ascension = clampAscensionForInvestment(rawAsc, inv);

  return {
    ascension,
    inv,
    minViableInv,
    source,
    sampleCount: bucket.count,
  };
}

export class HeroInvestmentModel {
  private readonly byComp = new Map<string, InvestmentBucket>();
  private readonly byMode = new Map<string, InvestmentBucket>();
  private readonly byGlobal = new Map<number, InvestmentBucket>();

  addObservation(
    modeSlug: string,
    target: string,
    slotKey: string,
    compHeroSig: string,
    pick: HeroPick,
    weight: number,
  ): void {
    const compKey = `${modeSlug}|${target}|${slotKey}|${compHeroSig}|${pick.hid}`;
    const modeKey = `${modeSlug}|${pick.hid}`;

    let compBucket = this.byComp.get(compKey);
    if (!compBucket) {
      compBucket = createBucket();
      this.byComp.set(compKey, compBucket);
    }
    addPickToBucket(compBucket, pick, weight);

    let modeBucket = this.byMode.get(modeKey);
    if (!modeBucket) {
      modeBucket = createBucket();
      this.byMode.set(modeKey, modeBucket);
    }
    addPickToBucket(modeBucket, pick, weight);

    let globalBucket = this.byGlobal.get(pick.hid);
    if (!globalBucket) {
      globalBucket = createBucket();
      this.byGlobal.set(pick.hid, globalBucket);
    }
    addPickToBucket(globalBucket, pick, weight);
  }

  resolve(
    modeSlug: string,
    target: string,
    slotKey: string,
    compHeroSig: string,
    heroId: number,
  ): HeroInvestmentTarget {
    const compKey = `${modeSlug}|${target}|${slotKey}|${compHeroSig}|${heroId}`;
    const fromComp = summarizeBucket(this.byComp.get(compKey), 'comp');
    if (fromComp?.inv) return fromComp;

    const modeKey = `${modeSlug}|${heroId}`;
    const fromMode = summarizeBucket(this.byMode.get(modeKey), 'mode');
    if (fromMode?.inv) return fromMode;

    const fromGlobal = summarizeBucket(this.byGlobal.get(heroId), 'global');
    if (fromGlobal?.inv) return fromGlobal;

    return fromComp ?? fromMode ?? fromGlobal ?? {
      ascension: null,
      inv: null,
      minViableInv: null,
      source: 'none',
      sampleCount: 0,
    };
  }

  resolveForHero(heroId: number, modeSlug?: string): HeroInvestmentTarget {
    const fromMode = modeSlug ? summarizeBucket(this.byMode.get(`${modeSlug}|${heroId}`), 'mode') : null;
    if (fromMode?.inv) return fromMode;

    const fromGlobal = summarizeBucket(this.byGlobal.get(heroId), 'global');
    if (fromGlobal?.inv) return fromGlobal;

    return fromMode ?? fromGlobal ?? {
      ascension: null,
      inv: null,
      minViableInv: null,
      source: 'none',
      sampleCount: 0,
    };
  }
}

export function computeSubmissionWeight(
  submission: Submission,
  formation: Formation,
  maxUpvotes: number,
  bestNcTime: number | null,
  maxDamage: number | null,
): number {
  const recency = Math.pow(0.5, Math.max(0, submission.days) / RECENCY_HALF_LIFE_DAYS);
  const upvoteScore = maxUpvotes > 0
    ? Math.log1p(Math.max(0, submission.up)) / Math.log1p(maxUpvotes)
    : 0.5;

  let perfScore = 0.5;
  if (submission.mode === 'nightmare-corridor' && formation.timeSeconds && bestNcTime) {
    perfScore = Math.min(1, bestNcTime / formation.timeSeconds);
  } else if (submission.mode === 'cursed-realm') {
    const dmg = formation.damage ?? (typeof submission.result['damage'] === 'number' ? submission.result['damage'] : null);
    if (dmg && maxDamage) perfScore = Math.min(1, dmg / maxDamage);
  } else if (submission.mode === 'treasure-scramble') {
    const placementType = submission.result['placementType'];
    const placementValue = Number(submission.result['placementValue']);
    if (Number.isFinite(placementValue) && placementValue > 0) {
      perfScore = placementType === 'rank'
        ? Math.max(0, 1 - (placementValue - 1) / 99)
        : Math.max(0, 1 - placementValue / 100);
    }
  }

  const base = 0.12 + 0.88 * (0.55 * upvoteScore + 0.45 * perfScore);
  return Math.max(0.01, base * recency);
}

interface CollectionObservation {
  readonly snapshot: CollectionSnapshot;
  readonly weight: number;
}

export class HeroCollectionModel {
  private readonly byMode = new Map<string, CollectionObservation[]>();
  private readonly byGlobal = new Map<number, CollectionObservation[]>();

  addObservation(modeSlug: string, heroId: number, snapshot: CollectionSnapshot, weight: number): void {
    const modeKey = `${modeSlug}|${heroId}`;
    let modeList = this.byMode.get(modeKey);
    if (!modeList) {
      modeList = [];
      this.byMode.set(modeKey, modeList);
    }
    modeList.push({ snapshot, weight });

    let globalList = this.byGlobal.get(heroId);
    if (!globalList) {
      globalList = [];
      this.byGlobal.set(heroId, globalList);
    }
    globalList.push({ snapshot, weight });
  }

  resolve(
    modeSlug: string,
    heroId: number,
    catalog: readonly CollectionCatalogItem[],
  ): CollectionSnapshot | null {
    const fromMode = this.byMode.get(`${modeSlug}|${heroId}`);
    if (fromMode && fromMode.length > 0) {
      return synthesizeConsensusCollection(fromMode, catalog);
    }
    const fromGlobal = this.byGlobal.get(heroId);
    if (fromGlobal && fromGlobal.length > 0) {
      return synthesizeConsensusCollection(fromGlobal, catalog);
    }
    return null;
  }
}

export function buildCollectionModel(submissions: readonly Submission[]): HeroCollectionModel {
  const model = new HeroCollectionModel();
  const maxUpvotesByTarget = new Map<string, number>();

  for (const sub of submissions) {
    const tKey = `${sub.mode}|${sub.target}`;
    maxUpvotesByTarget.set(tKey, Math.max(maxUpvotesByTarget.get(tKey) ?? 0, sub.up));
  }

  for (const sub of submissions) {
    const tKey = `${sub.mode}|${sub.target}`;
    const maxUp = maxUpvotesByTarget.get(tKey) ?? 0;
    const allForms = [...sub.forms, ...(sub.substituteForms ?? [])];
    for (const form of allForms) {
      if (form.heroes.length === 0) continue;
      const weight = computeSubmissionWeight(sub, form, maxUp, null, null) * (form.isSubstitute ? 0.7 : 1.0);
      for (const pick of form.heroes) {
        if (!pick.collection) continue;
        // Prefer observations that include mythic/recommended stat nodes over bare shells.
        const hasStats = desiredStatsFromSnapshot(pick.collection).length > 0;
        model.addObservation(sub.mode, pick.hid, pick.collection, weight * (hasStats ? 1.0 : 0.45));
      }
    }
  }

  return model;
}

export function buildInvestmentModel(submissions: readonly Submission[]): HeroInvestmentModel {
  const model = new HeroInvestmentModel();

  const maxUpvotesByTarget = new Map<string, number>();
  const bestTimeBySlot = new Map<string, number>();
  const maxDamageBySlot = new Map<string, number>();

  for (const sub of submissions) {
    const tKey = `${sub.mode}|${sub.target}`;
    maxUpvotesByTarget.set(tKey, Math.max(maxUpvotesByTarget.get(tKey) ?? 0, sub.up));
    const allForms = [...sub.forms, ...(sub.substituteForms ?? [])];
    for (const form of allForms) {
      const slotKey = form.parentSlotKey ?? form.key;
      const sKey = `${tKey}|${slotKey}`;
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

  for (const sub of submissions) {
    const tKey = `${sub.mode}|${sub.target}`;
    const maxUp = maxUpvotesByTarget.get(tKey) ?? 0;
    const allForms = [...sub.forms, ...(sub.substituteForms ?? [])];
    for (const form of allForms) {
      if (form.heroes.length === 0) continue;
      const slotKey = form.parentSlotKey ?? form.key;
      const sKey = `${tKey}|${slotKey}`;
      const compSig = [...form.heroes].map((h) => h.hid).sort((a, b) => a - b).join(',');
      const weight = computeSubmissionWeight(
        sub,
        form,
        maxUp,
        bestTimeBySlot.get(sKey) ?? null,
        maxDamageBySlot.get(sKey) ?? null,
      ) * (form.isSubstitute ? 0.7 : 1.0);
      for (const pick of form.heroes) {
        if (pick.merc && !hasRecordedInvestment(pick)) continue;
        model.addObservation(sub.mode, sub.target, slotKey, compSig, pick, weight);
      }
    }
  }

  return model;
}

function synthesizeConsensusCollection(
  observations: readonly { readonly snapshot: CollectionSnapshot; readonly weight: number }[],
  catalog: readonly CollectionCatalogItem[],
): CollectionSnapshot | null {
  if (observations.length === 0) return null;

  const weightByCatalog = new Map<string, {
    weight: number;
    catalogId?: number;
    name: string;
    class?: CollectionCatalogItem['class'];
    levels: WeightedSample[];
    statWeights: Map<string, number>;
  }>();

  for (const obs of observations) {
    const resolved = resolveCatalogItem(catalog, obs.snapshot.catalogId, obs.snapshot.name);
    const catalogId = obs.snapshot.catalogId ?? resolved?.id;
    const key = catalogId !== undefined ? `id:${catalogId}` : `name:${obs.snapshot.name.toLowerCase()}`;
    let entry = weightByCatalog.get(key);
    if (!entry) {
      entry = {
        weight: 0,
        catalogId,
        name: resolved?.name ?? obs.snapshot.name,
        class: obs.snapshot.class ?? resolved?.class,
        levels: [],
        statWeights: new Map<string, number>(),
      };
      weightByCatalog.set(key, entry);
    }
    entry.weight += obs.weight;
    entry.levels.push({ value: targetLevelFromSnapshot(obs.snapshot), weight: obs.weight });
    for (const stat of desiredStatsFromSnapshot(obs.snapshot)) {
      entry.statWeights.set(stat, (entry.statWeights.get(stat) ?? 0) + obs.weight);
    }
  }

  let bestEntry: ReturnType<typeof weightByCatalog.get> | undefined;
  for (const entry of weightByCatalog.values()) {
    if (!bestEntry || entry.weight > bestEntry.weight) {
      bestEntry = entry;
    }
  }
  if (!bestEntry) return null;

  const consensusLevel = Math.min(3, Math.max(1, Math.round(weightedQuantile(bestEntry.levels, 0.6) ?? 1)));
  const rankedStats = [...bestEntry.statWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([stat]) => stat as CollectionNodeStat);

  const attackStats = rankedStats.filter((s) => ATTACK_STAT_SET.has(s)).slice(0, 3);
  const defenseStats = rankedStats.filter((s) => DEFENSE_STAT_SET.has(s)).slice(0, 3);

  return {
    catalogId: bestEntry.catalogId,
    name: bestEntry.name,
    class: bestEntry.class,
    nodes: [],
    recommendation: {
      level: consensusLevel,
      attackStats,
      defenseStats,
    },
  };
}

/**
 * Aggregates raw formations for a given (mode, target, slot) into modeled comps
 * grouped by (canonical hero set + petId), with consensus investments, pets, and collections.
 */
export function buildModeledCompsForSlot(
  mode: ModeConfig,
  target: string,
  slotKey: string,
  slotLabel: string,
  entries: readonly { readonly submission: Submission; readonly formation: Formation }[],
  investmentModel: HeroInvestmentModel,
  heroById: ReadonlyMap<number, Hero>,
  collectionCatalog: readonly CollectionCatalogItem[],
  petById: ReadonlyMap<number, Pet>,
  collectionModel?: HeroCollectionModel,
): ModeledComp[] {
  if (entries.length === 0) return [];

  let maxUpvotes = 0;
  let bestTime: number | null = null;
  let maxDamage: number | null = null;

  for (const { submission, formation } of entries) {
    if (submission.up > maxUpvotes) maxUpvotes = submission.up;
    if (mode.slug === 'nightmare-corridor' && formation.timeSeconds && formation.timeSeconds > 0) {
      if (bestTime === null || formation.timeSeconds < bestTime) bestTime = formation.timeSeconds;
    }
    const dmg = formation.damage ?? (typeof submission.result['damage'] === 'number' ? submission.result['damage'] : null);
    if (dmg && dmg > 0 && (maxDamage === null || dmg > maxDamage)) maxDamage = dmg;
  }

  interface CompAccumulator {
    compHeroSig: string;
    petId: number | null;
    items: { submission: Submission; formation: Formation; weight: number; hasInv: boolean }[];
  }

  const groups = new Map<string, CompAccumulator>();

  for (const { submission, formation } of entries) {
    if (formation.heroes.length === 0) continue;
    const compHeroSig = [...formation.heroes].map((h) => h.hid).sort((a, b) => a - b).join(',');
    const groupKey = `${compHeroSig}|p:${formation.petId ?? 'none'}`;
    const weight = computeSubmissionWeight(submission, formation, maxUpvotes, bestTime, maxDamage);
    const invCount = formation.heroes.filter((h) => hasRecordedInvestment(h)).length;
    const hasInv = invCount >= Math.ceil(formation.heroes.length * 0.6);

    let acc = groups.get(groupKey);
    if (!acc) {
      acc = { compHeroSig, petId: formation.petId, items: [] };
      groups.set(groupKey, acc);
    }
    acc.items.push({ submission, formation, weight, hasInv });
  }

  const modeled: ModeledComp[] = [];

  for (const [groupKey, acc] of groups.entries()) {
    // Pick representative formation (preferring investment-complete, high-weight entries).
    const sortedItems = [...acc.items].sort((a, b) => {
      const scoreA = a.weight * (a.hasInv ? 1.25 : 0.9);
      const scoreB = b.weight * (b.hasInv ? 1.25 : 0.9);
      return scoreB - scoreA;
    });
    const rep = sortedItems[0];

    let totalWeight = 0;
    let timeWeightedSum = 0;
    let timeWeight = 0;
    let dmgWeightedSum = 0;
    let dmgWeight = 0;
    let invCoverageWeighted = 0;
    let colCoverageWeighted = 0;
    const petLevelSamples: WeightedSample[] = [];
    const spVotes = new Map<number, number>();
    const collectionsByHero = new Map<number, { snapshot: CollectionSnapshot; weight: number }[]>();
    const subIds = new Set<number>();

    for (const item of acc.items) {
      totalWeight += item.weight;
      subIds.add(item.submission.id);
      if (item.hasInv) invCoverageWeighted += item.weight;
      const colCount = item.formation.heroes.filter((h) => Boolean(h.collection)).length;
      colCoverageWeighted += item.weight * (colCount / Math.max(1, item.formation.heroes.length));

      if (item.formation.timeSeconds && item.formation.timeSeconds > 0) {
        timeWeightedSum += item.formation.timeSeconds * item.weight;
        timeWeight += item.weight;
      }
      const dmg = item.formation.damage ?? (typeof item.submission.result['damage'] === 'number' ? item.submission.result['damage'] : null);
      if (dmg && dmg > 0) {
        dmgWeightedSum += dmg * item.weight;
        dmgWeight += item.weight;
      }
      if (item.formation.petLevel !== null) {
        petLevelSamples.push({ value: item.formation.petLevel, weight: item.weight });
      }
      if (item.formation.spHeroId) {
        spVotes.set(item.formation.spHeroId, (spVotes.get(item.formation.spHeroId) ?? 0) + item.weight);
      }
      for (const pick of item.formation.heroes) {
        if (pick.collection) {
          let list = collectionsByHero.get(pick.hid);
          if (!list) {
            list = [];
            collectionsByHero.set(pick.hid, list);
          }
          list.push({ snapshot: pick.collection, weight: item.weight });
        }
      }
    }

    let spHeroId: number | null = rep.formation.spHeroId ?? null;
    let bestSpWeight = 0;
    for (const [hid, w] of spVotes.entries()) {
      if (w > bestSpWeight) {
        bestSpWeight = w;
        spHeroId = hid;
      }
    }

    const consensusPetLvlRaw = weightedQuantile(petLevelSamples, 0.6);
    const consensusPetLevel = consensusPetLvlRaw !== null
      ? snapToBreakpoint(consensusPetLvlRaw, PET_BREAKPOINTS)
      : rep.formation.petLevel;

    const petMeta = acc.petId !== null ? petById.get(acc.petId) : undefined;

    const heroes: ModeledCompHero[] = rep.formation.heroes.map((pick, idx) => {
      const meta = heroById.get(pick.hid);
      const targetInv = investmentModel.resolve(mode.slug, target, slotKey, acc.compHeroSig, pick.hid);
      const consensusCol = synthesizeConsensusCollection(
        collectionsByHero.get(pick.hid) ?? [],
        collectionCatalog,
      ) ?? pick.collection ?? collectionModel?.resolve(mode.slug, pick.hid, collectionCatalog) ?? null;

      return {
        pos: idx,
        hid: pick.hid,
        name: pick.name ?? meta?.name ?? `Hero #${pick.hid}`,
        iconUrl: pick.iconUrl ?? meta?.iconUrl,
        faction: pick.faction ?? meta?.faction ?? null,
        target: targetInv,
        collection: consensusCol,
      };
    });

    modeled.push({
      compKey: groupKey,
      slotKey,
      slotLabel,
      modeSlug: mode.slug,
      target,
      heroes,
      heroIds: heroes.map((h) => h.hid),
      petId: acc.petId,
      beast: petMeta?.name ?? rep.formation.beast,
      petIconUrl: rep.formation.petIconUrl ?? petMeta?.iconUrl ?? null,
      petLevel: consensusPetLevel,
      spHeroId,
      avgTimeSeconds: timeWeight > 0 ? Math.round((timeWeightedSum / timeWeight) * 10) / 10 : null,
      avgDamage: dmgWeight > 0 ? dmgWeightedSum / dmgWeight : null,
      evidenceWeight: totalWeight,
      submissionCount: subIds.size,
      investmentCoverage: totalWeight > 0 ? invCoverageWeighted / totalWeight : 0,
      collectionCoverage: totalWeight > 0 ? colCoverageWeighted / totalWeight : 0,
      representativeSubmission: rep.submission,
      representativeFormation: rep.formation,
      sourceSubmissionIds: [...subIds],
    });
  }

  return modeled;
}

/**
 * Evaluates a user's owned hero against a modeled consensus investment target,
 * weighting major AFK Arena breakpoints (SI20/30/40, 3F/9F, E30/E60) more heavily than minor stat differences.
 */
export function evaluateHeroAgainstTarget(
  heroId: number,
  target: HeroInvestmentTarget,
  roster: Readonly<Record<string, RosterEntry>>,
): InvestmentGapDetail {
  const owned = roster[heroId];
  if (!owned) {
    return {
      status: 'missing',
      belowMinViable: true,
      penalty: 100,
      missingMajorBreakpoints: ['Not owned'],
    };
  }

  const haveInv = rosterInvestment(owned);
  const missingMajor: string[] = [];
  let penalty = 0;
  let belowMinViable = false;

  if (target.ascension && owned.ascension && !isAscensionAtLeast(owned.ascension, target.ascension)) {
    const ownedIdx = ASCENSION_RANKS.indexOf(owned.ascension);
    const needIdx = ASCENSION_RANKS.indexOf(target.ascension);
    if (ownedIdx >= 0 && needIdx > ownedIdx) {
      penalty += (needIdx - ownedIdx) * 10;
      if (needIdx >= ASCENSION_RANKS.indexOf('ascended') && ownedIdx < ASCENSION_RANKS.indexOf('ascended')) {
        missingMajor.push('Ascended');
        belowMinViable = true;
      }
    }
  }

  if (haveInv && target.inv) {
    const need = target.inv;
    const minV = target.minViableInv;

    if (need.si !== null && haveInv.si !== null && haveInv.si < need.si) {
      const diff = need.si - haveInv.si;
      penalty += diff * 1.0;
      if (need.si >= 40 && haveInv.si < 40) { penalty += 18; missingMajor.push('SI40'); }
      else if (need.si >= 30 && haveInv.si < 30) { penalty += 24; missingMajor.push('SI30'); }
      else if (need.si >= 20 && haveInv.si < 20) { penalty += 16; missingMajor.push('SI20'); }
      if (minV?.si !== null && minV?.si !== undefined && haveInv.si < minV.si) belowMinViable = true;
    }

    if (need.furn !== null && haveInv.furn !== null && haveInv.furn < need.furn) {
      const diff = need.furn - haveInv.furn;
      penalty += diff * 3.0;
      if (need.furn >= 9 && haveInv.furn < 9) { penalty += 22; missingMajor.push('9F'); }
      else if (need.furn >= 3 && haveInv.furn < 3) { penalty += 14; missingMajor.push('3F'); }
      if (minV?.furn !== null && minV?.furn !== undefined && haveInv.furn < minV.furn) belowMinViable = true;
    }

    if (need.eng !== null && haveInv.eng !== null && haveInv.eng < need.eng) {
      const diff = need.eng - haveInv.eng;
      penalty += diff * 0.55;
      if (need.eng >= 60 && haveInv.eng < 60) { penalty += 24; missingMajor.push('E60'); }
      else if (need.eng >= 30 && haveInv.eng < 30) { penalty += 16; missingMajor.push('E30'); }
      if (minV?.eng !== null && minV?.eng !== undefined && haveInv.eng < minV.eng) belowMinViable = true;
    }
  }

  return {
    status: penalty > 0 ? 'under' : 'ok',
    belowMinViable,
    penalty,
    missingMajorBreakpoints: missingMajor,
  };
}
