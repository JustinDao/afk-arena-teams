import {
  CollectionCatalogItem,
  CollectionInventoryItem,
  CollectionNode,
  CollectionSnapshot,
  Hero,
} from '../models';

export type CollectionMatchStatus = 'none' | 'exact' | 'close' | 'fallback' | 'missing';

export interface CollectionAssignmentRequest {
  readonly slotKey: string;
  readonly heroId: number;
  readonly heroClass: CollectionCatalogItem['class'] | null;
  readonly target: CollectionSnapshot | null;
}

export interface CollectionAssignmentResult {
  readonly slotKey: string;
  readonly status: CollectionMatchStatus;
  readonly target: CollectionSnapshot | null;
  readonly assigned: CollectionInventoryItem | null;
  readonly assignedLevel: number | null;
  readonly targetLevel: number | null;
  readonly matchedStats: readonly string[];
  readonly score: number;
}

const VALID_CLASSES = new Set<CollectionCatalogItem['class']>([
  'Warrior',
  'Tank',
  'Ranger',
  'Mage',
  'Support',
]);

export function normalizeHeroClass(value: string | null | undefined): CollectionCatalogItem['class'] | null {
  if (!value) return null;
  return VALID_CLASSES.has(value as CollectionCatalogItem['class'])
    ? (value as CollectionCatalogItem['class'])
    : null;
}

export function collectionLevelFromNodes(nodes: readonly CollectionNode[]): number {
  const skillLevels = nodes.filter(({ stat }) => stat === 'skill_level').length;
  return Math.min(3, Math.max(1, skillLevels + 1));
}

export function targetLevelFromSnapshot(snapshot: CollectionSnapshot): number {
  if (snapshot.recommendation) {
    return Math.min(3, Math.max(1, snapshot.recommendation.level));
  }
  return collectionLevelFromNodes(snapshot.nodes);
}

export function desiredStatsFromSnapshot(snapshot: CollectionSnapshot): readonly string[] {
  if (snapshot.recommendation) {
    return [...new Set([
      ...snapshot.recommendation.attackStats,
      ...snapshot.recommendation.defenseStats,
    ])];
  }
  const mythic = snapshot.nodes
    .filter(({ stat, tier }) => stat !== 'skill_level' && tier === 'mythic')
    .map(({ stat }) => stat);
  if (mythic.length > 0) return [...new Set(mythic)];
  const anyNonLevel = snapshot.nodes
    .filter(({ stat }) => stat !== 'skill_level')
    .map(({ stat }) => stat);
  return [...new Set(anyNonLevel)];
}

export function resolveCatalogItem(
  catalog: readonly CollectionCatalogItem[],
  catalogId: number | undefined,
  name: string | undefined,
): CollectionCatalogItem | null {
  if (catalogId !== undefined) {
    const byId = catalog.find((item) => item.id === catalogId);
    if (byId) return byId;
  }
  if (name) {
    const lowered = name.trim().toLowerCase();
    const byName = catalog.find((item) => item.name.toLowerCase() === lowered);
    if (byName) return byName;
  }
  return null;
}

interface CandidateMatch {
  readonly status: Exclude<CollectionMatchStatus, 'none' | 'missing'>;
  readonly score: number;
  readonly assignedLevel: number;
  readonly targetLevel: number;
  readonly matchedStats: readonly string[];
}

