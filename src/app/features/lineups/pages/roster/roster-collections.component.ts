import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../../../core/auth/auth.service';
import { COLLECTION_NODE_TIERS, collectionIconUrl, collectionNodeIconUrl, collectionNodeLabel } from '../../collection-catalog';
import { LineupsStore } from '../../lineups.store';
import { CollectionInventoryItem, CollectionNode, CollectionNodeStat } from '../../models';
import { rosterClassFilterColor } from '../../roster-filter-colors';

@Component({
  selector: 'app-roster-collections',
  standalone: true,
  imports: [MatButtonModule, ReactiveFormsModule],
  templateUrl: './roster-collections.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RosterCollectionsComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  readonly collectionClassFilter = signal('');
  readonly collectionClasses = computed(() => {
    const order = ['Warrior', 'Tank', 'Ranger', 'Mage', 'Support'];
    return [...new Set(this.store.collectionCatalog().map(({ class: collectionClass }) => collectionClass))]
      .sort((left, right) => order.indexOf(left) - order.indexOf(right));
  });
  readonly collectionCatalog = computed(() => [...this.store.collectionCatalog()]
    .sort((left, right) => left.name.localeCompare(right.name)));
  readonly filteredCollectionCatalog = computed(() => this.collectionCatalog()
    .filter((collection) => !this.collectionClassFilter() || collection.class === this.collectionClassFilter()));
  readonly savedCollections = computed(() => [...this.store.collections()]
    .filter((collection) => !this.collectionClassFilter() || collection.class === this.collectionClassFilter())
    .sort((left, right) => left.name.localeCompare(right.name)));
  readonly collectionNodeStats = this.store.collectionNodeStats;
  readonly collectionNodeTiers = COLLECTION_NODE_TIERS;
  readonly collectionNodeSlots = [
    { category: 'Attack', indices: [0, 1, 2] },
    { category: 'Defense', indices: [3, 4, 5] },
    { category: 'Flex', indices: [6, 7] },
  ] as const;
  readonly collectionNodes = signal<CollectionNode[]>([]);
  readonly editingCollectionId = signal<string | null>(null);
  readonly collectionError = signal<string | null>(null);
  readonly collectionForm = new FormGroup({
    catalogId: new FormControl(1, { nonNullable: true }),
  });
  private hasExplicitCollectionSelection = false;

  constructor() {
    effect(() => {
      const firstCollection = this.collectionCatalog()[0];
      if (firstCollection && !this.hasExplicitCollectionSelection) {
        this.collectionForm.controls.catalogId.setValue(firstCollection.id, { emitEvent: false });
      }
    });
    void this.store.loadCollections();
  }

  async saveCollection(): Promise<void> {
    if (this.collectionForm.invalid || !this.auth.user()) return;
    const value = this.collectionForm.getRawValue();
    const catalogItem = this.collectionCatalog().find(({ id }) => id === value.catalogId);
    if (!catalogItem) {
      this.collectionError.set('Choose a collection from the catalog.');
      return;
    }
    const id = this.editingCollectionId();
    const collection = id
      ? { id, catalogId: catalogItem.id, name: catalogItem.name, class: catalogItem.class, nodes: this.collectionNodes() }
      : { catalogId: catalogItem.id, name: catalogItem.name, class: catalogItem.class, nodes: this.collectionNodes() };
    if (await this.store.saveCollection(collection)) {
      this.cancelCollectionEdit();
    }
  }

  editCollection(collection: CollectionInventoryItem): void {
    if (collection.catalogId === undefined) return;
    this.hasExplicitCollectionSelection = true;
    this.editingCollectionId.set(collection.id);
    this.collectionForm.reset({ catalogId: collection.catalogId });
    this.collectionNodes.set([...collection.nodes]);
    this.collectionError.set(null);
  }

  cancelCollectionEdit(): void {
    this.editingCollectionId.set(null);
    this.hasExplicitCollectionSelection = false;
    this.collectionForm.reset({ catalogId: this.collectionCatalog()[0]?.id ?? 1 });
    this.collectionNodes.set([]);
    this.collectionError.set(null);
  }

  selectCollection(catalogId: number): void {
    this.hasExplicitCollectionSelection = true;
    this.collectionForm.controls.catalogId.setValue(catalogId);
  }

  setCollectionClass(collectionClass: string): void {
    this.collectionClassFilter.set(collectionClass);
    if (
      collectionClass &&
      this.collectionCatalog().find(({ id }) => id === this.collectionForm.controls.catalogId.value)?.class !== collectionClass
    ) {
      const firstMatchingCollection = this.collectionCatalog().find(({ class: value }) => value === collectionClass);
      if (firstMatchingCollection) this.selectCollection(firstMatchingCollection.id);
    }
  }

  collectionClassToken(collectionClass: string): string {
    const tokens: Readonly<Record<string, string>> = {
      warrior: 'W',
      tank: 'T',
      ranger: 'R',
      mage: 'M',
      support: 'S',
    };
    return tokens[collectionClass.toLocaleLowerCase()] ?? collectionClass.slice(0, 2).toLocaleUpperCase();
  }

  collectionClassColor(collectionClass: string): string {
    return rosterClassFilterColor(collectionClass);
  }

  async deleteCollection(collection: CollectionInventoryItem): Promise<void> {
    if (await this.store.deleteCollection(collection.id) && this.editingCollectionId() === collection.id) {
      this.cancelCollectionEdit();
    }
  }

  updateCollectionNodeStat(slotIndex: number, stat: string): void {
    if (stat === '') {
      this.removeCollectionNode(slotIndex);
      return;
    }
    if (!this.collectionNodeStatsForSlot(slotIndex).includes(stat)) {
      this.collectionError.set('Choose a stat from the collection catalog.');
      return;
    }
    this.updateCollectionNode(slotIndex, (existing) => ({
      slotIndex,
      stat,
      tier: stat === 'skill_level' ? 'mythic' : existing?.tier ?? 'mythic',
    }));
  }

  updateCollectionNodeTier(slotIndex: number, tier: string): void {
    if (!this.collectionNodeTiers.includes(tier as CollectionNode['tier'])) {
      this.collectionError.set('Choose a tier from the collection catalog.');
      return;
    }
    const existing = this.collectionNodes().find((node) => node.slotIndex === slotIndex);
    if (existing) {
      this.updateCollectionNode(slotIndex, () => ({
        ...existing,
        tier: existing.stat === 'skill_level' ? 'mythic' : tier as CollectionNode['tier'],
      }));
    }
  }

  private updateCollectionNode(slotIndex: number, update: (node: CollectionNode | undefined) => CollectionNode): void {
    const existing = this.collectionNodes().find((node) => node.slotIndex === slotIndex);
    this.collectionNodes.update((nodes) => [
      ...nodes.filter((node) => node.slotIndex !== slotIndex),
      update(existing),
    ].sort((left, right) => left.slotIndex - right.slotIndex));
    this.collectionError.set(null);
  }

  removeCollectionNode(slotIndex: number): void {
    this.collectionNodes.update((nodes) => nodes.filter((item) => item.slotIndex !== slotIndex));
    this.collectionError.set(null);
  }

  collectionNodeLabel(node: CollectionNode): string {
    return `${node.tier[0].toUpperCase()} ${collectionNodeLabel(node.stat)}`;
  }

  collectionNodeStatLabel(stat: CollectionNodeStat): string {
    return collectionNodeLabel(stat);
  }

  collectionNodeStatsForSlot(slotIndex: number): readonly CollectionNodeStat[] {
    return slotIndex < 6
      ? this.collectionNodeStats().filter((stat) => stat !== 'skill_level')
      : this.collectionNodeStats();
  }

  collectionNodeAt(slotIndex: number): CollectionNode | undefined {
    return this.collectionNodes().find((node) => node.slotIndex === slotIndex);
  }

  collectionSummary(nodes: readonly CollectionNode[]): string {
    return nodes.map((node) => `${this.collectionSlotLabel(node.slotIndex)}: ${this.collectionNodeLabel(node)}`).join(' · ');
  }

  collectionIcon(collectionId: number, nodes: readonly CollectionNode[]): string {
    const levelNodeCount = nodes.filter(({ stat }) => stat === 'skill_level').length;
    return collectionIconUrl(collectionId, levelNodeCount + 1);
  }

  collectionNodeIcon(stat: CollectionNodeStat, tier: CollectionNode['tier']): string {
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
}
