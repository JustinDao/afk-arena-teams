import { Injectable } from '@angular/core';
import { CollectionCatalogItem, CollectionInventoryItem, CollectionNode, CollectionNodeStat, CollectionNodeTier, Formation, GameReferenceData, ModeConfig, Pet, PetRosterEntry, RosterEntry, Submission } from '../../features/lineup-ledger/models';
import { formatInvestment, parseInvestment, rosterInvestment } from '../../features/lineup-ledger/investment';
import { COLLECTION_CATALOG, COLLECTION_NODE_STATS } from '../../features/lineup-ledger/collection-catalog';
import { supabase, supabaseConfigured } from '../supabase/supabase-client';

interface ModeRow {
  slug: string;
  name: string;
  target_kind: 'boss' | 'debuff' | 'none';
  sort_order: number;
  config: Record<string, unknown>;
}

interface TargetRow {
  mode_id: number;
  slug: string;
  name: string;
}

interface DatabaseSubmissionRow {
  id: number;
  upvotes: number;
  hero_level: number | null;
  result: Record<string, number | boolean | string>;
  notes: string | null;
  created_at: string;
  targets: { name: string } | null;
  game_modes: { slug: string } | null;
  formations: {
    id: number;
    slot_key: string;
    slot_label: string;
    slot_order: number;
    beast: string | null;
    pet_id: number | null;
    pet_level: number | null;
    result_time_seconds: number | null;
    pets: { name: string; icon_url: string } | null;
    formation_heroes: {
      position: number;
      hero_id: number;
      is_merc: boolean;
      si: number | null;
      furniture: number | null;
      engraving: number | null;
      heroes: { name: string; icon_url: string } | null;
    }[];
    formation_collections: {
      hero_id: number;
      collection_name: string;
      catalog_id: number | null;
      collection_class: CollectionCatalogItem['class'] | null;
      nodes: Record<string, unknown>[];
    }[];
  }[];
}

interface HeroRow {
  id: number;
  name: string;
  icon_url: string;
}

interface PetRow {
  id: number;
  name: string;
  is_awakened: boolean;
  icon_url: string;
}

interface UserPetRow {
  pet_id: number;
  level: number;
}

interface UserRosterRow {
  hero_id: number;
  si: number | null;
  furniture: number | null;
  engraving: number | null;
}

interface UserCollectionRow {
  id: string;
  name: string;
  catalog_id: number | null;
  collection_catalog:
    | { class: CollectionCatalogItem['class'] }
    | { class: CollectionCatalogItem['class'] }[]
    | null;
  user_collection_nodes: {
    slot_index: number;
    node_type: CollectionNodeStat;
    tier: CollectionNodeTier;
  }[];
}

