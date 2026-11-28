import {
  CollectionCatalogItem,
  CollectionInventoryItem,
  Formation,
  Hero,
  HeroPick,
  HeroStatus,
  Investment,
  ModeConfig,
  Pet,
  PetRosterEntry,
  RosterEntry,
  Submission,
} from '../models';
import {
  assignCollectionsToLineup,
  CollectionAssignmentRequest,
  CollectionAssignmentResult,
  estimateFormationCollectionFit,
  normalizeHeroClass,
} from './collection-matcher';
import {
  buildCollectionModel,
  buildInvestmentModel,
  buildModeledCompsForSlot,
  evaluateHeroAgainstTarget,
  HeroInvestmentTarget,
  InvestmentGapDetail,
  ModeledComp,
  ModeledCompHero,
} from './meta-model';

export const RECOMMENDED_LINEUP_MODE_SLUGS = [
  'nightmare-corridor',
  'cursed-realm',
  'treasure-scramble',
  'temporal-rift',
  'hunting-fields-contract',
  'abyssal-expedition',
] as const;

export type RecommendedLineupModeSlug = (typeof RECOMMENDED_LINEUP_MODE_SLUGS)[number];

export interface LineupRecommenderInput {
  readonly mode: ModeConfig;
  readonly target: string;
  readonly teamCount?: number;
  readonly strictInvestment: boolean;
  readonly allowMerc: boolean;
  readonly excludedMercHeroIds?: readonly number[];
  readonly excludedCompKeys?: readonly string[];
  readonly submissions: readonly Submission[];
  readonly roster: Readonly<Record<string, RosterEntry>>;
  readonly petRoster: Readonly<Record<string, PetRosterEntry>>;
  readonly collections: readonly CollectionInventoryItem[];
  readonly collectionCatalog: readonly CollectionCatalogItem[];
  readonly heroes: readonly Hero[];
  readonly pets?: readonly Pet[];
}

export interface SuggestedHeroSubstitute {
  readonly heroId: number;
  readonly heroName: string;
  readonly overlapCount: number;
  readonly reason: string;
}

export interface RecommendedHeroSlot {
  readonly pick: HeroPick;
  readonly status: HeroStatus | 'merc';
  readonly isMerc: boolean;
  readonly ownedEntry: RosterEntry | null;
  readonly investmentTarget: HeroInvestmentTarget;
  readonly missingBreakpoints: readonly string[];
  readonly belowMinViable: boolean;
  readonly suggestedSubstitutes: readonly SuggestedHeroSubstitute[];
  readonly collectionAssignment: CollectionAssignmentResult;
}

export interface RecommendedTeam {
  readonly compKey: string;
  readonly slotKey: string;
  readonly slotLabel: string;
  readonly formation: Formation;
  readonly sourceSubmission: Submission;
  readonly sourceSubmissionIds: readonly number[];
  readonly sourceCount: number;
  readonly investmentCoverage: number;
  readonly heroes: readonly RecommendedHeroSlot[];
  readonly mercHeroId: number | null;
  readonly missingHeroIds: readonly number[];
  readonly underHeroIds: readonly number[];
  readonly missingPet: boolean;
  readonly underPetLevel: boolean;
  readonly ownedPetLevel: number | null;
  readonly runnable: boolean;
  readonly score: number;
}

export interface RecommendedMercenary {
  readonly heroId: number;
  readonly heroName: string;
  readonly slotLabel: string;
  readonly reason: 'missing' | 'under-invested';
}

export interface CollectionCoverageSummary {
  readonly requested: number;
  readonly exact: number;
  readonly close: number;
  readonly fallback: number;
  readonly missing: number;
}

export interface LineupRecommendationResult {
  readonly modeSlug: string;
  readonly target: string;
  readonly expectedTeamCount: number;
  readonly teams: readonly RecommendedTeam[];
  readonly emptySlots: readonly { readonly key: string; readonly label: string }[];
  readonly readyTeamCount: number;
  readonly merc: RecommendedMercenary | null;
  readonly collectionSummary: CollectionCoverageSummary;
  readonly missingHeroCount: number;
  readonly underHeroCount: number;
  readonly missingPetCount: number;
  readonly underPetCount: number;
  readonly totalNcTimeSeconds: number | null;
  readonly candidateSubmissionCount: number;
}

interface CompCandidate {
  readonly id: string;
  readonly slotKey: string;
  readonly slotLabel: string;
  readonly comp: ModeledComp;
  readonly heroIds: readonly number[];
  readonly heroGaps: readonly InvestmentGapDetail[];
  readonly petId: number | null;
  readonly missingPet: boolean;
  readonly underPetLevel: boolean;
  readonly ownedPetLevel: number | null;
  readonly mercHeroId: number | null;
  readonly mercReason: 'missing' | 'under-invested' | null;
  readonly missingCount: number;
  readonly underCount: number;
  readonly runnable: boolean;
  readonly score: number;
}

