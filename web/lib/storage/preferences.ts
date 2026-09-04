import { defaultSongOptions } from '@/lib/wasm/types';
import type { SongOptions } from '@/lib/wasm/types';

const storageKey = 'reve-midi:options:v1';

export function loadPreferences(): SongOptions {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<SongOptions> | null;
    return value ? { ...defaultSongOptions, ...value } : defaultSongOptions;
  } catch {
    return defaultSongOptions;
  }
}

export function savePreferences(options: SongOptions) {
  localStorage.setItem(storageKey, JSON.stringify(options));
}

export function clearPreferences() {
  localStorage.removeItem(storageKey);
}
