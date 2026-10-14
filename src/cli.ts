#!/usr/bin/env node
/**
 * Punto de entrada: aquí se "ensambla" el harness.
 *
 * Fíjate en que este archivo solo conecta piezas (config, modelo,
 * herramientas, permisos, logs, UI). Cada pieza se puede cambiar o testear
 * por separado. Esa separación es lo que hace un harness mantenible.
 *
 * Uso:
 *   npm run dev                         -> modo interactivo
 *   npm run dev -- "explica este repo"  -> una sola tarea y termina
 *   npm run dev -- --cwd ../otro-proyecto
 *   npm run dev -- --auto-approve       -> no pregunta permisos (¡cuidado!)
 */
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig, loadDotEnv } from "./config.js";
import { JsonlTranscript } from "./observability/transcript.js";
import { formatUsage } from "./observability/usage.js";
import { createAgent } from "./agent/create-agent.js";
import type { TurnResult } from "./agent/agent.js";
import { bold, createTerminalApprover, createTerminalEvents, cyan, dim, red } from "./ui/terminal.js";

interface CliArgs {
  cwd: string;
  autoApprove: boolean;
  prompt: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cwd: process.cwd(), autoApprove: false, prompt: null };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--cwd") args.cwd = path.resolve(argv[++i] ?? ".");
    else if (arg === "--auto-approve") args.autoApprove = true;
    else rest.push(arg);
  }
  if (rest.length > 0) args.prompt = rest.join(" ");
  return args;
}

const HELP = `Comandos:
  /help    muestra esta ayuda
  /usage   tokens y coste acumulados de la sesión
  /reset   empieza una conversación nueva
  /exit    salir
Ctrl+C cancela el turno en curso.`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();
  const config = loadConfig();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const transcript = new JsonlTranscript(args.cwd);

  const agent = createAgent({
    config,
    workspaceRoot: args.cwd,
    approver: createTerminalApprover(rl),
    permissionMode: args.autoApprove ? "auto-approve" : "ask",
    events: createTerminalEvents(),
    transcript,
  });

  transcript.record({ type: "session_start", cwd: args.cwd, provider: config.provider, model: config.model });

  // Ctrl+C: si hay un turno en marcha lo cancela; si no, sale.
  let current: AbortController | null = null;
  rl.on("SIGINT", () => {
    if (current) current.abort();
    else rl.close();
  });

  async function runTurn(text: string): Promise<TurnResult | null> {
    current = new AbortController();
    try {
      const result = await agent.send(text, current.signal);
      process.stdout.write(`\n${dim(`[${result.outcome} · ${result.steps} pasos · ${formatUsage(config.model, result.usage)}]`)}\n`);
      return result;
    } catch (err) {
      process.stdout.write(`\n${red("Error:")} ${(err as Error).message}\n`);
      transcript.record({ type: "error", message: (err as Error).message });
      return null;
    } finally {
      current = null;
    }
  }

  // Modo una-tarea: ejecuta el prompt y termina.
  if (args.prompt) {
    const result = await runTurn(args.prompt);
    rl.close();
    process.exitCode = result?.outcome === "completed" ? 0 : 1;
    return;
  }

  console.log(`${bold("harness")} ${dim(`· ${config.provider} · ${config.model} · ${args.cwd}`)}`);
  console.log(dim(`Transcript: ${transcript.file}`));
  console.log(dim(`Escribe /help para ver los comandos.\n`));

  rl.on("close", () => {
    console.log(dim(`\nSesión: ${formatUsage(config.model, agent.totalUsage)}`));
    process.exit(0);
  });

  for (;;) {
    const input = (await rl.question(cyan("› "))).trim();
    if (!input) continue;
    if (input === "/exit") break;
    if (input === "/help") console.log(HELP);
    else if (input === "/usage") console.log(formatUsage(config.model, agent.totalUsage));
    else if (input === "/reset") {
      agent.reset();
      console.log(dim("Conversación reiniciada."));
    } else await runTurn(input);
  }
  rl.close();
}

main().catch((err) => {
  console.error(red("Error fatal:"), err instanceof Error ? err.message : err);
  process.exit(1);
});
