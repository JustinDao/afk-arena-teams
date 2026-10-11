import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { HeroIconService } from './core/hero-icons/hero-icon.service';
import { UserDataService } from './core/data/user-data.service';
import { provideRouter, Router } from '@angular/router';
import { APP_ROUTES } from './app.routes';
import { AuthService, DUPLICATE_SIGNUP_MESSAGE } from './core/auth/auth.service';
import { User } from '@supabase/supabase-js';
import { COLLECTION_CATALOG, COLLECTION_NODE_STATS, collectionIconUrl, collectionNodeIconUrl } from './features/lineup-ledger/collection-catalog';

describe('AppComponent collection node editor', () => {
  it('does not show a mercenary control when creating a Twisted Realm team', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    fixture.componentInstance.openSubmission();
    fixture.componentInstance.changeDraftMode('twisted-realm');
    fixture.detectChanges();

    const labels = Array.from(fixture.nativeElement.querySelectorAll('label')) as HTMLLabelElement[];
    expect(labels.some((label) => label.textContent?.includes('Mercenary'))).toBeFalse();
    fixture.destroy();
  });

  describe('AppComponent account form', () => {
    it('blocks short passwords with a clear minimum-length validation', async () => {
      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          provideRouter(APP_ROUTES),
          { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
          { provide: UserDataService, useValue: { configured: false } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(AppComponent);
      const component = fixture.componentInstance;
      component.openAccount();
      component.accountMode.set('sign-up');
      component.accountForm.setValue({ email: 'player@example.com', password: 'short1' });
      component.accountForm.controls.password.markAsDirty();
      fixture.detectChanges();

      expect(component.accountForm.invalid).toBeTrue();
      expect(fixture.nativeElement.textContent).toContain('Use at least 8 characters.');
      expect(fixture.nativeElement.querySelector('.submit-button').disabled).toBeTrue();
      expect(getComputedStyle(fixture.nativeElement.querySelector('.account-actions')).display).toBe('grid');

      component.accountForm.controls.email.setValue('not-an-email');
      component.accountForm.controls.password.setValue('long-enough-password');
      fixture.detectChanges();
      expect(component.accountForm.invalid).toBeTrue();
      expect(fixture.nativeElement.querySelector('.submit-button').disabled).toBeTrue();

      component.accountForm.controls.email.setValue('player@example.com');
      fixture.detectChanges();
      component.accountForm.controls.password.setValue('long-enough-password');
      fixture.detectChanges();
      expect(component.accountForm.valid).toBeTrue();
      expect(fixture.nativeElement.querySelector('.submit-button').disabled).toBeFalse();
      fixture.destroy();
    });

    it('displays a duplicate account error message when signing up with an existing email', async () => {
      const authMock = {
        error: signal<string | null>(null),
        user: signal<User | null>(null),
        ready: signal(true),
        configured: true,
        clearError() {
          this.error.set(null);
        },
        signUp: jasmine.createSpy('signUp').and.callFake(async () => {
          authMock.error.set(DUPLICATE_SIGNUP_MESSAGE);
        }),
      };
      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          provideRouter(APP_ROUTES),
          { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
          { provide: UserDataService, useValue: { configured: false } },
          { provide: AuthService, useValue: authMock },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(AppComponent);
      const component = fixture.componentInstance;
      component.openAccount();
      component.selectAccountMode('sign-up');
      component.accountForm.setValue({ email: 'player@example.com', password: 'long-enough-password' });
      fixture.detectChanges();

      await component.submitAccount();
      fixture.detectChanges();

      expect(authMock.signUp).toHaveBeenCalledWith('player@example.com', 'long-enough-password');
      expect(component.accountMessage()).toBeNull();
      expect(component.auth.error()).toBe(DUPLICATE_SIGNUP_MESSAGE);
      const errorEl = fixture.nativeElement.querySelector('.auth-error');
      expect(errorEl?.textContent).toContain(DUPLICATE_SIGNUP_MESSAGE);
      expect(fixture.nativeElement.querySelector('.account-message')).toBeNull();

      component.selectAccountMode('sign-in');
      fixture.detectChanges();
      expect(component.auth.error()).toBeNull();
      expect(fixture.nativeElement.querySelector('.auth-error')).toBeNull();
      fixture.destroy();
    });
  });

  it('hides the roster prompt and Supabase privacy footer when signed out', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Add the heroes you own to filter lineups');
    expect(fixture.nativeElement.textContent).not.toContain('Lineups and account data are stored in Supabase.');
    fixture.destroy();
  });

  it('keeps active mode and roster routes synchronized with the page state', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    await router.navigateByUrl('/tr');
    expect(router.url).toBe('/twisted-realm');
    expect(component.store.mode()).toBe('twisted-realm');
    expect(component.rosterOpen()).toBeFalse();

    await router.navigateByUrl('/roster');
    expect(component.rosterOpen()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.roster-page')).not.toBeNull();

    await router.navigateByUrl('/treasure-scramble');
    expect(component.rosterOpen()).toBeFalse();
    expect(component.store.mode()).toBe('treasure-scramble');
    fixture.destroy();
  });

  it('offers collection icons and three attack, three defense, and two flex node slots', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    expect(component.collectionCatalog().length).toBe(20);
    expect(new Set(COLLECTION_CATALOG.map(({ id }) => id)).size).toBe(20);
    expect(COLLECTION_NODE_STATS.length).toBe(26);
    expect(new Set(COLLECTION_NODE_STATS).size).toBe(26);
    expect(component.collectionCatalog()[0]).toEqual({
      id: 1,
      class: 'Warrior',
      codeName: 'dt',
      name: 'Temporal Cover',
    });
    expect(component.collectionNodeStats()).toContain('skill_level');
    expect(component.collectionNodeStats()).toContain('full_atk');
    expect(component.collectionNodeSlots.map(({ category, indices }) => [category, indices.length])).toEqual([
      ['Attack', 3],
      ['Defense', 3],
      ['Flex', 2],
    ]);
    expect(component.collectionNodes()).toEqual([]);
    expect(collectionIconUrl(1, 2)).toBe(
      'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/1_lvl2_cl.webp',
    );
    expect(collectionIconUrl(1, 3, 2)).toBe(
      'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/1_lvl3_ms2_cl.webp',
    );
    expect(collectionNodeIconUrl('atk', 'mythic')).toBe(
      'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_stats_icon/atk_m.webp',
    );
    component.updateCollectionNodeStat(0, 'atk');
    expect(component.collectionNodeAt(0)?.tier).toBe('mythic');
    component.updateCollectionNodeTier(0, 'legendary');
    expect(component.collectionNodeAt(0)?.tier).toBe('legendary');
    component.updateCollectionNodeStat(7, 'skill_level');
    expect(component.collectionNodes()).toEqual([{
      slotIndex: 7,
      stat: 'skill_level',
      tier: 'mythic',
    }]);
    component.updateCollectionNodeTier(7, 'elite');
    expect(component.collectionNodeAt(7)?.tier).toBe('mythic');
    expect(component.collectionNodeStatsForSlot(0)).not.toContain('skill_level');
    expect(component.collectionNodeStatsForSlot(6)).toContain('skill_level');

    component.removeCollectionNode(7);
    expect(component.collectionNodes()).toEqual([]);
    fixture.destroy();
  });

  it('lets roster investments switch between compact and separate-column editing', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    component.openRoster();
    component.rosterInvestmentMode.set('long');
    component.store.clearRoster();
    component.store.toggleHero(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.roster-page')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.roster-page [role="dialog"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Back to lineups');
    const heroName = component.store.heroes().find(({ id }) => id === 1)?.name;
    const si = fixture.nativeElement.querySelector(`[aria-label="SI for ${heroName}"]`) as HTMLInputElement;
    const furniture = fixture.nativeElement.querySelector(`[aria-label="Furniture for ${heroName}"]`) as HTMLInputElement;
    const engraving = fixture.nativeElement.querySelector(`[aria-label="Engraving for ${heroName}"]`) as HTMLInputElement;
    si.value = '30';
    si.dispatchEvent(new Event('change'));
    furniture.value = '12';
    furniture.dispatchEvent(new Event('change'));
    engraving.value = '60';
    engraving.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.store.roster()[1]).toEqual({ inv: '3012e60', si: 30, furn: 12, eng: 60 });
    expect(fixture.nativeElement.querySelector('input[placeholder="309e60"]')).toBeNull();

    component.store.updateRosterInvestment(1, '303');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(`[aria-label="Engraving for ${heroName}"]`).value).toBe('0');
    component.rosterInvestmentMode.set('short');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[placeholder="309e60"]').value).toBe('303');
    fixture.destroy();
  });

  it('confirms before clearing hero and pet rosters', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const heroId = component.store.heroes()[0].id;
    const petId = component.store.pets()[0].id;
    component.store.toggleHero(heroId);
    component.confirmClearHeroes();
    expect(component.store.rosterCount()).toBe(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).not.toBeNull();
    component.cancelRosterAction();
    expect(component.store.rosterCount()).toBe(1);
    component.confirmClearHeroes();
    component.confirmRosterAction();
    expect(component.store.rosterCount()).toBe(0);

    component.store.togglePet(petId);
    component.confirmClearPets();
    expect(component.store.petRosterCount()).toBe(1);
    component.confirmRosterAction();
    expect(component.store.petRosterCount()).toBe(0);
    fixture.destroy();
  });

  it('quick-sets hero investments and confirms changes to all pet levels', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '' } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    const heroId = component.store.heroes()[0].id;
    const firstPetId = component.store.pets()[0].id;
    const secondPetId = component.store.pets()[1].id;
    component.store.toggleHero(heroId);

    component.quickSetHeroInvestment(heroId, '409e60');
    expect(component.store.roster()[heroId]).toEqual({ inv: '409e60', si: 40, furn: 9, eng: 60 });
    component.quickSetHeroInvestment(heroId, '309e60');
    expect(component.store.roster()[heroId].inv).toBe('309e60');
    component.quickSetHeroInvestment(heroId, '309e30');
    expect(component.store.roster()[heroId].inv).toBe('309e30');

    component.store.togglePet(firstPetId);
    component.store.togglePet(secondPetId);
    component.store.updatePetLevel(firstPetId, 18);
    component.quickSetPetLevel(15);
    expect(component.rosterConfirmation()?.action).toBe('set-pet-level');
    expect(component.store.petRoster()[firstPetId].level).toBe(18);
    component.cancelRosterAction();
    expect(component.store.petRoster()[firstPetId].level).toBe(18);
    component.quickSetPetLevel(15);
    component.confirmRosterAction();
    expect(component.store.petRoster()[firstPetId].level).toBe(15);
    expect(component.store.petRoster()[secondPetId].level).toBe(15);

    component.selectRosterTab('collections');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="tabpanel"][aria-label="Collections"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Sign in to manage collections saved to your account.');
    fixture.destroy();
  });
});
