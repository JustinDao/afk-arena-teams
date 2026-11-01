import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { collectionIconUrl } from '../../collection-catalog';
import { CollectionCatalogItem } from '../../models';

@Component({
  selector: 'app-collection-picker',
  standalone: true,
  imports: [MatButtonModule],
  template: `
    <div class="collection-picker" aria-label="Choose a collection">
      @for (collection of catalog(); track collection.id) {
        <button
          mat-button
          type="button"
          class="collection-choice"
          [class.selected]="selectedId() === collection.id"
          [attr.aria-pressed]="selectedId() === collection.id"
          [attr.aria-label]="collection.name + ', ' + collection.class"
          (click)="selectedIdChange.emit(collection.id)"
        >
          <img class="collection-icon" [src]="iconUrl(collection.id)" alt="">
          <span class="collection-choice-copy">
            <span class="collection-choice-name">{{ collection.name }}</span>
          </span>
        </button>
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
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionPickerComponent {
  readonly catalog = input.required<readonly CollectionCatalogItem[]>();
  readonly selectedId = input<number | null>(null);
  readonly selectedIdChange = output<number>();

  iconUrl(collectionId: number): string {
    return collectionIconUrl(collectionId);
  }
}
