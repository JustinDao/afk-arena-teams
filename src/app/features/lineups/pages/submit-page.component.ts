import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnDestroy, signal, ViewEncapsulation } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { HeroIconService } from '../../../core/hero-icons/hero-icon.service';
import { AuthService } from '../../../core/auth/auth.service';
import { HeroIconComponent } from '../../../core/hero-icons/hero-icon.component';
import { AddHeroModalComponent } from '../components/add-hero-modal/add-hero-modal.component';
import { AddPetModalComponent, DraftPetSelection } from '../components/add-pet-modal/add-pet-modal.component';
import { CollectionBuildEditorComponent } from '../components/collection-build-editor/collection-build-editor.component';
import { CollectionRecommendationEditorComponent } from '../components/collection-recommendation-editor/collection-recommendation-editor.component';
import { FormationBoardComponent, FormationBoardPet, FormationBoardSlot } from '../components/formation-board/formation-board.component';
import { HeroInvestmentEditorComponent } from '../components/hero-investment-editor/hero-investment-editor.component';
import { defaultAscensionForInvestment } from '../investment';
import { COLLECTION_NODE_STATS } from '../collection-catalog';
import { AscensionRank, DraftFormation, displayHeroName, Hero, ModeConfig, Pet } from '../models';
import { LineupsStore } from '../lineups.store';
import { formatDamage, formatDuration, parseDamage, parseDuration } from '../lineup-display';
import { LineupViewPreferencesService } from '../lineup-view-preferences.service';

