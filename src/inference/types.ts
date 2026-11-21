export type QuestionKind = 'choice' | 'noul' | 'score';
export type QuestionGroup = 'type' | 'scalar';

export type SubstanceType =
  | 'flesh'
  | 'botanical'
  | 'metal'
  | 'stone'
  | 'liquid'
  | 'fabric'
  | 'energy';

export type BiomeType = 'wild' | 'aquatic' | 'urban' | 'sky' | 'abyss' | 'cosmos';

export type ArchetypeClass =
  | 'beast'
  | 'guardian'
  | 'spirit'
  | 'construct'
  | 'flora'
  | 'trickster';

export type SizeClass =
  | 'tiny'
  | 'handheld'
  | 'human'
  | 'vehicle'
  | 'monument'
  | 'colossal'
  | 'intangible';

export interface CompiledQuestion {
  id: string;
  label: string;
  group: QuestionGroup;
  kind: QuestionKind;
  options: string[];
  optionDescriptions: Record<string, string | undefined>;
  readoutIds: number[][];
  temperature: number;
}

export interface PromptPlan {
  schemaVersion: number;
  modelRepo: string;
  revision: string;
  vocabSize: number;
  hiddenSize: number;
  d1SetSize: number;
  maxPixels: number;
  patchSize: number;
  mergeSize: number;
  temporalPatchSize: number;
  imageTokenId: number;
  prefixBeforeImage: number[];
  prefixAfterImage: number[];
  suffixIds: number[];
  suffixQuestionIds: number[];
  slotOffsets: number[];
  questions: CompiledQuestion[];
}

export interface PreprocessedImage {
  pixelValues: Float32Array;
  dims: [number, number, number, number, number];
  gridHeightBlocks: number;
  gridWidthBlocks: number;
  resizedHeight: number;
  resizedWidth: number;
  numImageTokens: number;
}

export interface QuestionResult {
  id: string;
  label: string;
  group: QuestionGroup;
  kind: QuestionKind;
  options: string[];
  probabilities: number[];
  topOption: string;
  topProbability: number;
  secondOption: string | null;
  secondProbability: number;
  /** 0..1 scalar value for score (expected value) and noul (P(yes)). */
  expectedScalar: number | null;
  /** Normalized Shannon entropy in [0, 1]. Higher = more model uncertainty. */
  entropy: number;
}

export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'mythic';

export interface RarityAssessment {
  tier: RarityTier;
  label: string;
  /** Composite normalized uncertainty in [0, 1]. */
  uncertainty: number;
  typeEntropy: number;
  scalarEntropy: number;
  meanEntropy: number;
  mostUncertainQuestion: {
    id: string;
    label: string;
    entropy: number;
  };
}

export interface CreatureStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  sp: number;
}

export interface CreatureTraits {
  size: number;
  mass: number;
  density: number;
  warmth: number;
  isLiving: number;
}

export interface InferenceMetrics {
  preprocessMs: number;
  visionMs: number;
  decoderMs: number;
  totalMs: number;
  imageTokens: number;
  totalTokens: number;
  resizedWidth: number;
  resizedHeight: number;
}

export interface CreatureAnalysis {
  /** Primary battle type from `substance` (7 physical materials). */
  primaryType: { id: SubstanceType; probability: number };
  /** Secondary substance type when runner-up probability >= 0.20. */
  secondaryType: { id: SubstanceType; probability: number } | null;
  /** Habitat / field affinity from `biome`. */
  biome: { id: BiomeType; probability: number };
  /** Combat role / class from `archetype`. */
  archetype: { id: ArchetypeClass; probability: number };
  /** Grounded real-world scale class (`tiny`..`colossal` or `intangible`). */
  sizeClass: { id: SizeClass; probability: number };
  traits: CreatureTraits;
  stats: CreatureStats;
  rarity: RarityAssessment;
  questions: QuestionResult[];
  metrics: InferenceMetrics;
}

export type ModelLoadStage =
  | 'checking-webgpu'
  | 'downloading'
  | 'initializing-vision'
  | 'initializing-decoder'
  | 'ready';

export interface LoadProgress {
  stage: ModelLoadStage;
  file?: string;
  loadedBytes: number;
  totalBytes: number;
  fromCache?: boolean;
}

export type WorkerCommand =
  | { type: 'init'; maxPixels?: number }
  | { type: 'analyze'; requestId: string; imageBlob: Blob; maxPixels?: number }
  | { type: 'clear-cache' }
  | { type: 'dispose' };

export type WorkerEvent =
  | { type: 'progress'; progress: LoadProgress }
  | { type: 'ready'; webgpuAdapter?: string; cached: boolean; initMs: number }
  | { type: 'result'; requestId: string; analysis: CreatureAnalysis }
  | { type: 'cache-cleared' }
  | {
      type: 'error';
      requestId?: string;
      code: 'WEBGPU_UNSUPPORTED' | 'INIT_FAILED' | 'INFERENCE_FAILED';
      message: string;
    };
