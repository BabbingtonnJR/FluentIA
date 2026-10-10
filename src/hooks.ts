import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useState } from 'react';
import { loadPack } from './content/packs';
import type { Pack } from './content/types';
import { getSettings } from './db/repo';
import type { Settings } from './db/types';

/** Settings from the database, or undefined while they are first loading. */
export function useLiveSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), []);
}

export const SettingsContext = createContext<Settings | null>(null);
export const PackContext = createContext<Pack | null>(null);

/** Current settings; pages render only after App has loaded them, so this is never stale defaults. */
export function useSettings(): Settings {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('useSettings must be used inside SettingsContext');
  return settings;
}

/** The active language pack; pages render only after App has loaded it. */
export function usePack(): Pack {
  const pack = useContext(PackContext);
  if (!pack) throw new Error('usePack must be used inside PackContext');
  return pack;
}

export function useLoadedPack(lang: string | undefined): { pack: Pack | null; error: string | null } {
  const [state, setState] = useState<{ pack: Pack | null; error: string | null }>({ pack: null, error: null });
  useEffect(() => {
    if (!lang) return;
    let alive = true;
    loadPack(lang).then(
      (pack) => alive && setState({ pack, error: null }),
      (e: unknown) => alive && setState({ pack: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [lang]);
  return state;
}

/** Applies the theme preference to <html data-theme>. */
export function useTheme(theme: Settings['theme'] | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (!theme || theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}
