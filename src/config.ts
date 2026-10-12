/**
 * Configuración central del harness.
 *
 * Todo lo que "afina" el comportamiento del agente vive aquí, para que puedas
 * experimentar cambiando una variable de entorno en vez de tocar código.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface HarnessConfig {
  /** Modelo de Claude que usa el agente. */
  model: string;
  /** Tope de tokens de salida por respuesta del modelo. */
  maxTokens: number;
  /** Cuánto "piensa" el modelo: más esfuerzo = mejor calidad, más tokens. */
  effort: Effort;
  /** Máximo de vueltas del bucle (llamadas al modelo) por cada mensaje tuyo. */
  maxSteps: number;
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

  return {
    model: env.HARNESS_MODEL ?? "claude-opus-5-5",
    // Con streaming podemos dar margen amplio sin riesgo de timeouts HTTP.
    maxTokens: 64_000,
    effort,
    maxSteps,
  };
}