const MAX_CANDIDATES_PER_SLOT = 24;
const MAX_TS_CANDIDATES = 96;
const SEARCH_NODE_BUDGET = 120_000;

function computeCompPerformanceScore(modeSlug: string, comp: ModeledComp): number {
  let score = 0;

  // Evidence weight + multi-submission consensus confidence.
  score += Math.log1p(comp.evidenceWeight) * 26;
  score += Math.log1p(comp.submissionCount) * 20;

  // Prefer comps backed by submissions that recorded hero investments and collections.
  score += comp.investmentCoverage * 28;
  score += comp.collectionCoverage * 24;

  // Prefer full 5-hero comps over partial ones.
  score += comp.heroes.length * 10;

  if (modeSlug === 'nightmare-corridor' && comp.avgTimeSeconds && comp.avgTimeSeconds > 0) {
    score += Math.max(0, 65 - comp.avgTimeSeconds);
  } else if (modeSlug === 'cursed-realm' && comp.avgDamage && comp.avgDamage > 0) {
    score += Math.min(48, Math.log10(comp.avgDamage) * 3.8);
  }

  return score;
}

function buildCandidatesForComp(
  modeSlug: string,
  comp: ModeledComp,
  roster: Readonly<Record<string, RosterEntry>>,
  petRoster: Readonly<Record<string, PetRosterEntry>>,
  collections: readonly CollectionInventoryItem[],
  collectionCatalog: readonly CollectionCatalogItem[],
  heroById: ReadonlyMap<number, Hero>,
  strictInvestment: boolean,
  canUseMerc: boolean,
  excludedMercSet: ReadonlySet<number>,
): CompCandidate[] {
  const heroGaps = comp.heroes.map((hero) =>
    evaluateHeroAgainstTarget(hero.hid, hero.target, roster),
  );

  const ownedPet = comp.petId === null ? undefined : petRoster[comp.petId];
  const missingPet = comp.petId !== null && !ownedPet;
  const underPetLevel = Boolean(
    ownedPet && comp.petLevel !== null && ownedPet.level < comp.petLevel,
  );
  const petLevelDeficit = underPetLevel && ownedPet && comp.petLevel !== null
    ? comp.petLevel - ownedPet.level
    : 0;
  // Missing the Lv.18 pet skill breakpoint hurts much more than post-18 stat scaling.
  const missedPet18Breakpoint = Boolean(
    underPetLevel && ownedPet && comp.petLevel !== null && comp.petLevel >= 18 && ownedPet.level < 18,
  );

  const perfScore = computeCompPerformanceScore(modeSlug, comp);
  const collectionFitBonus = estimateFormationCollectionFit(
    comp.heroes.map((h) => ({ hid: h.hid, collection: h.collection })),
    heroById,
    collections,
    collectionCatalog,
  ) * 34;

  const makeCandidate = (
    mercHeroId: number | null,
    mercReason: 'missing' | 'under-invested' | null,
  ): CompCandidate => {
    let missingCount = 0;
    let underCount = 0;
    let belowMinViableCount = 0;
    let totalPenalty = 0;

    comp.heroes.forEach((hero, idx) => {
      if (hero.hid === mercHeroId) return;
      const gap = heroGaps[idx];
      if (gap.status === 'missing') {
        missingCount += 1;
      } else if (gap.status === 'under') {
        underCount += 1;
        if (gap.belowMinViable) belowMinViableCount += 1;
        totalPenalty += gap.penalty;
      }
    });

    const runnable = missingCount === 0
      && !missingPet
      && (!strictInvestment || (underCount === 0 && !underPetLevel));

    let score = 10_000 + perfScore + collectionFitBonus;
    score -= missingCount * 2_400;
    if (missingPet) score -= 950;

    if (strictInvestment) {
      score -= underCount * 1_650 + totalPenalty * 4;
      if (underPetLevel) {
        score -= (missedPet18Breakpoint ? 800 : 420) + petLevelDeficit * 14;
      }
    } else {
      score -= belowMinViableCount * 190 + underCount * 75 + Math.min(340, totalPenalty * 2.4);
      if (underPetLevel) {
        score -= (missedPet18Breakpoint ? 220 : 60) + petLevelDeficit * 6;
      }
    }

    if (mercHeroId !== null) {
      score -= 4;
    }

    return {
      id: `${comp.compKey}:${comp.slotKey}:${mercHeroId ?? 'none'}`,
      slotKey: comp.slotKey,
      slotLabel: comp.slotLabel,
      comp,
      heroIds: comp.heroIds,
      heroGaps,
      petId: comp.petId,
      missingPet,
      underPetLevel,
      ownedPetLevel: ownedPet?.level ?? null,
      mercHeroId,
      mercReason,
      missingCount,
      underCount,
      runnable,
      score,
    };
  };

  const results: CompCandidate[] = [makeCandidate(null, null)];

  if (canUseMerc) {
    const missingIndices = heroGaps
      .map((g, idx) => ({ g, idx }))
      .filter(({ g }) => g.status === 'missing');
    if (missingIndices.length === 1) {
      const hid = comp.heroes[missingIndices[0].idx].hid;
      if (!excludedMercSet.has(hid)) {
        results.push(makeCandidate(hid, 'missing'));
      }
    } else if (missingIndices.length === 0) {
      const worstUnder = heroGaps
        .map((g, idx) => ({ g, idx }))
        .filter(({ g, idx }) => g.status === 'under' && !excludedMercSet.has(comp.heroes[idx].hid))
        .sort((a, b) => b.g.penalty - a.g.penalty)[0];
      if (worstUnder) {
        results.push(makeCandidate(comp.heroes[worstUnder.idx].hid, 'under-invested'));
      }
    }
  }

  return results;
}

