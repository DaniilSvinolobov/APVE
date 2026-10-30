import { VERFAHREN_PRIVAT, type State } from '../domain/types';
import { emptyState } from '../domain/demo';
import { verknuepfeAlte } from '../domain/runden';

const KEY = 'apve-state-v2'; // bis Version 0.1: ein einziges Projekt im localStorage, jetzt nur noch für die Übernahme (projektRepo/migration)
const STEP_KEY = 'apve-step';
const AKTIV_KEY = 'apve-aktiv';

/** Projekt aus dem früheren localStorage-Speicher (oder null, wenn keines oder nur ein leeres vorhanden ist). */
export function legacyState(): State | null {
  try {
    const raw = localStorage.getItem(KEY);
    const st = raw ? parseBackup(JSON.parse(raw)) : null;
    if (!st) return null;
    const leer = emptyState();
    const benutzt = st.offers.length || st.lv.length || st.lose.length || JSON.stringify(st.project) !== JSON.stringify(leer.project);
    return benutzt ? st : null;
  } catch { return null; }
}
export function clearLegacy() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
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

/** Geöffnetes Projekt dieses Tabs (nach dem Neuladen wieder öffnen; ein neuer Tab beginnt in der Übersicht). */
export function loadAktiv(): string | null {
  try { return sessionStorage.getItem(AKTIV_KEY); } catch { return null; }
}
export function saveAktiv(id: string | null) {
  try { id ? sessionStorage.setItem(AKTIV_KEY, id) : sessionStorage.removeItem(AKTIV_KEY); } catch { /* ignore */ }
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
