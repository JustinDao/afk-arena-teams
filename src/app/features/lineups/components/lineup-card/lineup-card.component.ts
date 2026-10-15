import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CollectionNode, EvaluatedSubmission, FORMATION_LAYOUT, HeroStatus, PetKind } from '../../models';
import { formatInvestment, formatKillTime, heroName, resultLine } from '../../lineup-display';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import { PetBadgeComponent } from '../pet-badge/pet-badge.component';
import { collectionIconUrl, collectionNodeIconUrl } from '../../collection-catalog';
import { rosterFilterColor } from '../../roster-filter-colors';
import { PETS } from '../../lineup-data';

@Component({
  selector: 'app-lineup-card',
  standalone: true,
  imports: [HeroIconComponent, MatButtonModule, PetBadgeComponent],
  templateUrl: './lineup-card.component.html',
  styleUrl: './lineup-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineupCardComponent {
  private readonly heroIcons = inject(HeroIconService);
  readonly row = input.required<EvaluatedSubmission>();
  readonly scope = input.required<'all' | 'slot'>();
  readonly voted = input.required<boolean>();
  readonly voteCount = input.required<number>();
  readonly vote = output<number>();
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
      ? `missing pet${row.missingPetNames.length === 1 ? '' : 's'} ${row.missingPetNames.slice(0, 4).join(', ')}`
      : '';
    const lowPetLevels = row.underLevelPetNames.length
      ? `needs higher pet level${row.underLevelPetNames.length === 1 ? '' : 's'} for ${row.underLevelPetNames.slice(0, 4).join(', ')}`
      : '';
    const lowHeroLevel = row.heroLevelMismatch
      ? `requires hero level ${row.heroLevelMismatch.required}, yours is ${row.heroLevelMismatch.owned}`
      : '';
    return [missing, low, missingPets, lowPetLevels, lowHeroLevel].filter(Boolean).join('; ');
  }

  ageLabel(days: number): string {
    return days === 0 ? 'just now' : `${days}d ago`;
  }

  collectionSummary(nodes: readonly CollectionNode[]): string {
    return nodes.map((node) => `${node.tier[0].toUpperCase()} ${node.stat.replaceAll('_', ' ').toUpperCase()}`).join(', ');
  }

  collectionIcon(catalogId: number | undefined, nodes: readonly CollectionNode[]): string | null {
    return catalogId === undefined
      ? null
      : collectionIconUrl(catalogId, nodes.filter(({ tier }) => tier === 'mythic').length);
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
