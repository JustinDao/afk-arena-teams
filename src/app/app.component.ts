import { CdkTrapFocus } from '@angular/cdk/a11y'
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { NavigationEnd, Router } from '@angular/router';
import { User } from '@supabase/supabase-js';
import { filter } from 'rxjs';
import { MODE_PATHS, MODE_SLUGS_BY_PATH } from './app.routes';
import { AuthService } from './core/auth/auth.service'
import { HeroIconComponent } from './core/hero-icons/hero-icon.component'
import { HeroIconService } from './core/hero-icons/hero-icon.service'
import { LineupCardComponent } from './features/lineup-ledger/components/lineup-card/lineup-card.component'
import { rosterInvestment } from './features/lineup-ledger/investment'
import { LineupLedgerStore } from './features/lineup-ledger/lineup-ledger.store'
import { CollectionInventoryItem, CollectionNode, CollectionNodeStat, DraftFormation, ModeConfig, UPCOMING_MODES } from './features/lineup-ledger/models'
import { COLLECTION_NODE_TIERS, collectionIconUrl, collectionNodeIconUrl, collectionNodeLabel } from './features/lineup-ledger/collection-catalog'

type ThemeMode = 'system' | 'light' | 'dark';
type RosterTab = 'heroes' | 'pets' | 'collections';
type RosterConfirmation =
  | { action: 'clear-heroes' | 'clear-pets'; title: string; message: string }
  | { action: 'set-pet-level'; title: string; message: string; level: number };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CdkTrapFocus, HeroIconComponent, LineupCardComponent, MatButtonModule, ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly store = inject(LineupLedgerStore);
  readonly auth = inject(AuthService);
  private readonly heroIcons = inject(HeroIconService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  readonly upcomingModes = UPCOMING_MODES;
  readonly rosterSearch = signal('');
  readonly theme = signal<ThemeMode>('system');
  readonly rosterOpen = signal(false);
  readonly rosterTab = signal<RosterTab>('heroes');
  readonly rosterConfirmation = signal<RosterConfirmation | null>(null);
  readonly rosterInvestmentMode = signal<'short' | 'long'>('short');
  readonly rosterInvestmentErrors = signal<Record<number, string>>({});
  readonly accountOpen = signal(false);
  readonly accountMode = signal<'sign-in' | 'sign-up'>('sign-in');
  readonly accountBusy = signal(false);
  readonly accountMessage = signal<string | null>(null);
  readonly collectionCatalog = this.store.collectionCatalog;
  readonly collectionNodeStats = this.store.collectionNodeStats;
  readonly collectionNodeTiers = COLLECTION_NODE_TIERS;
  readonly collectionNodeSlots = [
    { category: 'Attack', indices: [0, 1, 2] },
    { category: 'Defense', indices: [3, 4, 5] },
    { category: 'Flex', indices: [6, 7] },
  ] as const;
  readonly collectionNodes = signal<CollectionNode[]>([]);
  readonly editingCollectionId = signal<string | null>(null);
  readonly collectionError = signal<string | null>(null);
  readonly filteredRosterHeroes = computed(() => {
    const query = this.rosterSearch().toLocaleLowerCase();
    return this.store.heroes().filter((hero) => hero.name.toLocaleLowerCase().includes(query));
  });
  readonly filteredRosterPets = computed(() => {
    const query = this.rosterSearch().toLocaleLowerCase();
    return this.store.pets().filter((pet) => pet.name.toLocaleLowerCase().includes(query));
  });
  readonly rosterEditorBusy = computed(() =>
    this.auth.configured && (!this.store.backendReady() || this.store.rosterDetailsLoading()),
  );

  readonly submissionForm = new FormGroup({
    target: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
    damage: new FormControl('', { nonNullable: true }),
    placementType: new FormControl<'rank' | 'percent'>('rank', { nonNullable: true }),
    placementValue: new FormControl('', { nonNullable: true }),
  });
  readonly accountForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });
  readonly collectionForm = new FormGroup({
    catalogId: new FormControl(1, { nonNullable: true }),
  });

  constructor() {
    void this.heroIcons.initialize();
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncRoute());
    this.syncRoute();
    this.submissionForm.controls.target.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((target) => this.store.updateDraftTarget(target));
    this.auth.onUserChange((user) => {
      void this.initializePageData(user);
      this.accountMessage.set(null);
      if (user) this.accountOpen.set(false);
    });
    void this.auth.initialize().then(() => this.initializePageData(this.auth.user()));
    this.readTheme();
  }

  openRoster(tab: RosterTab = 'heroes'): void {
    this.rosterSearch.set('');
    this.rosterInvestmentErrors.set({});
    this.rosterTab.set(tab);
    this.rosterOpen.set(true);
    void this.router.navigateByUrl('/roster');
  }

  openCollections(): void {
    this.openRoster('collections');
  }

  selectRosterTab(tab: RosterTab): void {
    this.rosterTab.set(tab);
    if (tab === 'collections') void this.store.loadCollections();
  }

  confirmClearHeroes(): void {
    this.rosterConfirmation.set({
      action: 'clear-heroes',
      title: 'Clear hero roster?',
      message: 'This removes all selected heroes and their investment values from your roster.',
    });
  }

  confirmClearPets(): void {
    this.rosterConfirmation.set({
      action: 'clear-pets',
      title: 'Clear pet roster?',
      message: 'This removes all selected pets and their levels from your roster.',
    });
  }

  quickSetHeroInvestment(heroId: number, investment: string): void {
    if (this.store.updateRosterInvestment(heroId, investment)) this.setRosterInvestmentError(heroId, '');
  }

  quickSetPetLevel(level: number): void {
    const pets = Object.entries(this.store.petRoster());
    if (!pets.length || pets.every(([, pet]) => pet.level === level)) return;
    if (pets.some(([, pet]) => pet.level !== level)) {
      this.rosterConfirmation.set({
        action: 'set-pet-level',
        title: `Set all pet levels to ${level}?`,
        message: `This will change the level of every pet in your roster to ${level}.`,
        level,
      });
      return;
    }
    this.applyPetLevel(level);
  }

  confirmRosterAction(): void {
    const confirmation = this.rosterConfirmation();
    if (!confirmation) return;
    this.rosterConfirmation.set(null);
    if (confirmation.action === 'clear-heroes') this.store.clearRoster();
    else if (confirmation.action === 'clear-pets') this.store.clearPetRoster();
    else if (confirmation.action === 'set-pet-level') this.applyPetLevel(confirmation.level);
  }

  cancelRosterAction(): void {
    this.rosterConfirmation.set(null);
  }

  openSubmission(): void {
    this.store.openDraft();
    this.resetSubmissionForm();
    void this.store.loadCollections();
  }

  openAccount(): void {
    this.accountOpen.set(true);
    this.accountMode.set('sign-in');
    this.accountMessage.set(null);
    this.auth.clearError();
  }

  closeAccount(): void {
    this.accountOpen.set(false);
    this.accountMessage.set(null);
    this.auth.clearError();
  }

  selectAccountMode(mode: 'sign-in' | 'sign-up'): void {
    this.accountMode.set(mode);
    this.accountMessage.set(null);
    this.auth.clearError();
  }

  async submitAccount(): Promise<void> {
    this.accountBusy.set(true);
    this.accountMessage.set(null);
    this.auth.clearError();
    const { email, password } = this.accountForm.getRawValue();
    try {
      if (this.accountMode() === 'sign-up') {
        await this.auth.signUp(email.trim(), password);
        if (!this.auth.error()) {
          this.accountMessage.set(this.auth.user()
            ? 'Account created and signed in.'
            : 'Check your email to confirm your account, then sign in.');
        }
      } else {
        await this.auth.signIn(email.trim(), password);
      }
    } finally {
      this.accountBusy.set(false);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.accountBusy.set(true);
    try {
      await this.auth.signInWithGoogle();
    } finally {
      this.accountBusy.set(false);
    }
  }

  async linkGoogle(): Promise<void> {
    this.accountBusy.set(true);
    this.auth.clearError();
    try {
      await this.auth.linkGoogle();
    } finally {
      this.accountBusy.set(false);
    }
  }

  async signOut(): Promise<void> {
    if (await this.auth.signOut()) this.closeAccount();
  }

  async saveCollection(): Promise<void> {
    if (this.collectionForm.invalid || !this.auth.user()) return;
    const value = this.collectionForm.getRawValue();
    const catalogItem = this.collectionCatalog().find(({ id }) => id === value.catalogId);
    if (!catalogItem) {
      this.collectionError.set('Choose a collection from the catalog.');
      return;
    }
    const id = this.editingCollectionId();
    const collection = id
      ? { id, catalogId: catalogItem.id, name: catalogItem.name, class: catalogItem.class, nodes: this.collectionNodes() }
      : { catalogId: catalogItem.id, name: catalogItem.name, class: catalogItem.class, nodes: this.collectionNodes() };
    if (await this.store.saveCollection(collection)) {
      this.cancelCollectionEdit();
    }
  }

  editCollection(collection: CollectionInventoryItem): void {
    if (collection.catalogId === undefined) return;
    this.editingCollectionId.set(collection.id);
    this.collectionForm.reset({ catalogId: collection.catalogId });
    this.collectionNodes.set([...collection.nodes]);
    this.collectionError.set(null);
  }

  cancelCollectionEdit(): void {
    this.editingCollectionId.set(null);
    this.collectionForm.reset({ catalogId: 1 });
    this.collectionNodes.set([]);
    this.collectionError.set(null);
  }

  selectCollection(catalogId: number): void {
    this.collectionForm.controls.catalogId.setValue(catalogId);
  }

  async deleteCollection(collection: CollectionInventoryItem): Promise<void> {
    if (await this.store.deleteCollection(collection.id) && this.editingCollectionId() === collection.id) {
      this.cancelCollectionEdit();
    }
  }

  updateCollectionNodeStat(slotIndex: number, stat: string): void {
    if (stat === '') {
      this.removeCollectionNode(slotIndex);
      return;
    }
    if (!this.collectionNodeStatsForSlot(slotIndex).includes(stat)) {
      this.collectionError.set('Choose a stat from the collection catalog.');
      return;
    }
    this.updateCollectionNode(slotIndex, (existing) => ({
      slotIndex,
      stat,
      tier: stat === 'skill_level' ? 'mythic' : existing?.tier ?? 'mythic',
    }));
  }

  updateCollectionNodeTier(slotIndex: number, tier: string): void {
    if (!this.collectionNodeTiers.includes(tier as CollectionNode['tier'])) {
      this.collectionError.set('Choose a tier from the collection catalog.');
      return;
    }
    const existing = this.collectionNodes().find((node) => node.slotIndex === slotIndex);
    if (existing) {
      this.updateCollectionNode(slotIndex, () => ({
        ...existing,
        tier: existing.stat === 'skill_level' ? 'mythic' : tier as CollectionNode['tier'],
      }));
    }
  }

  private updateCollectionNode(slotIndex: number, update: (node: CollectionNode | undefined) => CollectionNode): void {
    const existing = this.collectionNodes().find((node) => node.slotIndex === slotIndex);
    this.collectionNodes.update((nodes) => [
      ...nodes.filter((node) => node.slotIndex !== slotIndex),
      update(existing),
    ].sort((left, right) => left.slotIndex - right.slotIndex));
    this.collectionError.set(null);
  }

  removeCollectionNode(slotIndex: number): void {
    this.collectionNodes.update((nodes) => nodes.filter((item) => item.slotIndex !== slotIndex));
    this.collectionError.set(null);
  }

  collectionNodeLabel(node: CollectionNode): string {
    return `${node.tier[0].toUpperCase()} ${collectionNodeLabel(node.stat)}`;
  }

  collectionNodeStatLabel(stat: CollectionNodeStat): string {
    return collectionNodeLabel(stat);
  }

  collectionNodeStatsForSlot(slotIndex: number): readonly CollectionNodeStat[] {
    return slotIndex < 6
      ? this.collectionNodeStats().filter((stat) => stat !== 'skill_level')
      : this.collectionNodeStats();
  }

  collectionNodeAt(slotIndex: number): CollectionNode | undefined {
    return this.collectionNodes().find((node) => node.slotIndex === slotIndex);
  }

  collectionSummary(nodes: readonly CollectionNode[]): string {
    return nodes.map((node) => `${this.collectionSlotLabel(node.slotIndex)}: ${this.collectionNodeLabel(node)}`).join(' · ');
  }

  collectionIcon(collectionId: number, nodes: readonly CollectionNode[]): string {
    const levelNodeCount = nodes.filter(({ stat }) => stat === 'skill_level').length;
    return collectionIconUrl(collectionId, levelNodeCount + 1);
  }

  collectionNodeIcon(stat: CollectionNodeStat, tier: CollectionNode['tier']): string {
    return collectionNodeIconUrl(stat, tier);
  }

  collectionSlotLabel(slotIndex: number): string {
    if (slotIndex < 3) return `Attack ${slotIndex + 1}`;
    if (slotIndex < 6) return `Defense ${slotIndex - 2}`;
    return `Flex ${slotIndex - 5}`;
  }

  closeDialog(): void {
    this.cancelRosterAction();
    this.rosterOpen.set(false);
    this.store.closeDraft();
    void this.router.navigateByUrl(this.modePath(this.store.mode()));
  }

  navigateToMode(slug: string): void {
    this.store.setMode(slug);
    void this.router.navigateByUrl(this.modePath(slug));
  }

  changeDraftMode(slug: string): void {
    this.store.changeDraftMode(slug);
    this.resetSubmissionForm();
  }

  submitLineup(): void {
    this.store.submitDraft(this.submissionForm.getRawValue());
  }

  setRosterSearch(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.rosterSearch.set(input.value);
  }

  updateRosterInvestment(heroId: number, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (this.store.updateRosterInvestment(heroId, input.value)) {
      this.setRosterInvestmentError(heroId, '');
    } else {
      this.setRosterInvestmentError(heroId, 'Use a valid code, such as 303e0 or 309e60 (SI 0–40, furniture 0–12, engraving 0–100).');
      input.value = this.store.roster()[heroId]?.inv ?? '';
    }
  }

  rosterInvestmentPart(heroId: number, part: 'si' | 'furn' | 'eng'): number | '' {
    const parsed = rosterInvestment(this.store.roster()[heroId]);
    return parsed?.[part] ?? '';
  }

  updateRosterInvestmentPart(heroId: number, part: 'si' | 'furn' | 'eng', event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const value = input.value.trim() === '' ? null : Number(input.value);
    const valid = value === null || Number.isInteger(value);
    if (!valid || !this.store.updateRosterInvestmentPart(heroId, part, value)) {
      const limits = { si: '0–40', furn: '0–12', eng: '0–100' } as const;
      this.setRosterInvestmentError(heroId, `${part === 'furn' ? 'Furniture' : part === 'si' ? 'SI' : 'Engraving'} must be a whole number from ${limits[part]}.`);
      input.value = String(this.rosterInvestmentPart(heroId, part));
    } else {
      this.setRosterInvestmentError(heroId, '');
    }
  }

  private setRosterInvestmentError(heroId: number, message: string): void {
    this.rosterInvestmentErrors.update((errors) => {
      const updated = { ...errors };
      if (message) updated[heroId] = message;
      else delete updated[heroId];
      return updated;
    });
  }

  private async initializePageData(user: User | null): Promise<void> {
    await this.store.initializeBackend(user);
    if (this.rosterOpen()) await this.store.loadRosterDetails();
    if ((this.rosterOpen() && this.rosterTab() === 'collections') || this.store.draft()) await this.store.loadCollections();
  }

  private syncRoute(): void {
    const path = this.router.url.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
    if (path === 'roster') {
      this.rosterOpen.set(true);
      this.store.closeDraft();
      void this.store.loadRosterDetails();
      return;
    }
    this.cancelRosterAction();
    this.rosterOpen.set(false);
    const mode = MODE_SLUGS_BY_PATH[path];
    if (mode && this.store.mode() !== mode) this.store.setMode(mode);
  }

  private modePath(slug: string): string {
    const path = MODE_PATHS[slug];
    if (!path) throw new Error(`No route is configured for game mode "${slug}".`);
    return path;
  }

  updatePetLevel(petId: number, event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.store.updatePetLevel(petId, Number(input.value));
  }

  private applyPetLevel(level: number): void {
    this.store.setAllPetLevels(level);
  }

  nullableNumberValue(event: Event): number | null {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.value.trim() === '') return null;
    const value = Number(input.value);
    return Number.isInteger(value) ? value : null;
  }

  petIdValue(event: Event): number | null {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.value === '') return null;
    const petId = Number(select.value);
    return Number.isInteger(petId) && this.store.pets().some((pet) => pet.id === petId) ? petId : null;
  }

  inputValue(event: Event): string {
    const input = event.target;
    return input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? input.value : '';
  }

  hasGoogleLinked(): boolean {
    return !!this.auth.user()?.identities?.some((identity) => identity.provider === 'google');
  }

  checkboxValue(event: Event): boolean {
    const input = event.target;
    return input instanceof HTMLInputElement && input.checked;
  }

  selectValue(event: Event): 'votes' | 'fewest' | 'new' {
    const select = event.target;
    if (select instanceof HTMLSelectElement && (select.value === 'fewest' || select.value === 'new')) {
      return select.value;
    }
    return 'votes';
  }

  modeFor(slug: string): ModeConfig {
    const mode = this.store.modes().find((entry) => entry.slug === slug);
    if (!mode) throw new Error(`Unknown game mode: ${slug}`);
    return mode;
  }

  filledSlots(formation: DraftFormation): number {
    return formation.slots.filter((slot) => slot.hid !== null).length;
  }

  toggleTheme(): void {
    const nextTheme: ThemeMode = this.theme() === 'system' ? 'dark' : this.theme() === 'dark' ? 'light' : 'system';
    this.theme.set(nextTheme);
    this.applyTheme(nextTheme);
    try {
      localStorage.setItem('ll.theme', nextTheme);
    } catch (error) {
      console.warn('Could not save the selected theme.', error);
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.cancelRosterAction();
      this.closeDialog();
      this.closeAccount();
    }
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    if (this.rosterConfirmation()) {
      this.cancelRosterAction();
      return;
    }
    if (this.rosterOpen() || this.store.draft()) this.closeDialog();
    if (this.accountOpen()) this.closeAccount();
  }

  private resetSubmissionForm(): void {
    const draft = this.store.draft();
    if (!draft) return;
    this.submissionForm.reset({
      target: draft.target,
      notes: draft.notes,
      damage: '',
      placementType: 'rank',
      placementValue: '',
    });
  }

  private readTheme(): void {
    try {
      const savedTheme = localStorage.getItem('ll.theme');
      if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system') {
        this.theme.set(savedTheme);
      }
    } catch (error) {
      console.warn('Could not read the saved theme.', error);
    }
    this.applyTheme(this.theme());
  }

  private applyTheme(theme: ThemeMode): void {
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    document.documentElement.classList.toggle('theme-light', theme === 'light');
  }
}
