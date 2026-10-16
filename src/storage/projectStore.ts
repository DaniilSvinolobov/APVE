import type { State } from '../domain/types';
import { emptyState } from '../domain/demo';

const KEY = 'apve-state-v2';
const STEP_KEY = 'apve-step';

/** Gespeichertes Projekt aus dem Browser laden (oder leeres Projekt). */
export function loadState(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseBackup(JSON.parse(raw)) ?? emptyState();
  } catch { /* ignore */ }
  return emptyState();
}

/** Projekt speichern; `false`, wenn der Browser-Speicher voll ist. */
export function saveState(s: State): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

/** Datensicherung (JSON) prüfen; `null`, wenn es keine Sicherung dieser Version ist. */
export function parseBackup(j: unknown): State | null {
  const o = j as { v?: number } | null;
  return o?.v === 2 ? { ...emptyState(), ...(j as State) } : null;
}

export function loadStep(): number {
  try { return Number(sessionStorage.getItem(STEP_KEY) ?? 0) || 0; } catch { return 0; }
}
export function saveStep(step: number) {
  try { sessionStorage.setItem(STEP_KEY, String(step)); } catch { /* ignore */ }
}

/** Alles löschen, was diese App im Browser abgelegt hat (Projekt, Zugangscode, Einwilligung). */
export function clearAllLocal() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('apve-')).forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch { /* ignore */ }
}
