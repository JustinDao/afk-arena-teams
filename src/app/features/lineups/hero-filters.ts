import { HeroIconService } from '../../core/hero-icons/hero-icon.service';
import { HeroAttribute } from './hero-classification';
import { Hero } from './models';

export const HERO_CLASSES = ['Warrior', 'Tank', 'Ranger', 'Mage', 'Support'] as const;
export const HERO_TYPES = ['strength', 'agility', 'intelligence'] as const;

const FACTION_ORDER = ['Lightbearer', 'Mauler', 'Wilder', 'Graveborn', 'Celestial', 'Hypogean', 'Dimensional', 'Draconis'];

export interface HeroFilterState {
  readonly faction: string;
  readonly heroClass: string;
  readonly type: HeroAttribute | '';
}

function heroFaction(icons: HeroIconService, hero: Hero): string | null {
  return hero.faction ?? icons.factionFor(hero.name);
}

function heroClass(icons: HeroIconService, hero: Hero): string | null {
  return hero.class ?? icons.classFor(hero.name);
}

export function filterHeroes(heroes: readonly Hero[], filters: HeroFilterState, icons: HeroIconService): Hero[] {
  return heroes.filter((hero) =>
    (!filters.faction || heroFaction(icons, hero) === filters.faction) &&
    (!filters.heroClass || heroClass(icons, hero) === filters.heroClass) &&
    (!filters.type || hero.type === filters.type),
  );
}

export function factionOptions(heroes: readonly Hero[], icons: HeroIconService): string[] {
  const options = [...new Set(heroes.map((hero) => heroFaction(icons, hero))
    .filter((value): value is string => value !== null))];
  return options.sort((left, right) => {
    const leftIndex = FACTION_ORDER.indexOf(left);
    const rightIndex = FACTION_ORDER.indexOf(right);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left.localeCompare(right);
  });
}
