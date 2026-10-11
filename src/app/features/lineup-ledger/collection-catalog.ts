import { CollectionCatalogItem, CollectionNodeStat, CollectionNodeTier } from './models';

const CDN_BASE = 'https://raw.githubusercontent.com/afk-mine/cdn/main';

export const COLLECTION_CATALOG: readonly CollectionCatalogItem[] = [
  { id: 1, class: 'Warrior', codeName: 'dt', name: 'Temporal Cover' },
  { id: 2, class: 'Warrior', codeName: 'lizard', name: 'Shadow Dancer' },
  { id: 3, class: 'Tank', codeName: 'timeg', name: 'Timeline Watch' },
  { id: 4, class: 'Tank', codeName: 'dkid', name: 'Spell Bondage' },
  { id: 5, class: 'Ranger', codeName: 'goda', name: 'Judgment Armor' },
  { id: 6, class: 'Ranger', codeName: 'wolf', name: 'Sandstorm Fangs' },
  { id: 7, class: 'Mage', codeName: 'lust', name: 'Captive Wings' },
  { id: 8, class: 'Mage', codeName: 'mystic', name: 'Oculus Diabolus' },
  { id: 9, class: 'Support', codeName: 'merchant', name: "Trader's Vault" },
  { id: 10, class: 'Support', codeName: 'puck', name: 'Luminous Flight' },
  { id: 11, class: 'Warrior', codeName: 'scimonster', name: 'Infused Mind Core' },
  { id: 12, class: 'Tank', codeName: 'orcleader', name: 'Horn of Dominion' },
  { id: 13, class: 'Ranger', codeName: 'swordmaster', name: 'Shadowflow Blade' },
  { id: 14, class: 'Mage', codeName: 'thor', name: "Stormwrath's Lull" },
  { id: 15, class: 'Support', codeName: 'nbh', name: "Bounty Hunter's Decree" },
  { id: 16, class: 'Warrior', codeName: 'pudge', name: "Reaper's Talon" },
  { id: 17, class: 'Tank', codeName: 'sonia', name: "Sinner's Rose" },
  { id: 18, class: 'Ranger', codeName: 'nunassassin', name: 'Demon Sealer' },
  { id: 19, class: 'Mage', codeName: 'selene', name: 'Crescent Wheel' },
  { id: 20, class: 'Support', codeName: 'siren', name: 'Ashen Tide Relic' },
];

export const COLLECTION_NODE_STATS: readonly CollectionNodeStat[] = [
  'armor', 'atk', 'buffer', 'cbr', 'cda', 'cdr', 'crit', 'def', 'diss',
  'dmg_resist', 'erosion', 'err', 'full_atk', 'full_buffer', 'full_def',
  'full_erosion', 'full_hp', 'heal', 'hp', 'is', 'll', 'mp', 'pp', 'prf',
  'skill_level', 'ty',
];

export const COLLECTION_NODE_TIERS: readonly CollectionNodeTier[] = ['elite', 'legendary', 'mythic'];

export function collectionIconUrl(collectionId: number, mythicStats = 0): string {
  const mythic = mythicStats ? `_ms${mythicStats}` : '';
  return `${CDN_BASE}/collection_icon/${collectionId}${mythic}_cl.webp`;
}

export function collectionNodeIconUrl(stat: CollectionNodeStat, tier: CollectionNodeTier): string {
  return `${CDN_BASE}/collection_stats_icon/${stat}_${tier[0]}.webp`;
}

export function collectionNodeLabel(stat: CollectionNodeStat): string {
  if (stat === 'skill_level') return 'LEVEL';
  return stat.split('_').map((part) => part.toUpperCase()).join(' ');
}
