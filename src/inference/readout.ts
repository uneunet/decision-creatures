import type {
  ArchetypeClass,
  BiomeType,
  CreatureAnalysis,
  CreatureStats,
  InferenceMetrics,
  PromptPlan,
  QuestionResult,
  RarityAssessment,
  RarityTier,
  SizeClass,
  SubstanceType,
} from './types';

/**
 * Physical hardness coefficient per substance, used for deterministic DEF derivation.
 */
export const SUBSTANCE_HARDNESS: Record<SubstanceType, number> = {
  metal: 1.0,
  stone: 0.95,
  botanical: 0.55,
  flesh: 0.45,
  fabric: 0.35,
  liquid: 0.25,
  energy: 0.1,
};

/**
 * Normalized Shannon entropy in [0, 1].
 * 0 = deterministic (one option has probability 1)
 * 1 = maximum uncertainty (uniform distribution across all options)
 */
export function normalizedEntropy(probabilities: readonly number[]): number {
  const k = probabilities.length;
  if (k <= 1) return 0;
  let h = 0;
  for (let i = 0; i < k; i++) {
    const p = probabilities[i]!;
    if (p > 1e-12) {
      h -= p * Math.log(p);
    }
  }
  const norm = h / Math.log(k);
  return Math.max(0, Math.min(1, norm));
}

/**
 * Reads calibrated option probabilities from the distilled head's compact
 * 60-dim concatenated logits `[7, 6, 6, 7, 2, 7, 5, 5, 5, 5, 5]`.
 * Post-hoc calibration temperature is baked into `creature_head.onnx`, so `temperature` defaults to `1.0`.
 */
export function readoutDistilledLogits(
  plan: PromptPlan,
  logits: Float32Array,
  temperature = 1.0,
): QuestionResult[] {
  const expectedLength = plan.questions.reduce((acc, q) => acc + q.options.length, 0);
  if (logits.length !== expectedLength) {
    throw new Error(
      `Distilled head logits length mismatch: expected ${expectedLength}, got ${logits.length}`,
    );
  }
  const results: QuestionResult[] = [];
  const temp = temperature > 0 ? temperature : 1.0;
  let offset = 0;

  for (let qIdx = 0; qIdx < plan.questions.length; qIdx++) {
    const q = plan.questions[qIdx]!;
    const k = q.options.length;
    const scores = new Array<number>(k);
    let maxScore = -Infinity;
    for (let optIdx = 0; optIdx < k; optIdx++) {
      const scaled = logits[offset + optIdx]! / temp;
      scores[optIdx] = scaled;
      if (scaled > maxScore) maxScore = scaled;
    }
    offset += k;

    let expSum = 0;
    const probs = new Array<number>(k);
    for (let i = 0; i < k; i++) {
      const e = Math.exp(scores[i]! - maxScore);
      probs[i] = e;
      expSum += e;
    }
    for (let i = 0; i < k; i++) {
      probs[i] = probs[i]! / expSum;
    }

    let topIdx = 0;
    let secondIdx = -1;
    for (let i = 1; i < k; i++) {
      if (probs[i]! > probs[topIdx]!) {
        secondIdx = topIdx;
        topIdx = i;
      } else if (secondIdx === -1 || probs[i]! > probs[secondIdx]!) {
        secondIdx = i;
      }
    }

    let expectedScalar: number | null = null;
    if (q.kind === 'score' && k > 1) {
      let ev = 0;
      for (let i = 0; i < k; i++) {
        ev += i * probs[i]!;
      }
      expectedScalar = ev / (k - 1);
    } else if (q.kind === 'noul') {
      expectedScalar = probs[0] ?? 0;
    }

    results.push({
      id: q.id,
      label: q.label,
      group: q.group,
      kind: q.kind,
      options: q.options,
      probabilities: probs,
      topOption: q.options[topIdx]!,
      topProbability: probs[topIdx]!,
      secondOption: secondIdx >= 0 ? q.options[secondIdx]! : null,
      secondProbability: secondIdx >= 0 ? probs[secondIdx]! : 0,
      expectedScalar,
      entropy: normalizedEntropy(probs),
    });
  }

  return results;
}

const RARITY_LABELS: Record<RarityTier, string> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  epic: 'EPIC',
  mythic: 'MYTHIC',
};

/**
 * Computes creature rarity from predictive uncertainty (normalized Shannon entropy)
 * across the finalized 11-question S-rank set.
 */
