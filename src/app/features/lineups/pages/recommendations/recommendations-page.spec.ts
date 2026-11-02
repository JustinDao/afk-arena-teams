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
    expect(groups[0].items[0].target).toBe('309e60 · Ascended');
  });

  it('describes popularity-only hero results without claiming lineups are completed', async () => {
    loadRecommendations.and.resolveTo([recommendation(heroes[0].id, 'build', { completeCount: 0, nearCount: 0, investment: null, ascension: null, byMode: { 'twisted-realm': 4 } })]);
    await setup({ id: 'u1' });
    const [first] = (await render(RecommendationHeroesComponent)).componentInstance.groups()[0].items;
    expect(first.reason).toBe('Used in 4 top teams');
    expect(first.target).toBe('');
  });

  it('groups collection recommendations by class and describes the target build', async () => {
    const warriorPick: CollectionRecommendation = {
      catalogId: 1, collectionClass: 'Warrior', rank: 1, kind: 'upgrade', score: 1, completeCount: 1, nearCount: 0,
      levelNodes: 1, mythicStats: ['cda', 'cda', 'crit'], byMode: { 'twisted-realm': 1 }, submissionIds: [1],
    };
    loadCollectionRecommendations.and.resolveTo([warriorPick]);
    await setup({ id: 'u1' });
    const [warrior] = (await render(RecommendationCollectionsComponent)).componentInstance.groups();
    expect(warrior.label).toBe('Warrior');
    expect(warrior.items[0].target).toBe('1 Level node · CDA ×2 · CRIT');
    expect(warrior.items[0].reason).toBe('Fully unlocks 1 top team');
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
