import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { collectionIconUrl, collectionNodeLabel, COLLECTION_CATALOG } from '../../collection-catalog';
import { countLabel } from '../../plural';
import { CollectionCatalogItem, CollectionRecommendation, displayHeroName } from '../../models';
import { LineupsStore } from '../../lineups.store';
import { ModeCount, modeCountsFor, reasonFor } from './recommendation-views';
import { RecommendationsState } from './recommendations.state';

interface CollectionTopUser {
  readonly id: number;
  readonly name: string;
  readonly iconUrl: string | null;
}

interface CollectionRecommendationView {
  readonly key: string;
  readonly recommendation: CollectionRecommendation;
  readonly name: string;
  readonly iconUrl: string;
  readonly reason: string;
  readonly target: string;
  readonly topUsers: readonly CollectionTopUser[];
  readonly modeCounts: readonly ModeCount[];
}

const COLLECTION_CLASSES: readonly CollectionCatalogItem['class'][] = ['Warrior', 'Tank', 'Ranger', 'Mage', 'Support'];
const OVERALL_LIMIT = 10;

@Component({
  selector: 'app-recommendation-collections',
  standalone: true,
  imports: [HeroIconComponent],
  templateUrl: './recommendation-collections.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommendationCollectionsComponent {
  private readonly store = inject(LineupsStore);
  readonly state = inject(RecommendationsState);
  readonly countLabel = countLabel;

  readonly views = computed<readonly CollectionRecommendationView[]>(() => {
    const heroById = new Map(this.store.heroes().map((hero) => [hero.id, hero]));
    return this.state.collections().flatMap((recommendation): CollectionRecommendationView[] => {
      const item = COLLECTION_CATALOG.find((entry) => entry.id === recommendation.catalogId);
      if (!item) return [];
      const modeCounts = modeCountsFor(recommendation.byMode, this.store.modes());
      const level = recommendation.levelNodes + 1;
      const topUsers: CollectionTopUser[] = (recommendation.topHeroIds ?? []).flatMap((id) => {
        const hero = heroById.get(id);
        return hero ? [{ id: hero.id, name: displayHeroName(hero), iconUrl: hero.iconUrl ?? null }] : [];
      });
      return [{
        key: `${recommendation.catalogId}-${recommendation.levelNodes}`,
        recommendation,
        name: `${item.name} · Lv ${level}`,
        iconUrl: collectionIconUrl(item.id, level, recommendation.mythicStats.length),
        reason: reasonFor(recommendation, modeCounts),
        target: this.targetFor(recommendation),
        topUsers,
        modeCounts,
      }];
    });
  });

  readonly overall = computed<readonly CollectionRecommendationView[]>(() => [...this.views()]
    .sort((left, right) => right.recommendation.score - left.recommendation.score
      || left.recommendation.rank - right.recommendation.rank
      || left.name.localeCompare(right.name))
    .slice(0, OVERALL_LIMIT));

  readonly groups = computed(() => COLLECTION_CLASSES.map((label) => ({
    label,
    items: this.views()
      .filter((view) => view.recommendation.collectionClass === label)
      .sort((left, right) => left.recommendation.rank - right.recommendation.rank),
  })));

  private targetFor(recommendation: CollectionRecommendation): string {
    const parts: string[] = [];
    const counts = new Map<string, number>();
    for (const stat of recommendation.mythicStats) counts.set(stat, (counts.get(stat) ?? 0) + 1);
    for (const [stat, count] of counts) {
      const label = collectionNodeLabel(stat);
      parts.push(count > 1 ? `${label} ×${count}` : label);
    }
    return parts.join(' · ');
  }
}
