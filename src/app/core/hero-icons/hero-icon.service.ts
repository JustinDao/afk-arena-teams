import { Injectable, signal } from '@angular/core';

const CDN_BASE = 'https://raw.githubusercontent.com/afk-mine/cdn/main';
const UNIT_INDEX_URL = `${CDN_BASE}/unit.json`;

interface CdnUnit {
  readonly id?: unknown;
  readonly names?: { readonly en?: unknown };
  readonly isAwakened?: unknown;
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

@Injectable({ providedIn: 'root' })
export class HeroIconService {
  private readonly unitIds = signal<ReadonlyMap<string, number>>(new Map());
  private loadPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadUnitIndex();
    return this.loadPromise;
  }

  unitIdFor(heroName: string): number | null {
    const lookupName = NAME_ALIASES[normalizeName(heroName)] ?? heroName;
    return this.unitIds().get(normalizeName(lookupName)) ?? null;
  }

  iconUrl(unitId: number): string {
    return `${CDN_BASE}/unit_icon_by_id/${unitId}.webp`;
  }

  private async loadUnitIndex(): Promise<void> {
    try {
      const response = await fetch(UNIT_INDEX_URL);
      if (!response.ok) throw new Error(`CDN returned HTTP ${response.status}.`);
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('The CDN unit index has an unexpected format.');
      }

      const index = new Map<string, number>();
      for (const value of Object.values(payload)) {
        if (!value || typeof value !== 'object') continue;
        const unit = value as CdnUnit;
        const name = unit.names?.en;
        const id = Number(unit.id);
        if (typeof name !== 'string' || !Number.isInteger(id) || id <= 0) continue;
        const key = normalizeName(unit.isAwakened === true ? `Awakened ${name}` : name);
        index.set(key, id);
      }
      if (index.size === 0) throw new Error('The CDN unit index contains no usable hero entries.');
      this.unitIds.set(index);
    } catch (error) {
      this.loadPromise = null;
      console.warn('AFK Arena hero icons are unavailable; displaying initials instead.', error);
    }
  }
}
