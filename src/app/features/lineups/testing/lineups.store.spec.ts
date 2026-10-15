import { TestBed } from '@angular/core/testing';
import { LineupsStore } from '../lineups.store';
import { SAMPLE_SUBMISSIONS } from '../lineup-data';
import { resultLine } from '../lineup-display';
import { UserDataService } from '../../../core/data/user-data.service';
import { AuthService } from '../../../core/auth/auth.service';
import { HEROES, HERO_BY_NAME, PETS } from '../lineup-data';
import { MODES } from '../models';
import { User } from '@supabase/supabase-js';

describe('LineupsStore', () => {
  let store: LineupsStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: UserDataService, useValue: { configured: false } }],
    });
    store = TestBed.inject(LineupsStore);
  });

  it('lists submissions by active mode and selected target', () => {
    expect(store.visibleSubmissions().length).toBe(1);
    store.setTarget('Netherspinner');
    expect(store.visibleSubmissions().map(({ submission }) => submission.target)).toEqual(['Netherspinner']);
  });

  it('shows partial matches when roster matching is enabled', () => {
    store.toggleHero(0);
    store.setMatch('partial');
    expect(store.visibleSubmissions().length).toBe(1);
    expect(store.visibleSubmissions().every(({ gap }) => gap > 0)).toBeTrue();
  });

  it('persists votes to browser storage', () => {
    const submissionId = store.visibleSubmissions()[0].submission.id;
    store.toggleVote(submissionId);
    expect(JSON.parse(localStorage.getItem('ll.votes') ?? '[]')).toContain(submissionId);
  });

  it('stores a shared hero level and separate owned pet levels', () => {
    store.setHeroLevel(450);
    store.togglePet(6019);
    store.updatePetLevel(6019, 18);

    expect(store.heroLevel()).toBe(450);
    expect(store.petRoster()[6019]).toEqual({ level: 18 });
    expect(JSON.parse(localStorage.getItem('ll.heroLevel') ?? 'null')).toBe(450);
    expect(JSON.parse(localStorage.getItem('ll.pets') ?? '{}')['6019']).toEqual({ level: 18 });
  });

  it('updates independent roster investment values and preserves additional furniture', () => {
    store.toggleHero(1);
    expect(store.updateRosterInvestmentPart(1, 'si', 30)).toBeTrue();
    expect(store.updateRosterInvestmentPart(1, 'furn', 12)).toBeTrue();
    expect(store.updateRosterInvestmentPart(1, 'eng', 60)).toBeTrue();

    expect(store.roster()[1]).toEqual({ inv: '3012e60', si: 30, furn: 12, eng: 60 });
    expect(store.updateRosterInvestmentPart(1, 'furn', 13)).toBeFalse();
    expect(store.roster()[1].furn).toBe(12);
    expect(store.updateRosterInvestment(1, '3099e60')).toBeFalse();
    expect(store.roster()[1].furn).toBe(12);

    expect(store.updateRosterInvestment(1, '303')).toBeTrue();
    expect(store.roster()[1]).toEqual({ inv: '303', si: 30, furn: 3, eng: 0 });

    store.updateRosterInvestmentPart(1, 'si', null);
    expect(store.roster()[1]).toEqual({ inv: '--3e0', si: null, furn: 3, eng: 0 });
  });

  it('accepts the maximum SI and furniture values and rejects values above the limits', () => {
    store.toggleHero(1);
    expect(store.updateRosterInvestmentPart(1, 'si', 50)).toBeTrue();
    expect(store.updateRosterInvestmentPart(1, 'furn', 36)).toBeTrue();
    expect(store.roster()[1]).toEqual({ inv: '5036e0', si: 50, furn: 36, eng: 0 });

    expect(store.updateRosterInvestmentPart(1, 'si', 51)).toBeFalse();
    expect(store.updateRosterInvestmentPart(1, 'furn', 37)).toBeFalse();
    expect(store.roster()[1]).toEqual({ inv: '5036e0', si: 50, furn: 36, eng: 0 });
  });

  it('resets incompatible investments to 0 when ascension drops in roster', () => {
    store.toggleHero(1);
    store.updateRosterAscension(1, 'ascended_1');
    store.updateRosterInvestment(1, '309e60');
    expect(store.roster()[1]).toEqual({ inv: '309e60', ascension: 'ascended_1', si: 30, furn: 9, eng: 60 });

    // Downgrading to Ascended (0 stars) removes engraving (set to 0)
    store.updateRosterAscension(1, 'ascended');
    expect(store.roster()[1].ascension).toBe('ascended');
    expect(store.roster()[1].eng).toBe(0);
    expect(store.roster()[1].furn).toBe(9);
    expect(store.roster()[1].si).toBe(30);
    expect(store.roster()[1].inv).toBe('309e0');

    // Downgrading to Mythic removes furniture and engraving (set to 0)
    store.updateRosterAscension(1, 'mythic');
    expect(store.roster()[1].ascension).toBe('mythic');
    expect(store.roster()[1].eng).toBe(0);
    expect(store.roster()[1].furn).toBe(0);
    expect(store.roster()[1].si).toBe(30);
    expect(store.roster()[1].inv).toBe('300e0');

    // Downgrading to Legendary removes SI, furniture, and engraving
    store.updateRosterAscension(1, 'legendary');
    expect(store.roster()[1].ascension).toBe('legendary');
    expect(store.roster()[1].eng).toBe(0);
    expect(store.roster()[1].furn).toBe(0);
    expect(store.roster()[1].si).toBe(0);
    expect(store.roster()[1].inv).toBe('000e0');
  });

  it('prefills selected lineup pets with the owned pet level and requires pet ownership to match', () => {
    store.setTarget('Netherspinner');
    store.selectAllHeroes();
    store.setMatch('partial');
    const lineup = store.visibleSubmissions()[0];

    expect(lineup.missingPetNames.length).toBe(6);
    expect(lineup.missingPetNames).toContain('Pandy Dumpty');
    expect(lineup.gap).toBe(6);

    store.togglePet(6019);
    store.updatePetLevel(6019, 18);
    store.openDraft();
    store.updateDraftPet(6019);

    expect(store.draft()?.forms[0].petLevel).toBe(18);
    expect(store.visibleSubmissions()[0].missingPetNames).not.toContain('Pandy Dumpty');
    expect(store.visibleSubmissions()[0].gap).toBe(5);
  });

  it('starts Treasure Scramble with seven teams and prevents cross-team hero repeats', () => {
    store.openDraft();
    store.changeDraftMode('treasure-scramble');
    expect(store.draft()?.forms.length).toBe(7);

    store.pickHero(0);
    store.selectFormation(1);
    expect(store.heroAlreadySelected(0)).toBeTrue();
    store.pickHero(0);
    expect(store.draft()?.forms[1].slots.every(({ hid }) => hid === null)).toBeTrue();
  });

  it('includes a pet on every team in each Cursed Realm example', () => {
    const cursedExamples = SAMPLE_SUBMISSIONS.filter(({ mode }) => mode === 'cursed-realm');
    expect(cursedExamples.length).toBeGreaterThan(0);
    for (const example of cursedExamples) {
      expect(example.forms.every(({ petId, petLevel }) => petId !== null && petLevel !== null)).toBeTrue();
      expect(example.forms.flatMap(({ heroes }) => heroes).filter(({ merc }) => merc).length).toBeLessThanOrEqual(1);
    }
  });

  it('includes a pet and level on every Twisted Realm and Treasure Scramble example team', () => {
    const examples = SAMPLE_SUBMISSIONS.filter(({ mode }) => mode === 'twisted-realm' || mode === 'treasure-scramble');
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example.forms.every(({ petId, petLevel }) => petId !== null && petLevel !== null)).toBeTrue();
    }
  });

  it('groups six named Nightmare Corridor bosses under the sixth-boss cycle anchor', () => {
    const example = SAMPLE_SUBMISSIONS.find(({ mode }) => mode === 'nightmare-corridor');
    expect(example?.target).toBe('Netherspinner');
    expect(example?.forms.map(({ label }) => label)).toEqual([
      'Soulweaver',
      'The Devourer',
      'Astral Devourer',
      'Dual-Mantle',
      'Cursed Caprihornus',
      'Netherspinner',
    ]);
    expect(example?.forms.every(({ timeSeconds }) => timeSeconds !== null && timeSeconds > 0)).toBeTrue();
    expect(example?.forms.flatMap(({ heroes }) => heroes).filter(({ merc }) => merc).length).toBeLessThanOrEqual(1);
  });

  it('creates Nightmare Corridor teams from the selected cycle anchor', () => {
    store.openDraft();
    expect(store.draft()?.target).toBe('Netherspinner');
    expect(store.draft()?.forms.map(({ label }) => label)).toEqual([
      'Soulweaver',
      'The Devourer',
      'Astral Devourer',
      'Dual-Mantel',
      'Cursed Caprihornus',
      'Netherspinner',
    ]);
  });

  it('records Resonating Crystal level for Twisted Realm and uses TS placement as its metric', () => {
    const twistedRealm = SAMPLE_SUBMISSIONS.filter(({ mode }) => mode === 'twisted-realm');
    expect(twistedRealm.every(({ heroLevel }) => heroLevel !== null)).toBeTrue();
    expect(twistedRealm.flatMap(({ forms }) => forms.flatMap(({ heroes }) => heroes)).every(({ merc }) => !merc)).toBeTrue();

    const treasureExamples = SAMPLE_SUBMISSIONS.filter(({ mode }) => mode === 'treasure-scramble');
    expect(treasureExamples.map(resultLine)).toEqual(['Top 1%', 'Rank 37']);
  });

  it('keeps custom collection builds as submission snapshots without adding them to roster inventory', async () => {
    store.openDraft();
    store.changeDraftMode('twisted-realm');
    store.setHeroLevel(600);
    store.updateDraftTarget('Kane');
    store.heroes().slice(0, 5).forEach(({ id }) => store.pickHero(id));
    store.startDraftCollectionSnapshot(0);
    store.updateDraftCollectionSnapshot(0, 1, [{ slotIndex: 0, stat: 'atk', tier: 'mythic' }]);

    await store.submitDraft({
      target: 'Kane',
      notes: '',
      damage: '100M',
      placementType: 'rank',
      placementValue: '',
    });

    const submission = store.submissions()[0];
    expect(submission.forms[0].heroes[0].collection).toEqual({
      catalogId: 1,
      name: 'Temporal Cover',
      class: 'Warrior',
      nodes: [{ slotIndex: 0, stat: 'atk', tier: 'mythic' }],
    });
    expect(store.collections()).toEqual([]);
  });

  it('limits mercenaries immediately across the full lineup and validates TS placement', async () => {
    store.openDraft();
    store.changeDraftMode('nightmare-corridor');
    store.updateDraftTarget('Netherspinner');
    fillDraft(store);
    store.updateDraftFormationField('mercenary', true, 0);
    expect(store.draft()?.forms.at(-1)?.slots[0].merc).toBeTrue();
    store.selectFormation(1);
    expect(store.mercenaryLimitReached(0)).toBeTrue();
    store.updateDraftFormationField('mercenary', true, 0);
    expect(store.draft()?.forms[1].slots[0].merc).toBeFalse();
    expect(store.toast()).toContain('Only 1 mercenary');
    await store.submitDraft({
      target: 'Netherspinner',
      notes: '',
      damage: '',
      placementType: 'rank',
      placementValue: '',
    });
    expect(store.draftErrors()).toEqual([]);

    store.changeDraftMode('treasure-scramble');
    fillDraft(store);
    store.updateDraftFormationField('mercenary', true, 0);
    await store.submitDraft({
      target: 'Fire',
      notes: '',
      damage: '',
      placementType: 'rank',
      placementValue: '101',
    });
    expect(store.draftErrors()).toContain('Mercenaries are not allowed in this mode.');
    expect(store.draftErrors()).toContain('Enter a whole-number placement rank from 1 to 100.');
  });
});

