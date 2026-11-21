import type { CSSProperties } from 'react';
import type {
  ArchetypeClass,
  BiomeType,
  CreatureAnalysis,
  CreatureStats,
  LoadProgress,
  RarityTier,
  SubstanceType,
} from '../inference/types';
import type { ThemeMode } from '../store/useThemeStore';

export interface SubstanceTheme {
  id: SubstanceType;
  label: string;
  pop: string;
  popDark: string;
  pastel: string;
  stroke: string;
  lip: string;
  ink: string;
  darkBg: string;
  darkStroke: string;
  darkLip: string;
}

export const SUBSTANCE_THEME: Record<SubstanceType, SubstanceTheme> = {
  flesh: {
    id: 'flesh',
    label: 'FLESH',
    pop: '#ff5c77',
    popDark: '#df3c58',
    pastel: '#ffe4ea',
    stroke: '#ffbac8',
    lip: '#ff8da3',
    ink: '#7a1c2e',
    darkBg: '#211317',
    darkStroke: '#a1344d',
    darkLip: '#6e1e31',
  },
  botanical: {
    id: 'botanical',
    label: 'BOTANICAL',
    pop: '#2cc069',
    popDark: '#1f9952',
    pastel: '#dff7e8',
    stroke: '#a8e8c1',
    lip: '#72d99b',
    ink: '#14522f',
    darkBg: '#111d16',
    darkStroke: '#2b7a4b',
    darkLip: '#195232',
  },
  metal: {
    id: 'metal',
    label: 'METAL',
    pop: '#64748b',
    popDark: '#475569',
    pastel: '#eaeff5',
    stroke: '#cbd5e1',
    lip: '#94a3b8',
    ink: '#1e293b',
    darkBg: '#16191f',
    darkStroke: '#55637a',
    darkLip: '#364052',
  },
  stone: {
    id: 'stone',
    label: 'STONE',
    pop: '#f59e0b',
    popDark: '#d97706',
    pastel: '#fef3d6',
    stroke: '#fbd685',
    lip: '#f5be49',
    ink: '#6b4009',
    darkBg: '#1f1a10',
    darkStroke: '#9c6b19',
    darkLip: '#6b460d',
  },
  liquid: {
    id: 'liquid',
    label: 'LIQUID',
    pop: '#1cb0f6',
    popDark: '#0f8ac7',
    pastel: '#dff4ff',
    stroke: '#a5dffc',
    lip: '#68caf9',
    ink: '#0d4c6e',
    darkBg: '#101b22',
    darkStroke: '#2b6f94',
    darkLip: '#1a4e6b',
  },
  fabric: {
    id: 'fabric',
    label: 'FABRIC',
    pop: '#ec4899',
    popDark: '#c42e79',
    pastel: '#fde7f3',
    stroke: '#f9b4d8',
    lip: '#f484be',
    ink: '#751b4b',
    darkBg: '#21131b',
    darkStroke: '#9e3168',
    darkLip: '#6b1d45',
  },
  energy: {
    id: 'energy',
    label: 'ENERGY',
    pop: '#8b5cf6',
    popDark: '#6d3fd9',
    pastel: '#efeaff',
    stroke: '#cbbafc',
    lip: '#a98bfa',
    ink: '#3f2080',
    darkBg: '#181424',
    darkStroke: '#6b46c1',
    darkLip: '#482c8a',
  },
};

export const SUBSTANCE_LIST: readonly SubstanceType[] = [
  'botanical',
  'liquid',
  'metal',
  'stone',
  'energy',
  'flesh',
  'fabric',
];

export interface RarityTheme {
  tier: RarityTier;
  rank: number;
  initial: 'C' | 'U' | 'R' | 'E' | 'M';
  label: string;
  bg: string;
  dark: string;
}

export const RARITY_THEME: Record<RarityTier, RarityTheme> = {
  common: {
    tier: 'common',
    rank: 1,
    initial: 'C',
    label: 'COMMON',
    bg: '#6b7280',
    dark: '#4b5563',
  },
  uncommon: {
    tier: 'uncommon',
    rank: 2,
    initial: 'U',
    label: 'UNCOMMON',
    bg: '#22c55e',
    dark: '#15803d',
  },
  rare: {
    tier: 'rare',
    rank: 3,
    initial: 'R',
    label: 'RARE',
    bg: '#0ea5e9',
    dark: '#0369a1',
  },
  epic: {
    tier: 'epic',
    rank: 4,
    initial: 'E',
    label: 'EPIC',
    bg: '#8b5cf6',
    dark: '#6d28d9',
  },
  mythic: {
    tier: 'mythic',
    rank: 5,
    initial: 'M',
    label: 'MYTHIC',
    bg: '#f59e0b',
    dark: '#b45309',
  },
};

export const RARITY_LIST: readonly RarityTier[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'mythic',
];

export interface StatSpec {
  key: keyof CreatureStats;
  en: string;
  ja: string;
  color: string;
}

