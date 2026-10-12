import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { APP_ROUTES } from '../../../../app.routes';
import { UserDataService } from '../../../../core/data/user-data.service';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { COLLECTION_CATALOG, COLLECTION_NODE_STATS, collectionIconUrl, collectionNodeIconUrl } from '../../collection-catalog';
import { heroAttributeFromValue } from '../../hero-classification';
import { rosterClassFilterColor } from '../../roster-filter-colors';
import { isAwakenedPet } from '../../pet-classification';
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
          unitIdFor: () => null,
          iconUrl: () => '',
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
    harness.detectChanges();
    const root: HTMLElement = harness.routeNativeElement as HTMLElement;

    expect(root.querySelector('.roster-page')).not.toBeNull();
    expect(root.textContent).toContain('Back to lineups');
    const heroName = store.heroes().find(({ id }) => id === 1)?.name;
    const field = (label: string) => root.querySelector(`[aria-label="${label} for ${heroName}"]`) as HTMLInputElement;
    for (const [label, value] of [['SI', '30'], ['Furniture', '12'], ['Engraving', '60']]) {
      field(label).value = value;
      field(label).dispatchEvent(new Event('change'));
    }
    harness.detectChanges();

    expect(store.roster()[1]).toEqual({ inv: '3012e60', si: 30, furn: 12, eng: 60 });
    expect(root.querySelector('input[placeholder="309e60"]')).toBeNull();

    store.updateRosterInvestment(1, '303');
    harness.detectChanges();
    expect(field('Engraving').value).toBe('0');
    component.investmentMode.set('short');
    harness.detectChanges();
    expect((root.querySelector('input[placeholder="309e60"]') as HTMLInputElement).value).toBe('303');
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

  it('confirms before clearing pets or changing all pet levels', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/roster/pets', RosterPetsComponent);
    const store = TestBed.inject(LineupsStore);
    const [first, second] = store.pets();
    store.togglePet(first.id);
    store.togglePet(second.id);
    store.updatePetLevel(first.id, 18);

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
    expect(component.petKind({ id: 6001, isAwakened: false })).toBe('basic');
    expect(component.petKind({ id: 6004, isAwakened: false })).toBe('regular');
    expect(component.petKind({ id: 6004, isAwakened: true })).toBe('awakened');
    for (const name of ['Blazefang', 'Count Snickerfang', 'nightfall pegasus', 'twinlum spirit']) {
      expect(component.petKind({ id: 6004, name, isAwakened: false })).toBe('awakened');
      expect(isAwakenedPet(name)).toBeTrue();
    }
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
