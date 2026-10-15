import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TitleCasePipe } from '@angular/common';
import { AuthService } from '../../../../core/auth/auth.service';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { HeroInvestmentEditorComponent } from '../../components/hero-investment-editor/hero-investment-editor.component';
import { HeroPickerComponent } from '../../components/hero-picker/hero-picker.component';
import { HeroAttribute } from '../../hero-classification';
import { LineupsStore } from '../../lineups.store';
import { rosterFilterColor } from '../../roster-filter-colors';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  selector: 'app-roster-heroes',
  standalone: true,
  imports: [ConfirmDialogComponent, HeroInvestmentEditorComponent, HeroPickerComponent, MatButtonModule, TitleCasePipe],
  templateUrl: './roster-heroes.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RosterHeroesComponent {
  readonly store = inject(LineupsStore);
  private readonly auth = inject(AuthService);
  private readonly heroIcons = inject(HeroIconService);
  readonly factionFilter = signal('');
  readonly classFilter = signal('');
  readonly typeFilter = signal<HeroAttribute | ''>('');
  readonly confirmingClear = signal(false);
  readonly investmentMode = signal<'short' | 'long'>('short');
  readonly factions = computed(() => this.factionOptions());
  readonly classes = ['Warrior', 'Tank', 'Ranger', 'Mage', 'Support'] as const;
  readonly types = ['strength', 'agility', 'intelligence'] as const;
  readonly ownedHeroIds = computed(() => Object.keys(this.store.roster()).map(Number));
  readonly disabledHeroIds = computed(() => this.busy() ? this.store.heroes().map(({ id }) => id) : []);
  readonly filteredHeroes = computed(() => {
    return this.store.heroes().filter((hero) =>
      (!this.factionFilter() || this.heroFaction(hero.name, hero.faction) === this.factionFilter()) &&
      (!this.classFilter() || this.heroClass(hero.name, hero.class) === this.classFilter()) &&
      (!this.typeFilter() || hero.type === this.typeFilter()),
    );
  });
  readonly busy = computed(() =>
    this.auth.configured && (!this.store.backendReady() || this.store.rosterDetailsLoading()),
  );

  setFaction(faction: string): void {
    this.factionFilter.set(faction);
  }

  setClass(heroClass: string): void {
    this.classFilter.set(heroClass);
  }

  setType(type: string): void {
    this.typeFilter.set(this.types.find((candidate) => candidate === type) ?? '');
  }

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

  factionColor(hero: { readonly name: string; readonly faction?: string | null }): string {
    const faction = this.heroFaction(hero.name, hero.faction);
    return faction ? rosterFilterColor('faction', faction) : '#a8b4ca';
  }

  heroHue(hero: { readonly name: string; readonly faction?: string | null }): number {
    return this.store.hue(this.heroFaction(hero.name, hero.faction) ?? hero.name);
  }

  nullableNumberValue(event: Event): number | null {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.value.trim() === '') return null;
    const value = Number(input.value);
    return Number.isInteger(value) ? value : null;
  }

  confirmClear(): void {
    this.confirmingClear.set(false);
    this.store.clearRoster();
  }

  quickSet(heroId: number, investment: string): void {
    this.store.updateRosterInvestment(heroId, investment);
  }

  private factionOptions(): string[] {
    const options = [...new Set(this.store.heroes().map(({ name, faction }) =>
      this.heroFaction(name, faction),
    ).filter((value): value is string => value !== null))];
    const order = ['Lightbearer', 'Mauler', 'Wilder', 'Graveborn', 'Celestial', 'Hypogean', 'Dimensional', 'Draconis'];
    return options.sort((left, right) => {
      const leftIndex = order.indexOf(left);
      const rightIndex = order.indexOf(right);
      if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
      if (leftIndex >= 0) return -1;
      if (rightIndex >= 0) return 1;
      return left.localeCompare(right);
    });
  }

  private heroFaction(name: string, faction?: string | null): string | null {
    return faction ?? this.heroIcons.factionFor(name);
  }

  private heroClass(name: string, heroClass?: string | null): string | null {
    return heroClass ?? this.heroIcons.classFor(name);
  }

}
