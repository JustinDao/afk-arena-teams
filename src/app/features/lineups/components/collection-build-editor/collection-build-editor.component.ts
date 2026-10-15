import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { collectionIconUrl, collectionNodeIconUrl, collectionNodeLabel } from '../../collection-catalog'
import { CollectionCatalogItem, CollectionNode, CollectionNodeStat } from '../../models'

@Component({
  selector: 'app-collection-build-editor',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="collection-picker" aria-label="Choose a collection">
      @for (collection of catalog(); track collection.id) {
        <button
          mat-button
          type="button"
          class="collection-choice"
          [class.selected]="selectedCatalogId() === collection.id"
          [attr.aria-pressed]="selectedCatalogId() === collection.id"
          [attr.aria-label]="collection.name + ', ' + collection.class"
          (click)="selectedCatalogIdChange.emit(collection.id)"
        >
          <img class="collection-icon" [src]="collectionIcon(collection.id, nodes())" alt="">
          <span class="collection-choice-copy">
            <span class="collection-choice-name">{{ collection.name }}</span>
            <small>{{ collection.class }}</small>
          </span>
        </button>
      }
    </div>
    <div class="collection-node-groups">
      @for (group of collectionNodeSlots; track group.category) {
        <fieldset>
          <legend>{{ group.category }} nodes</legend>
          @for (slotIndex of group.indices; track slotIndex) {
            <div class="collection-node-form" [class.has-tier]="!!nodeAt(slotIndex)">
              @if (nodeAt(slotIndex); as node) {
                <img class="collection-node-icon" [src]="collectionNodeIconUrl(node.stat, node.tier)" [alt]="node.stat + ' stat icon'">
              } @else {
                <span class="collection-node-icon-placeholder" aria-hidden="true">{{ slotIndex + 1 }}</span>
              }
              <label class="field">
                <span class="visually-hidden">{{ collectionSlotLabel(slotIndex) }} stat</span>
                <select [value]="nodeAt(slotIndex)?.stat ?? ''" (change)="updateStat(slotIndex, inputValue($event))">
                  <option value="">No node</option>
                  @for (stat of statsForSlot(slotIndex); track stat) {
                    <option [value]="stat">{{ collectionNodeLabel(stat) }}</option>
                  }
                </select>
              </label>
              @if (nodeAt(slotIndex); as node) {
                @if (node.stat === 'skill_level') {
                  <span class="collection-node-tier-fixed">Mythic</span>
                } @else {
                  <label class="field">
                    <span class="visually-hidden">{{ collectionSlotLabel(slotIndex) }} tier</span>
                    <select [value]="node.tier" (change)="updateTier(slotIndex, inputValue($event))">
                      <option value="elite">Elite</option>
                      <option value="legendary">Legendary</option>
                      <option value="mythic">Mythic</option>
                    </select>
                  </label>
                }
              }
            </div>
          }
        </fieldset>
      }
    </div>
  `,
  styles: [`
    .collection-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr)); gap: 8px; margin-block: 12px; }
    .collection-choice.mat-mdc-button {
      display: flex;
      box-sizing: border-box;
      width: 100%;
      height: auto;
      min-width: 0;
      min-height: 148px;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 6px;
      border: 1px solid var(--app-line);
      border-radius: var(--app-radius-sm);
      color: var(--app-ink);
      text-align: center;
      white-space: normal;
    }
    .collection-choice.mat-mdc-button ::ng-deep .mdc-button__label {
      display: flex;
      width: 100%;
      min-width: 0;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .collection-choice.selected { border-color: var(--app-primary); background: var(--app-panel-variant); box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-primary) 35%, transparent); }
    .collection-icon { display: block; width: 64px; height: 64px; object-fit: contain; margin-inline: auto; }
    .collection-choice-copy { display: flex; width: 100%; min-width: 0; flex-direction: column; align-items: center; gap: 2px; }
    .collection-choice-name { display: -webkit-box; width: 100%; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 3; text-overflow: ellipsis; }
    .collection-choice small { color: var(--app-muted); }
    .collection-node-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; margin-block: 12px; }
    fieldset { min-width: 0; padding: 8px 10px; border: 1px solid var(--app-line); border-radius: var(--app-radius-sm); }
    legend { padding-inline: 4px; font-weight: 600; }
    .collection-node-form { display: grid; width: min(100%, 360px); grid-template-columns: 32px minmax(0, 1fr); align-items: center; column-gap: 14px; margin: 8px auto; }
    .collection-node-form.has-tier { width: min(100%, 440px); grid-template-columns: 32px minmax(0, 1fr) minmax(80px, 0.55fr); }
    .collection-node-form select { padding-right: 16px; }
    .collection-node-icon, .collection-node-icon-placeholder { width: 36px; height: 36px; object-fit: contain; }
    .collection-node-icon-placeholder { display: grid; place-items: center; border-radius: var(--app-radius-sm); background: var(--app-panel-variant); color: var(--app-muted); }
    .collection-node-tier-fixed { color: var(--app-muted); font-size: 0.9rem; font-weight: 600; text-align: center; }
    .field { display: flex; flex-direction: column; gap: 4px; margin: 12px 0; font-size: 0.85rem; font-weight: 500; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionBuildEditorComponent {
  readonly catalog = input.required<readonly CollectionCatalogItem[]>();
  readonly selectedCatalogId = input.required<number>();
  readonly nodeStats = input.required<readonly CollectionNodeStat[]>();
  readonly nodes = input.required<readonly CollectionNode[]>();
  readonly selectedCatalogIdChange = output<number>();
  readonly nodesChange = output<readonly CollectionNode[]>();
  readonly collectionNodeSlots = [
    { category: 'Attack', indices: [0, 1, 2] },
    { category: 'Defense', indices: [3, 4, 5] },
    { category: 'Flex', indices: [6, 7] },
  ] as const;

  nodeAt(slotIndex: number): CollectionNode | undefined {
    return this.nodes().find((node) => node.slotIndex === slotIndex);
  }

  statsForSlot(slotIndex: number): readonly CollectionNodeStat[] {
    return slotIndex < 6 ? this.nodeStats().filter((stat) => stat !== 'skill_level') : this.nodeStats();
  }

  collectionNodeLabel(stat: CollectionNodeStat): string {
    return collectionNodeLabel(stat);
  }

  collectionNodeIconUrl(stat: CollectionNodeStat, tier: CollectionNode['tier']): string {
    return collectionNodeIconUrl(stat, tier);
  }

  collectionIcon(collectionId: number, nodes: readonly CollectionNode[]): string {
    return collectionIconUrl(collectionId);
  }

  collectionSlotLabel(slotIndex: number): string {
    if (slotIndex < 3) return `Attack ${slotIndex + 1}`;
    if (slotIndex < 6) return `Defense ${slotIndex - 2}`;
    return `Flex ${slotIndex - 5}`;
  }

  inputValue(event: Event): string {
    const input = event.target;
    return input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? input.value : '';
  }

  updateStat(slotIndex: number, stat: string): void {
    if (!stat) {
      this.emitNodes(this.nodes().filter((node) => node.slotIndex !== slotIndex));
      return;
    }
    if (!this.statsForSlot(slotIndex).includes(stat)) return;
    const existing = this.nodeAt(slotIndex);
    this.emitNodes([
      ...this.nodes().filter((node) => node.slotIndex !== slotIndex),
      { slotIndex, stat, tier: stat === 'skill_level' ? 'mythic' : existing?.tier ?? 'mythic' },
    ].sort((left, right) => left.slotIndex - right.slotIndex));
  }

  updateTier(slotIndex: number, tier: string): void {
    if (tier !== 'elite' && tier !== 'legendary' && tier !== 'mythic') return;
    const current = this.nodeAt(slotIndex);
    if (!current) return;
    this.emitNodes(this.nodes().map((node) =>
      node.slotIndex === slotIndex ? { ...node, tier: node.stat === 'skill_level' ? 'mythic' : tier } : node,
    ));
  }

  private emitNodes(nodes: readonly CollectionNode[]): void {
    this.nodesChange.emit(nodes);
  }
}
