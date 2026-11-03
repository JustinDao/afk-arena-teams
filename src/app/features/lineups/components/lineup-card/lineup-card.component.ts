import { countLabel, pluralNoun } from '../../plural';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { CollectionNode, CollectionRecommendationSpec, CollectionSnapshot, EvaluatedSubmission, FORMATION_LAYOUT, HeroStatus, PetKind } from '../../models';
import { formatInvestment, formatKillTime, heroName, resultLine } from '../../lineup-display';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { PetBadgeComponent } from '../pet-badge/pet-badge.component';
import { collectionIconUrlForSnapshot, collectionNodeIconUrl, collectionNodeLabel } from '../../collection-catalog';
import { rosterFilterColor } from '../../roster-filter-colors';
import { PETS } from '../../lineup-data';
import { LineupViewPreferencesService } from '../../lineup-view-preferences.service';

@Component({
  selector: 'app-lineup-card',
  standalone: true,
  imports: [HeroIconComponent, RouterLink, MatButtonModule, PetBadgeComponent],
  templateUrl: './lineup-card.component.html',
  styleUrl: './lineup-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineupCardComponent {
  readonly countLabel = countLabel;
  private readonly heroIcons = inject(HeroIconService);
  readonly lineupView = inject(LineupViewPreferencesService);
  readonly row = input.required<EvaluatedSubmission>();
  readonly scope = input.required<'all' | 'slot'>();
  readonly voted = input.required<boolean>();
  readonly voteCount = input.required<number>();
  readonly vote = output<number>();
  readonly share = output<number>();
  readonly detail = input(false);
  readonly hideActions = input(false);
  readonly layout = FORMATION_LAYOUT;

  heroStatus(formIndex: number, heroIndex: number): HeroStatus | '' {
    return this.row().forms[formIndex]?.statuses[heroIndex] ?? '';
  }

  isRunable(formIndex: number): boolean {
    const row = this.row();
    return row.active && row.forms[formIndex]?.missing === 0;
  }

  missingSummary(): string {
    const row = this.row();
    const names = row.missingHeroes.map(heroName);
    const missing = names.length
      ? `missing ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}`
      : '';
    const low = row.lowInvestmentHeroes.length
      ? `needs more investment on ${row.lowInvestmentHeroes.slice(0, 4).map(heroName).join(', ')}`
      : '';
    const missingPets = row.missingPetNames.length
      ? `missing ${pluralNoun(row.missingPetNames.length, 'pet')} ${row.missingPetNames.slice(0, 4).join(', ')}`
      : '';
    const lowPetLevels = row.underLevelPetNames.length
      ? `needs higher ${pluralNoun(row.underLevelPetNames.length, 'pet level')} for ${row.underLevelPetNames.slice(0, 4).join(', ')}`
      : '';
    const lowHeroLevel = row.heroLevelMismatch
      ? `requires hero level ${row.heroLevelMismatch.required}, yours is ${row.heroLevelMismatch.owned}`
      : '';
    return [missing, low, missingPets, lowPetLevels, lowHeroLevel].filter(Boolean).join('; ');
  }

  ageLabel(days: number): string {
    return days === 0 ? 'just now' : `${days}d ago`;
  }

  collectionSummary(collection: CollectionSnapshot): string {
    if (collection.recommendation) {
      const attack = collection.recommendation.attackStats.length
        ? `Attack: ${collection.recommendation.attackStats.map(collectionNodeLabel).join(' or ')}`
        : '';
      const defense = collection.recommendation.defenseStats.length
        ? `Defense: ${collection.recommendation.defenseStats.map(collectionNodeLabel).join(' or ')}`
        : '';
      return `${collection.name}; Level ${collection.recommendation.level}; ${[attack, defense].filter(Boolean).join('; ')}, as many as possible`;
    }
    return collection.name;
  }

  collectionIcon(collection: CollectionSnapshot): string | null {
    const catalogId = collection.catalogId;
    return catalogId === undefined
      ? null
      : collectionIconUrlForSnapshot(catalogId, collection);
  }

  collectionStats(collection: CollectionSnapshot): readonly { readonly stat: string; readonly tier: CollectionNode['tier'] }[] {
    return collection.recommendation
      ? [...collection.recommendation.attackStats, ...collection.recommendation.defenseStats]
        .map((stat) => ({ stat, tier: 'mythic' }))
      : collection.nodes.map(({ stat, tier }) => ({ stat, tier }));
  }

  collectionNodeIcon(stat: string, tier: CollectionNode['tier']): string {
    return collectionNodeIconUrl(stat, tier);
  }

  heroFactionColor(hero: { readonly name?: string; readonly faction?: string | null }, heroId: number): string {
    const faction = hero.faction ?? this.heroIcons.factionFor(hero.name ?? heroName(heroId));
    return rosterFilterColor('faction', faction ?? '');
  }

  petTone(petName: string): PetKind | null {
    return PETS.find((p) => p.name.toLowerCase() === petName.toLowerCase())?.kind ?? null;
  }

  readonly heroName = heroName;
  readonly investmentLabel = formatInvestment;
  readonly resultLabel = resultLine;
  readonly killTimeLabel = formatKillTime;
}
