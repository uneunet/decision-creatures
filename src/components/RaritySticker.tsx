import type { RarityTier } from '../inference/types';
import { computeScallopSegments, RARITY_THEME } from '../ui/theme';

function buildScallopPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  lobes: number,
): string {
  const segments = computeScallopSegments(cx, cy, rOuter, rInner, lobes);
  let d = '';
  segments.forEach((seg, i) => {
    if (i === 0) d += `M ${seg.startX.toFixed(2)} ${seg.startY.toFixed(2)} `;
    d += `Q ${seg.cpX.toFixed(2)} ${seg.cpY.toFixed(2)} ${seg.endX.toFixed(2)} ${seg.endY.toFixed(2)} `;
  });
  return `${d}Z`;
}

const SCALLOP_OUTER = buildScallopPath(34, 34, 33.5, 29.2, 14);
const SCALLOP_INNER = buildScallopPath(34, 34, 28.4, 24.8, 14);
const SCALLOP_LIP = buildScallopPath(34, 36.6, 33.2, 29.0, 14);

export interface RarityStickerProps {
  tier: RarityTier;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * S1 Scalloped Seal — 14-lobe flat die-cut sticker displaying only
 * the single rarity initial (C / U / R / E / M) and rarity color.
 */
export function RaritySticker({ tier, size = 'md', className }: RarityStickerProps) {
  const theme = RARITY_THEME[tier];
  const isMini = size === 'sm';

  return (
    <svg
      viewBox="0 0 68 70"
      role="img"
      aria-label={theme.label}
      className={className}
    >
      <path d={SCALLOP_LIP} fill={theme.dark} opacity={0.24} />
      <path d={SCALLOP_OUTER} fill="#ffffff" stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
      <path d={SCALLOP_INNER} fill={theme.bg} />
      {!isMini && (
        <circle
          cx={34}
          cy={34}
          r={21}
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1.4}
          strokeDasharray="3 3"
        />
      )}
      <text
        x={34}
        y={35.5}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize={isMini ? 28 : 25}
        fontWeight={900}
      >
        {theme.initial}
      </text>
    </svg>
  );
}
