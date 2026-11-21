import { useNavigate, useParams } from '@tanstack/react-router';
import {
  BarChart3,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { CreatureCard } from '../components/CreatureCard';
import {
  DeleteCreatureDialog,
  RenameCreatureDialog,
  ScoreDetailsDialog,
  ShareCardDialog,
} from '../components/CreatureDialogs';
import { useCollectionStore } from '../store/useCollectionStore';
import { PopButton, PopMenu } from '../ui/primitives';

export function CreatureDetailPage() {
  const { id } = useParams({ from: '/creatures/$id' });
  const navigate = useNavigate();
  const { items, loaded, imageUrls, rename, remove } = useCollectionStore();

  const [flipped, setFlipped] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [scoresOpen, setScoresOpen] = useState(false);

  const creature = items.find((c) => c.id === id);
  const imageUrl = creature ? imageUrls[creature.id] : undefined;

  if (!loaded) {
    return <main className="flex flex-1 items-center justify-center p-8" />;
  }

  if (!creature || !imageUrl) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-5 py-10">
        <div className="flex w-full max-w-[300px] flex-col items-center gap-4 rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] px-6 py-10 text-center">
          <span className="font-mono text-xs font-extrabold text-[var(--fg-muted)]">
            NOT FOUND
          </span>
          <PopButton variant="surface" size="sm" onClick={() => void navigate({ to: '/' })}>
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>コレクションへ</span>
          </PopButton>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-7">
      <CreatureCard
        name={creature.name}
        imageUrl={imageUrl}
        primaryType={creature.primaryType}
        secondaryType={creature.secondaryType}
        rarity={creature.rarityTier}
        stats={creature.stats}
        createdAt={creature.createdAt}
        flipped={flipped}
        onFlippedChange={setFlipped}
      />

      <div className="flex w-full max-w-[320px] flex-col items-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <PopButton
            variant="surface"
            size="sm"
            onClick={() => setFlipped((prev) => !prev)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{flipped ? '表に戻す' : 'パラメータ'}</span>
          </PopButton>
          <PopButton variant="primary" size="sm" onClick={() => setShareOpen(true)}>
            <Share2 className="h-3.5 w-3.5" />
            <span>共有 / 保存</span>
          </PopButton>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <PopButton
            variant="surface"
            size="sm"
            onClick={() => void navigate({ to: '/' })}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>コレクションへ</span>
          </PopButton>
          <PopButton
            variant="surface"
            size="sm"
            onClick={() => setScoresOpen(true)}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>11Q</span>
          </PopButton>

          <PopMenu.Root>
            <PopMenu.Trigger
              render={
                <PopButton variant="surface" size="icon" aria-label="その他">
                  <MoreHorizontal className="h-4 w-4" />
                </PopButton>
              }
            />
            <PopMenu.Portal>
              <PopMenu.Positioner side="top" sideOffset={8} align="end">
                <PopMenu.Popup className="min-w-40">
                  <PopMenu.Item onClick={() => setRenameOpen(true)}>
                    <span className="inline-flex items-center gap-2">
                      <Pencil className="h-3.5 w-3.5" />
                      <span>名前変更</span>
                    </span>
                  </PopMenu.Item>
                  <PopMenu.Separator />
                  <PopMenu.Item
                    onClick={() => setDeleteOpen(true)}
                    className="text-[#ff5c77]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>削除</span>
                    </span>
                  </PopMenu.Item>
                </PopMenu.Popup>
              </PopMenu.Positioner>
            </PopMenu.Portal>
          </PopMenu.Root>
        </div>
      </div>

      <RenameCreatureDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initialName={creature.name}
        onSave={(name) => rename(creature.id, name)}
      />
      <DeleteCreatureDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        creatureName={creature.name}
        onConfirm={async () => {
          await remove(creature.id);
          void navigate({ to: '/' });
        }}
      />
      <ShareCardDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        creature={creature}
        imageUrl={imageUrl}
      />
      <ScoreDetailsDialog
        open={scoresOpen}
        onOpenChange={setScoresOpen}
        creature={creature}
      />
    </main>
  );
}
