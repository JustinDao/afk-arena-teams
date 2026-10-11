import { computed, inject, Injectable, signal } from '@angular/core';
import { User } from '@supabase/supabase-js';
import { AuthService } from '../../core/auth/auth.service';
import { UserDataService } from '../../core/data/user-data.service';
import {
  CollectionInventoryItem,
  CollectionCatalogItem,
  CollectionNodeStat,
  DraftFormation,
  DraftSlot,
  EvaluatedFormation,
  EvaluatedSubmission,
  FORMATION_LAYOUT,
  Hero,
  HeroStatus,
  LineupDraft,
  ModeConfig,
  MODES,
  Pet,
  PetRosterEntry,
  RosterEntry,
  Submission,
  SubmissionFormValue,
} from './models';
import { HEROES, HERO_BY_ID, PETS, SAMPLE_SUBMISSIONS } from './lineup-data';
import { COLLECTION_CATALOG } from './collection-catalog';
import { COLLECTION_NODE_STATS } from './collection-catalog';
import { formatInvestment as formatInvestmentCode, parseInvestment, rosterInvestment } from './investment';

const SORTED_HEROES = [...HEROES].sort((a, b) => a.name.localeCompare(b.name));
const STORAGE_KEYS = { roster: 'll.roster', votes: 'll.votes', pets: 'll.pets', heroLevel: 'll.heroLevel' } as const;

function isUnderInvestment(
  have: NonNullable<ReturnType<typeof parseInvestment>>,
  need: NonNullable<Submission['forms'][number]['heroes'][number]['inv']>,
): boolean {
  return (['si', 'furn', 'eng'] as const).some((key) =>
    need[key] !== null && have[key] !== null && have[key]! < need[key]!,
  );
}

function parseDamage(value: string): number | null {
  const match = /^\s*([\d.,]+)\s*([kmbt])?\s*$/i.exec(value);
  if (!match) return null;
  const number = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  return number * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]?.toLowerCase() ?? ''] ?? 1);
}

function parseDuration(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d+):(\d{1,2})$/.exec(trimmed);
  if (match) {
    const seconds = Number(match[2]);
    if (seconds > 59) return null;
    const duration = Number(match[1]) * 60 + seconds;
    return duration > 0 ? duration : null;
  }
  const duration = /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
  return duration > 0 ? duration : null;
}

function makeEmptyFormation(key: string, label: string): DraftFormation {
  return {
    key,
    label,
    petId: null,
    petLevel: null,
    time: '',
    slots: Array.from({ length: 5 }, (): DraftSlot => ({ hid: null, merc: false, inv: '', collectionId: '' })),
  };
}

@Injectable({ providedIn: 'root' })
export class LineupLedgerStore {
  private readonly modeSignal = signal('nightmare-corridor');
  private readonly targetSignal = signal<string | null>(null);
  private readonly useRosterSignal = signal(true);
  private readonly matchSignal = signal<'strict' | 'partial'>('strict');
  private readonly scopeSignal = signal<'all' | 'slot'>('all');
  private readonly checkInvestmentSignal = signal(true);
  private readonly sortSignal = signal<'votes' | 'fewest' | 'new'>('votes');
  private readonly rosterSignal = signal<Record<string, RosterEntry>>({});
  private readonly petRosterSignal = signal<Record<string, PetRosterEntry>>({});
  private readonly heroLevelSignal = signal<number | null>(null);
  private readonly votesSignal = signal(new Set<number>());
  private readonly submissionsSignal = signal<readonly Submission[]>(SAMPLE_SUBMISSIONS);
  private readonly draftSignal = signal<LineupDraft | null>(null);
  private readonly draftErrorsSignal = signal<readonly string[]>([]);
  private readonly toastSignal = signal<string | null>(null);
  private readonly modesSignal = signal<readonly ModeConfig[]>(MODES);
  private readonly heroesSignal = signal<readonly Hero[]>(SORTED_HEROES);
  private readonly petsSignal = signal<readonly Pet[]>(PETS);
  private readonly collectionsSignal = signal<readonly CollectionInventoryItem[]>([]);
  private readonly collectionCatalogSignal = signal<readonly CollectionCatalogItem[]>(COLLECTION_CATALOG);
  private readonly collectionNodeStatsSignal = signal<readonly CollectionNodeStat[]>(COLLECTION_NODE_STATS);
  private readonly backendErrorSignal = signal<string | null>(null);
  private readonly backendReadySignal = signal(false);
  private readonly auth = inject(AuthService);
  private readonly data = inject(UserDataService);
  private activeUser: User | null = null;
  private backendUserId: string | null | undefined;
  private backendLoadId = 0;
  private privateDataUserId: string | null | undefined;
  private collectionsUserId: string | null | undefined;
  private readonly rosterDetailsLoadingSignal = signal(false);
  private readonly collectionsLoadingSignal = signal(false);
  private readonly collectionCatalogLoadingSignal = signal(false);
  private collectionCatalogLoaded = false;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private nextSubmissionId = Math.max(...SAMPLE_SUBMISSIONS.map(({ id }) => id), 0);

