/**
 * EL BUCLE DEL AGENTE: el corazón de cualquier harness.
 *
 * Un "agente" no es magia; es este bucle:
 *
 *   1. Enviar al modelo: system prompt + herramientas + historial.
 *   2. El modelo responde con texto y/o peticiones de herramientas (tool_use).
 *   3. Si no pidió herramientas -> terminó el turno. Fin.
 *   4. Si pidió herramientas -> el harness valida, pide permiso, ejecuta y
 *      añade los resultados (tool_result) al historial. Volver al paso 1.
 *
 * Todo lo demás (permisos, logs, límites, reintentos) son las "barandillas"
 * que convierten ese bucle en algo fiable. Eso es harness engineering.
 */
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaStopReason,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { InvalidToolInputError, type ModelClient } from "../model/client.js";
import type { ToolRegistry } from "../tools/registry.js";
import { ToolError, type ToolContext } from "../tools/types.js";
import type { PermissionManager } from "../permissions/permissions.js";
import { nullTranscript, type Transcript } from "../observability/transcript.js";
import { addUsage, emptyUsage, type UsageTotals } from "../observability/usage.js";

/** Eventos para que la interfaz (CLI, web...) muestre lo que pasa en vivo. */
export interface AgentEvents {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolCall?: (name: string, summary: string) => void;
  onToolResult?: (name: string, result: string, isError: boolean) => void;
  /** Avisos del propio harness (reintentos, límites...). */
  onNotice?: (message: string) => void;
}

export interface AgentOptions {
  model: ModelClient;
  tools: ToolRegistry;
  permissions: PermissionManager;
  system: string;
  workspaceRoot: string;
  maxSteps: number;
  events?: AgentEvents;
  transcript?: Transcript;
}

/** Por qué terminó un turno. Útil para tests y para la interfaz. */
export type TurnOutcome =
  | "completed" // el modelo terminó con normalidad
  | "max_steps" // alcanzamos el límite de vueltas del bucle
  | "max_tokens" // la respuesta se cortó por longitud
  | "refusal" // el modelo (o un clasificador) rechazó la petición
  | "context_exceeded" // la conversación no cabe en la ventana de contexto
  | "aborted"; // el usuario canceló

export interface TurnResult {
  outcome: TurnOutcome;
  steps: number;
  usage: UsageTotals;
}

/** Cuántas veces reintentamos un turno cuyo JSON de herramienta vino roto. */
const MAX_INVALID_JSON_RETRIES = 2;

export class Agent {
  /**
   * El historial completo. La API no tiene memoria: en cada llamada le
   * reenviamos TODO. Solo se añaden mensajes al final (append-only), nunca se
   * editan los anteriores; así el prompt cache sigue funcionando.
   */
  readonly messages: BetaMessageParam[] = [];
  readonly totalUsage: UsageTotals = emptyUsage();

  private readonly transcript: Transcript;
  private readonly events: AgentEvents;

  constructor(private readonly options: AgentOptions) {
    this.transcript = options.transcript ?? nullTranscript;
    this.events = options.events ?? {};
  }

  /** Procesa un mensaje del usuario hasta que el agente termina su turno. */
  async send(userText: string, signal?: AbortSignal): Promise<TurnResult> {
    const { model, tools, system, maxSteps } = this.options;
    const usage = emptyUsage();
    this.messages.push({ role: "user", content: userText });
    this.transcript.record({ type: "user_message", text: userText });

    let invalidJsonRetries = 0;
    for (let step = 1; step <= maxSteps; step++) {
      if (signal?.aborted) return this.finish("aborted", step - 1, usage);

      // ── 1. Llamar al modelo ────────────────────────────────────────────
      let response;
      try {
        response = await model.send(
          { system, tools: tools.toApiTools(), messages: this.messages },
          { onText: this.events.onText, onThinking: this.events.onThinking },
          signal,
        );
        invalidJsonRetries = 0;
      } catch (err) {
        if (signal?.aborted) return this.finish("aborted", step, usage);
        if (err instanceof InvalidToolInputError && invalidJsonRetries++ < MAX_INVALID_JSON_RETRIES) {
          this.events.onNotice?.("El modelo generó JSON inválido para una herramienta; reintentando el paso.");
          this.transcript.record({ type: "retry", reason: "invalid_tool_json", error: err.message });
          continue;
        }
        throw err;
      }

      addUsage(usage, response.usage);
      addUsage(this.totalUsage, response.usage);
      this.transcript.record({
        type: "assistant_message",
        step,
        stop_reason: response.stop_reason,
        content: response.content,
        usage: response.usage,
      });

      // ── 2. Decidir según por qué paró el modelo ────────────────────────
      const outcome = this.handleStopReason(response.stop_reason, response.content);
      if (outcome === "continue") continue;
      if (outcome !== "run_tools") return this.finish(outcome, step, usage);

      // ── 3. Ejecutar las herramientas pedidas ───────────────────────────
      const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
      const results: BetaToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        results.push(await this.runTool(toolUse, signal));
      }

      // ── 4. Devolver TODOS los resultados juntos en un único mensaje ────
      // (Separarlos en varios mensajes enseña al modelo a no pedir
      // herramientas en paralelo.)
      this.messages.push({ role: "user", content: results });
      if (signal?.aborted) return this.finish("aborted", step, usage);
    }