function pruneCandidates(candidates: readonly CompCandidate[], limit: number): CompCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  if (sorted.length <= limit) return sorted;

  const noMerc = sorted.filter((c) => c.mercHeroId === null);
  const withMerc = sorted.filter((c) => c.mercHeroId !== null);
  const nonMercQuota = Math.ceil(limit * 0.7);
  const selected = [
    ...noMerc.slice(0, nonMercQuota),
    ...withMerc.slice(0, limit - Math.min(noMerc.length, nonMercQuota)),
  ];
  if (selected.length < limit) {
    const ids = new Set(selected.map((c) => c.id));
    for (const c of sorted) {
      if (selected.length >= limit) break;
      if (!ids.has(c.id)) selected.push(c);
    }
  }
  return selected.sort((a, b) => b.score - a.score);
}

function hasConflict(
  candidate: CompCandidate,
  usedHeroes: ReadonlySet<number>,
  usedPets: ReadonlySet<number>,
): boolean {
  if (candidate.petId !== null && usedPets.has(candidate.petId)) return true;
  for (const hid of candidate.heroIds) {
    if (usedHeroes.has(hid)) return true;
  }
  return false;
}

function solveNamedSlots(
  slotLists: readonly (readonly CompCandidate[])[],
  maxMercs: number,
): (CompCandidate | null)[] {
  const numSlots = slotLists.length;
  if (numSlots === 0) return [];

  const order = slotLists
    .map((list, idx) => ({ idx, len: list.length }))
    .sort((a, b) => a.len - b.len)
    .map((entry) => entry.idx);

  const orderedLists = order.map((idx) => slotLists[idx]);
  const maxSlotScores = orderedLists.map((list) => (list.length > 0 ? Math.max(0, list[0].score) : 0));
  const suffixMax = new Array<number>(numSlots + 1).fill(0);
  for (let i = numSlots - 1; i >= 0; i--) {
    suffixMax[i] = suffixMax[i + 1] + maxSlotScores[i];
  }

  let bestScore = -Infinity;
  let bestPickedCount = -1;
  let bestChoice: (CompCandidate | null)[] = new Array(numSlots).fill(null);

  const currentChoice: (CompCandidate | null)[] = new Array(numSlots).fill(null);
  const usedHeroes = new Set<number>();
  const usedPets = new Set<number>();
  let visitedNodes = 0;

  const dfs = (depth: number, mercsUsed: number, scoreSoFar: number, pickedCount: number): void => {
    if (visitedNodes >= SEARCH_NODE_BUDGET) return;
    visitedNodes += 1;

    if (depth === numSlots) {
      if (
        pickedCount > bestPickedCount
        || (pickedCount === bestPickedCount && scoreSoFar > bestScore)
      ) {
        bestPickedCount = pickedCount;
        bestScore = scoreSoFar;
        bestChoice = [...currentChoice];
      }
      return;
    }

    const remainingSlots = numSlots - depth;
    if (pickedCount + remainingSlots < bestPickedCount) return;
    if (pickedCount + remainingSlots === bestPickedCount && scoreSoFar + suffixMax[depth] <= bestScore) {
      return;
    }

    const candidates = orderedLists[depth];
    let triedAny = false;

    for (const candidate of candidates) {
      const nextMercs = mercsUsed + (candidate.mercHeroId !== null ? 1 : 0);
      if (nextMercs > maxMercs) continue;
      if (hasConflict(candidate, usedHeroes, usedPets)) continue;

      triedAny = true;
      for (const hid of candidate.heroIds) usedHeroes.add(hid);
      if (candidate.petId !== null) usedPets.add(candidate.petId);
      currentChoice[depth] = candidate;

      dfs(depth + 1, nextMercs, scoreSoFar + candidate.score, pickedCount + 1);

      currentChoice[depth] = null;
      if (candidate.petId !== null) usedPets.delete(candidate.petId);
      for (const hid of candidate.heroIds) usedHeroes.delete(hid);
    }

    if (!triedAny || bestPickedCount < numSlots) {
      currentChoice[depth] = null;
      dfs(depth + 1, mercsUsed, scoreSoFar, pickedCount);
    }
  };

  dfs(0, 0, 0, 0);

  const restored: (CompCandidate | null)[] = new Array(numSlots).fill(null);
  order.forEach((origIdx, orderedIdx) => {
    restored[origIdx] = bestChoice[orderedIdx];
  });
  return restored;
}

