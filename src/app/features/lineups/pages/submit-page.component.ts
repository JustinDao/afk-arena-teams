import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnDestroy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { HeroIconComponent } from '../../../core/hero-icons/hero-icon.component';
import { HeroPickerComponent } from '../components/hero-picker/hero-picker.component';
import { DraftFormation, ModeConfig } from '../models';
import { LineupsStore } from '../lineups.store';

@Component({
  selector: 'app-submit-page',
  standalone: true,
  imports: [HeroIconComponent, HeroPickerComponent, MatButtonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './submit-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubmitPageComponent implements OnDestroy {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly disabledHeroIds = computed(() =>
    this.store.heroes().filter((hero) => this.store.heroAlreadySelected(hero.id)).map(({ id }) => id),
  );

  readonly submissionForm = new FormGroup({
    target: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
    damage: new FormControl('', { nonNullable: true }),
    placementType: new FormControl<'rank' | 'percent'>('rank', { nonNullable: true }),
    placementValue: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    if (!this.store.draft()) this.store.openDraft();
    this.submissionForm.controls.target.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((target) => this.store.updateDraftTarget(target));
    this.resetSubmissionForm();
    void this.store.loadCollections();
  }

  ngOnDestroy(): void {
    if (this.store.draft()) this.store.closeDraft();
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

  checkboxValue(event: Event): boolean {
    const input = event.target;
    return input instanceof HTMLInputElement && input.checked;
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
}
