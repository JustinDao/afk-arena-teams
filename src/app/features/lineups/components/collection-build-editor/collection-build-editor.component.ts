import { ChangeDetectionStrategy, Component, input, output } from '@angular/core'
import {
  ATTACK_COLLECTION_NODE_STATS,
  collectionNodeIconUrl,
  collectionNodeLabel,
  DEFENSE_COLLECTION_NODE_STATS,
} from '../../collection-catalog'
import { CollectionPickerComponent } from '../collection-picker/collection-picker.component'
import { CollectionCatalogItem, CollectionNode, CollectionNodeStat } from '../../models'

@Component({
  selector: 'app-collection-build-editor',
  standalone: true,
  imports: [CollectionPickerComponent],
  template: `
    @if (showPicker()) {
      <app-collection-picker [catalog]="catalog()" [selectedId]="selectedCatalogId()" (selectedIdChange)="selectedCatalogIdChange.emit($event)" />
    }
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
  readonly catalog = input<readonly CollectionCatalogItem[]>([]);
  readonly selectedCatalogId = input<number>(0);
  readonly showPicker = input(true);
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
    const currentNode = this.nodeAt(slotIndex);
    let allowed: readonly CollectionNodeStat[];
    if (slotIndex < 3) {
      allowed = this.nodeStats().filter((stat) => ATTACK_COLLECTION_NODE_STATS.includes(stat));
    } else if (slotIndex < 6) {
      allowed = this.nodeStats().filter((stat) => DEFENSE_COLLECTION_NODE_STATS.includes(stat));
    } else {
      allowed = this.nodeStats();
    }
    if (currentNode && !allowed.includes(currentNode.stat)) {
      return [currentNode.stat, ...allowed];
    }
    return allowed;
  }

  collectionNodeLabel(stat: CollectionNodeStat): string {
    return collectionNodeLabel(stat);
  }

  collectionNodeIconUrl(stat: CollectionNodeStat, tier: CollectionNode['tier']): string {
    return collectionNodeIconUrl(stat, tier);
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