export function computeRarity(questions: readonly QuestionResult[]): RarityAssessment {
  const typeQs = questions.filter((q) => q.group === 'type' && q.kind === 'choice');
  const scalarQs = questions.filter((q) => q.group === 'scalar');

  const avg = (xs: readonly QuestionResult[]) =>
    xs.length === 0 ? 0 : xs.reduce((acc, q) => acc + q.entropy, 0) / xs.length;

  const typeEntropy = avg(typeQs);
  const scalarEntropy = avg(scalarQs);
  const meanEntropy = avg(questions);
  const uncertainty = 0.6 * typeEntropy + 0.4 * scalarEntropy;

  let mostUncertain = questions[0]!;
  for (const q of questions) {
    if (q.entropy > mostUncertain.entropy) {
      mostUncertain = q;
    }
  }

  // Empirically calibrated for the finalized 11-question S-rank set
  // (12 real images: 0.248..0.516, median 0.421).
  let tier: RarityTier;
  if (uncertainty >= 0.53) {
    tier = 'mythic';
  } else if (uncertainty >= 0.48) {
    tier = 'epic';
  } else if (uncertainty >= 0.42) {
    tier = 'rare';
  } else if (uncertainty >= 0.34) {
    tier = 'uncommon';
  } else {
    tier = 'common';
  }

  return {
    tier,
    label: RARITY_LABELS[tier],
    uncertainty,
    typeEntropy,
    scalarEntropy,
    meanEntropy,
    mostUncertainQuestion: {
      id: mostUncertain.id,
      label: mostUncertain.label,
      entropy: mostUncertain.entropy,
    },
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function toStat(value01: number, rarityBoost: number): number {
  return Math.round(20 + clamp01(value01) * 72 + rarityBoost * 8);
}

/**
 * Computes expected physical hardness by integrating across the full `substance` distribution.
 */
export function expectedSubstanceHardness(substanceQ: QuestionResult | undefined): number {
  if (!substanceQ) return 0.5;
  let hardness = 0;
  for (let i = 0; i < substanceQ.options.length; i++) {
    const opt = substanceQ.options[i] as SubstanceType;
    const w = SUBSTANCE_HARDNESS[opt] ?? 0.5;
    hardness += w * (substanceQ.probabilities[i] ?? 0);
  }
  return clamp01(hardness);
}

/**
 * Synthesizes a creature profile from the finalized 11-question S-rank readout:
 * - Primary / Secondary Type: `substance` (7 physical materials)
 * - Environment: `biome` (6 domains)
 * - Class: `archetype` (6 roles)
 * - Scale Class: `size_class` (7 classes incl. `intangible`)
 * - HP: derived from `size_7` (45%) + `mass_5` (35%) + `is_living` (10%) + `warmth` (10%)
 * - DEF: derived from `mass_5` (45%) + density (25%) + expected substance hardness (30%)
 * - ATK / SPD / SP: direct from `power` / `agility` / `mystique`
 * - Rarity: derived from normalized predictive uncertainty
 */
export function analyzeCreature(
  questions: QuestionResult[],
  metrics: InferenceMetrics,
): CreatureAnalysis {
  const byId = new Map(questions.map((q) => [q.id, q]));

  const substanceQ = byId.get('substance') ?? questions[0]!;
  const biomeQ = byId.get('biome') ?? substanceQ;
  const archetypeQ = byId.get('archetype') ?? substanceQ;
  const sizeClassQ = byId.get('size_class') ?? substanceQ;

  const size = byId.get('size_7')?.expectedScalar ?? 0.5;
  const mass = byId.get('mass_5')?.expectedScalar ?? 0.5;
  const isLiving = byId.get('is_living')?.expectedScalar ?? 0.5;
  const warmth = byId.get('warmth')?.expectedScalar ?? 0.5;
  const power = byId.get('power')?.expectedScalar ?? 0.5;
  const agility = byId.get('agility')?.expectedScalar ?? 0.5;
  const mystique = byId.get('mystique')?.expectedScalar ?? 0.5;

  const density = clamp01((mass - size + 1) / 2);
  const hardness = expectedSubstanceHardness(substanceQ);

  const hpRaw = 0.45 * size + 0.35 * mass + 0.1 * isLiving + 0.1 * warmth;
  const defRaw = 0.45 * mass + 0.25 * density + 0.3 * hardness;

  const rarity = computeRarity(questions);
  const rarityBoost = clamp01((rarity.uncertainty - 0.25) / 0.45);

  const stats: CreatureStats = {
    hp: toStat(hpRaw, rarityBoost),
    atk: toStat(power, rarityBoost),
    def: toStat(defRaw, rarityBoost),
    spd: toStat(agility, rarityBoost),
    sp: toStat(mystique, rarityBoost),
  };

  const primaryType = {
    id: substanceQ.topOption as SubstanceType,
    probability: substanceQ.topProbability,
  };
  const secondaryType =
    substanceQ.secondOption && substanceQ.secondProbability >= 0.2
      ? { id: substanceQ.secondOption as SubstanceType, probability: substanceQ.secondProbability }
      : null;

  return {
    primaryType,
    secondaryType,
    biome: { id: biomeQ.topOption as BiomeType, probability: biomeQ.topProbability },
    archetype: { id: archetypeQ.topOption as ArchetypeClass, probability: archetypeQ.topProbability },
    sizeClass: { id: sizeClassQ.topOption as SizeClass, probability: sizeClassQ.topProbability },
    traits: { size, mass, density, warmth, isLiving },
    stats,
    rarity,
    questions,
    metrics,
  };
}
