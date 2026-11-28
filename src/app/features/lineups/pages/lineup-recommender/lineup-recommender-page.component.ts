import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import { HeroIconService } from '../../../../core/hero-icons/hero-icon.service';
import {
  collectionIconUrlForNodes,
  collectionIconUrlForSnapshot,
  collectionNodeIconUrl,
  collectionNodeLabel,
} from '../../collection-catalog';
import { PetBadgeComponent } from '../../components/pet-badge/pet-badge.component';
import { formatDamage, formatInvestment, formatKillTime } from '../../lineup-display';
import { PETS } from '../../lineup-data';
import { LineupViewPreferencesService } from '../../lineup-view-preferences.service';
import { LineupsStore } from '../../lineups.store';
import {
  CollectionInventoryItem,
  CollectionNode,
  CollectionSnapshot,
  displayHeroName,
  FORMATION_LAYOUT,
  ModeConfig,
  PetKind,
} from '../../models';
import { countLabel } from '../../plural';
import {
  CollectionAssignmentResult,
  CollectionMatchStatus,
  resolveCatalogItem,
} from '../../recommender/collection-matcher';
import {
  LineupRecommendationResult,
  RECOMMENDED_LINEUP_MODE_SLUGS,
  RecommendedHeroSlot,
  RecommendedLineupModeSlug,
  RecommendedTeam,
  recommendLineupOptionsForMode,
} from '../../recommender/lineup-recommender';
import { rosterFilterColor } from '../../roster-filter-colors';

