/**
 * Adaptador para cualquier API "compatible con OpenAI" (Chat Completions).
 *
 * Muchísimos proveedores exponen ese mismo formato: Gemini, OpenRouter,
 * Ollama (local y cloud), Groq, DeepSeek, LM Studio... Con este único
 * adaptador el harness funciona con todos ellos.
 *
 * Lo implementamos con `fetch` a mano (sin SDK) a propósito, para que veas
 * qué viaja realmente por la red:
 *   1. Traducimos nuestro historial (formato Anthropic) al formato OpenAI.
 *   2. Hacemos POST /chat/completions con `stream: true`.
 *   3. Leemos la respuesta como Server-Sent Events (líneas "data: {...}"),
 *      vamos mostrando el texto y acumulando las llamadas a herramientas.
 *   4. Traducimos el resultado de vuelta al formato interno.
 */
import { randomUUID } from "node:crypto";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaStopReason,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { InvalidToolInputError, type ModelClient, type ModelRequest, type StreamHandlers } from "./client.js";

// ── Formato OpenAI (solo lo que usamos) ────────────────────────────────────

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Datos propios del proveedor (p. ej. las "thought signatures" de Gemini). Hay que devolverlos tal cual. */
  extra_content?: unknown;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: unknown;
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string; code?: number | string };
}

/** Error HTTP del proveedor (clave inválida, modelo inexistente, límite de uso...). */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(`${provider} respondió ${status}: ${message}`);
  }
}

export interface OpenAICompatibleOptions {
  /** Nombre para mostrar en errores, p. ej. "gemini". */
  provider: string;
  baseURL: string;
  apiKey?: string;
  model: string;
  /** Cabeceras extra que pide algún proveedor. */
  headers?: Record<string, string>;
  /** Inyectable para tests. */
  fetch?: typeof fetch;
  /** Reintentos ante 429 / 5xx antes de empezar a recibir la respuesta. */
  maxRetries?: number;
  /** Espera base entre reintentos (ms). Se duplica en cada intento. */
  retryBaseMs?: number;
}

// ── Traducción: formato interno -> OpenAI ──────────────────────────────────

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

export function toChatTools(tools: BetaToolUnion[]): ChatTool[] {
  return tools.flatMap((tool) =>
    "input_schema" in tool && "name" in tool
      ? [{ type: "function" as const, function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }]
      : [],
  );
}

export function toChatMessages(
  system: string,
  messages: BetaMessageParam[],
  extraContentById: ReadonlyMap<string, unknown> = new Map(),
): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push(message.role === "assistant" ? { role: "assistant", content: message.content } : { role: "user", content: message.content });
      continue;
    }

    if (message.role === "user") {
      // En OpenAI cada resultado de herramienta es un mensaje "tool" separado
      // y deben ir justo después del mensaje del asistente que los pidió.
      const texts: string[] = [];
      for (const block of message.content) {
        if (block.type === "tool_result") {
          const content = textOf(block.content);
          out.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.is_error ? `ERROR: ${content}` : content });
        } else if (block.type === "text") {
          texts.push(block.text);
        }
      }
      if (texts.length > 0) out.push({ role: "user", content: texts.join("\n") });
      continue;
    }

    // Asistente: texto + llamadas a herramientas. Los bloques "thinking" son
    // propios de Anthropic y se descartan.
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const toolCalls: ChatToolCall[] = message.content.flatMap((b) => {
      if (b.type !== "tool_use") return [];
      const call: ChatToolCall = { id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } };
      const extra = extraContentById.get(b.id);
      if (extra !== undefined) call.extra_content = extra;
      return [call];
    });
    out.push({ role: "assistant", content: text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) });
  }
  return out;
}

// ── Lectura del stream (Server-Sent Events) ────────────────────────────────

/** Convierte el cuerpo de la respuesta en objetos JSON, uno por evento "data:". */
async function* readSseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue; // comentarios (": keep-alive") y líneas vacías
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      yield JSON.parse(data) as StreamChunk;
    }
  }
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
  extra?: unknown;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

// ── El adaptador ───────────────────────────────────────────────────────────

