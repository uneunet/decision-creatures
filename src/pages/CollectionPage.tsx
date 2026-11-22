import { useNavigate, useSearch } from '@tanstack/react-router';
import { Camera, ImagePlus, ScanLine, SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BrandMark } from '../components/BrandMark';
import { RaritySticker } from '../components/RaritySticker';
import type { RarityTier, SubstanceType } from '../inference/types';
import type { CollectionSortKey } from '../router';
import { useCollectionStore } from '../store/useCollectionStore';
import { useInferenceStore } from '../store/useInferenceStore';
import { useThemeStore } from '../store/useThemeStore';
import { PopButton, PopFilterGroup, PopFilterItem, PopPopover } from '../ui/primitives';
import {
  RARITY_LIST,
  RARITY_THEME,
  SUBSTANCE_LIST,
  SUBSTANCE_THEME,
  substanceVars,
  totalCreatureStats,
} from '../ui/theme';

const SORT_LABELS: Record<CollectionSortKey, string> = {
  newest: '新着',
  rarity: 'レア度',
  total: '強さ',
};

export function CollectionPage() {
  const { items, loaded, imageUrls, lastAddedId, clearLastAdded } = useCollectionStore();
  const setPendingScanBlob = useInferenceStore((s) => s.setPendingScanBlob);
  const mode = useThemeStore((s) => s.mode);
  const navigate = useNavigate();
  const search = useSearch({ from: '/' });
  const emptyFileInputRef = useRef<HTMLInputElement>(null);
  const emptyCameraInputRef = useRef<HTMLInputElement>(null);

  const filterType = search.type ?? null;
  const filterRarity = search.rarity ?? null;
  const sort: CollectionSortKey = search.sort ?? 'newest';

  useEffect(() => {
    if (!lastAddedId) return;
    const t = setTimeout(() => clearLastAdded(), 900);
    return () => clearTimeout(t);
  }, [lastAddedId, clearLastAdded]);

  const handoffToScan = useCallback(
    (blob: Blob) => {
      setPendingScanBlob(blob);
      void navigate({ to: '/scan' });
    },
    [setPendingScanBlob, navigate],
  );

  // Direct paste support on 0-item empty state
  useEffect(() => {
    if (!loaded || items.length > 0) return;
    const onPaste = (e: ClipboardEvent) => {
      const list = e.clipboardData?.items;
      if (!list) return;
      for (const item of list) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            handoffToScan(blob);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loaded, items.length, handoffToScan]);

  const setSearch = (patch: Partial<{ type?: SubstanceType; rarity?: RarityTier; sort?: CollectionSortKey }>) => {
    const next = {
      type: 'type' in patch ? patch.type : search.type,
      rarity: 'rarity' in patch ? patch.rarity : search.rarity,
      sort: 'sort' in patch ? patch.sort : search.sort,
    };
    if (next.sort === 'newest') delete next.sort;
    void navigate({ to: '/', search: next, replace: true });
  };

  const filtered = useMemo(() => {
    let list = items;
    if (filterType) list = list.filter((c) => c.primaryType === filterType);
    if (filterRarity) list = list.filter((c) => c.rarityTier === filterRarity);
    const copy = list.slice();
    if (sort === 'rarity') {
      copy.sort(
        (a, b) =>
          RARITY_THEME[b.rarityTier].rank - RARITY_THEME[a.rarityTier].rank ||
          b.createdAt - a.createdAt,
      );
    } else if (sort === 'total') {
      copy.sort(
        (a, b) =>
          totalCreatureStats(b.stats) - totalCreatureStats(a.stats) ||
          b.createdAt - a.createdAt,
      );
    } else {
      copy.sort((a, b) => b.createdAt - a.createdAt);
    }
    return copy;
  }, [items, filterType, filterRarity, sort]);

  if (!loaded) {
    return <main className="flex flex-1 items-center justify-center p-8" />;
  }

  // 0-item Empty State: inviting S1 card onboarding (pick / camera / drop / paste → /scan crop)
  if (items.length === 0) {
    return (
      <main
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) {
            handoffToScan(file);
          }
        }}
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-6"
      >
        <input
          ref={emptyFileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handoffToScan(file);
            e.target.value = '';
          }}
        />
        <input
          ref={emptyCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handoffToScan(file);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => emptyFileInputRef.current?.click()}
          aria-label="写真を選んで最初のカードをスキャンする"
          className="group flex aspect-[3/4.08] w-full max-w-[300px] cursor-pointer flex-col gap-3 overflow-hidden rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] p-2.5 text-left transition-transform duration-150 active:translate-y-[2px]"
        >
          <div className="flex h-[56%] w-full flex-col items-center justify-center gap-2.5 rounded-[16px] border-2 border-dashed border-[var(--attr-stroke)] bg-[var(--surface-sub)] transition-colors group-hover:border-[var(--attr-lip)]">
            <BrandMark
              className="h-16 w-16 transition-transform duration-150 group-hover:-translate-y-0.5"
              dynamic
            />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-3 py-1 text-[11px] font-extrabold text-[var(--fg-muted)]">
              <ImagePlus className="h-3.5 w-3.5" strokeWidth={2.3} />
              <span>タップ · ドロップ · 貼付</span>
            </span>
          </div>

          <div className="flex flex-1 flex-col justify-center gap-1.5 px-2 pb-1 text-center">
            <h1 className="text-[17px] leading-snug font-black tracking-tight text-[var(--fg)]">
              まずはスキャンしてみよう！
            </h1>
            <p className="text-xs leading-relaxed font-bold text-[var(--fg-muted)]">
              身近な写真をクリーチャーカードにして図鑑に集めよう
            </p>
          </div>
        </button>

        <div className="flex w-full max-w-[300px] items-center justify-center gap-2.5">
          <PopButton
            variant="primary"
            size="md"
            className="flex-1"
            onClick={() => emptyFileInputRef.current?.click()}
          >
            <ScanLine className="h-4 w-4" />
            <span>写真を選ぶ</span>
          </PopButton>
          <PopButton
            variant="surface"
            size="md"
            onClick={() => emptyCameraInputRef.current?.click()}
          >
            <Camera className="h-4 w-4" />
            <span>カメラ</span>
          </PopButton>
        </div>
      </main>
    );
  }

  const hasSubFilter = Boolean(filterRarity || sort !== 'newest');
  const activeRarityTheme = filterRarity ? RARITY_THEME[filterRarity] : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3.5 px-4 pt-4 pb-24">
      {/* 1-Row Attribute Pills (Base UI ToggleGroup) + Right Filter/Sort Popover */}
      <div className="flex items-center gap-2">
        <PopFilterGroup
          aria-label="属性フィルタ"
          value={[filterType ?? 'all']}
          onValueChange={(values) => {
            const picked = values[0];
            if (!picked || picked === 'all') {
              setSearch({ type: undefined });
            } else {
              setSearch({ type: picked as SubstanceType });
            }
          }}
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5"
        >
          <PopFilterItem
            value="all"
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-2 border-[var(--attr-stroke)] border-b-[3.5px] border-b-[var(--attr-lip)] bg-[var(--surface)] px-3 font-mono text-[10px] font-extrabold text-[var(--fg)] transition-transform active:translate-y-[1px] data-[pressed]:border-[#111115] data-[pressed]:bg-[#1f2026] data-[pressed]:text-white dark:data-[pressed]:border-white/70 dark:data-[pressed]:bg-white dark:data-[pressed]:text-[#15161b]"
          >
            ALL
          </PopFilterItem>

          {SUBSTANCE_LIST.map((sub) => {
            const theme = SUBSTANCE_THEME[sub];
            const active = filterType === sub;
            return (
              <PopFilterItem
                key={sub}
                value={sub}
                style={
                  active
                    ? {
                        backgroundColor: theme.pop,
                        borderColor: theme.popDark,
                      }
                    : undefined
                }
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-2 border-[var(--attr-stroke)] border-b-[3.5px] border-b-[var(--attr-lip)] bg-[var(--surface)] px-3 font-mono text-[10px] font-extrabold text-[var(--fg)] transition-transform active:translate-y-[1px] data-[pressed]:text-white"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: active ? '#ffffff' : theme.pop }}
                />
                {theme.label}
              </PopFilterItem>
            );
          })}
        </PopFilterGroup>

        <PopPopover.Root>
          <PopPopover.Trigger
            aria-label={
              activeRarityTheme
                ? `並び替え・絞り込み（${activeRarityTheme.label}・${SORT_LABELS[sort]}）`
                : `並び替え・絞り込み（${SORT_LABELS[sort]}）`
            }
            className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border-2 border-b-[3.5px] px-2.5 text-[11px] font-extrabold transition-transform active:translate-y-[1px] ${
              hasSubFilter
                ? 'border-[var(--attr-pop)] border-b-[var(--attr-pop-dark)] bg-[var(--surface)] text-[var(--attr-pop)]'
                : 'border-[var(--attr-stroke)] border-b-[var(--attr-lip)] bg-[var(--surface)] text-[var(--fg)]'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {activeRarityTheme && (
              <span
                className="grid h-4 w-4 place-items-center rounded-full font-mono text-[9px] font-black text-white"
                style={{ backgroundColor: activeRarityTheme.bg }}
              >
                {activeRarityTheme.initial}
              </span>
            )}
            <span>{SORT_LABELS[sort]}</span>
          </PopPopover.Trigger>
          <PopPopover.Portal>
            <PopPopover.Positioner sideOffset={8} align="end">
              <PopPopover.Popup className="flex w-60 flex-col gap-3">
                <div>
                  <div className="mb-1.5 font-mono text-[10px] font-extrabold text-[var(--fg-muted)]">
                    RARITY
                  </div>
                  <PopFilterGroup
                    aria-label="レア度フィルタ"
                    value={[filterRarity ?? 'all']}
                    onValueChange={(values) => {
                      const picked = values[0];
                      if (!picked || picked === 'all') {
                        setSearch({ rarity: undefined });
                      } else {
                        setSearch({ rarity: picked as RarityTier });
                      }
                    }}
                    className="flex flex-wrap gap-1.5"
                  >
                    <PopFilterItem
                      value="all"
                      aria-label="全レア度"
                      className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-[var(--attr-stroke)] bg-[var(--surface-sub)] font-mono text-[11px] font-black text-[var(--fg)] data-[pressed]:border-[#111] data-[pressed]:bg-[#1f2026] data-[pressed]:text-white dark:data-[pressed]:border-white dark:data-[pressed]:bg-white dark:data-[pressed]:text-[#15161b]"
                    >
                      全
                    </PopFilterItem>
                    {RARITY_LIST.map((tier) => {
                      const rt = RARITY_THEME[tier];
                      const active = filterRarity === tier;
                      return (
                        <PopFilterItem
                          key={tier}
                          value={tier}
                          aria-label={rt.label}
                          style={
                            active
                              ? { backgroundColor: rt.bg, borderColor: rt.dark }
                              : undefined
                          }
                          className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-[var(--attr-stroke)] bg-[var(--surface-sub)] font-mono text-[11px] font-black text-[var(--fg)] data-[pressed]:text-white"
                        >
                          {rt.initial}
                        </PopFilterItem>
                      );
                    })}
                  </PopFilterGroup>
                </div>

                <div>
                  <div className="mb-1.5 font-mono text-[10px] font-extrabold text-[var(--fg-muted)]">
                    SORT
                  </div>
                  <PopFilterGroup
                    aria-label="並び替え"
                    value={[sort]}
                    onValueChange={(values) => {
                      const picked = values[0] as CollectionSortKey | undefined;
                      if (picked) setSearch({ sort: picked });
                    }}
                    className="grid grid-cols-3 gap-1.5"
                  >
                    {(['newest', 'rarity', 'total'] as const).map((key) => (
                      <PopFilterItem
                        key={key}
                        value={key}
                        className="h-7 cursor-pointer rounded-lg border-2 border-[var(--attr-stroke)] bg-[var(--surface-sub)] text-[11px] font-extrabold text-[var(--fg)] data-[pressed]:border-[var(--attr-pop-dark)] data-[pressed]:bg-[var(--attr-pop)] data-[pressed]:text-white"
                      >
                        {SORT_LABELS[key]}
                      </PopFilterItem>
                    ))}
                  </PopFilterGroup>
                </div>
              </PopPopover.Popup>
            </PopPopover.Positioner>
          </PopPopover.Portal>
        </PopPopover.Root>
      </div>

      {/* Compact S1 Card Grid (2 col mobile / 3 col sm / 4 col lg) */}
      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-16 font-mono text-xs font-extrabold text-[var(--fg-muted)]">
          0 MATCHES
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {filtered.map((creature) => {
            const sub = SUBSTANCE_THEME[creature.primaryType];
            const vars = substanceVars(creature.primaryType, mode);
            const imgUrl = imageUrls[creature.id];
            const isJustAdded = lastAddedId === creature.id;

            return (
              <motion.button
                key={creature.id}
                type="button"
                style={vars}
                initial={isJustAdded ? { scale: 0.86, opacity: 0.3 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                onClick={() =>
                  void navigate({ to: '/creatures/$id', params: { id: creature.id } })
                }
                className="group relative flex aspect-[3/3.88] w-full cursor-pointer flex-col overflow-hidden rounded-[20px] border-2 border-[var(--attr-stroke)] border-b-[5px] border-b-[var(--attr-lip)] bg-[var(--surface)] text-left transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-[2px]"
              >
                <div className="h-[62%] p-1.5 pb-0">
                  <div className="h-full w-full overflow-hidden rounded-[13px] bg-[var(--attr-pastel)]">
                    {imgUrl && (
                      <img
                        src={imgUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    )}
                  </div>
                </div>

                <div className="absolute top-[62%] right-1.5 z-10 h-10 w-10 -translate-y-1/2 -rotate-[7deg]">
                  <RaritySticker tier={creature.rarityTier} size="sm" className="h-full w-full" />
                </div>

                <div className="flex flex-1 flex-col justify-between gap-1 px-2.5 pt-2.5 pb-2">
                  <div className="line-clamp-2 pr-6 text-[13.5px] leading-[1.2] font-black tracking-tight text-[var(--fg)] [overflow-wrap:anywhere] [word-break:keep-all]">
                    {creature.name}
                  </div>
                  <span
                    className="self-start rounded-full border-b-[2px] px-2 py-0.5 font-mono text-[8.5px] font-extrabold text-white uppercase"
                    style={{
                      backgroundColor: sub.pop,
                      borderBottomColor: sub.popDark,
                    }}
                  >
                    {sub.label}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Floating Bottom + Scan FAB */}
      <div className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2">
        <button
          type="button"
          onClick={() => void navigate({ to: '/scan' })}
          className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border-2 border-[#0f8ac7] border-b-[5px] bg-[#1cb0f6] px-5 text-sm font-black text-white ring-4 ring-[var(--attr-pastel)] transition-transform duration-100 active:translate-y-[2px] active:border-b-2"
        >
          <ScanLine className="h-4.5 w-4.5" strokeWidth={2.4} />
          <span>スキャン</span>
        </button>
      </div>
    </main>
  );
}
