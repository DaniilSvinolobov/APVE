/** Originaldateien der Angebote (nur im Arbeitsspeicher, für die KI-Dokumentprüfung). */
export interface DocFile { name: string; path: string; data: Uint8Array; mime: string; kat: string }
export const docStore = new Map<string, DocFile[]>();
