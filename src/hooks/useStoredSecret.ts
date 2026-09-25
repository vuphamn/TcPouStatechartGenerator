import { useEffect, useState } from 'react';

/**
 * A secret the user enters (gateway access token, helper pairing code): kept for this tab (sessionStorage), and in
 * this browser (localStorage) only while "remember" is on. Storage may be unavailable: the value then lives in memory.
 */
export function useStoredSecret(key: string): [string, (value: string) => void, boolean, (remember: boolean) => void] {
  const [remember, setRemember] = useState(() => {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  });
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? sessionStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      if (remember && value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {
      // per-viewer convenience only
    }
  }, [key, value, remember]);
  return [value, setValue, remember, setRemember];
}