  constructor() {
    if (this.data.configured) {
      this.submissionsSignal.set([]);
    } else {
      this.rosterSignal.set(this.readStorage<Record<string, RosterEntry>>(STORAGE_KEYS.roster, {}));
      this.votesSignal.set(new Set(this.readStorage<number[]>(STORAGE_KEYS.votes, [])));
      this.petRosterSignal.set(this.readStorage<Record<string, PetRosterEntry>>(STORAGE_KEYS.pets, {}));
      this.heroLevelSignal.set(this.readStorage<number | null>(STORAGE_KEYS.heroLevel, null));
    }
  }

  readonly mode = this.modeSignal.asReadonly();
  readonly target = this.targetSignal.asReadonly();
  readonly useRoster = this.useRosterSignal.asReadonly();
  readonly match = this.matchSignal.asReadonly();
  readonly scope = this.scopeSignal.asReadonly();
  readonly checkInvestment = this.checkInvestmentSignal.asReadonly();
  readonly sort = this.sortSignal.asReadonly();
  readonly roster = this.rosterSignal.asReadonly();
  readonly petRoster = this.petRosterSignal.asReadonly();
  readonly heroLevel = this.heroLevelSignal.asReadonly();
  readonly votes = this.votesSignal.asReadonly();
  readonly submissions = this.submissionsSignal.asReadonly();
  readonly draft = this.draftSignal.asReadonly();
  readonly draftErrors = this.draftErrorsSignal.asReadonly();
  readonly toast = this.toastSignal.asReadonly();
  readonly modes = this.modesSignal.asReadonly();
  readonly heroes = this.heroesSignal.asReadonly();
  readonly pets = this.petsSignal.asReadonly();
  readonly petRosterCount = computed(() => Object.keys(this.petRosterSignal()).length);
  readonly collections = this.collectionsSignal.asReadonly();
  readonly collectionCatalog = this.collectionCatalogSignal.asReadonly();
  readonly collectionNodeStats = this.collectionNodeStatsSignal.asReadonly();
  readonly backendError = this.backendErrorSignal.asReadonly();
  readonly backendReady = this.backendReadySignal.asReadonly();
  readonly rosterDetailsLoading = this.rosterDetailsLoadingSignal.asReadonly();
  readonly collectionsLoading = this.collectionsLoadingSignal.asReadonly();

  readonly activeMode = computed(() => this.getMode(this.modeSignal()));
  readonly rosterCount = computed(() => Object.keys(this.rosterSignal()).length);
  readonly modeSubmissionCount = computed(() =>
    this.submissionsSignal().filter(({ mode }) => mode === this.modeSignal()).length,
  );
  readonly visibleSubmissions = computed((): readonly EvaluatedSubmission[] => {
    const roster = this.rosterSignal();
    const rosterSize = Object.keys(roster).length;
    const currentMode = this.modeSignal();
    const selectedTarget = this.targetSignal();
    const useRoster = this.useRosterSignal() && rosterSize > 0;
    const checkInvestment = this.checkInvestmentSignal();
    const match = this.matchSignal();
    const scope = this.scopeSignal();
    const votes = this.votesSignal();
    const sort = this.sortSignal();

    const petRoster = this.petRosterSignal();
    const rows = this.submissionsSignal()
      .filter((submission) => submission.mode === currentMode && (!selectedTarget || submission.target === selectedTarget))
    .map((submission) => this.evaluateSubmission(
      submission, roster, petRoster, this.heroLevelSignal(), useRoster, checkInvestment, votes, scope,
    ));
    const filtered = match === 'strict' ? rows.filter(({ gap }) => gap === 0) : rows;
    filtered.sort((a, b) => sort === 'new'
      ? a.submission.days - b.submission.days
      : sort === 'fewest'
        ? a.gap - b.gap || this.voteCount(b.submission, votes) - this.voteCount(a.submission, votes)
        : this.voteCount(b.submission, votes) - this.voteCount(a.submission, votes) || a.gap - b.gap);
    return filtered;
  });

