import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../../../core/auth/auth.service';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { HeroInvestmentEditorComponent } from '../../components/hero-investment-editor/hero-investment-editor.component';
import { AddHeroModalComponent } from '../../components/add-hero-modal/add-hero-modal.component';
import { HeroFiltersComponent } from '../../components/hero-filters/hero-filters.component';
import { factionOptions, filterHeroes } from '../../hero-filters';
import { HeroAttribute } from '../../hero-classification';
import { defaultAscensionForInvestment, rosterInvestment } from '../../investment';
import { AscensionRank, displayHeroName, Hero, Investment } from '../../models';
import { LineupsStore } from '../../lineups.store';

@Component({
  selector: 'app-roster-heroes',
  standalone: true,
  imports: [AddHeroModalComponent, CdkTrapFocus, HeroFiltersComponent, HeroIconComponent, HeroInvestmentEditorComponent, MatButtonModule],
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
  readonly addingHero = signal(false);
  readonly editingHeroId = signal<number | null>(null);
  readonly editingHero = computed(() => {
    const id = this.editingHeroId();
    return id === null || !this.store.roster()[id] ? null : this.store.heroes().find((hero) => hero.id === id) ?? null;
  });
  readonly investmentMode = signal<'short' | 'long'>('short');
  readonly factions = computed(() => factionOptions(this.store.heroes(), this.heroIcons));
  readonly ownedHeroIds = computed(() => Object.keys(this.store.roster()).map(Number));
  readonly disabledHeroIds = computed(() => this.busy() ? this.store.heroes().map(({ id }) => id) : []);
  readonly filteredHeroes = computed(() => filterHeroes(this.store.heroes(), {
    faction: this.factionFilter(),
    heroClass: this.classFilter(),
    type: this.typeFilter(),
  }, this.heroIcons));
  readonly ownedFilteredHeroes = computed(() =>
    this.filteredHeroes().filter((hero) => this.store.roster()[hero.id]),
  );
  readonly busy = computed(() =>
    this.auth.configured && (!this.store.backendReady() || this.store.rosterDetailsLoading()),
  );

  nullableNumberValue(event: Event): number | null {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.value.trim() === '') return null;
    const value = Number(input.value);
    return Number.isInteger(value) ? value : null;
  }

  displayName(hero: Hero): string {
    return displayHeroName(hero);
  }

  investmentOf(heroId: number): Investment | null {
    return rosterInvestment(this.store.roster()[heroId]);
  }

  ascensionOf(hero: Hero): AscensionRank {
    return this.store.roster()[hero.id]?.ascension
      ?? defaultAscensionForInvestment(this.investmentOf(hero.id))
      ?? this.heroIcons.lowestAscensionFor(displayHeroName(hero));
  }

  addHero(heroId: number): void {
    this.addingHero.set(false);
    const hero = this.store.heroes().find(({ id }) => id === heroId);
    if (!this.store.roster()[heroId]) {
      this.store.toggleHero(heroId);
      if (hero) this.store.updateRosterAscension(heroId, this.ascensionOf(hero));
    }
    this.editingHeroId.set(heroId);
  }

  removeHero(heroId: number): void {
    this.editingHeroId.set(null);
    if (this.store.roster()[heroId]) this.store.toggleHero(heroId);
  }

  quickSet(heroId: number, investment: string): void {
    this.store.updateRosterInvestment(heroId, investment);
  }
}
