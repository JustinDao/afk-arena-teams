import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { SubmitPageComponent } from './features/lineups/pages/submit-page.component';
import { SubmitFromImagePageComponent } from './features/lineups/pages/submit-from-image-page.component';
import { LineupsStore } from './features/lineups/lineups.store';
import { HeroIconService } from './core/hero-icons/hero-icon.service';
import { UserDataService } from './core/data/user-data.service';
import { provideRouter } from '@angular/router';
import { AuthService, DUPLICATE_SIGNUP_MESSAGE } from './core/auth/auth.service';
import { User } from '@supabase/supabase-js';
import { APP_ROUTES } from './app.routes';
import { LineupViewPreferencesService } from './features/lineups/lineup-view-preferences.service';
import { COLLECTION_CATALOG, COLLECTION_NODE_STATS } from './features/lineups/collection-catalog';

describe('SubmitPageComponent', () => {
  it('uses the preferred front-right orientation in the formation editor', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const preferences = TestBed.inject(LineupViewPreferencesService);
    const originalOrientation = preferences.orientation();
    if (preferences.orientation() !== 'front-right') preferences.toggleOrientation();
    const fixture = TestBed.createComponent(SubmitPageComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.formation-board.front-right')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.formation-board.front-right .formation-row.back .formation-slot').length).toBe(3);
    fixture.destroy();
    if (originalOrientation !== 'front-right') preferences.toggleOrientation();
  });

  it('opens the pet slot modal and saves the selected pet and level', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubmitPageComponent);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.pet-slot').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-add-pet-modal')).not.toBeNull();

    const firstPet = TestBed.inject(LineupsStore).pets()[0];
    const petOption = Array.from(fixture.nativeElement.querySelectorAll('app-unit-picker-option button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes(firstPet.name)) as HTMLButtonElement;
    expect(petOption).toBeDefined();
    petOption.click();
    fixture.detectChanges();

    const levelInput = fixture.nativeElement.querySelector('.pet-modal input[type="number"]') as HTMLInputElement;
    levelInput.value = String(firstPet.kind === 'basic' ? 18 : 36);
    levelInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.pet-modal button.primary').click();
    fixture.detectChanges();

    const draftPet = TestBed.inject(LineupsStore).draft()?.forms[0];
    expect(draftPet?.petId).toBe(firstPet.id);
    expect(draftPet?.petLevel).toBe(firstPet.kind === 'basic' ? 18 : 36);
    expect(fixture.nativeElement.querySelector('app-add-pet-modal')).toBeNull();
    fixture.destroy();
  });

  it('lets Treasure Scramble placement type return to the blank placeholder', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubmitPageComponent);
    const store = TestBed.inject(LineupsStore);
    store.changeDraftMode('treasure-scramble');
    fixture.detectChanges();

    const placementType = fixture.nativeElement.querySelector('[formControlName="placementType"]') as HTMLSelectElement;
    expect((placementType.querySelector('option[value=""]') as HTMLOptionElement | null)?.disabled).toBeFalse();
    placementType.value = 'rank';
    placementType.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    placementType.value = '';
    placementType.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.submissionForm.controls.placementType.value).toBe('');
    fixture.destroy();
  });

  it('prefills the Twisted Realm submission RC level from the roster', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const store = TestBed.inject(LineupsStore);
    store.setHeroLevel(600);
    const fixture = TestBed.createComponent(SubmitPageComponent);
    fixture.detectChanges();
    fixture.componentInstance.changeDraftMode('twisted-realm');
    fixture.detectChanges();

    const rcLevel = fixture.nativeElement.querySelector('[formControlName="rcLevel"]') as HTMLInputElement;
    expect(rcLevel.value).toBe('600');
    fixture.destroy();
  });

  it('previews a flexible collection recommendation before any database migration', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: (name: string) => name === 'Begris' ? 'Warrior' : null } },
        {
          provide: UserDataService,
          useValue: {
            configured: false,
            loadCollectionCatalog: async () => ({ catalog: COLLECTION_CATALOG, nodeStats: COLLECTION_NODE_STATS }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubmitPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const store = TestBed.inject(LineupsStore);
    const hero = store.heroes().find(({ name }) => name === 'Begris')!;
    fixture.componentInstance.pickHero(hero.id, 0);
    fixture.componentInstance.openSlot(0);
    expect(fixture.componentInstance.classOfSlot(0)).toBe('Warrior');
    const availableCollections = fixture.componentInstance.catalogForSlot(0);
    expect(availableCollections.length).toBeGreaterThan(0);
    expect(availableCollections.every(({ class: heroClass }) => heroClass === 'Warrior')).toBeTrue();
    store.startDraftCollectionSnapshot(0, fixture.componentInstance.classOfSlot(0));
    store.setDraftCollectionRecommendationMode(0, true);
    fixture.detectChanges();
    const collection = fixture.componentInstance.catalogForSlot(0)[0];
    expect(collection).toBeDefined();
    const levelSelect = fixture.nativeElement.querySelector('.level-field select') as HTMLSelectElement;
    expect(levelSelect.value).toBe('1');
    expect(levelSelect.querySelector('option[value=""]')).toBeNull();
    const attackOptions = Array.from(fixture.nativeElement.querySelectorAll('.recommended-stat-groups fieldset:first-child input[type="checkbox"]')) as HTMLInputElement[];
    for (const option of attackOptions.slice(0, 5)) {
      option.click();
      option.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    }
    expect(store.draft()?.forms[0].slots[0].collectionSnapshot?.recommendation?.attackStats.length).toBe(5);
    expect(attackOptions[5].disabled).toBeTrue();
    store.updateDraftCollectionRecommendation(0, collection!.id, {
      level: 1,
      attackStats: ['erosion', 'mp'],
      defenseStats: [],
    });
    fixture.detectChanges();

    const previewIcon = fixture.nativeElement.querySelector('.preview-collection-icon') as HTMLImageElement;
    expect(previewIcon).not.toBeNull();
    expect(previewIcon.src).toContain(`/${collection!.id}_lvl1_cl.webp`);
    expect(previewIcon.src).not.toContain('_ms');
    expect(fixture.nativeElement.textContent).toContain('EROSION or MP');
    expect(fixture.nativeElement.textContent).toContain('as many as possible');
    fixture.destroy();
  });

  it('does not show a mercenary control when creating a Twisted Realm team', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubmitPageComponent);
    fixture.detectChanges();
    TestBed.inject(LineupsStore).changeDraftMode('twisted-realm');
    fixture.detectChanges();

    const labels = Array.from(fixture.nativeElement.querySelectorAll('label')) as HTMLLabelElement[];
    expect(labels.some((label) => label.textContent?.includes('Mercenary'))).toBeFalse();
    fixture.destroy();
  });

  it('shows an Import from image button on the submit page linking to /submit/from-image', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SubmitPageComponent);
    fixture.detectChanges();

    const importLink = fixture.nativeElement.querySelector('.import-from-image-link') as HTMLAnchorElement | null;
    expect(importLink).not.toBeNull();
    expect(importLink?.textContent).toContain('Import from image');
    expect(importLink?.getAttribute('href')).toBe('/submit/from-image');
    fixture.destroy();
  });

  it('recognizes a guide image on /submit/from-image, allows adjusting alternatives, and applies the lineup to the submit form draft', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitFromImagePageComponent, SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'ascended', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();

    const importFixture = TestBed.createComponent(SubmitFromImagePageComponent);
    const importComp = importFixture.componentInstance;
    importFixture.detectChanges();

    importComp.applyBuiltInSampleRecognition('lydydxhxpyyh1.png', 1920, 1080);
    importFixture.detectChanges();

    expect(importComp.selectedModeSlug()).toBe('nightmare-corridor');
    expect(importComp.selectedTargetName()).toBe('Infernal Overlord');
    expect(importComp.bestMode()?.mode_name).toBe('Nightmare Corridor');
    expect(importComp.bestLineupMatch()?.id).toBe('nc-guide-2026-10-infernal-overlord');
    expect(importComp.formations().length).toBe(6);
    expect(importComp.activeFormation()?.petName).toBe('Blazefang');
    expect(importComp.activeFormation()?.substituteTeams.length).toBeGreaterThan(0);

    // Swap a hero via alternative and apply a substitute team
    importComp.updateSlotHeroByName(2, 'Thalassa');
    expect(importComp.activeFormation()?.heroes[2].heroName).toBe('Thalassa');

    importComp.applySubstituteTeamToActiveRound(1);
    expect(importComp.activeFormation()?.heroes[0].heroName).toBe('Rem');
    expect(importComp.activeFormation()?.petName).toBe('Pandy Dumpty');

    await importComp.applyToSubmitForm();

    const store = TestBed.inject(LineupsStore);
    const draft = store.draft();
    expect(draft).not.toBeNull();
    expect(draft?.mode).toBe('nightmare-corridor');
    expect(draft?.target).toBe('Infernal Overlord');
    expect(draft?.forms.length).toBe(6);
    expect(draft?.forms[0].slots[0].collectionSnapshot?.name).toBe('Captive Wings');
    const slot0Snapshot = draft?.forms[0].slots[0].collectionSnapshot;
    expect(slot0Snapshot?.nodes.find((n) => n.slotIndex === 0)?.stat).toBe('erosion');
    expect(slot0Snapshot?.nodes.find((n) => n.slotIndex === 1)?.stat).toBe('mp');
    expect(slot0Snapshot?.nodes.find((n) => n.slotIndex === 6)?.stat).toBe('skill_level');
    expect(slot0Snapshot?.nodes.find((n) => n.slotIndex === 7)?.stat).toBe('skill_level');
    expect(slot0Snapshot?.recommendation).toBeDefined();
    expect(slot0Snapshot?.recommendation?.level).toBe(3);
    expect(slot0Snapshot?.recommendation?.attackStats).toEqual(['erosion', 'mp']);

    // Verify SubmitPageComponent preserves the imported draft formations on init
    const submitFixture = TestBed.createComponent(SubmitPageComponent);
    submitFixture.detectChanges();
    const preservedDraft = store.draft();
    expect(preservedDraft?.target).toBe('Infernal Overlord');
    expect(preservedDraft?.forms[0].slots[0].hid).not.toBeNull();
    expect(preservedDraft?.forms[0].petId).not.toBeNull();

    importFixture.destroy();
    submitFixture.destroy();
  });

  it('shares formation board and modal components (AddHeroModal, AddPetModal, HeroInvestmentEditor) with submit form', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitFromImagePageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        {
          provide: HeroIconService,
          useValue: {
            initialize: async () => {},
            unitIdFor: () => null,
            iconUrl: () => '',
            framedIconUrl: () => '',
            lowestAscensionFor: () => 'ascended',
            factionFor: () => null,
            classFor: () => null,
          },
        },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SubmitFromImagePageComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.applyBuiltInSampleRecognition('lydydxhxpyyh1.png', 1920, 1080);
    fixture.detectChanges();

    // 1. Formation board has the 2x3 layout (Front 2 slots, Back 3 slots)
    expect(fixture.nativeElement.querySelector('.formation-board')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.formation-row')[0].querySelectorAll('.formation-slot').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.formation-row')[1].querySelectorAll('.formation-slot').length).toBe(3);

    // 2. Pet slot opens AddPetModalComponent
    fixture.nativeElement.querySelector('.pet-slot').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-add-pet-modal')).not.toBeNull();
    comp.closePetModal();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-add-pet-modal')).toBeNull();

    // 3. Clicking occupied hero slot opens slot modal with HeroInvestmentEditorComponent
    comp.openSlot(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.slot-modal')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-hero-investment-editor')).not.toBeNull();

    // 4. Clicking empty slot opens AddHeroModalComponent
    comp.clearSlot(1);
    comp.openSlot(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-add-hero-modal')).not.toBeNull();

    comp.closeSlot();
    fixture.detectChanges();
    fixture.destroy();
  });

  it('updates formation tabs, target options, team count, and mercenary controls when switching mode to Treasure Scramble (TS)', async () => {
    await TestBed.configureTestingModule({
      imports: [SubmitFromImagePageComponent, SubmitPageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'ascended', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();

    const importFixture = TestBed.createComponent(SubmitFromImagePageComponent);
    const importComp = importFixture.componentInstance;
    importFixture.detectChanges();

    importComp.applyBuiltInSampleRecognition('lydydxhxpyyh1.png', 1920, 1080);
    importFixture.detectChanges();
    expect(importComp.formations()[0].label).toBe('Molten Crystalline Worm Queen');
    expect(importComp.allowsMercenary()).toBeTrue();

    // Switch mode to Treasure Scramble (TS)
    importComp.onModeSelect('treasure-scramble');
    importFixture.detectChanges();

    expect(importComp.selectedModeSlug()).toBe('treasure-scramble');
    expect(importComp.selectedTargetName()).toBe('Fire');
    expect(importComp.allowsMercenary()).toBeFalse();
    expect(importComp.formations().map((f) => f.label)).toEqual([
      'Team 1',
      'Team 2',
      'Team 3',
      'Team 4',
      'Team 5',
      'Team 6',
      'Team 7',
    ]);
    expect(importFixture.nativeElement.querySelector('.merc-check')).toBeNull();
    expect(importFixture.nativeElement.querySelector('.substitutes-box')).toBeNull();

    // Adjust TS team count to 5 and back to 7 without losing Team 6
    importComp.onTeamCountChange(5);
    importFixture.detectChanges();
    expect(importComp.formations().length).toBe(5);
    importComp.onTeamCountChange(7);
    importFixture.detectChanges();
    expect(importComp.formations().length).toBe(7);
    expect(importComp.formations()[5].heroes[0].heroName).not.toBe('');

    await importComp.applyToSubmitForm();
    const store = TestBed.inject(LineupsStore);
    const draft = store.draft();
    expect(draft?.mode).toBe('treasure-scramble');
    expect(draft?.target).toBe('Fire');
    expect(draft?.forms.length).toBe(7);
    expect(draft?.forms[0].key).toBe('t1');
    expect(draft?.forms[0].label).toBe('Team 1');

    importFixture.destroy();
  });

  it('correctly imports 7-team Treasure Scramble guide (yxqjrbg71c1i1.png) and matches TS lineup without NC leftovers', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent, SubmitFromImagePageComponent],
      providers: [
        provideRouter(APP_ROUTES),
        { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'ascended', factionFor: () => null, classFor: () => null } },
        { provide: UserDataService, useValue: { configured: false } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SubmitFromImagePageComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.applyBuiltInSampleRecognition('yxqjrbg71c1i1.png', 3000, 6000);
    fixture.detectChanges();

    expect(comp.selectedModeSlug()).toBe('treasure-scramble');
    expect(comp.selectedTargetName()).toBe('Fire');
    expect(comp.formations().length).toBe(7);
    expect(comp.formations().map((f) => f.label)).toEqual([
      'Team 1',
      'Team 2',
      'Team 3',
      'Team 4',
      'Team 5',
      'Team 6',
      'Team 7',
    ]);
    expect(comp.bestLineupMatch()?.mode_slug).toBe('treasure-scramble');
    expect(comp.bestLineupMatch()?.title).toContain('Treasure Scramble');
    expect(comp.roundAlignmentPrefix(1)).toBe('Team 1');
    expect(comp.isCandidateActive('treasure-scramble', 'Fire')).toBeTrue();
    expect(comp.isCandidateActive('nightmare-corridor', 'Infernal Overlord')).toBeFalse();

    fixture.destroy();
  });

  describe('AppComponent account form', () => {
    it('blocks short passwords with a clear minimum-length validation', async () => {
      await TestBed.configureTestingModule({
        imports: [AppComponent],
        providers: [
          provideRouter(APP_ROUTES),
          { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
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
        initialize: async () => {},
        onUserChange: () => () => {},
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
          { provide: HeroIconService, useValue: { initialize: async () => {}, unitIdFor: () => null, iconUrl: () => '', framedIconUrl: () => '', lowestAscensionFor: () => 'epic', factionFor: () => null, classFor: () => null } },
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
});
