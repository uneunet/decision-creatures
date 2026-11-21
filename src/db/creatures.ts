import Dexie, { type EntityTable } from 'dexie';
import type {
  ArchetypeClass,
  BiomeType,
  CreatureAnalysis,
  CreatureStats,
  CreatureTraits,
  QuestionResult,
  RarityAssessment,
  RarityTier,
  SizeClass,
  SubstanceType,
} from '../inference/types';

export interface CreatureRecord {
  id: string;
  name: string;
  primaryType: SubstanceType;
  secondaryType: SubstanceType | null;
  types: SubstanceType[];
  biome: BiomeType;
  archetype: ArchetypeClass;
  sizeClass: SizeClass;
  rarityTier: RarityTier;
  rarity: RarityAssessment;
  stats: CreatureStats;
  traits: CreatureTraits;
  scores: QuestionResult[];
  imageBlob: Blob;
  createdAt: number;
}

class DecisionCreaturesDB extends Dexie {
  creatures!: EntityTable<CreatureRecord, 'id'>;

  constructor() {
    super('decision-creatures');
    this.version(1).stores({
      creatures: 'id, createdAt, primaryType, rarityTier',
    });
  }
}

export const db = new DecisionCreaturesDB();

export function createCreatureRecord(
  analysis: CreatureAnalysis,
  name: string,
  imageBlob: Blob,
  createdAt = Date.now(),
  id = crypto.randomUUID(),
): CreatureRecord {
  const types: SubstanceType[] = analysis.secondaryType
    ? [analysis.primaryType.id, analysis.secondaryType.id]
    : [analysis.primaryType.id];

  return {
    id,
    name,
    primaryType: analysis.primaryType.id,
    secondaryType: analysis.secondaryType?.id ?? null,
    types,
    biome: analysis.biome.id,
    archetype: analysis.archetype.id,
    sizeClass: analysis.sizeClass.id,
    rarityTier: analysis.rarity.tier,
    rarity: analysis.rarity,
    stats: analysis.stats,
    traits: analysis.traits,
    scores: analysis.questions,
    imageBlob,
    createdAt,
  };
}

export async function listCreatures(): Promise<CreatureRecord[]> {
  return db.creatures.orderBy('createdAt').reverse().toArray();
}

export async function getCreatureById(id: string): Promise<CreatureRecord | undefined> {
  return db.creatures.get(id);
}

export async function saveCreature(record: CreatureRecord): Promise<CreatureRecord> {
  await db.creatures.put(record);
  return record;
}

export async function renameCreature(id: string, name: string): Promise<void> {
  await db.creatures.update(id, { name });
}

export async function deleteCreature(id: string): Promise<void> {
  await db.creatures.delete(id);
}
