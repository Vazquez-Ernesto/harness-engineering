import { describe, expect, it, vi } from "vitest";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  OpenAICompatibleModelClient,
  ProviderError,
  mapFinishReason,
  toChatMessages,
} from "../src/model/openai-compatible.js";
import { InvalidToolInputError } from "../src/model/client.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { sseResponse } from "./helpers/sse.js";

const request = (messages: BetaMessageParam[] = [{ role: "user", content: "hola" }]) => ({
  system: "sys",
  tools: createDefaultRegistry().toApiTools(),
  messages,
});

function clientWith(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof OpenAICompatibleModelClient>[0]> = {}) {
  return new OpenAICompatibleModelClient({
    provider: "test",
    baseURL: "https://api.test/v1/",
    apiKey: "clave",
    model: "modelo-x",
    fetch: fetchImpl,
    retryBaseMs: 1,
    ...extra,
  });
}

describe("toChatMessages (formato interno -> OpenAI)", () => {
  it("traduce texto, tool_use y tool_result", () => {
    const messages: BetaMessageParam[] = [
      { role: "user", content: "lee a.txt" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Voy." },
          { type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.txt" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "no existe", is_error: true }],
      },
    ];

    expect(toChatMessages("sys", messages, new Map([["call_1", { google: { thought_signature: "abc" } }]]))).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "lee a.txt" },
      {
        role: "assistant",
        content: "Voy.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"a.txt"}' },
            extra_content: { google: { thought_signature: "abc" } },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "ERROR: no existe" },
    ]);
  });

  it("descarta los bloques thinking", () => {
    const out = toChatMessages("sys", [
      { role: "user", content: "hola" },
      { role: "assistant", content: [{ type: "thinking", thinking: "mmm", signature: "s" }, { type: "text", text: "hola" }] },
    ]);
    expect(out.at(-1)).toEqual({ role: "assistant", content: "hola" });
  });
});

describe("OpenAICompatibleModelClient", () => {
  it("envía la petición en formato OpenAI con la API key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([{ choices: [{ delta: { content: "hola" }, finish_reason: "stop" }] }]),
    );
    await clientWith(fetchMock).send(request());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.test/v1/chat/completions");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer clave");
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ model: "modelo-x", stream: true });
    expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "read_file" } });
  });

  it("hace streaming del texto y devuelve un mensaje end_turn con el uso", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse(
        [
          { choices: [{ delta: { reasoning: "pienso" } }] },
          { choices: [{ delta: { content: "Ho" } }] },
          { choices: [{ delta: { content: "la" }, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
        ],
        { splitEvery: 7 }, // trozos pequeños: prueba que el parser junta líneas partidas
      ),
    );
    const deltas: string[] = [];
    const thinking: string[] = [];

    const message = await clientWith(fetchMock).send(request(), {
      onText: (d) => deltas.push(d),
      onThinking: (d) => thinking.push(d),
    });

    expect(deltas.join("")).toBe("Hola");
    expect(thinking).toEqual(["pienso"]);
    expect(message.stop_reason).toBe("end_turn");
    expect(message.content).toEqual([{ type: "text", text: "Hola", citations: null }]);
    expect(message.usage).toMatchObject({ input_tokens: 12, output_tokens: 3 });
  });

  it("junta llamadas a herramientas troceadas en varios eventos", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "read_file", arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.txt"}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "list_files", arguments: "{}" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ]),
    );

    const message = await clientWith(fetchMock).send(request());

    expect(message.stop_reason).toBe("tool_use");
    expect(message.content).toEqual([
      { type: "tool_use", id: "call_a", name: "read_file", input: { path: "a.txt" } },
      { type: "tool_use", id: "call_b", name: "list_files", input: {} },
    ]);
  });

  it("guarda extra_content (thought signatures de Gemini) y lo devuelve en el siguiente turno", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { id: "g1", function: { name: "list_files", arguments: "{}" }, extra_content: { google: { thought_signature: "firma" } } },
                  ],
                },
                finish_reason: "stop",
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]));
    const client = clientWith(fetchMock);

    const first = await client.send(request());
    await client.send(
      request([
        { role: "user", content: "lista" },
        { role: "assistant", content: first.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "g1", content: "a.txt" }] },
      ]),
    );

    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    const assistant = secondBody.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistant.tool_calls[0].extra_content).toEqual({ google: { thought_signature: "firma" } });
  });

  it("lanza InvalidToolInputError si los argumentos no son JSON válido", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c", function: { name: "bash", arguments: "{roto" } }] }, finish_reason: "tool_calls" }] }]),
    );
    await expect(clientWith(fetchMock).send(request())).rejects.toBeInstanceOf(InvalidToolInputError);
  });

  it("reintenta ante un 429 y luego continúa", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(sseResponse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]));

    const message = await clientWith(fetchMock).send(request());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(message.stop_reason).toBe("end_turn");
  });

  it("no reintenta errores del cliente como un 401", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("clave inválida", { status: 401 }));

    await expect(clientWith(fetchMock).send(request())).rejects.toThrow(ProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("convierte un error dentro del stream en ProviderError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([{ error: { message: "modelo saturado", code: 503 } }]));
    await expect(clientWith(fetchMock).send(request())).rejects.toThrow(/modelo saturado/);
  });
});

describe("mapFinishReason", () => {
  it("prioriza las llamadas a herramientas recibidas sobre finish_reason", () => {
    expect(mapFinishReason("stop", true)).toBe("tool_use");
    expect(mapFinishReason("length", true)).toBe("max_tokens");
    expect(mapFinishReason("content_filter", false)).toBe("refusal");
    expect(mapFinishReason(null, false)).toBe("end_turn");
  });
});
