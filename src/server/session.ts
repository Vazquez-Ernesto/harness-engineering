/**
 * Una sesión = una pestaña del navegador conectada.
 *
 * Traduce mensajes del protocolo en llamadas al Agent y los eventos del Agent
 * en mensajes para la web. No sabe nada de WebSockets: recibe una función
 * `send`, lo que permite testearla sin red.
 */
import { Agent } from "../agent/agent.js";
import { createAgent } from "../agent/create-agent.js";
import type { HarnessConfig } from "../config.js";
import type { ModelClient } from "../model/client.js";
import { PROVIDERS, isConfigured, isProviderId } from "../model/providers.js";
import type { ApprovalAnswer, ApprovalRequest } from "../permissions/permissions.js";
import { JsonlTranscript, nullTranscript, type Transcript } from "../observability/transcript.js";
import { estimateCostUsd } from "../observability/usage.js";
import type * as Protocol from "./protocol.js";
import type { ClientMessage, ProviderOption, ServerMessage } from "./protocol.js";
import type { ProviderId } from "../model/providers.js";
import type { ToolRisk } from "../tools/types.js";
import type { TurnOutcome } from "../agent/agent.js";

// protocol.ts repite algunos tipos para que la web no dependa de código de
// Node. Estas líneas hacen que TypeScript falle si alguna vez divergen.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _protocolInSync: [
  Same<Protocol.ProviderId, ProviderId>,
  Same<Protocol.ToolRisk, ToolRisk>,
  Same<Protocol.TurnOutcome, TurnOutcome>,
  Same<Protocol.ApprovalAnswer, ApprovalAnswer>,
] = [true, true, true, true];
void _protocolInSync;

export interface SessionOptions {
  config: HarnessConfig;
  workspaceRoot: string;
  send: (message: ServerMessage) => void;
  env?: NodeJS.ProcessEnv;
  /** Para tests: fábrica de modelos falsos. */
  modelFactory?: (config: HarnessConfig) => ModelClient;
  /** Para tests: false = no escribir transcript en disco. */
  persistTranscript?: boolean;
}

export class Session {
  private config: HarnessConfig;
  /** null si el proveedor elegido no tiene clave: la web puede elegir otro. */
  private agent: Agent | null = null;
  private readonly transcript: Transcript & { file?: string };
  private running: AbortController | null = null;
  /** Aprobaciones esperando respuesta del usuario, por id de tool_use. */
  private readonly pendingApprovals = new Map<string, (answer: ApprovalAnswer) => void>();

  constructor(private readonly options: SessionOptions) {
    this.config = options.config;
    this.transcript = options.persistTranscript === false ? nullTranscript : new JsonlTranscript(options.workspaceRoot);
    this.transcript.record({ type: "session_start", ui: "web", provider: this.config.provider, model: this.config.model });
    this.sendSessionInfo();
    try {
      this.agent = this.buildAgent();
    } catch (err) {
      this.error(`${(err as Error).message} Elige un proveedor configurado en la cabecera.`);
    }
  }

  private get env(): NodeJS.ProcessEnv {
    return this.options.env ?? process.env;
  }

  private buildAgent(): Agent {
    const send = this.options.send;
    return createAgent({
      config: this.config,
      workspaceRoot: this.options.workspaceRoot,
      model: this.options.modelFactory?.(this.config),
      transcript: this.transcript,
      approver: (request) => this.requestApproval(request),
      events: {
        onText: (delta) => send({ type: "text", delta }),
        onThinking: (delta) => send({ type: "thinking", delta }),
        onToolCall: (call) => send({ type: "tool_call", ...call }),
        onToolResult: (result) => send({ type: "tool_result", ...result }),
        onNotice: (message) => send({ type: "notice", message }),
      },
    });
  }

  private sendSessionInfo(): void {
    const providers: ProviderOption[] = Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.defaultModel,
      configured: isConfigured(p.id, this.env),
    }));
    this.options.send({
      type: "session",
      provider: this.config.provider,
      model: this.config.model,
      workspace: this.options.workspaceRoot,
      providers,
      transcriptFile: this.transcript.file ?? "",
    });
  }

  /** El Agent pide permiso: preguntamos a la web y esperamos su respuesta. */
  private requestApproval(request: ApprovalRequest): Promise<ApprovalAnswer> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(request.toolUseId, resolve);
      this.options.send({ type: "approval_request", toolUseId: request.toolUseId });
    });
  }

  async handle(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "user_message":
        return this.runTurn(message.text);
      case "approval": {
        const resolve = this.pendingApprovals.get(message.toolUseId);
        this.pendingApprovals.delete(message.toolUseId);
        resolve?.(message.answer);
        return;
      }
      case "cancel":
        this.cancel();
        return;
      case "reset":
        if (this.running) return this.error("Espera a que termine el turno (o cancélalo) antes de reiniciar.");
        this.agent?.reset();
        this.options.send({ type: "reset_done" });
        return;
      case "configure":
        return this.configure(message.provider, message.model);
    }
  }

  private async runTurn(text: string): Promise<void> {
    if (this.running) return this.error("El agente ya está trabajando. Espera o cancela el turno.");
    if (!text.trim()) return;
    if (!this.agent) return this.error("No hay ningún modelo configurado. Elige un proveedor con API key.");

    const agent = this.agent;
    const controller = new AbortController();
    this.running = controller;
    this.options.send({ type: "busy", busy: true });
    try {
      const result = await agent.send(text, controller.signal);
      this.options.send({
        type: "turn_end",
        outcome: result.outcome,
        steps: result.steps,
        usage: result.usage,
        costUsd: estimateCostUsd(this.config.model, result.usage),
      });
    } catch (err) {
      this.transcript.record({ type: "error", message: (err as Error).message });
      this.error((err as Error).message);
    } finally {
      this.running = null;
      this.options.send({ type: "busy", busy: false });
    }
  }

  private configure(provider: string, model: string): void {
    if (this.running) return this.error("No puedes cambiar de modelo mientras el agente trabaja.");
    if (!isProviderId(provider)) return this.error(`Proveedor desconocido: ${provider}`);
    if (!isConfigured(provider, this.env)) {
      return this.error(`Falta ${PROVIDERS[provider].apiKeyEnv} en el servidor para usar ${PROVIDERS[provider].label}.`);
    }
    const next = { ...this.config, provider, model: model.trim() || PROVIDERS[provider].defaultModel };
    // Cambiar de modelo empieza una conversación nueva: cada proveedor guarda
    // detalles propios en el historial que otro no entendería.
    const previous = this.config;
    this.config = next;
    try {
      this.agent = this.buildAgent();
    } catch (err) {
      this.config = previous;
      return this.error((err as Error).message);
    }
    this.transcript.record({ type: "configure", provider: next.provider, model: next.model });
    this.sendSessionInfo();
    this.options.send({ type: "reset_done" });
  }

  /** Cancela el turno en curso y rechaza las aprobaciones pendientes. */
  cancel(): void {
    this.running?.abort();
    for (const resolve of this.pendingApprovals.values()) resolve("no");
    this.pendingApprovals.clear();
  }

  private error(message: string): void {
    this.options.send({ type: "error", message });
  }
}
