import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SubstanceType } from '../inference/types';
import { applyDocumentSubstanceVars } from '../ui/theme';

export type ThemeMode = 'light' | 'dark';

function detectSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyDocumentTheme(mode: ThemeMode, substance: SubstanceType | null): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', mode === 'dark');
  applyDocumentSubstanceVars(substance, mode);
}

interface ThemeState {
  mode: ThemeMode;
  activeSubstance: SubstanceType | null;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  setActiveSubstance: (substance: SubstanceType | null) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: detectSystemTheme(),
      activeSubstance: null,
      setMode: (mode) => {
        applyDocumentTheme(mode, get().activeSubstance);
        set({ mode });
      },
      toggle: () => {
        const next: ThemeMode = get().mode === 'dark' ? 'light' : 'dark';
        get().setMode(next);
      },
      setActiveSubstance: (substance) => {
        if (get().activeSubstance === substance) return;
        applyDocumentSubstanceVars(substance, get().mode);
        set({ activeSubstance: substance });
      },
    }),
    {
      name: 'decision-creatures-theme',
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyDocumentTheme(state.mode, state.activeSubstance);
        }
      },
    },
  ),
);

applyDocumentTheme(useThemeStore.getState().mode, useThemeStore.getState().activeSubstance);