  async initializeBackend(user: User | null): Promise<void> {
    if (!this.data.configured) {
      this.backendReadySignal.set(true);
      return;
    }
    const userId = user?.id ?? null;
    if (this.backendUserId === userId) return;
    this.backendUserId = userId;
    const loadId = ++this.backendLoadId;
    this.activeUser = user;
    this.rosterDetailsLoadingSignal.set(false);
    this.collectionsLoadingSignal.set(false);
    this.privateDataUserId = null;
    this.collectionsUserId = null;
    this.rosterSignal.set({});
    this.petRosterSignal.set({});
    this.heroLevelSignal.set(null);
    this.collectionsSignal.set([]);
    this.votesSignal.set(new Set());
    this.backendReadySignal.set(false);
    this.backendErrorSignal.set(null);
    try {
      const [reference, submissions] = await Promise.all([
        this.data.loadReferenceData(),
        this.data.loadSubmissions(),
      ]);
      if (loadId !== this.backendLoadId) return;
      if (reference.modes.length === 0) throw new Error('No enabled game modes are configured in the database.');
      if (reference.heroes.length === 0) throw new Error('No heroes are configured in the database. Add heroes before using accounts.');
      this.modesSignal.set(reference.modes);
      this.heroesSignal.set(reference.heroes);
      this.petsSignal.set(reference.pets);
      this.submissionsSignal.set(submissions);
      if (!reference.modes.some((mode) => mode.slug === this.modeSignal())) {
        this.modeSignal.set(reference.modes[0].slug);
      }
      if (user) {
        const [roster, votes] = await Promise.all([
          this.data.loadRoster(),
          this.data.loadVotes(user.id),
        ]);
        if (loadId !== this.backendLoadId) return;
        this.rosterSignal.set(roster);
        this.votesSignal.set(new Set(votes));
      } else {
        this.rosterSignal.set({});
        this.petRosterSignal.set({});
        this.heroLevelSignal.set(null);
        this.collectionsSignal.set([]);
        this.votesSignal.set(new Set());
      }
    } catch (error) {
      if (loadId !== this.backendLoadId) return;
      this.reportBackendError(error, 'Could not load account data.');
    } finally {
      if (loadId === this.backendLoadId) this.backendReadySignal.set(true);
    }
  }

  async loadRosterDetails(): Promise<void> {
    const user = this.activeUser;
    if (!user || !this.data.configured || !this.backendReadySignal() || this.privateDataUserId === user.id || this.rosterDetailsLoadingSignal()) return;
    const loadId = this.backendLoadId;
    this.rosterDetailsLoadingSignal.set(true);
    try {
      const [petRoster, heroLevel] = await Promise.all([
        this.data.loadPetRoster(),
        this.data.loadHeroLevel(),
      ]);
      if (loadId !== this.backendLoadId || this.activeUser?.id !== user.id) return;
      this.petRosterSignal.set(petRoster);
      this.heroLevelSignal.set(heroLevel);
      this.privateDataUserId = user.id;
    } catch (error) {
      this.reportBackendError(error, 'Could not load roster details.');
    } finally {
      if (loadId === this.backendLoadId) this.rosterDetailsLoadingSignal.set(false);
    }
  }

  async loadCollections(): Promise<void> {
    await this.loadCollectionCatalog();
    const user = this.activeUser;
    if (!user || !this.data.configured || !this.backendReadySignal() || this.collectionsUserId === user.id || this.collectionsLoadingSignal()) return;
    const loadId = this.backendLoadId;
    this.collectionsLoadingSignal.set(true);
    try {
      const collections = await this.data.loadCollections();
      if (loadId !== this.backendLoadId || this.activeUser?.id !== user.id) return;
      this.collectionsSignal.set(collections);
      this.collectionsUserId = user.id;
    } catch (error) {
      this.reportBackendError(error, 'Could not load collections.');
    } finally {
      if (loadId === this.backendLoadId) this.collectionsLoadingSignal.set(false);
    }
  }

  async loadCollectionCatalog(): Promise<void> {
    if (!this.data.configured || this.collectionCatalogLoaded || this.collectionCatalogLoadingSignal()) return;
    this.collectionCatalogLoadingSignal.set(true);
    try {
      const referenceData = await this.data.loadCollectionCatalog();
      this.collectionCatalogSignal.set(referenceData.catalog);
      this.collectionNodeStatsSignal.set(referenceData.nodeStats);
      this.collectionCatalogLoaded = true;
    } catch (error) {
      this.collectionCatalogSignal.set([]);
      this.collectionNodeStatsSignal.set([]);
      this.reportBackendError(error, 'Could not load the collection catalog.');
    } finally {
      this.collectionCatalogLoadingSignal.set(false);
    }
  }

  setMode(slug: string): void {
    this.getMode(slug);
    this.modeSignal.set(slug);
    this.targetSignal.set(null);
    this.scopeSignal.set('all');
  }

  setTarget(target: string | null): void {
    this.targetSignal.set(target || null);
  }

  setMatch(match: 'strict' | 'partial'): void {
    this.matchSignal.set(match);
  }

  setScope(scope: 'all' | 'slot'): void {
    this.scopeSignal.set(scope);
  }

  setUseRoster(checked: boolean): void {
    this.useRosterSignal.set(checked);
  }

  setCheckInvestment(checked: boolean): void {
    this.checkInvestmentSignal.set(checked);
  }

  setSort(sort: 'votes' | 'fewest' | 'new'): void {
    this.sortSignal.set(sort);
  }

  toggleVote(id: number): void {
    if (this.data.configured) {
      if (!this.activeUser) {
        this.showToast('Sign in to vote on lineups.');
        return;
      }
      void this.data.toggleVote(id).then(async (voted) => {
        const votes = new Set(this.votesSignal());
        if (voted) votes.add(id);
        else votes.delete(id);
        this.votesSignal.set(votes);
        this.submissionsSignal.set(await this.data.loadSubmissions());
      }).catch((error: unknown) => this.reportBackendError(error, 'Could not save your vote.'));
      return;
    }
    const votes = new Set(this.votesSignal());
    if (votes.has(id)) votes.delete(id);
    else votes.add(id);
    this.votesSignal.set(votes);
    this.writeStorage(STORAGE_KEYS.votes, [...votes]);
  }

