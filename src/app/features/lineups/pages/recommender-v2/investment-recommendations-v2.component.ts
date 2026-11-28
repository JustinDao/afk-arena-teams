import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../../../core/auth/auth.service';
import { HeroIconComponent } from '../../../../core/hero-icons/hero-icon.component';
import {
  collectionIconUrl,
  collectionNodeIconUrl,
  collectionNodeLabel,
} from '../../collection-catalog';
import { formatInvestment } from '../../lineup-display';
import { LineupsStore } from '../../lineups.store';
import {
  ASCENSION_RANK_LABELS,
  AscensionRank,
  CollectionCatalogItem,
  displayHeroName,
  Hero,
  Investment,
  ModeEventCoverage,
  RECOMMENDATION_CATEGORIES,
  RecommendationCategory,
} from '../../models';
import { countLabel } from '../../plural';
import {
  CollectionInvestmentRecV2,
  computeInvestmentRecommendationsV2,
  HeroInvestmentRecV2,
  InvestmentRecommendationsV2Result,
  PetInvestmentRecV2,
} from '../../recommender/investment-recommender-v2';

type V2InvestmentTab = 'heroes' | 'pets' | 'collections';

const COLLECTION_CLASSES: readonly CollectionCatalogItem['class'][] = [
  'Warrior',
  'Tank',
  'Ranger',
  'Mage',
  'Support',
];

