import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { collectionIconUrl, collectionNodeLabel, COLLECTION_CATALOG } from '../../collection-catalog';
import { countLabel } from '../../plural';
import { CollectionCatalogItem, CollectionRecommendation } from '../../models';
import { LineupsStore } from '../../lineups.store';
import { ModeCount, modeCountsFor, reasonFor } from './recommendation-views';
import { RecommendationsState } from './recommendations.state';

interface CollectionRecommendationView {
  readonly recommendation: CollectionRecommendation;
  readonly name: string;
  readonly iconUrl: string;
  readonly reason: string;
  readonly target: string;
  readonly modeCounts: readonly ModeCount[];
}

const COLLECTION_CLASSES: readonly CollectionCatalogItem['class'][] = ['Warrior', 'Tank', 'Ranger', 'Mage', 'Support'];

@Component({
  selector: 'app-recommendation-collections',
  standalone: true,
  templateUrl: './recommendation-collections.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommendationCollectionsComponent {
  private readonly store = inject(LineupsStore);
  readonly state = inject(RecommendationsState);
  readonly countLabel = countLabel;

  readonly groups = computed(() => {
    const views = this.state.collections().flatMap((recommendation): CollectionRecommendationView[] => {
      const item = COLLECTION_CATALOG.find((entry) => entry.id === recommendation.catalogId);
      if (!item) return [];
      const modeCounts = modeCountsFor(recommendation.byMode, this.store.modes());
      return [{
        recommendation,
        name: item.name,
        iconUrl: collectionIconUrl(item.id, recommendation.levelNodes + 1, recommendation.mythicStats.length),
        reason: reasonFor(recommendation, modeCounts),
        target: this.targetFor(recommendation),
        modeCounts,
      }];
    });
    return COLLECTION_CLASSES.map((label) => ({
      label,
      items: views
        .filter((view) => view.recommendation.collectionClass === label)
        .sort((left, right) => left.recommendation.rank - right.recommendation.rank),
    }));
  });

  private targetFor(recommendation: CollectionRecommendation): string {
    const parts: string[] = [];
    if (recommendation.levelNodes > 0) parts.push(countLabel(recommendation.levelNodes, 'Level node'));
    const counts = new Map<string, number>();
    for (const stat of recommendation.mythicStats) counts.set(stat, (counts.get(stat) ?? 0) + 1);
    for (const [stat, count] of counts) {
      const label = collectionNodeLabel(stat);
      parts.push(count > 1 ? `${label} ×${count}` : label);
    }
    return parts.join(' · ');
  }
}
