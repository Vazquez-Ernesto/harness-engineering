/**
 * Contabilidad de tokens y coste estimado.
 *
 * Si algún día vendes esto, el coste por tarea es LA métrica: define tu
 * margen. Por eso se mide desde el día uno.
 */
import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** USD por millón de tokens. Revisa la web de precios de Anthropic: cambian. */
interface Pricing {
  input: number;
  output: number;
}

const PRICING: Record<string, Pricing> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(totals: UsageTotals, usage: BetaUsage): void {
  totals.inputTokens += usage.input_tokens;
  totals.outputTokens += usage.output_tokens;
  totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  totals.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
}

/**
 * Coste aproximado. Lectura de caché ≈ 0.1x el precio de input y escritura
 * ≈ 1.25x (caché de 5 minutos). Devuelve null si no conocemos el modelo.
 */
export function estimateCostUsd(model: string, totals: UsageTotals): number | null {
  const price = PRICING[model];
  if (!price) return null;
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
  return (
    totals.inputTokens * perToken(price.input) +
    totals.cacheWriteTokens * perToken(price.input * 1.25) +
    totals.cacheReadTokens * perToken(price.input * 0.1) +
    totals.outputTokens * perToken(price.output)
  );
}

/** Línea legible con tokens y coste, para la CLI. */
export function formatUsage(model: string, usage: UsageTotals): string {
  const cost = estimateCostUsd(model, usage);
  const costText = cost === null ? "" : ` · ~$${cost.toFixed(4)}`;
  return (
    `tokens: ${usage.inputTokens} in · ${usage.outputTokens} out · ` +
    `${usage.cacheReadTokens} caché leída · ${usage.cacheWriteTokens} caché escrita${costText}`
  );
}
