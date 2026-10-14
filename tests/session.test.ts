/**
 * Tests de la sesión web: simulan lo que haría el navegador (mensajes del
 * protocolo) y comprueban lo que el servidor le respondería. Sin red.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Session } from "../src/server/session.js";
import type { ServerMessage } from "../src/server/protocol.js";
import { isAllowedOrigin } from "../src/server/server.js";
import { loadConfig } from "../src/config.js";
import { FakeModel, message, text, toolUse } from "./helpers/fake-model.js";
import { makeWorkspace } from "./helpers/workspace.js";

const env = { OPENROUTER_API_KEY: "x" };

function makeSession(root: string, model: FakeModel) {
  const sent: ServerMessage[] = [];
  const session = new Session({
    config: loadConfig(env),
    workspaceRoot: root,
    send: (m) => sent.push(m),
    env,
    modelFactory: () => model,
    persistTranscript: false,
  });
  return { session, sent };
}

/** Espera hasta que llegue un mensaje del tipo indicado. */
async function waitFor(sent: ServerMessage[], type: ServerMessage["type"]): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (sent.some((m) => m.type === type)) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`No llegó ningún mensaje "${type}"`);
}

describe("Session", () => {
  it("al conectar envía la info de sesión con los proveedores", async () => {
    const { sent } = makeSession(await makeWorkspace(), new FakeModel([]));
    const info = sent.find((m) => m.type === "session");
    expect(info).toMatchObject({ provider: "openrouter" });
    expect(info?.type === "session" && info.providers.find((p) => p.id === "openrouter")?.configured).toBe(true);
    expect(info?.type === "session" && info.providers.find((p) => p.id === "gemini")?.configured).toBe(false);
  });

  it("flujo completo: pide permiso, el usuario aprueba y se escribe el archivo", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([
      message("tool_use", [toolUse("write_file", { path: "hola.txt", content: "hola" })]),
      message("end_turn", [text("Listo.")]),
    ]);
    const { session, sent } = makeSession(root, model);

    const turn = session.handle({ type: "user_message", text: "crea hola.txt" });
    await waitFor(sent, "approval_request");
    const request = sent.find((m) => m.type === "approval_request");
    await session.handle({ type: "approval", toolUseId: request!.type === "approval_request" ? request!.toolUseId : "", answer: "yes" });
    await turn;

    expect(await fs.readFile(path.join(root, "hola.txt"), "utf8")).toBe("hola");
    expect(sent.map((m) => m.type)).toEqual([
      "session", "busy", "tool_call", "approval_request", "tool_result", "text", "turn_end", "busy",
    ]);
  });

  it("cancelar rechaza la aprobación pendiente y no escribe nada", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([message("tool_use", [toolUse("write_file", { path: "x.txt", content: "x" })])]);
    const { session, sent } = makeSession(root, model);

    const turn = session.handle({ type: "user_message", text: "escribe" });
    await waitFor(sent, "approval_request");
    await session.handle({ type: "cancel" });
    await turn;

    expect(sent).toContainEqual(expect.objectContaining({ type: "turn_end", outcome: "aborted" }));
    await expect(fs.access(path.join(root, "x.txt"))).rejects.toThrow();
  });

  it("no permite elegir un proveedor sin clave", async () => {
    const { session, sent } = makeSession(await makeWorkspace(), new FakeModel([]));
    await session.handle({ type: "configure", provider: "gemini", model: "" });
    expect(sent.at(-1)).toMatchObject({ type: "error", message: expect.stringMatching(/GEMINI_API_KEY/) });
  });
});

describe("isAllowedOrigin (protección contra Cross-Site WebSocket Hijacking)", () => {
  it("acepta la propia UI y el servidor de desarrollo de Vite", () => {
    expect(isAllowedOrigin("http://localhost:4317", 4317)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173", 4317)).toBe(true);
  });

  it("rechaza otras webs y conexiones sin Origin", () => {
    expect(isAllowedOrigin("https://web-maliciosa.com", 4317)).toBe(false);
    expect(isAllowedOrigin("http://localhost:9999", 4317)).toBe(false);
    expect(isAllowedOrigin(undefined, 4317)).toBe(false);
  });
});