    this.events.onNotice?.(`Alcancé el límite de ${maxSteps} pasos. Escribe "continúa" para seguir.`);
    return this.finish("max_steps", maxSteps, usage);
  }

  /**
   * Traduce el stop_reason de la API en la siguiente acción del bucle.
   * Además añade la respuesta al historial cuando corresponde.
   */
  private handleStopReason(
    stopReason: BetaStopReason | null,
    content: BetaContentBlock[],
  ): TurnOutcome | "continue" | "run_tools" {
    const hasToolUse = content.some((b) => b.type === "tool_use");

    switch (stopReason) {
      case "tool_use":
        this.messages.push({ role: "assistant", content });
        return "run_tools";

      case "pause_turn":
        // Una herramienta de servidor pausó un turno largo: se reenvía tal cual para continuar.
        this.messages.push({ role: "assistant", content });
        return "continue";

      case "refusal":
        // No añadimos la respuesta: puede contener un tool_use cortado a la mitad
        // y nunca hay que ejecutar herramientas de un turno rechazado.
        this.events.onNotice?.("El modelo rechazó esta petición.");
        return "refusal";

      case "max_tokens":
        // Si se cortó en medio de un tool_use, la entrada está incompleta: no se ejecuta.
        if (hasToolUse) {
          this.events.onNotice?.("La respuesta se cortó mientras pedía una herramienta; no la ejecuto.");
        } else {
          this.messages.push({ role: "assistant", content });
          this.events.onNotice?.("La respuesta se cortó por longitud.");
        }
        return "max_tokens";

      case "model_context_window_exceeded":
        this.events.onNotice?.("La conversación ya no cabe en la ventana de contexto. Usa /reset para empezar de cero.");
        return "context_exceeded";

      default:
        // end_turn, stop_sequence, etc.: el modelo terminó.
        this.messages.push({ role: "assistant", content });
        return "completed";
    }
  }

  /** Valida, pide permiso y ejecuta UNA herramienta. Nunca lanza: los fallos vuelven al modelo. */
  private async runTool(toolUse: BetaToolUseBlock, signal?: AbortSignal): Promise<BetaToolResultBlockParam> {
    const { tools, permissions, workspaceRoot } = this.options;
    const reply = (content: string, isError: boolean): BetaToolResultBlockParam => {
      this.events.onToolResult?.(toolUse.name, content, isError);
      this.transcript.record({ type: "tool_result", tool: toolUse.name, id: toolUse.id, is_error: isError, content });
      return { type: "tool_result", tool_use_id: toolUse.id, content, is_error: isError };
    };

    // Cada tool_use necesita su tool_result, aunque el usuario haya cancelado.
    if (signal?.aborted) return reply("Cancelado por el usuario antes de ejecutarse.", true);

    const tool = tools.get(toolUse.name);
    if (!tool) return reply(`La herramienta "${toolUse.name}" no existe.`, true);

    // La entrada viene del modelo: es input NO confiable. Se valida siempre.
    const parsed = tool.schema.safeParse(toolUse.input);
    if (!parsed.success) {
      return reply(
        `Entrada inválida para ${tool.name}: ${parsed.error.message}\nRecibido: ${JSON.stringify(toolUse.input)}`,
        true,
      );
    }

    const summary = tool.summarize?.(parsed.data) ?? JSON.stringify(parsed.data);
    this.events.onToolCall?.(tool.name, summary);
    this.transcript.record({ type: "tool_call", tool: tool.name, id: toolUse.id, input: parsed.data });

    const decision = await permissions.check({ tool, input: parsed.data, summary });
    this.transcript.record({ type: "permission", tool: tool.name, id: toolUse.id, ...decision });
    if (!decision.allowed) {
      return reply(`El usuario no permitió esta acción (${decision.reason}). No la reintentes; pregunta cómo seguir.`, true);
    }

    const ctx: ToolContext = { workspaceRoot, signal };
    try {
      return reply(await tool.run(parsed.data, ctx), false);
    } catch (err) {
      // ToolError = fallo esperado (archivo no existe...). Cualquier otro
      // error también se devuelve al modelo en vez de tumbar el harness.
      const message = err instanceof ToolError ? err.message : `Error inesperado: ${(err as Error).message}`;
      return reply(message, true);
    }
  }

  private finish(outcome: TurnOutcome, steps: number, usage: UsageTotals): TurnResult {
    this.transcript.record({ type: "turn_end", outcome, steps, usage });
    return { outcome, steps, usage };
  }

  /** Borra el historial para empezar una conversación nueva. */
  reset(): void {
    this.messages.length = 0;
    this.transcript.record({ type: "reset" });
  }
}
