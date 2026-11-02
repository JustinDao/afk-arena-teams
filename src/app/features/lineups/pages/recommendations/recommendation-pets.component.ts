import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { countLabel } from '../../plural';
import { Pet, PetRecommendation } from '../../models';
import { LineupsStore } from '../../lineups.store';
import { ModeCount, modeCountsFor, reasonFor } from './recommendation-views';
import { RecommendationsState } from './recommendations.state';

interface PetRecommendationView {
  readonly recommendation: PetRecommendation;
  readonly pet: Pet;
  readonly reason: string;
  readonly modeCounts: readonly ModeCount[];
}

const PET_GROUPS = [
  { key: 'standard', label: 'Standard pets' },
  { key: 'awakened', label: 'Awakened pets' },
] as const;

@Component({
  selector: 'app-recommendation-pets',
  standalone: true,
  imports: [HeroIconComponent],
  templateUrl: './recommendation-pets.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommendationPetsComponent {
  private readonly store = inject(LineupsStore);
  readonly state = inject(RecommendationsState);
  readonly countLabel = countLabel;

  readonly groups = computed(() => {
    const pets = new Map(this.store.pets().map((pet) => [pet.id, pet]));
    const views = this.state.pets().flatMap((recommendation): PetRecommendationView[] => {
      const pet = pets.get(recommendation.petId);
      if (!pet) return [];
      const modeCounts = modeCountsFor(recommendation.byMode, this.store.modes());
      return [{ recommendation, pet, reason: reasonFor(recommendation, modeCounts), modeCounts }];
    });
    return PET_GROUPS.map(({ key, label }) => ({
      key,
      label,
      items: views
        .filter((view) => view.recommendation.petKind === key)
        .sort((left, right) => left.recommendation.rank - right.recommendation.rank),
    }));
  });
}