function solveUnorderedTeams(
  candidates: readonly CompCandidate[],
  targetTeamCount: number,
  uniqueAcross = true,
  initialBest: readonly CompCandidate[] = [],
): CompCandidate[] {
  const n = candidates.length;
  if (n === 0 || targetTeamCount <= 0) return [];

  const limit = Math.min(targetTeamCount, n);
  if (!uniqueAcross) {
    // Modes like Abyssal Expedition allow heroes to repeat across competing compositions.
    return [...candidates].slice(0, limit);
  }
  let bestCount = initialBest.length;
  let bestScore = initialBest.length > 0
    ? initialBest.reduce((sum, c) => sum + c.score, 0)
    : -Infinity;
  let bestTeamList: CompCandidate[] = [...initialBest];

  const current: CompCandidate[] = [];
  const usedHeroes = new Set<number>();
  const usedPets = new Set<number>();
  let visitedNodes = 0;

  const prefix = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + Math.max(0, candidates[i].score);
  }

  const dfs = (startIdx: number, scoreSoFar: number): void => {
    if (visitedNodes >= SEARCH_NODE_BUDGET) return;
    visitedNodes += 1;

    if (
      current.length > bestCount
      || (current.length === bestCount && scoreSoFar > bestScore)
    ) {
      bestCount = current.length;
      bestScore = scoreSoFar;
      bestTeamList = [...current];
    }

    if (current.length === limit || startIdx >= n) return;

    const needed = limit - current.length;
    const available = n - startIdx;
    if (current.length + available < bestCount) return;

    const maxPossibleAddCount = Math.min(needed, available);
    const upperBound = prefix[startIdx + maxPossibleAddCount] - prefix[startIdx];
    if (current.length + maxPossibleAddCount === bestCount && scoreSoFar + upperBound <= bestScore) {
      return;
    }

    for (let i = startIdx; i < n; i++) {
      if (current.length + (n - i) < bestCount) break;
      const cand = candidates[i];
      if (hasConflict(cand, usedHeroes, usedPets)) continue;

      for (const hid of cand.heroIds) usedHeroes.add(hid);
      if (cand.petId !== null) usedPets.add(cand.petId);
      current.push(cand);

      dfs(i + 1, scoreSoFar + cand.score);

      current.pop();
      if (cand.petId !== null) usedPets.delete(cand.petId);
      for (const hid of cand.heroIds) usedHeroes.delete(hid);
    }
  };

  dfs(0, 0);
  return bestTeamList;
}

function buildSynthesizedFormation(comp: ModeledComp, mercHeroId: number | null): Formation {
  const heroes: HeroPick[] = comp.heroes.map((h: ModeledCompHero) => ({
    pos: h.pos,
    hid: h.hid,
    name: h.name,
    iconUrl: h.iconUrl,
    faction: h.faction,
    inv: h.target.inv,
    ascension: h.target.ascension,
    merc: h.hid === mercHeroId,
    collection: h.collection,
  }));

  return {
    key: comp.slotKey,
    label: comp.slotLabel,
    beast: comp.beast,
    petId: comp.petId,
    petIconUrl: comp.petIconUrl,
    petLevel: comp.petLevel,
    timeSeconds: comp.avgTimeSeconds,
    damage: comp.avgDamage,
    spHeroId: comp.spHeroId,
    notes: comp.representativeFormation.notes,
    heroes,
  };
}

