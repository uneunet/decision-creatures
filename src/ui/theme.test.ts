import { describe, expect, test } from 'bun:test';
import type { RarityTier, SubstanceType } from '../inference/types';
import {
  computeScallopSegments,
  formatCreatureDate,
  formatLoadStageLabel,
  formatTypeLabel,
  generateCreatureName,
  RARITY_THEME,
  STAT_SPECS,
  SUBSTANCE_THEME,
  substanceVars,
} from './theme';

describe('UI flat-pop theme tokens', () => {
  test('defines complete palette for all 7 substances', () => {
    const substances: SubstanceType[] = [
      'flesh',
      'botanical',
      'metal',
      'stone',
      'liquid',
      'fabric',
      'energy',
    ];
    for (const s of substances) {
      const t = SUBSTANCE_THEME[s];
      expect(t.id).toBe(s);
      expect(t.pop).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.pastel).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.lip).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test('maps all 5 rarities to single initial C/U/R/E/M', () => {
    const expected: Record<RarityTier, 'C' | 'U' | 'R' | 'E' | 'M'> = {
      common: 'C',
      uncommon: 'U',
      rare: 'R',
      epic: 'E',
      mythic: 'M',
    };
    for (const [tier, initial] of Object.entries(expected) as Array<
      [RarityTier, 'C' | 'U' | 'R' | 'E' | 'M']
    >) {
      expect(RARITY_THEME[tier].initial).toBe(initial);
    }
  });

  test('includes English + concise Japanese labels for all 5 stats', () => {
    expect(STAT_SPECS.map((s) => `${s.en}:${s.ja}`)).toEqual([
      'HP:体力',
      'ATK:攻撃',
      'DEF:防御',
      'SPD:速さ',
      'SP:特殊',
    ]);
  });

  test('formats type label, deterministic name, CSS vars, and timestamp', () => {
    expect(formatTypeLabel('liquid', 'stone')).toBe('LIQUID / STONE');
    expect(formatTypeLabel('flesh', null)).toBe('FLESH');
    expect(
      generateCreatureName({
        biome: { id: 'abyss', probability: 0.8 },
        archetype: { id: 'spirit', probability: 0.9 },
      }),
    ).toBe('アビス・スピリット');

    const vars = substanceVars('botanical', 'light') as Record<string, string>;
    expect(vars['--attr-pop']).toBe(SUBSTANCE_THEME.botanical.pop);
    expect(vars['--attr-pastel']).toBe(SUBSTANCE_THEME.botanical.pastel);

    const darkVars = substanceVars('botanical', 'dark') as Record<string, string>;
    expect(darkVars['--attr-pastel']).toBe(SUBSTANCE_THEME.botanical.darkBg);
    expect(darkVars['--attr-stroke']).toBe(SUBSTANCE_THEME.botanical.darkStroke);

    const neutral = substanceVars(null, 'light') as Record<string, string>;
    expect(neutral['--attr-pastel']).toBe('#f4f3ef');

    const neutralDark = substanceVars(null, 'dark') as Record<string, string>;
    expect(neutralDark['--attr-pastel']).toBe('#15161b');

    const dt = new Date(2026, 10, 21, 9, 5);
    expect(formatCreatureDate(dt)).toBe('2026.11.21 09:05');
  });

  test('formats all ModelLoadStage labels accurately including cache hits', () => {
    expect(formatLoadStageLabel(null)).toBe('モデルを準備中...');
    expect(formatLoadStageLabel({ stage: 'checking-webgpu' })).toBe('WebGPU を確認中...');
    expect(
      formatLoadStageLabel({ stage: 'downloading', file: 'decoder.onnx', fromCache: false }),
    ).toBe('ダウンロード中 · decoder.onnx');
    expect(
      formatLoadStageLabel({ stage: 'downloading', file: 'decoder.onnx', fromCache: true }),
    ).toBe('キャッシュ読込 · decoder.onnx');
    expect(formatLoadStageLabel({ stage: 'initializing-vision' })).toContain('WebGPU');
    expect(formatLoadStageLabel({ stage: 'initializing-decoder' })).toContain('WebGPU');
    expect(formatLoadStageLabel({ stage: 'ready' })).toBe('準備完了');
  });

  test('computes closed 14-lobe scallop curve segments', () => {
    const segs = computeScallopSegments(34, 34, 33.5, 29.2, 14);
    expect(segs).toHaveLength(28);
    expect(segs[0]!.startX).toBeCloseTo(segs[27]!.endX, 5);
    expect(segs[0]!.startY).toBeCloseTo(segs[27]!.endY, 5);
  });
});
