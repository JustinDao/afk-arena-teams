import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CollectionCatalogItem } from '../../models';
import { CollectionPickerComponent } from '../collection-picker/collection-picker.component';
import { HeroFiltersComponent } from '../hero-filters/hero-filters.component';

@Component({
  selector: 'app-add-collection-modal',
  standalone: true,
  imports: [CdkTrapFocus, CollectionPickerComponent, HeroFiltersComponent, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" role="presentation">
      <section class="panel hero-modal" role="dialog" aria-modal="true" aria-label="Add collection" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <h2>Add collection</h2>
        <app-hero-filters
          label="Filter collections"
          [showFaction]="false"
          [showType]="false"
          [(heroClass)]="classFilter"
        />
        <div class="roster-pick collection-roster-pick">
          <app-collection-picker [catalog]="filteredCatalog()" (selectedIdChange)="collectionSelected.emit($event)" />
        </div>
        <div class="row-wrap modal-actions">
          <button mat-button type="button" class="btn" (click)="closed.emit()">Close</button>
        </div>
      </section>
    </div>
  `,
})
export class AddCollectionModalComponent {
  readonly catalog = input.required<readonly CollectionCatalogItem[]>();
  readonly collectionSelected = output<number>();
  readonly closed = output<void>();
  readonly classFilter = signal('');
  readonly filteredCatalog = computed(() => this.catalog()
    .filter((collection) => !this.classFilter() || collection.class === this.classFilter()));
}
