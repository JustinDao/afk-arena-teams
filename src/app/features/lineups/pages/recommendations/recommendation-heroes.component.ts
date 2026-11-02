import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { countLabel } from '../../plural';
import { formatInvestment } from '../../investment';
import { ASCENSION_RANK_LABELS, displayHeroName, Hero, HeroRecommendation, RECOMMENDATION_CATEGORIES } from '../../models';
import { LineupsStore } from '../../lineups.store';
import { ModeCount, modeCountsFor, reasonFor } from './recommendation-views';
import { RecommendationsState } from './recommendations.state';

interface RecommendationView {
  readonly recommendation: HeroRecommendation;
  readonly hero: Hero;
  readonly name: string;
  readonly reason: string;
  readonly target: string;
  readonly modeCounts: readonly ModeCount[];
}

@Component({
  selector: 'app-recommendation-heroes',
  standalone: true,
  imports: [HeroIconComponent],
  templateUrl: './recommendation-heroes.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommendationHeroesComponent {
  readonly store = inject(LineupsStore);
  readonly state = inject(RecommendationsState);
  readonly countLabel = countLabel;
  readonly hasRoster = computed(() => Object.keys(this.store.roster()).length > 0);

  readonly views = computed<readonly RecommendationView[]>(() => {
    const heroes = new Map(this.store.heroes().map((hero) => [hero.id, hero]));
    return this.state.heroes().flatMap((recommendation) => {
      const hero = heroes.get(recommendation.heroId);
      if (!hero) return [];
      const modeCounts = modeCountsFor(recommendation.byMode, this.store.modes());
      return [{
        recommendation,
        hero,
        name: displayHeroName(hero),
        reason: reasonFor(recommendation, modeCounts),
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

  private targetFor(recommendation: HeroRecommendation): string {
    const parts: string[] = [];
    const code = formatInvestment(recommendation.investment);
    if (code) parts.push(code);
    if (recommendation.ascension) parts.push(ASCENSION_RANK_LABELS[recommendation.ascension]);
    return parts.join(' · ');
  }
}
