import { describe, expect, test } from 'bun:test';
import { rgbaToPatches, smartResize } from './preprocess';
import rawPlan from './prompt-plan.json';
import {
  analyzeCreature,
  buildDecoderInputs,
  computeRarity,
  normalizedEntropy,
  readoutLogits,
} from './readout';
import type { PromptPlan, QuestionResult } from './types';

const plan = rawPlan as unknown as PromptPlan;

const DUMMY_METRICS = {
  preprocessMs: 1,
  visionMs: 2,
  decoderMs: 3,
  totalMs: 6,
  imageTokens: 64,
  totalTokens: 1357,
  resizedWidth: 256,
  resizedHeight: 256,
};

describe('preprocess', () => {
  test('smartResize keeps dimensions divisible by 32 within pixel bounds', () => {
    const down = smartResize(2000, 3000, 32, 65_536, 524_288);
    expect(down.height % 32).toBe(0);
    expect(down.width % 32).toBe(0);
    expect(down.height * down.width).toBeLessThanOrEqual(524_288);
    expect(down.height * down.width).toBeGreaterThanOrEqual(65_536);

    const up = smartResize(100, 100, 32, 65_536, 524_288);
    expect(up.height).toBe(256);
    expect(up.width).toBe(256);
  });

  test('rgbaToPatches matches Lfm3VlImageProcessor [gh, gw, 2, 2, 1536] layout and normalization', () => {
    const width = 32;
    const height = 32;
    const rgba = new Uint8ClampedArray(width * height * 4);
    rgba[0] = 255;
    rgba[1] = 0;
    rgba[2] = 127;
    rgba[3] = 255;
    const idx16 = 16 * 4;
    rgba[idx16] = 0;
    rgba[idx16 + 1] = 255;
    rgba[idx16 + 2] = 255;
    rgba[idx16 + 3] = 255;

    const out = rgbaToPatches(rgba, width, height);
    expect(out.dims).toEqual([1, 1, 2, 2, 1536]);
    expect(out.numImageTokens).toBe(1);
    expect(out.pixelValues.length).toBe(4 * 1536);

    expect(out.pixelValues[0]).toBeCloseTo(1.0, 5);
    expect(out.pixelValues[256]).toBeCloseTo(1.0, 5);
    expect(out.pixelValues[512]).toBeCloseTo(-1.0, 5);
    expect(out.pixelValues[768]).toBeCloseTo(-1.0, 5);
    expect(out.pixelValues[1024]).toBeCloseTo(127 * (2 / 255) - 1, 5);
    expect(out.pixelValues[1280]).toBeCloseTo(127 * (2 / 255) - 1, 5);

    expect(out.pixelValues[1536 + 0]).toBeCloseTo(-1.0, 5);
    expect(out.pixelValues[1536 + 512]).toBeCloseTo(1.0, 5);
    expect(out.pixelValues[1536 + 1024]).toBeCloseTo(1.0, 5);
  });
});