@Component({
  selector: 'app-investment-recommendations-v2',
  standalone: true,
  imports: [HeroIconComponent, MatButtonModule],
  templateUrl: './investment-recommendations-v2.component.html',
  styleUrl: './investment-recommendations-v2.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvestmentRecommendationsV2Component {
  readonly store = inject(LineupsStore);
  readonly auth = inject(AuthService);
  readonly categories = RECOMMENDATION_CATEGORIES;
  readonly countLabel = countLabel;

  readonly selectedModes = signal<readonly string[]>([]);
  readonly activeTab = signal<V2InvestmentTab>('heroes');
  readonly excludeOwnedCollections = signal(false);

  readonly loading = computed(() =>
    !this.store.backendReady()
    || this.store.rosterDetailsLoading()
    || this.store.collectionsLoading(),
  );

  readonly result = computed((): InvestmentRecommendationsV2Result => {
    return computeInvestmentRecommendationsV2({
      selectedModeSlugs: this.selectedModes(),
      modes: this.store.modes(),
      submissions: this.store.submissions(),
      roster: this.store.roster(),
      petRoster: this.store.petRoster(),
      collections: this.store.collections(),
      collectionCatalog: this.store.collectionCatalog(),
      heroes: this.store.heroes(),
      pets: this.store.pets(),
    });
  });

  readonly heroById = computed(() => {
    const map = new Map<number, Hero>();
    for (const hero of this.store.heroes()) {
      map.set(hero.id, hero);
    }
    return map;
  });

  readonly visibleCollections = computed(() => {
    const all = this.result().collections;
    return this.excludeOwnedCollections()
      ? all.filter((c) => c.ownedMatchingCount === 0)
      : all;
  });

  readonly overallCollections = computed(() => this.visibleCollections().slice(0, 10));

  readonly collectionGroups = computed((): readonly {
    readonly label: CollectionCatalogItem['class'];
    readonly items: readonly CollectionInvestmentRecV2[];
  }[] => {
    const visible = this.visibleCollections();
    return COLLECTION_CLASSES.map((cls) => ({
      label: cls,
      items: visible.filter((c) => c.collectionClass === cls),
    }));
  });

  readonly petGroups = computed((): readonly {
    readonly key: 'standard' | 'awakened';
    readonly label: string;
    readonly items: readonly PetInvestmentRecV2[];
  }[] => {
    const all = this.result().pets;
    return [
      { key: 'standard', label: 'Standard pets', items: all.filter((p) => p.petKind === 'standard') },
      { key: 'awakened', label: 'Awakened pets', items: all.filter((p) => p.petKind === 'awakened') },
    ];
  });

  modeSelected(slug: string): boolean {
    return this.selectedModes().includes(slug);
  }

  toggleMode(slug: string | null): void {
    if (slug === null) {
      this.selectedModes.set([]);
      return;
    }
    const current = this.selectedModes();
    this.selectedModes.set(
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );
  }

  selectTab(tab: V2InvestmentTab): void {
    this.activeTab.set(tab);
  }

  toggleExcludeOwnedCollections(): void {
    this.excludeOwnedCollections.update((v) => !v);
  }

  categoryLabel(category: RecommendationCategory): string {
    return this.categories.find((c) => c.key === category)?.label ?? category;
  }

  breakpointClass(bp: string): string {
    switch (bp) {
      case 'SI20': return 'bp-si20';
      case 'SI30': return 'bp-si30';
      case 'SI40': return 'bp-si40';
      case '3F': return 'bp-3f';
      case '9F': return 'bp-9f';
      case 'E30': return 'bp-e30';
      case 'E60': return 'bp-e60';
      case 'E80': return 'bp-e80';
      case 'Ascended': return 'bp-asc';
      default: return '';
    }
  }

  formatInv(inv: Investment | null, ascension: AscensionRank | null = null): string {
    const code = formatInvestment(inv);
    if (code) return code;
    if (ascension) return ASCENSION_RANK_LABELS[ascension];
    return '';
  }

  heroReason(rec: HeroInvestmentRecV2): string {
    const parts: string[] = [];
    if (rec.completeCount > 0) {
      parts.push(`Completes ${countLabel(rec.completeCount, 'team')}`);
    } else if (rec.nearCount > 0) {
      parts.push(`Used in ${countLabel(rec.nearCount, 'near team')}`);
    }
    const minStr = this.formatInv(rec.minViableInv);
    const targetStr = this.formatInv(rec.targetInv);
    if (minStr && targetStr && minStr !== targetStr) {
      parts.push(`min ${minStr}`);
    }
    return parts.join(' · ') || 'Consensus priority';
  }

  petReason(pet: PetInvestmentRecV2): string {
    const parts = [`Used in ${countLabel(pet.completeCount, 'formation')}`];
    if (pet.minViableLevel !== pet.targetLevel) {
      parts.push(`min Lv. ${pet.minViableLevel}`);
    }
    return parts.join(' · ');
  }

  collectionReason(col: CollectionInvestmentRecV2): string {
    if (col.ownedMatchingCount > 0) {
      return `Own ${col.ownedMatchingCount} · up to ${col.maxCopiesInRun} in a run`;
    }
    return `Used in ${countLabel(col.demandCount, 'slot')}`;
  }

  modeShortLabel(slug: string): string {
    return this.store.modes().find((m) => m.slug === slug)?.short ?? slug.toUpperCase();
  }

  modeCoverageEntries(byModeEvents: Readonly<Record<string, ModeEventCoverage>>): readonly {
    readonly short: string;
    readonly used: number;
    readonly total: number;
  }[] {
    return Object.entries(byModeEvents).map(([slug, cov]) => ({
      short: this.modeShortLabel(slug),
      used: cov.used,
      total: cov.total,
    }));
  }

  petModeEntries(byMode: Readonly<Record<string, number>>): readonly {
    readonly short: string;
    readonly count: number;
  }[] {
    return Object.entries(byMode).map(([slug, count]) => ({
      short: this.modeShortLabel(slug),
      count,
    }));
  }

  collectionIcon(catalogId: number, level: number): string {
    return collectionIconUrl(catalogId, level);
  }

  statIcon(stat: string): string {
    return collectionNodeIconUrl(stat, 'mythic');
  }

  statLabel(stat: string): string {
    return collectionNodeLabel(stat);
  }

  collectionUsers(ids: readonly number[]): readonly {
    readonly id: number;
    readonly name: string;
    readonly iconUrl: string | null;
  }[] {
    const byId = this.heroById();
    return ids.map((id) => {
      const hero = byId.get(id);
      return {
        id,
        name: hero ? displayHeroName(hero) : `Hero #${id}`,
        iconUrl: hero?.iconUrl ?? null,
      };
    });
  }
}
