/**
 * Catálogo de proveedores de modelos y cómo crear el adaptador de cada uno.
 *
 * Añadir un proveedor compatible con OpenAI es añadir una entrada aquí.
 * Las claves se leen SIEMPRE de variables de entorno (o de un archivo .env
 * que no se sube al repo); nunca se escriben en el código.
 */
import { AnthropicModelClient } from "./anthropic.js";
import { OpenAICompatibleModelClient } from "./openai-compatible.js";
import type { ModelClient } from "./client.js";
import type { Effort } from "../config.js";

export type ProviderId = "anthropic" | "gemini" | "openrouter" | "ollama";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** Variable de entorno con la API key. */
  apiKeyEnv: string;
  /** Modelo por defecto. Cámbialo con HARNESS_MODEL o desde la UI. */
  defaultModel: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  anthropic: { id: "anthropic", label: "Anthropic (Claude)", apiKeyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-opus-5-5" },
  gemini: { id: "gemini", label: "Google Gemini", apiKeyEnv: "GEMINI_API_KEY", defaultModel: "gemini-2.5-flash" },
  openrouter: { id: "openrouter", label: "OpenRouter", apiKeyEnv: "OPENROUTER_API_KEY", defaultModel: "qwen/qwen3-coder:free" },
  ollama: { id: "ollama", label: "Ollama", apiKeyEnv: "OLLAMA_API_KEY", defaultModel: "gpt-oss:120b" },
};

/** Orden de preferencia cuando no eliges proveedor explícitamente. */
const PREFERENCE: ProviderId[] = ["anthropic", "gemini", "openrouter", "ollama"];

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

/** ¿Hay credenciales/configuración para usar este proveedor? */
export function isConfigured(id: ProviderId, env: NodeJS.ProcessEnv): boolean {
  if (env[PROVIDERS[id].apiKeyEnv]) return true;
  // Ollama local no necesita clave, solo saber dónde está.
  return id === "ollama" && Boolean(env.OLLAMA_BASE_URL);
}

export function configuredProviders(env: NodeJS.ProcessEnv): ProviderId[] {
  return PREFERENCE.filter((id) => isConfigured(id, env));
}

/** Proveedor elegido: HARNESS_PROVIDER, o el primero que tenga clave. */
export function resolveProvider(env: NodeJS.ProcessEnv): ProviderId {
  const requested = env.HARNESS_PROVIDER;
  if (requested) {
    if (!isProviderId(requested)) {
      throw new Error(`HARNESS_PROVIDER inválido: "${requested}". Usa uno de: ${Object.keys(PROVIDERS).join(", ")}`);
    }
    return requested;
  }
  return configuredProviders(env)[0] ?? "anthropic";
}

export interface ModelSelection {
  provider: ProviderId;
  model: string;
  maxTokens: number;
  effort: Effort;
}

export function createModelClient(selection: ModelSelection, env: NodeJS.ProcessEnv = process.env): ModelClient {
  const { provider, model } = selection;
  if (!isConfigured(provider, env)) {
    throw new Error(`Falta ${PROVIDERS[provider].apiKeyEnv} para usar ${PROVIDERS[provider].label}.`);
  }
  switch (provider) {
    case "anthropic":
      return new AnthropicModelClient(selection);
    case "gemini":
      return new OpenAICompatibleModelClient({
        provider,
        model,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: env.GEMINI_API_KEY,
      });
    case "openrouter":
      return new OpenAICompatibleModelClient({
        provider,
        model,
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: env.OPENROUTER_API_KEY,
        // OpenRouter usa estas cabeceras (opcionales) para identificar la app.
        headers: { "X-Title": "harness-engineering" },
      });
    case "ollama":
      return new OpenAICompatibleModelClient({
        provider,
        model,
        // Con clave -> Ollama Cloud. Sin clave -> tu Ollama local.
        baseURL: env.OLLAMA_BASE_URL ?? (env.OLLAMA_API_KEY ? "https://ollama.com/v1" : "http://localhost:11434/v1"),
        apiKey: env.OLLAMA_API_KEY,
      });
  }
}
