import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { APP_ROUTES } from '../../../../app.routes';
import { UserDataService } from '../../../../core/data/user-data.service';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { COLLECTION_CATALOG, COLLECTION_NODE_STATS, collectionIconUrl, collectionNodeIconUrl } from '../../collection-catalog';
import { heroAttributeFromValue } from '../../hero-classification';
import { rosterClassFilterColor } from '../../roster-filter-colors';
import { LineupsStore } from '../../lineups.store';
import { RosterCollectionsComponent } from './roster-collections.component';
import { RosterHeroesComponent } from './roster-heroes.component';
import { RosterPetsComponent } from './roster-pets.component';

async function setup(): Promise<void> {
  await TestBed.configureTestingModule({
    providers: [
      provideRouter(APP_ROUTES),
      {
        provide: HeroIconService,
        useValue: {
          initialize: async () => {},
          unitIdFor: () => 52,
          iconUrl: (id: number) => `https://cdn/unit_icon_by_id/${id}.webp`,
          framedIconUrl: (id: number, rank: string) => `https://cdn/framed_unit_icon/${id}_${rank}.webp`,
          factionFor: (name: string) => name === 'Rowan' ? 'Lightbearer' : 'Wilder',
          classFor: (name: string) => name === 'Rowan' ? 'Mage' : 'Ranger',
        },
      },
      { provide: UserDataService, useValue: { configured: false } },
    ],
  }).compileComponents();
}

