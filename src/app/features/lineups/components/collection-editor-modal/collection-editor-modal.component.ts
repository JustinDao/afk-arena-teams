import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { collectionIconUrlForNodes, defaultCollectionName } from '../../collection-catalog';
import { CollectionCatalogItem, CollectionInventoryItem, CollectionNode, CollectionNodeStat } from '../../models';
import { CollectionBuildEditorComponent } from '../collection-build-editor/collection-build-editor.component';

export interface CollectionEditorResult {
  readonly name: string;
  readonly nodes: readonly CollectionNode[];
}

@Component({
  selector: 'app-collection-editor-modal',
  standalone: true,
  imports: [CdkTrapFocus, CollectionBuildEditorComponent, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" role="presentation">
      <section class="panel hero-modal collection-modal" role="dialog" aria-modal="true" [attr.aria-label]="(existing() ? 'Edit ' : 'Add ') + catalogItem().name" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <div class="collection-modal-head">
          <img class="collection-icon" [src]="iconUrl()" alt="">
          <label class="collection-name-field">
            <span>Name</span>
            <input type="text" maxlength="80" [value]="name()" [placeholder]="defaultName()" aria-label="Collection name" (input)="onName($event)">
            <small class="muted">{{ catalogItem().name }} · {{ catalogItem().class }}. Defaults to its non-Level mythic nodes.</small>
          </label>
        </div>
        <app-collection-build-editor
          [showPicker]="false"
          [nodeStats]="nodeStats()"
          [nodes]="nodes()"
          (nodesChange)="nodes.set($event)"
        />
        <div class="row-wrap modal-actions">
          @if (existing()) {
            <button mat-button type="button" class="btn" [disabled]="busy()" (click)="removed.emit()">Remove</button>
          }
          <button mat-button type="button" class="btn" (click)="closed.emit()">Cancel</button>
          <button mat-flat-button type="button" class="btn primary" [disabled]="busy() || !name().trim()" (click)="save()">Save</button>
        </div>
      </section>
    </div>
  `,
})
export class CollectionEditorModalComponent {
  readonly catalogItem = input.required<CollectionCatalogItem>();
  readonly existing = input<CollectionInventoryItem | null>(null);
  readonly nodeStats = input.required<readonly CollectionNodeStat[]>();
  readonly busy = input(false);
  readonly saved = output<CollectionEditorResult>();
  readonly removed = output<void>();
  readonly closed = output<void>();

  readonly nodes = linkedSignal<readonly CollectionNode[]>(() => this.existing()?.nodes ?? []);
  readonly customName = linkedSignal<string | null>(() => {
    const existing = this.existing();
    if (!existing) return null;
    const derived = defaultCollectionName(this.catalogItem().name, existing.nodes);
    return existing.name === this.catalogItem().name || existing.name === derived ? null : existing.name;
  });
  readonly defaultName = computed(() => defaultCollectionName(this.catalogItem().name, this.nodes()));
  readonly name = computed(() => this.customName() ?? this.defaultName());
  readonly iconUrl = computed(() => collectionIconUrlForNodes(this.catalogItem().id, this.nodes()));

  onName(event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    this.customName.set(value.trim() ? value : null);
  }

  save(): void {
    const name = this.name().trim().slice(0, 80);
    if (name) this.saved.emit({ name, nodes: this.nodes() });
  }
}
