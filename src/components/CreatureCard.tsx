import { RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import type { CreatureStats, RarityTier, SubstanceType } from '../inference/types';
import { useThemeStore } from '../store/useThemeStore';
import { PopStatMeter } from '../ui/primitives';
import {
  formatCreatureDate,
  formatTypeLabel,
  STAT_SPECS,
  substanceVars,
} from '../ui/theme';
import { RaritySticker } from './RaritySticker';

export interface CreatureCardProps {
  name: string;
  imageUrl: string;
  primaryType: SubstanceType;
  secondaryType?: SubstanceType | null;
  rarity: RarityTier;
  stats: CreatureStats;
  createdAt: Date | number;
  flipped?: boolean;
  onFlippedChange?: (flipped: boolean) => void;
  revealOnMount?: boolean;
}

export function CreatureCard({
  name,
  imageUrl,
  primaryType,
  secondaryType = null,
  rarity,
  stats,
  createdAt,
  flipped: controlledFlipped,
  onFlippedChange,
  revealOnMount = false,
}: CreatureCardProps) {
  const mode = useThemeStore((s) => s.mode);
  const [uncontrolledFlipped, setUncontrolledFlipped] = useState(false);
  const flipped = controlledFlipped ?? uncontrolledFlipped;

  const toggle = () => {
    const next = !flipped;
    if (controlledFlipped === undefined) {
      setUncontrolledFlipped(next);
    }
    onFlippedChange?.(next);
  };

  const typeLabel = formatTypeLabel(primaryType, secondaryType);
  const dateLabel = formatCreatureDate(createdAt);

  return (
    <article
      style={substanceVars(primaryType, mode)}
      aria-label={name}
      className="perspective-card mx-auto w-full max-w-[300px]"
    >
      <div
        onClick={toggle}
        className="group relative aspect-[3/4.08] w-full cursor-pointer select-none rounded-[24px]"
      >
        <motion.div
          className="preserve-3d relative h-full w-full"
          initial={revealOnMount ? { rotateY: 180, scale: 0.92 } : false}
          animate={{ rotateY: flipped ? 180 : 0, scale: 1 }}
          whileTap={{ scale: 0.97 }}
          transition={{
            type: 'spring',
            stiffness: 220,
            damping: 22,
            mass: 0.9,
          }}
        >
          {/* FRONT FACE */}
          <div
            aria-hidden={flipped}
            inert={flipped || undefined}
            className="backface-hidden card-face-front absolute inset-0 flex flex-col overflow-hidden rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)]"
          >
            <button
              type="button"
              aria-pressed={flipped}
              aria-label={`${name} のパラメータを見る`}
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              className="backface-hidden absolute top-4 right-4 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-full border-2 border-[var(--attr-stroke)] bg-[var(--surface)] text-[var(--attr-ink)] transition-transform duration-200 group-hover:scale-110 group-hover:rotate-18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--attr-pop)]"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>

            <div className="h-[56%] p-2.5 pb-0">
              <div className="h-full w-full overflow-hidden rounded-[16px] bg-[var(--surface-sub)]">
                <img
                  src={imageUrl}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                />
              </div>
            </div>

            <div className="backface-hidden absolute top-[56%] right-2.5 z-10 h-[64px] w-[64px] -translate-y-1/2 -rotate-[7deg] transition-transform duration-250 ease-out group-hover:-translate-y-[54%] group-hover:rotate-[4deg] group-hover:scale-108">
              <RaritySticker tier={rarity} size="md" className="h-full w-full" />
            </div>

            <div className="flex flex-1 flex-col justify-between gap-2 px-4 pt-4 pb-3.5">
              <h2 className="pr-[62px] text-[21px] leading-[1.18] font-black tracking-tight text-[var(--fg)] [overflow-wrap:anywhere] [word-break:keep-all]">
                {name}
              </h2>

              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 rounded-full border-b-[2.5px] border-b-[var(--attr-pop-dark)] bg-[var(--attr-pop)] px-2.5 py-1 font-mono text-[10px] font-extrabold tracking-wide text-white uppercase">
                  {typeLabel}
                </span>
                <time className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-[var(--fg-muted)]">
                  {dateLabel}
                </time>
              </div>
            </div>
          </div>

          {/* BACK FACE */}
          <div
            aria-hidden={!flipped}
            inert={!flipped || undefined}
            className="backface-hidden card-face-back absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] px-4 pt-4 pb-3.5"
          >
            <div className="flex items-center justify-between gap-2 border-b-2 border-[var(--surface-sub)] pb-2.5">
              <span className="truncate text-[16px] font-black tracking-tight text-[var(--fg)]">
                {name}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="h-[32px] w-[32px] shrink-0 -rotate-[6deg]">
                  <RaritySticker tier={rarity} size="sm" className="h-full w-full" />
                </div>
                <button
                  type="button"
                  aria-pressed={flipped}
                  aria-label={`${name} の表面を見る`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle();
                  }}
                  className="grid h-7 w-7 cursor-pointer place-items-center rounded-full border-2 border-[var(--attr-stroke)] bg-[var(--surface-sub)] text-[var(--attr-ink)] transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--attr-pop)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.4} />
                </button>
              </div>
            </div>

            <div className="my-auto flex flex-col gap-2.5 py-2">
              {STAT_SPECS.map((spec, idx) => (
                <PopStatMeter
                  key={spec.key}
                  en={spec.en}
                  ja={spec.ja}
                  value={stats[spec.key]}
                  color={spec.color}
                  animate={flipped}
                  delay={0.11 + idx * 0.05}
                />
              ))}
            </div>

            <div className="flex items-center justify-between border-t-2 border-[var(--surface-sub)] pt-2.5 font-mono text-[9.5px] font-bold text-[var(--fg-muted)] uppercase">
              <span>{typeLabel}</span>
              <time className="tabular-nums">{dateLabel}</time>
            </div>
          </div>
        </motion.div>
      </div>
    </article>
  );
}