describe('roster pages', () => {
  beforeEach(setup);

  it('accepts only explicit strength, agility, and intelligence attributes', () => {
    expect(heroAttributeFromValue('strength')).toBe('strength');
    expect(heroAttributeFromValue('Agility')).toBe('agility');
    expect(heroAttributeFromValue('INTELLIGENCE')).toBe('intelligence');
    expect(heroAttributeFromValue('Warrior')).toBeNull();
    expect(heroAttributeFromValue(null)).toBeNull();
  });

  it('selects the first alphabetized collection by default', () => {
    const fixture = TestBed.createComponent(RosterCollectionsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const firstCollection = [...component.collectionCatalog()].sort((left, right) =>
      left.name.localeCompare(right.name),
    )[0];

    expect(component.collectionForm.controls.catalogId.value).toBe(firstCollection.id);
  });

  it('renders collection choice button with centered content and icon', () => {
    const fixture = TestBed.createComponent(RosterCollectionsComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const choice = element.querySelector('.collection-choice') as HTMLElement | null;
    expect(choice).not.toBeNull();
    const icon = choice?.querySelector('.collection-icon') as HTMLImageElement | null;
    expect(icon).not.toBeNull();
  });

  it('routes /roster to heroes and gives each tab its own URL', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);

    await harness.navigateByUrl('/roster');
    expect(router.url).toBe('/roster/heroes');
    expect(harness.routeNativeElement?.querySelector('[aria-label="Heroes"]')).not.toBeNull();

    await harness.navigateByUrl('/roster/pets');
    expect(harness.routeNativeElement?.querySelector('[aria-label="Pets"]')).not.toBeNull();

    await harness.navigateByUrl('/roster/collections');
    expect(harness.routeNativeElement?.querySelector('[aria-label="Collections"]')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('Sign in to manage collections saved to your account.');
  });

  it('keeps short mode aliases and mode state synchronized with the URL', async () => {
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    const store = TestBed.inject(LineupsStore);

    await harness.navigateByUrl('/tr');
    expect(router.url).toBe('/twisted-realm');
    expect(store.mode()).toBe('twisted-realm');
    await harness.navigateByUrl('/ts');
    expect(router.url).toBe('/treasure-scramble');
    expect(store.mode()).toBe('treasure-scramble');
    expect(harness.routeNativeElement?.textContent).not.toContain('Add the heroes you own to filter lineups');
  });

  it('lets roster investments switch between compact and separate-column editing', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/heroes', RosterHeroesComponent);
    const store = TestBed.inject(LineupsStore);
    component.investmentMode.set('long');
    store.clearRoster();
    store.toggleHero(1);
    store.updateRosterAscension(1, 'ascended_1');
    harness.detectChanges();
    const root: HTMLElement = harness.routeNativeElement as HTMLElement;

    expect(root.querySelector('.roster-page')).not.toBeNull();
    expect(root.textContent).toContain('Back to lineups');
    const heroName = store.heroes().find(({ id }) => id === 1)?.name;
    const field = (label: string) => root.querySelector(`[aria-label="${label} for ${heroName}"]`) as HTMLInputElement;
    for (const [label, value] of [['SI', '30'], ['Furniture', '12'], ['Engraving', '60']]) {
      field(label).value = value;
      field(label).dispatchEvent(new Event('change'));
      harness.detectChanges();
    }

    expect(store.roster()[1]).toEqual({ inv: '3012e60', si: 30, furn: 12, eng: 60, ascension: 'ascended_1' });
    expect(root.querySelector('input[placeholder="309e60"]')).toBeNull();

    store.updateRosterInvestment(1, '303');
    harness.detectChanges();
    expect(field('Engraving').value).toBe('0');
    component.investmentMode.set('short');
    harness.detectChanges();
    expect((root.querySelector('input[placeholder="309e60"]') as HTMLInputElement).value).toBe('303');
  });

  it('saves hero ascension rank separately from investment stats', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/heroes', RosterHeroesComponent);
    const store = TestBed.inject(LineupsStore);
    store.toggleHero(1);
    store.updateRosterInvestment(1, '209e60');
    store.updateRosterAscension(1, 'ascended_2');

    expect(store.roster()[1]).toEqual({
      inv: '209e60',
      si: 20,
      furn: 9,
      eng: 60,
      ascension: 'ascended_2',
    });
    harness.detectChanges();
    const ascension = harness.routeNativeElement?.querySelector(`select[aria-label="Ascension for ${store.heroName(1)}"]`) as HTMLSelectElement;
    expect(ascension.value).toBe('ascended_2');
    expect(harness.routeNativeElement?.querySelector('.hero-icon.large')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('.hero-icon.large.framed')).not.toBeNull();
    const icon = harness.routeNativeElement?.querySelector('.hero-icon.large') as HTMLElement;
    const image = icon.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toContain('52_ascended_2.webp');
    image.dispatchEvent(new Event('error'));
    harness.detectChanges();
    expect(icon.classList.contains('framed')).toBeFalse();
    expect(image.getAttribute('src')).toContain('/unit_icon_by_id/52.webp');
  });

  it('gates investment fields by ascension and offers rank quick sets', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/heroes', RosterHeroesComponent);
    const store = TestBed.inject(LineupsStore);
    store.toggleHero(1);
    component.investmentMode.set('long');
    harness.detectChanges();

    const root = harness.routeNativeElement as HTMLElement;
    const input = (label: string) => root.querySelector(`input[aria-label="${label} for ${store.heroName(1)}"]`) as HTMLInputElement;
    const rank = root.querySelector(`select[aria-label="Ascension for ${store.heroName(1)}"]`) as HTMLSelectElement;
    expect(root.querySelector('.investment-field h4')?.textContent).toContain('Investment');
    expect(input('SI').disabled).toBeTrue();
    expect(input('Furniture').disabled).toBeTrue();
    expect(input('Engraving').disabled).toBeTrue();

    rank.value = 'mythic';
    rank.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(input('SI').disabled).toBeFalse();
    expect(input('Furniture').disabled).toBeTrue();
    expect(input('Engraving').disabled).toBeTrue();
    component.investmentMode.set('short');
    harness.detectChanges();
    const shortCode = root.querySelector(`input[aria-label="Investment for ${store.heroName(1)}"]`) as HTMLInputElement;
    shortCode.value = '30e60';
    shortCode.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Engraving requires Ascended 1 star');
    expect(store.roster()[1].inv).toBe('');

    component.investmentMode.set('long');
    harness.detectChanges();
    rank.value = 'ascended_1';
    rank.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(input('Furniture').disabled).toBeFalse();
    expect(input('Engraving').disabled).toBeFalse();
    expect(root.textContent).toContain('A1★');
    expect(root.textContent).toContain('A5★');

    component.investmentMode.set('short');
    harness.detectChanges();
    const ascendedShortCode = root.querySelector(`input[aria-label="Investment for ${store.heroName(1)}"]`) as HTMLInputElement;
    ascendedShortCode.value = '309e60';
    ascendedShortCode.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(store.roster()[1].inv).toBe('309e60');
  });

  it('promotes a hero to Ascended 1 star before applying an investment quick set', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/heroes', RosterHeroesComponent);
    const store = TestBed.inject(LineupsStore);
    store.toggleHero(1);
    harness.detectChanges();

    const root = harness.routeNativeElement as HTMLElement;
    const investmentQuickSet = root.querySelector(`[aria-label="Quick set investment for ${store.heroName(1)}"] button`) as HTMLButtonElement;
    investmentQuickSet.click();
    harness.detectChanges();

    expect(store.roster()[1].ascension).toBe('ascended_1');
    expect(store.roster()[1].inv).toBe('409e60');
  });

  it('confirms before clearing the hero roster and quick-sets investments', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/heroes', RosterHeroesComponent);
    const store = TestBed.inject(LineupsStore);
    const heroId = store.heroes()[0].id;
    store.toggleHero(heroId);
    component.confirmingClear.set(true);
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(store.rosterCount()).toBe(1);
    component.confirmClear();
    expect(store.rosterCount()).toBe(0);

    store.toggleHero(heroId);
    component.quickSet(heroId, '409e60');
    expect(store.roster()[heroId]).toEqual({ inv: '409e60', si: 40, furn: 9, eng: 60 });
    component.quickSet(heroId, '309e30');
    expect(store.roster()[heroId].inv).toBe('309e30');
  });

  it('filters heroes by faction, class, and attribute type', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/heroes', RosterHeroesComponent);
    const root = harness.routeNativeElement as HTMLElement;
    component.setFaction('Lightbearer');
    component.setClass('Mage');
    component.setType('intelligence');
    harness.detectChanges();
    expect(root.querySelector('.roster-pick')?.textContent).toContain('Rowan');
    expect(root.querySelector('.roster-pick')?.textContent).not.toContain('Lyca');

    component.setFaction('Wilder');
    harness.detectChanges();
    expect(root.querySelector('.roster-pick')?.textContent).not.toContain('Rowan');
    expect(component.factions()).toContain('Lightbearer');
    expect(component.classes).toContain('Mage');
    expect(component.classes).toEqual(['Warrior', 'Tank', 'Ranger', 'Mage', 'Support']);
    expect(root.querySelector('[aria-label="Filter heroes"] .icon-filter-row')).not.toBeNull();
    expect(component.filterToken('faction', 'Lightbearer')).toBe('LB');
    expect(component.filterColor('faction', 'Lightbearer')).toBe('#83cfff');
    expect(component.filterColor('faction', 'Graveborn')).toBe('#24613b');
    expect(component.filterColor('class', 'Mage')).toBe('#6b9ee8');
    expect(component.factionColor({ name: 'Rowan' })).toBe('#83cfff');
  });

  it('shows awakened and non-awakened heroes together in the roster picker', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/roster/heroes', RosterHeroesComponent);
    const store = TestBed.inject(LineupsStore);
    const root = harness.routeNativeElement as HTMLElement;

    expect(store.heroes().some(({ name, isAwakened }) => name === 'Lyca' && !isAwakened)).toBeTrue();
    const displayedHeroes = Array.from(root.querySelectorAll('.roster-pick button'), ({ textContent }) => textContent?.trim());
    expect(displayedHeroes).toContain('Lyca (Awakened)');
    expect(displayedHeroes).toContain('Lyca');
    expect(root.querySelector('[aria-label="Awakened status"]')).toBeNull();
  });

  it('confirms before clearing pets or changing all pet levels', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/pets', RosterPetsComponent);
    const store = TestBed.inject(LineupsStore);
    const [first, second] = store.pets();
    store.togglePet(first.id);
    store.togglePet(second.id);
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('.pet-roster-pick app-hero-icon .hero-icon.small')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('.pet-quick-set button.mat-mdc-outlined-button')).not.toBeNull();
    store.updatePetLevel(first.id, 18);
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('.extra-hero app-hero-icon .hero-icon.small')).not.toBeNull();

    component.quickSetLevel(15);
    expect(component.confirmation()?.action).toBe('set-level');
    expect(store.petRoster()[first.id].level).toBe(18);
    component.confirmation.set(null);
    component.quickSetLevel(15);
    component.confirm();
    expect(store.petRoster()[first.id].level).toBe(15);
    expect(store.petRoster()[second.id].level).toBe(15);

    component.confirmClear();
    expect(store.petRosterCount()).toBe(2);
    component.confirm();
    expect(store.petRosterCount()).toBe(0);
    expect(store.pets().filter(({ kind }) => kind === 'basic').map(({ id }) => id)).toEqual([6001, 6002, 6003]);
    expect(store.pets().filter(({ kind }) => kind === 'awakened').map(({ id }) => id)).toEqual([6027, 6028, 6029, 6030]);
    expect(store.pets().filter(({ kind }) => kind === 'standard').length).toBe(23);
  });

  it('offers collection icons and three attack, three defense, and two flex node slots', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/collections', RosterCollectionsComponent);

    expect(component.collectionCatalog().length).toBe(20);
    expect(component.collectionCatalog().map(({ name }) => name)).toEqual(
      [...component.collectionCatalog().map(({ name }) => name)].sort((a, b) => a.localeCompare(b)),
    );
    const collectionClass = component.collectionCatalog()[0].class;
    expect(component.collectionClassColor(collectionClass)).toBe(rosterClassFilterColor(collectionClass));
    component.setCollectionClass(collectionClass);
    expect(component.filteredCollectionCatalog().every(({ class: value }) => value === collectionClass)).toBeTrue();
    expect(component.filteredCollectionCatalog().some(({ id }) => id === component.collectionForm.controls.catalogId.value)).toBeTrue();
    component.collectionClassFilter.set('');
    expect(new Set(COLLECTION_CATALOG.map(({ id }) => id)).size).toBe(20);
    expect(COLLECTION_NODE_STATS.length).toBe(26);
    expect(component.collectionNodeStats()).toContain('skill_level');
    expect(component.collectionNodeSlots.map(({ category, indices }) => [category, indices.length])).toEqual([
      ['Attack', 3],
      ['Defense', 3],
      ['Flex', 2],
    ]);
    expect(collectionIconUrl(1, 2)).toBe(
      'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/1_lvl2_cl.webp',
    );
    expect(collectionNodeIconUrl('atk', 'mythic')).toBe(
      'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_stats_icon/atk_m.webp',
    );
    component.updateCollectionNodeStat(0, 'atk');
    expect(component.collectionNodeAt(0)?.tier).toBe('mythic');
    component.updateCollectionNodeTier(0, 'legendary');
    expect(component.collectionNodeAt(0)?.tier).toBe('legendary');
    component.updateCollectionNodeStat(7, 'skill_level');
    component.updateCollectionNodeTier(7, 'elite');
    expect(component.collectionNodeAt(7)).toEqual({ slotIndex: 7, stat: 'skill_level', tier: 'mythic' });
    expect(component.collectionNodeStatsForSlot(0)).not.toContain('skill_level');
    expect(component.collectionNodeStatsForSlot(6)).toContain('skill_level');
    component.removeCollectionNode(7);
    expect(component.collectionNodeAt(7)).toBeUndefined();
  });
});
