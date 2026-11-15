import { ChangeDetectionStrategy, Component, inject, input, output, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { collectionIconUrlForSnapshot, collectionNodeIconUrl, collectionNodeLabel } from '../../collection-catalog';
import { LineupViewPreferencesService } from '../../lineup-view-preferences.service';
import { AscensionRank, CollectionNode, CollectionSnapshot, Investment } from '../../models';

export interface FormationBoardSlot {
  readonly heroId: number | null;
  readonly heroName: string;
  readonly iconUrl: string | null;
  readonly hue?: number;
  readonly ascension?: AscensionRank | null;
  readonly investment?: Investment | null;
  readonly collection?: CollectionSnapshot | null;
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
                [class.has-collection]="!!slot.collection"
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
                @if (slot.collection; as collection) {
                  <span class="collection-tag" [attr.title]="collectionSummary(collection)">
                    @if (collectionIcon(collection); as iconUrl) {
                      <img class="collection-icon" [src]="iconUrl" [alt]="collection.name + ' icon'">
                    }
                    @for (node of collectionStats(collection); track $index) {
                      @if (node.stat !== 'skill_level') {
                        <img class="collection-node-icon" [src]="collectionNodeIcon(node.stat, node.tier)"
                          [alt]="(collection.recommendation ? 'Acceptable ' : '') + node.tier + ' ' + node.stat.replaceAll('_', ' ')"
                          [title]="(collection.recommendation ? 'Acceptable ' : '') + node.tier + ' ' + node.stat.replaceAll('_', ' ')">
                      }
                    }
                  </span>
                }
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
  styles: [`
    .formation-board:not(.front-right) .formation-row {
      align-items: flex-start;
    }

    .formation-board.front-right .formation-row {
      align-items: center;
    }

    .formation-board .formation-slot.has-collection.mat-mdc-button {
      width: auto;
      min-width: 74px;
      height: auto;
      min-height: 74px;
      padding: 6px;
    }

    .formation-board .formation-slot.has-collection .mdc-button__label {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }

    .formation-board.front-right .formation-slot.has-collection .mdc-button__label {
      display: grid;
      grid-template-columns: 64px 56px;
      align-items: start;
      justify-items: center;
      gap: 4px;
    }

    .formation-board.front-right .formation-slot.has-collection app-hero-icon {
      transform: translateY(-4px);
    }

    .formation-board .formation-slot .collection-tag {
      display: flex;
      flex-flow: row wrap;
      justify-content: center;
      align-items: flex-start;
      width: 56px;
      margin-top: 2px;
      gap: 2px;
    }

    .formation-board.front-right .formation-slot .collection-tag {
      margin-top: 0;
    }

    .formation-board .formation-slot .collection-tag .collection-icon {
      width: 56px;
      height: 56px;
      flex: 0 0 100%;
      display: block;
      margin-inline: auto;
      object-fit: contain;
    }

    .formation-board .formation-slot .collection-tag .collection-node-icon {
      width: 22px;
      height: 22px;
    }
  `],
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

  collectionSummary(collection: CollectionSnapshot): string {
    const level = collection.recommendation?.level
      ?? collection.nodes.filter(({ stat }) => stat === 'skill_level').length + 1;
    if (collection.recommendation) {
      const attack = collection.recommendation.attackStats.length
        ? `Attack: ${collection.recommendation.attackStats.map(collectionNodeLabel).join(' or ')}`
        : '';
      const defense = collection.recommendation.defenseStats.length
        ? `Defense: ${collection.recommendation.defenseStats.map(collectionNodeLabel).join(' or ')}`
        : '';
      return `${collection.name}; Level ${level}; ${[attack, defense].filter(Boolean).join('; ')}, as many as possible`;
    }
    return `${collection.name}; Level ${level}`;
  }

  collectionIcon(collection: CollectionSnapshot): string | null {
    const catalogId = collection.catalogId;
    return catalogId === null || catalogId === undefined
      ? null
      : collectionIconUrlForSnapshot(catalogId, collection);
  }

  collectionStats(collection: CollectionSnapshot): readonly { readonly stat: string; readonly tier: CollectionNode['tier'] }[] {
    return collection.recommendation
      ? [...collection.recommendation.attackStats, ...collection.recommendation.defenseStats]
          .map((stat) => ({ stat, tier: 'mythic' as const }))
      : collection.nodes.map(({ stat, tier }) => ({ stat, tier }));
  }

  collectionNodeIcon(stat: string, tier: CollectionNode['tier']): string {
    return collectionNodeIconUrl(stat, tier);
  }
}
