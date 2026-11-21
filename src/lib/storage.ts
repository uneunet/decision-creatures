import type { StateStorage } from 'zustand/middleware';

/**
 * `localStorage` wrapper that tolerates private-mode / restricted storage errors.
 */
export function createSafeLocalStorage(
  transformRaw?: (raw: string) => string | null,
): StateStorage {
  return {
    getItem: (name) => {
      try {
        const raw = window.localStorage.getItem(name);
        if (!raw) return null;
        return transformRaw ? transformRaw(raw) : raw;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        window.localStorage.setItem(name, value);
      } catch {
        // Ignore restricted/private-mode storage errors
      }
    },
    removeItem: (name) => {
      try {
        window.localStorage.removeItem(name);
      } catch {
        // Ignore storage restriction
      }
    },
  };
}
