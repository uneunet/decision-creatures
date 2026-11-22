import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Download,
  ImagePlus,
  LayoutGrid,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Share2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreatureCard } from '../components/CreatureCard';
import { RenameCreatureDialog, ShareCardDialog } from '../components/CreatureDialogs';
import {
  clampCropOffset,
  computeCropMetrics,
  cropAndCompressImage,
} from '../lib/image';
import { useCollectionStore } from '../store/useCollectionStore';
import { useInferenceStore } from '../store/useInferenceStore';
import { useThemeStore } from '../store/useThemeStore';
import { PopButton, PopProgress, PopSlider } from '../ui/primitives';
import { formatLoadStageLabel } from '../ui/theme';

type ScanStage = 'pick' | 'crop' | 'confirm' | 'analyzing' | 'revealed';

function formatMB(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

export function ScanPage() {
  const {
    status,
    progress,
    webgpuSupported,
    cacheAvailable,
    error,
    checkCache,
    analyzeFile,
    clearError,
    consumePendingScanBlob,
  } = useInferenceStore();

  const { items, imageUrls, addFromAnalysis, rename } = useCollectionStore();
  const setActiveSubstance = useThemeStore((s) => s.setActiveSubstance);
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);

  const [stage, setStage] = useState<ScanStage>('pick');
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: 276,
    h: 216,
  });
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropZoom, setCropZoom] = useState(1.0);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ pointerId: null, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    void checkCache();
  }, [checkCache]);

  // Single authoritative owner for revoking sourceUrl Object URLs (StrictMode safe)
  useEffect(() => {
    if (!sourceUrl) return;
    return () => {
      URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  const selectBlob = useCallback(
    (blob: Blob) => {
      clearError();
      setLocalError(null);
      setImgNatural(null);
      const nextUrl = URL.createObjectURL(blob);
      setSourceUrl(nextUrl);
      setCropX(0);
      setCropY(0);
      setCropZoom(1.0);
      setStage('crop');
    },
    [clearError],
  );

  // Pick up any image dropped/selected/pasted on `/` empty state
  useEffect(() => {
    const pending = consumePendingScanBlob();
    if (pending) {
      selectBlob(pending);
    }
  }, [consumePendingScanBlob, selectBlob]);

  // Keep crop viewport CSS dimensions synchronized with DOM
  useEffect(() => {
    const el = cropBoxRef.current;
    if (!el) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ w: rect.width, h: rect.height });
      }
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage]);

  const cropMetrics = useMemo(() => {
    if (!imgNatural) return null;
    return computeCropMetrics(
      imgNatural.w,
      imgNatural.h,
      viewportSize.w,
      viewportSize.h,
      cropZoom,
    );
  }, [imgNatural, viewportSize.w, viewportSize.h, cropZoom]);

  // Global clipboard paste support on /scan
  useEffect(() => {
    if (stage !== 'pick') return;
    const onPaste = (e: ClipboardEvent) => {
      const itemsList = e.clipboardData?.items;
      if (!itemsList) return;
      for (const item of itemsList) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            selectBlob(blob);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [stage, selectBlob]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (stage !== 'pick' && stage !== 'crop') return;
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) {
        selectBlob(file);
      }
    },
    [stage, selectBlob],
  );

  const executeScan = useCallback(async () => {
    if (!sourceUrl || starting) return;
    const rect = cropBoxRef.current?.getBoundingClientRect();
    const vw = rect?.width || viewportSize.w;
    const vh = rect?.height || viewportSize.h;

    setStarting(true);
    setLocalError(null);
    setStage('analyzing');
    try {
      const croppedBlob = await cropAndCompressImage(sourceUrl, {
        x: cropX,
        y: cropY,
        zoom: cropZoom,
        viewportWidth: vw,
        viewportHeight: vh,
      });

      const analysis = await analyzeFile(croppedBlob);
      if (!analysis) {
        setStage('crop');
        return;
      }

      const saved = await addFromAnalysis(analysis, croppedBlob);
      setRevealedId(saved.id);
      setFlipped(false);
      setStage('revealed');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'スキャンまたは保存に失敗しました');
      setStage('crop');
    } finally {
      setStarting(false);
    }
  }, [
    sourceUrl,
    starting,
    viewportSize.w,
    viewportSize.h,
    cropX,
    cropY,
    cropZoom,
    analyzeFile,
    addFromAnalysis,
  ]);

  const handleStartClick = useCallback(async () => {
    if (!webgpuSupported || starting || status === 'analyzing') return;
    setStarting(true);
    setLocalError(null);
    try {
      const isCached =
        status === 'ready' ||
        status === 'loading' ||
        cacheAvailable === true ||
        (await checkCache());
      if (!isCached) {
        setStage('confirm');
        return;
      }
    } finally {
      setStarting(false);
    }
    await executeScan();
  }, [webgpuSupported, starting, status, cacheAvailable, checkCache, executeScan]);

  const resetToPick = () => {
    clearError();
    setLocalError(null);
    setSourceUrl(null);
    setImgNatural(null);
    setRevealedId(null);
    setFlipped(false);
    setStage('pick');
  };

  const endDrag = (pointerId: number) => {
    if (dragRef.current.pointerId === pointerId) {
      dragRef.current.pointerId = null;
    }
  };

  const revealedCreature = revealedId ? items.find((c) => c.id === revealedId) : undefined;
  const revealedImageUrl = revealedCreature ? imageUrls[revealedCreature.id] : undefined;

  // Sync revealed creature attribute theme to <html> so Header, BrandMark, and Portals match
  useEffect(() => {
    if (stage === 'revealed' && revealedCreature) {
      setActiveSubstance(revealedCreature.primaryType);
    } else {
      setActiveSubstance(null);
    }
    return () => setActiveSubstance(null);
  }, [stage, revealedCreature, setActiveSubstance]);

  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : null;

  const handleZoomChange = (nextZoom: number) => {
    setCropZoom(nextZoom);
    if (!imgNatural) return;
    const nextMetrics = computeCropMetrics(
      imgNatural.w,
      imgNatural.h,
      viewportSize.w,
      viewportSize.h,
      nextZoom,
    );
    const clamped = clampCropOffset(cropX, cropY, nextMetrics.maxX, nextMetrics.maxY);
    setCropX(clamped.x);
    setCropY(clamped.y);
  };

  const displayError = localError
    ? localError
    : error
      ? `[${error.code}] ${error.message}`
      : null;

  return (
    <main
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--attr-pastel)] px-5 py-7 transition-colors duration-200"
    >
      {/* Hidden inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) selectBlob(f);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) selectBlob(f);
          e.target.value = '';
        }}
      />

      {!webgpuSupported && (
        <div
          role="alert"
          className="flex w-full max-w-[300px] items-start gap-2.5 rounded-2xl border-2 border-[#fbd685] border-b-[4px] border-b-[#f5be49] bg-[#fef3d6] px-4 py-3 text-xs font-extrabold text-[#6b4009] dark:border-[#9c6b19] dark:border-b-[#6b460d] dark:bg-[#1f1a10] dark:text-[#fbd685]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {typeof window !== 'undefined' && !window.isSecureContext
              ? 'HTTP 接続のため WebGPU を利用できません。HTTPS（または localhost）で開き直してください。'
              : 'このブラウザは WebGPU 非対応のためスキャンできません。Chrome / Edge / 対応 Safari をご利用ください。'}
          </span>
        </div>
      )}

      {displayError && (
        <div
          role="alert"
          className="w-full max-w-[300px] rounded-2xl border-2 border-[#ffbac8] border-b-[4px] border-b-[#ff8da3] bg-[#ffe4ea] px-4 py-3 font-mono text-xs font-bold text-[#7a1c2e] dark:border-[#a1344d] dark:border-b-[#6e1e31] dark:bg-[#211317] dark:text-[#ffbac8]"
        >
          {displayError}
        </div>
      )}

      {/* STAGE 1: PICK */}
      {stage === 'pick' && (
        <div className="flex w-full max-w-[300px] flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group flex aspect-[3/4.08] w-full cursor-pointer flex-col overflow-hidden rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] p-2.5 transition-transform duration-150 active:translate-y-[2px]"
          >
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[16px] border-2 border-dashed border-[var(--attr-stroke)] bg-[var(--surface-sub)] px-4 text-center transition-colors group-hover:border-[var(--attr-lip)]">
              <span className="grid h-14 w-14 place-items-center rounded-2xl border-2 border-[var(--attr-stroke)] border-b-[4px] border-b-[var(--attr-lip)] bg-[var(--surface)] text-[var(--fg)] transition-transform duration-150 group-hover:-translate-y-0.5">
                <ImagePlus className="h-6 w-6" strokeWidth={2.2} />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-black text-[var(--fg)]">写真を選ぶ</span>
                <span className="text-[11px] font-bold text-[var(--fg-muted)]">
                  ドロップ・貼り付け対応
                </span>
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2">
            <PopButton
              variant="surface"
              size="sm"
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera className="h-3.5 w-3.5" />
              <span>カメラ</span>
            </PopButton>
            <PopButton
              variant="surface"
              size="sm"
              onClick={() => void navigate({ to: '/' })}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>コレクションへ</span>
            </PopButton>
          </div>
        </div>
      )}

      {/* STAGE 2 / 3 / 4: CROP / CONFIRM / ANALYZING (Inside S1 Card Frame) */}
      {(stage === 'crop' || stage === 'confirm' || stage === 'analyzing') && sourceUrl && (
        <div className="flex aspect-[3/4.08] w-full max-w-[300px] flex-col gap-2.5 overflow-hidden rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] p-2.5">
          {/* Interactive Pan/Zoom Crop Viewport matching Card's 56% photo window */}
          <div
            ref={cropBoxRef}
            onPointerDown={(e) => {
              if (stage !== 'crop' || dragRef.current.pointerId !== null) return;
              dragRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                origX: cropX,
                origY: cropY,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (dragRef.current.pointerId !== e.pointerId || stage !== 'crop' || !cropMetrics) {
                return;
              }
              const nx = dragRef.current.origX + (e.clientX - dragRef.current.startX);
              const ny = dragRef.current.origY + (e.clientY - dragRef.current.startY);
              const clamped = clampCropOffset(nx, ny, cropMetrics.maxX, cropMetrics.maxY);
              setCropX(clamped.x);
              setCropY(clamped.y);
            }}
            onPointerUp={(e) => endDrag(e.pointerId)}
            onPointerCancel={(e) => endDrag(e.pointerId)}
            onLostPointerCapture={(e) => endDrag(e.pointerId)}
            className={`relative h-[56%] w-full overflow-hidden rounded-[16px] bg-[var(--surface-sub)] ${
              stage === 'crop' ? 'cursor-grab touch-none active:cursor-grabbing' : ''
            }`}
          >
            <img
              src={sourceUrl}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
                setCropX(0);
                setCropY(0);
              }}
              className="pointer-events-none absolute top-1/2 left-1/2 max-w-none max-h-none"
              style={
                cropMetrics
                  ? {
                      width: `${cropMetrics.drawnW}px`,
                      height: `${cropMetrics.drawnH}px`,
                      transform: `translate(calc(-50% + ${cropX}px), calc(-50% + ${cropY}px))`,
                    }
                  : {
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transform: 'translate(-50%, -50%)',
                    }
              }
            />

            {stage === 'crop' && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, transparent 33%, #fff 33%, #fff 33.6%, transparent 33.6%, transparent 66.4%, #fff 66.4%, #fff 67%, transparent 67%), linear-gradient(to bottom, transparent 33%, #fff 33%, #fff 33.6%, transparent 33.6%, transparent 66.4%, #fff 66.4%, #fff 67%, transparent 67%)',
                }}
              />
            )}

            {stage === 'analyzing' && (
              <motion.div
                className="pointer-events-none absolute inset-x-0 h-1.5 bg-[var(--attr-pop)]"
                initial={{ top: '4%' }}
                animate={{ top: ['4%', '94%', '4%'] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </div>

          {/* Lower Card Control Area */}
          {stage === 'crop' && (
            <div className="flex flex-1 flex-col justify-between px-2 pt-2 pb-1">
              <div className="flex items-center gap-2.5 text-[var(--fg-muted)]">
                <ZoomOut className="h-4 w-4 shrink-0" />
                <PopSlider
                  ariaLabel="ズーム"
                  min={1}
                  max={2.4}
                  step={0.05}
                  value={cropZoom}
                  onValueChange={handleZoomChange}
                />
                <ZoomIn className="h-4 w-4 shrink-0" />
              </div>

              <div className="flex items-center justify-center gap-2">
                <PopButton variant="surface" size="sm" onClick={resetToPick}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>選び直す</span>
                </PopButton>
                <PopButton
                  variant="primary"
                  size="sm"
                  disabled={!webgpuSupported || starting || status === 'analyzing'}
                  onClick={() => void handleStartClick()}
                >
                  <ScanLine className="h-3.5 w-3.5" />
                  <span>スキャン</span>
                </PopButton>
              </div>
            </div>
          )}

          {stage === 'confirm' && (
            <div className="flex flex-1 flex-col justify-between px-2 pt-2 pb-1 text-center">
              <div className="flex flex-col gap-1">
                <p className="text-xs leading-relaxed font-extrabold text-[var(--fg)]">
                  初回のみ AI モデル（約 200 MB）を端末に保存します
                </p>
                <p className="text-[11px] font-bold text-[var(--fg-muted)]">
                  画像は外部送信されず、ブラウザ内で解析します
                </p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <PopButton variant="surface" size="sm" onClick={() => setStage('crop')}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>戻る</span>
                </PopButton>
                <PopButton
                  variant="primary"
                  size="sm"
                  disabled={starting}
                  onClick={() => void executeScan()}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>保存して開始</span>
                </PopButton>
              </div>
            </div>
          )}

          {stage === 'analyzing' && (
            <div className="flex flex-1 flex-col justify-center px-2.5">
              <PopProgress
                value={
                  status === 'loading' && progress?.stage === 'downloading' ? pct : null
                }
                label={
                  status === 'loading'
                    ? formatLoadStageLabel(progress)
                    : '特徴を解析中...'
                }
                detail={
                  status === 'loading' &&
                  progress?.stage === 'downloading' &&
                  progress.totalBytes > 0 &&
                  pct !== null
                    ? `${formatMB(progress.loadedBytes)} / ${formatMB(progress.totalBytes)} (${pct}%)`
                    : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {/* STAGE 5: AUTO-SAVED & REVEALED */}
      {stage === 'revealed' && revealedCreature && revealedImageUrl && (
        <div className="flex w-full max-w-[320px] flex-col items-center gap-4">
          <CreatureCard
            name={revealedCreature.name}
            imageUrl={revealedImageUrl}
            primaryType={revealedCreature.primaryType}
            secondaryType={revealedCreature.secondaryType}
            rarity={revealedCreature.rarityTier}
            stats={revealedCreature.stats}
            createdAt={revealedCreature.createdAt}
            flipped={flipped}
            onFlippedChange={setFlipped}
            revealOnMount
          />

          <div className="flex w-full flex-col items-center gap-2">
            {/* Primary seamless return to Collection + Continue scanning */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <PopButton
                variant="primary"
                size="sm"
                onClick={() => void navigate({ to: '/' })}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>コレクションへ</span>
              </PopButton>
              <PopButton variant="surface" size="sm" onClick={resetToPick}>
                <Plus className="h-3.5 w-3.5" />
                <span>続ける</span>
              </PopButton>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <PopButton
                variant="surface"
                size="sm"
                onClick={() => setFlipped((prev) => !prev)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>{flipped ? '表に戻す' : 'パラメータ'}</span>
              </PopButton>
              <PopButton
                variant="surface"
                size="sm"
                onClick={() => setShareOpen(true)}
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>共有 / 保存</span>
              </PopButton>
              <PopButton
                variant="surface"
                size="icon"
                aria-label="名前変更"
                onClick={() => setRenameOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </PopButton>
            </div>
          </div>

          <RenameCreatureDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            initialName={revealedCreature.name}
            onSave={(name) => rename(revealedCreature.id, name)}
          />
          <ShareCardDialog
            open={shareOpen}
            onOpenChange={setShareOpen}
            creature={revealedCreature}
            imageUrl={revealedImageUrl}
          />
        </div>
      )}
    </main>
  );
}
