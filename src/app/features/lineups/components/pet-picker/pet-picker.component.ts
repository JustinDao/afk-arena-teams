import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { UnitPickerOptionComponent } from '../unit-picker-option/unit-picker-option.component';
import { Pet } from '../../models';

@Component({
  selector: 'app-pet-picker',
  standalone: true,
  imports: [UnitPickerOptionComponent],
  template: `
    <label class="visually-hidden" [for]="searchId()">{{ searchLabel() }}</label>
    <input
      class="search"
      [id]="searchId()"
      type="search"
      [placeholder]="searchLabel()"
      [attr.aria-label]="searchLabel()"
      (input)="setSearch($event)"
    >
    <div class="pick roster-pick pet-roster-pick">
      @for (pet of filteredPets(); track pet.id) {
        <app-unit-picker-option
          [name]="pet.name"
          [imageUrl]="pet.iconUrl ?? null"
          [tone]="pet.kind"
          [title]="pet.kind + ' pet'"
          [selected]="selectedIds().includes(pet.id)"
          [disabled]="disabledIds().includes(pet.id)"
          (selectedChange)="petSelected.emit(pet.id)"
        />
      } @empty {
        <p class="muted">No pet matches that search.</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PetPickerComponent {
  readonly pets = input.required<readonly Pet[]>();
  readonly selectedIds = input<readonly number[]>([]);
  readonly disabledIds = input<readonly number[]>([]);
  readonly searchId = input.required<string>();
  readonly searchLabel = input('Search pets');
  readonly petSelected = output<number>();
  readonly search = signal('');
  readonly filteredPets = computed(() => {
    const query = this.search().toLocaleLowerCase();
    return this.pets().filter((pet) => pet.name.toLocaleLowerCase().includes(query));
  });

  setSearch(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.search.set(event.target.value);
  }
}
