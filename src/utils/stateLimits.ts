import { useCallback, useEffect, useState } from 'react';

/**
 * Stuck-state alerts: how long a state machine may stay in a state (ms), per POU type (e.g. SM_TableManager) so
 * every window and the Machine Overview use the same limits for its instances; a default for the states that have
 * none; and whether a notification is shown when a machine goes over. Kept per viewer (localStorage), in step
 * across the app's tabs / windows.
 */

export interface StateLimits {
  /** state -> ms */
  byState: Record<string, number>;
}

const KEY = (type: string) => `kss.limits.${type.toLowerCase()}`;
const DEFAULT_KEY = 'kss.limits.default';
const NOTIFY_KEY = 'kss.limits.notify';
const EVENT = 'kss-state-limits';

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // per-viewer convenience only
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
};

export function readLimits(type: string | undefined): Record<string, number> {
  return type ? read<Record<string, number>>(KEY(type), {}) : {};
}

/** Sets (ms > 0) or clears (null) a state's limit for a POU type */
export function setStateLimit(type: string, state: string, ms: number | null) {
  const next = { ...readLimits(type) };
  if (ms && ms > 0) next[state] = Math.round(ms);
  else delete next[state];
  write(KEY(type), Object.keys(next).length ? next : null);
}

export function readDefaultLimit(): number | null {
  const v = read<number | null>(DEFAULT_KEY, null);
  return typeof v === 'number' && v > 0 ? v : null;
}
export const setDefaultLimit = (ms: number | null) => write(DEFAULT_KEY, ms && ms > 0 ? Math.round(ms) : null);
export const readNotify = () => read<boolean>(NOTIFY_KEY, false) === true;
export const setNotify = (on: boolean) => write(NOTIFY_KEY, on);

/** The limit for a state of a POU type: its own, else the default (null: none) */
export function limitFor(limits: Record<string, number>, defaultMs: number | null, state: string | null | undefined): number | null {
  if (!state) return null;
  return limits[state] ?? defaultMs ?? null;
}

/** A value that follows the limits' storage (this window's changes and the other windows') */
function useStored<T>(readValue: () => T, deps: unknown[]): T {
  const [value, setValue] = useState<T>(readValue);
  useEffect(() => {
    setValue(readValue());
    const refresh = () => setValue(readValue());
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('kss.limits.')) refresh();
    };
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** A POU type's limits (state -> ms) */
export const useStateLimits = (type: string | undefined) => useStored(() => readLimits(type), [type]);
/** The default limit (ms) and whether to notify */
export const useDefaultLimit = () => useStored(readDefaultLimit, []);
export const useNotify = () => useStored(readNotify, []);
/** Limits of several types at once (the Machine Overview): type -> state -> ms */
export function useLimitsOfTypes(types: string[]): Record<string, Record<string, number>> {
  const key = [...new Set(types.map((t) => t.toLowerCase()))].sort().join('|');
  return useStored(() => Object.fromEntries(key.split('|').filter(Boolean).map((t) => [t, readLimits(t)])), [key]);
}

/** Seconds as the user types them ("30", "1.5", "2m", "1h") to ms; null: empty / not a duration */
export function parseDuration(text: string): number | null {
  const m = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|min|h)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] ?? 's';
  const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : unit === 'h' ? n * 3600000 : n * 60000;
  return ms > 0 ? ms : null;
}

/** ms as a short duration for a field ("30 s", "2 min") */
export function formatLimit(ms: number | null): string {
  if (!ms) return '';
  if (ms % 3600000 === 0) return `${ms / 3600000} h`;
  if (ms % 60000 === 0) return `${ms / 60000} min`;
  return `${Number((ms / 1000).toFixed(3))} s`;
}

/** Shows a notification (desktop app: a Windows notification; browsers: after permission) */
export async function notifyStuck(title: string, body: string, tag: string) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body, tag });
  } catch {
    // notifications not available (e.g. inside TwinCAT XAE)
  }
}

/** Asks for permission now (from a click: browsers only ask from a user gesture) */
export function requestNotifyPermission() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    // not available
  }
}

export const useLimitSetter = () => useCallback(setStateLimit, []);
