import { collectionIconUrlForNodes, defaultCollectionName } from './collection-catalog';
import { CollectionNode } from './models';

const nodes: CollectionNode[] = [
  { slotIndex: 0, stat: 'cda', tier: 'mythic' },
  { slotIndex: 1, stat: 'cda', tier: 'mythic' },
  { slotIndex: 2, stat: 'crit', tier: 'mythic' },
  { slotIndex: 3, stat: 'atk', tier: 'legendary' },
  { slotIndex: 6, stat: 'skill_level', tier: 'mythic' },
  { slotIndex: 7, stat: 'skill_level', tier: 'mythic' },
];

describe('collection catalog helpers', () => {
  it('builds the icon from the level node count and mythic stat count', () => {
    expect(collectionIconUrlForNodes(13, nodes)).toBe(
      'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/13_lvl3_ms3_cl.webp',
    );
    expect(collectionIconUrlForNodes(13, [])).toBe(
      'https://raw.githubusercontent.com/afk-mine/cdn/main/collection_icon/13_lvl1_cl.webp',
    );
  });

  it('defaults the name to the non-Level mythic nodes, or the catalog name when there are none', () => {
    expect(defaultCollectionName('Shadowflow Blade', nodes)).toBe('CDA, CDA, CRIT');
    expect(defaultCollectionName('Shadowflow Blade', [])).toBe('Shadowflow Blade');
  });
});