export function recommendLineupForMode(input: LineupRecommenderInput): LineupRecommendationResult {
  const {
    mode,
    target,
    strictInvestment,
    allowMerc,
    submissions,
    roster,
    petRoster,
    collections,
    collectionCatalog,
    heroes,
    pets = [],
  } = input;

  const heroById = new Map<number, Hero>(heroes.map((h) => [h.id, h]));
  const petById = new Map<number, Pet>(pets.map((p) => [p.id, p]));

  // Build global hierarchical investment & collection models from ALL submissions so missing
  // investments or collections in any single submission are imputed from other lineups.
  const investmentModel = buildInvestmentModel(submissions);
  const collectionModel = buildCollectionModel(submissions);

  const matchingSubmissions = submissions.filter(
    (sub) => sub.mode === mode.slug && (!target || sub.target === target),
  );

  const maxMercs = allowMerc ? (mode.mercMax ?? 0) : 0;
  const canUseMerc = maxMercs > 0;
  const excludedMercSet = new Set<number>(input.excludedMercHeroIds ?? []);
  const excludedCompKeySet = new Set<string>(input.excludedCompKeys ?? []);

  let chosenCandidates: CompCandidate[] = [];
  const emptySlots: { key: string; label: string }[] = [];
  let expectedTeamCount = 0;

  const isVariableMode = Boolean(mode.variable);
  const uniqueAcross = mode.uniqueAcross !== false;

  if (isVariableMode) {
    const desiredCount = Math.max(
      mode.variable?.min ?? 1,
      Math.min(mode.variable?.max ?? 7, input.teamCount ?? mode.variable?.default ?? 5),
    );
    expectedTeamCount = desiredCount;

    const rawEntries: { submission: Submission; formation: Formation }[] = [];
    for (const sub of matchingSubmissions) {
      const allForms = [...sub.forms, ...(sub.substituteForms ?? [])];
      for (const formation of allForms) {
        if (formation.heroes.length > 0) {
          rawEntries.push({ submission: sub, formation });
        }
      }
    }

    const modeledComps = buildModeledCompsForSlot(
      mode,
      target,
      `${mode.slug}-pool`,
      'Team',
      rawEntries,
      investmentModel,
      heroById,
      collectionCatalog,
      petById,
      collectionModel,
    ).filter((comp) => !excludedCompKeySet.has(comp.compKey));

    const allCandidates = modeledComps.flatMap((comp) =>
      buildCandidatesForComp(
        mode.slug,
        comp,
        roster,
        petRoster,
        collections,
        collectionCatalog,
        heroById,
        strictInvestment,
        canUseMerc,
        excludedMercSet,
      ),
    );

    // Warm-start with the best complete submission that already has >= desiredCount disjoint teams,
    // so valid N-team sets are never missed due to pruning or search budget.
    let initialBest: CompCandidate[] = [];
    let initialBestScore = -Infinity;
    if (uniqueAcross) {
      const candByCompKey = new Map<string, CompCandidate>();
      for (const c of allCandidates) {
        if (c.mercHeroId !== null) continue;
        const prev = candByCompKey.get(c.comp.compKey);
        if (!prev || c.score > prev.score) candByCompKey.set(c.comp.compKey, c);
      }
      for (const sub of matchingSubmissions) {
        const subForms = sub.forms.filter((f) => f.heroes.length > 0);
        if (subForms.length < desiredCount) continue;
        const picked: CompCandidate[] = [];
        const usedH = new Set<number>();
        const usedP = new Set<number>();
        for (const f of subForms) {
          const heroSig = [...f.heroes].map((h) => h.hid).sort((a, b) => a - b).join(',');
          const key = `${heroSig}|p:${f.petId ?? 'none'}`;
          const cand = candByCompKey.get(key);
          if (!cand || hasConflict(cand, usedH, usedP)) continue;
          picked.push(cand);
          for (const hid of cand.heroIds) usedH.add(hid);
          if (cand.petId !== null) usedP.add(cand.petId);
          if (picked.length === desiredCount) break;
        }
        if (picked.length === desiredCount) {
          const total = picked.reduce((sum, c) => sum + c.score, 0);
          if (total > initialBestScore) {
            initialBestScore = total;
            initialBest = picked;
          }
        }
      }
    }

    // Ensure all candidates from the warm-start solution stay in the pruned pool.
    const prunedBase = pruneCandidates(allCandidates, MAX_TS_CANDIDATES);
    const prunedIds = new Set(prunedBase.map((c) => c.id));
    for (const c of initialBest) {
      if (!prunedIds.has(c.id)) prunedBase.push(c);
    }
    prunedBase.sort((a, b) => b.score - a.score);

    chosenCandidates = solveUnorderedTeams(prunedBase, desiredCount, uniqueAcross, initialBest).map((cand, index) => ({
      ...cand,
      slotKey: `team-${index + 1}`,
      slotLabel: `Team ${index + 1}`,
    }));

    for (let i = chosenCandidates.length; i < desiredCount; i++) {
      emptySlots.push({ key: `team-${i + 1}`, label: `Team ${i + 1}` });
    }
  } else {
    const slotDefs = mode.targetFormations?.[target] ?? mode.formations ?? [];
    expectedTeamCount = slotDefs.length;

    const perSlotCandidates = slotDefs.map((slotDef, slotIndex) => {
      const slotEntries: { submission: Submission; formation: Formation }[] = [];
      for (const sub of matchingSubmissions) {
        const primary = sub.forms.find((f) => f.key === slotDef.key)
          ?? sub.forms.find((f) => f.label.toLowerCase() === slotDef.label.toLowerCase())
          ?? (sub.forms.length === slotDefs.length ? sub.forms[slotIndex] : undefined);
        if (primary && primary.heroes.length > 0) {
          slotEntries.push({ submission: sub, formation: primary });
        }
        for (const subForm of sub.substituteForms ?? []) {
          if (subForm.heroes.length === 0) continue;
          const matchesSlot = subForm.parentSlotKey === slotDef.key
            || subForm.key === slotDef.key
            || subForm.label.toLowerCase() === slotDef.label.toLowerCase();
          if (matchesSlot) {
            slotEntries.push({ submission: sub, formation: subForm });
          }
        }
      }

      const modeledComps = buildModeledCompsForSlot(
        mode,
        target,
        slotDef.key,
        slotDef.label,
        slotEntries,
        investmentModel,
        heroById,
        collectionCatalog,
        petById,
        collectionModel,
      );
      const filteredComps = modeledComps.filter((c) => !excludedCompKeySet.has(`${slotDef.key}::${c.compKey}`));
      const compsToUse = filteredComps.length > 0 ? filteredComps : modeledComps;

      const candidates = compsToUse.flatMap((comp) =>
        buildCandidatesForComp(
          mode.slug,
          comp,
          roster,
          petRoster,
          collections,
          collectionCatalog,
          heroById,
          strictInvestment,
          canUseMerc,
          excludedMercSet,
        ),
      );
      return pruneCandidates(candidates, MAX_CANDIDATES_PER_SLOT);
    });

    const solved = solveNamedSlots(perSlotCandidates, maxMercs);
    solved.forEach((cand, idx) => {
      if (cand) {
        chosenCandidates.push(cand);
      } else {
        emptySlots.push({ key: slotDefs[idx].key, label: slotDefs[idx].label });
      }
    });
  }

  // Optimal unique collection inventory assignment across all chosen teams.
  const collectionRequests: CollectionAssignmentRequest[] = [];
  chosenCandidates.forEach((cand, teamIdx) => {
    cand.comp.heroes.forEach((hero, heroIdx) => {
      const heroMeta = heroById.get(hero.hid);
      collectionRequests.push({
        slotKey: `${teamIdx}:${heroIdx}`,
        heroId: hero.hid,
        heroClass: normalizeHeroClass(heroMeta?.class),
        target: hero.collection,
      });
    });
  });

  const collectionAssignments = assignCollectionsToLineup(
    collectionRequests,
    collections,
    collectionCatalog,
  );

  let merc: RecommendedMercenary | null = null;
  let missingHeroCount = 0;
  let underHeroCount = 0;
  let missingPetCount = 0;
  let underPetCount = 0;
  let readyTeamCount = 0;
  let ncTimeSum = 0;
  let allNcHaveTime = mode.slug === 'nightmare-corridor' && chosenCandidates.length > 0;

  const collectionSummary = {
    requested: 0,
    exact: 0,
    close: 0,
    fallback: 0,
    missing: 0,
  };

  // Precompute all hero IDs used across the chosen lineup (to avoid suggesting already-used heroes as subs).
  const usedInLineup = new Set<number>(chosenCandidates.flatMap((c) => c.heroIds));

  // Build pool of all formations for this mode (primary + substitute) for 4-core substitute inference.
  const modeFormations = submissions
    .filter((s) => s.mode === mode.slug)
    .flatMap((s) => [...s.forms, ...(s.substituteForms ?? [])].map((f) => ({ sub: s, form: f })))
    .filter(({ form }) => form.heroes.length >= 4);

  const inferSubstitutesForMissingHero = (
    teamHeroIds: readonly number[],
    missingHeroId: number,
    slotKey: string,
  ): readonly SuggestedHeroSubstitute[] => {
    const coreOthers = new Set(teamHeroIds.filter((id) => id !== missingHeroId));
    if (coreOthers.size < 3) return [];

    const scoreBySubHero = new Map<number, { score: number; bestOverlap: number }>();

    for (const { sub, form } of modeFormations) {
      const fIds = form.heroes.map((h) => h.hid);
      if (fIds.includes(missingHeroId)) continue;
      let overlap = 0;
      for (const id of fIds) {
        if (coreOthers.has(id)) overlap += 1;
      }
      if (overlap < 3) continue;

      const sameTargetBonus = sub.target === target ? 2.5 : 1.0;
      const sameSlotBonus = (form.parentSlotKey ?? form.key) === slotKey ? 2.0 : 1.0;
      const baseWeight = (overlap === 4 ? 10 : 3) * sameTargetBonus * sameSlotBonus * (1 + Math.log1p(Math.max(0, sub.up)));

      for (const candidateId of fIds) {
        if (coreOthers.has(candidateId)) continue;
        // Only suggest heroes the user owns and (when uniqueAcross) aren't already used in another team.
        if (!roster[candidateId]) continue;
        if (uniqueAcross && usedInLineup.has(candidateId)) continue;

        const prev = scoreBySubHero.get(candidateId);
        if (!prev) {
          scoreBySubHero.set(candidateId, { score: baseWeight, bestOverlap: overlap });
        } else {
          scoreBySubHero.set(candidateId, {
            score: prev.score + baseWeight,
            bestOverlap: Math.max(prev.bestOverlap, overlap),
          });
        }
      }
    }

    const fromCore = [...scoreBySubHero.entries()]
      .sort((a, b) => b[1].bestOverlap - a[1].bestOverlap || b[1].score - a[1].score)
      .slice(0, 2)
      .map(([heroId, info]) => ({
        heroId,
        heroName: heroById.get(heroId)?.name ?? `Hero #${heroId}`,
        overlapCount: info.bestOverlap,
        reason: `${info.bestOverlap}/4 core`,
      }));

    if (fromCore.length > 0) return fromCore;

    // Tier 2 fallback: owned, unused heroes of the same class used on this same boss/slot.
    const missingClass = heroById.get(missingHeroId)?.class ?? null;
    const bossSubScores = new Map<number, number>();
    for (const { sub, form } of modeFormations) {
      const matchesSlot = (form.parentSlotKey ?? form.key) === slotKey
        || (isVariableMode && sub.target === target);
      if (!matchesSlot) continue;
      const w = (sub.target === target ? 2 : 1) * (1 + Math.log1p(Math.max(0, sub.up)));
      for (const pick of form.heroes) {
        const cid = pick.hid;
        if (cid === missingHeroId || coreOthers.has(cid)) continue;
        if (!roster[cid]) continue;
        if (uniqueAcross && usedInLineup.has(cid)) continue;
        const candClass = heroById.get(cid)?.class ?? null;
        if (missingClass && candClass && candClass !== missingClass) continue;
        bossSubScores.set(cid, (bossSubScores.get(cid) ?? 0) + w);
      }
    }

    return [...bossSubScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([heroId]) => ({
        heroId,
        heroName: heroById.get(heroId)?.name ?? `Hero #${heroId}`,
        overlapCount: 0,
        reason: missingClass ? `same boss · ${missingClass}` : 'same boss',
      }));
  };

  const teams: RecommendedTeam[] = chosenCandidates.map((cand, teamIdx) => {
    const synthesizedFormation = buildSynthesizedFormation(cand.comp, cand.mercHeroId);

    const heroSlots: RecommendedHeroSlot[] = cand.comp.heroes.map((hero, heroIdx) => {
      const gap = cand.heroGaps[heroIdx];
      const isMerc = cand.mercHeroId === hero.hid;
      const status: HeroStatus | 'merc' = isMerc ? 'merc' : gap.status;
      if (isMerc) {
        merc = {
          heroId: hero.hid,
          heroName: hero.name,
          slotLabel: cand.slotLabel,
          reason: cand.mercReason ?? 'missing',
        };
      }
      const assignment = collectionAssignments.get(`${teamIdx}:${heroIdx}`) ?? {
        slotKey: `${teamIdx}:${heroIdx}`,
        status: 'none' as const,
        target: hero.collection,
        assigned: null,
        assignedLevel: null,
        targetLevel: null,
        matchedStats: [],
        score: 0,
      };
      if (assignment.status !== 'none') {
        collectionSummary.requested += 1;
        collectionSummary[assignment.status] += 1;
      }

      const suggestedSubstitutes = status === 'missing'
        ? inferSubstitutesForMissingHero(cand.heroIds, hero.hid, cand.slotKey)
        : [];

      return {
        pick: synthesizedFormation.heroes[heroIdx],
        status,
        isMerc,
        ownedEntry: roster[hero.hid] ?? null,
        investmentTarget: hero.target,
        missingBreakpoints: isMerc ? [] : gap.missingMajorBreakpoints,
        belowMinViable: isMerc ? false : gap.belowMinViable,
        suggestedSubstitutes,
        collectionAssignment: assignment,
      };
    });

    const missingHeroIds = heroSlots.filter((h) => h.status === 'missing').map((h) => h.pick.hid);
    const underHeroIds = heroSlots.filter((h) => h.status === 'under').map((h) => h.pick.hid);

    missingHeroCount += missingHeroIds.length;
    underHeroCount += underHeroIds.length;
    if (cand.missingPet) missingPetCount += 1;
    if (cand.underPetLevel) underPetCount += 1;
    if (cand.runnable) readyTeamCount += 1;

    if (mode.slug === 'nightmare-corridor') {
      if (cand.comp.avgTimeSeconds !== null && cand.comp.avgTimeSeconds > 0) {
        ncTimeSum += cand.comp.avgTimeSeconds;
      } else {
        allNcHaveTime = false;
      }
    }

    return {
      compKey: cand.comp.compKey,
      slotKey: cand.slotKey,
      slotLabel: cand.slotLabel,
      formation: synthesizedFormation,
      sourceSubmission: cand.comp.representativeSubmission,
      sourceSubmissionIds: cand.comp.sourceSubmissionIds,
      sourceCount: cand.comp.submissionCount,
      investmentCoverage: cand.comp.investmentCoverage,
      heroes: heroSlots,
      mercHeroId: cand.mercHeroId,
      missingHeroIds,
      underHeroIds,
      missingPet: cand.missingPet,
      underPetLevel: cand.underPetLevel,
      ownedPetLevel: cand.ownedPetLevel,
      runnable: cand.runnable,
      score: cand.score,
    };
  });

  return {
    modeSlug: mode.slug,
    target,
    expectedTeamCount,
    teams,
    emptySlots,
    readyTeamCount,
    merc,
    collectionSummary,
    missingHeroCount,
    underHeroCount,
    missingPetCount,
    underPetCount,
    totalNcTimeSeconds: allNcHaveTime ? Math.round(ncTimeSum * 10) / 10 : null,
    candidateSubmissionCount: matchingSubmissions.length,
  };
}

