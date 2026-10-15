import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../../../core/auth/auth.service';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { PetPickerComponent } from '../../components/pet-picker/pet-picker.component';
import { LineupsStore } from '../../lineups.store';
import { ConfirmDialogComponent } from './confirm-dialog.component';

type PetConfirmation =
  | { action: 'clear'; title: string; message: string }
  | { action: 'set-level'; title: string; message: string; level: number };

@Component({
  selector: 'app-roster-pets',
  standalone: true,
  imports: [ConfirmDialogComponent, HeroIconComponent, MatButtonModule, PetPickerComponent],
  templateUrl: './roster-pets.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RosterPetsComponent {
  readonly store = inject(LineupsStore);
  private readonly auth = inject(AuthService);
  readonly confirmation = signal<PetConfirmation | null>(null);
  readonly selectedPetIds = computed(() => Object.keys(this.store.petRoster()).map(Number));
  readonly disabledPetIds = computed(() => this.busy() ? this.store.pets().map(({ id }) => id) : []);
  readonly busy = computed(() =>
    this.auth.configured && (!this.store.backendReady() || this.store.rosterDetailsLoading()),
  );

  confirmClear(): void {
    this.confirmation.set({
      action: 'clear',
      title: 'Clear pet roster?',
      message: 'This removes all selected pets and their levels from your roster.',
    });
  }

  quickSetLevel(level: number): void {
    const pets = Object.values(this.store.petRoster());
    if (!pets.length || pets.every((pet) => pet.level === level)) return;
    this.confirmation.set({
      action: 'set-level',
      title: `Set all pet levels to ${level}?`,
      message: `This will change the level of every pet in your roster to ${level}.`,
      level,
    });
  }

  confirm(): void {
    const confirmation = this.confirmation();
    if (!confirmation) return;
    this.confirmation.set(null);
    if (confirmation.action === 'clear') this.store.clearPetRoster();
    else this.store.setAllPetLevels(confirmation.level);
  }

  updateLevel(petId: number, event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.store.updatePetLevel(petId, Number(input.value));
  }

}
