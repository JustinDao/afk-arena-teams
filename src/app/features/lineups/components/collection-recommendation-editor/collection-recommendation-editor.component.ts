import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  ATTACK_COLLECTION_NODE_STATS,
  collectionIconUrl,
  collectionNodeIconUrl,
  collectionNodeLabel,
  DEFENSE_COLLECTION_NODE_STATS,
} from '../../collection-catalog';
import {
  CollectionCatalogItem,
  CollectionNodeStat,
  CollectionRecommendationSpec,
} from '../../models';
import { CollectionPickerComponent } from '../collection-picker/collection-picker.component';

@Component({
  selector: 'app-collection-recommendation-editor',
  standalone: true,
  imports: [CollectionPickerComponent],
  template: `
    <app-collection-picker
      [catalog]="catalog()"
      [selectedId]="selectedCatalogId()"
      (selectedIdChange)="selectedCatalogIdChange.emit($event)"
    />
    <label class="field level-field">
      <span>Collection level</span>
      <select [value]="effectiveLevel()" (change)="updateLevel(inputValue($event))">
        <option [value]="1" [selected]="effectiveLevel() === 1">Level 1</option>
        <option [value]="2" [selected]="effectiveLevel() === 2">Level 2</option>
        <option [value]="3" [selected]="effectiveLevel() === 3">Level 3</option>
      </select>
    </label>
    <div class="recommended-stat-groups">
      <fieldset class="recommended-stats">
        <legend>Attack nodes · up to 5 stats</legend>
        <p class="rules">Any selected stat is acceptable for an Attack node.</p>
        <div class="stat-options">
          @for (stat of attackStats(); track stat) {
            <label class="stat-option">
              <input
                type="checkbox"
                [checked]="hasStat(stat, 'attack')"
                [disabled]="!hasStat(stat, 'attack') && recommendation().attackStats.length >= 5"
                (change)="toggleStat(stat, 'attack', checkboxValue($event))"
              >
              {{ collectionNodeLabel(stat) }}
            </label>
          }
        </div>
      </fieldset>
      <fieldset class="recommended-stats">
        <legend>Defense nodes · up to 5 stats</legend>
        <p class="rules">Any selected stat is acceptable for a Defense node.</p>
        <div class="stat-options">
          @for (stat of defenseStats(); track stat) {
            <label class="stat-option">
              <input
                type="checkbox"
                [checked]="hasStat(stat, 'defense')"
                [disabled]="!hasStat(stat, 'defense') && recommendation().defenseStats.length >= 5"
                (change)="toggleStat(stat, 'defense', checkboxValue($event))"
              >
              {{ collectionNodeLabel(stat) }}
            </label>
          }
        </div>
      </fieldset>
    </div>
    <section class="recommended-stats">
      <p class="rules">Aim for as many Mythic nodes with the selected stats as possible.</p>
      <p class="rules">Preview works before migration; saving recommendations requires the flexible collection migration.</p>
    </section>
    <section class="recommendation-preview" aria-label="Collection recommendation preview">
      <img class="preview-collection-icon" [src]="previewIcon()" alt="">
      <div>
        <strong>{{ selectedCollectionName() }} · Level {{ effectiveLevel() }}</strong>
        @if (selectedStats().length) {
          <div class="preview-stats" aria-label="Acceptable Mythic stats">
            @for (stat of selectedStats(); track stat) {
              <img [src]="collectionNodeIconUrl(stat)" [alt]="collectionNodeLabel(stat)" [title]="collectionNodeLabel(stat)">
            }
          </div>
          <p>{{ statSummary() }} · as many as possible</p>
        } @else {
          <p>Select at least one acceptable Mythic stat to complete this recommendation.</p>
        }
      </div>
    </section>
  `,
  styles: [`
    .field { display: flex; flex-direction: column; gap: 4px; margin: 12px 0; font-size: 0.85rem; font-weight: 500; }
    .level-field { max-width: 220px; }
    .recommended-stat-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 12px; }
    .recommended-stats { min-width: 0; margin: 12px 0; padding: 10px 12px; border: 1px solid var(--app-line); border-radius: var(--app-radius-sm); }
    .recommended-stats legend { padding-inline: 4px; font-weight: 600; }
    .stat-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 6px 12px; }
    .stat-option { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 4px 0; }
    .stat-option input { margin: 0; }
    .recommendation-preview { display: flex; align-items: center; gap: 12px; margin-block: 14px; padding: 10px; border: 1px solid var(--app-line); border-radius: var(--app-radius-sm); background: var(--app-panel-variant); }
    .preview-collection-icon { width: 64px; height: 64px; flex: 0 0 auto; object-fit: contain; }
    .recommendation-preview p { margin: 4px 0 0; color: var(--app-muted); font-size: 0.85rem; }
    .preview-stats { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .preview-stats img { width: 28px; height: 28px; object-fit: contain; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionRecommendationEditorComponent {
  readonly catalog = input.required<readonly CollectionCatalogItem[]>();
  readonly selectedCatalogId = input.required<number>();
  readonly nodeStats = input.required<readonly CollectionNodeStat[]>();
  readonly recommendation = input.required<CollectionRecommendationSpec>();
  readonly selectedCatalogIdChange = output<number>();
  readonly recommendationChange = output<CollectionRecommendationSpec>();
  readonly attackStats = computed(() => ATTACK_COLLECTION_NODE_STATS.filter((stat) => this.nodeStats().includes(stat)));
  readonly defenseStats = computed(() => DEFENSE_COLLECTION_NODE_STATS.filter((stat) => this.nodeStats().includes(stat)));
  readonly selectedStats = computed(() => [
    ...this.recommendation().attackStats,
    ...this.recommendation().defenseStats,
  ]);
  readonly effectiveLevel = computed(() => this.recommendation().level || 1);

  readonly selectedCollectionName = computed(() =>
    this.catalog().find(({ id }) => id === this.selectedCatalogId())?.name ?? 'Collection',
  );

  previewIcon(): string {
    return collectionIconUrl(this.selectedCatalogId(), this.effectiveLevel());
  }

  collectionNodeLabel(stat: CollectionNodeStat): string {
    return collectionNodeLabel(stat);
  }

  collectionNodeIconUrl(stat: CollectionNodeStat): string {
    return collectionNodeIconUrl(stat, 'mythic');
  }

  statSummary(): string {
    const groups = [
      this.recommendation().attackStats.length
        ? `Attack: ${this.recommendation().attackStats.map(collectionNodeLabel).join(' or ')}`
        : '',
      this.recommendation().defenseStats.length
        ? `Defense: ${this.recommendation().defenseStats.map(collectionNodeLabel).join(' or ')}`
        : '',
    ];
    return groups.filter(Boolean).join('; ');
  }

  hasStat(stat: CollectionNodeStat, kind: 'attack' | 'defense'): boolean {
    return (kind === 'attack' ? this.recommendation().attackStats : this.recommendation().defenseStats).includes(stat);
  }

  updateLevel(value: string): void {
    const level = Number(value);
    if (Number.isInteger(level) && level >= 1 && level <= 3) {
      this.emitRecommendation({ ...this.recommendation(), level });
    }
  }

  toggleStat(stat: CollectionNodeStat, kind: 'attack' | 'defense', selected: boolean): void {
    const current = kind === 'attack' ? this.recommendation().attackStats : this.recommendation().defenseStats;
    const stats = new Set(current);
    if (selected) stats.add(stat);
    else stats.delete(stat);
    if (stats.size > 5) return;
    this.emitRecommendation({
      ...this.recommendation(),
      [kind === 'attack' ? 'attackStats' : 'defenseStats']: [...stats],
    });
  }

  inputValue(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target.value : '';
  }

  checkboxValue(event: Event): boolean {
    return event.target instanceof HTMLInputElement && event.target.checked;
  }

  private emitRecommendation(recommendation: CollectionRecommendationSpec): void {
    this.recommendationChange.emit(recommendation);
  }
}
