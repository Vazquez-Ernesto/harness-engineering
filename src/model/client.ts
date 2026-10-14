/**
 * El contrato entre el bucle del agente y "un modelo de IA".
 *
 * El bucle NO sabe con qué proveedor habla. Depende solo de esta interfaz.
 * Cada proveedor (Anthropic, Gemini, OpenRouter, Ollama...) tiene un
 * ADAPTADOR que la implementa. Eso permite:
 *   - Cambiar de proveedor sin tocar el bucle.
 *   - Testear el bucle con un modelo falso (sin gastar tokens ni red).
 *
 * Formato interno: el historial se guarda con la forma de mensajes de la API
 * de Anthropic (bloques text / tool_use / tool_result). Los adaptadores de
 * otros proveedores traducen desde y hacia ese formato.
 */
import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

export interface ModelRequest {
  system: string;
  tools: BetaToolUnion[];
  messages: BetaMessageParam[];
}

/** Callbacks para mostrar la respuesta mientras llega (streaming). */
export interface StreamHandlers {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
}

export interface ModelClient {
  send(request: ModelRequest, handlers?: StreamHandlers, signal?: AbortSignal): Promise<BetaMessage>;
}

/**
 * El modelo generó el JSON de entrada de una herramienta y no se pudo parsear.
 * Es recuperable: el bucle puede reintentar el turno.
 */
export class InvalidToolInputError extends Error {}
