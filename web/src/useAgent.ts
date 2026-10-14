/**
 * Hook que conecta la UI con el servidor del harness por WebSocket.
 *
 * Todo el estado de la conversación se deriva de los mensajes del servidor
 * con un reducer: dado el estado actual y un evento, devuelve el estado
 * siguiente. Así es fácil de razonar (y de testear).
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  ApprovalAnswer,
  ClientMessage,
  ProviderId,
  ProviderOption,
  ServerMessage,
  ToolRisk,
  TurnOutcome,
  UsageSummary,
} from "../../src/server/protocol";

export type ToolStatus = "running" | "awaiting_approval" | "ok" | "error";

export type ChatItem =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; thinking: string }
  | { kind: "tool"; key: string; id: string; name: string; summary: string; risk: ToolRisk; status: ToolStatus; result?: string }
  | { kind: "notice"; key: string; text: string }
  | { kind: "error"; key: string; text: string }
  | { kind: "turn_end"; key: string; outcome: TurnOutcome; steps: number; usage: UsageSummary; costUsd: number | null };

export interface SessionInfo {
  provider: ProviderId;
  model: string;
  workspace: string;
  providers: ProviderOption[];
  transcriptFile: string;
}

interface State {
  items: ChatItem[];
  busy: boolean;
  session: SessionInfo | null;
}

/** Acciones locales (no vienen del servidor) + mensajes del servidor. */
type Action = ServerMessage | { type: "local_user"; text: string } | { type: "local_answered"; toolUseId: string };

let keyCounter = 0;
const nextKey = () => String(++keyCounter);

/** Añade texto o razonamiento al último mensaje del asistente (o crea uno). */
function appendAssistant(items: ChatItem[], field: "text" | "thinking", delta: string): ChatItem[] {
  const last = items.at(-1);
  if (last?.kind === "assistant") {
    return [...items.slice(0, -1), { ...last, [field]: last[field] + delta }];
  }
  return [...items, { kind: "assistant", key: nextKey(), text: "", thinking: "", [field]: delta }];
}

function updateTool(items: ChatItem[], id: string, patch: Partial<Extract<ChatItem, { kind: "tool" }>>): ChatItem[] {
  return items.map((item) => (item.kind === "tool" && item.id === id ? { ...item, ...patch } : item));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "local_user":
      return { ...state, items: [...state.items, { kind: "user", key: nextKey(), text: action.text }] };
    case "local_answered":
      return { ...state, items: updateTool(state.items, action.toolUseId, { status: "running" }) };
    case "session":
      return { ...state, session: action };
    case "busy":
      return { ...state, busy: action.busy };
    case "text":
      return { ...state, items: appendAssistant(state.items, "text", action.delta) };
    case "thinking":
      return { ...state, items: appendAssistant(state.items, "thinking", action.delta) };
    case "tool_call":
      return {
        ...state,
        items: [...state.items, { kind: "tool", key: nextKey(), ...action, status: "running" }],
      };
    case "approval_request":
      return { ...state, items: updateTool(state.items, action.toolUseId, { status: "awaiting_approval" }) };
    case "tool_result":
      return {
        ...state,
        items: updateTool(state.items, action.id, { status: action.isError ? "error" : "ok", result: action.content }),
      };
    case "notice":
      return { ...state, items: [...state.items, { kind: "notice", key: nextKey(), text: action.message }] };
    case "error":
      return { ...state, items: [...state.items, { kind: "error", key: nextKey(), text: action.message }] };
    case "turn_end":
      return { ...state, items: [...state.items, { kind: "turn_end", key: nextKey(), ...action }] };
    case "reset_done":
      return { ...state, items: [] };
  }
}

export type ConnectionStatus = "connecting" | "open" | "closed";

export function useAgent() {
  const [state, dispatch] = useReducer(reducer, { items: [], busy: false, session: null });
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socketRef.current = socket;
    socket.onopen = () => setConnection("open");
    socket.onclose = () => setConnection("closed");
    socket.onmessage = (event) => dispatch(JSON.parse(event.data as string) as ServerMessage);
    return () => socket.close();
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  return {
    ...state,
    connection,
    sendMessage: (text: string) => {
      dispatch({ type: "local_user", text });
      send({ type: "user_message", text });
    },
    approve: (toolUseId: string, answer: ApprovalAnswer) => {
      dispatch({ type: "local_answered", toolUseId });
      send({ type: "approval", toolUseId, answer });
    },
    cancel: () => send({ type: "cancel" }),
    reset: () => send({ type: "reset" }),
    configure: (provider: ProviderId, model: string) => send({ type: "configure", provider, model }),
  };
}