export const STAT_SPECS: readonly StatSpec[] = [
  { key: 'hp', en: 'HP', ja: '体力', color: '#2cc069' },
  { key: 'atk', en: 'ATK', ja: '攻撃', color: '#ff5c77' },
  { key: 'def', en: 'DEF', ja: '防御', color: '#1cb0f6' },
  { key: 'spd', en: 'SPD', ja: '速さ', color: '#f59e0b' },
  { key: 'sp', en: 'SP', ja: '特殊', color: '#8b5cf6' },
];

export function substanceVars(
  substance: SubstanceType | null,
  mode: ThemeMode = 'light',
): CSSProperties {
  const isDark = mode === 'dark';
  if (!substance) {
    return {
      '--attr-pop': '#1cb0f6',
      '--attr-pop-dark': '#0f8ac7',
      '--attr-pastel': isDark ? '#15161b' : '#f4f3ef',
      '--attr-stroke': isDark ? '#3f4455' : '#dcd9cf',
      '--attr-lip': isDark ? '#2b2f3d' : '#c5c1b4',
      '--attr-ink': isDark ? '#f4f4f6' : '#1f2026',
    } as CSSProperties;
  }

  const theme = SUBSTANCE_THEME[substance];
  return {
    '--attr-pop': theme.pop,
    '--attr-pop-dark': theme.popDark,
    '--attr-pastel': isDark ? theme.darkBg : theme.pastel,
    '--attr-stroke': isDark ? theme.darkStroke : theme.stroke,
    '--attr-lip': isDark ? theme.darkLip : theme.lip,
    '--attr-ink': isDark ? '#f4f4f6' : theme.ink,
  } as CSSProperties;
}

export function applyDocumentSubstanceVars(
  substance: SubstanceType | null,
  mode: ThemeMode,
): void {
  if (typeof document === 'undefined') return;
  const vars = substanceVars(substance, mode) as Record<string, string>;
  const rootStyle = document.documentElement.style;
  for (const [key, value] of Object.entries(vars)) {
    rootStyle.setProperty(key, value);
  }
}

export function formatLoadStageLabel(
  progress: Pick<LoadProgress, 'stage' | 'file' | 'fromCache'> | null | undefined,
): string {
  if (!progress) return 'モデルを準備中...';
  switch (progress.stage) {
    case 'checking-webgpu':
      return 'WebGPU を確認中...';
    case 'downloading':
      if (progress.fromCache) {
        return progress.file ? `キャッシュ読込 · ${progress.file}` : 'キャッシュから読込中...';
      }
      return progress.file ? `ダウンロード中 · ${progress.file}` : 'モデルをダウンロード中...';
    case 'initializing-vision':
      return 'WebGPU を初期化中 (Vision)...';
    case 'initializing-decoder':
      return 'WebGPU を初期化中 (Decoder)...';
    case 'ready':
      return '準備完了';
  }
}

export interface ScallopCurveSegment {
  startX: number;
  startY: number;
  cpX: number;
  cpY: number;
  endX: number;
  endY: number;
}

/**
 * Shared quadratic Bezier segments for the S1 scalloped die-cut rarity seal,
 * consumed by both SVG (`RaritySticker`) and Canvas 2D (`exportCardPng`).
 */
export function computeScallopSegments(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  lobes = 14,
): ScallopCurveSegment[] {
  const pts: Array<[number, number]> = [];
  const total = lobes * 2;
  for (let i = 0; i < total; i++) {
    const angle = (i * Math.PI * 2) / total - Math.PI / 2;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  const segments: ScallopCurveSegment[] = [];
  for (let i = 0; i < total; i++) {
    const curr = pts[i]!;
    const next = pts[(i + 1) % total]!;
    const prev = pts[(i - 1 + total) % total]!;
    segments.push({
      startX: (prev[0] + curr[0]) / 2,
      startY: (prev[1] + curr[1]) / 2,
      cpX: curr[0],
      cpY: curr[1],
      endX: (curr[0] + next[0]) / 2,
      endY: (curr[1] + next[1]) / 2,
    });
  }
  return segments;
}

const BIOME_PREFIX: Record<BiomeType, string> = {
  wild: 'フォレスト',
  aquatic: 'アクア',
  urban: 'アーバン',
  sky: 'スカイ',
  abyss: 'アビス',
  cosmos: 'コスモ',
};

const ARCHETYPE_SUFFIX: Record<ArchetypeClass, string> = {
  beast: 'ビースト',
  guardian: 'ガーディアン',
  spirit: 'スピリット',
  construct: 'コンストラクト',
  flora: 'フローラ',
  trickster: 'トリックスター',
};

export function formatTypeLabel(
  primary: SubstanceType,
  secondary?: SubstanceType | null,
): string {
  const p = SUBSTANCE_THEME[primary].label;
  return secondary ? `${p} / ${SUBSTANCE_THEME[secondary].label}` : p;
}

export function generateCreatureName(
  analysis: Pick<CreatureAnalysis, 'biome' | 'archetype'>,
): string {
  return `${BIOME_PREFIX[analysis.biome.id]}・${ARCHETYPE_SUFFIX[analysis.archetype.id]}`;
}

export function totalCreatureStats(stats: CreatureStats): number {
  return stats.hp + stats.atk + stats.def + stats.spd + stats.sp;
}

export function formatCreatureDate(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
}
