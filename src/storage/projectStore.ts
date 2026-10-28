import { VERFAHREN_PRIVAT, type State } from '../domain/types';
import { emptyState } from '../domain/demo';
import { verknuepfeAlte } from '../domain/runden';

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
  if (o?.v !== 2) return null;
  const e = emptyState();
  // Felder, die in neueren Versionen dazugekommen sind, mit Standardwerten ergänzen
  const project = { ...e.project, ...(j as State).project };
  project.verfahren = ALTE_VERFAHREN[project.verfahren] ?? project.verfahren;
  const st = { ...e, ...(j as State), project };
  verknuepfeAlte(st);
  return st;
}

/** Frühere Einträge der Auswahl „Vergabeverfahren“; nicht eindeutige (z. B. „UVgO“) bleiben stehen und werden als bisherige Angabe angezeigt. */
const ALTE_VERFAHREN: Record<string, string> = {
  'Nichtförmliches Verfahren': '', // war nur der Standardwert
  'Öffentliche Ausschreibung': 'Öffentliche Ausschreibung nach VOB/A',
  'Freihändige Vergabe': 'Freihändige Vergabe nach VOB/A',
  'Privat / intern': VERFAHREN_PRIVAT,
};

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
