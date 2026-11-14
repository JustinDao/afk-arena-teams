import { ChangeDetectionStrategy, Component, inject, input, output, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { LineupViewPreferencesService } from '../../lineup-view-preferences.service';
import { AscensionRank, Investment } from '../../models';

export interface FormationBoardSlot {
  readonly heroId: number | null;
  readonly heroName: string;
  readonly iconUrl: string | null;
  readonly hue?: number;
  readonly ascension?: AscensionRank | null;
  readonly investment?: Investment | null;
  readonly needsReview?: boolean;
}

export interface FormationBoardPet {
  readonly id: number | null;
  readonly name: string;
  readonly iconUrl: string | null;
  readonly level: number | null;
}

@Component({
  selector: 'app-formation-board',
  standalone: true,
  imports: [HeroIconComponent, MatButtonModule],
  template: `
    <div class="formation-board" [class.front-right]="lineupView.orientation() === 'front-right'">
      @for (rowIndex of [0, 1]; track rowIndex) {
        <div class="formation-row" [class.back]="rowIndex > 0">
          @for (slot of slots().slice(rowIndex === 0 ? 0 : 2, rowIndex === 0 ? 2 : 5); track $index; let inRowIndex = $index) {
            @let slotIndex = rowIndex === 0 ? inRowIndex : inRowIndex + 2;
            @if (slot.heroId === null) {
              <button
                mat-button
                type="button"
                class="formation-slot empty-slot"
                [class.selected]="selectedSlotIndex() === slotIndex"
                (click)="slotClick.emit(slotIndex)">
                {{ rowIndex ? 'Back' : 'Front' }}
              </button>
            } @else {
              <button
                mat-button
                type="button"
                class="formation-slot"
                [class.selected]="selectedSlotIndex() === slotIndex"
                [class.needs-review]="slot.needsReview"
                [style.--h]="slot.hue ?? 200"
                [attr.aria-label]="'Edit ' + slot.heroName"
                (click)="slotClick.emit(slotIndex)">
                <app-hero-icon
                  [name]="slot.heroName"
                  [imageUrl]="slot.iconUrl"
                  size="large"
                  [ascension]="slot.ascension ?? null"
                  [investment]="slot.investment ?? null" />
                <span
                  class="remove-slot"
                  role="button"
                  [attr.aria-label]="'Remove ' + slot.heroName"
                  (click)="$event.stopPropagation(); slotRemove.emit(slotIndex)">×</span>
              </button>
            }
          }
        </div>
      }
    </div>

    @if (showPet()) {
      <section class="extras">
        <div class="field pet-slot-field">
          <h3>{{ petLabel() }} @if (petOptional()) { <span class="muted">(optional)</span> }</h3>
          @if (!pet() || pet()!.id === null) {
            <button
              mat-button
              type="button"
              class="formation-slot empty-slot pet-slot"
              aria-label="Add pet"
              (click)="petClick.emit()">Add Pet</button>
          } @else {
            @let p = pet()!;
            <button
              mat-button
              type="button"
              class="formation-slot pet-slot"
              [attr.aria-label]="'Edit ' + p.name + ', level ' + (p.level ?? 'not set')"
              (click)="petClick.emit()">
              <app-hero-icon [name]="p.name" [imageUrl]="p.iconUrl" size="large" />
              @if (p.level !== null) {
                <span class="pet-level-tag">Lv. {{ p.level }}</span>
              }
              <span class="remove-slot" aria-hidden="true" (click)="$event.stopPropagation(); petRemove.emit()">×</span>
            </button>
          }
        </div>
      </section>
    }
  `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormationBoardComponent {
  readonly lineupView = inject(LineupViewPreferencesService);
  readonly slots = input.required<readonly FormationBoardSlot[]>();
  readonly pet = input<FormationBoardPet | null>(null);
  readonly selectedSlotIndex = input<number | null>(null);
  readonly petLabel = input('Pet');
  readonly petOptional = input(true);
  readonly showPet = input(true);

  readonly slotClick = output<number>();
  readonly slotRemove = output<number>();
  readonly petClick = output<void>();
  readonly petRemove = output<void>();
}
