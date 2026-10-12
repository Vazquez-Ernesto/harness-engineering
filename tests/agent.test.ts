/**
 * Tests del bucle del agente. Cada test es un "guion" de lo que responde el
 * modelo y comprobamos cómo reacciona el harness. Es testing de caja negra
 * del harness, con el modelo como dependencia simulada (un mock).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { Agent } from "../src/agent/agent.js";
import { InvalidToolInputError } from "../src/model/client.js";
import { createDefaultRegistry } from "../src/tools/registry.js";
import { PermissionManager, type ApprovalAnswer } from "../src/permissions/permissions.js";
import { FakeModel, message, text, toolUse } from "./helpers/fake-model.js";
import { makeWorkspace } from "./helpers/workspace.js";

function makeAgent(model: FakeModel, root: string, opts: { approve?: ApprovalAnswer; maxSteps?: number } = {}) {
  return new Agent({
    model,
    tools: createDefaultRegistry(),
    permissions: new PermissionManager("ask", async () => opts.approve ?? "yes"),
    system: "system de prueba",
    workspaceRoot: root,
    maxSteps: opts.maxSteps ?? 10,
  });
}

/** Extrae los tool_result del último mensaje de usuario enviado al modelo. */
function lastToolResults(model: FakeModel): BetaToolResultBlockParam[] {
  const last = model.requests.at(-1)!.messages.at(-1)!;
  expect(last.role).toBe("user");
  return last.content as BetaToolResultBlockParam[];
}

describe("Agent", () => {
  it("termina en un paso si el modelo solo responde texto", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([message("end_turn", [text("¡Hola!")])]);
    const agent = makeAgent(model, root);

    const result = await agent.send("hola");

    expect(result).toMatchObject({ outcome: "completed", steps: 1 });
    expect(agent.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("envía system prompt y herramientas en cada llamada", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([message("end_turn", [text("ok")])]);
    await makeAgent(model, root).send("hola");

    const request = model.requests[0]!;
    expect(request.system).toBe("system de prueba");
    expect(request.tools.map((t) => ("name" in t ? t.name : t.type))).toEqual([
      "read_file", "list_files", "search_files", "edit_file", "write_file", "bash",
    ]);
  });

  it("ejecuta la herramienta pedida y devuelve el resultado al modelo", async () => {
    const root = await makeWorkspace({ "a.txt": "contenido secreto" });
    const call = toolUse("read_file", { path: "a.txt" });
    const model = new FakeModel([
      message("tool_use", [text("Voy a leerlo."), call]),
      message("end_turn", [text("Dice 'contenido secreto'.")]),
    ]);

    const result = await makeAgent(model, root).send("¿qué dice a.txt?");

    expect(result).toMatchObject({ outcome: "completed", steps: 2 });
    const [toolResult] = lastToolResults(model);
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: (call as { id: string }).id, is_error: false });
    expect(toolResult!.content).toContain("contenido secreto");
  });

  it("devuelve todos los resultados de llamadas paralelas en un solo mensaje", async () => {
    const root = await makeWorkspace({ "a.txt": "A", "b.txt": "B" });
    const model = new FakeModel([
      message("tool_use", [toolUse("read_file", { path: "a.txt" }), toolUse("read_file", { path: "b.txt" })]),
      message("end_turn", [text("listo")]),
    ]);

    await makeAgent(model, root).send("lee ambos");

    expect(lastToolResults(model)).toHaveLength(2);
  });

  it("valida la entrada del modelo y devuelve el error sin ejecutar", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([
      message("tool_use", [toolUse("write_file", { path: "x.txt" })]), // falta content
      message("end_turn", [text("perdón")]),
    ]);

    await makeAgent(model, root).send("escribe");

    const [toolResult] = lastToolResults(model);
    expect(toolResult).toMatchObject({ is_error: true });
    expect(toolResult!.content).toContain("Entrada inválida");
    await expect(fs.access(path.join(root, "x.txt"))).rejects.toThrow();
  });

  it("no ejecuta acciones que el usuario rechaza", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([
      message("tool_use", [toolUse("write_file", { path: "x.txt", content: "hola" })]),
      message("end_turn", [text("entendido")]),
    ]);

    await makeAgent(model, root, { approve: "no" }).send("escribe");

    const [toolResult] = lastToolResults(model);
    expect(toolResult).toMatchObject({ is_error: true });
    expect(toolResult!.content).toContain("no permitió");
    await expect(fs.access(path.join(root, "x.txt"))).rejects.toThrow();
  });

  it("responde con error si el modelo pide una herramienta inexistente", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([
      message("tool_use", [toolUse("borrar_todo", {})]),
      message("end_turn", [text("ok")]),
    ]);

    await makeAgent(model, root).send("hazlo");

    expect(lastToolResults(model)[0]).toMatchObject({ is_error: true, content: 'La herramienta "borrar_todo" no existe.' });
  });

  it("se detiene al alcanzar maxSteps", async () => {
    const root = await makeWorkspace({ "a.txt": "A" });
    const loop = () => message("tool_use", [toolUse("read_file", { path: "a.txt" })]);
    const model = new FakeModel([loop(), loop(), loop()]);

    const result = await makeAgent(model, root, { maxSteps: 3 }).send("bucle infinito");

    expect(result).toMatchObject({ outcome: "max_steps", steps: 3 });
  });

  it("ante un rechazo no añade la respuesta ni ejecuta herramientas", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([message("refusal", [toolUse("write_file", { path: "x", content: "y" })])]);
    const agent = makeAgent(model, root);

    const result = await agent.send("algo");

    expect(result.outcome).toBe("refusal");
    expect(agent.messages.map((m) => m.role)).toEqual(["user"]);
    await expect(fs.access(path.join(root, "x"))).rejects.toThrow();
  });

  it("no ejecuta un tool_use cortado por max_tokens", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([message("max_tokens", [toolUse("write_file", { path: "x", content: "a medias" })])]);

    const result = await makeAgent(model, root).send("escribe algo largo");

    expect(result.outcome).toBe("max_tokens");
    await expect(fs.access(path.join(root, "x"))).rejects.toThrow();
  });

  it("reintenta el paso si el JSON de una herramienta llega roto", async () => {
    const root = await makeWorkspace();
    const model = new FakeModel([new InvalidToolInputError("JSON roto"), message("end_turn", [text("ok")])]);

    const result = await makeAgent(model, root).send("hola");

    expect(result.outcome).toBe("completed");
    expect(model.requests).toHaveLength(2);
  });

  it("acumula el uso de tokens del turno", async () => {
    const root = await makeWorkspace({ "a.txt": "A" });
    const model = new FakeModel([
      message("tool_use", [toolUse("read_file", { path: "a.txt" })]),
      message("end_turn", [text("ok")]),
    ]);

    const result = await makeAgent(model, root).send("lee");

    expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 40 });
  });

  it("si se cancela, no ejecuta más herramientas pero deja el historial válido", async () => {
    const root = await makeWorkspace();
    const controller = new AbortController();
    const model = new FakeModel([message("tool_use", [toolUse("write_file", { path: "x", content: "y" })])]);
    const agent = new Agent({
      model,
      tools: createDefaultRegistry(),
      permissions: new PermissionManager("ask", async () => {
        controller.abort(); // el usuario pulsa Ctrl+C mientras se le pregunta
        return "no";
      }),
      system: "s",
      workspaceRoot: root,
      maxSteps: 10,
    });

    const result = await agent.send("escribe", controller.signal);

    expect(result.outcome).toBe("aborted");
    // Cada tool_use del asistente tiene su tool_result: la conversación puede continuar.
    expect(agent.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});