export class OpenAICompatibleModelClient implements ModelClient {
  /**
   * Gemini devuelve "thought signatures" en cada llamada a herramienta y exige
   * recibirlas de vuelta en el siguiente turno. Las guardamos por id.
   */
  private readonly extraContentById = new Map<string, unknown>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async send(request: ModelRequest, handlers: StreamHandlers = {}, signal?: AbortSignal): Promise<BetaMessage> {
    const tools = toChatTools(request.tools);
    const body = {
      model: this.options.model,
      messages: toChatMessages(request.system, request.messages, this.extraContentById),
      ...(tools.length > 0 ? { tools } : {}),
      stream: true,
      // Pide que el último evento incluya el conteo de tokens.
      stream_options: { include_usage: true },
    };

    const response = await this.post(JSON.stringify(body), signal);

    let text = "";
    let finishReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    // Las llamadas a herramientas llegan troceadas en muchos eventos; se
    // agrupan por índice (o por id si el proveedor no manda índice).
    const calls = new Map<string | number, ToolCallAccumulator>();
    let lastKey: string | number | undefined;

    for await (const chunk of readSseJson(response.body!)) {
      if (chunk.error) {
        throw new ProviderError(this.options.provider, Number(chunk.error.code) || 500, chunk.error.message ?? "error en el stream");
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta ?? {};
      const reasoning = delta.reasoning ?? delta.reasoning_content;
      if (reasoning) handlers.onThinking?.(reasoning);
      if (delta.content) {
        text += delta.content;
        handlers.onText?.(delta.content);
      }
      for (const part of delta.tool_calls ?? []) {
        const key = part.index ?? (part.id ? `id:${part.id}` : lastKey ?? 0);
        lastKey = key;
        let acc = calls.get(key);
        if (!acc) calls.set(key, (acc = { id: "", name: "", args: "" }));
        if (part.id) acc.id = part.id;
        if (part.function?.name) acc.name = part.function.name;
        if (part.function?.arguments) acc.args += part.function.arguments;
        if (part.extra_content !== undefined) acc.extra = part.extra_content;
      }
    }

    // ── Traducción de vuelta: OpenAI -> formato interno ──
    const content: BetaContentBlock[] = [];
    if (text) content.push({ type: "text", text, citations: null } as BetaContentBlock);
    for (const call of calls.values()) {
      let input: unknown;
      try {
        input = call.args.trim() === "" ? {} : JSON.parse(call.args);
      } catch {
        throw new InvalidToolInputError(`JSON inválido para ${call.name}: ${call.args.slice(0, 200)}`);
      }
      const id = call.id || `call_${randomUUID()}`;
      if (call.extra !== undefined) this.extraContentById.set(id, call.extra);
      content.push({ type: "tool_use", id, name: call.name, input } as BetaContentBlock);
    }

    return {
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      model: this.options.model,
      content,
      stop_reason: mapFinishReason(finishReason, calls.size > 0),
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as BetaMessage;
  }

  /** POST con reintentos ante límites de uso (429) y errores del servidor (5xx). */
  private async post(body: string, signal?: AbortSignal): Promise<Response> {
    const { provider, baseURL, apiKey, headers, maxRetries = 3, retryBaseMs = 1000 } = this.options;
    const url = `${baseURL.replace(/\/+$/, "")}/chat/completions`;

    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...headers,
        },
        body,
        signal,
      });
      if (response.ok && response.body) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        const detail = await response.text().catch(() => "");
        throw new ProviderError(provider, response.status, detail.slice(0, 500) || response.statusText);
      }
      // Respeta "retry-after" (segundos) si el proveedor lo manda; si no, backoff exponencial.
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : retryBaseMs * 2 ** attempt;
      await sleep(waitMs, signal);
    }
  }
}

export function mapFinishReason(finishReason: string | null, hasToolCalls: boolean): BetaStopReason {
  // Algunos proveedores devuelven "stop" aunque haya pedido herramientas:
  // nos fiamos de lo que realmente llegó.
  if (hasToolCalls) return finishReason === "length" ? "max_tokens" : "tool_use";
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "content_filter") return "refusal";
  return "end_turn";
}