interface CollectionCatalogRow {
  id: number;
  class: CollectionCatalogItem['class'];
  code_name: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class UserDataService {
  readonly configured = supabaseConfigured;

  async loadVotes(userId: string): Promise<readonly number[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('votes').select('submission_id').eq('voter', userId);
    if (error) throw new Error(`Could not load your votes: ${error.message}`);
    return (data ?? []).map((row) => Number(row.submission_id));
  }

  async replaceRoster(roster: Readonly<Record<string, RosterEntry>>): Promise<void> {
    if (!supabase) return;
    const entries = Object.entries(roster).map(([heroId, entry]) => {
      const investment = rosterInvestment(entry) ?? { si: null, furn: null, eng: null };
      return { hero_id: Number(heroId), si: investment.si, furniture: investment.furn, engraving: investment.eng };
    });
    const { error } = await supabase.rpc('replace_user_roster', { p_entries: entries });
    if (error) throw new Error(`Could not update your hero roster: ${error.message}`);
  }

  async replacePetRoster(roster: Readonly<Record<string, PetRosterEntry>>): Promise<void> {
    if (!supabase) return;
    const entries = Object.entries(roster).map(([petId, entry]) => ({
      pet_id: Number(petId),
      level: entry.level,
    }));
    const { error } = await supabase.rpc('replace_user_pet_roster', { p_entries: entries });
    if (error) throw new Error(`Could not update your pet roster: ${error.message}`);
  }

  async saveHeroLevel(level: number | null): Promise<void> {
    if (!supabase) return;
    const { error } = await supabase.rpc('set_user_hero_level', { p_level: level });
    if (error) throw new Error(`Could not save your hero level: ${error.message}`);
  }

  async loadSubmissions(): Promise<readonly Submission[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('submissions')
      .select('id,upvotes,hero_level,result,notes,created_at,targets(name),game_modes(slug),formations(id,slot_key,slot_label,slot_order,beast,pet_id,pet_level,result_time_seconds,pets(name,icon_url),formation_heroes(position,hero_id,is_merc,si,furniture,engraving,heroes(name,icon_url)),formation_collections(hero_id,collection_name,catalog_id,collection_class,nodes))')
      .order('upvotes', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Could not load lineups: ${error.message}`);
    return ((data ?? []) as unknown as DatabaseSubmissionRow[]).map((row) => {
      if (!row.targets || !row.game_modes) throw new Error(`Lineup ${row.id} has invalid reference data.`);
      return {
        id: row.id,
        mode: row.game_modes.slug,
        target: row.targets.name,
        up: row.upvotes,
        days: Math.max(0, Math.floor((Date.now() - Date.parse(row.created_at)) / 86_400_000)),
        result: row.result,
        notes: row.notes ?? '',
        by: 'community',
        heroLevel: row.hero_level,
        forms: row.formations
          .sort((a, b) => a.slot_order - b.slot_order)
          .map((formation): Formation => ({
            key: formation.slot_key,
            label: formation.slot_label,
            beast: formation.pets?.name ?? formation.beast ?? '',
            petId: formation.pet_id,
            petIconUrl: formation.pets?.icon_url ?? null,
            petLevel: formation.pet_level,
            timeSeconds: formation.result_time_seconds,
            heroes: formation.formation_heroes
              .sort((a, b) => a.position - b.position)
              .map((hero) => {
                const collection = formation.formation_collections.find((item) => item.hero_id === hero.hero_id);
                return {
                  pos: hero.position,
                  hid: hero.hero_id,
                  name: hero.heroes?.name,
                  iconUrl: hero.heroes?.icon_url,
                  inv: { si: hero.si, furn: hero.furniture, eng: hero.engraving },
                  merc: hero.is_merc,
                  collection: collection ? {
                    name: collection.collection_name,
                      catalogId: collection.catalog_id ?? undefined,
                      class: collection.collection_class ?? undefined,
                      nodes: this.mapCollectionNodes(collection.nodes),
                    } : null,
                };
              }),
          })),
      };
    });
  }

  async submitLineup(payload: Record<string, unknown>): Promise<number> {
    if (!supabase) throw new Error('Configure Supabase to submit lineups.');
    const { data, error } = await supabase.rpc('submit_lineup', { p_payload: payload });
    if (error) throw new Error(`Could not submit lineup: ${error.message}`);
    return Number(data);
  }

  async toggleVote(submissionId: number): Promise<boolean> {
    if (!supabase) throw new Error('Configure Supabase to vote on lineups.');
    const { data, error } = await supabase.rpc('toggle_submission_vote', { p_submission_id: submissionId });
    if (error) throw new Error(`Could not save your vote: ${error.message}`);
    return Boolean(data);
  }

  async loadReferenceData(): Promise<GameReferenceData> {
    if (!supabase) throw new Error('Supabase is not configured.');
    const [modeResponse, targetResponse, heroResponse, petResponse] = await Promise.all([
      supabase.from('game_modes').select('id,slug,name,target_kind,sort_order,config').eq('enabled', true).order('sort_order'),
      supabase.from('targets').select('mode_id,slug,name').order('name'),
      supabase.from('heroes').select('id,name,icon_url').order('name'),
      supabase.from('pets').select('id,name,is_awakened,icon_url').order('name'),
    ]);
    if (modeResponse.error) throw new Error(`Could not load game modes: ${modeResponse.error.message}`);
    if (targetResponse.error) throw new Error(`Could not load targets: ${targetResponse.error.message}`);
    if (heroResponse.error) throw new Error(`Could not load heroes: ${heroResponse.error.message}`);
    if (petResponse.error) throw new Error(`Could not load pets: ${petResponse.error.message}`);

    const targetsByMode = new Map<number, TargetRow[]>();
    for (const target of (targetResponse.data ?? []) as TargetRow[]) {
      const targets = targetsByMode.get(target.mode_id) ?? [];
      targets.push(target);
      targetsByMode.set(target.mode_id, targets);
    }
    const modes = ((modeResponse.data ?? []) as unknown as (ModeRow & { id: number })[]).map((row) =>
      this.mapMode(row, targetsByMode.get(row.id) ?? []),
    );
    const heroes = ((heroResponse.data ?? []) as HeroRow[]).map((hero) => ({
      id: hero.id,
      name: hero.name,
      iconUrl: hero.icon_url,
    }));
    const pets = ((petResponse.data ?? []) as PetRow[]).map((pet): Pet => ({
      id: pet.id,
      name: pet.name,
      isAwakened: pet.is_awakened,
      iconUrl: pet.icon_url,
    }));
    return { modes, heroes, pets };
  }

  async loadPetRoster(): Promise<Record<string, PetRosterEntry>> {
    if (!supabase) return {};
    const { data, error } = await supabase.from('user_pet_roster').select('pet_id,level');
    if (error) throw new Error(`Could not load your pet roster: ${error.message}`);
    const roster: Record<string, PetRosterEntry> = {};
    for (const row of (data ?? []) as UserPetRow[]) {
      roster[row.pet_id] = { level: row.level };
    }
    return roster;
  }

  async loadHeroLevel(): Promise<number | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.from('profiles').select('hero_level').maybeSingle();
    if (error) throw new Error(`Could not load your hero level: ${error.message}`);
    return typeof data?.hero_level === 'number' ? data.hero_level : null;
  }

  async loadRoster(): Promise<Record<string, RosterEntry>> {
    if (!supabase) return {};
    const { data, error } = await supabase.from('user_roster').select('hero_id,si,furniture,engraving');
    if (error) throw new Error(`Could not load your hero roster: ${error.message}`);
    const roster: Record<string, RosterEntry> = {};
    for (const row of (data ?? []) as UserRosterRow[]) {
      roster[row.hero_id] = {
        inv: formatInvestment({ si: row.si, furn: row.furniture, eng: row.engraving }),
        si: row.si,
        furn: row.furniture,
        eng: row.engraving,
      };
    }
    return roster;
  }

  async saveRosterEntry(heroId: number, investment: string): Promise<void> {
    if (!supabase) return;
    const values = parseInvestment(investment) ?? { si: null, furn: null, eng: null };
    const { error } = await supabase.from('user_roster').upsert({
      hero_id: heroId,
      si: values.si,
      furniture: values.furn,
      engraving: values.eng,
    }, { onConflict: 'user_id,hero_id' });
    if (error) throw new Error(`Could not save your hero roster: ${error.message}`);
  }

  async removeRosterEntry(heroId: number): Promise<void> {
    if (!supabase) return;
    const { error } = await supabase.from('user_roster').delete().eq('hero_id', heroId);
    if (error) throw new Error(`Could not remove the hero from your roster: ${error.message}`);
  }

  async loadCollections(): Promise<readonly CollectionInventoryItem[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('user_collections')
      .select('id,name,catalog_id,collection_catalog(class),user_collection_nodes(slot_index,node_type,tier)')
      .order('name');
    if (error) throw new Error(`Could not load your collections: ${error.message}`);
    return ((data ?? []) as UserCollectionRow[]).map((row) => {
      const collectionData = Array.isArray(row.collection_catalog)
        ? row.collection_catalog[0]
        : row.collection_catalog;
      return {
        id: row.id,
        ...(row.catalog_id === null ? {} : { catalogId: row.catalog_id }),
        name: row.name,
        ...(collectionData ? { class: collectionData.class } : {}),
        nodes: (row.user_collection_nodes ?? []).map((node) => ({
          slotIndex: node.slot_index,
          stat: node.node_type,
          tier: node.tier,
        })),
      };
    });
  }

  async loadCollectionCatalog(): Promise<{
    readonly catalog: readonly CollectionCatalogItem[];
    readonly nodeStats: readonly CollectionNodeStat[];
  }> {
    if (!supabase) return { catalog: COLLECTION_CATALOG, nodeStats: COLLECTION_NODE_STATS };
    const [catalogResponse, statsResponse] = await Promise.all([
      supabase.from('collection_catalog').select('id,class,code_name,name').order('id'),
      supabase.from('collection_node_types').select('node_type').order('node_type'),
    ]);
    if (catalogResponse.error) throw new Error(`Could not load the collection catalog: ${catalogResponse.error.message}`);
    if (statsResponse.error) throw new Error(`Could not load collection stat types: ${statsResponse.error.message}`);
    const catalog = (catalogResponse.data ?? []) as CollectionCatalogRow[];
    const nodeStats = (statsResponse.data ?? []).map((row) => row.node_type);
    if (!catalog.length) throw new Error('The collection catalog is empty.');
    if (!nodeStats.length) throw new Error('The collection stat-node catalog is empty.');
    return {
      catalog: catalog.map((item) => ({
        id: item.id,
        class: item.class,
        codeName: item.code_name,
        name: item.name,
      })),
      nodeStats,
    };
  }

  async saveCollection(collection: CollectionInventoryItem | Omit<CollectionInventoryItem, 'id'>): Promise<CollectionInventoryItem> {
    if (!supabase) throw new Error('Configure Supabase to save collections.');
    const { data, error } = await supabase.rpc('save_user_collection', {
      p_collection: {
        ...('id' in collection ? { id: collection.id } : {}),
        catalog_id: collection.catalogId,
        nodes: collection.nodes.map((node) => ({
          slot_index: node.slotIndex,
          stat_type: node.stat,
          tier: node.tier,
        })),
      },
    });
    if (error) throw new Error(`Could not save collection: ${error.message}`);
    const saved = (await this.loadCollections()).find((item) => item.id === String(data));
    if (!saved) throw new Error('The collection was saved, but could not be reloaded.');
    return saved;
  }

  async deleteCollection(id: string): Promise<void> {
    if (!supabase) return;
    const { error } = await supabase.from('user_collections').delete().eq('id', id);
    if (error) throw new Error(`Could not delete collection: ${error.message}`);
  }

  private mapCollectionNodes(nodes: readonly Record<string, unknown>[]): readonly CollectionNode[] {
    const mapped: CollectionNode[] = [];
    for (const value of nodes) {
      const slotIndex = Number(value['slotIndex'] ?? value['slot_index']);
      const rawStat = value['stat'] ?? value['type'] ?? value['node_type'];
      const rawTier = value['tier'];
      const tier = rawTier === 'epic' ? 'elite' : rawTier;
      const legacyStatMap: Readonly<Record<string, CollectionNodeStat>> = {
        attack: 'atk',
        defense: 'def',
        level: 'skill_level',
      };
      const stat = typeof rawStat === 'string'
        ? legacyStatMap[rawStat] ?? (/^[a-z0-9_]+$/.test(rawStat) ? rawStat : undefined)
        : undefined;
      if (
        !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 7 ||
        !stat ||
        (tier !== 'elite' && tier !== 'legendary' && tier !== 'mythic')
      ) throw new Error('A saved collection contains an invalid stat node.');
      mapped.push({ slotIndex, stat, tier });
    }
    return mapped;
  }

  private mapMode(row: ModeRow & { id: number }, targetRows: readonly TargetRow[]): ModeConfig {
    const config = row.config ?? {};
    const fields = (config['result_fields'] as Record<string, unknown>[] | undefined) ?? [];
    const formations = config['formations'] as ModeConfig['formations'] | undefined;
    const variableFormations = config['variable_formations'] as { min: number; max: number } | undefined;
    return {
      slug: row.slug,
      short: row.slug.split('-').map((part) => part[0].toUpperCase()).join(''),
      name: row.name,
      targetLabel: String(config['target_label'] ?? (row.target_kind === 'debuff' ? 'Debuff' : 'Boss')),
      targetAll: String(config['target_all'] ?? (row.target_kind === 'debuff' ? 'All debuffs' : 'All bosses')),
      targets: targetRows.map((target) => target.name),
      targetSlugs: Object.fromEntries(targetRows.map((target) => [target.name, target.slug])),
      rules: String(config['rules'] ?? ''),
      ...(formations ? { formations } : {}),
      ...(variableFormations ? { variable: variableFormations } : {}),
      ...(typeof config['merc_max_per_submission'] === 'number' ? { mercMax: config['merc_max_per_submission'] } : {}),
      ...(typeof config['unique_heroes_across_formations'] === 'boolean' ? { uniqueAcross: config['unique_heroes_across_formations'] } : {}),
      ...(typeof config['collections_enabled'] === 'boolean' ? { collectionsEnabled: config['collections_enabled'] } : {}),
      fields: fields.map((field) => ({
        k: String(field['key']),
        l: String(field['label'] ?? field['key']),
        t: this.fieldType(String(field['type'])),
        ph: typeof field['placeholder'] === 'string' ? field['placeholder'] : undefined,
        def: typeof field['default'] === 'boolean' || typeof field['default'] === 'number' ? field['default'] : undefined,
        opts: Array.isArray(field['options']) ? field['options'].map(Number) : undefined,
      })),
    };
  }

  private fieldType(type: string): ModeConfig['fields'][number]['t'] {
    if (type === 'bool') return 'bool';
    if (type === 'damage') return 'damage';
    if (type === 'duration') return 'dur';
    if (type === 'percent') return 'pct';
    if (type === 'int') return 'int';
    return 'select';
  }

}
