export interface Hero {
  readonly id: number;
  readonly name: string;
  readonly isAwakened?: boolean;
  readonly faction?: string | null;
  readonly class?: string | null;
  readonly type?: import('./hero-classification').HeroAttribute | null;
  readonly iconUrl?: string;
}

export const ASCENSION_RANKS = [
  'epic',
  'epic_plus',
  'legendary',
  'legendary_plus',
  'mythic',
  'mythic_plus',
  'ascended',
  'ascended_1',
  'ascended_2',
  'ascended_3',
  'ascended_4',
  'ascended_5',
] as const;

export type AscensionRank = (typeof ASCENSION_RANKS)[number];

export const ASCENSION_RANK_LABELS: Readonly<Record<AscensionRank, string>> = {
  epic: 'Epic',
  epic_plus: 'Epic+',
  legendary: 'Legendary',
  legendary_plus: 'Legendary+',
  mythic: 'Mythic',
  mythic_plus: 'Mythic+',
  ascended: 'Ascended',
  ascended_1: 'Ascended 1 star',
  ascended_2: 'Ascended 2 stars',
  ascended_3: 'Ascended 3 stars',
  ascended_4: 'Ascended 4 stars',
  ascended_5: 'Ascended 5 stars',
};

export function displayHeroName(hero: Pick<Hero, 'name' | 'isAwakened'>): string {
  const baseName = hero.name.replace(/^Awakened\s+/i, '').replace(/\s+\(Awakened\)$/i, '');
  return hero.isAwakened ? `${baseName} (Awakened)` : baseName;
}

export function isSpCapableHero(hero: Pick<Hero, 'name' | 'isAwakened'>): boolean {
  return Boolean(hero.isAwakened) || /\(highborn\)/i.test(hero.name);
}

export interface Pet {
  readonly id: number;
  readonly name: string;
  readonly kind: PetKind;
  readonly iconUrl?: string;
}

export type PetKind = 'basic' | 'standard' | 'awakened';

export const BASIC_PET_MAX_LEVEL = 18;
export const PET_MAX_LEVEL = 36;

