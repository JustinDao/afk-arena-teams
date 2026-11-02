import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { MODE_PATHS } from '../../../../app.routes';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserDataService } from '../../../../core/data/user-data.service';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { formatInvestment } from '../../investment';
import { ASCENSION_RANK_LABELS, displayHeroName, Hero, HeroRecommendation, RECOMMENDATION_CATEGORIES } from '../../models';
import { LineupsStore } from '../../lineups.store';

interface RecommendationView {
  readonly recommendation: HeroRecommendation;
  readonly hero: Hero;
  readonly name: string;
  readonly reason: string;
  readonly target: string;
  readonly modeCounts: readonly { readonly slug: string; readonly short: string; readonly count: number }[];
}

@Component({
  selector: 'app-recommendations-page',
  standalone: true,
  imports: [DatePipe, HeroIconComponent, MatButtonModule],
  templateUrl: './recommendations-page.component.html',
  styleUrl: './recommendations-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommendationsPageComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  private readonly data = inject(UserDataService);
  private readonly router = inject(Router);

  readonly selectedModes = signal<readonly string[]>([]);
  readonly recommendations = signal<readonly HeroRecommendation[]>([]);
  readonly refreshedAt = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private loadId = 0;
  private settingsUserId: string | null = null;

  readonly views = computed<readonly RecommendationView[]>(() => {
    const heroes = new Map(this.store.heroes().map((hero) => [hero.id, hero]));
    const modes = new Map(this.store.modes().map((mode) => [mode.slug, mode.short]));
    return this.recommendations().flatMap((recommendation) => {
      const hero = heroes.get(recommendation.heroId);
      if (!hero) return [];
      const modeCounts = Object.entries(recommendation.byMode)
        .map(([slug, count]) => ({ slug, short: modes.get(slug) ?? slug, count }))
        .sort((left, right) => right.count - left.count);
      return [{
        recommendation,
        hero,
        name: displayHeroName(hero),
        reason: this.reasonFor(recommendation, modeCounts.reduce((total, mode) => total + mode.count, 0)),
        target: this.targetFor(recommendation),
        modeCounts,
      }];
    });
  });
  readonly groups = computed(() => RECOMMENDATION_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    items: this.views()
      .filter((view) => view.recommendation.category === key)
      .sort((left, right) => left.recommendation.rank - right.recommendation.rank),
  })));
  readonly hasRoster = computed(() => Object.keys(this.store.roster()).length > 0);

  constructor() {
    effect(() => {
      const user = this.auth.user();
      const ready = this.store.backendReady() || !this.auth.configured;
      if (!user || !ready) return;
      untracked(() => void this.initialize(user.id));
    });
  }

  modeSelected(slug: string): boolean {
    return this.selectedModes().includes(slug);
  }

  async toggleMode(slug: string | null): Promise<void> {
    const current = this.selectedModes();
    const next = slug === null
      ? []
      : current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug];
    this.selectedModes.set(next);
    try {
      await this.data.saveRecommendationModes(next);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not save your modes.');
    }
    await this.refresh();
  }

  viewLineups(view: RecommendationView): void {
    const slug = view.modeCounts[0]?.slug;
    const path = slug ? MODE_PATHS[slug] : null;
    if (!slug || !path) return;
    this.store.setMode(slug);
    void this.router.navigateByUrl(path);
  }

  private async initialize(userId: string): Promise<void> {
    if (this.settingsUserId !== userId) {
      try {
        const settings = await this.data.loadRecommendationSettings();
        this.selectedModes.set(settings.modes);
        this.refreshedAt.set(settings.refreshedAt);
        this.settingsUserId = userId;
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : 'Could not load your settings.');
      }
    }
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const loadId = ++this.loadId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const recommendations = await this.data.loadRecommendations(this.selectedModes());
      if (loadId === this.loadId) this.recommendations.set(recommendations);
    } catch (error) {
      if (loadId === this.loadId) this.error.set(error instanceof Error ? error.message : 'Could not load recommendations.');
    } finally {
      if (loadId === this.loadId) this.loading.set(false);
    }
  }

  private reasonFor(recommendation: HeroRecommendation, total: number): string {
    const { kind, completeCount, nearCount } = recommendation;
    const plural = (count: number) => `${count} top team${count === 1 ? '' : 's'}`;
    if (completeCount === 0 && nearCount === 0) return `Used in ${plural(total)}`;
    const parts: string[] = [];
    if (completeCount > 0) parts.push(`${kind === 'build' ? 'Completes' : 'Fully unlocks'} ${plural(completeCount)}`);
    if (nearCount > 0) parts.push(`${completeCount > 0 ? 'gets you closer on' : 'Gets you closer on'} ${nearCount} more`);
    return parts.join(' and ');
  }

  private targetFor(recommendation: HeroRecommendation): string {
    const parts: string[] = [];
    const code = formatInvestment(recommendation.investment);
    if (code) parts.push(code);
    if (recommendation.ascension) parts.push(ASCENSION_RANK_LABELS[recommendation.ascension]);
    return parts.join(' · ');
  }
}