describe('LineupsStore account data loading', () => {
  let store: LineupsStore;
  let data: jasmine.SpyObj<UserDataService>;

  beforeEach(() => {
    data = jasmine.createSpyObj<UserDataService>('UserDataService', [
      'loadReferenceData', 'loadSubmissions', 'loadRoster', 'loadVotes',
      'loadPetRoster', 'loadHeroLevel', 'loadCollections', 'replaceRoster',
    ]);
    Object.defineProperty(data, 'configured', { value: true });
    data.loadReferenceData.and.resolveTo({ modes: MODES, heroes: HEROES, pets: PETS });
    data.loadSubmissions.and.resolveTo([]);
    data.loadRoster.and.resolveTo({ 1: { inv: '' } });
    data.loadVotes.and.resolveTo([]);
    data.loadPetRoster.and.resolveTo({});
    data.loadHeroLevel.and.resolveTo(null);
    data.loadCollections.and.resolveTo([]);
    TestBed.configureTestingModule({
      providers: [
        { provide: UserDataService, useValue: data },
        { provide: AuthService, useValue: {} },
      ],
    });
    store = TestBed.inject(LineupsStore);
  });

  it('keeps base and awakened hero records distinct in the sample catalog', () => {
    expect(HERO_BY_NAME.get('Belinda')?.isAwakened).toBeFalse();
    expect(HERO_BY_NAME.get('Belinda (Awakened)')?.isAwakened).toBeTrue();
    expect(HERO_BY_NAME.get('Belinda')?.id).not.toBe(HERO_BY_NAME.get('Belinda (Awakened)')?.id);
  });

  it('loads only owned heroes and votes on the main page, then fetches extra data on demand once', async () => {
    const user = { id: 'test-user' } as User;
    data.loadRoster.and.resolveTo({ 1: { inv: '', ascension: 'ascended_5' } });
    await store.initializeBackend(user);

    expect(data.loadRoster).toHaveBeenCalledTimes(1);
    expect(store.roster()[1].ascension).toBe('ascended_5');
    expect(data.loadVotes).toHaveBeenCalledTimes(1);
    expect(data.loadPetRoster).not.toHaveBeenCalled();
    expect(data.loadHeroLevel).not.toHaveBeenCalled();
    expect(data.loadCollections).not.toHaveBeenCalled();

    await store.loadRosterDetails();
    await store.loadRosterDetails();
    expect(data.loadPetRoster).toHaveBeenCalledTimes(1);
    expect(data.loadHeroLevel).toHaveBeenCalledTimes(1);

    await store.loadCollections();
    await store.loadCollections();
    expect(data.loadCollections).toHaveBeenCalledTimes(1);
  });

  it('serializes roster saves so an older update cannot overwrite a newer ascension', async () => {
    await store.initializeBackend({ id: 'test-user' } as User);
    let finishFirstSave!: () => void;
    data.replaceRoster.and.returnValues(
      new Promise<void>((resolve) => { finishFirstSave = resolve; }),
      Promise.resolve(),
    );

    store.updateRosterAscension(1, 'mythic');
    store.updateRosterAscension(1, 'ascended_2');
    expect(data.replaceRoster).toHaveBeenCalledTimes(1);
    expect(data.replaceRoster.calls.argsFor(0)[0][1].ascension).toBe('mythic');

    finishFirstSave();
    await Promise.resolve();
    await Promise.resolve();

    expect(data.replaceRoster).toHaveBeenCalledTimes(2);
    expect(data.replaceRoster.calls.argsFor(1)[0][1].ascension).toBe('ascended_2');
  });

  it('sorts heroes by their displayed names after loading reference data', async () => {
    data.loadReferenceData.and.resolveTo({
      modes: MODES,
      heroes: [
        { id: 1, name: 'Rowan' },
        { id: 2, name: 'Ezizh', isAwakened: true },
        { id: 3, name: 'Ezizh' },
      ],
      pets: PETS,
    });

    await store.initializeBackend(null);

    expect(store.heroes().map((hero) => `${hero.name}${hero.isAwakened ? ' (Awakened)' : ''}`)).toEqual([
      'Ezizh',
      'Ezizh (Awakened)',
      'Rowan',
    ]);
  });
});

function fillDraft(store: LineupsStore): void {
  let heroIndex = 0;
  const teamCount = store.draft()?.forms.length ?? 0;
  for (let formIndex = 0; formIndex < teamCount; formIndex++) {
    store.selectFormation(formIndex);
    store.updateDraftTime('2:00');
    for (let slotIndex = 0; slotIndex < 5; slotIndex++) {
      const hero = store.heroes()[heroIndex++];
      if (!hero) throw new Error('Not enough heroes to fill the test lineup.');
      store.pickHero(hero.id);
    }
  }
}