export function petMaxLevel(kind: PetKind | undefined): number {
  return kind === 'basic' ? BASIC_PET_MAX_LEVEL : PET_MAX_LEVEL;
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
  readonly faction?: string | null;
  readonly inv: Investment | null;
  readonly ascension: AscensionRank | null;
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

export interface CollectionRecommendationSpec {
  readonly level: number;
  readonly attackStats: readonly CollectionNodeStat[];
  readonly defenseStats: readonly CollectionNodeStat[];
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
  readonly recommendation?: CollectionRecommendationSpec;
}

export interface Formation {
  readonly key: string;
  readonly label: string;
  readonly beast: string;
  readonly petId: number | null;
  readonly petIconUrl?: string | null;
  readonly petLevel: number | null;
  readonly timeSeconds: number | null;
  readonly damage?: number | null;
  readonly spHeroId?: number | null;
  readonly notes?: string;
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
  readonly targetFormations?: Readonly<Record<string, readonly { readonly key: string; readonly label: string }[]>>;
  readonly rules: string;
  readonly formations?: readonly { readonly key: string; readonly label: string }[];
  readonly variable?: { readonly min: number; readonly max: number; readonly default?: number };
  readonly mercMax?: number;
  readonly uniqueAcross?: boolean;
  readonly collectionsEnabled?: boolean;
  readonly allowPartialFormations?: boolean;
  readonly fields: readonly ResultField[];
}

export interface RosterEntry {
  inv: string;
  ascension?: AscensionRank | null;
  si?: number | null;
  furn?: number | null;
  eng?: number | null;
}

export interface DraftSlot {
  hid: number | null;
  merc: boolean;
  inv: string;
  ascension: AscensionRank | null;
  collectionId: string;
  collectionSnapshot: CollectionSnapshot | null;
}

export interface DraftFormation {
  key: string;
  label: string;
  petId: number | null;
  petLevel: number | null;
  spHeroId?: number | null;
  time: string;
  damage?: string;
  notes?: string;
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
  readonly floor?: string;
  readonly stars?: string;
  readonly rcLevel?: string;
  readonly placementType: '' | 'rank' | 'percent';
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
    slug: 'nightmare-corridor',
    short: 'NC',
    name: 'Nightmare Corridor',
    targetLabel: 'Cycle anchor (6th boss)',
    targetAll: 'All cycles',
    targets: ['Netherspinner', 'Infernal Overlord', 'Soulchain Knight'],
    targetSlugs: {
      Netherspinner: 'netherspinner',
      'Infernal Overlord': 'infernal-overlord',
      'Soulchain Knight': 'soulchain-knight',
    },
    targetFormations: {
      Netherspinner: [
        { key: 'soulweaver', label: 'Soulweaver' },
        { key: 'the-devourer', label: 'The Devourer' },
        { key: 'astral-devourer', label: 'Astral Devourer' },
        { key: 'dual-mantle', label: 'Dual-Mantel' },
        { key: 'cursed-caprihornus', label: 'Cursed Caprihornus' },
        { key: 'netherspinner', label: 'Netherspinner' },
      ],
      'Infernal Overlord': [
        { key: 'molten-crystalline-worm-queen', label: 'Molten Crystalline Worm Queen' },
        { key: 'cindercrow-specter', label: 'Cindercrow Specter' },
        { key: 'demonic-puppet', label: 'Demonic Puppet' },
        { key: 'ashen-prophet', label: 'Ashen Prophet' },
        { key: 'mirror-demon', label: 'Mirror Demon' },
        { key: 'infernal-overlord', label: 'Infernal Overlord' },
      ],
      'Soulchain Knight': [
        { key: 'cindercrow-specter', label: 'Cindercrow Specter' },
        { key: 'demonic-puppet', label: 'Demonic Puppet' },
        { key: 'ashen-prophet', label: 'Ashen Prophet' },
        { key: 'mirror-demon', label: 'Mirror Demon' },
        { key: 'infernal-overlord', label: 'Infernal Overlord' },
        { key: 'soulchain-knight', label: 'Soulchain Knight' },
      ],
    },
    rules: 'Six teams, one for each boss in the cycle. Select the cycle by its 6th boss. Only Resonating Crystal heroes and up to one mercenary across the lineup.',
    formations: [
      { key: 'soulweaver', label: 'Soulweaver' },
      { key: 'the-devourer', label: 'The Devourer' },
      { key: 'astral-devourer', label: 'Astral Devourer' },
      { key: 'dual-mantle', label: 'Dual-Mantle' },
      { key: 'cursed-caprihornus', label: 'Cursed Caprihornus' },
      { key: 'netherspinner', label: 'Netherspinner' },
    ],
    mercMax: 1,
    uniqueAcross: true,
    collectionsEnabled: true,
    allowPartialFormations: true,
    fields: [],
  },
  {
    slug: 'cursed-realm',
    short: 'CR',
    name: 'Cursed Realm',
    targetLabel: 'Boss',
    targetAll: 'All bosses',
    targets: ['Kane', 'Demonic Entity', 'The Unhinged', 'Ice Shemira', 'Burning Brute', 'Grotesque Mage', 'Dune Destroyer'],
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
    collectionsEnabled: true,
    allowPartialFormations: true,
    fields: [{ k: 'damage', l: 'Total damage across all six fights', t: 'damage', ph: 'e.g. 5.6B' }],
  },
  {
    slug: 'treasure-scramble',
    short: 'TS',
    name: 'Treasure Scramble',
    targetLabel: 'Debuff',
    targetAll: 'All debuffs',
    targets: ['Fire', 'Frost', 'Forest', 'Fog', 'Fountain'],
    rules: 'A lineup contains two to seven teams, depending on the division, for one debuff cycle. Heroes are level 360 with no artifact bonuses, mercenaries are not allowed, and a hero can only appear once per run.',
    variable: { min: 2, max: 7, default: 7 },
    uniqueAcross: true,
    mercMax: 0,
    collectionsEnabled: true,
    allowPartialFormations: true,
    fields: [],
  },
  {
    slug: 'temporal-rift',
    short: 'TRift',
    name: 'Temporal Rift',
    targetLabel: 'Season',
    targetAll: 'All seasons',
    targets: ['S16', 'S17'],
    rules: 'Season-long run using up to five teams. Record the floor reached and any beacon/trait enhancer notes.',
    variable: { min: 1, max: 5, default: 5 },
    uniqueAcross: true,
    mercMax: 0,
    collectionsEnabled: true,
    allowPartialFormations: true,
    fields: [{ k: 'floor', l: 'Floor reached', t: 'int', ph: 'e.g. 300' }],
  },
  {
    slug: 'hunting-fields-contract',
    short: 'HFC',
    name: 'Hunting Fields Contract',
    targetLabel: 'Contract',
    targetAll: 'All contracts',
    targets: ['Wrizz — No Earrings', 'Adrax — No Earrings', 'Adrax — Ranger Buff', 'Adrax — Mage Buff', 'Adrax — Tank Buff'],
    rules: 'Always two teams under the active Hunting Fields Contract buff or trait restriction (e.g. No Earrings, Ranger Buff). Record per-team or total boss damage.',
    formations: [
      { key: 'team-1', label: 'Team 1' },
      { key: 'team-2', label: 'Team 2' },
    ],
    uniqueAcross: true,
    mercMax: 0,
    collectionsEnabled: true,
    allowPartialFormations: true,
    fields: [{ k: 'damage', l: 'Total damage', t: 'damage', ph: 'e.g. 72B' }],
  },
  {
    slug: 'abyssal-expedition',
    short: 'AbEx',
    name: 'Abyssal Expedition',
    targetLabel: 'Boss / Phase',
    targetAll: 'All bosses',
    targets: ['S18 — Final Boss', 'S18 — Gate Bosses'],
    rules: 'Boss and gate compositions grouped by relic branch or phase. Heroes may repeat across competing compositions.',
    variable: { min: 1, max: 6, default: 3 },
    uniqueAcross: false,
    mercMax: 0,
    collectionsEnabled: true,
    allowPartialFormations: true,
    fields: [{ k: 'damage', l: 'Boss damage', t: 'damage', ph: 'e.g. 120B' }],
  },
];

