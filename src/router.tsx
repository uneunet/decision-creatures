import {
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from '@tanstack/react-router';
import { LayoutGrid } from 'lucide-react';
import type { RarityTier, SubstanceType } from './inference/types';
import { CollectionPage } from './pages/CollectionPage';
import { CreatureDetailPage } from './pages/CreatureDetailPage';
import { RootLayout } from './pages/RootLayout';
import { ScanPage } from './pages/ScanPage';
import { PopButton } from './ui/primitives';

export type CollectionSortKey = 'newest' | 'rarity' | 'total';

export interface CollectionSearch {
  type?: SubstanceType;
  rarity?: RarityTier;
  sort?: CollectionSortKey;
}

const VALID_SUBSTANCES = new Set<SubstanceType>([
  'flesh',
  'botanical',
  'metal',
  'stone',
  'liquid',
  'fabric',
  'energy',
]);

const VALID_RARITIES = new Set<RarityTier>([
  'common',
  'uncommon',
  'rare',
  'epic',
  'mythic',
]);

const VALID_SORTS = new Set<CollectionSortKey>(['newest', 'rarity', 'total']);

export function validateCollectionSearch(search: Record<string, unknown>): CollectionSearch {
  const result: CollectionSearch = {};
  if (typeof search.type === 'string' && VALID_SUBSTANCES.has(search.type as SubstanceType)) {
    result.type = search.type as SubstanceType;
  }
  if (typeof search.rarity === 'string' && VALID_RARITIES.has(search.rarity as RarityTier)) {
    result.rarity = search.rarity as RarityTier;
  }
  if (typeof search.sort === 'string' && VALID_SORTS.has(search.sort as CollectionSortKey)) {
    result.sort = search.sort as CollectionSortKey;
  }
  return result;
}

function NotFoundView() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-5 py-10">
      <div className="flex w-full max-w-[300px] flex-col items-center gap-4 rounded-[24px] border-2 border-[var(--attr-stroke)] border-b-[6px] border-b-[var(--attr-lip)] bg-[var(--surface)] px-6 py-10 text-center">
        <span className="font-mono text-lg font-black text-[var(--fg)]">404</span>
        <PopButton variant="surface" size="sm" onClick={() => void navigate({ to: '/' })}>
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>コレクションへ</span>
        </PopButton>
      </div>
    </main>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundView,
});

const collectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateCollectionSearch,
  component: CollectionPage,
});

const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scan',
  component: ScanPage,
});

const creatureDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/creatures/$id',
  component: CreatureDetailPage,
});

const routeTree = rootRoute.addChildren([
  collectionRoute,
  scanRoute,
  creatureDetailRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
