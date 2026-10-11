export interface Hero {
  readonly id: number;
  readonly name: string;
  readonly iconUrl?: string;
}

export interface Pet {
  readonly id: number;
  readonly name: string;
  readonly isAwakened: boolean;
  readonly iconUrl?: string;
}

export interface PetRosterEntry {
  readonly level: number;
}

export interface Investment {
  readonly si: number | null;
  readonly furn: number | null;
  readonly eng: number | null;
}

export interface HeroPick {
  readonly pos: number;
  readonly hid: number;
  readonly name?: string;
  readonly iconUrl?: string;
  readonly inv: Investment | null;
  readonly merc: boolean;
  readonly collection: CollectionSnapshot | null;
}

export type CollectionNodeTier = 'elite' | 'legendary' | 'mythic';
export type CollectionNodeStat = string;

export interface CollectionCatalogItem {
  readonly id: number;
  readonly name: string;
  readonly class: 'Warrior' | 'Tank' | 'Ranger' | 'Mage' | 'Support';
  readonly codeName: string;
}

export interface CollectionNode {
  readonly slotIndex: number;
  readonly stat: CollectionNodeStat;
  readonly tier: CollectionNodeTier;
}

export interface CollectionInventoryItem {
  readonly id: string;
  readonly catalogId?: number;
  readonly name: string;
  readonly class?: CollectionCatalogItem['class'];
  readonly nodes: readonly CollectionNode[];
}

export interface CollectionSnapshot {
  readonly catalogId?: number;
  readonly name: string;
  readonly class?: CollectionCatalogItem['class'];
  readonly nodes: readonly CollectionNode[];
}

export interface Formation {
  readonly key: string;
  readonly label: string;
  readonly beast: string;
  readonly petId: number | null;
  readonly petIconUrl?: string | null;
  readonly petLevel: number | null;
  readonly timeSeconds: number | null;
  readonly heroes: readonly HeroPick[];
}

export type SubmissionResult = Readonly<Record<string, number | boolean | string>>;

export interface Submission {
  readonly id: number;
  readonly mode: string;
  readonly target: string;
  readonly up: number;
  readonly days: number;
  readonly result: SubmissionResult;
  readonly forms: readonly Formation[];
  readonly notes: string;
  readonly by: string;
  readonly heroLevel: number | null;
}

export interface ResultField {
  readonly k: string;
  readonly l: string;
  readonly t: 'bool' | 'damage' | 'dur' | 'pct' | 'int' | 'select';
  readonly ph?: string;
  readonly def?: boolean | number;
  readonly opts?: readonly number[];
  readonly showIf?: (result: Readonly<Record<string, unknown>>) => boolean;
}

export interface ModeConfig {
  readonly slug: string;
  readonly short: string;
  readonly name: string;
  readonly targetLabel: string;
  readonly targetAll: string;
  readonly targets: readonly string[];
  readonly targetSlugs?: Readonly<Record<string, string>>;
  readonly rules: string;
  readonly formations?: readonly { readonly key: string; readonly label: string }[];
  readonly variable?: { readonly min: number; readonly max: number };
  readonly mercMax?: number;
  readonly uniqueAcross?: boolean;
  readonly collectionsEnabled?: boolean;
  readonly fields: readonly ResultField[];
}

export interface RosterEntry {
  inv: string;
  si?: number | null;
  furn?: number | null;
  eng?: number | null;
}

export interface DraftSlot {
  hid: number | null;
  merc: boolean;
  inv: string;
  collectionId: string;
}

export interface DraftFormation {
  key: string;
  label: string;
  petId: number | null;
  petLevel: number | null;
  time: string;
  slots: DraftSlot[];
}

export interface LineupDraft {
  mode: string;
  target: string;
  cur: number;
  slot: number;
  q: string;
  notes: string;
  result: Record<string, unknown>;
  forms: DraftFormation[];
}

export type HeroStatus = 'ok' | 'under' | 'missing';

export interface EvaluatedFormation {
  readonly statuses: readonly HeroStatus[];
  readonly missing: number;
  readonly missingPet: boolean;
  readonly underPetLevel: boolean;
}

