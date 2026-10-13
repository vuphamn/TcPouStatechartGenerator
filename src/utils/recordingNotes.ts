/**
 * Notes added to a recording while replaying it (its file is not written again): kept in this browser by the file's name
 * and its start, merged with the notes the file has when it opens again.
 */
import type { RecordingNote } from './liveRecording.ts';

const KEY = (file: string, started: number) => `kss.recNotes|${file.toLowerCase()}|${started}`;

export function loadRecordingNotes(file: string, started: number): RecordingNote[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(file, started)) || '[]');
    return Array.isArray(v) ? v.filter((n) => n && Number.isFinite(n.t) && typeof n.text === 'string') : [];
  } catch {
    return [];
  }
}

export function saveRecordingNote(file: string, started: number, note: RecordingNote): void {
  try {
    localStorage.setItem(KEY(file, started), JSON.stringify([...loadRecordingNotes(file, started), note].slice(-200)));
  } catch {
    // (not kept)
  }
}
