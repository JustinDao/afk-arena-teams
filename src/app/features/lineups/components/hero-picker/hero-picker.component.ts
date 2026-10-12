import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { Hero } from '../../models';
import { rosterFilterColor } from '../../roster-filter-colors';

@Component({
  selector: 'app-hero-picker',
  standalone: true,
  imports: [HeroIconComponent, MatButtonModule],
  template: `
    <label class="visually-hidden" [for]="searchId()">{{ searchLabel() }}</label>
    <input
      [id]="searchId()"
      class="search"
      [placeholder]="searchPlaceholder()"
      [value]="search()"
      (input)="setSearch($event)"
    >
    <div class="pick">
      @for (hero of filteredHeroes(); track hero.id) {
        <button
          mat-button
          type="button"
          class="hero-pick"
          [class.owned]="selectedIds().includes(hero.id)"
          [style.--hero-faction-color]="factionColor(hero)"
          [disabled]="disabledIds().includes(hero.id)"
          (click)="heroSelected.emit(hero.id)"
        >
          <app-hero-icon [name]="hero.name" [imageUrl]="hero.iconUrl ?? null" />
          {{ hero.name }}
        </button>
      } @empty {
        <p class="muted">{{ emptyMessage() }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroPickerComponent {
  private readonly icons = inject(HeroIconService);
  readonly heroes = input.required<readonly Hero[]>();
  readonly disabledIds = input<readonly number[]>([]);
  readonly selectedIds = input<readonly number[]>([]);
  readonly searchId = input('hero-picker-search');
  readonly searchLabel = input('Search heroes');
  readonly searchPlaceholder = input('Search heroes');
  readonly emptyMessage = input('No heroes match that search.');
  readonly heroSelected = output<number>();
  readonly search = signal('');
  readonly filteredHeroes = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.heroes().filter((hero) => hero.name.toLocaleLowerCase().includes(query));
  });

  setSearch(event: Event): void {
    const inputElement = event.target;
    if (inputElement instanceof HTMLInputElement) this.search.set(inputElement.value);
  }

  factionColor(hero: Hero): string {
    const faction = hero.faction ?? this.icons.factionFor(hero.name);
    return rosterFilterColor('faction', faction ?? '');
  }
}
