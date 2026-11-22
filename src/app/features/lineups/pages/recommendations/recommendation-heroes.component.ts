import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { countLabel } from '../../plural';
import { formatInvestment, rosterInvestment } from '../../investment';
import { ASCENSION_RANKS, AscensionRank, displayHeroName, Hero, HeroRecommendation, RECOMMENDATION_CATEGORIES, RosterEntry } from '../../models';
import { LineupsStore } from '../../lineups.store';
import { ModeCount, modeCountsFor, reasonFor } from './recommendation-views';
import { RecommendationsState } from './recommendations.state';

interface RecommendationView {
  readonly recommendation: HeroRecommendation;
  readonly hero: Hero;
  readonly name: string;
  readonly categoryLabel: string;
  readonly reason: string;
  readonly current: string;
  readonly target: string;
  readonly modeCounts: readonly ModeCount[];
}

const CATEGORY_LABELS = new Map<string, string>(RECOMMENDATION_CATEGORIES.map(({ key, label }) => [key, label]));
const OVERALL_LIMIT = 10;
const SHORT_ASCENSION_LABELS: Readonly<Record<AscensionRank, string>> = {
  epic: 'E',
  epic_plus: 'E+',
  legendary: 'L',
  legendary_plus: 'L+',
  mythic: 'M',
  mythic_plus: 'M+',
  ascended: 'A',
  ascended_1: 'A1*',
  ascended_2: 'A2*',
  ascended_3: 'A3*',
  ascended_4: 'A4*',
  ascended_5: 'A5*',
};

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
    const roster = this.store.roster();
    return this.state.heroes().flatMap((recommendation) => {
      const hero = heroes.get(recommendation.heroId);
      if (!hero) return [];
      const modeCounts = modeCountsFor(recommendation.byMode, this.store.modes());
      return [{
        recommendation,
        hero,
        name: displayHeroName(hero),
        categoryLabel: CATEGORY_LABELS.get(recommendation.category) ?? recommendation.category,
        reason: reasonFor(recommendation, modeCounts),
        current: this.currentFor(roster[hero.id], recommendation),
        target: this.targetFor(recommendation),
        modeCounts,
      }];
    });
  });

  readonly overall = computed<readonly RecommendationView[]>(() => [...this.views()]
    .sort((left, right) => right.recommendation.score - left.recommendation.score
      || left.recommendation.rank - right.recommendation.rank
      || left.name.localeCompare(right.name))
    .slice(0, OVERALL_LIMIT));

  readonly groups = computed(() => RECOMMENDATION_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    items: this.views()
      .filter((view) => view.recommendation.category === key)
      .sort((left, right) => left.recommendation.rank - right.recommendation.rank),
  })));

  private effectiveAscension(recommendation: HeroRecommendation): AscensionRank | null {
    const rank = recommendation.ascension;
    if (!rank) return null;
    const inv = recommendation.investment;
    let minRank: AscensionRank = rank;
    if ((inv?.eng ?? 0) > 0) minRank = 'ascended_1';
    else if ((inv?.furn ?? 0) > 0) minRank = 'ascended';
    else if ((inv?.si ?? 0) > 0) minRank = 'mythic';
    return ASCENSION_RANKS.indexOf(rank) < ASCENSION_RANKS.indexOf(minRank) ? minRank : rank;
  }

  private currentFor(entry: RosterEntry | undefined, recommendation: HeroRecommendation): string {
    if (recommendation.kind !== 'invest' || !entry) return '';
    const inv = rosterInvestment(entry);
    const code = inv && (inv.si !== null || inv.furn !== null || inv.eng !== null) ? formatInvestment(inv) : '';
    const targetAscension = this.effectiveAscension(recommendation);
    if (code) {
      if (targetAscension && entry.ascension && entry.ascension !== targetAscension) {
        return `${code} · ${SHORT_ASCENSION_LABELS[entry.ascension]}`;
      }
      return code;
    }
    return entry.ascension ? SHORT_ASCENSION_LABELS[entry.ascension] : '';
  }

  private targetFor(recommendation: HeroRecommendation): string {
    const parts: string[] = [];
    const code = this.formatRecommendationInvestment(recommendation.investment);
    if (code) parts.push(code);
    const targetAscension = this.effectiveAscension(recommendation);
    if (targetAscension) parts.push(SHORT_ASCENSION_LABELS[targetAscension]);
    return parts.join(' · ');
  }

  private formatRecommendationInvestment(investment: HeroRecommendation['investment']): string {
    if (!investment) return '';
    const { si, furn, eng } = investment;
    const present = [si, furn, eng].filter((value) => value !== null).length;
    if (present === 1) {
      if (si !== null) return `SI ${si}`;
      if (furn !== null) return `${furn}F`;
      if (eng !== null) return `E${eng}`;
    }
    return formatInvestment(investment);
  }
}