describe('finalized 11-question prompt-plan & readout', () => {
  test('plan contains exactly the 11 finalized S-rank questions', () => {
    expect(plan.questions.map((q) => q.id)).toEqual([
      'substance',
      'biome',
      'archetype',
      'size_class',
      'is_living',
      'size_7',
      'mass_5',
      'power',
      'agility',
      'mystique',
      'warmth',
    ]);
  });

  test('buildDecoderInputs packs state (-1) and 1-indexed question_ids cleanly', () => {
    const numImg = 64;
    const dec = buildDecoderInputs(plan, numImg);
    const expectedStateLen = plan.prefixBeforeImage.length + numImg + plan.prefixAfterImage.length;

    expect(dec.stateLen).toBe(expectedStateLen);
    expect(dec.seqLen).toBe(expectedStateLen + plan.suffixIds.length);
    expect(dec.slotPositions.length).toBe(11);

    for (let i = 0; i < dec.stateLen; i++) {
      expect(dec.questionIds[i]).toBe(-1n);
    }
    for (let i = 0; i < numImg; i++) {
      expect(dec.inputIds[plan.prefixBeforeImage.length + i]).toBe(BigInt(plan.imageTokenId));
    }
    expect(dec.questionIds[dec.stateLen]).toBe(1n);
    expect(dec.questionIds[dec.seqLen - 1]).toBe(11n);
  });

  test('normalizedEntropy is 0 for deterministic and 1 for uniform distributions', () => {
    expect(normalizedEntropy([1, 0, 0, 0])).toBeCloseTo(0, 6);
    expect(normalizedEntropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(1, 6);
    expect(normalizedEntropy([0.5, 0.5])).toBeCloseTo(1, 6);
  });

  test('derived HP and DEF reflect physical size, mass, density, and substance hardness', () => {
    const makeResults = (overrides: {
      substance: string;
      size: number;
      mass: number;
      isLiving: number;
      power: number;
      agility: number;
      mystique: number;
      warmth: number;
    }): QuestionResult[] =>
      plan.questions.map((q) => {
        const probs = q.options.map((opt) =>
          q.id === 'substance' ? (opt === overrides.substance ? 1 : 0) : 1 / q.options.length,
        );
        const scalarMap: Record<string, number> = {
          size_7: overrides.size,
          mass_5: overrides.mass,
          is_living: overrides.isLiving,
          power: overrides.power,
          agility: overrides.agility,
          mystique: overrides.mystique,
          warmth: overrides.warmth,
        };
        return {
          id: q.id,
          label: q.label,
          group: q.group,
          kind: q.kind,
          options: q.options,
          probabilities: probs,
          topOption: q.id === 'substance' ? overrides.substance : q.options[0]!,
          topProbability: 1,
          secondOption: null,
          secondProbability: 0,
          expectedScalar: scalarMap[q.id] ?? null,
          entropy: 0.35,
        };
      });

    const castle = analyzeCreature(
      makeResults({
        substance: 'stone',
        size: 0.85,
        mass: 0.9,
        isLiving: 0,
        power: 0.7,
        agility: 0.2,
        mystique: 0.85,
        warmth: 0.05,
      }),
      DUMMY_METRICS,
    );

    const lightning = analyzeCreature(
      makeResults({
        substance: 'energy',
        size: 0.87,
        mass: 0.15,
        isLiving: 0,
        power: 0.8,
        agility: 0.85,
        mystique: 0.6,
        warmth: 0.15,
      }),
      DUMMY_METRICS,
    );

    expect(castle.primaryType.id).toBe('stone');
    expect(lightning.primaryType.id).toBe('energy');
    expect(castle.stats.def).toBeGreaterThan(lightning.stats.def + 30);
    expect(castle.stats.hp).toBeGreaterThan(lightning.stats.hp + 15);
    expect(lightning.stats.spd).toBeGreaterThan(castle.stats.spd + 30);
  });

  test('readoutLogits + computeRarity assigns higher rarity to higher uncertainty', () => {
    const sharpLogits = new Float32Array(plan.questions.length * plan.vocabSize);
    const flatLogits = new Float32Array(plan.questions.length * plan.vocabSize);

    for (let i = 0; i < plan.questions.length; i++) {
      const q = plan.questions[i]!;
      sharpLogits[i * plan.vocabSize + q.readoutIds[0]![0]!] = 8.0;
    }

    const sharpRarity = computeRarity(readoutLogits(plan, sharpLogits));
    const flatRarity = computeRarity(readoutLogits(plan, flatLogits));

    expect(sharpRarity.uncertainty).toBeLessThan(0.1);
    expect(sharpRarity.tier).toBe('common');
    expect(flatRarity.uncertainty).toBeCloseTo(1.0, 5);
    expect(flatRarity.tier).toBe('mythic');
  });
});
