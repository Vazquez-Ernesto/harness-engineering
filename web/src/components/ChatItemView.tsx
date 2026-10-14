import Markdown from "react-markdown";
import type { ApprovalAnswer, TurnOutcome } from "../../../src/server/protocol";
import type { ChatItem } from "../useAgent";

interface Props {
  item: ChatItem;
  onApprove: (toolUseId: string, answer: ApprovalAnswer) => void;
}

const OUTCOME_LABEL: Record<TurnOutcome, string> = {
  completed: "completado",
  max_steps: "límite de pasos",
  max_tokens: "respuesta cortada",
  refusal: "rechazado",
  context_exceeded: "contexto lleno",
  aborted: "cancelado",
};

const RISK_LABEL = { read: "lectura", write: "escritura", execute: "ejecución" } as const;

export function ChatItemView({ item, onApprove }: Props) {
  switch (item.kind) {
    case "user":
      return <div className="msg msg-user">{item.text}</div>;

    case "assistant":
      return (
        <div className="msg msg-assistant">
          {item.thinking && (
            <details className="thinking">
              <summary>Razonamiento</summary>
              <div>{item.thinking}</div>
            </details>
          )}
          {/* react-markdown no ejecuta HTML del modelo: solo convierte Markdown en elementos React. */}
          {item.text && (
            <div className="assistant-text">
              <Markdown>{item.text}</Markdown>
            </div>
          )}
        </div>
      );

    case "tool":
      return (
        <div className={`tool tool-${item.status}`}>
          <div className="tool-head">
            <span className={`tool-dot risk-${item.risk}`} title={RISK_LABEL[item.risk]} />
            <span className="tool-name">{item.name}</span>
            <code className="tool-summary">{item.summary}</code>
            <span className="tool-status">
              {item.status === "running" && "…"}
              {item.status === "ok" && "✓"}
              {item.status === "error" && "✗"}
            </span>
          </div>

          {item.status === "awaiting_approval" && (
            <div className="approval">
              <span>
                ¿Permitir esta acción de <strong>{RISK_LABEL[item.risk]}</strong>?
              </span>
              <div className="approval-buttons">
                <button className="btn btn-primary" onClick={() => onApprove(item.id, "yes")}>
                  Sí
                </button>
                <button className="btn" onClick={() => onApprove(item.id, "always")}>
                  Siempre en esta sesión
                </button>
                <button className="btn btn-danger" onClick={() => onApprove(item.id, "no")}>
                  No
                </button>
              </div>
            </div>
          )}

          {item.result !== undefined && (
            <details className="tool-result">
              <summary>{item.status === "error" ? "Ver error" : "Ver resultado"}</summary>
              <pre>{item.result}</pre>
            </details>
          )}
        </div>
      );

    case "notice":
      return <div className="notice">⚠ {item.text}</div>;

    case "error":
      return <div className="error">{item.text}</div>;

    case "turn_end": {
      const { usage } = item;
      const cost = item.costUsd === null ? "" : ` · ~$${item.costUsd.toFixed(4)}`;
      return (
        <div className="turn-end">
          {OUTCOME_LABEL[item.outcome]} · {item.steps} pasos · {usage.inputTokens.toLocaleString()} in /{" "}
          {usage.outputTokens.toLocaleString()} out tokens{cost}
        </div>
      );
    }
  }
}
