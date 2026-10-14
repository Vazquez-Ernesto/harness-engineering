/**
 * Un modelo falso con respuestas guionizadas.
 *
 * Así testeamos el bucle del agente de forma determinista, sin red y sin
 * gastar tokens: le decimos "en la llamada 1 pide read_file, en la 2 termina"
 * y comprobamos que el harness hace lo correcto con eso.
 */
import type {
  BetaContentBlock,
  BetaMessage,
  BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ModelClient, ModelRequest, StreamHandlers } from "../../src/model/client.js";

type Scripted = BetaMessage | Error;

export class FakeModel implements ModelClient {
  /** Copia de cada petición recibida, para hacer aserciones. */
  readonly requests: ModelRequest[] = [];
  private readonly script: Scripted[];

  constructor(script: Scripted[]) {
    this.script = [...script];
  }

  async send(request: ModelRequest, handlers: StreamHandlers = {}): Promise<BetaMessage> {
    // structuredClone: el agente sigue mutando su historial después de la llamada.
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (!next) throw new Error("FakeModel: no quedan respuestas en el guion");
    if (next instanceof Error) throw next;
    for (const block of next.content) if (block.type === "text") handlers.onText?.(block.text);
    return next;
  }
}

let idCounter = 0;

export function toolUse(name: string, input: unknown): BetaContentBlock {
  return { type: "tool_use", id: `toolu_${++idCounter}`, name, input } as BetaContentBlock;
}

export function text(value: string): BetaContentBlock {
  return { type: "text", text: value, citations: null } as BetaContentBlock;
}

export function message(stopReason: BetaStopReason, content: BetaContentBlock[]): BetaMessage {
  return {
    id: `msg_${++idCounter}`,
    type: "message",
    role: "assistant",
    model: "fake-model",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as BetaMessage;
}
