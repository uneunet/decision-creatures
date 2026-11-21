import { motion } from 'motion/react';
import { useCallback, useRef } from 'react';
import type { RarityTier, SubstanceType } from './inference/types';
import { useInferenceStore } from './store/useInferenceStore';

const RARITY_STYLES: Record<RarityTier, string> = {
  common: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  uncommon: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300',
  rare: 'border-sky-500/50 bg-sky-950/50 text-sky-300',
  epic: 'border-violet-500/60 bg-violet-950/60 text-violet-300',
  mythic: 'border-amber-400/70 bg-amber-950/60 text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.2)]',
};

const SUBSTANCE_ACCENTS: Record<SubstanceType, string> = {
  flesh: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  botanical: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  metal: 'bg-slate-400/20 text-slate-200 border-slate-400/40',
  stone: 'bg-amber-700/25 text-amber-200 border-amber-600/40',
  liquid: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40',
  fabric: 'bg-pink-400/20 text-pink-200 border-pink-400/40',
  energy: 'bg-violet-500/20 text-violet-200 border-violet-400/40',
};

const PIXEL_PRESETS = [
  { label: '256 tok', pixels: 262_144 },
  { label: '512 tok', pixels: 524_288 },
  { label: '1024 tok', pixels: 1_048_576 },
];

