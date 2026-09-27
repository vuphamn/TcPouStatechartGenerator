/**
 * The operator board's alert sound: a short chime made with Web Audio (no sound file). Browsers only play sound
 * after the page was clicked or tapped once: until then canPlay() is false and the board says so.
 */

let ctx: AudioContext | null = null;

const context = (): AudioContext | null => {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    return ctx;
  } catch {
    return null;
  }
};

/** Resumes sound after a click or tap (the browser's rule); true when sound can play now */
export async function unlockSound(): Promise<boolean> {
  const c = context();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

export const canPlay = () => context()?.state === 'running';

/** Two tones (error: lower and three times; stuck: once) */
export function playAlert(kind: 'error' | 'stuck' | 'escalated'): void {
  const c = context();
  if (!c || c.state !== 'running') return;
  const tones = kind === 'error' ? [[660, 0], [440, 0.22], [660, 0.5], [440, 0.72], [660, 1.0], [440, 1.22]] : kind === 'escalated' ? [[880, 0], [660, 0.2], [880, 0.4], [660, 0.6]] : [[880, 0], [660, 0.22]];
  for (const [freq, at] of tones) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = c.currentTime + at;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.22);
  }
}