export const UPCOMING_MODES = [] as const;

export const RECOMMENDATION_CATEGORIES = [
  { key: 'standard-4f', label: '4F' },
  { key: 'cele-hypo', label: 'Cele / Hypo' },
  { key: 'awakened', label: 'Awakened' },
  { key: 'drago-lite', label: 'Dragolite' },
  { key: 'dragon-highborn', label: 'Dragon Highborn' },
] as const;

export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number]['key'];

export interface ModeEventCoverage {
  readonly used: number;
  readonly total: number;
}

export interface HeroRecommendation {
  readonly heroId: number;
  readonly category: RecommendationCategory;
  readonly rank: number;
  readonly kind: 'build' | 'invest';
  readonly score: number;
  readonly completeCount: number;
  readonly nearCount: number;
  readonly investment: Investment | null;
  readonly ascension: AscensionRank | null;
  readonly byMode: Readonly<Record<string, number>>;
  readonly byModeEvents?: Readonly<Record<string, ModeEventCoverage>>;
  readonly submissionIds: readonly number[];
}

export interface CollectionRecommendation {
  readonly catalogId: number;
  readonly collectionClass: CollectionCatalogItem['class'];
  readonly rank: number;
  readonly kind: 'build' | 'upgrade';
  readonly score: number;
  readonly completeCount: number;
  readonly nearCount: number;
  readonly levelNodes: number;
  readonly mythicStats: readonly string[];
  readonly byMode: Readonly<Record<string, number>>;
  readonly submissionIds: readonly number[];
  readonly topHeroIds?: readonly number[];
}

export interface PetRecommendation {
  readonly petId: number;
  readonly petKind: Exclude<PetKind, 'basic'>;
  readonly rank: number;
  readonly kind: 'build' | 'upgrade';
  readonly score: number;
  readonly completeCount: number;
  readonly nearCount: number;
  readonly level: number;
  readonly byMode: Readonly<Record<string, number>>;
  readonly submissionIds: readonly number[];
}

export interface RecommendationSettings {
  readonly modes: readonly string[];
  readonly refreshedAt: string | null;
}
