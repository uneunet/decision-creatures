import {
  BarChart3,
  Check,
  Download,
  Image as ImageIcon,
  Pencil,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CreatureRecord } from '../db/creatures';
import {
  downloadBlob,
  exportCreatureCardPng,
  shareOrDownloadPng,
} from '../lib/exportCardPng';
import { useThemeStore } from '../store/useThemeStore';
import { PopAlertDialog, PopButton, PopDialog } from '../ui/primitives';

export function RenameCreatureDialog({
  open,
  onOpenChange,
  initialName,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onSave: (name: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialName);

  useEffect(() => {
    if (open) setValue(initialName);
  }, [open, initialName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    await onSave(trimmed);
    onOpenChange(false);
  };

  return (
    <PopDialog.Root open={open} onOpenChange={onOpenChange}>
      <PopDialog.Content>
        <div className="flex items-center justify-between gap-2 border-b-2 border-[var(--surface-sub)] pb-3">
          <PopDialog.Title>
            <Pencil className="h-4 w-4" />
            <span>名前を変更</span>
          </PopDialog.Title>
          <PopDialog.Close
            render={
              <PopButton variant="ghost" size="icon" aria-label="閉じる">
                <X className="h-4 w-4" />
              </PopButton>
            }
          />
        </div>

        <form onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-4">
          <input
            type="text"
            aria-label="クリーチャー名"
            value={value}
            maxLength={32}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            className="h-11 w-full rounded-xl border-2 border-[var(--attr-stroke)] bg-[var(--surface-sub)] px-3.5 text-sm font-extrabold text-[var(--fg)] outline-none focus:border-[var(--attr-pop)]"
          />
          <div className="flex items-center justify-end gap-2">
            <PopDialog.Close
              render={
                <PopButton variant="surface" size="sm" type="button">
                  キャンセル
                </PopButton>
              }
            />
            <PopButton variant="primary" size="sm" type="submit" disabled={!value.trim()}>
              <Check className="h-3.5 w-3.5" />
              <span>保存</span>
            </PopButton>
          </div>
        </form>
      </PopDialog.Content>
    </PopDialog.Root>
  );
}

export function DeleteCreatureDialog({
  open,
  onOpenChange,
  creatureName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creatureName: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <PopAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <PopAlertDialog.Content>
        <div className="flex items-center justify-between gap-2 border-b-2 border-[var(--surface-sub)] pb-3">
          <PopAlertDialog.Title className="text-[#ff5c77]">
            <Trash2 className="h-4 w-4" />
            <span>カードを削除</span>
          </PopAlertDialog.Title>
          <PopAlertDialog.Close
            render={
              <PopButton variant="ghost" size="icon" aria-label="閉じる">
                <X className="h-4 w-4" />
              </PopButton>
            }
          />
        </div>

        <PopAlertDialog.Description className="mt-3">
          「{creatureName}」を端末のコレクションから削除します。
        </PopAlertDialog.Description>

        <div className="mt-5 flex items-center justify-end gap-2">
          <PopAlertDialog.Close
            render={
              <PopButton variant="surface" size="sm" type="button">
                キャンセル
              </PopButton>
            }
          />
          <PopButton
            variant="danger"
            size="sm"
            type="button"
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>削除する</span>
          </PopButton>
        </div>
      </PopAlertDialog.Content>
    </PopAlertDialog.Root>
  );
}

export function ShareCardDialog({
  open,
  onOpenChange,
  creature,
  imageUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creature: CreatureRecord;
  imageUrl: string;
}) {
  const mode = useThemeStore((s) => s.mode);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBlob(null);
      setPreviewUrl(null);
      setRenderError(null);
      setBusy(false);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;
    setBlob(null);
    setPreviewUrl(null);
    setRenderError(null);
    setBusy(true);

    void exportCreatureCardPng(creature, imageUrl, mode)
      .then((nextBlob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(nextBlob);
        setBlob(nextBlob);
        setPreviewUrl(createdUrl);
      })
      .catch((err) => {
        if (!active) return;
        setRenderError(err instanceof Error ? err.message : '画像の生成に失敗しました');
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, creature, imageUrl, mode]);

  const filename = `${creature.name}.png`;

  return (
    <PopDialog.Root open={open} onOpenChange={onOpenChange}>
      <PopDialog.Content className="w-[min(94vw,480px)]">
        <div className="flex items-center justify-between gap-2 border-b-2 border-[var(--surface-sub)] pb-3">
          <PopDialog.Title>
            <ImageIcon className="h-4 w-4" />
            <span>カード画像（表＋裏）</span>
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
          <div className="overflow-hidden rounded-2xl border-2 border-[var(--attr-stroke)] bg-[var(--surface-sub)]">
            {previewUrl ? (
              <img src={previewUrl} alt={`${creature.name} 表裏カード`} className="block w-full" />
            ) : (
              <div className="flex aspect-[1040/680] items-center justify-center px-4 text-center font-mono text-xs font-bold text-[var(--fg-muted)]">
                {busy ? 'RENDERING...' : (renderError ?? '—')}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <PopButton
              variant="surface"
              size="sm"
              disabled={!blob}
              onClick={() => {
                if (blob) downloadBlob(blob, filename);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              <span>画像保存</span>
            </PopButton>
            <PopButton
              variant="primary"
              size="sm"
              disabled={!blob}
              onClick={() => {
                if (blob) void shareOrDownloadPng(blob, filename, creature.name);
              }}
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>共有</span>
            </PopButton>
          </div>
        </div>
      </PopDialog.Content>
    </PopDialog.Root>
  );
}

export function ScoreDetailsDialog({
  open,
  onOpenChange,
  creature,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creature: CreatureRecord;
}) {
  return (
    <PopDialog.Root open={open} onOpenChange={onOpenChange}>
      <PopDialog.Content>
        <div className="flex items-center justify-between gap-2 border-b-2 border-[var(--surface-sub)] pb-3">
          <PopDialog.Title>
            <BarChart3 className="h-4 w-4" />
            <span>11 設問スコア詳細</span>
          </PopDialog.Title>
          <PopDialog.Close
            render={
              <PopButton variant="ghost" size="icon" aria-label="閉じる">
                <X className="h-4 w-4" />
              </PopButton>
            }
          />
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 font-mono text-[11px] font-bold">
            <div className="rounded-xl bg-[var(--surface-sub)] px-2.5 py-2 text-center">
              <div className="text-[9px] text-[var(--fg-muted)]">BIOME</div>
              <div className="uppercase">{creature.biome}</div>
            </div>
            <div className="rounded-xl bg-[var(--surface-sub)] px-2.5 py-2 text-center">
              <div className="text-[9px] text-[var(--fg-muted)]">CLASS</div>
              <div className="uppercase">{creature.archetype}</div>
            </div>
            <div className="rounded-xl bg-[var(--surface-sub)] px-2.5 py-2 text-center">
              <div className="text-[9px] text-[var(--fg-muted)]">UNC</div>
              <div>{Math.round(creature.rarity.uncertainty * 100)}%</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {creature.scores.map((q) => (
              <div
                key={q.id}
                className="rounded-xl border-2 border-[var(--surface-sub)] bg-[var(--surface-sub)]/60 p-2.5 font-mono text-[11px]"
              >
                <div className="mb-1.5 flex items-center justify-between font-extrabold text-[var(--fg)]">
                  <span>{q.id}</span>
                  <span className="text-[10px] text-[var(--fg-muted)]">
                    H={q.entropy.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {q.options
                    .map((opt, i) => ({ opt, p: q.probabilities[i]! }))
                    .sort((a, b) => b.p - a.p)
                    .slice(0, 3)
                    .map(({ opt, p }) => (
                      <div key={opt} className="flex items-center gap-1.5">
                        <span className="w-16 truncate text-[10px] font-bold text-[var(--fg-muted)]">
                          {opt}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--track)]">
                          <div
                            className="h-full rounded-full bg-[var(--attr-pop)]"
                            style={{ width: `${Math.round(p * 100)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-[10px] font-bold tabular-nums text-[var(--fg-muted)]">
                          {Math.round(p * 100)}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopDialog.Content>
    </PopDialog.Root>
  );
}
