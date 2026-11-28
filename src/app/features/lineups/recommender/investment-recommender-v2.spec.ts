import { Hero, HeroPick, MODES, RosterEntry, Submission } from '../models';
import {
  computeInvestmentCostFactor,
  computeInvestmentRecommendationsV2,
  recommendSi40Strategy,
} from './investment-recommender-v2';

function makeHero(id: number, name: string): Hero {
  return {
    id,
    name,
    faction: 'Lightbearer',
    class: 'Support',
    isAwakened: false,
  };
}

function makePick(hid: number, pos: number, si: number, furn: number, eng: number): HeroPick {
  return {
    pos,
    hid,
    inv: { si, furn, eng },
    ascension: 'ascended_1',
    merc: false,
    collection: null,
  };
}

describe('investment-recommender-v2 cost model', () => {
  const ncMode = MODES.find((m) => m.slug === 'nightmare-corridor')!;

  it('orders upgrade costs realistically: SI30/9F < E60 < SI40 across strategies', () => {
    const si30 = computeInvestmentCostFactor('standard-4f', 'invest', { si: 20, furn: 9, eng: 30 }, { si: 30, furn: 9, eng: 30 });
    const furn9 = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 3, eng: 30 }, { si: 30, furn: 9, eng: 30 });
    const e30 = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 0 }, { si: 30, furn: 9, eng: 30 });
    const e60 = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 30 }, { si: 30, furn: 9, eng: 60 });
    const si40Red = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 60 }, { si: 40, furn: 9, eng: 60 }, 'red-focus');
    const si40Balanced = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 60 }, { si: 40, furn: 9, eng: 60 }, 'balanced');
    const si40Mid = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 60 }, { si: 40, furn: 9, eng: 60 }, 'split-405-300');
    const si40MidEpic = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 60 }, { si: 40, furn: 9, eng: 60 }, 'split-305-380');
    const si40Epic = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 60 }, { si: 40, furn: 9, eng: 60 }, 'epic-focus');

    expect(e30).toBeLessThan(si30);
    expect(furn9).toBeLessThan(e60);
    expect(si30).toBeLessThan(e60);
    expect(e60).toBeLessThan(si40Red);
    expect(si40Red).toBeLessThan(si40Balanced);
    expect(si40Balanced).toBeLessThan(si40Mid);
    expect(si40Mid).toBeLessThan(si40MidEpic);
    expect(si40MidEpic).toBeLessThan(si40Epic);
  });

  it('weights the back-loaded SI35->40 levels heavier than SI30->35', () => {
    const firstHalf = computeInvestmentCostFactor('standard-4f', 'invest', { si: 30, furn: 9, eng: 30 }, { si: 35, furn: 9, eng: 30 }, 'balanced');
    const secondHalf = computeInvestmentCostFactor('standard-4f', 'invest', { si: 35, furn: 9, eng: 30 }, { si: 40, furn: 9, eng: 30 }, 'balanced');
    expect(secondHalf).toBeGreaterThan(firstHalf);
  });

  it('ranks core SI30+9F upgrades ahead of equal-usage E60/SI40 pushes and responds to si40Strategy', () => {
    const heroes: Hero[] = [
      makeHero(1, 'CoreSI30'),
      makeHero(2, 'LuxuryE60'),
      makeHero(3, 'LuxurySI40'),
    ];

    const submissions: Submission[] = [
      {
        id: 100,
        mode: 'nightmare-corridor',
        target: 'Boss Cycle',
        by: 'tester',
        notes: '',
        heroLevel: null,
        days: 1,
        up: 20,
        result: {},
        forms: [
          {
            key: 'B1',
            label: 'B1',
            beast: '',
            petId: null,
            petLevel: null,
            timeSeconds: null,
            heroes: [
              makePick(1, 0, 30, 9, 30),
              makePick(2, 1, 30, 9, 60),
              makePick(3, 2, 40, 9, 60),
            ],
          },
        ],
      },
    ];

    const roster: Record<string, RosterEntry> = {
      1: { ascension: 'ascended_1', inv: '203e30', si: 20, furn: 3, eng: 30 },
      2: { ascension: 'ascended_1', inv: '309e30', si: 30, furn: 9, eng: 30 },
      3: { ascension: 'ascended_1', inv: '309e60', si: 30, furn: 9, eng: 60 },
    };

    const baseInput = {
      selectedModeSlugs: ['nightmare-corridor'],
      modes: [ncMode],
      submissions,
      roster,
      petRoster: {},
      collections: [],
      collectionCatalog: [],
      heroes,
      pets: [],
    };

    const balanced = computeInvestmentRecommendationsV2({ ...baseInput, si40Strategy: 'balanced' });
    const epicFocus = computeInvestmentRecommendationsV2({ ...baseInput, si40Strategy: 'epic-focus' });
    const redFocus = computeInvestmentRecommendationsV2({ ...baseInput, si40Strategy: 'red-focus' });

    const scoreOf = (res: typeof balanced, id: number): number =>
      res.overallHeroes.find((h) => h.heroId === id)?.score ?? 0;

    // Equal usage: SI30+9F > E60 > SI40 under balanced strategy.
    expect(scoreOf(balanced, 1)).toBeGreaterThan(scoreOf(balanced, 2));
    expect(scoreOf(balanced, 2)).toBeGreaterThan(scoreOf(balanced, 3));

    // SI40 score rises as strategy becomes more aggressive with Reds; SI30 score is unaffected.
    expect(scoreOf(epicFocus, 3)).toBeLessThan(scoreOf(balanced, 3));
    expect(scoreOf(balanced, 3)).toBeLessThan(scoreOf(redFocus, 3));
    expect(scoreOf(epicFocus, 1)).toBe(scoreOf(redFocus, 1));
  });

  it('recommends an SI40 split based on remaining owned meta SI30s', () => {
    expect(recommendSi40Strategy(12, 5).strategy).toBe('epic-focus');
    expect(recommendSi40Strategy(7, 5).strategy).toBe('split-305-380');
    expect(recommendSi40Strategy(4, 5).strategy).toBe('split-405-300');
    expect(recommendSi40Strategy(2, 5).strategy).toBe('balanced');
    expect(recommendSi40Strategy(0, 5).strategy).toBe('red-focus');
  });
});