function lineupSignature(result: LineupRecommendationResult): string {
  const teamSigs = result.teams
    .map((t) => `${t.slotKey}:${t.compKey}:m${t.mercHeroId ?? 'none'}`)
    .sort()
    .join(';');
  return `${teamSigs}|merc:${result.merc?.heroId ?? 'none'}`;
}

/**
 * Generates up to `maxOptions` distinct conflict-free lineup recommendations.
 * When a previous option used a mercenary, the next option excludes that merc hero so the user
 * immediately gets alternatives with a different merc (or no merc); otherwise it diversifies by
 * excluding one of the previous option's comps.
 */
export function recommendLineupOptionsForMode(
  input: LineupRecommenderInput,
  maxOptions = 3,
): readonly LineupRecommendationResult[] {
  const first = recommendLineupForMode(input);
  if (first.candidateSubmissionCount === 0 || first.teams.length === 0 || maxOptions <= 1) {
    return [first];
  }

  const results: LineupRecommendationResult[] = [first];
  const seenSigs = new Set<string>([lineupSignature(first)]);
  const excludedMercs = [...(input.excludedMercHeroIds ?? [])];
  const excludedComps = [...(input.excludedCompKeys ?? [])];

  for (let attempt = 0; attempt < maxOptions * 2 && results.length < maxOptions; attempt++) {
    const prev = results[results.length - 1];
    let candidate: LineupRecommendationResult | null = null;

    // 1. If the previous option used a merc, try excluding that merc hero next.
    if (prev.merc && !excludedMercs.includes(prev.merc.heroId)) {
      excludedMercs.push(prev.merc.heroId);
      candidate = recommendLineupForMode({
        ...input,
        excludedMercHeroIds: excludedMercs,
        excludedCompKeys: excludedComps,
      });
    } else {
      // 2. Otherwise diversify by rotating out the top-scoring comp from the previous option.
      const pivotTeam = [...prev.teams]
        .sort((a, b) => b.score - a.score)
        .find((t) => {
          const key = input.mode.variable ? t.compKey : `${t.slotKey}::${t.compKey}`;
          return !excludedComps.includes(key);
        });
      if (!pivotTeam) break;
      const pivotKey = input.mode.variable
        ? pivotTeam.compKey
        : `${pivotTeam.slotKey}::${pivotTeam.compKey}`;
      excludedComps.push(pivotKey);
      candidate = recommendLineupForMode({
        ...input,
        excludedMercHeroIds: excludedMercs,
        excludedCompKeys: excludedComps,
      });
    }

    if (candidate && candidate.teams.length > 0) {
      const sig = lineupSignature(candidate);
      if (!seenSigs.has(sig)) {
        seenSigs.add(sig);
        results.push(candidate);
      }
    }
  }

  return results;
}