export interface EvaluatedSubmission {
  readonly submission: Submission;
  readonly active: boolean;
  readonly forms: readonly EvaluatedFormation[];
  readonly missingCount: number;
  readonly bestSlotMissing: number;
  readonly missingHeroes: readonly number[];
  readonly lowInvestmentHeroes: readonly number[];
  readonly missingPetNames: readonly string[];
  readonly underLevelPetNames: readonly string[];
  readonly heroLevelMismatch: { readonly owned: number; readonly required: number } | null;
  readonly gap: number;
}

export interface SubmissionFormValue {
  readonly target: string;
  readonly notes: string;
  readonly damage: string;
  readonly placementType: 'rank' | 'percent';
  readonly placementValue: string;
}

export interface GameReferenceData {
  readonly modes: readonly ModeConfig[];
  readonly heroes: readonly Hero[];
  readonly pets: readonly Pet[];
}

export const FORMATION_LAYOUT = [2, 3] as const;

export const MODES: readonly ModeConfig[] = [
  {
    slug: 'twisted-realm',
    short: 'TR',
    name: 'Twisted Realm',
    targetLabel: 'Boss',
    targetAll: 'All bosses',
    targets: ['Kane', 'Demonic Entity', 'The Unhinged', 'Ice Shemira', 'Burning Brute', 'Grotesque Mage'],
    rules: 'One team per run. Heroes are level-matched to the account Resonating Crystal level; gear and ascension still count. The boss rotates every couple of days.',
    formations: [{ key: 'team', label: 'Team' }],
    collectionsEnabled: true,
    fields: [{ k: 'damage', l: 'Damage dealt', t: 'damage', ph: 'e.g. 1.84B' }],
  },
  {
    slug: 'nightmare-corridor',
    short: 'NC',
    name: 'Nightmare Corridor',
    targetLabel: 'Cycle anchor (6th boss)',
    targetAll: 'All cycles',
    targets: ['Astral Devourer', 'Dual-Mantle', 'Cursed Capricornus', 'Netherspinner', 'Molten Crystaline Worm', 'Cindercrow Specter'],
    rules: 'Six teams, one for each boss in the cycle. Select the cycle by its 6th boss. Only Resonating Crystal heroes and up to one mercenary across the lineup.',
    formations: [
      { key: 'astral-devourer', label: 'Astral Devourer' },
      { key: 'dual-mantle', label: 'Dual-Mantle' },
      { key: 'cursed-capricornus', label: 'Cursed Capricornus' },
      { key: 'netherspinner', label: 'Netherspinner' },
      { key: 'molten-crystaline-worm', label: 'Molten Crystaline Worm' },
      { key: 'cindercrow-specter', label: 'Cindercrow Specter' },
    ],
    mercMax: 1,
    collectionsEnabled: true,
    fields: [],
  },
  {
    slug: 'cursed-realm',
    short: 'CR',
    name: 'Cursed Realm',
    targetLabel: 'Boss',
    targetAll: 'All bosses',
    targets: ['Kane', 'Demonic Entity', 'The Unhinged', 'Ice Shemira', 'Burning Brute', 'Grotesque Mage'],
    rules: 'Six formations: five Shadow Guards and the boss. Heroes are level 360 with no artifact or union bonuses, up to one mercenary across the full lineup, and a hero can only appear once per run.',
    formations: [
      { key: 'sg1', label: 'SG1' },
      { key: 'sg2', label: 'SG2' },
      { key: 'sg3', label: 'SG3' },
      { key: 'sg4', label: 'SG4' },
      { key: 'sg5', label: 'SG5' },
      { key: 'boss', label: 'Boss' },
    ],
    mercMax: 1,
    uniqueAcross: true,
    collectionsEnabled: false,
    fields: [{ k: 'damage', l: 'Total damage across all six fights', t: 'damage', ph: 'e.g. 5.6B' }],
  },
  {
    slug: 'treasure-scramble',
    short: 'TS',
    name: 'Treasure Scramble',
    targetLabel: 'Debuff',
    targetAll: 'All debuffs',
    targets: ['Fire', 'Frost', 'Forest', 'Fog', 'Fountain'],
    rules: 'A lineup contains seven teams for one debuff cycle. Heroes are level 360 with no artifact bonuses, mercenaries are not allowed, and a hero can only appear once per run.',
    variable: { min: 7, max: 7 },
    uniqueAcross: true,
    mercMax: 0,
    collectionsEnabled: false,
    fields: [],
  },
];

export const UPCOMING_MODES = ['Arena of Heroes', "Legends' Challenger", 'Temporal Rift'] as const;