function evaluateCollectionMatch(
  item: CollectionInventoryItem,
  request: CollectionAssignmentRequest,
  catalog: readonly CollectionCatalogItem[],
): CandidateMatch | null {
  if (!request.target) return null;

  const targetCatalog = resolveCatalogItem(catalog, request.target.catalogId, request.target.name);
  const itemCatalog = resolveCatalogItem(catalog, item.catalogId, item.name);

  const requiredClass = request.heroClass ?? request.target.class ?? targetCatalog?.class ?? null;
  const itemClass = item.class ?? itemCatalog?.class ?? null;
  if (requiredClass && itemClass && requiredClass !== itemClass) {
    return null;
  }

  const targetCatalogId = request.target.catalogId ?? targetCatalog?.id ?? null;
  const itemCatalogId = item.catalogId ?? itemCatalog?.id ?? null;
  const isSameCatalog = targetCatalogId !== null && itemCatalogId !== null
    ? targetCatalogId === itemCatalogId
    : item.name.trim().toLowerCase() === request.target.name.trim().toLowerCase();

  const ownedLevel = collectionLevelFromNodes(item.nodes);
  const targetLevel = targetLevelFromSnapshot(request.target);
  const desiredStats = desiredStatsFromSnapshot(request.target);
  const desiredSet = new Set(desiredStats);

  let statScore = 0;
  const matchedStatsSet = new Set<string>();
  let mythicCount = 0;

  for (const node of item.nodes) {
    if (node.stat === 'skill_level') continue;
    if (node.tier === 'mythic') mythicCount += 1;
    if (desiredSet.has(node.stat)) {
      matchedStatsSet.add(node.stat);
      if (node.tier === 'mythic') statScore += 45;
      else if (node.tier === 'legendary') statScore += 22;
      else statScore += 10;
    }
  }

  const matchedStats = [...matchedStatsSet];
  const levelDiff = ownedLevel - targetLevel;
  const levelScore = levelDiff >= 0
    ? 220 + Math.min(levelDiff, 2) * 15
    : 220 + levelDiff * 130;

  if (isSameCatalog) {
    const score = 1000 + levelScore + statScore + mythicCount * 4;
    const meetsStats = desiredStats.length === 0 || matchedStats.length > 0;
    const status: 'exact' | 'close' = ownedLevel >= targetLevel && meetsStats ? 'exact' : 'close';
    return {
      status,
      score: Math.max(1, score),
      assignedLevel: ownedLevel,
      targetLevel,
      matchedStats,
    };
  }

  // Same-class fallback when the exact catalog item is unavailable.
  const fallbackScore = 120 + Math.max(0, levelScore / 3) + statScore * 0.6 + mythicCount * 5;
  return {
    status: 'fallback',
    score: Math.max(1, Math.round(fallbackScore)),
    assignedLevel: ownedLevel,
    targetLevel,
    matchedStats,
  };
}

/**
 * Hungarian algorithm for rectangular maximum-weight bipartite matching.
 * Returns an array `matchForRow` where `matchForRow[i]` is the matched column index or -1.
 */
function maxWeightBipartiteMatch(weights: readonly (readonly number[])[]): number[] {
  const numRows = weights.length;
  if (numRows === 0) return [];
  const numCols = weights[0].length;
  if (numCols === 0) return Array(numRows).fill(-1);

  // Pad to square matrix of size n x n with 0 weights for dummy entries.
  const n = Math.max(numRows, numCols);
  let maxVal = 0;
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      if (weights[i][j] > maxVal) maxVal = weights[i][j];
    }
  }

  // Convert max-weight to min-cost (1-indexed for standard Jonker/Hungarian formulation).
  const cost: number[][] = Array.from({ length: n + 1 }, () => Array(n + 1).fill(maxVal));
  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      cost[i + 1][j + 1] = maxVal - Math.max(0, weights[i][j]);
    }
  }

  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const matchForRow = new Array<number>(numRows).fill(-1);
  for (let j = 1; j <= numCols; j++) {
    const row = p[j] - 1;
    if (row >= 0 && row < numRows && weights[row][j - 1] > 0) {
      matchForRow[row] = j - 1;
    }
  }
  return matchForRow;
}

/**
 * Assigns owned collections from the user's inventory to hero slots across a full lineup
 * with no duplicate inventory items across teams, maximizing overall match quality.
 */
