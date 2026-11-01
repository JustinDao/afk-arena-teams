import { CdkTrapFocus } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { HeroAttribute } from '../../hero-classification';
import { factionOptions, filterHeroes } from '../../hero-filters';
import { Hero } from '../../models';
import { HeroFiltersComponent } from '../hero-filters/hero-filters.component';
import { HeroPickerComponent } from '../hero-picker/hero-picker.component';

@Component({
  selector: 'app-add-hero-modal',
  standalone: true,
  imports: [CdkTrapFocus, HeroFiltersComponent, HeroPickerComponent, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" role="presentation">
      <section class="panel hero-modal" role="dialog" aria-modal="true" aria-label="Add hero" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <h2>Add hero</h2>
        <app-hero-filters
          [factions]="factions()"
          [(faction)]="factionFilter"
          [(heroClass)]="classFilter"
          [(type)]="typeFilter"
        />
        <app-hero-picker
          class="roster-pick hero-roster-pick"
          [heroes]="filteredHeroes()"
          [disabledIds]="disabledIds()"
          [selectedIds]="ownedIds()"
          searchId="roster-search"
          searchLabel="Search heroes"
          (heroSelected)="heroSelected.emit($event)"
        />
        <div class="row-wrap modal-actions">
          <button mat-button type="button" class="btn" (click)="closed.emit()">Close</button>
        </div>
      </section>
    </div>
  `,
})
export class AddHeroModalComponent {
  private readonly icons = inject(HeroIconService);
  readonly heroes = input.required<readonly Hero[]>();
  readonly ownedIds = input<readonly number[]>([]);
  readonly disabledIds = input<readonly number[]>([]);
  readonly heroSelected = output<number>();
  readonly closed = output<void>();
  readonly factionFilter = signal('');
  readonly classFilter = signal('');
  readonly typeFilter = signal<HeroAttribute | ''>('');
  readonly factions = computed(() => factionOptions(this.heroes(), this.icons));
  readonly filteredHeroes = computed(() => filterHeroes(this.heroes(), {
    faction: this.factionFilter(),
    heroClass: this.classFilter(),
    type: this.typeFilter(),
  }, this.icons));
}
