import { TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { HeroAttribute } from '../../hero-classification';
import { HERO_CLASSES, HERO_TYPES } from '../../hero-filters';
import { rosterFilterColor } from '../../roster-filter-colors';

@Component({
  selector: 'app-hero-filters',
  standalone: true,
  imports: [MatButtonModule, TitleCasePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="roster-filters" role="group" aria-label="Filter heroes">
      <div class="icon-filter-row" role="group" aria-label="Faction">
        <span class="icon-filter-label">Faction</span>
        <button mat-button type="button" class="icon-filter-button" [class.active]="!faction()" [attr.aria-pressed]="!faction()" aria-label="All factions" title="All factions" (click)="faction.set('')">
          <span class="filter-option-content"><span class="filter-token">ALL</span><span class="filter-caption">All</span></span>
        </button>
        @for (option of factions(); track option) {
          <button mat-button type="button" class="icon-filter-button" [class.active]="faction() === option" [attr.aria-pressed]="faction() === option" [attr.aria-label]="option" [attr.title]="option" (click)="faction.set(option)">
            <span class="filter-option-content"><span class="filter-token" [style.--filter-color]="filterColor('faction', option)">{{ filterToken('faction', option) }}</span><span class="filter-caption">{{ option }}</span></span>
          </button>
        }
      </div>
      <div class="icon-filter-row" role="group" aria-label="Class">
        <span class="icon-filter-label">Class</span>
        <button mat-button type="button" class="icon-filter-button" [class.active]="!heroClass()" [attr.aria-pressed]="!heroClass()" aria-label="All classes" title="All classes" (click)="heroClass.set('')">
          <span class="filter-option-content"><span class="filter-token">ALL</span><span class="filter-caption">All</span></span>
        </button>
        @for (option of classes; track option) {
          <button mat-button type="button" class="icon-filter-button" [class.active]="heroClass() === option" [attr.aria-pressed]="heroClass() === option" [attr.aria-label]="option" [attr.title]="option" (click)="heroClass.set(option)">
            <span class="filter-option-content"><span class="filter-token" [style.--filter-color]="filterColor('class', option)">{{ filterToken('class', option) }}</span><span class="filter-caption">{{ option }}</span></span>
          </button>
        }
      </div>
      <div class="icon-filter-row" role="group" aria-label="Type">
        <span class="icon-filter-label">Type</span>
        <button mat-button type="button" class="icon-filter-button" [class.active]="!type()" [attr.aria-pressed]="!type()" aria-label="All types" title="All types" (click)="type.set('')">
          <span class="filter-option-content"><span class="filter-token">ALL</span><span class="filter-caption">All</span></span>
        </button>
        @for (option of types; track option) {
          <button mat-button type="button" class="icon-filter-button" [class.active]="type() === option" [attr.aria-pressed]="type() === option" [attr.aria-label]="option | titlecase" [attr.title]="option | titlecase" (click)="type.set(option)">
            <span class="filter-option-content"><span class="filter-token" [style.--filter-color]="filterColor('type', option)">{{ filterToken('type', option) }}</span><span class="filter-caption">{{ option | titlecase }}</span></span>
          </button>
        }
      </div>
    </div>
  `,
})
export class HeroFiltersComponent {
  readonly factions = input.required<readonly string[]>();
  readonly faction = model('');
  readonly heroClass = model('');
  readonly type = model<HeroAttribute | ''>('');
  readonly classes = HERO_CLASSES;
  readonly types = HERO_TYPES;

  filterToken(kind: 'faction' | 'class' | 'type', value: string): string {
    const normalized = value.toLocaleLowerCase();
    const tokens: Readonly<Record<string, string>> = kind === 'faction'
      ? { lightbearer: 'LB', mauler: 'M', wilder: 'W', graveborn: 'GB', celestial: 'C', hypogean: 'H', dimensional: 'D' }
      : kind === 'class'
        ? { warrior: 'W', tank: 'T', ranger: 'R', mage: 'M', support: 'S' }
        : { strength: 'STR', agility: 'AGI', intelligence: 'INT' };
    return tokens[normalized] ?? value.slice(0, 2).toLocaleUpperCase();
  }

  filterColor(kind: 'faction' | 'class' | 'type', value: string): string {
    return rosterFilterColor(kind, value);
  }
}