function formatMB(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export function App() {
  const {
    status,
    progress,
    webgpuAdapter,
    initMs,
    cached,
    error,
    imageUrl,
    analysis,
    maxPixels,
    setMaxPixels,
    init,
    analyzeFile,
    clearCache,
  } = useInferenceStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) {
        void analyzeFile(file);
      }
    },
    [analyzeFile],
  );

  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-semibold tracking-tight text-zinc-100">
            decision-creatures
          </h1>
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 font-mono text-xs text-zinc-400">
            d1-2B · q4f16 · 11Q
          </span>
          {webgpuAdapter && (
            <span className="hidden font-mono text-xs text-zinc-500 sm:inline">
              {webgpuAdapter}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 font-mono text-xs">
            {PIXEL_PRESETS.map((p) => (
              <button
                key={p.pixels}
                type="button"
                onClick={() => setMaxPixels(p.pixels)}
                className={`rounded-md px-2 py-1 transition ${
                  maxPixels === p.pixels
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {status === 'idle' || status === 'error' ? (
            <button
              type="button"
              onClick={() => void init()}
              className="rounded-lg bg-zinc-100 px-3.5 py-1.5 font-mono text-xs font-medium text-zinc-950 transition hover:bg-white"
            >
              Load Model
            </button>
          ) : (
            <button
              type="button"
              onClick={clearCache}
              disabled={status === 'loading' || status === 'analyzing'}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40"
            >
              Clear Cache
            </button>
          )}
        </div>
      </header>

      {status === 'loading' && progress && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="mb-2 flex items-center justify-between font-mono text-xs text-zinc-300">
            <span>
              {progress.stage}
              {progress.file ? ` · ${progress.file}` : ''}
              {progress.fromCache ? ' (cache)' : ''}
            </span>
            {progress.stage === 'downloading' && progress.totalBytes > 0 && (
              <span>
                {formatMB(progress.loadedBytes)} / {formatMB(progress.totalBytes)} ({pct}%)
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <motion.div
              className="h-full bg-emerald-400"
              initial={{ width: 0 }}
              animate={{ width: progress.stage === 'downloading' ? `${pct}%` : '100%' }}
              transition={{ duration: 0.2 }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 font-mono text-xs text-red-200">
          [{error.code}] {error.message}
        </div>
      )}

      <main className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="flex flex-col gap-4 lg:col-span-5">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="group relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/50 transition hover:border-zinc-500"
          >
            {imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt="Scanned subject"
                  className="h-full w-full object-cover"
                />
                {status === 'analyzing' && (
                  <motion.div
                    className="pointer-events-none absolute inset-x-0 h-1 bg-emerald-400/90 shadow-[0_0_20px_rgba(52,211,153,0.9)]"
                    initial={{ top: '0%' }}
                    animate={{ top: ['0%', '100%', '0%'] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 font-mono text-xs text-zinc-500">
                <span className="text-2xl text-zinc-600 transition group-hover:text-zinc-300">+</span>
                <span>Drop / Select Image</span>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void analyzeFile(file);
              }}
            />
          </div>

          {analysis && (
            <div className="grid grid-cols-4 gap-2 font-mono text-xs">
              <MetricPill label="PRE" value={`${analysis.metrics.preprocessMs}ms`} />
              <MetricPill label="VIS" value={`${analysis.metrics.visionMs}ms`} />
              <MetricPill label="DEC" value={`${analysis.metrics.decoderMs}ms`} />
              <MetricPill
                label="TOK"
                value={`${analysis.metrics.imageTokens}/${analysis.metrics.totalTokens}`}
              />
            </div>
          )}

          {status === 'ready' && initMs !== null && !analysis && (
            <div className="font-mono text-xs text-zinc-500">
              ready · {initMs}ms {cached ? '(cached)' : '(fetched)'}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-5 lg:col-span-7">
          {analysis ? (
            <>
              <motion.div
                key={imageUrl}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-lg border px-3 py-1 font-mono text-sm font-semibold uppercase ${
                        SUBSTANCE_ACCENTS[analysis.primaryType.id]
                      }`}
                    >
                      {analysis.primaryType.id}
                      <span className="ml-1.5 opacity-60">
                        {Math.round(analysis.primaryType.probability * 100)}%
                      </span>
                    </span>
                    {analysis.secondaryType && (
                      <span
                        className={`rounded-lg border px-2.5 py-1 font-mono text-xs uppercase ${
                          SUBSTANCE_ACCENTS[analysis.secondaryType.id]
                        }`}
                      >
                        {analysis.secondaryType.id}{' '}
                        <span className="opacity-60">
                          {Math.round(analysis.secondaryType.probability * 100)}%
                        </span>
                      </span>
                    )}
                    <span className="rounded-lg border border-zinc-700/80 bg-zinc-950 px-2.5 py-1 font-mono text-xs uppercase text-zinc-200">
                      {analysis.biome.id}
                    </span>
                    <span className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 font-mono text-xs uppercase text-zinc-400">
                      {analysis.archetype.id}
                    </span>
                    <span className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 font-mono text-xs uppercase text-zinc-500">
                      {analysis.sizeClass.id}
                    </span>
                  </div>

                  <div
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1 font-mono text-xs font-semibold ${
                      RARITY_STYLES[analysis.rarity.tier]
                    }`}
                  >
                    <span>{analysis.rarity.label}</span>
                    <span className="opacity-70">
                      H={(analysis.rarity.uncertainty * 100).toFixed(0)}
                    </span>
                  </div>
                </div>

                {/* 5 Combat Stats */}
                <div className="mt-5 grid grid-cols-5 gap-3">
                  {(
                    [
                      ['HP', analysis.stats.hp, 'bg-emerald-400'],
                      ['ATK', analysis.stats.atk, 'bg-rose-400'],
                      ['DEF', analysis.stats.def, 'bg-sky-400'],
                      ['SPD', analysis.stats.spd, 'bg-amber-300'],
                      ['SP', analysis.stats.sp, 'bg-violet-400'],
                    ] as const
                  ).map(([label, value, color]) => (
                    <div key={label} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between font-mono">
                        <span className="text-[11px] text-zinc-500">{label}</span>
                        <span className="text-sm font-semibold text-zinc-100">{value}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <motion.div
                          className={`h-full ${color}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${value}%` }}
                          transition={{ duration: 0.35 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Physical & Uncertainty Telemetry */}
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-800/80 pt-3 font-mono text-[11px] text-zinc-500">
                  <span>size={analysis.traits.size.toFixed(2)}</span>
                  <span>mass={analysis.traits.mass.toFixed(2)}</span>
                  <span>density={analysis.traits.density.toFixed(2)}</span>
                  <span>warmth={analysis.traits.warmth.toFixed(2)}</span>
                  <span>living={analysis.traits.isLiving.toFixed(2)}</span>
                  <span>
                    peakH={analysis.rarity.mostUncertainQuestion.id}(
                    {analysis.rarity.mostUncertainQuestion.entropy.toFixed(2)})
                  </span>
                </div>
              </motion.div>

              {/* 11-Question Live Matrix */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {analysis.questions.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 font-mono text-xs"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-200">{q.id}</span>
                      <span className="text-[11px] text-zinc-500">
                        {q.expectedScalar !== null
                          ? `val=${q.expectedScalar.toFixed(2)} · `
                          : ''}
                        H={q.entropy.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {q.options
                        .map((opt, i) => ({ opt, p: q.probabilities[i]! }))
                        .sort((a, b) => b.p - a.p)
                        .slice(0, 3)
                        .map(({ opt, p }) => (
                          <div key={opt} className="flex items-center gap-2">
                            <span className="w-16 truncate text-[11px] text-zinc-400">{opt}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className="h-full bg-zinc-300/80"
                                style={{ width: `${Math.round(p * 100)}%` }}
                              />
                            </div>
                            <span className="w-9 text-right text-[11px] text-zinc-500">
                              {Math.round(p * 100)}%
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center rounded-2xl border border-zinc-800/60 bg-zinc-900/20 font-mono text-xs text-zinc-600">
              {status === 'analyzing' ? 'running single-forward pass...' : 'awaiting image'}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="text-zinc-200">{value}</div>
    </div>
  );
}
