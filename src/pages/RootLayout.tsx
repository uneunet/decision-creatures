import { Link, Outlet, useMatch, useNavigate } from '@tanstack/react-router';
import {
  Download,
  Info,
  LayoutGrid,
  Menu,
  Moon,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { RaritySticker } from '../components/RaritySticker';
import { useCollectionStore } from '../store/useCollectionStore';
import { useInferenceStore } from '../store/useInferenceStore';
import { useThemeStore } from '../store/useThemeStore';
import {
  PopButton,
  PopDialog,
  PopMenu,
  PopProgress,
  PopToggle,
  PopToggleGroup,
} from '../ui/primitives';
import { formatLoadStageLabel, RARITY_LIST, RARITY_THEME } from '../ui/theme';

const PIXEL_PRESETS = [
  { label: '128', pixels: 131_072 },
  { label: '256', pixels: 262_144 },
  { label: '512', pixels: 524_288 },
] as const;

function formatMB(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export function RootLayout() {
  const {
    status,
    progress,
    error,
    webgpuSupported,
    webgpuAdapter,
    initMs,
    cached,
    cacheAvailable,
    maxPixels,
    setMaxPixels,
    checkCache,
    init,
    clearCache,
  } = useInferenceStore();

  const { items, loaded, load } = useCollectionStore();
  const { mode, toggle: toggleTheme, setActiveSubstance } = useThemeStore();

  const navigate = useNavigate();
  const detailMatch = useMatch({ from: '/creatures/$id', shouldThrow: false });
  const scanMatch = useMatch({ from: '/scan', shouldThrow: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
    void checkCache();
  }, [loaded, load, checkCache]);

  // Sync active substance CSS variables onto <html> so Portals & Header inherit it
  const detailId = detailMatch?.params.id;
  const detailCreature = detailId ? items.find((c) => c.id === detailId) : undefined;
  const isScanRoute = Boolean(scanMatch);

  useEffect(() => {
    if (detailCreature) {
      setActiveSubstance(detailCreature.primaryType);
    } else if (!isScanRoute) {
      setActiveSubstance(null);
    }
  }, [detailCreature, isScanRoute, setActiveSubstance]);

  const loadPct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : null;

  const modelBadge =
    status === 'loading'
      ? 'LOADING'
      : status === 'ready'
        ? 'READY'
        : cacheAvailable
          ? 'CACHED'
          : 'IDLE';

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-[var(--attr-pastel)] text-[var(--fg)] transition-colors duration-200">
        {/* Fixed Header: Logo + ≡ Menu across all screens */}
        <header className="sticky top-0 z-30 border-b-2 border-[var(--attr-stroke)] bg-[var(--surface)] transition-colors duration-200">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
            <Link
              to="/"
              className="flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--attr-pop)]"
            >
              <BrandMark className="h-7 w-7 shrink-0" dynamic />
              <span className="text-[15.5px] font-extrabold tracking-tight text-[var(--fg)]">
                decision-creatures
              </span>
            </Link>

            <PopMenu.Root>
              <PopMenu.Trigger
                render={
                  <PopButton variant="ghost" size="icon" aria-label="メニュー">
                    <Menu className="h-[18px] w-[18px]" strokeWidth={2.4} />
                  </PopButton>
                }
              />
              <PopMenu.Portal>
                <PopMenu.Positioner sideOffset={8} align="end">
                  <PopMenu.Popup>
                    <PopMenu.Item onClick={() => void navigate({ to: '/' })}>
                      <span className="inline-flex items-center gap-2">
                        <LayoutGrid className="h-3.5 w-3.5" />
                        <span>コレクション</span>
                      </span>
                      <span className="rounded-full bg-[var(--surface-sub)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
                        {items.length}
                      </span>
                    </PopMenu.Item>
                    <PopMenu.Item onClick={() => void navigate({ to: '/scan' })}>
                      <span className="inline-flex items-center gap-2">
                        <ScanLine className="h-3.5 w-3.5" />
                        <span>スキャン</span>
                      </span>
                      <span className="rounded-full bg-[var(--surface-sub)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
                        +
                      </span>
                    </PopMenu.Item>
                    <PopMenu.Separator />
                    <PopMenu.Item onClick={toggleTheme}>
                      <span className="inline-flex items-center gap-2">
                        {mode === 'dark' ? (
                          <Moon className="h-3.5 w-3.5" />
                        ) : (
                          <Sun className="h-3.5 w-3.5" />
                        )}
                        <span>テーマ切替</span>
                      </span>
                      <span className="rounded-full bg-[var(--surface-sub)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-muted)] uppercase">
                        {mode}
                      </span>
                    </PopMenu.Item>
                    <PopMenu.Item onClick={() => setSettingsOpen(true)}>
                      <span className="inline-flex items-center gap-2">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        <span>モデル設定</span>
                      </span>
                      <span className="rounded-full bg-[var(--surface-sub)] px-2 py-0.5 font-mono text-[10px] text-[var(--fg-muted)]">
                        {modelBadge}
                      </span>
                    </PopMenu.Item>
                    <PopMenu.Item onClick={() => setAboutOpen(true)}>
                      <span className="inline-flex items-center gap-2">
                        <Info className="h-3.5 w-3.5" />
                        <span>このサイトについて</span>
                      </span>
                    </PopMenu.Item>
                  </PopMenu.Popup>
                </PopMenu.Positioner>
              </PopMenu.Portal>
            </PopMenu.Root>
          </div>
        </header>

        <div className="flex flex-1 flex-col">
          <Outlet />
        </div>

        <footer className="mx-auto flex w-full max-w-4xl items-center justify-center px-4 pt-1 pb-5">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-sub)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--attr-pop)]"
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2.3} />
            <span>ブラウザ内完結（画像送信なし） · しくみとレア度</span>
          </button>
        </footer>

        {/* About / Transparency Dialog */}
        <PopDialog.Root open={aboutOpen} onOpenChange={setAboutOpen}>
          <PopDialog.Content>
            <div className="flex items-center justify-between gap-2 border-b-2 border-[var(--surface-sub)] pb-3">
              <PopDialog.Title>
                <Info className="h-4 w-4" />
                <span>decision-creatures とは</span>
              </PopDialog.Title>
              <PopDialog.Close
                render={
                  <PopButton variant="ghost" size="icon" aria-label="閉じる">
                    <X className="h-4 w-4" />
                  </PopButton>
                }
              />
            </div>

            <div className="mt-4 flex flex-col gap-3.5">
              <section className="flex flex-col gap-1.5 rounded-2xl bg-[var(--surface-sub)] p-3.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-black text-[var(--fg)]">
                  <ScanLine className="h-3.5 w-3.5" />
                  <span>何をしているサイト？</span>
                </div>
                <p className="text-[11.5px] leading-relaxed font-bold text-[var(--fg-muted)]">
                  身近な写真をブラウザ内蔵の AI（WebGPU）で 11 の観点（材質・生息域・大きさ・重さ・強さ・速さ・神秘性など）から解析し、タイプとステータスを持ったクリーチャーカードを生成・保存する図鑑アプリです。
                </p>
              </section>

              <section className="flex flex-col gap-2 rounded-2xl bg-[var(--surface-sub)] p-3.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-black text-[var(--fg)]">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>レア度（C / U / R / E / M）の意味</span>
                </div>
                <div className="flex flex-col gap-2 rounded-xl bg-[var(--surface)] px-2 py-2.5">
                  <div className="grid grid-cols-5 gap-1">
                    {RARITY_LIST.map((tier) => {
                      const label = RARITY_THEME[tier].label;
                      const displayName = label.charAt(0) + label.slice(1).toLowerCase();
                      return (
                        <div key={tier} className="flex flex-col items-center gap-0.5">
                          <RaritySticker tier={tier} size="sm" className="h-7 w-7" />
                          <span className="text-[9.5px] leading-tight font-extrabold text-[var(--fg-muted)]">
                            {displayName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between px-1 text-[10px] font-extrabold text-[var(--fg-muted)]">
                    <span>← 定番（迷い小）</span>
                    <span>未知（迷い大）→</span>
                  </div>
                </div>
                <p className="text-[11.5px] leading-relaxed font-bold text-[var(--fg-muted)]">
                  ランダムなガチャではなく、AI がその写真の判定にどれだけ「迷ったか」（予測不確実度）で決まります。典型的な被写体ほど C / U に、複数の性質が混ざる不思議な被写体や珍しい構図ほど R / E / M になりやすくなります。
                </p>
              </section>

              <section className="flex flex-col gap-1.5 rounded-2xl bg-[var(--surface-sub)] p-3.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-black text-[var(--fg)]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>すべてローカルで完結</span>
                </div>
                <p className="text-[11.5px] leading-relaxed font-bold text-[var(--fg-muted)]">
                  写真の解析はすべてお使いの端末の GPU 上で実行され、画像が外部サーバーへ送信されることはありません。作成したカード・写真・AI モデル（初回のみ約 200 MB）もすべてブラウザ内（IndexedDB / OPFS）に保存されます。
                </p>
              </section>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[10.5px] leading-snug font-bold text-[var(--fg-muted)]">
                  Built with LiquidAI/d1-2B
                  <br />
                  LFM Open License v1.0
                </span>
                <PopButton
                  variant="surface"
                  size="sm"
                  onClick={() => {
                    setAboutOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>モデル設定</span>
                </PopButton>
              </div>
            </div>
          </PopDialog.Content>
        </PopDialog.Root>

        {/* Model Settings & License Dialog */}
        <PopDialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopDialog.Content>
            <div className="flex items-center justify-between gap-2 border-b-2 border-[var(--surface-sub)] pb-3">
              <PopDialog.Title>
                <SlidersHorizontal className="h-4 w-4" />
                <span>モデル設定・詳細</span>
              </PopDialog.Title>
              <PopDialog.Close
                render={
                  <PopButton variant="ghost" size="icon" aria-label="閉じる">
                    <X className="h-4 w-4" />
                  </PopButton>
                }
              />
            </div>

            <div className="mt-4 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-extrabold text-[var(--fg-muted)]">テーマ</span>
                <PopButton variant="surface" size="sm" onClick={toggleTheme}>
                  {mode === 'dark' ? (
                    <Moon className="h-3.5 w-3.5" />
                  ) : (
                    <Sun className="h-3.5 w-3.5" />
                  )}
                  <span>{mode === 'dark' ? 'ダーク' : 'ライト'}</span>
                </PopButton>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-extrabold text-[var(--fg-muted)]">画像トークン上限</span>
                <PopToggleGroup
                  value={[String(maxPixels)]}
                  onValueChange={(values) => {
                    const next = Number(values[0]);
                    if (Number.isFinite(next) && next > 0) {
                      setMaxPixels(next);
                    }
                  }}
                >
                  {PIXEL_PRESETS.map((p) => (
                    <PopToggle key={p.pixels} value={String(p.pixels)}>
                      {p.label}
                    </PopToggle>
                  ))}
                </PopToggleGroup>
              </div>

              <div className="flex flex-col gap-1 rounded-2xl bg-[var(--surface-sub)] p-3 font-mono text-[11px] font-bold">
                <div className="text-[var(--fg)]">LiquidAI/d1-2B Vision (q8) + Distilled Head · 11Q</div>
                <div className="text-[var(--fg-muted)]">
                  WebGPU: {webgpuSupported ? (webgpuAdapter ?? '対応') : '非対応'}
                </div>
                <div className="text-[var(--fg-muted)]">
                  キャッシュ: {cacheAvailable ? '保存済み (約 200 MB)' : '未保存'}
                  {initMs !== null ? ` · ${initMs}ms ${cached ? '(cache)' : '(net)'}` : ''}
                </div>
              </div>

              {status === 'loading' && (
                <PopProgress
                  value={progress?.stage === 'downloading' ? loadPct : null}
                  label={formatLoadStageLabel(progress)}
                  detail={
                    progress?.stage === 'downloading' &&
                    progress.totalBytes > 0 &&
                    loadPct !== null
                      ? `${formatMB(progress.loadedBytes)} / ${formatMB(progress.totalBytes)} (${loadPct}%)`
                      : undefined
                  }
                />
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-2xl border-2 border-[#ffbac8] border-b-[4px] border-b-[#ff8da3] bg-[#ffe4ea] px-3.5 py-2.5 font-mono text-[11px] font-bold text-[#7a1c2e] dark:border-[#a1344d] dark:border-b-[#6e1e31] dark:bg-[#211317] dark:text-[#ffbac8]"
                >
                  [{error.code}] {error.message}
                </div>
              )}

              <p className="text-[11px] leading-relaxed font-bold text-[var(--fg-muted)]">
                Built with LiquidAI/d1-2B under LFM Open License v1.0.
                画像の解析とデータ保存はすべてブラウザ内で完結します。
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                {status === 'idle' || status === 'error' ? (
                  <PopButton
                    variant="primary"
                    size="sm"
                    disabled={!webgpuSupported}
                    onClick={() => {
                      void init();
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>モデル読込</span>
                  </PopButton>
                ) : (
                  <PopButton
                    variant="danger"
                    size="sm"
                    disabled={status === 'loading' || status === 'analyzing'}
                    onClick={clearCache}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>キャッシュ削除</span>
                  </PopButton>
                )}
              </div>
            </div>
          </PopDialog.Content>
        </PopDialog.Root>
      </div>
    </MotionConfig>
  );
}
