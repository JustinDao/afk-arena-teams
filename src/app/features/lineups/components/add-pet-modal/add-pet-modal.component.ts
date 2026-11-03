import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Pet, PetRosterEntry, petMaxLevel } from '../../models';
import { PetPickerComponent } from '../pet-picker/pet-picker.component';

export interface DraftPetSelection {
  readonly petId: number | null;
  readonly level: number | null;
}

@Component({
  selector: 'app-add-pet-modal',
  standalone: true,
  imports: [CdkTrapFocus, MatButtonModule, PetPickerComponent],
  template: `
    <div class="overlay" role="presentation">
      <section class="panel hero-modal pet-modal" role="dialog" aria-modal="true"
        [attr.aria-label]="currentPetId() === null ? 'Add pet' : 'Edit pet'" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <h2>{{ currentPetId() === null ? 'Add pet' : 'Edit pet' }}</h2>
        <app-pet-picker
          searchId="submit-pet-search"
          searchLabel="Search pets"
          [pets]="pets()"
          [selectedIds]="selectedPetId() === null ? [] : [selectedPetId()!]"
          (petSelected)="selectPet($event)"
        />
        @if (selectedPet(); as pet) {
          <label class="field">Pet level
            <input type="number" min="1" [attr.max]="petMaxLevel(pet.kind)" step="1"
              [value]="level() ?? ''" [placeholder]="'1–' + petMaxLevel(pet.kind)"
              (input)="setLevel($event, pet.kind)">
          </label>
        }
        <div class="row-wrap modal-actions">
          @if (currentPetId() !== null) {
            <button mat-button type="button" class="btn" (click)="selectionChange.emit({ petId: null, level: null })">Remove pet</button>
          }
          <button mat-button type="button" class="btn" (click)="closed.emit()">Cancel</button>
          <button mat-flat-button type="button" class="btn primary" [disabled]="selectedPetId() === null"
            (click)="save()">Done</button>
        </div>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddPetModalComponent {
  readonly pets = input.required<readonly Pet[]>();
  readonly petRoster = input.required<Readonly<Record<string, PetRosterEntry>>>();
  readonly currentPetId = input<number | null>(null);
  readonly currentLevel = input<number | null>(null);
  readonly selectionChange = output<DraftPetSelection>();
  readonly closed = output<void>();
  readonly selectedPetId = signal<number | null>(null);
  readonly level = signal<number | null>(null);
  readonly selectedPet = computed(() => this.pets().find((pet) => pet.id === this.selectedPetId()) ?? null);
  readonly petMaxLevel = petMaxLevel;

  ngOnInit(): void {
    this.selectedPetId.set(this.currentPetId());
    this.level.set(this.currentLevel());
  }

  selectPet(petId: number): void {
    this.selectedPetId.set(petId);
    this.level.set(this.petRoster()[petId]?.level ?? null);
  }

  setLevel(event: Event, kind: Pet['kind']): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.value.trim() === '') {
      this.level.set(null);
      return;
    }
    const value = Number(input.value);
    if (Number.isInteger(value)) this.level.set(Math.min(petMaxLevel(kind), Math.max(1, value)));
  }

  save(): void {
    const petId = this.selectedPetId();
    if (petId === null) return;
    this.selectionChange.emit({ petId, level: this.level() });
  }
}