export function assignCollectionsToLineup(
  requests: readonly CollectionAssignmentRequest[],
  inventory: readonly CollectionInventoryItem[],
  catalog: readonly CollectionCatalogItem[],
): ReadonlyMap<string, CollectionAssignmentResult> {
  const results = new Map<string, CollectionAssignmentResult>();
  const activeRequests: CollectionAssignmentRequest[] = [];

  for (const req of requests) {
    if (!req.target) {
      results.set(req.slotKey, {
        slotKey: req.slotKey,
        status: 'none',
        target: null,
        assigned: null,
        assignedLevel: null,
        targetLevel: null,
        matchedStats: [],
        score: 0,
      });
    } else {
      activeRequests.push(req);
    }
  }

  if (activeRequests.length === 0) {
    return results;
  }

  if (inventory.length === 0) {
    for (const req of activeRequests) {
      results.set(req.slotKey, {
        slotKey: req.slotKey,
        status: 'missing',
        target: req.target,
        assigned: null,
        assignedLevel: null,
        targetLevel: req.target ? targetLevelFromSnapshot(req.target) : null,
        matchedStats: [],
        score: 0,
      });
    }
    return results;
  }

  const matches: (CandidateMatch | null)[][] = activeRequests.map((req) =>
    inventory.map((item) => evaluateCollectionMatch(item, req, catalog)),
  );
  const weights: number[][] = matches.map((row) =>
    row.map((cell) => (cell ? cell.score : 0)),
  );

  const assignment = maxWeightBipartiteMatch(weights);

  activeRequests.forEach((req, rowIndex) => {
    const colIndex = assignment[rowIndex];
    const match = colIndex >= 0 ? matches[rowIndex][colIndex] : null;
    if (match && colIndex >= 0) {
      results.set(req.slotKey, {
        slotKey: req.slotKey,
        status: match.status,
        target: req.target,
        assigned: inventory[colIndex],
        assignedLevel: match.assignedLevel,
        targetLevel: match.targetLevel,
        matchedStats: match.matchedStats,
        score: match.score,
      });
    } else {
      results.set(req.slotKey, {
        slotKey: req.slotKey,
        status: 'missing',
        target: req.target,
        assigned: null,
        assignedLevel: null,
        targetLevel: req.target ? targetLevelFromSnapshot(req.target) : null,
        matchedStats: [],
        score: 0,
      });
    }
  });

  return results;
}

/**
 * Quick heuristic estimate of how well the user's inventory can cover a single formation's
 * requested collections (used as a light tie-breaker during formation selection).
 */
export function estimateFormationCollectionFit(
  heroes: readonly { readonly hid: number; readonly collection: CollectionSnapshot | null }[],
  heroById: ReadonlyMap<number, Hero>,
  inventory: readonly CollectionInventoryItem[],
  catalog: readonly CollectionCatalogItem[],
): number {
  if (inventory.length === 0) return 0;
  let totalTargetCount = 0;
  let exactCatalogMatches = 0;

  for (const hero of heroes) {
    if (!hero.collection) continue;
    totalTargetCount += 1;
    const targetCatalog = resolveCatalogItem(catalog, hero.collection.catalogId, hero.collection.name);
    const targetCatalogId = hero.collection.catalogId ?? targetCatalog?.id ?? null;
    const heroClass = normalizeHeroClass(heroById.get(hero.hid)?.class);
    const hasExact = inventory.some((item) => {
      const itemCatalog = resolveCatalogItem(catalog, item.catalogId, item.name);
      const itemCatalogId = item.catalogId ?? itemCatalog?.id ?? null;
      const itemClass = item.class ?? itemCatalog?.class ?? null;
      if (heroClass && itemClass && heroClass !== itemClass) return false;
      if (targetCatalogId !== null && itemCatalogId !== null) {
        return targetCatalogId === itemCatalogId;
      }
      return item.name.trim().toLowerCase() === hero.collection!.name.trim().toLowerCase();
    });
    if (hasExact) exactCatalogMatches += 1;
  }

  return totalTargetCount === 0 ? 0 : exactCatalogMatches / totalTargetCount;
}
