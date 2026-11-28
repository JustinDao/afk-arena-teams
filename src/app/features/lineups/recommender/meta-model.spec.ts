import { COLLECTION_CATALOG } from '../collection-catalog';
import {
  Hero,
  MODES,
  ModeConfig,
  Pet,
  RosterEntry,
  Submission,
} from '../models';
import { computeInvestmentRecommendationsV2 } from './investment-recommender-v2';
import { recommendLineupForMode } from './lineup-recommender';
import { buildInvestmentModel } from './meta-model';

describe('Recommender V2 consensus modeling', () => {
  const ncMode = MODES.find((m) => m.slug === 'nightmare-corridor')!;

  const heroes: Hero[] = [
    { id: 1, name: 'Hero 1', faction: 'Lightbearer', class: 'Support' },
    { id: 2, name: 'Hero 2', faction: 'Wilder', class: 'Mage' },
    { id: 3, name: 'Hero 3', faction: 'Celestial', class: 'Ranger' },
    { id: 4, name: 'Hero 4', faction: 'Hypogean', class: 'Warrior' },
    { id: 5, name: 'Hero 5', faction: 'Graveborn', class: 'Tank' },
  ];

  const pets: Pet[] = [
    { id: 1, name: 'Seal', kind: 'standard' },
  ];

  it('imputes missing hero investments in an uninvested submission from other lineups', () => {
    const customNcMode: ModeConfig = {
      ...ncMode,
      targetFormations: {
        'Soulchain Knight': [{ key: 'boss-1', label: 'Boss 1' }],
      },
    };

    // Submission 701 in NC has NO recorded investments (inv: null, bare Ascended).
    const uninvestedNc: Submission = {
      id: 701,
      mode: 'nightmare-corridor',
      target: 'Soulchain Knight',
      up: 20,
      days: 1,
      result: {},
      notes: '',
      by: 'alice',
      heroLevel: null,
      forms: [
        {
          key: 'boss-1',
          label: 'Boss 1',
          beast: 'Seal',
          petId: 1,
          petLevel: 18,
          timeSeconds: 10,
          heroes: [1, 2, 3, 4, 5].map((hid, pos) => ({
            pos,
            hid,
            name: `Hero ${hid}`,
            inv: null,
            ascension: 'ascended',
            merc: false,
            collection: null,
          })),
        },
      ],
    };

    // Other submissions in CR record actual investments for Hero 1..5 (309e60).
    const investedCr: Submission = {
      id: 702,
      mode: 'cursed-realm',
      target: 'Kane',
      up: 15,
      days: 2,
      result: { damage: 50_000_000_000 },
      notes: '',
      by: 'bob',
      heroLevel: null,
      forms: [
        {
          key: 'boss',
          label: 'Boss',
          beast: 'Seal',
          petId: 1,
          petLevel: 18,
          timeSeconds: null,
          heroes: [1, 2, 3, 4, 5].map((hid, pos) => ({
            pos,
            hid,
            name: `Hero ${hid}`,
            inv: { si: 30, furn: 9, eng: 60 },
            ascension: 'ascended_1',
            merc: false,
            collection: null,
          })),
        },
      ],
    };

    const roster: Record<string, RosterEntry> = {
      1: { inv: '203e0', ascension: 'ascended', si: 20, furn: 3, eng: 0 },
      2: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      3: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      4: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      5: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
    };

    const rec = recommendLineupForMode({
      mode: customNcMode,
      target: 'Soulchain Knight',
      strictInvestment: false,
      allowMerc: false,
      submissions: [uninvestedNc, investedCr],
      roster,
      petRoster: { 1: { level: 18 } },
      collections: [],
      collectionCatalog: COLLECTION_CATALOG,
      heroes,
      pets,
    });

    const hero1Slot = rec.teams[0].heroes[0];
    // Even though #701 omitted investments, Hero 1's target investment is imputed as 309e60 from CR!
    expect(hero1Slot.investmentTarget.source).toBe('global');
    expect(hero1Slot.investmentTarget.inv).toEqual({ si: 30, furn: 9, eng: 60 });
    expect(hero1Slot.status).toBe('under');
    expect(hero1Slot.missingBreakpoints).toContain('SI30');
    expect(hero1Slot.missingBreakpoints).toContain('9F');
    expect(hero1Slot.missingBreakpoints).toContain('E60');
  });

  it('uses weighted consensus breakpoints so a single whale outlier does not skew target investments', () => {
    const makeSub = (id: number, up: number, si: number, furn: number, eng: number): Submission => ({
      id,
      mode: 'cursed-realm',
      target: 'Kane',
      up,
      days: 1,
      result: { damage: 40_000_000_000 },
      notes: '',
      by: `user-${id}`,
      heroLevel: null,
      forms: [
        {
          key: 'boss',
          label: 'Boss',
          beast: 'Seal',
          petId: 1,
          petLevel: 18,
          timeSeconds: null,
          heroes: [
            { pos: 0, hid: 1, name: 'Hero 1', inv: { si, furn, eng }, ascension: 'ascended_1', merc: false, collection: null },
          ],
        },
      ],
    });

    const submissions = [
      makeSub(1, 20, 30, 9, 60),
      makeSub(2, 18, 30, 9, 60),
      makeSub(3, 15, 30, 9, 30),
      // One whale submission with higher upvotes at 50/36/e100
      makeSub(4, 30, 50, 36, 100),
    ];

    const model = buildInvestmentModel(submissions);
    const resolved = model.resolveForHero(1, 'cursed-realm');

    // Consensus (60th percentile) stays at 30/9/60 instead of jumping to the whale outlier 50/36/e100.
    expect(resolved.inv).toEqual({ si: 30, furn: 9, eng: 60 });
    expect(resolved.minViableInv).toEqual({ si: 30, furn: 9, eng: 60 });
  });

  it('ranks missing and under-invested heroes, pets, and collections in V2 investment recommendations', () => {
    const sub: Submission = {
      id: 801,
      mode: 'cursed-realm',
      target: 'Kane',
      up: 25,
      days: 1,
      result: { damage: 60_000_000_000 },
      notes: '',
      by: 'alice',
      heroLevel: null,
      forms: [
        {
          key: 'boss',
          label: 'Boss',
          beast: 'Seal',
          petId: 1,
          petLevel: 18,
          timeSeconds: null,
          heroes: [
            {
              pos: 0,
              hid: 1,
              name: 'Hero 1',
              inv: { si: 30, furn: 9, eng: 60 },
              ascension: 'ascended_1',
              merc: false,
              collection: {
                catalogId: 9,
                name: "Trader's Vault",
                class: 'Support',
                nodes: [],
                recommendation: { level: 2, attackStats: ['full_atk'], defenseStats: [] },
              },
            },
            {
              pos: 1,
              hid: 2,
              name: 'Hero 2',
              inv: { si: 30, furn: 9, eng: 60 },
              ascension: 'ascended_1',
              merc: false,
              collection: null,
            },
          ],
        },
      ],
    };

    const result = computeInvestmentRecommendationsV2({
      selectedModeSlugs: ['cursed-realm'],
      modes: MODES,
      submissions: [sub],
      roster: {
        // Hero 1 is owned but under-invested; Hero 2 is missing.
        1: { inv: '203e0', ascension: 'ascended', si: 20, furn: 3, eng: 0 },
      },
      petRoster: { 1: { level: 12 } },
      collections: [],
      collectionCatalog: COLLECTION_CATALOG,
      heroes,
      pets,
    });

    expect(result.overallHeroes.length).toBe(2);
    expect(result.overallHeroes.some((h) => h.heroId === 1 && h.kind === 'invest')).toBeTrue();
    expect(result.overallHeroes.some((h) => h.heroId === 2 && h.kind === 'build')).toBeTrue();
    expect(result.pets.length).toBe(1);
    expect(result.pets[0].targetLevel).toBe(18);
    expect(result.collections.length).toBe(1);
    expect(result.collections[0].catalogId).toBe(9);
  });

  it('weights collection recasting higher when an owned exact-level copy is 1 slot away (2/3 Mythic) vs 2 slots away (1/3 Mythic)', () => {
    const sub: Submission = {
      id: 802,
      mode: 'cursed-realm',
      target: 'Kane',
      up: 20,
      days: 1,
      result: { damage: 50_000_000_000 },
      notes: '',
      by: 'alice',
      heroLevel: null,
      forms: [
        {
          key: 'boss',
          label: 'Boss',
          beast: 'Seal',
          petId: 1,
          petLevel: 18,
          timeSeconds: null,
          heroes: [
            {
              pos: 0,
              hid: 2,
              name: 'Hero 2',
              inv: { si: 30, furn: 9, eng: 60 },
              ascension: 'ascended_1',
              merc: false,
              collection: {
                catalogId: 14,
                name: "Stormwrath's Lull",
                class: 'Mage',
                nodes: [],
                recommendation: { level: 1, attackStats: ['erosion'], defenseStats: [] },
              },
            },
            {
              pos: 1,
              hid: 3,
              name: 'Hero 3',
              inv: { si: 30, furn: 9, eng: 60 },
              ascension: 'ascended_1',
              merc: false,
              collection: {
                catalogId: 13,
                name: 'Shadowflow Blade',
                class: 'Ranger',
                nodes: [],
                recommendation: { level: 1, attackStats: ['atk'], defenseStats: [] },
              },
            },
          ],
        },
      ],
    };

    const result = computeInvestmentRecommendationsV2({
      selectedModeSlugs: ['cursed-realm'],
      modes: MODES,
      submissions: [sub],
      roster: {
        2: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
        3: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      },
      petRoster: { 1: { level: 18 } },
      collections: [
        // 2/3 Mythic Erosion -> 1 slot away (strong recast candidate!)
        {
          id: 'storm-2m',
          catalogId: 14,
          name: 'Storm 2M Erosion',
          class: 'Mage',
          nodes: [
            { slotIndex: 0, stat: 'erosion', tier: 'mythic' },
            { slotIndex: 1, stat: 'erosion', tier: 'mythic' },
            { slotIndex: 2, stat: 'erosion', tier: 'legendary' },
          ],
        },
        // 1/3 Mythic ATK -> 2 slots away (weaker recast candidate)
        {
          id: 'blade-1m',
          catalogId: 13,
          name: 'Blade 1M ATK',
          class: 'Ranger',
          nodes: [
            { slotIndex: 0, stat: 'atk', tier: 'mythic' },
            { slotIndex: 1, stat: 'hp', tier: 'legendary' },
            { slotIndex: 2, stat: 'def', tier: 'elite' },
          ],
        },
      ],
      collectionCatalog: COLLECTION_CATALOG,
      heroes,
      pets,
    });

    expect(result.collections.length).toBe(2);
    // Storm (2/3 Mythic, 1 slot away) must outrank Blade (1/3 Mythic, 2 slots away).
    expect(result.collections[0].catalogId).toBe(14);
    expect(result.collections[0].action).toBe('recast');
    expect(result.collections[0].recastCandidate?.slotsRemaining).toBe(1);
    expect(result.collections[0].recastCandidate?.estimatedElixirs).toBe(400);
    expect(result.collections[0].score).toBeGreaterThan(result.collections[1].score);
  });
});
