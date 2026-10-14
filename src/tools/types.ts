/**
 * Qué es una herramienta para este harness.
 *
 * El modelo NO ejecuta nada: solo pide "quiero llamar a read_file con
 * {path: 'x'}". El harness valida esa petición, decide si se permite, la
 * ejecuta y le devuelve el resultado como texto. Esta interfaz es el contrato.
 */
import type { z } from "zod";

/**
 * Nivel de riesgo. El sistema de permisos lo usa para decidir si hay que
 * preguntarte antes de ejecutar.
 */
export type ToolRisk = "read" | "write" | "execute";

export interface ToolContext {
  /** Carpeta raíz donde el agente puede trabajar. */
  workspaceRoot: string;
  /** Se activa si cancelas el turno (Ctrl+C). */
  signal?: AbortSignal;
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  /** Nombre que ve el modelo. snake_case por convención. */
  name: string;
  /** Lo que el modelo lee para decidir cuándo y cómo usarla. ¡Es un prompt! */
  description: string;
  risk: ToolRisk;
  /** Esquema de entrada: genera el JSON Schema para la API y valida lo que llega. */
  schema: S;
  /** Ejecuta la herramienta. Devuelve texto que se le entrega al modelo. */
  run(input: z.infer<S>, ctx: ToolContext): Promise<string>;
  /** Resumen de una línea para mostrarte qué va a hacer (permisos y logs). */
  summarize?(input: z.infer<S>): string;
}

/** Helper para que TypeScript infiera el tipo de `input` desde el esquema. */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

/**
 * Error "esperado" de una herramienta (archivo no existe, texto no encontrado...).
 * Se le devuelve al modelo como `is_error: true` para que corrija y reintente.
 */
export class ToolError extends Error {}
