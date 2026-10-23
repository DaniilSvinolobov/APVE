/**
 * Gemeinsamer KI-Zugang der Vercel-Functions: Claude über Amazon Bedrock in der EU (Standard: Frankfurt).
 * Dateien mit „_“ am Anfang sind bei Vercel keine eigene Function.
 *
 * Umgebungsvariablen (Vercel reserviert die Namen AWS_*, daher eigene Namen):
 *   BEDROCK_API_KEY                Bedrock-API-Key (Bearer) – oder stattdessen:
 *   BEDROCK_ACCESS_KEY_ID          Zugangsschlüssel eines IAM-Nutzers, der nur Bedrock aufrufen darf
 *   BEDROCK_SECRET_ACCESS_KEY      zugehöriger geheimer Schlüssel
 *   BEDROCK_REGION                 Standard eu-central-1 (Frankfurt); nur EU-Regionen (eu-…) sind zugelassen
 *   KI_MODEL                       Standard eu.anthropic.claude-opus-5-5 (EU-Inferenzprofil); global./us./… werden abgelehnt
 *   KI_EFFORT                      low | medium | high (Standard high)
 */
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

export const kiEnabled = () => !!(process.env.BEDROCK_API_KEY || (process.env.BEDROCK_ACCESS_KEY_ID && process.env.BEDROCK_SECRET_ACCESS_KEY));

export class KonfigFehler extends Error {}

/** Region und Modell erzwingen die Verarbeitung in der EU; eine Fehlkonfiguration bricht ab, statt Daten außerhalb der EU zu senden. */
export function kiConfig() {
  const region = process.env.BEDROCK_REGION || 'eu-central-1';
  const model = process.env.KI_MODEL || 'eu.anthropic.claude-opus-5-5';
  if (!/^eu-[a-z]+-\d$/.test(region)) throw new KonfigFehler(`BEDROCK_REGION „${region}“ liegt nicht in der EU.`);
  if (/^(global|us|apac|jp|au|ca)\./.test(model)) throw new KonfigFehler(`KI_MODEL „${model}“ würde außerhalb der EU verarbeitet.`);
  const e = process.env.KI_EFFORT;
  const effort: 'low' | 'medium' | 'high' = e === 'low' || e === 'medium' ? e : 'high';
  return { region, model, effort };
}

/** Bedrock Runtime (wie der Playground): akzeptiert die EU-Inferenzprofile (eu.anthropic.…), auf die auch die Kontingente gelten. */
export function kiClient(region: string) {
  const apiKey = process.env.BEDROCK_API_KEY;
  if (apiKey) return new AnthropicBedrock({ awsRegion: region, apiKey });
  const awsAccessKey = process.env.BEDROCK_ACCESS_KEY_ID, awsSecretKey = process.env.BEDROCK_SECRET_ACCESS_KEY;
  if (awsAccessKey && awsSecretKey) return new AnthropicBedrock({ awsRegion: region, awsAccessKey, awsSecretKey });
  throw new KonfigFehler('Kein Bedrock-Zugang konfiguriert.');
}

/** JSON-Objekt aus der Antwort lesen (Bedrock kennt keine erzwungenen Ausgabeformate; ggf. Codeblock oder Begleittext entfernen). */
export function jsonAus(text: string): unknown {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new SyntaxError('Kein JSON in der Antwort.');
  return JSON.parse(text.slice(a, b + 1));
}

export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
export const txt = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