@Component({
  selector: 'app-submit-page',
  standalone: true,
  imports: [
    AddHeroModalComponent,
    AddPetModalComponent,
    CdkTrapFocus,
    CollectionBuildEditorComponent,
    CollectionRecommendationEditorComponent,
    FormationBoardComponent,
    HeroIconComponent,
    HeroInvestmentEditorComponent,
    MatButtonModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './submit-page.component.html',
  styleUrl: './roster/roster-page.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubmitPageComponent implements OnDestroy {
  readonly store = inject(LineupsStore);
  readonly lineupView = inject(LineupViewPreferencesService);
  readonly auth = inject(AuthService);
  readonly nodeStatsCatalog = COLLECTION_NODE_STATS;
  private readonly heroIcons = inject(HeroIconService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly disabledHeroIds = computed(() =>
    this.store.heroes().filter((hero) => this.store.heroAlreadySelected(hero.id)).map(({ id }) => id),
  );
  readonly editingSlot = signal<{ readonly index: number } | null>(null);
  readonly petModalOpen = signal(false);

  readonly boardSlots = computed<readonly FormationBoardSlot[]>(() => {
    const draft = this.store.draft();
    if (!draft) return [];
    const collectionsEnabled = this.modeFor(draft.mode).collectionsEnabled;
    const rosterCollections = this.store.collections();
    return draft.forms[draft.cur].slots.map((slot, index) => {
      const heroId = slot.hid;
      const heroName = heroId !== null ? this.store.heroName(heroId) : '';
      const collection =
        heroId !== null && collectionsEnabled
          ? (slot.collectionSnapshot ??
              (slot.collectionId
                ? (rosterCollections.find((c) => c.id === slot.collectionId) ?? null)
                : null))
          : null;
      return {
        heroId,
        heroName,
        iconUrl: heroId !== null ? this.store.heroIconUrl(heroId) : null,
        hue: heroId !== null ? this.store.hue(heroName) : 200,
        ascension: this.ascensionOf(index),
        investment: this.store.draftInvestment(index),
        collection,
      };
    });
  });

  readonly boardPet = computed<FormationBoardPet | null>(() => {
    const draft = this.store.draft();
    if (!draft) return null;
    const form = draft.forms[draft.cur];
    if (form.petId === null) return null;
    const pet = this.petFor(form.petId);
    return {
      id: form.petId,
      name: pet.name,
      iconUrl: pet.iconUrl ?? null,
      level: form.petLevel,
    };
  });

  readonly submissionForm = new FormGroup({
    target: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
    damage: new FormControl('', { nonNullable: true }),
    totalTime: new FormControl('', { nonNullable: true }),
    rcLevel: new FormControl('', { nonNullable: true }),
    placementType: new FormControl<'' | 'rank' | 'percent'>('', { nonNullable: true }),
    placementValue: new FormControl('', { nonNullable: true }),
  });
  readonly resultEntryMode = signal<'per-round' | 'total'>('per-round');
  readonly calculatedTotalTime = computed(() => {
    const draft = this.store.draft();
    if (!draft || draft.mode !== 'nightmare-corridor') return '';
    const times = draft.forms.map((f) => parseDuration(f.time)).filter((t): t is number => t !== null && t > 0);
    if (!times.length) return '';
    return formatDuration(times.reduce((sum, t) => sum + t, 0));
  });
  readonly calculatedTotalDamage = computed(() => {
    const draft = this.store.draft();
    if (!draft || draft.mode !== 'cursed-realm') return '';
    const dmgs = draft.forms.map((f) => parseDamage(f.damage ?? '')).filter((d): d is number => d !== null && d > 0);
    if (!dmgs.length) return '';
    return formatDamage(dmgs.reduce((sum, d) => sum + d, 0));
  });

  constructor() {
    if (!this.store.draft()) this.store.openDraft();
    this.resetSubmissionForm();
    this.submissionForm.controls.target.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((target) => this.store.updateDraftTarget(target));
    void this.store.loadCollections();
  }

  ngOnDestroy(): void {
    if (this.store.draft()) this.store.closeDraft();
  }

  pickHero(heroId: number, slotIndex: number): void {
    this.store.pickHero(heroId, slotIndex);
    const draft = this.store.draft();
    if (draft?.forms[draft.cur].slots[slotIndex].hid !== heroId) return;
    this.store.updateDraftAscension(this.defaultAscension(this.heroFor(heroId)), slotIndex);
  }

  ascensionOf(slotIndex: number): AscensionRank | null {
    const draft = this.store.draft();
    const slot = draft?.forms[draft.cur].slots[slotIndex];
    if (!slot || slot.hid === null) return null;
    return slot.ascension ?? this.defaultAscension(this.heroFor(slot.hid), this.store.draftInvestment(slotIndex));
  }

  private defaultAscension(hero: Hero, investment: ReturnType<LineupsStore['draftInvestment']> = null): AscensionRank {
    return defaultAscensionForInvestment(investment) ?? this.heroIcons.lowestAscensionFor(displayHeroName(hero));
  }

  openSlot(index: number): void {
    this.editingSlot.set({ index });
  }

  closeSlot(): void {
    this.editingSlot.set(null);
  }

  updateDraftPet(selection: DraftPetSelection): void {
    this.store.updateDraftPet(selection.petId);
    if (selection.petId !== null) this.store.updateDraftPetLevel(selection.level);
    this.petModalOpen.set(false);
  }

  changeDraftMode(slug: string): void {
    this.store.changeDraftMode(slug);
    this.resetSubmissionForm();
  }

  async submitLineup(): Promise<void> {
    const mode = this.store.draft()?.mode;
    await this.store.submitDraft(this.submissionForm.getRawValue());
    if (mode && !this.store.draft()) await this.router.navigateByUrl(`/${mode}`);
  }

  modeFor(slug: string): ModeConfig {
    const mode = this.store.modes().find((entry) => entry.slug === slug);
    if (!mode) throw new Error(`Unknown game mode: ${slug}`);
    return mode;
  }

  filledSlots(formation: DraftFormation): number {
    return formation.slots.filter((slot) => slot.hid !== null).length;
  }

  petFor(id: number): Pet {
    const pet = this.store.pets().find((entry) => entry.id === id);
    if (!pet) throw new Error(`Unknown pet id: ${id}`);
    return pet;
  }

  teamCounts(variable: { readonly min: number; readonly max: number }): readonly number[] {
    return Array.from({ length: variable.max - variable.min + 1 }, (_, index) => variable.min + index);
  }

  teamCountValue(event: Event): number {
    return Number(this.inputValue(event));
  }

  inputValue(event: Event): string {
    const input = event.target;
    return input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? input.value : '';
  }

  checkboxValue(event: Event): boolean {
    const input = event.target;
    return input instanceof HTMLInputElement && input.checked;
  }

  heroFor(id: number): Hero {
    const hero = this.store.heroes().find((entry) => entry.id === id);
    if (!hero) throw new Error(`Unknown hero id: ${id}`);
    return hero;
  }

  classOfSlot(slotIndex: number): string | null {
    const draft = this.store.draft();
    const hid = draft?.forms[draft.cur].slots[slotIndex].hid;
    if (hid === null || hid === undefined) return null;
    const hero = this.heroFor(hid);
    return hero.class ?? this.heroIcons.classFor(displayHeroName(hero));
  }

  private sameClass(itemClass: string | null | undefined, heroClass: string | null): boolean {
    return !!heroClass && itemClass?.toLowerCase() === heroClass.toLowerCase();
  }

  collectionsForSlot(slotIndex: number) {
    const heroClass = this.classOfSlot(slotIndex);
    const collections = this.store.collections();
    const filtered = heroClass ? collections.filter((collection) => this.sameClass(collection.class, heroClass)) : [];
    return filtered.length ? filtered : collections;
  }

  catalogForSlot(slotIndex: number) {
    const heroClass = this.classOfSlot(slotIndex);
    const catalog = this.store.collectionCatalog();
    const filtered = heroClass ? catalog.filter((item) => this.sameClass(item.class, heroClass)) : [];
    return filtered.length ? filtered : catalog;
  }

  startCustomCollection(slotIndex: number): void {
    const draft = this.store.draft();
    if (!draft || draft.forms[draft.cur].slots[slotIndex].collectionSnapshot) return;
    this.store.startDraftCollectionSnapshot(slotIndex, this.classOfSlot(slotIndex));
  }

  useRosterCollection(slotIndex: number): void {
    const draft = this.store.draft();
    const selectedId = draft?.forms[draft.cur].slots[slotIndex].collectionId;
    if (selectedId && this.store.collections().some(({ id }) => id === selectedId)) return;
    const collection = this.collectionsForSlot(slotIndex)[0];
    if (collection) this.store.updateCollectionAssignment(slotIndex, collection.id);
  }

  private resetSubmissionForm(): void {
    const draft = this.store.draft();
    if (!draft) return;
    const hasRoundDamage = draft.mode === 'cursed-realm' && draft.forms.some((f) => Boolean(f.damage?.trim()));
    const hasTotalTime = draft.mode === 'nightmare-corridor' && typeof draft.result['totalTime'] === 'string' && !draft.forms.some((f) => Boolean(f.time.trim()));
    if (draft.mode === 'cursed-realm') {
      this.resultEntryMode.set(hasRoundDamage ? 'per-round' : 'total');
    } else if (draft.mode === 'nightmare-corridor') {
      this.resultEntryMode.set(hasTotalTime ? 'total' : 'per-round');
    }
    this.submissionForm.reset({
      target: draft.target,
      notes: draft.notes,
      damage: typeof draft.result['damage'] === 'string' ? draft.result['damage'] : '',
      totalTime: typeof draft.result['totalTime'] === 'string' ? draft.result['totalTime'] : '',
      rcLevel: String(this.store.heroLevel() ?? ''),
      placementType:
        draft.result['placementType'] === 'rank' || draft.result['placementType'] === 'percent'
          ? draft.result['placementType']
          : '',
      placementValue:
        typeof draft.result['placementValue'] === 'string' || typeof draft.result['placementValue'] === 'number'
          ? String(draft.result['placementValue'])
          : '',
    });
  }
}
