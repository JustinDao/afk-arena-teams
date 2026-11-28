import { COLLECTION_CATALOG } from '../collection-catalog';
import {
  CollectionInventoryItem,
  Formation,
  Hero,
  HeroPick,
  MODES,
  ModeConfig,
  PetRosterEntry,
  RosterEntry,
  Submission,
} from '../models';
import { recommendLineupForMode } from './lineup-recommender';

describe('recommendLineupForMode', () => {
  const ncMode = MODES.find((m) => m.slug === 'nightmare-corridor')!;
  const tsMode = MODES.find((m) => m.slug === 'treasure-scramble')!;

  const heroes: Hero[] = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    name: `Hero ${i + 1}`,
    class: i % 2 === 0 ? 'Mage' : 'Support',
  }));

  const makePick = (
    hid: number,
    pos: number,
    inv = { si: 30, furn: 9, eng: 60 },
    collection: HeroPick['collection'] = null,
  ): HeroPick => ({
    pos,
    hid,
    name: `Hero ${hid}`,
    inv,
    ascension: 'ascended_1',
    merc: false,
    collection,
  });

  const makeFormation = (
    key: string,
    label: string,
    heroIds: number[],
    petId: number | null,
    petLevel: number | null,
    timeSeconds: number | null = null,
    collectionsByIndex: Record<number, HeroPick['collection']> = {},
  ): Formation => ({
    key,
    label,
    beast: petId ? `Pet ${petId}` : '',
    petId,
    petLevel,
    timeSeconds,
    heroes: heroIds.map((hid, idx) => makePick(hid, idx, { si: 30, furn: 9, eng: 60 }, collectionsByIndex[idx] ?? null)),
  });

  it('mixes and matches formations across submissions to avoid hero and pet conflicts and auto-picks 1 merc', () => {
    const customNcMode: ModeConfig = {
      ...ncMode,
      targetFormations: {
        'Soulchain Knight': [
          { key: 'boss-1', label: 'Boss 1' },
          { key: 'boss-2', label: 'Boss 2' },
        ],
      },
    };

    const subA: Submission = {
      id: 101,
      mode: 'nightmare-corridor',
      target: 'Soulchain Knight',
      up: 20,
      days: 1,
      result: {},
      notes: '',
      by: 'alice',
      heroLevel: null,
      forms: [
        // User owns all 5 heroes and pet 1.
        makeFormation('boss-1', 'Boss 1', [1, 2, 3, 4, 5], 1, 18, 20),
        // User is missing hero 9 and hero 10 -> not runnable even with 1 merc.
        makeFormation('boss-2', 'Boss 2', [6, 7, 8, 9, 10], 2, 18, 25),
      ],
    };

    const subB: Submission = {
      id: 102,
      mode: 'nightmare-corridor',
      target: 'Soulchain Knight',
      up: 10,
      days: 2,
      result: {},
      notes: '',
      by: 'bob',
      heroLevel: null,
      forms: [
        // Conflicts with subA boss-1 pet 1 and hero 1.
        makeFormation('boss-1', 'Boss 1', [1, 11, 12, 13, 14], 1, 18, 40),
        // Only missing hero 15 -> runnable with 1 merc, and disjoint from subA boss-1!
        makeFormation('boss-2', 'Boss 2', [6, 7, 8, 12, 15], 2, 18, 28),
      ],
    };

    const roster: Record<string, RosterEntry> = {};
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14]) {
      roster[id] = { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 };
    }
    const petRoster: Record<string, PetRosterEntry> = {
      1: { level: 18 },
      2: { level: 18 },
    };

    const rec = recommendLineupForMode({
      mode: customNcMode,
      target: 'Soulchain Knight',
      strictInvestment: false,
      allowMerc: true,
      submissions: [subA, subB],
      roster,
      petRoster,
      collections: [],
      collectionCatalog: COLLECTION_CATALOG,
      heroes,
    });

    expect(rec.teams.length).toBe(2);
    expect(rec.readyTeamCount).toBe(2);
    expect(rec.teams[0].sourceSubmission.id).toBe(101);
    expect(rec.teams[1].sourceSubmission.id).toBe(102);
    expect(rec.merc?.heroId).toBe(15);
    expect(rec.merc?.reason).toBe('missing');
    expect(rec.totalNcTimeSeconds).toBe(48);
  });

  it('penalizes under-invested teams and enforces strict investment when enabled', () => {
    const customNcMode: ModeConfig = {
      ...ncMode,
      targetFormations: {
        'Soulchain Knight': [{ key: 'boss-1', label: 'Boss 1' }],
      },
    };

    const subHighVotesUnder: Submission = {
      id: 201,
      mode: 'nightmare-corridor',
      target: 'Soulchain Knight',
      up: 50,
      days: 1,
      result: {},
      notes: '',
      by: 'alice',
      heroLevel: null,
      forms: [makeFormation('boss-1', 'Boss 1', [1, 2, 3, 4, 5], 1, 18, 15)],
    };

    const subBuilt: Submission = {
      id: 202,
      mode: 'nightmare-corridor',
      target: 'Soulchain Knight',
      up: 5,
      days: 1,
      result: {},
      notes: '',
      by: 'bob',
      heroLevel: null,
      forms: [makeFormation('boss-1', 'Boss 1', [6, 7, 8, 9, 10], 2, 18, 25)],
    };

    const roster: Record<string, RosterEntry> = {
      // Hero 1 is under-invested (203e0 vs 309e60).
      1: { inv: '203e0', ascension: 'ascended_1', si: 20, furn: 3, eng: 0 },
      2: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      3: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      4: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      5: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      6: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      7: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      8: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      9: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
      10: { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 },
    };
    const petRoster: Record<string, PetRosterEntry> = {
      1: { level: 18 },
      2: { level: 18 },
    };

    const strictRec = recommendLineupForMode({
      mode: customNcMode,
      target: 'Soulchain Knight',
      strictInvestment: true,
      allowMerc: false,
      submissions: [subHighVotesUnder, subBuilt],
      roster,
      petRoster,
      collections: [],
      collectionCatalog: COLLECTION_CATALOG,
      heroes,
    });

    expect(strictRec.teams[0].sourceSubmission.id).toBe(202);
    expect(strictRec.teams[0].runnable).toBeTrue();
  });

  it('builds requested number of disjoint Treasure Scramble teams without mercs and assigns unique collections', () => {
    const wingsTarget: HeroPick['collection'] = {
      catalogId: 7,
      name: 'Captive Wings',
      class: 'Mage',
      nodes: [],
      recommendation: { level: 2, attackStats: ['atk'], defenseStats: [] },
    };

    const sub1: Submission = {
      id: 301,
      mode: 'treasure-scramble',
      target: 'Frost',
      up: 30,
      days: 1,
      result: { placementType: 'rank', placementValue: 5 },
      notes: '',
      by: 'alice',
      heroLevel: null,
      forms: [
        makeFormation('t1', 'Team 1', [1, 2, 3, 4, 5], 1, 18, null, { 0: wingsTarget }),
        makeFormation('t2', 'Team 2', [6, 7, 8, 9, 10], 2, 18, null, { 0: wingsTarget }),
      ],
    };

    const sub2: Submission = {
      id: 302,
      mode: 'treasure-scramble',
      target: 'Frost',
      up: 25,
      days: 2,
      result: { placementType: 'rank', placementValue: 10 },
      notes: '',
      by: 'bob',
      heroLevel: null,
      forms: [
        // Overlaps with sub1 t1 (hero 1) -> must not be picked together with sub1 t1.
        makeFormation('t1', 'Team 1', [1, 11, 12, 13, 14], 3, 18),
        // Completely disjoint team -> should be picked as Team 3!
        makeFormation('t2', 'Team 2', [11, 12, 13, 14, 15], 3, 18),
      ],
    };

    const roster: Record<string, RosterEntry> = {};
    for (let id = 1; id <= 15; id++) {
      roster[id] = { inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 };
    }
    const petRoster: Record<string, PetRosterEntry> = {
      1: { level: 18 },
      2: { level: 18 },
      3: { level: 18 },
    };
    const collections: CollectionInventoryItem[] = [
      {
        id: 'owned-wings-1',
        catalogId: 7,
        name: 'Captive Wings A',
        class: 'Mage',
        nodes: [
          { slotIndex: 0, stat: 'skill_level', tier: 'mythic' },
          { slotIndex: 1, stat: 'atk', tier: 'mythic' },
        ],
      },
    ];

    const rec = recommendLineupForMode({
      mode: tsMode,
      target: 'Frost',
      teamCount: 3,
      strictInvestment: false,
      allowMerc: true, // TS has mercMax: 0 so mercs must remain disabled.
      submissions: [sub1, sub2],
      roster,
      petRoster,
      collections,
      collectionCatalog: COLLECTION_CATALOG,
      heroes,
    });

    expect(rec.teams.length).toBe(3);
    expect(rec.readyTeamCount).toBe(3);
    expect(rec.merc).toBeNull();

    // Verify all heroes and pets are unique across all 3 teams.
    const allHeroIds = rec.teams.flatMap((t) => t.heroes.map((h) => h.pick.hid));
    expect(new Set(allHeroIds).size).toBe(15);
    const allPetIds = rec.teams.map((t) => t.formation.petId).filter((id): id is number => id !== null);
    expect(new Set(allPetIds).size).toBe(3);

    // Only 1 Captive Wings is owned -> assigned once, second requester marked missing.
    expect(rec.collectionSummary.requested).toBe(2);
    expect(rec.collectionSummary.exact).toBe(1);
    expect(rec.collectionSummary.missing).toBe(1);
  });
});
