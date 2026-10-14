import { describe, expect, it } from "vitest";
import { configuredProviders, createModelClient, resolveProvider } from "../src/model/providers.js";
import { loadConfig } from "../src/config.js";

describe("selección de proveedor", () => {
  it("usa HARNESS_PROVIDER si está definido", () => {
    expect(resolveProvider({ HARNESS_PROVIDER: "gemini" })).toBe("gemini");
  });

  it("rechaza un proveedor desconocido", () => {
    expect(() => resolveProvider({ HARNESS_PROVIDER: "skynet" })).toThrow(/inválido/);
  });

  it("sin HARNESS_PROVIDER elige el primero que tenga clave", () => {
    expect(resolveProvider({ OPENROUTER_API_KEY: "x", OLLAMA_API_KEY: "y" })).toBe("openrouter");
  });

  it("Ollama local cuenta como configurado con solo OLLAMA_BASE_URL", () => {
    expect(configuredProviders({ OLLAMA_BASE_URL: "http://localhost:11434/v1" })).toEqual(["ollama"]);
  });

  it("el modelo por defecto depende del proveedor y HARNESS_MODEL lo sobrescribe", () => {
    expect(loadConfig({ GEMINI_API_KEY: "x" })).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash" });
    expect(loadConfig({ GEMINI_API_KEY: "x", HARNESS_MODEL: "otro" }).model).toBe("otro");
  });

  it("falla con un mensaje claro si falta la clave", () => {
    expect(() =>
      createModelClient({ provider: "gemini", model: "m", maxTokens: 1, effort: "high" }, {}),
    ).toThrow(/Falta GEMINI_API_KEY/);
  });
});