  toggleHero(heroId: number): void {
    const roster = { ...this.rosterSignal() };
    if (roster[heroId]) delete roster[heroId];
    else roster[heroId] = { inv: '' };
    this.rosterSignal.set(roster);
    this.saveRoster(roster);
    if (this.activeUser) void this.persistRoster();
  }

  selectAllHeroes(): void {
    const roster = { ...this.rosterSignal() };
    for (const hero of this.heroesSignal()) roster[hero.id] ??= { inv: '' };
    this.rosterSignal.set(roster);
    this.saveRoster(roster);
    if (this.activeUser) void this.persistRoster();
  }

  clearRoster(): void {
    this.rosterSignal.set({});
    this.saveRoster({});
    if (this.activeUser) void this.persistRoster();
  }

  setHeroLevel(value: number | null): void {
    const level = value !== null && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : null;
    this.heroLevelSignal.set(level);
    if (!this.data.configured) this.writeStorage(STORAGE_KEYS.heroLevel, level);
    if (this.activeUser) void this.persistHeroLevel();
  }

  togglePet(petId: number): void {
    const roster = { ...this.petRosterSignal() };
    if (roster[petId]) delete roster[petId];
    else roster[petId] = { level: 1 };
    this.savePetRoster(roster);
    if (this.activeUser) void this.persistPetRoster();
  }

  selectAllPets(): void {
    const roster = { ...this.petRosterSignal() };
    for (const pet of this.petsSignal()) roster[pet.id] ??= { level: 1 };
    this.savePetRoster(roster);
    if (this.activeUser) void this.persistPetRoster();
  }

  clearPetRoster(): void {
    this.savePetRoster({});
    if (this.activeUser) void this.persistPetRoster();
  }

