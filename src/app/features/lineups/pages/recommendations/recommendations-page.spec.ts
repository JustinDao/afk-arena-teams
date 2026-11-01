import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserDataService } from '../../../../core/data/user-data.service';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { HeroRecommendation } from '../../models';
import { HEROES as heroes } from '../../lineup-data';
import { RecommendationsPageComponent } from './recommendations-page.component';

describe('RecommendationsPageComponent', () => {
  const loadRecommendations = jasmine.createSpy('loadRecommendations');
  const saveRecommendationModes = jasmine.createSpy('saveRecommendationModes');

  function recommendation(heroId: number, kind: 'build' | 'invest', overrides: Partial<HeroRecommendation> = {}): HeroRecommendation {
    return {
      heroId, kind, score: 1, completeCount: 2, nearCount: 1,
      investment: { si: 30, furn: 9, eng: 60 }, ascension: 'ascended',
      byMode: { 'twisted-realm': 2, 'cursed-realm': 1 }, submissionIds: [1], ...overrides,
    };
  }

  async function setup(user: unknown) {
    loadRecommendations.calls.reset();
    saveRecommendationModes.calls.reset();
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

  it('asks signed-out users to sign in without loading anything', async () => {
    const fixture = await setup(null);
    expect(loadRecommendations).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Sign in');
  });

  it('loads saved modes, splits build and invest lists, and mentions the nightly refresh', async () => {
    loadRecommendations.and.resolveTo([recommendation(heroes[0].id, 'build'), recommendation(heroes[1].id, 'invest')]);
    const fixture = await setup({ id: 'u1' });
    const component = fixture.componentInstance;

    expect(loadRecommendations).toHaveBeenCalledWith(['twisted-realm']);
    expect(component.toBuild().length).toBe(1);
    expect(component.toInvest().length).toBe(1);
    expect(component.toBuild()[0].reason).toBe('Completes 2 top lineups and gets you closer on 1 more');
    expect(component.toBuild()[0].target).toBe('309e60 · Ascended');
    expect(fixture.nativeElement.textContent).toContain('refreshed nightly');
    expect(fixture.nativeElement.textContent).toContain('last refreshed');
  });

  it('saves the mode selection and reloads when a mode is toggled', async () => {
    loadRecommendations.and.resolveTo([]);
    const fixture = await setup({ id: 'u1' });
    loadRecommendations.calls.reset();

    await fixture.componentInstance.toggleMode('cursed-realm');
    expect(saveRecommendationModes).toHaveBeenCalledWith(['twisted-realm', 'cursed-realm']);
    expect(loadRecommendations).toHaveBeenCalledWith(['twisted-realm', 'cursed-realm']);

    await fixture.componentInstance.toggleMode(null);
    expect(saveRecommendationModes).toHaveBeenCalledWith([]);
  });

  it('describes popularity-only results without claiming lineups are completed', async () => {
    loadRecommendations.and.resolveTo([recommendation(heroes[0].id, 'build', { completeCount: 0, nearCount: 0, investment: null, ascension: null, byMode: { 'twisted-realm': 4 } })]);
    const fixture = await setup({ id: 'u1' });
    expect(fixture.componentInstance.toBuild()[0].reason).toBe('Used in 4 top lineups');
    expect(fixture.componentInstance.toBuild()[0].target).toBe('');
  });
});
