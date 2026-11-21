import { describe, expect, test } from 'bun:test';
import { rgbaToPatches, smartResize } from './preprocess';
import rawPlan from './prompt-plan.json';
import {
  analyzeCreature,
  computeRarity,
  normalizedEntropy,
  readoutDistilledLogits,
} from './readout';
import type { PromptPlan, QuestionResult } from './types';

const plan = rawPlan as unknown as PromptPlan;

const DUMMY_METRICS = {
  preprocessMs: 1,
  visionMs: 2,
  decoderMs: 3,
  totalMs: 6,
  imageTokens: 64,
  totalTokens: 64,
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

describe('finalized 11-question prompt-plan & distilled readout', () => {
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

  test('readoutDistilledLogits slices 60 compact logits into calibrated 11-question results & rarity', () => {
    const totalDims = plan.questions.reduce((acc, q) => acc + q.options.length, 0);
    expect(totalDims).toBe(60);

    const sharpLogits = new Float32Array(totalDims);
    const flatLogits = new Float32Array(totalDims);

    // Pick specific options: substance=metal, is_living=yes (idx 0), power=max
    let offset = 0;
    for (const q of plan.questions) {
      if (q.id === 'substance') {
        sharpLogits[offset + q.options.indexOf('metal')] = 8.0;
      } else if (q.id === 'power') {
        sharpLogits[offset + (q.options.length - 1)] = 8.0;
      } else {
        sharpLogits[offset] = 8.0;
      }
      offset += q.options.length;
    }

    const sharpResults = readoutDistilledLogits(plan, sharpLogits);
    expect(sharpResults.length).toBe(11);

    const byId = new Map(sharpResults.map((r) => [r.id, r]));
    expect(byId.get('substance')?.topOption).toBe('metal');
    expect(byId.get('is_living')?.expectedScalar).toBeGreaterThan(0.99);
    expect(byId.get('power')?.expectedScalar).toBeGreaterThan(0.99);

    const sharpRarity = computeRarity(sharpResults);
    const flatRarity = computeRarity(readoutDistilledLogits(plan, flatLogits));
    expect(sharpRarity.uncertainty).toBeLessThan(0.1);
    expect(sharpRarity.tier).toBe('common');
    expect(flatRarity.tier).toBe('mythic');
    expect(flatRarity.uncertainty).toBeCloseTo(1.0, 5);

    expect(() => readoutDistilledLogits(plan, new Float32Array(10))).toThrow(/length mismatch/i);
  });
});
