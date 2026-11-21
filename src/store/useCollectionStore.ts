import { create } from 'zustand';
import {
  type CreatureRecord,
  createCreatureRecord,
  deleteCreature,
  listCreatures,
  renameCreature,
  saveCreature,
} from '../db/creatures';
import type { CreatureAnalysis } from '../inference/types';
import { generateCreatureName } from '../ui/theme';

interface CollectionState {
  items: CreatureRecord[];
  loaded: boolean;
  lastAddedId: string | null;
  imageUrls: Record<string, string>;

  load: () => Promise<void>;
  addFromAnalysis: (analysis: CreatureAnalysis, imageBlob: Blob) => Promise<CreatureRecord>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearLastAdded: () => void;
}

function ensureUrls(
  items: readonly CreatureRecord[],
  existing: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  const alive = new Set<string>();
  for (const item of items) {
    alive.add(item.id);
    next[item.id] = existing[item.id] ?? URL.createObjectURL(item.imageBlob);
  }
  for (const [id, url] of Object.entries(existing)) {
    if (!alive.has(id)) {
      URL.revokeObjectURL(url);
    }
  }
  return next;
}

let inflightLoad: Promise<void> | null = null;

export const useCollectionStore = create<CollectionState>((set, get) => ({
  items: [],
  loaded: false,
  lastAddedId: null,
  imageUrls: {},

  load: async () => {
    if (inflightLoad) return inflightLoad;
    inflightLoad = (async () => {
      try {
        const items = await listCreatures();
        const imageUrls = ensureUrls(items, get().imageUrls);
        set({ items, imageUrls, loaded: true });
      } catch {
        set({ loaded: true });
      } finally {
        inflightLoad = null;
      }
    })();
    return inflightLoad;
  },

  addFromAnalysis: async (analysis, imageBlob) => {
    const name = generateCreatureName(analysis);
    const record = createCreatureRecord(analysis, name, imageBlob);
    await saveCreature(record);
    const nextItems = [record, ...get().items.filter((x) => x.id !== record.id)];
    const imageUrls = ensureUrls(nextItems, get().imageUrls);
    set({ items: nextItems, imageUrls, loaded: true, lastAddedId: record.id });
    return record;
  },

  rename: async (id, rawName) => {
    const name = rawName.trim();
    if (!name) return;
    await renameCreature(id, name);
    set({
      items: get().items.map((item) => (item.id === id ? { ...item, name } : item)),
    });
  },

  remove: async (id) => {
    await deleteCreature(id);
    const nextItems = get().items.filter((item) => item.id !== id);
    const imageUrls = ensureUrls(nextItems, get().imageUrls);
    set({
      items: nextItems,
      imageUrls,
      lastAddedId: get().lastAddedId === id ? null : get().lastAddedId,
    });
  },

  clearLastAdded: () => set({ lastAddedId: null }),
}));
