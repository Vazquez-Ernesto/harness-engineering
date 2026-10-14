/**
 * Presentación en la terminal. Nada de lógica del agente aquí: solo pinta los
 * eventos que emite el Agent. Si mañana haces una UI en React, sustituyes
 * este archivo y el resto del harness no cambia.
 */
import type { Interface } from "node:readline/promises";
import type { AgentEvents } from "../agent/agent.js";
import type { ApprovalAnswer, Approver } from "../permissions/permissions.js";

const color = (code: number) => (text: string) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
export const dim = color(2);
export const bold = color(1);
export const red = color(31);
export const green = color(32);
export const yellow = color(33);
export const cyan = color(36);

/** Primera línea + recorte, para no inundar la terminal con resultados largos. */
function preview(text: string, max = 160): string {
  const lines = text.split("\n");
  const first = lines[0]!.length > max ? lines[0]!.slice(0, max) + "…" : lines[0]!;
  return lines.length > 1 ? `${first} ${dim(`(+${lines.length - 1} líneas)`)}` : first;
}

export function createTerminalEvents(): AgentEvents {
  // Recordamos qué estábamos imprimiendo para insertar saltos de línea limpios.
  let mode: "none" | "text" | "thinking" = "none";
  const switchTo = (next: typeof mode) => {
    if (mode !== next && mode !== "none") process.stdout.write("\n");
    mode = next;
  };

  return {
    onThinking(delta) {
      if (mode !== "thinking") {
        switchTo("thinking");
        process.stdout.write(dim("✻ pensando: "));
      }
      process.stdout.write(dim(delta));
    },
    onText(delta) {
      switchTo("text");
      process.stdout.write(delta);
    },
    onToolCall({ name, summary }) {
      switchTo("none");
      process.stdout.write(`${cyan("⏺")} ${bold(name)} ${dim(summary)}\n`);
    },
    onToolResult({ content, isError }) {
      process.stdout.write(`  ${isError ? red("✗") : green("✓")} ${dim(preview(content))}\n`);
    },
    onNotice(message) {
      switchTo("none");
      process.stdout.write(`${yellow("⚠")} ${message}\n`);
    },
  };
}

export function createTerminalApprover(rl: Interface): Approver {
  return async ({ tool, summary }) => {
    const question =
      `${yellow("?")} ¿Permitir ${bold(tool.name)} (${tool.risk})?\n  ${summary}\n` +
      `  ${dim("[s]í / [n]o / [t]odas las veces en esta sesión")} > `;
    for (;;) {
      const answer = (await rl.question(question)).trim().toLowerCase();
      const map: Record<string, ApprovalAnswer> = { s: "yes", si: "yes", sí: "yes", y: "yes", n: "no", no: "no", t: "always" };
      const result = map[answer];
      if (result) return result;
    }
  };
}
