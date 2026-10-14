/**
 * Configuración central del harness.
 *
 * Todo lo que "afina" el comportamiento del agente vive aquí, para que puedas
 * experimentar cambiando una variable de entorno en vez de tocar código.
 */
import { PROVIDERS, resolveProvider, type ProviderId } from "./model/providers.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface HarnessConfig {
  /** Proveedor del modelo: anthropic, gemini, openrouter u ollama. */
  provider: ProviderId;
  /** Modelo concreto dentro del proveedor. */
  model: string;
  /** Tope de tokens de salida por respuesta (solo Anthropic). */
  maxTokens: number;
  /** Cuánto "piensa" el modelo (solo Anthropic): más esfuerzo = mejor calidad, más tokens. */
  effort: Effort;
  /** Máximo de vueltas del bucle (llamadas al modelo) por cada mensaje tuyo. */
  maxSteps: number;
}

/**
 * Carga un archivo .env de la carpeta actual si existe (Node 20.12+ lo trae
 * de serie). Las variables ya definidas en la terminal tienen prioridad.
 */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No hay .env: no pasa nada, se usan las variables de la terminal.
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HarnessConfig {
  const effort = (env.HARNESS_EFFORT ?? "high") as Effort;
  if (!EFFORTS.includes(effort)) {
    throw new Error(`HARNESS_EFFORT inválido: "${effort}". Usa uno de: ${EFFORTS.join(", ")}`);
  }

  const maxSteps = Number(env.HARNESS_MAX_STEPS ?? 50);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error(`HARNESS_MAX_STEPS debe ser un entero positivo, recibí "${env.HARNESS_MAX_STEPS}"`);
  }

  const provider = resolveProvider(env);
  return {
    provider,
    model: env.HARNESS_MODEL ?? PROVIDERS[provider].defaultModel,
    // Con streaming podemos dar margen amplio sin riesgo de timeouts HTTP.
    maxTokens: 64_000,
    effort,
    maxSteps,
  };
}
