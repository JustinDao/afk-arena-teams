import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'
import { AuthService } from '../../../../core/auth/auth.service'
import { collectionIconUrlForNodes, collectionNodeLabel, defaultCollectionName } from '../../collection-catalog'
import { AddCollectionModalComponent } from '../../components/add-collection-modal/add-collection-modal.component'
import {
  CollectionEditorModalComponent,
  CollectionEditorResult,
} from '../../components/collection-editor-modal/collection-editor-modal.component'
import { HeroFiltersComponent } from '../../components/hero-filters/hero-filters.component'
import { LineupsStore } from '../../lineups.store'
import { CollectionInventoryItem, CollectionNode } from '../../models'

const CLASS_ORDER = ['Warrior', 'Tank', 'Ranger', 'Mage', 'Support'];

function tierCount(collection: CollectionInventoryItem, tier: CollectionNode['tier']): number {
  return collection.nodes.filter((node) => node.stat !== 'skill_level' && node.tier === tier).length;
}

// Class, then level, then mythic / legendary / epic (elite) node counts; highest first.
function compareCollections(left: CollectionInventoryItem, right: CollectionInventoryItem): number {
  const classRank = (collection: CollectionInventoryItem) => {
    const index = CLASS_ORDER.indexOf(collection.class ?? '');
    return index === -1 ? CLASS_ORDER.length : index;
  };
  const level = (collection: CollectionInventoryItem) => collection.nodes.filter((node) => node.stat === 'skill_level').length;
  return classRank(left) - classRank(right)
    || level(right) - level(left)
    || tierCount(right, 'mythic') - tierCount(left, 'mythic')
    || tierCount(right, 'legendary') - tierCount(left, 'legendary')
    || tierCount(right, 'elite') - tierCount(left, 'elite')
    || left.name.localeCompare(right.name);
}

@Component({
  selector: 'app-roster-collections',
  standalone: true,
  imports: [AddCollectionModalComponent, CollectionEditorModalComponent, HeroFiltersComponent, MatButtonModule],
  templateUrl: './roster-collections.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RosterCollectionsComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  readonly collectionClassFilter = signal('');
  readonly addingCollection = signal(false);
  readonly newCatalogId = signal<number | null>(null);
  readonly editingCollectionId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly collectionCatalog = computed(() => [...this.store.collectionCatalog()]
    .sort((left, right) => left.name.localeCompare(right.name)));
  readonly savedCollections = computed(() => [...this.store.collections()]
    .filter((collection) => !this.collectionClassFilter() || collection.class === this.collectionClassFilter())
    .sort(compareCollections));
  readonly editingCollection = computed(() => {
    const id = this.editingCollectionId();
    return id ? this.store.collections().find((collection) => collection.id === id) ?? null : null;
  });
  readonly editorCatalogItem = computed(() => {
    const catalogId = this.editingCollection()?.catalogId ?? this.newCatalogId();
    return catalogId === null ? null : this.collectionCatalog().find(({ id }) => id === catalogId) ?? null;
  });

  constructor() {
    void this.store.loadCollections();
  }

  startNewCollection(catalogId: number): void {
    this.addingCollection.set(false);
    this.editingCollectionId.set(null);
    this.newCatalogId.set(catalogId);
  }

  closeEditor(): void {
    this.newCatalogId.set(null);
    this.editingCollectionId.set(null);
  }

  async saveCollection(result: CollectionEditorResult): Promise<void> {
    const catalogItem = this.editorCatalogItem();
    if (!catalogItem || !this.auth.user()) return;
    const existing = this.editingCollection();
    const collection = {
      ...(existing ? { id: existing.id } : {}),
      catalogId: catalogItem.id,
      name: result.name,
      class: catalogItem.class,
      nodes: result.nodes,
    };
    this.saving.set(true);
    try {
      if (await this.store.saveCollection(collection as CollectionInventoryItem)) this.closeEditor();
    } finally {
      this.saving.set(false);
    }
  }

  async removeCollection(): Promise<void> {
    const existing = this.editingCollection();
    if (!existing) return;
    this.saving.set(true);
    try {
      if (await this.store.deleteCollection(existing.id)) this.closeEditor();
    } finally {
      this.saving.set(false);
    }
  }

  collectionIcon(collection: CollectionInventoryItem): string {
    return collectionIconUrlForNodes(collection.catalogId ?? 0, collection.nodes);
  }

  displayName(collection: CollectionInventoryItem): string {
    const catalogName = this.collectionCatalog().find(({ id }) => id === collection.catalogId)?.name;
    return catalogName && collection.name === catalogName
      ? defaultCollectionName(catalogName, collection.nodes)
      : collection.name;
  }

  collectionSummary(nodes: readonly CollectionNode[]): string {
    return nodes
      .map((node) => node.stat === 'skill_level' ? 'LEVEL' : `${node.tier[0].toUpperCase()} ${collectionNodeLabel(node.stat)}`)
      .join(' · ');
  }
}
