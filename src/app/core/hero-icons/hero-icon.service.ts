import { Injectable, signal } from '@angular/core';
import { ASCENSION_RANKS, AscensionRank, Investment } from '../../features/lineups/models';

const CDN_BASE = 'https://raw.githubusercontent.com/afk-mine/cdn/main';
const UNIT_INDEX_URL = `${CDN_BASE}/unit.json`;

interface CdnUnit {
  readonly id?: unknown;
  readonly codeName?: unknown;
  readonly names?: { readonly en?: unknown };
  readonly isAwakened?: unknown;
  readonly faction?: unknown;
  readonly class?: unknown;
  readonly rarity?: unknown;
}

const NAME_ALIASES: Readonly<Record<string, string>> = {
  astarv: 'Astar',
  daemina: 'Daemia',
  envydiel: 'Awakened Envydiel',
  gavus: 'Awakened Gavus',
  hybris: 'Awakened Hybris',
  joan: 'Joan of Arc',
  rosa: 'Rosaline',
};

function normalizeName(name: string): string {
  return name.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function cdnLookupName(name: string): string {
  const awakenedSuffix = name.match(/^(.*?)\s+\(Awakened\)$/i);
  const candidate = awakenedSuffix ? `Awakened ${awakenedSuffix[1]}` : name;
  return NAME_ALIASES[normalizeName(candidate)] ?? candidate;
}

interface UnitMetadata {
  readonly id: number;
  readonly faction: string | null;
  readonly heroClass: string | null;
}

@Injectable({ providedIn: 'root' })
export class HeroIconService {
  private readonly units = signal<ReadonlyMap<string, UnitMetadata>>(new Map());
  private loadPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadUnitIndex();
    return this.loadPromise;
  }

  unitIdFor(heroName: string): number | null {
    const lookupName = cdnLookupName(heroName);
    return this.units().get(normalizeName(lookupName))?.id ?? null;
  }

  factionFor(heroName: string): string | null {
    return this.unitFor(heroName)?.faction ?? null;
  }

  classFor(heroName: string): string | null {
    return this.unitFor(heroName)?.heroClass ?? null;
  }

  iconUrl(unitId: number): string {
    return `${CDN_BASE}/unit_icon_by_id/${unitId}.webp`;
  }

  framedIconUrl(unitId: number, ascension: AscensionRank, investment: Investment | null): string {
    const ascensionCode: Readonly<Record<AscensionRank, string>> = {
      epic: 'e',
      legendary: 'l',
      mythic: 'm',
      ascended: 'a',
      ascended_1: 'a1',
      ascended_2: 'a2',
      ascended_3: 'a3',
      ascended_4: 'a4',
      ascended_5: 'a5',
    };
    const parts = [`${unitId}_${ascensionCode[ascension]}`];
    const si = investment?.si;
    const rankIndex = ASCENSION_RANKS.indexOf(ascension);
    if (si !== null && si !== undefined && rankIndex >= ASCENSION_RANKS.indexOf('mythic')) {
      const level = si === 0 ? 0 : Math.floor(si / 10) * 10;
      if (level >= 0 && level <= 40) parts.push(`si${level}`);
    }

    const furniture = investment?.furn;
    if (furniture !== null && furniture !== undefined && rankIndex >= ASCENSION_RANKS.indexOf('ascended')) {
      const level = furniture >= 36 ? 36 : furniture >= 9 ? 9 : furniture >= 3 ? 3 : null;
      if (level !== null) parts.push(`f${level}`);
    }

    const engraving = investment?.eng;
    if (engraving !== null && engraving !== undefined && rankIndex >= ASCENSION_RANKS.indexOf('ascended_1')) {
      const level = engraving >= 80 ? 80 : engraving >= 60 ? 60 : engraving >= 30 ? 30 : null;
      if (level !== null) parts.push(`e${level}`);
    }

    return `${CDN_BASE}/framed_unit_icon/${parts.join('_')}.webp`;
  }

  private async loadUnitIndex(): Promise<void> {
    try {
      const response = await fetch(UNIT_INDEX_URL);
      if (!response.ok) throw new Error(`CDN returned HTTP ${response.status}.`);
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('The CDN unit index has an unexpected format.');
      }

      const index = new Map<string, UnitMetadata>();
      for (const value of Object.values(payload)) {
        if (!value || typeof value !== 'object') continue;
        const unit = value as CdnUnit;
        const name = unit.names?.en;
        const id = Number(unit.id);
        if (typeof name !== 'string' || !Number.isInteger(id) || id <= 0) continue;
        const codeName = typeof unit.codeName === 'string' ? unit.codeName : '';
        const isBossVariant = codeName.startsWith('Boss') || codeName.startsWith('WBoss') || codeName.startsWith('RBoss');
        const key = normalizeName(unit.isAwakened === true ? `Awakened ${name}` : name);
        // Prefer playable/standard hero definitions over NPC boss variations (e.g. BossBane vs Bane for Ezizh)
        if (!index.has(key) || (!isBossVariant && unit.rarity !== undefined)) {
          index.set(key, {
            id,
            faction: typeof unit.faction === 'string' ? unit.faction : null,
            heroClass: typeof unit.class === 'string' ? unit.class : null,
          });
        }
      }
      if (index.size === 0) throw new Error('The CDN unit index contains no usable hero entries.');
      this.units.set(index);
    } catch (error) {
      this.loadPromise = null;
      console.warn('AFK Arena hero icons are unavailable; displaying initials instead.', error);
    }
  }

  private unitFor(heroName: string): UnitMetadata | null {
    const lookupName = cdnLookupName(heroName);
    return this.units().get(normalizeName(lookupName)) ?? null;
  }
}
