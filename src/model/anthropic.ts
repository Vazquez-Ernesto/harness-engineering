/**
 * Adaptador para la API de Claude (Anthropic), usando su SDK oficial.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Effort } from "../config.js";
import { InvalidToolInputError, type ModelClient, type ModelRequest, type StreamHandlers } from "./client.js";

export class AnthropicModelClient implements ModelClient {
  constructor(
    private readonly config: { model: string; maxTokens: number; effort: Effort },
    // Sin argumentos, el SDK lee ANTHROPIC_API_KEY (u otras credenciales) del entorno.
    private readonly client: Anthropic = new Anthropic(),
  ) {}

  async send(request: ModelRequest, handlers: StreamHandlers = {}, signal?: AbortSignal): Promise<BetaMessage> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: request.system,
        tools: request.tools,
        messages: request.messages,
        // Thinking adaptativo: el modelo decide cuánto razonar antes de actuar.
        // "summarized" nos devuelve un resumen legible de ese razonamiento.
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: this.config.effort },
        // Prompt caching automático: cachea el prefijo de la conversación.
        // En un agente cada llamada repite todo el historial, así que esto
        // abarata mucho las llamadas a partir de la segunda.
        cache_control: { type: "ephemeral" },
        // Si un clasificador de seguridad rechaza la petición, la API la
        // reintenta sola con el modelo de respaldo recomendado.
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
      },
      { signal },
    );

    if (handlers.onText) stream.on("text", handlers.onText);
    if (handlers.onThinking) stream.on("thinking", handlers.onThinking);
    let receivedEvents = false;
    stream.on("streamEvent", () => (receivedEvents = true));

    try {
      return await stream.finalMessage();
    } catch (err) {
      // Errores HTTP de la API (401, 429, 500, red...): no son nuestros, se propagan.
      if (err instanceof Anthropic.APIError) throw err;
      // El SDK lanza un AnthropicError genérico cuando no puede parsear el JSON
      // de entrada de una herramienta (lo usamos con eager_input_streaming).
      // Solo puede pasar si la respuesta ya empezó a llegar; antes de eso, un
      // AnthropicError es otra cosa (p. ej. faltan credenciales).
      if (err instanceof Anthropic.AnthropicError && receivedEvents) {
        throw new InvalidToolInputError(err.message);
      }
      throw err;
    }
  }
}
