/**
 * Observabilidad: cada sesión se guarda como un archivo JSONL (una línea JSON
 * por evento) en .harness/sessions/.
 *
 * Para un QA esto es oro: es el "log de ejecución" del agente. Te permite
 * reproducir qué vio el modelo, qué decidió y cuánto costó cada paso.
 */
import fs from "node:fs";
import path from "node:path";

export interface TranscriptEvent {
  type: string;
  [key: string]: unknown;
}

export interface Transcript {
  record(event: TranscriptEvent): void;
}

export class JsonlTranscript implements Transcript {
  readonly file: string;

  constructor(workspaceRoot: string, now: Date = new Date()) {
    const dir = path.join(workspaceRoot, ".harness", "sessions");
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${now.toISOString().replace(/[:.]/g, "-")}.jsonl`);
  }

  record(event: TranscriptEvent): void {
    // Escritura síncrona a propósito: si el proceso muere, el log ya está en disco.
    fs.appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  }
}

/** Transcript que no guarda nada (útil en tests). */
export const nullTranscript: Transcript = { record() {} };