@Component({
  selector: 'app-lineup-recommender-page',
  standalone: true,
  imports: [HeroIconComponent, MatButtonModule, PetBadgeComponent, RouterLink],
  templateUrl: './lineup-recommender-page.component.html',
  styleUrl: './lineup-recommender-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineupRecommenderPageComponent {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  readonly lineupView = inject(LineupViewPreferencesService);
  private readonly heroIcons = inject(HeroIconService);

  readonly layout = FORMATION_LAYOUT;
  readonly countLabel = countLabel;
  readonly formatKillTime = formatKillTime;
  readonly formatDamage = formatDamage;
  readonly tsTeamCounts = [2, 3, 4, 5, 6, 7] as const;

  readonly selectedModeSlug = signal<RecommendedLineupModeSlug>('nightmare-corridor');
  readonly selectedTarget = signal<string>('');
  readonly tsTeamCount = signal<number>(7);
  readonly strictInvestment = signal<boolean>(false);
  readonly allowMerc = signal<boolean>(true);
  readonly excludedMercHeroIds = signal<readonly number[]>([]);
  readonly selectedOptionIndex = signal<number>(0);

  readonly supportedModes = computed((): readonly ModeConfig[] => {
    const allowed = new Set<string>(RECOMMENDED_LINEUP_MODE_SLUGS);
    return this.store.modes().filter((m) => allowed.has(m.slug));
  });

  readonly activeMode = computed((): ModeConfig | null => {
    const slug = this.selectedModeSlug();
    return this.supportedModes().find((m) => m.slug === slug) ?? this.supportedModes()[0] ?? null;
  });

  readonly availableTargets = computed((): readonly string[] => {
    const mode = this.activeMode();
    if (!mode) return [];
    return mode.targets;
  });

  readonly targetSubmissionCounts = computed((): Readonly<Record<string, number>> => {
    const mode = this.activeMode();
    if (!mode) return {};
    const counts: Record<string, number> = {};
    for (const sub of this.store.submissions()) {
      if (sub.mode !== mode.slug) continue;
      counts[sub.target] = (counts[sub.target] ?? 0) + 1;
    }
    return counts;
  });

  readonly activeTarget = computed((): string => {
    const targets = this.availableTargets();
    if (targets.length === 0) return '';
    const current = this.selectedTarget();
    if (current && targets.includes(current)) return current;
    const counts = this.targetSubmissionCounts();
    // For Nightmare Corridor, prefer the newest cycle (last in list) that has submissions.
    const mode = this.activeMode();
    if (mode?.slug === 'nightmare-corridor') {
      for (let i = targets.length - 1; i >= 0; i--) {
        if ((counts[targets[i]] ?? 0) > 0) return targets[i];
      }
      return targets[targets.length - 1];
    }
    const firstWithData = targets.find((t) => (counts[t] ?? 0) > 0);
    return firstWithData ?? targets[0];
  });

  readonly loading = computed(() =>
    !this.store.backendReady()
    || this.store.rosterDetailsLoading()
    || this.store.collectionsLoading(),
  );

  readonly hasRoster = computed(() => this.store.rosterCount() > 0);

  readonly recommendationOptions = computed((): readonly LineupRecommendationResult[] => {
    const mode = this.activeMode();
    const target = this.activeTarget();
    if (!mode || !target) return [];

    return recommendLineupOptionsForMode({
      mode,
      target,
      teamCount: mode.slug === 'treasure-scramble' ? this.tsTeamCount() : undefined,
      strictInvestment: this.strictInvestment(),
      allowMerc: this.allowMerc(),
      excludedMercHeroIds: this.excludedMercHeroIds(),
      submissions: this.store.submissions(),
      roster: this.store.roster(),
      petRoster: this.store.petRoster(),
      collections: this.store.collections(),
      collectionCatalog: this.store.collectionCatalog(),
      heroes: this.store.heroes(),
      pets: this.store.pets(),
    }, 3);
  });

  readonly recommendation = computed((): LineupRecommendationResult | null => {
    const options = this.recommendationOptions();
    if (options.length === 0) return null;
    const idx = Math.min(this.selectedOptionIndex(), options.length - 1);
    return options[idx] ?? options[0];
  });

  readonly excludedMercHeroes = computed((): readonly { readonly id: number; readonly name: string }[] => {
    const names = this.heroNameById();
    return this.excludedMercHeroIds().map((id) => ({
      id,
      name: names.get(id) ?? `Hero #${id}`,
    }));
  });

  constructor() {
    effect(() => {
      if (this.store.backendReady()) {
        void this.store.loadRosterDetails();
        void this.store.loadCollections();
      }
    });
  }

  selectMode(slug: string): void {
    if (RECOMMENDED_LINEUP_MODE_SLUGS.includes(slug as RecommendedLineupModeSlug)) {
      this.selectedModeSlug.set(slug as RecommendedLineupModeSlug);
      this.selectedTarget.set('');
      this.selectedOptionIndex.set(0);
    }
  }

  selectTarget(target: string): void {
    this.selectedTarget.set(target);
    this.selectedOptionIndex.set(0);
  }

  selectTsTeamCount(count: number): void {
    this.tsTeamCount.set(count);
    this.selectedOptionIndex.set(0);
  }

  toggleStrictInvestment(): void {
    this.strictInvestment.update((v) => !v);
    this.selectedOptionIndex.set(0);
  }

  toggleAllowMerc(): void {
    this.allowMerc.update((v) => !v);
    this.selectedOptionIndex.set(0);
  }

  selectOption(index: number): void {
    this.selectedOptionIndex.set(index);
  }

  excludeMercHero(heroId: number): void {
    const current = this.excludedMercHeroIds();
    if (!current.includes(heroId)) {
      this.excludedMercHeroIds.set([...current, heroId]);
      this.selectedOptionIndex.set(0);
    }
  }

  removeExcludedMerc(heroId: number): void {
    this.excludedMercHeroIds.update((list) => list.filter((id) => id !== heroId));
    this.selectedOptionIndex.set(0);
  }

  clearExcludedMercs(): void {
    this.excludedMercHeroIds.set([]);
    this.selectedOptionIndex.set(0);
  }

  optionSummaryLabel(opt: LineupRecommendationResult, index: number): string {
    const parts = [`Option ${index + 1}`];
    if (opt.merc) {
      parts.push(`Merc: ${opt.merc.heroName}`);
    } else if ((this.activeMode()?.mercMax ?? 0) > 0 && this.allowMerc()) {
      parts.push('No merc');
    } else if (opt.totalNcTimeSeconds !== null) {
      parts.push(formatKillTime(opt.totalNcTimeSeconds));
    }
    return parts.join(' · ');
  }

  readonly heroNameById = computed(() => {
    const map = new Map<number, string>();
    for (const hero of this.store.heroes()) {
      map.set(hero.id, displayHeroName(hero));
    }
    return map;
  });

  heroDisplayName(slot: RecommendedHeroSlot): string {
    return slot.pick.name ?? this.heroNameById().get(slot.pick.hid) ?? `Hero #${slot.pick.hid}`;
  }

  heroFactionColor(slot: RecommendedHeroSlot): string {
    const faction = slot.pick.faction ?? this.heroIcons.factionFor(this.heroDisplayName(slot));
    return rosterFilterColor('faction', faction ?? '');
  }

  heroTooltip(slot: RecommendedHeroSlot): string {
    const name = this.heroDisplayName(slot);
    const reqInv = formatInvestment(slot.investmentTarget.inv);
    const minInv = formatInvestment(slot.investmentTarget.minViableInv);
    const parts = [name];
    if (reqInv) {
      const inferred = slot.investmentTarget.source === 'mode'
        ? ' (mode consensus)'
        : slot.investmentTarget.source === 'global'
          ? ' (global consensus)'
          : '';
      parts.push(`Target: ${reqInv}${inferred}`);
      if (minInv && minInv !== reqInv) parts.push(`Min viable: ${minInv}`);
    }
    if (slot.isMerc) {
      parts.push('Recommended mercenary');
    } else if (slot.status === 'missing') {
      parts.push('Not in your roster');
    } else if (slot.status === 'under') {
      const ownedInv = slot.ownedEntry?.inv || '';
      const bp = slot.missingBreakpoints.length ? ` [missing ${slot.missingBreakpoints.join(', ')}]` : '';
      parts.push((ownedInv ? `Yours: ${ownedInv}` : 'Under target') + bp);
    } else {
      parts.push('Ready in your roster');
    }
    return parts.join(' · ');
  }

  teamStatusLabel(team: RecommendedTeam): string {
    if (team.missingHeroIds.length > 0) {
      return `${countLabel(team.missingHeroIds.length, 'hero')} missing`;
    }
    if (team.missingPet) return 'Pet missing';
    if (team.mercHeroId !== null) return 'Ready (with merc)';
    if (team.underHeroIds.length > 0 || team.underPetLevel) return 'Under-invested';
    return 'Ready';
  }

  teamStatusTone(team: RecommendedTeam): 'ready' | 'merc' | 'warn' | 'short' {
    if (team.missingHeroIds.length > 0 || team.missingPet) return 'short';
    if (team.mercHeroId !== null) return 'merc';
    if (team.underHeroIds.length > 0 || team.underPetLevel) return 'warn';
    return 'ready';
  }

  petTone(petName: string): PetKind | null {
    return PETS.find((p) => p.name.toLowerCase() === petName.toLowerCase())?.kind ?? null;
  }

  petTitle(team: RecommendedTeam): string {
    const name = team.formation.beast;
    const req = team.formation.petLevel;
    const owned = team.ownedPetLevel;
    if (team.missingPet) return `${name} — not in your pet roster`;
    if (team.underPetLevel && req !== null && owned !== null) {
      return `${name} — yours is Lv. ${owned}, target Lv. ${req}`;
    }
    if (owned !== null) return `${name} — Lv. ${owned} owned`;
    return name;
  }

  collectionIcon(assignment: CollectionAssignmentResult): string | null {
    const catalog = this.store.collectionCatalog();
    if (assignment.assigned) {
      const cat = resolveCatalogItem(catalog, assignment.assigned.catalogId, assignment.assigned.name);
      const id = assignment.assigned.catalogId ?? cat?.id;
      return id !== undefined ? collectionIconUrlForNodes(id, assignment.assigned.nodes) : null;
    }
    if (assignment.target) {
      const cat = resolveCatalogItem(catalog, assignment.target.catalogId, assignment.target.name);
      const id = assignment.target.catalogId ?? cat?.id;
      return id !== undefined ? collectionIconUrlForSnapshot(id, assignment.target) : null;
    }
    return null;
  }

  collectionNodes(assignment: CollectionAssignmentResult): readonly { readonly stat: string; readonly tier: CollectionNode['tier'] }[] {
    if (assignment.assigned) {
      return assignment.assigned.nodes
        .filter(({ stat }) => stat !== 'skill_level')
        .slice(0, 4)
        .map(({ stat, tier }) => ({ stat, tier }));
    }
    const target = assignment.target;
    if (!target) return [];
    if (target.recommendation) {
      return [...target.recommendation.attackStats, ...target.recommendation.defenseStats]
        .slice(0, 4)
        .map((stat) => ({ stat, tier: 'mythic' as const }));
    }
    return target.nodes
      .filter(({ stat }) => stat !== 'skill_level')
      .slice(0, 4)
      .map(({ stat, tier }) => ({ stat, tier }));
  }

  collectionNodeIcon(stat: string, tier: CollectionNode['tier']): string {
    return collectionNodeIconUrl(stat, tier);
  }

  collectionStatusLabel(status: CollectionMatchStatus): string {
    switch (status) {
      case 'exact':
        return 'Owned';
      case 'close':
        return 'Close';
      case 'fallback':
        return 'Alt';
      case 'missing':
        return 'Missing';
      default:
        return '';
    }
  }

  collectionTooltip(assignment: CollectionAssignmentResult): string {
    const targetName = assignment.target?.name ?? 'Collection';
    const targetLvl = assignment.targetLevel ? `Lv.${assignment.targetLevel}` : '';
    if (assignment.assigned) {
      const owned = assignment.assigned;
      const ownedLvl = assignment.assignedLevel ? `Lv.${assignment.assignedLevel}` : '';
      const statsText = this.formatOwnedNodes(owned);
      const prefix = assignment.status === 'exact'
        ? 'Equip your'
        : assignment.status === 'close'
          ? 'Closest owned match:'
          : 'Fallback same-class owned:';
      return `${prefix} ${owned.name} (${ownedLvl}${statsText ? `, ${statsText}` : ''}). Target: ${targetName} ${targetLvl}`.trim();
    }
    return `Missing collection: target ${targetName} ${targetLvl}`.trim();
  }

  assignedCollectionLabel(assignment: CollectionAssignmentResult): string {
    if (assignment.assigned) {
      return assignment.assigned.name;
    }
    return assignment.target?.name ?? '';
  }

  private formatOwnedNodes(item: CollectionInventoryItem): string {
    const labels = item.nodes
      .filter(({ stat, tier }) => stat !== 'skill_level' && (tier === 'mythic' || tier === 'legendary'))
      .map(({ stat, tier }) => `${tier === 'mythic' ? 'M' : 'L'} ${collectionNodeLabel(stat)}`);
    return labels.slice(0, 3).join(', ');
  }
}
