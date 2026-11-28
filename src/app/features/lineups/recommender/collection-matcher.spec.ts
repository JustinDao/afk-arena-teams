import { COLLECTION_CATALOG } from '../collection-catalog';
import { CollectionInventoryItem, CollectionSnapshot } from '../models';
import { assignCollectionsToLineup, CollectionAssignmentRequest } from './collection-matcher';

describe('assignCollectionsToLineup', () => {
  const inventory: CollectionInventoryItem[] = [
    {
      id: 'col-wings-lv3',
      catalogId: 7,
      name: 'Captive Wings +2 ATK',
      class: 'Mage',
      nodes: [
        { slotIndex: 0, stat: 'skill_level', tier: 'mythic' },
        { slotIndex: 1, stat: 'skill_level', tier: 'mythic' },
        { slotIndex: 2, stat: 'atk', tier: 'mythic' },
        { slotIndex: 3, stat: 'mp', tier: 'mythic' },
      ],
    },
    {
      id: 'col-wings-lv1',
      catalogId: 7,
      name: 'Captive Wings Lv1',
      class: 'Mage',
      nodes: [
        { slotIndex: 0, stat: 'atk', tier: 'legendary' },
      ],
    },
    {
      id: 'col-oculus-lv2',
      catalogId: 8,
      name: 'Oculus Diabolus Lv2',
      class: 'Mage',
      nodes: [
        { slotIndex: 0, stat: 'skill_level', tier: 'mythic' },
        { slotIndex: 1, stat: 'erosion', tier: 'mythic' },
      ],
    },
    {
      id: 'col-vault-lv2',
      catalogId: 9,
      name: "Trader's Vault Lv2",
      class: 'Support',
      nodes: [
        { slotIndex: 0, stat: 'skill_level', tier: 'mythic' },
        { slotIndex: 1, stat: 'full_atk', tier: 'mythic' },
      ],
    },
  ];

  const makeTarget = (catalogId: number, name: string, level: number, attackStats: string[] = []): CollectionSnapshot => ({
    catalogId,
    name,
    nodes: [],
    recommendation: { level, attackStats, defenseStats: [] },
  });

  it('assigns collections uniquely and optimally by level and stats', () => {
    const requests: CollectionAssignmentRequest[] = [
      {
        slotKey: '0:0',
        heroId: 1,
        heroClass: 'Mage',
        target: makeTarget(7, 'Captive Wings', 1, ['atk']),
      },
      {
        slotKey: '1:0',
        heroId: 2,
        heroClass: 'Mage',
        target: makeTarget(7, 'Captive Wings', 3, ['atk', 'mp']),
      },
    ];

    const result = assignCollectionsToLineup(requests, inventory, COLLECTION_CATALOG);

    // Slot 1:0 needs Lv3 Captive Wings, so optimal matching must give Lv3 to 1:0 and Lv1 to 0:0.
    expect(result.get('1:0')?.assigned?.id).toBe('col-wings-lv3');
    expect(result.get('1:0')?.status).toBe('exact');
    expect(result.get('0:0')?.assigned?.id).toBe('col-wings-lv1');
    expect(result.get('0:0')?.status).toBe('exact');
  });

  it('falls back to a same-class collection when exact catalog is exhausted and marks missing when none remain', () => {
    const requests: CollectionAssignmentRequest[] = [
      { slotKey: '0:0', heroId: 1, heroClass: 'Mage', target: makeTarget(7, 'Captive Wings', 2, ['atk']) },
      { slotKey: '1:0', heroId: 2, heroClass: 'Mage', target: makeTarget(7, 'Captive Wings', 1, ['atk']) },
      { slotKey: '2:0', heroId: 3, heroClass: 'Mage', target: makeTarget(7, 'Captive Wings', 1, ['atk']) },
      { slotKey: '3:0', heroId: 4, heroClass: 'Mage', target: makeTarget(7, 'Captive Wings', 1, ['atk']) },
    ];

    const result = assignCollectionsToLineup(requests, inventory, COLLECTION_CATALOG);

    const assignedIds = [...result.values()]
      .map((r) => r.assigned?.id)
      .filter((id): id is string => Boolean(id));

    // Only 3 Mage collections exist in inventory; no duplicate IDs allowed and Support collection must not be assigned.
    expect(new Set(assignedIds).size).toBe(assignedIds.length);
    expect(assignedIds.length).toBe(3);
    expect(assignedIds).not.toContain('col-vault-lv2');

    const statuses = [...result.values()].map((r) => r.status);
    expect(statuses.filter((s) => s === 'fallback').length).toBe(1);
    expect(statuses.filter((s) => s === 'missing').length).toBe(1);
  });

  it('respects class boundaries and returns none when no target collection is requested', () => {
    const requests: CollectionAssignmentRequest[] = [
      { slotKey: '0:0', heroId: 10, heroClass: 'Warrior', target: makeTarget(1, 'Temporal Cover', 2, ['atk']) },
      { slotKey: '0:1', heroId: 11, heroClass: 'Support', target: null },
    ];

    const result = assignCollectionsToLineup(requests, inventory, COLLECTION_CATALOG);

    expect(result.get('0:0')?.status).toBe('missing');
    expect(result.get('0:0')?.assigned).toBeNull();
    expect(result.get('0:1')?.status).toBe('none');
  });
});