  updatePetLevel(petId: number, value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 18 || !this.petRosterSignal()[petId]) return;
    const roster = { ...this.petRosterSignal(), [petId]: { level: value } };
    this.savePetRoster(roster);
    if (this.activeUser) void this.persistPetRoster();
  }

  setAllPetLevels(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 18) return;
    const roster = Object.fromEntries(
      Object.keys(this.petRosterSignal()).map((petId) => [petId, { level: value }]),
    );
    this.savePetRoster(roster);
    if (this.activeUser) void this.persistPetRoster();
  }

  updateRosterInvestment(heroId: number, investment: string): boolean {
    const roster = this.rosterSignal();
    if (!roster[heroId]) return false;
    const parsed = parseInvestment(investment);
    if (investment.trim() && !parsed) return false;
    const entry = { ...roster[heroId], inv: investment };
    if (parsed) {
      entry.si = parsed.si;
      entry.furn = parsed.furn;
      entry.eng = parsed.eng;
    } else {
      delete entry.si;
      delete entry.furn;
      delete entry.eng;
    }
    const updated = { ...roster, [heroId]: entry };
    this.rosterSignal.set(updated);
    this.saveRoster(updated);
    if (this.activeUser) void this.persistRoster();
    return true;
  }

  updateRosterInvestmentPart(heroId: number, part: 'si' | 'furn' | 'eng', value: number | null): boolean {
    const ranges = { si: [0, 30], furn: [0, 12], eng: [0, 100] } as const;
    const [min, max] = ranges[part];
    if (value !== null && (!Number.isInteger(value) || value < min || value > max)) return false;
    const existing = this.rosterSignal()[heroId];
    if (!existing) return false;

    const investment = rosterInvestment(existing) ?? { si: null, furn: null, eng: null };
    const updated = { ...investment, [part]: value };
    const roster = this.rosterSignal();
    const updatedRoster = {
      ...roster,
      [heroId]: {
        ...existing,
        inv: formatInvestmentCode(updated),
        si: updated.si,
        furn: updated.furn,
        eng: updated.eng,
      },
    };
    this.rosterSignal.set(updatedRoster);
    this.saveRoster(updatedRoster);
    if (this.activeUser) void this.persistRoster();
    return true;
  }

  async saveCollection(collection: CollectionInventoryItem | Omit<CollectionInventoryItem, 'id'>): Promise<boolean> {
    try {
      const saved = await this.data.saveCollection(collection);
      this.collectionsSignal.update((items) => {
        const withoutOld = items.filter((item) => item.id !== saved.id);
        return [...withoutOld, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      this.showToast('Collection saved.');
      return true;
    } catch (error) {
      this.reportBackendError(error, 'Could not save collection.');
      return false;
    }
  }

  async deleteCollection(id: string): Promise<boolean> {
    try {
      await this.data.deleteCollection(id);
      this.collectionsSignal.update((items) => items.filter((item) => item.id !== id));
      this.showToast('Collection deleted.');
      return true;
    } catch (error) {
      this.reportBackendError(error, 'Could not delete collection.');
      return false;
    }
  }

  updateCollectionAssignment(slotIndex: number, collectionId: string): void {
    this.updateDraft((draft) => {
      draft.forms[draft.cur].slots[slotIndex].collectionId = collectionId;
    });
  }

  openDraft(): void {
    this.draftErrorsSignal.set([]);
    this.draftSignal.set(this.newDraft(this.modeSignal()));
  }

  closeDraft(): void {
    this.draftSignal.set(null);
    this.draftErrorsSignal.set([]);
  }

  changeDraftMode(slug: string): void {
    this.getMode(slug);
    this.draftErrorsSignal.set([]);
    this.draftSignal.set(this.newDraft(slug));
  }

  updateDraftTarget(target: string): void {
    this.updateDraft((draft) => { draft.target = target; });
  }

  selectFormation(index: number): void {
    this.updateDraft((draft) => {
      draft.cur = index;
      draft.slot = -1;
    });
  }

  addTeam(): void {
    this.updateDraft((draft) => {
      const mode = this.getMode(draft.mode);
      if (!mode.variable || draft.forms.length >= mode.variable.max) return;
      const number = draft.forms.length + 1;
      draft.forms.push(makeEmptyFormation(`t${number}`, `Team ${number}`));
      draft.cur = number - 1;
      draft.slot = -1;
    });
  }

  removeTeam(): void {
    this.updateDraft((draft) => {
      const mode = this.getMode(draft.mode);
      if (!mode.variable || draft.forms.length <= mode.variable.min) return;
      draft.forms.pop();
      draft.cur = Math.min(draft.cur, draft.forms.length - 1);
      draft.slot = -1;
    });
  }

  selectSlot(index: number): void {
    this.updateDraft((draft) => {
      draft.slot = draft.slot === index ? -1 : index;
    });
  }

  clearSlot(index: number): void {
    this.updateDraft((draft) => {
      draft.forms[draft.cur].slots[index] = { hid: null, merc: false, inv: '', collectionId: '' };
    });
  }

  pickHero(heroId: number): void {
    this.updateDraft((draft) => {
      const mode = this.getMode(draft.mode);
      const formation = draft.forms[draft.cur];
      if (formation.slots.some(({ hid }) => hid === heroId)) {
        this.showToast('That hero is already in this team.');
        return;
      }
      if (mode.uniqueAcross && draft.forms.some((form) => form.slots.some(({ hid }) => hid === heroId))) {
        this.showToast('A hero can only appear once per run in this mode.');
        return;
      }
      const slotIndex = draft.slot >= 0 ? draft.slot : formation.slots.findIndex(({ hid }) => hid === null);
      if (slotIndex < 0) {
        this.showToast('This team is full. Remove a hero first.');
        return;
      }
      formation.slots[slotIndex] = { hid: heroId, merc: false, inv: '', collectionId: '' };
      draft.slot = formation.slots.findIndex(({ hid }) => hid === null);
    });
  }

  updateDraftFormationField(field: 'investment' | 'mercenary', value: string | boolean, slotIndex: number): void {
    this.updateDraft((draft) => {
      const formation = draft.forms[draft.cur];
      if (field === 'investment') formation.slots[slotIndex].inv = String(value);
      else formation.slots[slotIndex].merc = Boolean(value);
    });
  }

  updateDraftPet(petId: number | null): void {
    this.updateDraft((draft) => {
      const formation = draft.forms[draft.cur];
      formation.petId = petId;
      formation.petLevel = petId === null ? null : this.petRosterSignal()[petId]?.level ?? null;
    });
  }

  updateDraftPetLevel(value: number | null): void {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 18)) return;
    this.updateDraft((draft) => { draft.forms[draft.cur].petLevel = value; });
  }

  updateDraftTime(value: string): void {
    this.updateDraft((draft) => { draft.forms[draft.cur].time = value; });
  }

  setDraftSearch(query: string): void {
    this.updateDraft((draft) => { draft.q = query; });
  }

  filteredDraftHeroes(): readonly (typeof HEROES)[number][] {
    const draft = this.draftSignal();
    if (!draft) return [];
    const query = draft.q.toLocaleLowerCase();
    return this.heroesSignal().filter((hero) => hero.name.toLocaleLowerCase().includes(query));
  }

  heroAlreadySelected(heroId: number): boolean {
    const draft = this.draftSignal();
    if (!draft) return false;
    const mode = this.getMode(draft.mode);
    const forms = mode.uniqueAcross ? draft.forms : [draft.forms[draft.cur]];
    return forms.some((form) => form.slots.some(({ hid }) => hid === heroId));
  }

  async submitDraft(value: SubmissionFormValue): Promise<void> {
    const draft = this.draftSignal();
    if (!draft) return;
    const mode = this.getMode(draft.mode);
    const errors = this.validateDraft(draft, value, mode);
    if (errors.length) {
      this.draftErrorsSignal.set(errors);
      return;
    }
    this.draftErrorsSignal.set([]);
    if (this.data.configured && !this.activeUser) {
      this.draftErrorsSignal.set(['Sign in before submitting a lineup.']);
      return;
    }

    const result: Record<string, number | boolean | string> = {};
    for (const field of mode.fields) {
      const raw = value[field.k as keyof SubmissionFormValue];
      if (field.t === 'bool') result[field.k] = Boolean(raw);
      else if (field.t === 'damage') result[field.k] = parseDamage(String(raw))!;
      else if (field.t === 'dur') result[field.k] = parseDuration(String(raw))!;
      else result[field.k] = Number(raw);
    }
    if (draft.mode === 'treasure-scramble') {
      result['placementType'] = value.placementType;
      result['placement'] = Number(value.placementValue);
    }

    const forms = draft.forms.map((form) => ({
      key: form.key,
      label: form.label,
      beast: this.petName(form.petId) ?? '',
      petId: form.petId,
      petLevel: form.petLevel,
      timeSeconds: draft.mode === 'nightmare-corridor' ? parseDuration(form.time) : null,
      heroes: form.slots.map((slot, pos) => ({
        pos,
        hid: slot.hid!,
        merc: slot.merc,
        inv: parseInvestment(slot.inv),
        collection: slot.collectionId
          ? this.collectionsSignal().find((collection) => collection.id === slot.collectionId) ?? null
          : null,
      })),
    }));
    if (this.data.configured) {
      const modeForSubmission = this.getMode(draft.mode);
      try {
        await this.data.submitLineup({
          mode_slug: draft.mode,
          target_slug: modeForSubmission.targetSlugs?.[value.target],
          hero_level: this.heroLevelSignal(),
          result,
          notes: value.notes.trim(),
          formations: draft.forms.map((form) => ({
            slot_key: form.key,
            slot_label: form.label,
            pet_id: form.petId,
            pet_level: form.petLevel,
            time_seconds: draft.mode === 'nightmare-corridor' ? parseDuration(form.time) : null,
            heroes: form.slots.map((slot, position) => ({
              position,
              hero_id: slot.hid,
              is_merc: slot.merc,
              si: parseInvestment(slot.inv)?.si,
              furniture: parseInvestment(slot.inv)?.furn,
              engraving: parseInvestment(slot.inv)?.eng,
              collection_id: slot.collectionId || null,
            })),
          })),
        });
        this.submissionsSignal.set(await this.data.loadSubmissions());
        this.modeSignal.set(draft.mode);
        this.targetSignal.set(value.target);
        this.draftSignal.set(null);
        this.showToast('Lineup added.');
        return;
      } catch (error) {
        this.reportBackendError(error, 'Could not submit lineup.');
        return;
      }
    }
    const newSubmission: Submission = {
      id: ++this.nextSubmissionId,
      mode: draft.mode,
      target: value.target,
      up: 0,
      days: 0,
      result,
      forms,
      notes: value.notes.trim(),
      by: 'you',
      heroLevel: this.heroLevelSignal(),
    };
    this.submissionsSignal.update((submissions) => [newSubmission, ...submissions]);
    this.modeSignal.set(draft.mode);
    this.targetSignal.set(value.target);
    this.draftSignal.set(null);
    this.showToast(this.data.configured ? 'Lineup added.' : 'Lineup added. This prototype keeps it in memory only.');
  }

  showToast(message: string): void {
    this.toastSignal.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastSignal.set(null), 3200);
  }

  heroName(heroId: number): string {
    const hero = this.heroesSignal().find((entry) => entry.id === heroId) ?? HERO_BY_ID.get(heroId);
    if (!hero) throw new Error(`Unknown hero id: ${heroId}`);
    return hero.name;
  }

  heroIconUrl(heroId: number): string | null {
    return this.heroesSignal().find((entry) => entry.id === heroId)?.iconUrl ?? null;
  }

  petName(petId: number | null): string | null {
    if (petId === null) return null;
    const pet = this.petsSignal().find((entry) => entry.id === petId);
    if (!pet) throw new Error(`Unknown pet id: ${petId}`);
    return pet.name;
  }

  petIconUrl(petId: number | null): string | null {
    if (petId === null) return null;
    return this.petsSignal().find((entry) => entry.id === petId)?.iconUrl ?? null;
  }

  hue(name: string): number {
    let hash = 0;
    for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 360;
    return hash;
  }

  voteCount(submission: Submission, votes = this.votesSignal()): number {
    return submission.up + Number(votes.has(submission.id));
  }

  formatInvestment(investment: Submission['forms'][number]['heroes'][number]['inv']): string {
    return formatInvestmentCode(investment);
  }

  resultLine(submission: Submission): string {
    const result = submission.result;
    if (submission.mode === 'nightmare-corridor') {
      return `${submission.forms.length} boss kill times`;
    }
    if (submission.mode === 'treasure-scramble') {
      return result['placementType'] === 'rank'
        ? `Rank ${result['placement']}`
        : `Top ${result['placement']}%`;
    }
    return `${this.formatDamage(Number(result['damage']))} damage${submission.mode === 'cursed-realm' ? ' in total' : ''}`;
  }

  private newDraft(slug: string): LineupDraft {
    const mode = this.getMode(slug);
    const result: Record<string, unknown> = {};
    for (const field of mode.fields) if (field.def !== undefined) result[field.k] = field.def;
    const forms = mode.variable
      ? Array.from({ length: mode.variable.min }, (_, index) => makeEmptyFormation(`t${index + 1}`, `Team ${index + 1}`))
      : mode.formations!.map(({ key, label }) => makeEmptyFormation(key, label));
    return {
      mode: slug,
      target: this.modeSignal() === slug ? (this.targetSignal() ?? '') : '',
      cur: 0,
      slot: -1,
      q: '',
      notes: '',
      result,
      forms,
    };
  }

  private updateDraft(update: (draft: LineupDraft) => void): void {
    const current = this.draftSignal();
    if (!current) return;
    const draft: LineupDraft = {
      ...current,
      result: { ...current.result },
      forms: current.forms.map((form) => ({
        ...form,
        time: form.time,
        slots: form.slots.map((slot) => ({ ...slot })),
      })),
    };
    update(draft);
    this.draftSignal.set(draft);
  }

  private evaluateSubmission(
    submission: Submission,
    roster: Readonly<Record<string, RosterEntry>>,
    petRoster: Readonly<Record<string, PetRosterEntry>>,
    heroLevel: number | null,
    active: boolean,
    checkInvestment: boolean,
    votes: ReadonlySet<number>,
    scope: 'all' | 'slot',
  ): EvaluatedSubmission {
    if (!active) {
      const forms = submission.forms.map(() => ({ statuses: [], missing: 0, missingPet: false, underPetLevel: false }));
      return {
        submission,
        active: false,
        forms,
        missingCount: 0,
        bestSlotMissing: 0,
        missingHeroes: [],
        lowInvestmentHeroes: [],
        missingPetNames: [],
        underLevelPetNames: [],
        heroLevelMismatch: null,
        gap: 0,
      };
    }
    const heroLevelMismatch = checkInvestment && heroLevel !== null && submission.heroLevel !== null
      && heroLevel < submission.heroLevel
      ? { owned: heroLevel, required: submission.heroLevel }
      : null;
    const forms: EvaluatedFormation[] = submission.forms.map((formation) => {
      const statuses = formation.heroes.map((hero): HeroStatus => {
        const owned = roster[hero.hid];
        if (!owned) return 'missing';
        const current = checkInvestment ? rosterInvestment(owned) : null;
        return current && hero.inv && isUnderInvestment(current, hero.inv) ? 'under' : 'ok';
      });
      const ownedPet = formation.petId === null ? undefined : petRoster[formation.petId];
      const missingPet = formation.petId !== null && !ownedPet;
      const underPetLevel = !!ownedPet && checkInvestment && formation.petLevel !== null && ownedPet.level < formation.petLevel;
      return {
        statuses,
        missing: statuses.filter((status) => status !== 'ok').length
          + Number(missingPet) + Number(underPetLevel) + Number(heroLevelMismatch !== null),
        missingPet,
        underPetLevel,
      };
    });
    const missingHeroes = new Set<number>();
    const lowInvestmentHeroes = new Set<number>();
    const missingPetNames: string[] = [];
    const underLevelPetNames: string[] = [];
    submission.forms.forEach((formation, formIndex) => formation.heroes.forEach((hero, heroIndex) => {
      const status = forms[formIndex].statuses[heroIndex];
      if (status === 'missing') missingHeroes.add(hero.hid);
      if (status === 'under') lowInvestmentHeroes.add(hero.hid);
    }));
    submission.forms.forEach((formation, formIndex) => {
      if (formation.petId === null) return;
      if (forms[formIndex].missingPet) missingPetNames.push(formation.beast);
      if (forms[formIndex].underPetLevel) underLevelPetNames.push(formation.beast);
    });
    const totalGap = missingHeroes.size + lowInvestmentHeroes.size + missingPetNames.length
      + underLevelPetNames.length + Number(heroLevelMismatch !== null);
    const bestSlotMissing = Math.min(...forms.map((form) => form.missing));
    const gap = submission.forms.length > 1 && scope === 'slot' ? bestSlotMissing : totalGap;
    return {
      submission,
      active: true,
      forms,
      missingCount: totalGap,
      bestSlotMissing,
      missingHeroes: [...missingHeroes],
      lowInvestmentHeroes: [...lowInvestmentHeroes],
      missingPetNames: [...missingPetNames],
      underLevelPetNames: [...underLevelPetNames],
      heroLevelMismatch,
      gap,
    };
  }

  private validateDraft(draft: LineupDraft, value: SubmissionFormValue, mode: ModeConfig): string[] {
    const errors: string[] = [];
    if (!value.target) errors.push(`Pick a ${mode.targetLabel.toLocaleLowerCase()}.`);
    if (draft.mode === 'twisted-realm' && this.heroLevelSignal() === null) {
      errors.push('Set your Resonating Crystal level in your roster before submitting a Twisted Realm lineup.');
    }
    if (draft.forms.some((form) => form.slots.some((slot) => slot.hid === null))) {
      errors.push('Fill every hero slot in each team.');
    }
    if (mode.mercMax !== undefined) {
      const mercCount = draft.forms.reduce((total, form) => total + form.slots.filter(({ merc }) => merc).length, 0);
      if (mercCount > mode.mercMax) {
        errors.push(mode.mercMax === 0
          ? 'Mercenaries are not allowed in this mode.'
          : `Only ${mode.mercMax} mercenary is allowed across this lineup.`);
      }
    }
    for (const form of draft.forms) {
      if (form.petLevel !== null && (!Number.isInteger(form.petLevel) || form.petLevel < 1 || form.petLevel > 18)) {
        errors.push('Pet levels must be between 1 and 18.');
      }
      const heroIds = form.slots.flatMap(({ hid }) => hid === null ? [] : [hid]);
      if (new Set(heroIds).size !== heroIds.length) errors.push('A hero can only appear once in each team.');
      if (draft.mode === 'nightmare-corridor' && parseDuration(form.time) === null) {
        errors.push(`Enter a valid kill time for ${form.label.toLocaleLowerCase()}.`);
      }
    }
    if (mode.uniqueAcross) {
      const ids = draft.forms.flatMap((form) => form.slots.flatMap(({ hid }) => hid === null ? [] : [hid]));
      if (new Set(ids).size !== ids.length) errors.push('A hero can only appear once per run in this mode.');
    }
    for (const field of mode.fields) {
      const raw = value[field.k as keyof SubmissionFormValue];
      if (field.t === 'bool') continue;
      if (field.t === 'damage' && (parseDamage(String(raw)) ?? 0) <= 0) errors.push(`Enter a positive value for ${field.l.toLocaleLowerCase()}.`);
      else if (field.t === 'dur' && parseDuration(String(raw)) === null) errors.push(`Enter a valid ${field.l.toLocaleLowerCase()}.`);
      else if (field.t === 'pct' && (!Number.isFinite(Number(raw)) || Number(raw) < 0 || Number(raw) > 100)) errors.push(`Enter a valid ${field.l.toLocaleLowerCase()}.`);
      else if (field.t === 'int' && (!Number.isInteger(Number(raw)) || Number(raw) <= 0)) {
        errors.push(`Enter a valid value for ${field.l.toLocaleLowerCase()}.`);
      }
      else if (field.t === 'select' && (!Number.isInteger(Number(raw)) || !field.opts?.includes(Number(raw)))) {
        errors.push(`Select a valid value for ${field.l.toLocaleLowerCase()}.`);
      }
    }
    if (draft.mode === 'treasure-scramble') {
      const placement = Number(value.placementValue);
      if (!Number.isFinite(placement) || placement <= 0 || placement > 100
        || (value.placementType === 'rank' && !Number.isInteger(placement))) {
        errors.push(value.placementType === 'rank'
          ? 'Enter a whole-number placement rank from 1 to 100.'
          : 'Enter a top percentage greater than 0 and at most 100.');
      }
    }
    return errors;
  }

  private getMode(slug: string): ModeConfig {
    const mode = this.modesSignal().find((entry) => entry.slug === slug);
    if (!mode) throw new Error(`Unknown game mode: ${slug}`);
    return mode;
  }

  private formatDamage(value: number): string {
    for (const [unit, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
      if (value >= unit) return `${Number((value / unit).toFixed(2))}${suffix}`;
    }
    return String(value);
  }

  private saveRoster(roster: Record<string, RosterEntry>): void {
    if (!this.data.configured) this.writeStorage(STORAGE_KEYS.roster, roster);
  }

  private savePetRoster(roster: Record<string, PetRosterEntry>): void {
    this.petRosterSignal.set(roster);
    if (!this.data.configured) this.writeStorage(STORAGE_KEYS.pets, roster);
  }

  private async persistRoster(): Promise<void> {
    try {
      await this.data.replaceRoster(this.rosterSignal());
    } catch (error) {
      this.reportBackendError(error, 'Could not save your hero roster.');
    }
  }

  private async persistPetRoster(): Promise<void> {
    try {
      await this.data.replacePetRoster(this.petRosterSignal());
    } catch (error) {
      this.reportBackendError(error, 'Could not save your pet roster.');
    }
  }

  private async persistHeroLevel(): Promise<void> {
    try {
      await this.data.saveHeroLevel(this.heroLevelSignal());
    } catch (error) {
      this.reportBackendError(error, 'Could not save your hero level.');
    }
  }

  private reportBackendError(error: unknown, context: string): void {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`${context} ${detail}`);
    this.backendErrorSignal.set(`${context} ${detail}`);
    this.showToast(context);
  }

  private readStorage<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) as T : fallback;
    } catch (error) {
      console.warn(`Could not read saved AFK Arena Team Lineups data (${key}).`, error);
      return fallback;
    }
  }

  private writeStorage(key: string, value: unknown): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Could not save AFK Arena Team Lineups data (${key}).`, error);
      this.showToast('Your browser could not save this change. Check browser storage settings.');
    }
  }
}
