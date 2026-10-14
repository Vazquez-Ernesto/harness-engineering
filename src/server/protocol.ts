/**
 * Protocolo entre la UI web y el servidor, por WebSocket.
 *
 * Es solo un contrato de tipos: lo importan el servidor (Node) y la web
 * (React), así ambos lados hablan exactamente el mismo idioma y TypeScript
 * avisa si uno cambia sin el otro.
 */

export type ProviderId = "anthropic" | "gemini" | "openrouter" | "ollama";
export type ToolRisk = "read" | "write" | "execute";
export type ApprovalAnswer = "yes" | "no" | "always";
export type TurnOutcome = "completed" | "max_steps" | "max_tokens" | "refusal" | "context_exceeded" | "aborted";

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ProviderOption {
  id: ProviderId;
  label: string;
  defaultModel: string;
  /** ¿Hay clave configurada en el servidor para este proveedor? */
  configured: boolean;
}

/** Mensajes que la web envía al servidor. */
export type ClientMessage =
  | { type: "user_message"; text: string }
  | { type: "approval"; toolUseId: string; answer: ApprovalAnswer }
  | { type: "cancel" }
  | { type: "reset" }
  | { type: "configure"; provider: ProviderId; model: string };

/** Mensajes que el servidor envía a la web. */
export type ServerMessage =
  | {
      type: "session";
      provider: ProviderId;
      model: string;
      workspace: string;
      providers: ProviderOption[];
      transcriptFile: string;
    }
  | { type: "busy"; busy: boolean }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; summary: string; risk: ToolRisk }
  | { type: "approval_request"; toolUseId: string }
  | { type: "tool_result"; id: string; name: string; content: string; isError: boolean }
  | { type: "notice"; message: string }
  | { type: "turn_end"; outcome: TurnOutcome; steps: number; usage: UsageSummary; costUsd: number | null }
  | { type: "reset_done" }
  | { type: "error"; message: string };
