import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserDataService } from '../../../../core/data/user-data.service';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { CollectionRecommendation, HeroRecommendation, PetRecommendation } from '../../models';
import { HEROES as heroes, PETS as pets } from '../../lineup-data';
import { RecommendationCollectionsComponent } from './recommendation-collections.component';
import { RecommendationHeroesComponent } from './recommendation-heroes.component';
import { RecommendationPetsComponent } from './recommendation-pets.component';
import { RecommendationsPageComponent } from './recommendations-page.component';
import { RecommendationsState } from './recommendations.state';

describe('Recommendations pages', () => {
  const loadRecommendations = jasmine.createSpy('loadRecommendations');
  const loadCollectionRecommendations = jasmine.createSpy('loadCollectionRecommendations');
  const loadPetRecommendations = jasmine.createSpy('loadPetRecommendations');
  const saveRecommendationModes = jasmine.createSpy('saveRecommendationModes');

  function recommendation(heroId: number, kind: 'build' | 'invest', overrides: Partial<HeroRecommendation> = {}): HeroRecommendation {
    return {
      heroId, kind, category: 'standard-4f', rank: 1, score: 1, completeCount: 2, nearCount: 1,
      investment: { si: 30, furn: 9, eng: 60 }, ascension: 'ascended',
      byMode: { 'twisted-realm': 2, 'cursed-realm': 1 }, submissionIds: [1], ...overrides,
    };
  }

  async function setup(user: unknown) {
    for (const spy of [loadRecommendations, loadCollectionRecommendations, loadPetRecommendations, saveRecommendationModes]) spy.calls.reset();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => '', classFor: () => '' } },
        {
          provide: UserDataService,
          useValue: {
            configured: false,
            loadRecommendationSettings: async () => ({ modes: ['twisted-realm'], refreshedAt: '2026-11-01T10:00:00Z' }),
            loadRecommendations,
            loadCollectionRecommendations,
            loadPetRecommendations,
            saveRecommendationModes,
          },
        },
        { provide: AuthService, useValue: { configured: false, user: signal(user), ready: signal(true) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(RecommendationsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function render<T>(component: new () => T) {
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    loadRecommendations.and.resolveTo([]);
    loadCollectionRecommendations.and.resolveTo([]);
    loadPetRecommendations.and.resolveTo([]);
  });

  it('asks signed-out users to sign in without loading anything', async () => {
    const fixture = await setup(null);
    expect(loadRecommendations).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Sign in');
  });

  it('shows the three tabs and mentions the nightly refresh', async () => {
    const fixture = await setup({ id: 'u1' });
    const tabs = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.recommendation-tabs a')).map((tab) => tab.textContent?.trim());
    expect(tabs).toEqual(['Heroes', 'Collections', 'Pets']);
    expect(fixture.nativeElement.textContent).toContain('refreshed nightly');
    expect(fixture.nativeElement.textContent).toContain('last refreshed');
    expect(loadRecommendations).toHaveBeenCalledWith(['twisted-realm']);
    expect(loadCollectionRecommendations).toHaveBeenCalledWith(['twisted-realm']);
    expect(loadPetRecommendations).toHaveBeenCalledWith(['twisted-realm']);
  });

  it('saves the mode selection and reloads when a mode is toggled', async () => {
    await setup({ id: 'u1' });
    const state = TestBed.inject(RecommendationsState);
    loadRecommendations.calls.reset();

    await state.toggleMode('cursed-realm');
    expect(saveRecommendationModes).toHaveBeenCalledWith(['twisted-realm', 'cursed-realm']);
    expect(loadRecommendations).toHaveBeenCalledWith(['twisted-realm', 'cursed-realm']);

    await state.toggleMode(null);
    expect(saveRecommendationModes).toHaveBeenCalledWith([]);
  });

  it('groups hero recommendations by category with the best step first', async () => {
    loadRecommendations.and.resolveTo([
      recommendation(heroes[1].id, 'invest', { rank: 2 }),
      recommendation(heroes[0].id, 'build'),
      recommendation(heroes[2].id, 'build', { category: 'awakened' }),
    ]);
    await setup({ id: 'u1' });
    const groups = (await render(RecommendationHeroesComponent)).componentInstance.groups();

    expect(groups.map(({ label }) => label)).toEqual(['4F', 'Cele / Hypo', 'Awakened', 'Dragolite', 'Dragon Highborn']);
    expect(groups[0].items.map(({ recommendation: { kind } }) => kind)).toEqual(['build', 'invest']);
    expect(groups[2].items.length).toBe(1);
    expect(groups[1].items.length).toBe(0);
    expect(groups[0].items[0].reason).toBe('Completes 2 top teams and gets you closer on 1 more');
    expect(groups[0].items[0].target).toBe('309e60 · A1*');
  });

  it('clamps target ascension up to the minimum required by recommended investment', async () => {
    loadRecommendations.and.resolveTo([
      recommendation(heroes[0].id, 'invest', { rank: 1, investment: { si: 30, furn: 3, eng: 30 }, ascension: 'ascended' }),
      recommendation(heroes[1].id, 'invest', { rank: 2, investment: { si: 30, furn: 9, eng: null }, ascension: 'mythic' }),
      recommendation(heroes[2].id, 'invest', { rank: 3, category: 'awakened', investment: { si: 30, furn: null, eng: null }, ascension: 'legendary' }),
    ]);
    await setup({ id: 'u1' });
    const groups = (await render(RecommendationHeroesComponent)).componentInstance.groups();
    expect(groups[0].items.map((item) => item.target)).toEqual(['303e30 · A1*', '309 · A']);
    expect(groups[2].items[0].target).toBe('SI 30 · M');
  });

  it('builds a combined top-10 overall priority list sorted by score across categories', async () => {
    loadRecommendations.and.resolveTo([
      recommendation(heroes[0].id, 'build', { category: 'standard-4f', rank: 1, score: 2 }),
      recommendation(heroes[1].id, 'invest', { category: 'standard-4f', rank: 2, score: 1 }),
      recommendation(heroes[2].id, 'build', { category: 'awakened', rank: 1, score: 11 }),
      recommendation(heroes[3].id, 'build', { category: 'cele-hypo', rank: 1, score: 10 }),
      recommendation(heroes[4].id, 'invest', { category: 'drago-lite', rank: 1, score: 9 }),
      recommendation(heroes[5].id, 'build', { category: 'dragon-highborn', rank: 1, score: 8 }),
      recommendation(heroes[6].id, 'build', { category: 'standard-4f', rank: 3, score: 7 }),
      recommendation(heroes[7].id, 'build', { category: 'cele-hypo', rank: 2, score: 6 }),
      recommendation(heroes[8].id, 'build', { category: 'awakened', rank: 2, score: 5 }),
      recommendation(heroes[9].id, 'build', { category: 'drago-lite', rank: 2, score: 4 }),
      recommendation(heroes[10].id, 'build', { category: 'dragon-highborn', rank: 2, score: 3 }),
    ]);
    await setup({ id: 'u1' });
    const fixture = await render(RecommendationHeroesComponent);
    const overall = fixture.componentInstance.overall();

    expect(overall.map((view) => view.hero.id)).toEqual([
      heroes[2].id,
      heroes[3].id,
      heroes[4].id,
      heroes[5].id,
      heroes[6].id,
      heroes[7].id,
      heroes[8].id,
      heroes[9].id,
      heroes[10].id,
      heroes[0].id,
    ]);
    expect(overall[0].categoryLabel).toBe('Awakened');
    expect(fixture.nativeElement.textContent).toContain('Overall priority');
  });

  it('describes popularity-only hero results without claiming lineups are completed', async () => {
    loadRecommendations.and.resolveTo([recommendation(heroes[0].id, 'build', { completeCount: 0, nearCount: 0, investment: null, ascension: null, byMode: { 'twisted-realm': 4 } })]);
    await setup({ id: 'u1' });
    const [first] = (await render(RecommendationHeroesComponent)).componentInstance.groups()[0].items;
    expect(first.reason).toBe('Used in 4 top teams');
    expect(first.target).toBe('');
  });

  it('labels single-stat hero targets explicitly (SI, furniture, engraving)', async () => {
    loadRecommendations.and.resolveTo([
      recommendation(heroes[0].id, 'invest', { rank: 1, investment: { si: 40, furn: null, eng: null }, ascension: 'ascended' }),
      recommendation(heroes[1].id, 'invest', { rank: 2, investment: { si: null, furn: 9, eng: null }, ascension: null }),
      recommendation(heroes[2].id, 'invest', { rank: 3, category: 'awakened', investment: { si: null, furn: null, eng: 60 }, ascension: null }),
    ]);
    await setup({ id: 'u1' });
    const fixture = await render(RecommendationHeroesComponent);
    const groups = fixture.componentInstance.groups();
    expect(groups[0].items.map((item) => item.target)).toEqual(['SI 40 · A', '9F']);
    expect(groups[2].items[0].target).toBe('E60');
  });

  it('shows current roster investment for invest recommendations but not build recommendations', async () => {
    localStorage.setItem('ll.roster', JSON.stringify({
      [heroes[0].id]: { inv: '203e30', ascension: 'mythic_plus' },
    }));
    try {
      loadRecommendations.and.resolveTo([
        recommendation(heroes[0].id, 'invest', { rank: 1, investment: { si: 30, furn: 9, eng: 60 }, ascension: 'ascended_1' }),
        recommendation(heroes[1].id, 'build', { rank: 2, investment: { si: 30, furn: 9, eng: 60 }, ascension: 'ascended' }),
      ]);
      await setup({ id: 'u1' });
      const fixture = await render(RecommendationHeroesComponent);
      const [investItem, buildItem] = fixture.componentInstance.groups()[0].items;

      expect(investItem.current).toBe('203e30 · M+');
      expect(buildItem.current).toBe('');
      expect(fixture.nativeElement.textContent).toContain('203e30 · M+ → 309e60 · A1*');
    } finally {
      localStorage.removeItem('ll.roster');
    }
  });

  it('omits ascension from current and target when an invest hero is already at or past the target ascension', async () => {
    localStorage.setItem('ll.roster', JSON.stringify({
      [heroes[0].id]: { inv: '309e30', ascension: 'ascended_5' },
      [heroes[1].id]: { inv: '309e30', ascension: 'ascended_1' },
    }));
    try {
      loadRecommendations.and.resolveTo([
        recommendation(heroes[0].id, 'invest', { rank: 1, investment: { si: 30, furn: 9, eng: 61 }, ascension: 'ascended_1' }),
        recommendation(heroes[1].id, 'invest', { rank: 2, investment: { si: 30, furn: 9, eng: 60 }, ascension: 'ascended_1' }),
      ]);
      await setup({ id: 'u1' });
      const fixture = await render(RecommendationHeroesComponent);
      const [pastItem, equalItem] = fixture.componentInstance.groups()[0].items;

      expect(pastItem.current).toBe('309e30');
      expect(pastItem.target).toBe('309e61');
      expect(equalItem.current).toBe('309e30');
      expect(equalItem.target).toBe('309e60');
      expect(fixture.nativeElement.textContent).toContain('309e30 → 309e61');
      expect(fixture.nativeElement.textContent).not.toContain('A5*');
      expect(fixture.nativeElement.textContent).not.toContain('A1*');
    } finally {
      localStorage.removeItem('ll.roster');
    }
  });

  it('groups collection recommendations by class and describes the target build', async () => {
    const warriorPick: CollectionRecommendation = {
      catalogId: 1, collectionClass: 'Warrior', rank: 1, kind: 'upgrade', score: 1, completeCount: 1, nearCount: 0,
      levelNodes: 1, mythicStats: ['cda', 'cda', 'crit'], byMode: { 'twisted-realm': 1 }, submissionIds: [1],
      topHeroIds: [heroes[0].id, heroes[1].id],
    };
    loadCollectionRecommendations.and.resolveTo([warriorPick]);
    await setup({ id: 'u1' });
    const fixture = await render(RecommendationCollectionsComponent);
    const [warrior] = fixture.componentInstance.groups();
    expect(warrior.label).toBe('Warrior');
    expect(warrior.items[0].name).toContain('· Lv 2');
    expect(warrior.items[0].target).toBe('CDA ×2 · CRIT');
    expect(warrior.items[0].reason).toBe('Fully unlocks 1 top team');
    expect(warrior.items[0].topUsers.map((u) => u.id)).toEqual([heroes[0].id, heroes[1].id]);
    const userIcons = fixture.nativeElement.querySelectorAll('.rec-users app-hero-icon');
    expect(userIcons.length).toBeGreaterThanOrEqual(2);
    expect(userIcons[0].getAttribute('title')).toContain(heroes[0].name);
  });

  it('builds a combined top-10 overall priority list for collections sorted by score', async () => {
    const pick = (catalogId: number, collectionClass: CollectionRecommendation['collectionClass'], score: number): CollectionRecommendation => ({
      catalogId, collectionClass, rank: 1, kind: 'upgrade', score, completeCount: 1, nearCount: 0,
      levelNodes: 1, mythicStats: ['cda'], byMode: { 'twisted-realm': 1 }, submissionIds: [1],
    });
    loadCollectionRecommendations.and.resolveTo([
      pick(1, 'Warrior', 2),
      pick(5, 'Tank', 11),
      pick(9, 'Ranger', 10),
      pick(13, 'Mage', 9),
      pick(17, 'Support', 8),
      pick(2, 'Warrior', 7),
      pick(6, 'Tank', 6),
      pick(10, 'Ranger', 5),
      pick(14, 'Mage', 4),
      pick(18, 'Support', 3),
      pick(3, 'Warrior', 1),
    ]);
    await setup({ id: 'u1' });
    const fixture = await render(RecommendationCollectionsComponent);
    const overall = fixture.componentInstance.overall();

    expect(overall.map((view) => view.recommendation.catalogId)).toEqual([5, 9, 13, 17, 2, 6, 10, 14, 18, 1]);
    expect(fixture.nativeElement.textContent).toContain('Overall priority');
  });

  it('groups pet recommendations by kind and shows the target level', async () => {
    const pet = pets.find((entry) => entry.kind !== 'basic')!;
    const pick: PetRecommendation = {
      petId: pet.id, petKind: pet.kind as 'standard' | 'awakened', rank: 1, kind: 'upgrade', score: 1,
      completeCount: 1, nearCount: 0, level: 30, byMode: { 'twisted-realm': 1 }, submissionIds: [1],
    };
    loadPetRecommendations.and.resolveTo([pick]);
    await setup({ id: 'u1' });
    const fixture = await render(RecommendationPetsComponent);
    const groups = fixture.componentInstance.groups();
    expect(groups.map(({ key }) => key)).toEqual(['standard', 'awakened']);
    expect(groups.find(({ key }) => key === pet.kind)!.items[0].reason).toBe('Fully unlocks 1 top team');
    expect(fixture.nativeElement.textContent).toContain('Level up to 30');
  });
});
